/* src/bot-simple.js
 * Telegram bot logic for Cloudflare Workers (no Telegraf).
 * - Direct Telegram API via fetch
 * - Supabase v2 client configured for edge
 * - DM wizard with inline keyboards
 * - Group-only /revisar search (case/accents-insensitive) by model
 * - Model saved in UPPERCASE
 */

import { createClient } from '@supabase/supabase-js';
import { logger } from './logger.js';
import { validate, phoneSubmissionSchema } from './validation.js';

// Utility: safe JSON fetch wrapper for Telegram API
async function tgFetch(token, method, payload) {
  const url = `https://api.telegram.org/bot${token}/${method}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const json = await res.json();
  if (!json.ok) {
    // Log, but do not throw to avoid breaking webhook response
    logger.error('Telegram API error', null, { method, response: json });
  }
  return json;
}

function toCsvArray(envVal) {
  return (envVal || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
}

// Normalize text for case-insensitive, accent-insensitive comparisons
function normalizeText(s) {
  return (s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip accents
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function toUpperModel(s) {
  return (s || '').trim().toUpperCase();
}

function parseYesNo(text) {
  const t = (text || '').trim().toLowerCase();
  if (["si", "sí", "s", "yes", "y", "ok"].includes(t)) return true;
  if (["no", "n", "cancel", "cancelar"].includes(t)) return false;
  return null;
}

function splitNormList(txt) {
  if (!txt || txt.trim() === '') return [];
  let s = String(txt);
  s = s.replace(/\r/g, ' ').replace(/\n/g, ' ');
  s = s.replace(/\|/g, ',').replace(/;/g, ',');
  const parts = s.split(/[\s,]+/).map(p => p.trim()).filter(Boolean);
  return parts;
}

function kbCancel() {
  return { inline_keyboard: [[{ text: 'Cancelar', callback_data: 'wiz:cancel' }]] };
}
function kbBackCancel() {
  return { inline_keyboard: [[
    { text: 'Atrás', callback_data: 'wiz:back' },
    { text: 'Cancelar', callback_data: 'wiz:cancel' }
  ]] };
}
function kbWorks() {
  return { inline_keyboard: [
    [
      { text: '👍 Sí', callback_data: 'wiz:works_yes' },
      { text: '👎 No', callback_data: 'wiz:works_no' }
    ],
    [
      { text: 'Atrás', callback_data: 'wiz:back' },
      { text: 'Cancelar', callback_data: 'wiz:cancel' }
    ]
  ] };
}
function kbConfirm() {
  return { inline_keyboard: [[
    { text: 'Atrás', callback_data: 'wiz:back' },
    { text: 'Confirmar', callback_data: 'wiz:confirm' },
    { text: 'Cancelar', callback_data: 'wiz:cancel' }
  ]] };
}

export class SimpleTelegramBot {
  constructor(env) {
    this.token = env.BOT_TOKEN;
    // Supabase edge-safe client
    this.supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
      global: { fetch }
    });
    this.adminIds = toCsvArray(env.ADMIN_TG_IDS);
    this.allowedChatIds = toCsvArray(env.ALLOWED_CHAT_IDS);
    // Moderation/welcome config
    this.showShortWelcomeInGroup = String(env.SHOW_SHORT_WELCOME_IN_GROUP || 'true').toLowerCase() !== 'false';
    this.rulesCommandEnabled = true;
    // Optional Vercel KV REST (for future captcha/flood control)
    this.kvUrl = env.VERCEL_KV_REST_API_URL;
    this.kvToken = env.VERCEL_KV_REST_API_TOKEN;
  }

  // Telegram API helpers
  async sendMessage(chat_id, text, opts = {}) {
    return tgFetch(this.token, 'sendMessage', {
      chat_id,
      text,
      parse_mode: opts.parse_mode || 'Markdown',
      reply_markup: opts.reply_markup,
      reply_to_message_id: opts.reply_to_message_id
    });
  }
  async sendChatAction(chat_id, action) {
    return tgFetch(this.token, 'sendChatAction', { chat_id, action });
  }
  async deleteMessage(chat_id, message_id) {
    return tgFetch(this.token, 'deleteMessage', { chat_id, message_id });
  }
  async answerCallbackQuery(callback_query_id, opts = {}) {
    return tgFetch(this.token, 'answerCallbackQuery', { callback_query_id, ...opts });
  }
  async editMessageText(chat_id, message_id, text, opts = {}) {
    return tgFetch(this.token, 'editMessageText', {
      chat_id,
      message_id,
      text,
      parse_mode: opts.parse_mode || 'Markdown',
      reply_markup: opts.reply_markup
    });
  }
  async editMessageReplyMarkup(chat_id, message_id, reply_markup) {
    return tgFetch(this.token, 'editMessageReplyMarkup', { chat_id, message_id, reply_markup });
  }

  // Webhook dispatcher
  async handleUpdate(update) {
    try {
      if (update.message) {
        await this.onMessage(update.message);
      } else if (update.callback_query) {
        await this.onCallback(update.callback_query);
      } else if (update.chat_join_request) {
        await this.onChatJoinRequest(update.chat_join_request);
      }
    } catch (e) {
      if (String(e).includes('duplicate key value') || String(e).includes('unique constraint')) {
        throw e;
      } else {
        logger.error('handleUpdate error', e);
      }
    }
  }

  // Access control for groups
  groupAllowed(chat) {
    if (!chat) return false;
    if (chat.type !== 'group' && chat.type !== 'supergroup') return true; // Not a group
    if (!this.allowedChatIds.length) return true;
    return this.allowedChatIds.includes(String(chat.id));
  }

  async onMessage(msg) {
    const chat = msg.chat;
    const chatId = chat.id;
    const userId = msg.from?.id;
    const chatType = chat?.type;
    const textRaw = msg.text || '';
    const text = textRaw.trim();

    // Ignore not-allowed groups
    if ((chatType === 'group' || chatType === 'supergroup') && !this.groupAllowed(chat)) return;

    // Welcome new members (group join)
    if (Array.isArray(msg.new_chat_members) && msg.new_chat_members.length) {
      for (const m of msg.new_chat_members) {
        if (m.is_bot) continue;
        await this.startCaptchaAndWelcome(m, chat);
      }
      return;
    }

    // If user has not passed captcha, block messages and remind
    if ((chatType === 'group' || chatType === 'supergroup') && userId) {
      const pending = await this.kvGet(`captcha:${chatId}:${userId}`);
      if (pending) {
        if (msg.message_id) await this.deleteMessage(chatId, msg.message_id);
        // remind silently
        await this.sendMessage(chatId, `⏳ @${msg.from?.username || userId} verifica en tu DM para participar.`, {});
        return;
      }
    }

    if (text.startsWith('/')) {
      await this.onCommand({ chatId, chatType, userId, msg, text });
      return;
    }

    // DM wizard text input
    if (chatType === 'private') {
      await this.handleWizardText(chatId, userId, text);
    }
  }

  async onCommand({ chatId, chatType, userId, msg, text }) {
    const [cmd, ...args] = text.split(/\s+/);
    const argStr = args.join(' ').trim();
    switch (cmd.toLowerCase()) {
      case '/start': {
        await this.sendWelcomeMessage(chatId, userId, chatType);
        break;
      }
      case '/id': {
        const isAdmin = this.adminIds.includes(String(userId));
        const user = msg.from;
        const chat = msg.chat;
        
        let response = '🆔 **Información de IDs**\n\n';
        response += `👤 **Usuario:**\n`;
        response += `• ID: \`${userId}\`\n`;
        response += `• Nombre: ${user.first_name || 'N/A'}\n`;
        response += `• Username: @${user.username || 'N/A'}\n`;
        response += `• Apellido: ${user.last_name || 'N/A'}\n\n`;
        
        response += `💬 **Chat:**\n`;
        response += `• ID: \`${chatId}\`\n`;
        response += `• Tipo: ${chatType}\n`;
        response += `• Título: ${chat.title || 'N/A'}\n`;
        
        if (isAdmin) {
          response += `\n🔧 **Info de Admin:**\n`;
          response += `• Es admin: ✅ Sí\n`;
          response += `• Timestamp: ${new Date().toISOString()}\n`;
        }
        
        await this.sendMessage(chatId, response);
        break;
      }
      case '/reglas': {
        await this.sendRules(userId, chatId, chatType);
        break;
      }
      case '/fijar': {
        // Solo admins pueden fijar reglas
        if (!this.adminIds.includes(String(userId))) {
          await this.sendMessage(chatId, '❌ Solo los administradores pueden usar este comando.');
          return;
        }
        
        if (chatType === 'private') {
          await this.sendMessage(chatId, 'Este comando solo funciona en grupos.');
          return;
        }
        
        const shortRules = this.getShortRules();
        await this.sendMessage(chatId, shortRules);
        break;
      }

      case '/exportar': {
        if (chatType === 'private') {
          await this.sendExportOptions(chatId);
        } else {
          await this.sendMessage(chatId, '📥 Para exportar la base de datos, escríbeme por DM y usa /exportar.');
        }
        break;
      }
      case '/subir': {
        if (chatType !== 'private') {
          await this.sendMessage(chatId, '💬 Para agregar un teléfono, escríbeme por DM y usa /subir ahí.');
        } else {
          await this.startWizard(chatId, userId);
        }
        break;
      }
      case '/revisar': {
        if (chatType === 'private') {
          await this.sendMessage(chatId, '🔍 El comando /revisar funciona solo en grupos. Aquí en DM usa /subir para agregar teléfonos.');
          return;
        }
        if (!argStr) {
          await this.sendMessage(chatId, '📝 Formato: /revisar <modelo>\n\nEjemplo: /revisar Samsung A14');
          return;
        }
        await this.searchByModel(chatId, argStr);
        break;
      }
      case '/cancelar': {
        await this.cancelWizard(chatId, userId);
        break;
      }
      case '/reportar': {
        await this.handleReport(chatId, userId, argStr);
        break;
      }
      case '/suscribir': {
        await this.handleSubscribe(chatId, userId);
        break;
      }
      case '/cancelarsub': {
        await this.handleUnsubscribe(chatId, userId);
        break;
      }
      default: {
        if (chatType === 'private') {
          await this.sendMessage(chatId, 'Usa /subir para iniciar el asistente.');
        }
        break;
      }
    }
  }

  // Search by model (case/accents-insensitive)
  async searchByModel(chatId, query) {
    try {
      const q = normalizeText(query);
      const { data, error } = await this.supabase
        .from('phones')
        .select('id, commercial_name, model, works, bands, provinces, observations, created_at')
        .eq('status', 'approved')
        .or('nombre_comercial.ilike.%' + q + '%,model.ilike.%' + q + '%')
        .limit(50);
      if (error) throw error;

      const matches = data || [];

      if (!matches.length) {
        await this.sendMessage(chatId, 'No encontramos ese modelo. ¿Quieres usar /subir para proponerlo?');
        return;
      }

      // Build a compact response to avoid spam in groups
      const lines = matches.slice(0, 8).map(r => {
        const w = r.works === true ? '✅' : (r.works === false ? '❌' : '❓');
        const bands = Array.isArray(r.bands) ? r.bands.join(', ') : (r.bands || '—');
        const provs = Array.isArray(r.provinces) ? r.provinces.join(', ') : (r.provinces || '—');
        const obs = r.observations ? ` | Obs: ${r.observations}` : '';
        return `• ${r.commercial_name} (${r.model}) ${w}\n  Bandas: ${bands}\n  Prov: ${provs}${obs}`;
      });
      let msg = '🔎 Resultados por modelo:\n\n' + lines.join('\n\n');
      if (matches.length > lines.length) msg += `\n\n(+${matches.length - lines.length} más...)`;
      await this.sendMessage(chatId, msg);
    } catch (e) {
      logger.error('searchByModel error', e, { chatId });
      await this.sendMessage(chatId, 'Se enredó la cosa 😅. Intenta de nuevo o /cancelar.');
    }
  }

  // Wizard state persistence
  async getDraft(tgId) {
    const { data } = await this.supabase
      .from('submission_drafts')
      .select('*')
      .eq('tg_id', String(tgId))
      .maybeSingle();
    return data || null;
  }
  async setDraft(tgId, patch) {
    const existing = await this.getDraft(tgId);
    if (existing) {
      const { data, error } = await this.supabase
        .from('submission_drafts')
        .update({ ...existing, ...patch, updated_at: new Date().toISOString() })
        .eq('tg_id', String(tgId))
        .select('*')
        .single();
      if (error) throw error;
      return data;
    } else {
      const { data, error } = await this.supabase
        .from('submission_drafts')
        .insert({ tg_id: String(tgId), step: 'awaiting_name', ...patch, updated_at: new Date().toISOString() })
        .select('*')
        .single();
      if (error) throw error;
      return data;
    }
  }
  async clearDraft(tgId) {
    await this.supabase.from('submission_drafts').delete().eq('tg_id', String(tgId));
  }

  // Wizard control
  async startWizard(chatId, userId) {
    await this.setDraft(userId, { step: 'awaiting_name', commercial_name: null, model: null, works: null, bands: null, provinces: null, observations: null });
    await this.sendMessage(chatId, '📲 Vamos a subir un modelo. Dime el nombre comercial (ej: "Redmi Note 12").', {
      reply_markup: kbCancel()
    });
  }
  async cancelWizard(chatId, userId) {
    await this.clearDraft(userId);
    await this.sendMessage(chatId, 'Listo, cancelado. Puedes empezar de nuevo con /subir.');
  }

  async handleWizardText(chatId, userId, text) {
    try {
      const draft = await this.getDraft(userId);
      if (!draft) return false;

      switch (draft.step) {
        case 'awaiting_name': {
          if (!text || text.length < 2) {
            await this.sendMessage(chatId, 'Por favor, envía un nombre comercial válido.', { reply_markup: kbCancel() });
            return true;
          }
          await this.setDraft(userId, { commercial_name: text, step: 'awaiting_model' });
          await this.sendMessage(chatId, 'Modelo exacto (ej: "2209116AG").', { reply_markup: kbBackCancel() });
          return true;
        }
        case 'awaiting_model': {
          if (!text || text.length < 1) {
            await this.sendMessage(chatId, 'Modelo inválido.', { reply_markup: kbBackCancel() });
            return true;
          }
          await this.setDraft(userId, { model: text, step: 'awaiting_works' });
          await this.sendMessage(chatId, '¿Funciona en Cuba? Responde "sí" o "no".', { reply_markup: kbWorks() });
          return true;
        }
        case 'awaiting_works': {
          const yn = parseYesNo(text);
          if (yn === null) {
            await this.sendMessage(chatId, 'Responde "sí" o "no".', { reply_markup: kbWorks() });
            return true;
          }
          if (yn) {
            await this.setDraft(userId, { works: true, step: 'awaiting_bands' });
            await this.sendMessage(chatId, 'Indica las bandas separadas por coma:\n\n📡 Bandas específicas: B3,B7,B28,B20,B38\n📶 Tecnologías: 2G,3G,4G,5G\n❓ O escribe "desconocido"', { reply_markup: kbBackCancel() });
          } else {
            await this.setDraft(userId, { works: false, step: 'awaiting_obs' });
            await this.sendMessage(chatId, 'Añade observaciones (ej: "sin señal 4G en Holguín").', { reply_markup: kbBackCancel() });
          }
          return true;
        }
        case 'awaiting_bands': {
          const bands = text.toLowerCase() === 'desconocido' ? [] : splitNormList(text);
          await this.setDraft(userId, { bands, step: 'awaiting_provinces' });
          await this.sendMessage(chatId, 'Indica las provincias separadas por coma (ej: La Habana, Santiago de Cuba) o escribe "-" para omitir.', { reply_markup: kbBackCancel() });
          return true;
        }
        case 'awaiting_provinces': {
          const provinces = text === '-' ? [] : splitNormList(text);
          await this.setDraft(userId, { provinces, step: 'awaiting_obs' });
          await this.sendMessage(chatId, 'Observaciones adicionales (opcional). Escribe "-" para omitir.', { reply_markup: kbBackCancel() });
          return true;
        }
        case 'awaiting_obs': {
          const observations = text === '-' ? null : text;
          await this.setDraft(userId, { observations, step: 'confirm' });
          const d = await this.getDraft(userId);
          const summary =
            '📌 Resumen:\n' +
            `Nombre: ${d.commercial_name}\n` +
            `Modelo: ${d.model}\n` +
            `¿Funciona?: ${d.works ? 'Sí' : 'No'}\n` +
            `Bandas: ${(d.bands && d.bands.length) ? d.bands.join(', ') : '—'}\n` +
            `Provincias: ${(d.provinces && d.provinces.length) ? d.provinces.join(', ') : '—'}\n` +
            `Obs: ${d.observations || '—'}`;
          await this.sendMessage(chatId, summary + '\n\nConfirma con el botón.', { reply_markup: kbConfirm() });
          return true;
        }
        case 'confirm': {
          // If user types instead of pressing buttons, accept yes/no
          const yn = parseYesNo(text);
          if (yn === null) {
            await this.sendMessage(chatId, 'Pulsa Confirmar o responde "sí" para confirmar o "no" para cancelar.', { reply_markup: kbConfirm() });
            return true;
          }
          if (yn) {
            await this.submitPhone(userId, chatId);
          } else {
            await this.cancelWizard(chatId, userId);
          }
          return true;
        }
        default:
          return false;
      }
    } catch (e) {
      logger.error('handleWizardText error', e, { chatId, userId });
      await this.sendMessage(chatId, 'Se enredó la cosa 😅. Intenta de nuevo o /cancelar.');
      return true;
    }
  }

  async onCallback(cb) {
    const id = cb.id;
    const data = cb.data || '';
    const msg = cb.message;
    const chatId = msg?.chat?.id;
    const userId = cb.from?.id;
    if (!chatId || !userId) return;

    try {

      // Export buttons
      if (data.startsWith('export:')) {
        await this.answerCallbackQuery(id);
        const format = data.split(':')[1];
        await this.handleExportCallback(chatId, userId, format);
        return;
      }

      // Welcome buttons
      if (data.startsWith('welcome:')) {
        await this.answerCallbackQuery(id);
        const action = data.split(':')[1];
        
        switch (action) {
          case 'add_phone':
            await this.startWizard(chatId, userId);
            break;
          case 'search':
            await this.sendMessage(chatId, '🔍 Para buscar teléfonos, usa el comando /revisar en el grupo o escribe el modelo que buscas.');
            break;
          case 'rules':
            await this.sendRules(userId, chatId, 'private');
            break;
          case 'stats':
            await this.sendStats(chatId);
            break;
          case 'export':
            await this.sendExportOptions(chatId);
            break;
          case 'help':
            await this.sendHelp(chatId);
            break;
          case 'back':
            await this.sendWelcomeMessage(chatId, userId, 'private');
            break;
        }
        return;
      }

      // Captcha buttons
      if (data.startsWith('cap:')) {
        await this.answerCallbackQuery(id);
        const parts = data.split(':'); // cap:ok|fail:chatId:userId
        const kind = parts[1];
        const cId = Number(parts[2]);
        const uId = Number(parts[3]);
        if (uId !== userId) return; // ignore others
        if (kind === 'ok') {
          await this.kvDel(`captcha:${cId}:${uId}`);
          await this.sendMessage(userId, '✅ ¡Verificación completada! Ahora puedes participar en el grupo.');
          await this.sendRules(userId, cId, 'private');
        } else {
          // Expulsar usuario del grupo
          await tgFetch(this.token, 'banChatMember', { chat_id: cId, user_id: uId });
          await tgFetch(this.token, 'unbanChatMember', { chat_id: cId, user_id: uId }); // unban inmediato para que pueda volver a intentar
          await this.kvDel(`captcha:${cId}:${uId}`);
          await this.sendMessage(userId, '❌ Has sido expulsado por no completar la verificación. Puedes volver a unirte al grupo.');
        }
        return;
      }

      if (!data.startsWith('wiz:')) return; // wizard controls below

      await this.answerCallbackQuery(id);

      const draft = await this.getDraft(userId);
      if (!draft) return;

      const prevMap = {
        awaiting_model: 'awaiting_name',
        awaiting_works: 'awaiting_model',
        awaiting_bands: 'awaiting_works',
        awaiting_provinces: 'awaiting_bands',
        awaiting_obs: 'awaiting_provinces',
        confirm: 'awaiting_obs'
      };

      if (data === 'wiz:cancel') {
        await this.cancelWizard(chatId, userId);
        return;
      }
      if (data === 'wiz:back') {
        const prev = prevMap[draft.step];
        if (!prev) return;
        await this.setDraft(userId, { step: prev });
        // re-prompt according to prev step
        switch (prev) {
          case 'awaiting_name':
            await this.sendMessage(chatId, 'Nombre comercial (ej: "Redmi Note 12").', { reply_markup: kbCancel() });
            break;
          case 'awaiting_model':
            await this.sendMessage(chatId, 'Modelo exacto (ej: "2209116AG").', { reply_markup: kbBackCancel() });
            break;
          case 'awaiting_works':
            await this.sendMessage(chatId, '¿Funciona en Cuba? Responde "sí" o "no".', { reply_markup: kbWorks() });
            break;
          case 'awaiting_bands':
            await this.sendMessage(chatId, 'Indica las bandas separadas por coma:\n\n📡 Bandas específicas: B3,B7,B28,B20,B38\n📶 Tecnologías: 2G,3G,4G,5G\n❓ O escribe "desconocido"', { reply_markup: kbBackCancel() });
            break;
          case 'awaiting_provinces':
            await this.sendMessage(chatId, 'Provincias separadas por coma o "-" para omitir.', { reply_markup: kbBackCancel() });
            break;
          case 'awaiting_obs':
            await this.sendMessage(chatId, 'Observaciones (opcional). Escribe "-" para omitir.', { reply_markup: kbBackCancel() });
            break;
        }
        return;
      }
      if (data === 'wiz:works_yes') {
        if (draft.step === 'awaiting_works') {
          await this.setDraft(userId, { works: true, step: 'awaiting_bands' });
          await this.sendMessage(chatId, 'Indica las bandas separadas por coma:\n\n📡 Bandas específicas: B3,B7,B28,B20,B38\n📶 Tecnologías: 2G,3G,4G,5G\n❓ O escribe "desconocido"', { reply_markup: kbBackCancel() });
        }
        return;
      }
      if (data === 'wiz:works_no') {
        if (draft.step === 'awaiting_works') {
          await this.setDraft(userId, { works: false, step: 'awaiting_obs' });
          await this.sendMessage(chatId, 'Añade observaciones (ej: "sin señal 4G en Holguín").', { reply_markup: kbBackCancel() });
        }
        return;
      }
      if (data === 'wiz:confirm' && draft.step === 'confirm') {
        await this.submitPhone(userId, chatId);
        return;
      }
    } catch (e) {
      logger.error('onCallback error', e, { userId: userId || 'unknown' });
    }
  }

  async onChatJoinRequest(req) {
    // Approve join request instantly (optional) and DM welcome
    const user = req.from;
    const chat = { id: req.chat?.id, type: req.chat?.type, title: req.chat?.title };
    // Try to approve (ignore errors silently)
    await tgFetch(this.token, 'approveChatJoinRequest', { chat_id: chat.id, user_id: user.id });
    try {
      await this.welcomeUserDM(user, chat);
      await this.startCaptcha(user, chat);
    } catch (err) {
      logger.warn('Failed to send welcome/captcha via DM', { error: err.message, userId: user.id });
      const mention = user.username ? `@${user.username}` : (user.first_name || 'usuario');
      const fallbackMsg = `⚠️ Hola ${mention}, no pude enviarte un mensaje privado de verificación. Por favor, inicia un chat privado conmigo primero para que pueda enviarte el captcha.`;
      await this.sendMessage(chat.id, fallbackMsg);
    }
  }

  async sendWelcomeMessage(chatId, userId, chatType) {
    try {
      // Get welcome message from database
      const { data } = await this.supabase
        .from('bot_config')
        .select('welcome')
        .single();

      let welcomeMessage = data?.welcome;
      
      if (!welcomeMessage) {
        // Fallback to default welcome message
        welcomeMessage = `🎉 *¡BIENVENIDO A CUBAMODEL!* 🇨🇺📱

🌟 *Base de Datos Abierta para Teléfonos en Cuba*

Este proyecto nació porque antes intentaron cobrar por una base que la comunidad creó gratis.

✨ Aquí todo es distinto: la información será _SIEMPRE_ abierta y descargable.

⚠️ *LIMITACIONES ACTUALES:*
• Puede ir lento en horas pico
• Hay topes de consultas
• Puede fallar (fase desarrollo)

💫 Gracias por sumarte. 
Esto es de todos y para todos. ✨`;
      }

      // Replace {fullname} placeholder if user info is available
      if (welcomeMessage.includes('{fullname}')) {
        // For now, we'll use a generic greeting since we don't have user info in this context
        welcomeMessage = welcomeMessage.replace('{fullname}', 'usuario');
      }

      // Create inline keyboard for welcome message
      const welcomeKeyboard = {
        inline_keyboard: [
          [
            { text: '📱 Agregar Teléfono', callback_data: 'welcome:add_phone' },
            { text: '🔍 Buscar Teléfonos', callback_data: 'welcome:search' }
          ],
          [
            { text: '📜 Ver Reglas', callback_data: 'welcome:rules' },
            { text: '📊 Ver Estadísticas', callback_data: 'welcome:stats' }
          ],
          [
            { text: '📥 Exportar Base', callback_data: 'welcome:export' },
            { text: '❓ Ayuda', callback_data: 'welcome:help' }
          ]
        ]
      };

      if (chatType === 'private') {
        await this.sendMessage(chatId, welcomeMessage, { reply_markup: welcomeKeyboard });
      } else {
        await this.sendMessage(chatId, 'Te envié el mensaje de bienvenida por DM. 📩');
        await this.sendMessage(userId, welcomeMessage, { reply_markup: welcomeKeyboard });
      }
    } catch (error) {
      logger.error('Error fetching welcome message from database', error);
      // Fallback to default welcome message
      const defaultWelcome = `🎉 *¡BIENVENIDO A CUBAMODEL!* 🇨🇺📱

🌟 *Base de Datos Abierta para Teléfonos en Cuba*

Este proyecto nació porque antes intentaron cobrar por una base que la comunidad creó gratis.

✨ Aquí todo es distinto: la información será _SIEMPRE_ abierta y descargable.

💫 Gracias por sumarte. 
Esto es de todos y para todos. ✨`;

      const defaultRulesAndCommands = `📜 *NUESTRAS REGLAS:*
1️⃣ Respeto; nada de insultos
2️⃣ No ventas, solo compatibilidad
3️⃣ Aporta datos reales con /subir
4️⃣ Usa /reportar para errores
5️⃣ La base es de todos

🇨🇺 ¡Vamos a hacer la mejor base de datos 
de compatibilidad de teléfonos en Cuba! 🇨🇺`;
      
      const welcomeKeyboard = {
        inline_keyboard: [
          [
            { text: '📱 Agregar Teléfono', callback_data: 'welcome:add_phone' },
            { text: '🔍 Buscar Teléfonos', callback_data: 'welcome:search' }
          ],
          [
            { text: '📜 Ver Reglas', callback_data: 'welcome:rules' },
            { text: '📊 Ver Estadísticas', callback_data: 'welcome:stats' }
          ],
          [
            { text: '📥 Exportar Base', callback_data: 'welcome:export' },
            { text: '❓ Ayuda', callback_data: 'welcome:help' }
          ]
        ]
      };
      
      if (chatType === 'private') {
        await this.sendMessage(chatId, defaultWelcome, { reply_markup: welcomeKeyboard });
        await this.sendMessage(chatId, defaultRulesAndCommands);
      } else {
        await this.sendMessage(chatId, 'Te envié el mensaje de bienvenida por DM. 📩');
        await this.sendMessage(userId, defaultWelcome, { reply_markup: welcomeKeyboard });
        await this.sendMessage(userId, defaultRulesAndCommands);
      }
    }
  }

  async sendRules(userId, chatId, chatType) {
    try {
      // Get rules from database
      const { data } = await this.supabase
        .from('bot_config')
        .select('rules')
        .single();

      const rules = data?.rules || 
        '📜 Reglas:\n' +
        '1) Respeto; nada de insultos ni spam.\n' +
        '2) No ventas, solo compatibilidad de teléfonos en Cuba.\n' +
        '3) Aporta datos reales con /subir.\n' +
        '4) Usa /reportar para avisar de errores.\n' +
        '5) La base es de todos, nadie puede privatizarla.';

      if (chatType === 'private') {
        await this.sendMessage(userId, rules);
      } else {
        await this.sendMessage(chatId, 'Te envié las reglas por DM. 📩');
        await this.sendMessage(userId, rules);
      }
    } catch (error) {
      logger.error('Error fetching rules from database', error);
      // Fallback to default rules
      const defaultRules = '📜 Reglas:\n1) Respeto; nada de insultos ni spam.\n2) No ventas, solo compatibilidad de teléfonos en Cuba.\n3) Aporta datos reales con /subir.\n4) Usa /reportar para avisar de errores.\n5) La base es de todos, nadie puede privatizarla.';
      if (chatType === 'private') {
        await this.sendMessage(userId, defaultRules);
      } else {
        await this.sendMessage(chatId, 'Te envié las reglas por DM. 📩');
        await this.sendMessage(userId, defaultRules);
      }
    }
  }

  // Función para generar reglas resumidas para fijar en grupos
  getShortRules() {
    return `📱 **CubaModel - Reglas Rápidas**

1️⃣ Respeto - Sin spam ni insultos
2️⃣ Solo compatibilidad de teléfonos
3️⃣ Usa /subir para agregar datos
4️⃣ /reportar para errores
5️⃣ Base de datos abierta para todos

💬 DM para reglas completas y verificación`;
  }

  async sendStats(chatId) {
    try {
      const { data: phones, error: phonesError } = await this.supabase
        .from('phones')
        .select('id, status')
        .eq('status', 'approved');

      const { data: events, error: eventsError } = await this.supabase
        .from('events')
        .select('id')
        .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

      if (phonesError || eventsError) {
        await this.sendMessage(chatId, '❌ Error obteniendo estadísticas. Intenta más tarde.');
        return;
      }

      const totalPhones = phones?.length || 0;
      const eventsToday = events?.length || 0;

      const statsMessage = `📊 **Estadísticas de CubaModel**

📱 **Teléfonos en la base:**
• Total aprobados: ${totalPhones}
• Última actualización: ${new Date().toLocaleDateString()}

📈 **Actividad:**
• Eventos hoy: ${eventsToday}
• Estado: ✅ Activo

🌐 **Información:**
• Base de datos: Abierta y gratuita
• Proyecto: Comunitario
• Región: Cuba 🇨🇺

💡 Usa /subir para agregar más teléfonos`;

      await this.sendMessage(chatId, statsMessage);
    } catch (error) {
      logger.error('Error sending stats', error);
      await this.sendMessage(chatId, '❌ Error obteniendo estadísticas. Intenta más tarde.');
    }
  }

  async sendHelp(chatId) {
    const helpMessage = `❓ **Ayuda - CubaModel Bot**

🤖 **Comandos principales:**
• /start - Mensaje de bienvenida
• /subir - Agregar teléfono (solo DM)
• /revisar <modelo> - Buscar teléfonos (solo grupos)
• /reglas - Ver reglas completas
• /exportar - Exportar base de datos (solo DM)
• /id - Ver información de IDs
• /reportar - Reportar problema

📱 **Cómo usar:**
1. **Agregar teléfono:** Escríbeme por DM y usa /subir
2. **Buscar teléfonos:** En el grupo usa /revisar Samsung A14
3. **Ver reglas:** Usa /reglas o el botón en el mensaje de bienvenida
4. **Exportar datos:** Usa /exportar o el botón "📥 Exportar Base"

🔧 **Para administradores:**
• /fijar - Mostrar reglas cortas en grupo
• /id - Ver información detallada

❓ **¿Necesitas más ayuda?**
Contacta a los administradores del grupo.`;

    await this.sendMessage(chatId, helpMessage);
  }

  async sendExportOptions(chatId) {
    const exportKeyboard = {
      inline_keyboard: [
        [
          { text: '📄 Exportar CSV', callback_data: 'export:csv' },
          { text: '📋 Exportar JSON', callback_data: 'export:json' }
        ],
        [
          { text: '📊 Solo Estadísticas', callback_data: 'export:stats' },
          { text: '📱 Solo Teléfonos', callback_data: 'export:phones' }
        ],
        [
          { text: '🔙 Volver', callback_data: 'welcome:back' }
        ]
      ]
    };

    const exportMessage = `📥 **Exportar Base de Datos**

Selecciona el formato que prefieras para descargar la información:

📄 **CSV** - Para Excel/Google Sheets
📋 **JSON** - Para desarrolladores
📊 **Estadísticas** - Solo números y resúmenes
📱 **Teléfonos** - Solo la lista de teléfonos

💡 *Los archivos se enviarán como documentos*`;

    await this.sendMessage(chatId, exportMessage, { reply_markup: exportKeyboard });
  }

  async handleExportCallback(chatId, userId, format) {
    try {
      await this.sendMessage(chatId, '⏳ Generando archivo de exportación...');

      let filename, content;

      switch (format) {
        case 'csv': {
          const csvData = await this.exportToCSV();
          content = csvData;
          filename = `cubamodel_phones_${new Date().toISOString().split('T')[0]}.csv`;
          break;
        }

        case 'json': {
          const jsonData = await this.exportToJSON();
          content = JSON.stringify(jsonData, null, 2);
          filename = `cubamodel_phones_${new Date().toISOString().split('T')[0]}.json`;
          break;
        }

        case 'stats': {
          const statsData = await this.exportStats();
          content = JSON.stringify(statsData, null, 2);
          filename = `cubamodel_stats_${new Date().toISOString().split('T')[0]}.json`;
          break;
        }

        case 'phones': {
          const phonesData = await this.exportPhonesOnly();
          content = JSON.stringify(phonesData, null, 2);
          filename = `cubamodel_phones_only_${new Date().toISOString().split('T')[0]}.json`;
          break;
        }

        default:
          await this.sendMessage(chatId, '❌ Formato de exportación no válido.');
          return;
      }

      // Enviar como documento
      await this.sendDocument(chatId, content, filename);

    } catch (error) {
      logger.error('Error exporting data:', error);
      await this.sendMessage(chatId, '❌ Error generando el archivo de exportación. Intenta más tarde.');
    }
  }

  async exportToCSV() {
    const { data: phones, error } = await this.supabase
      .from('phones')
      .select('*')
      .eq('status', 'approved')
      .order('created_at', { ascending: false });

    if (error) throw error;

    const headers = ['ID', 'Marca', 'Modelo', 'Banda', 'Tecnología', 'Fecha Creación', 'Estado'];
    const csvRows = [headers.join(',')];

    phones.forEach(phone => {
      const row = [
        phone.id,
        `"${phone.brand || ''}"`,
        `"${phone.model || ''}"`,
        `"${phone.bands || ''}"`,
        `"${phone.technologies || ''}"`,
        phone.created_at,
        phone.status
      ];
      csvRows.push(row.join(','));
    });

    return csvRows.join('\n');
  }

  async exportToJSON() {
    const { data: phones, error } = await this.supabase
      .from('phones')
      .select('*')
      .eq('status', 'approved')
      .order('created_at', { ascending: false });

    if (error) throw error;

    return {
      export_date: new Date().toISOString(),
      total_phones: phones.length,
      phones: phones
    };
  }

  async exportStats() {
    const { data: phones, error: phonesError } = await this.supabase
      .from('phones')
      .select('id, status, brand, created_at');

    const { data: events, error: eventsError } = await this.supabase
      .from('events')
      .select('id, type, created_at')
      .gte('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString());

    if (phonesError || eventsError) throw phonesError || eventsError;

    const approvedPhones = phones.filter(p => p.status === 'approved');
    const brands = {};
    approvedPhones.forEach(phone => {
      if (phone.brand) {
        brands[phone.brand] = (brands[phone.brand] || 0) + 1;
      }
    });

    return {
      export_date: new Date().toISOString(),
      statistics: {
        total_phones: phones.length,
        approved_phones: approvedPhones.length,
        pending_phones: phones.length - approvedPhones.length,
        brands_distribution: brands,
        events_last_30_days: events.length
      },
      summary: {
        most_common_brand: Object.keys(brands).reduce((a, b) => brands[a] > brands[b] ? a : b, 'N/A'),
        total_brands: Object.keys(brands).length,
        last_updated: approvedPhones[0]?.created_at || 'N/A'
      }
    };
  }

  async exportPhonesOnly() {
    const { data: phones, error } = await this.supabase
      .from('phones')
      .select('brand, model, bands, technologies, status')
      .eq('status', 'approved')
      .order('brand', { ascending: true });

    if (error) throw error;

    return {
      export_date: new Date().toISOString(),
      phones: phones.map(phone => ({
        brand: phone.brand,
        model: phone.model,
        bands: phone.bands,
        technologies: phone.technologies
      }))
    };
  }

  async sendDocument(chatId, content, filename) {
    // Use global Blob and FormData if available (Cloudflare Workers)
    const BlobClass = globalThis.Blob;
    const FormDataClass = globalThis.FormData;

    const blob = new BlobClass([content], { type: 'text/plain' });
    const formData = new FormDataClass();
    formData.append('document', blob, filename);
    formData.append('chat_id', chatId);
    formData.append('caption', `📥 ${filename}\n\nExportado el ${new Date().toLocaleString()}`);

    try {
      const response = await fetch(`https://api.telegram.org/bot${this.token}/sendDocument`, {
        method: 'POST',
        body: formData
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const result = await response.json();
      if (!result.ok) {
        throw new Error(result.description);
      }

    } catch (error) {
      logger.error('Error sending document:', error);
      // Fallback: enviar como mensaje de texto si falla el documento
      await this.sendMessage(chatId, `📄 **${filename}**\n\n\`\`\`\n${content.substring(0, 4000)}\n\`\`\``);
    }
  }

  async welcomeUserDM(user, chat) {
    try {
      // Get welcome message from database
      const { data } = await this.supabase
        .from('bot_config')
        .select('welcome')
        .single();

      let msg = data?.welcome;
      
      if (!msg) {
        // Fallback to default welcome message
        const fullname = [user.first_name, user.last_name].filter(Boolean).join(' ').trim() || user.username || 'amigo';
        msg = `👋 ¡Bienvenido ${fullname} a CubaModel! 🇨🇺📱\n\n` +
          'Este proyecto nació porque antes intentaron cobrar por una base que la comunidad creó gratis.\n' +
          'Aquí todo es distinto: la información será siempre abierta y descargable.\n\n' +
          '⚠️ Limitaciones:\n' +
          '• Puede ir lento en horas pico.\n' +
          '• Hay topes de consultas y almacenamiento.\n' +
          '• Puede caerse o fallar a veces (fase de desarrollo).\n\n' +
          '📜 Reglas:\n' +
          '1) Respeto; nada de insultos ni spam.\n' +
          '2) No ventas, solo compatibilidad de teléfonos en Cuba.\n' +
          '3) Aporta datos reales con /subir.\n' +
          '4) Usa /reportar para avisar de errores.\n' +
          '5) La base es de todos, nadie puede privatizarla.\n\n' +
          'Gracias por sumarte. Esto es de todos y para todos. ✨';
      } else {
        // Replace variables in welcome message
        const fullname = [user.first_name, user.last_name].filter(Boolean).join(' ').trim() || user.username || 'amigo';
        const username = user.username ? `@${user.username}` : 'usuario';
        const chatTitle = chat.title || 'CubaModel';
        
        msg = msg
          .replace(/{fullname}/g, fullname)
          .replace(/{username}/g, username)
          .replace(/{chat_title}/g, chatTitle);
      }

      // Try DM; if user has blocked bot, ignore
      await this.sendMessage(user.id, msg);
    } catch (error) {
      logger.error('Error fetching welcome message from database', error);
      // Fallback to default welcome
      const fullname = [user.first_name, user.last_name].filter(Boolean).join(' ').trim() || user.username || 'amigo';
      const defaultMsg = `👋 ¡Bienvenido ${fullname} a CubaModel! 🇨🇺📱\n\n` +
        'Este proyecto nació porque antes intentaron cobrar por una base que la comunidad creó gratis.\n' +
        'Aquí todo es distinto: la información será siempre abierta y descargable.\n\n' +
        'Gracias por sumarte. Esto es de todos y para todos. ✨';
      await this.sendMessage(user.id, defaultMsg);
    }
  }

  // --- Captcha with Vercel KV (REST) ---
  async kvSet(key, value, exSeconds) {
    if (!this.kvUrl || !this.kvToken) return null;
    const res = await fetch(`${this.kvUrl}/set/${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${this.kvToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ value, ex: exSeconds })
    });
    try { return await res.json(); } catch { return null; }
  }
  async kvGet(key) {
    if (!this.kvUrl || !this.kvToken) return null;
    const res = await fetch(`${this.kvUrl}/get/${encodeURIComponent(key)}`, {
      headers: { 'Authorization': `Bearer ${this.kvToken}` }
    });
    const json = await res.json().catch(() => null);
    return json?.result ?? null;
  }
  async kvDel(key) {
    if (!this.kvUrl || !this.kvToken) return null;
    await fetch(`${this.kvUrl}/del/${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${this.kvToken}` }
    });
  }
  async kvKeys(pattern) {
    if (!this.kvUrl || !this.kvToken) return [];
    const res = await fetch(`${this.kvUrl}/keys/${encodeURIComponent(pattern)}`, {
      headers: { 'Authorization': `Bearer ${this.kvToken}` }
    });
    const json = await res.json().catch(() => null);
    return json?.result ?? [];
  }
  async kickExpiredCaptchas() {
    try {
      const keys = await this.kvKeys('captcha:*');
      if (!keys || !keys.length) return;

      for (const key of keys) {
        const val = await this.kvGet(key);
        if (val && Date.now() > Number(val)) {
          const parts = key.split(':');
          if (parts.length === 3) {
            const chatId = Number(parts[1]);
            const userId = Number(parts[2]);
            logger.info('Kicking expired captcha user', { chatId, userId });

            // ban + unban user
            await tgFetch(this.token, 'banChatMember', { chat_id: chatId, user_id: userId });
            await tgFetch(this.token, 'unbanChatMember', { chat_id: chatId, user_id: userId });

            // delete key
            await this.kvDel(key);

            // send private message
            await this.sendMessage(userId, '❌ El tiempo de verificación ha expirado y has sido expulsado. Puedes volver a unirte al grupo.');
          }
        }
      }
    } catch (e) {
      logger.error('Error in kickExpiredCaptchas', e);
    }
  }

  captchaKeyboard(chatId, userId) {
    return {
      inline_keyboard: [[
        { text: '✅ Soy humano', callback_data: `cap:ok:${chatId}:${userId}` },
        { text: '❌ No pasar', callback_data: `cap:fail:${chatId}:${userId}` }
      ]]
    };
  }
  async startCaptchaAndWelcome(user, chat) {
    await this.startCaptcha(user, chat);
    // Solo enviar mensaje corto en grupos, no llenar el chat
    if (this.showShortWelcomeInGroup && (chat.type === 'group' || chat.type === 'supergroup')) {
      const short = `👋 ¡Hola ${user.first_name || 'usuario'}! Revisa tus DM para verificar y participar.`;
      await this.sendMessage(chat.id, short);
    }
  }
  async startCaptcha(user, chat) {
    // Save expiration timestamp and a long TTL (e.g. 86400)
    const expiration = Date.now() + 120000;
    await this.kvSet(`captcha:${chat.id}:${user.id}`, String(expiration), 86400);
    const dm =
      '🔐 **Verificación de seguridad**\n\n' +
      'Antes de participar en el grupo, confirma que eres humano.\n' +
      'Esto nos ayuda a evitar spam y mantener el grupo limpio.\n\n' +
      '⏰ Tienes 2 minutos para verificar.\n' +
      '❌ Si no verificas, serás expulsado automáticamente.';
    await this.sendMessage(user.id, dm, { reply_markup: this.captchaKeyboard(chat.id, user.id) });
  }

  formatConfirmation(d) {
    return (
      '📱 Resumen:\n\n' +
      `Nombre: ${d.commercial_name}\n` +
      `Modelo: ${d.model}\n` +
      `Funciona en Cuba: ${d.works ? 'Sí' : 'No'}\n` +
      `Bandas: ${(d.bands && d.bands.length) ? d.bands.join(', ') : '—'}\n` +
      `Provincias: ${(d.provinces && d.provinces.length) ? d.provinces.join(', ') : '—'}\n` +
      `Observaciones: ${d.observations || '—'}`
    );
  }

  async submitPhone(userId, chatId) {
    const d = await this.getDraft(userId);
    if (!d) return;

    const modelUpper = toUpperModel(d.model);
    const bands = Array.isArray(d.bands) ? d.bands : splitNormList(d.bands);
    const provinces = Array.isArray(d.provinces) ? d.provinces : splitNormList(d.provinces);

    const payload = {
      commercial_name: d.commercial_name,
      model: modelUpper,
      works: !!d.works,
      bands: bands || [],
      provinces: provinces || [],
      observations: d.observations || null,
    };

    // Validate submission server-side before inserting
    const validation = validate(phoneSubmissionSchema, payload);
    if (!validation.success) {
      logger.error('submitPhone invalid payload', null, { userId, chatId, errors: validation.error });
      await this.sendMessage(chatId, 'Datos inválidos en la propuesta. Intenta de nuevo o /cancelar.');
      return;
    }

    const { error } = await this.supabase
      .from('phones')
      .insert({ ...payload, created_at: new Date().toISOString() });

    if (error) {
      if (String(error).includes('duplicate key value') || String(error).includes('unique constraint')) {
        // Let upper layer handle duplicate specially by throwing
        throw error;
      } else {
        logger.error('submitPhone error', error, { userId, chatId });
        await this.sendMessage(chatId, 'Se enredó la cosa 😅. Intenta de nuevo o /cancelar.');
        return;
      }
    }

    await this.clearDraft(userId);
    await this.sendMessage(chatId, '¡Hecho! Quedó guardado. ✅');
  }

  async handleReport(chatId, userId, text) {
    try {
      const reason = (text || '').trim();
      if (!reason) {
        await this.sendMessage(chatId, 'Escribe: /reportar <texto del reporte>.');
        return;
      }
      const { error } = await this.supabase
        .from('reports')
        .insert({
          tg_id: String(userId),
          chat_id: String(chatId),
          model: null, // si se quiere ligar al último resultado, debe guardarse ese contexto aparte
          reason,
          created_at: new Date().toISOString()
        });
      if (error) throw error;
      await this.sendMessage(chatId, 'Reporte recibido. Gracias por avisar.');
    } catch (e) {
      logger.error('handleReport error', e, { chatId, userId });
      await this.sendMessage(chatId, 'Se enredó la cosa 😅. Intenta de nuevo o /cancelar.');
    }
  }

  async handleSubscribe(chatId, userId) {
    try {
      const { error } = await this.supabase
        .from('subscriptions')
        .upsert({ tg_id: String(userId), created_at: new Date().toISOString() });
      if (error) throw error;
      await this.sendMessage(chatId, 'Suscripción activada. 📣');
    } catch (e) {
      logger.error('handleSubscribe error', e, { chatId, userId });
      await this.sendMessage(chatId, 'Se enredó la cosa 😅. Intenta de nuevo o /cancelar.');
    }
  }
  async handleUnsubscribe(chatId, userId) {
    try {
      await this.supabase.from('subscriptions').delete().eq('tg_id', String(userId));
      await this.sendMessage(chatId, 'Suscripción cancelada. 🔕');
    } catch (e) {
      logger.error('handleUnsubscribe error', e, { chatId, userId });
      await this.sendMessage(chatId, 'Se enredó la cosa 😅. Intenta de nuevo o /cancelar.');
    }
  }
}

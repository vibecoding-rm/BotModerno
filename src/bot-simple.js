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
        await this.sendMessage(chatId,
          '¡Asere! Soy Bandín 📶. Usa /subir en DM pa\' proponer modelos y /revisar en el grupo.\n\n' +
          'Comandos:\n' +
          '• /subir — Asistente (solo por DM)\n' +
          '• /revisar <modelo> — Buscar por modelo (solo en grupos)\n' +
          '• /reportar <texto> — Reportar algo sobre el último resultado\n' +
          '• /suscribir — Alta de notificaciones\n' +
          '• /cancelarsub — Baja de notificaciones\n' +
          '• /cancelar — Cancelar asistente\n'
        );
        break;
      }
      case '/subir': {
        if (chatType !== 'private') {
          await this.sendMessage(chatId, 'En el grupo es /revisar. Escríbeme por DM pa\' /subir.');
        } else {
          await this.startWizard(chatId, userId);
        }
        break;
      }
      case '/revisar': {
        if (chatType === 'private') {
          await this.sendMessage(chatId, 'El comando /revisar es solo en grupos; usa /subir aquí en DM.');
          return;
        }
        if (!argStr) {
          await this.sendMessage(chatId, 'Formato: /revisar <modelo>. Escribe el modelo exacto o parcial.');
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
        await this.handleReport(chatId, userId, argStr, msg.from?.username);
        break;
      }
      case '/suscribir': {
        await this.handleSubscribe(chatId, userId, msg.from?.username);
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
      // Fetch candidate rows and filter on edge to ensure accent/space-insensitive matching
      const { data, error } = await this.supabase
        .from('phones')
        .select('id, commercial_name, model, works, bands, provinces, observations, created_at')
        .limit(2000);
      if (error) throw error;

      const matches = (data || []).filter(r => normalizeText(r.model) .includes(q));

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
          await this.sendMessage(chatId, '¿Funciona en Cuba? Responde "sí" o "no".', { reply_markup: kbBackCancel() });
          return true;
        }
        case 'awaiting_works': {
          const yn = parseYesNo(text);
          if (yn === null) {
            await this.sendMessage(chatId, 'Responde "sí" o "no".', { reply_markup: kbBackCancel() });
            return true;
          }
          if (yn) {
            await this.setDraft(userId, { works: true, step: 'awaiting_bands' });
            await this.sendMessage(chatId, 'Indica las bandas separadas por coma (ej: B3,B7,B28) o escribe "desconocido".', { reply_markup: kbBackCancel() });
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
    try {
      const id = cb.id;
      const data = cb.data || '';
      const msg = cb.message;
      const chatId = msg?.chat?.id;
      const userId = cb.from?.id;
      if (!chatId || !userId) return;

      if (!data.startsWith('wiz:')) return; // only wizard controls here

      await this.answerCallbackQuery(id);

      const draft = await this.getDraft(userId);
      if (!draft) return;

      const stepOrder = ['awaiting_name', 'awaiting_model', 'awaiting_works', 'awaiting_bands', 'awaiting_provinces', 'awaiting_obs', 'confirm'];
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
            await this.sendMessage(chatId, '¿Funciona en Cuba? Responde "sí" o "no".', { reply_markup: kbBackCancel() });
            break;
          case 'awaiting_bands':
            await this.sendMessage(chatId, 'Bandas separadas por coma (ej: B3,B7,B28) o "desconocido".', { reply_markup: kbBackCancel() });
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
      if (data === 'wiz:confirm' && draft.step === 'confirm') {
        await this.submitPhone(userId, chatId);
        return;
      }
    } catch (e) {
      logger.error('onCallback error', e, { userId });
    }
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

    const { error } = await this.supabase
      .from('phones')
      .insert({
        commercial_name: d.commercial_name,
        model: modelUpper,
        works: !!d.works,
        bands: bands || [],
        provinces: provinces || [],
        observations: d.observations || null,
        created_at: new Date().toISOString()
      });

    if (error) {
      if (String(error).includes('duplicate key value') || String(error).includes('unique constraint')) {
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

  async handleReport(chatId, userId, text, username) {
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

  async handleSubscribe(chatId, userId, username) {
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

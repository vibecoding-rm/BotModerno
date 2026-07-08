/* src/bot-simple.js
 * Telegram bot logic for Cloudflare Workers (no Telegraf).
 * - Direct Telegram API via fetch
 * - Cloudflare D1 SQL queries
 * - DM wizard with inline keyboards
 * - Group-only /revisar search (case/accents-insensitive) by model
 * - Model saved in UPPERCASE
 */

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
const CUBA_PROVINCES = [
  'Pinar del Río', 'Artemisa', 'La Habana', 'Mayabeque',
  'Matanzas', 'Cienfuegos', 'Villa Clara', 'Sancti Spíritus',
  'Ciego de Ávila', 'Camagüey', 'Las Tunas', 'Holguín',
  'Granma', 'Santiago de Cuba', 'Guantánamo', 'Isla de la Juventud'
];
// Provincias escritas a mano: separa solo por comas y mapea al nombre canónico
function parseProvincesText(txt) {
  if (!txt || txt.trim() === '') return [];
  const byNorm = new Map(CUBA_PROVINCES.map(p => [normalizeText(p), p]));
  const out = [];
  for (const part of String(txt).split(/[,;|\n]+/)) {
    const norm = normalizeText(part);
    if (!norm) continue;
    const canonical = byNorm.get(norm) || part.trim();
    if (!out.includes(canonical)) out.push(canonical);
  }
  return out;
}
// Teclado multi-selección de provincias; ownerId evita que otros toquen el wizard ajeno
function kbProvinces(selected = [], ownerId = '') {
  const rows = [];
  for (let i = 0; i < CUBA_PROVINCES.length; i += 2) {
    const row = [];
    for (const j of [i, i + 1]) {
      if (j < CUBA_PROVINCES.length) {
        const name = CUBA_PROVINCES[j];
        const on = selected.includes(name);
        row.push({ text: (on ? '✅ ' : '') + name, callback_data: `prov:t:${j}:${ownerId}` });
      }
    }
    rows.push(row);
  }
  rows.push([
    { text: '✔️ Listo', callback_data: `prov:done::${ownerId}` },
    { text: 'Omitir', callback_data: `prov:skip::${ownerId}` }
  ]);
  rows.push([
    { text: 'Atrás', callback_data: 'wiz:back' },
    { text: 'Cancelar', callback_data: 'wiz:cancel' }
  ]);
  return { inline_keyboard: rows };
}
function kbModeration(id) {
  return { inline_keyboard: [
    [
      { text: '✅ Aprobar', callback_data: `mod:approve:${id}` },
      { text: '❌ Rechazar', callback_data: `mod:reject:${id}` }
    ],
    [
      { text: '⏭ Saltar', callback_data: `mod:next:${id}` }
    ]
  ] };
}
function parseJsonArray(v) {
  if (typeof v === 'string') {
    try { const p = JSON.parse(v); return Array.isArray(p) ? p : []; } catch { return []; }
  }
  return Array.isArray(v) ? v : [];
}

export class SimpleTelegramBot {
  constructor(env) {
    this.token = env.BOT_TOKEN;
    this.db = env.DB;
    this.adminIds = toCsvArray(env.ADMIN_TG_IDS);
    this.allowedChatIds = toCsvArray(env.ALLOWED_CHAT_IDS);
    // Moderation/welcome config
    this.showShortWelcomeInGroup = String(env.SHOW_SHORT_WELCOME_IN_GROUP || 'true').toLowerCase() !== 'false';
    this.rulesCommandEnabled = true;
    // Cloudflare KV (captcha/flood control)
    this.kv = env.APP_KV;
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

    // En privado el bot solo responde al dueño/admins
    if (chatType === 'private' && !this.adminIds.includes(String(userId))) return;

    if (text.startsWith('/')) {
      await this.onCommand({ chatId, chatType, userId, msg, text });
      return;
    }

    // Wizard text input (grupo o DM): solo actúa si el usuario tiene borrador activo
    if (text) {
      const replyTo = chatType === 'private' ? undefined : msg.message_id;
      await this.handleWizardText(chatId, userId, text, replyTo);
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
        await this.sendExportOptions(chatId);
        break;
      }
      case '/subir': {
        await this.startWizard(chatId, userId, chatType === 'private' ? undefined : msg.message_id);
        break;
      }
      case '/revisar': {
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
      case '/bandas': {
        await this.sendBandsGuide(chatId);
        break;
      }
      case '/ayuda':
      case '/help': {
        await this.sendHelp(chatId);
        break;
      }
      case '/pendientes': {
        if (!this.isAdmin(userId)) {
          if (chatType === 'private') await this.sendMessage(chatId, '❌ Solo los administradores pueden usar este comando.');
          return;
        }
        await this.sendPendingReview(chatId, 0);
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

  // Search by model (case/accents-insensitive) with pagination
  async searchByModel(chatId, query, offset = 0, editMessageId = null) {
    try {
      const PAGE = 6;
      const q = normalizeText(query);
      const like = '%' + q + '%';

      const countRow = await this.db.prepare(
        "SELECT COUNT(*) AS n FROM phones WHERE status = 'approved' AND (nombre_comercial LIKE ?1 OR model LIKE ?1)"
      ).bind(like).first();
      const total = countRow?.n || 0;

      if (!total) {
        await this.sendMessage(chatId, 'No encontramos ese modelo. ¿Quieres usar /subir para proponerlo?');
        return;
      }

      const res = await this.db.prepare(
        "SELECT id, commercial_name, model, works, bands, provinces, observations FROM phones WHERE status = 'approved' AND (nombre_comercial LIKE ?1 OR model LIKE ?1) ORDER BY commercial_name LIMIT ?2 OFFSET ?3"
      ).bind(like, PAGE, offset).all();

      const matches = (res.results || []).map(r => ({
        ...r,
        bands: parseJsonArray(r.bands),
        provinces: parseJsonArray(r.provinces),
        works: r.works === 1 || r.works === true ? true : (r.works === 0 || r.works === false ? false : null)
      }));

      const lines = matches.map(r => {
        const w = r.works === true ? '✅' : (r.works === false ? '❌' : '❓');
        const bands = r.bands.length ? r.bands.join(', ') : '—';
        const provs = r.provinces.length ? r.provinces.join(', ') : '—';
        const obs = r.observations ? ` | Obs: ${r.observations}` : '';
        return `• ${r.commercial_name}${r.model ? ` (${r.model})` : ''} ${w}\n  Bandas: ${bands}\n  Prov: ${provs}${obs}`;
      });

      const from = offset + 1;
      const to = offset + matches.length;
      let msgText = `🔎 "${query}" — ${from}-${to} de ${total}\n\n` + lines.join('\n\n');

      // Botones de paginación (callback data máx 64 BYTES: recortar query en UTF-8)
      let qShort = query;
      const enc = new TextEncoder();
      while (qShort && enc.encode(`pg:${offset + PAGE}:${qShort}`).length > 64) {
        qShort = qShort.slice(0, -1);
      }
      const navRow = [];
      if (offset > 0) navRow.push({ text: '◀ Anterior', callback_data: `pg:${Math.max(0, offset - PAGE)}:${qShort}` });
      if (to < total) navRow.push({ text: 'Siguiente ▶', callback_data: `pg:${offset + PAGE}:${qShort}` });
      const kb = navRow.length ? { inline_keyboard: [navRow] } : undefined;

      if (editMessageId) {
        await this.editMessageText(chatId, editMessageId, msgText, { reply_markup: kb });
      } else {
        await this.sendMessage(chatId, msgText, { reply_markup: kb });
      }
    } catch (e) {
      logger.error('searchByModel error', e, { chatId });
      await this.sendMessage(chatId, 'Se enredó la cosa 😅. Intenta de nuevo o /cancelar.');
    }
  }

  async getDraft(tgId) {
    const row = await this.db.prepare("SELECT * FROM submission_drafts WHERE tg_id = ?1").bind(String(tgId)).first();
    if (!row) return null;
    
    let bands = row.bands;
    if (typeof bands === 'string') {
      try { bands = JSON.parse(bands); } catch (e) { bands = []; }
    }
    let provinces = row.provinces;
    if (typeof provinces === 'string') {
      try { provinces = JSON.parse(provinces); } catch (e) { provinces = []; }
    }
    return {
      ...row,
      bands: Array.isArray(bands) ? bands : [],
      provinces: Array.isArray(provinces) ? provinces : [],
      works: row.works === 1 || row.works === true ? true : (row.works === 0 || row.works === false ? false : null)
    };
  }
  async setDraft(tgId, patch) {
    const existing = await this.getDraft(tgId);
    
    const step = patch.hasOwnProperty('step') ? patch.step : (existing ? existing.step : 'awaiting_name');
    const commercial_name = patch.hasOwnProperty('commercial_name') ? patch.commercial_name : (existing ? existing.commercial_name : null);
    const model = patch.hasOwnProperty('model') ? patch.model : (existing ? existing.model : null);
    
    const worksVal = patch.hasOwnProperty('works') ? patch.works : (existing ? existing.works : null);
    const works = worksVal === true ? 1 : (worksVal === false ? 0 : null);
    
    const bandsVal = patch.hasOwnProperty('bands') ? patch.bands : (existing ? existing.bands : null);
    const bands = Array.isArray(bandsVal) ? JSON.stringify(bandsVal) : (typeof bandsVal === 'string' ? bandsVal : null);
    
    const provincesVal = patch.hasOwnProperty('provinces') ? patch.provinces : (existing ? existing.provinces : null);
    const provinces = Array.isArray(provincesVal) ? JSON.stringify(provincesVal) : (typeof provincesVal === 'string' ? provincesVal : null);
    
    const observations = patch.hasOwnProperty('observations') ? patch.observations : (existing ? existing.observations : null);
    const updatedAt = new Date().toISOString();
    
    let row;
    if (existing) {
      row = await this.db.prepare(
        "UPDATE submission_drafts SET step = ?1, commercial_name = ?2, model = ?3, works = ?4, bands = ?5, provinces = ?6, observations = ?7, updated_at = ?8 WHERE tg_id = ?9 RETURNING *"
      ).bind(step, commercial_name, model, works, bands, provinces, observations, updatedAt, String(tgId)).first();
    } else {
      row = await this.db.prepare(
        "INSERT INTO submission_drafts (tg_id, step, commercial_name, model, works, bands, provinces, observations, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9) RETURNING *"
      ).bind(String(tgId), step, commercial_name, model, works, bands, provinces, observations, updatedAt).first();
    }
    
    if (!row) throw new Error("Failed to save draft");
    
    let parsedBands = row.bands;
    if (typeof parsedBands === 'string') {
      try { parsedBands = JSON.parse(parsedBands); } catch (e) { parsedBands = []; }
    }
    let parsedProvinces = row.provinces;
    if (typeof parsedProvinces === 'string') {
      try { parsedProvinces = JSON.parse(parsedProvinces); } catch (e) { parsedProvinces = []; }
    }
    return {
      ...row,
      bands: Array.isArray(parsedBands) ? parsedBands : [],
      provinces: Array.isArray(parsedProvinces) ? parsedProvinces : [],
      works: row.works === 1 || row.works === true ? true : (row.works === 0 || row.works === false ? false : null)
    };
  }
  async clearDraft(tgId) {
    await this.db.prepare("DELETE FROM submission_drafts WHERE tg_id = ?1").bind(String(tgId)).run();
  }

  // Wizard control
  async startWizard(chatId, userId, replyTo) {
    await this.setDraft(userId, { step: 'awaiting_name', commercial_name: null, model: null, works: null, bands: null, provinces: null, observations: null });
    await this.sendMessage(chatId, '📲 Vamos a subir un modelo. Dime el nombre comercial (ej: "Redmi Note 12").', {
      reply_markup: kbCancel(),
      reply_to_message_id: replyTo
    });
  }
  async cancelWizard(chatId, userId) {
    await this.clearDraft(userId);
    await this.sendMessage(chatId, 'Listo, cancelado. Puedes empezar de nuevo con /subir.');
  }

  async handleWizardText(chatId, userId, text, replyTo) {
    const send = (t, kb) => this.sendMessage(chatId, t, { reply_markup: kb, reply_to_message_id: replyTo });
    try {
      const draft = await this.getDraft(userId);
      if (!draft) return false;

      switch (draft.step) {
        case 'awaiting_name': {
          if (!text || text.length < 2) {
            await send('Por favor, envía un nombre comercial válido.', kbCancel());
            return true;
          }
          await this.setDraft(userId, { commercial_name: text, step: 'awaiting_model' });
          await send('Modelo exacto (ej: "2209116AG").', kbBackCancel());
          return true;
        }
        case 'awaiting_model': {
          if (!text || text.length < 1) {
            await send('Modelo inválido.', kbBackCancel());
            return true;
          }
          await this.setDraft(userId, { model: text, step: 'awaiting_works' });
          await send('¿Funciona en Cuba? Responde "sí" o "no".', kbWorks());
          return true;
        }
        case 'awaiting_works': {
          const yn = parseYesNo(text);
          if (yn === null) {
            await send('Responde "sí" o "no".', kbWorks());
            return true;
          }
          if (yn) {
            await this.setDraft(userId, { works: true, step: 'awaiting_bands' });
            await send('Indica las bandas separadas por coma:\n\n📡 Bandas específicas: B3,B7,B28,B20,B38\n📶 Tecnologías: 2G,3G,4G,5G\n❓ O escribe "desconocido"', kbBackCancel());
          } else {
            await this.setDraft(userId, { works: false, step: 'awaiting_obs' });
            await send('Añade observaciones (ej: "sin señal 4G en Holguín").', kbBackCancel());
          }
          return true;
        }
        case 'awaiting_bands': {
          const bands = text.toLowerCase() === 'desconocido' ? [] : splitNormList(text);
          await this.setDraft(userId, { bands, provinces: [], step: 'awaiting_provinces' });
          await send('📍 ¿En qué provincias lo probaste? Toca para marcar/desmarcar y pulsa "✔️ Listo" (o escribe los nombres separados por coma).', kbProvinces([], userId));
          return true;
        }
        case 'awaiting_provinces': {
          const provinces = text === '-' ? [] : parseProvincesText(text);
          await this.setDraft(userId, { provinces, step: 'awaiting_obs' });
          await send('Observaciones adicionales (opcional). Escribe "-" para omitir.', kbBackCancel());
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
          await send(summary + '\n\nConfirma con el botón.', kbConfirm());
          return true;
        }
        case 'confirm': {
          // If user types instead of pressing buttons, accept yes/no
          const yn = parseYesNo(text);
          if (yn === null) {
            await send('Pulsa Confirmar o responde "sí" para confirmar o "no" para cancelar.', kbConfirm());
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
      await send('Se enredó la cosa 😅. Intenta de nuevo o /cancelar.');
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

    // En privado solo el dueño/admins pueden usar botones (excepto verificación captcha)
    if (msg?.chat?.type === 'private' && !data.startsWith('cap:') && !this.adminIds.includes(String(userId))) return;

    try {

      // Paginación de /revisar (cualquiera puede pasar páginas)
      if (data.startsWith('pg:')) {
        await this.answerCallbackQuery(id);
        const parts = data.split(':');
        const offset = Number(parts[1]) || 0;
        const query = parts.slice(2).join(':');
        if (query) await this.searchByModel(chatId, query, offset, msg?.message_id);
        return;
      }

      // Selección de provincias en el wizard
      if (data.startsWith('prov:')) {
        const parts = data.split(':'); // prov:<t|done|skip>:<idx|''>:<ownerId>
        const action = parts[1];
        const ownerId = parts[3];
        if (ownerId && String(userId) !== ownerId) {
          await this.answerCallbackQuery(id, { text: 'Este asistente es de otro usuario.', show_alert: false });
          return;
        }
        await this.answerCallbackQuery(id);
        const draft = await this.getDraft(userId);
        if (!draft || draft.step !== 'awaiting_provinces') return;

        if (action === 'done' || action === 'skip') {
          const provinces = action === 'skip' ? [] : (draft.provinces || []);
          await this.setDraft(userId, { provinces, step: 'awaiting_obs' });
          await this.sendMessage(chatId, 'Observaciones adicionales (opcional). Escribe "-" para omitir.', { reply_markup: kbBackCancel() });
          return;
        }
        if (action === 't') {
          const name = CUBA_PROVINCES[Number(parts[2])];
          if (!name) return;
          const cur = draft.provinces || [];
          const next = cur.includes(name) ? cur.filter(p => p !== name) : [...cur, name];
          await this.setDraft(userId, { provinces: next });
          if (msg?.message_id) await this.editMessageReplyMarkup(chatId, msg.message_id, kbProvinces(next, userId));
        }
        return;
      }

      // Moderation buttons (solo admins)
      if (data.startsWith('mod:')) {
        await this.answerCallbackQuery(id, this.isAdmin(userId) ? {} : { text: 'Solo administradores.', show_alert: true });
        await this.handleModCallback(chatId, userId, data, msg);
        return;
      }

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
            await this.sendMessage(chatId, '📍 ¿En qué provincias lo probaste? Toca para marcar/desmarcar y pulsa "✔️ Listo".', { reply_markup: kbProvinces(draft.provinces || [], userId) });
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
      const row = await this.db.prepare("SELECT welcome FROM bot_config LIMIT 1").first();
      let welcomeMessage = row?.welcome;
      
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
        // En grupo: bienvenida corta en el propio grupo (sin DMs no solicitados)
        await this.sendMessage(chatId, this.getShortRules());
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
        await this.sendMessage(chatId, this.getShortRules());
      }
    }
  }

  async sendRules(userId, chatId, chatType) {
    try {
      // Get rules from database
      const row = await this.db.prepare("SELECT rules FROM bot_config LIMIT 1").first();
      const rules = row?.rules || 
        '📜 Reglas:\n' +
        '1) Respeto; nada de insultos ni spam.\n' +
        '2) No ventas, solo compatibilidad de teléfonos en Cuba.\n' +
        '3) Aporta datos reales con /subir.\n' +
        '4) Usa /reportar para avisar de errores.\n' +
        '5) La base es de todos, nadie puede privatizarla.';

      // Reglas directamente en el chat donde se pidieron
      await this.sendMessage(chatType === 'private' ? userId : chatId, rules);
    } catch (error) {
      logger.error('Error fetching rules from database', error);
      // Fallback to default rules
      const defaultRules = '📜 Reglas:\n1) Respeto; nada de insultos ni spam.\n2) No ventas, solo compatibilidad de teléfonos en Cuba.\n3) Aporta datos reales con /subir.\n4) Usa /reportar para avisar de errores.\n5) La base es de todos, nadie puede privatizarla.';
      await this.sendMessage(chatType === 'private' ? userId : chatId, defaultRules);
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
      const phonesRow = await this.db.prepare("SELECT COUNT(*) AS n FROM phones WHERE status = 'approved'").first();
      const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const eventsRow = await this.db.prepare("SELECT COUNT(*) AS n FROM events WHERE created_at >= ?1").bind(cutoff).first();

      const totalPhones = phonesRow?.n || 0;
      const eventsToday = eventsRow?.n || 0;

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

  async sendBandsGuide(chatId) {
    const guide = `📡 **Guía de bandas en Cuba (ETECSA)**

📶 **Redes disponibles:**
• 2G (GSM): 900 MHz — llamadas y SMS, casi cualquier teléfono.
• 3G (UMTS): 900/2100 MHz.
• 4G (LTE): **Banda 3 (B3, 1800 MHz)** — la principal en todo el país. En algunas zonas también hay Banda 7 (B7, 2600 MHz).

✅ **Lo clave:** para tener 4G en Cuba, tu teléfono debe soportar **LTE B3 (1800)**.

🔍 **¿Cómo saber las bandas de tu teléfono?**
1. Mira el modelo exacto en Ajustes → Acerca del teléfono.
2. Búscalo en gsmarena.com o kimovil.com → sección "Red/Network".
3. Verifica que aparezca LTE B3 (1800). Si además trae B7, mejor.

⚠️ **Cuidado con teléfonos de operadoras de EE.UU.** (Cricket, Boost, Metro...): muchos vienen bloqueados de fábrica o sin B3 → revisa antes de comprar.

💡 Usa /revisar <modelo> para ver la experiencia real de la comunidad con ese modelo, y /subir para aportar la tuya.`;
    await this.sendMessage(chatId, guide);
  }

  async sendHelp(chatId) {
    const helpMessage = `❓ **Ayuda - CubaModel Bot**

🤖 **Comandos principales:**
• /start - Mensaje de bienvenida
• /subir - Agregar teléfono
• /revisar <modelo> - Buscar teléfonos
• /bandas - Guía de bandas 4G en Cuba
• /reglas - Ver reglas completas
• /exportar - Exportar base de datos
• /suscribir - Recibir avisos de novedades
• /id - Ver información de IDs
• /reportar - Reportar problema

📱 **Cómo usar:**
1. **Agregar teléfono:** Usa /subir en el grupo y sigue los pasos
2. **Buscar teléfonos:** Usa /revisar Samsung A14
3. **Ver reglas:** Usa /reglas
4. **Exportar datos:** Usa /exportar y elige el formato

🔧 **Para administradores:**
• /pendientes - Revisar propuestas pendientes (aprobar/rechazar)
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
    const res = await this.db.prepare("SELECT * FROM phones WHERE status = 'approved' ORDER BY created_at DESC").all();
    const phones = res.results || [];

    const headers = ['ID', 'Nombre', 'Modelo', 'Funciona', 'Bandas', 'Provincias', 'Observaciones', 'Fecha Creación', 'Estado'];
    const csvRows = [headers.join(',')];

    const csvCell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const joinJson = (v) => {
      if (typeof v === 'string') {
        try {
          const parsed = JSON.parse(v);
          if (Array.isArray(parsed)) return parsed.join(', ');
        } catch {
          return v;
        }
      }
      return Array.isArray(v) ? v.join(', ') : (v || '');
    };

    phones.forEach(phone => {
      const row = [
        phone.id,
        csvCell(phone.commercial_name),
        csvCell(phone.model),
        phone.works ? 'Sí' : 'No',
        csvCell(joinJson(phone.bands)),
        csvCell(joinJson(phone.provinces)),
        csvCell(phone.observations),
        phone.created_at,
        phone.status
      ];
      csvRows.push(row.join(','));
    });

    return csvRows.join('\n');
  }

  async exportToJSON() {
    const res = await this.db.prepare("SELECT * FROM phones WHERE status = 'approved' ORDER BY created_at DESC").all();
    const phones = res.results || [];

    const parsedPhones = phones.map(phone => {
      let bands = phone.bands;
      if (typeof bands === 'string') {
        try { bands = JSON.parse(bands); } catch (e) { bands = []; }
      }
      let provinces = phone.provinces;
      if (typeof provinces === 'string') {
        try { provinces = JSON.parse(provinces); } catch (e) { provinces = []; }
      }
      return {
        ...phone,
        bands: Array.isArray(bands) ? bands : [],
        provinces: Array.isArray(provinces) ? provinces : [],
        works: phone.works === 1 || phone.works === true ? true : (phone.works === 0 || phone.works === false ? false : null)
      };
    });

    return {
      export_date: new Date().toISOString(),
      total_phones: parsedPhones.length,
      phones: parsedPhones
    };
  }

  async exportStats() {
    const counts = await this.db.prepare(
      "SELECT COUNT(*) AS total, SUM(CASE WHEN status='approved' THEN 1 ELSE 0 END) AS approved, SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) AS pending, SUM(CASE WHEN works=1 THEN 1 ELSE 0 END) AS works_yes FROM phones"
    ).first();

    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const eventsRow = await this.db.prepare("SELECT COUNT(*) AS n FROM events WHERE created_at >= ?1").bind(cutoff).first();
    const lastRow = await this.db.prepare("SELECT MAX(created_at) AS last FROM phones WHERE status='approved'").first();

    return {
      export_date: new Date().toISOString(),
      statistics: {
        total_phones: counts?.total || 0,
        approved_phones: counts?.approved || 0,
        pending_phones: counts?.pending || 0,
        works_in_cuba: counts?.works_yes || 0,
        events_last_30_days: eventsRow?.n || 0
      },
      summary: {
        last_updated: lastRow?.last || 'N/A'
      }
    };
  }

  async exportPhonesOnly() {
    const res = await this.db.prepare(
      "SELECT commercial_name, model, works, bands, provinces FROM phones WHERE status = 'approved' ORDER BY commercial_name ASC"
    ).all();
    const phones = res.results || [];

    const parseJson = (v) => {
      if (typeof v === 'string') {
        try { const p = JSON.parse(v); return Array.isArray(p) ? p : []; } catch (e) { return []; }
      }
      return Array.isArray(v) ? v : [];
    };

    return {
      export_date: new Date().toISOString(),
      phones: phones.map(phone => ({
        commercial_name: phone.commercial_name,
        model: phone.model,
        works: phone.works === 1 || phone.works === true,
        bands: parseJson(phone.bands),
        provinces: parseJson(phone.provinces)
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
      const row = await this.db.prepare("SELECT welcome FROM bot_config LIMIT 1").first();
      let msg = row?.welcome;
      
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

  // --- Captcha with Cloudflare KV (binding APP_KV) ---
  async kvSet(key, value, exSeconds) {
    if (!this.kv) return null;
    try {
      await this.kv.put(key, String(value), { expirationTtl: exSeconds });
      return true;
    } catch (e) {
      logger.error('kvSet error', e, { key });
      return null;
    }
  }
  async kvGet(key) {
    if (!this.kv) return null;
    try {
      return await this.kv.get(key);
    } catch (e) {
      logger.error('kvGet error', e, { key });
      return null;
    }
  }
  async kvDel(key) {
    if (!this.kv) return null;
    try {
      await this.kv.delete(key);
    } catch (e) {
      logger.error('kvDel error', e, { key });
    }
  }
  async kvKeys(prefix) {
    if (!this.kv) return [];
    try {
      const listed = await this.kv.list({ prefix });
      return (listed.keys || []).map(k => k.name);
    } catch (e) {
      logger.error('kvKeys error', e, { prefix });
      return [];
    }
  }
  async kickExpiredCaptchas() {
    try {
      const keys = await this.kvKeys('captcha:');
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

    const bandsStr = JSON.stringify(payload.bands);
    const provincesStr = JSON.stringify(payload.provinces);
    const worksInt = payload.works ? 1 : 0;
    const createdAt = new Date().toISOString();

    const nombreComercial = normalizeText(payload.commercial_name);

    let insertedId = null;
    try {
      const row = await this.db.prepare(
        "INSERT INTO phones (commercial_name, model, works, bands, provinces, observations, nombre_comercial, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8) RETURNING id"
      ).bind(payload.commercial_name, payload.model, worksInt, bandsStr, provincesStr, payload.observations, nombreComercial, createdAt).first();
      insertedId = row?.id;
    } catch (error) {
      if (/unique constraint|duplicate key/i.test(String(error))) {
        await this.clearDraft(userId);
        await this.sendMessage(chatId, '📱 Ese modelo ya está en la base de datos. Si crees que hay un error en sus datos, usa /reportar para avisarnos. ¡Gracias por aportar!');
        return;
      }
      logger.error('submitPhone error', error, { userId, chatId });
      await this.sendMessage(chatId, 'Se enredó la cosa 😅. Intenta de nuevo o /cancelar.');
      return;
    }

    await this.clearDraft(userId);
    await this.sendMessage(chatId, '¡Hecho! Tu propuesta quedó guardada y pasará a revisión. ✅\nCuando un admin la apruebe aparecerá en /revisar.');
    if (insertedId) await this.notifyAdminsNewSubmission(insertedId);
  }

  // --- Moderación (solo admins) ---
  isAdmin(userId) {
    return this.adminIds.includes(String(userId));
  }

  formatPhoneReview(p, pendingCount) {
    const bands = parseJsonArray(p.bands);
    const provinces = parseJsonArray(p.provinces);
    const works = p.works === 1 || p.works === true ? '✅ Sí' : '❌ No';
    const txt = `📋 Propuesta #${p.id}` + (pendingCount != null ? ` (${pendingCount} pendientes)` : '') + '\n\n' +
      `📱 Nombre: ${p.commercial_name}\n` +
      `🔢 Modelo: ${p.model || '—'}\n` +
      `🇨🇺 Funciona: ${works}\n` +
      `📡 Bandas: ${bands.length ? bands.join(', ') : '—'}\n` +
      `📍 Provincias: ${provinces.length ? provinces.join(', ') : '—'}\n` +
      `📝 Obs: ${p.observations || '—'}\n` +
      `📅 Enviado: ${p.created_at || '—'}`;
    return txt;
  }

  async countPending() {
    const row = await this.db.prepare("SELECT COUNT(*) AS n FROM phones WHERE status = 'pending'").first();
    return row?.n || 0;
  }

  async sendPendingReview(chatId, afterId = 0) {
    const pending = await this.countPending();
    if (!pending) {
      await this.sendMessage(chatId, '🎉 No hay propuestas pendientes. ¡Todo revisado!');
      return;
    }
    let next = await this.db.prepare(
      "SELECT * FROM phones WHERE status = 'pending' AND id > ?1 ORDER BY id LIMIT 1"
    ).bind(afterId).first();
    if (!next) {
      // Fin de la cola: reempezar desde el principio (quedan saltados)
      next = await this.db.prepare("SELECT * FROM phones WHERE status = 'pending' ORDER BY id LIMIT 1").first();
    }
    await this.sendMessage(chatId, this.formatPhoneReview(next, pending), { reply_markup: kbModeration(next.id) });
  }

  async handleModCallback(chatId, userId, data, msg) {
    if (!this.isAdmin(userId)) return;
    const [, action, idStr] = data.split(':');
    const id = Number(idStr);

    if (action === 'next') {
      // Quitar botones del actual y mostrar el siguiente
      if (msg?.message_id) await this.editMessageReplyMarkup(chatId, msg.message_id, { inline_keyboard: [] });
      await this.sendPendingReview(chatId, id);
      return;
    }

    if (action !== 'approve' && action !== 'reject') return;
    const phone = await this.db.prepare("SELECT * FROM phones WHERE id = ?1").bind(id).first();
    if (!phone) {
      await this.sendMessage(chatId, `La propuesta #${id} ya no existe.`);
      return;
    }
    if (phone.status !== 'pending') {
      await this.sendMessage(chatId, `La propuesta #${id} ya fue revisada (${phone.status}).`);
      return;
    }

    const newStatus = action === 'approve' ? 'approved' : 'rejected';
    await this.db.prepare("UPDATE phones SET status = ?1 WHERE id = ?2").bind(newStatus, id).run();

    const verdict = action === 'approve' ? '✅ APROBADO' : '❌ RECHAZADO';
    if (msg?.message_id) {
      await this.editMessageText(chatId, msg.message_id, this.formatPhoneReview(phone) + `\n\n${verdict}`);
    }

    if (action === 'approve') {
      await this.notifySubscribers(phone);
    }

    // Mostrar el siguiente pendiente automáticamente
    await this.sendPendingReview(chatId, id);
  }

  async notifySubscribers(phone) {
    try {
      const res = await this.db.prepare("SELECT tg_id FROM subscriptions LIMIT 100").all();
      const subs = res.results || [];
      if (!subs.length) return;
      const bands = parseJsonArray(phone.bands);
      const works = phone.works === 1 || phone.works === true ? '✅ funciona' : '❌ no funciona';
      const txt = `📢 Nuevo teléfono en la base:\n\n📱 ${phone.commercial_name}` +
        (phone.model ? ` (${phone.model})` : '') +
        `\n🇨🇺 ${works} en Cuba` +
        (bands.length ? `\n📡 Bandas: ${bands.join(', ')}` : '') +
        '\n\nUsa /revisar en el grupo para verlo.';
      for (const s of subs) {
        // Puede fallar si el usuario nunca inició el bot; se ignora
        await this.sendMessage(s.tg_id, txt);
      }
    } catch (e) {
      logger.error('notifySubscribers error', e);
    }
  }

  async notifyAdminsNewSubmission(phoneId) {
    try {
      const phone = await this.db.prepare("SELECT * FROM phones WHERE id = ?1").bind(phoneId).first();
      if (!phone) return;
      const pending = await this.countPending();
      for (const adminId of this.adminIds) {
        await this.sendMessage(adminId, '🆕 Nueva propuesta recibida:\n\n' + this.formatPhoneReview(phone, pending), {
          reply_markup: kbModeration(phone.id)
        });
      }
    } catch (e) {
      logger.error('notifyAdminsNewSubmission error', e);
    }
  }

  async handleReport(chatId, userId, text) {
    try {
      const reason = (text || '').trim();
      if (!reason) {
        await this.sendMessage(chatId, 'Escribe: /reportar <texto del reporte>.');
        return;
      }
      const createdAt = new Date().toISOString();
      await this.db.prepare(
        "INSERT INTO reports (tg_id, chat_id, model, reason, created_at) VALUES (?1, ?2, NULL, ?3, ?4)"
      ).bind(String(userId), String(chatId), reason, createdAt).run();
      await this.sendMessage(chatId, 'Reporte recibido. Gracias por avisar.');
    } catch (e) {
      logger.error('handleReport error', e, { chatId, userId });
      await this.sendMessage(chatId, 'Se enredó la cosa 😅. Intenta de nuevo o /cancelar.');
    }
  }

  async handleSubscribe(chatId, userId) {
    try {
      const createdAt = new Date().toISOString();
      await this.db.prepare(
        "INSERT OR REPLACE INTO subscriptions (tg_id, created_at) VALUES (?1, ?2)"
      ).bind(String(userId), createdAt).run();
      await this.sendMessage(chatId, 'Suscripción activada. 📣');
    } catch (e) {
      logger.error('handleSubscribe error', e, { chatId, userId });
      await this.sendMessage(chatId, 'Se enredó la cosa 😅. Intenta de nuevo o /cancelar.');
    }
  }
  async handleUnsubscribe(chatId, userId) {
    try {
      await this.db.prepare("DELETE FROM subscriptions WHERE tg_id = ?1").bind(String(userId)).run();
      await this.sendMessage(chatId, 'Suscripción cancelada. 🔕');
    } catch (e) {
      logger.error('handleUnsubscribe error', e, { chatId, userId });
      await this.sendMessage(chatId, 'Se enredó la cosa 😅. Intenta de nuevo o /cancelar.');
    }
  }
}

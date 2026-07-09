/* src/bot-simple.js
 * SimpleTelegramBot: estado (token/DB/KV/config), helpers del API de Telegram
 * y despacho de updates. La lógica de cada feature vive en su módulo:
 *   commands.js (comandos), wizard.js (/subir), search.js (/revisar),
 *   moderation.js (/pendientes + notificaciones), export.js (/exportar),
 *   captcha.js (verificación de miembros), info.js (bienvenida/reglas/ayuda).
 */

import { logger } from './logger.js';
import { tgFetch } from './telegram.js';
import { toCsvArray, escapeHtml } from './format.js';
import { onCommand } from './commands.js';
import { searchByModel } from './search.js';
import { handleWizardText, handleWizardCallback, handleProvincesCallback } from './wizard.js';
import { handleModCallback, drainPendingNotifications } from './moderation.js';
import { handleExportCallback } from './export.js';
import { startCaptchaAndWelcome, startCaptcha, handleCaptchaCallback, kickExpiredCaptchas } from './captcha.js';
import { welcomeUserDM, handleWelcomeCallback } from './info.js';

export class SimpleTelegramBot {
  constructor(env) {
    this.token = env.BOT_TOKEN;
    this.db = env.DB;
    this.adminIds = toCsvArray(env.ADMIN_TG_IDS);
    this.allowedChatIds = toCsvArray(env.ALLOWED_CHAT_IDS);
    this.showShortWelcomeInGroup = String(env.SHOW_SHORT_WELCOME_IN_GROUP || 'true').toLowerCase() !== 'false';
    // Cloudflare KV (captcha/rate limit)
    this.kv = env.APP_KV;
  }

  // --- Telegram API helpers ---
  // parse_mode: HTML por defecto (los textos propios usan <b>/<i> y los datos de
  // usuario pasan por escapeHtml); 'plain' omite parse_mode (textos de bot_config).
  async sendMessage(chat_id, text, opts = {}) {
    const payload = {
      chat_id,
      text,
      reply_markup: opts.reply_markup,
      reply_to_message_id: opts.reply_to_message_id
    };
    if (opts.parse_mode !== 'plain') payload.parse_mode = opts.parse_mode || 'HTML';
    // Efectos animados: Telegram solo los acepta en chats privados
    if (opts.message_effect_id) payload.message_effect_id = opts.message_effect_id;
    return tgFetch(this.token, 'sendMessage', payload);
  }
  async sendPhoto(chat_id, photo, opts = {}) {
    const payload = { chat_id, photo, caption: opts.caption, reply_markup: opts.reply_markup };
    if (opts.caption && opts.parse_mode !== 'plain') payload.parse_mode = opts.parse_mode || 'HTML';
    if (opts.message_effect_id) payload.message_effect_id = opts.message_effect_id;
    return tgFetch(this.token, 'sendPhoto', payload);
  }
  async setMessageReaction(chat_id, message_id, emoji) {
    return tgFetch(this.token, 'setMessageReaction', {
      chat_id,
      message_id,
      reaction: [{ type: 'emoji', emoji }]
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
    const payload = { chat_id, message_id, text, reply_markup: opts.reply_markup };
    if (opts.parse_mode !== 'plain') payload.parse_mode = opts.parse_mode || 'HTML';
    return tgFetch(this.token, 'editMessageText', payload);
  }
  async editMessageReplyMarkup(chat_id, message_id, reply_markup) {
    return tgFetch(this.token, 'editMessageReplyMarkup', { chat_id, message_id, reply_markup });
  }

  // --- KV helpers ---
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
  // Rate limit simple en KV: máx `limit` usos por ~minuto (KV es eventual; freno grueso, no exacto)
  async rateLimited(key, limit) {
    if (!this.kv) return false;
    const k = `rl:${key}`;
    const cur = Number(await this.kvGet(k)) || 0;
    if (cur >= limit) return true;
    await this.kvSet(k, String(cur + 1), 60);
    return false;
  }

  // Config de bot_config (una sola fila), cacheada por instancia (una por update)
  async getBotConfig() {
    if (this._config) return this._config;
    let row = null;
    try {
      row = await this.db.prepare("SELECT * FROM bot_config LIMIT 1").first();
    } catch (e) {
      logger.error('getBotConfig error', e);
    }
    this._config = {
      rules: row?.rules || '',
      welcome: row?.welcome || '',
      welcome_photo: row?.welcome_photo || '',
      captcha_enabled: row ? (row.captcha_enabled === 1 || row.captcha_enabled === true) : true,
      captcha_timeout: Number(row?.captcha_timeout) || 120,
      auto_approve_join: row ? (row.auto_approve_join === 1 || row.auto_approve_join === true) : true
    };
    return this._config;
  }

  isAdmin(userId) {
    return this.adminIds.includes(String(userId));
  }

  // Access control for groups
  groupAllowed(chat) {
    if (!chat) return false;
    if (chat.type !== 'group' && chat.type !== 'supergroup') return true; // Not a group
    if (!this.allowedChatIds.length) return true;
    return this.allowedChatIds.includes(String(chat.id));
  }

  // --- Webhook dispatcher ---
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
      logger.error('handleUpdate error', e);
    }
  }

  async onMessage(msg) {
    const chat = msg.chat;
    const chatId = chat.id;
    const userId = msg.from?.id;
    const chatType = chat?.type;
    const text = (msg.text || '').trim();

    // Ignore not-allowed groups
    if ((chatType === 'group' || chatType === 'supergroup') && !this.groupAllowed(chat)) return;

    // Welcome new members (group join)
    if (Array.isArray(msg.new_chat_members) && msg.new_chat_members.length) {
      for (const m of msg.new_chat_members) {
        if (m.is_bot) continue;
        await startCaptchaAndWelcome(this, m, chat);
      }
      return;
    }

    // If user has not passed captcha, block messages and remind
    if ((chatType === 'group' || chatType === 'supergroup') && userId) {
      const pending = await this.kvGet(`captcha:${chatId}:${userId}`);
      if (pending) {
        if (msg.message_id) await this.deleteMessage(chatId, msg.message_id);
        await this.sendMessage(chatId, `⏳ @${escapeHtml(msg.from?.username || String(userId))} verifica para poder participar.`, {});
        return;
      }
    }

    // En privado el bot solo responde al dueño/admins
    if (chatType === 'private' && !this.isAdmin(userId)) return;

    // Admin en privado: foto con caption "/banner" -> guardar banner de bienvenida
    if (chatType === 'private' && Array.isArray(msg.photo) && msg.photo.length) {
      const caption = (msg.caption || '').trim().toLowerCase();
      if (caption === '/banner') {
        const fileId = msg.photo[msg.photo.length - 1].file_id; // la de mayor resolución
        await this.db.prepare("UPDATE bot_config SET welcome_photo = ?1 WHERE id = 1").bind(fileId).run();
        await this.sendMessage(chatId, '🖼 Banner de bienvenida guardado. Pruébalo con /start.\nPara quitarlo: /banner quitar');
      }
      return;
    }

    if (text.startsWith('/')) {
      await onCommand(this, { chatId, chatType, userId, msg, text });
      return;
    }

    // Wizard text input (grupo o DM): solo actúa si el usuario tiene borrador activo
    if (text) {
      const replyTo = chatType === 'private' ? undefined : msg.message_id;
      await handleWizardText(this, chatId, userId, text, replyTo);
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
    if (msg?.chat?.type === 'private' && !data.startsWith('cap:') && !this.isAdmin(userId)) return;

    try {
      // Paginación de /revisar (cualquiera puede pasar páginas)
      if (data.startsWith('pg:')) {
        await this.answerCallbackQuery(id);
        const parts = data.split(':');
        const offset = Number(parts[1]) || 0;
        const query = parts.slice(2).join(':');
        if (query) await searchByModel(this, chatId, query, offset, msg?.message_id);
        return;
      }

      if (data.startsWith('prov:')) {
        await handleProvincesCallback(this, { id, data, msg, chatId, userId });
        return;
      }

      // Moderation buttons (solo admins)
      if (data.startsWith('mod:')) {
        await this.answerCallbackQuery(id, this.isAdmin(userId) ? {} : { text: 'Solo administradores.', show_alert: true });
        await handleModCallback(this, chatId, userId, data, msg);
        return;
      }

      if (data.startsWith('export:')) {
        await this.answerCallbackQuery(id);
        await handleExportCallback(this, chatId, userId, data.split(':')[1]);
        return;
      }

      if (data.startsWith('welcome:')) {
        await this.answerCallbackQuery(id);
        await handleWelcomeCallback(this, { chatId, userId, action: data.split(':')[1] });
        return;
      }

      if (data.startsWith('cap:')) {
        await handleCaptchaCallback(this, { id, data, msg, chatId, userId });
        return;
      }

      if (data.startsWith('wiz:')) {
        await handleWizardCallback(this, { id, data, msg, chatId, userId });
        return;
      }
    } catch (e) {
      logger.error('onCallback error', e, { userId: userId || 'unknown' });
    }
  }

  async onChatJoinRequest(req) {
    // Approve join request (según config) and DM welcome
    const user = req.from;
    const chat = { id: req.chat?.id, type: req.chat?.type, title: req.chat?.title };
    const config = await this.getBotConfig();
    if (!config.auto_approve_join) return; // la solicitud queda para que un admin la apruebe a mano
    await tgFetch(this.token, 'approveChatJoinRequest', { chat_id: chat.id, user_id: user.id });
    await welcomeUserDM(this, user, chat);
    // startCaptcha ya maneja el fallback al grupo si los DMs están cerrados
    await startCaptcha(this, user, chat);
  }

  // --- Delegados para el cron del worker ---
  async kickExpiredCaptchas() {
    return kickExpiredCaptchas(this);
  }
  async drainPendingNotifications(batchSize) {
    return drainPendingNotifications(this, batchSize);
  }
}

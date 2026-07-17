/* src/commands.js
 * Enrutado de comandos /… y acciones simples (reportes, suscripciones).
 */
import { logger } from './logger.js';
import { escapeHtml } from './format.js';
import { searchByModel, searchByBrand, showTopPhones } from './search.js';
import { handleImei } from './imei.js';
import { startWizard, cancelWizard } from './wizard.js';
import { sendExportOptions } from './export.js';
import { sendPendingReview } from './moderation.js';
import { sendWelcomeMessage, sendRules, getShortRules, sendBandsGuide, sendHelp, sendStats } from './info.js';

export async function onCommand(bot, { chatId, chatType, userId, msg, text }) {
  const [cmd, ...args] = text.split(/\s+/);
  const argStr = args.join(' ').trim();
  switch (cmd.toLowerCase()) {
    case '/start': {
      await sendWelcomeMessage(bot, chatId, userId, chatType);
      break;
    }
    case '/id': {
      await sendIdInfo(bot, { chatId, chatType, userId, msg });
      break;
    }
    case '/reglas': {
      await sendRules(bot, userId, chatId, chatType);
      break;
    }
    case '/fijar': {
      // Solo admins pueden fijar reglas
      if (!bot.isAdmin(userId)) {
        await bot.sendMessage(chatId, '❌ Solo los administradores pueden usar este comando.');
        return;
      }
      if (chatType === 'private') {
        await bot.sendMessage(chatId, 'Este comando solo funciona en grupos.');
        return;
      }
      await bot.sendMessage(chatId, getShortRules());
      break;
    }
    case '/exportar': {
      await sendExportOptions(bot, chatId);
      break;
    }
    case '/subir': {
      await startWizard(bot, chatId, userId, chatType === 'private' ? undefined : msg.message_id);
      break;
    }
    case '/revisar': {
      if (!argStr) {
        await bot.sendMessage(chatId, '📝 Formato: /revisar &lt;modelo&gt;\n\nEjemplo: /revisar Samsung A14');
        return;
      }
      await searchByModel(bot, chatId, argStr);
      break;
    }
    case '/imei': {
      await handleImei(bot, chatId, argStr);
      break;
    }
    case '/cancelar': {
      await cancelWizard(bot, chatId, userId);
      break;
    }
    case '/reportar': {
      await handleReport(bot, chatId, userId, argStr);
      break;
    }
    case '/bandas': {
      await sendBandsGuide(bot, chatId);
      break;
    }
    case '/ayuda':
    case '/help': {
      await sendHelp(bot, chatId);
      break;
    }
    case '/pendientes': {
      if (!bot.isAdmin(userId)) {
        if (chatType === 'private') await bot.sendMessage(chatId, '❌ Solo los administradores pueden usar este comando.');
        return;
      }
      await sendPendingReview(bot, chatId, 0);
      break;
    }
    case '/banner': {
      if (!bot.isAdmin(userId)) return;
      if (chatType !== 'private') {
        await bot.sendMessage(chatId, 'El banner se configura por DM.');
        return;
      }
      if (argStr.toLowerCase() === 'quitar') {
        await bot.db.prepare("UPDATE bot_config SET welcome_photo = '' WHERE id = 1").run();
        await bot.sendMessage(chatId, '🗑 Banner de bienvenida eliminado. /start vuelve a ser solo texto.');
        return;
      }
      await bot.sendMessage(chatId, '🖼 Envíame una <b>foto</b> con el texto <code>/banner</code> como pie de foto y la usaré como banner de /start.\nPara quitar el actual: /banner quitar');
      break;
    }
    case '/suscribir': {
      await handleSubscribe(bot, chatId, userId);
      break;
    }
    case '/cancelarsub': {
      await handleUnsubscribe(bot, chatId, userId);
      break;
    }
    case '/top': {
      await showTopPhones(bot, chatId);
      break;
    }
    case '/marca': {
      if (!argStr) {
        await bot.sendMessage(chatId, '📝 Formato: /marca &lt;marca&gt;\n\nEjemplo: /marca Samsung');
        return;
      }
      await searchByBrand(bot, chatId, argStr);
      break;
    }
    case '/seguir': {
      if (!argStr) {
        await bot.sendMessage(chatId, '🔔 Formato: /seguir &lt;modelo&gt;\n\nEjemplo: /seguir Samsung A14\n\nTe avisaré cuando alguien lo suba a la base.');
        return;
      }
      await handleFollow(bot, chatId, userId, argStr);
      break;
    }
    case '/misseguimientos': {
      await handleMyFollows(bot, chatId, userId);
      break;
    }
    case '/stats': {
      await sendStats(bot, chatId);
      break;
    }
    default: {
      if (chatType === 'private') {
        await bot.sendMessage(chatId, 'Usa /subir para iniciar el asistente.');
      }
      break;
    }
  }
}

async function sendIdInfo(bot, { chatId, chatType, userId, msg }) {
  const isAdmin = bot.isAdmin(userId);
  const user = msg.from;
  const chat = msg.chat;

  let response = '🆔 <b>Información de IDs</b>\n\n';
  response += `👤 <b>Usuario:</b>\n`;
  response += `• ID: <code>${userId}</code>\n`;
  response += `• Nombre: ${escapeHtml(user.first_name || 'N/A')}\n`;
  response += `• Username: @${escapeHtml(user.username || 'N/A')}\n`;
  response += `• Apellido: ${escapeHtml(user.last_name || 'N/A')}\n\n`;

  response += `💬 <b>Chat:</b>\n`;
  response += `• ID: <code>${chatId}</code>\n`;
  response += `• Tipo: ${chatType}\n`;
  response += `• Título: ${escapeHtml(chat.title || 'N/A')}\n`;

  if (isAdmin) {
    response += `\n🔧 <b>Info de Admin:</b>\n`;
    response += `• Es admin: ✅ Sí\n`;
    response += `• Timestamp: ${new Date().toISOString()}\n`;
  }

  await bot.sendMessage(chatId, response);
}

export async function handleReport(bot, chatId, userId, text) {
  try {
    const reason = (text || '').trim();
    if (!reason) {
      await bot.sendMessage(chatId, 'Escribe: /reportar &lt;texto del reporte&gt;.');
      return;
    }
    const createdAt = new Date().toISOString();
    await bot.db.prepare(
      "INSERT INTO reports (tg_id, chat_id, model, reason, created_at) VALUES (?1, ?2, NULL, ?3, ?4)"
    ).bind(String(userId), String(chatId), reason, createdAt).run();
    await bot.sendMessage(chatId, '📨 <b>Reporte recibido.</b> Gracias por avisar — un admin lo revisará.');
  } catch (e) {
    logger.error('handleReport error', e, { chatId, userId });
    await bot.sendMessage(chatId, 'Se enredó la cosa 😅. Intenta de nuevo o /cancelar.');
  }
}

export async function handleSubscribe(bot, chatId, userId) {
  try {
    const createdAt = new Date().toISOString();
    await bot.db.prepare(
      "INSERT OR REPLACE INTO subscriptions (tg_id, created_at) VALUES (?1, ?2)"
    ).bind(String(userId), createdAt).run();
    await bot.sendMessage(chatId,
      '🔔 <b>Suscripción activada.</b> Te avisaré cuando se aprueben teléfonos nuevos.\n' +
      '💡 Los avisos llegan por privado: tócame el perfil y dale "Iniciar" una vez para que pueda escribirte.');
  } catch (e) {
    logger.error('handleSubscribe error', e, { chatId, userId });
    await bot.sendMessage(chatId, 'Se enredó la cosa 😅. Intenta de nuevo o /cancelar.');
  }
}

export async function handleUnsubscribe(bot, chatId, userId) {
  try {
    await bot.db.prepare("DELETE FROM subscriptions WHERE tg_id = ?1").bind(String(userId)).run();
    await bot.sendMessage(chatId, '🔕 Suscripción cancelada. No recibirás más avisos.');
  } catch (e) {
    logger.error('handleUnsubscribe error', e, { chatId, userId });
    await bot.sendMessage(chatId, 'Se enredó la cosa 😅. Intenta de nuevo o /cancelar.');
  }
}

async function handleFollow(bot, chatId, userId, query) {
  try {
    const normalized = query.trim().toLowerCase().slice(0, 100);
    const existing = await bot.db.prepare(
      "SELECT id FROM watchlist WHERE tg_id = ?1 AND query = ?2"
    ).bind(String(userId), normalized).first();
    if (existing) {
      await bot.sendMessage(chatId,
        `🔔 Ya estás siguiendo «${escapeHtml(query)}».\n` +
        '💡 /misseguimientos para ver tus seguimientos activos.');
      return;
    }
    const countRow = await bot.db.prepare(
      "SELECT COUNT(*) AS n FROM watchlist WHERE tg_id = ?1"
    ).bind(String(userId)).first();
    if ((countRow?.n || 0) >= 5) {
      await bot.sendMessage(chatId,
        '⚠️ Ya tienes 5 seguimientos activos (el máximo).\n' +
        'Usa /misseguimientos para cancelar alguno.');
      return;
    }
    await bot.db.prepare(
      "INSERT INTO watchlist (tg_id, query, created_at) VALUES (?1, ?2, ?3)"
    ).bind(String(userId), normalized, new Date().toISOString()).run();
    await bot.sendMessage(chatId,
      `🔔 <b>Seguimiento activado</b> para «${escapeHtml(query)}».\n` +
      'Te avisaré cuando alguien lo suba a la base.\n\n' +
      '💡 /misseguimientos para ver todos tus seguimientos.');
  } catch (e) {
    logger.error('handleFollow error', e, { chatId, userId });
    await bot.sendMessage(chatId, 'Se enredó la cosa 😅. Intenta de nuevo.');
  }
}

export async function handleMyFollows(bot, chatId, userId) {
  try {
    const res = await bot.db.prepare(
      "SELECT id, query FROM watchlist WHERE tg_id = ?1 ORDER BY id"
    ).bind(String(userId)).all();
    const rows = res.results || [];
    if (!rows.length) {
      await bot.sendMessage(chatId,
        '📭 No tienes seguimientos activos.\n\n' +
        '💡 Usa /seguir &lt;modelo&gt; para que te avisen cuando alguien lo suba.');
      return;
    }
    const kb = {
      inline_keyboard: rows.map(r => [
        { text: `❌ Dejar «${r.query.slice(0, 30)}»`, callback_data: `unfollow:${r.id}` }
      ])
    };
    const list = rows.map((r, i) => `${i + 1}. ${escapeHtml(r.query)}`).join('\n');
    await bot.sendMessage(chatId,
      `🔔 <b>Tus seguimientos (${rows.length}/5)</b>\n\n${list}\n\n` +
      'Pulsa para cancelar uno:',
      { reply_markup: kb });
  } catch (e) {
    logger.error('handleMyFollows error', e, { chatId, userId });
    await bot.sendMessage(chatId, 'Se enredó la cosa 😅. Intenta de nuevo.');
  }
}

export async function handleUnfollow(bot, chatId, userId, watchlistId, msgId) {
  try {
    const row = await bot.db.prepare(
      "SELECT id, query, tg_id FROM watchlist WHERE id = ?1"
    ).bind(watchlistId).first();
    if (!row || String(row.tg_id) !== String(userId)) {
      await bot.sendMessage(chatId, 'No encontré ese seguimiento o no es tuyo.');
      return;
    }
    await bot.db.prepare("DELETE FROM watchlist WHERE id = ?1").bind(watchlistId).run();
    const text = `✅ Dejaste de seguir «${escapeHtml(row.query)}».`;
    if (msgId) {
      await bot.editMessageText(chatId, msgId, text);
    } else {
      await bot.sendMessage(chatId, text);
    }
  } catch (e) {
    logger.error('handleUnfollow error', e, { chatId, userId });
    await bot.sendMessage(chatId, 'Se enredó la cosa 😅. Intenta de nuevo.');
  }
}

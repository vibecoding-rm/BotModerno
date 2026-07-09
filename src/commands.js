/* src/commands.js
 * Enrutado de comandos /… y acciones simples (reportes, suscripciones).
 */
import { logger } from './logger.js';
import { escapeHtml } from './format.js';
import { searchByModel } from './search.js';
import { startWizard, cancelWizard } from './wizard.js';
import { sendExportOptions } from './export.js';
import { sendPendingReview } from './moderation.js';
import { sendWelcomeMessage, sendRules, getShortRules, sendBandsGuide, sendHelp } from './info.js';

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
    case '/suscribir': {
      await handleSubscribe(bot, chatId, userId);
      break;
    }
    case '/cancelarsub': {
      await handleUnsubscribe(bot, chatId, userId);
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
    await bot.sendMessage(chatId, 'Reporte recibido. Gracias por avisar.');
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
    await bot.sendMessage(chatId, 'Suscripción activada. 📣');
  } catch (e) {
    logger.error('handleSubscribe error', e, { chatId, userId });
    await bot.sendMessage(chatId, 'Se enredó la cosa 😅. Intenta de nuevo o /cancelar.');
  }
}

export async function handleUnsubscribe(bot, chatId, userId) {
  try {
    await bot.db.prepare("DELETE FROM subscriptions WHERE tg_id = ?1").bind(String(userId)).run();
    await bot.sendMessage(chatId, 'Suscripción cancelada. 🔕');
  } catch (e) {
    logger.error('handleUnsubscribe error', e, { chatId, userId });
    await bot.sendMessage(chatId, 'Se enredó la cosa 😅. Intenta de nuevo o /cancelar.');
  }
}

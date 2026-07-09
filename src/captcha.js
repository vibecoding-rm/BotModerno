/* src/captcha.js
 * Verificación anti-spam de miembros nuevos (estado en KV, botones cap:).
 */
import { logger } from './logger.js';
import { tgFetch, EFFECTS } from './telegram.js';
import { escapeHtml } from './format.js';
import { kbCaptcha } from './keyboards.js';
import { welcomeUserDM } from './info.js';

export async function startCaptchaAndWelcome(bot, user, chat) {
  const viaDm = await startCaptcha(bot, user, chat);
  // Solo enviar mensaje corto en grupos, no llenar el chat (si el captcha fue por DM)
  if (viaDm && bot.showShortWelcomeInGroup && (chat.type === 'group' || chat.type === 'supergroup')) {
    const short = `👋 ¡Hola ${escapeHtml(user.first_name || 'usuario')}! Revisa tus DM para verificar y participar.`;
    await bot.sendMessage(chat.id, short);
  }
}

// Devuelve true si el captcha se envió por DM, false si fue en el grupo o está desactivado.
export async function startCaptcha(bot, user, chat) {
  const config = await bot.getBotConfig();
  if (!config.captcha_enabled) return false;
  const timeoutSec = config.captcha_timeout;
  const minutes = Math.max(1, Math.round(timeoutSec / 60));
  const text =
    '🔐 <b>Verificación de seguridad</b>\n\n' +
    'Antes de participar en el grupo, confirma que eres humano.\n' +
    'Esto nos ayuda a evitar spam y mantener el grupo limpio.\n\n' +
    `⏰ Tienes ${minutes} minuto${minutes === 1 ? '' : 's'} para verificar.\n` +
    '❌ Si no verificas, serás expulsado automáticamente.';
  // Intentar por DM primero; la key en KV se guarda solo cuando el captcha llegó a alguna parte
  const dm = await bot.sendMessage(user.id, text, { reply_markup: kbCaptcha(chat.id, user.id) });
  const viaDm = !!dm?.ok;
  if (!viaDm) {
    // DMs cerrados: captcha con botón en el propio grupo para no dejar al usuario atrapado
    const mention = escapeHtml(user.username ? `@${user.username}` : (user.first_name || 'usuario'));
    await bot.sendMessage(chat.id, `🔐 ${mention}, confirma que eres humano para participar:`, {
      reply_markup: kbCaptcha(chat.id, user.id)
    });
  }
  const expiration = Date.now() + timeoutSec * 1000;
  await bot.kvSet(`captcha:${chat.id}:${user.id}`, String(expiration), 86400);
  return viaDm;
}

// Botones cap:ok|fail (en DM o, si los DMs están cerrados, en el propio grupo)
export async function handleCaptchaCallback(bot, { id, data, msg, chatId, userId, from }) {
  const parts = data.split(':'); // cap:ok|fail:chatId:userId
  const kind = parts[1];
  const cId = Number(parts[2]);
  const uId = Number(parts[3]);
  if (uId !== userId) {
    await bot.answerCallbackQuery(id, { text: 'Esta verificación es de otro usuario.' });
    return;
  }
  const inGroup = msg?.chat?.type === 'group' || msg?.chat?.type === 'supergroup';
  if (kind === 'ok') {
    await bot.kvDel(`captcha:${cId}:${uId}`);
    await bot.answerCallbackQuery(id, { text: '✅ ¡Verificación completada!' });
    // Limpiar el mensaje de captcha del grupo si se verificó ahí
    if (inGroup && msg?.message_id) await bot.deleteMessage(chatId, msg.message_id);
    // El DM puede fallar si el usuario tiene DMs cerrados; se ignora
    await bot.sendMessage(userId, '✅ ¡Verificación completada! Ahora puedes participar en el grupo.', { message_effect_id: EFFECTS.party });
    // Bienvenida completa con banner (incluye las reglas)
    await welcomeUserDM(bot, from || { id: userId }, { id: cId });
  } else {
    await bot.answerCallbackQuery(id);
    // Expulsar usuario del grupo
    await tgFetch(bot.token, 'banChatMember', { chat_id: cId, user_id: uId });
    await tgFetch(bot.token, 'unbanChatMember', { chat_id: cId, user_id: uId }); // unban inmediato para que pueda volver a intentar
    await bot.kvDel(`captcha:${cId}:${uId}`);
    if (inGroup && msg?.message_id) await bot.deleteMessage(chatId, msg.message_id);
    await bot.sendMessage(userId, '❌ Has sido expulsado por no completar la verificación. Puedes volver a unirte al grupo.');
  }
}

export async function kickExpiredCaptchas(bot) {
  try {
    const keys = await bot.kvKeys('captcha:');
    if (!keys || !keys.length) return;

    for (const key of keys) {
      const val = await bot.kvGet(key);
      if (val && Date.now() > Number(val)) {
        const parts = key.split(':');
        if (parts.length === 3) {
          const chatId = Number(parts[1]);
          const userId = Number(parts[2]);
          logger.info('Kicking expired captcha user', { chatId, userId });

          // ban + unban user
          await tgFetch(bot.token, 'banChatMember', { chat_id: chatId, user_id: userId });
          await tgFetch(bot.token, 'unbanChatMember', { chat_id: chatId, user_id: userId });

          // delete key
          await bot.kvDel(key);

          // send private message
          await bot.sendMessage(userId, '❌ El tiempo de verificación ha expirado y has sido expulsado. Puedes volver a unirte al grupo.');
        }
      }
    }
  } catch (e) {
    logger.error('Error in kickExpiredCaptchas', e);
  }
}

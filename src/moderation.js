/* src/moderation.js
 * Cola de moderación (/pendientes, botones mod:) y notificaciones a admins/suscriptores.
 */
import { logger } from './logger.js';
import { parseJsonArray, escapeHtml, normalizeText } from './format.js';
import { kbModeration } from './keyboards.js';

export function formatPhoneReview(p, pendingCount) {
  const bands = parseJsonArray(p.bands);
  const provinces = parseJsonArray(p.provinces);
  const works = p.works === 1 || p.works === true ? '✅ Sí' : '❌ No';
  return `📋 Propuesta #${p.id}` + (pendingCount != null ? ` (${pendingCount} pendientes)` : '') + '\n\n' +
    `📱 Nombre: ${escapeHtml(p.commercial_name)}\n` +
    `🔢 Modelo: ${escapeHtml(p.model || '—')}\n` +
    `🇨🇺 Funciona: ${works}\n` +
    `📡 Bandas: ${escapeHtml(bands.length ? bands.join(', ') : '—')}\n` +
    `📍 Provincias: ${escapeHtml(provinces.length ? provinces.join(', ') : '—')}\n` +
    `📝 Obs: ${escapeHtml(p.observations || '—')}\n` +
    `📅 Enviado: ${p.created_at || '—'}`;
}

export async function countPending(bot) {
  const row = await bot.db.prepare("SELECT COUNT(*) AS n FROM phones WHERE status = 'pending'").first();
  return row?.n || 0;
}

export async function sendPendingReview(bot, chatId, afterId = 0) {
  const pending = await countPending(bot);
  if (!pending) {
    await bot.sendMessage(chatId, '🎉 No hay propuestas pendientes. ¡Todo revisado!');
    return;
  }
  let next = await bot.db.prepare(
    "SELECT * FROM phones WHERE status = 'pending' AND id > ?1 ORDER BY id LIMIT 1"
  ).bind(afterId).first();
  if (!next) {
    // Fin de la cola: reempezar desde el principio (quedan saltados)
    next = await bot.db.prepare("SELECT * FROM phones WHERE status = 'pending' ORDER BY id LIMIT 1").first();
  }
  await bot.sendMessage(chatId, formatPhoneReview(next, pending), { reply_markup: kbModeration(next.id) });
}

export async function handleModCallback(bot, chatId, userId, data, msg) {
  if (!bot.isAdmin(userId)) return;
  const [, action, idStr] = data.split(':');
  const id = Number(idStr);

  if (action === 'next') {
    // Quitar botones del actual y mostrar el siguiente
    if (msg?.message_id) await bot.editMessageReplyMarkup(chatId, msg.message_id, { inline_keyboard: [] });
    await sendPendingReview(bot, chatId, id);
    return;
  }

  if (action !== 'approve' && action !== 'reject') return;
  const phone = await bot.db.prepare("SELECT * FROM phones WHERE id = ?1").bind(id).first();
  if (!phone) {
    await bot.sendMessage(chatId, `La propuesta #${id} ya no existe.`);
    return;
  }
  if (phone.status !== 'pending') {
    await bot.sendMessage(chatId, `La propuesta #${id} ya fue revisada (${phone.status}).`);
    return;
  }

  const newStatus = action === 'approve' ? 'approved' : 'rejected';
  await bot.db.prepare("UPDATE phones SET status = ?1 WHERE id = ?2").bind(newStatus, id).run();

  const verdict = action === 'approve' ? '✅ APROBADO' : '❌ RECHAZADO';
  if (msg?.message_id) {
    await bot.editMessageText(chatId, msg.message_id, formatPhoneReview(phone) + `\n\n${verdict}`);
  }

  if (action === 'approve') {
    await notifySubscribers(bot, phone);
    await notifyWatchlist(bot, phone);
  }

  // Mostrar el siguiente pendiente automáticamente
  await sendPendingReview(bot, chatId, id);
}

// Encola la notificación (una fila por suscriptor); el cron la envía por lotes.
// Enviar en línea rompía el límite de 50 subrequests por request del plan gratis.
export async function notifySubscribers(bot, phone) {
  try {
    const bands = parseJsonArray(phone.bands);
    const works = phone.works === 1 || phone.works === true ? '✅ funciona' : '❌ no funciona';
    const txt = `📢 Nuevo teléfono en la base:\n\n📱 ${escapeHtml(phone.commercial_name)}` +
      (phone.model ? ` (${escapeHtml(phone.model)})` : '') +
      `\n🇨🇺 ${works} en Cuba` +
      (bands.length ? `\n📡 Bandas: ${escapeHtml(bands.join(', '))}` : '') +
      '\n\nUsa /revisar en el grupo para verlo.';
    await bot.db.prepare(
      "INSERT INTO pending_notifications (tg_id, payload, created_at) SELECT tg_id, ?1, ?2 FROM subscriptions"
    ).bind(txt, new Date().toISOString()).run();
  } catch (e) {
    logger.error('notifySubscribers error', e);
  }
}

// Notifica a usuarios que siguen este modelo con /seguir cuando se aprueba.
// Borra el watchlist entry después de notificar (one-shot).
export async function notifyWatchlist(bot, phone) {
  try {
    const name = phone.commercial_name || phone.model || '';
    if (!name) return;
    const normName = normalizeText(name);
    const res = await bot.db.prepare("SELECT id, tg_id, query FROM watchlist").all();
    const rows = (res.results || []).filter(r => normName.includes(r.query));
    if (!rows.length) return;
    const works = phone.works === 1 || phone.works === true ? '✅ funciona' : '❌ no funciona';
    const txt = `🔔 <b>¡Encontrado!</b> Estabas siguiendo este modelo:\n\n` +
      `📱 <b>${escapeHtml(phone.commercial_name)}</b>` +
      (phone.model ? ` (${escapeHtml(phone.model)})` : '') +
      `\n🇨🇺 ${works} en Cuba\n\n` +
      `Usa /revisar ${escapeHtml(name)} para ver los detalles.`;
    const ids = rows.map(r => Number(r.id));
    const now = new Date().toISOString();
    for (const row of rows) {
      await bot.db.prepare(
        "INSERT INTO pending_notifications (tg_id, payload, created_at) VALUES (?1, ?2, ?3)"
      ).bind(row.tg_id, txt, now).run();
    }
    if (ids.length) {
      await bot.db.prepare(
        `DELETE FROM watchlist WHERE id IN (${ids.join(',')})`
      ).run();
    }
  } catch (e) {
    logger.error('notifyWatchlist error', e);
  }
}

// Drena la cola de notificaciones en lotes chicos (llamado desde el cron cada 5 min)
export async function drainPendingNotifications(bot, batchSize = 30) {
  try {
    const res = await bot.db.prepare(
      "SELECT id, tg_id, payload FROM pending_notifications ORDER BY id LIMIT ?1"
    ).bind(batchSize).all();
    const rows = res.results || [];
    if (!rows.length) return;
    for (const row of rows) {
      // Puede fallar si el usuario nunca inició el bot o lo bloqueó; se descarta igual
      await bot.sendMessage(row.tg_id, row.payload);
    }
    const ids = rows.map(r => Number(r.id)).filter(Number.isFinite).join(',');
    await bot.db.prepare(`DELETE FROM pending_notifications WHERE id IN (${ids})`).run();
  } catch (e) {
    logger.error('drainPendingNotifications error', e);
  }
}

export async function notifyAdminsNewSubmission(bot, phoneId) {
  try {
    const phone = await bot.db.prepare("SELECT * FROM phones WHERE id = ?1").bind(phoneId).first();
    if (!phone) return;
    const pending = await countPending(bot);
    for (const adminId of bot.adminIds) {
      await bot.sendMessage(adminId, '🆕 Nueva propuesta recibida:\n\n' + formatPhoneReview(phone, pending), {
        reply_markup: kbModeration(phone.id)
      });
    }
  } catch (e) {
    logger.error('notifyAdminsNewSubmission error', e);
  }
}

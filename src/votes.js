/* src/votes.js
 * Votos 👍/👎 por ficha de teléfono en /revisar.
 * Un voto por usuario por teléfono; votar lo mismo dos veces lo quita (toggle).
 */
import { logger } from './logger.js';

// Conteos {up, down} por id de teléfono para una página de resultados.
export async function getVoteTallies(bot, ids) {
  const map = new Map();
  if (!ids || !ids.length) return map;
  try {
    const placeholders = ids.map((_, i) => `?${i + 1}`).join(',');
    const res = await bot.db.prepare(
      `SELECT phone_id,
              SUM(CASE WHEN vote = 1 THEN 1 ELSE 0 END)  AS up,
              SUM(CASE WHEN vote = -1 THEN 1 ELSE 0 END) AS down
       FROM phone_votes WHERE phone_id IN (${placeholders}) GROUP BY phone_id`
    ).bind(...ids).all();
    for (const r of res.results || []) {
      map.set(Number(r.phone_id), { up: Number(r.up) || 0, down: Number(r.down) || 0 });
    }
  } catch (e) {
    // tabla ausente (migración sin aplicar): se muestran las fichas sin conteos
    logger.warn('getVoteTallies sin datos', { error: String(e) });
  }
  return map;
}

// Registra/cambia/quita un voto y devuelve un mensaje corto para el toast.
// data: "vt:<u|d>:<phoneId>:<offset>:<query>"
export async function handleVoteCallback(bot, { id, data, msg, chatId, userId }) {
  const parts = data.split(':');
  const dir = parts[1];                 // 'u' | 'd' | 'i' (etiqueta, no vota)
  const phoneId = Number(parts[2]) || 0;

  if (dir === 'i') {
    await bot.answerCallbackQuery(id, { text: '👍 funcionó · 👎 no funcionó — según tu experiencia' });
    return;
  }

  const offset = Number(parts[3]) || 0;
  const query = parts.slice(4).join(':');
  const vote = dir === 'u' ? 1 : -1;

  let toast = '¡Gracias por tu voto!';
  try {
    const existing = await bot.db.prepare(
      'SELECT vote FROM phone_votes WHERE phone_id = ?1 AND tg_id = ?2'
    ).bind(phoneId, userId).first();

    if (existing && existing.vote === vote) {
      // mismo voto de nuevo -> se quita
      await bot.db.prepare('DELETE FROM phone_votes WHERE phone_id = ?1 AND tg_id = ?2')
        .bind(phoneId, userId).run();
      toast = 'Quité tu voto.';
    } else {
      await bot.db.prepare(
        `INSERT INTO phone_votes (phone_id, tg_id, vote, created_at) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(phone_id, tg_id) DO UPDATE SET vote = excluded.vote, created_at = excluded.created_at`
      ).bind(phoneId, userId, vote, new Date().toISOString()).run();
      toast = vote === 1 ? '👍 ¡Registrado! Gracias.' : '👎 Registrado. Gracias.';
    }
  } catch (e) {
    logger.error('handleVoteCallback error', e, { userId });
    await bot.answerCallbackQuery(id, { text: 'No pude guardar el voto 😅' });
    return;
  }

  await bot.answerCallbackQuery(id, { text: toast });
  // Re-render de la misma página para actualizar los conteos
  if (query) {
    const { searchByModel } = await import('./search.js');
    await searchByModel(bot, chatId, query, offset, msg?.message_id);
  }
}

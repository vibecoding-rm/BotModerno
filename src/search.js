/* src/search.js
 * /revisar: búsqueda por nombre/modelo (case/acentos-insensible) con paginación.
 */
import { logger } from './logger.js';
import { normalizeText, parsePhoneRow, formatSearchResults } from './format.js';

const PAGE = 6;

export async function searchByModel(bot, chatId, query, offset = 0, editMessageId = null) {
  try {
    const q = normalizeText(query);
    const like = '%' + q + '%';

    const countRow = await bot.db.prepare(
      "SELECT COUNT(*) AS n FROM phones WHERE status = 'approved' AND (nombre_comercial LIKE ?1 OR model LIKE ?1)"
    ).bind(like).first();
    const total = countRow?.n || 0;

    if (!total) {
      await bot.sendMessage(chatId, 'No encontramos ese modelo. ¿Quieres usar /subir para proponerlo?');
      return;
    }

    const res = await bot.db.prepare(
      "SELECT id, commercial_name, model, works, bands, provinces, observations FROM phones WHERE status = 'approved' AND (nombre_comercial LIKE ?1 OR model LIKE ?1) ORDER BY commercial_name LIMIT ?2 OFFSET ?3"
    ).bind(like, PAGE, offset).all();

    const matches = (res.results || []).map(parsePhoneRow);
    const msgText = formatSearchResults(query, matches, offset, total);

    // Botones de paginación (callback data máx 64 BYTES: recortar query en UTF-8)
    let qShort = query;
    const enc = new TextEncoder();
    while (qShort && enc.encode(`pg:${offset + PAGE}:${qShort}`).length > 64) {
      qShort = qShort.slice(0, -1);
    }
    const to = offset + matches.length;
    const navRow = [];
    if (offset > 0) navRow.push({ text: '◀ Anterior', callback_data: `pg:${Math.max(0, offset - PAGE)}:${qShort}` });
    if (to < total) navRow.push({ text: 'Siguiente ▶', callback_data: `pg:${offset + PAGE}:${qShort}` });
    const kb = navRow.length ? { inline_keyboard: [navRow] } : undefined;

    if (editMessageId) {
      await bot.editMessageText(chatId, editMessageId, msgText, { reply_markup: kb, parse_mode: 'HTML' });
    } else {
      await bot.sendMessage(chatId, msgText, { reply_markup: kb, parse_mode: 'HTML' });
    }
  } catch (e) {
    logger.error('searchByModel error', e, { chatId });
    await bot.sendMessage(chatId, 'Se enredó la cosa 😅. Intenta de nuevo o /cancelar.');
  }
}

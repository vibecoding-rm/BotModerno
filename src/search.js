/* src/search.js
 * /revisar: búsqueda por nombre/modelo con paginación.
 * Primero FTS5 (palabras con prefijo: "samsun galax" encuentra "Samsung Galaxy…");
 * si no hay resultados o el índice falla, cae al LIKE por subcadena de siempre.
 */
import { logger } from './logger.js';
import { normalizeText, buildFtsQuery, parsePhoneRow, formatSearchResults } from './format.js';

const PAGE = 6;

async function ftsSearch(bot, query, offset) {
  const match = buildFtsQuery(query);
  if (!match) return null;
  try {
    const countRow = await bot.db.prepare(
      "SELECT COUNT(*) AS n FROM phones_fts f JOIN phones p ON p.id = f.rowid WHERE phones_fts MATCH ?1 AND p.status = 'approved'"
    ).bind(match).first();
    const total = countRow?.n || 0;
    if (!total) return null;
    const res = await bot.db.prepare(
      "SELECT p.id, p.commercial_name, p.model, p.works, p.bands, p.provinces, p.observations FROM phones_fts f JOIN phones p ON p.id = f.rowid WHERE phones_fts MATCH ?1 AND p.status = 'approved' ORDER BY p.commercial_name LIMIT ?2 OFFSET ?3"
    ).bind(match, PAGE, offset).all();
    return { total, rows: res.results || [] };
  } catch (e) {
    // Índice ausente o sintaxis MATCH inválida: se usa el LIKE de siempre
    logger.warn('ftsSearch fallback a LIKE', { error: String(e) });
    return null;
  }
}

async function likeSearch(bot, query, offset) {
  const like = '%' + normalizeText(query) + '%';
  const countRow = await bot.db.prepare(
    "SELECT COUNT(*) AS n FROM phones WHERE status = 'approved' AND (nombre_comercial LIKE ?1 OR model LIKE ?1)"
  ).bind(like).first();
  const total = countRow?.n || 0;
  if (!total) return { total: 0, rows: [] };
  const res = await bot.db.prepare(
    "SELECT id, commercial_name, model, works, bands, provinces, observations FROM phones WHERE status = 'approved' AND (nombre_comercial LIKE ?1 OR model LIKE ?1) ORDER BY commercial_name LIMIT ?2 OFFSET ?3"
  ).bind(like, PAGE, offset).all();
  return { total, rows: res.results || [] };
}

export async function searchByModel(bot, chatId, query, offset = 0, editMessageId = null) {
  try {
    const found = (await ftsSearch(bot, query, offset)) || (await likeSearch(bot, query, offset));
    const { total, rows } = found;

    if (!total) {
      await bot.sendMessage(chatId, 'No encontramos ese modelo. ¿Quieres usar /subir para proponerlo?');
      return;
    }

    const matches = rows.map(parsePhoneRow);
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

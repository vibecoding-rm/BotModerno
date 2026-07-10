/* src/search.js
 * /revisar: búsqueda por nombre/modelo con paginación.
 * Primero FTS5 (palabras con prefijo: "samsun galax" encuentra "Samsung Galaxy…");
 * si no hay resultados o el índice falla, cae al LIKE por subcadena de siempre.
 */
import { logger } from './logger.js';
import { normalizeText, buildFtsQuery, parsePhoneRow, formatSearchResults, escapeHtml } from './format.js';
import { getVoteTallies } from './votes.js';

const PAGE = 6;

// Recorta un texto para caber en callback_data (límite 64 BYTES en UTF-8).
function fitCallbackQuery(prefix, query) {
  const enc = new TextEncoder();
  let q = query;
  while (q && enc.encode(prefix + q).length > 64) q = q.slice(0, -1);
  return q;
}

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
      await bot.sendMessage(chatId,
        `🔎 No encontramos nada para «${escapeHtml(query)}».\n\n` +
        '💡 Prueba con menos letras (solo la marca o el código del modelo).\n' +
        '📲 ¿Lo tienes en la mano? Proponlo con /subir y ayuda a la comunidad.');
      return;
    }

    const matches = rows.map(parsePhoneRow);

    // Conteo de votos 👍/👎 de esta página, adjuntado a cada ficha
    const tallies = await getVoteTallies(bot, matches.map(m => m.id));
    for (const m of matches) {
      const t = tallies.get(Number(m.id));
      m.up = t?.up || 0;
      m.down = t?.down || 0;
    }

    const msgText = formatSearchResults(query, matches, offset, total);

    // callback_data ≤ 64 BYTES: recortar query en UTF-8 (el id/offset más largos van en el prefijo)
    const maxId = Math.max(0, ...matches.map(m => Number(m.id) || 0));
    const qShort = fitCallbackQuery(`vt:d:${maxId}:${offset}:`, query);

    // Una fila de votos por ficha: [nombre] [👍 N] [👎 M]
    const rowsKb = matches.map(m => {
      const name = (m.commercial_name || m.model || '').slice(0, 24) || 'Ficha';
      return [
        { text: `📱 ${name}`, callback_data: `vt:i:${m.id}` },
        { text: `👍 ${m.up}`, callback_data: `vt:u:${m.id}:${offset}:${qShort}` },
        { text: `👎 ${m.down}`, callback_data: `vt:d:${m.id}:${offset}:${qShort}` },
      ];
    });

    // Fila de paginación
    const to = offset + matches.length;
    const navRow = [];
    if (offset > 0) navRow.push({ text: '◀ Anterior', callback_data: `pg:${Math.max(0, offset - PAGE)}:${qShort}` });
    if (to < total) navRow.push({ text: 'Siguiente ▶', callback_data: `pg:${offset + PAGE}:${qShort}` });
    if (navRow.length) rowsKb.push(navRow);
    const kb = rowsKb.length ? { inline_keyboard: rowsKb } : undefined;

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

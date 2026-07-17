/* src/search.js
 * /revisar: búsqueda por nombre/modelo con paginación.
 * Primero FTS5 (palabras con prefijo: "samsun galax" encuentra "Samsung Galaxy…");
 * si no hay resultados o el índice falla, cae al LIKE por subcadena de siempre.
 */
import { logger } from './logger.js';
import { normalizeText, buildFtsQuery, parsePhoneRow, formatSearchResults, formatPhoneDetail, formatBandEstimates, formatTop, normDeviceName, cubaBandVerdict, escapeHtml } from './format.js';
import { getVoteTallies } from './votes.js';

// Cruza el nombre del teléfono con device_bands (dataset GSMArena) para el
// veredicto Cuba estimado. Devuelve {bands_2g, bands_3g, bands_4g} o null.
// Best-effort: si la tabla no existe / está vacía, no rompe nada.
export async function lookupBands(bot, name) {
  const nn = normDeviceName(name);
  if (!nn) return null;
  try {
    let row = await bot.db.prepare('SELECT bands_2g, bands_3g, bands_4g FROM device_bands WHERE norm_name = ?1 LIMIT 1').bind(nn).first();
    if (!row) {
      row = await bot.db.prepare('SELECT bands_2g, bands_3g, bands_4g FROM device_bands WHERE norm_name LIKE ?1 LIMIT 1').bind('%' + nn + '%').first();
    }
    return row || null;
  } catch {
    return null; // device_bands ausente todavía
  }
}

// Fallback de /revisar: cuando la comunidad no tiene el modelo, busca en
// device_bands y muestra el estimado por bandas. Devuelve true si mostró algo.
async function bandsFallback(bot, chatId, query) {
  const nn = normDeviceName(query);
  if (!nn) return false;
  try {
    const res = await bot.db.prepare(
      'SELECT oem, model, bands_2g, bands_3g, bands_4g FROM device_bands WHERE norm_name LIKE ?1 GROUP BY norm_name ORDER BY LENGTH(norm_name) LIMIT 20'
    ).bind('%' + nn + '%').all();
    const rows = res.results || [];
    if (!rows.length) return false;
    await bot.sendMessage(chatId, formatBandEstimates(query, rows));
    return true;
  } catch {
    return false; // device_bands ausente todavía
  }
}

const PAGE = 6;

// Extrae un filtro de provincia del query del usuario:
//   "samsung a14 en habana"  → { modelQuery: "samsung a14", province: "habana" }
//   "samsung a14"            → { modelQuery: "samsung a14", province: null }
// También acepta el formato codificado de paginación "samsung a14|habana".
function parseRevisionQuery(rawQuery) {
  const pipeIdx = rawQuery.lastIndexOf('|');
  if (pipeIdx > 0) {
    const modelQuery = rawQuery.slice(0, pipeIdx).trim();
    const province = rawQuery.slice(pipeIdx + 1).trim();
    if (modelQuery && province) return { modelQuery, province };
  }
  const m = rawQuery.match(/^(.+?)\s+en\s+(.+)$/i);
  if (m) return { modelQuery: m[1].trim(), province: m[2].trim() };
  return { modelQuery: rawQuery, province: null };
}

// /top: los 10 teléfonos con más votos positivos entre los confirmados funcionando.
export async function showTopPhones(bot, chatId) {
  try {
    const res = await bot.db.prepare(`
      SELECT p.id, p.commercial_name, p.model, p.works,
             SUM(CASE WHEN v.vote = 1 THEN 1 ELSE 0 END) AS up
      FROM phones p
      LEFT JOIN phone_votes v ON v.phone_id = p.id
      WHERE p.status = 'approved' AND p.works = 1
      GROUP BY p.id
      ORDER BY up DESC, p.commercial_name ASC
      LIMIT 15
    `).all();
    await bot.sendMessage(chatId, formatTop(res.results || []), { parse_mode: 'HTML' });
  } catch (e) {
    logger.error('showTopPhones error', e, { chatId });
    await bot.sendMessage(chatId, 'Se enredó la cosa 😅. Intenta de nuevo.');
  }
}

// /marca: lista todos los teléfonos cuyo nombre empieza por la marca dada.
export async function searchByBrand(bot, chatId, brand) {
  try {
    const like = normalizeText(brand) + '%';
    const countRow = await bot.db.prepare(
      "SELECT COUNT(*) AS n FROM phones WHERE status = 'approved' AND nombre_comercial LIKE ?1"
    ).bind(like).first();
    const total = countRow?.n || 0;
    if (!total) {
      await bot.sendMessage(chatId,
        `📭 No hay teléfonos de la marca «${escapeHtml(brand)}» en la base todavía.\n` +
        `📲 ¿Tienes uno? Repórtalo con /subir.`);
      return;
    }
    const res = await bot.db.prepare(
      "SELECT id, commercial_name, model, works, bands, provinces, observations FROM phones WHERE status = 'approved' AND nombre_comercial LIKE ?1 ORDER BY commercial_name LIMIT ?2"
    ).bind(like, PAGE).all();
    const matches = (res.results || []).map(parsePhoneRow);
    const tallies = await getVoteTallies(bot, matches.map(m => m.id));
    for (const m of matches) { const t = tallies.get(Number(m.id)); m.up = t?.up || 0; m.down = t?.down || 0; }
    const maxId = Math.max(0, ...matches.map(m => Number(m.id) || 0));
    const qShort = fitCallbackQuery(`vt:d:${maxId}:0:`, brand);
    const rowsKb = matches.map(m => {
      const name = (m.commercial_name || m.model || 'Ficha').slice(0, 48);
      const mark = m.works === true ? '✅' : (m.works === false ? '❌' : '❓');
      return [{ text: `${mark} ${name}`, callback_data: `ph:${m.id}:0:${qShort}` }];
    });
    if (total > PAGE) rowsKb.push([{ text: `Siguiente ▶`, callback_data: `pg:${PAGE}:${qShort}` }]);
    const kb = rowsKb.length ? { inline_keyboard: rowsKb } : undefined;
    const from = 1, to = matches.length;
    const header = `🔎 Marca «${escapeHtml(brand)}» · ${from}–${to} de ${total}\n\n`;
    const blocks = matches.map(m => {
      const w = m.works === true ? '✅' : (m.works === false ? '❌' : '❓');
      const showModel = m.model && m.model.toUpperCase() !== (m.commercial_name || '').trim().toUpperCase();
      let head = `${w} <b>${escapeHtml(m.commercial_name)}</b>`;
      if (showModel) head += ` (${escapeHtml(m.model)})`;
      return head;
    });
    await bot.sendMessage(chatId, header + blocks.join('\n'), { reply_markup: kb, parse_mode: 'HTML' });
  } catch (e) {
    logger.error('searchByBrand error', e, { chatId });
    await bot.sendMessage(chatId, 'Se enredó la cosa 😅. Intenta de nuevo.');
  }
}

// Recorta un texto para caber en callback_data (límite 64 BYTES en UTF-8).
function fitCallbackQuery(prefix, query) {
  const enc = new TextEncoder();
  let q = query;
  while (q && enc.encode(prefix + q).length > 64) q = q.slice(0, -1);
  return q;
}

async function ftsSearch(bot, query, offset, province) {
  const match = buildFtsQuery(query);
  if (!match) return null;
  try {
    let countRow, res;
    if (province) {
      const plike = '%' + province + '%';
      countRow = await bot.db.prepare(
        "SELECT COUNT(*) AS n FROM phones_fts f JOIN phones p ON p.id = f.rowid WHERE phones_fts MATCH ?1 AND p.status = 'approved' AND p.provinces LIKE ?2"
      ).bind(match, plike).first();
      const total = countRow?.n || 0;
      if (!total) return null;
      res = await bot.db.prepare(
        "SELECT p.id, p.commercial_name, p.model, p.works, p.bands, p.provinces, p.observations FROM phones_fts f JOIN phones p ON p.id = f.rowid WHERE phones_fts MATCH ?1 AND p.status = 'approved' AND p.provinces LIKE ?2 ORDER BY p.commercial_name LIMIT ?3 OFFSET ?4"
      ).bind(match, plike, PAGE, offset).all();
      return { total, rows: res.results || [] };
    }
    countRow = await bot.db.prepare(
      "SELECT COUNT(*) AS n FROM phones_fts f JOIN phones p ON p.id = f.rowid WHERE phones_fts MATCH ?1 AND p.status = 'approved'"
    ).bind(match).first();
    const total = countRow?.n || 0;
    if (!total) return null;
    res = await bot.db.prepare(
      "SELECT p.id, p.commercial_name, p.model, p.works, p.bands, p.provinces, p.observations FROM phones_fts f JOIN phones p ON p.id = f.rowid WHERE phones_fts MATCH ?1 AND p.status = 'approved' ORDER BY p.commercial_name LIMIT ?2 OFFSET ?3"
    ).bind(match, PAGE, offset).all();
    return { total, rows: res.results || [] };
  } catch (e) {
    // Índice ausente o sintaxis MATCH inválida: se usa el LIKE de siempre
    logger.warn('ftsSearch fallback a LIKE', { error: String(e) });
    return null;
  }
}

async function likeSearch(bot, query, offset, province) {
  const like = '%' + normalizeText(query) + '%';
  if (province) {
    const plike = '%' + province + '%';
    const countRow = await bot.db.prepare(
      "SELECT COUNT(*) AS n FROM phones WHERE status = 'approved' AND (nombre_comercial LIKE ?1 OR model LIKE ?1) AND provinces LIKE ?2"
    ).bind(like, plike).first();
    const total = countRow?.n || 0;
    if (!total) return { total: 0, rows: [] };
    const res = await bot.db.prepare(
      "SELECT id, commercial_name, model, works, bands, provinces, observations FROM phones WHERE status = 'approved' AND (nombre_comercial LIKE ?1 OR model LIKE ?1) AND provinces LIKE ?2 ORDER BY commercial_name LIMIT ?3 OFFSET ?4"
    ).bind(like, plike, PAGE, offset).all();
    return { total, rows: res.results || [] };
  }
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

export async function searchByModel(bot, chatId, rawQuery, offset = 0, editMessageId = null) {
  const { modelQuery: query, province } = parseRevisionQuery(rawQuery);
  try {
    const found = (await ftsSearch(bot, query, offset, province)) || (await likeSearch(bot, query, offset, province));
    const { total, rows } = found;

    if (!total) {
      // Sin reporte de la comunidad: intentar el estimado por bandas (device_bands)
      const shown = await bandsFallback(bot, chatId, query);
      if (!shown) {
        await bot.sendMessage(chatId,
          `🔎 No encontramos nada para «${escapeHtml(query)}».\n\n` +
          '💡 Prueba con menos letras (solo la marca o el código del modelo).\n' +
          '📲 ¿Lo tienes en la mano? Proponlo con /subir y ayuda a la comunidad.');
      }
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

    const msgText = formatSearchResults(query, matches, offset, total, { province });

    // callback_data ≤ 64 BYTES: recortar rawQuery en UTF-8 (preserva el filtro de provincia)
    const maxId = Math.max(0, ...matches.map(m => Number(m.id) || 0));
    // Encode province in rawQuery as "modelQuery|province" so pagination preserves the filter
    const navQuery = province ? `${query}|${province}` : rawQuery;
    const qShort = fitCallbackQuery(`vt:d:${maxId}:${offset}:`, navQuery);

    // Un botón por ficha con el nombre COMPLETO: abre la vista de detalle (con votos)
    const rowsKb = matches.map(m => {
      const name = (m.commercial_name || m.model || 'Ficha').slice(0, 48);
      const mark = m.works === true ? '✅' : (m.works === false ? '❌' : '❓');
      return [{ text: `${mark} ${name}`, callback_data: `ph:${m.id}:${offset}:${qShort}` }];
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

// Vista de detalle de un teléfono: nombre completo + datos + votos 👍/👎 + volver.
// offset/query se conservan para poder regresar a la misma página de resultados.
export async function showPhoneDetail(bot, chatId, phoneId, offset, query, editMessageId = null) {
  try {
    const r = await bot.db.prepare(
      "SELECT id, commercial_name, model, works, bands, provinces, observations FROM phones WHERE id = ?1 AND status = 'approved'"
    ).bind(phoneId).first();
    if (!r) {
      await bot.sendMessage(chatId, 'Esa ficha ya no está disponible.');
      return;
    }
    const phone = parsePhoneRow(r);
    const tally = (await getVoteTallies(bot, [phoneId])).get(Number(phoneId)) || { up: 0, down: 0 };
    // Si la comunidad ya confirmó/negó (works true/false), eso manda y no
    // mostramos el estimado por bandas para no contradecir. Solo estimamos
    // cuando la compatibilidad está sin confirmar (works === null).
    const bandVerdict = phone.works === null
      ? cubaBandVerdict(await lookupBands(bot, phone.commercial_name))
      : null;
    const text = formatPhoneDetail(phone, tally, bandVerdict);

    const qShort = fitCallbackQuery(`vt:d:${phoneId}:${offset}:`, query);
    const kb = { inline_keyboard: [
      [
        { text: `👍 ${tally.up || 0}`, callback_data: `vt:u:${phoneId}:${offset}:${qShort}`, style: 'success' },
        { text: `👎 ${tally.down || 0}`, callback_data: `vt:d:${phoneId}:${offset}:${qShort}`, style: 'danger' },
      ],
      [{ text: '⬅ Volver a los resultados', callback_data: `pg:${offset}:${qShort}` }],
    ] };

    if (editMessageId) {
      await bot.editMessageText(chatId, editMessageId, text, { reply_markup: kb, parse_mode: 'HTML' });
    } else {
      await bot.sendMessage(chatId, text, { reply_markup: kb, parse_mode: 'HTML' });
    }
  } catch (e) {
    logger.error('showPhoneDetail error', e, { chatId });
    await bot.sendMessage(chatId, 'Se enredó la cosa 😅. Intenta de nuevo.');
  }
}

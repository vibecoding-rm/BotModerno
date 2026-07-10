/* src/imei.js
 * /imei: identifica un teléfono por su IMEI usando la tabla tacs
 * (Osmocom TAC database, CC BY-SA 3.0) y lo cruza con la base comunitaria.
 */
import { logger } from './logger.js';
import { escapeHtml, buildFtsQuery, cubaBandVerdict } from './format.js';
import { lookupBands } from './search.js';

// Solo dígitos; un IMEI usable tiene 14-16 dígitos (15 es el estándar)
export function normalizeImei(text) {
  const digits = (text || '').replace(/\D/g, '');
  if (digits.length < 14 || digits.length > 16) return null;
  return digits;
}

// Luhn sobre el IMEI de 15 dígitos (el 15º es el dígito de control).
// Devuelve null si no es comprobable (14 o 16 dígitos).
export function luhnValidImei(imei) {
  if (imei.length !== 15) return null;
  let sum = 0;
  for (let i = 0; i < 15; i++) {
    let d = imei.charCodeAt(i) - 48;
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

// Fallback: consulta imeicheck.com (key personal, 60 req/min) cuando el TAC no
// está en la base local. Devuelve {brand, model, aka} con la misma semántica que
// la tabla tacs (brand=fabricante, model=nombre comercial, aka=código) o null.
export async function fetchImeiFallback(key, imei) {
  if (!key) return null;
  const url = `https://alpha.imeicheck.com/api/free_with_key/modelBrandName?key=${encodeURIComponent(key)}&imei=${encodeURIComponent(imei)}&format=json`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 5000);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'CubaModelBot/1.0' } });
    if (!res.ok) return null;
    const data = await res.json();
    const o = data && data.object;
    // status llega como "succes" (sic); nos basta con que haya marca en el objeto
    if (!o || !o.brand) return null;
    const brand = String(o.brand).trim();
    const name = String(o.name || '').trim();   // nombre comercial
    const code = String(o.model || '').trim();  // código del fabricante
    if (!brand && !name && !code) return null;
    return {
      brand: brand || '—',
      model: name || code || '—',
      aka: name && code ? code : '',
    };
  } catch {
    return null; // timeout / red / JSON inválido: /imei sigue con lo que tenga
  } finally {
    clearTimeout(timer);
  }
}

export async function handleImei(bot, chatId, argStr) {
  try {
    if (!argStr) {
      await bot.sendMessage(chatId,
        '📱 <b>Identificar teléfono por IMEI</b>\n\n' +
        'Formato: /imei &lt;número&gt;\n' +
        'Ejemplo: /imei 356759041234563\n\n' +
        '💡 Marca <code>*#06#</code> en el teléfono para ver su IMEI.\n' +
        '🔒 Solo usamos los primeros 8 dígitos (TAC): identifican el modelo, no tu equipo.');
      return;
    }

    const imei = normalizeImei(argStr);
    if (!imei) {
      await bot.sendMessage(chatId, '❌ Eso no parece un IMEI: deben ser 15 dígitos (marca <code>*#06#</code> para verlo).');
      return;
    }

    const luhn = luhnValidImei(imei);
    const tac = imei.slice(0, 8);
    let row = await bot.db.prepare('SELECT brand, model, aka FROM tacs WHERE tac = ?1').bind(tac).first();

    // Fallback a imeicheck.com si el TAC no está local: identifica el equipo y
    // cachea el resultado en tacs para no repetir la llamada (la base crece sola).
    if (!row) {
      const api = await fetchImeiFallback(bot.imeicheckKey, imei);
      if (api) {
        row = api;
        try {
          await bot.db.prepare(
            'INSERT OR IGNORE INTO tacs (tac, brand, model, aka) VALUES (?1, ?2, ?3, ?4)'
          ).bind(tac, api.brand, api.model, api.aka || null).run();
        } catch { /* el cache es best-effort; no rompe la respuesta */ }
        try {
          await bot.db.prepare(
            "INSERT INTO events (tg_id, type, payload, created_at) VALUES (NULL, 'tac_api', ?1, ?2)"
          ).bind(tac, new Date().toISOString()).run();
        } catch { /* solo telemetría */ }
      }
    }

    const lines = [];
    if (row) {
      lines.push(`📱 <b>${escapeHtml(row.brand)} ${escapeHtml(row.model)}</b>`);
      if (row.aka) lines.push(`    🏷 También conocido como: ${escapeHtml(row.aka)}`);
      lines.push(`    🔢 TAC: <code>${tac}</code>`);

      // Cruce con la base comunitaria (mismo buscador FTS de /revisar)
      const match = buildFtsQuery(`${row.brand} ${row.model}`);
      let known = 0;
      if (match) {
        try {
          const c = await bot.db.prepare(
            "SELECT COUNT(*) AS n FROM phones_fts f JOIN phones p ON p.id = f.rowid WHERE phones_fts MATCH ?1 AND p.status = 'approved'"
          ).bind(match).first();
          known = c?.n || 0;
        } catch { /* índice FTS ausente: se omite el cruce */ }
      }
      if (known > 0) {
        lines.push('');
        lines.push(`📚 La comunidad tiene <b>${known}</b> registro${known === 1 ? '' : 's'} de este modelo:`);
        lines.push(`👉 /revisar ${escapeHtml(row.model)}`);
      } else {
        lines.push('');
        lines.push('🔎 Aún no hay experiencia de la comunidad con este modelo.');
        lines.push('📲 ¿Lo probaste en Cuba? Aporta con /subir.');
      }

      // Estimado por bandas del modelo (device_bands): útil sobre todo cuando la
      // comunidad aún no lo ha reportado. Best-effort.
      const bandVerdict = cubaBandVerdict(await lookupBands(bot, `${row.brand} ${row.model}`));
      if (bandVerdict) {
        lines.push('');
        lines.push(bandVerdict.text);
      }
    } else {
      // Registrar el TAC no encontrado: sirve para curar la base con datos reales de uso
      try {
        await bot.db.prepare(
          "INSERT INTO events (tg_id, type, payload, created_at) VALUES (NULL, 'tac_miss', ?1, ?2)"
        ).bind(tac, new Date().toISOString()).run();
      } catch { /* solo telemetría */ }
      lines.push(`🤷 El TAC <code>${tac}</code> todavía no está en nuestra base.`);
      lines.push('');
      lines.push('📝 Lo anotamos para agregarlo. Mientras, busca el modelo por nombre con /revisar, o mira /bandas para saber qué debe soportar.');
    }

    if (luhn === false) {
      lines.push('');
      lines.push('⚠️ Ojo: el dígito de control no cuadra — puede que el IMEI esté mal tecleado.');
    }

    await bot.sendMessage(chatId, lines.join('\n'));
  } catch (e) {
    logger.error('handleImei error', e, { chatId });
    await bot.sendMessage(chatId, 'Se enredó la cosa 😅. Intenta de nuevo.');
  }
}

/* src/imei.js
 * /imei: identifica un teléfono por su IMEI usando la tabla tacs
 * (Osmocom TAC database, CC BY-SA 3.0) y lo cruza con la base comunitaria.
 */
import { logger } from './logger.js';
import { escapeHtml, buildFtsQuery } from './format.js';

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
    const row = await bot.db.prepare('SELECT brand, model, aka FROM tacs WHERE tac = ?1').bind(tac).first();

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
        lines.push('📲 ¿Lo probaste en Cuba? Aporta con /subir. Y revisa /bandas (la clave: LTE B3).');
      }
    } else {
      lines.push(`🤷 El TAC <code>${tac}</code> no está en nuestra base (Osmocom, ~22.500 equipos).`);
      lines.push('');
      lines.push('💡 Busca el modelo por nombre con /revisar, o mira /bandas para saber qué debe soportar.');
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

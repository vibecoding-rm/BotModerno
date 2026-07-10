/* src/format.js
 * Helpers puros de parseo y formato (sin estado ni I/O): se testean en unit tests.
 */

export function toCsvArray(envVal) {
  return (envVal || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
}

// Normalize text for case-insensitive, accent-insensitive comparisons
export function normalizeText(s) {
  return (s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip accents
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function toUpperModel(s) {
  return (s || '').trim().toUpperCase();
}

export function parseYesNo(text) {
  const t = (text || '').trim().toLowerCase();
  if (["si", "sí", "s", "yes", "y", "ok"].includes(t)) return true;
  if (["no", "n", "cancel", "cancelar"].includes(t)) return false;
  return null;
}

export function splitNormList(txt) {
  if (!txt || txt.trim() === '') return [];
  let s = String(txt);
  s = s.replace(/\r/g, ' ').replace(/\n/g, ' ');
  s = s.replace(/\|/g, ',').replace(/;/g, ',');
  const parts = s.split(/[\s,]+/).map(p => p.trim()).filter(Boolean);
  return parts;
}

export const CUBA_PROVINCES = [
  'Pinar del Río', 'Artemisa', 'La Habana', 'Mayabeque',
  'Matanzas', 'Cienfuegos', 'Villa Clara', 'Sancti Spíritus',
  'Ciego de Ávila', 'Camagüey', 'Las Tunas', 'Holguín',
  'Granma', 'Santiago de Cuba', 'Guantánamo', 'Isla de la Juventud'
];

// Provincias escritas a mano: separa solo por comas y mapea al nombre canónico
export function parseProvincesText(txt) {
  if (!txt || txt.trim() === '') return [];
  const byNorm = new Map(CUBA_PROVINCES.map(p => [normalizeText(p), p]));
  const out = [];
  for (const part of String(txt).split(/[,;|\n]+/)) {
    const norm = normalizeText(part);
    if (!norm) continue;
    const canonical = byNorm.get(norm) || part.trim();
    if (!out.includes(canonical)) out.push(canonical);
  }
  return out;
}

export function parseJsonArray(v) {
  if (typeof v === 'string') {
    try { const p = JSON.parse(v); return Array.isArray(p) ? p : []; } catch { return []; }
  }
  return Array.isArray(v) ? v : [];
}

// Fila cruda de D1 -> vista con bands/provinces como arrays y works booleano/null
export function parsePhoneRow(r) {
  return {
    ...r,
    bands: parseJsonArray(r.bands),
    provinces: parseJsonArray(r.provinces),
    works: r.works === 1 || r.works === true ? true : (r.works === 0 || r.works === false ? false : null)
  };
}

// Query FTS5 con prefijos: "samsun galax" -> '"samsun"* "galax"*' (AND implicito).
// Devuelve null si no quedan tokens utilizables.
export function buildFtsQuery(query) {
  const tokens = normalizeText(query).split(/[^a-z0-9]+/).filter(Boolean);
  if (!tokens.length) return null;
  return tokens.map(t => `"${t}"*`).join(' ');
}

export function escapeHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Normaliza un nombre de equipo igual que el import de device_bands, para cruzar
// phones.commercial_name con device_bands.norm_name.
export function normDeviceName(s) {
  return (s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Veredicto de compatibilidad Cuba ESTIMADO por bandas (no es teléfono probado).
// bandRow: fila de device_bands { bands_2g, bands_3g, bands_4g } o null.
// Devuelve { ok, level: 'ok'|'partial'|'none', short, text } o null.
// ETECSA/Cubacel: 2G GSM 900; 3G UMTS 900 (B8) y 2100 (B1); 4G LTE B3 (1800,
// principal nacional) + B1 (2100) y B28 (700) desde 2023. NO usa B7 (2600).
export function cubaBandVerdict(bandRow) {
  if (!bandRow) return null;
  const b4 = bandRow.bands_4g || '';
  if (!/\d/.test(b4)) return null; // sin números de banda 4G no estimamos
  const lte = new Set((b4.match(/\d+/g) || []).map(Number));
  const b3 = lte.has(3), b1 = lte.has(1), b28 = lte.has(28);
  const extra = [b1 && 'B1', b28 && 'B28'].filter(Boolean).join('/');
  const gsm900 = /\b900\b/.test(bandRow.bands_2g || '');
  const umts = /\b900\b|\b2100\b/.test(bandRow.bands_3g || '');
  const disclaimer = '⚠️ <i>Estimado por sus bandas — NO probado por la comunidad.</i>';

  if (b3) {
    const t = '📶 <b>Compatible con el 4G de Cuba</b> (estimado): trae <b>LTE B3</b> (1800 MHz), la banda principal de ETECSA'
      + (extra ? `, y también ${extra}.` : '.');
    return { ok: true, level: 'ok', short: `📶 Compatible: LTE B3${extra ? ' + ' + extra : ''}`, text: `${t}\n${disclaimer}` };
  }
  if (b1 || b28) {
    return {
      ok: false, level: 'partial', short: `🟡 4G parcial: ${extra}, sin B3`,
      text: `🟡 <b>4G parcial en Cuba</b> (estimado): le falta la <b>B3</b> (1800 MHz, la principal), pero trae ${extra}, que ETECSA usa solo en algunas zonas.\n${disclaimer}`,
    };
  }
  const calls = gsm900 || umts ? ' Podría servir para llamadas y datos 2G/3G.' : '';
  return {
    ok: false, level: 'none', short: '📵 Sin bandas 4G de ETECSA',
    text: `📵 <b>Probablemente sin 4G en Cuba</b> (estimado): no trae ninguna banda LTE de ETECSA (B3/B1/B28).${calls}\n${disclaimer}`,
  };
}

// Lista de estimados por bandas para modelos que la comunidad NO ha reportado
// (fallback de /revisar cruzando con device_bands). rows: filas de device_bands.
export function formatBandEstimates(query, rows) {
  const blocks = rows.map(r => {
    const v = cubaBandVerdict(r);
    const name = `${r.oem || ''} ${r.model || ''}`.trim();
    let line = `📱 <b>${escapeHtml(name)}</b>`;
    if (v) line += `\n    ${v.short}`;
    return line;
  });
  return `🔎 Nadie de la comunidad ha reportado «${escapeHtml(query)}» todavía.\n\n` +
    '📊 <b>Estimado por las bandas del equipo</b> (no es un teléfono probado en Cuba):\n\n' +
    blocks.join('\n\n') +
    '\n\n⚠️ Es un cálculo por las specs del modelo. ¿Lo tienes en la mano? Confírmalo con /subir.';
}

// Ficha individual de un teléfono (vista de detalle con votos). Nombre completo,
// sin truncar, con todo el ancho. r ya viene de parsePhoneRow; tally = {up, down};
// bandVerdict = salida de cubaBandVerdict() o null.
export function formatPhoneDetail(r, tally = { up: 0, down: 0 }, bandVerdict = null) {
  const w = r.works === true ? '✅ Funciona en Cuba (confirmado por la comunidad)'
    : (r.works === false ? '❌ No funciona en Cuba (reporte de la comunidad)' : '❓ Compatibilidad sin confirmar por la comunidad');
  const lines = [`📱 <b>${escapeHtml(r.commercial_name)}</b>`];
  const showModel = r.model && r.model.toUpperCase() !== (r.commercial_name || '').trim().toUpperCase();
  if (showModel) lines.push(`🔩 Modelo: <code>${escapeHtml(r.model)}</code>`);
  lines.push('');
  lines.push(w);
  if (bandVerdict) {
    lines.push('');
    lines.push(bandVerdict.text);
  }
  if (r.bands && r.bands.length) lines.push(`📶 Bandas reportadas: ${escapeHtml(r.bands.join(', '))}`);
  if (r.provinces && r.provinces.length) lines.push(`📍 Provincias: ${escapeHtml(r.provinces.join(', '))}`);
  if (r.observations) {
    lines.push('');
    lines.push(`💬 ${escapeHtml(r.observations)}`);
  }
  const up = tally.up || 0, down = tally.down || 0;
  lines.push('');
  lines.push('──────────────');
  lines.push(`👍 ${up} · 👎 ${down} — ¿te sirvió esta info? Vota abajo 👇`);
  return lines.join('\n');
}

// Página de resultados de /revisar: compacto, nombre en negrita, solo campos con datos (HTML)
export function formatSearchResults(query, matches, offset, total) {
  const from = offset + 1;
  const to = offset + matches.length;
  const blocks = matches.map(r => {
    const w = r.works === true ? '✅' : (r.works === false ? '❌' : '❓');
    // Omitir el modelo cuando es idéntico al nombre (filas cuyo nombre ES el código)
    const showModel = r.model && r.model.toUpperCase() !== (r.commercial_name || '').trim().toUpperCase();
    let head = `${w} <b>${escapeHtml(r.commercial_name)}</b>`;
    if (showModel) head += ` (${escapeHtml(r.model)})`;
    const meta = [];
    if (r.bands.length) meta.push(`📶 ${escapeHtml(r.bands.join(', '))}`);
    if (r.provinces.length) meta.push(`📍 ${escapeHtml(r.provinces.join(', '))}`);
    if (r.up || r.down) meta.push(`👍 ${r.up || 0} · 👎 ${r.down || 0}`);
    const lines = [head];
    if (meta.length) lines.push(`    ${meta.join(' · ')}`);
    if (r.observations) {
      // Observaciones largas: cita colapsable nativa para no llenar la pantalla
      if (r.observations.length > 100) {
        lines.push(`<blockquote expandable>💬 ${escapeHtml(r.observations)}</blockquote>`);
      } else {
        lines.push(`    💬 ${escapeHtml(r.observations)}`);
      }
    }
    return lines.join('\n');
  });
  let legend = '✅ funciona en Cuba · ❌ no funciona';
  if (matches.some(r => r.works !== true && r.works !== false)) legend += ' · ❓ sin confirmar';
  return `🔎 Resultados para «${escapeHtml(query)}» · ${from}–${to} de ${total}\n\n` +
    blocks.join('\n\n') +
    `\n\n──────────────\n${legend}`;
}

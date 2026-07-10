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
// bandRow: fila de device_bands { bands_4g, has_b3 } o null. Devuelve {ok, text} o null.
// Clave ETECSA: LTE B3 (1800 MHz) para el 4G.
export function cubaBandVerdict(bandRow) {
  if (!bandRow) return null;
  const b4 = bandRow.bands_4g || '';
  if (!/\d/.test(b4)) return null; // sin números de banda no estimamos
  const disclaimer = '⚠️ <i>Estimado por sus bandas — NO probado por la comunidad.</i>';
  if (bandRow.has_b3) {
    return { ok: true, text: `📶 <b>Compatible por bandas</b> (estimado): trae <b>LTE B3</b> (1800 MHz), la banda principal de ETECSA.\n${disclaimer}` };
  }
  return { ok: false, text: `📵 <b>Dudoso por bandas</b> (estimado): no figura <b>LTE B3</b> (1800 MHz), la principal de ETECSA; el 4G podría no andar.\n${disclaimer}` };
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

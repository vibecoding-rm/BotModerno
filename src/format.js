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
// Devuelve { ok, level, short, text } con el desglose 4G/3G/2G, o null si no hay
// nada que evaluar. ETECSA/Cubacel: 2G GSM 900; 3G UMTS 900 (B8) y 2100 (B1);
// 4G LTE B3 (1800, principal) + B1 (2100) y B28 (700) desde 2023. NO usa B7.
export function cubaBandVerdict(bandRow) {
  if (!bandRow) return null;
  const b4 = bandRow.bands_4g || '';
  const b3g = bandRow.bands_3g || '';
  const b2g = bandRow.bands_2g || '';

  // 4G: ETECSA da 4G en Cuba HOY SOLO con B3 (1800 MHz). Sin B3 no hay 4G útil,
  // aunque el equipo traiga otras bandas LTE (B1/B28 no están desplegadas).
  const lte = new Set((b4.match(/\d+/g) || []).map(Number));
  const has4gBands = lte.size > 0;
  const mentionsLte = /lte|\b4g\b/i.test(b4);
  const b3 = lte.has(3);

  // 3G: ETECSA usa UMTS 900 y 2100
  const n3 = new Set((b3g.match(/\d+/g) || []).map(Number));
  const cuba3g = [n3.has(2100) && '2100 MHz', n3.has(900) && '900 MHz'].filter(Boolean);
  const has3G = cuba3g.length > 0;

  // 2G: ETECSA usa GSM 900
  const has2G = /\b900\b/.test(b2g);

  if (!has4gBands && !mentionsLte && !has3G && !has2G) return null; // nada que estimar

  const disclaimer = '⚠️ <i>Es un cálculo por las specs del equipo, NO lo ha probado nadie en Cuba.</i>';
  const g4 = b3 ? 'full' : has4gBands ? 'no' : mentionsLte ? 'unknown' : 'no';
  const calls = has3G || has2G;

  // Línea de internet 4G: solo SÍ si trae B3 (única banda 4G de ETECSA en Cuba)
  let l4;
  if (g4 === 'full') l4 = '✅ <b>Internet 4G: SÍ.</b> Trae la banda B3 (1800 MHz), la única que usa ETECSA para el 4G en Cuba.';
  else if (g4 === 'unknown') l4 = '⚠️ <b>Internet 4G: no seguro.</b> El equipo tiene LTE, pero no sabemos si trae la banda B3 (1800 MHz) que usa ETECSA.';
  else l4 = '❌ <b>Internet 4G: NO.</b> No trae la banda B3 (1800 MHz), la única con la que ETECSA da 4G en Cuba.';

  // Línea de llamadas / internet básico (2G y 3G)
  const cbits = [];
  if (has3G) cbits.push(`3G (${cuba3g.join(' / ')})`);
  if (has2G) cbits.push('2G (900 MHz)');
  const l23 = calls
    ? `✅ <b>Llamadas, SMS e internet básico: SÍ.</b> Soporta ${cbits.join(' y ')}.`
    : '❌ <b>Llamadas: NO.</b> No trae el 2G (900 MHz) ni el 3G de ETECSA.';

  const text = ['📶 <b>¿Funcionaría en Cuba?</b> (estimado por sus bandas)', '', l4, l23, '', disclaimer].join('\n');

  // Titular corto para la lista: la respuesta primero
  let head;
  if (g4 === 'full') head = '✅ Sí sirve';
  else if (g4 === 'unknown') head = '⚠️ Quizás (4G no confirmado)';
  else if (calls) head = '🟡 Solo llamadas y 3G (sin 4G)';
  else head = '❌ No sirve en Cuba';
  const got = [];
  if (g4 === 'full') got.push('4G');
  if (has3G) got.push('3G');
  if (has2G) got.push('2G');
  const short = got.length ? `${head} — tiene ${got.join(', ')}` : head;

  const level = g4 === 'full' ? 'ok' : (calls || g4 === 'unknown') ? 'partial' : 'none';
  return { ok: g4 === 'full', level, short, text };
}

// Lista de estimados por bandas para modelos que la comunidad NO ha reportado
// (fallback de /revisar cruzando con device_bands). rows: filas de device_bands.
export function formatBandEstimates(query, rows) {
  // Un solo modelo: desglose COMPLETO, idéntico al de /imei (coherencia).
  if (rows.length === 1) {
    const r = rows[0];
    const v = cubaBandVerdict(r);
    const name = `${r.oem || ''} ${r.model || ''}`.trim();
    return `🔎 Nadie de la comunidad ha reportado el «${escapeHtml(name)}» todavía.\n\n`
      + (v ? v.text : 'No tengo datos de bandas de este equipo.')
      + '\n\n📲 ¿Lo tienes en la mano? Confírmalo con /subir para que quede probado.';
  }

  // Varios: agrupar por veredicto y mostrar una respuesta compacta.
  // Prefiere variante "Global" o la de nombre más corto como representante.
  function pickRep(items) {
    const g = items.find(({ r }) => /global/i.test(r.model || ''));
    return g || items.reduce((a, b) => (a.r.model || '').length <= (b.r.model || '').length ? a : b);
  }

  const withV = rows.map(r => ({ r, v: cubaBandVerdict(r) }));
  const buckets = { ok: [], partial: [], none: [] };
  for (const item of withV) {
    const lv = item.v ? item.v.level : 'none';
    (buckets[lv] || buckets.none).push(item);
  }
  const total = rows.length;
  const header = `🔎 Nadie de la comunidad ha reportado «${escapeHtml(query)}» todavía.\n\n` +
    '📊 <b>Estimado por las bandas</b> (no es un teléfono probado en Cuba):';

  // Si todos dan el mismo veredicto: un solo bloque claro + nota de variantes.
  const oneBucket = [buckets.ok, buckets.partial, buckets.none].find(b => b.length === total);
  if (oneBucket) {
    const { r, v } = pickRep(oneBucket);
    const note = total > 1 ? `\n\n📋 Revisamos ${total} variantes de este modelo — todas con el mismo resultado.` : '';
    return header + '\n\n' +
      (v ? v.text : 'No tenemos datos de bandas de este equipo.') + note +
      '\n\n📲 ¿Lo tienes en la mano? Confírmalo con /subir.';
  }

  // Veredictos mixtos: desglose compacto por bucket.
  const lines = [];
  if (buckets.ok.length) {
    const { r } = pickRep(buckets.ok);
    const ex = escapeHtml(`${r.oem} ${r.model}`.trim());
    lines.push(`✅ Sí sirve: ${buckets.ok.length} variante${buckets.ok.length > 1 ? 's' : ''} — ej. ${ex}`);
  }
  if (buckets.partial.length) {
    const { r } = pickRep(buckets.partial);
    const ex = escapeHtml(`${r.oem} ${r.model}`.trim());
    lines.push(`🟡 Solo llamadas/3G: ${buckets.partial.length} variante${buckets.partial.length > 1 ? 's' : ''} — ej. ${ex}`);
  }
  if (buckets.none.length) {
    const { r } = pickRep(buckets.none);
    const ex = escapeHtml(`${r.oem} ${r.model}`.trim());
    lines.push(`❌ No sirve: ${buckets.none.length} variante${buckets.none.length > 1 ? 's' : ''} — ej. ${ex}`);
  }
  return header + ' (varía según la variante)\n\n' +
    lines.join('\n') +
    '\n\n⚠️ El resultado depende de la variante exacta que tengas. Busca el modelo preciso o mira /bandas.' +
    '\n📲 ¿Lo probaste en Cuba? Confirma con /subir.';
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

// Ranking /top — lista compacta de los más votados/confirmados
export function formatTop(rows) {
  if (!rows.length) return '📊 Todavía no hay suficientes reportes para armar un ranking. ¡Sé el primero con /subir!';
  const lines = rows.map((r, i) => {
    const w = r.works === true ? '✅' : (r.works === false ? '❌' : '❓');
    const name = escapeHtml(r.commercial_name || r.model || '—');
    const votes = r.up ? ` · 👍 ${r.up}` : '';
    return `${i + 1}. ${w} <b>${name}</b>${votes}`;
  });
  return '🏆 <b>Top teléfonos en Cuba</b>\n\nLos más confirmados por la comunidad:\n\n' +
    lines.join('\n') +
    '\n\n💡 Vota en las fichas de /revisar para actualizar este ranking.';
}

// Página de resultados de /revisar: compacto, nombre en negrita, solo campos con datos (HTML)
export function formatSearchResults(query, matches, offset, total, { province } = {}) {
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
  const provNote = province ? ` en <b>${escapeHtml(province)}</b>` : '';
  return `🔎 Resultados para «${escapeHtml(query)}»${provNote} · ${from}–${to} de ${total}\n\n` +
    blocks.join('\n\n') +
    `\n\n──────────────\n${legend}`;
}

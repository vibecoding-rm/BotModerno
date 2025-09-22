#!/usr/bin/env node
// importar_modelos_cuba.js
// Script para importar modelos de teléfonos a Supabase desde un CSV, seguro e idempotente.
// Uso: node importar_modelos_cuba.js [--dry-run] [--table=compat_models] [--path=./modelos_cuba_para_bot.csv] [--brand="Samsung"]

import fs from 'fs/promises';
import path from 'path';
import process from 'process';
import dotenv from 'dotenv';
import Papa from 'papaparse';
import pLimit from 'p-limit';
import { createClient } from '@supabase/supabase-js';

// --- Configuración y utilidades ---
const ALLOWED_BANDAS = ['2G', '3G', '4G'];
const PROVINCIAS_VALIDAS = [
  'Pinar del Río', 'Artemisa', 'La Habana', 'Mayabeque', 'Matanzas', 'Villa Clara',
  'Cienfuegos', 'Sancti Spíritus', 'Ciego de Ávila', 'Camagüey', 'Las Tunas',
  'Holguín', 'Granma', 'Santiago de Cuba', 'Guantánamo', 'Isla de la Juventud',
  'Bauta', 'Guanabacoa', 'Playa Baracoa'
];
const PROVINCIAS_MAP = {
  'Holguin': 'Holguín',
  'La Habana': 'La Habana',
  'Camaguey': 'Camagüey',
  'Santiago': 'Santiago de Cuba',
  'Villa Clara': 'Villa Clara',
  'Matanzas': 'Matanzas',
  'Bauta': 'Bauta',
  'Guanabacoa': 'Guanabacoa',
  'Playa Baracoa': 'Playa Baracoa',
  // ... puedes agregar más normalizaciones aquí
};

function normalizeProvincia(p) {
  p = p.trim();
  if (PROVINCIAS_MAP[p]) return PROVINCIAS_MAP[p];
  // Capitaliza primera letra de cada palabra
  return p.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
}

function normalizeBandas(bandas) {
  return bandas.split(',').map(b => b.trim().toUpperCase()).filter(b => b);
}

function extractTechnologies(bandasRaw) {
  const s = String(bandasRaw || '');
  const tech = new Set();
  if (/2\s*G/i.test(s)) tech.add('2G');
  if (/3\s*G/i.test(s)) tech.add('3G');
  if (/4\s*G/i.test(s)) tech.add('4G');
  if (/LTE/i.test(s)) tech.add('4G');
  if (/\bB\d{1,2}\b/i.test(s)) tech.add('4G');
  return Array.from(tech);
}

function normalizeFunciona(val) {
  if (val == null) return undefined;
  const v = String(val).trim();
  if (/^s[ií]$/i.test(v) || /^si\s*\(.*\)$/i.test(v) || /^yes$/i.test(v)) return true;
  if (/^no$/i.test(v)) return false;
  return undefined;
}

function dedupeByModelo(rows) {
  const map = new Map();
  rows.forEach((row) => {
    const key = row["Modelo"] ? String(row["Modelo"]).trim() : '';
    if (key) map.set(key, { ...row });
  });
  return Array.from(map.values());
}

function validateRow(row, idx) {
  // Solo descartar si faltan ambos
  if (!row["Nombre Comercial"] && !row["Modelo"]) {
    throw new Error(`Fila ${idx + 2}: Falta Nombre Comercial y Modelo.`);
  }
  // Si falta Nombre Comercial, usar Modelo como nombre
  if (!row["Nombre Comercial"] && row["Modelo"]) {
    row["Nombre Comercial"] = row["Modelo"];
  }
  // Si falta Modelo pero en Nombre Comercial hay un código entre paréntesis, extraerlo
  if (!row["Modelo"] && row["Nombre Comercial"]) {
    const match = row["Nombre Comercial"].match(/\(([^)]+)\)/);
    if (match) {
      row["Modelo"] = match[1];
      // Opcional: quitar el paréntesis del nombre comercial
      row["Nombre Comercial"] = row["Nombre Comercial"].replace(/\s*\([^)]+\)/, '').trim();
    }
  }
  // Si sigue faltando Modelo, usar Nombre Comercial como modelo
  if (!row["Modelo"] && row["Nombre Comercial"]) {
    row["Modelo"] = row["Nombre Comercial"];
  }
    // Normalizar bandas: extraer tecnologías 2G/3G/4G (LTE->4G, B* -> 4G)
  if (row["Bandas"]) {
    const techs = extractTechnologies(row["Bandas"]);
    row["Bandas"] = techs.filter(b => ALLOWED_BANDAS.includes(b)).join(',');
  }
  // Provincias: extraer solo provincias válidas, el resto a Observaciones
  if (row["Provincias"]) {
    const partes = row["Provincias"].split(',').map(p => p.trim());
    const provincias = [];
    let extras = [];
    for (const p of partes) {
      if (PROVINCIAS_VALIDAS.includes(normalizeProvincia(p))) {
        provincias.push(normalizeProvincia(p));
      } else if (p) {
        extras.push(p);
      }
    }
    row["Provincias"] = provincias.join(',');
    if (extras.length) {
      row["Observaciones"] = (row["Observaciones"] ? row["Observaciones"] + ' ' : '') + 'Extra provincia: ' + extras.join('; ');
    }
  }
}

function mapRow(row, worksColumn) {
  const worksVal = normalizeFunciona(row["Funciona"]);
  const obj = {
    commercial_name: row["Nombre Comercial"].trim(),
    model: row["Modelo"].trim(),
    bands: row["Bandas"] ? extractTechnologies(row["Bandas"]) : [],
    provinces: row["Provincias"] ? row["Provincias"].split(',').map(p => normalizeProvincia(p)).filter(Boolean) : [],
    observations: row["Observaciones"] ? row["Observaciones"].trim() : null
  };
  if (typeof worksVal === 'boolean' && worksColumn) obj[worksColumn] = worksVal;
  return obj;
}

async function ensureTable(supabase, tableName) {
  // No crear tabla, solo continuar (se asume que la tabla 'phones' ya existe)
  return;
}

async function detectWorksColumn(supabase, tableName) {
  const trySelect = async (col) => {
    const { error } = await supabase.from(tableName).select(col).limit(1);
    return !error;
  };
  if (await trySelect('works_in_cuba')) return 'works_in_cuba';
  if (await trySelect('works')) return 'works';
  throw new Error(`La tabla ${tableName} no tiene columnas 'works_in_cuba' ni 'works'.`);
}

async function main() {
  // --- Parsear argumentos ---
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const tableArg = args.find(a => a.startsWith('--table='));
  const pathArg = args.find(a => a.startsWith('--path='));
  const brandArg = args.find(a => a.startsWith('--brand='));
  const tableName = tableArg ? tableArg.split('=')[1] : 'phones';
  const csvPath = pathArg ? pathArg.split('=')[1] : './modelos_cuba_para_bot.csv';
  const brandFilter = brandArg ? brandArg.split('=')[1].toLowerCase() : null;

  // --- Cargar .env ---
  dotenv.config();
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE || process.env.SUPABASE_ANON_KEY;
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('Faltan variables de entorno SUPABASE_URL y/o SUPABASE_SERVICE_ROLE/SUPABASE_ANON_KEY.');
    console.error('Ejemplo de .env:');
    console.error('SUPABASE_URL=https://xxxx.supabase.co\nSUPABASE_SERVICE_ROLE=ey...');
    process.exit(2);
  }
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

  // --- Leer y parsear CSV ---
  let csvRaw;
  try {
    csvRaw = await fs.readFile(csvPath, 'utf8');
  } catch (e) {
    console.error(`No se pudo leer el archivo CSV: ${csvPath}`);
    process.exit(1);
  }
  const parsed = Papa.parse(csvRaw, { header: true, skipEmptyLines: true });
  if (parsed.errors.length) {
    parsed.errors.forEach(e => console.error('Error parseando CSV:', e));
    process.exit(1);
  }
  let rows = parsed.data.map((row, idx) => ({ ...row, _csvLine: idx + 2 }));
  if (brandFilter) {
    rows = rows.filter(r => r["Nombre Comercial"] && r["Nombre Comercial"].toLowerCase().includes(brandFilter));
  }

  // --- Validar y normalizar ---
  let validRows = [];
  let invalidRows = [];
  for (let i = 0; i < rows.length; ++i) {
    try {
      validateRow(rows[i], i);
      validRows.push(rows[i]);
    } catch (e) {
      invalidRows.push({ line: i + 2, error: e.message });
    }
  }
  // Dedupe por modelo (última ocurrencia)
  const deduped = dedupeByModelo(validRows);
  const dedupedCount = validRows.length - deduped.length;
  const worksColumn = await detectWorksColumn(supabase, tableName);
  const mapped = deduped.map(r => mapRow(r, worksColumn));

  // --- Dry run ---
  if (dryRun) {
    console.log('--- DRY RUN ---');
    console.log(`Total filas válidas: ${validRows.length}`);
    console.log(`Total inválidas: ${invalidRows.length}`);
    if (invalidRows.length) {
      invalidRows.slice(0, 10).forEach(r => console.log(`Línea ${r.line}: ${r.error}`));
    }
    console.log(`Duplicados internos removidos por modelo: ${dedupedCount}`);
    console.log('Primeras 10 operaciones de upsert que se harían:');
    mapped.slice(0, 10).forEach((row, i) => {
      const worksStr = typeof row[worksColumn] === 'boolean' ? row[worksColumn] : '(default)';
      console.log(`#${i + 1}: upsert model="${row.model}" commercial_name="${row.commercial_name}" ${worksColumn}=${worksStr} bands=[${(row.bands || []).join(', ')}] provinces=[${(row.provinces || []).join(', ')}] observations="${row.observations || ''}"`);
    });
    process.exit(0);
  }

  // --- Real run ---
  try {
    await ensureTable(supabase, tableName);
  } catch (e) {
    console.error('Error asegurando tabla:', e.message);
    process.exit(2);
  }

  // --- Upsert en lotes (manual: insert/update por 'model') ---
  const BATCH_SIZE = 500;
  let total = 0;
  let errors = 0;
  for (let i = 0; i < mapped.length; i += BATCH_SIZE) {
    const chunk = mapped.slice(i, i + BATCH_SIZE);
    try {
      const models = chunk.map(r => r.model).filter(Boolean);
      const { data: existing, error: selErr } = await supabase.from(tableName).select('id, model').in('model', models);
      if (selErr) throw selErr;
      const existingSet = new Set((existing || []).map(r => r.model));
      const toInsert = chunk.filter(r => !existingSet.has(r.model));
      const toUpdate = chunk.filter(r => existingSet.has(r.model));

      if (toInsert.length) {
        let retries = 0;
        while (retries < 5) {
          const { error: insErr } = await supabase.from(tableName).insert(toInsert);
          if (!insErr) break;
          if (insErr.message && /timeout|network|temporar/i.test(insErr.message)) {
            await new Promise(res => setTimeout(res, 1000 * Math.pow(2, retries)));
            retries++;
          } else {
            throw insErr;
          }
        }
        total += toInsert.length;
      }

      for (const row of toUpdate) {
        let retries = 0;
        while (retries < 5) {
          const patch = { ...row };
          const { error: updErr } = await supabase.from(tableName).update(patch).eq('model', row.model);
          if (!updErr) break;
          if (updErr.message && /timeout|network|temporar/i.test(updErr.message)) {
            await new Promise(res => setTimeout(res, 1000 * Math.pow(2, retries)));
            retries++;
          } else {
            throw updErr;
          }
        }
        total += 1;
      }
    } catch (e) {
      console.error('Error en upsert:', e.message);
      errors++;
    }
  }
  console.log(`Importación finalizada. Total procesados: ${total}. Errores: ${errors}.`);
  process.exit(errors ? 3 : 0);
}

main().catch(e => {
  console.error('Error fatal:', e.message);
  process.exit(1);
});

// --- Fin del script ---

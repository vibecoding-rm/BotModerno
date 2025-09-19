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

function normalizeFunciona(val) {
  if (/^sí$/i.test(val) || /^si$/i.test(val)) return true;
  if (/^no$/i.test(val)) return false;
  throw new Error(`Valor de 'Funciona' inválido: ${val}`);
}

function dedupeByModelo(rows) {
  const map = new Map();
  rows.forEach((row, idx) => {
    if (row.modelo) map.set(row.modelo, { ...row, _csvLine: row._csvLine });
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
  // Validar Funciona
  if (!/^sí$|^si$|^no$/i.test(row["Funciona"])) {
    throw new Error(`Fila ${idx + 2}: 'Funciona' debe ser 'Sí', 'Si' o 'No'.`);
  }
  // Normalizar bandas: quitar espacios raros, LTE → 4G
  if (row["Bandas"]) {
    row["Bandas"] = row["Bandas"].replace(/LTE/gi, '4G').replace(/\s*,\s*/g, ',').replace(/\s+/g, '').replace(/,+/g, ',');
    const bandasArr = normalizeBandas(row["Bandas"]);
    row["Bandas"] = bandasArr.filter(b => ALLOWED_BANDAS.includes(b)).join(',');
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

function mapRow(row) {
  return {
    commercial_name: row["Nombre Comercial"].trim(),
    model: row["Modelo"].trim(),
    works: normalizeFunciona(row["Funciona"]),
    bands: row["Bandas"] ? normalizeBandas(row["Bandas"]) : [],
    provinces: row["Provincias"] ? row["Provincias"].split(',').map(p => normalizeProvincia(p)).filter(Boolean) : [],
    observations: row["Observaciones"] ? row["Observaciones"].trim() : null
  };
}

async function ensureTable(supabase, tableName) {
  // No crear tabla, solo continuar (se asume que la tabla 'phones' ya existe)
  return;
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
  const mapped = deduped.map(mapRow);

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
      console.log(`#${i + 1}: upsert modelo="${row.modelo}" nombre_comercial="${row.nombre_comercial}" funciona=${row.funciona} bandas=[${row.bandas.join(', ')}] provincias=[${row.provincias.join(', ')}] observaciones="${row.observaciones || ''}"`);
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

  // --- Upsert en lotes ---
  const BATCH_SIZE = 500;
  let total = 0;
  let limit = pLimit(5); // 5 requests concurrentes
  let errors = 0;
  for (let i = 0; i < mapped.length; i += BATCH_SIZE) {
    const chunk = mapped.slice(i, i + BATCH_SIZE);
    try {
      await limit(async () => {
        let retries = 0;
        while (retries < 5) {
          const { error } = await supabase.from(tableName).upsert(chunk, { onConflict: 'model' });
          if (!error) break;
          if (error.message && /timeout|network|temporar/i.test(error.message)) {
            await new Promise(res => setTimeout(res, 1000 * Math.pow(2, retries)));
            retries++;
          } else {
            throw error;
          }
        }
      });
      total += chunk.length;
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

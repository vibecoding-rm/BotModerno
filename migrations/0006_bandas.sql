-- Migration 0006: bandas de red por modelo (dataset GSMArena, para estimar
-- compatibilidad con ETECSA). OJO: es un ESTIMADO por specs, NO teléfonos probados.
-- Datos importados aparte con tools/ia-importa-bandas.py (solo modelos con
-- números de banda LTE reales). La app cruza norm_name con phones.commercial_name.
CREATE TABLE IF NOT EXISTS device_bands (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  oem       TEXT NOT NULL,
  model     TEXT NOT NULL,
  norm_name TEXT NOT NULL,        -- "samsung galaxy a02s" para el cruce
  bands_2g  TEXT,
  bands_3g  TEXT,
  bands_4g  TEXT,
  has_b3    INTEGER NOT NULL DEFAULT 0   -- 1 si trae LTE B3 (1800), clave en Cuba
);

CREATE INDEX IF NOT EXISTS idx_device_bands_norm ON device_bands(norm_name);

-- Migration 0004: tabla de TACs (primeros 8 dígitos del IMEI -> marca/modelo)
-- Datos: Osmocom TAC database (tacdb.osmocom.org, CC BY-SA 3.0), importados aparte
-- con tools/ia-importa-tacs.py (la migración solo crea la estructura).
CREATE TABLE IF NOT EXISTS tacs (
  tac TEXT PRIMARY KEY,   -- 8 dígitos
  brand TEXT NOT NULL,
  model TEXT NOT NULL,
  aka TEXT                -- otros nombres/códigos del equipo
);

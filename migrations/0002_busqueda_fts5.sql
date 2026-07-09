-- Migration 0002: indice FTS5 para /revisar (busqueda por palabras con prefijos)
-- Permite matches con palabras incompletas o mal terminadas: "samsun galax" -> "Samsung Galaxy...".
-- Tabla de contenido externo sobre phones; los triggers la mantienen sincronizada.
-- Nota: con recursive_triggers OFF (default de SQLite/D1) el trigger de updated_at
-- no re-dispara estos triggers.

CREATE VIRTUAL TABLE IF NOT EXISTS phones_fts USING fts5(
  nombre_comercial,
  model,
  content='phones',
  content_rowid='id'
);

-- Backfill con las filas existentes
INSERT INTO phones_fts(rowid, nombre_comercial, model)
SELECT id, IFNULL(nombre_comercial, ''), IFNULL(model, '') FROM phones;

CREATE TRIGGER IF NOT EXISTS trg_phones_fts_ai AFTER INSERT ON phones BEGIN
  INSERT INTO phones_fts(rowid, nombre_comercial, model)
  VALUES (new.id, IFNULL(new.nombre_comercial, ''), IFNULL(new.model, ''));
END;

CREATE TRIGGER IF NOT EXISTS trg_phones_fts_ad AFTER DELETE ON phones BEGIN
  INSERT INTO phones_fts(phones_fts, rowid, nombre_comercial, model)
  VALUES ('delete', old.id, IFNULL(old.nombre_comercial, ''), IFNULL(old.model, ''));
END;

CREATE TRIGGER IF NOT EXISTS trg_phones_fts_au AFTER UPDATE ON phones BEGIN
  INSERT INTO phones_fts(phones_fts, rowid, nombre_comercial, model)
  VALUES ('delete', old.id, IFNULL(old.nombre_comercial, ''), IFNULL(old.model, ''));
  INSERT INTO phones_fts(rowid, nombre_comercial, model)
  VALUES (new.id, IFNULL(new.nombre_comercial, ''), IFNULL(new.model, ''));
END;

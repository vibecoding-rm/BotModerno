-- D1 SQLite Schema for CubaModel Bot
-- Compatible with Cloudflare D1
-- Nota: nombre_comercial se calcula en JS (minusculas + sin acentos) al insertar/actualizar.

-- Table: phones
CREATE TABLE IF NOT EXISTS phones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  commercial_name TEXT NOT NULL,
  model TEXT,
  works BOOLEAN DEFAULT 0,
  bands TEXT DEFAULT '[]',         -- JSON array: ["2G","3G","4G"] o ["B3","B7"]
  provinces TEXT DEFAULT '[]',     -- JSON array: ["La Habana","Holguín"]
  observations TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  nombre_comercial TEXT,           -- normalizado: minusculas, sin acentos (seteado desde JS)
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TRIGGER IF NOT EXISTS trg_phones_update_time
AFTER UPDATE ON phones
BEGIN
  UPDATE phones SET updated_at = datetime('now') WHERE id = NEW.id;
END;

-- Dedupe: mismo nombre normalizado + modelo => rechazado por UNIQUE
CREATE UNIQUE INDEX IF NOT EXISTS idx_phones_dedupe ON phones (nombre_comercial, IFNULL(model, ''));

-- Table: submission_drafts
CREATE TABLE IF NOT EXISTS submission_drafts (
  tg_id TEXT PRIMARY KEY,
  step TEXT NOT NULL DEFAULT 'awaiting_name',
  commercial_name TEXT,
  model TEXT,
  works BOOLEAN DEFAULT 0,
  bands TEXT,
  provinces TEXT,
  observations TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TRIGGER IF NOT EXISTS trg_submission_drafts_update_time
AFTER UPDATE ON submission_drafts
BEGIN
  UPDATE submission_drafts SET updated_at = datetime('now') WHERE tg_id = NEW.tg_id;
END;

-- Table: reports
CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tg_id TEXT,
  chat_id TEXT,
  model TEXT,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','reviewed','dismissed')),
  created_at TEXT DEFAULT (datetime('now'))
);

-- Table: subscriptions
CREATE TABLE IF NOT EXISTS subscriptions (
  tg_id TEXT PRIMARY KEY,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Table: events
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tg_id TEXT,
  type TEXT NOT NULL,
  payload TEXT,                    -- JSON string
  created_at TEXT DEFAULT (datetime('now'))
);

-- Table: pending_notifications (cola de avisos a suscriptores; el cron la drena por lotes)
CREATE TABLE IF NOT EXISTS pending_notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tg_id TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Table: bot_config (una sola fila; sin secretos: el token vive en Worker secrets)
CREATE TABLE IF NOT EXISTS bot_config (
  id INTEGER PRIMARY KEY CHECK (id = 1) DEFAULT 1,
  rules TEXT DEFAULT '',
  welcome TEXT DEFAULT '',
  is_active BOOLEAN DEFAULT 1,
  short_welcome BOOLEAN DEFAULT 1,
  captcha_enabled BOOLEAN DEFAULT 1,
  captcha_timeout INTEGER DEFAULT 120,
  auto_approve_join BOOLEAN DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TRIGGER IF NOT EXISTS trg_bot_config_update_time
AFTER UPDATE ON bot_config
BEGIN
  UPDATE bot_config SET updated_at = datetime('now') WHERE id = NEW.id;
END;

-- Indice FTS5 de busqueda (contenido externo sobre phones, sincronizado por triggers)
CREATE VIRTUAL TABLE IF NOT EXISTS phones_fts USING fts5(
  nombre_comercial,
  model,
  content='phones',
  content_rowid='id'
);

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

-- Indices
CREATE INDEX IF NOT EXISTS idx_phones_nombre_comercial ON phones (nombre_comercial);
CREATE INDEX IF NOT EXISTS idx_phones_status ON phones (status);
CREATE INDEX IF NOT EXISTS idx_phones_model ON phones (model);
CREATE INDEX IF NOT EXISTS idx_events_created_at ON events (created_at);
CREATE INDEX IF NOT EXISTS idx_events_tg_id ON events (tg_id);

-- Default configuration
INSERT OR IGNORE INTO bot_config (id, rules, welcome)
VALUES (1,
  '1) Respeto; nada de insultos ni spam.
2) No ventas, solo compatibilidad de teléfonos en Cuba.
3) Aporta datos reales con /subir.
4) Usa /reportar para avisar de errores.
5) La base es de todos, nadie puede privatizarla.',
  '👋 ¡Bienvenido {fullname} a CubaModel! 🇨🇺📱

Este proyecto nació porque antes intentaron cobrar por una base que la comunidad creó gratis.
Aquí todo es distinto: la información será siempre abierta y descargable.

📜 Reglas:
1) Respeto; nada de insultos ni spam.
2) No ventas, solo compatibilidad de teléfonos en Cuba.
3) Aporta datos reales con /subir.
4) Usa /reportar para avisar de errores.
5) La base es de todos, nadie puede privatizarla.

Gracias por sumarte. Esto es de todos y para todos. ✨'
);

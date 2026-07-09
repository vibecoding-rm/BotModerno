-- Migration 0001: cola de notificaciones + limpieza de config fantasma
-- Aplicar con: wrangler d1 migrations apply cubamodel --remote

-- Cola de avisos a suscriptores (una fila por suscriptor); drainPendingNotifications
-- la envía por lotes de 30 desde el cron para no exceder los 50 subrequests/request.
CREATE TABLE IF NOT EXISTS pending_notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tg_id TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

-- user_roles nunca se usó desde el código
DROP TABLE IF EXISTS user_roles;

-- El código ahora SÍ lee captcha_enabled/captcha_timeout/auto_approve_join.
-- Se ponen en 1 para conservar el comportamiento que el bot tenía hardcodeado
-- (captcha siempre activo, joins auto-aprobados). Ahora se pueden apagar por config.
UPDATE bot_config SET captcha_enabled = 1, auto_approve_join = 1 WHERE id = 1;

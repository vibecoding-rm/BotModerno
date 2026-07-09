-- Migration 0003: banner opcional de bienvenida (/start en privado)
-- Un admin lo configura enviando al bot una foto con caption "/banner" (file_id de Telegram).
ALTER TABLE bot_config ADD COLUMN welcome_photo TEXT DEFAULT '';

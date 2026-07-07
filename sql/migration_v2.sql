-- ========================================================
--   MIGRATION V2 - SQL SCHEMA ALIGNMENT & MIGRATION
--   Compatible with Supabase (PostgreSQL)
--   This script is fully idempotent.
-- ========================================================

-- Extensiones necesarias
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 1. STANDARDIZE COLUMNS FOR public.phones (works_in_cuba -> works)
DO $$
BEGIN
  -- If works_in_cuba exists and works does not, rename it
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'phones' AND column_name = 'works_in_cuba') AND
     NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'phones' AND column_name = 'works') THEN
    ALTER TABLE public.phones RENAME COLUMN works_in_cuba TO works;
  
  -- If both exist, copy data to works and drop works_in_cuba
  ELSIF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'phones' AND column_name = 'works_in_cuba') AND
        EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'phones' AND column_name = 'works') THEN
    UPDATE public.phones SET works = works_in_cuba WHERE works IS NULL;
    ALTER TABLE public.phones DROP COLUMN works_in_cuba;
    
  -- If neither exists, create works column
  ELSIF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'phones' AND column_name = 'works') THEN
    ALTER TABLE public.phones ADD COLUMN works boolean;
  END IF;
END $$;

-- 2. STANDARDIZE COLUMNS FOR public.submission_drafts (works_in_cuba -> works)
DO $$
BEGIN
  -- If works_in_cuba exists and works does not, rename it
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'submission_drafts' AND column_name = 'works_in_cuba') AND
     NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'submission_drafts' AND column_name = 'works') THEN
    ALTER TABLE public.submission_drafts RENAME COLUMN works_in_cuba TO works;
  
  -- If both exist, copy data to works and drop works_in_cuba
  ELSIF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'submission_drafts' AND column_name = 'works_in_cuba') AND
        EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'submission_drafts' AND column_name = 'works') THEN
    UPDATE public.submission_drafts SET works = works_in_cuba WHERE works IS NULL;
    ALTER TABLE public.submission_drafts DROP COLUMN works_in_cuba;
    
  -- If neither exists, create works column
  ELSIF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'submission_drafts' AND column_name = 'works') THEN
    ALTER TABLE public.submission_drafts ADD COLUMN works boolean;
  END IF;
END $$;

-- 3. ENSURE reports TABLE MATCHES APPLICATION QUERIES & INSERTS
-- Ensure the table exists first with the correct base structure
CREATE TABLE IF NOT EXISTS public.reports (
  id bigserial PRIMARY KEY,
  tg_id text,
  chat_id text,
  model text,
  reason text,
  created_at timestamptz DEFAULT now(),
  status text DEFAULT 'pending'
);

-- In case the table already existed, alter it to make sure all expected columns are present
ALTER TABLE public.reports ADD COLUMN IF NOT EXISTS tg_id text;
ALTER TABLE public.reports ADD COLUMN IF NOT EXISTS chat_id text;
ALTER TABLE public.reports ADD COLUMN IF NOT EXISTS model text;
ALTER TABLE public.reports ADD COLUMN IF NOT EXISTS reason text;
ALTER TABLE public.reports ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
ALTER TABLE public.reports ADD COLUMN IF NOT EXISTS status text DEFAULT 'pending';

-- Migrate and drop legacy columns (content or text) to reason
DO $$
BEGIN
  -- content -> reason
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'reports' AND column_name = 'content') THEN
    UPDATE public.reports SET reason = content WHERE reason IS NULL;
    ALTER TABLE public.reports DROP COLUMN content;
  END IF;

  -- text -> reason
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'reports' AND column_name = 'text') THEN
    UPDATE public.reports SET reason = text WHERE reason IS NULL;
    ALTER TABLE public.reports DROP COLUMN text;
  END IF;

  -- phone_id -> drop if exists (since schema relies on model/reason text matching)
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'reports' AND column_name = 'phone_id') THEN
    ALTER TABLE public.reports DROP COLUMN phone_id;
  END IF;

  -- reporter_tg_id -> tg_id
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'reports' AND column_name = 'reporter_tg_id') THEN
    UPDATE public.reports SET tg_id = reporter_tg_id WHERE tg_id IS NULL;
    ALTER TABLE public.reports DROP COLUMN reporter_tg_id;
  END IF;

  -- reporter_username -> drop if exists
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'reports' AND column_name = 'reporter_username') THEN
    ALTER TABLE public.reports DROP COLUMN reporter_username;
  END IF;
END $$;

-- Configure RLS for reports
ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS reports_service_role_all ON public.reports;
CREATE POLICY reports_service_role_all
  ON public.reports
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- 4. CREATE user_roles TABLE
CREATE TABLE IF NOT EXISTS public.user_roles (
  id bigserial PRIMARY KEY,
  user_id text NOT NULL,
  role text NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- Configure RLS for user_roles
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_roles_service_role_all ON public.user_roles;
CREATE POLICY user_roles_service_role_all
  ON public.user_roles
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_user_roles_user_id ON public.user_roles(user_id);

-- 5. ALTER/EXTEND bot_config TABLE
-- Ensure bot_config table exists with basic fields
CREATE TABLE IF NOT EXISTS public.bot_config (
  id integer PRIMARY KEY DEFAULT 1,
  rules text DEFAULT '',
  welcome text DEFAULT '',
  updated_at timestamptz DEFAULT now()
);

-- Alter table to add web panel settings
ALTER TABLE public.bot_config ADD COLUMN IF NOT EXISTS webhook_url text;
ALTER TABLE public.bot_config ADD COLUMN IF NOT EXISTS bot_token text;
ALTER TABLE public.bot_config ADD COLUMN IF NOT EXISTS is_active boolean DEFAULT true;
ALTER TABLE public.bot_config ADD COLUMN IF NOT EXISTS short_welcome boolean DEFAULT true;
ALTER TABLE public.bot_config ADD COLUMN IF NOT EXISTS captcha_enabled boolean DEFAULT false;
ALTER TABLE public.bot_config ADD COLUMN IF NOT EXISTS captcha_timeout integer DEFAULT 120;
ALTER TABLE public.bot_config ADD COLUMN IF NOT EXISTS auto_approve_join boolean DEFAULT false;

-- Enforce default values for existing rows to prevent null issues
UPDATE public.bot_config SET is_active = true WHERE is_active IS NULL;
UPDATE public.bot_config SET short_welcome = true WHERE short_welcome IS NULL;
UPDATE public.bot_config SET captcha_enabled = false WHERE captcha_enabled IS NULL;
UPDATE public.bot_config SET captcha_timeout = 120 WHERE captcha_timeout IS NULL;
UPDATE public.bot_config SET auto_approve_join = false WHERE auto_approve_join IS NULL;

-- Configure RLS for bot_config
ALTER TABLE public.bot_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bot_config_service_role_all ON public.bot_config;
CREATE POLICY bot_config_service_role_all
  ON public.bot_config
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Create index for bot_config
CREATE INDEX IF NOT EXISTS idx_bot_config_id ON public.bot_config(id);

-- Insert default configurations if not present
INSERT INTO public.bot_config (id, rules, welcome) 
VALUES (1, 
  '1) Respeto; nada de insultos ni spam.
2) No ventas, solo compatibilidad de teléfonos en Cuba.
3) Aporta datos reales con /subir.
4) Usa /reportar para avisar de errores.
5) La base es de todos, nadie puede privatizarla.',
  '👋 ¡Bienvenido {fullname} a CubaModel! 🇨🇺📱

Este proyecto nació porque antes intentaron cobrar por una base que la comunidad creó gratis.
Aquí todo es distinto: la información será siempre abierta y descargable.

⚠️ Limitaciones:
• Puede ir lento en horas pico.
• Hay topes de consultas y almacenamiento.
• Puede caerse o fallar a veces (fase de desarrollo).

📜 Reglas:
1) Respeto; nada de insultos ni spam.
2) No ventas, solo compatibilidad de teléfonos en Cuba.
3) Aporta datos reales con /subir.
4) Usa /reportar para avisar de errores.
5) La base es de todos, nadie puede privatizarla.

Gracias por sumarte. Esto es de todos y para todos. ✨'
) ON CONFLICT (id) DO NOTHING;

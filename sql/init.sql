 -- =============================================
--   ESQUEMA + MIGRACIÓN + OPTIMIZACIÓN (FULL)
--   Compatible con Supabase (PostgreSQL)
--   Idempotente (puedes correrlo varias veces)
-- =============================================

-- Extensiones necesarias
create extension if not exists unaccent;
create extension if not exists pg_trgm;

-- Helpers ------------------------------

-- Split con normalización básica (coma/pipe/; y espacios múltiples)
create or replace function public._split_norm(txt text)
returns text[] language sql immutable strict as $$
  select
  case when trim(coalesce(txt,'')) = '' then '{}'::text[]
       else array_remove(
              array_agg(nullif(trim(x), '')),
              null
            )
  end
  from unnest(
    regexp_split_to_array(
      replace(replace(replace(replace(coalesce(txt,''), E'\r',' '), E'\n',' '), '|', ','), ';', ','),
      E'\\s*,\\s*|\\s{2,}'
    )
  ) as x;
$$;

-- Deduplicación ordenada de arrays
create or replace function public._array_dedup(a text[])
returns text[] language sql immutable as $$
  select case when a is null then '{}'::text[]
              else (select array_agg(distinct x order by x) from unnest(a) as x)
         end;
$$;

-- Tablas base --------------------------

create table if not exists public.phones (
  id                bigserial primary key,
  commercial_name   text not null,
  model             text,
  works             boolean,
  bands             text[] default '{}'::text[],
  provinces         text[] default '{}'::text[],
  observations      text,
  status            text not null default 'pending'
                    check (status in ('pending','approved','rejected')),
  nombre_comercial  text, -- normalizado (lower + unaccent)
  created_at        timestamptz default now()
);

create table if not exists public.submission_drafts (
  tg_id             text primary key,
  step              text not null default 'awaiting_name',
  commercial_name   text,
  model             text,
  works             boolean,
  bands             text,        -- texto libre; el server lo convertirá a array al publicar
  provinces         text,        -- idem (opcional)
  observations      text,
  updated_at        timestamptz default now()
);

create table if not exists public.reports (
  id                bigserial primary key,
  tg_id             text,
  content           text,
  created_at        timestamptz default now()
);

create table if not exists public.subscriptions (
  tg_id             text primary key,
  created_at        timestamptz default now()
);

create table if not exists public.events (
  id                bigserial primary key,
  tg_id             text,
  type              text not null, -- 'message','error','system'
  payload           jsonb,
  created_at        timestamptz default now()
);

-- RLS ----------------------------------

alter table public.phones            enable row level security;
alter table public.submission_drafts enable row level security;
alter table public.reports           enable row level security;
alter table public.subscriptions     enable row level security;
alter table public.events            enable row level security;

-- phones: lectura pública
drop policy if exists phones_read on public.phones;
create policy phones_read
  on public.phones
  for select
  using (true);

-- phones: insert/update para usuarios autenticados (service_role también pasa)
drop policy if exists phones_write on public.phones;
create policy phones_write
  on public.phones
  for insert
  with check (auth.role() = 'authenticated');

drop policy if exists phones_update on public.phones;
create policy phones_update
  on public.phones
  for update
  using (auth.role() = 'authenticated');

-- drafts: acceso completo solo desde service_role (bot/admin server-side)
drop policy if exists drafts_service_role_all on public.submission_drafts;
create policy drafts_service_role_all
  on public.submission_drafts
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- reports: service_role
drop policy if exists reports_service_role_all on public.reports;
create policy reports_service_role_all
  on public.reports
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- subscriptions: service_role
drop policy if exists subs_service_role_all on public.subscriptions;
create policy subs_service_role_all
  on public.subscriptions
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- events: service_role
drop policy if exists events_service_role_all on public.events;
create policy events_service_role_all
  on public.events
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- Migración de tipos a text[] (bands/provinces) ---------------

-- bands → text[]
do $$
declare _dtype text;
begin
  select data_type into _dtype
  from information_schema.columns
  where table_schema='public' and table_name='phones' and column_name='bands';

  if not found then
    alter table public.phones add column bands text[] default '{}'::text[];
  elsif _dtype <> 'ARRAY' then
    alter table public.phones
      alter column bands type text[]
      using public._split_norm(bands::text);
  end if;
end$$;

-- provinces → text[]
do $$
declare _dtype text;
begin
  select data_type into _dtype
  from information_schema.columns
  where table_schema='public' and table_name='phones' and column_name='provinces';

  if not found then
    alter table public.phones add column provinces text[] default '{}'::text[];
  elsif _dtype <> 'ARRAY' then
    alter table public.phones
      alter column provinces type text[]
      using public._split_norm(provinces::text);
  end if;
end$$;

-- Si existen columnas legacy (texto) bands_text / provinces_text, backfill
do $$
begin
  if exists (select 1 from information_schema.columns
               where table_schema='public' and table_name='phones' and column_name='bands_text') then
    update public.phones
       set bands = public._array_dedup(public._split_norm(bands_text))
     where (bands is null or array_length(bands,1) is null)
       and coalesce(bands_text,'') <> '';
  end if;

  if exists (select 1 from information_schema.columns
               where table_schema='public' and table_name='phones' and column_name='provinces_text') then
    update public.phones
       set provinces = public._array_dedup(public._split_norm(provinces_text))
     where (provinces is null or array_length(provinces,1) is null)
       and coalesce(provinces_text,'') <> '';
  end if;
end$$;

-- Normalización + backfills -------------------------

-- Asegura columnas si venías de un esquema viejo
do $$
begin
  if not exists (select 1 from information_schema.columns
    where table_schema='public' and table_name='phones' and column_name='nombre_comercial') then
    alter table public.phones add column nombre_comercial text;
  end if;

  if not exists (select 1 from information_schema.columns
    where table_schema='public' and table_name='phones' and column_name='status') then
    alter table public.phones add column status text not null default 'pending'
      check (status in ('pending','approved','rejected'));
  end if;
end$$;

-- Trigger para mantener nombre_comercial = unaccent(lower(commercial_name))
create or replace function public.phones_sync_nombre_comercial()
returns trigger language plpgsql as $$
begin
  new.nombre_comercial := unaccent(lower(coalesce(new.commercial_name,'')));
  return new;
end $$;

drop trigger if exists trg_phones_sync_nombre_comercial on public.phones;
create trigger trg_phones_sync_nombre_comercial
before insert or update of commercial_name on public.phones
for each row execute function public.phones_sync_nombre_comercial();

-- Backfill nombre_comercial y status
update public.phones
   set nombre_comercial = unaccent(lower(coalesce(commercial_name,'')))
 where nombre_comercial is distinct from unaccent(lower(coalesce(commercial_name,'')));

update public.phones
   set status = 'pending'
 where coalesce(status,'') not in ('pending','approved','rejected');

-- Limpieza arrays + dedup
update public.phones
   set bands = public._array_dedup(coalesce(array_remove(bands, ''), '{}'::text[]))
 where bands is not null;

update public.phones
   set provinces = public._array_dedup(coalesce(array_remove(provinces, ''), '{}'::text[]))
 where provinces is not null;

-- Índices (rendimiento de búsqueda y filtros) --------

-- Búsqueda por nombre (ILIKE, trigrama)
create index if not exists idx_phones_nombre_comercial_trgm
  on public.phones using gin (nombre_comercial gin_trgm_ops);

-- Filtros por arrays
create index if not exists idx_phones_bands_gin
  on public.phones using gin (bands);

create index if not exists idx_phones_provinces_gin
  on public.phones using gin (provinces);

-- Filtros por estado y otros campos útiles
create index if not exists idx_phones_status on public.phones (status);
create index if not exists idx_phones_name  on public.phones (commercial_name);
create index if not exists idx_phones_model on public.phones (model);

-- Índices de events
create index if not exists idx_events_created on public.events (created_at);
create index if not exists idx_events_tg      on public.events (tg_id);

-- =============================================
--   FIN DEL SCRIPT
-- =============================================

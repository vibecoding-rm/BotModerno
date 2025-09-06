-- sql/reports.sql
-- End-user reports for models
create table if not exists public.reports (
  id bigserial primary key,
  phone_id bigint references public.phones(id) on delete cascade,
  reporter_tg_id text not null,
  reporter_username text,
  text text not null,
  status text not null default 'open' check (status in ('open','reviewed','dismissed')),
  created_at timestamptz default now()
);
create index if not exists reports_phone_id_idx on public.reports(phone_id);

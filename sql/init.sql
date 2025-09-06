
create table if not exists phones (
  id bigserial primary key,
  commercial_name text not null,
  model text,
  works boolean,
  bands text,
  observations text,
  created_at timestamptz default now()
);
create table if not exists submission_drafts (
  tg_id text primary key,
  step text not null default 'awaiting_name',
  commercial_name text,
  model text,
  works boolean,
  bands text,
  observations text,
  updated_at timestamptz default now()
);
create table if not exists reports (
  id bigserial primary key,
  tg_id text,
  content text,
  created_at timestamptz default now()
);
create table if not exists subscriptions (
  tg_id text primary key,
  created_at timestamptz default now()
);
create table if not exists events (
  id bigserial primary key,
  tg_id text,
  type text not null,
  payload jsonb,
  created_at timestamptz default now()
);
alter table phones enable row level security;
alter table submission_drafts enable row level security;
alter table reports enable row level security;
alter table subscriptions enable row level security;
alter table events enable row level security;
create policy if not exists phones_read on phones for select using (true);
create policy if not exists phones_write on phones for insert with check (auth.role() = 'authenticated');
create policy if not exists phones_update on phones for update using (auth.role() = 'authenticated');
create policy if not exists drafts_service_role_read on submission_drafts for select using (auth.role() = 'service_role');
create policy if not exists drafts_service_role_write on submission_drafts for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
create policy if not exists reports_service_role_all on reports for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
create policy if not exists subs_service_role_all on subscriptions for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
create policy if not exists events_service_role_all on events for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
create index if not exists idx_phones_name on phones (commercial_name);
create index if not exists idx_phones_model on phones (model);
create index if not exists idx_events_created on events (created_at);
create index if not exists idx_events_tg on events (tg_id);

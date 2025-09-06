-- sql/subscriptions.sql
-- DM subscriptions for approvals
create table if not exists public.subscriptions (
  tg_id text primary key,
  username text,
  created_at timestamptz default now()
);

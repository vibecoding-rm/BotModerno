-- sql/submission_drafts.sql
-- Persistent wizard state for /subir
create table if not exists public.submission_drafts (
  id bigserial primary key,
  tg_id text not null unique,
  step text not null,
  commercial_name text,
  model text,
  works_in_cuba boolean,
  bands text[],
  observations text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists submission_drafts_tg_id_idx on public.submission_drafts(tg_id);

create or replace function public.touch_submission_drafts()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end$$;

drop trigger if exists trg_touch_submission_drafts on public.submission_drafts;
create trigger trg_touch_submission_drafts
before update on public.submission_drafts
for each row execute procedure public.touch_submission_drafts();

-- sql/phones.sql
-- Main phones table for CubaModel
create table if not exists public.phones (
  id bigserial primary key,
  commercial_name text not null,
  model text not null,
  works_in_cuba boolean not null default false,
  bands text[],
  provinces text[],
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  observations text,
  submitted_by_tg text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists phones_status_idx on public.phones(status);
create index if not exists phones_commercial_name_idx on public.phones(commercial_name);
create index if not exists phones_model_idx on public.phones(model);

create or replace function public.touch_phones()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end$$;

drop trigger if exists trg_touch_phones on public.phones;
create trigger trg_touch_phones
before update on public.phones
for each row execute procedure public.touch_phones();
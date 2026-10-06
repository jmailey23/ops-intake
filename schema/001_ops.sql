-- ops-intake schema.
--
-- The same shape as src/types.ts, with the rules that matter enforced in the
-- database rather than the interface:
--
--   * captures are immutable: what was received, exactly as received
--   * job filing is one SQL function, so live ingest, a backfill and an alias
--     edit can never disagree
--   * who sees what is row level security keyed to the signed in person
--   * only the owner can settle an item flagged for an owner decision
--
-- Portable Postgres. On Supabase, replace app_uid() with auth.uid().


create type person_role as enum ('owner', 'office', 'pm', 'crew', 'sub');

create table people (
  id       uuid primary key default gen_random_uuid(),
  name     text not null,
  emails   text[] not null default '{}',
  role     person_role not null,
  auth_uid uuid unique
);

create table jobs (
  id      uuid primary key default gen_random_uuid(),
  name    text not null,
  aliases text[] not null default '{}'
);

-- Crew and subs see the jobs they are on, and nothing else.
create table job_people (
  job_id    uuid not null references jobs on delete cascade,
  person_id uuid not null references people on delete cascade,
  primary key (job_id, person_id)
);

create table captures (
  id          uuid primary key default gen_random_uuid(),
  message_id  text not null unique,           -- idempotency: a pump that repeats itself is a no-op
  from_addr   text not null,
  to_addr     text not null,
  subject     text not null default '',
  body        text not null default '',
  received_at timestamptz not null,
  internal    boolean not null,
  writer_id   uuid references people,
  job_id      uuid references jobs,
  created_at  timestamptz not null default now()
);
comment on table captures is 'Immutable record of what was received. Never edited.';

create function captures_are_immutable() returns trigger language plpgsql as $$
begin
  raise exception 'captures are immutable';
end $$;
create trigger captures_immutable before update or delete on captures
  for each row execute function captures_are_immutable();

create type item_kind as enum ('task', 'material', 'issue');

create table items (
  id                   uuid primary key default gen_random_uuid(),
  capture_id           uuid not null references captures,
  title                text not null,
  detail               text,
  kind                 item_kind not null default 'task',
  urgent               boolean not null default false,
  needs_owner_decision boolean not null default false,
  decision             text,
  decided_by           uuid references people,
  owner_id             uuid references people,
  job_id               uuid references jobs,
  job_candidates       uuid[] not null default '{}',  -- set when filing was ambiguous
  status               text not null default 'open' check (status in ('open', 'done')),
  created_at           timestamptz not null default now()
);
comment on column items.needs_owner_decision is 'The delegation boundary: money, scope and unhappy clients.';

-- ── filing ───────────────────────────────────────────────────────────────

-- Whole-word alias match. One job named files it, two or more wait for a
-- person, none is general. Mirrors src/filing.ts.
create function file_text(p_text text)
returns table (job_id uuid, candidates uuid[])
language sql stable as $$
  with hay as (
    select ' ' || regexp_replace(lower(coalesce(p_text, '')), '[^a-z0-9]+', ' ', 'g') || ' ' as h
  ),
  hits as (
    select distinct j.id
    from jobs j, unnest(j.aliases) a, hay
    where length(trim(regexp_replace(lower(a), '[^a-z0-9]+', ' ', 'g'))) > 0
      and position(' ' || trim(regexp_replace(lower(a), '[^a-z0-9]+', ' ', 'g')) || ' ' in hay.h) > 0
  )
  select
    case when count(*) = 1 then min(id::text)::uuid end,
    case when count(*) > 1 then array_agg(id order by id) else '{}' end
  from hits
$$;

-- ── who is asking ────────────────────────────────────────────────────────

create function app_uid() returns uuid language sql stable as $$
  select nullif(current_setting('app.uid', true), '')::uuid
$$;

create function me() returns people language sql stable security definer as $$
  select * from people where auth_uid = app_uid()
$$;

create function is_staff() returns boolean language sql stable security definer as $$
  select coalesce((select role in ('owner', 'office', 'pm') from people where auth_uid = app_uid()), false)
$$;

create function on_job(p_job uuid) returns boolean language sql stable security definer as $$
  select exists (
    select 1 from job_people jp join people p on p.id = jp.person_id
    where jp.job_id = p_job and p.auth_uid = app_uid()
  )
$$;

-- ── row level security ───────────────────────────────────────────────────

alter table people     enable row level security;
alter table jobs       enable row level security;
alter table job_people enable row level security;
alter table captures   enable row level security;
alter table items      enable row level security;

create policy people_read on people for select using (app_uid() is not null);

create policy jobs_staff on jobs for select using (is_staff());
create policy jobs_mine  on jobs for select using (on_job(id));

create policy job_people_read on job_people for select using (is_staff() or on_job(job_id));

-- Raw mail can carry prices and client complaints: the office side only.
create policy captures_staff on captures for select using (is_staff());

create policy items_staff_read  on items for select using (is_staff());
create policy items_field_read  on items for select
  using (owner_id = (me()).id or (job_id is not null and on_job(job_id)));
create policy items_staff_write on items for update using (is_staff());
create policy items_field_write on items for update using (owner_id = (me()).id);

-- Only the owner settles an owner decision, whatever else a role may edit.
create function guard_owner_decision() returns trigger language plpgsql as $$
begin
  if old.needs_owner_decision
     and (new.decision is distinct from old.decision or new.status is distinct from old.status)
     and coalesce((me()).role::text, '') <> 'owner' then
    raise exception 'only the owner can settle an owner decision';
  end if;
  if new.decision is distinct from old.decision then
    new.decided_by := (me()).id;
  end if;
  return new;
end $$;
create trigger items_owner_decision before update on items
  for each row execute function guard_owner_decision();

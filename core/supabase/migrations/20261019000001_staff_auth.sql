-- Zarghoon AI — staff sign-in for the management dashboard.
--
-- Separate from the website's customer accounts: a staff credential belongs
-- to a row in `staff`, and access is decided by that row's role and
-- is_active flag on every request.
--
-- Passwords are stored only as scrypt hashes. Session tokens are random and
-- stored only as SHA-256 hashes, so a database read does not yield a usable
-- session.

create table staff_credentials (
  staff_id            uuid primary key references staff (id) on delete cascade,
  username            text not null check (username ~ '^[a-z0-9][a-z0-9._-]{2,39}$'),
  password_hash       text not null check (password_hash like 'scrypt$%'),
  password_updated_at timestamptz not null default now(),
  failed_attempts     integer not null default 0 check (failed_attempts >= 0),
  locked_until        timestamptz,
  last_login_at       timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create unique index staff_credentials_username_key on staff_credentials (username);
create trigger staff_credentials_set_updated_at before update on staff_credentials
  for each row execute function zj_set_updated_at();

create table staff_sessions (
  id            uuid primary key default gen_random_uuid(),
  token_hash    text not null check (token_hash ~ '^[0-9a-f]{64}$'),
  staff_id      uuid not null references staff (id) on delete cascade,
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  expires_at    timestamptz not null,
  revoked_at    timestamptz,
  user_agent    text check (user_agent is null or length(user_agent) <= 300),
  constraint staff_sessions_expiry check (expires_at > created_at)
);
create unique index staff_sessions_token_hash_key on staff_sessions (token_hash);
create index staff_sessions_staff_idx on staff_sessions (staff_id) where revoked_at is null;

do $$
declare
  t text;
  r text;
begin
  foreach t in array array['staff_credentials', 'staff_sessions'] loop
    execute format('alter table %I enable row level security', t);
    foreach r in array array['anon', 'authenticated'] loop
      if exists (select 1 from pg_roles where rolname = r) then
        execute format('revoke all on table %I from %I', t, r);
      end if;
    end loop;
  end loop;
end;
$$;

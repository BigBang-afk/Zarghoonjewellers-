-- Zarghoon AI — least-privilege database roles (Phase 1, Step 12).
--
-- Not a migration: roles are server-wide and their passwords are secrets.
-- Run it as the database owner (e.g. Supabase "postgres") after every
-- migration, because new tables need their grants and policies. It is
-- idempotent and never prints or sets a password:
--
--   psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -f core/supabase/roles/least_privilege.sql
--   psql "$ADMIN_URL" -c "\password zarghoon_app"        # then use it in ZARGHOON_CORE_DATABASE_URL
--   psql "$ADMIN_URL" -c "\password zarghoon_readonly"   # optional: reports
--
-- Roles:
--   zarghoon_app       the website chat, dashboard and worker. Reads and writes rows; cannot
--                      change the schema, truncate, or edit/delete the audit log, decided
--                      approvals or migration history.
--   zarghoon_readonly  reports (npm run crm:report). Read-only; no staff credentials or sessions.
-- Migrations keep running as the owner. Row-level security stays enabled on every table
-- and anon/authenticated (Supabase public API roles) keep no access at all.

set client_min_messages = warning;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'zarghoon_app') then
    create role zarghoon_app login nosuperuser nocreatedb nocreaterole noinherit nobypassrls;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'zarghoon_readonly') then
    create role zarghoon_readonly login nosuperuser nocreatedb nocreaterole noinherit nobypassrls;
  end if;
  alter role zarghoon_app nosuperuser nocreatedb nocreaterole nobypassrls;
  alter role zarghoon_readonly nosuperuser nocreatedb nocreaterole nobypassrls;
  -- Fail fast instead of letting a stuck query hold locks.
  alter role zarghoon_app set statement_timeout = '30s';
  alter role zarghoon_app set idle_in_transaction_session_timeout = '60s';
  alter role zarghoon_readonly set statement_timeout = '60s';
  alter role zarghoon_readonly set default_transaction_read_only = on;
end;
$$;

do $$
declare
  t text;
  readonly_hidden constant text[] := array['staff_credentials', 'staff_sessions'];
  app_insert_only constant text[] := array['agent_actions'];
  app_no_delete constant text[] := array['approvals', 'zarghoon_meta', 'zarghoon_schema_migrations'];
  app_read_only constant text[] := array['zarghoon_meta', 'zarghoon_schema_migrations'];
begin
  execute format('grant connect on database %I to zarghoon_app, zarghoon_readonly', current_database());
  revoke create on schema public from public;
  revoke create on schema public from zarghoon_app, zarghoon_readonly;
  grant usage on schema public to zarghoon_app, zarghoon_readonly;

  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('revoke all on table public.%I from zarghoon_app, zarghoon_readonly', t);
    execute format('drop policy if exists zarghoon_app_rows on public.%I', t);
    execute format('drop policy if exists zarghoon_readonly_rows on public.%I', t);

    if t = any (app_read_only) then
      execute format('grant select on table public.%I to zarghoon_app', t);
    elsif t = any (app_insert_only) then
      execute format('grant select, insert on table public.%I to zarghoon_app', t);
    elsif t = any (app_no_delete) then
      execute format('grant select, insert, update on table public.%I to zarghoon_app', t);
    else
      execute format('grant select, insert, update, delete on table public.%I to zarghoon_app', t);
    end if;
    -- RLS is on everywhere; the app role sees rows only through this policy. Authorisation
    -- of staff and customers is enforced by the application layer (see docs/security.md).
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy zarghoon_app_rows on public.%I for all to zarghoon_app using (true) with check (true)', t);

    if not (t = any (readonly_hidden)) then
      execute format('grant select on table public.%I to zarghoon_readonly', t);
      execute format('create policy zarghoon_readonly_rows on public.%I for select to zarghoon_readonly using (true)', t);
    end if;
  end loop;

  grant usage, select on all sequences in schema public to zarghoon_app;
  revoke all on all functions in schema public from public;
  grant execute on all functions in schema public to zarghoon_app;
end;
$$;

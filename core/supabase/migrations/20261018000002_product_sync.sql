-- Zarghoon AI — one-way product synchronisation from an external source
-- (e.g. the existing website) into the Zarghoon AI catalogue.
--
-- A link records which external product a Zarghoon product came from, so
-- re-syncing updates the same row instead of creating duplicates. Links are
-- never deleted by sync; products missing from the source are only reported.

create table product_source_links (
  id                 uuid primary key default gen_random_uuid(),
  source             text not null check (source ~ '^[a-z0-9_]{2,40}$'),
  source_product_id  text not null check (length(btrim(source_product_id)) between 1 and 200),
  product_id         uuid not null references products (id) on delete restrict,
  -- Hash of the normalised source record at the last applied sync (change detection).
  source_hash        text not null,
  first_synced_at    timestamptz not null default now(),
  last_synced_at     timestamptz not null default now()
);
create unique index product_source_links_source_key on product_source_links (source, source_product_id);
create unique index product_source_links_product_key on product_source_links (source, product_id);

alter table product_source_links enable row level security;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on table product_source_links from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on table product_source_links from authenticated;
  end if;
end;
$$;

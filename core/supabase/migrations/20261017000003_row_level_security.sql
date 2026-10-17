-- Zarghoon AI — Row Level Security.
--
-- Phase 1 access model: every table is reached only by trusted server code
-- (the service-role key or a direct Postgres connection, both of which bypass
-- RLS). Browser/anonymous clients get NO direct table access at all — not even
-- to products, because the products table holds internal cost columns
-- (making_charge, stone_cost). A public catalogue will be exposed later through
-- a dedicated view or API that selects only customer-safe columns.
--
-- RLS is enabled with no policies, which denies everything to anon and
-- authenticated. Grants are also revoked as a second layer.
--
-- The role checks keep this migration runnable on plain Postgres (CI, local
-- tests), where the Supabase roles do not exist.

do $$
declare
  t text;
  r text;
begin
  foreach t in array array[
    'staff', 'customers', 'customer_identities', 'products', 'product_images', 'leads',
    'lead_signal_events', 'conversations', 'messages', 'product_interests', 'followups',
    'orders', 'order_items', 'approvals', 'agent_actions', 'handoffs'
  ] loop
    execute format('alter table %I enable row level security', t);
    foreach r in array array['anon', 'authenticated'] loop
      if exists (select 1 from pg_roles where rolname = r) then
        execute format('revoke all on table %I from %I', t, r);
      end if;
    end loop;
  end loop;
end;
$$;

-- Zarghoon AI — core schema (Phase 1 foundation).
--
-- Conventions:
--   * Enumerations are TEXT + CHECK constraints (not Postgres ENUM types) so
--     values can be evolved by later migrations without ALTER TYPE pitfalls.
--   * Money is NUMERIC(14,2); gold/metal weight is NUMERIC(10,3). Never float.
--   * Unknown business facts are NULL. Columns are only NOT NULL when a value
--     is genuinely always known at insert time.
--   * Historical migrations are never edited; schema changes go in new files.

create or replace function zj_set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- staff
-- ---------------------------------------------------------------------------
create table staff (
  id            uuid primary key default gen_random_uuid(),
  full_name     text not null check (length(btrim(full_name)) > 0),
  role          text not null check (role in ('owner', 'manager', 'sales', 'support', 'admin')),
  phone         text,
  email         text check (email is null or email = lower(email)),
  is_active     boolean not null default true,
  -- Availability is set explicitly by staff/managers. Automated assignment
  -- must never pick a staff member whose is_available is false.
  is_available  boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create unique index staff_email_key on staff (email) where email is not null;
create trigger staff_set_updated_at before update on staff
  for each row execute function zj_set_updated_at();

-- ---------------------------------------------------------------------------
-- customers
-- ---------------------------------------------------------------------------
create table customers (
  id                  uuid primary key default gen_random_uuid(),
  full_name           text,
  -- Phone numbers are stored normalized to E.164 (e.g. +923001234567).
  phone               text check (phone is null or phone ~ '^\+[1-9][0-9]{6,14}$'),
  whatsapp_number     text check (whatsapp_number is null or whatsapp_number ~ '^\+[1-9][0-9]{6,14}$'),
  email               text check (email is null or email = lower(btrim(email))),
  city                text,
  preferred_language  text not null default 'unknown'
                      check (preferred_language in ('english', 'urdu', 'roman_urdu', 'unknown')),
  notes               text,
  last_contact_at     timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create unique index customers_phone_key on customers (phone) where phone is not null;
create unique index customers_whatsapp_number_key on customers (whatsapp_number) where whatsapp_number is not null;
create unique index customers_email_key on customers (email) where email is not null;
create index customers_last_contact_at_idx on customers (last_contact_at desc nulls last);
create trigger customers_set_updated_at before update on customers
  for each row execute function zj_set_updated_at();

-- ---------------------------------------------------------------------------
-- products
-- ---------------------------------------------------------------------------
create table products (
  id              uuid primary key default gen_random_uuid(),
  -- SKU format: uppercase segments separated by hyphens, e.g. ZJ-BR-001.
  sku             text not null check (sku ~ '^[A-Z0-9]+(-[A-Z0-9]+)+$'),
  name            text not null check (length(btrim(name)) > 0),
  description     text,
  category        text,
  collection      text,
  metal           text check (metal is null or metal in ('gold', 'white_gold', 'rose_gold', 'silver', 'platinum', 'other')),
  karat           smallint check (karat is null or karat between 1 and 24),
  weight_grams    numeric(10, 3) check (weight_grams is null or weight_grams > 0),
  making_charge   numeric(14, 2) check (making_charge is null or making_charge >= 0),
  stone_cost      numeric(14, 2) check (stone_cost is null or stone_cost >= 0),
  approved_price  numeric(14, 2) check (approved_price is null or approved_price >= 0),
  currency        text not null default 'PKR' check (currency ~ '^[A-Z]{3}$'),
  stock_quantity  integer check (stock_quantity is null or stock_quantity >= 0),
  -- NULL stock_status means "unknown — requires confirmation".
  stock_status    text check (stock_status is null or stock_status in
                    ('available', 'low_stock', 'out_of_stock', 'reserved', 'made_to_order', 'discontinued')),
  size            text,
  website_url     text check (website_url is null or website_url ~ '^https?://'),
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  -- A product cannot be "out of stock" while holding positive stock, nor
  -- "available"/"low_stock" with a recorded quantity of zero.
  constraint products_stock_consistency check (
    stock_quantity is null
    or stock_status is null
    or (stock_status = 'out_of_stock' and stock_quantity = 0)
    or (stock_status in ('available', 'low_stock') and stock_quantity > 0)
    or stock_status in ('reserved', 'made_to_order', 'discontinued')
  )
);
create unique index products_sku_key on products (sku);
create index products_category_idx on products (category) where is_active;
create index products_collection_idx on products (collection) where is_active;
create index products_stock_status_idx on products (stock_status) where is_active;
create trigger products_set_updated_at before update on products
  for each row execute function zj_set_updated_at();

create table product_images (
  id          uuid primary key default gen_random_uuid(),
  product_id  uuid not null references products (id) on delete cascade,
  url         text not null check (url ~ '^https?://'),
  alt_text    text,
  sort_order  integer not null default 0,
  is_primary  boolean not null default false,
  created_at  timestamptz not null default now()
);
create index product_images_product_id_idx on product_images (product_id, sort_order);
create unique index product_images_one_primary on product_images (product_id) where is_primary;

-- ---------------------------------------------------------------------------
-- leads
-- ---------------------------------------------------------------------------
create table leads (
  id                   uuid primary key default gen_random_uuid(),
  customer_id          uuid not null references customers (id) on delete restrict,
  status               text not null default 'new' check (status in
                         ('new', 'qualified', 'warm', 'hot', 'very_hot', 'waiting_customer',
                          'human_followup', 'won', 'lost', 'do_not_contact')),
  -- score/score_classification are a cache of the deterministic scoring
  -- function applied to lead_signal_events. They are only written by code.
  score                smallint not null default 0 check (score between 0 and 100),
  score_classification text not null default 'cold'
                         check (score_classification in ('cold', 'warm', 'hot', 'very_hot')),
  source_channel       text check (source_channel is null or source_channel in
                         ('website', 'whatsapp', 'instagram', 'facebook', 'in_store', 'other')),
  -- Budget as stated by the customer. Never estimated.
  budget_amount        numeric(14, 2) check (budget_amount is null or budget_amount >= 0),
  budget_currency      text check (budget_currency is null or budget_currency ~ '^[A-Z]{3}$'),
  assigned_staff_id    uuid references staff (id) on delete set null,
  notes                text,
  lost_reason          text,
  won_at               timestamptz,
  lost_at              timestamptz,
  last_activity_at     timestamptz not null default now(),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint leads_lost_reason_required check (status <> 'lost' or lost_reason is not null)
);
create index leads_customer_id_idx on leads (customer_id, created_at desc);
create index leads_status_idx on leads (status);
create index leads_score_idx on leads (score desc) where status not in ('won', 'lost', 'do_not_contact');
create trigger leads_set_updated_at before update on leads
  for each row execute function zj_set_updated_at();

-- ---------------------------------------------------------------------------
-- conversations / messages
-- ---------------------------------------------------------------------------
create table conversations (
  id                        uuid primary key default gen_random_uuid(),
  -- Nullable: an anonymous website visitor can chat before being identified.
  customer_id               uuid references customers (id) on delete restrict,
  lead_id                   uuid references leads (id) on delete set null,
  channel                   text not null check (channel in
                              ('website', 'whatsapp', 'instagram', 'facebook', 'in_store', 'other')),
  external_conversation_id  text,
  status                    text not null default 'open' check (status in ('open', 'closed')),
  human_takeover            boolean not null default false,
  human_takeover_at         timestamptz,
  human_takeover_reason     text,
  assigned_staff_id         uuid references staff (id) on delete set null,
  last_message_at           timestamptz,
  closed_at                 timestamptz,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  constraint conversations_closed_at_consistency check ((status = 'closed') = (closed_at is not null))
);
create unique index conversations_external_key on conversations (channel, external_conversation_id)
  where external_conversation_id is not null;
create index conversations_customer_id_idx on conversations (customer_id, last_message_at desc nulls last);
create index conversations_takeover_idx on conversations (human_takeover) where human_takeover;
create trigger conversations_set_updated_at before update on conversations
  for each row execute function zj_set_updated_at();

create table messages (
  id                   uuid primary key default gen_random_uuid(),
  conversation_id      uuid not null references conversations (id) on delete cascade,
  direction            text not null check (direction in ('inbound', 'outbound')),
  sender_type          text not null check (sender_type in ('customer', 'ai', 'staff', 'system')),
  sender_staff_id      uuid references staff (id) on delete set null,
  content              text not null check (length(content) > 0),
  -- Language detected for this single message. Never copied automatically
  -- into customers.preferred_language.
  language             text check (language is null or language in ('english', 'urdu', 'roman_urdu', 'unknown')),
  metadata             jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  external_message_id  text,
  created_at           timestamptz not null default now(),
  constraint messages_direction_sender check (
    (direction = 'inbound' and sender_type = 'customer')
    or (direction = 'outbound' and sender_type in ('ai', 'staff', 'system'))
  ),
  constraint messages_staff_sender check (sender_type <> 'staff' or sender_staff_id is not null)
);
create index messages_conversation_id_idx on messages (conversation_id, created_at desc);
create unique index messages_external_key on messages (conversation_id, external_message_id)
  where external_message_id is not null;

-- ---------------------------------------------------------------------------
-- product interests
-- ---------------------------------------------------------------------------
create table product_interests (
  id               uuid primary key default gen_random_uuid(),
  customer_id      uuid not null references customers (id) on delete restrict,
  lead_id          uuid references leads (id) on delete set null,
  product_id       uuid not null references products (id) on delete restrict,
  interest_type    text not null check (interest_type in
                     ('viewed', 'asked_price', 'asked_availability', 'shortlisted',
                      'requested_similar', 'requested_customization')),
  conversation_id  uuid references conversations (id) on delete set null,
  message_id       uuid references messages (id) on delete set null,
  notes            text,
  created_at       timestamptz not null default now()
);
create index product_interests_customer_idx on product_interests (customer_id, created_at desc);
create index product_interests_lead_idx on product_interests (lead_id, created_at desc) where lead_id is not null;
create index product_interests_product_idx on product_interests (product_id);
-- The same message cannot register the same interest twice.
create unique index product_interests_message_dedupe on product_interests
  (customer_id, product_id, interest_type, message_id) where message_id is not null;

-- ---------------------------------------------------------------------------
-- follow-ups
-- ---------------------------------------------------------------------------
create table followups (
  id                 uuid primary key default gen_random_uuid(),
  customer_id        uuid not null references customers (id) on delete restrict,
  lead_id            uuid references leads (id) on delete set null,
  conversation_id    uuid references conversations (id) on delete set null,
  assigned_staff_id  uuid references staff (id) on delete set null,
  followup_type      text not null default 'sales' check (followup_type in
                       ('sales', 'after_sales', 'order_update', 'service', 'other')),
  channel            text check (channel is null or channel in
                       ('website', 'whatsapp', 'instagram', 'facebook', 'in_store', 'other')),
  scheduled_for      timestamptz not null,
  status             text not null default 'pending' check (status in ('pending', 'completed', 'cancelled', 'skipped')),
  -- A draft only. Follow-up messages are never sent automatically in Phase 1.
  message_draft      text,
  note               text,
  outcome_note       text,
  created_by_type    text not null check (created_by_type in ('ai', 'staff', 'system')),
  created_by_staff_id uuid references staff (id) on delete set null,
  completed_at       timestamptz,
  cancelled_at       timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index followups_pending_due_idx on followups (scheduled_for) where status = 'pending';
create index followups_customer_idx on followups (customer_id, scheduled_for desc);
create index followups_lead_idx on followups (lead_id) where lead_id is not null;
create trigger followups_set_updated_at before update on followups
  for each row execute function zj_set_updated_at();

-- ---------------------------------------------------------------------------
-- orders
-- ---------------------------------------------------------------------------
create table orders (
  id                 uuid primary key default gen_random_uuid(),
  order_number       text not null,
  customer_id        uuid not null references customers (id) on delete restrict,
  lead_id            uuid references leads (id) on delete set null,
  status             text not null default 'draft' check (status in
                       ('draft', 'pending_confirmation', 'confirmed', 'in_production', 'ready',
                        'delivered', 'cancelled', 'refunded')),
  payment_status     text not null default 'unpaid' check (payment_status in
                       ('unpaid', 'partially_paid', 'paid', 'refunded')),
  currency           text not null default 'PKR' check (currency ~ '^[A-Z]{3}$'),
  subtotal           numeric(14, 2) not null default 0 check (subtotal >= 0),
  discount_total     numeric(14, 2) not null default 0 check (discount_total >= 0),
  tax_total          numeric(14, 2) not null default 0 check (tax_total >= 0),
  total              numeric(14, 2) not null default 0 check (total >= 0),
  assigned_staff_id  uuid references staff (id) on delete set null,
  notes              text,
  confirmed_at       timestamptz,
  delivered_at       timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint orders_total_consistency check (total = subtotal - discount_total + tax_total)
);
create unique index orders_order_number_key on orders (order_number);
create index orders_customer_idx on orders (customer_id, created_at desc);
create index orders_status_idx on orders (status);
create trigger orders_set_updated_at before update on orders
  for each row execute function zj_set_updated_at();

create table order_items (
  id            uuid primary key default gen_random_uuid(),
  order_id      uuid not null references orders (id) on delete cascade,
  -- Nullable for bespoke/custom items that are not catalogue products.
  product_id    uuid references products (id) on delete restrict,
  sku_snapshot  text,
  description   text not null,
  quantity      integer not null check (quantity > 0),
  unit_price    numeric(14, 2) not null check (unit_price >= 0),
  line_total    numeric(14, 2) not null check (line_total >= 0),
  created_at    timestamptz not null default now(),
  constraint order_items_line_total check (line_total = unit_price * quantity)
);
create index order_items_order_idx on order_items (order_id);

-- ---------------------------------------------------------------------------
-- approvals
-- ---------------------------------------------------------------------------
create table approvals (
  id                     uuid primary key default gen_random_uuid(),
  action_type            text not null check (action_type in
                           ('discount', 'refund', 'price_change', 'gold_rate_change', 'payment_change',
                            'cancellation', 'delete_product', 'delete_order',
                            'high_risk_complaint_response', 'advertising_spend', 'bulk_marketing',
                            'banking_details_change', 'other')),
  status                 text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  requested_by_type      text not null check (requested_by_type in ('ai', 'staff', 'system')),
  requested_by_staff_id  uuid references staff (id) on delete set null,
  customer_id            uuid references customers (id) on delete set null,
  lead_id                uuid references leads (id) on delete set null,
  conversation_id        uuid references conversations (id) on delete set null,
  reason                 text not null check (length(btrim(reason)) > 0),
  payload                jsonb not null default '{}'::jsonb,
  decided_by_staff_id    uuid references staff (id) on delete set null,
  decided_at             timestamptz,
  decision_note          text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint approvals_decision_consistency check (
    (status = 'pending' and decided_at is null)
    or (status in ('approved', 'rejected') and decided_at is not null and decided_by_staff_id is not null)
    or (status = 'cancelled' and decided_at is not null)
  )
);
create index approvals_pending_idx on approvals (created_at) where status = 'pending';
create trigger approvals_set_updated_at before update on approvals
  for each row execute function zj_set_updated_at();

-- ---------------------------------------------------------------------------
-- agent_actions — append-only audit log
-- ---------------------------------------------------------------------------
create table agent_actions (
  id                 uuid primary key default gen_random_uuid(),
  action_type        text not null,
  tool_name          text,
  actor_type         text not null check (actor_type in ('ai', 'staff', 'system')),
  actor_staff_id     uuid references staff (id) on delete set null,
  -- Which agent acted (e.g. 'sales_agent'); supports the future multi-agent setup.
  agent_name         text,
  customer_id        uuid references customers (id) on delete set null,
  lead_id            uuid references leads (id) on delete set null,
  conversation_id    uuid references conversations (id) on delete set null,
  approval_id        uuid references approvals (id) on delete set null,
  input              jsonb not null default '{}'::jsonb,
  output             jsonb not null default '{}'::jsonb,
  status             text not null check (status in ('succeeded', 'failed', 'pending_approval', 'rejected')),
  requires_approval  boolean not null default false,
  error_message      text,
  request_id         text,
  created_at         timestamptz not null default now()
);
create index agent_actions_customer_idx on agent_actions (customer_id, created_at desc) where customer_id is not null;
create index agent_actions_conversation_idx on agent_actions (conversation_id, created_at desc) where conversation_id is not null;
create index agent_actions_type_idx on agent_actions (action_type, created_at desc);

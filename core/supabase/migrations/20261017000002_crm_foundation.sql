-- Zarghoon AI — CRM foundation.
--
-- Adds identity matching, auditable lead scoring, human handoff records and
-- database-level guards that back up the application's business rules.

-- ---------------------------------------------------------------------------
-- Customer-level do-not-contact.
-- A do-not-contact request is about the person, not one sales opportunity,
-- so it is stored on the customer and blocks follow-ups for every lead.
-- ---------------------------------------------------------------------------
alter table customers
  add column do_not_contact     boolean not null default false,
  add column do_not_contact_at  timestamptz;

-- ---------------------------------------------------------------------------
-- External identities (Instagram/Facebook/TikTok IDs, website visitor IDs…).
-- Phone, WhatsApp and email live on customers with their own unique indexes.
-- ---------------------------------------------------------------------------
create table customer_identities (
  id              uuid primary key default gen_random_uuid(),
  customer_id     uuid not null references customers (id) on delete cascade,
  identity_type   text not null check (identity_type in
                    ('website_visitor', 'instagram', 'facebook', 'tiktok', 'google', 'other')),
  identity_value  text not null check (length(btrim(identity_value)) > 0),
  is_verified     boolean not null default false,
  created_at      timestamptz not null default now()
);
create unique index customer_identities_key on customer_identities (identity_type, identity_value);
create index customer_identities_customer_idx on customer_identities (customer_id);

-- ---------------------------------------------------------------------------
-- Leads: at most one active (non-terminal) lead per customer. This is what
-- "the active lead" in Customer 360 refers to.
-- ---------------------------------------------------------------------------
create unique index leads_one_active_per_customer on leads (customer_id)
  where status not in ('won', 'lost', 'do_not_contact');

-- ---------------------------------------------------------------------------
-- Lead signal events — the audit trail behind every lead score.
-- Each signal can contribute to a lead's score at most once; the unique index
-- makes duplicate scoring impossible even under concurrent requests.
-- ---------------------------------------------------------------------------
create table lead_signal_events (
  id                 uuid primary key default gen_random_uuid(),
  lead_id            uuid not null references leads (id) on delete cascade,
  signal             text not null check (signal in
                       ('asked_price', 'provided_budget', 'specific_product_interest', 'asked_availability',
                        'provided_contact', 'asked_shop_location', 'asked_about_visit',
                        'asked_about_payment_or_order', 'repeated_product_interest',
                        'requested_human_salesperson')),
  -- Points awarded at the time of recording (copied from the deterministic
  -- scoring table in code) — kept for audit.
  points             smallint not null check (points between 0 and 100),
  source_message_id  uuid references messages (id) on delete set null,
  recorded_by_type   text not null check (recorded_by_type in ('ai', 'staff', 'system')),
  recorded_by_staff_id uuid references staff (id) on delete set null,
  evidence           text,
  created_at         timestamptz not null default now()
);
create unique index lead_signal_events_once_per_lead on lead_signal_events (lead_id, signal);

-- ---------------------------------------------------------------------------
-- Follow-ups: at most one *pending* follow-up of a given type per
-- customer/lead pair. Prevents accidental duplicate scheduling.
-- ---------------------------------------------------------------------------
create unique index followups_one_pending_per_type on followups
  (customer_id, coalesce(lead_id, '00000000-0000-0000-0000-000000000000'::uuid), followup_type)
  where status = 'pending';

-- ---------------------------------------------------------------------------
-- Human handoffs
-- ---------------------------------------------------------------------------
create table handoffs (
  id                 uuid primary key default gen_random_uuid(),
  conversation_id    uuid not null references conversations (id) on delete cascade,
  customer_id        uuid references customers (id) on delete set null,
  lead_id            uuid references leads (id) on delete set null,
  reason             text not null check (reason in
                       ('customer_requested', 'discount_request', 'complaint', 'payment_issue',
                        'custom_order', 'high_value_lead', 'low_ai_confidence', 'manager_requested', 'other')),
  urgency            text not null default 'normal' check (urgency in ('normal', 'high', 'urgent')),
  status             text not null default 'open' check (status in ('open', 'resolved')),
  note               text,
  requested_by_type  text not null check (requested_by_type in ('ai', 'staff', 'system')),
  requested_by_staff_id uuid references staff (id) on delete set null,
  assigned_staff_id  uuid references staff (id) on delete set null,
  resolved_at        timestamptz,
  resolved_by_staff_id uuid references staff (id) on delete set null,
  created_at         timestamptz not null default now(),
  constraint handoffs_resolved_consistency check ((status = 'resolved') = (resolved_at is not null))
);
create index handoffs_open_idx on handoffs (urgency, created_at) where status = 'open';
create index handoffs_conversation_idx on handoffs (conversation_id, created_at desc);
create index handoffs_customer_idx on handoffs (customer_id) where customer_id is not null;

-- ---------------------------------------------------------------------------
-- Guard: no AI-authored messages while a human has taken over the
-- conversation. The application checks this first; the trigger guarantees it.
-- ---------------------------------------------------------------------------
create or replace function zj_block_ai_message_during_takeover() returns trigger
language plpgsql as $$
declare
  takeover boolean;
begin
  if new.sender_type = 'ai' then
    select human_takeover into takeover from conversations where id = new.conversation_id;
    if takeover then
      raise exception 'human takeover active for conversation %', new.conversation_id
        using errcode = 'P0001', hint = 'ZJ_HUMAN_TAKEOVER_ACTIVE';
    end if;
  end if;
  return new;
end;
$$;
create trigger messages_block_ai_during_takeover before insert on messages
  for each row execute function zj_block_ai_message_during_takeover();

-- ---------------------------------------------------------------------------
-- Guard: agent_actions is append-only.
-- ---------------------------------------------------------------------------
create or replace function zj_agent_actions_append_only() returns trigger
language plpgsql as $$
begin
  raise exception 'agent_actions is append-only' using errcode = 'P0001', hint = 'ZJ_AUDIT_APPEND_ONLY';
end;
$$;
create trigger agent_actions_no_update before update or delete on agent_actions
  for each row execute function zj_agent_actions_append_only();

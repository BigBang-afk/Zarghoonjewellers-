-- Zarghoon AI — follow-up engine (Phase 1, Step 9).
--
-- Adds what the existing follow-up model lacks for safe automation:
--  * contact consent and an identity-review flag on customers,
--  * purpose, priority, idempotency and worker-processing state on follow-ups,
--  * opt-in follow-up sequences (e.g. day 1 / 3 / 7), created only by staff,
--  * versioned message drafts that staff review (nothing is ever sent here),
--  * internal dashboard notifications, and owner-editable engine settings.
-- Existing rows keep working: new columns have safe defaults
-- (consent "unknown" means no automated outreach until staff record consent).

-- ---------------------------------------------------------------------------
-- Customers: messaging consent + identity review
-- ---------------------------------------------------------------------------
alter table customers
  add column contact_consent         text not null default 'unknown'
                                     check (contact_consent in ('unknown', 'granted', 'denied')),
  add column contact_consent_at      timestamptz,
  add column contact_consent_source  text check (contact_consent_source is null or length(contact_consent_source) <= 200),
  add column identity_review_required boolean not null default false;

-- ---------------------------------------------------------------------------
-- Opt-in sequences. Only the next step exists as a follow-up at any time, so
-- the existing "one pending follow-up per type" rule still holds.
-- ---------------------------------------------------------------------------
create table followup_enrollments (
  id                   uuid primary key default gen_random_uuid(),
  customer_id          uuid not null references customers (id) on delete restrict,
  lead_id              uuid references leads (id) on delete set null,
  product_id           uuid references products (id) on delete set null,
  purpose              text not null,
  step_days            smallint[] not null check (cardinality(step_days) between 1 and 5),
  next_step            smallint not null default 1 check (next_step >= 1),
  status               text not null default 'active' check (status in ('active', 'completed', 'stopped')),
  stopped_reason       text,
  created_by_staff_id  uuid not null references staff (id) on delete restrict,
  idempotency_key      text not null check (length(idempotency_key) between 8 and 200),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create unique index followup_enrollments_idempotency_key on followup_enrollments (idempotency_key);
create unique index followup_enrollments_one_active on followup_enrollments (customer_id, purpose) where status = 'active';
create trigger followup_enrollments_set_updated_at before update on followup_enrollments
  for each row execute function zj_set_updated_at();

-- ---------------------------------------------------------------------------
-- Follow-ups: purpose, priority, idempotency, processing state
-- ---------------------------------------------------------------------------
alter table followups
  add column purpose              text check (purpose is null or purpose in (
                                    'new_inquiry', 'product_interest', 'bridal', 'price_inquiry', 'availability_inquiry',
                                    'visit_request', 'custom_order', 'staff_callback', 'post_purchase_care', 'review_request')),
  add column priority             text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  add column product_id           uuid references products (id) on delete set null,
  add column enrollment_id        uuid references followup_enrollments (id) on delete set null,
  add column sequence_step        smallint check (sequence_step is null or sequence_step between 1 and 5),
  add column idempotency_key      text check (idempotency_key is null or length(idempotency_key) between 8 and 200),
  -- Worker state, separate from status (pending/completed/cancelled/skipped).
  -- A draft being ready never completes a follow-up.
  add column processing_state     text not null default 'scheduled' check (processing_state in
                                    ('scheduled', 'processing', 'awaiting_review', 'approved', 'reminder_due', 'blocked', 'failed')),
  add column processing_attempts  smallint not null default 0 check (processing_attempts >= 0),
  add column locked_until         timestamptz,
  add column locked_by            text check (locked_by is null or length(locked_by) <= 100),
  add column last_processed_at    timestamptz,
  add column last_error_code      text check (last_error_code is null or length(last_error_code) <= 100),
  add column blocked_reason       text check (blocked_reason is null or length(blocked_reason) <= 100),
  add column quiet_hours_adjusted boolean not null default false,
  add column customer_replied_at  timestamptz,
  -- Staff reviewed the reply (e.g. by rescheduling): earlier replies no longer hold this follow-up.
  add column reply_acknowledged_at timestamptz;
create unique index followups_idempotency_key on followups (idempotency_key) where idempotency_key is not null;
create index followups_due_for_processing_idx on followups (scheduled_for)
  where status = 'pending' and processing_state in ('scheduled', 'failed');

-- ---------------------------------------------------------------------------
-- Drafts: versioned, reviewed by staff, never sent by this system.
-- ---------------------------------------------------------------------------
create table followup_drafts (
  id                    uuid primary key default gen_random_uuid(),
  followup_id           uuid not null references followups (id) on delete cascade,
  version               smallint not null check (version >= 1),
  language              text not null check (language in ('english', 'urdu', 'roman_urdu')),
  content               text not null check (length(btrim(content)) between 1 and 1000),
  status                text not null default 'pending_review'
                        check (status in ('pending_review', 'approved', 'rejected', 'superseded')),
  author_type           text not null check (author_type in ('ai', 'template', 'staff')),
  author_staff_id       uuid references staff (id) on delete set null,
  model                 text check (model is null or length(model) <= 100),
  -- What produced this draft (worker run, staff request…): the same event never drafts twice.
  source_event_key      text not null check (length(source_event_key) between 1 and 200),
  -- The verified facts the draft was allowed to use, and validation notes.
  facts                 jsonb not null default '{}'::jsonb check (jsonb_typeof(facts) = 'object'),
  validation            jsonb not null default '{}'::jsonb check (jsonb_typeof(validation) = 'object'),
  rationale             text check (rationale is null or length(rationale) <= 1000),
  reviewed_by_staff_id  uuid references staff (id) on delete set null,
  reviewed_at           timestamptz,
  review_note           text check (review_note is null or length(review_note) <= 2000),
  created_at            timestamptz not null default now(),
  constraint followup_drafts_author_staff check (author_type <> 'staff' or author_staff_id is not null),
  constraint followup_drafts_review_consistency check (
    (status in ('approved', 'rejected')) = (reviewed_at is not null and reviewed_by_staff_id is not null)
    or status = 'superseded'
  )
);
create unique index followup_drafts_event_key on followup_drafts (followup_id, source_event_key);
create unique index followup_drafts_version_key on followup_drafts (followup_id, version);
create unique index followup_drafts_one_live on followup_drafts (followup_id) where status in ('pending_review', 'approved');
create index followup_drafts_review_idx on followup_drafts (created_at) where status = 'pending_review';

-- A follow-up that is no longer pending (completed, cancelled, skipped) can
-- never be acted on, so its open drafts are superseded — whatever closed it.
create or replace function zj_supersede_drafts_of_closed_followup() returns trigger
language plpgsql as $$
begin
  if old.status = 'pending' and new.status <> 'pending' then
    update followup_drafts set status = 'superseded'
     where followup_id = new.id and status in ('pending_review', 'approved');
  end if;
  return new;
end;
$$;
create trigger followups_supersede_drafts after update of status on followups
  for each row execute function zj_supersede_drafts_of_closed_followup();

-- ---------------------------------------------------------------------------
-- Internal dashboard notifications (no external delivery).
-- ---------------------------------------------------------------------------
create table notifications (
  id                 uuid primary key default gen_random_uuid(),
  kind               text not null check (kind in
                       ('high_priority_followup', 'overdue_followup', 'human_attention', 'draft_awaiting_review', 'processing_failed')),
  severity           text not null default 'info' check (severity in ('info', 'warning', 'critical')),
  title              text not null check (length(title) between 1 and 200),
  body               text check (body is null or length(body) <= 1000),
  customer_id        uuid references customers (id) on delete set null,
  followup_id        uuid references followups (id) on delete cascade,
  handoff_id         uuid references handoffs (id) on delete cascade,
  -- Assigned staff member; null = owner/admin/manager queue.
  audience_staff_id  uuid references staff (id) on delete set null,
  dedupe_key         text not null check (length(dedupe_key) between 1 and 200),
  created_at         timestamptz not null default now(),
  resolved_at        timestamptz
);
create unique index notifications_dedupe_key on notifications (dedupe_key);
create index notifications_open_idx on notifications (created_at desc) where resolved_at is null;

create table notification_reads (
  notification_id  uuid not null references notifications (id) on delete cascade,
  staff_id         uuid not null references staff (id) on delete cascade,
  read_at          timestamptz not null default now(),
  primary key (notification_id, staff_id)
);

-- ---------------------------------------------------------------------------
-- Engine settings (single row; owner/admin editable). Times are business-local.
-- ---------------------------------------------------------------------------
create table followup_settings (
  id                       boolean primary key default true check (id),
  timezone                 text not null default 'Asia/Karachi' check (length(timezone) between 1 and 64),
  quiet_hours_enabled      boolean not null default true,
  quiet_hours_start        time not null default '21:00',
  quiet_hours_end          time not null default '10:00',
  default_sequence_days    smallint[] not null default '{1,3,7}' check (cardinality(default_sequence_days) between 1 and 5),
  max_processing_attempts  smallint not null default 3 check (max_processing_attempts between 1 and 10),
  updated_by_staff_id      uuid references staff (id) on delete set null,
  updated_at               timestamptz not null default now()
);
insert into followup_settings default values;

do $$
declare
  t text;
  r text;
begin
  foreach t in array array['followup_enrollments', 'followup_drafts', 'notifications', 'notification_reads', 'followup_settings'] loop
    execute format('alter table %I enable row level security', t);
    foreach r in array array['anon', 'authenticated'] loop
      if exists (select 1 from pg_roles where rolname = r) then
        execute format('revoke all on table %I from %I', t, r);
      end if;
    end loop;
  end loop;
end;
$$;

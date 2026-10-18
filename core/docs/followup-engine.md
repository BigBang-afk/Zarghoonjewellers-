# AI-powered follow-up engine (Phase 1, Step 9)

The follow-up engine works out which customers need a follow-up, prepares a personalised message draft, and gives staff a review and approval workflow. **It never sends anything.** WhatsApp, SMS, email, Instagram and Facebook are not connected. An approved draft waits, marked "approved — not sent", for a future permitted channel.

```
customer asks about a necklace → conversation saved → lead + product interest recorded
→ recommendation (fixed rules) → staff schedule a follow-up (or a Day 1/3/7 sequence)
→ worker: when due, re-check eligibility → draft (Claude or template) → validate
→ staff review: edit / approve / reject / reschedule / cancel / complete
→ approved: ready for a future channel (not sent)
```

## Who decides what

| Decision | Made by |
| --- | --- |
| May this customer be followed up at all? | **Deterministic code** (`policy.ts`). Never the model. |
| What kind of follow-up, priority, reason | Deterministic recommendation from stored records (`recommendations.ts`) |
| Whether a follow-up exists | An authorised staff member. Customers are never enrolled automatically. |
| The wording of the message | Claude (or the offline templates), from a verified fact sheet |
| Whether the wording is acceptable | Deterministic validator, then a staff member |
| Sending | Nobody. Not implemented. |

### Eligibility rules (`policy.ts`)

These **block** a follow-up from being created or processed:

| Code | Rule |
| --- | --- |
| `do_not_contact` | The customer, or the lead, opted out. Every follow-up is cancelled and sequences stop. |
| `consent_denied` | The customer declined messages. All follow-ups are cancelled. |
| `consent_missing` | No consent recorded (the default for existing customers). Customer outreach is not allowed; internal staff callbacks are. |
| `identity_review` | The customer's identity is flagged as uncertain. No outreach. |
| `lead_closed` | Sales follow-ups stop when the lead is won or lost, or the customer buys after scheduling. |
| `no_purchase` | Post-purchase care needs a confirmed order; a review request needs a delivered one. |
| `frequency_limit` | At most 3 customer follow-ups per 7 days. |

These **hold** a follow-up: nothing is drafted automatically, and the assigned staff member is notified.

| Code | Rule |
| --- | --- |
| `human_takeover` | A person is handling the conversation. Internal reminders continue. |
| `customer_replied` | The customer wrote since the follow-up was scheduled. Open drafts are withdrawn and sequences stop. Rescheduling acknowledges the reply and re-arms the follow-up. |

### Follow-up types

`new_inquiry`, `product_interest`, `bridal`, `price_inquiry`, `availability_inquiry`, `visit_request`, `custom_order`, `staff_callback` (internal), `post_purchase_care`, and `review_request`.

Each type maps onto the existing `followup_type`, so the existing rule of one pending follow-up per type per lead still prevents duplicates.

## Drafting (`drafting.ts`)

- **Fact sheet:**
  - the customer's stored name and preferred language (English if unknown, and the draft says so);
  - the interested piece's name and SKU;
  - the price only when an approved price exists;
  - availability only when stored stock allows promising it, otherwise "needs confirmation";
  - the customer's last message and the staff note.
- **Claude** (`claude-opus-5-5` via the shared client, effort `low` by default, server-side refusal fallback on):
  - submits through a `strict` `submit_draft` tool;
  - automatic tool choice, since forced tool choice is not available on this model;
  - its brand voice is premium, friendly, respectful and never pushy.
- **Validator:** rejects any number that is not a verified price, plus percentages, discounts or offers, gold rates, delivery promises, urgency or limited-stock claims, guarantees, links or contact details, availability claims without stock, and the wrong language or script.
- **One correction attempt**, then a reviewed **safe template**. Every template passes the validator in all 3 languages.
- **Provider errors** (network or rate limit) are thrown, so the worker retries. An unvalidated draft is never stored.
- **Offline mode:** without `ANTHROPIC_API_KEY`, or with `ZARGHOON_FOLLOWUP_DRAFTER=template`, only templates are used. The dashboard labels them "not AI".

## Worker (`worker.ts`, `npm run followups:worker`)

- **Claiming:**
  - uses `FOR UPDATE SKIP LOCKED` plus a 5-minute lease, so several workers can run safely;
  - a crashed worker's lease simply expires and another worker picks the follow-up up.
- **Re-checks** eligibility for every due follow-up, then does one of:
  - cancels it (opt-out, closed lead, purchase);
  - holds it (no consent, takeover, reply);
  - raises a reminder (internal callback);
  - drafts it, idempotently per follow-up and due time.
- **Failures:**
  - only an error code is recorded, never message content;
  - retried with back-off (1, 5, 15, 60 minutes) up to `max_processing_attempts` (default 3);
  - after that, a `processing_failed` notification.
- **Notifications** are raised for overdue follow-ups and customers waiting for a person, and resolve automatically.
- It **never** completes a follow-up and never sends anything.

```bash
cd core
ZARGHOON_CORE_DATABASE_URL=… npm run followups:worker -- --env staging --once          # e.g. from cron
ZARGHOON_CORE_DATABASE_URL=… npm run followups:worker -- --env staging --interval 60   # long-running
```

It refuses to run if the database label differs from `--env` or migrations are pending.

## Duplicate protection

| Risk | Protection |
| --- | --- |
| Retried "schedule" request | `followups.idempotency_key` is unique; a retry returns the original. |
| Double-submitted form | One request key per form render (scheduling, drafting, editing). |
| Two pending sales follow-ups for one lead | Existing unique index `followups_one_pending_per_type`. |
| Duplicate drafts for the same event | Unique `(followup_id, source_event_key)`; only one live draft per follow-up. |
| Two sequences for the same thing | One active enrollment per customer and purpose; enrollment idempotency key. |
| Two workers on the same follow-up | `SKIP LOCKED` claim plus lease; every final write checks the lease. |
| Duplicate notifications | Unique `dedupe_key`. |

## Time

- All timestamps are stored in UTC.
- "Today", quiet hours and staff-entered times use the business time zone (`followup_settings.timezone`, default `Asia/Karachi`).
- Customer follow-ups that fall inside quiet hours (default 21:00–10:00, configurable by the owner or admin) move to the next allowed time. Internal reminders are not moved.
- A customer's own time zone is never assumed.

## Data model (migration `20261020000001_followup_engine.sql`)

- **`customers`:** `contact_consent` (`unknown`, `granted` or `denied`), plus its time and source, and `identity_review_required`.
- **`followups`:**
  - `purpose`, `priority`, `product_id`;
  - sequence fields;
  - `idempotency_key`;
  - processing state, attempts, lease, last error code and block reason;
  - quiet-hours flag;
  - reply timestamps.
- **New tables:** `followup_enrollments`, `followup_drafts` (versioned), `notifications` and `notification_reads`, `followup_settings`.
- **Trigger:** when a follow-up stops being pending, its open drafts are superseded.

## Analytics

Draft creation and staff approval are counted. **Delivery, response time and follow-up-to-sale conversion show "Not available"**: nothing is delivered yet, so a reply cannot honestly be attributed to a message. The count of customers who replied after a follow-up was scheduled is shown as an observation, not an attribution.

## Tests

| File | Covers |
| --- | --- |
| `tests/unit/businessTime.test.ts` | Time zones and quiet hours |
| `tests/unit/followupDrafting.test.ts` | Validator, missing price, unknown stock, Claude drafter with a scripted model, fallback, languages |
| `tests/integration/followupEngine.test.ts` | Eligibility, do-not-contact, consent, duplicates, purchase, reply, takeover, scheduling, quiet hours, approval, editing, rescheduling, completion, audit, no external calls |
| `tests/integration/followupWorker.test.ts` | Retries, concurrent workers, database failure and lease recovery |
| `tests/integration/followupDashboard.test.ts` | Authorization, data isolation, notifications, analytics, demo isolation |

None of them needs an API key.

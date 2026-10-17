# Zarghoon AI — CRM Foundation

This document describes how the CRM layer of Zarghoon AI works: what the rules
are, where they are enforced, and why. Everything here is implemented in
deterministic TypeScript services over PostgreSQL. None of it lives in a
prompt. The future Sales Agent will call these services through validated
tools. It will never write SQL or decide business facts itself.

Code: `src/services/crm/`. Tests: `tests/integration/*` and `tests/unit/leadScoring.test.ts`.

---

## 1. Principles

| Principle | How it is enforced |
| --- | --- |
| Database is the source of truth | Every read returns stored values. Unknown fields stay `null`/`[]`. |
| No hallucinated facts | Services only accept IDs that exist (FKs + explicit lookups). Scores are computed, not supplied. |
| Deterministic rules in code | Scoring, status promotion, follow-up eligibility and identity matching are pure code with tests. |
| Defence in depth | Key rules are also database constraints/triggers (one active lead, one signal per lead, AI blocked during takeover, append-only audit). |
| Auditable | Every mutation writes an `agent_actions` row (actor, request ID, input, output), with secrets redacted. |
| Human control | Sensitive operations are staff-only or need an approval; the AI can always *stop itself* but never override a human. |

Every mutating call takes an `ActionContext`:

```ts
{ actor: { type: "ai", agentName: "sales_agent" } | { type: "staff", staffId } | { type: "system" },
  requestId?: string, toolName?: string }
```

---

## 2. Customer lifecycle

```
identifiers arrive (phone / WhatsApp / email / external ID)
        │
        ▼
 normalize  ──►  resolveIdentity  ──►  none      → create customer
                                  ├─►  match     → return existing (unchanged)
                                  └─►  conflict  → CustomerIdentityConflictError + audit
```

**Fields:** name, phone, WhatsApp number, email, city, preferred language,
notes, last contact, do-not-contact, and external identities (separate
`customer_identities` table).

**Normalization** (`src/lib/identifiers.ts`)

- Phone and WhatsApp numbers are normalized to E.164 with `libphonenumber-js`.
  Numbers without a country code are read as Pakistani: `0300-1234567`,
  `923001234567` and `0092 300 1234567` all become `+923001234567`. Invalid
  numbers are rejected, never stored half-parsed.
- Emails are trimmed and lowercased.
- Instagram/TikTok handles lose a leading `@` and are lowercased. Opaque
  platform IDs are only trimmed.

**Creation rules**

- At least one identifier (phone, WhatsApp, email or external identity) is
  required. A record that can never be matched again is useless and
  encourages duplicates.
- Missing data is never filled in. A customer created from a WhatsApp number
  has `phone = null`, not a copy of the WhatsApp number.
- `createCustomer` returns `{ outcome: "created" | "existing", customer }`.
  When an existing customer matches, **nothing on that record is changed**.
  New details are applied with an explicit `updateCustomer` call.

**Preferred language** is one of `english | urdu | roman_urdu | unknown` and
starts as `unknown`. It is never inferred permanently from one message:

- Each message stores its own detected `language`, and that never propagates
  to the profile.
- `setPreferredLanguage` can be called by staff freely. An AI actor must cite
  `evidenceMessageId`, an **inbound** message from **this** customer in which
  they stated the preference. Otherwise the call is rejected.

**Do-not-contact** is a property of the person:

- `customers.setDoNotContact` (any actor) or `leads.markLeadDoNotContact`
  flags the customer, closes the active lead as `do_not_contact`, and cancels
  every pending follow-up, all in one transaction.
- New leads cannot be opened for a do-not-contact customer.
- Only staff can lift the flag (`clearDoNotContact`), and a reason is required.

---

## 3. Identity matching and conflict handling

`resolveIdentity` looks up **every** supplied identifier:

- Phone and WhatsApp share one namespace: a WhatsApp number that equals
  another customer's phone number is treated as the same identifier.
- Email is matched exactly after normalization.
- External identities are matched on `(identity_type, identity_value)`.

| Distinct customers matched | Result |
| --- | --- |
| 0 | `none` → safe to create |
| 1 | `match` → that customer |
| 2+ | `conflict` → `CustomerIdentityConflictError` |

**Conflicts are never merged automatically.** The error carries the matching
customer IDs and which identifier matched which record. A
`customer_identity_conflict` row is written to the audit log (outside the
rolled-back transaction) so staff can review it. Merging will be a
deliberate, approved operation in a later phase.

The same check guards `updateCustomer` and `linkExternalIdentity`: you cannot
give customer B an identifier that belongs to customer A. Unique indexes on
`phone`, `whatsapp_number`, `email` and `(identity_type, identity_value)` back
this up under concurrency. If two requests race, the loser re-resolves and
gets the match or the conflict.

> Known limitation: two family members genuinely sharing one phone cannot both
> hold it. That is intentional for now, because it prevents silent duplicates.
> Staff can record the second person with a different identifier.

---

## 4. Lead lifecycle

```
            ┌──────── signals raise the score ────────┐
 new ──► (warm) ──► (hot) ──► (very_hot)              │
  │                                                    │
  ├── qualified / waiting_customer / human_followup  (set by staff, AI or workflow)
  │
  └──► won | lost | do_not_contact      (terminal)
```

- **One active lead per customer**: a partial unique index over non-terminal
  statuses enforces it. `createLead` returns `ActiveLeadExistsError` carrying
  the existing lead's ID.
- **Status promotion is automatic and one-way**: while a lead is in a
  temperature status (`new`, `qualified`, `warm`, `hot`, `very_hot`), its
  status follows the score's classification *upwards only*. Workflow statuses
  (`waiting_customer`, `human_followup`) and terminal statuses are never
  changed by scoring.
- **Who can set what**:
  - The AI may set only `waiting_customer` directly.
  - Staff may set any non-terminal status.
  - `won` and `lost` are only reachable through `markLeadWon` / `markLeadLost`,
    which are **staff/system only**. The AI cannot declare a sale.
  - `lost` requires a reason.
- **Closing a lead** cancels its pending `sales` follow-ups. `after_sales`,
  `order_update` and `service` follow-ups are kept.
- A stated budget (`budgetAmount`, decimal-safe) automatically records the
  `provided_budget` signal.

Queries: `getHotLeads()` returns active leads classified hot or very_hot, by
score. `getLeadsNeedingFollowup()` returns active leads that are warm or
better, or in `human_followup` / `waiting_customer`, have no pending
follow-up, and whose customer is not do-not-contact.

---

## 5. Deterministic lead scoring

`src/services/crm/leadScoring.ts` is a pure function with no I/O and no AI.

| Signal | Points |
| --- | --- |
| asked_price | 10 |
| provided_budget | 15 |
| specific_product_interest | 15 |
| asked_availability | 15 |
| provided_contact | 10 |
| asked_shop_location | 10 |
| asked_about_visit | 20 |
| asked_about_payment_or_order | 20 |
| repeated_product_interest | 10 |
| requested_human_salesperson | 15 |

- Each signal counts **once per lead**.
- The score is capped at **100**. `uncappedScore` is reported for transparency.
- Classification: 0–20 `cold`, 21–50 `warm`, 51–75 `hot`, 76–100 `very_hot`.

```json
{
  "score": 40,
  "classification": "warm",
  "uncappedScore": 40,
  "breakdown": [
    { "signal": "asked_price", "points": 10 },
    { "signal": "provided_budget", "points": 15 },
    { "signal": "asked_availability", "points": 15 }
  ]
}
```

**Audit trail.** Every signal is a row in `lead_signal_events`: the signal,
the points awarded, the source message, who recorded it, and free-text
evidence. `leads.score` and `leads.score_classification` are only a cache.
`getLeadScore()` and Customer 360 recompute from the events.

**Duplicate prevention.** A unique index on `(lead_id, signal)` makes double
scoring impossible, even with concurrent requests. Recording a signal twice
raises `DuplicateLeadSignalError`. Internal callers that derive signals
automatically use an idempotent path (`ON CONFLICT DO NOTHING`).

Signals cannot be recorded on closed (won/lost/do_not_contact) leads.

---

## 6. Product interests

`recordProductInterest` stores what a customer actually engaged with:
`viewed`, `asked_price`, `asked_availability`, `shortlisted`,
`requested_similar` or `requested_customization`.

- The product must exist (by `productId` **or** `sku`, exactly one).
  Invented IDs fail with `ProductNotFound`.
- The interest attaches to the customer's active lead automatically, unless
  a lead is given. The lead, conversation and message must belong to that
  customer, so cross-customer writes are rejected.
- The same interest from the same message is recorded once (idempotent).

Interests feed scoring deterministically:

| Interest | Signals recorded on the active lead |
| --- | --- |
| viewed | none (browsing is not intent) |
| asked_price | asked_price, specific_product_interest |
| asked_availability | asked_availability, specific_product_interest |
| shortlisted / requested_similar / requested_customization | specific_product_interest |
| any non-`viewed` interest in a product the customer already engaged with | + repeated_product_interest |

---

## 7. Conversations and messages

- Channels: `website`, `whatsapp`, `instagram`, `facebook`, `in_store`,
  `other`. Only website/internal use is active in Phase 1. The model is
  channel-agnostic, so future channel adapters normalize into `addMessage`.
- A conversation can start **anonymous** (`customerId = null`).
  `attachCustomer` links it once the visitor is identified, and refuses to
  re-link it to a different customer.
- `(channel, external_conversation_id)` is unique.
- Messages: `direction` (`inbound` | `outbound`) and `senderType`
  (`customer` | `ai` | `staff` | `system`) must be consistent: inbound
  messages come only from customers. This is enforced in Zod and by a DB
  CHECK. Staff messages must name the staff member.
- `externalMessageId` makes channel redelivery idempotent.
- `metadata` is a JSON object. Anything that looks like a secret
  (`authorization`, `apiKey`, `password`, tokens, connection strings…) is
  **rejected**, and size is capped at 16 KB.
- Closed conversations accept no new messages.
- Adding a message updates `conversations.last_message_at` and
  `customers.last_contact_at`. Inbound messages also bump the lead's
  `last_activity_at`.
- `getRecentMessages(id, n)` returns the last *n* messages in chronological
  order.
- Staff assignment: automated actors may only assign staff who are active
  **and available**. A staff member may deliberately assign any active
  colleague.

---

## 8. Follow-ups

Phase 1 manages follow-up **records only**. Nothing is ever sent to a
customer. `messageDraft` is a suggestion for a human.

`scheduleFollowup` rules:

1. `scheduledFor` must be in the future, at most 365 days ahead, and an ISO
   timestamp **with an explicit offset** (ambiguous local times are
   rejected). Time comes from an injectable clock.
2. Do-not-contact customers or leads get **no** follow-ups of any type, from
   any actor.
3. Won/lost leads get no further `sales` follow-ups. `after_sales`,
   `order_update`, `service` and `other` are still allowed.
4. At most one **pending** follow-up per customer + lead + type. This is
   enforced in code and by a partial unique index. A duplicate returns
   `DuplicateFollowupError` with the existing ID.
5. The lead and conversation must belong to the customer, and assigned staff
   follow the availability rule above.

Statuses go `pending → completed | cancelled | skipped`. Only a pending
follow-up can transition. `getPendingFollowups({ dueBefore, assignedStaffId })`
returns due or overdue items oldest-first.

---

## 9. Customer 360

`getCustomer360(customerId)` returns one consistent read:

| Field | Source |
| --- | --- |
| `customer`, `externalIdentities`, `doNotContact` | customers / customer_identities |
| `activeLead` | the single non-terminal lead, or `null` |
| `leadScore`, `leadClassification`, `leadScoreBreakdown` | **recomputed** from `lead_signal_events` (`null` / `[]` without an active lead) |
| `productInterests` | most recent interests with SKU and name |
| `recentConversations`, `recentMessages` | latest conversations, and the latest conversation's recent messages |
| `pendingFollowups` | pending follow-ups, soonest first |
| `ordersSummary` | counts by state and exact decimal lifetime value per currency (confirmed → delivered orders only) |
| `assignedStaff` | the active lead's owner, else the latest open conversation's |
| `humanTakeoverStatus` | open conversations under takeover and open handoffs |

It contains no inferred preferences, estimates or summaries. This is the
context the Sales Agent will receive in the next phase.

---

## 10. Human takeover and handoff

`requestHumanHandoff({ conversationId, customerId?, leadId?, reason, urgency, note?, preferredStaffId? })`

- Reasons: `customer_requested`, `discount_request`, `complaint`,
  `payment_issue`, `custom_order`, `high_value_lead`, `low_ai_confidence`,
  `manager_requested`, `other`.
- Urgency: `normal`, `high`, `urgent`.

In **one transaction** it:

1. creates a `handoffs` row that preserves the reason, urgency, note and
   requester,
2. sets `human_takeover = true` on the conversation,
3. moves the active lead to `human_followup` (closed leads are left alone).
   For `customer_requested` it also records `requested_human_salesperson`,
4. writes a `human_handoff_requested` audit entry.

While a handoff is open, a repeat request returns the existing handoff
(`alreadyActive: true`) and can only **raise** urgency.

**Autonomous replies are blocked** while takeover is active:
`addMessage` with `senderType: "ai"` throws `HumanTakeoverActiveError` and
writes an `ai_message_blocked` audit record. The database has a trigger that
rejects AI messages too, so even a bug or a direct insert cannot get through.
Staff and customer messages continue normally.

**Staff are never auto-assigned.** A `preferredStaffId` may be named. For
automated actors that person must be active and available, otherwise
`StaffUnavailableError` is raised and nothing changes.

Only staff can end a takeover: `resolveHandoff(id, ctx, { releaseTakeover })`
or `conversations.setHumanTakeover(id, { active: false })`. The AI can
*activate* takeover at any time (stopping is always safe) but can never
release it.

---

## 11. Auditability

`agent_actions` is **append-only**: a trigger rejects UPDATE and DELETE. Each
row records `action_type`, `tool_name`, actor (type, staff ID, agent name),
customer, lead and conversation, approval, `input`, `output`, `status`
(`succeeded` | `failed` | `pending_approval` | `rejected`),
`requires_approval`, `error_message`, `request_id` and a timestamp.

- Inputs and outputs pass through `redact()` before storage. Secret-looking
  keys and credential-looking values become `[REDACTED]`.
- Failed attempts that matter (identity conflicts, blocked AI messages) are
  written **outside** the rolled-back transaction, so they survive.
- Because audit rows reference customers/leads/conversations, those records
  cannot be hard-deleted. Deletion requires a deliberate, approved process.

Action types written today: `customer_created`, `customer_updated`,
`customer_identity_conflict`, `customer_identity_linked`,
`customer_language_set`, `do_not_contact_set`, `do_not_contact_cleared`,
`lead_created`, `lead_updated`, `lead_signal_recorded`, `lead_won`,
`lead_lost`, `product_interest_recorded`, `conversation_created`,
`conversation_customer_attached`, `conversation_staff_assigned`,
`conversation_closed`, `ai_message_sent`, `ai_message_blocked`,
`human_takeover_activated`, `human_takeover_released`,
`human_handoff_requested`, `handoff_escalated`, `handoff_resolved`,
`followup_scheduled`, `followup_completed`, `followup_cancelled`,
`followup_skipped`, `approval_requested`, `approval_approved`,
`approval_rejected`, `approval_cancelled`, `product_import`.

---

## 12. Error types

| Error | Kind | Meaning |
| --- | --- | --- |
| `ValidationError` | validation | Input failed Zod validation; `issues` lists paths. |
| `CustomerNotFound`, `LeadNotFound`, `ProductNotFound`, … | not_found | Referenced record does not exist. |
| `CustomerIdentityConflictError` | conflict | Identifiers match several customers. |
| `ActiveLeadExistsError` | conflict | Customer already has an active lead. |
| `DuplicateLeadSignalError` | conflict | Signal already scored for the lead. |
| `DuplicateFollowupError` | conflict | Same-type pending follow-up exists. |
| `FollowupNotAllowedError` | business_rule | `reason`: past, too far ahead, do-not-contact, lead closed, not pending. |
| `HumanTakeoverActiveError` | business_rule | AI reply attempted during takeover. |
| `DoNotContactError`, `ConversationClosedError`, `InvalidStateError`, `StaffUnavailableError` | business_rule | Other rule violations. |
| `ForbiddenActionError` | forbidden | Actor not allowed (e.g. AI marking a lead won). |
| `ApprovalRequiredError` | approval_required | Action needs an approved approval. |
| `InfrastructureError` / unknown | infrastructure | Hidden behind `INTERNAL_ERROR` by `toPublicError`. |

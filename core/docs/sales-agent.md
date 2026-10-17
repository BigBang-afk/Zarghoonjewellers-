# Zarghoon AI — Sales Agent

The Sales Agent is the Claude-powered assistant that answers Zarghoon
customers. In this phase it runs **internally only**: in tests and in a
command-line playground. It is not connected to WhatsApp, Instagram,
Facebook, TikTok, Google Business, ads or the website, and it never sends
anything to a real customer.

Code: `src/agents/`. Tests: `tests/agents/`, `tests/unit/responseValidator.test.ts`,
`tests/unit/salesSafety.test.ts`, `tests/unit/llmClient.test.ts`.

The core idea: **Claude decides what to say and which tools to call. Code
decides what is allowed, what is true, and what gets recorded.** Every rule
in the system prompt is also enforced in code, so a model mistake is caught
rather than shown to a customer.

---

## 1. Architecture

```
SalesAgentInput { customerId, conversationId?, message, channel, requestId? }
        │
        ▼
salesAgent.handleMessage()                       src/agents/sales/salesAgent.ts
  1. validate input (Zod), load customer, open/verify conversation
  2. store the inbound message (always)
  3. human takeover active? ──► return status "human_takeover_active", no model call
  4. ensure an active lead (skipped for do-not-contact customers)
  5. load Customer 360 + recent messages from the DATABASE
  6. controlled model loop ──► tools (toolExecutor.ts) ──► CRM/product services
  7. validate the final reply against tool data (responseValidator.ts)
  8. deterministic rules: mandatory handoffs, keyword backstop,
     intent-implied lead signals (safety.ts)
  9. store the reply (only if the AI may still speak)
 10. create the handoff (after the reply, so the customer still gets an answer)
 11. read lead score back from the scoring engine; audit the turn
        │
        ▼
SalesAgentResult (Zod-validated)
```

| File | Responsibility |
| --- | --- |
| `llm/llmClient.ts` | `LlmClient` interface + official Anthropic SDK implementation and config |
| `llm/scriptedLlmClient.ts` | Credential-free scripted model for tests and offline demo |
| `sales/types.ts` | Input/output schemas, intents, statuses |
| `sales/salesPrompt.ts` | Static system prompt + per-turn context builder |
| `sales/toolDefinitions.ts` | The closed tool set; Zod schemas generate the JSON schemas |
| `sales/toolExecutor.ts` | Validates, scopes, executes and audits tool calls |
| `sales/responseValidator.ts` | Fact-grounding check on the final reply |
| `sales/safety.ts` | Mandatory handoffs, keyword backstop, language heuristic, safe fallback replies |
| `sales/salesAgent.ts` | Orchestrator and model loop |
| `config/businessInfo.ts` | Owner-approved store facts (address, hours…) — all `null` until configured |
| `demo/` | DEMO fixtures and the offline demo model |

### Model client

`createAnthropicLlmClient` wraps the official `@anthropic-ai/sdk` and calls
the beta Messages endpoint. Configuration comes from the environment:

| Variable | Default | Meaning |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | — (required for live use) | Never logged or stored |
| `SALES_AGENT_MODEL` | `claude-opus-5-5` | Model id |
| `SALES_AGENT_EFFORT` | `medium` | `low` … `max`. This model always thinks adaptively; effort controls depth and cost |
| `SALES_AGENT_MAX_TOKENS` | `8000` | Per model call (includes thinking) |
| `SALES_AGENT_TIMEOUT_MS` | `60000` | Per HTTP request (SDK retries twice) |
| `SALES_AGENT_REFUSAL_FALLBACK` | `true` | Server-side refusal fallback (`fallbacks: "default"`) |

With refusal fallback on, if the API's safety classifiers decline a request,
the API retries it on a fallback model automatically instead of returning
nothing. Set `SALES_AGENT_REFUSAL_FALLBACK=false` to turn it off. A refusal
that still happens is handled as a safe fallback (below).

Provider errors become `LlmProviderError`, with no key in the message.
Tests never need credentials: they inject `ScriptedLlmClient`, or give the
real client a fake `fetch` to inspect the exact request it sends.

---

## 2. The tool loop

- The model gets the static system prompt, the closed tool list, and one
  user message containing the current time, a stored-facts customer
  profile, the conversation so far (from the database), and the new message.
- Each model call may request several tools. Every one is executed, and the
  results go back in a single message. Assistant content (including thinking
  blocks) is passed back unchanged.
- The turn ends only when the model calls **`submit_reply` on its own**.
  Plain text is never sent to a customer: the model is asked to submit, and
  `submit_reply` alongside other tools is rejected, because the reply must
  come *after* the tool results.
- Limits:
  - `maxModelCalls` (default 8), whether calls are spent on tools or on
    corrections.
  - `turnTimeoutMs` (default 120 s): an abort signal cancels the in-flight
    model request.
  - `maxReplyCorrections` (default 2): rejected replies that may be retried.
- **Fail safe:** any of the following sends a fixed, fact-free reply in the
  customer's language (stored with sender `system`, not `ai`) and creates a
  `low_ai_confidence` handoff:
  - model error, refusal, `max_tokens`
  - timeout
  - iteration limit
  - repeated invalid replies
  - unavailable tools

  The result status is `failed_safe`.

---

## 3. Allowed tools

Tool inputs **never contain customer, conversation or lead IDs**. The
executor injects them from the turn, so the model cannot read or write
another customer's data. Every input is Zod-validated and every schema
rejects unknown keys.

| Tool | Does | Audited as |
| --- | --- | --- |
| `get_customer_360` | Profile, active-lead status, interests, follow-ups, order counts, takeover. **No lead score** | `customer_360_viewed` |
| `get_recent_messages` | Current conversation only | — |
| `search_products` | Real catalogue search; price filters only match priced items | `product_search` |
| `get_product` | One product by id/SKU | `product_viewed` |
| `check_inventory` | Stored stock status + `canPromiseInStock` | `inventory_check` |
| `record_product_interest` | Only for product ids a product tool returned this turn | `product_interest_recorded` |
| `record_lead_signal` | Model picks the signal + evidence; engine scores it; duplicates return `already_recorded` | `lead_signal_recorded` |
| `schedule_followup` | Staff task only; nothing is sent | `followup_scheduled` |
| `request_human_handoff` | **Deferred**: created right after the reply is stored | `human_handoff_requested` |
| `get_business_info` | Owner-approved store facts; `null` = needs confirmation | `business_info_viewed` |
| `set_preferred_language` | Only with the current inbound message as evidence (CRM rule) | `customer_language_set` |
| `submit_reply` | Ends the turn (validated, see §5) | `sales_agent_turn` |

Product results never include internal cost fields (making charge, stone
cost).

**`add_message` is orchestrator-only.** Messages are stored by
`salesAgent.ts` through the conversation service: the inbound message first,
then the validated reply. The model has no message-writing tool, so it cannot
fabricate conversation history.

Rejected calls (unknown tool, invalid input, unverified product, business
rule violations) return a structured tool error such as
`INVALID_TOOL_INPUT`, `PRODUCT_NOT_VERIFIED`, `FOLLOWUP_NOT_ALLOWED` or
`UNKNOWN_TOOL`. They change nothing and are audited as `tool_call_rejected`.
Infrastructure failures return a generic `TOOL_UNAVAILABLE` (no internals)
and are logged with redaction.

## 4. Prohibited actions

There is no tool, and therefore no way, for the agent to:

- run SQL or read other customers
- change prices or stock
- grant discounts
- create or modify orders or payments
- mark leads won or lost
- release a human takeover
- send messages to channels

Approvals remain human-only.

---

## 5. Reply validation (code, not prompt)

`validateReply` rejects a `submit_reply` when:

1. **Ungrounded numbers.** A price, amount, karat, weight or percentage in
   the reply that does not appear in this turn's tool results or the
   customer's own words. It understands:
   - `PKR 485,000`, `4,85,000`, `4.85 lakh`, `1.2 crore`
   - `400k` (amount) vs `22k` (karat), grams/tola
   - Urdu digits (`۴۸۵۰۰۰`)

   Small bare numbers (≤ 31: counts, dates, times) are allowed. A
   percentage needs an actual percentage in the sources. Digits inside IDs
   never count as grounding.
2. **Unseen SKUs.** A SKU that no product tool returned this turn.
3. **Unseen products.** `productsReferenced` contains an ID the database
   didn't return.
4. **Unchecked availability.** An availability answer about a product
   without `check_inventory` this turn.
5. **Internal data.** The reply mentions scores, lead status or similar.
6. **Too many emojis.** More than 2.
7. **Low confidence without handoff.** `confidence: "low"` without a handoff.

A rejected reply goes back to the model as a tool error listing the
problems. It is never stored. After `maxReplyCorrections` the turn fails
safe.

Known limit: free-text claims without numbers, such as a made-up street
name or "it's available" said without a product reference, can't be fully
verified mechanically. They are covered by the prompt, by the requirement
that store facts come from `get_business_info`, and by the availability rule
above. Expanding these checks is planned work.

---

## 6. Lead signals

Claude **selects** signals; the deterministic engine (`leadScoring.ts`)
scores them. Points and scores are never shown to the model, and a reply
that mentions a score is rejected.

Signals reach a lead in three ways, all idempotent (one per signal per lead):

- the model calls `record_lead_signal`
- product interests imply signals (`asked_price` → asked_price +
  specific_product_interest, and so on; see `docs/crm.md`)
- the classified intent implies a signal, recorded by code after the turn:

| Intent | Signal |
| --- | --- |
| price_question | asked_price |
| availability_question | asked_availability |
| budget_search | provided_budget |
| visit_question | asked_about_visit |
| location_question | asked_shop_location |
| payment_question | asked_about_payment_or_order |
| human_request | requested_human_salesperson (via the handoff) |

Every sales conversation is tied to the customer's active lead, which is
created if missing (except for do-not-contact customers). The result's
`leadScore`/`leadClassification` are read back from the database after the
turn.

---

## 7. Handoffs

A handoff is created when **any** of these triggers fires; the most urgent
one wins:

| Trigger | Source |
| --- | --- |
| Intent `discount_request` → discount_request · `complaint` → complaint (**high**) · `human_request` → customer_requested · `custom_order` → custom_order | Code rule; the model cannot opt out |
| Keywords in the customer's message (English, Roman Urdu, Urdu): discount/kam karein/رعایت, complaint/refund/kharab/شکایت, human/manager, payment failed | Code backstop for misclassification; errs towards escalation |
| `request_human_handoff` tool or `submit_reply.handoff` | Model |
| Any fail-safe path | Code → `low_ai_confidence` |

Order of operations: the reply is stored first, then the handoff, which
activates human takeover. The customer gets an answer such as "a team member
will follow up", and every later message returns `human_takeover_active`
with **no model call and no AI message**. If staff take over *during* a
turn, the finished reply is discarded (the database trigger would also block
it). The agent can never release a takeover; only staff can.

---

## 8. Products and prices

- Only products returned by the database are shown, and an empty search
  result produces an honest "couldn't find" answer.
- **Price:** quoted only when `approvedPrice` is set, exactly as stored.
  With no approved price, the reply says the team will confirm it. No gold
  rate or weight-based calculation exists yet.
- **Availability:** only from `check_inventory`. "In stock" requires
  `canPromiseInStock`. Unknown or reserved stock means "the team will
  confirm".
- **Discounts:** never offered. Any discount request is handed off.
- **Custom orders:** interest recorded, handed off, with no promises on
  feasibility, price or dates.
- **Complaints:** acknowledged with empathy and handed off at high urgency,
  with no admissions, refunds or compensation.

## 9. Language

Claude replies in the language of the customer's latest message: English,
Urdu (Urdu script) or Roman Urdu, following any mix. Each stored message
carries its own `language`. The customer's **preferred language changes only
when they explicitly ask**, through `set_preferred_language`, which cites
their inbound message per the CRM rules. Fallback replies come in all three
languages, chosen by a script/keyword heuristic.

---

## 10. Testing

```bash
npm test         # everything, no credentials, no network
```

Agent tests use `ScriptedLlmClient` over an in-memory Postgres seeded with
DEMO data. Scripts deliberately include model mistakes (invented prices,
karat, weights, SKUs, discounts and scores, skipped inventory checks, missed
handoffs, invalid tool arguments, infinite tool loops, timeouts, refusals,
takeover races) to prove the code catches them. The 26 required scenarios
are numbered in `tests/agents/salesAgent.scenarios.test.ts`; loop-control
cases are in `tests/agents/salesAgent.loop.test.ts`.

## 11. Demo playground

```bash
npm run sales                 # in-memory DEMO database; Claude if ANTHROPIC_API_KEY is set
npm run sales -- --offline    # rule-based offline model, no API key
npm run sales -- --json       # also print the full structured result
```

```
Customer: Show me bridal necklaces under 500000
Agent: …
  [status=replied · intent=budget_search · lang=english · lead=15/cold · tools=search_products · products=DEMO-NK-001]
```

Commands:

- `/new` starts a new conversation.
- `/release` hands a taken-over conversation back to the AI, acting as DEMO staff.
- `/json` toggles the full result.
- `/quit` exits.

- **Demo mode** (default) runs PostgreSQL in memory with DEMO- products,
  DEMO staff and clearly marked DEMO store info. Everything disappears on
  exit.
- **Offline model** is a simple rule-based stand-in, *not AI*. It shows the
  pipeline (tools, validation, CRM writes, handoff backstop) without an API
  key.
- **Development database:**
  `ZARGHOON_ENV=development SALES_PLAYGROUND_DATABASE_URL=… npm run sales -- --db dev`.
  It refuses to start without both variables, or when `NODE_ENV=production`.
  The playground never uses `DATABASE_URL`, so it cannot silently connect to
  production.

Demo safety: DEMO SKUs are blocked by the product importer, and
`seedDemoData` refuses to run on a database that already holds real
products.

## 12. Live test (manual, never CI)

```bash
ANTHROPIC_API_KEY=… npm run sales-agent                 # all live scenarios
ANTHROPIC_API_KEY=… npm run sales-agent -- --only discount
```

This runs ten scenarios against the real model on the in-memory DEMO
database: bridal budget, unpriced item, out of stock, discount, complaint,
Roman Urdu, Urdu, location, gold rate and a prompt-injection attempt. For
each it checks the deterministic outcomes, prints every reply for human
review, and exits non-zero on failure. Without a key it skips. It uses a few
dozen API calls at most.

## 13. Not built yet (by design)

No WhatsApp, Instagram, Facebook, Meta, TikTok, Google Business or ads
integration, no website chat UI, and no outbound messaging to customers.
Channel adapters will later normalize messages into `handleMessage`.

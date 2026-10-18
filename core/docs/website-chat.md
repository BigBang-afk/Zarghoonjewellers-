# Zarghoon AI — Website Chat

A floating AI sales chat on the Zarghoon Jewellers website, answered by the
real Sales Agent (`docs/sales-agent.md`) over the core business services.
No social channels are connected and nothing is ever sent to customers
outside the chat itself.

## Architecture

```
Browser (ChatWidget)                      src/components/chat/*        (website)
   │  fetch, HttpOnly session cookie, X-Zarghoon-Chat header
   ▼
Next.js route handlers                    src/app/api/chat/**          (website)
   │  CSRF/origin check · 4 KB body limit · cookie + website login → visitor
   ▼
createWebsiteChat()                       core/src/channels/website/   (core)
   │  rate limits · session → customer · open conversation · views/cards
   ▼
Sales Agent → approved tools → core services → PostgreSQL
```

- The website uses `@zarghoon/core` as a compiled ESM package
  (`file:core`), built by `npm run build:core`. That step runs automatically
  before `npm run dev` and `npm run build`.
- The package is marked `serverExternalPackages`, so it runs only on the
  server. The browser imports only TypeScript **types** from it.
- The Next.js layer is thin. Every rule lives in core and is tested there
  (`core/tests/channels/websiteChat.test.ts`).

### Endpoints

| Route | Purpose |
| --- | --- |
| `GET /api/chat` | Chat availability + this visitor's open conversation (never creates records) |
| `POST /api/chat` `{ message }` | One Sales Agent turn → new messages, product cards, takeover flag |
| `POST /api/chat/reset` `{ scope: "conversation" }` | Close the conversation (refused during a human handoff) |
| `POST /api/chat/reset` `{ scope: "demo" }` | Development demo only: wipe the in-memory demo database |
| `POST /api/chat/contact` `{ fullName?, phone?, email? }` | Visitor-typed contact details (self-reported) |

## Modes

| `ZARGHOON_CHAT_MODE` | Database | Model | Default |
| --- | --- | --- | --- |
| `demo` | In-memory PostgreSQL (PGlite) seeded with `DEMO-` fixtures. **Session-only**: lost on server restart | Claude if `ANTHROPIC_API_KEY` is set, otherwise the labelled **offline demo model (not AI)** | development |
| `live` | `ZARGHOON_CORE_DATABASE_URL` (the real core database) | Claude; without a key the chat is **unavailable** (503), never faked | — |
| `off` | none | none — launcher hidden, API refuses | production |

In demo mode the chat shows a **DEMO** badge and a banner ("sample DEMO
products, not real stock or prices"). Demo mode in a production build must
be enabled explicitly, and should never be enabled on the public site.

## Identity and sessions

- **Anonymous visitors:** a random 256-bit token lives in an `HttpOnly`,
  `SameSite=Lax` cookie (`Secure` in production) scoped to `/api/chat`.
  Only its **SHA-256 hash** is stored, as the customer's `website_visitor`
  identity, so a database leak exposes no live sessions. The CRM customer is
  created on the first message, with no invented details.
- **Signed-in website customers:** linked through a verified
  `website_account` identity (migration `20261018000001`) carrying their
  account name.
  - Their unverified registration mobile number is **not** copied into the CRM.
  - Admin and staff accounts are not treated as customers.
  - Anonymous and signed-in histories are never merged automatically.
- **No IDs from the browser.** Requests never contain customer or
  conversation IDs (unknown fields are rejected), so changing an ID can't
  expose another visitor. Malformed or forged cookies are ignored.

## Product cards

The model only picks *which* products to mention; it must have obtained them
from tools this turn. Every card value is read directly from the core
catalogue on the server:

- name, SKU, karat, weight, approved price, availability
- image: only images stored for that product (no stock photos)
- product link: the catalogue's `website_url`

Unknown values show **"Ask for details"** (karat, weight) or **"Needs
confirmation"** (price, unknown stock). The website's separate Prisma
`Product` table is **not** used by the chat. The core catalogue is the
authoritative source.

## CRM behaviour

| Event | Recorded via |
| --- | --- |
| First message | `createCustomer` (identity only) + active lead + conversation |
| Every turn | messages, product interests, lead signals, follow-ups, handoffs — all by the Sales Agent's validated tools and code rules |
| Contact form | `updateCustomer` + `provided_contact` signal. An identifier that belongs to another customer is **never merged**: it is audited as `customer_identity_conflict`, and the visitor sees a neutral "our team will confirm your details" |

The lead score always comes from the deterministic scoring engine. It is
shown only in the **internal debug panel**, which requires
`ZARGHOON_CHAT_DEBUG=true` and is impossible in production builds.

## Human handoff

Discounts, complaints, refunds, payment problems, custom jewellery, and
requests for a person or manager all trigger the existing handoff. Triggers
are model intent, mandatory code rules, and the English/Roman Urdu/Urdu
keyword backstop.

What the visitor sees:

- the reply, if one was given before the handoff,
- then *"Our team will assist you with this request."*
- and the header changes to *"A team member is assisting you"*.

No response time is promised. While a human has taken over, the visitor's
messages are stored but **no model call is made and no AI reply is created**.
"New conversation" is refused, so starting over can't bypass the handoff.
Staff replies appear as **Zarghoon team**.

## Security controls

- **CSRF:** custom `X-Zarghoon-Chat` header and same-origin `Origin` check
  on every POST.
- **Size limits:** 4 KB request body; 1,000-character messages; strict Zod
  schemas.
- **Rate limits:**
  - per session: 8/min, 80/day
  - per IP: 20/min
  - global: **2,000 AI turns/day**, for Claude cost protection

  A refused request doesn't consume quota and gets `Retry-After`. All
  limits are configurable.
- **Agent bounds:** at most 6 model calls and 45 s per turn; route
  `maxDuration` 60 s.
- **Model containment:** the closed tool set and code-level fact validation
  from the Sales Agent apply. There's no SQL access and no arbitrary tools.
  Customer text is treated as data.
- **Safe errors:** internal errors return a generic message; Anthropic keys
  and database URLs exist only on the server.
- **Logging:** request IDs and outcomes only, **never message text**.
  Messages themselves are stored in the CRM as conversation history.
- **Audit:** all agent and CRM actions are recorded in `agent_actions`.
- **Auth failures:** the chat falls back to anonymous if the website's auth
  is unavailable.

Known limit: rate-limit state is per server instance. Behind several
instances or serverless replicas, the effective limits multiply. Use a shared
store (e.g. Redis/Upstash) before relying on them at scale.

## Running and testing

```bash
# one-time: a PostgreSQL database for the website's own Prisma tables
cp .env.example .env.local     # set DATABASE_URL, AUTH_SECRET; ZARGHOON_CHAT_MODE=demo
npm install
npx prisma migrate deploy
npm run dev                    # builds core, then http://localhost:3000
```

- Open the site, then click the gold gem button at the bottom-right.
- Try the suggestions, "Show me 22k bangles", "Do you have anklets?",
  "Mujhe bridal set chahiye", "کیا آپ کے پاس جھمکے ہیں؟", or
  "I want to speak to someone".
- **Lead scoring:** set `ZARGHOON_CHAT_DEBUG=true`, then open "Internal
  debug" under the messages. Price or availability questions, budgets and the
  contact form raise the score.
- **Reset:** the chat's "Reset demo" link wipes the in-memory demo
  database; restarting the server does the same.
- **Real Claude:** add `ANTHROPIC_API_KEY` to `.env.local` and restart.

Automated tests:

```bash
cd core && npm test            # includes core/tests/channels/websiteChat.test.ts
npm run test:e2e               # Playwright against `npm run dev` (desktop + mobile)
```

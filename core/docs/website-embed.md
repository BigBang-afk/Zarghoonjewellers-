# Zarghoon AI — Adding the Chat to Your Existing Website

Zarghoon AI connects to your **existing** website (zarghoonjewllers.com) with
**one line of code**. Your site keeps its design, product pages, accounts,
checkout, payments, orders, domain and hosting. Nothing on it is replaced.

```
Your existing website (any platform)            Zarghoon AI service (separate, server-side)
 ┌─────────────────────────────────────┐        ┌───────────────────────────────────────────┐
 │ <script src=".../zarghoon-ai.js">   │ loads  │ /zarghoon-ai.js  loader (button + iframe) │
 │  • gold chat button (Shadow DOM)    │───────▶│ /embed/chat      chat UI (in the iframe)  │
 │  • chat opens in an isolated iframe │        │ /api/chat        Sales Agent + CRM (core) │
 └─────────────────────────────────────┘        │ secrets: ANTHROPIC_API_KEY, DB URL        │
         product links → your own                └───────────────────────────────────────────┘
         product pages & checkout
```

## What the widget does — and doesn't do

- **Does:**
  - shows a launcher button
  - opens the chat in an iframe served by the Zarghoon AI service
  - links recommended products to **your own product pages**, where your
    normal checkout takes over
- **Doesn't:**
  - read your pages, forms, cookies or customer accounts
  - store anything on your domain
  - touch prices, products, orders or payments
  - process payments
  - send messages outside the chat
- **Isolation:**
  - the button lives in a Shadow DOM, so your CSS can't break it and it
    can't affect your design
  - the chat lives in a sandboxed iframe
- **Removal:** delete the one line.

## Installing (after approval — not done yet)

Add before `</body>` on every page (or in the site-wide footer/theme
settings):

```html
<script src="https://ai.zarghoonjewllers.com/zarghoon-ai.js" defer></script>
```

| Platform | Where to paste it |
| --- | --- |
| Shopify | Online Store → Themes → Edit code → `layout/theme.liquid`, before `</body>` |
| WordPress / WooCommerce | A header/footer code plugin (e.g. WPCode) → Footer, or the theme's `footer.php` |
| Wix | Settings → Custom Code → Add Code → "Body – end", all pages |
| Squarespace | Settings → Advanced → Code Injection → Footer |
| Custom / Next.js | The site layout, before `</body>` |

Options: `data-position="left"` moves the button to the left. Your own
buttons can call `window.ZarghoonAI.open()`.

## Hosting the Zarghoon AI service

The service is the Next.js app in this repository, deployed in
**service-only mode**. It then serves only `/zarghoon-ai.js`, `/embed/chat`
and `/api/chat/*`, and every other page returns 404, so it never becomes a
second website.

Recommended: a subdomain of your store, e.g. `ai.zarghoonjewllers.com`
(a DNS record added for the new service only; your main site's DNS is
unchanged). Then the session cookie is same-site and works in every browser.

| Variable | Value |
| --- | --- |
| `ZARGHOON_AI_SERVICE_ONLY` | `true` |
| `ZARGHOON_EMBED_ALLOWED_ORIGINS` | `https://zarghoonjewllers.com https://www.zarghoonjewllers.com` |
| `ZARGHOON_EMBED_CROSS_SITE` | `false` on a subdomain; `true` if the service is on a different domain (e.g. `*.vercel.app`) |
| `ZARGHOON_CHAT_MODE` | `demo` for staging; `live` only after the real database is verified |
| `ZARGHOON_CORE_DATABASE_URL` | live mode: the Zarghoon AI core PostgreSQL (Supabase) |
| `ANTHROPIC_API_KEY` | server-side only |
| `DATABASE_URL`, `AUTH_SECRET`, `AUTH_TRUST_HOST=true` | required by the app framework even in service-only mode |

## Security

- **Who can embed it:** only sites in `ZARGHOON_EMBED_ALLOWED_ORIGINS` can
  frame the chat. This is enforced per request with CSP `frame-ancestors`,
  and production defaults to "nobody else".
- **No public API:** the chat API is only called by the chat page itself
  (same origin, custom header, origin check). There is no CORS, so other
  sites can't call it.
- **Visitor isolation:** each visitor has an HttpOnly session cookie on the
  service. In cross-site mode it is `Partitioned`, which also confines it to
  your site. Your site's scripts can't read it, and no customer or
  conversation IDs are ever accepted from the browser.
- **Iframe messages:** only "close", and the loader accepts them only from
  the service's origin and its own iframe.
- **Inherited from the website chat:** all controls in
  [`website-chat.md`](website-chat.md) apply — rate limits and the daily
  cost cap, input limits, verified product cards, handoff, audit, no message
  text in logs.

## Products: connecting your real catalogue

The chat only recommends products from the **Zarghoon AI core catalogue**.
It never reads your store directly, and never invents prices or stock.

To go live:

1. Export products from your store, e.g. Shopify/WooCommerce CSV export.
2. Convert them to the core CSV format (`docs/products.md`). Set
   `website_url` to each product's page on zarghoonjewllers.com so "View
   product" leads to your real page and checkout.
3. Run the importer as a **dry run**, review it, then apply it with staff
   approval.
4. Keep stock and prices current: re-import, or build a sync once your
   platform is confirmed.

Until then the chat uses **DEMO** products, clearly labelled.

## Staging and testing

```bash
npm run dev                       # service + demo chat at http://localhost:3000
python3 -m http.server 4000 --directory e2e/fixtures/existing-store
# open http://localhost:4000 — a stand-in "existing store" page with the one-line embed
npm run test:e2e                  # full suite incl. same-site embed + mobile
npm run build && npm run test:e2e:cross-site   # production build embedded from another site
```

The fixture page is a test stand-in only. It has deliberately aggressive CSS
to prove isolation, and is never deployed.

## Launch checklist (needs your approval at each step)

1. Confirm your website's platform and hosting (and give this session
   network access to the domain, or share the details).
2. Deploy the service to **staging** in demo mode, with the embed allowlist
   set to a staging copy or preview of your site.
3. Verify on the staging copy: desktop, mobile, English/Urdu/Roman Urdu,
   handoff.
4. Provision the core database, import and verify real products
   (`website_url` set), and add store details (`BUSINESS_INFO_PATH`).
5. Run the live Claude checks (`cd core && npm run sales-agent`).
6. Switch to `ZARGHOON_CHAT_MODE=live`, add your domains to
   `ZARGHOON_EMBED_ALLOWED_ORIGINS`, add the script tag to the live site.
   With your approval.

# Zarghoon AI — Product Catalogue & Safe Import

Code: `src/services/products/`. Tests: `tests/integration/product*.test.ts`,
`tests/unit/productImportValidation.test.ts`.

## Product facts

Products are identified by a unique **SKU**: uppercase segments joined by
hyphens, such as `ZJ-BR-001`, `ZJ-BG-002` or `ZJ-RG-003`. Lowercase input is
normalized.

Every business fact is nullable: description, category, collection, metal,
karat, weight, making charge, stone cost, approved price, stock quantity,
stock status, size and website URL. **`null` means unknown and must be
treated as "requires confirmation".** Nothing estimates or fills these in.

- Money is `NUMERIC(14,2)` and weight is `NUMERIC(10,3)`. In TypeScript they
  are decimal strings handled with `decimal.js`, never JS floats. Inputs with
  extra precision are rejected rather than rounded.
- Stock status is one of `available`, `low_stock`, `out_of_stock`,
  `reserved`, `made_to_order` or `discontinued`, or `null` (unknown). A DB
  constraint keeps status and quantity consistent: `out_of_stock` ⇒ 0, and
  `available`/`low_stock` ⇒ more than 0.
- There is **no pricing engine yet**. `approved_price` is the only price the
  system will quote. Gold-rate based pricing will be a separate deterministic
  module in a later phase.

## Product service

- `searchProducts({ query, category, collection, karat, stockStatuses, minPrice, maxPrice, includeInactive, limit, offset })`
  - Text search is literal: `%` and `_` in user input are escaped.
  - Price filters only match products that **have** an approved price.
  - Each result carries `priceStatus: "approved" | "requires_confirmation"`.
- `getProduct({ id } | { sku })`, `getProductById`, `getProductBySku`. These
  throw `ProductNotFound` if the product doesn't exist.
- `checkInventory({ id } | { sku })` returns `availability` (stored status,
  `unknown`, or `not_listed` for inactive products), plus:
  - `canPromiseInStock`: the **only** flag an agent may rely on to say a
    piece is in stock (active and `available`/`low_stock`).
  - `requiresConfirmation`: unknown, reserved or inactive.

## CSV import pipeline

```
CSV → parse → normalize → validate (Zod, row numbers) → duplicate SKUs → TEST- guard
    → dry run (default) → compare with database → approved apply (one transaction) → audit
```

Columns: `sku, name, description, category, collection, metal, karat,
weight_grams, making_charge, stone_cost, approved_price, currency,
stock_quantity, stock_status, size, website_url, is_active`. `sku` and `name`
are required. See `data/products.sample.csv`.

Safety rules:

| Rule | Behaviour |
| --- | --- |
| Unknown or duplicate column | File rejected, so a typo like `aproved_price` can't silently drop prices |
| `""`, `N/A`, `-`, `unknown`, `TBD` | Treated as unknown (`null`) |
| Any invalid row | **Whole file rejected**, with every issue listed by row number and column |
| Duplicate SKU in file (after normalization) | Every occurrence reported |
| `TEST-` SKUs | Blocked unless `allowTestSkus` (env `ALLOW_TEST_SKUS=true`, refused in production) |
| Dry run | Default. Shows creates, updates and field-level diffs; writes nothing |
| Blank cell on an existing product | "No change". Imports never blank out stored values |
| Overwriting a stored price, making charge, stone cost, weight, karat, metal or currency | Requires an **approved `price_change` approval**, single-use |
| Filling a previously unknown value | Allowed (it's new information, not an overwrite) |
| Merged stock state inconsistent | Rejected |
| Who can apply | Active staff with role owner, manager or admin. Never the AI |
| Apply | One transaction with existing rows locked; all-or-nothing; audited as `product_import` |

CLI:

```bash
npm run products:import -- --file data/products.sample.csv                    # dry run
npm run products:import -- --file products.csv --apply --staff-id <uuid>      # apply
npm run products:import -- --file products.csv --apply --staff-id <uuid> --approval-id <uuid>
```

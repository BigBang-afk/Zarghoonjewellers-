import Link from "next/link";
import { can, STOCK_STATUSES } from "@zarghoon/core/dashboard";
import { Badge, buttonClass, EmptyState, hrefWith, inputClass, Karat, Money, PageHeader, Pagination, StockBadge, Table, Td, Th, Weight } from "@/components/ui";
import { humanize, STOCK_LABELS } from "@/lib/format";
import { pageContext, readParams, type SearchParams } from "@/lib/page";

export const dynamic = "force-dynamic";

export default async function ProductsPage({ searchParams }: { searchParams: SearchParams }) {
  const { rt, viewer } = await pageContext();
  const params = await readParams(searchParams);
  const result = await rt.dashboard.listProducts(viewer, params);

  return (
    <>
      <PageHeader
        title="Products"
        description="The Zarghoon AI catalogue. Unknown values show “Needs confirmation” — they are never estimated. Changes to prices, stock, weight or karat go through approved imports or synchronisation."
        actions={can.viewSyncRecords(viewer) ? <Link href="/products/sync" className={buttonClass.secondary}>Sync &amp; import records</Link> : null}
      />
      <form method="get" className="mb-4 grid grid-cols-1 gap-2 rounded-xl border border-line bg-surface p-3 sm:grid-cols-2 lg:grid-cols-5" role="search">
        <input name="q" defaultValue={params.q} placeholder="Search name or SKU" aria-label="Search products" className={`${inputClass} lg:col-span-2`} />
        <select name="category" defaultValue={params.category ?? ""} aria-label="Category" className={inputClass}>
          <option value="">All categories</option>
          {result.categories.map((c) => (
            <option key={c} value={c}>{humanize(c)}</option>
          ))}
        </select>
        <select name="stock" defaultValue={params.stock ?? ""} aria-label="Stock" className={inputClass}>
          <option value="">Any stock status</option>
          {STOCK_STATUSES.map((s) => (
            <option key={s} value={s}>{STOCK_LABELS[s]}</option>
          ))}
          <option value="unknown">Unknown</option>
        </select>
        <div className="flex gap-2">
          <select name="missing" defaultValue={params.missing ?? ""} aria-label="Missing information" className={inputClass}>
            <option value="">Any completeness</option>
            <option value="any">Missing anything</option>
            <option value="price">Missing price</option>
            <option value="weight">Missing weight</option>
            <option value="karat">Missing karat</option>
            <option value="stock">Missing stock</option>
            <option value="image">Missing image</option>
          </select>
          <button className={buttonClass.primary} type="submit">Apply</button>
        </div>
      </form>

      {result.rows.length === 0 ? (
        <EmptyState title="No products match">
          <Link href="/products" className="text-gold-dark underline">Clear filters</Link>
        </EmptyState>
      ) : (
        <>
          <Table label="Products">
            <thead>
              <tr>
                <Th>Product</Th>
                <Th>Category</Th>
                <Th>Karat</Th>
                <Th>Weight</Th>
                <Th className="text-right">Approved price</Th>
                <Th>Stock</Th>
                <Th>Missing</Th>
              </tr>
            </thead>
            <tbody>
              {result.rows.map((p) => (
                <tr key={p.id} className={`hover:bg-ivory ${p.isActive ? "" : "opacity-60"}`} data-testid="product-row">
                  <Td>
                    <div className="flex items-center gap-3">
                      {p.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element -- catalogue images are external HTTPS URLs
                        <img src={p.imageUrl} alt="" className="h-10 w-10 rounded-md border border-line object-cover" loading="lazy" referrerPolicy="no-referrer" />
                      ) : (
                        <span className="flex h-10 w-10 items-center justify-center rounded-md border border-dashed border-line-strong text-xs text-muted" aria-label="No image">—</span>
                      )}
                      <div>
                        <Link href={`/products/${p.id}`} className="font-medium text-emerald-800 hover:underline">{p.name}</Link>
                        <div className="text-xs text-muted">{p.sku}{p.isActive ? "" : " · inactive"}</div>
                      </div>
                    </div>
                  </Td>
                  <Td>{p.category ? humanize(p.category) : <span className="text-muted">—</span>}</Td>
                  <Td><Karat karat={p.karat} /></Td>
                  <Td className="tabular"><Weight grams={p.weightGrams} /></Td>
                  <Td className="tabular text-right"><Money amount={p.approvedPrice} currency={p.currency} /></Td>
                  <Td><StockBadge status={p.stockStatus} quantity={p.stockQuantity} /></Td>
                  <Td>
                    {p.missing.length ? (
                      <span className="flex flex-wrap gap-1">{p.missing.map((m) => <Badge key={m} tone="warning">{m}</Badge>)}</span>
                    ) : (
                      <Badge tone="emerald">Complete</Badge>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <Pagination page={result.page} pageSize={result.pageSize} total={result.total} href={(p) => hrefWith("/products", params, { page: String(p) })} />
        </>
      )}
    </>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Card, DefinitionList, Karat, Money, PageHeader, StockBadge, Value, Weight } from "@/components/ui";
import { formatDateTime, humanize } from "@/lib/format";
import { orNotFound, pageContext } from "@/lib/page";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Product" };

export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { rt, viewer } = await pageContext();
  const d = await orNotFound(rt.dashboard.getProduct(viewer, id));
  const p = d.product;

  return (
    <>
      <PageHeader
        title={p.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            {p.sku} <StockBadge status={p.stockStatus} quantity={p.stockQuantity} /> {p.isActive ? null : <Badge>Inactive</Badge>}
          </span>
        }
        actions={<Link href="/products" className="text-sm text-gold-dark hover:underline">← All products</Link>}
      />
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Card title="Stored details">
            <DefinitionList
              items={[
                ["SKU", p.sku],
                ["Category", <Value key="c">{p.category ? humanize(p.category) : null}</Value>],
                ["Collection", <Value key="col" missing="—">{p.collection ? humanize(p.collection) : null}</Value>],
                ["Metal", <Value key="m">{p.metal ? humanize(p.metal) : null}</Value>],
                ["Karat", <Karat key="k" karat={p.karat} />],
                ["Weight", <Weight key="w" grams={p.weightGrams} />],
                ["Approved price", <Money key="p" amount={p.approvedPrice} currency={p.currency} />],
                ["Stock", <StockBadge key="s" status={p.stockStatus} quantity={p.stockQuantity} />],
                ["Size", <Value key="z" missing="—">{p.size}</Value>],
                ["Website page", p.websiteUrl ? <a key="u" href={p.websiteUrl} rel="noreferrer noopener" target="_blank" className="text-emerald-800 underline">Open</a> : "—"],
                ["Customer interest records", String(d.interestCount)],
                ["Last updated", formatDateTime(p.updatedAt)],
              ]}
            />
            {p.description ? <p className="mt-4 whitespace-pre-wrap text-sm text-ink">{p.description}</p> : null}
          </Card>
          <Card title="Images">
            {d.images.length === 0 ? (
              <p className="text-sm text-muted">No images recorded.</p>
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {d.images.map((img) => (
                  // eslint-disable-next-line @next/next/no-img-element -- catalogue images are external HTTPS URLs
                  <img key={img.url} src={img.url} alt={img.altText ?? p.name} className="aspect-square w-full rounded-lg border border-line object-cover" loading="lazy" referrerPolicy="no-referrer" />
                ))}
              </div>
            )}
          </Card>
        </div>
        <div className="space-y-6">
          <Card title="Missing information">
            {d.missing.length === 0 ? (
              <p className="text-sm text-emerald-700">Nothing missing.</p>
            ) : (
              <>
                <ul className="flex flex-wrap gap-1" data-testid="missing-fields">
                  {d.missing.map((m) => (
                    <Badge key={m} tone="warning">{m}</Badge>
                  ))}
                </ul>
                <p className="mt-3 text-xs text-muted">
                  The AI tells customers these details “need confirmation”. Fill them through an approved import or sync — the dashboard does not edit product facts directly.
                </p>
              </>
            )}
          </Card>
          {d.costs ? (
            <Card title="Internal costs">
              <DefinitionList items={[["Making charge", <Money key="m" amount={d.costs.makingCharge} />], ["Stone cost", <Money key="s" amount={d.costs.stoneCost} />]]} />
              <p className="mt-3 text-xs text-muted">Visible to owner, admin and managers only. Never shown to customers or the AI.</p>
            </Card>
          ) : null}
          {d.sourceLinks.length ? (
            <Card title="Synchronised from">
              <ul className="space-y-1 text-sm">
                {d.sourceLinks.map((l) => (
                  <li key={`${l.source}:${l.sourceProductId}`}>
                    {humanize(l.source)} · <code className="text-xs">{l.sourceProductId}</code>
                    <div className="text-xs text-muted">Last synced {formatDateTime(l.lastSyncedAt)}</div>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}

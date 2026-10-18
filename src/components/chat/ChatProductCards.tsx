"use client";

import type { ChatProductCard } from "@zarghoon/core/website";

/**
 * Product cards rendered from verified catalogue data returned by the server.
 * Unknown values arrive already labelled ("Needs confirmation" / "Ask for
 * details"); nothing here computes or guesses a value.
 */

const AVAILABILITY_STYLE: Record<ChatProductCard["availability"], string> = {
  available: "bg-emerald-50 text-emerald-800 ring-emerald-600/20",
  low_stock: "bg-amber-50 text-amber-800 ring-amber-600/20",
  made_to_order: "bg-sky-50 text-sky-800 ring-sky-600/20",
  reserved: "bg-cream-dark text-charcoal/70 ring-charcoal/10",
  out_of_stock: "bg-maroon/5 text-maroon ring-maroon/20",
  discontinued: "bg-maroon/5 text-maroon ring-maroon/20",
  unknown: "bg-cream-dark text-charcoal/70 ring-charcoal/10",
  not_listed: "bg-cream-dark text-charcoal/70 ring-charcoal/10",
};

function GemPlaceholder() {
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true" className="h-10 w-10 text-gold/60">
      <path fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" d="M14 8h20l8 10-18 22L6 18z M6 18h36 M18 8l-4 10 10 22 10-22-4-10" />
    </svg>
  );
}

export default function ChatProductCards({
  products,
  onAsk,
}: {
  products: ChatProductCard[];
  onAsk: (sku: string) => void;
}) {
  if (products.length === 0) return null;
  return (
    <div className="-mx-1 mt-3 flex snap-x gap-3 overflow-x-auto px-1 pb-2" role="list" aria-label="Recommended pieces">
      {products.map((p) => (
        <article
          key={p.productId}
          role="listitem"
          className="flex w-52 shrink-0 snap-start flex-col overflow-hidden rounded-2xl border border-gold/25 bg-white shadow-sm"
        >
          <div className="relative flex aspect-[4/3] items-center justify-center bg-gradient-to-br from-cream to-cream-dark">
            {p.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- verified catalogue URL of arbitrary host
              <img src={p.imageUrl} alt={p.name} className="h-full w-full object-cover" loading="lazy" />
            ) : (
              <GemPlaceholder />
            )}
          </div>
          <div className="flex flex-1 flex-col gap-2 p-3">
            <div>
              <h4 className="font-serif text-[15px] leading-snug text-charcoal">{p.name}</h4>
              <p className="mt-0.5 font-mono text-[10px] tracking-wider text-charcoal/50">{p.sku}</p>
            </div>
            <dl className="grid grid-cols-2 gap-x-2 gap-y-1 text-[11px]">
              <dt className="text-charcoal/50">Karat</dt>
              <dd className="text-right text-charcoal">{p.karatLabel}</dd>
              <dt className="text-charcoal/50">Weight</dt>
              <dd className="text-right text-charcoal">{p.weightLabel}</dd>
            </dl>
            <p className={`text-sm font-semibold ${p.priceConfirmed ? "text-charcoal" : "text-charcoal/60 italic font-normal"}`}>
              {p.priceLabel}
            </p>
            <span className={`w-fit rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ring-inset ${AVAILABILITY_STYLE[p.availability]}`}>
              {p.availabilityLabel}
            </span>
            <div className="mt-auto pt-1">
              {p.viewUrl ? (
                <a
                  href={p.viewUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block rounded-full border border-gold/50 py-1.5 text-center text-xs font-medium text-gold-dark transition hover:bg-gold/10"
                >
                  View product
                </a>
              ) : (
                <button
                  type="button"
                  onClick={() => onAsk(p.sku)}
                  className="w-full rounded-full border border-gold/50 py-1.5 text-xs font-medium text-gold-dark transition hover:bg-gold/10"
                >
                  Ask about this piece
                </button>
              )}
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}

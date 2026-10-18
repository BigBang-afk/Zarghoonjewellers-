import Link from "next/link";
import type { ReactNode } from "react";
import { CLASSIFICATION_LABELS, formatMoney, formatWeight, LEAD_STATUS_LABELS, NEEDS_CONFIRMATION, STOCK_LABELS } from "@/lib/format";

/** Presentational building blocks. No data access, no business rules. */

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="font-serif text-3xl font-semibold tracking-tight text-emerald-900 sm:text-4xl">{title}</h1>
        {description ? <p className="mt-1 max-w-2xl text-sm text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

export function Card({ title, children, className = "", actions }: { title?: string; children: ReactNode; className?: string; actions?: ReactNode }) {
  return (
    <section className={`rounded-xl border border-line bg-surface shadow-[0_1px_2px_rgba(29,26,22,0.04)] ${className}`}>
      {title ? (
        <header className="flex items-center justify-between gap-2 border-b border-line px-5 py-3">
          <h2 className="font-serif text-xl font-semibold text-emerald-900">{title}</h2>
          {actions}
        </header>
      ) : null}
      <div className="p-5">{children}</div>
    </section>
  );
}

const TONES = {
  neutral: "bg-stone-100 text-stone-700 ring-stone-200",
  emerald: "bg-emerald-50 text-emerald-800 ring-emerald-100",
  gold: "bg-gold-50 text-gold-dark ring-gold-light",
  danger: "bg-danger-50 text-danger ring-red-200",
  warning: "bg-warning-50 text-warning ring-amber-200",
  dark: "bg-emerald-900 text-gold-light ring-emerald-800",
} as const;
export type Tone = keyof typeof TONES;

export function Badge({ children, tone = "neutral", title }: { children: ReactNode; tone?: Tone; title?: string }) {
  return (
    <span title={title} className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${TONES[tone]}`}>
      {children}
    </span>
  );
}

export function StatCard({ label, value, hint, href, tone = "neutral" }: { label: string; value: ReactNode; hint?: ReactNode; href?: string; tone?: "neutral" | "gold" | "danger" | "emerald" }) {
  const accent = { neutral: "border-line", gold: "border-gold-light", danger: "border-red-200", emerald: "border-emerald-100" }[tone];
  const body = (
    <div className={`h-full rounded-xl border ${accent} bg-surface p-4 transition-colors hover:border-gold`}>
      <p className="text-xs font-medium uppercase tracking-wider text-muted">{label}</p>
      <p className="tabular mt-2 font-serif text-3xl font-semibold text-emerald-900">{value}</p>
      {hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
    </div>
  );
  return href ? (
    <Link href={href} className="block" data-testid={`stat-${label}`}>
      {body}
    </Link>
  ) : (
    <div data-testid={`stat-${label}`}>{body}</div>
  );
}

/** Shows a stored value, or an explicit "Needs confirmation" — never a guess. */
export function Value({ children, missing = NEEDS_CONFIRMATION }: { children: ReactNode; missing?: string }) {
  if (children === null || children === undefined || children === "") {
    return <span className="text-sm italic text-warning">{missing}</span>;
  }
  return <>{children}</>;
}

export const Money = ({ amount, currency }: { amount: string | null | undefined; currency?: string | null }) => (
  <Value>{formatMoney(amount, currency ?? "PKR")}</Value>
);
export const Weight = ({ grams }: { grams: string | null | undefined }) => <Value>{formatWeight(grams)}</Value>;
export const Karat = ({ karat }: { karat: number | null | undefined }) => <Value>{karat ? `${karat}K` : null}</Value>;

const STATUS_TONE: Record<string, Tone> = {
  new: "neutral",
  qualified: "emerald",
  warm: "warning",
  hot: "gold",
  very_hot: "dark",
  waiting_customer: "neutral",
  human_followup: "danger",
  won: "emerald",
  lost: "neutral",
  do_not_contact: "danger",
};

export function LeadStatusBadge({ status }: { status: string | null | undefined }) {
  if (!status) return <span className="text-sm text-muted">No lead</span>;
  return <Badge tone={STATUS_TONE[status] ?? "neutral"}>{LEAD_STATUS_LABELS[status] ?? status}</Badge>;
}

const CLASS_TONE: Record<string, Tone> = { cold: "neutral", warm: "warning", hot: "gold", very_hot: "dark" };

/** Score 0–100 with its deterministic classification. */
export function LeadScore({ score, classification }: { score: number | null | undefined; classification: string | null | undefined }) {
  if (score === null || score === undefined || !classification) return <span className="text-sm text-muted">—</span>;
  return (
    <span className="inline-flex items-center gap-2" data-testid="lead-score">
      <span className="tabular w-7 text-right text-sm font-semibold text-ink">{score}</span>
      <span className="hidden h-1.5 w-14 overflow-hidden rounded-full bg-stone-100 sm:block" aria-hidden>
        <span className="block h-full rounded-full bg-gold" style={{ width: `${Math.min(100, score)}%` }} />
      </span>
      <Badge tone={CLASS_TONE[classification] ?? "neutral"}>{CLASSIFICATION_LABELS[classification] ?? classification}</Badge>
    </span>
  );
}

export function StockBadge({ status, quantity }: { status: string | null | undefined; quantity?: number | null }) {
  if (!status) return <Value>{null}</Value>;
  const tone: Tone = status === "available" ? "emerald" : status === "low_stock" ? "warning" : status === "out_of_stock" || status === "discontinued" ? "danger" : "neutral";
  return (
    <Badge tone={tone}>
      {STOCK_LABELS[status] ?? status}
      {quantity !== null && quantity !== undefined ? ` · ${quantity}` : ""}
    </Badge>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-line-strong bg-surface px-6 py-10 text-center" data-testid="empty-state">
      <p className="font-serif text-xl font-semibold text-emerald-900">{title}</p>
      {children ? <div className="mx-auto mt-2 max-w-md text-sm text-muted">{children}</div> : null}
    </div>
  );
}

export function Table({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-line bg-surface">
      <table className="w-full min-w-[640px] text-left text-sm" aria-label={label}>
        {children}
      </table>
    </div>
  );
}

export const Th = ({ children, className = "" }: { children?: ReactNode; className?: string }) => (
  <th scope="col" className={`border-b border-line bg-ivory px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-muted ${className}`}>
    {children}
  </th>
);
export const Td = ({ children, className = "" }: { children?: ReactNode; className?: string }) => (
  <td className={`border-b border-line px-4 py-3 align-top ${className}`}>{children}</td>
);

/** Links that keep the other query parameters. */
export function hrefWith(base: string, params: Record<string, string | undefined>, change: Record<string, string | undefined>) {
  const merged = { ...params, ...change };
  const qs = new URLSearchParams(Object.entries(merged).filter((e): e is [string, string] => !!e[1])).toString();
  return qs ? `${base}?${qs}` : base;
}

export function Tabs({ items, current }: { items: { key: string; label: string; href: string; count?: number }[]; current: string }) {
  return (
    <nav className="mb-4 flex gap-1 overflow-x-auto border-b border-line" aria-label="Filter">
      {items.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          aria-current={t.key === current ? "page" : undefined}
          className={`-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium ${
            t.key === current ? "border-gold text-emerald-900" : "border-transparent text-muted hover:text-emerald-800"
          }`}
        >
          {t.label}
          {t.count !== undefined ? <span className="tabular ml-1.5 rounded-full bg-stone-100 px-1.5 text-xs text-muted">{t.count}</span> : null}
        </Link>
      ))}
    </nav>
  );
}

export function Pagination({ page, pageSize, total, href }: { page: number; pageSize: number; total: number; href: (page: number) => string }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return <p className="mt-3 text-xs text-muted">{total} record{total === 1 ? "" : "s"}</p>;
  return (
    <div className="mt-3 flex items-center justify-between text-sm">
      <p className="text-xs text-muted">
        Page {page} of {pages} · {total} records
      </p>
      <div className="flex gap-2">
        {page > 1 ? <Link className="rounded-md border border-line px-3 py-1 hover:border-gold" href={href(page - 1)}>Previous</Link> : null}
        {page < pages ? <Link className="rounded-md border border-line px-3 py-1 hover:border-gold" href={href(page + 1)}>Next</Link> : null}
      </div>
    </div>
  );
}

export const buttonClass = {
  primary: "inline-flex items-center justify-center rounded-lg bg-emerald-900 px-3.5 py-2 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-50",
  gold: "inline-flex items-center justify-center rounded-lg bg-gold px-3.5 py-2 text-sm font-medium text-white hover:bg-gold-dark disabled:opacity-50",
  secondary: "inline-flex items-center justify-center rounded-lg border border-line-strong bg-surface px-3.5 py-2 text-sm font-medium text-ink hover:border-gold disabled:opacity-50",
  danger: "inline-flex items-center justify-center rounded-lg border border-red-200 bg-surface px-3.5 py-2 text-sm font-medium text-danger hover:bg-danger-50 disabled:opacity-50",
};

export const inputClass =
  "w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm text-ink placeholder:text-stone-400 focus:border-gold focus:outline-none";

export function DefinitionList({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
      {items.map(([k, v]) => (
        <div key={k}>
          <dt className="text-xs font-medium uppercase tracking-wider text-muted">{k}</dt>
          <dd className="mt-0.5 text-sm text-ink">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

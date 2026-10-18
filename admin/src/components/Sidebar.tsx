"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

export interface NavItem {
  href: string;
  label: string;
  /** Shown as a small label, e.g. "read-only". */
  note?: string;
  count?: number;
}

export function Sidebar({ items, footer }: { items: NavItem[]; footer?: React.ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const active = (href: string) => (href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`));

  const nav = (
    <nav aria-label="Main" className="flex flex-col gap-0.5">
      {items.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          onClick={() => setOpen(false)}
          aria-current={active(item.href) ? "page" : undefined}
          className={`flex items-center justify-between rounded-lg px-3 py-2 text-sm transition-colors ${
            active(item.href) ? "bg-emerald-800 text-white" : "text-emerald-100 hover:bg-emerald-800/60 hover:text-white"
          }`}
        >
          <span>{item.label}</span>
          <span className="flex items-center gap-1.5">
            {item.note ? <span className="text-[10px] uppercase tracking-wider text-gold-light/80">{item.note}</span> : null}
            {item.count ? <span className="tabular rounded-full bg-gold px-1.5 text-xs font-semibold text-emerald-950">{item.count}</span> : null}
          </span>
        </Link>
      ))}
    </nav>
  );

  const brand = (
    <Link href="/" className="block px-3 py-1">
      <span className="font-serif text-2xl font-semibold text-gold-light">Zarghoon</span>
      <span className="ml-1.5 text-xs uppercase tracking-[0.2em] text-emerald-100">AI</span>
      <span className="block text-[11px] uppercase tracking-[0.18em] text-emerald-100/70">Management</span>
    </Link>
  );

  return (
    <>
      {/* Mobile top bar */}
      <div className="sticky top-0 z-30 flex items-center justify-between bg-emerald-950 px-4 py-3 lg:hidden">
        {brand}
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-controls="mobile-nav"
          className="rounded-lg border border-emerald-800 px-3 py-1.5 text-sm text-emerald-100"
        >
          {open ? "Close" : "Menu"}
        </button>
      </div>
      {open ? (
        <div id="mobile-nav" className="fixed inset-x-0 top-[60px] bottom-0 z-30 overflow-y-auto bg-emerald-950 px-3 pb-6 lg:hidden">
          {nav}
          <div className="mt-6 border-t border-emerald-800 pt-4">{footer}</div>
        </div>
      ) : null}
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-64 flex-col gap-6 overflow-y-auto bg-emerald-950 px-3 py-6 lg:flex">
        {brand}
        {nav}
        <div className="mt-auto border-t border-emerald-800 pt-4">{footer}</div>
      </aside>
    </>
  );
}

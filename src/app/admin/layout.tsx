import { redirect } from "next/navigation";
import Link from "next/link";
import type { ReactNode } from "react";
import { auth } from "@/lib/auth";
import LogoutButton from "@/components/LogoutButton";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (session.user.role !== "ADMIN") redirect("/dashboard");

  return (
    <div className="mx-auto flex max-w-6xl flex-1 flex-col gap-8 px-6 py-10 md:flex-row">
      <aside className="shrink-0 md:w-56">
        <p className="text-sm uppercase tracking-[0.3em] text-gold">Admin Panel</p>
        <nav className="mt-6 flex flex-row gap-2 md:flex-col">
          <Link
            href="/admin"
            className="rounded-lg px-4 py-2 text-sm font-medium text-charcoal/80 hover:bg-gold/10 hover:text-charcoal"
          >
            Dashboard
          </Link>
          <Link
            href="/admin/products"
            className="rounded-lg px-4 py-2 text-sm font-medium text-charcoal/80 hover:bg-gold/10 hover:text-charcoal"
          >
            Products
          </Link>
          <Link
            href="/admin/products/new"
            className="rounded-lg px-4 py-2 text-sm font-medium text-charcoal/80 hover:bg-gold/10 hover:text-charcoal"
          >
            Add Product
          </Link>
        </nav>
        <div className="mt-8">
          <LogoutButton className="rounded-full border border-gold/40 px-4 py-2 text-sm font-medium text-gold hover:bg-gold hover:text-charcoal" />
        </div>
      </aside>
      <div className="flex-1">{children}</div>
    </div>
  );
}

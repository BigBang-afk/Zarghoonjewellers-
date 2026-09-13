import Link from "next/link";
import { prisma } from "@/lib/prisma";

export default async function AdminDashboardPage() {
  const [productCount, customerCount] = await Promise.all([
    prisma.product.count(),
    prisma.user.count({ where: { role: "CUSTOMER" } }),
  ]);

  return (
    <div>
      <h1 className="font-serif text-3xl text-charcoal">Admin Dashboard</h1>
      <p className="mt-2 text-charcoal/60">Manage your product catalogue and customer base.</p>

      <div className="mt-8 grid gap-6 sm:grid-cols-2">
        <div className="rounded-2xl border border-gold/20 bg-white p-6 shadow-sm">
          <p className="text-sm text-charcoal/60">Total Products</p>
          <p className="mt-2 font-serif text-4xl text-charcoal">{productCount}</p>
        </div>
        <div className="rounded-2xl border border-gold/20 bg-white p-6 shadow-sm">
          <p className="text-sm text-charcoal/60">Registered Customers</p>
          <p className="mt-2 font-serif text-4xl text-charcoal">{customerCount}</p>
        </div>
      </div>

      <div className="mt-8 flex flex-wrap gap-4">
        <Link
          href="/admin/products/new"
          className="rounded-full bg-gold px-6 py-3 font-semibold text-charcoal transition hover:bg-gold-light"
        >
          Add New Product
        </Link>
        <Link
          href="/admin/products"
          className="rounded-full border border-gold/40 px-6 py-3 font-semibold text-gold transition hover:bg-gold/10"
        >
          View All Products
        </Link>
      </div>
    </div>
  );
}

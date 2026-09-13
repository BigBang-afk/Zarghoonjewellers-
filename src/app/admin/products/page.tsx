import Link from "next/link";
import Image from "next/image";
import { prisma } from "@/lib/prisma";
import DeleteProductButton from "@/components/DeleteProductButton";

export default async function AdminProductsPage() {
  const products = await prisma.product.findMany({
    include: { images: true },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="font-serif text-3xl text-charcoal">Products</h1>
        <Link
          href="/admin/products/new"
          className="rounded-full bg-gold px-5 py-2.5 text-sm font-semibold text-charcoal transition hover:bg-gold-light"
        >
          Add Product
        </Link>
      </div>

      {products.length === 0 ? (
        <p className="mt-10 text-charcoal/60">No products yet. Add your first product.</p>
      ) : (
        <div className="mt-8 overflow-x-auto rounded-2xl border border-gold/20 bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-gold/20 bg-cream-dark/40 text-xs uppercase tracking-wide text-charcoal/60">
              <tr>
                <th className="px-4 py-3">Image</th>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3">Quality</th>
                <th className="px-4 py-3">Net (g)</th>
                <th className="px-4 py-3">Wastage %</th>
                <th className="px-4 py-3">Gross (g)</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {products.map((p) => (
                <tr key={p.id} className="border-b border-gold/10 last:border-0">
                  <td className="px-4 py-3">
                    <div className="relative h-12 w-12 overflow-hidden rounded-lg bg-cream-dark">
                      {p.images[0] && (
                        <Image src={p.images[0].url} alt={p.name} fill className="object-cover" />
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 font-medium text-charcoal">{p.name}</td>
                  <td className="px-4 py-3 text-charcoal/70">{p.category}</td>
                  <td className="px-4 py-3 text-charcoal/70">{p.quality}</td>
                  <td className="px-4 py-3 text-charcoal/70">{p.netWeight.toFixed(3)}</td>
                  <td className="px-4 py-3 text-charcoal/70">{p.wastagePercent.toFixed(2)}</td>
                  <td className="px-4 py-3 font-medium text-charcoal">{p.grossWeight.toFixed(3)}</td>
                  <td className="px-4 py-3">
                    <DeleteProductButton productId={p.id} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

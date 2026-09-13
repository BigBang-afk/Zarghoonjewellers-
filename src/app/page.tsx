import Link from "next/link";
import { prisma } from "@/lib/prisma";
import ProductCard from "@/components/ProductCard";

const categories = [
  { name: "Rings", blurb: "Engagement & statement rings" },
  { name: "Necklaces", blurb: "Bridal sets & everyday elegance" },
  { name: "Earrings", blurb: "Studs, jhumkas & danglers" },
  { name: "Bangles", blurb: "Traditional & contemporary" },
];

const trustPoints = [
  "BIS Hallmarked Gold",
  "Certified Gemstones",
  "Transparent Pricing",
  "Trusted by Families",
];

export default async function Home() {
  const products = await prisma.product.findMany({
    include: { images: true },
    orderBy: { createdAt: "desc" },
    take: 8,
  });

  return (
    <div>
      <section className="bg-charcoal text-cream">
        <div className="mx-auto max-w-6xl px-6 py-24 text-center">
          <p className="mb-4 text-sm uppercase tracking-[0.3em] text-gold">
            Trusted craftsmanship, generation after generation
          </p>
          <h1 className="font-serif text-4xl leading-tight sm:text-6xl">
            Timeless Jewellery,
            <br />
            Crafted for a Lifetime
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-cream/80">
            Discover handcrafted gold, diamond and gemstone jewellery from Zarghoon
            Jewellers. Join the Zarghoon Family for exclusive updates on new
            collections and offers.
          </p>
          <div className="mt-10 flex flex-wrap justify-center gap-4">
            <Link
              href="/register"
              className="rounded-full bg-gold px-8 py-3 font-semibold text-charcoal transition hover:bg-gold-light"
            >
              Join the Zarghoon Family
            </Link>
            <Link
              href="#collections"
              className="rounded-full border border-gold/50 px-8 py-3 font-semibold text-gold transition hover:bg-gold/10"
            >
              Explore Collections
            </Link>
          </div>
        </div>
      </section>

      <section className="border-b border-cream-dark bg-cream">
        <div className="mx-auto grid max-w-6xl grid-cols-2 gap-6 px-6 py-10 text-center sm:grid-cols-4">
          {trustPoints.map((item) => (
            <div key={item} className="text-sm font-medium text-charcoal/80">
              {item}
            </div>
          ))}
        </div>
      </section>

      <section id="collections" className="mx-auto max-w-6xl px-6 py-20">
        <h2 className="text-center font-serif text-3xl text-charcoal">Our Collections</h2>
        <div className="mt-10 grid grid-cols-2 gap-6 sm:grid-cols-4">
          {categories.map((c) => (
            <div
              key={c.name}
              className="rounded-2xl border border-gold/20 bg-white p-6 text-center shadow-sm transition hover:shadow-md"
            >
              <h3 className="font-serif text-xl text-charcoal">{c.name}</h3>
              <p className="mt-2 text-sm text-charcoal/60">{c.blurb}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="bg-cream-dark/40 py-20">
        <div className="mx-auto max-w-6xl px-6">
          <h2 className="text-center font-serif text-3xl text-charcoal">Featured Pieces</h2>
          {products.length === 0 ? (
            <p className="mt-8 text-center text-charcoal/60">
              New collection coming soon. Please check back shortly.
            </p>
          ) : (
            <div className="mt-10 grid grid-cols-2 gap-6 sm:grid-cols-3 lg:grid-cols-4">
              {products.map((p) => (
                <ProductCard
                  key={p.id}
                  name={p.name}
                  category={p.category}
                  quality={p.quality}
                  grossWeight={p.grossWeight}
                  imageUrl={p.images[0]?.url}
                />
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 py-20 text-center">
        <h2 className="font-serif text-3xl text-charcoal">Become Part of the Zarghoon Family</h2>
        <p className="mx-auto mt-4 max-w-xl text-charcoal/60">
          Register today to get birthday &amp; anniversary surprises, and enjoy
          priority access to new arrivals.
        </p>
        <Link
          href="/register"
          className="mt-8 inline-block rounded-full bg-gold px-8 py-3 font-semibold text-charcoal transition hover:bg-gold-light"
        >
          Create Your Account
        </Link>
      </section>
    </div>
  );
}

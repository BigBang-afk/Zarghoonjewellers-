import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import ProductCard from "@/components/ProductCard";

function isSameDay(date: Date | null | undefined, today: Date) {
  if (!date) return false;
  return date.getUTCMonth() === today.getUTCMonth() && date.getUTCDate() === today.getUTCDate();
}

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (session.user.role === "ADMIN") redirect("/admin");

  const [user, products] = await Promise.all([
    prisma.user.findUnique({ where: { username: session.user.username } }),
    prisma.product.findMany({
      include: { images: true },
      orderBy: { createdAt: "desc" },
      take: 8,
    }),
  ]);

  const today = new Date();
  const isBirthday = isSameDay(user?.dob, today);
  const isAnniversary = isSameDay(user?.anniversary, today);

  return (
    <div className="mx-auto max-w-6xl px-6 py-16">
      <div className="rounded-2xl bg-charcoal p-10 text-cream">
        <p className="text-sm uppercase tracking-[0.3em] text-gold">Zarghoon Jewellers Family</p>
        <h1 className="mt-3 font-serif text-3xl sm:text-4xl">
          Welcome back, {user?.fullName ?? session.user.name}
        </h1>
        {user && (
          <p className="mt-2 text-cream/70">
            Member since {user.createdAt.toLocaleDateString()}
          </p>
        )}
      </div>

      {(isBirthday || isAnniversary) && (
        <div className="mt-8 rounded-2xl border border-gold bg-gold/10 p-6 text-center">
          <p className="font-serif text-xl text-charcoal">
            {isBirthday ? "Happy Birthday" : "Happy Anniversary"} from all of us at Zarghoon
            Jewellers!
          </p>
          <p className="mt-1 text-sm text-charcoal/70">
            Visit us today for a special surprise gift.
          </p>
        </div>
      )}

      <div className="mt-12">
        <h2 className="font-serif text-2xl text-charcoal">Latest Arrivals</h2>
        {products.length === 0 ? (
          <p className="mt-6 text-charcoal/60">
            New collection coming soon. Please check back shortly.
          </p>
        ) : (
          <div className="mt-6 grid grid-cols-2 gap-6 sm:grid-cols-3 lg:grid-cols-4">
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
    </div>
  );
}

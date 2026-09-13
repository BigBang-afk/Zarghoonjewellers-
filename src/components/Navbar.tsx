import Link from "next/link";
import { auth } from "@/lib/auth";
import LogoutButton from "@/components/LogoutButton";

export default async function Navbar() {
  const session = await auth();
  const role = session?.user?.role;

  return (
    <header className="sticky top-0 z-50 border-b border-gold/20 bg-charcoal text-cream">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <Link href="/" className="font-serif text-2xl tracking-wide text-gold">
          Zarghoon <span className="text-cream">Jewellers</span>
        </Link>

        <nav className="hidden items-center gap-8 text-sm font-medium md:flex">
          <Link href="/" className="transition-colors hover:text-gold">
            Home
          </Link>
          <Link href="/#collections" className="transition-colors hover:text-gold">
            Collections
          </Link>
          {role === "ADMIN" && (
            <Link href="/admin" className="transition-colors hover:text-gold">
              Admin Panel
            </Link>
          )}
          {role === "CUSTOMER" && (
            <Link href="/dashboard" className="transition-colors hover:text-gold">
              My Account
            </Link>
          )}
        </nav>

        <div className="flex items-center gap-3">
          {!session?.user ? (
            <>
              <Link href="/login" className="text-sm font-medium transition-colors hover:text-gold">
                Login
              </Link>
              <Link
                href="/register"
                className="rounded-full bg-gold px-5 py-2 text-sm font-semibold text-charcoal transition hover:bg-gold-light"
              >
                Join the Family
              </Link>
            </>
          ) : (
            <LogoutButton className="rounded-full border border-gold/50 px-5 py-2 text-sm font-medium text-gold transition hover:bg-gold hover:text-charcoal" />
          )}
        </div>
      </div>
    </header>
  );
}

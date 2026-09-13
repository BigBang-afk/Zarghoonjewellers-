import Link from "next/link";

export default function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer className="border-t border-gold/20 bg-charcoal text-cream/80">
      <div className="mx-auto grid max-w-6xl gap-10 px-6 py-14 sm:grid-cols-3">
        <div>
          <p className="font-serif text-xl text-gold">Zarghoon Jewellers</p>
          <p className="mt-3 text-sm text-cream/60">
            Handcrafted gold, diamond and gemstone jewellery, trusted by families for
            generations. Join the Zarghoon Family for exclusive updates and offers.
          </p>
        </div>
        <div>
          <p className="text-sm font-semibold uppercase tracking-wide text-gold">Quick Links</p>
          <ul className="mt-3 space-y-2 text-sm">
            <li>
              <Link href="/" className="hover:text-gold">
                Home
              </Link>
            </li>
            <li>
              <Link href="/#collections" className="hover:text-gold">
                Collections
              </Link>
            </li>
            <li>
              <Link href="/register" className="hover:text-gold">
                Join the Family
              </Link>
            </li>
            <li>
              <Link href="/login" className="hover:text-gold">
                Login
              </Link>
            </li>
          </ul>
        </div>
        <div>
          <p className="text-sm font-semibold uppercase tracking-wide text-gold">Visit Us</p>
          <ul className="mt-3 space-y-2 text-sm text-cream/60">
            <li>Zarghoon Jewellers, Main Bazaar</li>
            <li>Open daily · 10:00 AM &ndash; 9:00 PM</li>
            <li>Phone: +00 000 0000000</li>
          </ul>
        </div>
      </div>
      <div className="border-t border-gold/10 py-6 text-center text-xs text-cream/50">
        &copy; {year} Zarghoon Jewellers. All rights reserved.
      </div>
    </footer>
  );
}

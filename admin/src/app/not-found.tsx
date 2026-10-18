import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-[60vh] items-center justify-center p-4">
      <div className="max-w-md text-center" data-testid="not-found">
        <h1 className="font-serif text-3xl font-semibold text-emerald-900">Not found</h1>
        <p className="mt-2 text-sm text-muted">This record does not exist or is not assigned to you.</p>
        <Link href="/" className="mt-4 inline-block text-sm font-medium text-gold-dark hover:underline">
          Back to overview
        </Link>
      </div>
    </main>
  );
}

export function DemoBanner() {
  return (
    <div role="note" className="bg-gold px-4 py-2 text-center text-xs font-semibold uppercase tracking-[0.18em] text-emerald-950" data-testid="demo-banner">
      Development demo — fake data
    </div>
  );
}

export function EnvironmentBanner({ label }: { label: string }) {
  if (label === "production") return null;
  return (
    <div role="note" className="bg-emerald-800 px-4 py-1.5 text-center text-xs font-medium uppercase tracking-[0.18em] text-gold-light" data-testid="env-banner">
      {label} database — test data only
    </div>
  );
}

export function Unavailable({ message }: { message: string }) {
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="max-w-lg rounded-xl border border-line bg-surface p-8" data-testid="dashboard-unavailable">
        <h1 className="font-serif text-3xl font-semibold text-emerald-900">Dashboard unavailable</h1>
        <p className="mt-3 text-sm text-ink">{message}</p>
        <p className="mt-3 text-sm text-muted">
          No data is shown, and demo data is never substituted for a database that cannot be reached. See
          <code className="mx-1 rounded bg-stone-100 px-1">admin/README.md</code>
          for configuration.
        </p>
      </div>
    </main>
  );
}

export function NotPermitted({ what }: { what: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-8 text-center" data-testid="not-permitted">
      <h1 className="font-serif text-2xl font-semibold text-emerald-900">Not available for your role</h1>
      <p className="mt-2 text-sm text-muted">{what} is limited to the owner, admins and managers.</p>
    </div>
  );
}

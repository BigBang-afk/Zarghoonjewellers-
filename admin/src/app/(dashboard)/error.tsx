"use client";

export default function DashboardError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="rounded-xl border border-red-200 bg-surface p-6" role="alert" data-testid="page-error">
      <h1 className="font-serif text-2xl font-semibold text-danger">Something went wrong</h1>
      <p className="mt-2 text-sm text-muted">
        {error.message.startsWith("Your role") ? error.message : "This page could not be loaded. No changes were made."}
        {error.digest ? <span className="ml-1 text-xs">(ref {error.digest})</span> : null}
      </p>
      <button type="button" onClick={reset} className="mt-4 rounded-lg border border-line-strong px-3 py-1.5 text-sm">
        Try again
      </button>
    </div>
  );
}

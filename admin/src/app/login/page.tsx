import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { DEMO_STAFF } from "@zarghoon/core/dashboard";
import { DemoBanner, EnvironmentBanner, Unavailable } from "@/components/Banners";
import { LoginForm } from "@/components/LoginForm";
import { getRuntimeStatus } from "@/lib/runtime";
import { getSession } from "@/lib/session";

export const metadata: Metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const status = await getRuntimeStatus();
  if (!status.ok) return <Unavailable message={status.message} />;
  if (await getSession()) redirect("/");
  const params = await searchParams;
  const demo = status.runtime.mode === "demo";

  return (
    <div className="min-h-screen">
      {demo ? <DemoBanner /> : <EnvironmentBanner label={status.runtime.environmentLabel} />}
      <main className="flex min-h-[calc(100vh-2rem)] items-center justify-center bg-[radial-gradient(ellipse_at_top,var(--emerald-50),var(--ivory)_60%)] p-4">
        <div className="w-full max-w-sm">
          <div className="mb-6 text-center">
            <p className="font-serif text-4xl font-semibold text-emerald-900">Zarghoon</p>
            <p className="text-xs uppercase tracking-[0.3em] text-gold-dark">AI · Management</p>
          </div>
          <div className="rounded-2xl border border-line bg-surface p-6 shadow-sm">
            <h1 className="mb-1 font-serif text-2xl font-semibold text-emerald-900">Staff sign in</h1>
            <p className="mb-5 text-sm text-muted">Private business information. Authorised staff only.</p>
            {params.reset ? <p className="mb-4 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">Demo data was reset. Please sign in again.</p> : null}
            {params.changed ? <p className="mb-4 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">Password changed. Please sign in again.</p> : null}
            <LoginForm />
          </div>
          {demo ? (
            <div className="mt-4 rounded-xl border border-gold-light bg-gold-50 p-4 text-sm text-ink" data-testid="demo-accounts">
              <p className="font-medium text-gold-dark">Demo accounts (fake staff)</p>
              <p className="mt-1 text-xs text-muted">Password: the ZARGHOON_DEMO_PASSWORD you set when starting the dashboard.</p>
              <ul className="mt-2 space-y-0.5 text-xs">
                {DEMO_STAFF.map((s) => (
                  <li key={s.username}>
                    <code className="rounded bg-white px-1">{s.username}</code> — {s.role}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </main>
    </div>
  );
}

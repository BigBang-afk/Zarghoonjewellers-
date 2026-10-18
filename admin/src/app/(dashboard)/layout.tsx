import { can } from "@zarghoon/core/dashboard";
import { DemoBanner, EnvironmentBanner, Unavailable } from "@/components/Banners";
import { Sidebar, type NavItem } from "@/components/Sidebar";
import { ToastProvider } from "@/components/Toaster";
import { logoutAction } from "@/lib/actions";
import { humanize } from "@/lib/format";
import { getRuntimeStatus } from "@/lib/runtime";
import { requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const status = await getRuntimeStatus();
  if (!status.ok) return <Unavailable message={status.message} />;
  const session = await requireSession();
  const viewer = session.staff;
  const rt = status.runtime;
  const overview = await rt.dashboard.getOverview(viewer);

  const items: NavItem[] = [
    { href: "/", label: "Overview" },
    { href: "/customers", label: "Customers" },
    { href: "/leads", label: "Leads" },
    { href: "/conversations", label: "Conversations" },
    { href: "/products", label: "Products" },
    { href: "/followups", label: "Follow-ups", count: overview.overdueFollowups },
    { href: "/handoffs", label: "Human Handoffs", count: overview.openHandoffs },
    { href: "/orders", label: "Orders", note: "read-only" },
    ...(can.decideApprovals(viewer) ? [{ href: "/approvals", label: "Approvals" }] : []),
    ...(can.viewAudit(viewer) ? [{ href: "/activity", label: "Activity Log" }] : []),
    { href: "/settings", label: "Settings" },
  ];

  const footer = (
    <div className="px-3 text-sm text-emerald-100">
      <p className="font-medium text-white" data-testid="current-user">
        {viewer.fullName}
      </p>
      <p className="text-xs text-emerald-100/70">{humanize(viewer.role)}</p>
      <form action={logoutAction} className="mt-3">
        <button type="submit" className="rounded-lg border border-emerald-800 px-3 py-1.5 text-xs text-emerald-100 hover:border-gold hover:text-white">
          Sign out
        </button>
      </form>
    </div>
  );

  return (
    <ToastProvider>
      <div className="min-h-screen">
        <Sidebar items={items} footer={footer} />
        <div className="lg:pl-64">
          {rt.mode === "demo" ? <DemoBanner /> : <EnvironmentBanner label={rt.environmentLabel} />}
          <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</main>
        </div>
      </div>
    </ToastProvider>
  );
}

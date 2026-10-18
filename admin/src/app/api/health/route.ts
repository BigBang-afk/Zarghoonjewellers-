import { getRuntimeStatus } from "@/lib/runtime";

/**
 * Liveness/readiness for the hosting platform's health check. Public, so it
 * reveals nothing beyond up/down: no configuration, database or error details.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const status = await getRuntimeStatus();
  return Response.json(
    { status: status.ok ? "ok" : "unavailable" },
    { status: status.ok ? 200 : 503, headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } },
  );
}

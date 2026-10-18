import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import type { StaffSession } from "@zarghoon/core/dashboard";
import { getRuntime } from "./runtime";

/**
 * Staff sessions. The cookie holds a random token (HttpOnly, SameSite=Strict,
 * Secure in production); the server stores only its hash. Every page and
 * every Server Action resolves the session again from the database, so a
 * deactivated staff member loses access immediately.
 */

export const SESSION_COOKIE = process.env.NODE_ENV === "production" ? "__Host-zj_staff" : "zj_staff";

export const getSession = cache(async (): Promise<StaffSession | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const rt = await getRuntime();
  return rt.auth.getSession(token);
});

/** For pages: the signed-in staff member, or a redirect to the sign-in page. */
export async function requireSession(): Promise<StaffSession> {
  const session = await getSession();
  if (!session) redirect("/login");
  return session;
}

export async function setSessionCookie(token: string, expiresAt: Date, secure: boolean) {
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure,
    sameSite: "strict",
    path: "/",
    expires: expiresAt,
  });
}

export async function clearSessionCookie() {
  (await cookies()).delete(SESSION_COOKIE);
}

/** Best-effort client address for rate limiting (first X-Forwarded-For hop when behind a proxy). */
export async function clientAddress(): Promise<string> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "local";
}

import "server-only";
import { notFound } from "next/navigation";
import { AppError, type DashboardRuntime, type StaffSummary } from "@zarghoon/core/dashboard";
import { getRuntime } from "./runtime";
import { requireSession } from "./session";

/**
 * Every page calls this (layouts are not a security boundary): it verifies
 * the staff session in the database and returns the viewer used to scope
 * every query.
 */
export async function pageContext(): Promise<{ rt: DashboardRuntime; viewer: StaffSummary }> {
  const session = await requireSession();
  return { rt: await getRuntime(), viewer: session.staff };
}

/** Out-of-scope and missing records both render the 404 page. */
export async function orNotFound<T>(promise: Promise<T>): Promise<T> {
  try {
    return await promise;
  } catch (error) {
    if (error instanceof AppError && error.kind === "not_found") notFound();
    if (error instanceof AppError && error.kind === "validation") notFound();
    throw error;
  }
}

export type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** Flattens Next's search params to single strings (extra values are ignored). */
export async function readParams(searchParams: SearchParams): Promise<Record<string, string | undefined>> {
  const raw = await searchParams;
  return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]));
}

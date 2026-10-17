import { z } from "zod";
import { ValidationError, type ValidationIssue } from "./errors.js";

export function zodIssues(error: z.ZodError): ValidationIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path.map(String).join("."),
    message: issue.message,
  }));
}

/** Parses untrusted input (tool calls, API bodies) or throws a typed ValidationError. */
export function parseInput<S extends z.ZodType>(schema: S, input: unknown, label = "input"): z.output<S> {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new ValidationError(`Invalid ${label}`, zodIssues(result.error));
  }
  return result.data;
}

export const uuidSchema = z.uuid({ message: "Must be a valid UUID" });

/** Optional free text: trimmed; empty string becomes null. */
export const optionalText = (max = 2000) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((s) => (s.length === 0 ? null : s))
    .nullish()
    .transform((v) => v ?? null);

/** Accepts a Date or an ISO-8601 timestamp that carries an explicit offset/Z. */
export const timestampSchema = z.union([
  z.date(),
  z.iso.datetime({ offset: true }).transform((s) => new Date(s)),
]);

/**
 * Text field for PATCH-style updates: absent → undefined (leave unchanged),
 * null or "" → null (clear), otherwise the trimmed string.
 */
export const patchText = (max = 2000) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((s) => (s.length === 0 ? null : s))
    .nullable()
    .optional();

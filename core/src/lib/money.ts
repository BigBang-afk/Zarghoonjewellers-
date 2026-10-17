import { Decimal } from "decimal.js";
import { z } from "zod";

/**
 * Decimal-safe money and weight handling.
 *
 * Authoritative monetary values are represented as strings at every boundary
 * (database NUMERIC → string → Decimal) and are never converted to JS numbers.
 * Inputs with more precision than the column allows are rejected, not rounded,
 * so no value is ever silently altered.
 */

export const MoneyDecimal = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
export type MoneyDecimal = InstanceType<typeof MoneyDecimal>;

interface DecimalSpec {
  label: string;
  maxScale: number;
  maxIntegerDigits: number;
  allowZero: boolean;
}

function decimalStringSchema(spec: DecimalSpec) {
  return z
    .union([z.string(), z.number()])
    .transform((value, ctx) => {
      // Numbers are accepted only when they are exact integers; fractional JS
      // numbers may already have lost precision before reaching us.
      if (typeof value === "number" && !Number.isSafeInteger(value)) {
        ctx.addIssue({ code: "custom", message: `${spec.label} with decimals must be provided as a string` });
        return z.NEVER;
      }
      const text = String(value).trim().replace(/,/g, "");
      if (!/^\d+(\.\d+)?$/.test(text)) {
        ctx.addIssue({ code: "custom", message: `${spec.label} must be a non-negative decimal number` });
        return z.NEVER;
      }
      const d = new MoneyDecimal(text);
      if (d.decimalPlaces() > spec.maxScale) {
        ctx.addIssue({ code: "custom", message: `${spec.label} allows at most ${spec.maxScale} decimal places` });
        return z.NEVER;
      }
      if (d.truncated().toFixed(0).length > spec.maxIntegerDigits) {
        ctx.addIssue({ code: "custom", message: `${spec.label} is too large` });
        return z.NEVER;
      }
      if (!spec.allowZero && d.isZero()) {
        ctx.addIssue({ code: "custom", message: `${spec.label} must be greater than zero` });
        return z.NEVER;
      }
      return d.toFixed(spec.maxScale);
    });
}

/** NUMERIC(14,2) money amount, returned as a fixed 2-dp string. */
export const moneySchema = (label = "Amount") =>
  decimalStringSchema({ label, maxScale: 2, maxIntegerDigits: 12, allowZero: true });

/** NUMERIC(10,3) weight in grams (> 0), returned as a fixed 3-dp string. */
export const weightGramsSchema = (label = "Weight") =>
  decimalStringSchema({ label, maxScale: 3, maxIntegerDigits: 7, allowZero: false });

export const currencySchema = z
  .string()
  .trim()
  .transform((s) => s.toUpperCase())
  .pipe(z.string().regex(/^[A-Z]{3}$/, "Currency must be a 3-letter ISO code"));

/** Adds decimal strings exactly. */
export function sumMoney(values: readonly string[]): string {
  return values.reduce((acc, v) => acc.plus(v), new MoneyDecimal(0)).toFixed(2);
}

/** Exact comparison of two decimal strings (null-aware). */
export function decimalEquals(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return a === b;
  return new MoneyDecimal(a).equals(b);
}

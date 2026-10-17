import { describe, expect, it } from "vitest";
import { findSecrets, redact, REDACTED } from "../../src/lib/redact.js";
import { toPublicError, InfrastructureError, ProductNotFoundError } from "../../src/lib/errors.js";

describe("redact", () => {
  it("masks secret-looking keys at any depth", () => {
    const out = redact({
      apiKey: "abc",
      nested: { password: "p", refreshToken: "t", shipping_city: "Lahore" },
      list: [{ service_role_key: "x" }],
    }) as Record<string, any>;
    expect(out.apiKey).toBe(REDACTED);
    expect(out.nested.password).toBe(REDACTED);
    expect(out.nested.refreshToken).toBe(REDACTED);
    expect(out.nested.shipping_city).toBe("Lahore");
    expect(out.list[0].service_role_key).toBe(REDACTED);
  });

  it("masks credential-looking values under innocent keys", () => {
    const out = redact({ note: "sk-ant-api03-abcdefghijklmnop", url: "postgres://u:pw@host/db" }) as Record<string, unknown>;
    expect(out.note).toBe(REDACTED);
    expect(out.url).toBe(REDACTED);
  });

  it("reports secret paths for rejection", () => {
    expect(findSecrets({ a: { token: "x" }, b: "fine" })).toEqual(["a.token"]);
    expect(findSecrets({ page: "/necklaces", utm_source: "google" })).toEqual([]);
  });
});

describe("toPublicError", () => {
  it("exposes business errors", () => {
    expect(toPublicError(new ProductNotFoundError({ sku: "ZJ-X-1" })).code).toBe("PRODUCT_NOT_FOUND");
  });
  it("hides infrastructure details", () => {
    const pub = toPublicError(new InfrastructureError("connection to postgres://u:pw@host failed"));
    expect(pub).toEqual({ code: "INTERNAL_ERROR", message: "An internal error occurred" });
    expect(toPublicError(new Error("boom")).code).toBe("INTERNAL_ERROR");
  });
});

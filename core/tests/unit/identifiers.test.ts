import { describe, expect, it } from "vitest";
import { normalizeEmail, normalizeExternalIdentity, normalizePhone } from "../../src/lib/identifiers.js";

describe("normalizePhone", () => {
  it.each([
    ["03001234567", "+923001234567"],
    ["0300-1234567", "+923001234567"],
    ["+92 300 1234567", "+923001234567"],
    ["923001234567", "+923001234567"],
    ["00923001234567", "+923001234567"],
    ["(0300) 123 4567", "+923001234567"],
    ["+1 415 555 2671", "+14155552671"],
  ])("normalizes %s to %s", (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  });

  it.each(["12345", "0300 123", "not a phone", "", "+92300123456789", "0300123456a"])("rejects %j", (input) => {
    expect(normalizePhone(input)).toBeNull();
  });
});

describe("normalizeEmail", () => {
  it("trims and lowercases", () => {
    expect(normalizeEmail("  Sara.Ahmed@Example.COM ")).toBe("sara.ahmed@example.com");
  });
  it("rejects invalid addresses", () => {
    expect(normalizeEmail("sara@")).toBeNull();
    expect(normalizeEmail("")).toBeNull();
  });
});

describe("normalizeExternalIdentity", () => {
  it("strips @ and lowercases social handles", () => {
    expect(normalizeExternalIdentity("instagram", " @Zarghoon.Fan ")).toBe("zarghoon.fan");
  });
  it("keeps opaque IDs as-is apart from trimming", () => {
    expect(normalizeExternalIdentity("facebook", " 1234ABC ")).toBe("1234ABC");
  });
  it("rejects empty values", () => {
    expect(normalizeExternalIdentity("website_visitor", "   ")).toBeNull();
  });
});

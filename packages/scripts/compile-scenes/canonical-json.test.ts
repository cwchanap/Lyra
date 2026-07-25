import { describe, expect, it } from "vitest";
import { canonicalJson, sha256CanonicalJson } from "./canonical-json";

describe("canonicalJson", () => {
  it("sorts object keys recursively and preserves semantic array order", () => {
    const left = { z: [{ b: 2, a: 1 }], a: true };
    const right = { a: true, z: [{ a: 1, b: 2 }] };

    expect(canonicalJson(left)).toBe(canonicalJson(right));
    expect(canonicalJson({ items: ["a", "b"] })).not.toBe(
      canonicalJson({ items: ["b", "a"] }),
    );
  });

  it.each([
    { value: Number.NaN, message: "non-finite number" },
    { value: Number.POSITIVE_INFINITY, message: "non-finite number" },
    { value: { missing: undefined }, message: "undefined" },
    { value: 1n, message: "bigint" },
    { value: new Map(), message: "plain JSON object" },
  ])("rejects $message", ({ value, message }) => {
    expect(() => canonicalJson(value)).toThrow(message);
  });

  it("returns a stable lowercase SHA-256 tag", () => {
    const hash = sha256CanonicalJson({ b: 2, a: 1 });
    expect(hash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(hash).toBe(sha256CanonicalJson({ a: 1, b: 2 }));
  });
});

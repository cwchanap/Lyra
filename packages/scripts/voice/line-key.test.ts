import { describe, expect, it } from "vitest";
import { keyExpression, localeLineKey } from "./line-key";

describe("localeLineKey", () => {
  it("treats the standard expression and a portrait-less line alike", () => {
    expect(keyExpression("standard")).toBeNull();
    expect(keyExpression(null)).toBeNull();
    expect(keyExpression(undefined)).toBeNull();
    expect(
      localeLineKey({
        speaker: "相馬律",
        text: "好。",
        expression: "standard",
      }),
    ).toBe(
      localeLineKey({ speaker: "相馬律", text: "好。", expression: null }),
    );
  });

  it("separates lines by speaker, expression and text", () => {
    const base = localeLineKey({ speaker: "相馬律", text: "好。" });
    expect(localeLineKey({ speaker: "早坂茜", text: "好。" })).not.toBe(base);
    expect(
      localeLineKey({ speaker: "相馬律", text: "好。", expression: "smiling" }),
    ).not.toBe(base);
    expect(localeLineKey({ speaker: "相馬律", text: "好！" })).not.toBe(base);
  });
});

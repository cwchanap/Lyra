import { describe, expect, it } from "vitest";
import { cssRule } from "./test-utils";

describe("cssRule", () => {
  it("returns the declaration block for a simple element selector", () => {
    const source = `aside {\n  position: static;\n  width: 100%;\n}`;
    expect(cssRule(source, "aside")).toContain("position: static");
    expect(cssRule(source, "aside")).toContain("width: 100%");
  });

  it("returns the declaration block for a multi-dot class selector", () => {
    // Pins the replaceAll(".") fix: the old InvestigationSceneSurface helper
    // used replace(".") which only escaped the first dot, so a selector like
    // ".scene-coordinate-plane" left two dots unescaped. The shared helper
    // must escape every dot.
    const source = ".scene-coordinate-plane {\n  left: 50%;\n  top: 50%;\n}";
    expect(cssRule(source, ".scene-coordinate-plane")).toContain("left: 50%");
    expect(cssRule(source, ".scene-coordinate-plane")).toContain("top: 50%");
  });

  it("returns an empty string when the selector is absent", () => {
    const source = "aside { position: static; }";
    expect(cssRule(source, ".missing")).toBe("");
  });

  it("balances braces so native CSS nesting is not truncated", () => {
    // The hardening point: a naive {([^}]*)} regex would stop at the first
    // nested '}' and return only 'color: red; &:hover { color: blue; ',
    // dropping the trailing declarations. The brace-balanced helper returns
    // the full block including the nested rule and the declarations after it.
    const source = [
      ".foo {",
      "  color: red;",
      "  &:hover {",
      "    color: blue;",
      "  }",
      "  background: black;",
      "}",
    ].join("\n");

    const rule = cssRule(source, ".foo");
    expect(rule).toContain("color: red");
    expect(rule).toContain("&:hover");
    expect(rule).toContain("color: blue");
    expect(rule).toContain("background: black");
  });

  it("returns the first match when a selector appears more than once", () => {
    const source = [
      ".panel { max-height: min(42vh, 360px); }",
      "@media (max-width: 720px) { .panel { padding: 20px; } }",
    ].join("\n");

    expect(cssRule(source, ".panel")).toContain("max-height: min(42vh, 360px)");
    expect(cssRule(source, ".panel")).not.toContain("padding: 20px");
  });
});

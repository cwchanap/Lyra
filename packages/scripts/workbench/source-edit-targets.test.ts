// =============================================================================
// packages/scripts/workbench/source-edit-targets.test.ts
//
// HPA-135 Task 1.5: the one-line byte-preserving scene source renderer. It
// reads only the compiler-provided physical line, never scans other lines,
// and preserves every byte around the replaced logical value.
// =============================================================================

import { describe, expect, it } from "vitest";
import {
  renderSceneSourceReplacement,
  type WorkbenchSourceTarget,
} from "./source-edit-targets";

function target(
  overrides: Partial<WorkbenchSourceTarget> & {
    line: number;
    currentText: string;
  },
): WorkbenchSourceTarget {
  return {
    semanticRef: "reader:dialogue:main:0",
    kind: "readerDialogue",
    ...overrides,
  };
}

function render(
  source: string,
  workbenchTarget: WorkbenchSourceTarget,
  replacementText: string,
) {
  return renderSceneSourceReplacement({
    source,
    target: workbenchTarget,
    replacementText,
  });
}

describe("direct reader lines", () => {
  it("changes only the text after ：, preserving speaker/expression/indent/trailing whitespace/EOL", () => {
    const source = [
      "# Scene 0: 接案",
      "",
      "  **相馬律**[concerned]：原文   ",
      "next",
    ].join("\n");
    const result = render(
      source,
      target({ line: 3, currentText: "原文" }),
      "替換後的台詞",
    );
    if (!result.ok) throw new Error(result.diagnostic.message);
    expect(result.nextContent).toBe(
      [
        "# Scene 0: 接案",
        "",
        "  **相馬律**[concerned]：替換後的台詞   ",
        "next",
      ].join("\n"),
    );
  });

  it("preserves CRLF line endings on untouched parts of the document", () => {
    const source = "# Scene 0: 接案\r\n\r\n**相馬律**：原文\r\nnext";
    const result = render(
      source,
      target({ line: 3, currentText: "原文" }),
      "新文",
    );
    if (!result.ok) throw new Error(result.diagnostic.message);
    expect(result.nextContent).toBe(
      "# Scene 0: 接案\r\n\r\n**相馬律**：新文\r\nnext",
    );
  });

  it("changes only the bracket contents of a single-line action", () => {
    const source = ["# Scene 0", "", "[相馬律走進場景。]", "next"].join("\n");
    const result = render(
      source,
      target({
        semanticRef: "reader:action:main:0",
        kind: "readerAction",
        line: 3,
        currentText: "相馬律走進場景。",
      }),
      "相馬律停在門口。",
    );
    if (!result.ok) throw new Error(result.diagnostic.message);
    expect(result.nextContent).toBe(
      ["# Scene 0", "", "[相馬律停在門口。]", "next"].join("\n"),
    );
  });

  it("rejects a multiline action as unsupported", () => {
    // A multiline bracket action tokenizes to `unknown` on its first physical
    // line; it is read-only in v1.
    const source = [
      "# Scene 0",
      "",
      "[很長的動作開始",
      "延續到下一行。]",
      "",
    ].join("\n");
    const result = render(
      source,
      target({
        semanticRef: "reader:action:main:0",
        kind: "readerAction",
        line: 3,
        currentText: "很長的動作開始 延續到下一行。",
      }),
      "新動作。",
    );
    expect(result).toMatchObject({
      ok: false,
      diagnostic: { code: "workbenchSourceMultilineActionUnsupported" },
    });
  });
});

describe("metadata-wrapped reader items", () => {
  it("replaces only the inner dialogue value, byte-preserving the metadata prefix", () => {
    const source = [
      "#### Testimony",
      "",
      "- **On Loop:** **相馬律**：原文",
      "",
    ].join("\n");
    const result = render(
      source,
      target({ line: 3, currentText: "原文" }),
      "替換",
    );
    if (!result.ok) throw new Error(result.diagnostic.message);
    expect(result.nextContent).toBe(
      ["#### Testimony", "", "- **On Loop:** **相馬律**：替換", ""].join("\n"),
    );
  });

  it("replaces only the inner action value of a metadata-wrapped challenge", () => {
    const source = [
      "##### Line: 說詞 {#l1}",
      "",
      "- **Challenge:** [原動作]",
    ].join("\n");
    const result = render(
      source,
      target({
        semanticRef: "reader:action:question:q:line:l1:challenge:0",
        kind: "readerAction",
        line: 3,
        currentText: "原動作",
      }),
      "新動作",
    );
    if (!result.ok) throw new Error(result.diagnostic.message);
    expect(result.nextContent).toBe(
      ["##### Line: 說詞 {#l1}", "", "- **Challenge:** [新動作]"].join("\n"),
    );
  });

  it("rejects a wrong metadata-wrapped current value and never searches elsewhere", () => {
    // The expected value exists on ANOTHER line; the renderer must still
    // fail instead of relocating.
    const source = [
      "#### Testimony",
      "",
      "- **On Loop:** **相馬律**：別的內容",
      "",
      "**相馬律**：原文",
    ].join("\n");
    const result = render(
      source,
      target({ line: 3, currentText: "原文" }),
      "替換",
    );
    expect(result).toMatchObject({
      ok: false,
      diagnostic: { code: "workbenchSourceCarrierStale" },
    });
  });
});

describe("prompt lines", () => {
  it("changes only the Background Prompt metadata value at the compiler line", () => {
    const source = [
      "[場景：咖啡館外，雨夜。]",
      "- **Background Prompt:** Old rainy exterior.",
      "- **BGM:** none",
    ].join("\n");
    const result = render(
      source,
      target({
        semanticRef: "asset:background:tag_001",
        kind: "backgroundPrompt",
        line: 2,
        currentText: "Old rainy exterior.",
      }),
      "New rainy exterior with wet asphalt.",
    );
    if (!result.ok) throw new Error(result.diagnostic.message);
    expect(result.nextContent).toBe(
      [
        "[場景：咖啡館外，雨夜。]",
        "- **Background Prompt:** New rainy exterior with wet asphalt.",
        "- **BGM:** none",
      ].join("\n"),
    );
  });

  it("changes only the Image Prompt metadata value at the compiler line", () => {
    const source = [
      "### evidence:receipt {#receipt}",
      "- **Image Prompt:** Old receipt icon.",
      "",
    ].join("\n");
    const result = render(
      source,
      target({
        semanticRef: "asset:evidence:receipt:imagePrompt",
        kind: "evidenceImagePrompt",
        line: 2,
        currentText: "Old receipt icon.",
      }),
      "New flattened receipt icon.",
    );
    if (!result.ok) throw new Error(result.diagnostic.message);
    expect(result.nextContent).toBe(
      [
        "### evidence:receipt {#receipt}",
        "- **Image Prompt:** New flattened receipt icon.",
        "",
      ].join("\n"),
    );
  });

  it("rejects a prompt target whose line holds a different metadata key", () => {
    const source = ["[場景：雨夜。]", "- **BGM:** none"].join("\n");
    const result = render(
      source,
      target({
        semanticRef: "asset:background:tag_001",
        kind: "backgroundPrompt",
        line: 2,
        currentText: "none",
      }),
      "New prompt.",
    );
    expect(result).toMatchObject({
      ok: false,
      diagnostic: { code: "workbenchSourceCarrierStale" },
    });
  });
});

describe("all replacements", () => {
  it("rejects CR/LF inside the replacement text", () => {
    const source = ["# Scene 0", "", "**相馬律**：原文"].join("\n");
    for (const replacementText of ["第一行\n第二行", "含歸位\r字元"]) {
      const result = render(
        source,
        target({ line: 3, currentText: "原文" }),
        replacementText,
      );
      expect(result.ok).toBe(false);
    }
  });

  it("rejects when the line syntax or current value does not match", () => {
    const source = ["# Scene 0", "", "**相馬律**：原文"].join("\n");
    // wrong current text
    expect(
      render(source, target({ line: 3, currentText: "不同" }), "替換"),
    ).toMatchObject({
      ok: false,
      diagnostic: { code: "workbenchSourceCarrierStale" },
    });
    // wrong syntax: action target on a dialogue line
    expect(
      render(
        source,
        target({ kind: "readerAction", line: 3, currentText: "原文" }),
        "替換",
      ),
    ).toMatchObject({
      ok: false,
      diagnostic: { code: "workbenchSourceCarrierStale" },
    });
    // line out of range
    expect(
      render(source, target({ line: 99, currentText: "原文" }), "替換"),
    ).toMatchObject({
      ok: false,
      diagnostic: { code: "workbenchSourceCarrierStale" },
    });
  });

  it("always yields the same physical line count with exactly one changed line", () => {
    const source = [
      "# Scene 0",
      "",
      "**相馬律**：原文",
      "",
      "[動作]",
      "**早坂茜**：好。",
    ].join("\n");
    const result = render(
      source,
      target({ line: 3, currentText: "原文" }),
      "內容完全不同的全新台詞",
    );
    if (!result.ok) throw new Error(result.diagnostic.message);
    const before = source.split("\n");
    const after = result.nextContent.split("\n");
    expect(after).toHaveLength(before.length);
    const changed = before
      .map((line, index) => (line === after[index] ? -1 : index))
      .filter((index) => index >= 0);
    expect(changed).toEqual([2]);
  });
});

// =============================================================================
// packages/scripts/compile-scenes/parser-source-lines.test.ts
//
// HPA-135 Task 1.1: every DialogueItem construction path must capture the
// authored tokenizer token's physical line as compiler-only `sourceLine`.
// Metadata-wrapped interrogation fields (On Loop, Challenge, ...) must carry
// the OUTER metadata token's authored line, never the inner re-tokenized
// line 1 that parseDialogueFieldValue() would otherwise produce.
// =============================================================================

import { describe, expect, it } from "vitest";
import { parseAnalysisScene } from "./parser-analysis";
import { parseInterrogationScene } from "./parser-interrogation";
import { parseInvestigationScene } from "./parser-investigation";
import { parseLinearScene } from "./parser-linear";
import type { DialogueItem } from "./types";

/** Authored 1-based line of the first source line containing `needle`. */
function lineOf(source: string, needle: string): number {
  const index = source.split("\n").findIndex((line) => line.includes(needle));
  if (index < 0) throw new Error(`needle not found in source: ${needle}`);
  return index + 1;
}

function itemsOf(
  items: DialogueItem[],
): Array<Extract<DialogueItem, { kind: "line" | "action" }>> {
  return items.filter(
    (item): item is Extract<DialogueItem, { kind: "line" | "action" }> =>
      item.kind === "line" || item.kind === "action",
  );
}

describe("linear scene source lines", () => {
  it("captures authored lines for direct dialogue, action, and sceneTag", () => {
    const source = [
      "# Scene 0: 測試",
      "",
      "[場景：前廳，深夜。]",
      "",
      "[相馬律走進場景。]",
      "",
      "**相馬律**：測試開始。",
    ].join("\n");
    const parsed = parseLinearScene(source, "scene_0.md", "scene_0");
    if (!parsed.ok) throw new Error(parsed.error.message);

    const queue = parsed.value.queue;
    expect(queue[0]).toMatchObject({
      kind: "sceneTag",
      text: "前廳，深夜。",
      sourceLine: lineOf(source, "[場景：前廳，深夜。]"),
    });
    expect(queue[1]).toMatchObject({
      kind: "action",
      text: "相馬律走進場景。",
      sourceLine: lineOf(source, "[相馬律走進場景。]"),
    });
    expect(queue[2]).toMatchObject({
      kind: "line",
      speaker: "相馬律",
      text: "測試開始。",
      sourceLine: lineOf(source, "**相馬律**：測試開始。"),
    });
  });
});

describe("investigation scene source lines", () => {
  const source = [
    "# Scene 1: 測試調查",
    "",
    "## Intro",
    "",
    "**相馬律**：開始調查。",
    "",
    "## Sub-location: 前廳 {#front_hall}",
    "",
    "- **Status:** unlocked",
    "",
    "[場景：前廳。]",
    "",
    "[相馬律走進前廳。]",
    "",
    "### Hotspot: 咖啡機 {#coffee_machine}",
    "",
    "- **Description:** 一台老咖啡機。",
    "",
    "**相馬律**：檢查咖啡機。",
    "",
    "### Character: 早坂茜 {#hayasaka_akane}",
    "",
    "- **Role:** 律師",
    "- **Bio:** 委託人。",
    "",
    "#### Topic: 委託內容 {#case_brief}",
    "",
    "**早坂茜**：關於委託。",
    "",
    "## Evidence Manifest",
    "",
    "### evidence:receipt {#receipt}",
    "",
    "- **Name:** 收據",
    "- **Description:** 一張收據。",
    "- **Details:** 時間是 23:10。",
    "",
    "#### On Collect",
    "",
    "**相馬律**：拿到收據。",
    "",
    "## Statement Manifest",
    "",
    "### statement:alibi {#alibi}",
    "",
    "- **Speaker:** 早坂茜",
    "- **Content:** 「我在場。」",
    "",
    "#### On Acquire",
    "",
    "**早坂茜**：確認證詞。",
    "",
    "## Outro",
    "",
    "**相馬律**：調查結束。",
  ].join("\n");

  function parse() {
    const parsed = parseInvestigationScene(
      source,
      "investigation_scene_1.md",
      "investigation_scene_1",
    );
    if (!parsed.ok) throw new Error(parsed.error.message);
    return parsed.value;
  }

  it("captures intro and sublocation transition dialogue/action lines", () => {
    const ast = parse();
    expect(ast.intro[0]).toMatchObject({
      kind: "line",
      text: "開始調查。",
      sourceLine: lineOf(source, "**相馬律**：開始調查。"),
    });
    const transition = itemsOf(ast.sublocations[0]!.transitionDialogue);
    expect(transition[0]).toMatchObject({
      kind: "action",
      text: "相馬律走進前廳。",
      sourceLine: lineOf(source, "[相馬律走進前廳。]"),
    });
  });

  it("captures hotspot inspect and topic dialogue lines", () => {
    const ast = parse();
    const hotspot = ast.sublocations[0]!.hotspots[0]!;
    expect(hotspot.inspectDialogue[0]).toMatchObject({
      kind: "line",
      text: "檢查咖啡機。",
      sourceLine: lineOf(source, "**相馬律**：檢查咖啡機。"),
    });
    const topic = ast.sublocations[0]!.characters[0]!.topics[0]!;
    expect(topic.topicDialogue[0]).toMatchObject({
      kind: "line",
      text: "關於委託。",
      sourceLine: lineOf(source, "**早坂茜**：關於委託。"),
    });
  });

  it("captures evidence/statement manifest On Collect / On Acquire lines", () => {
    const ast = parse();
    expect(ast.evidenceManifest[0]!.onCollect[0]).toMatchObject({
      kind: "line",
      text: "拿到收據。",
      sourceLine: lineOf(source, "**相馬律**：拿到收據。"),
    });
    expect(ast.statementManifest[0]!.onAcquire[0]).toMatchObject({
      kind: "line",
      text: "確認證詞。",
      sourceLine: lineOf(source, "**早坂茜**：確認證詞。"),
    });
  });

  it("captures outro dialogue lines", () => {
    const ast = parse();
    expect(ast.outro.dialogue[0]).toMatchObject({
      kind: "line",
      text: "調查結束。",
      sourceLine: lineOf(source, "**相馬律**：調查結束。"),
    });
  });
});

describe("interrogation scene source lines", () => {
  const source = [
    "# Scene 1: 測試詢問",
    "",
    "## Intro",
    "",
    "**相馬律**：開始詢問。",
    "",
    "## Phase: 初步 {#phase_a}",
    "",
    "- **Kind:** inquiry",
    "",
    "[場景：詢問室。]",
    "",
    "[相馬律坐下。]",
    "",
    "### Subject: 若槻蓮 {#wakatsuki_ren}",
    "",
    "- **Role:** 嫌疑人",
    "- **Bio:** 店員。",
    "",
    "### Question: 動線 {#route}",
    "",
    "- **Status:** unlocked",
    "",
    "#### Testimony",
    "",
    "- **On Loop:** **相馬律**：再說一次。",
    "- **Loop Prompt:** **相馬律**：從頭再聽。",
    "- **Default Challenge:** [相馬律盯著紀錄。]",
    "- **Default Wrong:** **相馬律**：這裡不對。",
    "- **Wrong Reply:** **相馬律**：不是這件。",
    "",
    "##### Line: 說詞 {#l_claim}",
    "",
    "**若槻蓮**：我一直在店裡。",
    "",
    "- **Contradiction:** evidence:log",
    "- **Challenge:** **相馬律**：紀錄顯示你出去了。",
    "- **On Correct:** **若槻蓮**：好吧。",
    "- **On Wrong Evidence:** **若槻蓮**：證明不了。",
    "",
    "## Evidence Manifest",
    "",
    "### evidence:log {#log}",
    "",
    "- **Name:** 紀錄",
    "- **Description:** 出入紀錄。",
    "- **Details:** 23:10。",
    "",
    "#### On Collect",
    "",
    "**相馬律**：拿到紀錄。",
    "",
    "## Outro",
    "",
    "**相馬律**：結束。",
  ].join("\n");

  function parse() {
    const parsed = parseInterrogationScene(
      source,
      "interrogation_scene_1.md",
      "interrogation_scene_1",
    );
    if (!parsed.ok) throw new Error(parsed.error.message);
    return parsed.value;
  }

  it("captures direct intro, phase-entry, and testimony-content lines", () => {
    const ast = parse();
    expect(ast.intro[0]).toMatchObject({
      kind: "line",
      text: "開始詢問。",
      sourceLine: lineOf(source, "**相馬律**：開始詢問。"),
    });
    const entry = itemsOf(ast.phases[0]!.entryDialogue);
    expect(entry[0]).toMatchObject({
      kind: "action",
      text: "相馬律坐下。",
      sourceLine: lineOf(source, "[相馬律坐下。]"),
    });
    const testimony = ast.phases[0]!.questions[0]!.testimony;
    expect(testimony.lines[0]!.content[0]).toMatchObject({
      kind: "line",
      speaker: "若槻蓮",
      text: "我一直在店裡。",
      sourceLine: lineOf(source, "**若槻蓮**：我一直在店裡。"),
    });
  });

  it("uses the OUTER metadata line for metadata-wrapped testimony fields", () => {
    // parseDialogueFieldValue() re-tokenizes the metadata value; the inner
    // tokens start at line 1. Every returned item must instead carry the
    // authored line of the `- **Key:**` metadata token itself.
    const ast = parse();
    const testimony = ast.phases[0]!.questions[0]!.testimony;
    const cases: Array<[string, DialogueItem[]]> = [
      ["**相馬律**：再說一次。", testimony.onLoop],
      ["**相馬律**：從頭再聽。", testimony.loopPrompt ?? []],
      ["[相馬律盯著紀錄。]", testimony.defaultChallenge ?? []],
      ["**相馬律**：這裡不對。", testimony.defaultWrong ?? []],
      ["**相馬律**：不是這件。", testimony.wrongReply ?? []],
    ];
    for (const [needle, items] of cases) {
      const expected = lineOf(source, needle);
      expect(expected).toBeGreaterThan(1); // a real authored metadata line
      for (const item of items) {
        expect(item).toMatchObject({ sourceLine: expected });
      }
    }
  });

  it("uses the OUTER metadata line for testimony Line fields", () => {
    const ast = parse();
    const line = ast.phases[0]!.questions[0]!.testimony.lines[0]!;
    const cases: Array<[string, DialogueItem[]]> = [
      ["**相馬律**：紀錄顯示你出去了。", line.challenge ?? []],
      ["**若槻蓮**：好吧。", line.onCorrect ?? []],
      ["**若槻蓮**：證明不了。", line.onWrongEvidence ?? []],
    ];
    for (const [needle, items] of cases) {
      const expected = lineOf(source, needle);
      expect(expected).toBeGreaterThan(1);
      for (const item of items) {
        expect(item).toMatchObject({ sourceLine: expected });
      }
    }
  });
});

describe("analysis scene source lines", () => {
  it("captures intro, result, and outro dialogue lines", () => {
    const source = [
      "# Scene 8: 雨夜的推理整理",
      "- **Summary:** 相馬整理線索。",
      "## Intro",
      "**相馬律**：先把能證明的事實分開。",
      "## Board: 線索分類 {#source_classification}",
      "- **Kind:** classify",
      "- **Prompt:** 將卡片分到正確的證據群組。",
      "- **Reveals:** [assert_fact:source_classified]",
      "- **Incomplete Feedback:** 還有卡片沒有分類。",
      "- **Incorrect Feedback:** 這個來源不支持該分類。",
      "### Card: 月台照片 {#platform_photo}",
      "- **Source:** evidence:platform_photo",
      "- **Summary:** 月台監視器留下的雨衣身影。",
      "### Group: 影像證據 {#visual}",
      "- **Description:** 可以直接核對時間的影像。",
      "- **Accepted Cards:** [platform_photo]",
      "### Result Dialogue",
      "**相馬律**：來源已經分清楚了。",
      "## Outro",
      "**相馬律**：下一步去找站務員。",
    ].join("\n");
    const parsed = parseAnalysisScene(
      source,
      "analysis_scene_1.md",
      "analysis_scene_1",
    );
    if (!parsed.ok) throw new Error(parsed.error.message);

    expect(parsed.value.intro[0]).toMatchObject({
      kind: "line",
      text: "先把能證明的事實分開。",
      sourceLine: lineOf(source, "**相馬律**：先把能證明的事實分開。"),
    });
    expect(parsed.value.boards[0]!.resultDialogue[0]).toMatchObject({
      kind: "line",
      text: "來源已經分清楚了。",
      sourceLine: lineOf(source, "**相馬律**：來源已經分清楚了。"),
    });
    expect(parsed.value.outro[0]).toMatchObject({
      kind: "line",
      text: "下一步去找站務員。",
      sourceLine: lineOf(source, "**相馬律**：下一步去找站務員。"),
    });
  });
});

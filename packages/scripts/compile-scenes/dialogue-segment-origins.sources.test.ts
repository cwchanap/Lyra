// =============================================================================
// packages/scripts/compile-scenes/dialogue-segment-origins.sources.test.ts
//
// HPA-135 Task 1.3: shared carrier identity + compiler-owned per-item source
// lines. When deriveDialogueSegments() receives sourceAst, every carrier must
// expose itemSources[] parallel to its emitted items, joined by emitted item
// index, with source owners associated by semantic ID (never raw array
// order). Carrier-local mismatch resolves to workbenchSourceCarrierStale.
// =============================================================================

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  dialogueSegmentCarrierId,
  deriveDialogueSegments,
  resolveDialogueItemSource,
} from "./dialogue-segment-origins";
import { compileCaseRecordCorpus } from "./case-record-provenance";
import { emitInterrogationScene, emitInvestigationScene } from "./emitter";
import { parseAnalysisScene } from "./parser-analysis";
import { parseInterrogationScene } from "./parser-interrogation";
import { parseInvestigationScene } from "./parser-investigation";
import { parseLinearScene } from "./parser-linear";
import { emptyStoryCatalog } from "./parser-story-catalog";
import type {
  ASTInterrogationScene,
  ASTInvestigationScene,
  CompiledCaseRecordCorpus,
  JSONAnalysisScene,
} from "./types";

const INVESTIGATION_PATH =
  "packages/scripts/__fixtures__/valid/chapter_1/investigation_scene_1.md";
const LINEAR_PATH = "packages/scripts/__fixtures__/valid/chapter_1/scene_0.md";
const INTERROGATION_PATH =
  "packages/scripts/__fixtures__/valid_interrogation/chapter_1/interrogation_scene_1.md";

function corpusForAst(
  ast: ASTInvestigationScene | ASTInterrogationScene,
): CompiledCaseRecordCorpus {
  const result = compileCaseRecordCorpus(
    emptyStoryCatalog("story_catalog.md"),
    [{ chapterId: "chapter_1", file: ast.sourceFile, ast }],
  );
  if (!result.ok) {
    throw new Error(result.errors.map(({ message }) => message).join("\n"));
  }
  return result.value;
}

function investigationAst(): ASTInvestigationScene {
  const parsed = parseInvestigationScene(
    readFileSync(resolve(INVESTIGATION_PATH), "utf8"),
    INVESTIGATION_PATH,
    "investigation_scene_1",
  );
  if (!parsed.ok) throw new Error(parsed.error.message);
  return parsed.value;
}

function interrogationAst(): ASTInterrogationScene {
  const parsed = parseInterrogationScene(
    readFileSync(resolve(INTERROGATION_PATH), "utf8"),
    INTERROGATION_PATH,
    "interrogation_scene_1",
  );
  if (!parsed.ok) throw new Error(parsed.error.message);
  return parsed.value;
}

const ANALYSIS_SOURCE = [
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

function analysisJson(
  ast: ReturnType<typeof parseAnalysisAst>,
): JSONAnalysisScene {
  const resultDialogue = ast.boards[0]!.resultDialogue;
  return {
    type: "analysis",
    id: ast.id,
    title: ast.title,
    summary: ast.summary,
    assetRefs: [],
    intro: [
      {
        kind: "line",
        speaker: "相馬律",
        text: "先把能證明的事實分開。",
        portrait: null,
      },
    ],
    boards: [
      {
        kind: "classify",
        common: {
          id: "source_classification",
          label: "線索分類",
          prompt: "將卡片分到正確的證據群組。",
          unlock: null,
          reveals: [{ kind: "assertFact", factId: "source_classified" }],
          feedback: {
            incomplete: "還有卡片沒有分類。",
            incorrect: "這個來源不支持該分類。",
            hint: null,
            incorrectSelections: [],
          },
          cards: [],
          resultDialogue: resultDialogue.map((item) =>
            item.kind === "line"
              ? {
                  kind: "line" as const,
                  speaker: item.speaker,
                  text: item.text,
                  portrait: null,
                }
              : item,
          ),
        },
        groups: [],
        acceptedGroupByCard: {},
      },
    ],
    outro: [
      {
        kind: "line",
        speaker: "相馬律",
        text: "下一步去找站務員。",
        portrait: null,
      },
    ],
  };
}

function parseAnalysisAst() {
  const parsed = parseAnalysisScene(
    ANALYSIS_SOURCE,
    "analysis_scene_1.md",
    "analysis_scene_1",
  );
  if (!parsed.ok) throw new Error(parsed.error.message);
  return parsed.value;
}

function segmentsByCarrier(
  segments: ReturnType<typeof deriveDialogueSegments>,
): Map<string, ReturnType<typeof deriveDialogueSegments>[number]> {
  return new Map(segments.map((s) => [dialogueSegmentCarrierId(s.origin), s]));
}

describe("dialogueSegmentCarrierId", () => {
  it("owns the carrier spelling for every origin family", () => {
    const chapterId = "chapter_1";
    const sceneId = "scene_1";
    expect(
      dialogueSegmentCarrierId({ type: "linearScene", chapterId, sceneId }),
    ).toBe("main");
    expect(
      dialogueSegmentCarrierId({
        type: "investigationIntro",
        chapterId,
        sceneId,
      }),
    ).toBe("intro");
    expect(
      dialogueSegmentCarrierId({
        type: "investigationOutro",
        chapterId,
        sceneId,
      }),
    ).toBe("outro");
    expect(
      dialogueSegmentCarrierId({
        type: "interrogationIntro",
        chapterId,
        sceneId,
      }),
    ).toBe("intro");
    expect(
      dialogueSegmentCarrierId({
        type: "interrogationOutro",
        chapterId,
        sceneId,
      }),
    ).toBe("outro");
    expect(
      dialogueSegmentCarrierId({ type: "analysisIntro", chapterId, sceneId }),
    ).toBe("intro");
    expect(
      dialogueSegmentCarrierId({ type: "analysisOutro", chapterId, sceneId }),
    ).toBe("outro");
    expect(
      dialogueSegmentCarrierId({
        type: "investigationInteraction",
        chapterId,
        sceneId,
        segmentId: "hotspot:table:inspect",
      }),
    ).toBe("hotspot:table:inspect");
    expect(
      dialogueSegmentCarrierId({
        type: "interrogationPhase",
        chapterId,
        sceneId,
        phaseId: "press",
        segmentId: "question:alibi:onLoop",
      }),
    ).toBe("question:alibi:onLoop");
    expect(
      dialogueSegmentCarrierId({
        type: "analysisResult",
        chapterId,
        sceneId,
        boardId: "source_classification",
      }),
    ).toBe("board:source_classification:result");
  });
});

describe("deriveDialogueSegments itemSources", () => {
  it("exposes linear main item sources parallel to emitted items", () => {
    const parsed = parseLinearScene(
      readFileSync(resolve(LINEAR_PATH), "utf8"),
      LINEAR_PATH,
      "scene_0",
    );
    if (!parsed.ok) throw new Error(parsed.error.message);
    const segments = deriveDialogueSegments({
      chapterId: "chapter_1",
      json: {
        type: "linear",
        id: "scene_0",
        title: parsed.value.title,
        summary: parsed.value.summary,
        queue: parsed.value.queue.map((item) =>
          item.kind === "line"
            ? {
                kind: "line" as const,
                speaker: item.speaker,
                text: item.text,
                portrait: null,
              }
            : item.kind === "sceneTag"
              ? { kind: "sceneTag" as const, text: item.text, assetCue: null }
              : { kind: "action" as const, text: item.text },
        ),
        assetRefs: [],
      },
      sourceAst: parsed.value,
    });
    const main = segmentsByCarrier(segments).get("main");
    expect(main?.itemSources).toEqual([
      { sourceFile: LINEAR_PATH, line: 3 },
      { sourceFile: LINEAR_PATH, line: 5 },
      { sourceFile: LINEAR_PATH, line: 7 },
      { sourceFile: LINEAR_PATH, line: 9 },
      { sourceFile: LINEAR_PATH, line: 11 },
      { sourceFile: LINEAR_PATH, line: 13 },
    ]);
    const resolution = resolveDialogueItemSource(segments, "main", 2);
    expect(resolution).toEqual({
      ok: true,
      sourceFile: LINEAR_PATH,
      line: 7,
    });
  });

  it("exposes investigation carrier item sources by semantic id", () => {
    const ast = investigationAst();
    const segments = deriveDialogueSegments({
      chapterId: "chapter_1",
      json: emitInvestigationScene(ast, corpusForAst(ast)),
      sourceAst: ast,
    });
    const byCarrier = segmentsByCarrier(segments);

    expect(byCarrier.get("intro")?.itemSources).toEqual([
      { sourceFile: INVESTIGATION_PATH, line: 5 },
      { sourceFile: INVESTIGATION_PATH, line: 7 },
    ]);
    expect(byCarrier.get("hotspot:table:inspect")?.itemSources).toEqual([
      { sourceFile: INVESTIGATION_PATH, line: 24 },
      { sourceFile: INVESTIGATION_PATH, line: 26 },
    ]);
    expect(
      byCarrier.get("topic:witness:timeline:dialogue")?.itemSources,
    ).toEqual([{ sourceFile: INVESTIGATION_PATH, line: 50 }]);
    expect(byCarrier.get("evidence:coffee:onCollect")?.itemSources).toEqual([
      { sourceFile: INVESTIGATION_PATH, line: 93 },
    ]);
    expect(byCarrier.get("outro")?.itemSources).toEqual([
      { sourceFile: INVESTIGATION_PATH, line: 129 },
      { sourceFile: INVESTIGATION_PATH, line: 131 },
    ]);

    const resolution = resolveDialogueItemSource(
      segments,
      "hotspot:table:inspect",
      1,
    );
    expect(resolution).toEqual({
      ok: true,
      sourceFile: INVESTIGATION_PATH,
      line: 26,
    });
  });

  it("exposes interrogation phase/testimony branch item sources", () => {
    const ast = interrogationAst();
    const segments = deriveDialogueSegments({
      chapterId: "chapter_1",
      json: emitInterrogationScene(ast, corpusForAst(ast)),
      sourceAst: ast,
    });
    const byCarrier = segmentsByCarrier(segments);

    expect(byCarrier.get("intro")?.itemSources).toEqual([
      { sourceFile: INTERROGATION_PATH, line: 5 },
    ]);
    expect(
      byCarrier.get("question:entered_storage:onLoop")?.itemSources,
    ).toEqual([{ sourceFile: INTERROGATION_PATH, line: 27 }]);
    expect(
      byCarrier.get("question:entered_storage:loopPrompt")?.itemSources,
    ).toEqual([{ sourceFile: INTERROGATION_PATH, line: 28 }]);
    expect(
      byCarrier.get("question:entered_storage:wrongReply")?.itemSources,
    ).toEqual([{ sourceFile: INTERROGATION_PATH, line: 29 }]);
    expect(
      byCarrier.get("question:entered_storage:line:l_beans:content")
        ?.itemSources,
    ).toEqual([{ sourceFile: INTERROGATION_PATH, line: 33 }]);
    expect(
      byCarrier.get("question:entered_storage:line:l_cleaning:challenge")
        ?.itemSources,
    ).toEqual([{ sourceFile: INTERROGATION_PATH, line: 40 }]);
  });

  it("exposes analysis carrier item sources", () => {
    const ast = parseAnalysisAst();
    const segments = deriveDialogueSegments({
      chapterId: "chapter_1",
      json: analysisJson(ast),
      sourceAst: ast,
    });
    const byCarrier = segmentsByCarrier(segments);

    expect(byCarrier.get("intro")?.itemSources).toEqual([
      { sourceFile: "analysis_scene_1.md", line: 4 },
    ]);
    expect(
      byCarrier.get("board:source_classification:result")?.itemSources,
    ).toEqual([{ sourceFile: "analysis_scene_1.md", line: 18 }]);
    expect(byCarrier.get("outro")?.itemSources).toEqual([
      { sourceFile: "analysis_scene_1.md", line: 20 },
    ]);
  });

  it("joins item sources by semantic id when segment array order differs", () => {
    const ast = investigationAst();
    const json = emitInvestigationScene(ast, corpusForAst(ast));
    // Reorder the compiled tree so index-based joins would pair unrelated
    // carriers: sublocations reversed, hotspots and topics reversed within.
    const reordered = structuredClone(json);
    reordered.sublocations = [...reordered.sublocations].reverse();
    for (const sub of reordered.sublocations) {
      sub.hotspots = [...sub.hotspots].reverse();
      for (const character of sub.characters) {
        character.topics = [...character.topics].reverse();
      }
    }

    const segments = deriveDialogueSegments({
      chapterId: "chapter_1",
      json: reordered,
      sourceAst: ast,
    });
    const byCarrier = segmentsByCarrier(segments);

    expect(byCarrier.get("hotspot:table:inspect")?.itemSources).toEqual([
      { sourceFile: INVESTIGATION_PATH, line: 24 },
      { sourceFile: INVESTIGATION_PATH, line: 26 },
    ]);
    expect(byCarrier.get("hotspot:cabinet:inspect")?.itemSources).toEqual([
      { sourceFile: INVESTIGATION_PATH, line: 78 },
      { sourceFile: INVESTIGATION_PATH, line: 80 },
    ]);
    expect(byCarrier.get("topic:witness:motive:dialogue")?.itemSources).toEqual(
      [{ sourceFile: INVESTIGATION_PATH, line: 61 }],
    );
    expect(
      resolveDialogueItemSource(segments, "topic:witness:motive:dialogue", 0),
    ).toEqual({ ok: true, sourceFile: INVESTIGATION_PATH, line: 61 });
  });

  it("resolves carrier-local staleness without disabling other carriers", () => {
    const ast = investigationAst();
    const json = emitInvestigationScene(ast, corpusForAst(ast));
    // Edit one authored hotspot line without recompiling: the compiled item
    // no longer matches the source at the compiler line.
    const staleAst = structuredClone(ast);
    const inspect = staleAst.sublocations[0]!.hotspots[0]!.inspectDialogue;
    const edited = { ...inspect[0]!, text: "未重新編譯的文字。" };
    staleAst.sublocations[0]!.hotspots[0]!.inspectDialogue = [
      edited,
      ...inspect.slice(1),
    ];

    const segments = deriveDialogueSegments({
      chapterId: "chapter_1",
      json,
      sourceAst: staleAst,
    });

    const stale = resolveDialogueItemSource(
      segments,
      "hotspot:table:inspect",
      0,
    );
    expect(stale).toMatchObject({
      ok: false,
      reason: "stale",
      error: { code: "workbenchSourceCarrierStale" },
    });
    // The mismatched entry is tagged `{ stale: true }` so callers can
    // distinguish a stale join from a synthesized item by source identity.
    const inspectSegment = segmentsByCarrier(segments).get(
      "hotspot:table:inspect",
    );
    expect(inspectSegment?.itemSources?.[0]).toEqual({ stale: true });

    // A healthy carrier in the same scene still resolves.
    expect(resolveDialogueItemSource(segments, "intro", 1)).toEqual({
      ok: true,
      sourceFile: INVESTIGATION_PATH,
      line: 7,
    });
  });

  it("resolves staleness when sourceAst is absent", () => {
    const ast = investigationAst();
    const segments = deriveDialogueSegments({
      chapterId: "chapter_1",
      json: emitInvestigationScene(ast, corpusForAst(ast)),
    });
    expect(resolveDialogueItemSource(segments, "intro", 0)).toMatchObject({
      ok: false,
      reason: "stale",
      error: { code: "workbenchSourceCarrierStale" },
    });
  });

  it("resolves staleness for an out-of-range item index", () => {
    const ast = investigationAst();
    const segments = deriveDialogueSegments({
      chapterId: "chapter_1",
      json: emitInvestigationScene(ast, corpusForAst(ast)),
      sourceAst: ast,
    });
    expect(resolveDialogueItemSource(segments, "intro", 99)).toMatchObject({
      ok: false,
      reason: "stale",
      error: { code: "workbenchSourceCarrierStale" },
    });
  });

  it("tags compiler-synthesized carriers as synthesized, not stale", () => {
    // An evidence with no authored On Re-examine section: the real compile
    // pipeline materializes the default fallback via materializeSemanticDefaults
    // so the JSON carries it while the source AST still has no authored
    // counterpart. The source identity (null, not { stale: true }) marks it
    // synthesized — it will never be editable, unlike a stale join that
    // recompiling may fix.
    const ast = investigationAst();
    const rawJson = emitInvestigationScene(ast, corpusForAst(ast));
    const synthesizedEvidence = ast.evidenceManifest.find(
      (evidence) =>
        evidence.onReexamine === null ||
        evidence.onReexamine === undefined ||
        evidence.onReexamine.length === 0,
    );
    expect(synthesizedEvidence).toBeDefined();
    const carrierId = `evidence:${synthesizedEvidence!.id}:onReexamine`;
    // Materialize the synthesized default into the JSON, as the real
    // compile pipeline does (materializeSemanticDefaults).
    const json = structuredClone(rawJson);
    const evidenceInJson = json.evidenceManifest.find(
      (evidence) => evidence.id === synthesizedEvidence!.id,
    )!;
    evidenceInJson.onReexamine = [
      { kind: "action" as const, text: "（沒有新發現。）" },
    ];

    const segments = deriveDialogueSegments({
      chapterId: "chapter_1",
      json,
      sourceAst: ast,
    });
    const byCarrier = segmentsByCarrier(segments);
    // The synthesized carrier has itemSources entries (all null), not an
    // absent itemSources array — that is what distinguishes "synthesized"
    // from "no source document supplied".
    expect(byCarrier.get(carrierId)?.itemSources).toEqual([null]);

    const resolution = resolveDialogueItemSource(segments, carrierId, 0);
    expect(resolution).toMatchObject({
      ok: false,
      reason: "synthesized",
      error: { code: "workbenchSourceItemSynthesized" },
    });
  });
});

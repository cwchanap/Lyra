import assert from "node:assert/strict";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { compile, formatErrors } from "./compile-scenes/orchestrator";
import { enrichScenesWithAssets } from "./compile-scenes/assets/enrich";
import type { AssetConfig } from "./compile-scenes/assets/config";
import { parseChapter } from "./compile-scenes/parser-chapter";
import { parseAnalysisScene } from "./compile-scenes/parser-analysis";
import { parseInterrogationScene } from "./compile-scenes/parser-interrogation";
import { parseInvestigationScene } from "./compile-scenes/parser-investigation";
import { parseLinearScene } from "./compile-scenes/parser-linear";
import { buildSaveContentManifest } from "./compile-scenes/save-content-manifest";
import type { SceneRecord } from "./compile-scenes/validator";

const VALID_STORY_CATALOG = readFileSync(
  resolve("packages/scripts/__fixtures__/story_catalog/valid/story_catalog.md"),
  "utf-8",
).replace(/\n## Source Groups[\s\S]*$/, "");

const SINGLETON_SOURCE_GROUP_CATALOG = `# Story Catalog

## Source Groups

### Source Group: Program export {#program_export}
- **Summary:** Records derived from the same program export.
`;

const DUPLICATE_SOURCE_GROUP_CATALOG = `# Story Catalog

## Source Groups

### Source Group: First program export {#program_export}
- **Summary:** First definition of the source group.

### Source Group: Second program export {#program_export}
- **Summary:** Duplicate definition of the source group.
`;

const NEUTRAL_CASE_RECORD_PROVENANCE = {
  sourceKind: "unspecified",
  representationLayer: "none",
  proceduralStatus: "unspecified",
  completeness: "unspecified",
  confidence: "unspecified",
  sourceGroupId: null,
  sourceLabel: null,
  proofCapabilities: [],
  supersedesRecordId: null,
};

const HPA_257_DIAGNOSTIC_CODES = new Set([
  "positiveSelfReference",
  "positiveDependencyCycle",
  "requiredContentUnreachable",
  "mandatoryAuthorizationUnreachable",
  "storyRevealBatchAlwaysInvalid",
  "storyRevealBatchOrderDependent",
  "primaryObjectiveTransitionAlwaysInvalid",
  "primaryObjectiveOrderingNotExhaustive",
  "optionalContentUnreachable",
]);

function hpa257DiagnosticCodes(
  diagnostics: ReadonlyArray<{ code: string }>,
): string[] {
  return diagnostics
    .filter((diagnostic) => HPA_257_DIAGNOSTIC_CODES.has(diagnostic.code))
    .map((diagnostic) => diagnostic.code);
}

function annotateCoffeeWithSourceGroup(sourceRoot: string): void {
  const scenePath = resolve(sourceRoot, "chapter_1/investigation_scene_1.md");
  const original = readFileSync(scenePath, "utf-8");
  writeFileSync(
    scenePath,
    original.replace(
      "- **Source Sublocation:** main_hall",
      `- **Source Sublocation:** main_hall
- **Source Kind:** digital
- **Representation Layer:** summary
- **Procedural Status:** reacquired
- **Completeness:** complete
- **Confidence:** corroborated
- **Source Group:** program_export
- **Source Label:** Main hall program export
- **Proof Capabilities:** [procedure, time]`,
    ),
  );
}

describe("production Chapter 1 authoring", () => {
  it("gives every manifested scene an authored player recap", () => {
    const chapterDir = "docs/stories_plan/chapter_1";
    const chapterFile = `${chapterDir}/chapter.md`;
    const chapter = parseChapter(
      readFileSync(chapterFile, "utf-8"),
      "chapter_1/chapter.md",
      "chapter_1",
    );
    if (!chapter.ok) throw new Error(formatErrors([chapter.error]));

    const missingSummaryFiles = chapter.value.sceneFiles.filter((sceneFile) => {
      const sourceFile = `chapter_1/${sceneFile}`;
      const source = readFileSync(resolve(chapterDir, sceneFile), "utf-8");
      const id = sceneFile.replace(/\.md$/, "");
      const parsed = sceneFile.startsWith("analysis_scene_")
        ? parseAnalysisScene(source, sourceFile, id)
        : sceneFile.startsWith("investigation_scene_")
          ? parseInvestigationScene(source, sourceFile, id)
          : sceneFile.startsWith("interrogation_scene_")
            ? parseInterrogationScene(source, sourceFile, id)
            : parseLinearScene(source, sourceFile, id);
      if (!parsed.ok) throw new Error(formatErrors([parsed.error]));
      return (
        parsed.value.kind !== "analysisScene" && !parsed.value.summaryAuthored
      );
    });

    expect(
      missingSummaryFiles,
      `Chapter 1 scenes missing authored player recap copy: ${missingSummaryFiles.join(", ")}`,
    ).toEqual([]);
  });
});

describe("compile (end-to-end against valid fixture)", () => {
  it("compiles the valid fixture without errors and emits expected files", () => {
    const outRoot = mkdtempSync(resolve(tmpdir(), "scene-compile-"));
    try {
      const result = compile({
        sourceRoot: "packages/scripts/__fixtures__/valid",
        outputRoot: outRoot,
      });
      if (!result.ok) {
        throw new Error("Compile failed:\n" + formatErrors(result.errors));
      }
      expect(result.chaptersCompiled).toBe(1);
      expect(result.scenesCompiled).toBe(2);

      const idx = JSON.parse(
        readFileSync(resolve(outRoot, "chapters.json"), "utf-8"),
      );
      expect(idx.chapters).toHaveLength(1);
      expect(idx.chapters[0].id).toBe("chapter_1");
      expect(idx.chapters[0].scenes).toEqual([
        { type: "linear", file: "chapter_1/scene_0.json" },
        { type: "investigation", file: "chapter_1/investigation_scene_1.json" },
      ]);

      const linear = JSON.parse(
        readFileSync(resolve(outRoot, "chapter_1/scene_0.json"), "utf-8"),
      );
      expect(linear.type).toBe("linear");
      expect(linear.queue.length).toBeGreaterThan(0);

      const investigation = JSON.parse(
        readFileSync(
          resolve(outRoot, "chapter_1/investigation_scene_1.json"),
          "utf-8",
        ),
      );
      expect(investigation.type).toBe("investigation");
      expect(investigation.sublocations).toHaveLength(2);
      expect(investigation.outro.unlock).not.toBe("auto");
    } finally {
      rmSync(outRoot, { recursive: true, force: true });
    }
  });

  it("fails with noChaptersFound when source root has no chapter directories", () => {
    const emptyDir = mkdtempSync(resolve(tmpdir(), "scene-compile-empty-"));
    const outRoot = mkdtempSync(resolve(tmpdir(), "scene-compile-empty-out-"));
    try {
      const result = compile({ sourceRoot: emptyDir, outputRoot: outRoot });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]!.code).toBe("noChaptersFound");
    } finally {
      rmSync(emptyDir, { recursive: true, force: true });
      rmSync(outRoot, { recursive: true, force: true });
    }
  });

  it("compiles interrogation scenes into the chapter output", () => {
    const outRoot = mkdtempSync(
      resolve(tmpdir(), "scene-compile-interrogation-"),
    );
    const readJson = (path: string) =>
      JSON.parse(readFileSync(resolve(outRoot, path), "utf-8"));
    try {
      const result = compile({
        sourceRoot: "packages/scripts/__fixtures__/valid_interrogation",
        outputRoot: outRoot,
      });
      if (!result.ok) {
        throw new Error("Compile failed:\n" + formatErrors(result.errors));
      }

      expect(readJson("chapters.json").chapters[0].scenes[1]).toEqual({
        type: "interrogation",
        file: "chapter_1/interrogation_scene_1.json",
      });
      const interrogation = readJson("chapter_1/interrogation_scene_1.json");
      expect(interrogation.type).toBe("interrogation");
      expect(
        interrogation.phases.map((phase: { kind: string }) => phase.kind),
      ).toEqual(["inquiry"]);
      expect(
        interrogation.phases[0].questions.map(
          (question: { id: string }) => question.id,
        ),
      ).toEqual(["entered_storage", "beans_follow_up"]);
      const enteredStorage = interrogation.phases[0].questions[0];
      expect(
        enteredStorage.testimony.lines.map((line: { id: string }) => line.id),
      ).toEqual(["l_beans", "l_cleaning"]);
      const cleaningLine = enteredStorage.testimony.lines[1];
      expect(cleaningLine.contradiction).toEqual({
        kind: "evidence",
        id: "coffee_machine_cleaning_log",
      });
      expect(cleaningLine.challenge.length).toBeGreaterThan(0);
      expect(cleaningLine.onCorrect.length).toBeGreaterThan(0);
      expect(cleaningLine.onWrongEvidence.length).toBeGreaterThan(0);
      expect(cleaningLine.reveals).toContainEqual({
        kind: "statement",
        id: "kagami_timeline_inconsistent",
      });
      expect(enteredStorage.testimony.loopPrompt.length).toBeGreaterThan(0);
      expect(enteredStorage.testimony.wrongReply.length).toBeGreaterThan(0);
      const beansFollowUp = interrogation.phases[0].questions[1];
      expect(beansFollowUp.testimony.loopPrompt).toEqual([]);
      expect(beansFollowUp.testimony.wrongReply).toEqual([]);
      expect(
        interrogation.evidenceManifest.map((e: { id: string }) => e.id),
      ).toEqual(["coffee_machine_cleaning_log"]);
      expect(
        interrogation.statementManifest.map((s: { id: string }) => s.id),
      ).toEqual([
        "wakatsuki_entered_for_beans",
        "kagami_timeline_inconsistent",
      ]);
      expect(interrogation.outro).toMatchObject({ unlock: "auto" });
    } finally {
      rmSync(outRoot, { recursive: true, force: true });
    }
  });

  it("emits HPA-257 expressions and ordered story targets without reshaping them", () => {
    const outRoot = mkdtempSync(resolve(tmpdir(), "scene-compile-hpa-257-"));
    const readJson = (path: string) =>
      JSON.parse(readFileSync(resolve(outRoot, path), "utf-8"));
    try {
      const result = compile({
        sourceRoot: "packages/scripts/__fixtures__/hpa_257_valid",
        outputRoot: outRoot,
      });
      if (!result.ok) {
        throw new Error("Compile failed:\n" + formatErrors(result.errors));
      }

      const investigation = readJson("chapter_1/investigation_scene_1.json");
      expect(investigation.sublocations[0].hotspots[0].unlock).toEqual({
        op: "at_least",
        count: 2,
        conditions: [
          { predicate: "fact_asserted", id: "door_conflict" },
          { predicate: "objective_completed", id: "prepare_request" },
        ],
      });
      expect(investigation.sublocations[0].hotspots[0].reveals).toEqual([
        { kind: "revealQuestion", questionId: "who_entered" },
        {
          kind: "resolveQuestion",
          questionId: "who_entered",
          factId: "door_conflict",
        },
        { kind: "revealObjective", objectiveId: "verify_alibi" },
        { kind: "completeObjective", objectiveId: "verify_alibi" },
        {
          kind: "setPrimaryObjective",
          completeCurrent: true,
          nextObjectiveId: null,
        },
      ]);
      expect(investigation.sublocations[0].hotspots[0].reveals).toContainEqual({
        kind: "setPrimaryObjective",
        completeCurrent: true,
        nextObjectiveId: null,
      });
      expect(investigation.sublocations[0].hotspots[1].unlock).toEqual({
        op: "at_least",
        count: 2,
        conditions: [
          { predicate: "question_resolved", id: "who_entered" },
          {
            op: "at_least",
            count: 1,
            conditions: [
              { predicate: "fact_asserted", id: "door_conflict" },
              {
                predicate: "objective_completed",
                id: "prepare_request",
              },
            ],
          },
        ],
      });

      const interrogation = readJson("chapter_1/interrogation_scene_1.json");
      expect(interrogation.phases[0].unlock).toEqual({
        op: "at_least",
        count: 2,
        conditions: [
          { predicate: "question_resolved", id: "who_entered" },
          {
            op: "at_least",
            count: 1,
            conditions: [
              {
                predicate: "objective_completed",
                id: "prepare_request",
              },
              {
                predicate: "authorization_granted",
                id: "narrow_export",
              },
            ],
          },
        ],
      });
      expect(interrogation.phases[0].reveals).toEqual([
        { kind: "revealQuestion", questionId: "who_entered" },
        { kind: "revealObjective", objectiveId: "verify_alibi" },
        { kind: "completeObjective", objectiveId: "verify_alibi" },
        {
          kind: "setPrimaryObjective",
          completeCurrent: true,
          nextObjectiveId: "present_request",
        },
      ]);
      expect(interrogation.phases[0].questions[0].unlock).toEqual({
        predicate: "fact_asserted",
        id: "door_conflict",
      });
    } finally {
      rmSync(outRoot, { recursive: true, force: true });
    }
  });

  it("compiles manifest-owned analysis scenes into normalized output, catalog refs, and the content revision", () => {
    // Break caught: analysis definitions could validate in isolation while
    // production manifests still reject the files or omit their JSON from
    // the chapter bundle and save-content hash.
    const sourceRoot = mkdtempSync(
      resolve(tmpdir(), "scene-compile-analysis-source-"),
    );
    const outRoot = mkdtempSync(
      resolve(tmpdir(), "scene-compile-analysis-out-"),
    );
    const readJson = (path: string) =>
      JSON.parse(readFileSync(resolve(outRoot, path), "utf-8"));
    const firstAnalysis = [
      "# Scene 1: 證據分析",
      "- **Summary:** 將已取得的材料整理成可驗證的結論。",
      "",
      "## Intro",
      "",
      "**相馬律**：先把手上的材料排好。",
      "",
      "## Board: 材料分類 {#classify_board}",
      "",
      "- **Kind:** classify",
      "- **Prompt:** 將卡片放入正確分類。",
      "- **Reveals:** []",
      "- **Incomplete Feedback:** 還有卡片沒有分類。",
      "- **Incorrect Feedback:** 這個分類不對。",
      "",
      "### Card: 熱咖啡 {#coffee_card}",
      "",
      "- **Source:** evidence:coffee",
      "- **Summary:** 杯中的咖啡仍然溫熱。",
      "",
      "### Group: 時間線 {#timeline_group}",
      "",
      "- **Description:** 可用來判斷事件順序的材料。",
      "- **Accepted Cards:** [coffee_card]",
      "",
      "### Result Dialogue",
      "",
      "**相馬律**：分類完成。",
      "",
      "## Board: 發現順序 {#order_board}",
      "",
      "- **Kind:** order",
      "- **Prompt:** 將卡片排成正確順序。",
      "- **Reveals:** []",
      "- **Incomplete Feedback:** 順序還沒有完成。",
      "- **Incorrect Feedback:** 這個順序不對。",
      "- **Accepted Order:** [coffee_card]",
      "- **Fixed Anchors:** [coffee_card@1]",
      "",
      "### Card: 熱咖啡 {#coffee_card}",
      "",
      "- **Source:** evidence:coffee",
      "- **Summary:** 杯中的咖啡仍然溫熱。",
      "",
      "### Result Dialogue",
      "",
      "**相馬律**：順序完成。",
      "",
      "## Board: 關鍵材料 {#threshold_board}",
      "",
      "- **Kind:** threshold",
      "- **Prompt:** 選出足以支持結論的材料。",
      "- **Reveals:** []",
      "- **Incomplete Feedback:** 還需要更多材料。",
      "- **Incorrect Feedback:** 這些材料不足以支持結論。",
      "- **Eligible Cards:** [coffee_card]",
      "- **Minimum Selected:** 1",
      "- **Minimum Distinct Source Groups:** 0",
      "- **Required Proof Capabilities:** []",
      "- **Allowed Procedural Statuses:** [unspecified]",
      "- **Require Source Group:** false",
      "",
      "### Card: 熱咖啡 {#coffee_card}",
      "",
      "- **Source:** evidence:coffee",
      "- **Summary:** 杯中的咖啡仍然溫熱。",
      "",
      "### Result Dialogue",
      "",
      "**相馬律**：材料足夠。",
      "",
      "## Outro",
      "",
      "**相馬律**：下一步可以驗證時間線。",
    ].join("\n");
    const laterAnalysis = [
      "# Scene 1: 後續分析",
      "- **Summary:** 以前一塊分析板的結果確認下一項推論。",
      "",
      "## Intro",
      "",
      "**相馬律**：前一項結論已經成立。",
      "",
      "## Board: 後續分類 {#later_board}",
      "",
      "- **Kind:** classify",
      "- **Prompt:** 再確認一次材料分類。",
      "- **Unlock:** analysis_board:chapter_1@analysis_scene_1@classify_board completed",
      "- **Reveals:** []",
      "- **Incomplete Feedback:** 還沒有完成分類。",
      "- **Incorrect Feedback:** 分類不正確。",
      "",
      "### Card: 熱咖啡 {#coffee_card}",
      "",
      "- **Source:** evidence:coffee",
      "- **Summary:** 杯中的咖啡仍然溫熱。",
      "",
      "### Group: 時間線 {#timeline_group}",
      "",
      "- **Description:** 可用來判斷事件順序的材料。",
      "- **Accepted Cards:** [coffee_card]",
      "",
      "### Result Dialogue",
      "",
      "**相馬律**：後續分類完成。",
      "",
      "## Outro",
      "",
      "**相馬律**：推論可以繼續。",
    ].join("\n");

    try {
      cpSync("packages/scripts/__fixtures__/valid", sourceRoot, {
        recursive: true,
      });
      const chapterRoot = resolve(sourceRoot, "chapter_1");
      writeFileSync(
        resolve(chapterRoot, "chapter.md"),
        [
          "# Chapter 1: 測試章節",
          "",
          "**Summary:** 一個用來驗證分析場景整合的最小章節。",
          "",
          "## Scenes",
          "",
          "1. scene_0.md",
          "2. investigation_scene_1.md",
          "3. analysis_scene_1.md",
          "4. analysis_scene_2.md",
          "",
        ].join("\n"),
      );
      writeFileSync(resolve(chapterRoot, "analysis_scene_1.md"), firstAnalysis);
      writeFileSync(resolve(chapterRoot, "analysis_scene_2.md"), laterAnalysis);

      const first = compile({ sourceRoot, outputRoot: outRoot });
      if (!first.ok) throw new Error(formatErrors(first.errors));

      expect(first.scenesCompiled).toBe(4);
      expect(readJson("chapters.json").chapters[0].scenes).toEqual([
        { type: "linear", file: "chapter_1/scene_0.json" },
        {
          type: "investigation",
          file: "chapter_1/investigation_scene_1.json",
        },
        { type: "analysis", file: "chapter_1/analysis_scene_1.json" },
        { type: "analysis", file: "chapter_1/analysis_scene_2.json" },
      ]);

      const analysis = readJson("chapter_1/analysis_scene_1.json");
      expect(analysis).toMatchObject({
        type: "analysis",
        id: "analysis_scene_1",
        title: "證據分析",
        summary: "將已取得的材料整理成可驗證的結論。",
        assetRefs: [],
        boards: [
          {
            kind: "classify",
            common: {
              id: "classify_board",
            },
            groups: [
              {
                id: "timeline_group",
                label: "時間線",
                description: "可用來判斷事件順序的材料。",
              },
            ],
            acceptedGroupByCard: { coffee_card: "timeline_group" },
          },
          {
            kind: "order",
            common: {
              id: "order_board",
            },
            acceptedOrder: ["coffee_card"],
            fixedAnchors: [{ cardId: "coffee_card", position: 1 }],
          },
          {
            kind: "threshold",
            common: {
              id: "threshold_board",
            },
            minimumSelected: 1,
            acceptedSelections: [["coffee_card"]],
          },
        ],
      });
      expect(
        analysis.boards.map(
          (board: { common: { id: string } }) => board.common.id,
        ),
      ).toEqual(["classify_board", "order_board", "threshold_board"]);
      expect(analysis.boards[0].groups[0]).not.toHaveProperty("acceptedCards");
      expect(analysis.boards[2]).not.toHaveProperty(
        "minimumDistinctSourceGroups",
      );
      expect(analysis.boards[2]).not.toHaveProperty(
        "requiredProofCapabilities",
      );

      const catalog = readJson("story_catalog.json");
      expect(catalog.analysisScenes).toEqual([
        { chapterId: "chapter_1", sceneId: "analysis_scene_1" },
        { chapterId: "chapter_1", sceneId: "analysis_scene_2" },
      ]);
      expect(catalog.analysisBoards).toEqual([
        {
          chapterId: "chapter_1",
          sceneId: "analysis_scene_1",
          boardId: "classify_board",
        },
        {
          chapterId: "chapter_1",
          sceneId: "analysis_scene_1",
          boardId: "order_board",
        },
        {
          chapterId: "chapter_1",
          sceneId: "analysis_scene_1",
          boardId: "threshold_board",
        },
        {
          chapterId: "chapter_1",
          sceneId: "analysis_scene_2",
          boardId: "later_board",
        },
      ]);

      const firstRevision = readJson(
        "save_content_manifest.json",
      ).contentRevision;
      writeFileSync(
        resolve(chapterRoot, "analysis_scene_1.md"),
        firstAnalysis.replace("分類完成。", "分類完成（修訂）。"),
      );
      const changed = compile({ sourceRoot, outputRoot: outRoot });
      if (!changed.ok) throw new Error(formatErrors(changed.errors));
      expect(readJson("save_content_manifest.json").contentRevision).not.toBe(
        firstRevision,
      );
    } finally {
      rmSync(sourceRoot, { recursive: true, force: true });
      rmSync(outRoot, { recursive: true, force: true });
    }
  });

  it("compiles the complete analysis Chapter 1 corpus through qualified progression", () => {
    // Break caught: without analysis reachability nodes, the later mandatory
    // hotspot cannot satisfy its qualified analysis-scene prerequisite even
    // though every board card has a real prior acquisition path.
    const outRoot = mkdtempSync(
      resolve(tmpdir(), "scene-compile-analysis-chapter-1-"),
    );
    const readJson = (path: string) =>
      JSON.parse(readFileSync(resolve(outRoot, path), "utf-8"));
    try {
      const result = compile({
        sourceRoot: "packages/scripts/__fixtures__/analysis-chapter-1",
        outputRoot: outRoot,
      });
      if (!result.ok) throw new Error(formatErrors(result.errors));

      expect(result.scenesCompiled).toBe(3);
      expect(readJson("chapters.json").chapters[0].scenes).toEqual([
        {
          type: "investigation",
          file: "chapter_1/investigation_scene_1.json",
        },
        { type: "analysis", file: "chapter_1/analysis_scene_8_5.json" },
        {
          type: "investigation",
          file: "chapter_1/investigation_scene_2.json",
        },
      ]);

      const analysis = readJson("chapter_1/analysis_scene_8_5.json");
      expect(
        analysis.boards.map(
          (board: { common: { id: string } }) => board.common.id,
        ),
      ).toEqual([
        "evidence_packages",
        "local_event_sequence",
        "narrow_request_basis",
      ]);
      expect(analysis.boards[0].acceptedGroupByCard).toEqual({
        miyake_call: "miyake_small_lies",
        l_corridor_replay: "earlier_third_party",
        external_credential_event: "earlier_third_party",
      });
      expect(analysis.boards[1]).toMatchObject({
        acceptedOrder: ["event_1841", "event_1842", "event_1843", "event_1844"],
        fixedAnchors: [{ cardId: "event_1841", position: 1 }],
      });
      expect(analysis.boards[2]).toMatchObject({
        minimumSelected: 2,
        acceptedSelections: [
          ["lock_sequence", "manager_timing"],
          ["lock_sequence", "manager_timing", "phone_notification"],
          ["lock_sequence", "phone_notification"],
        ],
      });

      expect(readJson("story_catalog.json").analysisScenes).toEqual([
        { chapterId: "chapter_1", sceneId: "analysis_scene_8_5" },
      ]);
      expect(readJson("story_catalog.json").analysisBoards).toEqual([
        {
          chapterId: "chapter_1",
          sceneId: "analysis_scene_8_5",
          boardId: "evidence_packages",
        },
        {
          chapterId: "chapter_1",
          sceneId: "analysis_scene_8_5",
          boardId: "local_event_sequence",
        },
        {
          chapterId: "chapter_1",
          sceneId: "analysis_scene_8_5",
          boardId: "narrow_request_basis",
        },
      ]);
    } finally {
      rmSync(outRoot, { recursive: true, force: true });
    }
  });

  it.each([
    {
      name: "first_manifest_analysis_unobtainable_card_source",
      mutate(sourceRoot: string) {
        replaceFixtureText(
          sourceRoot,
          "chapter_1/chapter.md",
          [
            "1. investigation_scene_1.md",
            "2. analysis_scene_8_5.md",
            "3. investigation_scene_2.md",
          ].join("\n"),
          [
            "1. analysis_scene_8_5.md",
            "2. investigation_scene_1.md",
            "3. investigation_scene_2.md",
          ].join("\n"),
        );
        // Keep the displayed evidence definitions valid, but make their only
        // reveal producer follow the first manifest analysis scene.
        replaceFixtureTail(
          sourceRoot,
          "chapter_1/analysis_scene_8_5.md",
          "## Board: 本機事件順序 {#local_event_sequence}",
          [
            "## Outro",
            "",
            "**相馬律**：我們只證明了第三者存在。下一步才是把那個空位填上。",
            "",
          ].join("\n"),
        );
        replaceFixtureText(
          sourceRoot,
          "chapter_1/investigation_scene_1.md",
          "- **Reveals:** [evidence:miyake_call_record, evidence:l_corridor_replay, evidence:external_credential_event, evidence:event_1841, evidence:event_1842, evidence:event_1843, evidence:event_1844, evidence:lock_sequence, evidence:phone_notification, statement:manager_timing]",
          "- **Reveals:** []",
        );
      },
      expected: [
        {
          code: "requiredContentUnreachable",
          sourceFile: "chapter_1/analysis_scene_8_5.md",
          line: 11,
        },
      ],
    },
    {
      name: "analysis_output_unreachable",
      mutate(sourceRoot: string) {
        replaceFixtureText(
          sourceRoot,
          "chapter_1/analysis_scene_8_5.md",
          "- **Unlock:** analysis_board:chapter_1@analysis_scene_8_5@local_event_sequence completed",
          "- **Unlock:** fact:blocked_analysis_output asserted",
        );
        replaceFixtureText(
          sourceRoot,
          "story_catalog.md",
          "## Objectives",
          [
            "### Fact: 被阻斷的分析輸出 {#blocked_analysis_output}",
            "",
            "- **Summary:** 此命題沒有任何可達的產生者。",
            "- **Details:** 用來驗證分析輸出沒有被固定點虛構出來。",
            "- **Category:** fixture",
            "",
            "## Objectives",
          ].join("\n"),
        );
        replaceFixtureText(
          sourceRoot,
          "chapter_1/investigation_scene_2.md",
          "analysis_scene:chapter_1@analysis_scene_8_5 completed",
          "fact:two_independent_lock_contradictions_identified asserted",
        );
      },
      expected: [
        {
          code: "requiredContentUnreachable",
          sourceFile: "chapter_1/investigation_scene_2.md",
          line: 17,
        },
      ],
    },
    {
      name: "analysis_card_source_unobtainable",
      mutate(sourceRoot: string) {
        replaceFixtureText(
          sourceRoot,
          "chapter_1/investigation_scene_1.md",
          "evidence:lock_sequence, evidence:phone_notification, statement:manager_timing",
          "evidence:lock_sequence, statement:manager_timing",
        );
      },
      expected: [
        {
          code: "requiredContentUnreachable",
          sourceFile: "chapter_1/analysis_scene_8_5.md",
          line: 86,
        },
        {
          code: "requiredContentUnreachable",
          sourceFile: "chapter_1/investigation_scene_2.md",
          line: 17,
        },
      ],
    },
    {
      name: "analysis_statement_source_unobtainable",
      mutate(sourceRoot: string) {
        replaceFixtureText(
          sourceRoot,
          "chapter_1/investigation_scene_1.md",
          "evidence:phone_notification, statement:manager_timing",
          "evidence:phone_notification",
        );
      },
      expected: [
        {
          code: "requiredContentUnreachable",
          sourceFile: "chapter_1/analysis_scene_8_5.md",
          line: 86,
        },
        {
          code: "requiredContentUnreachable",
          sourceFile: "chapter_1/investigation_scene_2.md",
          line: 17,
        },
      ],
    },
    {
      name: "analysis_board_self_reference",
      mutate(sourceRoot: string) {
        replaceFixtureText(
          sourceRoot,
          "chapter_1/analysis_scene_8_5.md",
          "- **Prompt:** 把每張卡放進它真正支持的命題。\n- **Reveals:**",
          "- **Prompt:** 把每張卡放進它真正支持的命題。\n- **Unlock:** analysis_board:chapter_1@analysis_scene_8_5@evidence_packages completed\n- **Reveals:**",
        );
      },
      expected: [
        {
          code: "positiveSelfReference",
          sourceFile: "chapter_1/analysis_scene_8_5.md",
          line: 11,
        },
      ],
    },
    {
      name: "analysis_board_positive_cycle",
      mutate(sourceRoot: string) {
        replaceFixtureText(
          sourceRoot,
          "chapter_1/analysis_scene_8_5.md",
          "- **Prompt:** 把每張卡放進它真正支持的命題。\n- **Reveals:**",
          "- **Prompt:** 把每張卡放進它真正支持的命題。\n- **Unlock:** analysis_board:chapter_1@analysis_scene_8_5@local_event_sequence completed\n- **Reveals:**",
        );
      },
      expected: [
        {
          code: "positiveDependencyCycle",
          sourceFile: "chapter_1/analysis_scene_8_5.md",
          line: 11,
        },
      ],
    },
  ])("reports $name through the real compiler", ({ mutate, expected }) => {
    // Break caught: analysis sources, outputs, and board prerequisites could
    // otherwise be validated structurally while bypassing HPA-257's fixed
    // point and source-located diagnostics.
    const sourceRoot = mkdtempSync(
      resolve(tmpdir(), "scene-compile-analysis-reachability-"),
    );
    const outRoot = mkdtempSync(
      resolve(tmpdir(), "scene-compile-analysis-reachability-out-"),
    );
    try {
      cpSync("packages/scripts/__fixtures__/analysis-chapter-1", sourceRoot, {
        recursive: true,
      });
      mutate(sourceRoot);
      const result = compile({ sourceRoot, outputRoot: outRoot });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      for (const diagnostic of expected) {
        expect(result.errors).toContainEqual(
          expect.objectContaining(diagnostic),
        );
      }
    } finally {
      rmSync(sourceRoot, { recursive: true, force: true });
      rmSync(outRoot, { recursive: true, force: true });
    }
  });

  it("keeps absent qualified analysis registration rejected", () => {
    const outRoot = mkdtempSync(
      resolve(tmpdir(), "scene-compile-absent-analysis-registration-"),
    );
    try {
      const result = compile({
        sourceRoot:
          "packages/scripts/__fixtures__/invalid/hpa_257_absent_analysis_registration",
        outputRoot: outRoot,
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.errors).toContainEqual(
        expect.objectContaining({ code: "unresolvedAnalysisPredicate" }),
      );
    } finally {
      rmSync(outRoot, { recursive: true, force: true });
    }
  });

  it("emits story asset manifest for an asset-enabled fixture", () => {
    const outRoot = mkdtempSync(
      resolve(tmpdir(), "scene-compile-assets-scenes-"),
    );
    const assetOutRoot = mkdtempSync(
      resolve(tmpdir(), "scene-compile-assets-manifest-"),
    );
    try {
      const result = compile({
        sourceRoot: "packages/scripts/__fixtures__/asset_enabled/stories_plan",
        outputRoot: outRoot,
        assetConfigRoot:
          "packages/scripts/__fixtures__/asset_enabled/assets/config",
        assetOutputRoot: assetOutRoot,
      });
      if (!result.ok)
        throw new Error("Compile failed:\n" + formatErrors(result.errors));
      expect(result.assetReport.enabled).toBe(true);
      expect(result.assetReport.requested.background).toBeGreaterThan(0);

      const manifest = JSON.parse(
        readFileSync(resolve(assetOutRoot, "manifest.json"), "utf-8"),
      );
      const report = JSON.parse(
        readFileSync(resolve(assetOutRoot, "report.json"), "utf-8"),
      );
      expect(manifest.enabled).toBe(true);
      expect(
        manifest.entries.some((entry: { assetId: string }) =>
          entry.assetId.startsWith("background."),
        ),
      ).toBe(true);
      expect(
        manifest.entries.some((entry: { assetId: string }) =>
          entry.assetId.startsWith("portrait."),
        ),
      ).toBe(true);
      expect(report).toEqual(result.assetReport);
    } finally {
      rmSync(outRoot, { recursive: true, force: true });
      rmSync(assetOutRoot, { recursive: true, force: true });
    }
  });
});

function replaceFixtureText(
  sourceRoot: string,
  relativePath: string,
  before: string,
  after: string,
): void {
  const path = resolve(sourceRoot, relativePath);
  const source = readFileSync(path, "utf-8");
  if (!source.includes(before)) {
    throw new Error(`Fixture mutation target missing from ${relativePath}.`);
  }
  writeFileSync(path, source.replace(before, after));
}

function replaceFixtureTail(
  sourceRoot: string,
  relativePath: string,
  marker: string,
  replacement: string,
): void {
  const path = resolve(sourceRoot, relativePath);
  const source = readFileSync(path, "utf-8");
  const markerIndex = source.indexOf(marker);
  if (markerIndex === -1) {
    throw new Error(`Fixture tail marker missing from ${relativePath}.`);
  }
  writeFileSync(path, source.slice(0, markerIndex) + replacement);
}

describe("snapshot: valid fixture JSON output", () => {
  let outRoot: string;
  let chaptersJson: unknown;
  let linearJson: unknown;
  let investigationJson: unknown;

  beforeAll(() => {
    outRoot = mkdtempSync(resolve(tmpdir(), "scene-compile-snap-"));
    const result = compile({
      sourceRoot: "packages/scripts/__fixtures__/valid",
      outputRoot: outRoot,
    });
    if (!result.ok) throw new Error(formatErrors(result.errors));
    chaptersJson = JSON.parse(
      readFileSync(resolve(outRoot, "chapters.json"), "utf-8"),
    );
    linearJson = JSON.parse(
      readFileSync(resolve(outRoot, "chapter_1/scene_0.json"), "utf-8"),
    );
    investigationJson = JSON.parse(
      readFileSync(
        resolve(outRoot, "chapter_1/investigation_scene_1.json"),
        "utf-8",
      ),
    );
  });

  afterAll(() => {
    rmSync(outRoot, { recursive: true, force: true });
  });

  it("matches the chapters.json snapshot", () => {
    expect(chaptersJson).toMatchSnapshot();
  });
  it("matches the linear scene snapshot", () => {
    expect(linearJson).toMatchSnapshot();
  });
  it("matches the investigation scene snapshot", () => {
    expect(investigationJson).toMatchSnapshot();
  });
});

describe("invalid fixtures: each one fails with a specific error code", () => {
  const INVALID_ROOT = "packages/scripts/__fixtures__/invalid";
  const fixtures = readdirSync(INVALID_ROOT).filter((d) =>
    statSync(resolve(INVALID_ROOT, d)).isDirectory(),
  );

  for (const name of fixtures) {
    it(`fixture "${name}" produces the expected error`, () => {
      const sourceRoot = resolve(INVALID_ROOT, name);
      const expectedFile = resolve(sourceRoot, "expected-error.txt");
      if (!existsSync(expectedFile)) {
        throw new Error(`Fixture ${name} is missing expected-error.txt`);
      }
      const expectedSubstring = readFileSync(expectedFile, "utf-8").trim();
      const outRoot = mkdtempSync(
        resolve(tmpdir(), `scene-compile-bad-${name}-`),
      );
      try {
        const result = compile({ sourceRoot, outputRoot: outRoot });
        expect(result.ok).toBe(false);
        if (result.ok) return;
        const matched = result.errors.some(
          (e) =>
            e.code === expectedSubstring ||
            e.message.includes(expectedSubstring),
        );
        if (!matched) {
          throw new Error(
            `Fixture "${name}" did not produce expected error "${expectedSubstring}". Got:\n` +
              formatErrors(result.errors),
          );
        }
      } finally {
        rmSync(outRoot, { recursive: true, force: true });
      }
    });
  }
});

describe("HPA-257 compiler diagnostics", () => {
  const WARNING_ROOT = "packages/scripts/__fixtures__/hpa_257_warnings";
  const warningFixtures = readdirSync(WARNING_ROOT)
    .filter((name) => statSync(resolve(WARNING_ROOT, name)).isDirectory())
    .sort((left, right) => left.localeCompare(right));

  for (const name of warningFixtures) {
    it(`returns the expected reachability warning snapshot for "${name}"`, () => {
      const sourceRoot = resolve(WARNING_ROOT, name);
      const expectedWarningCodes = readFileSync(
        resolve(sourceRoot, "expected-warning.txt"),
        "utf-8",
      )
        .trim()
        .split(/\r?\n/)
        .filter(Boolean);
      const outRoot = mkdtempSync(
        resolve(tmpdir(), `scene-compile-hpa-257-warning-${name}-`),
      );
      try {
        const result = compile({ sourceRoot, outputRoot: outRoot });
        if (!result.ok) {
          throw new Error("Compile failed:\n" + formatErrors(result.errors));
        }
        expect(hpa257DiagnosticCodes(result.warnings)).toEqual(
          expectedWarningCodes,
        );
      } finally {
        rmSync(outRoot, { recursive: true, force: true });
      }
    });
  }

  it("sorts new reachability errors by source location before the normalized node key", () => {
    const sourceRoot = resolve(
      "packages/scripts/__fixtures__/invalid/hpa_257_positive_self_reference",
    );
    const outRoot = mkdtempSync(
      resolve(tmpdir(), "scene-compile-hpa-257-diagnostic-order-"),
    );
    try {
      const result = compile({ sourceRoot, outputRoot: outRoot });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(
        result.errors
          .filter((error) => error.code === "positiveSelfReference")
          .map(({ sourceFile, line, code }) => ({ sourceFile, line, code })),
      ).toEqual([
        {
          sourceFile: "chapter_1/investigation_scene_1.md",
          line: 9,
          code: "positiveSelfReference",
        },
        {
          sourceFile: "chapter_1/investigation_scene_1.md",
          line: 18,
          code: "positiveSelfReference",
        },
      ]);
    } finally {
      rmSync(outRoot, { recursive: true, force: true });
    }
  });

  it("reports case-record corpus failures before HPA-257 reachability diagnostics", () => {
    const sourceRoot = resolve(
      "packages/scripts/__fixtures__/invalid/hpa_259_case_record_before_reachability",
    );
    const outRoot = mkdtempSync(
      resolve(tmpdir(), "scene-compile-hpa-259-case-record-order-"),
    );
    try {
      const result = compile({ sourceRoot, outputRoot: outRoot });
      expect(result.ok).toBe(false);
      if (result.ok) return;

      const codes = result.errors.map((error) => error.code);
      const caseRecordIndex = codes.indexOf("caseRecordSourceGroupUnused");
      const reachabilityIndex = codes.findIndex((code) =>
        HPA_257_DIAGNOSTIC_CODES.has(code),
      );

      expect(caseRecordIndex).toBeGreaterThanOrEqual(0);
      expect(reachabilityIndex).toBeGreaterThanOrEqual(0);
      expect(caseRecordIndex).toBeLessThan(reachabilityIndex);
    } finally {
      rmSync(outRoot, { recursive: true, force: true });
    }
  });

  it.each([
    {
      label: "structural validation",
      fixture: "unresolved_reveal_target",
      expectedEarlierCode: "unresolvedRevealTarget",
      storyCatalog: SINGLETON_SOURCE_GROUP_CATALOG,
    },
    {
      label: "story-catalog validation",
      fixture: "../valid",
      expectedEarlierCode: "duplicateGlobalDefinitionId",
      storyCatalog: DUPLICATE_SOURCE_GROUP_CATALOG,
    },
    {
      label: "story predicate-reference validation",
      fixture: "hpa_257_unknown_story_predicates",
      expectedEarlierCode: "unresolvedStoryPredicate",
      storyCatalog: SINGLETON_SOURCE_GROUP_CATALOG,
    },
  ])(
    "keeps $label diagnostics ahead of case-record corpus failures",
    ({ fixture, expectedEarlierCode, storyCatalog }) => {
      const sourceRoot = mkdtempSync(
        resolve(tmpdir(), "scene-compile-hpa-259-earlier-validation-"),
      );
      const outRoot = mkdtempSync(
        resolve(tmpdir(), "scene-compile-hpa-259-earlier-validation-out-"),
      );
      try {
        cpSync(
          resolve("packages/scripts/__fixtures__/invalid", fixture),
          sourceRoot,
          { recursive: true },
        );
        writeFileSync(resolve(sourceRoot, "story_catalog.md"), storyCatalog);

        const result = compile({ sourceRoot, outputRoot: outRoot });
        expect(result.ok).toBe(false);
        if (result.ok) return;

        const codes = result.errors.map((error) => error.code);
        const earlierIndex = codes.indexOf(expectedEarlierCode);
        const caseRecordIndex = codes.indexOf("caseRecordSourceGroupUnused");

        expect(earlierIndex).toBeGreaterThanOrEqual(0);
        expect(caseRecordIndex).toBeGreaterThanOrEqual(0);
        expect(earlierIndex).toBeLessThan(caseRecordIndex);
      } finally {
        rmSync(sourceRoot, { recursive: true, force: true });
        rmSync(outRoot, { recursive: true, force: true });
      }
    },
  );

  it("skips abstract effect simulation after semantic reference validation fails", () => {
    const fixtureRoot = mkdtempSync(
      resolve(tmpdir(), "scene-compile-hpa-257-invalid-reference-"),
    );
    const sourceRoot = resolve(fixtureRoot, "fixture");
    const outRoot = mkdtempSync(
      resolve(tmpdir(), "scene-compile-hpa-257-invalid-reference-output-"),
    );
    try {
      cpSync(
        resolve(
          "packages/scripts/__fixtures__/invalid/hpa_257_positive_self_reference",
        ),
        sourceRoot,
        { recursive: true },
      );
      const scenePath = resolve(
        sourceRoot,
        "chapter_1/investigation_scene_1.md",
      );
      writeFileSync(
        scenePath,
        readFileSync(scenePath, "utf-8").replace(
          "[assert_fact:zeta_loop]",
          "[assert_fact:zeta_loop, assert_fact:unknown_fact]",
        ),
      );

      const result = compile({ sourceRoot, outputRoot: outRoot });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(
        result.errors.some((error) => error.message.includes("unknown_fact")),
      ).toBe(true);
      expect(hpa257DiagnosticCodes(result.errors)).toEqual([]);
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
      rmSync(outRoot, { recursive: true, force: true });
    }
  });

  it("rejects every unknown typed story predicate before reachability", () => {
    const sourceRoot = resolve(
      "packages/scripts/__fixtures__/invalid/hpa_257_unknown_story_predicates",
    );
    const outRoot = mkdtempSync(
      resolve(tmpdir(), "scene-compile-hpa-257-unknown-predicates-"),
    );
    try {
      const result = compile({ sourceRoot, outputRoot: outRoot });
      expect(result.ok).toBe(false);
      if (result.ok) return;

      const referenceErrors = result.errors.filter(
        (error) => error.code === "unresolvedStoryPredicate",
      );
      expect(referenceErrors).toHaveLength(4);
      expect(referenceErrors.map((error) => error.message)).toEqual([
        expect.stringContaining('unknown fact "missing_fact"'),
        expect.stringContaining('unknown question "missing_question"'),
        expect.stringContaining('unknown objective "missing_objective"'),
        expect.stringContaining(
          'unknown authorization "missing_authorization"',
        ),
      ]);
      expect(hpa257DiagnosticCodes(result.errors)).toEqual([]);
    } finally {
      rmSync(outRoot, { recursive: true, force: true });
    }
  });

  it("rejects unregistered qualified analysis predicates before reachability", () => {
    const sourceRoot = resolve(
      "packages/scripts/__fixtures__/invalid/hpa_257_absent_analysis_registration",
    );
    const outRoot = mkdtempSync(
      resolve(tmpdir(), "scene-compile-hpa-257-missing-analysis-"),
    );
    try {
      const result = compile({ sourceRoot, outputRoot: outRoot });
      expect(result.ok).toBe(false);
      if (result.ok) return;

      expect(
        result.errors
          .filter((error) => error.code === "unresolvedAnalysisPredicate")
          .map((error) => error.message),
      ).toEqual([
        expect.stringContaining("chapter_9@analysis_scene_1"),
        expect.stringContaining("chapter_9@analysis_scene_1@board_1"),
      ]);
      expect(hpa257DiagnosticCodes(result.errors)).toEqual([]);
    } finally {
      rmSync(outRoot, { recursive: true, force: true });
    }
  });
});

describe("compile parse failure handling", () => {
  it("keeps analysis parse failures source-located without adding a manifest-missing error", () => {
    // Break caught: dispatch could report a generic unknown or missing file
    // instead of the parser's authored location, obscuring the repair.
    const sourceRoot = mkdtempSync(
      resolve(tmpdir(), "scene-compile-analysis-parse-fail-"),
    );
    const outRoot = mkdtempSync(
      resolve(tmpdir(), "scene-compile-analysis-parse-fail-out-"),
    );
    try {
      const chapterRoot = resolve(sourceRoot, "chapter_1");
      mkdirSync(chapterRoot, { recursive: true });
      writeFileSync(
        resolve(chapterRoot, "chapter.md"),
        "# Chapter 1: Analysis parse failure\n\n**Summary:** Tests parser locations.\n\n## Scenes\n\n1. analysis_scene_1.md\n",
      );
      writeFileSync(
        resolve(chapterRoot, "analysis_scene_1.md"),
        "# Scene 1: Missing summary\n\n## Intro\n\n**相馬律**：開始。\n",
      );

      const result = compile({ sourceRoot, outputRoot: outRoot });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          code: "analysisSceneMissingSummary",
          sourceFile: "chapter_1/analysis_scene_1.md",
          line: 1,
        }),
      );
      expect(
        result.errors.some(
          (error) => error.code === "chapterManifestMissingFile",
        ),
      ).toBe(false);
    } finally {
      rmSync(sourceRoot, { recursive: true, force: true });
      rmSync(outRoot, { recursive: true, force: true });
    }
  });

  it("does not report a manifest missing-file error for a scene that failed to parse", () => {
    const sourceRoot = mkdtempSync(
      resolve(tmpdir(), "scene-compile-parse-fail-"),
    );
    const outRoot = mkdtempSync(
      resolve(tmpdir(), "scene-compile-parse-fail-out-"),
    );
    try {
      const chapterRoot = resolve(sourceRoot, "chapter_1");
      mkdirSync(chapterRoot, { recursive: true });
      writeFileSync(
        resolve(chapterRoot, "chapter.md"),
        "# Chapter 1: Parse Fail\n\n**Summary:** s\n\n## Scenes\n1. scene_0.md\n",
      );
      writeFileSync(
        resolve(chapterRoot, "scene_0.md"),
        "this is not a valid linear scene\n",
      );

      const result = compile({ sourceRoot, outputRoot: outRoot });
      expect(result.ok).toBe(false);
      if (result.ok) return;

      expect(
        result.errors.some((e) => e.code === "linearSceneMissingTitle"),
      ).toBe(true);
      expect(
        result.errors.some((e) => e.code === "chapterManifestMissingFile"),
      ).toBe(false);
    } finally {
      rmSync(sourceRoot, { recursive: true, force: true });
      rmSync(outRoot, { recursive: true, force: true });
    }
  });

  it("reports invalid investigation layout sidecars and prevents output", () => {
    const sourceRoot = mkdtempSync(
      resolve(tmpdir(), "scene-compile-bad-layout-"),
    );
    const outRoot = mkdtempSync(
      resolve(tmpdir(), "scene-compile-bad-layout-out-"),
    );
    try {
      const chapterRoot = resolve(sourceRoot, "chapter_1");
      mkdirSync(chapterRoot, { recursive: true });
      writeFileSync(
        resolve(chapterRoot, "chapter.md"),
        "# Chapter 1: Bad Layout\n\n**Summary:** s\n\n## Scenes\n1. investigation_scene_1.md\n",
      );
      writeFileSync(
        resolve(chapterRoot, "investigation_scene_1.md"),
        readFileSync(
          "packages/scripts/__fixtures__/valid/chapter_1/investigation_scene_1.md",
          "utf-8",
        ),
      );
      writeFileSync(
        resolve(chapterRoot, "investigation_scene_1.layout.json"),
        JSON.stringify(
          {
            version: 1,
            sceneId: "investigation_scene_1",
            sublocations: {
              main_hall: {
                hotspots: {
                  missing_table: {
                    kind: "rect",
                    x: 0.1,
                    y: 0.2,
                    w: 0.3,
                    h: 0.4,
                  },
                },
                characters: {},
              },
            },
          },
          null,
          2,
        ),
      );

      const result = compile({ sourceRoot, outputRoot: outRoot });

      expect(result.ok).toBe(false);
      expect(existsSync(resolve(outRoot, "chapters.json"))).toBe(false);
      if (result.ok) return;
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          code: "layoutUnknownHotspot",
          sourceFile: "chapter_1/investigation_scene_1.layout.json",
        }),
      );
    } finally {
      rmSync(sourceRoot, { recursive: true, force: true });
      rmSync(outRoot, { recursive: true, force: true });
    }
  });
});

describe("asset enrichment: first visual cue audio validation", () => {
  const enabledConfig: AssetConfig = {
    enabled: true,
    globalStylePrompt: "anime style",
    types: {
      background: {
        dimensions: [1920, 1080],
        format: "png",
        transparency: false,
        prompt: "",
      },
      portrait: {
        dimensions: [768, 1024],
        format: "png",
        transparency: true,
        prompt: "",
      },
      evidence: {
        dimensions: [512, 512],
        format: "png",
        transparency: true,
        prompt: "",
      },
      standee: {
        dimensions: [1024, 1024],
        format: "png",
        transparency: true,
        prompt: "",
      },
      audio: { format: "ogg", loop: true, prompt: "" },
    },
    characters: { byId: new Map(), byDisplayName: new Map() },
    audio: {
      bgm: new Map([["rain", { id: "rain", prompt: "rain", loop: true }]]),
      bgs: new Map([["wind", { id: "wind", prompt: "wind", loop: true }]]),
      sfx: new Map(),
    },
  };

  it("errors when first scene tag omits BGM", () => {
    const scene: SceneRecord = {
      chapterId: "chapter_1",
      file: "chapter_1/scene_0.md",
      ast: {
        kind: "linearScene",
        id: "scene_0",
        title: "Test",
        summary: "Test",
        summaryAuthored: false,
        sourceFile: "scene_0.md",
        line: 1,
        queue: [
          {
            kind: "sceneTag",
            text: "Test Scene",
            assetCue: {
              backgroundPrompt: "a dark room",
              backgroundAssetId: null,
              bgm: null, // omitted — should error on first cue
              bgs: { channel: "bgs", assetId: "wind" },
            },
          },
        ],
        assetRefs: [],
      },
    };
    const result = enrichScenesWithAssets({
      scenes: [scene],
      config: enabledConfig,
    });
    expect(
      result.errors.some((e) => e.code === "assetFirstCueMissingBgm"),
    ).toBe(true);
    expect(
      result.errors.some((e) => e.code === "assetFirstCueMissingBgs"),
    ).toBe(false);
  });

  it("errors when first scene tag omits BGS", () => {
    const scene: SceneRecord = {
      chapterId: "chapter_1",
      file: "chapter_1/scene_0.md",
      ast: {
        kind: "linearScene",
        id: "scene_0",
        title: "Test",
        summary: "Test",
        summaryAuthored: false,
        sourceFile: "scene_0.md",
        line: 1,
        queue: [
          {
            kind: "sceneTag",
            text: "Test Scene",
            assetCue: {
              backgroundPrompt: "a dark room",
              backgroundAssetId: null,
              bgm: { channel: "bgm", assetId: "rain" },
              bgs: null, // omitted — should error on first cue
            },
          },
        ],
        assetRefs: [],
      },
    };
    const result = enrichScenesWithAssets({
      scenes: [scene],
      config: enabledConfig,
    });
    expect(
      result.errors.some((e) => e.code === "assetFirstCueMissingBgs"),
    ).toBe(true);
    expect(
      result.errors.some((e) => e.code === "assetFirstCueMissingBgm"),
    ).toBe(false);
  });

  it("does not error when first scene tag sets BGM and BGS to none", () => {
    const scene: SceneRecord = {
      chapterId: "chapter_1",
      file: "chapter_1/scene_0.md",
      ast: {
        kind: "linearScene",
        id: "scene_0",
        title: "Test",
        summary: "Test",
        summaryAuthored: false,
        sourceFile: "scene_0.md",
        line: 1,
        queue: [
          {
            kind: "sceneTag",
            text: "Test Scene",
            assetCue: {
              backgroundPrompt: "a dark room",
              backgroundAssetId: null,
              bgm: { channel: "bgm", assetId: null }, // explicit none — valid
              bgs: { channel: "bgs", assetId: null }, // explicit none — valid
            },
          },
        ],
        assetRefs: [],
      },
    };
    const result = enrichScenesWithAssets({
      scenes: [scene],
      config: enabledConfig,
    });
    expect(
      result.errors.some((e) => e.code === "assetFirstCueMissingBgm"),
    ).toBe(false);
    expect(
      result.errors.some((e) => e.code === "assetFirstCueMissingBgs"),
    ).toBe(false);
  });

  it("does not error when non-first scene tag omits BGM", () => {
    const scene: SceneRecord = {
      chapterId: "chapter_1",
      file: "chapter_1/scene_0.md",
      ast: {
        kind: "linearScene",
        id: "scene_0",
        title: "Test",
        summary: "Test",
        summaryAuthored: false,
        sourceFile: "scene_0.md",
        line: 1,
        queue: [
          {
            kind: "sceneTag",
            text: "First Scene",
            assetCue: {
              backgroundPrompt: "a dark room",
              backgroundAssetId: null,
              bgm: { channel: "bgm", assetId: "rain" },
              bgs: { channel: "bgs", assetId: "wind" },
            },
          },
          {
            kind: "sceneTag",
            text: "Second Scene",
            assetCue: {
              backgroundPrompt: "a light room",
              backgroundAssetId: null,
              bgm: null, // omitted on non-first — valid
              bgs: null,
            },
          },
        ],
        assetRefs: [],
      },
    };
    const result = enrichScenesWithAssets({
      scenes: [scene],
      config: enabledConfig,
    });
    expect(
      result.errors.some((e) => e.code === "assetFirstCueMissingBgm"),
    ).toBe(false);
    expect(
      result.errors.some((e) => e.code === "assetFirstCueMissingBgs"),
    ).toBe(false);
  });
});

describe("compile (multiple source roots)", () => {
  it("merges chapters across roots and skips a non-existent root", () => {
    const outRoot = mkdtempSync(resolve(tmpdir(), "scene-compile-multi-"));
    const missingRoot = resolve(tmpdir(), "scene-compile-definitely-missing");
    rmSync(missingRoot, { recursive: true, force: true });
    try {
      const result = compile({
        sourceRoot: ["packages/scripts/__fixtures__/valid", missingRoot],
        outputRoot: outRoot,
      });
      if (!result.ok) {
        throw new Error("Compile failed:\n" + formatErrors(result.errors));
      }
      expect(result.chaptersCompiled).toBe(1);
      expect(result.scenesCompiled).toBe(2);
    } finally {
      rmSync(outRoot, { recursive: true, force: true });
    }
  });

  it("errors with duplicateChapter when the same chapter appears in two roots", () => {
    const outRoot = mkdtempSync(resolve(tmpdir(), "scene-compile-dup-"));
    try {
      const result = compile({
        sourceRoot: [
          "packages/scripts/__fixtures__/valid",
          "packages/scripts/__fixtures__/valid",
        ],
        outputRoot: outRoot,
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.errors.some((e) => e.code === "duplicateChapter")).toBe(
        true,
      );
    } finally {
      rmSync(outRoot, { recursive: true, force: true });
    }
  });
});

describe("compile (global story catalog)", () => {
  it("rejects colliding derived dialogue origins with both carrier locations", () => {
    const sourceRoot = mkdtempSync(
      resolve(tmpdir(), "scene-compile-origin-collision-source-"),
    );
    const outRoot = mkdtempSync(
      resolve(tmpdir(), "scene-compile-origin-collision-out-"),
    );
    try {
      cpSync("packages/scripts/__fixtures__/valid", sourceRoot, {
        recursive: true,
      });
      const scenePath = resolve(
        sourceRoot,
        "chapter_1/investigation_scene_1.md",
      );
      const original = readFileSync(scenePath, "utf8");
      const duplicateCarrier = [
        "### Character: 第二證人 {#witness}",
        "",
        "- **Role:** 證人",
        "- **Bio:** 在另一個地點重複同一個話題。",
        "",
        "#### Topic: 重複的案發時間 {#timeline}",
        "",
        "- **Status:** unlocked",
        "",
        "**證人**：這是第二個衝突的話題。",
        "",
      ].join("\n");
      writeFileSync(
        scenePath,
        original.replace(
          "## Evidence Manifest",
          `${duplicateCarrier}\n## Evidence Manifest`,
        ),
      );

      const result = compile({ sourceRoot, outputRoot: outRoot });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      const collision = result.errors.find(
        (error) => error.code === "derivedDialogueOriginCollision",
      );
      expect(collision).toMatchObject({
        sourceFile: "chapter_1/investigation_scene_1.md",
        line: 87,
      });
      expect(collision?.message).toContain(
        "chapter_1/investigation_scene_1.md:45",
      );
      expect(collision?.message).toContain(
        "chapter_1/investigation_scene_1.md:87",
      );
    } finally {
      rmSync(sourceRoot, { recursive: true, force: true });
      rmSync(outRoot, { recursive: true, force: true });
    }
  });

  it("emits a stable manifest for emitted chapter and scene order", () => {
    const sourceRoot = mkdtempSync(
      resolve(tmpdir(), "scene-compile-save-content-source-"),
    );
    const outRoot = mkdtempSync(
      resolve(tmpdir(), "scene-compile-save-content-out-"),
    );
    const linearScene = readFileSync(
      "packages/scripts/__fixtures__/valid/chapter_1/scene_0.md",
      "utf-8",
    );
    const readJson = (path: string) =>
      JSON.parse(readFileSync(resolve(outRoot, path), "utf-8"));
    const readManifest = () => readJson("save_content_manifest.json");
    try {
      const firstChapter = resolve(sourceRoot, "chapter_1");
      const secondChapter = resolve(sourceRoot, "chapter_2");
      mkdirSync(firstChapter);
      mkdirSync(secondChapter);
      writeFileSync(
        resolve(firstChapter, "chapter.md"),
        "# Chapter 1: First authored chapter\n\n**Summary:** First summary.\n\n## Scenes\n1. scene_first.md\n2. scene_second.md\n",
      );
      writeFileSync(resolve(firstChapter, "scene_first.md"), linearScene);
      writeFileSync(resolve(firstChapter, "scene_second.md"), linearScene);
      writeFileSync(
        resolve(secondChapter, "chapter.md"),
        "# Chapter 2: Second authored chapter\n\n**Summary:** Second summary.\n\n## Scenes\n1. scene_third.md\n",
      );
      writeFileSync(resolve(secondChapter, "scene_third.md"), linearScene);

      const first = compile({ sourceRoot, outputRoot: outRoot });
      if (!first.ok) throw new Error(formatErrors(first.errors));

      const chapterOne = {
        id: "chapter_1",
        title: "First authored chapter",
        summary: "First summary.",
        scenes: [
          readJson("chapter_1/scene_first.json"),
          readJson("chapter_1/scene_second.json"),
        ],
      };
      const chapterTwo = {
        id: "chapter_2",
        title: "Second authored chapter",
        summary: "Second summary.",
        scenes: [readJson("chapter_2/scene_third.json")],
      };
      const storyCatalog = readJson("story_catalog.json");
      const emitted = readManifest();

      // Regression: hashing chapters or scene filenames in a different order
      // would silently invalidate existing saves for unchanged authored content.
      expect(emitted).toEqual(
        buildSaveContentManifest({
          bundle: {
            chapters: [chapterOne, chapterTwo],
            storyCatalog,
          },
        }),
      );
      expect(emitted).not.toEqual(
        buildSaveContentManifest({
          bundle: {
            chapters: [chapterTwo, chapterOne],
            storyCatalog,
          },
        }),
      );
      expect(emitted).not.toEqual(
        buildSaveContentManifest({
          bundle: {
            chapters: [
              { ...chapterOne, scenes: [...chapterOne.scenes].reverse() },
              chapterTwo,
            ],
            storyCatalog,
          },
        }),
      );
      expect(Object.keys(emitted).sort()).toEqual([
        "contentRevision",
        "manifestVersion",
      ]);

      const firstManifestText = readFileSync(
        resolve(outRoot, "save_content_manifest.json"),
        "utf-8",
      );
      const second = compile({ sourceRoot, outputRoot: outRoot });
      if (!second.ok) throw new Error(formatErrors(second.errors));
      expect(
        readFileSync(resolve(outRoot, "save_content_manifest.json"), "utf-8"),
      ).toBe(firstManifestText);

      writeFileSync(
        resolve(firstChapter, "chapter.md"),
        "# Chapter 1: First authored chapter\n\n**Summary:** First summary.\n\n## Scenes\n1. scene_second.md\n2. scene_first.md\n",
      );
      const reordered = compile({ sourceRoot, outputRoot: outRoot });
      if (!reordered.ok) throw new Error(formatErrors(reordered.errors));
      expect(readManifest().contentRevision).not.toBe(emitted.contentRevision);
    } finally {
      rmSync(sourceRoot, { recursive: true, force: true });
      rmSync(outRoot, { recursive: true, force: true });
    }
  });

  it("emits the exact empty version-2 artifact when no catalog is authored", () => {
    const sourceRoot = mkdtempSync(
      resolve(tmpdir(), "scene-compile-empty-catalog-source-"),
    );
    const outRoot = mkdtempSync(
      resolve(tmpdir(), "scene-compile-empty-catalog-out-"),
    );
    try {
      const chapterRoot = resolve(sourceRoot, "chapter_1");
      mkdirSync(chapterRoot);
      writeFileSync(
        resolve(chapterRoot, "chapter.md"),
        "# Chapter 1: Empty Catalog\n\n**Summary:** No records.\n\n## Scenes\n1. scene_0.md\n",
      );
      writeFileSync(
        resolve(chapterRoot, "scene_0.md"),
        readFileSync(
          "packages/scripts/__fixtures__/valid/chapter_1/scene_0.md",
          "utf-8",
        ),
      );

      const result = compile({
        sourceRoot,
        outputRoot: outRoot,
      });
      if (!result.ok) throw new Error(formatErrors(result.errors));

      expect(
        JSON.parse(
          readFileSync(resolve(outRoot, "story_catalog.json"), "utf-8"),
        ),
      ).toEqual({
        schemaVersion: 2,
        facts: [],
        questions: [],
        objectives: [],
        authorizations: [],
        sourceGroups: [],
        evidenceIndex: [],
        statementsIndex: [],
        analysisScenes: [],
        analysisBoards: [],
      });
    } finally {
      rmSync(sourceRoot, { recursive: true, force: true });
      rmSync(outRoot, { recursive: true, force: true });
    }
  });

  it.each(["first", "second"] as const)(
    "compiles one catalog discovered in the %s configured root",
    (position) => {
      const catalogRoot = mkdtempSync(
        resolve(tmpdir(), `scene-compile-catalog-${position}-`),
      );
      const outRoot = mkdtempSync(
        resolve(tmpdir(), `scene-compile-catalog-${position}-out-`),
      );
      try {
        writeFileSync(
          resolve(catalogRoot, "story_catalog.md"),
          VALID_STORY_CATALOG,
        );
        const fixtureRoot = "packages/scripts/__fixtures__/valid";
        const sourceRoot =
          position === "first"
            ? [catalogRoot, fixtureRoot]
            : [fixtureRoot, catalogRoot];

        const result = compile({ sourceRoot, outputRoot: outRoot });
        if (!result.ok) throw new Error(formatErrors(result.errors));

        const emitted = JSON.parse(
          readFileSync(resolve(outRoot, "story_catalog.json"), "utf-8"),
        );
        expect(emitted.facts).toContainEqual(
          expect.objectContaining({ id: "visitor_signed_in" }),
        );
        expect(emitted.questions[0]?.resolvedByFactIds).toEqual([
          "visitor_signed_in",
        ]);
        expect(emitted.sourceGroups).toEqual([]);
      } finally {
        rmSync(catalogRoot, { recursive: true, force: true });
        rmSync(outRoot, { recursive: true, force: true });
      }
    },
  );

  it("rejects two catalogs at the second path and writes no catalog artifact", () => {
    const firstRoot = mkdtempSync(
      resolve(tmpdir(), "scene-compile-catalog-duplicate-first-"),
    );
    const secondRoot = mkdtempSync(
      resolve(tmpdir(), "scene-compile-catalog-duplicate-second-"),
    );
    const outRoot = mkdtempSync(
      resolve(tmpdir(), "scene-compile-catalog-duplicate-out-"),
    );
    try {
      writeFileSync(
        resolve(firstRoot, "story_catalog.md"),
        VALID_STORY_CATALOG,
      );
      writeFileSync(
        resolve(secondRoot, "story_catalog.md"),
        VALID_STORY_CATALOG,
      );

      const result = compile({
        sourceRoot: [
          firstRoot,
          secondRoot,
          "packages/scripts/__fixtures__/valid",
        ],
        outputRoot: outRoot,
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          code: "duplicateStoryCatalog",
          sourceFile: resolve(secondRoot, "story_catalog.md"),
        }),
      );
      expect(existsSync(resolve(outRoot, "story_catalog.json"))).toBe(false);
    } finally {
      rmSync(firstRoot, { recursive: true, force: true });
      rmSync(secondRoot, { recursive: true, force: true });
      rmSync(outRoot, { recursive: true, force: true });
    }
  });

  it("reports an unreadable discovered catalog", () => {
    const catalogRoot = mkdtempSync(
      resolve(tmpdir(), "scene-compile-catalog-unreadable-"),
    );
    const outRoot = mkdtempSync(
      resolve(tmpdir(), "scene-compile-catalog-unreadable-out-"),
    );
    const catalogPath = resolve(catalogRoot, "story_catalog.md");
    try {
      mkdirSync(catalogPath);

      const result = compile({
        sourceRoot: ["packages/scripts/__fixtures__/valid", catalogRoot],
        outputRoot: outRoot,
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          code: "storyCatalogUnreadable",
          sourceFile: catalogPath,
        }),
      );
    } finally {
      rmSync(catalogRoot, { recursive: true, force: true });
      rmSync(outRoot, { recursive: true, force: true });
    }
  });

  it("leaves pre-existing catalog and save manifest artifacts unchanged on validation failure", () => {
    const catalogRoot = mkdtempSync(
      resolve(tmpdir(), "scene-compile-catalog-invalid-"),
    );
    const outRoot = mkdtempSync(
      resolve(tmpdir(), "scene-compile-catalog-invalid-out-"),
    );
    const sentinel = '{"sentinel":"keep exactly"}\n';
    const manifestSentinel = '{"save":"keep exactly"}\n';
    try {
      writeFileSync(
        resolve(catalogRoot, "story_catalog.md"),
        readFileSync(
          "packages/scripts/__fixtures__/story_catalog/invalid_duplicate_fact/story_catalog.md",
          "utf-8",
        ),
      );
      writeFileSync(resolve(outRoot, "story_catalog.json"), sentinel);
      writeFileSync(
        resolve(outRoot, "save_content_manifest.json"),
        manifestSentinel,
      );

      const result = compile({
        sourceRoot: ["packages/scripts/__fixtures__/valid", catalogRoot],
        outputRoot: outRoot,
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.errors).toContainEqual(
        expect.objectContaining({ code: "duplicateGlobalDefinitionId" }),
      );
      expect(
        readFileSync(resolve(outRoot, "story_catalog.json"), "utf-8"),
      ).toBe(sentinel);
      expect(
        readFileSync(resolve(outRoot, "save_content_manifest.json"), "utf-8"),
      ).toBe(manifestSentinel);
    } finally {
      rmSync(catalogRoot, { recursive: true, force: true });
      rmSync(outRoot, { recursive: true, force: true });
    }
  });

  it("replaces only compiler-owned scene outputs on successful compilation", () => {
    const outRoot = mkdtempSync(
      resolve(tmpdir(), "scene-compile-catalog-surgical-out-"),
    );
    try {
      writeFileSync(resolve(outRoot, "chapters.json"), "old chapters\n");
      writeFileSync(resolve(outRoot, "story_catalog.json"), "old catalog\n");
      writeFileSync(
        resolve(outRoot, "save_content_manifest.json"),
        "old save content manifest\n",
      );
      mkdirSync(resolve(outRoot, "chapter_99"));
      writeFileSync(
        resolve(outRoot, "chapter_99/stale.json"),
        "stale chapter\n",
      );
      writeFileSync(resolve(outRoot, "keep.txt"), "keep file\n");
      mkdirSync(resolve(outRoot, "future_data"));
      writeFileSync(
        resolve(outRoot, "future_data/keep.json"),
        "keep directory\n",
      );

      const result = compile({
        sourceRoot: "packages/scripts/__fixtures__/valid",
        outputRoot: outRoot,
      });
      if (!result.ok) throw new Error(formatErrors(result.errors));

      expect(readdirSync(outRoot).sort()).toEqual([
        "chapter_1",
        "chapters.json",
        "future_data",
        "keep.txt",
        "save_content_manifest.json",
        "story_catalog.json",
      ]);
      expect(readFileSync(resolve(outRoot, "keep.txt"), "utf-8")).toBe(
        "keep file\n",
      );
      expect(
        readFileSync(resolve(outRoot, "future_data/keep.json"), "utf-8"),
      ).toBe("keep directory\n");
      expect(existsSync(resolve(outRoot, "chapter_99"))).toBe(false);
      expect(
        JSON.parse(
          readFileSync(resolve(outRoot, "story_catalog.json"), "utf-8"),
        ).schemaVersion,
      ).toBe(2);
      expect(
        JSON.parse(
          readFileSync(resolve(outRoot, "save_content_manifest.json"), "utf-8"),
        ),
      ).toMatchObject({
        manifestVersion: 1,
        contentRevision: expect.any(String),
      });
    } finally {
      rmSync(outRoot, { recursive: true, force: true });
    }
  });

  it.each([
    {
      label: "an undeclared record source group",
      expectedCode: "caseRecordSourceGroupUnknown",
      arrange(sourceRoot: string) {
        annotateCoffeeWithSourceGroup(sourceRoot);
      },
    },
    {
      label: "an unused catalog source group",
      expectedCode: "caseRecordSourceGroupUnused",
      arrange(sourceRoot: string) {
        writeFileSync(
          resolve(sourceRoot, "story_catalog.md"),
          SINGLETON_SOURCE_GROUP_CATALOG,
        );
      },
    },
  ])(
    "rejects $label before replacing any compiler-owned output",
    ({ expectedCode, arrange }) => {
      const sourceRoot = mkdtempSync(
        resolve(tmpdir(), "scene-compile-source-group-invalid-source-"),
      );
      const outRoot = mkdtempSync(
        resolve(tmpdir(), "scene-compile-source-group-invalid-out-"),
      );
      const sentinel = "preserve sentinel\n";
      try {
        cpSync("packages/scripts/__fixtures__/valid", sourceRoot, {
          recursive: true,
        });
        arrange(sourceRoot);
        for (const file of [
          "chapters.json",
          "story_catalog.json",
          "save_content_manifest.json",
        ]) {
          writeFileSync(resolve(outRoot, file), sentinel);
        }
        mkdirSync(resolve(outRoot, "chapter_1"));
        writeFileSync(resolve(outRoot, "chapter_1/sentinel.json"), sentinel);

        const result = compile({ sourceRoot, outputRoot: outRoot });

        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.errors).toContainEqual(
          expect.objectContaining({ code: expectedCode }),
        );
        for (const file of [
          "chapters.json",
          "story_catalog.json",
          "save_content_manifest.json",
          "chapter_1/sentinel.json",
        ]) {
          expect(readFileSync(resolve(outRoot, file), "utf-8")).toBe(sentinel);
        }
      } finally {
        rmSync(sourceRoot, { recursive: true, force: true });
        rmSync(outRoot, { recursive: true, force: true });
      }
    },
  );

  it("returns singleton warnings and emits structurally equal scene/catalog provenance from one corpus", () => {
    const sourceRoot = mkdtempSync(
      resolve(tmpdir(), "scene-compile-source-group-success-source-"),
    );
    const outRoot = mkdtempSync(
      resolve(tmpdir(), "scene-compile-source-group-success-out-"),
    );
    try {
      cpSync("packages/scripts/__fixtures__/valid", sourceRoot, {
        recursive: true,
      });
      annotateCoffeeWithSourceGroup(sourceRoot);
      writeFileSync(
        resolve(sourceRoot, "story_catalog.md"),
        SINGLETON_SOURCE_GROUP_CATALOG,
      );

      const result = compile({ sourceRoot, outputRoot: outRoot });

      if (!result.ok) throw new Error(formatErrors(result.errors));
      expect(result.warnings).toContainEqual(
        expect.objectContaining({
          code: "singletonSourceGroup",
          sourceFile: resolve(sourceRoot, "story_catalog.md"),
        }),
      );
      const scene = JSON.parse(
        readFileSync(
          resolve(outRoot, "chapter_1/investigation_scene_1.json"),
          "utf-8",
        ),
      );
      const catalog = JSON.parse(
        readFileSync(resolve(outRoot, "story_catalog.json"), "utf-8"),
      );
      const sceneRecord = scene.evidenceManifest.find(
        ({ id }: { id: string }) => id === "coffee",
      );
      const catalogRecord = catalog.evidenceIndex.find(
        ({ id }: { id: string }) => id === "coffee",
      );
      assert.deepStrictEqual(sceneRecord.provenance, catalogRecord.provenance);
      expect(catalog.sourceGroups).toEqual([
        {
          id: "program_export",
          label: "Program export",
          summary: "Records derived from the same program export.",
          members: [{ kind: "evidence", id: "coffee" }],
        },
      ]);
      expect(catalogRecord.provenance.proofCapabilities).toEqual([
        "time",
        "procedure",
      ]);
    } finally {
      rmSync(sourceRoot, { recursive: true, force: true });
      rmSync(outRoot, { recursive: true, force: true });
    }
  });
});

describe("compile (tracked production corpus compatibility)", () => {
  it("keeps the Chapter 1 warning and save-content manifest baseline", () => {
    const outRoot = mkdtempSync(
      resolve(tmpdir(), "scene-compile-live-baseline-"),
    );
    try {
      const repoRoot = resolve(".");
      const result = compile({
        sourceRoot: resolve(repoRoot, "docs/stories_plan"),
        outputRoot: outRoot,
        assetConfigRoot: resolve(repoRoot, "static/assets/config"),
        repoRoot,
      });
      if (!result.ok) {
        throw new Error(
          "Live corpus compile failed:\n" + formatErrors(result.errors),
        );
      }

      expect(hpa257DiagnosticCodes(result.warnings)).toEqual([]);

      expect({
        warnings: result.warnings,
        manifest: JSON.parse(
          readFileSync(resolve(outRoot, "save_content_manifest.json"), "utf-8"),
        ),
      }).toMatchSnapshot();
    } finally {
      rmSync(outRoot, { recursive: true, force: true });
    }
  });

  it("emits neutral provenance and no source groups without story migration", () => {
    const outRoot = mkdtempSync(
      resolve(tmpdir(), "scene-compile-live-provenance-"),
    );
    try {
      const repoRoot = resolve(".");
      const result = compile({
        sourceRoot: [
          resolve(repoRoot, "static/stories_plan"),
          resolve(repoRoot, "docs/stories_plan"),
        ],
        outputRoot: outRoot,
        assetConfigRoot: resolve(repoRoot, "static/assets/config"),
        assetOutputRoot: resolve(outRoot, "assets"),
        repoRoot,
      });
      if (!result.ok) {
        throw new Error(
          "Live corpus compile failed:\n" + formatErrors(result.errors),
        );
      }

      const chapters = JSON.parse(
        readFileSync(resolve(outRoot, "chapters.json"), "utf-8"),
      ) as {
        chapters: Array<{
          scenes: Array<{ type: string; file: string }>;
        }>;
      };
      const sceneRecords: Array<{
        kind: "evidence" | "statement";
        id: string;
        provenance: unknown;
      }> = [];
      for (const chapter of chapters.chapters) {
        for (const descriptor of chapter.scenes) {
          if (
            descriptor.type !== "investigation" &&
            descriptor.type !== "interrogation"
          ) {
            continue;
          }
          const scene = JSON.parse(
            readFileSync(resolve(outRoot, descriptor.file), "utf-8"),
          ) as {
            evidenceManifest: Array<{ id: string; provenance: unknown }>;
            statementManifest: Array<{ id: string; provenance: unknown }>;
          };
          sceneRecords.push(
            ...scene.evidenceManifest.map(({ id, provenance }) => ({
              kind: "evidence" as const,
              id,
              provenance,
            })),
            ...scene.statementManifest.map(({ id, provenance }) => ({
              kind: "statement" as const,
              id,
              provenance,
            })),
          );
        }
      }

      const catalog = JSON.parse(
        readFileSync(resolve(outRoot, "story_catalog.json"), "utf-8"),
      ) as {
        sourceGroups: unknown[];
        evidenceIndex: Array<{ id: string; provenance: unknown }>;
        statementsIndex: Array<{ id: string; provenance: unknown }>;
      };
      const catalogRecords = [
        ...catalog.evidenceIndex.map(({ id, provenance }) => ({
          kind: "evidence" as const,
          id,
          provenance,
        })),
        ...catalog.statementsIndex.map(({ id, provenance }) => ({
          kind: "statement" as const,
          id,
          provenance,
        })),
      ];

      expect(sceneRecords.length).toBeGreaterThan(0);
      expect(
        sceneRecords.map(({ kind, id }) => `${kind}:${id}`).sort(),
      ).toEqual(catalogRecords.map(({ kind, id }) => `${kind}:${id}`).sort());
      for (const record of [...sceneRecords, ...catalogRecords]) {
        expect(record.provenance).toEqual(NEUTRAL_CASE_RECORD_PROVENANCE);
      }
      expect(catalog.sourceGroups).toEqual([]);
    } finally {
      rmSync(outRoot, { recursive: true, force: true });
    }
  });
});

describe("compile (layout warning wiring)", () => {
  // End-to-end test for the orchestrator's non-blocking warning path:
  // a .layout.json sidecar with overlapping hotspot rects must produce a
  // successful compile (warnings are non-blocking) with layoutHotspotOverlap
  // entries in result.warnings. This verifies the full wiring from sidecar
  // parsing → detectLayoutOverlaps → CompileResult.warnings that the CLI
  // (compile-scenes.ts runOnce) prints via console.warn.
  it("returns ok with layoutHotspotOverlap warnings for overlapping hotspot rects", () => {
    const sourceRoot = mkdtempSync(
      resolve(tmpdir(), "scene-compile-overlap-warn-"),
    );
    const outRoot = mkdtempSync(
      resolve(tmpdir(), "scene-compile-overlap-warn-out-"),
    );
    try {
      const chapterRoot = resolve(sourceRoot, "chapter_1");
      mkdirSync(chapterRoot, { recursive: true });
      writeFileSync(
        resolve(chapterRoot, "chapter.md"),
        "# Chapter 1: Overlap Warn\n\n**Summary:** s\n\n## Scenes\n1. investigation_scene_1.md\n",
      );
      // Reuse the valid fixture's investigation scene — it has hotspots
      // `table` and `window` in sublocation `main_hall`.
      writeFileSync(
        resolve(chapterRoot, "investigation_scene_1.md"),
        readFileSync(
          "packages/scripts/__fixtures__/valid/chapter_1/investigation_scene_1.md",
          "utf-8",
        ),
      );
      // Sidecar with near-identical overlapping `table` and `window` rects
      // (>80% overlap of the smaller rect) and NO intentionalOverlaps opt-out
      // → should trigger layoutHotspotOverlap.
      writeFileSync(
        resolve(chapterRoot, "investigation_scene_1.layout.json"),
        JSON.stringify(
          {
            version: 1,
            sceneId: "investigation_scene_1",
            sublocations: {
              main_hall: {
                hotspots: {
                  table: { kind: "rect", x: 0.1, y: 0.1, w: 0.3, h: 0.3 },
                  window: { kind: "rect", x: 0.11, y: 0.11, w: 0.3, h: 0.3 },
                },
                characters: {},
              },
              back_room: {
                hotspots: {
                  cabinet: { kind: "rect", x: 0.1, y: 0.1, w: 0.2, h: 0.2 },
                },
                characters: {},
              },
            },
          },
          null,
          2,
        ),
      );

      const result = compile({ sourceRoot, outputRoot: outRoot });

      // Warnings are non-blocking — compile must still succeed.
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      // The orchestrator must have wired detectLayoutOverlaps output into
      // CompileResult.warnings (the array the CLI prints).
      expect(result.warnings.length).toBeGreaterThan(0);
      const overlapWarnings = result.warnings.filter(
        (w) => w.code === "layoutHotspotOverlap",
      );
      expect(overlapWarnings.length).toBe(1);
      expect(overlapWarnings[0]!.sourceFile).toBe(
        "chapter_1/investigation_scene_1.layout.json",
      );
      expect(overlapWarnings[0]!.message).toContain("table");
      expect(overlapWarnings[0]!.message).toContain("window");
    } finally {
      rmSync(sourceRoot, { recursive: true, force: true });
      rmSync(outRoot, { recursive: true, force: true });
    }
  });

  it("returns ok with no warnings when intentionalOverlaps suppresses the overlap", () => {
    const sourceRoot = mkdtempSync(
      resolve(tmpdir(), "scene-compile-overlap-suppressed-"),
    );
    const outRoot = mkdtempSync(
      resolve(tmpdir(), "scene-compile-overlap-suppressed-out-"),
    );
    try {
      const chapterRoot = resolve(sourceRoot, "chapter_1");
      mkdirSync(chapterRoot, { recursive: true });
      writeFileSync(
        resolve(chapterRoot, "chapter.md"),
        "# Chapter 1: Overlap Suppressed\n\n**Summary:** s\n\n## Scenes\n1. investigation_scene_1.md\n",
      );
      writeFileSync(
        resolve(chapterRoot, "investigation_scene_1.md"),
        readFileSync(
          "packages/scripts/__fixtures__/valid/chapter_1/investigation_scene_1.md",
          "utf-8",
        ),
      );
      // Same near-identical overlapping rects (>80%), but with
      // intentionalOverlaps opt-out → no warning should be emitted.
      writeFileSync(
        resolve(chapterRoot, "investigation_scene_1.layout.json"),
        JSON.stringify(
          {
            version: 1,
            sceneId: "investigation_scene_1",
            sublocations: {
              main_hall: {
                hotspots: {
                  table: { kind: "rect", x: 0.1, y: 0.1, w: 0.3, h: 0.3 },
                  window: { kind: "rect", x: 0.11, y: 0.11, w: 0.3, h: 0.3 },
                },
                characters: {},
                intentionalOverlaps: [{ hotspots: ["table", "window"] }],
              },
              back_room: {
                hotspots: {
                  cabinet: { kind: "rect", x: 0.1, y: 0.1, w: 0.2, h: 0.2 },
                },
                characters: {},
              },
            },
          },
          null,
          2,
        ),
      );

      const result = compile({ sourceRoot, outputRoot: outRoot });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.warnings).toEqual([]);
    } finally {
      rmSync(sourceRoot, { recursive: true, force: true });
      rmSync(outRoot, { recursive: true, force: true });
    }
  });
});

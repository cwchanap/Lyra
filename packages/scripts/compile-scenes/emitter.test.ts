import assert from "node:assert/strict";
import { describe, expect, it } from "vitest";
import { compileCaseRecordCorpus } from "./case-record-provenance";
import {
  emitChaptersIndex,
  emitInterrogationScene,
  emitInvestigationScene,
  emitLinearScene,
  emitStoryCatalog,
} from "./emitter";
import { parseInterrogationScene } from "./parser-interrogation";
import { emptyStoryCatalog } from "./parser-story-catalog";
import type {
  ASTChapter,
  ASTInterrogationScene,
  ASTInvestigationScene,
  ASTLinearScene,
  ASTStoryCatalog,
  CompiledCaseRecordCorpus,
  JSONChaptersIndex,
  JSONInterrogationScene,
} from "./types";
import type { SceneRecord } from "./validator";

function compileCorpus(
  catalog: ASTStoryCatalog,
  scenes: readonly SceneRecord[],
): CompiledCaseRecordCorpus {
  const result = compileCaseRecordCorpus(catalog, scenes);
  if (!result.ok) {
    throw new Error(
      result.errors
        .map(({ code, message }) => `${code}: ${message}`)
        .join("\n"),
    );
  }
  return result.value;
}

function corpusForScene(
  ast: ASTInvestigationScene | ASTInterrogationScene,
  chapterId = "chapter_1",
): CompiledCaseRecordCorpus {
  return compileCorpus(emptyStoryCatalog("story_catalog.md"), [
    { chapterId, file: ast.sourceFile, ast },
  ]);
}

// Mirrors XEXAM_SRC from parser-interrogation.test.ts (Task-2 grammar
// fixture): a question/testimony/line scene with one honest line and one
// contradiction line whose On Correct reveals a follow-up question.
const XEXAM_SRC = `# Scene 1: 訊問

## Intro

## Phase: 訊問若槻 {#press}
- **Kind:** inquiry
[場景：審訊室、深夜]

### Subject: 若槻悠真 {#wakatsuki}
- **Role:** 清掃員
- **Bio:** 值夜班的清潔工。

### Question: 當晚行蹤 {#alibi}
- **Status:** unlocked

#### Testimony
- **On Loop:** **相馬律**：還有哪裡對不上。再說一次。
- **Loop Prompt:** **相馬律**：從頭再聽一次。
- **Wrong Reply:** **相馬律**：不對，這不是關鍵。

##### Line: 下班時間 {#l_off}
**若槻悠真**：八點就下班了。

##### Line: 否認接觸 {#l_deny}
**若槻悠真**：那台機器我根本沒碰過。
- **Contradiction:** evidence:cleaning_log
- **Challenge:** **相馬律**：這句話對不上。
- **On Correct:** **若槻悠真**：好吧，我碰過。
  - **Reveals:** [question:cleaning_time]
- **On Wrong Evidence:** **若槻悠真**：這能證明什麼？

### Question: 追問清掃 {#cleaning_time}
- **Status:** locked
#### Testimony
- **On Loop:** **相馬律**：別想混過去。
##### Line: 交代 {#l_ct}
**若槻悠真**：我只是忘了關電源。

## Evidence Manifest

## Statement Manifest

## Outro
`;

function emitInterrogationFixture(): JSONInterrogationScene {
  const parsed = parseInterrogationScene(
    XEXAM_SRC,
    "interrogation_scene_1.md",
    "interrogation_scene_1",
  );
  if (!parsed.ok) {
    throw new Error(
      `fixture parse failed: ${parsed.error.code} ${parsed.error.message}`,
    );
  }
  return emitInterrogationScene(parsed.value, corpusForScene(parsed.value));
}

describe("emitter", () => {
  it("emits an empty version-2 story catalog", () => {
    const catalog = emptyStoryCatalog("story_catalog.md");
    expect(emitStoryCatalog(catalog, compileCorpus(catalog, []))).toEqual({
      schemaVersion: 2,
      facts: [],
      questions: [],
      objectives: [],
      authorizations: [],
      sourceGroups: [],
      evidenceIndex: [],
      statementsIndex: [],
    });
  });

  it("preserves authored definition order except objectives and derives sorted case-record origins", () => {
    const catalog: ASTStoryCatalog = {
      facts: [
        {
          id: "fact_z",
          label: "Fact Z",
          summary: "Z.",
          details: "Z details.",
          category: "timeline",
          sourceFile: "story_catalog.md",
          line: 3,
        },
        {
          id: "fact_a",
          label: "Fact A",
          summary: "A.",
          details: "A details.",
          category: "identity",
          sourceFile: "story_catalog.md",
          line: 8,
        },
      ],
      questions: [
        {
          id: "question_z",
          label: "Question Z",
          summary: "Z?",
          resolvedByFactIds: [
            {
              id: "fact_a",
              sourceFile: "story_catalog.md",
              line: 15,
            },
          ],
          sourceFile: "story_catalog.md",
          line: 13,
        },
        {
          id: "question_a",
          label: "Question A",
          summary: "A?",
          resolvedByFactIds: [],
          sourceFile: "story_catalog.md",
          line: 17,
        },
      ],
      objectives: [
        {
          id: "objective_z",
          label: "Objective Z",
          summary: "Later tie.",
          kind: "secondary",
          sortOrder: 2,
          sourceFile: "story_catalog.md",
          line: 22,
        },
        {
          id: "objective_late",
          label: "Objective Late",
          summary: "Last.",
          kind: "primary",
          sortOrder: 9,
          sourceFile: "story_catalog.md",
          line: 27,
        },
        {
          id: "objective_a",
          label: "Objective A",
          summary: "Earlier tie.",
          kind: "primary",
          sortOrder: 2,
          sourceFile: "story_catalog.md",
          line: 32,
        },
      ],
      authorizations: [
        {
          id: "authorization_z",
          label: "Authorization Z",
          summary: "Z.",
          grantingAuthority: "Authority Z",
          sourceFile: "story_catalog.md",
          line: 38,
        },
        {
          id: "authorization_a",
          label: "Authorization A",
          summary: "A.",
          grantingAuthority: "Authority A",
          sourceFile: "story_catalog.md",
          line: 43,
        },
      ],
      sourceGroups: [],
      sourceFile: "story_catalog.md",
      line: 1,
    };
    const scenes: SceneRecord[] = [
      {
        chapterId: "chapter_2",
        file: "investigation_scene_4.md",
        ast: {
          kind: "investigationScene",
          id: "investigation_scene_4",
          title: "Investigation",
          intro: [],
          sublocations: [],
          evidenceManifest: [
            {
              id: "evidence_z",
              name: "Evidence Z",
              description: "Z.",
              details: "Z details.",
              imageCue: { imagePrompt: null, imageAssetId: null },
              sourceSublocationId: null,
              onCollect: [],
              onReexamine: null,
              sourceFile: "chapter_2/investigation_scene_4.md",
              line: 10,
            },
          ],
          statementManifest: [
            {
              id: "statement_a",
              speaker: "Witness",
              content: "A.",
              onAcquire: [],
              onReexamine: null,
              sourceFile: "chapter_2/investigation_scene_4.md",
              line: 20,
            },
          ],
          outro: { unlock: "auto", dialogue: [] },
          assetRefs: [],
          sourceFile: "chapter_2/investigation_scene_4.md",
          line: 1,
        },
      },
      {
        chapterId: "chapter_1",
        file: "interrogation_scene_3.md",
        ast: {
          kind: "interrogationScene",
          id: "interrogation_scene_3",
          title: "Interrogation",
          intro: [],
          phases: [],
          evidenceManifest: [
            {
              id: "evidence_a",
              name: "Evidence A",
              description: "A.",
              details: "A details.",
              imageCue: { imagePrompt: null, imageAssetId: null },
              sourceSublocationId: null,
              onCollect: [],
              onReexamine: null,
              sourceFile: "chapter_1/interrogation_scene_3.md",
              line: 10,
            },
          ],
          statementManifest: [
            {
              id: "statement_z",
              speaker: "Suspect",
              content: "Z.",
              onAcquire: [],
              onReexamine: null,
              sourceFile: "chapter_1/interrogation_scene_3.md",
              line: 20,
            },
          ],
          outro: { unlock: "auto", dialogue: [] },
          assetRefs: [],
          sourceFile: "chapter_1/interrogation_scene_3.md",
          line: 1,
        },
      },
    ];

    const emitted = emitStoryCatalog(catalog, compileCorpus(catalog, scenes));

    expect(emitted.facts.map(({ id }) => id)).toEqual(["fact_z", "fact_a"]);
    expect(emitted.questions.map(({ id }) => id)).toEqual([
      "question_z",
      "question_a",
    ]);
    expect(emitted.objectives.map(({ id }) => id)).toEqual([
      "objective_a",
      "objective_z",
      "objective_late",
    ]);
    expect(emitted.authorizations.map(({ id }) => id)).toEqual([
      "authorization_z",
      "authorization_a",
    ]);
    expect(emitted.questions[0]?.resolvedByFactIds).toEqual(["fact_a"]);
    expect(emitted.evidenceIndex).toEqual([
      {
        id: "evidence_a",
        chapterId: "chapter_1",
        sceneId: "interrogation_scene_3",
        provenance: {
          sourceKind: "unspecified",
          representationLayer: "none",
          proceduralStatus: "unspecified",
          completeness: "unspecified",
          confidence: "unspecified",
          sourceGroupId: null,
          sourceLabel: null,
          proofCapabilities: [],
          supersedesRecordId: null,
        },
      },
      {
        id: "evidence_z",
        chapterId: "chapter_2",
        sceneId: "investigation_scene_4",
        provenance: {
          sourceKind: "unspecified",
          representationLayer: "none",
          proceduralStatus: "unspecified",
          completeness: "unspecified",
          confidence: "unspecified",
          sourceGroupId: null,
          sourceLabel: null,
          proofCapabilities: [],
          supersedesRecordId: null,
        },
      },
    ]);
    expect(emitted.statementsIndex).toEqual([
      {
        id: "statement_a",
        chapterId: "chapter_2",
        sceneId: "investigation_scene_4",
        provenance: {
          sourceKind: "unspecified",
          representationLayer: "none",
          proceduralStatus: "unspecified",
          completeness: "unspecified",
          confidence: "unspecified",
          sourceGroupId: null,
          sourceLabel: null,
          proofCapabilities: [],
          supersedesRecordId: null,
        },
      },
      {
        id: "statement_z",
        chapterId: "chapter_1",
        sceneId: "interrogation_scene_3",
        provenance: {
          sourceKind: "unspecified",
          representationLayer: "none",
          proceduralStatus: "unspecified",
          completeness: "unspecified",
          confidence: "unspecified",
          sourceGroupId: null,
          sourceLabel: null,
          proofCapabilities: [],
          supersedesRecordId: null,
        },
      },
    ]);
  });

  it("copies neutral and full provenance from one corpus into scenes and the exact canonical v2 catalog", () => {
    const ast: ASTInvestigationScene = {
      kind: "investigationScene",
      id: "investigation_scene_1",
      title: "Provenance",
      intro: [],
      sublocations: [],
      evidenceManifest: [
        {
          id: "neutral_record",
          name: "Neutral",
          description: "Neutral.",
          details: "Neutral details.",
          imageCue: { imagePrompt: null, imageAssetId: null },
          sourceSublocationId: null,
          onCollect: [],
          onReexamine: null,
          sourceFile: "chapter_1/investigation_scene_1.md",
          line: 10,
        },
        {
          id: "grouped_record",
          name: "Grouped",
          description: "Grouped.",
          details: "Grouped details.",
          imageCue: { imagePrompt: null, imageAssetId: null },
          sourceSublocationId: null,
          provenance: {
            sourceKind: null,
            representationLayer: null,
            proceduralStatus: null,
            completeness: null,
            confidence: null,
            sourceGroupId: {
              value: "shared_source",
              sourceFile: "chapter_1/investigation_scene_1.md",
              line: 21,
            },
            sourceLabel: null,
            proofCapabilities: [],
            supersedes: null,
          },
          onCollect: [],
          onReexamine: null,
          sourceFile: "chapter_1/investigation_scene_1.md",
          line: 20,
        },
      ],
      statementManifest: [
        {
          id: "old_account",
          speaker: "Witness",
          content: "Earlier.",
          provenance: {
            sourceKind: null,
            representationLayer: null,
            proceduralStatus: {
              value: "lead",
              sourceFile: "chapter_1/investigation_scene_1.md",
              line: 31,
            },
            completeness: null,
            confidence: null,
            sourceGroupId: null,
            sourceLabel: null,
            proofCapabilities: [],
            supersedes: null,
          },
          onAcquire: [],
          onReexamine: null,
          sourceFile: "chapter_1/investigation_scene_1.md",
          line: 30,
        },
        {
          id: "full_account",
          speaker: "Witness",
          content: "Complete.",
          provenance: {
            sourceKind: {
              value: "testimony",
              sourceFile: "chapter_1/investigation_scene_1.md",
              line: 41,
            },
            representationLayer: {
              value: "summary",
              sourceFile: "chapter_1/investigation_scene_1.md",
              line: 42,
            },
            proceduralStatus: {
              value: "reacquired",
              sourceFile: "chapter_1/investigation_scene_1.md",
              line: 43,
            },
            completeness: {
              value: "partial",
              sourceFile: "chapter_1/investigation_scene_1.md",
              line: 44,
            },
            confidence: {
              value: "corroborated",
              sourceFile: "chapter_1/investigation_scene_1.md",
              line: 45,
            },
            sourceGroupId: {
              value: "shared_source",
              sourceFile: "chapter_1/investigation_scene_1.md",
              line: 46,
            },
            sourceLabel: {
              value: "Witness summary",
              sourceFile: "chapter_1/investigation_scene_1.md",
              line: 47,
            },
            proofCapabilities: [
              {
                value: "causation",
                sourceFile: "chapter_1/investigation_scene_1.md",
                line: 48,
              },
              {
                value: "procedure",
                sourceFile: "chapter_1/investigation_scene_1.md",
                line: 48,
              },
              {
                value: "credibility",
                sourceFile: "chapter_1/investigation_scene_1.md",
                line: 48,
              },
              {
                value: "source",
                sourceFile: "chapter_1/investigation_scene_1.md",
                line: 48,
              },
              {
                value: "motive",
                sourceFile: "chapter_1/investigation_scene_1.md",
                line: 48,
              },
              {
                value: "access",
                sourceFile: "chapter_1/investigation_scene_1.md",
                line: 48,
              },
              {
                value: "time",
                sourceFile: "chapter_1/investigation_scene_1.md",
                line: 48,
              },
              {
                value: "identity",
                sourceFile: "chapter_1/investigation_scene_1.md",
                line: 48,
              },
              {
                value: "route",
                sourceFile: "chapter_1/investigation_scene_1.md",
                line: 48,
              },
              {
                value: "order",
                sourceFile: "chapter_1/investigation_scene_1.md",
                line: 48,
              },
            ],
            supersedes: {
              kind: "statement",
              id: "old_account",
              sourceFile: "chapter_1/investigation_scene_1.md",
              line: 49,
            },
          },
          onAcquire: [],
          onReexamine: null,
          sourceFile: "chapter_1/investigation_scene_1.md",
          line: 40,
        },
      ],
      outro: { unlock: "auto", dialogue: [] },
      assetRefs: [],
      sourceFile: "chapter_1/investigation_scene_1.md",
      line: 1,
    };
    const scene: SceneRecord = {
      chapterId: "chapter_1",
      file: "investigation_scene_1.md",
      ast,
    };
    const catalog = emptyStoryCatalog("story_catalog.md");
    catalog.sourceGroups = [
      {
        id: "shared_source",
        label: "Shared source",
        summary: "One underlying source.",
        sourceFile: "story_catalog.md",
        line: 8,
      },
    ];
    const corpus = compileCorpus(catalog, [scene]);

    const emittedScene = emitInvestigationScene(ast, corpus);
    const emittedCatalog = emitStoryCatalog(catalog, corpus);
    for (const sceneRecord of [
      ...emittedScene.evidenceManifest.map((record) => ({
        kind: "evidence" as const,
        record,
      })),
      ...emittedScene.statementManifest.map((record) => ({
        kind: "statement" as const,
        record,
      })),
    ]) {
      const catalogRecord =
        sceneRecord.kind === "evidence"
          ? emittedCatalog.evidenceIndex.find(
              ({ id }) => id === sceneRecord.record.id,
            )
          : emittedCatalog.statementsIndex.find(
              ({ id }) => id === sceneRecord.record.id,
            );
      assert.deepStrictEqual(
        sceneRecord.record.provenance,
        catalogRecord?.provenance,
      );
    }

    expect(emittedCatalog).toEqual({
      schemaVersion: 2,
      facts: [],
      questions: [],
      objectives: [],
      authorizations: [],
      sourceGroups: [
        {
          id: "shared_source",
          label: "Shared source",
          summary: "One underlying source.",
          members: [
            { kind: "evidence", id: "grouped_record" },
            { kind: "statement", id: "full_account" },
          ],
        },
      ],
      evidenceIndex: [
        {
          id: "grouped_record",
          chapterId: "chapter_1",
          sceneId: "investigation_scene_1",
          provenance: {
            sourceKind: "unspecified",
            representationLayer: "none",
            proceduralStatus: "unspecified",
            completeness: "unspecified",
            confidence: "unspecified",
            sourceGroupId: "shared_source",
            sourceLabel: null,
            proofCapabilities: [],
            supersedesRecordId: null,
          },
        },
        {
          id: "neutral_record",
          chapterId: "chapter_1",
          sceneId: "investigation_scene_1",
          provenance: {
            sourceKind: "unspecified",
            representationLayer: "none",
            proceduralStatus: "unspecified",
            completeness: "unspecified",
            confidence: "unspecified",
            sourceGroupId: null,
            sourceLabel: null,
            proofCapabilities: [],
            supersedesRecordId: null,
          },
        },
      ],
      statementsIndex: [
        {
          id: "full_account",
          chapterId: "chapter_1",
          sceneId: "investigation_scene_1",
          provenance: {
            sourceKind: "testimony",
            representationLayer: "summary",
            proceduralStatus: "reacquired",
            completeness: "partial",
            confidence: "corroborated",
            sourceGroupId: "shared_source",
            sourceLabel: "Witness summary",
            proofCapabilities: [
              "time",
              "order",
              "route",
              "identity",
              "access",
              "motive",
              "source",
              "credibility",
              "procedure",
              "causation",
            ],
            supersedesRecordId: "statement:old_account",
          },
        },
        {
          id: "old_account",
          chapterId: "chapter_1",
          sceneId: "investigation_scene_1",
          provenance: {
            sourceKind: "unspecified",
            representationLayer: "none",
            proceduralStatus: "lead",
            completeness: "unspecified",
            confidence: "unspecified",
            sourceGroupId: null,
            sourceLabel: null,
            proofCapabilities: [],
            supersedesRecordId: null,
          },
        },
      ],
    });
  });

  it.each(["missing", "mis-originated"] as const)(
    "reports caseRecordEmissionMismatch for a %s compiled record",
    (failure) => {
      const ast: ASTInvestigationScene = {
        kind: "investigationScene",
        id: "investigation_scene_1",
        title: "Mismatch",
        intro: [],
        sublocations: [],
        evidenceManifest: [
          {
            id: "record",
            name: "Record",
            description: "Record.",
            details: "Details.",
            imageCue: { imagePrompt: null, imageAssetId: null },
            sourceSublocationId: null,
            onCollect: [],
            onReexamine: null,
            sourceFile: "chapter_1/investigation_scene_1.md",
            line: 12,
          },
        ],
        statementManifest: [],
        outro: { unlock: "auto", dialogue: [] },
        assetRefs: [],
        sourceFile: "chapter_1/investigation_scene_1.md",
        line: 1,
      };
      const corpus =
        failure === "missing"
          ? compileCorpus(emptyStoryCatalog("story_catalog.md"), [])
          : corpusForScene(ast);
      if (failure === "mis-originated") {
        const record = corpus.recordsByKey.get("evidence:record");
        if (!record) throw new Error("expected compiled fixture record");
        record.sceneId = "investigation_scene_other";
      }

      try {
        emitInvestigationScene(ast, corpus);
        throw new Error("expected emission to fail");
      } catch (error) {
        expect(error).toMatchObject({
          code: "caseRecordEmissionMismatch",
          sourceFile: "chapter_1/investigation_scene_1.md",
          line: 12,
        });
      }
    },
  );

  it("emits a linear scene JSON", () => {
    const ast: ASTLinearScene = {
      kind: "linearScene",
      id: "scene_0",
      title: "接案",
      queue: [
        { kind: "sceneTag", text: "街道" },
        { kind: "line", speaker: "A", text: "hi" },
        {
          kind: "line",
          speaker: "B",
          text: "worried",
          expression: "concerned",
        },
      ],
      assetRefs: [{ type: "background", assetId: "bg_street" }],
      sourceFile: "scene_0.md",
      line: 1,
    };
    const json = emitLinearScene(ast);
    expect(json).toEqual({
      type: "linear",
      id: "scene_0",
      title: "接案",
      queue: [
        { kind: "sceneTag", text: "街道", assetCue: null },
        {
          kind: "line",
          speaker: "A",
          text: "hi",
          portrait: null,
        },
        {
          kind: "line",
          speaker: "B",
          text: "worried",
          portrait: null,
        },
      ],
      assetRefs: [{ type: "background", assetId: "bg_street" }],
    });
  });

  it("omits the legacy line expression while preserving portrait.expression", () => {
    const ast: ASTLinearScene = {
      kind: "linearScene",
      id: "scene_portrait",
      title: "Portrait",
      queue: [
        {
          kind: "line",
          speaker: "A",
          text: "hi",
          expression: "concerned",
          portrait: {
            characterId: "a",
            expression: "concerned",
            assetId: "portrait.a.concerned",
          },
        },
      ],
      assetRefs: [],
      sourceFile: "scene_portrait.md",
      line: 1,
    };

    expect(emitLinearScene(ast).queue[0]).toEqual({
      kind: "line",
      speaker: "A",
      text: "hi",
      portrait: {
        characterId: "a",
        expression: "concerned",
        assetId: "portrait.a.concerned",
      },
    });
  });

  it("emits an investigation scene JSON with auto outro preserved", () => {
    const ast: ASTInvestigationScene = {
      kind: "investigationScene",
      id: "i",
      title: "t",
      intro: [],
      sublocations: [
        {
          id: "room",
          label: "Room",
          status: "unlocked",
          unlock: null,
          reveals: [],
          sceneTag: "a room",
          assetCue: {
            backgroundPrompt: "rainy room",
            backgroundAssetId: "bg_room",
            bgm: { channel: "bgm", assetId: "music_room" },
            bgs: { channel: "bgs", assetId: null },
          },
          transitionDialogue: [],
          hotspots: [
            {
              id: "table",
              label: "Table",
              description: "A rain-wet table.",
              status: "unlocked",
              unlock: null,
              reveals: [],
              evidenceSource: null,
              sceneSourcePrompt: null,
              inspectDialogue: [],
              onReexamine: null,
              layout: {
                kind: "rect",
                x: 0.18,
                y: 0.52,
                w: 0.16,
                h: 0.12,
              },
              sourceFile: "i.md",
              line: 5,
            },
          ],
          characters: [
            {
              id: "witness",
              name: "Witness",
              role: "Witness",
              bio: "Waiting.",
              topics: [],
              layout: {
                kind: "sprite",
                assetId: "portrait.witness.standard",
                x: 0.72,
                y: 0.18,
                w: 0.16,
                h: 0.72,
                anchor: "bottomCenter",
              },
              sourceFile: "i.md",
              line: 20,
            },
          ],
          sourceFile: "i.md",
          line: 4,
        },
      ],
      evidenceManifest: [
        {
          id: "photo",
          name: "Photo",
          description: "A photo.",
          details: "Photo details.",
          imageCue: {
            imagePrompt: "wet photo",
            imageAssetId: "evidence_photo",
          },
          sourceSublocationId: "room",
          onCollect: [],
          onReexamine: null,
          sourceFile: "i.md",
          line: 12,
        },
      ],
      statementManifest: [],
      outro: { unlock: "auto", dialogue: [] },
      assetRefs: [{ type: "evidence", assetId: "evidence_photo" }],
      sourceFile: "i.md",
      line: 1,
    };
    const json = emitInvestigationScene(ast, corpusForScene(ast));
    expect(json.outro.unlock).toBe("auto");
    expect(json.type).toBe("investigation");
    expect(json.assetRefs).toEqual([
      { type: "evidence", assetId: "evidence_photo" },
    ]);
    expect(json.sublocations[0]?.backgroundAssetId).toBe("bg_room");
    expect(json.sublocations[0]?.bgm).toEqual({
      channel: "bgm",
      assetId: "music_room",
    });
    expect(json.sublocations[0]?.bgs).toEqual({
      channel: "bgs",
      assetId: null,
    });
    expect(json.sublocations[0]?.hotspots[0]?.layout).toEqual({
      kind: "rect",
      x: 0.18,
      y: 0.52,
      w: 0.16,
      h: 0.12,
    });
    expect(json.sublocations[0]?.hotspots[0]?.evidenceSource).toBeNull();
    expect(json.sublocations[0]?.hotspots[0]?.sceneSourcePrompt).toBeNull();
    expect(json.sublocations[0]?.characters[0]?.layout).toEqual({
      kind: "sprite",
      assetId: "portrait.witness.standard",
      x: 0.72,
      y: 0.18,
      w: 0.16,
      h: 0.72,
      anchor: "bottomCenter",
    });
    expect(json.evidenceManifest[0]?.imageAssetId).toBe("evidence_photo");
    expect(json.evidenceManifest[0]?.sourceSublocationId).toBe("room");
  });

  it("emits interrogation scene JSON", () => {
    const ast: ASTInterrogationScene = {
      kind: "interrogationScene",
      id: "interrogation_scene_1",
      title: "詢問",
      intro: [],
      phases: [
        {
          kind: "inquiry",
          id: "p",
          label: "問話",
          subject: {
            id: "suspect",
            name: "嫌疑人",
            role: "嫌疑人",
            bio: "沉默。",
            sourceFile: "x",
            line: 4,
          },
          required: true,
          status: "unlocked",
          unlock: null,
          reveals: [],
          sceneTag: "詢問室",
          assetCue: {
            backgroundPrompt: null,
            backgroundAssetId: "bg_interrogation_room",
            bgm: null,
            bgs: { channel: "bgs", assetId: "rain_loop" },
          },
          entryDialogue: [],
          complete: "auto",
          questions: [],
          sourceFile: "x",
          line: 2,
        },
      ],
      evidenceManifest: [
        {
          id: "recording",
          name: "錄音",
          description: "走廊錄音。",
          details: "有雨聲。",
          imageCue: {
            imagePrompt: null,
            imageAssetId: "evidence_recording",
          },
          sourceSublocationId: null,
          onCollect: [],
          onReexamine: null,
          sourceFile: "x",
          line: 8,
        },
      ],
      statementManifest: [],
      outro: { unlock: "auto", dialogue: [] },
      assetRefs: [{ type: "audio", assetId: "rain_loop" }],
      sourceFile: "x",
      line: 1,
    };
    expect(emitInterrogationScene(ast, corpusForScene(ast))).toMatchObject({
      type: "interrogation",
      id: "interrogation_scene_1",
      assetRefs: [{ type: "audio", assetId: "rain_loop" }],
      phases: [
        {
          kind: "inquiry",
          id: "p",
          subject: { id: "suspect" },
          backgroundAssetId: "bg_interrogation_room",
          bgm: null,
          bgs: { channel: "bgs", assetId: "rain_loop" },
        },
      ],
      evidenceManifest: [
        {
          id: "recording",
          imageAssetId: "evidence_recording",
        },
      ],
    });
  });

  it("emits interrogation testimony lines with contradiction + reveals", () => {
    const json = emitInterrogationFixture();
    const phase = json.phases[0]!;
    expect(phase.kind).toBe("inquiry");
    const deny = phase.questions[0]!.testimony.lines[1]!;
    expect(deny.contradiction).toEqual({
      kind: "evidence",
      id: "cleaning_log",
    });
    expect(deny.onCorrect?.length).toBeGreaterThan(0);
    expect(deny.reveals).toContainEqual({
      kind: "question",
      id: "cleaning_time",
    });
    expect(phase.questions[0]!.testimony.onLoop.length).toBeGreaterThan(0);
  });

  it("emits a chapters index", () => {
    const chapter: ASTChapter = {
      kind: "chapter",
      dirName: "chapter_1",
      number: 1,
      title: "t",
      summary: "s",
      sceneFiles: [
        "scene_0.md",
        "investigation_scene_1.md",
        "interrogation_scene_2.md",
      ],
      sourceFile: "chapter_1/chapter.md",
      line: 1,
    };
    const idx: JSONChaptersIndex = emitChaptersIndex([chapter]);
    expect(idx).toEqual({
      chapters: [
        {
          id: "chapter_1",
          title: "t",
          summary: "s",
          scenes: [
            { type: "linear", file: "chapter_1/scene_0.json" },
            {
              type: "investigation",
              file: "chapter_1/investigation_scene_1.json",
            },
            {
              type: "interrogation",
              file: "chapter_1/interrogation_scene_2.json",
            },
          ],
        },
      ],
    });
  });
});

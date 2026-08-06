import { describe, expect, it } from "vitest";
import { createAnalysisDefinitionRegistryFromScenes } from "./analysis-definition-registry";
import { parseAnalysisScene } from "./parser-analysis";
import { emptyStoryCatalog } from "./parser-story-catalog";
import {
  validateAnalysisScenes,
  type AnalysisSceneRecord,
} from "./validator-analysis";
import type {
  ASTAnalysisScene,
  ASTStoryCatalog,
  CaseRecordProvenance,
  CompiledCaseRecord,
  CompiledCaseRecordCorpus,
  InventoryTarget,
} from "./types";

const NEUTRAL_PROVENANCE: CaseRecordProvenance = {
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

function parse(source: string, id = "analysis_scene_1"): ASTAnalysisScene {
  const result = parseAnalysisScene(source, `chapter_1/${id}.md`, id);
  if (!result.ok) {
    throw new Error(`${result.error.code}: ${result.error.message}`);
  }
  return result.value;
}

function catalog(): ASTStoryCatalog {
  const value = emptyStoryCatalog("story_catalog.md");
  value.facts.push({
    id: "fact_a",
    label: "Fact A",
    summary: "A fact.",
    details: "Fact details.",
    category: "test",
    sourceFile: "story_catalog.md",
    line: 3,
  });
  value.authorizations.push({
    id: "archive_access",
    label: "Archive access",
    summary: "Test authorization.",
    grantingAuthority: "Inspector",
    sourceFile: "story_catalog.md",
    line: 9,
  });
  return value;
}

function targetKey(target: InventoryTarget): string {
  return `${target.kind}:${target.id}`;
}

function record(
  id: string,
  provenance: Partial<CaseRecordProvenance> = {},
): CompiledCaseRecord {
  return {
    target: { kind: "evidence", id },
    chapterId: "chapter_1",
    sceneId: "investigation_scene_1",
    provenance: { ...NEUTRAL_PROVENANCE, ...provenance },
    sourceFile: "chapter_1/investigation_scene_1.md",
    line: 20,
  };
}

function corpus(records: CompiledCaseRecord[]): CompiledCaseRecordCorpus {
  return {
    recordsByKey: new Map(
      records.map((entry) => [targetKey(entry.target), entry]),
    ),
    evidenceIndex: [],
    statementsIndex: [],
    sourceGroups: [],
    warnings: [],
  };
}

function recordsFor(...ids: string[]): CompiledCaseRecordCorpus {
  return corpus(ids.map((id) => record(id)));
}

function asRecords(scenes: ASTAnalysisScene[]): AnalysisSceneRecord[] {
  return scenes.map((ast) => ({
    chapterId: "chapter_1",
    file: `${ast.id}.md`,
    ast,
  }));
}

function validate(
  scenes: ASTAnalysisScene[],
  caseRecords: CompiledCaseRecordCorpus,
  storyCatalog = catalog(),
) {
  const parsedScenes = asRecords(scenes);
  return validateAnalysisScenes({
    scenes: parsedScenes,
    catalog: storyCatalog,
    caseRecords,
    analysisRegistry: createAnalysisDefinitionRegistryFromScenes(parsedScenes),
  });
}

function classifySource(
  options: {
    boardId?: string;
    cards?: string[];
    groups?: string[];
    reveals?: string;
    unlock?: string | null;
    resultDialogue?: string;
  } = {},
): string {
  const cards = options.cards ?? ["card_a", "card_b"];
  const groups = options.groups ?? ["card_a", "card_b"];
  const boardId = options.boardId ?? "classify_board";
  const unlock = options.unlock === undefined ? null : options.unlock;
  return [
    "# Scene 1: 分類",
    "- **Summary:** 整理證據。",
    "## Intro",
    "**相馬律**：開始吧。",
    `## Board: 分類 {#${boardId}}`,
    "- **Kind:** classify",
    "- **Prompt:** 將卡片分組。",
    ...(unlock === null ? [] : [`- **Unlock:** ${unlock}`]),
    `- **Reveals:** ${options.reveals ?? "[assert_fact:fact_a]"}`,
    "- **Incomplete Feedback:** 尚未完成。",
    "- **Incorrect Feedback:** 不正確。",
    ...cards.flatMap((id) => [
      `### Card: ${id} {#${id}}`,
      `- **Source:** evidence:${id}`,
      `- **Summary:** ${id} 摘要。`,
    ]),
    ...groups.flatMap((accepted, index) => [
      `### Group: 群組 ${index + 1} {#group_${index + 1}}`,
      `- **Description:** 群組 ${index + 1} 的說明。`,
      `- **Accepted Cards:** [${accepted}]`,
    ]),
    "### Result Dialogue",
    options.resultDialogue ?? "**相馬律**：完成。",
    "## Outro",
    "**相馬律**：下一步。",
  ].join("\n");
}

function orderSource(
  options: {
    acceptedOrder?: string;
    anchors?: string;
  } = {},
): string {
  return [
    "# Scene 1: 排序",
    "- **Summary:** 整理順序。",
    "## Intro",
    "**相馬律**：開始吧。",
    "## Board: 順序 {#order_board}",
    "- **Kind:** order",
    "- **Prompt:** 排好順序。",
    "- **Reveals:** [assert_fact:fact_a]",
    "- **Incomplete Feedback:** 尚未完成。",
    "- **Incorrect Feedback:** 不正確。",
    `- **Accepted Order:** ${options.acceptedOrder ?? "[card_a, card_b]"}`,
    `- **Fixed Anchors:** ${options.anchors ?? "[card_a@1]"}`,
    "### Card: A {#card_a}",
    "- **Source:** evidence:card_a",
    "- **Summary:** A 摘要。",
    "### Card: B {#card_b}",
    "- **Source:** evidence:card_b",
    "- **Summary:** B 摘要。",
    "### Result Dialogue",
    "**相馬律**：完成。",
    "## Outro",
    "**相馬律**：下一步。",
  ].join("\n");
}

function thresholdSource(
  options: {
    cards?: string[];
    eligible?: string;
    minimumSelected?: number;
    minimumDistinctGroups?: number;
    requiredProofCapabilities?: string;
    allowedStatuses?: string;
    requireSourceGroup?: boolean;
  } = {},
): string {
  const cards = options.cards ?? ["card_a", "card_b"];
  return [
    "# Scene 1: 閾值",
    "- **Summary:** 選擇材料。",
    "## Intro",
    "**相馬律**：開始吧。",
    "## Board: 閾值 {#threshold_board}",
    "- **Kind:** threshold",
    "- **Prompt:** 選出材料。",
    "- **Reveals:** [assert_fact:fact_a]",
    "- **Incomplete Feedback:** 尚未完成。",
    "- **Incorrect Feedback:** 不正確。",
    `- **Eligible Cards:** ${options.eligible ?? `[${cards.join(", ")}]`}`,
    `- **Minimum Selected:** ${options.minimumSelected ?? 1}`,
    `- **Minimum Distinct Source Groups:** ${options.minimumDistinctGroups ?? 0}`,
    `- **Required Proof Capabilities:** ${options.requiredProofCapabilities ?? "[]"}`,
    `- **Allowed Procedural Statuses:** ${options.allowedStatuses ?? "[exhibit]"}`,
    `- **Require Source Group:** ${options.requireSourceGroup ?? false}`,
    ...cards.flatMap((id) => [
      `### Card: ${id} {#${id}}`,
      `- **Source:** evidence:${id}`,
      `- **Summary:** ${id} 摘要。`,
    ]),
    "### Result Dialogue",
    "**相馬律**：完成。",
    "## Outro",
    "**相馬律**：下一步。",
  ].join("\n");
}

describe("analysis semantic validation", () => {
  it("normalizes hidden classify answers without leaking the authored group lists", () => {
    // Break caught: Task 5 could otherwise need to re-interpret authored
    // solution lists, or public board output could expose them directly.
    const scene = parse(
      classifySource({
        cards: ["card_b", "card_a"],
        groups: ["card_a", "card_b"],
      }),
    );
    const result = validate(
      scene ? [scene] : [],
      recordsFor("card_a", "card_b"),
    );

    expect(result).toMatchObject({
      ok: true,
      value: [
        {
          chapterId: "chapter_1",
          sceneId: "analysis_scene_1",
          boards: [
            {
              kind: "classify",
              common: {
                id: "classify_board",
              },
              acceptedGroupByCard: {
                card_a: "group_1",
                card_b: "group_2",
              },
              groups: [
                { id: "group_1", label: "群組 1" },
                { id: "group_2", label: "群組 2" },
              ],
            },
          ],
        },
      ],
    });
    if (!result.ok) return;
    expect(result.value[0]?.boards[0]).not.toHaveProperty(
      "groups.0.acceptedCards",
    );
  });

  it.each([
    {
      name: "analysis_duplicate_ids",
      arrange: (scene: ASTAnalysisScene) => {
        const board = scene.boards[0]!;
        scene.boards.push({ ...board, line: 30 });
        board.cards.push({ ...board.cards[0]!, line: 31 });
        if (board.kind === "classify") {
          board.groups.push({ ...board.groups[0]!, line: 32 });
        }
      },
      expectedCode: "analysisDuplicateBoardId",
    },
    {
      name: "analysis_missing_card",
      arrange: (scene: ASTAnalysisScene) => {
        scene.boards[0]!.cards = [];
      },
      expectedCode: "analysisBoardNoCards",
    },
  ])("rejects $name", ({ arrange, expectedCode }) => {
    const scene = parse(classifySource());
    arrange(scene);
    const result = validate([scene], recordsFor("card_a", "card_b"));

    expect(result).toMatchObject({ ok: false });
    if (result.ok) return;
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        code: expectedCode,
        sourceFile: scene.sourceFile,
      }),
    );
    if (expectedCode === "analysisDuplicateBoardId") {
      expect(result.errors).toContainEqual(
        expect.objectContaining({ code: "analysisDuplicateCardId" }),
      );
      expect(result.errors).toContainEqual(
        expect.objectContaining({ code: "analysisDuplicateGroupId" }),
      );
    }
  });

  it("reports analysis_unresolved_reference at the authored card source", () => {
    const scene = parse(classifySource());
    const result = validate([scene], recordsFor("card_b"));

    expect(result).toMatchObject({ ok: false });
    if (result.ok) return;
    expect(result.errors).toContainEqual({
      code: "analysisCardSourceUnresolved",
      sourceFile: "chapter_1/analysis_scene_1.md",
      line: 12,
      message: expect.stringContaining("evidence:card_a"),
    });
  });

  it("validates authored board story reveals through the catalog resolver", () => {
    const scene = parse(
      classifySource({ reveals: "[assert_fact:missing_fact]" }),
    );
    const result = validate([scene], recordsFor("card_a", "card_b"));

    expect(result).toMatchObject({ ok: false });
    if (result.ok) return;
    expect(result.errors).toContainEqual({
      code: "storyRevealUnresolved",
      sourceFile: "chapter_1/analysis_scene_1.md",
      line: 8,
      message: expect.stringContaining('unknown fact "missing_fact"'),
    });
  });

  it("validates board unlock references against the parsed-scene registry", () => {
    const scene = parse(
      classifySource({
        unlock:
          "analysis_board:chapter_1@missing_scene@missing_board completed",
      }),
    );
    const result = validate([scene], recordsFor("card_a", "card_b"));

    expect(result).toMatchObject({ ok: false });
    if (result.ok) return;
    expect(result.errors).toContainEqual({
      code: "unresolvedAnalysisPredicate",
      sourceFile: "chapter_1/analysis_scene_1.md",
      line: 8,
      message: expect.stringContaining("chapter_1@missing_scene@missing_board"),
    });
  });

  it("rejects analysis_classify_incomplete when a displayed card has no accepted group", () => {
    const scene = parse(classifySource({ groups: ["card_a"] }));
    const result = validate([scene], recordsFor("card_a", "card_b"));

    expect(result).toMatchObject({ ok: false });
    if (result.ok) return;
    expect(result.errors).toContainEqual(
      expect.objectContaining({ code: "analysisClassifyCardUnassigned" }),
    );
  });

  it("rejects analysis_order_incomplete when accepted order omits a displayed card", () => {
    const scene = parse(orderSource({ acceptedOrder: "[card_a]" }));
    const result = validate([scene], recordsFor("card_a", "card_b"));

    expect(result).toMatchObject({ ok: false });
    if (result.ok) return;
    expect(result.errors).toContainEqual(
      expect.objectContaining({ code: "analysisOrderCardMissing" }),
    );
  });

  it("rejects malformed and contradictory fixed anchors", () => {
    const scene = parse(orderSource());
    const board = scene.boards[0];
    if (!board || board.kind !== "order")
      throw new Error("expected order board");
    board.fixedAnchors = [
      {
        cardId: "card_a",
        position: 0,
        sourceFile: scene.sourceFile,
        line: 12,
      },
      {
        cardId: "card_a",
        position: 2,
        sourceFile: scene.sourceFile,
        line: 12,
      },
    ];
    const result = validate([scene], recordsFor("card_a", "card_b"));

    expect(result).toMatchObject({ ok: false });
    if (result.ok) return;
    expect(result.errors).toContainEqual(
      expect.objectContaining({ code: "analysisOrderAnchorPositionInvalid" }),
    );
    expect(result.errors).toContainEqual(
      expect.objectContaining({ code: "analysisOrderAnchorCardDuplicate" }),
    );
    expect(result.errors).toContainEqual(
      expect.objectContaining({ code: "analysisOrderAnchorContradictsOrder" }),
    );
  });

  it("rejects threshold eligible IDs that are not displayed", () => {
    const scene = parse(
      thresholdSource({ eligible: "[card_a, missing_card]" }),
    );
    const result = validate([scene], recordsFor("card_a", "card_b"));

    expect(result).toMatchObject({ ok: false });
    if (result.ok) return;
    expect(result.errors).toContainEqual(
      expect.objectContaining({ code: "analysisThresholdEligibleCardUnknown" }),
    );
  });

  it("does not misreport a displayed eligible card as unknown when only its source is unresolved", () => {
    // Break caught: solution validation must use the authored display set,
    // not the subset whose case-record provenance happened to resolve.
    const scene = parse(thresholdSource());
    const result = validate([scene], recordsFor("card_b"));

    expect(result).toMatchObject({ ok: false });
    if (result.ok) return;
    expect(result.errors).toContainEqual(
      expect.objectContaining({ code: "analysisCardSourceUnresolved" }),
    );
    expect(result.errors).not.toContainEqual(
      expect.objectContaining({ code: "analysisThresholdEligibleCardUnknown" }),
    );
  });

  it("rejects more than the threshold materialization budget", () => {
    const cards = Array.from({ length: 7 }, (_, index) => `card_${index + 1}`);
    const scene = parse(thresholdSource({ cards }));
    const result = validate([scene], recordsFor(...cards));

    expect(result).toMatchObject({ ok: false });
    if (result.ok) return;
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        code: "analysisThresholdEligibleCardBudgetExceeded",
      }),
    );
  });

  it("rejects analysis_threshold_missing_provenance when no eligible record has an allowed status", () => {
    const scene = parse(thresholdSource());
    const result = validate([scene], recordsFor("card_a", "card_b"));

    expect(result).toMatchObject({ ok: false });
    if (result.ok) return;
    expect(result.errors).toContainEqual(
      expect.objectContaining({ code: "analysisThresholdUnsatisfiable" }),
    );
  });

  it("rejects analysis_threshold_unsatisfiable after provenance and proof coverage evaluation", () => {
    const scene = parse(
      thresholdSource({
        minimumSelected: 2,
        minimumDistinctGroups: 2,
        requiredProofCapabilities: "[time, procedure]",
        requireSourceGroup: true,
      }),
    );
    const result = validate(
      [scene],
      corpus([
        record("card_a", {
          proceduralStatus: "exhibit",
          sourceGroupId: "source_a",
          proofCapabilities: ["time"],
        }),
        record("card_b", {
          proceduralStatus: "exhibit",
          sourceGroupId: "source_a",
          proofCapabilities: ["procedure"],
        }),
      ]),
    );

    expect(result).toMatchObject({ ok: false });
    if (result.ok) return;
    expect(result.errors).toContainEqual(
      expect.objectContaining({ code: "analysisThresholdUnsatisfiable" }),
    );
  });

  it("materializes deterministic accepted threshold selections", () => {
    const cards = ["card_c", "card_a", "card_b"];
    const scene = parse(
      thresholdSource({ cards, allowedStatuses: "[exhibit]" }),
    );
    const result = validate(
      [scene],
      corpus(cards.map((id) => record(id, { proceduralStatus: "exhibit" }))),
    );

    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    const board = result.value[0]?.boards[0];
    if (!board || board.kind !== "threshold")
      throw new Error("expected threshold board");
    expect(board.acceptedSelections).toEqual([
      ["card_a"],
      ["card_a", "card_b"],
      ["card_a", "card_b", "card_c"],
      ["card_a", "card_c"],
      ["card_b"],
      ["card_b", "card_c"],
      ["card_c"],
    ]);
  });

  it("rejects grant_authorization analysis outputs even when the catalog defines it", () => {
    const scene = parse(
      classifySource({ reveals: "[grant_authorization:archive_access]" }),
    );
    const result = validate([scene], recordsFor("card_a", "card_b"));

    expect(result).toMatchObject({ ok: false });
    if (result.ok) return;
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        code: "analysisBoardGrantAuthorizationForbidden",
      }),
    );
  });

  it("reports an unknown grant_authorization target alongside the forbidden output", () => {
    // Break caught: filtering forbidden grants before catalog validation hid
    // misspelled authorization IDs from authors.
    const scene = parse(
      classifySource({ reveals: "[grant_authorization:missing_access]" }),
    );
    const result = validate([scene], recordsFor("card_a", "card_b"));

    expect(result).toMatchObject({ ok: false });
    if (result.ok) return;
    expect(result.errors).toContainEqual({
      code: "analysisBoardGrantAuthorizationForbidden",
      sourceFile: "chapter_1/analysis_scene_1.md",
      line: 8,
      message: expect.stringContaining('"missing_access"'),
    });
    expect(result.errors).toContainEqual({
      code: "storyRevealUnresolved",
      sourceFile: "chapter_1/analysis_scene_1.md",
      line: 8,
      message: expect.stringContaining(
        'unknown authorization "missing_access"',
      ),
    });
  });
});

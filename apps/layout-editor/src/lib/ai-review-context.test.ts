import { describe, expect, it } from "vitest";
import type { AssetManifestEntry } from "@lyra/scripts/compile-scenes/assets/manifest";
import {
  allowedLensesForSelection,
  buildAiReviewContext,
  chapterPlanTargetForScene,
  type AiReviewSelection,
} from "./ai-review-context";
import { headingSectionText, projectPlanWorkspace } from "./plan-workspace";
import type { AssetSceneUsage } from "./asset-workspace";
import type {
  ReaderScene,
  WorkbenchPlanWorkspacePayload,
  WorkbenchScenePayload,
} from "./workbench-types";

const BIBLE_PATH = "docs/stories_plan/final_story_bible.md";
const PLAN_PATH = "docs/stories_plan/chapter_1_plan.md";
const CHARACTERS_PATH = "docs/stories_plan/characters.md";

function table(headers: string[], rows: string[][]): string {
  return [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.join(" | ")} |`),
  ].join("\n");
}

const BIBLE_CONTENT = [
  "# 10. 章節總覽",
  "",
  table(
    ["章節", "標題", "案件類型", "變體", "主線誤導"],
    [
      ["1", "雨鐘咖啡館殺人事件", "密室", "變體", "誤導"],
      ["2", "t2", "密室", "變體", "誤導"],
      ["3", "t3", "密室", "變體", "誤導"],
      ["4", "t4", "密室", "變體", "誤導"],
      ["5", "歌舞伎町連續假面審判", "密室", "變體", "誤導"],
      ["6", "t6", "密室", "變體", "誤導"],
      ["7", "t7", "密室", "變體", "誤導"],
      ["8", "t8", "密室", "變體", "誤導"],
    ],
  ),
  "",
  "## 第 1 章角色外貌與細節",
  "",
  "外貌decoy內容",
  "",
  "## 第 1 章：雨鐘咖啡館殺人事件",
  "",
  "第一章主案內容",
  "",
  "## 18.5 第一幕 reveal ladder",
  "",
  table(
    ["章節", "必須建立", "絕對不能建立"],
    [
      ["第 1 章", "火災名稱", "不說重演"],
      ["第 5～7 章", "中段接合", "不提前定案"],
    ],
  ),
  "",
].join("\n");

const CHAPTER_PLAN_CONTENT = [
  "# Chapter 1 Plan",
  "",
  "# Prologue 0：雨中的東京",
  "prologue0 內容",
  "",
  "# Prologue Block：誘惑性相似前綴",
  "block 內容",
  "",
  "# Prologue 1：零號小委託",
  "prologue1 內容",
  "",
  "# Prologue 2：雨鐘咖啡館的普通日",
  "prologue2 內容",
  "",
  "# Beat 2：委託與程序入口",
  "beat2 內容",
  "",
  "# Beat 8.5：短暫誤判整理點",
  "beat8.5 內容",
  "",
].join("\n");

const CHARACTERS_CONTENT = [
  "# 角色設定總表",
  "",
  "### 相馬律（主角）",
  "台詞風格：結論偏短。",
  "",
  "### 早坂茜（法律搭檔）",
  "其他聲音。",
  "",
].join("\n");

function payload(
  overrides: {
    bible?: string;
    plan?: string;
    characters?: string;
    chapterNumber?: number;
    chapterId?: string;
  } = {},
): WorkbenchPlanWorkspacePayload {
  return {
    documents: [
      {
        id: "story-bible",
        kind: "storyBible",
        path: BIBLE_PATH,
        content: overrides.bible ?? BIBLE_CONTENT,
        chapterNumber: null,
      },
      {
        id: `chapter-${overrides.chapterNumber ?? 1}-plan`,
        kind: "chapterPlan",
        path: PLAN_PATH,
        content: overrides.plan ?? CHAPTER_PLAN_CONTENT,
        chapterNumber: overrides.chapterNumber ?? 1,
      },
    ],
    storyCharactersMd: {
      path: CHARACTERS_PATH,
      content: overrides.characters ?? CHARACTERS_CONTENT,
    },
  };
}

const workspace = projectPlanWorkspace(payload());

function sceneFixture(sceneId: string): ReaderScene {
  return {
    id: sceneId,
    type: "linear",
    title: sceneId,
    sourcePath: `docs/stories_plan/chapter_1/${sceneId}.md`,
    groups: [],
    presentation: [],
  };
}

function sceneSelection(
  sceneId: string,
  chapterId = "chapter_1",
): AiReviewSelection {
  return {
    kind: "readerScene",
    chapterId,
    sceneId,
    scene: sceneFixture(sceneId),
  };
}

function readerItemSelection(
  overrides: Partial<Extract<AiReviewSelection, { kind: "readerItem" }>> = {},
): AiReviewSelection {
  return {
    kind: "readerItem",
    chapterId: "chapter_1",
    sceneId: "scene_2",
    scene: sceneFixture("scene_2"),
    group: {
      id: "intro",
      kind: "intro",
      label: "intro",
      flow: "main",
      sourceAnchor: null,
      items: [],
      children: [],
    },
    ref: { carrierId: "intro", itemIndex: 0 },
    item: {
      kind: "line",
      speaker: "相馬律",
      text: "相馬律：先不要急著判斷。",
      editable: { carrierId: "intro", itemIndex: 0 },
    },
    editSelection: {
      surface: "reader",
      chapterId: "chapter_1",
      sceneId: "scene_2",
      compiledScene: {} as unknown as WorkbenchScenePayload,
      carrierId: "intro",
      itemIndex: 0,
      item: {
        kind: "line",
        speaker: "相馬律",
        text: "相馬律：先不要急著判斷。",
      },
    },
    ...overrides,
  };
}

const backgroundEntry: AssetManifestEntry = {
  assetId: "background.chapter_1.scene_2.rain_street",
  type: "background",
  source: {
    chapterId: "chapter_1",
    sceneId: "scene_2",
    unitId: "unit1",
    promptLine: 12,
    authoredPrompt: "雨夜柏油路",
  },
  expectedPath: "static/assets/backgrounds/rain_street.png",
  publicPath: "assets/backgrounds/rain_street.png",
  promptParts: {
    globalStyle: "全域雨夜風格",
    typePrompt: "背景提示",
    subjectPrompt: "",
    entryPrompt: "雨夜柏油路",
  },
  finalPrompt: "全域雨夜風格\n\n背景提示\n\n雨夜柏油路",
};

const backgroundUsages: AssetSceneUsage[] = [
  {
    chapterId: "chapter_1",
    sceneId: "scene_2",
    sceneSourcePath: "docs/stories_plan/chapter_1/scene_2.md",
    carrierId: "structural:scene_2",
    carrierLabel: "scene_2",
    role: "background",
    itemIndex: null,
    assetId: backgroundEntry.assetId,
    type: "background",
  },
];

function assetPromptSelection(
  editSelection: Extract<
    AiReviewSelection,
    { kind: "assetPrompt" }
  >["editSelection"],
): AiReviewSelection {
  return {
    kind: "assetPrompt",
    assetId: backgroundEntry.assetId,
    entry: backgroundEntry,
    usages: backgroundUsages,
    editSelection,
  };
}

describe("chapterPlanTargetForScene", () => {
  it("parses the closed Beat/Prologue scene-id grammar", () => {
    expect(chapterPlanTargetForScene("scene_p0")).toEqual({
      prefix: "Prologue",
      label: "0",
    });
    expect(chapterPlanTargetForScene("investigation_scene_p1")).toEqual({
      prefix: "Prologue",
      label: "1",
    });
    expect(chapterPlanTargetForScene("scene_p2")).toEqual({
      prefix: "Prologue",
      label: "2",
    });
    expect(chapterPlanTargetForScene("scene_2")).toEqual({
      prefix: "Beat",
      label: "2",
    });
    expect(chapterPlanTargetForScene("analysis_scene_8_5")).toEqual({
      prefix: "Beat",
      label: "8.5",
    });
  });

  it("keeps unsupported scene ids missing", () => {
    expect(chapterPlanTargetForScene("analysis_scene_p1_5")).toBeNull();
    expect(chapterPlanTargetForScene("investigation_scene_map_01")).toBeNull();
  });
});

describe("buildAiReviewContext — chapter plan matching", () => {
  it("resolves each Prologue/Beat target to exactly one H1 section", () => {
    const cases: Array<[string, string]> = [
      ["scene_p0", "Prologue 0"],
      ["investigation_scene_p1", "Prologue 1"],
      ["scene_p2", "Prologue 2"],
      ["scene_2", "Beat 2"],
      ["analysis_scene_8_5", "Beat 8.5"],
    ];
    const planDocument = workspace.documents.find(
      (d) => d.kind === "chapterPlan",
    )!;
    for (const [sceneId, prefix] of cases) {
      const bundle = buildAiReviewContext(
        sceneSelection(sceneId),
        "storyConsistency",
        workspace,
      );
      const chip = bundle.context.find((item) => item.kind === "chapterPlan");
      expect(chip, sceneId).toBeDefined();
      const headings = planDocument.headings.filter(
        (heading) =>
          heading.level === 1 && heading.text.startsWith(`${prefix}：`),
      );
      expect(headings, sceneId).toHaveLength(1);
      expect(chip!.sourceRef).toBe(`${PLAN_PATH}#${headings[0]!.anchor}`);
      expect(chip!.content).toContain(headings[0]!.text);
      expect(bundle.missingContext, sceneId).toEqual([]);
    }
  });

  it("never confuses the decoy 'Prologue Block：' H1 with a Prologue target", () => {
    const bundle = buildAiReviewContext(
      sceneSelection("scene_p0"),
      "storyConsistency",
      workspace,
    );
    const chip = bundle.context.find((item) => item.kind === "chapterPlan")!;
    expect(chip.content).toContain("Prologue 0：雨中的東京");
    expect(chip.content).not.toContain("Prologue Block");
  });

  it("requires exactly one H1 prefix match and stays missing otherwise", () => {
    const duplicated = projectPlanWorkspace(
      payload({
        plan: `${CHAPTER_PLAN_CONTENT}\n# Beat 8.5：重複標題\n重複內容\n`,
      }),
    );
    const bundle = buildAiReviewContext(
      sceneSelection("analysis_scene_8_5"),
      "storyConsistency",
      duplicated,
    );
    expect(
      bundle.context.find((item) => item.kind === "chapterPlan"),
    ).toBeUndefined();
    expect(bundle.missingContext.map((m) => m.kind)).toContain("chapterPlan");
  });

  it("keeps unparseable scene ids visibly missing", () => {
    for (const sceneId of [
      "analysis_scene_p1_5",
      "investigation_scene_map_01",
    ]) {
      const bundle = buildAiReviewContext(
        sceneSelection(sceneId),
        "storyConsistency",
        workspace,
      );
      expect(
        bundle.context.find((item) => item.kind === "chapterPlan"),
      ).toBeUndefined();
      expect(bundle.missingContext.map((m) => m.kind)).toContain("chapterPlan");
    }
  });
});

describe("buildAiReviewContext — Story Bible matching", () => {
  it("resolves Chapter 1 only by the exact H2 第 1 章：雨鐘咖啡館殺人事件", () => {
    const bundle = buildAiReviewContext(
      sceneSelection("scene_2"),
      "storyConsistency",
      workspace,
    );
    const chip = bundle.context.find((item) => item.kind === "storyBible")!;
    const bibleDocument = workspace.documents.find(
      (d) => d.kind === "storyBible",
    )!;
    const exact = bibleDocument.headings.find(
      (heading) =>
        heading.level === 2 && heading.text === "第 1 章：雨鐘咖啡館殺人事件",
    )!;
    expect(chip.sourceRef).toBe(`${BIBLE_PATH}#${exact.anchor}`);
    expect(chip.content).toContain("第一章主案內容");
    expect(chip.content).not.toContain("外貌decoy內容");
  });

  it("reports missing bible context when the exact chapter H2 is absent", () => {
    const stripped = projectPlanWorkspace(
      payload({
        bible: BIBLE_CONTENT.replace(
          "## 第 1 章：雨鐘咖啡館殺人事件\n\n第一章主案內容\n\n",
          "",
        ),
      }),
    );
    const bundle = buildAiReviewContext(
      sceneSelection("scene_2"),
      "storyConsistency",
      stripped,
    );
    expect(
      bundle.context.find((item) => item.kind === "storyBible"),
    ).toBeUndefined();
    expect(bundle.missingContext.map((m) => m.kind)).toContain("storyBible");
  });
});

describe("buildAiReviewContext — Aoba reveal boundary", () => {
  it("resolves Chapter 1 only by the exact 第 1 章 stage label", () => {
    const bundle = buildAiReviewContext(
      sceneSelection("scene_2"),
      "storyConsistency",
      workspace,
    );
    const chip = bundle.context.find((item) => item.kind === "revealBoundary")!;
    expect(chip.content).toBe("必須建立：火災名稱\n絕對不能建立：不說重演");
    expect(chip.sourceRef).toBe(
      `${BIBLE_PATH}#${workspace.aobaReveal!.anchor}`,
    );
  });

  it("never satisfies chapters 5–7 from the 第 5～7 章 range row", () => {
    const chapter5 = projectPlanWorkspace(
      payload({ chapterNumber: 5, plan: "# Beat 5：歌舞伎町\n內容\n" }),
    );
    const bundle = buildAiReviewContext(
      sceneSelection("scene_5", "chapter_5"),
      "storyConsistency",
      chapter5,
    );
    expect(
      bundle.context.find((item) => item.kind === "revealBoundary"),
    ).toBeUndefined();
    expect(bundle.missingContext.map((m) => m.kind)).toContain(
      "revealBoundary",
    );
    // The chapter's own plan section still resolves exactly.
    expect(
      bundle.context.find((item) => item.kind === "chapterPlan"),
    ).toBeDefined();
  });
});

describe("buildAiReviewContext — Plan selections", () => {
  it("Plan-on-Aoba skips the supporting chip whose sourceRef equals the selected source", () => {
    const bundle = buildAiReviewContext(
      {
        kind: "planSection",
        documentId: "story-bible",
        anchor: workspace.aobaReveal!.anchor,
      },
      "storyConsistency",
      workspace,
    );
    expect(bundle.selectedSourceRef).toBe(
      `${BIBLE_PATH}#${workspace.aobaReveal!.anchor}`,
    );
    expect(bundle.context.map((item) => item.kind)).toEqual(["selection"]);
    expect(bundle.context[0]!.required).toBe(true);
    expect(bundle.context[0]!.sourceRef).toBe(bundle.selectedSourceRef);
  });

  it("attaches exact per-stage reveal chips to other Bible-section reviews", () => {
    const bibleDocument = workspace.documents.find(
      (d) => d.kind === "storyBible",
    )!;
    const otherAnchor = bibleDocument.headings.find(
      (heading) => heading.text === "第 1 章：雨鐘咖啡館殺人事件",
    )!.anchor;
    const bundle = buildAiReviewContext(
      { kind: "planSection", documentId: "story-bible", anchor: otherAnchor },
      "storyConsistency",
      workspace,
    );
    const revealChips = bundle.context.filter(
      (item) => item.kind === "revealBoundary",
    );
    expect(revealChips.map((chip) => chip.label)).toEqual([
      "青葉揭示邊界 第 1 章",
    ]);
    expect(revealChips[0]!.content).toContain("必須建立：火災名稱");
    // Range rows never become chips.
    expect(revealChips.some((chip) => chip.label.includes("5～7"))).toBe(false);
  });
});

describe("buildAiReviewContext — dialogue voice", () => {
  it("resolves the speaker section through headingSectionText over storyCharactersMd", () => {
    const bundle = buildAiReviewContext(
      readerItemSelection(),
      "dialogue",
      workspace,
    );
    const voice = bundle.context.find(
      (item) => item.kind === "characterVoice",
    )!;
    const section = headingSectionText(
      CHARACTERS_CONTENT,
      (heading) =>
        heading.level === 3 &&
        (heading.text === "相馬律" ||
          (heading.text.startsWith("相馬律（") && heading.text.endsWith("）"))),
    )!;
    expect(voice.sourceRef).toBe(`${CHARACTERS_PATH}#${section.anchor}`);
    expect(voice.content).toBe(section.content);
    expect(voice.content).toContain("台詞風格：結論偏短。");
    expect(voice.required).toBe(false);
    // Dialogue still carries the exact parent plan section.
    expect(
      bundle.context.find((item) => item.kind === "chapterPlan"),
    ).toBeDefined();
  });

  it("reports missing voice context for unknown or duplicate speakers", () => {
    const unknown = buildAiReviewContext(
      readerItemSelection({
        item: {
          kind: "line",
          speaker: "不在場角色",
          text: "…",
          editable: { carrierId: "intro", itemIndex: 0 },
        },
      }),
      "dialogue",
      workspace,
    );
    expect(
      unknown.context.find((item) => item.kind === "characterVoice"),
    ).toBeUndefined();
    expect(unknown.missingContext.map((m) => m.kind)).toContain(
      "characterVoice",
    );

    const duplicated = projectPlanWorkspace(
      payload({
        characters: `${CHARACTERS_CONTENT}### 相馬律（回憶）\n重複。\n`,
      }),
    );
    const duplicateBundle = buildAiReviewContext(
      readerItemSelection(),
      "dialogue",
      duplicated,
    );
    expect(
      duplicateBundle.context.find((item) => item.kind === "characterVoice"),
    ).toBeUndefined();
    expect(duplicateBundle.missingContext.map((m) => m.kind)).toContain(
      "characterVoice",
    );
  });
});

describe("buildAiReviewContext — prompt refinement", () => {
  it("consumes manifest prompt parts and concrete usages", () => {
    const bundle = buildAiReviewContext(
      assetPromptSelection({
        surface: "asset",
        assetId: backgroundEntry.assetId,
        prompt: {
          kind: "backgroundPrompt",
          chapterId: "chapter_1",
          sceneId: "scene_2",
          unitId: "unit1",
          promptLine: 12,
          authoredPrompt: "雨夜柏油路",
        },
        sceneUsages: backgroundUsages,
      }),
      "promptRefinement",
      workspace,
    );
    const refs = bundle.context.map((item) => item.ref);
    expect(refs).toContain("promptLayer:globalStyle");
    expect(refs).toContain("promptLayer:typePrompt");
    expect(refs).toContain("promptLayer:entryPrompt");
    expect(refs).not.toContain("promptLayer:subjectPrompt");
    expect(refs).toContain("usageImpact");
    expect(
      bundle.context.find((item) => item.ref === "usageImpact")!.content,
    ).toContain("chapter_1/scene_2");
  });

  it("gives a replacement target only when existing HPA-135 identity exists", () => {
    const withIdentity = buildAiReviewContext(
      assetPromptSelection({
        surface: "asset",
        assetId: backgroundEntry.assetId,
        prompt: {
          kind: "backgroundPrompt",
          chapterId: "chapter_1",
          sceneId: "scene_2",
          unitId: "unit1",
          promptLine: 12,
          authoredPrompt: "雨夜柏油路",
        },
        sceneUsages: backgroundUsages,
      }),
      "promptRefinement",
      workspace,
    );
    expect(withIdentity.replacementTargetRef).toBe("asset:background:unit1");

    const findingsOnly = buildAiReviewContext(
      assetPromptSelection(null),
      "promptRefinement",
      workspace,
    );
    expect(findingsOnly.replacementTargetRef).toBeNull();
  });
});

describe("buildAiReviewContext — chip removal", () => {
  it("removing a supporting chip removes only that request item", () => {
    const full = buildAiReviewContext(
      sceneSelection("scene_2"),
      "storyConsistency",
      workspace,
    );
    const removed = buildAiReviewContext(
      sceneSelection("scene_2"),
      "storyConsistency",
      workspace,
      { removeContextRefs: ["revealBoundary"] },
    );
    expect(removed.context.map((item) => item.ref)).toEqual(
      full.context
        .map((item) => item.ref)
        .filter((ref) => ref !== "revealBoundary"),
    );
    expect(removed.context.find((item) => item.required)).toBeDefined();
  });

  it("never removes the required selected source", () => {
    const bundle = buildAiReviewContext(
      sceneSelection("scene_2"),
      "storyConsistency",
      workspace,
      { removeContextRefs: ["selection"] },
    );
    expect(bundle.context.find((item) => item.required)).toBeDefined();
  });
});

describe("allowedLensesForSelection", () => {
  it("depends only on the selection kind", () => {
    expect(allowedLensesForSelection(sceneSelection("scene_2"))).toEqual([
      "storyConsistency",
    ]);
    expect(allowedLensesForSelection(readerItemSelection())).toEqual([
      "storyConsistency",
      "dialogue",
    ]);
    expect(
      allowedLensesForSelection({
        kind: "planSection",
        documentId: "story-bible",
        anchor: "x",
      }),
    ).toEqual(["storyConsistency"]);
    expect(allowedLensesForSelection(assetPromptSelection(null))).toEqual([
      "promptRefinement",
    ]);
  });
});

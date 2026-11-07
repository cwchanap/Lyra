import { describe, expect, it } from "vitest";
import type { AssetManifestEntry } from "@lyra/scripts/compile-scenes/assets/manifest";
import {
  allowedLensesForSelection,
  buildAiReviewContext,
  type AiReviewSelection,
} from "./ai-review-context";
import type { AssetSceneUsage } from "./asset-workspace";
import type { ReaderScene, WorkbenchScenePayload } from "./workbench-types";

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

type ReaderItemGroup = Extract<
  AiReviewSelection,
  { kind: "readerItem" }
>["group"];

describe("buildAiReviewContext — Reader projection context", () => {
  it("scene selections carry a required sceneProjection chip with the public projection text", () => {
    const scene: ReaderScene = {
      id: "scene_2",
      type: "linear",
      title: "雨中現場",
      sourcePath: "docs/stories_plan/chapter_1/scene_2.md",
      groups: [
        {
          id: "main",
          kind: "intro",
          label: "Main",
          flow: "main",
          sourceAnchor: "#main",
          items: [
            { kind: "sceneTag", text: "場景：雨中辦公室" },
            {
              kind: "line",
              speaker: "相馬律",
              text: "先不要急著判斷。",
              editable: { carrierId: "main", itemIndex: 1 },
            },
          ],
          children: [
            {
              id: "child",
              kind: "topic",
              label: "Child",
              flow: "main",
              sourceAnchor: null,
              items: [
                {
                  kind: "action",
                  text: "雨聲漸強。",
                  editable: { carrierId: "child", itemIndex: 0 },
                },
              ],
              children: [],
            },
          ],
        },
      ],
      presentation: [],
    };
    const bundle = buildAiReviewContext(
      {
        kind: "readerScene",
        chapterId: "chapter_1",
        sceneId: "scene_2",
        scene,
      },
      "storyConsistency",
    );
    const projection = bundle.context.find(
      (item) => item.kind === "sceneProjection",
    );
    expect(projection).toBeDefined();
    expect(projection!.required).toBe(true);
    expect(projection!.sourceRef).toBe(scene.sourcePath);
    // The projection text is the whole public walk: nested groups included.
    expect(projection!.content).toContain("雨中現場");
    expect(projection!.content).toContain("相馬律: 先不要急著判斷。");
    expect(projection!.content).toContain("雨聲漸強。");
  });

  it("dialogue reviews attach the containing Reader group as a removable chip", () => {
    const group: ReaderItemGroup = {
      id: "question:q1:onLoop",
      kind: "question",
      label: "On Loop",
      flow: "branch",
      sourceAnchor: "#question-q1",
      items: [
        {
          kind: "line",
          speaker: "相馬律",
          text: "再說一次。",
          editable: { carrierId: "question:q1:onLoop", itemIndex: 0 },
        },
      ],
      children: [],
    };
    const bundle = buildAiReviewContext(
      readerItemSelection({ group }),
      "dialogue",
    );
    const groupChip = bundle.context.find(
      (item) => item.ref === "readerGroup:question:q1:onLoop",
    );
    expect(groupChip).toBeDefined();
    expect(groupChip!.kind).toBe("sceneProjection");
    expect(groupChip!.required).toBe(false);
    expect(groupChip!.sourceRef).toBe(
      "docs/stories_plan/chapter_1/scene_2.md#question-q1",
    );
    expect(groupChip!.content).toContain("相馬律: 再說一次。");
  });

  it("story-consistency item reviews attach the scene projection instead of the containing group", () => {
    const bundle = buildAiReviewContext(
      readerItemSelection(),
      "storyConsistency",
    );
    expect(
      bundle.context.some((item) => item.ref.startsWith("readerGroup:")),
    ).toBe(false);
    const projection = bundle.context.find(
      (item) => item.ref === "sceneProjection",
    );
    expect(projection).toBeDefined();
    expect(projection!.required).toBe(false);
    expect(projection!.sourceRef).toBe(
      "docs/stories_plan/chapter_1/scene_2.md",
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
    );
    expect(withIdentity.replacementTargetRef).toBe("asset:background:unit1");

    const findingsOnly = buildAiReviewContext(
      assetPromptSelection(null),
      "promptRefinement",
    );
    expect(findingsOnly.replacementTargetRef).toBeNull();
  });
});

describe("buildAiReviewContext — chip removal", () => {
  it("removing a supporting chip removes only that request item", () => {
    const full = buildAiReviewContext(
      readerItemSelection(),
      "storyConsistency",
    );
    const removed = buildAiReviewContext(
      readerItemSelection(),
      "storyConsistency",
      { removeContextRefs: ["sceneProjection"] },
    );
    expect(full.context.map((item) => item.ref)).toContain("sceneProjection");
    expect(removed.context.map((item) => item.ref)).toEqual(
      full.context
        .map((item) => item.ref)
        .filter((ref) => ref !== "sceneProjection"),
    );
    expect(removed.context.find((item) => item.required)).toBeDefined();
  });

  it("never removes the required selected source", () => {
    const bundle = buildAiReviewContext(
      sceneSelection("scene_2"),
      "storyConsistency",
      { removeContextRefs: ["selection", "sceneProjection"] },
    );
    expect(bundle.context.map((item) => item.ref)).toEqual([
      "selection",
      "sceneProjection",
    ]);
    expect(bundle.context.every((item) => item.required)).toBe(true);
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
    expect(allowedLensesForSelection(assetPromptSelection(null))).toEqual([
      "promptRefinement",
    ]);
  });
});

// =============================================================================
// apps/layout-editor/src/lib/focused-edit.test.ts
//
// HPA-135 Task 2: the focused draft seam. Covers source resolution from
// compiler data (direct + metadata-wrapped Reader items, manifest prompt
// lines), compiled-vs-source staleness, the no-change guard, the hand-rolled
// one-hunk diff with locality assertions, and impact reuse.
// =============================================================================

import { describe, expect, it } from "vitest";
import type {
  JSONInterrogationScene,
  JSONLinearScene,
} from "@lyra/scripts/compile-scenes/types";
import type { CaseRecordProvenance } from "@lyra/scripts/compile-scenes/types";
import type { AssetSceneUsage } from "./asset-workspace";
import type { SourceDocumentId } from "./focused-edit";
import {
  focusedEditDiff,
  multilineReaderActionRefs,
  openFocusedEdit,
} from "./focused-edit";
import type { PublicAnalysisScene } from "./workbench-types";

// ---- fixtures ----------------------------------------------------------------

/** Authored 1-based line of the first source line containing `needle`. */
function lineOf(source: string, needle: string): number {
  const index = source.split("\n").findIndex((line) => line.includes(needle));
  if (index < 0) throw new Error(`needle not found in source: ${needle}`);
  return index + 1;
}

const linearSource = [
  "# Scene 0: 接案",
  "",
  "**相馬律**：原文台詞。",
  "",
  "[相馬律走進場景。]",
  "",
  "**早坂茜**：了解。",
].join("\n");

const linearScene = {
  type: "linear",
  id: "scene_t",
  title: "接案",
  summary: "Fixture",
  queue: [
    { kind: "line", speaker: "相馬律", text: "原文台詞。", portrait: null },
    { kind: "action", text: "相馬律走進場景。" },
    { kind: "line", speaker: "早坂茜", text: "了解。", portrait: null },
  ],
  assetRefs: [],
} satisfies JSONLinearScene;

// Multiline bracket block: the tokenizer flattens it into ONE compiled
// action whose text cannot be distinguished from a single-line action, so
// multilineReaderActionRefs must re-consult the authored source lines.
const multilineActionSource = [
  "# Scene 0: 接案",
  "",
  "[雨聲漸強，",
  "打濕了窗台。]",
  "",
  "[相馬律走進場景。]",
].join("\n");

const multilineActionScene = {
  type: "linear",
  id: "scene_t",
  title: "接案",
  summary: "Fixture",
  queue: [
    { kind: "action", text: "雨聲漸強， 打濕了窗台。" },
    { kind: "action", text: "相馬律走進場景。" },
  ],
  assetRefs: [],
} satisfies JSONLinearScene;

// Analysis public-view pair: the editor's sanitized analysis scene keeps
// intro/outro/resultDialogue verbatim, which is exactly what the compiler's
// AnalysisDialogueSceneSource derivation reads — no parallel identity system.
const analysisSource = [
  "# Scene 9: 分析測試",
  "",
  "- **Summary:** Fixture。",
  "",
  "## Intro",
  "",
  "**相馬律**：分析開場。",
  "",
  "[雨聲漸強，",
  "打濕了窗台。]",
  "",
  "## Board: 板一 {#board_a}",
  "",
  "- **Kind:** classify",
  "- **Prompt:** 分類。",
  "- **Reveals:** [assert_fact:f1]",
  "- **Incomplete Feedback:** 未完成。",
  "- **Incorrect Feedback:** 錯誤。",
  "",
  "### Card: 卡一 {#card_a}",
  "",
  "- **Source:** evidence:e1",
  "- **Summary:** 卡一摘要。",
  "",
  "### Result Dialogue",
  "",
  "**相馬律**：板一結果。",
  "",
  "[相馬律收起卡片。]",
  "",
  "## Outro",
  "",
  "**相馬律**：分析結束。",
].join("\n");

const analysisLine = (text: string) => ({
  kind: "line" as const,
  speaker: "相馬律",
  text,
  portrait: null,
});

const analysisScene = {
  type: "analysis",
  id: "analysis_scene_9",
  title: "分析測試",
  summary: "Fixture。",
  intro: [
    analysisLine("分析開場。"),
    { kind: "action" as const, text: "雨聲漸強， 打濕了窗台。" },
  ],
  boards: [
    {
      kind: "classify" as const,
      common: {
        id: "board_a",
        label: "板一",
        prompt: "分類。",
        cards: [
          {
            id: "card_a",
            label: "卡一",
            source: { kind: "evidence" as const, id: "e1" },
            summary: "卡一摘要。",
          },
        ],
        resultDialogue: [
          analysisLine("板一結果。"),
          { kind: "action" as const, text: "相馬律收起卡片。" },
        ],
        feedback: { incomplete: "未完成。", incorrect: "錯誤。", hint: null },
      },
      groups: [],
    },
  ],
  outro: [analysisLine("分析結束。")],
} satisfies PublicAnalysisScene;

const analysisDocument = () =>
  document(
    "scene:chapter_1:analysis_scene_9",
    "docs/stories_plan/chapter_1/analysis_scene_9.md",
    analysisSource,
  );

function analysisSelection(
  overrides: Partial<
    Parameters<typeof openFocusedEdit>[0] & { surface: "reader" }
  > = {},
): Parameters<typeof openFocusedEdit>[0] {
  return {
    surface: "reader",
    document: analysisDocument(),
    chapterId: "chapter_1",
    sceneId: "analysis_scene_9",
    compiledScene: analysisScene,
    carrierId: "intro",
    itemIndex: 0,
    item: { kind: "line", speaker: "相馬律", text: "分析開場。" },
    ...overrides,
  };
}

// Metadata-wrapped interrogation pair: the compiled items must match the
// authored tokens exactly (same construction the emitter produces).
const interrogationSource = [
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

const provenance = {
  sourceKind: "physical",
  representationLayer: "raw",
  proceduralStatus: "unspecified",
  completeness: "complete",
  confidence: "unverified",
  sourceGroupId: null,
  sourceLabel: null,
  proofCapabilities: [],
  supersedesRecordId: null,
} satisfies CaseRecordProvenance;

const interrogationLine = (speaker: string, text: string) => ({
  kind: "line" as const,
  speaker,
  text,
  portrait: null,
});

const interrogationScene = {
  type: "interrogation",
  id: "interrogation_scene_t",
  title: "測試詢問",
  summary: "Fixture",
  intro: [interrogationLine("相馬律", "開始詢問。")],
  assetRefs: [],
  phases: [
    {
      kind: "inquiry",
      id: "phase_a",
      label: "初步",
      subject: {
        id: "wakatsuki_ren",
        name: "若槻蓮",
        role: "嫌疑人",
        bio: "店員。",
        portrait: null,
      },
      required: true,
      status: "unlocked",
      unlock: null,
      reveals: [],
      sceneTag: "場景：詢問室。",
      backgroundAssetId: null,
      bgm: null,
      bgs: null,
      entryDialogue: [{ kind: "action" as const, text: "相馬律坐下。" }],
      complete: "auto",
      questions: [
        {
          id: "route",
          label: "動線",
          status: "unlocked",
          required: true,
          unlock: null,
          reveals: [],
          testimony: {
            onLoop: [interrogationLine("相馬律", "再說一次。")],
            loopPrompt: [interrogationLine("相馬律", "從頭再聽。")],
            defaultChallenge: [
              { kind: "action" as const, text: "相馬律盯著紀錄。" },
            ],
            defaultWrong: [interrogationLine("相馬律", "這裡不對。")],
            wrongReply: [interrogationLine("相馬律", "不是這件。")],
            lines: [
              {
                id: "l_claim",
                label: "說詞",
                content: [interrogationLine("若槻蓮", "我一直在店裡。")],
                contradiction: { kind: "evidence", id: "log" },
                challenge: [interrogationLine("相馬律", "紀錄顯示你出去了。")],
                onCorrect: [interrogationLine("若槻蓮", "好吧。")],
                onWrongEvidence: [interrogationLine("若槻蓮", "證明不了。")],
                reveals: [],
              },
            ],
          },
        },
      ],
    },
  ],
  evidenceManifest: [
    {
      id: "log",
      name: "紀錄",
      description: "出入紀錄。",
      details: "23:10。",
      imageAssetId: null,
      provenance,
      onCollect: [interrogationLine("相馬律", "拿到紀錄。")],
      // Compiler-synthesized default re-examination: no authored source.
      onReexamine: [{ kind: "action" as const, text: "（沒有新發現。）" }],
    },
  ],
  statementManifest: [],
  outro: { unlock: "auto", dialogue: [interrogationLine("相馬律", "結束。")] },
} satisfies JSONInterrogationScene;

function document(id: SourceDocumentId, path: string, content: string) {
  return { id, path, content, hash: `sha256-${id}` };
}

function readerSelection(
  overrides: Partial<
    Parameters<typeof openFocusedEdit>[0] & { surface: "reader" }
  > = {},
): Parameters<typeof openFocusedEdit>[0] {
  return {
    surface: "reader",
    document: document(
      "scene:chapter_1:scene_t",
      "docs/stories_plan/chapter_1/scene_t.md",
      linearSource,
    ),
    chapterId: "chapter_1",
    sceneId: "scene_t",
    compiledScene: linearScene,
    carrierId: "main",
    itemIndex: 0,
    item: { kind: "line", speaker: "相馬律", text: "原文台詞。" },
    ...overrides,
  };
}

const interrogationDocument = () =>
  document(
    "scene:chapter_1:interrogation_scene_t",
    "docs/stories_plan/chapter_1/interrogation_scene_t.md",
    interrogationSource,
  );

function assetUsage(sceneId: string, assetId: string): AssetSceneUsage {
  return {
    chapterId: "chapter_1",
    sceneId,
    sceneSourcePath: `docs/stories_plan/chapter_1/${sceneId}.md`,
    carrierId: "sublocation:lobby",
    carrierLabel: "Lobby",
    role: "background",
    itemIndex: null,
    assetId,
    type: "background",
  };
}

// ---- reader: direct dialogue/action ------------------------------------------

describe("openFocusedEdit reader direct items", () => {
  it("drafts a direct dialogue edit resolved from compiler source data", () => {
    const result = openFocusedEdit(readerSelection(), "替換後的台詞。");
    if (!result.ok) throw new Error(result.diagnostic.message);
    const { draft } = result;
    expect(draft.sourceDocumentId).toBe("scene:chapter_1:scene_t");
    expect(draft.sourcePath).toBe("docs/stories_plan/chapter_1/scene_t.md");
    expect(draft.expectedHash).toBe("sha256-scene:chapter_1:scene_t");
    expect(draft.semanticRef).toBe("reader:dialogue:main:0");
    expect(draft.kind).toBe("readerDialogue");
    expect(draft.expectedLine).toBe(
      lineOf(linearSource, "**相馬律**：原文台詞。"),
    );
    expect(draft.originalText).toBe("原文台詞。");
    expect(draft.replacementText).toBe("替換後的台詞。");
    expect(draft.nextContent).toBe(
      linearSource.replace(
        "**相馬律**：原文台詞。",
        "**相馬律**：替換後的台詞。",
      ),
    );
    expect(draft.impact).toEqual({
      scope: "scene",
      chapterId: "chapter_1",
      sceneId: "scene_t",
    });
  });

  it("drafts a single-line action edit", () => {
    const result = openFocusedEdit(
      readerSelection({
        itemIndex: 1,
        item: { kind: "action", text: "相馬律走進場景。" },
      }),
      "相馬律停在門口。",
    );
    if (!result.ok) throw new Error(result.diagnostic.message);
    expect(result.draft.semanticRef).toBe("reader:action:main:1");
    expect(result.draft.kind).toBe("readerAction");
    expect(result.draft.expectedLine).toBe(
      lineOf(linearSource, "[相馬律走進場景。]"),
    );
    expect(result.draft.nextContent).toBe(
      linearSource.replace("[相馬律走進場景。]", "[相馬律停在門口。]"),
    );
  });
});

// ---- reader: analysis items through the public view -------------------------

describe("openFocusedEdit analysis items (public view)", () => {
  it("drafts an analysis intro dialogue edit through the shared resolver", () => {
    const result = openFocusedEdit(analysisSelection(), "改寫的開場。");
    if (!result.ok) throw new Error(result.diagnostic.message);
    expect(result.draft.semanticRef).toBe("reader:dialogue:intro:0");
    expect(result.draft.kind).toBe("readerDialogue");
    expect(result.draft.expectedLine).toBe(
      lineOf(analysisSource, "**相馬律**：分析開場。"),
    );
    expect(result.draft.nextContent).toBe(
      analysisSource.replace(
        "**相馬律**：分析開場。",
        "**相馬律**：改寫的開場。",
      ),
    );
    expect(result.draft.impact).toEqual({
      scope: "scene",
      chapterId: "chapter_1",
      sceneId: "analysis_scene_9",
    });
  });

  it("drafts a board result dialogue edit resolved by board id", () => {
    const result = openFocusedEdit(
      analysisSelection({
        carrierId: "board:board_a:result",
        itemIndex: 0,
        item: { kind: "line", speaker: "相馬律", text: "板一結果。" },
      }),
      "板一改寫。",
    );
    if (!result.ok) throw new Error(result.diagnostic.message);
    expect(result.draft.semanticRef).toBe(
      "reader:dialogue:board:board_a:result:0",
    );
    expect(result.draft.expectedLine).toBe(
      lineOf(analysisSource, "**相馬律**：板一結果。"),
    );
  });

  it("rejects a drifted analysis document with compiled-source staleness", () => {
    const result = openFocusedEdit(
      analysisSelection({
        document: document(
          "scene:chapter_1:analysis_scene_9",
          "docs/stories_plan/chapter_1/analysis_scene_9.md",
          analysisSource.replace("分析開場。", "改過的開場。"),
        ),
      }),
      "改寫的開場。",
    );
    expect(result).toMatchObject({
      ok: false,
      diagnostic: { code: "focusedEditCompiledSourceStale" },
    });
  });

  it("passes through the multiline rejection for an analysis multiline action", () => {
    const result = openFocusedEdit(
      analysisSelection({
        itemIndex: 1,
        item: { kind: "action", text: "雨聲漸強， 打濕了窗台。" },
      }),
      "單行化。",
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostic.code).toBe(
        "workbenchSourceMultilineActionUnsupported",
      );
    }
  });

  it("marks analysis multiline actions and leaves single-line ones unmarked", () => {
    const refs = multilineReaderActionRefs({
      chapterId: "chapter_1",
      document: analysisDocument(),
      compiledScene: analysisScene,
    });
    expect([...refs]).toEqual(["intro#1"]);
  });

  it("marks every analysis action when the document no longer parses (fail-closed)", () => {
    const refs = multilineReaderActionRefs({
      chapterId: "chapter_1",
      document: document(
        "scene:chapter_1:analysis_scene_9",
        "docs/stories_plan/chapter_1/analysis_scene_9.md",
        "完全不是場景檔的文字",
      ),
      compiledScene: analysisScene,
    });
    expect([...refs]).toEqual(["intro#1", "board:board_a:result#1"]);
  });
});

// ---- multiline Reader action refs (Task 4 fix: no Edit on multiline actions)

describe("multilineReaderActionRefs", () => {
  it("marks actions whose authored bracket block spans multiple lines", () => {
    const refs = multilineReaderActionRefs({
      chapterId: "chapter_1",
      document: document(
        "scene:chapter_1:scene_t",
        "docs/stories_plan/chapter_1/scene_t.md",
        multilineActionSource,
      ),
      compiledScene: multilineActionScene,
    });
    expect([...refs]).toEqual(["main#0"]);
  });

  it("leaves single-line actions unmarked", () => {
    const refs = multilineReaderActionRefs({
      chapterId: "chapter_1",
      document: document(
        "scene:chapter_1:scene_t",
        "docs/stories_plan/chapter_1/scene_t.md",
        linearSource,
      ),
      compiledScene: linearScene,
    });
    expect(refs.size).toBe(0);
  });

  it("marks every action when the document no longer parses against the compiled scene", () => {
    const refs = multilineReaderActionRefs({
      chapterId: "chapter_1",
      document: document(
        "scene:chapter_1:scene_t",
        "docs/stories_plan/chapter_1/scene_t.md",
        "not a scene",
      ),
      compiledScene: linearScene,
    });
    // Fail-closed: an unparseable document cannot vouch for any action.
    expect([...refs]).toEqual(["main#1"]);
  });

  it("marks an action whose source line disagrees with the compiled projection", () => {
    // The document parses, but the compiled action no longer matches its
    // authored line, so the per-item source join fails — that action must be
    // treated as not-editable rather than failed open.
    const refs = multilineReaderActionRefs({
      chapterId: "chapter_1",
      document: document(
        "scene:chapter_1:scene_t",
        "docs/stories_plan/chapter_1/scene_t.md",
        linearSource.replace("[相馬律走進場景。]", "[他走了進來。]"),
      ),
      compiledScene: linearScene,
    });
    expect([...refs]).toEqual(["main#1"]);
  });
});

// ---- reader: metadata-wrapped interrogation items ----------------------------

describe("openFocusedEdit metadata-wrapped interrogation items", () => {
  it("drafts the OUTER metadata line for a wrapped dialogue value", () => {
    const doc = interrogationDocument();
    const result = openFocusedEdit(
      {
        surface: "reader",
        document: doc,
        chapterId: "chapter_1",
        sceneId: "interrogation_scene_t",
        compiledScene: interrogationScene,
        carrierId: "question:route:onLoop",
        itemIndex: 0,
        item: { kind: "line", speaker: "相馬律", text: "再說一次。" },
      },
      "再說一次就好。",
    );
    if (!result.ok) throw new Error(result.diagnostic.message);
    expect(result.draft.semanticRef).toBe(
      "reader:dialogue:question:route:onLoop:0",
    );
    expect(result.draft.expectedLine).toBe(
      lineOf(interrogationSource, "- **On Loop:** **相馬律**：再說一次。"),
    );
    expect(result.draft.nextContent).toBe(
      interrogationSource.replace(
        "- **On Loop:** **相馬律**：再說一次。",
        "- **On Loop:** **相馬律**：再說一次就好。",
      ),
    );
  });

  it("drafts the OUTER metadata line for a wrapped action value", () => {
    const doc = interrogationDocument();
    const result = openFocusedEdit(
      {
        surface: "reader",
        document: doc,
        chapterId: "chapter_1",
        sceneId: "interrogation_scene_t",
        compiledScene: interrogationScene,
        carrierId: "question:route:defaultChallenge",
        itemIndex: 0,
        item: { kind: "action", text: "相馬律盯著紀錄。" },
      },
      "相馬律翻開紀錄。",
    );
    if (!result.ok) throw new Error(result.diagnostic.message);
    expect(result.draft.semanticRef).toBe(
      "reader:action:question:route:defaultChallenge:0",
    );
    expect(result.draft.kind).toBe("readerAction");
    expect(result.draft.expectedLine).toBe(
      lineOf(
        interrogationSource,
        "- **Default Challenge:** [相馬律盯著紀錄。]",
      ),
    );
    expect(result.draft.nextContent).toBe(
      interrogationSource.replace(
        "- **Default Challenge:** [相馬律盯著紀錄。]",
        "- **Default Challenge:** [相馬律翻開紀錄。]",
      ),
    );
  });
});

// ---- compiled/source staleness + guards --------------------------------------

describe("openFocusedEdit staleness and guards", () => {
  it("rejects with focusedEditCompiledSourceStale when source text drifted", () => {
    const drifted = linearSource.replace("原文台詞。", "改過的台詞。");
    const result = openFocusedEdit(
      readerSelection({
        document: document(
          "scene:chapter_1:scene_t",
          "docs/stories_plan/chapter_1/scene_t.md",
          drifted,
        ),
      }),
      "替換後的台詞。",
    );
    expect(result).toMatchObject({
      ok: false,
      diagnostic: { code: "focusedEditCompiledSourceStale" },
    });
  });

  it("rejects with focusedEditCompiledSourceStale for an unknown carrier", () => {
    const result = openFocusedEdit(
      readerSelection({ carrierId: "question:missing:onLoop" }),
      "替換後的台詞。",
    );
    expect(result).toMatchObject({
      ok: false,
      diagnostic: { code: "focusedEditCompiledSourceStale" },
    });
  });

  it("rejects with focusedEditCompiledSourceStale when the document no longer parses", () => {
    const result = openFocusedEdit(
      readerSelection({
        document: document(
          "scene:chapter_1:scene_t",
          "docs/stories_plan/chapter_1/scene_t.md",
          "完全不是場景檔的文字",
        ),
      }),
      "替換後的台詞。",
    );
    expect(result).toMatchObject({
      ok: false,
      diagnostic: { code: "focusedEditCompiledSourceStale" },
    });
  });

  it("treats compiler-synthesized default dialogue as not editable, not stale", () => {
    const result = openFocusedEdit(
      {
        surface: "reader",
        document: interrogationDocument(),
        chapterId: "chapter_1",
        sceneId: "interrogation_scene_t",
        compiledScene: interrogationScene,
        carrierId: "evidence:log:onReexamine",
        itemIndex: 0,
        item: { kind: "action", text: "（沒有新發現。）" },
      },
      "改成有新發現。",
    );
    expect(result).toMatchObject({
      ok: false,
      diagnostic: { code: "focusedEditTargetNotEditable" },
    });
  });

  it("rejects an identical replacement with focusedEditNoChange", () => {
    const result = openFocusedEdit(readerSelection(), "原文台詞。");
    expect(result).toMatchObject({
      ok: false,
      diagnostic: { code: "focusedEditNoChange" },
    });
  });

  it("passes through the multiline-target rejection for a multiline action", () => {
    // Backstop for the Reader affordance gate: even if a multiline action
    // somehow gets clicked, no draft exists and the diagnostic is loud.
    const result = openFocusedEdit({
      surface: "reader",
      document: document(
        "scene:chapter_1:scene_t",
        "docs/stories_plan/chapter_1/scene_t.md",
        multilineActionSource,
      ),
      chapterId: "chapter_1",
      sceneId: "scene_t",
      compiledScene: multilineActionScene,
      carrierId: "main",
      itemIndex: 0,
      item: { kind: "action", text: "雨聲漸強， 打濕了窗台。" },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostic.code).toBe(
        "workbenchSourceMultilineActionUnsupported",
      );
    }
  });

  it("passes through the multiline-replacement rejection", () => {
    const result = openFocusedEdit(readerSelection(), "第一行\n第二行");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostic.code).toBe(
        "workbenchSourceMultilineReplacementUnsupported",
      );
    }
  });
});

// ---- asset prompt edits + impact ---------------------------------------------

const backgroundPrompt = {
  kind: "backgroundPrompt" as const,
  chapterId: "chapter_1",
  sceneId: "scene_t",
  unitId: "tag_001",
  promptLine: 2,
  authoredPrompt: "Old rainy exterior.",
};

const backgroundDoc = () =>
  document(
    "scene:chapter_1:scene_t",
    "docs/stories_plan/chapter_1/scene_t.md",
    [
      "[場景：咖啡館外，雨夜。]",
      "- **Background Prompt:** Old rainy exterior.",
      "- **BGM:** none",
    ].join("\n"),
  );

describe("openFocusedEdit asset prompt edits", () => {
  it("drafts a Background Prompt edit from manifest promptLine + authoredPrompt", () => {
    const result = openFocusedEdit(
      {
        surface: "asset",
        document: backgroundDoc(),
        assetId: "background.chapter_1.tag_001",
        prompt: backgroundPrompt,
        sceneUsages: [assetUsage("scene_t", "background.chapter_1.tag_001")],
      },
      "New rainy exterior with wet asphalt.",
    );
    if (!result.ok) throw new Error(result.diagnostic.message);
    expect(result.draft.semanticRef).toBe("asset:background:tag_001");
    expect(result.draft.kind).toBe("backgroundPrompt");
    expect(result.draft.expectedLine).toBe(2);
    expect(result.draft.originalText).toBe("Old rainy exterior.");
    expect(result.draft.nextContent).toBe(
      [
        "[場景：咖啡館外，雨夜。]",
        "- **Background Prompt:** New rainy exterior with wet asphalt.",
        "- **BGM:** none",
      ].join("\n"),
    );
    expect(result.draft.impact).toEqual({
      scope: "asset",
      assetId: "background.chapter_1.tag_001",
      scenes: [{ chapterId: "chapter_1", sceneId: "scene_t" }],
      usages: 1,
      shared: false,
    });
  });

  it("drafts an evidence Image Prompt edit and marks multi-scene usage shared", () => {
    const evidencePrompt = {
      kind: "evidenceImagePrompt" as const,
      chapterId: "chapter_1",
      sceneId: "scene_t",
      evidenceId: "receipt",
      promptLine: 2,
      authoredPrompt: "Old receipt icon.",
    };
    const result = openFocusedEdit(
      {
        surface: "asset",
        document: document(
          "scene:chapter_1:scene_t",
          "docs/stories_plan/chapter_1/scene_t.md",
          [
            "### evidence:receipt {#receipt}",
            "- **Image Prompt:** Old receipt icon.",
            "",
          ].join("\n"),
        ),
        assetId: "evidence.receipt",
        prompt: evidencePrompt,
        sceneUsages: [
          assetUsage("scene_t", "evidence.receipt"),
          { ...assetUsage("scene_2", "evidence.receipt"), role: "evidence" },
        ],
      },
      "New flattened receipt icon.",
    );
    if (!result.ok) throw new Error(result.diagnostic.message);
    expect(result.draft.semanticRef).toBe("asset:evidence:receipt:imagePrompt");
    expect(result.draft.kind).toBe("evidenceImagePrompt");
    expect(result.draft.impact).toEqual({
      scope: "asset",
      assetId: "evidence.receipt",
      scenes: [
        { chapterId: "chapter_1", sceneId: "scene_t" },
        { chapterId: "chapter_1", sceneId: "scene_2" },
      ],
      usages: 2,
      shared: true,
    });
  });

  it("rejects an asset edit whose authoredPrompt no longer matches the line", () => {
    const result = openFocusedEdit(
      {
        surface: "asset",
        document: backgroundDoc(),
        assetId: "background.chapter_1.tag_001",
        prompt: { ...backgroundPrompt, authoredPrompt: "Drifted prompt." },
        sceneUsages: [],
      },
      "New rainy exterior.",
    );
    expect(result).toMatchObject({
      ok: false,
      diagnostic: { code: "focusedEditCompiledSourceStale" },
    });
  });

  it("reports zero usages for an unused asset", () => {
    const result = openFocusedEdit(
      {
        surface: "asset",
        document: backgroundDoc(),
        assetId: "background.chapter_1.tag_001",
        prompt: backgroundPrompt,
        sceneUsages: [],
      },
      "New rainy exterior with wet asphalt.",
    );
    if (!result.ok) throw new Error(result.diagnostic.message);
    expect(result.draft.impact).toEqual({
      scope: "asset",
      assetId: "background.chapter_1.tag_001",
      scenes: [],
      usages: 0,
      shared: false,
    });
  });
});

// ---- one-hunk diff + locality ------------------------------------------------

describe("focusedEditDiff", () => {
  const original = ["a", "b", "c", "d", "e", "f", "g", "h"].join("\n");

  it("builds one unified hunk with up to 3 context lines and exact syntax", () => {
    const changed = original.replace("d", "D");
    const result = focusedEditDiff(original, changed, 4);
    if (!result.ok) throw new Error(result.diagnostic.message);
    expect(result.hunk.oldStart).toBe(1);
    expect(result.hunk.oldLines).toBe(7);
    expect(result.hunk.newStart).toBe(1);
    expect(result.hunk.newLines).toBe(7);
    expect(result.hunk.lines).toEqual([
      { kind: "context", text: "a" },
      { kind: "context", text: "b" },
      { kind: "context", text: "c" },
      { kind: "del", text: "d" },
      { kind: "add", text: "D" },
      { kind: "context", text: "e" },
      { kind: "context", text: "f" },
      { kind: "context", text: "g" },
    ]);
  });

  it("clamps trailing context at end of document", () => {
    const changed = original.replace("h", "H");
    const result = focusedEditDiff(original, changed, 8);
    if (!result.ok) throw new Error(result.diagnostic.message);
    expect(result.hunk.oldStart).toBe(5);
    expect(result.hunk.oldLines).toBe(4);
    expect(result.hunk.lines).toEqual([
      { kind: "context", text: "e" },
      { kind: "context", text: "f" },
      { kind: "context", text: "g" },
      { kind: "del", text: "h" },
      { kind: "add", text: "H" },
    ]);
  });

  it("shows exact authored Markdown syntax through the draft", () => {
    const draft = openFocusedEdit(readerSelection(), "替換後的台詞。");
    if (!draft.ok) throw new Error(draft.diagnostic.message);
    const result = focusedEditDiff(
      linearSource,
      draft.draft.nextContent,
      draft.draft.expectedLine,
    );
    if (!result.ok) throw new Error(result.diagnostic.message);
    expect(result.hunk.lines).toContainEqual({
      kind: "del",
      text: "**相馬律**：原文台詞。",
    });
    expect(result.hunk.lines).toContainEqual({
      kind: "add",
      text: "**相馬律**：替換後的台詞。",
    });
  });

  it("rejects a line-count change", () => {
    const grown = `${original}\nextra`;
    expect(focusedEditDiff(original, grown, 1).ok).toBe(false);
  });

  it("rejects more than one changed line", () => {
    const changed = original.replace("d", "D").replace("f", "F");
    const result = focusedEditDiff(original, changed, 4);
    expect(result).toMatchObject({
      ok: false,
      diagnostic: { code: "workbenchSourceNotFocused" },
    });
  });

  it("rejects when the changed line is not the expected line", () => {
    const changed = original.replace("d", "D");
    expect(focusedEditDiff(original, changed, 5).ok).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import * as unlockGrammar from "./parser-unlock";
import { parseAnalysisScene } from "./parser-analysis";

const VALID_SOURCE = [
  "# Scene 8: 雨夜的推理整理",
  "- **Summary:** 相馬整理三組互相印證的線索。",
  "## Intro",
  "**相馬律**：先把能證明的事實分開。",
  "## Board: 線索分類 {#source_classification}",
  "- **Kind:** classify",
  "- **Prompt:** 將卡片分到正確的證據群組。",
  "- **Unlock:** fact:timeline_conflict asserted",
  "- **Reveals:** [assert_fact:source_classified]",
  "- **Incomplete Feedback:** 還有卡片沒有分類。",
  "- **Incorrect Feedback:** 這個來源不支持該分類。",
  "- **Hint:** 先看每張卡片的來源。",
  "### Card: 月台照片 {#platform_photo}",
  "- **Source:** evidence:platform_photo",
  "- **Summary:** 月台監視器留下的雨衣身影。",
  "### Card: 車票證詞 {#ticket_statement}",
  "- **Source:** statement:ticket_statement",
  "- **Summary:** 證人提到車票被撕毀。",
  "### Group: 影像證據 {#visual}",
  "- **Description:** 可以直接核對時間的影像。",
  "- **Accepted Cards:** [platform_photo]",
  "### Group: 證詞 {#testimony}",
  "- **Description:** 需要與其他材料互相驗證的說法。",
  "- **Accepted Cards:** [ticket_statement]",
  "### Result Dialogue",
  "**相馬律**：來源已經分清楚了。",
  "## Board: 班次順序 {#train_order}",
  "- **Kind:** order",
  "- **Prompt:** 排出雨夜列車抵達的順序。",
  "- **Reveals:** [reveal_question:train_sequence]",
  "- **Incomplete Feedback:** 順序尚未完成。",
  "- **Incorrect Feedback:** 班次的前後關係不對。",
  "- **Accepted Order:** [first_train, second_train, last_train]",
  "- **Fixed Anchors:** [first_train@1, last_train@3]",
  "### Card: 第一班 {#first_train}",
  "- **Source:** evidence:first_train_log",
  "- **Summary:** 首班車的刷卡紀錄。",
  "### Card: 第二班 {#second_train}",
  "- **Source:** evidence:second_train_log",
  "- **Summary:** 第二班車的月台紀錄。",
  "### Card: 末班車 {#last_train}",
  "- **Source:** statement:last_train_statement",
  "- **Summary:** 目擊者對末班車的說法。",
  "### Result Dialogue",
  "**相馬律**：列車時序終於吻合。",
  "## Board: 可採信材料 {#proof_threshold}",
  "- **Kind:** threshold",
  "- **Prompt:** 選出足以支持下一步行動的材料。",
  "- **Reveals:** [grant_authorization:station_archive_access]",
  "- **Incomplete Feedback:** 還需要更多可採信材料。",
  "- **Incorrect Feedback:** 這些材料的來源條件不符。",
  "- **Eligible Cards:** [gate_log, reacquired_video]",
  "- **Minimum Selected:** 1",
  "- **Minimum Distinct Source Groups:** 1",
  "- **Required Proof Capabilities:** [time, procedure]",
  "- **Allowed Procedural Statuses:** [reacquired, exhibit]",
  "- **Require Source Group:** true",
  "### Card: 原始閘門紀錄 {#gate_log}",
  "- **Source:** evidence:gate_log",
  "- **Summary:** 站務系統輸出的原始閘門紀錄。",
  "### Card: 再取得影像 {#reacquired_video}",
  "- **Source:** evidence:reacquired_video",
  "- **Summary:** 經程序重新取得的月台影像。",
  "### Result Dialogue",
  "**相馬律**：現在可以正式調閱站務檔案。",
  "## Outro",
  "**相馬律**：下一步去找站務員。",
].join("\n");

describe("analysis-board parser grammar", () => {
  it("accepts story-only board unlock predicates and rejects local predicates", () => {
    // Break caught: exporting the investigation/interrogation grammar for
    // boards would silently admit local predicates that an analysis board
    // cannot evaluate.
    const parseStoryUnlockExpr = Reflect.get(
      unlockGrammar,
      "parseStoryUnlockExpr",
    ) as
      | ((
          source: string,
          sourceFile: string,
          line: number,
        ) =>
          | { ok: true; value: unknown }
          | { ok: false; error: { code: string; line: number } })
      | undefined;

    expect(parseStoryUnlockExpr).toBeTypeOf("function");
    if (!parseStoryUnlockExpr) return;

    expect(
      parseStoryUnlockExpr(
        "fact:timeline_conflict asserted and analysis_board:chapter_1@analysis_scene_1@timeline completed",
        "analysis.md",
        9,
      ),
    ).toMatchObject({
      ok: true,
      value: {
        op: "and",
        left: { predicate: "fact_asserted", id: "timeline_conflict" },
        right: {
          predicate: "analysis_board_completed",
          chapterId: "chapter_1",
          sceneId: "analysis_scene_1",
          boardId: "timeline",
        },
      },
    });
    expect(
      parseStoryUnlockExpr(
        "evidence:train_ticket collected",
        "analysis.md",
        10,
      ),
    ).toMatchObject({
      ok: false,
      error: { code: "unlockUnknownPredicate", line: 10 },
    });
  });

  it("parses source-located classify, order, and threshold boards", () => {
    // Break caught: a parser that treats all boards as one loose shape loses
    // kind-specific authored constraints and the metadata locations Task 4
    // needs for semantic diagnostics.
    const result = parseAnalysisScene(
      VALID_SOURCE,
      "chapter_1/analysis_scene_8.md",
      "analysis_scene_8",
    );

    if (!result.ok) {
      throw new Error(`${result.error.code}: ${result.error.message}`);
    }

    const scene = result.value;
    expect(scene).toMatchObject({
      kind: "analysisScene",
      id: "analysis_scene_8",
      title: "雨夜的推理整理",
      summary: "相馬整理三組互相印證的線索。",
      sourceFile: "chapter_1/analysis_scene_8.md",
      line: 1,
      intro: [
        {
          kind: "line",
          speaker: "相馬律",
          text: "先把能證明的事實分開。",
        },
      ],
      outro: [
        {
          kind: "line",
          speaker: "相馬律",
          text: "下一步去找站務員。",
        },
      ],
    });

    expect(scene.boards).toHaveLength(3);
    const classify = scene.boards[0];
    expect(classify?.kind).toBe("classify");
    if (!classify || classify.kind !== "classify") return;
    expect(classify).toMatchObject({
      id: "source_classification",
      label: "線索分類",
      line: 5,
      prompt: { value: "將卡片分到正確的證據群組。", line: 7 },
      unlock: {
        value: { predicate: "fact_asserted", id: "timeline_conflict" },
        line: 8,
      },
      reveals: {
        value: [{ kind: "assertFact", factId: "source_classified" }],
        line: 9,
      },
      feedback: {
        incomplete: { value: "還有卡片沒有分類。", line: 10 },
        incorrect: { value: "這個來源不支持該分類。", line: 11 },
        hint: { value: "先看每張卡片的來源。", line: 12 },
      },
      resultDialogue: [
        { kind: "line", speaker: "相馬律", text: "來源已經分清楚了。" },
      ],
    });
    expect(classify.cards).toHaveLength(2);
    expect(classify.cards[0]).toMatchObject({
      id: "platform_photo",
      line: 13,
      source: {
        value: { kind: "evidence", id: "platform_photo" },
        line: 14,
      },
      summary: { value: "月台監視器留下的雨衣身影。", line: 15 },
    });
    expect(classify.groups).toHaveLength(2);
    expect(classify.groups[0]).toMatchObject({
      id: "visual",
      line: 19,
      description: { value: "可以直接核對時間的影像。", line: 20 },
      acceptedCards: [{ value: "platform_photo", line: 21 }],
    });

    const order = scene.boards[1];
    expect(order?.kind).toBe("order");
    if (!order || order.kind !== "order") return;
    expect(order).toMatchObject({
      id: "train_order",
      line: 27,
      acceptedOrder: [
        { value: "first_train", line: 33 },
        { value: "second_train", line: 33 },
        { value: "last_train", line: 33 },
      ],
      fixedAnchors: [
        { cardId: "first_train", position: 1, line: 34 },
        { cardId: "last_train", position: 3, line: 34 },
      ],
    });

    const threshold = scene.boards[2];
    expect(threshold?.kind).toBe("threshold");
    if (!threshold || threshold.kind !== "threshold") return;
    expect(threshold).toMatchObject({
      id: "proof_threshold",
      line: 46,
      eligibleCards: [
        { value: "gate_log", line: 52 },
        { value: "reacquired_video", line: 52 },
      ],
      minimumSelected: { value: 1, line: 53 },
      minimumDistinctSourceGroups: { value: 1, line: 54 },
      requiredProofCapabilities: [
        { value: "time", line: 55 },
        { value: "procedure", line: 55 },
      ],
      allowedProceduralStatuses: [
        { value: "reacquired", line: 56 },
        { value: "exhibit", line: 56 },
      ],
      requireSourceGroup: { value: true, line: 57 },
    });
  });

  it("parses a global question-resolved unlock through the analysis parser", () => {
    // Break caught: a story-only analysis unlock must still accept every
    // global StoryPredicate, including question resolution, without falling
    // back to an investigation-local grammar.
    const result = parseAnalysisScene(
      VALID_SOURCE.replace(
        "fact:timeline_conflict asserted",
        "question:train_sequence resolved",
      ),
      "question-unlock.md",
      "analysis_scene_8",
    );

    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.value.boards[0]?.unlock).toMatchObject({
      value: { predicate: "question_resolved", id: "train_sequence" },
      sourceFile: "question-unlock.md",
      line: 8,
    });
  });

  it("accepts a P1-local practice-card source without treating it as evidence", () => {
    // Break caught: the prologue notebook must be a board-local tutorial
    // source, never an ordinary evidence record that can enter the Case File.
    const result = parseAnalysisScene(
      VALID_SOURCE.replace(
        "- **Source:** evidence:platform_photo",
        "- **Source:** practice:p1_receipt_reprint",
      ),
      "chapter_1/analysis_scene_p1_5.md",
      "analysis_scene_p1_5",
    );

    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.value.boards[0]?.cards[0]?.source.value).toEqual({
      kind: "practice",
      id: "p1_receipt_reprint",
    });
  });

  it("parses explicit threshold feedback for a wrong selected card set", () => {
    // Break caught: P1 needs a distinct rebuttal when a player presents the
    // CCTV/change observation alone, rather than collapsing it into generic
    // incomplete feedback.
    const result = parseAnalysisScene(
      VALID_SOURCE.replace(
        "### Result Dialogue\n**相馬律**：現在可以正式調閱站務檔案。",
        [
          "### Incorrect Selection",
          "- **Cards:** [reacquired_video]",
          "- **Feedback:** 這段影像只說明人離開，還沒有說明憑證記錄的是哪個時間。",
          "",
          "### Result Dialogue",
          "**相馬律**：現在可以正式調閱站務檔案。",
        ].join("\n"),
      ),
      "chapter_1/analysis_scene_p1_5.md",
      "analysis_scene_p1_5",
    );

    expect(result).toMatchObject({
      ok: true,
      value: {
        boards: [
          expect.anything(),
          expect.anything(),
          {
            feedback: {
              incorrectSelections: [
                {
                  cards: [{ value: "reacquired_video" }],
                  feedback: {
                    value:
                      "這段影像只說明人離開，還沒有說明憑證記錄的是哪個時間。",
                  },
                },
              ],
            },
          },
        ],
      },
    });
  });

  it.each([
    {
      name: "a nonnumeric scene number",
      source: VALID_SOURCE.replace("# Scene 8:", "# Scene P8:"),
      expected: { code: "analysisSceneMissingTitle", line: 1 },
    },
    {
      name: "a missing result dialogue block",
      source: VALID_SOURCE.replace(
        "### Result Dialogue\n**相馬律**：來源已經分清楚了。\n",
        "",
      ),
      expected: { code: "analysisBoardMissingResultDialogue", line: 5 },
    },
    {
      name: "an unsupported board kind",
      source: VALID_SOURCE.replace("- **Kind:** classify", "- **Kind:** match"),
      expected: { code: "analysisBoardInvalidKind", line: 6 },
    },
    {
      name: "a card source outside evidence and statement",
      source: VALID_SOURCE.replace(
        "- **Source:** evidence:platform_photo",
        "- **Source:** note:platform_photo",
      ),
      expected: { code: "analysisCardInvalidSource", line: 14 },
    },
  ])("reports $name at its authored line", ({ source, expected }) => {
    // Break caught: loose structural/scalar/source parsing can either accept
    // invalid authoring or point writers at the wrong Markdown location.
    const result = parseAnalysisScene(
      source,
      "invalid-analysis.md",
      "analysis",
    );

    expect(result).toMatchObject({
      ok: false,
      error: { ...expected, sourceFile: "invalid-analysis.md" },
    });
  });
});

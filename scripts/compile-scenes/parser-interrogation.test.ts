import { describe, expect, it } from "bun:test";
import { parseInterrogationScene } from "./parser-interrogation";

const VALID_SOURCE = `# Scene 2: 第一次詢問與交叉詢問

## Intro

**相馬律**：先從若槻開始。

## Phase: 若槻蓮初步詢問 {#wakatsuki_inquiry}
- **Kind:** inquiry
- **Required:** true

[場景：警視廳臨時詢問室，深夜，白色日光燈刺眼。]

### Subject: 若槻蓮 {#wakatsuki_ren}
- **Role:** 第一嫌疑人
- **Bio:** 雨鐘咖啡館兼職店員。

### Question: 進倉庫的理由 {#entered_storage}
- **Status:** unlocked
- **Reveals:** [statement:wakatsuki_entered_for_beans]

**相馬律**：你為什麼進倉庫？

**若槻蓮**：我只是去拿咖啡豆。

#### On Reask

**若槻蓮**：我說過了，是咖啡豆。

#### Follow-up: 追問咖啡豆 {#beans_follow_up}
- **Status:** locked
- **Unlock:** question:entered_storage answered
- **Required:** false
- **Reveals:** [evidence:coffee_machine_cleaning_log]

**相馬律**：再說一次咖啡豆的事。

**若槻蓮**：我進倉庫前看到咖啡機還沒清潔。

##### On Reask

**若槻蓮**：我只能確定當時還沒清潔。

## Phase: 若槻蓮的行動證詞 {#wakatsuki_testimony}
- **Kind:** testimony
- **Required:** true
- **Status:** locked
- **Unlock:** statement:wakatsuki_entered_for_beans acquired

[場景：警視廳臨時證據審查室，深夜，投影幕顯示 KAGAMI 門鎖時間線。]

### Subject: 若槻蓮 {#wakatsuki_ren}
- **Role:** 第一嫌疑人
- **Bio:** 雨鐘咖啡館兼職店員。

### Testimony

#### Statement: 清潔鍵 {#cleaning_button}
- **Content:** 我出來後，立刻按下清潔鍵。
- **Contradiction:** evidence:coffee_machine_cleaning_log
- **On Correct:** breakthrough_cleaning_time
- **On Wrong:** wrong_time_record

##### On Press

**相馬律**：你說立刻？

##### On Present

**相馬律**：這份清潔紀錄能說明時間。

##### On Wrong Present

**神谷澪**：那份資料不夠。

### Result: breakthrough_cleaning_time {#breakthrough_cleaning_time}
- **Reveals:** [statement:kagami_timeline_inconsistent]

**相馬律**：這和門鎖時間線矛盾。

### Result: wrong_time_record {#wrong_time_record}

**早坂茜**：還不夠。

## Evidence Manifest

### evidence:coffee_machine_cleaning_log {#coffee_machine_cleaning_log}
- **Name:** 咖啡機清潔紀錄
- **Description:** 咖啡機自動記錄的清潔模式啟動時間。
- **Details:** 清潔模式啟動時間為 21:13:29。

#### On Collect

**相馬律**：時間不一致。

## Statement Manifest

### statement:wakatsuki_entered_for_beans {#wakatsuki_entered_for_beans}
- **Speaker:** 若槻蓮
- **Content:** 「我進倉庫只是拿咖啡豆。」

#### On Acquire

**若槻蓮**：我只是拿咖啡豆。

### statement:kagami_timeline_inconsistent {#kagami_timeline_inconsistent}
- **Speaker:** 相馬律
- **Content:** 「門鎖時間線和咖啡機紀錄不一致。」

#### On Acquire

**相馬律**：至少有一份時間紀錄不成立。

## Outro

**相馬律**：先到這裡。
`;

describe("parseInterrogationScene", () => {
  it("parses inquiry and testimony phases in one scene", () => {
    const parsed = parseInterrogationScene(VALID_SOURCE, "chapter_1/interrogation_scene_2.md", "interrogation_scene_2");
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.kind).toBe("interrogationScene");
    expect(parsed.value.phases.map((p) => p.kind)).toEqual(["inquiry", "testimony"]);
    expect(parsed.value.phases[0]!.id).toBe("wakatsuki_inquiry");
    expect(parsed.value.phases[1]!.id).toBe("wakatsuki_testimony");
    const inquiry = parsed.value.phases[0]!;
    expect(inquiry.kind).toBe("inquiry");
    if (inquiry.kind === "inquiry") {
      expect(inquiry.questions[0]!.onReask).toEqual([
        {
          kind: "line",
          speaker: "若槻蓮",
          text: "我說過了，是咖啡豆。",
          expression: null,
          portrait: null,
        },
      ]);
      expect(inquiry.questions[1]).toMatchObject({
        id: "beans_follow_up",
        kind: "followUp",
        parentQuestionId: "entered_storage",
        status: "locked",
        required: false,
        reveals: [{ kind: "evidence", id: "coffee_machine_cleaning_log" }],
      });
      expect(inquiry.questions[1]!.unlock).toEqual({
        predicate: "question_answered",
        id: "entered_storage",
      });
      expect(inquiry.questions[1]!.onReask).toEqual([
        {
          kind: "line",
          speaker: "若槻蓮",
          text: "我只能確定當時還沒清潔。",
          expression: null,
          portrait: null,
        },
      ]);
    }
    const testimony = parsed.value.phases[1]!;
    expect(testimony.kind).toBe("testimony");
    if (testimony.kind === "testimony") {
      expect(testimony.unlock).toEqual({
        predicate: "statement_acquired",
        id: "wakatsuki_entered_for_beans",
      });
      expect(testimony.statements[0]!.contradiction).toEqual({
        kind: "evidence",
        id: "coffee_machine_cleaning_log",
      });
      expect(testimony.statements[0]!.onCorrect).toBe("breakthrough_cleaning_time");
      expect(testimony.statements[0]!.onWrong).toBe("wrong_time_record");
      expect(testimony.results[0]!.reveals).toContainEqual({
        kind: "statement",
        id: "kagami_timeline_inconsistent",
      });
    }
    expect(parsed.value.evidenceManifest[0]!.id).toBe("coffee_machine_cleaning_log");
    expect(parsed.value.statementManifest.map((s) => s.id)).toContain("kagami_timeline_inconsistent");
  });

  it("parses phase background and audio metadata", () => {
    const parsed = parseInterrogationScene(
      VALID_SOURCE.replace(
        "- **Required:** true\n\n[場景：警視廳臨時詢問室",
        "- **Required:** true\n- **Background Prompt:** Harsh police interview room at night.\n- **BGM:** rain_mystery_low\n- **BGS:** none\n\n[場景：警視廳臨時詢問室",
      ),
      "chapter_1/interrogation_scene_2.md",
      "interrogation_scene_2",
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.phases[0]?.assetCue).toMatchObject({
      backgroundPrompt: "Harsh police interview room at night.",
      bgm: { channel: "bgm", assetId: "rain_mystery_low" },
      bgs: { channel: "bgs", assetId: null },
    });
  });

  it("rejects evidence image metadata on a phase", () => {
    const parsed = parseInterrogationScene(
      VALID_SOURCE.replace(
        "- **Required:** true\n\n[場景：警視廳臨時詢問室",
        "- **Required:** true\n- **Image Prompt:** Small brass key on transparent background.\n\n[場景：警視廳臨時詢問室",
      ),
      "chapter_1/interrogation_scene_2.md",
      "interrogation_scene_2",
    );
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error.code).toBe("assetMetadataUnknownKey");
  });

  it("rejects reserved asset metadata on a question", () => {
    const parsed = parseInterrogationScene(
      VALID_SOURCE.replace(
        "- **Status:** unlocked\n- **Reveals:** [statement:wakatsuki_entered_for_beans]",
        "- **Status:** unlocked\n- **Background Prompt:** Harsh police interview room at night.\n- **Reveals:** [statement:wakatsuki_entered_for_beans]",
      ),
      "chapter_1/interrogation_scene_2.md",
      "interrogation_scene_2",
    );
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error.code).toBe("assetMetadataUnknownKey");
  });

  it("rejects a phase without a subject", () => {
    const source = VALID_SOURCE.replace(/### Subject:[\s\S]*?### Question:/, "### Question:");
    const parsed = parseInterrogationScene(source, "bad.md", "interrogation_scene_2");
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error.code).toBe("interrogationPhaseMissingSubject");
  });

  it("rejects a phase with duplicate subjects", () => {
    const source = VALID_SOURCE.replace(
      "### Question: 進倉庫的理由",
      `### Subject: 若槻蓮 {#wakatsuki_ren_duplicate}
- **Role:** 第一嫌疑人
- **Bio:** 重複的詢問對象。

### Question: 進倉庫的理由`,
    );
    const parsed = parseInterrogationScene(source, "bad.md", "interrogation_scene_2");
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error.code).toBe("interrogationPhaseDuplicateSubject");
  });

  it("rejects a testimony phase with duplicate testimony containers", () => {
    const source = VALID_SOURCE.replace(
      "### Result: breakthrough_cleaning_time",
      `### Testimony

### Result: breakthrough_cleaning_time`,
    );
    const parsed = parseInterrogationScene(source, "bad.md", "interrogation_scene_2");
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error.code).toBe("testimonyDuplicateContainer");
  });

  it("rejects an interrogation scene with no phases", () => {
    const source = VALID_SOURCE.replace(/## Phase:[\s\S]*?## Evidence Manifest/, "## Evidence Manifest");
    const parsed = parseInterrogationScene(source, "bad.md", "interrogation_scene_2");
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error.code).toBe("interrogationSceneNoPhases");
  });

  it("rejects an unlocked phase with Unlock metadata", () => {
    const source = VALID_SOURCE.replace("- **Status:** locked", "- **Status:** unlocked");
    const parsed = parseInterrogationScene(source, "bad.md", "interrogation_scene_2");
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error.code).toBe("unlockOnNonLockedBlock");
  });

  it("rejects a default-unlocked question with Unlock metadata", () => {
    const source = VALID_SOURCE.replace(
      "- **Status:** unlocked\n- **Reveals:** [statement:wakatsuki_entered_for_beans]",
      "- **Unlock:** statement:wakatsuki_entered_for_beans acquired\n- **Reveals:** [statement:wakatsuki_entered_for_beans]",
    );
    const parsed = parseInterrogationScene(source, "bad.md", "interrogation_scene_2");
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error.code).toBe("unlockOnNonLockedBlock");
  });

  it("rejects a default-unlocked follow-up with Unlock metadata", () => {
    const source = VALID_SOURCE.replace(
      "\n## Phase: 若槻蓮的行動證詞",
      `
#### Follow-up: 追問咖啡豆 {#beans_follow_up}
- **Unlock:** question:entered_storage answered

**相馬律**：再說一次咖啡豆的事。

## Phase: 若槻蓮的行動證詞`,
    );
    const parsed = parseInterrogationScene(source, "bad.md", "interrogation_scene_2");
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error.code).toBe("unlockOnNonLockedBlock");
  });

  it("rejects an inquiry phase with no questions", () => {
    const source = VALID_SOURCE.replace(/### Question:[\s\S]*?## Phase:/, "## Phase:");
    const parsed = parseInterrogationScene(source, "bad.md", "interrogation_scene_2");
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error.code).toBe("interrogationInquiryNoQuestions");
  });

  it("rejects a testimony phase with no results", () => {
    const source = VALID_SOURCE.replace(/### Result: breakthrough_cleaning_time[\s\S]*?## Evidence Manifest/, "## Evidence Manifest");
    const parsed = parseInterrogationScene(source, "bad.md", "interrogation_scene_2");
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error.code).toBe("testimonyNoResults");
  });
});

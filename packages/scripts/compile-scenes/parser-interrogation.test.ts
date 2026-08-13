import { describe, expect, it } from "vitest";
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

#### Testimony
- **On Loop:** **相馬律**：還有哪裡對不上，再說一次。
- **Loop Prompt:** **相馬律**：從頭再聽一次。
- **Wrong Reply:** **相馬律**：不對，這不是關鍵。

##### Line: 拿咖啡豆的說法 {#l_beans}
**若槻蓮**：我只是去拿咖啡豆。

##### Line: 清潔紀錄的說法 {#l_cleaning}
**若槻蓮**：我進倉庫前看到咖啡機還沒清潔。
- **Contradiction:** evidence:coffee_machine_cleaning_log
- **Challenge:** **相馬律**：這份紀錄顯示你進去前已經清潔過了。
- **On Correct:** **若槻蓮**：好吧，我看到的其實是清潔完成後的畫面。
  - **Reveals:** [statement:kagami_timeline_inconsistent]
- **On Wrong Evidence:** **若槻蓮**：這能證明什麼？

### Question: 追問咖啡豆 {#beans_follow_up}
- **Status:** locked
- **Unlock:** question:entered_storage answered
- **Required:** false
- **Reveals:** [evidence:coffee_machine_cleaning_log]

#### Testimony
- **On Loop:** **相馬律**：再說一次咖啡豆的事。

##### Line: 忘了清潔 {#l_follow}
**若槻蓮**：我只能確定當時還沒清潔。

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
- **Source Kind:** testimony
- **Representation Layer:** raw
- **Procedural Status:** lead
- **Completeness:** partial
- **Confidence:** disputed
- **Source Group:** wakatsuki_account
- **Source Label:** 若槻蓮最初證詞
- **Proof Capabilities:** [credibility, identity]
- **Supersedes:** statement:initial_witness_account

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
  it("parses an immediate authored Summary", () => {
    const parsed = parseInterrogationScene(
      VALID_SOURCE.replace(
        "# Scene 2: 第一次詢問與交叉詢問",
        "# Scene 2: 第一次詢問與交叉詢問\n\n- **Summary:** 相馬開始第一次詢問。",
      ),
      "chapter_1/interrogation_scene_2.md",
      "interrogation_scene_2",
    );

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.summary).toBe("相馬開始第一次詢問。");
    expect(parsed.value.summaryAuthored).toBe(true);
  });

  it("rejects a malformed H1 title", () => {
    const parsed = parseInterrogationScene(
      "# Not a scene",
      "chapter_1/interrogation_scene_2.md",
      "interrogation_scene_2",
    );

    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error.code).toBe("interrogationSceneMissingTitle");
  });

  it("parses an inquiry phase with cross-examined testimony, evidence, and statement manifests", () => {
    const parsed = parseInterrogationScene(
      VALID_SOURCE,
      "chapter_1/interrogation_scene_2.md",
      "interrogation_scene_2",
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.kind).toBe("interrogationScene");
    expect(parsed.value.phases.map((p) => p.kind)).toEqual(["inquiry"]);
    expect(parsed.value.phases[0]!.id).toBe("wakatsuki_inquiry");

    const phase = parsed.value.phases[0]!;
    expect(phase.questions.map((q) => q.id)).toEqual([
      "entered_storage",
      "beans_follow_up",
    ]);

    const entered = phase.questions[0]!;
    expect(entered.reveals).toEqual([
      { kind: "statement", id: "wakatsuki_entered_for_beans" },
    ]);
    expect(entered.testimony.onLoop.length).toBeGreaterThan(0);
    expect(entered.testimony.lines.map((l) => l.id)).toEqual([
      "l_beans",
      "l_cleaning",
    ]);
    const cleaningLine = entered.testimony.lines[1]!;
    expect(cleaningLine.contradiction).toEqual({
      kind: "evidence",
      id: "coffee_machine_cleaning_log",
    });
    expect(cleaningLine.challenge).not.toBeNull();
    expect(cleaningLine.onCorrect).not.toBeNull();
    expect(cleaningLine.onWrongEvidence).not.toBeNull();
    expect(cleaningLine.reveals).toContainEqual({
      kind: "statement",
      id: "kagami_timeline_inconsistent",
    });

    const followUp = phase.questions[1]!;
    expect(followUp.status).toBe("locked");
    expect(followUp.required).toBe(false);
    expect(followUp.unlock).toEqual({
      predicate: "question_answered",
      id: "entered_storage",
    });
    expect(followUp.reveals).toEqual([
      { kind: "evidence", id: "coffee_machine_cleaning_log" },
    ]);

    expect(parsed.value.evidenceManifest[0]!.id).toBe(
      "coffee_machine_cleaning_log",
    );
    expect(parsed.value.statementManifest.map((s) => s.id)).toContain(
      "kagami_timeline_inconsistent",
    );
    expect(parsed.value.statementManifest[0]?.provenance).toMatchObject({
      sourceKind: { value: "testimony", line: 65 },
      representationLayer: { value: "raw", line: 66 },
      proceduralStatus: { value: "lead", line: 67 },
      completeness: { value: "partial", line: 68 },
      confidence: { value: "disputed", line: 69 },
      sourceGroupId: { value: "wakatsuki_account", line: 70 },
      sourceLabel: { value: "若槻蓮最初證詞", line: 71 },
      proofCapabilities: [
        { value: "credibility", line: 72 },
        { value: "identity", line: 72 },
      ],
      supersedes: {
        kind: "statement",
        id: "initial_witness_account",
        line: 73,
      },
    });
  });

  it("parses the optional represented authority on an inquiry phase", () => {
    const parsed = parseInterrogationScene(
      VALID_SOURCE.replace(
        "- **Kind:** inquiry\n- **Required:** true",
        "- **Kind:** inquiry\n- **Required:** true\n- **Represented Authority:** KAGAMI 證據摘要審查會主理",
      ),
      "chapter_1/interrogation_scene_2.md",
      "interrogation_scene_2",
    );

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.phases[0]?.representedAuthority).toBe(
      "KAGAMI 證據摘要審查會主理",
    );
  });

  it("keeps unannotated statement provenance absent in the AST", () => {
    const parsed = parseInterrogationScene(
      VALID_SOURCE,
      "chapter_1/interrogation_scene_2.md",
      "interrogation_scene_2",
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.statementManifest[1]?.provenance).toEqual({
      sourceKind: null,
      representationLayer: null,
      proceduralStatus: null,
      completeness: null,
      confidence: null,
      sourceGroupId: null,
      sourceLabel: null,
      proofCapabilities: [],
      supersedes: null,
    });
  });

  it("rejects Image Prompt on a statement at its authored line", () => {
    const parsed = parseInterrogationScene(
      VALID_SOURCE.replace(
        "- **Content:** 「我進倉庫只是拿咖啡豆。」",
        "- **Content:** 「我進倉庫只是拿咖啡豆。」\n- **Image Prompt:** prohibited",
      ),
      "chapter_1/interrogation_scene_2.md",
      "interrogation_scene_2",
    );
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error).toMatchObject({
      code: "caseRecordMetadataUnknownKey",
      line: 65,
    });
  });

  it("parses intro scene tag background metadata", () => {
    const parsed = parseInterrogationScene(
      VALID_SOURCE.replace(
        "## Intro\n\n**相馬律**：先從若槻開始。",
        "## Intro\n\n[場景：警署等待區，深夜。]\n- **Background Prompt:** Late-night police waiting area.\n\n**相馬律**：先從若槻開始。",
      ),
      "chapter_1/interrogation_scene_2.md",
      "interrogation_scene_2",
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.intro[0]).toMatchObject({
      kind: "sceneTag",
      text: "警署等待區，深夜。",
      assetCue: {
        backgroundPrompt: "Late-night police waiting area.",
        backgroundAssetId: null,
      },
    });
  });

  it("rejects arbitrary unknown metadata after an intro scene tag", () => {
    // Only Background Prompt / BGM / BGS are permitted on a scene tag.
    // Anything else — typos, stray keys — must fail fast so authoring
    // mistakes aren't silently dropped by parseVisualAssetCue.
    const parsed = parseInterrogationScene(
      VALID_SOURCE.replace(
        "## Intro\n\n**相馬律**：先從若槻開始。",
        "## Intro\n\n[場景：警署等待區，深夜。]\n- **BackgroundPromt:** typoed-key\n\n**相馬律**：先從若槻開始。",
      ),
      "chapter_1/interrogation_scene_2.md",
      "interrogation_scene_2",
    );
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error.code).toBe("assetMetadataUnknownKey");
    expect(parsed.error.message).toContain("BackgroundPromt");
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
    const source = VALID_SOURCE.replace(
      /### Subject:[\s\S]*?### Question:/,
      "### Question:",
    );
    const parsed = parseInterrogationScene(
      source,
      "bad.md",
      "interrogation_scene_2",
    );
    expect(parsed.ok).toBe(false);
    if (!parsed.ok)
      expect(parsed.error.code).toBe("interrogationPhaseMissingSubject");
  });

  it("rejects a phase with duplicate subjects", () => {
    const source = VALID_SOURCE.replace(
      "### Question: 進倉庫的理由",
      `### Subject: 若槻蓮 {#wakatsuki_ren_duplicate}
- **Role:** 第一嫌疑人
- **Bio:** 重複的詢問對象。

### Question: 進倉庫的理由`,
    );
    const parsed = parseInterrogationScene(
      source,
      "bad.md",
      "interrogation_scene_2",
    );
    expect(parsed.ok).toBe(false);
    if (!parsed.ok)
      expect(parsed.error.code).toBe("interrogationPhaseDuplicateSubject");
  });

  it("rejects an interrogation scene with no phases", () => {
    const source = VALID_SOURCE.replace(
      /## Phase:[\s\S]*?## Evidence Manifest/,
      "## Evidence Manifest",
    );
    const parsed = parseInterrogationScene(
      source,
      "bad.md",
      "interrogation_scene_2",
    );
    expect(parsed.ok).toBe(false);
    if (!parsed.ok)
      expect(parsed.error.code).toBe("interrogationSceneNoPhases");
  });

  it("rejects an unlocked phase with Unlock metadata", () => {
    const source = `# Scene 9: 測試

## Phase: 測試階段 {#test_phase}
- **Kind:** inquiry
- **Status:** unlocked
- **Unlock:** statement:some_statement acquired

## Outro
`;
    const parsed = parseInterrogationScene(
      source,
      "bad.md",
      "interrogation_scene_9",
    );
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error.code).toBe("unlockOnNonLockedBlock");
  });

  it("rejects a default-unlocked question with Unlock metadata", () => {
    const source = VALID_SOURCE.replace(
      "- **Status:** unlocked\n- **Reveals:** [statement:wakatsuki_entered_for_beans]",
      "- **Unlock:** statement:wakatsuki_entered_for_beans acquired\n- **Reveals:** [statement:wakatsuki_entered_for_beans]",
    );
    const parsed = parseInterrogationScene(
      source,
      "bad.md",
      "interrogation_scene_2",
    );
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error.code).toBe("unlockOnNonLockedBlock");
  });

  it("rejects an inquiry phase with no questions", () => {
    const source = VALID_SOURCE.replace(
      /### Question:[\s\S]*?## Evidence Manifest/,
      "## Evidence Manifest",
    );
    const parsed = parseInterrogationScene(
      source,
      "bad.md",
      "interrogation_scene_2",
    );
    expect(parsed.ok).toBe(false);
    if (!parsed.ok)
      expect(parsed.error.code).toBe("interrogationInquiryNoQuestions");
  });

  it("rejects a question with no #### Testimony block", () => {
    const source = `# Scene 9: 測試

## Phase: 測試階段 {#test_phase}
- **Kind:** inquiry

[場景：測試場景]

### Subject: 測試對象 {#subject_x}
- **Role:** 角色
- **Bio:** 簡介。

### Question: 沒有證詞的問題 {#no_testimony}
- **Status:** unlocked

## Outro
`;
    const parsed = parseInterrogationScene(
      source,
      "bad.md",
      "interrogation_scene_9",
    );
    expect(parsed.ok).toBe(false);
    if (!parsed.ok)
      expect(parsed.error.code).toBe("interrogationQuestionMissingTestimony");
  });

  it("rejects a #### Testimony with no On Loop", () => {
    const source = `# Scene 9: 測試

## Phase: 測試階段 {#test_phase}
- **Kind:** inquiry

[場景：測試場景]

### Subject: 測試對象 {#subject_x}
- **Role:** 角色
- **Bio:** 簡介。

### Question: 缺起手台詞的問題 {#missing_on_loop}
- **Status:** unlocked

#### Testimony

## Outro
`;
    const parsed = parseInterrogationScene(
      source,
      "bad.md",
      "interrogation_scene_9",
    );
    expect(parsed.ok).toBe(false);
    if (!parsed.ok)
      expect(parsed.error.code).toBe("interrogationMissingOnLoop");
  });

  it("rejects a #### Testimony with On Loop but zero ##### Line entries", () => {
    const source = `# Scene 9: 測試

## Phase: 測試階段 {#test_phase}
- **Kind:** inquiry

[場景：測試場景]

### Subject: 測試對象 {#subject_x}
- **Role:** 角色
- **Bio:** 簡介。

### Question: 沒有台詞的問題 {#empty_testimony}
- **Status:** unlocked

#### Testimony
- **On Loop:** **相馬律**：還有哪裡對不上，再說一次。

## Outro
`;
    const parsed = parseInterrogationScene(
      source,
      "bad.md",
      "interrogation_scene_9",
    );
    expect(parsed.ok).toBe(false);
    if (!parsed.ok)
      expect(parsed.error.code).toBe("interrogationEmptyTestimony");
  });

  it("rejects a multi-Line honest (no Contradiction) Testimony, since only the first Line plays", () => {
    const source = `# Scene 9: 測試

## Phase: 測試階段 {#test_phase}
- **Kind:** inquiry

[場景：測試場景]

### Subject: 測試對象 {#subject_x}
- **Role:** 角色
- **Bio:** 簡介。

### Question: 多行誠實問題 {#multi_line_honest}
- **Status:** unlocked

#### Testimony
- **On Loop:** **相馬律**：還有哪裡對不上，再說一次。

##### Line: 第一行 {#l_honest_a}
**若槻蓮**：我只是去拿咖啡豆。

##### Line: 第二行會被靜默丟棄 {#l_honest_b}
**若槻蓮**：然後我就離開了。

## Outro
`;
    const parsed = parseInterrogationScene(
      source,
      "bad.md",
      "interrogation_scene_9",
    );
    expect(parsed.ok).toBe(false);
    if (!parsed.ok)
      expect(parsed.error.code).toBe(
        "interrogationHonestTestimonyMultipleLines",
      );
  });

  it("accepts a single-Line honest (no Contradiction) Testimony", () => {
    const source = `# Scene 9: 測試

## Phase: 測試階段 {#test_phase}
- **Kind:** inquiry

[場景：測試場景]

### Subject: 測試對象 {#subject_x}
- **Role:** 角色
- **Bio:** 簡介。

### Question: 單行誠實問題 {#single_line_honest}
- **Status:** unlocked

#### Testimony
- **On Loop:** **相馬律**：還有哪裡對不上，再說一次。

##### Line: 唯一行 {#l_honest_only}
**若槻蓮**：我只是去拿咖啡豆。

## Outro
`;
    const parsed = parseInterrogationScene(
      source,
      "ok.md",
      "interrogation_scene_9",
    );
    expect(parsed.ok).toBe(true);
  });

  it("rejects a ##### Line with Contradiction but no Challenge", () => {
    const source = `# Scene 9: 測試

## Phase: 測試階段 {#test_phase}
- **Kind:** inquiry

[場景：測試場景]

### Subject: 測試對象 {#subject_x}
- **Role:** 角色
- **Bio:** 簡介。

### Question: 缺挑戰的問題 {#missing_challenge}
- **Status:** unlocked

#### Testimony
- **On Loop:** **相馬律**：還有哪裡對不上，再說一次。

##### Line: 矛盾但缺挑戰 {#l_missing_challenge}
**若槻蓮**：我只是去拿咖啡豆。
- **Contradiction:** evidence:some_evidence

## Outro
`;
    const parsed = parseInterrogationScene(
      source,
      "bad.md",
      "interrogation_scene_9",
    );
    expect(parsed.ok).toBe(false);
    if (!parsed.ok)
      expect(parsed.error.code).toBe("interrogationMissingChallenge");
  });

  it("rejects a ##### Line with Contradiction and Challenge but no On Correct", () => {
    const source = `# Scene 9: 測試

## Phase: 測試階段 {#test_phase}
- **Kind:** inquiry

[場景：測試場景]

### Subject: 測試對象 {#subject_x}
- **Role:** 角色
- **Bio:** 簡介。

### Question: 缺正確回應的問題 {#missing_on_correct}
- **Status:** unlocked

#### Testimony
- **On Loop:** **相馬律**：還有哪裡對不上，再說一次。

##### Line: 矛盾但缺正確回應 {#l_missing_on_correct}
**若槻蓮**：我只是去拿咖啡豆。
- **Contradiction:** evidence:some_evidence
- **Challenge:** **相馬律**：這份紀錄顯示你進去前已經清潔過了。

## Outro
`;
    const parsed = parseInterrogationScene(
      source,
      "bad.md",
      "interrogation_scene_9",
    );
    expect(parsed.ok).toBe(false);
    if (!parsed.ok)
      expect(parsed.error.code).toBe("interrogationMissingOnCorrect");
  });

  it("rejects a ##### Line with Contradiction, Challenge, and On Correct but no On Wrong Evidence", () => {
    const source = `# Scene 9: 測試

## Phase: 測試階段 {#test_phase}
- **Kind:** inquiry

[場景：測試場景]

### Subject: 測試對象 {#subject_x}
- **Role:** 角色
- **Bio:** 簡介。

### Question: 缺誤指證據回應的問題 {#missing_on_wrong_evidence}
- **Status:** unlocked

#### Testimony
- **On Loop:** **相馬律**：還有哪裡對不上，再說一次。

##### Line: 矛盾但缺誤指證據回應 {#l_missing_on_wrong_evidence}
**若槻蓮**：我只是去拿咖啡豆。
- **Contradiction:** evidence:some_evidence
- **Challenge:** **相馬律**：這份紀錄顯示你進去前已經清潔過了。
- **On Correct:** **若槻蓮**：好吧，我看到的其實是清潔完成後的畫面。

## Outro
`;
    const parsed = parseInterrogationScene(
      source,
      "bad.md",
      "interrogation_scene_9",
    );
    expect(parsed.ok).toBe(false);
    if (!parsed.ok)
      expect(parsed.error.code).toBe("interrogationMissingOnWrongEvidence");
  });

  it("rejects a ##### Line heading with no leading suspect dialogue", () => {
    const source = `# Scene 9: 測試

## Phase: 測試階段 {#test_phase}
- **Kind:** inquiry

[場景：測試場景]

### Subject: 測試對象 {#subject_x}
- **Role:** 角色
- **Bio:** 簡介。

### Question: 沒有台詞內容的問題 {#empty_line}
- **Status:** unlocked

#### Testimony
- **On Loop:** **相馬律**：還有哪裡對不上，再說一次。

##### Line: 沒有台詞 {#l_empty}
- **Contradiction:** evidence:some_evidence

## Outro
`;
    const parsed = parseInterrogationScene(
      source,
      "bad.md",
      "interrogation_scene_9",
    );
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error.code).toBe("interrogationEmptyLine");
  });
});

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

describe("parseInterrogationScene — question/testimony/line (xexam)", () => {
  it("parses questions with testimony lines and contradiction metadata", () => {
    const res = parseInterrogationScene(
      XEXAM_SRC,
      "interrogation_scene_1.md",
      "interrogation_scene_1",
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const phase = res.value.phases[0]!;
    expect(phase.kind).toBe("inquiry");
    const q = phase.questions[0]!;
    expect(q.id).toBe("alibi");
    expect(q.testimony.onLoop.length).toBeGreaterThan(0);
    expect(q.testimony.lines.map((l) => l.id)).toEqual(["l_off", "l_deny"]);
    const deny = q.testimony.lines[1]!;
    expect(deny.contradiction).toEqual({
      kind: "evidence",
      id: "cleaning_log",
    });
    expect(deny.challenge).not.toBeNull();
    expect(deny.onCorrect).not.toBeNull();
    expect(deny.onWrongEvidence).not.toBeNull();
    expect(deny.reveals).toContainEqual({
      kind: "question",
      id: "cleaning_time",
    });
    expect(phase.questions[1]!.status).toBe("locked");
  });
});

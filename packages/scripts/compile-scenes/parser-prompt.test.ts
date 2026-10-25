import { describe, expect, it } from "vitest";
import {
  deriveDialogueSegments,
  resolveDialogueItemSource,
} from "./dialogue-segment-origins";
import { emitLinearScene } from "./emitter";
import { parseInterrogationScene } from "./parser-interrogation";
import { parseLinearScene } from "./parser-linear";
import { tokenize } from "./tokenizer";

const PROMPT = `
> 推理：那 89.7 秒說明了什麼？
> - [x] 摘要把合併的時間當成了事件時間
> - [ ] 三宅說了謊 → **早坂茜**：他的小謊和這段時間無關。

> - [ ] 門鎖當晚故障 → [門鎖的紀錄一直完整。]
`.trim();

function linear(body: string) {
  return parseLinearScene(
    `# Scene 2: 摘要\n\n**相馬律**：先看時間。\n\n${body}\n\n**早坂茜**：對。`,
    "scene_2.md",
    "scene_2",
  );
}

function errorCode(body: string): string | null {
  const result = linear(body);
  return result.ok ? null : result.error.code;
}

describe("推理 prompts", () => {
  it("tokenizes the question and its option lines as one block", () => {
    const tokens = tokenize(`${PROMPT}\n\n**早坂茜**：對。`, "scene.md");
    expect(tokens.map((token) => token.kind)).toEqual(["prompt", "dialogue"]);
    expect(tokens[0]).toMatchObject({
      kind: "prompt",
      question: "那 89.7 秒說明了什麼？",
      line: 1,
      options: [
        { text: "[x] 摘要把合併的時間當成了事件時間", line: 2 },
        {
          text: "[ ] 三宅說了謊 → **早坂茜**：他的小謊和這段時間無關。",
          line: 3,
        },
        { text: "[ ] 門鎖當晚故障 → [門鎖的紀錄一直完整。]", line: 5 },
      ],
    });
  });

  it("parses options, the answer and each wrong reply in a linear scene", () => {
    const result = linear(PROMPT);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.queue.map((item) => item.kind)).toEqual([
      "line",
      "prompt",
      "line",
    ]);
    expect(result.value.queue[1]).toEqual({
      kind: "prompt",
      question: "那 89.7 秒說明了什麼？",
      options: [
        { label: "摘要把合併的時間當成了事件時間", correct: true, reply: null },
        {
          label: "三宅說了謊",
          correct: false,
          reply: { speaker: "早坂茜", text: "他的小謊和這段時間無關。" },
        },
        {
          label: "門鎖當晚故障",
          correct: false,
          reply: { speaker: null, text: "門鎖的紀錄一直完整。" },
        },
      ],
      sourceLine: 5,
    });
  });

  it("emits the prompt into scene JSON without compiler-only fields", () => {
    const result = linear(PROMPT);
    if (!result.ok) throw new Error(result.error.message);
    const emitted = emitLinearScene(result.value);
    expect(emitted.queue[1]).toEqual({
      kind: "prompt",
      question: "那 89.7 秒說明了什麼？",
      options: [
        { label: "摘要把合併的時間當成了事件時間", correct: true, reply: null },
        {
          label: "三宅說了謊",
          correct: false,
          reply: { speaker: "早坂茜", text: "他的小謊和這段時間無關。" },
        },
        {
          label: "門鎖當晚故障",
          correct: false,
          reply: { speaker: null, text: "門鎖的紀錄一直完整。" },
        },
      ],
    });
  });

  it.each([
    ["one option", "> 推理：問？\n> - [x] 答", "promptOptionCount"],
    [
      "five options",
      [
        "> 推理：問？",
        "> - [x] A",
        "> - [ ] B → [b]",
        "> - [ ] C → [c]",
        "> - [ ] D → [d]",
        "> - [ ] E → [e]",
      ].join("\n"),
      "promptOptionCount",
    ],
    [
      "no correct option",
      "> 推理：問？\n> - [ ] A → [a]\n> - [ ] B → [b]",
      "promptCorrectOptionCount",
    ],
    [
      "two correct options",
      "> 推理：問？\n> - [x] A\n> - [x] B",
      "promptCorrectOptionCount",
    ],
    [
      "a wrong option without a reply",
      "> 推理：問？\n> - [x] A\n> - [ ] B",
      "promptWrongOptionMissingReply",
    ],
    [
      "a reply on the correct option",
      "> 推理：問？\n> - [x] A → [a]\n> - [ ] B → [b]",
      "promptCorrectOptionHasReply",
    ],
    [
      "an option without a checkbox",
      "> 推理：問？\n> - [x] A\n> - B → [b]",
      "promptOptionMalformed",
    ],
    [
      "a repeated option",
      "> 推理：問？\n> - [x] A\n> - [ ] A → [a]",
      "promptDuplicateOption",
    ],
    [
      "a reply with an expression",
      "> 推理：問？\n> - [x] A\n> - [ ] B → **早坂茜**[stern]：不對。",
      "promptReplyMalformed",
    ],
    [
      "a reply that is not a line",
      "> 推理：問？\n> - [x] A\n> - [ ] B → 不對。",
      "promptReplyMalformed",
    ],
  ])("rejects %s", (_name, body, code) => {
    expect(errorCode(body)).toBe(code);
  });

  it("flags a compiled prompt as stale when its options change in the source", () => {
    const result = linear(PROMPT);
    if (!result.ok) throw new Error(result.error.message);
    const json = emitLinearScene(result.value);
    const sourceAt = (sourceAst: typeof result.value) =>
      resolveDialogueItemSource(
        deriveDialogueSegments({ chapterId: "chapter_1", json, sourceAst }),
        "main",
        1,
      );

    expect(sourceAt(result.value)).toMatchObject({ ok: true });

    const edited = structuredClone(result.value);
    const prompt = edited.queue[1];
    if (prompt?.kind !== "prompt") throw new Error("expected the prompt");
    prompt.options[1]!.label = "三宅隱瞞了時間";
    expect(sourceAt(edited)).toMatchObject({
      ok: false,
      reason: "stale",
      error: { code: "workbenchSourceCarrierStale" },
    });
  });

  it("rejects a stray option line with no question", () => {
    expect(errorCode("> - [x] A")).toBe("linearSceneUnknownLine");
  });

  it("rejects a prompt inside interrogation testimony", () => {
    const source = `
# Scene 1: 測試詢問

## Phase: 初步詢問 {#inquiry}

- **Kind:** inquiry
- **Required:** true

[場景：詢問室。]

### Subject: 若槻蓮 {#wakatsuki_ren}

- **Role:** 嫌疑人
- **Bio:** 店員。

### Question: 進倉庫的理由 {#entered_storage}

- **Status:** unlocked

#### Testimony

- **On Loop:** **相馬律**：再說一次。

##### Line: 拿咖啡豆 {#l_beans}

**若槻蓮**：我只是去拿咖啡豆。

> 推理：他在說謊嗎？
> - [x] 是
> - [ ] 不是 → [再聽一次。]

- **Contradiction:** evidence:cleaning_log
`.trim();
    const result = parseInterrogationScene(
      source,
      "interrogation_scene_1.md",
      "interrogation_scene_1",
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("promptNotAllowedInTestimony");
  });
});

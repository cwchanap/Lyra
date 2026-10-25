import { describe, expect, it } from "vitest";
import { compileCaseRecordCorpus } from "./case-record-provenance";
import { emitInvestigationScene } from "./emitter";
import { parseInvestigationScene } from "./parser-investigation";
import { emptyStoryCatalog } from "./parser-story-catalog";
import type { ASTChapter, ASTInvestigationScene, ASTTopic } from "./types";
import { type SceneRecord, validate } from "./validator";

const MANIFESTS = `
## Evidence Manifest

### evidence:receipt {#receipt}

- **Name:** 收據
- **Description:** 一張收據。
- **Details:** 印著 REPRINT。
- **Source Sublocation:** shop

#### On Collect

**相馬律**：收好。
`;

function investigation(characterBody: string, manifests = MANIFESTS): string {
  return `# Scene 1: 測試調查

## Sub-location: 店內 {#shop}

- **Status:** unlocked

[場景：便利店。]

### Hotspot: 櫃檯 {#counter}

- **Description:** 收銀櫃檯。
- **Reveals:** [evidence:receipt]

**相馬律**：有張收據。

### Character: 店員 {#clerk}

- **Role:** 店員
- **Bio:** 當晚值班。
${characterBody}

#### Topic: 值班 {#shift}

**店員**：我十點上班。
${manifests}
## Outro

**相馬律**：走吧。
`;
}

const PRESENT_TOPIC = `
#### Topic: 那張收據 {#receipt_reaction}

- **Present:** evidence:receipt

**店員**：這是重印的。
`;

function parse(source: string) {
  return parseInvestigationScene(
    source,
    "investigation_scene_1.md",
    "investigation_scene_1",
  );
}

function parsed(source: string): ASTInvestigationScene {
  const result = parse(source);
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

function clerk(ast: ASTInvestigationScene) {
  const character = ast.sublocations[0]?.characters[0];
  if (!character) throw new Error("missing clerk");
  return character;
}

function topic(ast: ASTInvestigationScene, id: string): ASTTopic {
  const found = clerk(ast).topics.find((t) => t.id === id);
  if (!found) throw new Error(`missing topic ${id}`);
  return found;
}

function errorCode(source: string): string | null {
  const result = parse(source);
  return result.ok ? null : result.error.code;
}

function chapter(sceneFiles: string[]): ASTChapter {
  return {
    kind: "chapter",
    dirName: "chapter_1",
    number: 1,
    title: "第一章",
    summary: "摘要",
    inProgress: false,
    sceneFiles,
    sourceFile: "chapter_1/chapter.md",
    line: 1,
  };
}

describe("Present topics", () => {
  it("locks the topic until one of its records is held", () => {
    const ast = parsed(investigation(PRESENT_TOPIC));
    expect(topic(ast, "receipt_reaction")).toMatchObject({
      status: "locked",
      present: [{ kind: "evidence", id: "receipt" }],
      unlock: { predicate: "evidence_collected", id: "receipt" },
    });
    expect(topic(ast, "shift").present).toEqual([]);
  });

  it("keeps an authored Unlock and requires any one listed record", () => {
    const ast = parsed(
      investigation(`
#### Topic: 那張收據 {#receipt_reaction}

- **Present:** evidence:receipt, statement:clerk_shift
- **Unlock:** hotspot:counter investigated

**店員**：這是重印的。
`),
    );
    expect(topic(ast, "receipt_reaction").unlock).toEqual({
      op: "and",
      left: { predicate: "hotspot_investigated", id: "counter" },
      right: {
        op: "or",
        left: { predicate: "evidence_collected", id: "receipt" },
        right: { predicate: "statement_acquired", id: "clerk_shift" },
      },
    });
  });

  it("gives a character a default Wrong Present line, or the authored one", () => {
    expect(clerk(parsed(investigation(PRESENT_TOPIC))).wrongPresent).toEqual({
      speaker: null,
      text: "店員看了一眼，沒有反應。",
    });
    const authored = parsed(
      investigation(
        `- **Wrong Present:** **店員**：這跟我無關吧。\n${PRESENT_TOPIC}`,
      ),
    );
    expect(clerk(authored).wrongPresent).toEqual({
      speaker: "店員",
      text: "這跟我無關吧。",
    });
    expect(clerk(parsed(investigation(""))).wrongPresent).toBeNull();
  });

  it.each([
    [
      "a malformed record",
      PRESENT_TOPIC.replace("evidence:receipt", "receipt"),
      "presentMalformed",
    ],
    [
      "a repeated record",
      PRESENT_TOPIC.replace(
        "evidence:receipt",
        "evidence:receipt, evidence:receipt",
      ),
      "presentDuplicateRecord",
    ],
    [
      "an unlocked Present topic",
      PRESENT_TOPIC.replace(
        "- **Present:**",
        "- **Status:** unlocked\n- **Present:**",
      ),
      "presentTopicUnlocked",
    ],
    [
      "Wrong Present without a Present topic",
      "- **Wrong Present:** [他搖頭。]",
      "wrongPresentWithoutPresentTopic",
    ],
    [
      "a Wrong Present that is not one line",
      `- **Wrong Present:** 不對。\n${PRESENT_TOPIC}`,
      "wrongPresentMalformed",
    ],
  ])("rejects %s", (_name, body, code) => {
    expect(errorCode(investigation(body))).toBe(code);
  });

  it("emits present and wrongPresent only where they are used", () => {
    const ast = parsed(investigation(PRESENT_TOPIC));
    const scene: SceneRecord = {
      chapterId: "chapter_1",
      file: "investigation_scene_1.md",
      ast,
    };
    const corpus = compileCaseRecordCorpus(
      emptyStoryCatalog("story_catalog.md"),
      [scene],
    );
    if (!corpus.ok) throw new Error(corpus.errors[0]?.message);
    const json = emitInvestigationScene(ast, corpus.value);
    const character = json.sublocations[0]?.characters[0];
    expect(character?.wrongPresent).toEqual({
      speaker: null,
      text: "店員看了一眼，沒有反應。",
    });
    expect(character?.topics.map((t) => t.present)).toEqual([
      [{ kind: "evidence", id: "receipt" }],
      undefined,
    ]);
  });

  it("accepts a record from this scene", () => {
    const ast = parsed(investigation(PRESENT_TOPIC));
    const errors = validate({
      chapters: [chapter(["investigation_scene_1.md"])],
      scenes: [
        { chapterId: "chapter_1", file: "investigation_scene_1.md", ast },
      ],
    });
    expect(errors).toEqual([]);
  });

  it("accepts a record every earlier path collects, and rejects one it may not", () => {
    const earlier = parsed(investigation(""));
    const later = (record: string) =>
      parsed(
        investigation(
          PRESENT_TOPIC.replace("evidence:receipt", record),
          "",
        ).replace("- **Reveals:** [evidence:receipt]\n", ""),
      );
    const run = (ast: ASTInvestigationScene) =>
      validate({
        chapters: [
          chapter(["investigation_scene_1.md", "investigation_scene_2.md"]),
        ],
        scenes: [
          {
            chapterId: "chapter_1",
            file: "investigation_scene_1.md",
            ast: earlier,
          },
          {
            chapterId: "chapter_1",
            file: "investigation_scene_2.md",
            ast: { ...ast, id: "investigation_scene_2" },
          },
        ],
      }).map((error) => error.code);

    expect(run(later("evidence:receipt"))).toEqual([]);
    expect(run(later("evidence:missing_note"))).toContain(
      "presentRecordUnavailable",
    );
  });
});

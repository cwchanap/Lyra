import { describe, expect, it } from "vitest";
import {
  materializeSemanticDefaults,
  NO_NEW_FINDINGS_DIALOGUE,
} from "./semantic-defaults";
import type {
  ASTInterrogationScene,
  ASTInvestigationScene,
  DialogueItem,
} from "./types";
import type { SceneRecord } from "./validator";

const FALLBACK = [{ kind: "action", text: "（沒有新發現。）" }];
const authored: DialogueItem[] = [{ kind: "action", text: "既有內容" }];

function scene(
  input: {
    hotspot?: DialogueItem[] | null | undefined;
    topic?: DialogueItem[] | null | undefined;
    evidence?: DialogueItem[] | null | undefined;
    statement?: DialogueItem[] | null | undefined;
  } = {},
): SceneRecord {
  return {
    chapterId: "chapter_1",
    file: "investigation_scene_1.md",
    ast: {
      kind: "investigationScene",
      id: "investigation_scene_1",
      title: "調查",
      summary: "調查",
      summaryAuthored: false,
      intro: [],
      sublocations: [
        {
          id: "office",
          label: "辦公室",
          status: "unlocked",
          unlock: null,
          reveals: [],
          sceneTag: "室內",
          assetCue: null,
          transitionDialogue: [],
          sourceFile: "chapter_1/investigation_scene_1.md",
          line: 2,
          hotspots: [
            {
              id: "desk",
              label: "桌子",
              description: "",
              status: "unlocked",
              unlock: null,
              reveals: [],
              evidenceSource: null,
              sceneSourcePrompt: null,
              inspectDialogue: [],
              onReexamine: input.hotspot ?? null,
              sourceFile: "chapter_1/investigation_scene_1.md",
              line: 3,
            },
          ],
          characters: [
            {
              id: "witness",
              name: "證人",
              role: "",
              bio: "",
              sourceFile: "chapter_1/investigation_scene_1.md",
              line: 4,
              topics: [
                {
                  id: "alibi",
                  label: "不在場證明",
                  status: "unlocked",
                  unlock: null,
                  reveals: [],
                  topicDialogue: [],
                  onReexamine: input.topic ?? null,
                  sourceFile: "chapter_1/investigation_scene_1.md",
                  line: 5,
                },
              ],
            },
          ],
        },
      ],
      evidenceManifest: [
        {
          id: "receipt",
          name: "收據",
          description: "",
          details: "",
          imageCue: { imagePrompt: null, imageAssetId: null },
          sourceSublocationId: null,
          onCollect: [],
          onReexamine: input.evidence ?? null,
          sourceFile: "chapter_1/investigation_scene_1.md",
          line: 6,
        },
      ],
      statementManifest: [
        {
          id: "testimony",
          speaker: "證人",
          content: "",
          onAcquire: [],
          onReexamine: input.statement ?? null,
          sourceFile: "chapter_1/investigation_scene_1.md",
          line: 7,
        },
      ],
      outro: { unlock: "auto", dialogue: [] },
      assetRefs: [],
      sourceFile: "chapter_1/investigation_scene_1.md",
      line: 1,
    } satisfies ASTInvestigationScene,
  };
}

function defaults(record: SceneRecord) {
  const ast = materializeSemanticDefaults(record).ast;
  if (ast.kind !== "investigationScene")
    throw new Error("expected investigation");
  return {
    hotspot: ast.sublocations[0]!.hotspots[0]!.onReexamine,
    topic: ast.sublocations[0]!.characters[0]!.topics[0]!.onReexamine,
    evidence: ast.evidenceManifest[0]!.onReexamine,
    statement: ast.statementManifest[0]!.onReexamine,
    intro: ast.intro,
  };
}

describe("materializeSemanticDefaults", () => {
  const missingCases: Array<
    [
      keyof Omit<ReturnType<typeof defaults>, "intro">,
      Parameters<typeof scene>[0],
    ]
  > = [
    ["hotspot", { hotspot: undefined }],
    ["topic", { topic: undefined }],
    ["evidence", { evidence: undefined }],
    ["statement", { statement: undefined }],
  ];
  it.each(missingCases)(
    "materializes a missing %s re-examination block",
    (role, input) => {
      expect(defaults(scene(input))[role]).toEqual(FALLBACK);
    },
  );

  const emptyCases: Array<
    [
      keyof Omit<ReturnType<typeof defaults>, "intro">,
      Parameters<typeof scene>[0],
    ]
  > = [
    ["hotspot", { hotspot: [] }],
    ["topic", { topic: [] }],
    ["evidence", { evidence: [] }],
    ["statement", { statement: [] }],
  ];
  it.each(emptyCases)(
    "materializes an empty %s re-examination block",
    (role, input) => {
      expect(defaults(scene(input))[role]).toEqual(FALLBACK);
    },
  );

  it("preserves non-empty re-examination dialogue byte-for-byte", () => {
    const actual = defaults(
      scene({
        hotspot: authored,
        topic: authored,
        evidence: authored,
        statement: authored,
      }),
    );
    expect(actual.hotspot).toBe(authored);
    expect(actual.topic).toBe(authored);
    expect(actual.evidence).toBe(authored);
    expect(actual.statement).toBe(authored);
  });

  it("does not mutate the input scene when materializing a null re-examination block", () => {
    const input = scene({ hotspot: null });
    const actual = defaults(input);
    expect(
      (input.ast as ASTInvestigationScene).sublocations[0]!.hotspots[0]!
        .onReexamine,
    ).toBeNull();
    expect(actual.hotspot).toEqual(FALLBACK);
  });

  it("does not add a fallback to unrelated empty intro or outro dialogue", () => {
    const actual = defaults(scene());
    expect(actual.intro).toEqual([]);
    const ast = materializeSemanticDefaults(scene()).ast;
    if (ast.kind !== "investigationScene")
      throw new Error("expected investigation");
    expect(ast.outro.dialogue).toEqual([]);
    expect(NO_NEW_FINDINGS_DIALOGUE).toEqual(FALLBACK);
  });

  it("does not add a fallback to an unrelated empty interrogation testimony", () => {
    const record: SceneRecord = {
      chapterId: "chapter_1",
      file: "interrogation_scene_2.md",
      ast: {
        kind: "interrogationScene",
        id: "interrogation_scene_2",
        title: "詢問",
        summary: "詢問",
        summaryAuthored: false,
        intro: [],
        assetRefs: [],
        evidenceManifest: [],
        statementManifest: [],
        outro: { unlock: "auto", dialogue: [] },
        sourceFile: "chapter_1/interrogation_scene_2.md",
        line: 1,
        phases: [
          {
            kind: "inquiry",
            id: "inquiry",
            label: "詢問",
            required: true,
            status: "unlocked",
            unlock: null,
            reveals: [],
            sceneTag: "詢問室",
            assetCue: null,
            entryDialogue: [],
            complete: "auto",
            sourceFile: "chapter_1/interrogation_scene_2.md",
            line: 2,
            subject: {
              id: "witness",
              name: "證人",
              role: "證人",
              bio: "",
              sourceFile: "chapter_1/interrogation_scene_2.md",
              line: 3,
            },
            questions: [
              {
                id: "whereabouts",
                label: "去向",
                required: true,
                status: "unlocked",
                unlock: null,
                reveals: [],
                sourceFile: "chapter_1/interrogation_scene_2.md",
                line: 4,
                testimony: {
                  onLoop: [],
                  loopPrompt: null,
                  defaultChallenge: null,
                  defaultWrong: null,
                  wrongReply: null,
                  sourceFile: "chapter_1/interrogation_scene_2.md",
                  line: 5,
                  lines: [
                    {
                      id: "line_1",
                      label: "證詞",
                      content: [],
                      contradiction: null,
                      challenge: null,
                      onCorrect: null,
                      onWrongEvidence: null,
                      reveals: [],
                      sourceFile: "chapter_1/interrogation_scene_2.md",
                      line: 6,
                    },
                  ],
                },
              },
            ],
          },
        ],
      } satisfies ASTInterrogationScene,
    };
    const ast = materializeSemanticDefaults(record).ast;
    if (ast.kind !== "interrogationScene")
      throw new Error("expected interrogation");
    expect(ast.intro).toEqual([]);
    expect(ast.outro.dialogue).toEqual([]);
    expect(ast.phases[0]!.questions[0]!.testimony.lines[0]!.content).toEqual(
      [],
    );
  });
});

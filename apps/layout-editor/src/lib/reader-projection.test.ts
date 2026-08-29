import { describe, expect, it } from "vitest";
import { deriveDialogueSegments } from "@lyra/scripts/compile-scenes/dialogue-segment-origins";
import type {
  CaseRecordProvenance,
  JSONDialogueItem,
  JSONInterrogationScene,
  JSONInvestigationScene,
  JSONLinearScene,
} from "@lyra/scripts/compile-scenes/types";
import type {
  PublicAnalysisScene,
  ReaderGroup,
  ReaderScene,
} from "./workbench-types";
import { projectReaderScene, readerSegmentId } from "./reader-projection";

// Every dialogue carrier fixture renders exactly one line whose text equals
// the compiler carrier ID, so sentinel == carrier ID everywhere.
const SENTINEL_SPEAKER = "證人";
const line = (text: string): JSONDialogueItem => ({
  kind: "line",
  speaker: SENTINEL_SPEAKER,
  text,
  portrait: null,
});

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

const linearScene = {
  type: "linear",
  id: "scene_a",
  title: "Linear",
  summary: "Fixture",
  queue: [
    { kind: "line", speaker: "相馬律", text: "first", portrait: null },
    { kind: "action", text: "second" },
  ],
  assetRefs: [],
} satisfies JSONLinearScene;

const investigationScene = {
  type: "investigation",
  id: "investigation_scene_b",
  title: "Investigation",
  summary: "Fixture",
  intro: [line("intro")],
  assetRefs: [],
  sublocations: [
    {
      id: "lobby",
      label: "Lobby",
      status: "unlocked",
      unlock: null,
      reveals: [],
      sceneTag: "場景：大廳",
      backgroundAssetId: null,
      bgm: null,
      bgs: null,
      transitionDialogue: [line("sublocation:lobby:transition")],
      hotspots: [
        {
          id: "door",
          label: "Door",
          description: "A heavy door.",
          status: "unlocked",
          unlock: null,
          reveals: [
            { kind: "evidence", id: "door_log" },
            { kind: "topic", characterId: "npc1", topicId: "topic1" },
          ],
          evidenceSource: null,
          sceneSourcePrompt: null,
          inspectDialogue: [line("hotspot:door:inspect")],
          onReexamine: [line("hotspot:door:reexamine")],
          layout: null,
        },
      ],
      characters: [
        {
          id: "npc1",
          name: "Witness",
          role: "Witness",
          bio: "Saw something.",
          layout: null,
          topics: [
            {
              id: "topic1",
              label: "The door",
              status: "unlocked",
              unlock: null,
              reveals: [{ kind: "assertFact", factId: "fact_door" }],
              topicDialogue: [line("topic:npc1:topic1:dialogue")],
              onReexamine: [line("topic:npc1:topic1:reexamine")],
            },
          ],
        },
      ],
    },
  ],
  evidenceManifest: [
    {
      id: "door_log",
      name: "Door Log",
      description: "Access log.",
      details: "Detailed log.",
      imageAssetId: null,
      sourceSublocationId: "lobby",
      provenance,
      onCollect: [line("evidence:door_log:onCollect")],
      onReexamine: [line("evidence:door_log:onReexamine")],
    },
  ],
  statementManifest: [
    {
      id: "witness",
      speaker: "Witness",
      content: "I saw the door open.",
      provenance,
      onAcquire: [line("statement:witness:onAcquire")],
      onReexamine: [line("statement:witness:onReexamine")],
    },
  ],
  outro: { unlock: "auto", dialogue: [line("outro")] },
} satisfies JSONInvestigationScene;

const interrogationScene = {
  type: "interrogation",
  id: "interrogation_scene_c",
  title: "Interrogation",
  summary: "Fixture",
  intro: [line("intro")],
  assetRefs: [],
  phases: [
    {
      kind: "inquiry",
      id: "phase1",
      label: "First Round",
      subject: {
        id: "suspect",
        name: "Suspect",
        role: "Subject",
        bio: "Evasive.",
        portrait: null,
      },
      required: true,
      status: "unlocked",
      unlock: null,
      reveals: [],
      sceneTag: "場景：偵訊室",
      backgroundAssetId: null,
      bgm: null,
      bgs: null,
      entryDialogue: [line("phase:phase1:entry")],
      complete: "auto",
      questions: [
        {
          id: "q1",
          label: "The alibi",
          status: "unlocked",
          required: true,
          unlock: null,
          reveals: [{ kind: "question", id: "q2" }],
          testimony: {
            onLoop: [line("question:q1:onLoop")],
            loopPrompt: [line("question:q1:loopPrompt")],
            defaultChallenge: [line("question:q1:defaultChallenge")],
            defaultWrong: [line("question:q1:defaultWrong")],
            wrongReply: [line("question:q1:wrongReply")],
            lines: [
              {
                id: "l1",
                label: "Wasn't there",
                content: [line("question:q1:line:l1:content")],
                contradiction: { kind: "evidence", id: "cctv" },
                challenge: [line("question:q1:line:l1:challenge")],
                onCorrect: [line("question:q1:line:l1:onCorrect")],
                onWrongEvidence: [line("question:q1:line:l1:onWrongEvidence")],
                reveals: [{ kind: "statement", id: "witness" }],
              },
            ],
          },
        },
      ],
    },
  ],
  evidenceManifest: [
    {
      id: "cctv",
      name: "CCTV Footage",
      description: "Camera recording.",
      details: "Timestamped frames.",
      imageAssetId: null,
      provenance,
      onCollect: [line("evidence:cctv:onCollect")],
      onReexamine: [line("evidence:cctv:onReexamine")],
    },
  ],
  statementManifest: [
    {
      id: "witness",
      speaker: "Witness",
      content: "He left at ten.",
      provenance,
      onAcquire: [line("statement:witness:onAcquire")],
      onReexamine: [line("statement:witness:onReexamine")],
    },
  ],
  outro: { unlock: "auto", dialogue: [line("outro")] },
} satisfies JSONInterrogationScene;

const analysisScene = {
  type: "analysis",
  id: "analysis_scene_d",
  title: "Analysis",
  summary: "Fixture",
  intro: [line("intro")],
  outro: [line("outro")],
  boards: [
    {
      kind: "classify",
      common: {
        id: "classify_board",
        label: "Classify Board",
        prompt: "Sort the cards.",
        cards: [
          {
            id: "card_a",
            label: "Card A",
            source: { kind: "evidence", id: "door_log" },
            summary: "Card A summary.",
          },
        ],
        resultDialogue: [line("board:classify_board:result")],
        feedback: {
          incomplete: "Incomplete classify.",
          incorrect: "Incorrect classify.",
          hint: "Classify hint.",
        },
      },
      groups: [
        { id: "g1", label: "Group One", description: "Group One description." },
      ],
    },
    {
      kind: "order",
      common: {
        id: "order_board",
        label: "Order Board",
        prompt: "Order the cards.",
        cards: [
          {
            id: "anchor_card",
            label: "Anchor Card",
            source: { kind: "statement", id: "witness" },
            summary: "Anchor card summary.",
          },
        ],
        resultDialogue: [line("board:order_board:result")],
        feedback: {
          incomplete: "Incomplete order.",
          incorrect: "Incorrect order.",
          hint: null,
        },
      },
      fixedAnchors: [{ cardId: "anchor_card", position: 1 }],
    },
    {
      kind: "threshold",
      common: {
        id: "threshold_board",
        label: "Threshold Board",
        prompt: "Pick enough cards.",
        cards: [
          {
            id: "card_t",
            label: "Card T",
            source: { kind: "practice", id: "practice_1" },
            summary: "Threshold card summary.",
          },
        ],
        resultDialogue: [line("board:threshold_board:result")],
        feedback: {
          incomplete: "Incomplete threshold.",
          incorrect: "Incorrect threshold.",
          hint: null,
        },
      },
    },
  ],
} satisfies PublicAnalysisScene;

function findGroup(scene: ReaderScene, id: string): ReaderGroup | undefined {
  const stack = [...scene.groups];
  while (stack.length > 0) {
    const group = stack.pop();
    if (!group) break;
    if (group.id === id) return group;
    stack.push(...group.children);
  }
  return undefined;
}

function collectDialogueCarrierIds(scene: ReaderScene): Set<string> {
  const ids = new Set<string>();
  const walk = (group: ReaderGroup) => {
    if (group.items.some((item) => item.kind !== "notice")) ids.add(group.id);
    for (const child of group.children) walk(child);
  };
  for (const group of scene.groups) walk(group);
  return ids;
}

const investigationReader = () =>
  projectReaderScene(
    "chapter_1",
    "docs/stories_plan/chapter_1/investigation_scene_b.md",
    investigationScene,
  );
const interrogationReader = () =>
  projectReaderScene(
    "chapter_1",
    "docs/stories_plan/chapter_1/interrogation_scene_c.md",
    interrogationScene,
  );
const analysisReader = () =>
  projectReaderScene(
    "chapter_1",
    "docs/stories_plan/chapter_1/analysis_scene_d.md",
    analysisScene,
  );

describe("projectReaderScene dialogue-carrier completeness", () => {
  it("projects the linear queue as the single main group in compiler order", () => {
    const reader = projectReaderScene(
      "chapter_1",
      "docs/stories_plan/chapter_1/scene_a.md",
      linearScene,
    );
    expect(collectDialogueCarrierIds(reader)).toEqual(
      new Set(
        deriveDialogueSegments({
          chapterId: "chapter_1",
          json: linearScene,
        }).map((segment) => readerSegmentId(segment.origin)),
      ),
    );
    expect(reader.groups.map((group) => group.id)).toEqual(["main"]);
    expect(reader.groups[0]?.items).toEqual([
      { kind: "line", speaker: "相馬律", text: "first" },
      { kind: "action", text: "second" },
    ]);
  });

  it("projects every non-empty investigation compiler carrier exactly once", () => {
    const reader = investigationReader();
    const expected = deriveDialogueSegments({
      chapterId: "chapter_1",
      json: investigationScene,
    }).map((segment) => readerSegmentId(segment.origin));

    expect(collectDialogueCarrierIds(reader)).toEqual(new Set(expected));
    for (const id of expected) {
      const group = findGroup(reader, id);
      expect(group, id).toBeDefined();
      expect(group?.items, id).toContainEqual({
        kind: "line",
        speaker: SENTINEL_SPEAKER,
        text: id,
      });
    }
  });

  it("projects every non-empty interrogation compiler carrier exactly once", () => {
    const reader = interrogationReader();
    const expected = deriveDialogueSegments({
      chapterId: "chapter_1",
      json: interrogationScene,
    }).map((segment) => readerSegmentId(segment.origin));

    expect(collectDialogueCarrierIds(reader)).toEqual(new Set(expected));
    for (const id of expected) {
      const group = findGroup(reader, id);
      expect(group, id).toBeDefined();
      expect(group?.items, id).toContainEqual({
        kind: "line",
        speaker: SENTINEL_SPEAKER,
        text: id,
      });
    }
  });

  it("pins representative carrier group labels", () => {
    const reader = investigationReader();
    expect(findGroup(reader, "hotspot:door:inspect")?.label).toBe("Inspect");
    expect(findGroup(reader, "hotspot:door:reexamine")?.label).toBe(
      "On Re-examine",
    );
    expect(findGroup(reader, "evidence:door_log:onCollect")?.label).toBe(
      "On Collect",
    );
    expect(findGroup(reader, "statement:witness:onAcquire")?.label).toBe(
      "On Acquire",
    );
  });

  it("pins interrogation challenge carrier labels without renaming carrier IDs", () => {
    const reader = interrogationReader();
    expect(findGroup(reader, "question:q1:line:l1:challenge")?.label).toBe(
      "Press",
    );
    expect(findGroup(reader, "question:q1:line:l1:onCorrect")?.label).toBe(
      "Correct Present",
    );
    expect(
      findGroup(reader, "question:q1:line:l1:onWrongEvidence")?.label,
    ).toBe("Wrong Present");
  });

  it("pins main flow for canonical play-path carriers and null carrier anchors", () => {
    const investigation = investigationReader();
    expect(findGroup(investigation, "intro")?.flow).toBe("main");
    expect(findGroup(investigation, "outro")?.flow).toBe("main");
    expect(findGroup(investigation, "sublocation:lobby:transition")?.flow).toBe(
      "main",
    );
    expect(findGroup(investigation, "hotspot:door:inspect")?.flow).toBe("main");
    expect(findGroup(investigation, "topic:npc1:topic1:dialogue")?.flow).toBe(
      "main",
    );
    // Carrier groups never carry anchors; structural groups do.
    expect(
      findGroup(investigation, "hotspot:door:inspect")?.sourceAnchor,
    ).toBeNull();

    const interrogation = interrogationReader();
    expect(findGroup(interrogation, "intro")?.flow).toBe("main");
    expect(findGroup(interrogation, "outro")?.flow).toBe("main");
    expect(findGroup(interrogation, "phase:phase1:entry")?.flow).toBe("main");
    expect(findGroup(interrogation, "question:q1:line:l1:content")?.flow).toBe(
      "main",
    );
  });

  it("pins branch flow for optional, re-examine, and acquisition carriers", () => {
    const investigation = investigationReader();
    expect(findGroup(investigation, "hotspot:door:reexamine")?.flow).toBe(
      "branch",
    );
    expect(findGroup(investigation, "topic:npc1:topic1:reexamine")?.flow).toBe(
      "branch",
    );
    expect(findGroup(investigation, "evidence:door_log:onCollect")?.flow).toBe(
      "branch",
    );
    expect(
      findGroup(investigation, "evidence:door_log:onReexamine")?.flow,
    ).toBe("branch");
    expect(findGroup(investigation, "statement:witness:onAcquire")?.flow).toBe(
      "branch",
    );
    expect(
      findGroup(investigation, "statement:witness:onReexamine")?.flow,
    ).toBe("branch");

    const interrogation = interrogationReader();
    expect(
      findGroup(interrogation, "question:q1:line:l1:challenge")?.flow,
    ).toBe("branch");
    expect(
      findGroup(interrogation, "question:q1:line:l1:onCorrect")?.flow,
    ).toBe("branch");
    expect(
      findGroup(interrogation, "question:q1:line:l1:onWrongEvidence")?.flow,
    ).toBe("branch");
    expect(findGroup(interrogation, "question:q1:onLoop")?.flow).toBe("branch");
    expect(findGroup(interrogation, "question:q1:loopPrompt")?.flow).toBe(
      "branch",
    );
    expect(findGroup(interrogation, "question:q1:defaultChallenge")?.flow).toBe(
      "branch",
    );
    expect(findGroup(interrogation, "question:q1:defaultWrong")?.flow).toBe(
      "branch",
    );
    expect(findGroup(interrogation, "question:q1:wrongReply")?.flow).toBe(
      "branch",
    );
    expect(findGroup(interrogation, "evidence:cctv:onCollect")?.flow).toBe(
      "branch",
    );
    expect(findGroup(interrogation, "statement:witness:onAcquire")?.flow).toBe(
      "branch",
    );
  });
});

describe("projectReaderScene non-dialogue notices", () => {
  it("projects hotspot reveals as inventory notice items", () => {
    const hotspot = findGroup(investigationReader(), "hotspot:door");
    expect(hotspot?.items).toContainEqual({
      kind: "notice",
      noticeKind: "evidence",
      text: "Reveals evidence: door_log",
    });
    expect(hotspot?.items).toContainEqual({
      kind: "notice",
      noticeKind: "reveal",
      text: "Reveals topic: npc1/topic1",
    });
  });

  it("projects story reveals with writer-facing labels", () => {
    const topic = findGroup(investigationReader(), "topic:npc1:topic1");
    expect(topic?.items).toContainEqual({
      kind: "notice",
      noticeKind: "reveal",
      text: "Asserts fact: fact_door",
    });
  });

  it("projects the testimony-line contradiction notice", () => {
    const lineGroup = findGroup(interrogationReader(), "line:l1");
    expect(lineGroup?.items).toContainEqual({
      kind: "notice",
      noticeKind: "contradiction",
      text: "Contradiction: evidence:cctv",
    });
    expect(lineGroup?.items).toContainEqual({
      kind: "notice",
      noticeKind: "statement",
      text: "Reveals statement: witness",
    });
  });

  it("projects interrogation local question reveals", () => {
    const question = findGroup(interrogationReader(), "question:q1");
    expect(question?.items).toContainEqual({
      kind: "notice",
      noticeKind: "reveal",
      text: "Reveals question: q2",
    });
  });

  it("projects interrogation inventory metadata as public notices", () => {
    const reader = interrogationReader();
    const collect = findGroup(reader, "evidence:cctv:onCollect");
    expect(collect?.items).toContainEqual({
      kind: "notice",
      noticeKind: "evidence",
      text: "Evidence: CCTV Footage",
    });
    expect(collect?.items).toContainEqual({
      kind: "notice",
      noticeKind: "evidence",
      text: "Description: Camera recording.",
    });
    const acquire = findGroup(reader, "statement:witness:onAcquire");
    expect(acquire?.items).toContainEqual({
      kind: "notice",
      noticeKind: "statement",
      text: "Statement — Witness: He left at ten.",
    });
  });

  it("keeps investigation inventory carriers free of metadata notices", () => {
    const collect = findGroup(
      investigationReader(),
      "evidence:door_log:onCollect",
    );
    expect(collect?.items).toEqual([
      {
        kind: "line",
        speaker: SENTINEL_SPEAKER,
        text: "evidence:door_log:onCollect",
      },
    ]);
  });

  it("projects order-board fixed anchors as constraint notices", () => {
    const orderBoard = findGroup(analysisReader(), "board:order_board");
    expect(orderBoard?.items).toContainEqual({
      kind: "notice",
      noticeKind: "constraint",
      text: "Fixed card anchor_card at position 1",
    });
  });

  it("projects public analysis prompt, feedback, card, group, and result text", () => {
    const reader = analysisReader();
    const board = findGroup(reader, "board:classify_board");
    expect(board?.items).toContainEqual({
      kind: "notice",
      noticeKind: "prompt",
      text: "Sort the cards.",
    });
    expect(board?.items).toContainEqual({
      kind: "notice",
      noticeKind: "feedback",
      text: "Incomplete classify.",
    });
    expect(board?.items).toContainEqual({
      kind: "notice",
      noticeKind: "feedback",
      text: "Incorrect classify.",
    });
    expect(board?.items).toContainEqual({
      kind: "notice",
      noticeKind: "feedback",
      text: "Classify hint.",
    });
    expect(findGroup(reader, "group:g1")?.items).toContainEqual({
      kind: "notice",
      noticeKind: "group",
      text: "Group One description.",
    });
    const card = findGroup(reader, "card:card_a");
    expect(card?.items).toContainEqual({
      kind: "notice",
      noticeKind: "card",
      text: "Source: evidence:door_log",
    });
    expect(card?.items).toContainEqual({
      kind: "notice",
      noticeKind: "card",
      text: "Card A summary.",
    });
    expect(
      findGroup(reader, "board:classify_board:result")?.items,
    ).toContainEqual({
      kind: "line",
      speaker: SENTINEL_SPEAKER,
      text: "board:classify_board:result",
    });
    expect(collectDialogueCarrierIds(reader)).toEqual(
      new Set([
        "intro",
        "board:classify_board:result",
        "board:order_board:result",
        "board:threshold_board:result",
        "outro",
      ]),
    );
  });
});

describe("projectReaderScene scene envelope", () => {
  it("carries id, type, title, and source path", () => {
    const reader = investigationReader();
    expect(reader.id).toBe("investigation_scene_b");
    expect(reader.type).toBe("investigation");
    expect(reader.title).toBe("Investigation");
    expect(reader.sourcePath).toBe(
      "docs/stories_plan/chapter_1/investigation_scene_b.md",
    );
  });

  it("anchors structural groups at authored semantic IDs", () => {
    expect(findGroup(investigationReader(), "hotspot:door")?.sourceAnchor).toBe(
      "#door",
    );
    expect(findGroup(interrogationReader(), "phase:phase1")?.sourceAnchor).toBe(
      "#phase1",
    );
  });

  it("marks press-branch carriers as branch flow and content as main flow", () => {
    expect(
      findGroup(interrogationReader(), "question:q1:line:l1:challenge")?.flow,
    ).toBe("branch");
    expect(
      findGroup(interrogationReader(), "question:q1:line:l1:content")?.flow,
    ).toBe("main");
  });
});

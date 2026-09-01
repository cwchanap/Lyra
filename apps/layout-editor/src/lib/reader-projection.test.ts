import { describe, expect, it } from "vitest";
import { deriveDialogueSegments } from "@lyra/scripts/compile-scenes/dialogue-segment-origins";
import type {
  CaseRecordProvenance,
  JSONDialogueItem,
  JSONInterrogationScene,
  JSONInvestigationScene,
  JSONLinearScene,
  JSONVisualAssetCue,
  PortraitRef,
} from "@lyra/scripts/compile-scenes/types";
import type {
  PublicAnalysisScene,
  ReaderGroup,
  ReaderPresentationFact,
  ReaderScene,
  WorkbenchScenePayload,
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

const portraitLine = (
  text: string,
  portrait: PortraitRef,
): JSONDialogueItem => ({
  kind: "line",
  speaker: SENTINEL_SPEAKER,
  text,
  portrait,
});

const sceneTagCue = (
  text: string,
  assetCue: JSONVisualAssetCue,
): JSONDialogueItem => ({
  kind: "sceneTag",
  text,
  assetCue,
});

const NPC1_STANDARD: PortraitRef = {
  characterId: "npc1",
  expression: "standard",
  assetId: "portrait.npc1.standard",
};
const NPC1_CONCERNED: PortraitRef = {
  characterId: "npc1",
  expression: "concerned",
  assetId: "portrait.npc1.concerned",
};
const SUSPECT_STANDARD: PortraitRef = {
  characterId: "suspect",
  expression: "standard",
  assetId: "portrait.suspect.standard",
};
const INV_INTRO_CUE: JSONVisualAssetCue = {
  backgroundAssetId: "background.chapter_1.inv_b_intro",
  bgm: null,
  bgs: null,
};
const INT_INTRO_CUE: JSONVisualAssetCue = {
  backgroundAssetId: null,
  bgm: { channel: "bgm", assetId: "audio.bgm.rain" },
  bgs: null,
};
const ANA_INTRO_CUE: JSONVisualAssetCue = {
  backgroundAssetId: null,
  bgm: { channel: "bgm", assetId: "audio.bgm.rain" },
  bgs: null,
};

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

const LINEAR_CUE: JSONVisualAssetCue = {
  backgroundAssetId: "background.chapter_1.lin_b",
  bgm: { channel: "bgm", assetId: "audio.bgm.rain" },
  bgs: { channel: "bgs", assetId: "audio.bgs.street_rain" },
};

const presentationLinearScene = {
  type: "linear",
  id: "scene_p",
  title: "Presentation",
  summary: "Fixture",
  queue: [
    { kind: "sceneTag", text: "場景：雨の署", assetCue: LINEAR_CUE },
    {
      kind: "line",
      speaker: SENTINEL_SPEAKER,
      text: "first",
      portrait: NPC1_STANDARD,
    },
    { kind: "action", text: "second" },
    {
      kind: "line",
      speaker: SENTINEL_SPEAKER,
      text: "third",
      portrait: NPC1_STANDARD,
    },
  ],
  assetRefs: [],
} satisfies JSONLinearScene;

const investigationScene = {
  type: "investigation",
  id: "investigation_scene_b",
  title: "Investigation",
  summary: "Fixture",
  map: null,
  intro: [sceneTagCue("場景：現場", INV_INTRO_CUE), line("intro")],
  assetRefs: [],
  sublocations: [
    {
      id: "lobby",
      label: "Lobby",
      status: "unlocked",
      unlock: null,
      reveals: [],
      sceneTag: "場景：大廳",
      backgroundAssetId: "background.chapter_1.inv_b_lobby",
      bgm: { channel: "bgm", assetId: "audio.bgm.rain" },
      bgs: { channel: "bgs", assetId: "audio.bgs.street_rain" },
      transitionDialogue: [
        portraitLine("sublocation:lobby:transition", NPC1_STANDARD),
      ],
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
          inspectDialogue: [
            portraitLine("hotspot:door:inspect", NPC1_CONCERNED),
          ],
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
          layout: {
            kind: "sprite",
            assetId: "standee.npc1",
            x: 0.1,
            y: 0.2,
            w: 0.3,
            h: 0.4,
            anchor: "bottomCenter",
          },
          topics: [
            {
              id: "topic1",
              label: "The door",
              status: "unlocked",
              unlock: null,
              reveals: [{ kind: "assertFact", factId: "fact_door" }],
              topicDialogue: [
                portraitLine("topic:npc1:topic1:dialogue", NPC1_CONCERNED),
              ],
              onReexamine: [line("topic:npc1:topic1:reexamine")],
            },
          ],
        },
        {
          id: "npc2",
          name: "Baked Witness",
          role: "Witness",
          bio: "Painted into the background.",
          layout: { kind: "baked", x: 0.5, y: 0.5, w: 0.1, h: 0.2 },
          topics: [
            {
              id: "topic2",
              label: "The rain",
              status: "unlocked",
              unlock: null,
              reveals: [],
              topicDialogue: [line("topic:npc2:topic2:dialogue")],
              onReexamine: null,
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
      imageAssetId: "evidence.door_log",
      sourceSublocationId: "lobby",
      provenance,
      onCollect: [portraitLine("evidence:door_log:onCollect", NPC1_STANDARD)],
      onReexamine: [line("evidence:door_log:onReexamine")],
    },
  ],
  statementManifest: [
    {
      id: "witness",
      speaker: "Witness",
      content: "I saw the door open.",
      provenance,
      onAcquire: [portraitLine("statement:witness:onAcquire", NPC1_STANDARD)],
      onReexamine: [line("statement:witness:onReexamine")],
    },
  ],
  outro: {
    unlock: "auto",
    dialogue: [portraitLine("outro", NPC1_CONCERNED)],
  },
} satisfies JSONInvestigationScene;

const mappedInvestigationScene = {
  type: "investigation",
  id: "investigation_scene_m",
  title: "City Map",
  summary: "Fixture",
  map: {
    id: "tokyo",
    backgroundAssetId: "background.city_map.tokyo",
    nodes: [{ sublocationId: "rain_bell_cafe", x: 0.16, y: 0.45 }],
  },
  intro: [],
  assetRefs: [],
  sublocations: [
    {
      id: "rain_bell_cafe",
      label: "Rain Bell Cafe",
      status: "unlocked",
      unlock: null,
      reveals: [],
      sceneTag: "場景：雨鐘咖啡",
      backgroundAssetId: "background.chapter_1.inv_m_cafe",
      bgm: null,
      bgs: null,
      transitionDialogue: [],
      hotspots: [],
      characters: [],
    },
  ],
  evidenceManifest: [],
  statementManifest: [],
  outro: { unlock: "auto", dialogue: [] },
} satisfies JSONInvestigationScene;

const interrogationScene = {
  type: "interrogation",
  id: "interrogation_scene_c",
  title: "Interrogation",
  summary: "Fixture",
  intro: [sceneTagCue("場景：偵訊室", INT_INTRO_CUE), line("intro")],
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
        portrait: SUSPECT_STANDARD,
      },
      required: true,
      status: "unlocked",
      unlock: null,
      reveals: [],
      sceneTag: "場景：偵訊室",
      backgroundAssetId: "background.chapter_1.int_c_room",
      bgm: null,
      bgs: { channel: "bgs", assetId: "audio.bgs.street_rain" },
      entryDialogue: [portraitLine("phase:phase1:entry", SUSPECT_STANDARD)],
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
                content: [
                  portraitLine("question:q1:line:l1:content", SUSPECT_STANDARD),
                ],
                contradiction: { kind: "evidence", id: "cctv" },
                challenge: [line("question:q1:line:l1:challenge")],
                onCorrect: [
                  portraitLine(
                    "question:q1:line:l1:onCorrect",
                    SUSPECT_STANDARD,
                  ),
                ],
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
      imageAssetId: "evidence.cctv",
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
  intro: [
    sceneTagCue("場景：解析室", ANA_INTRO_CUE),
    portraitLine("intro", NPC1_STANDARD),
  ],
  outro: [portraitLine("outro", NPC1_STANDARD)],
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
        resultDialogue: [
          portraitLine("board:classify_board:result", NPC1_STANDARD),
        ],
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

function factsFor(
  scene: ReaderScene,
  carrierId: string,
): ReaderPresentationFact[] {
  return scene.presentation.filter((fact) => fact.carrierId === carrierId);
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

// ----- Test-only presentation completeness oracle -----------------------------
//
// Modeled on collectBackgroundCues() in
// packages/scripts/compile-scenes/background-cues-audit.ts: an independent
// recursive scan of the compiled public values (no production projection
// helpers), compared as multisets — duplicates counted — against
// ReaderScene.presentation, so a newly added structural presentation field
// cannot silently disappear and one repeated asset cannot mask a dropped
// field.

function scanPresentationOccurrences(value: unknown, out: string[]): void {
  if (Array.isArray(value)) {
    for (const item of value) scanPresentationOccurrences(item, out);
    return;
  }
  if (value === null || typeof value !== "object") return;
  const record = value as Record<string, unknown>;

  if (Object.hasOwn(record, "backgroundAssetId")) {
    out.push(`backgroundAssetId:${JSON.stringify(record.backgroundAssetId)}`);
  }
  if (Object.hasOwn(record, "bgm")) {
    out.push(`bgm:${JSON.stringify(record.bgm)}`);
  }
  if (Object.hasOwn(record, "bgs")) {
    out.push(`bgs:${JSON.stringify(record.bgs)}`);
  }
  if (typeof record.imageAssetId === "string") {
    out.push(`imageAssetId:${record.imageAssetId}`);
  }
  if (record.portrait != null) {
    out.push(`portrait:${JSON.stringify(record.portrait)}`);
  }
  if (record.kind === "sceneTag" && record.assetCue != null) {
    // The cue's own inner keys are represented by the cue occurrence itself;
    // do not descend into the cue value or its backgroundAssetId/bgm/bgs keys
    // would double-count against the structural field occurrences.
    out.push(`sceneTag.assetCue:${JSON.stringify(record.assetCue)}`);
  } else if (record.kind === "sprite" && typeof record.assetId === "string") {
    out.push(`sprite.assetId:${record.assetId}`);
  }

  for (const [key, child] of Object.entries(record)) {
    if (key === "assetCue" && record.kind === "sceneTag") continue;
    scanPresentationOccurrences(child, out);
  }
}

function presentationFactOccurrences(
  facts: ReaderPresentationFact[],
): string[] {
  const out: string[] = [];
  for (const fact of facts) {
    switch (fact.kind) {
      case "dialogueAssetCue":
        out.push(`sceneTag.assetCue:${JSON.stringify(fact.cue)}`);
        break;
      case "dialoguePortrait":
      case "subjectPortrait":
        out.push(`portrait:${JSON.stringify(fact.portrait)}`);
        break;
      case "structuralVisualCue":
        out.push(`backgroundAssetId:${JSON.stringify(fact.backgroundAssetId)}`);
        out.push(`bgm:${JSON.stringify(fact.bgm)}`);
        out.push(`bgs:${JSON.stringify(fact.bgs)}`);
        break;
      case "evidenceImage":
        out.push(`imageAssetId:${fact.imageAssetId}`);
        break;
      case "sprite":
        out.push(`sprite.assetId:${fact.assetId}`);
        break;
    }
  }
  return out;
}

describe("projectReaderScene presentation facts", () => {
  it("reader_projection_emits_dialogue_presentation_without_changing_reader_items", () => {
    const reader = projectReaderScene(
      "chapter_1",
      "docs/stories_plan/chapter_1/scene_p.md",
      presentationLinearScene,
    );
    expect(reader.presentation).toEqual([
      {
        kind: "dialogueAssetCue",
        carrierId: "main",
        itemIndex: 0,
        cue: LINEAR_CUE,
      },
      {
        kind: "dialoguePortrait",
        carrierId: "main",
        itemIndex: 1,
        portrait: NPC1_STANDARD,
      },
      {
        kind: "dialoguePortrait",
        carrierId: "main",
        itemIndex: 3,
        portrait: NPC1_STANDARD,
      },
    ]);
    // Reader-visible items keep the exact HPA-634 text/cue shape — no
    // presentation fields leak into the rendered tree.
    expect(reader.groups[0]?.items).toEqual([
      { kind: "sceneTag", text: "場景：雨の署" },
      { kind: "line", speaker: SENTINEL_SPEAKER, text: "first" },
      { kind: "action", text: "second" },
      { kind: "line", speaker: SENTINEL_SPEAKER, text: "third" },
    ]);
  });

  it("emits linear main facts in exact queue item order", () => {
    const reader = projectReaderScene(
      "chapter_1",
      "docs/stories_plan/chapter_1/scene_p.md",
      presentationLinearScene,
    );
    expect(
      factsFor(reader, "main").map((fact) =>
        fact.kind === "dialogueAssetCue" || fact.kind === "dialoguePortrait"
          ? fact.itemIndex
          : null,
      ),
    ).toEqual([0, 1, 3]);
  });

  it("emits investigation facts in walk order at the existing reader carrier IDs", () => {
    const reader = investigationReader();
    // Facts ride the single walk: carrier IDs are the existing Reader IDs.
    expect(reader.presentation.map((fact) => fact.carrierId)).toEqual([
      "intro",
      "sublocation:lobby",
      "sublocation:lobby:transition",
      "hotspot:door:inspect",
      "character:npc1",
      "topic:npc1:topic1:dialogue",
      "evidence:door_log",
      "evidence:door_log:onCollect",
      "statement:witness:onAcquire",
      "outro",
    ]);
    expect(factsFor(reader, "intro")).toEqual([
      {
        kind: "dialogueAssetCue",
        carrierId: "intro",
        itemIndex: 0,
        cue: INV_INTRO_CUE,
      },
    ]);
    expect(factsFor(reader, "sublocation:lobby:transition")).toEqual([
      {
        kind: "dialoguePortrait",
        carrierId: "sublocation:lobby:transition",
        itemIndex: 0,
        portrait: NPC1_STANDARD,
      },
    ]);
    expect(factsFor(reader, "hotspot:door:inspect")).toEqual([
      {
        kind: "dialoguePortrait",
        carrierId: "hotspot:door:inspect",
        itemIndex: 0,
        portrait: NPC1_CONCERNED,
      },
    ]);
    // Re-examine carrier stays plain: no facts, reader items unchanged.
    expect(factsFor(reader, "hotspot:door:reexamine")).toEqual([]);
    expect(factsFor(reader, "topic:npc1:topic1:dialogue")).toEqual([
      {
        kind: "dialoguePortrait",
        carrierId: "topic:npc1:topic1:dialogue",
        itemIndex: 0,
        portrait: NPC1_CONCERNED,
      },
    ]);
    expect(factsFor(reader, "topic:npc1:topic1:reexamine")).toEqual([]);

    // Structural facts emitted at the existing traversal sites.
    expect(factsFor(reader, "sublocation:lobby")).toEqual([
      {
        kind: "structuralVisualCue",
        carrierId: "sublocation:lobby",
        backgroundAssetId: "background.chapter_1.inv_b_lobby",
        bgm: { channel: "bgm", assetId: "audio.bgm.rain" },
        bgs: { channel: "bgs", assetId: "audio.bgs.street_rain" },
      },
    ]);
    expect(factsFor(reader, "character:npc1")).toEqual([
      {
        kind: "sprite",
        carrierId: "character:npc1",
        characterId: "npc1",
        assetId: "standee.npc1",
      },
    ]);
    // Baked layouts are explicitly non-asset-bearing: no sprite fact.
    expect(
      reader.presentation.some(
        (fact) => fact.kind === "sprite" && fact.characterId === "npc2",
      ),
    ).toBe(false);
    expect(factsFor(reader, "evidence:door_log")).toEqual([
      {
        kind: "evidenceImage",
        carrierId: "evidence:door_log",
        imageAssetId: "evidence.door_log",
      },
    ]);
    expect(factsFor(reader, "evidence:door_log:onCollect")).toEqual([
      {
        kind: "dialoguePortrait",
        carrierId: "evidence:door_log:onCollect",
        itemIndex: 0,
        portrait: NPC1_STANDARD,
      },
    ]);
    expect(factsFor(reader, "statement:witness:onAcquire")).toEqual([
      {
        kind: "dialoguePortrait",
        carrierId: "statement:witness:onAcquire",
        itemIndex: 0,
        portrait: NPC1_STANDARD,
      },
    ]);
    expect(factsFor(reader, "outro")).toEqual([
      {
        kind: "dialoguePortrait",
        carrierId: "outro",
        itemIndex: 0,
        portrait: NPC1_CONCERNED,
      },
    ]);
  });

  it("projects a mapped scene as exactly one map structural cue before sublocation cues", () => {
    const reader = projectReaderScene(
      "chapter_1",
      "docs/stories_plan/chapter_1/investigation_scene_m.md",
      mappedInvestigationScene,
    );
    // One map fact, emitted before the ordinary sublocation structural cues.
    expect(reader.presentation.map((fact) => fact.carrierId)).toEqual([
      "map:tokyo",
      "sublocation:rain_bell_cafe",
    ]);
    expect(factsFor(reader, "map:tokyo")).toEqual([
      {
        kind: "structuralVisualCue",
        carrierId: "map:tokyo",
        backgroundAssetId: "background.city_map.tokyo",
        bgm: null,
        bgs: null,
      },
    ]);
    // Map-less scenes never emit a map fact.
    expect(
      investigationReader().presentation.some((fact) =>
        fact.carrierId.startsWith("map:"),
      ),
    ).toBe(false);
  });

  it("emits interrogation facts in walk order across phases, questions, lines, and inventory", () => {
    const reader = interrogationReader();
    expect(reader.presentation.map((fact) => fact.carrierId)).toEqual([
      "intro",
      "phase:phase1",
      "phase:phase1",
      "phase:phase1:entry",
      "question:q1:line:l1:content",
      "question:q1:line:l1:onCorrect",
      "evidence:cctv",
    ]);
    expect(factsFor(reader, "intro")).toEqual([
      {
        kind: "dialogueAssetCue",
        carrierId: "intro",
        itemIndex: 0,
        cue: INT_INTRO_CUE,
      },
    ]);
    // Phase entry: structural visual cue first, then the subject portrait.
    expect(factsFor(reader, "phase:phase1")).toEqual([
      {
        kind: "structuralVisualCue",
        carrierId: "phase:phase1",
        backgroundAssetId: "background.chapter_1.int_c_room",
        bgm: null,
        bgs: { channel: "bgs", assetId: "audio.bgs.street_rain" },
      },
      {
        kind: "subjectPortrait",
        carrierId: "phase:phase1",
        portrait: SUSPECT_STANDARD,
      },
    ]);
    expect(factsFor(reader, "phase:phase1:entry")).toEqual([
      {
        kind: "dialoguePortrait",
        carrierId: "phase:phase1:entry",
        itemIndex: 0,
        portrait: SUSPECT_STANDARD,
      },
    ]);
    // Question-level carriers without assets contribute no facts.
    expect(factsFor(reader, "question:q1:onLoop")).toEqual([]);
    expect(factsFor(reader, "question:q1:loopPrompt")).toEqual([]);
    expect(factsFor(reader, "question:q1:defaultChallenge")).toEqual([]);
    expect(factsFor(reader, "question:q1:defaultWrong")).toEqual([]);
    expect(factsFor(reader, "question:q1:wrongReply")).toEqual([]);
    expect(factsFor(reader, "question:q1:line:l1:content")).toEqual([
      {
        kind: "dialoguePortrait",
        carrierId: "question:q1:line:l1:content",
        itemIndex: 0,
        portrait: SUSPECT_STANDARD,
      },
    ]);
    expect(factsFor(reader, "question:q1:line:l1:challenge")).toEqual([]);
    expect(factsFor(reader, "question:q1:line:l1:onCorrect")).toEqual([
      {
        kind: "dialoguePortrait",
        carrierId: "question:q1:line:l1:onCorrect",
        itemIndex: 0,
        portrait: SUSPECT_STANDARD,
      },
    ]);
    expect(factsFor(reader, "question:q1:line:l1:onWrongEvidence")).toEqual([]);
    expect(factsFor(reader, "evidence:cctv")).toEqual([
      {
        kind: "evidenceImage",
        carrierId: "evidence:cctv",
        imageAssetId: "evidence.cctv",
      },
    ]);
    expect(factsFor(reader, "statement:witness:onAcquire")).toEqual([]);
    expect(factsFor(reader, "outro")).toEqual([]);
  });

  it("text_only_carriers_project_completely_with_zero_presentation", () => {
    // Plain text-only carriers keep the strict structural consumption: every
    // compiler carrier is still taken, asserted, and rendered, while Assets
    // later emits no usage for them.
    const reader = projectReaderScene(
      "chapter_1",
      "docs/stories_plan/chapter_1/scene_a.md",
      linearScene,
    );
    expect(reader.presentation).toEqual([]);
    expect(reader.groups.map((group) => group.id)).toEqual(["main"]);
    expect(reader.groups[0]?.items).toHaveLength(2);
    const enriched = investigationReader();
    for (const id of [
      "hotspot:door:reexamine",
      "topic:npc1:topic1:reexamine",
    ]) {
      const group = findGroup(enriched, id);
      expect(
        group?.items.some((item) => item.kind !== "notice"),
        id,
      ).toBe(true);
    }
  });

  it("public analysis emits presentation only from sanitized public dialogue", () => {
    const reader = analysisReader();
    // Only public intro/result/outro dialogue facts — never board answer data.
    // intro: cue + portrait, outro: portrait, classify result: portrait.
    expect(reader.presentation).toHaveLength(4);
    for (const fact of reader.presentation) {
      expect(
        fact.kind === "dialogueAssetCue" || fact.kind === "dialoguePortrait",
      ).toBe(true);
      expect(["intro", "outro", "board:classify_board:result"]).toContain(
        fact.carrierId,
      );
    }
    expect(factsFor(reader, "intro")).toEqual([
      {
        kind: "dialogueAssetCue",
        carrierId: "intro",
        itemIndex: 0,
        cue: ANA_INTRO_CUE,
      },
      {
        kind: "dialoguePortrait",
        carrierId: "intro",
        itemIndex: 1,
        portrait: NPC1_STANDARD,
      },
    ]);
    expect(factsFor(reader, "board:classify_board:result")).toEqual([
      {
        kind: "dialoguePortrait",
        carrierId: "board:classify_board:result",
        itemIndex: 0,
        portrait: NPC1_STANDARD,
      },
    ]);
    expect(factsFor(reader, "outro")).toEqual([
      {
        kind: "dialoguePortrait",
        carrierId: "outro",
        itemIndex: 0,
        portrait: NPC1_STANDARD,
      },
    ]);
  });

  it("presentation multiset matches every raw presentation-bearing occurrence", () => {
    const cases: Array<[string, WorkbenchScenePayload]> = [
      ["scene_p", presentationLinearScene],
      ["investigation_scene_b", investigationScene],
      ["interrogation_scene_c", interrogationScene],
      ["analysis_scene_d", analysisScene],
    ];
    for (const [id, scene] of cases) {
      const reader = projectReaderScene(
        "chapter_1",
        `docs/stories_plan/chapter_1/${id}.md`,
        scene,
      );
      const raw: string[] = [];
      scanPresentationOccurrences(scene, raw);
      const facts = presentationFactOccurrences(reader.presentation);
      expect(
        [...raw].sort(),
        `${id}: raw occurrences vs presentation facts`,
      ).toEqual([...facts].sort());
    }
  });

  it("counts repeated identical occurrences instead of masking dropped fields", () => {
    // NPC1 refs appear on six line items across the investigation fixture
    // (transition, inspect, topic dialogue, onCollect, onAcquire, outro) —
    // and SUSPECT_STANDARD four times in the interrogation fixture (subject
    // portrait, entry, content, onCorrect). Each occurrence must be
    // represented; none may be collapsed away.
    const investigation = investigationReader().presentation.filter(
      (fact) => fact.kind === "dialoguePortrait",
    );
    expect(investigation).toHaveLength(6);
    const interrogation = interrogationReader().presentation;
    expect(
      interrogation.filter(
        (fact) =>
          (fact.kind === "dialoguePortrait" ||
            fact.kind === "subjectPortrait") &&
          fact.portrait.assetId === SUSPECT_STANDARD.assetId,
      ),
    ).toHaveLength(4);
  });
});

import { describe, expect, it } from "bun:test";
import { validate } from "./validator";
import type {
  ASTChapter,
  ASTEvidence,
  ASTInquiryPhase,
  ASTInquiryQuestion,
  ASTInterrogationPhase,
  ASTInterrogationScene,
  ASTInvestigationScene,
  ASTLinearScene,
  ASTStatement,
  ASTTestimonyPhase,
  ASTTestimonyResult,
  ASTTestimonyStatement,
  DialogueItem,
} from "./types";

// Test helpers — minimal AST builders.

const mkLinearScene = (id: string): ASTLinearScene => ({
  kind: "linearScene",
  id,
  title: id,
  queue: [],
  sourceFile: `${id}.md`,
  line: 1,
});

const mkInvestigationScene = (overrides: Partial<ASTInvestigationScene> = {}): ASTInvestigationScene => ({
  kind: "investigationScene",
  id: overrides.id ?? "i",
  title: overrides.title ?? "i",
  intro: [],
  sublocations: [
    {
      id: "room",
      label: "Room",
      status: "unlocked",
      unlock: null,
      reveals: [],
      sceneTag: "tag",
      transitionDialogue: [],
      hotspots: [
        {
          id: "thing",
          label: "thing",
          description: "a thing",
          status: "unlocked",
          unlock: null,
          reveals: [],
          inspectDialogue: [{ kind: "line", speaker: "A", text: "hi" }] as DialogueItem[],
          onReexamine: null,
          sourceFile: "i.md",
          line: 4,
        },
      ],
      characters: [],
      sourceFile: "i.md",
      line: 2,
    },
  ],
  evidenceManifest: [],
  statementManifest: [],
  outro: { unlock: "auto", dialogue: [] },
  sourceFile: "i.md",
  line: 1,
  ...overrides,
});

const mkEvidence = (id: string): ASTEvidence => ({
  id,
  name: id,
  description: id,
  details: id,
  onCollect: [],
  onReexamine: null,
  sourceFile: "interrogation_scene_1.md",
  line: 1,
});

const mkStatement = (id: string): ASTStatement => ({
  id,
  speaker: "Witness",
  content: id,
  onAcquire: [],
  onReexamine: null,
  sourceFile: "interrogation_scene_1.md",
  line: 1,
});

const mkQuestion = (overrides: Partial<ASTInquiryQuestion> = {}): ASTInquiryQuestion => ({
  id: "question",
  label: "Question",
  kind: "question",
  parentQuestionId: null,
  status: "unlocked",
  required: true,
  unlock: null,
  reveals: [],
  answerDialogue: [],
  onReask: null,
  sourceFile: "interrogation_scene_1.md",
  line: 1,
  ...overrides,
});

const mkResult = (overrides: Partial<ASTTestimonyResult> = {}): ASTTestimonyResult => ({
  id: "result",
  label: "Result",
  reveals: [],
  dialogue: [],
  sourceFile: "interrogation_scene_1.md",
  line: 1,
  ...overrides,
});

const mkTestimonyStatement = (overrides: Partial<ASTTestimonyStatement> = {}): ASTTestimonyStatement => ({
  id: "statement",
  label: "Statement",
  content: "Statement",
  contradiction: null,
  onCorrect: null,
  onWrong: null,
  onPress: null,
  onPresent: null,
  onWrongPresent: null,
  reveals: [],
  sourceFile: "interrogation_scene_1.md",
  line: 1,
  ...overrides,
});

const mkInquiryPhase = (overrides: Partial<ASTInquiryPhase> = {}): ASTInquiryPhase => ({
  kind: "inquiry",
  id: "inquiry",
  label: "Inquiry",
  subject: {
    id: "subject",
    name: "Subject",
    role: "Witness",
    bio: "Bio",
    sourceFile: "interrogation_scene_1.md",
    line: 1,
  },
  required: true,
  status: "unlocked",
  unlock: null,
  reveals: [],
  sceneTag: "room",
  entryDialogue: [],
  complete: "auto",
  questions: [mkQuestion()],
  sourceFile: "interrogation_scene_1.md",
  line: 1,
  ...overrides,
});

const mkTestimonyPhase = (overrides: Partial<ASTTestimonyPhase> = {}): ASTTestimonyPhase => ({
  kind: "testimony",
  id: "testimony",
  label: "Testimony",
  subject: {
    id: "subject",
    name: "Subject",
    role: "Witness",
    bio: "Bio",
    sourceFile: "interrogation_scene_1.md",
    line: 1,
  },
  required: true,
  status: "unlocked",
  unlock: null,
  reveals: [],
  sceneTag: "room",
  entryDialogue: [],
  statements: [mkTestimonyStatement()],
  results: [mkResult()],
  sourceFile: "interrogation_scene_1.md",
  line: 1,
  ...overrides,
});

const mkInterrogationScene = (overrides: Partial<ASTInterrogationScene> = {}): ASTInterrogationScene => {
  const phases = overrides.phases ?? [mkInquiryPhase(), mkTestimonyPhase()];

  return {
    kind: "interrogationScene",
    id: "interrogation_scene_1",
    title: "Interrogation",
    intro: [],
    phases: phases as ASTInterrogationPhase[],
    evidenceManifest: [],
    statementManifest: [],
    outro: { unlock: "auto", dialogue: [] },
    sourceFile: "interrogation_scene_1.md",
    line: 1,
    ...overrides,
  };
};

const mkChapter = (number: number, sceneFiles: string[]): ASTChapter => ({
  kind: "chapter",
  dirName: `chapter_${number}`,
  number,
  title: `Chapter ${number}`,
  summary: "s",
  sceneFiles,
  sourceFile: `chapter_${number}/chapter.md`,
  line: 1,
});

describe("validator", () => {
  it("accepts a valid minimal corpus", () => {
    const errors = validate({
      chapters: [mkChapter(1, ["scene_0.md", "investigation_scene_1.md"])],
      scenes: [
        { chapterId: "chapter_1", file: "scene_0.md", ast: mkLinearScene("scene_0") },
        { chapterId: "chapter_1", file: "investigation_scene_1.md", ast: mkInvestigationScene({ id: "investigation_scene_1" }) },
      ],
    });
    expect(errors).toEqual([]);
  });

  it("rejects a chapter manifest pointing to a non-existent scene file", () => {
    const errors = validate({
      chapters: [mkChapter(1, ["missing.md"])],
      scenes: [],
    });
    expect(errors.find((e) => e.code === "chapterManifestMissingFile")).toBeDefined();
  });

  it("rejects a chapter whose only scenes are reserved placeholders", () => {
    const errors = validate({
      chapters: [mkChapter(1, ["interrogation_scene_1.md"])],
      scenes: [],
      skippedReservedFiles: new Set(["chapter_1/interrogation_scene_1.md"]),
    });
    expect(errors.find((e) => e.code === "chapterNoPlayableScenes")).toBeDefined();
    expect(errors.find((e) => e.code === "chapterManifestMissingFile")).toBeUndefined();
  });

  it("rejects a hotspot whose Reveals target an undeclared evidence id", () => {
    const scene = mkInvestigationScene({ id: "i" });
    scene.sublocations[0]!.hotspots[0]!.reveals = [{ kind: "evidence", id: "ghost" }];
    const errors = validate({
      chapters: [mkChapter(1, ["i.md"])],
      scenes: [{ chapterId: "chapter_1", file: "i.md", ast: scene }],
    });
    expect(errors.find((e) => e.code === "unresolvedRevealTarget")).toBeDefined();
  });

  it("rejects duplicate global evidence ids across chapters", () => {
    const scene1 = mkInvestigationScene({ id: "a" });
    scene1.evidenceManifest = [
      { id: "dup", name: "n", description: "d", details: "x", onCollect: [], onReexamine: null, sourceFile: "a.md", line: 10 },
    ];
    const scene2 = mkInvestigationScene({ id: "b" });
    scene2.evidenceManifest = [
      { id: "dup", name: "n", description: "d", details: "x", onCollect: [], onReexamine: null, sourceFile: "b.md", line: 10 },
    ];
    const errors = validate({
      chapters: [mkChapter(1, ["a.md"]), mkChapter(2, ["b.md"])],
      scenes: [
        { chapterId: "chapter_1", file: "a.md", ast: scene1 },
        { chapterId: "chapter_2", file: "b.md", ast: scene2 },
      ],
    });
    expect(errors.find((e) => e.code === "duplicateGlobalEvidenceId")).toBeDefined();
  });

  it("rejects a cross-chapter Unlock predicate (v1 restriction)", () => {
    const scene1 = mkInvestigationScene({ id: "a" });
    scene1.evidenceManifest = [
      { id: "foo", name: "n", description: "d", details: "x", onCollect: [], onReexamine: null, sourceFile: "a.md", line: 10 },
    ];
    const scene2 = mkInvestigationScene({ id: "b" });
    scene2.outro = {
      unlock: { predicate: "evidence_collected", id: "foo" },
      dialogue: [],
    };
    const errors = validate({
      chapters: [mkChapter(1, ["a.md"]), mkChapter(2, ["b.md"])],
      scenes: [
        { chapterId: "chapter_1", file: "a.md", ast: scene1 },
        { chapterId: "chapter_2", file: "b.md", ast: scene2 },
      ],
    });
    expect(errors.find((e) => e.code === "crossChapterUnlock")).toBeDefined();
  });

  it("rejects an Outro Unlock referencing a hotspot id not declared in the same scene", () => {
    const scene = mkInvestigationScene({ id: "i" });
    scene.outro = {
      unlock: { predicate: "hotspot_investigated", id: "ghost" },
      dialogue: [],
    };
    const errors = validate({
      chapters: [mkChapter(1, ["i.md"])],
      scenes: [{ chapterId: "chapter_1", file: "i.md", ast: scene }],
    });
    expect(errors.find((e) => e.code === "unresolvedUnlockPredicate")).toBeDefined();
  });

  it("rejects a locked sub-location with no inbound Reveals and no Unlock", () => {
    const scene = mkInvestigationScene({ id: "i" });
    scene.sublocations.push({
      id: "orphan",
      label: "Orphan",
      status: "locked",
      unlock: null,
      reveals: [],
      sceneTag: "t",
      transitionDialogue: [],
      hotspots: [],
      characters: [],
      sourceFile: "i.md",
      line: 50,
    });
    const errors = validate({
      chapters: [mkChapter(1, ["i.md"])],
      scenes: [{ chapterId: "chapter_1", file: "i.md", ast: scene }],
    });
    expect(errors.find((e) => e.code === "lockedBlockUnreachable")).toBeDefined();
  });

  it("rejects a block with BOTH an inbound Reveals and a self Unlock", () => {
    const scene = mkInvestigationScene({ id: "i" });
    scene.sublocations[0]!.hotspots[0]!.reveals = [{ kind: "sublocation", id: "double_path" }];
    scene.sublocations.push({
      id: "double_path",
      label: "Double Path",
      status: "locked",
      unlock: { predicate: "hotspot_investigated", id: "thing" },
      reveals: [],
      sceneTag: "t",
      transitionDialogue: [],
      hotspots: [],
      characters: [],
      sourceFile: "i.md",
      line: 60,
    });
    const errors = validate({
      chapters: [mkChapter(1, ["i.md"])],
      scenes: [{ chapterId: "chapter_1", file: "i.md", ast: scene }],
    });
    expect(errors.find((e) => e.code === "revealsAndUnlockBoth")).toBeDefined();
  });

  it("rejects cyclic unlock dependencies between sub-locations", () => {
    // Two locked sub-locations that each need a hotspot inside the other.
    // Neither can be reached from an unlocked starting point.
    const scene = mkInvestigationScene({ id: "i" });
    scene.sublocations = [
      {
        id: "room_a",
        label: "Room A",
        status: "unlocked", // first must be unlocked per parser rule
        unlock: null,
        reveals: [],
        sceneTag: "room a",
        transitionDialogue: [],
        hotspots: [],
        characters: [],
        sourceFile: "i.md",
        line: 2,
      },
      {
        id: "room_b",
        label: "Room B",
        status: "locked",
        // Needs hotspot inside room_c
        unlock: { predicate: "hotspot_investigated", id: "hc" },
        reveals: [{ kind: "hotspot", id: "hb" }],
        sceneTag: "room b",
        transitionDialogue: [],
        hotspots: [
          {
            id: "hb",
            label: "hb",
            description: "b",
            status: "unlocked",
            unlock: null,
            reveals: [],
            inspectDialogue: [{ kind: "line", speaker: "B", text: "hi" }],
            onReexamine: null,
            sourceFile: "i.md",
            line: 15,
          },
        ],
        characters: [],
        sourceFile: "i.md",
        line: 12,
      },
      {
        id: "room_c",
        label: "Room C",
        status: "locked",
        // Needs hotspot inside room_b — mutual deadlock
        unlock: { predicate: "hotspot_investigated", id: "hb" },
        reveals: [{ kind: "hotspot", id: "hc" }],
        sceneTag: "room c",
        transitionDialogue: [],
        hotspots: [
          {
            id: "hc",
            label: "hc",
            description: "c",
            status: "unlocked",
            unlock: null,
            reveals: [],
            inspectDialogue: [{ kind: "line", speaker: "C", text: "hi" }],
            onReexamine: null,
            sourceFile: "i.md",
            line: 25,
          },
        ],
        characters: [],
        sourceFile: "i.md",
        line: 22,
      },
    ];
    const errors = validate({
      chapters: [mkChapter(1, ["i.md"])],
      scenes: [{ chapterId: "chapter_1", file: "i.md", ast: scene }],
    });
    // room_b and room_c are both locked with no inbound Reveals from room_a.
    // room_b's Reveals targets hotspot:hb (inside itself), not a sublocation.
    // room_c's Reveals targets hotspot:hc (inside itself), not a sublocation.
    // Neither has an inbound Reveals from a reachable block.
    // room_b needs hc (inside locked room_c), room_c needs hb (inside locked room_b) → cycle.
    const reachErr = errors.find((e) => e.code === "lockedBlockUnreachable" && e.message.includes("room_b"));
    expect(reachErr).toBeDefined();
    const reachErr2 = errors.find((e) => e.code === "lockedBlockUnreachable" && e.message.includes("room_c"));
    expect(reachErr2).toBeDefined();
  });

  it("accepts a reachable locked block via Unlock predicate chain", () => {
    // room_a is unlocked, has hotspot that unlocks room_b via Reveals,
    // room_b has a locked hotspot whose Unlock references a reachable hotspot.
    const scene = mkInvestigationScene({ id: "i" });
    scene.sublocations[0]!.hotspots = [
      {
        id: "h1",
        label: "h1",
        description: "h1",
        status: "unlocked",
        unlock: null,
        reveals: [{ kind: "sublocation", id: "room_b" }],
        inspectDialogue: [{ kind: "line", speaker: "A", text: "hi" }],
        onReexamine: null,
        sourceFile: "i.md",
        line: 4,
      },
    ];
    scene.sublocations.push({
      id: "room_b",
      label: "Room B",
      status: "locked",
      unlock: null, // unlocked via Reveals from h1
      reveals: [],
      sceneTag: "room b",
      transitionDialogue: [],
      hotspots: [
        {
          id: "h2",
          label: "h2",
          description: "h2",
          status: "locked",
          unlock: { predicate: "hotspot_investigated", id: "h1" },
          reveals: [],
          inspectDialogue: [{ kind: "line", speaker: "B", text: "hi" }],
          onReexamine: null,
          sourceFile: "i.md",
          line: 12,
        },
      ],
      characters: [],
      sourceFile: "i.md",
      line: 10,
    });
    const errors = validate({
      chapters: [mkChapter(1, ["i.md"])],
      scenes: [{ chapterId: "chapter_1", file: "i.md", ast: scene }],
    });
    // room_b is reachable (via Reveals from h1), h2 is reachable
    // (room_b reachable + unlock references reachable hotspot h1)
    expect(errors).toEqual([]);
  });

  it("rejects a locked block whose evidence_collected predicate references evidence only revealed by itself", () => {
    // A locked hotspot requires evidence:x, but evidence:x is only revealed
    // by that same locked hotspot — a circular dependency the runtime can never resolve.
    const scene = mkInvestigationScene({ id: "i" });
    scene.evidenceManifest = [
      { id: "ev1", name: "ev1", description: "d", details: "x", onCollect: [], onReexamine: null, sourceFile: "i.md", line: 20 },
    ];
    scene.sublocations[0]!.hotspots = [
      {
        id: "h1",
        label: "h1",
        description: "h1",
        status: "unlocked",
        unlock: null,
        reveals: [],
        inspectDialogue: [{ kind: "line", speaker: "A", text: "hi" }],
        onReexamine: null,
        sourceFile: "i.md",
        line: 4,
      },
      {
        id: "h2",
        label: "h2",
        description: "h2",
        status: "locked",
        unlock: { predicate: "evidence_collected", id: "ev1" },
        reveals: [{ kind: "evidence", id: "ev1" }],
        inspectDialogue: [{ kind: "line", speaker: "A", text: "found it" }],
        onReexamine: null,
        sourceFile: "i.md",
        line: 8,
      },
    ];
    const errors = validate({
      chapters: [mkChapter(1, ["i.md"])],
      scenes: [{ chapterId: "chapter_1", file: "i.md", ast: scene }],
    });
    const reachErr = errors.find((e) => e.code === "lockedBlockUnreachable" && e.message.includes("h2"));
    expect(reachErr).toBeDefined();
  });

  it("accepts a locked block whose evidence_collected predicate references evidence revealed by a reachable block", () => {
    const scene = mkInvestigationScene({ id: "i" });
    scene.evidenceManifest = [
      { id: "ev1", name: "ev1", description: "d", details: "x", onCollect: [], onReexamine: null, sourceFile: "i.md", line: 20 },
    ];
    scene.sublocations[0]!.hotspots = [
      {
        id: "h1",
        label: "h1",
        description: "h1",
        status: "unlocked",
        unlock: null,
        reveals: [{ kind: "evidence", id: "ev1" }],
        inspectDialogue: [{ kind: "line", speaker: "A", text: "hi" }],
        onReexamine: null,
        sourceFile: "i.md",
        line: 4,
      },
      {
        id: "h2",
        label: "h2",
        description: "h2",
        status: "locked",
        unlock: { predicate: "evidence_collected", id: "ev1" },
        reveals: [],
        inspectDialogue: [{ kind: "line", speaker: "A", text: "unlocked" }],
        onReexamine: null,
        sourceFile: "i.md",
        line: 8,
      },
    ];
    const errors = validate({
      chapters: [mkChapter(1, ["i.md"])],
      scenes: [{ chapterId: "chapter_1", file: "i.md", ast: scene }],
    });
    expect(errors).toEqual([]);
  });

  it("rejects a locked block whose statement_acquired predicate references a statement only revealed by another unreachable block", () => {
    const scene = mkInvestigationScene({ id: "i" });
    scene.statementManifest = [
      { id: "st1", speaker: "X", content: "s", onAcquire: [], onReexamine: null, sourceFile: "i.md", line: 30 },
    ];
    scene.sublocations[0]!.hotspots = [
      {
        id: "h1",
        label: "h1",
        description: "h1",
        status: "unlocked",
        unlock: null,
        reveals: [],
        inspectDialogue: [{ kind: "line", speaker: "A", text: "hi" }],
        onReexamine: null,
        sourceFile: "i.md",
        line: 4,
      },
      {
        id: "h2",
        label: "h2",
        description: "h2",
        status: "locked",
        unlock: { predicate: "statement_acquired", id: "st1" },
        reveals: [],
        inspectDialogue: [{ kind: "line", speaker: "A", text: "unlocked" }],
        onReexamine: null,
        sourceFile: "i.md",
        line: 8,
      },
      {
        id: "h3",
        label: "h3",
        description: "h3",
        status: "locked",
        unlock: { predicate: "hotspot_investigated", id: "h2" },
        reveals: [{ kind: "statement", id: "st1" }],
        inspectDialogue: [{ kind: "line", speaker: "A", text: "locked" }],
        onReexamine: null,
        sourceFile: "i.md",
        line: 12,
      },
    ];
    const errors = validate({
      chapters: [mkChapter(1, ["i.md"])],
      scenes: [{ chapterId: "chapter_1", file: "i.md", ast: scene }],
    });
    // h2 needs st1, st1 is only revealed by h3, h3 needs h2 — deadlock.
    const reachErr = errors.find((e) => e.code === "lockedBlockUnreachable" && e.message.includes("h2"));
    expect(reachErr).toBeDefined();
  });

  it("rejects a locked sub-location whose evidence_collected unlock references evidence not revealed by any reachable sub-location", () => {
    const scene = mkInvestigationScene({ id: "i" });
    scene.evidenceManifest = [
      { id: "ev1", name: "ev1", description: "d", details: "x", onCollect: [], onReexamine: null, sourceFile: "i.md", line: 20 },
    ];
    scene.sublocations = [
      {
        id: "room_a",
        label: "Room A",
        status: "unlocked",
        unlock: null,
        reveals: [],
        sceneTag: "room a",
        transitionDialogue: [],
        hotspots: [
          {
            id: "h1",
            label: "h1",
            description: "h1",
            status: "unlocked",
            unlock: null,
            reveals: [],
            inspectDialogue: [{ kind: "line", speaker: "A", text: "hi" }],
            onReexamine: null,
            sourceFile: "i.md",
            line: 4,
          },
        ],
        characters: [],
        sourceFile: "i.md",
        line: 2,
      },
      {
        id: "room_b",
        label: "Room B",
        status: "locked",
        unlock: { predicate: "evidence_collected", id: "ev1" },
        reveals: [],
        sceneTag: "room b",
        transitionDialogue: [],
        hotspots: [
          {
            id: "h2",
            label: "h2",
            description: "h2",
            status: "unlocked",
            unlock: null,
            reveals: [{ kind: "evidence", id: "ev1" }],
            inspectDialogue: [{ kind: "line", speaker: "B", text: "found" }],
            onReexamine: null,
            sourceFile: "i.md",
            line: 15,
          },
        ],
        characters: [],
        sourceFile: "i.md",
        line: 12,
      },
    ];
    const errors = validate({
      chapters: [mkChapter(1, ["i.md"])],
      scenes: [{ chapterId: "chapter_1", file: "i.md", ast: scene }],
    });
    // room_b needs evidence:ev1, but ev1 is only revealed inside room_b itself.
    const reachErr = errors.find((e) => e.code === "lockedBlockUnreachable" && e.message.includes("room_b"));
    expect(reachErr).toBeDefined();
  });

  // ---- P1: cross-sublocation reveals in internal reachability ----

  it("accepts a locked topic whose evidence_collected predicate references evidence revealed by an unlocked hotspot in another sub-location", () => {
    const scene = mkInvestigationScene({ id: "i" });
    scene.evidenceManifest = [
      { id: "ev1", name: "ev1", description: "d", details: "x", onCollect: [], onReexamine: null, sourceFile: "i.md", line: 20 },
    ];
    // room_a has an unlocked hotspot that reveals evidence:ev1
    scene.sublocations[0]!.hotspots = [
      {
        id: "h1",
        label: "h1",
        description: "h1",
        status: "unlocked",
        unlock: null,
        reveals: [{ kind: "evidence", id: "ev1" }],
        inspectDialogue: [{ kind: "line", speaker: "A", text: "hi" }],
        onReexamine: null,
        sourceFile: "i.md",
        line: 4,
      },
    ];
    scene.sublocations[0]!.characters = [
      {
        id: "npc1",
        name: "NPC1",
        role: "witness",
        bio: "bio",
        topics: [
          {
            id: "secret",
            label: "Secret Topic",
            status: "locked",
            unlock: { predicate: "evidence_collected", id: "ev1" },
            reveals: [],
            topicDialogue: [{ kind: "line", speaker: "NPC1", text: "unlocked" }],
            onReexamine: null,
            sourceFile: "i.md",
            line: 10,
          },
        ],
        sourceFile: "i.md",
        line: 8,
      },
    ];
    // room_b also unlocked, has a locked topic needing evidence:ev1
    scene.sublocations.push({
      id: "room_b",
      label: "Room B",
      status: "unlocked",
      unlock: null,
      reveals: [],
      sceneTag: "room b",
      transitionDialogue: [],
      hotspots: [],
      characters: [
        {
          id: "npc2",
          name: "NPC2",
          role: "witness",
          bio: "bio",
          topics: [
            {
              id: "another_secret",
              label: "Another Secret",
              status: "locked",
              unlock: { predicate: "evidence_collected", id: "ev1" },
              reveals: [],
              topicDialogue: [{ kind: "line", speaker: "NPC2", text: "unlocked" }],
              onReexamine: null,
              sourceFile: "i.md",
              line: 20,
            },
          ],
          sourceFile: "i.md",
          line: 18,
        },
      ],
      sourceFile: "i.md",
      line: 15,
    });
    const errors = validate({
      chapters: [mkChapter(1, ["i.md"])],
      scenes: [{ chapterId: "chapter_1", file: "i.md", ast: scene }],
    });
    expect(errors).toEqual([]);
  });

  it("accepts a locked hotspot whose statement_acquired predicate references a statement revealed by an unlocked hotspot in another sub-location", () => {
    const scene = mkInvestigationScene({ id: "i" });
    scene.statementManifest = [
      { id: "st1", speaker: "X", content: "s", onAcquire: [], onReexamine: null, sourceFile: "i.md", line: 30 },
    ];
    // room_a: unlocked hotspot reveals statement:st1
    scene.sublocations[0]!.hotspots = [
      {
        id: "h1",
        label: "h1",
        description: "h1",
        status: "unlocked",
        unlock: null,
        reveals: [{ kind: "statement", id: "st1" }],
        inspectDialogue: [{ kind: "line", speaker: "A", text: "hi" }],
        onReexamine: null,
        sourceFile: "i.md",
        line: 4,
      },
    ];
    // room_b: locked hotspot needs statement:st1
    scene.sublocations.push({
      id: "room_b",
      label: "Room B",
      status: "unlocked",
      unlock: null,
      reveals: [],
      sceneTag: "room b",
      transitionDialogue: [],
      hotspots: [
        {
          id: "h2",
          label: "h2",
          description: "h2",
          status: "locked",
          unlock: { predicate: "statement_acquired", id: "st1" },
          reveals: [],
          inspectDialogue: [{ kind: "line", speaker: "B", text: "hi" }],
          onReexamine: null,
          sourceFile: "i.md",
          line: 12,
        },
      ],
      characters: [],
      sourceFile: "i.md",
      line: 10,
    });
    const errors = validate({
      chapters: [mkChapter(1, ["i.md"])],
      scenes: [{ chapterId: "chapter_1", file: "i.md", ast: scene }],
    });
    expect(errors).toEqual([]);
  });

  it("accepts a locked hotspot whose evidence_collected predicate references evidence from another sub-location entry reveal", () => {
    const scene = mkInvestigationScene({ id: "i" });
    scene.evidenceManifest = [
      { id: "ev_entry", name: "ev_entry", description: "d", details: "x", onCollect: [], onReexamine: null, sourceFile: "i.md", line: 30 },
    ];
    scene.sublocations[0]!.reveals = [{ kind: "evidence", id: "ev_entry" }];
    scene.sublocations.push({
      id: "room_b",
      label: "Room B",
      status: "unlocked",
      unlock: null,
      reveals: [],
      sceneTag: "room b",
      transitionDialogue: [],
      hotspots: [
        {
          id: "h2",
          label: "h2",
          description: "h2",
          status: "locked",
          unlock: { predicate: "evidence_collected", id: "ev_entry" },
          reveals: [],
          inspectDialogue: [{ kind: "line", speaker: "B", text: "hi" }],
          onReexamine: null,
          sourceFile: "i.md",
          line: 12,
        },
      ],
      characters: [],
      sourceFile: "i.md",
      line: 10,
    });
    const errors = validate({
      chapters: [mkChapter(1, ["i.md"])],
      scenes: [{ chapterId: "chapter_1", file: "i.md", ast: scene }],
    });
    expect(errors).toEqual([]);
  });

  it("accepts a locked block unlocked by evidence revealed through another reachable sub-location's locked-block chain", () => {
    const scene = mkInvestigationScene({ id: "i" });
    scene.evidenceManifest = [
      { id: "ev_chain", name: "ev_chain", description: "d", details: "x", onCollect: [], onReexamine: null, sourceFile: "i.md", line: 30 },
    ];
    scene.sublocations = [
      {
        id: "room_a",
        label: "Room A",
        status: "unlocked",
        unlock: null,
        reveals: [],
        sceneTag: "room a",
        transitionDialogue: [],
        hotspots: [
          {
            id: "a1",
            label: "a1",
            description: "a1",
            status: "locked",
            unlock: { predicate: "evidence_collected", id: "ev_chain" },
            reveals: [],
            inspectDialogue: [{ kind: "line", speaker: "A", text: "unlocked" }],
            onReexamine: null,
            sourceFile: "i.md",
            line: 8,
          },
        ],
        characters: [],
        sourceFile: "i.md",
        line: 2,
      },
      {
        id: "room_b",
        label: "Room B",
        status: "unlocked",
        unlock: null,
        reveals: [],
        sceneTag: "room b",
        transitionDialogue: [],
        hotspots: [
          {
            id: "b1",
            label: "b1",
            description: "b1",
            status: "unlocked",
            unlock: null,
            reveals: [{ kind: "hotspot", id: "b2" }],
            inspectDialogue: [{ kind: "line", speaker: "B", text: "first" }],
            onReexamine: null,
            sourceFile: "i.md",
            line: 18,
          },
          {
            id: "b2",
            label: "b2",
            description: "b2",
            status: "locked",
            unlock: null,
            reveals: [{ kind: "evidence", id: "ev_chain" }],
            inspectDialogue: [{ kind: "line", speaker: "B", text: "second" }],
            onReexamine: null,
            sourceFile: "i.md",
            line: 24,
          },
        ],
        characters: [],
        sourceFile: "i.md",
        line: 14,
      },
    ];
    const errors = validate({
      chapters: [mkChapter(1, ["i.md"])],
      scenes: [{ chapterId: "chapter_1", file: "i.md", ast: scene }],
    });
    expect(errors).toEqual([]);
  });

  it("rejects a sub-location unlock that depends on a hotspot only revealed from inside that sub-location", () => {
    const scene = mkInvestigationScene({ id: "i" });
    scene.sublocations = [
      {
        id: "room_a",
        label: "Room A",
        status: "unlocked",
        unlock: null,
        reveals: [],
        sceneTag: "room a",
        transitionDialogue: [],
        hotspots: [
          {
            id: "hidden",
            label: "hidden",
            description: "hidden",
            status: "locked",
            unlock: null,
            reveals: [],
            inspectDialogue: [{ kind: "line", speaker: "A", text: "hidden" }],
            onReexamine: null,
            sourceFile: "i.md",
            line: 8,
          },
        ],
        characters: [],
        sourceFile: "i.md",
        line: 2,
      },
      {
        id: "room_b",
        label: "Room B",
        status: "locked",
        unlock: { predicate: "hotspot_investigated", id: "hidden" },
        reveals: [],
        sceneTag: "room b",
        transitionDialogue: [],
        hotspots: [
          {
            id: "revealer",
            label: "revealer",
            description: "revealer",
            status: "unlocked",
            unlock: null,
            reveals: [{ kind: "hotspot", id: "hidden" }],
            inspectDialogue: [{ kind: "line", speaker: "B", text: "reveals" }],
            onReexamine: null,
            sourceFile: "i.md",
            line: 18,
          },
        ],
        characters: [],
        sourceFile: "i.md",
        line: 14,
      },
    ];
    const errors = validate({
      chapters: [mkChapter(1, ["i.md"])],
      scenes: [{ chapterId: "chapter_1", file: "i.md", ast: scene }],
    });
    const reachErr = errors.find((e) => e.code === "lockedBlockUnreachable" && e.message.includes("room_b"));
    expect(reachErr).toBeDefined();
  });

  // ---- P2: duplicate scene-local id detection ----

  it("rejects duplicate hotspot ids across sub-locations within the same scene", () => {
    const scene = mkInvestigationScene({ id: "i" });
    scene.sublocations.push({
      id: "room_b",
      label: "Room B",
      status: "unlocked",
      unlock: null,
      reveals: [],
      sceneTag: "room b",
      transitionDialogue: [],
      hotspots: [
        {
          id: "thing", // duplicate of the hotspot in room
          label: "thing",
          description: "duplicate",
          status: "unlocked",
          unlock: null,
          reveals: [],
          inspectDialogue: [{ kind: "line", speaker: "A", text: "hi" }],
          onReexamine: null,
          sourceFile: "i.md",
          line: 20,
        },
      ],
      characters: [],
      sourceFile: "i.md",
      line: 18,
    });
    const errors = validate({
      chapters: [mkChapter(1, ["i.md"])],
      scenes: [{ chapterId: "chapter_1", file: "i.md", ast: scene }],
    });
    const dup = errors.find((e) => e.code === "duplicateSceneLocalId" && e.message.includes("thing"));
    expect(dup).toBeDefined();
  });

  it("rejects duplicate sub-location ids within the same scene", () => {
    const scene = mkInvestigationScene({ id: "i" });
    scene.sublocations.push({
      id: "room", // duplicate of the first sub-location
      label: "Room Again",
      status: "unlocked",
      unlock: null,
      reveals: [],
      sceneTag: "room again",
      transitionDialogue: [],
      hotspots: [],
      characters: [],
      sourceFile: "i.md",
      line: 20,
    });
    const errors = validate({
      chapters: [mkChapter(1, ["i.md"])],
      scenes: [{ chapterId: "chapter_1", file: "i.md", ast: scene }],
    });
    const dup = errors.find((e) => e.code === "duplicateSceneLocalId" && e.message.includes("sub-location") && e.message.includes("room"));
    expect(dup).toBeDefined();
  });

  it("rejects duplicate character ids within the same sub-location", () => {
    const scene = mkInvestigationScene({ id: "i" });
    scene.sublocations[0]!.characters = [
      {
        id: "npc",
        name: "NPC",
        role: "witness",
        bio: "bio",
        topics: [],
        sourceFile: "i.md",
        line: 10,
      },
      {
        id: "npc", // duplicate character id within same sub-location
        name: "NPC Dup",
        role: "suspect",
        bio: "bio",
        topics: [],
        sourceFile: "i.md",
        line: 11,
      },
    ];
    const errors = validate({
      chapters: [mkChapter(1, ["i.md"])],
      scenes: [{ chapterId: "chapter_1", file: "i.md", ast: scene }],
    });
    const dup = errors.find((e) => e.code === "duplicateSceneLocalId" && e.message.includes("character") && e.message.includes("npc"));
    expect(dup).toBeDefined();
  });

  it("allows the same character id in different sub-locations", () => {
    const scene = mkInvestigationScene({ id: "i" });
    scene.sublocations[0]!.characters = [
      {
        id: "npc",
        name: "NPC",
        role: "witness",
        bio: "bio",
        topics: [{ id: "alibi", label: "Alibi", status: "unlocked" as const, unlock: null, reveals: [], topicDialogue: [], onReexamine: null, sourceFile: "i.md", line: 10 }],
        sourceFile: "i.md",
        line: 10,
      },
    ];
    scene.sublocations.push({
      id: "room_b",
      label: "Room B",
      status: "unlocked",
      unlock: null,
      reveals: [],
      sceneTag: "room b",
      transitionDialogue: [],
      hotspots: [],
      characters: [
        {
          id: "npc", // same character id, different sub-location — allowed
          name: "NPC Again",
          role: "suspect",
          bio: "bio",
          topics: [{ id: "motive", label: "Motive", status: "unlocked" as const, unlock: null, reveals: [], topicDialogue: [], onReexamine: null, sourceFile: "i.md", line: 25 }],
          sourceFile: "i.md",
          line: 25,
        },
      ],
      sourceFile: "i.md",
      line: 20,
    });
    const errors = validate({
      chapters: [mkChapter(1, ["i.md"])],
      scenes: [{ chapterId: "chapter_1", file: "i.md", ast: scene }],
    });
    const dup = errors.find((e) => e.code === "duplicateSceneLocalId" && e.message.includes("character"));
    expect(dup).toBeUndefined();
  });

  // ---- P2: cycle detection across sub-location boundary via locked-block reveals ----

  it("rejects a cycle where a locked hotspot reveals evidence needed to unlock the sub-location containing its own unlock condition", () => {
    // Sub A (unlocked, entry): locked hotspot H1 reveals evidence:key, unlock: hotspot_investigated:H2
    // Sub B (locked, unlock: evidence_collected:key): unlocked hotspot H2
    // Cycle: to get evidence:key need H1, H1 needs H2 (in B), B needs evidence:key.
    const scene = mkInvestigationScene({ id: "i" });
    scene.evidenceManifest = [
      { id: "key", name: "key", description: "d", details: "x", onCollect: [], onReexamine: null, sourceFile: "i.md", line: 30 },
    ];
    scene.sublocations = [
      {
        id: "room_a",
        label: "Room A",
        status: "unlocked",
        unlock: null,
        reveals: [],
        sceneTag: "room a",
        transitionDialogue: [],
        hotspots: [
          {
            id: "h1",
            label: "h1",
            description: "locked hotspot in entry",
            status: "locked",
            unlock: { predicate: "hotspot_investigated", id: "h2" },
            reveals: [{ kind: "evidence", id: "key" }],
            inspectDialogue: [{ kind: "line", speaker: "A", text: "found key" }],
            onReexamine: null,
            sourceFile: "i.md",
            line: 4,
          },
        ],
        characters: [],
        sourceFile: "i.md",
        line: 2,
      },
      {
        id: "room_b",
        label: "Room B",
        status: "locked",
        unlock: { predicate: "evidence_collected", id: "key" },
        reveals: [],
        sceneTag: "room b",
        transitionDialogue: [],
        hotspots: [
          {
            id: "h2",
            label: "h2",
            description: "unlocked hotspot in gated sub-location",
            status: "unlocked",
            unlock: null,
            reveals: [],
            inspectDialogue: [{ kind: "line", speaker: "B", text: "hi" }],
            onReexamine: null,
            sourceFile: "i.md",
            line: 15,
          },
        ],
        characters: [],
        sourceFile: "i.md",
        line: 12,
      },
    ];
    const errors = validate({
      chapters: [mkChapter(1, ["i.md"])],
      scenes: [{ chapterId: "chapter_1", file: "i.md", ast: scene }],
    });
    // room_b should be unreachable because evidence:key is only revealed by
    // locked h1, which itself depends on h2 inside room_b.
    const reachErr = errors.find((e) => e.code === "lockedBlockUnreachable" && e.message.includes("room_b"));
    expect(reachErr).toBeDefined();
  });

  // ---- Outro predicate reachability ----

  it("rejects an Outro whose evidence_collected predicate references evidence never revealed by any reachable block", () => {
    const scene = mkInvestigationScene({ id: "i" });
    scene.evidenceManifest = [
      { id: "phantom", name: "Phantom", description: "d", details: "x", onCollect: [], onReexamine: null, sourceFile: "i.md", line: 20 },
    ];
    scene.sublocations[0]!.hotspots = [
      {
        id: "h1",
        label: "h1",
        description: "h1",
        status: "unlocked",
        unlock: null,
        reveals: [], // does NOT reveal evidence:phantom
        inspectDialogue: [{ kind: "line", speaker: "A", text: "hi" }],
        onReexamine: null,
        sourceFile: "i.md",
        line: 4,
      },
    ];
    scene.outro = {
      unlock: { predicate: "evidence_collected", id: "phantom" },
      dialogue: [],
    };
    const errors = validate({
      chapters: [mkChapter(1, ["i.md"])],
      scenes: [{ chapterId: "chapter_1", file: "i.md", ast: scene }],
    });
    const outroErr = errors.find((e) => e.code === "outroPredicateUnreachable" && e.message.includes("phantom"));
    expect(outroErr).toBeDefined();
  });

  it("rejects an Outro whose statement_acquired predicate references a statement never revealed by any reachable block", () => {
    const scene = mkInvestigationScene({ id: "i" });
    scene.statementManifest = [
      { id: "ghost_stmt", speaker: "X", content: "s", onAcquire: [], onReexamine: null, sourceFile: "i.md", line: 30 },
    ];
    scene.outro = {
      unlock: { predicate: "statement_acquired", id: "ghost_stmt" },
      dialogue: [],
    };
    const errors = validate({
      chapters: [mkChapter(1, ["i.md"])],
      scenes: [{ chapterId: "chapter_1", file: "i.md", ast: scene }],
    });
    const outroErr = errors.find((e) => e.code === "outroPredicateUnreachable" && e.message.includes("ghost_stmt"));
    expect(outroErr).toBeDefined();
  });

  it("accepts an Outro whose evidence_collected predicate references evidence revealed by a reachable block", () => {
    const scene = mkInvestigationScene({ id: "i" });
    scene.evidenceManifest = [
      { id: "real_ev", name: "Real", description: "d", details: "x", onCollect: [], onReexamine: null, sourceFile: "i.md", line: 20 },
    ];
    scene.sublocations[0]!.hotspots = [
      {
        id: "h1",
        label: "h1",
        description: "h1",
        status: "unlocked",
        unlock: null,
        reveals: [{ kind: "evidence", id: "real_ev" }],
        inspectDialogue: [{ kind: "line", speaker: "A", text: "hi" }],
        onReexamine: null,
        sourceFile: "i.md",
        line: 4,
      },
    ];
    scene.outro = {
      unlock: { predicate: "evidence_collected", id: "real_ev" },
      dialogue: [],
    };
    const errors = validate({
      chapters: [mkChapter(1, ["i.md"])],
      scenes: [{ chapterId: "chapter_1", file: "i.md", ast: scene }],
    });
    expect(errors).toEqual([]);
  });

  it("accepts an Outro OR expression when one reachable branch can satisfy it", () => {
    const scene = mkInvestigationScene({ id: "i" });
    scene.evidenceManifest = [
      { id: "real_ev", name: "Real", description: "d", details: "x", onCollect: [], onReexamine: null, sourceFile: "i.md", line: 20 },
      { id: "red_herring", name: "Red Herring", description: "d", details: "x", onCollect: [], onReexamine: null, sourceFile: "i.md", line: 21 },
    ];
    scene.sublocations[0]!.hotspots = [
      {
        id: "h1",
        label: "h1",
        description: "h1",
        status: "unlocked",
        unlock: null,
        reveals: [{ kind: "evidence", id: "real_ev" }],
        inspectDialogue: [{ kind: "line", speaker: "A", text: "hi" }],
        onReexamine: null,
        sourceFile: "i.md",
        line: 4,
      },
    ];
    scene.outro = {
      unlock: {
        op: "or",
        left: { predicate: "evidence_collected", id: "real_ev" },
        right: { predicate: "evidence_collected", id: "red_herring" },
      },
      dialogue: [],
    };
    const errors = validate({
      chapters: [mkChapter(1, ["i.md"])],
      scenes: [{ chapterId: "chapter_1", file: "i.md", ast: scene }],
    });
    expect(errors.find((e) => e.code === "outroPredicateUnreachable")).toBeUndefined();
  });

  it("rejects an Outro AND expression when one branch is unreachable", () => {
    const scene = mkInvestigationScene({ id: "i" });
    scene.evidenceManifest = [
      { id: "real_ev", name: "Real", description: "d", details: "x", onCollect: [], onReexamine: null, sourceFile: "i.md", line: 20 },
      { id: "red_herring", name: "Red Herring", description: "d", details: "x", onCollect: [], onReexamine: null, sourceFile: "i.md", line: 21 },
    ];
    scene.sublocations[0]!.hotspots = [
      {
        id: "h1",
        label: "h1",
        description: "h1",
        status: "unlocked",
        unlock: null,
        reveals: [{ kind: "evidence", id: "real_ev" }],
        inspectDialogue: [{ kind: "line", speaker: "A", text: "hi" }],
        onReexamine: null,
        sourceFile: "i.md",
        line: 4,
      },
    ];
    scene.outro = {
      unlock: {
        op: "and",
        left: { predicate: "evidence_collected", id: "real_ev" },
        right: { predicate: "evidence_collected", id: "red_herring" },
      },
      dialogue: [],
    };
    const errors = validate({
      chapters: [mkChapter(1, ["i.md"])],
      scenes: [{ chapterId: "chapter_1", file: "i.md", ast: scene }],
    });
    const outroErr = errors.find((e) => e.code === "outroPredicateUnreachable" && e.message.includes("red_herring"));
    expect(outroErr).toBeDefined();
  });

  it("rejects an Outro whose topic_discussed predicate references a topic in an unreachable sub-location", () => {
    const scene = mkInvestigationScene({ id: "i" });
    scene.sublocations = [
      {
        id: "room_a",
        label: "Room A",
        status: "unlocked",
        unlock: null,
        reveals: [],
        sceneTag: "a",
        transitionDialogue: [],
        hotspots: [],
        characters: [],
        sourceFile: "i.md",
        line: 2,
      },
      {
        id: "room_b",
        label: "Room B",
        status: "locked",
        unlock: { predicate: "hotspot_investigated", id: "nonexistent" }, // can never be satisfied
        reveals: [],
        sceneTag: "b",
        transitionDialogue: [],
        hotspots: [],
        characters: [
          {
            id: "npc",
            name: "NPC",
            role: "witness",
            bio: "bio",
            topics: [
              {
                id: "secret",
                label: "Secret",
                status: "unlocked",
                unlock: null,
                reveals: [],
                topicDialogue: [{ kind: "line", speaker: "NPC", text: "hi" }],
                onReexamine: null,
                sourceFile: "i.md",
                line: 15,
              },
            ],
            sourceFile: "i.md",
            line: 12,
          },
        ],
        sourceFile: "i.md",
        line: 10,
      },
    ];
    scene.outro = {
      unlock: { predicate: "topic_discussed", characterId: "npc", topicId: "secret" },
      dialogue: [],
    };
    const errors = validate({
      chapters: [mkChapter(1, ["i.md"])],
      scenes: [{ chapterId: "chapter_1", file: "i.md", ast: scene }],
    });
    const outroErr = errors.find((e) => e.code === "outroPredicateUnreachable" && e.message.includes("npc@secret"));
    expect(outroErr).toBeDefined();
  });

  it("accepts an interrogation scene whose testimony uses same-scene evidence revealed by an earlier inquiry", () => {
    const scene = mkInterrogationScene({
      phases: [
        mkInquiryPhase({
          id: "inquiry",
          questions: [mkQuestion({ id: "q", reveals: [{ kind: "evidence", id: "log" }] })],
        }),
        mkTestimonyPhase({
          id: "testimony",
          statements: [mkTestimonyStatement({ id: "s", contradiction: { kind: "evidence", id: "log" }, onCorrect: "win" })],
          results: [mkResult({ id: "win" })],
        }),
      ],
      evidenceManifest: [mkEvidence("log")],
    });
    const errors = validate({
      chapters: [mkChapter(1, ["interrogation_scene_1.md"])],
      scenes: [{ chapterId: "chapter_1", file: "interrogation_scene_1.md", ast: scene }],
    });
    expect(errors).toEqual([]);
  });

  it("rejects unresolved testimony result references", () => {
    const scene = mkInterrogationScene({
      phases: [mkTestimonyPhase({
        statements: [mkTestimonyStatement({ id: "s", contradiction: { kind: "evidence", id: "log" }, onCorrect: "missing" })],
        results: [],
      })],
      evidenceManifest: [mkEvidence("log")],
    });
    const errors = validate({
      chapters: [mkChapter(1, ["interrogation_scene_1.md"])],
      scenes: [{ chapterId: "chapter_1", file: "interrogation_scene_1.md", ast: scene }],
    });
    expect(errors.find((e) => e.code === "interrogationResultUnresolved")).toBeDefined();
  });

  it("rejects cross-scene evidence that is not guaranteed by an earlier scene", () => {
    const sourceInvestigation = mkInvestigationScene({ id: "investigation_scene_1" });
    sourceInvestigation.evidenceManifest = [mkEvidence("optional_log")];
    const interrogation = mkInterrogationScene({
      phases: [mkTestimonyPhase({
        statements: [mkTestimonyStatement({
          id: "s",
          contradiction: { kind: "evidence", id: "optional_log" },
          onCorrect: "win",
        })],
        results: [mkResult({ id: "win" })],
      })],
    });
    const errors = validate({
      chapters: [mkChapter(1, ["investigation_scene_1.md", "interrogation_scene_2.md"])],
      scenes: [
        { chapterId: "chapter_1", file: "investigation_scene_1.md", ast: sourceInvestigation },
        { chapterId: "chapter_1", file: "interrogation_scene_2.md", ast: interrogation },
      ],
    });
    expect(errors.find((e) => e.code === "crossSceneInventoryNotGuaranteed")).toBeDefined();
  });

  it("rejects same-scene testimony contradictions when the manifest item is never obtainable before testimony", () => {
    const scene = mkInterrogationScene({
      phases: [
        mkTestimonyPhase({
          id: "testimony",
          statements: [mkTestimonyStatement({
            id: "s",
            contradiction: { kind: "evidence", id: "unrevealed_log" },
            onCorrect: "win",
          })],
          results: [mkResult({ id: "win" })],
        }),
      ],
      evidenceManifest: [mkEvidence("unrevealed_log")],
    });
    const errors = validate({
      chapters: [mkChapter(1, ["interrogation_scene_1.md"])],
      scenes: [{ chapterId: "chapter_1", file: "interrogation_scene_1.md", ast: scene }],
    });
    expect(errors.find((e) => e.code === "interrogationContradictionUnresolved")).toBeDefined();
  });

  it("accepts press-then-present: evidence revealed by pressing one statement used as contradiction against another", () => {
    const scene = mkInterrogationScene({
      phases: [
        mkTestimonyPhase({
          id: "testimony",
          statements: [
            mkTestimonyStatement({
              id: "s1",
              reveals: [{ kind: "evidence", id: "press_evidence" }],
            }),
            mkTestimonyStatement({
              id: "s2",
              contradiction: { kind: "evidence", id: "press_evidence" },
              onCorrect: "win",
            }),
          ],
          results: [mkResult({ id: "win" })],
        }),
      ],
      evidenceManifest: [mkEvidence("press_evidence")],
    });
    const errors = validate({
      chapters: [mkChapter(1, ["interrogation_scene_1.md"])],
      scenes: [{ chapterId: "chapter_1", file: "interrogation_scene_1.md", ast: scene }],
    });
    expect(errors).toEqual([]);
  });

  it("rejects required testimony phases with no valid contradiction path", () => {
    const scene = mkInterrogationScene({
      phases: [
        mkTestimonyPhase({
          id: "testimony",
          required: true,
          statements: [
            mkTestimonyStatement({ id: "s1", contradiction: null, onCorrect: null }),
            mkTestimonyStatement({ id: "s2", contradiction: null, onCorrect: "win" }),
          ],
          results: [mkResult({ id: "win" })],
        }),
      ],
    });
    const errors = validate({
      chapters: [mkChapter(1, ["interrogation_scene_1.md"])],
      scenes: [{ chapterId: "chapter_1", file: "interrogation_scene_1.md", ast: scene }],
    });
    expect(errors.find((e) => e.code === "interrogationNoValidContradictionPath")).toBeDefined();
  });

  it("rejects required inquiry phases whose explicit completion inventory is locally declared but unobtainable", () => {
    const scene = mkInterrogationScene({
      phases: [
        mkInquiryPhase({
          id: "inquiry",
          required: true,
          complete: { predicate: "evidence_collected", id: "missing" },
          questions: [mkQuestion({ id: "q" })],
        }),
      ],
      evidenceManifest: [mkEvidence("missing")],
    });
    const errors = validate({
      chapters: [mkChapter(1, ["interrogation_scene_1.md"])],
      scenes: [{ chapterId: "chapter_1", file: "interrogation_scene_1.md", ast: scene }],
    });
    expect(errors.find((e) => e.code === "interrogationNoValidCompletionPath")).toBeDefined();
  });

  it("does not treat an incompletable optional phase as completed for later unlocks", () => {
    const scene = mkInterrogationScene({
      phases: [
        mkInquiryPhase({
          id: "optional_dead_end",
          required: false,
          complete: { predicate: "evidence_collected", id: "missing" },
          questions: [mkQuestion({ id: "optional_q" })],
        }),
        mkInquiryPhase({
          id: "requires_dead_end",
          required: true,
          status: "locked",
          unlock: { predicate: "phase_completed", id: "optional_dead_end" },
          questions: [mkQuestion({ id: "blocked_q" })],
        }),
      ],
      evidenceManifest: [mkEvidence("missing")],
    });
    const errors = validate({
      chapters: [mkChapter(1, ["interrogation_scene_1.md"])],
      scenes: [{ chapterId: "chapter_1", file: "interrogation_scene_1.md", ast: scene }],
    });
    expect(errors.find((e) => e.code === "interrogationNoValidCompletionPath" && e.message.includes("requires_dead_end"))).toBeDefined();
  });

  it("accepts same-scene testimony contradictions using inventory revealed on phase entry", () => {
    const scene = mkInterrogationScene({
      phases: [
        mkInquiryPhase({
          id: "entry_reveal",
          reveals: [{ kind: "evidence", id: "entry_log" }],
          questions: [mkQuestion({ id: "q" })],
        }),
        mkTestimonyPhase({
          id: "testimony",
          statements: [mkTestimonyStatement({
            id: "s",
            contradiction: { kind: "evidence", id: "entry_log" },
            onCorrect: "win",
          })],
          results: [mkResult({ id: "win" })],
        }),
      ],
      evidenceManifest: [mkEvidence("entry_log")],
    });
    const errors = validate({
      chapters: [mkChapter(1, ["interrogation_scene_1.md"])],
      scenes: [{ chapterId: "chapter_1", file: "interrogation_scene_1.md", ast: scene }],
    });
    expect(errors).toEqual([]);
  });

  it("does not guarantee a required inquiry question reveal when the question is locked by unobtainable inventory", () => {
    const source = mkInterrogationScene({
      phases: [
        mkInquiryPhase({
          id: "source_inquiry",
          questions: [
            mkQuestion({
              id: "locked_question",
              status: "locked",
              unlock: { predicate: "evidence_collected", id: "missing_key" },
              required: true,
              reveals: [{ kind: "evidence", id: "later_log" }],
            }),
          ],
        }),
      ],
      evidenceManifest: [mkEvidence("missing_key"), mkEvidence("later_log")],
    });
    const later = mkInterrogationScene({
      phases: [mkTestimonyPhase({
        statements: [mkTestimonyStatement({
          id: "s",
          contradiction: { kind: "evidence", id: "later_log" },
          onCorrect: "win",
        })],
        results: [mkResult({ id: "win" })],
      })],
    });
    const errors = validate({
      chapters: [mkChapter(1, ["interrogation_scene_1.md", "interrogation_scene_2.md"])],
      scenes: [
        { chapterId: "chapter_1", file: "interrogation_scene_1.md", ast: source },
        { chapterId: "chapter_1", file: "interrogation_scene_2.md", ast: later },
      ],
    });
    expect(errors.find((e) => e.code === "crossSceneInventoryNotGuaranteed" && e.message.includes("later_log"))).toBeDefined();
  });

  it("does not guarantee a required inquiry question reveal when explicit phase completion can skip it", () => {
    const source = mkInterrogationScene({
      phases: [
        mkInquiryPhase({
          id: "source_inquiry",
          complete: { predicate: "question_answered", id: "gate" },
          questions: [
            mkQuestion({ id: "gate", required: true }),
            mkQuestion({
              id: "skippable_required",
              required: true,
              reveals: [{ kind: "evidence", id: "skippable_log" }],
            }),
          ],
        }),
      ],
      evidenceManifest: [mkEvidence("skippable_log")],
    });
    const later = mkInterrogationScene({
      phases: [mkTestimonyPhase({
        statements: [mkTestimonyStatement({
          id: "later_s",
          contradiction: { kind: "evidence", id: "skippable_log" },
          onCorrect: "later_win",
        })],
        results: [mkResult({ id: "later_win" })],
      })],
    });
    const errors = validate({
      chapters: [mkChapter(1, ["interrogation_scene_1.md", "interrogation_scene_2.md"])],
      scenes: [
        { chapterId: "chapter_1", file: "interrogation_scene_1.md", ast: source },
        { chapterId: "chapter_1", file: "interrogation_scene_2.md", ast: later },
      ],
    });
    expect(errors.find((e) => e.code === "crossSceneInventoryNotGuaranteed" && e.message.includes("skippable_log"))).toBeDefined();
  });

  it("guarantees inquiry question reveal when phase complete depends on that inventory item", () => {
    // When an inquiry phase's complete expression references evidence_collected
    // or statement_acquired, and the only way to obtain that item is by answering
    // a question in the same phase, that question is mandatory for phase
    // completion and its reveals should be guaranteed.
    const source = mkInterrogationScene({
      phases: [
        mkInquiryPhase({
          id: "source_inquiry",
          complete: { predicate: "evidence_collected", id: "gated_evidence" },
          questions: [
            mkQuestion({
              id: "revealer",
              required: false,
              reveals: [{ kind: "evidence", id: "gated_evidence" }],
            }),
          ],
        }),
      ],
      evidenceManifest: [mkEvidence("gated_evidence")],
    });
    const later = mkInterrogationScene({
      phases: [mkTestimonyPhase({
        statements: [mkTestimonyStatement({
          id: "later_s",
          contradiction: { kind: "evidence", id: "gated_evidence" },
          onCorrect: "later_win",
        })],
        results: [mkResult({ id: "later_win" })],
      })],
    });
    const errors = validate({
      chapters: [mkChapter(1, ["interrogation_scene_1.md", "interrogation_scene_2.md"])],
      scenes: [
        { chapterId: "chapter_1", file: "interrogation_scene_1.md", ast: source },
        { chapterId: "chapter_1", file: "interrogation_scene_2.md", ast: later },
      ],
    });
    // The question "revealer" is mandatory because its reveal (gated_evidence)
    // is required by the phase complete expression. So gated_evidence IS guaranteed.
    expect(errors.find((e) => e.code === "crossSceneInventoryNotGuaranteed" && e.message.includes("gated_evidence"))).toBeUndefined();
  });

  it("does not guarantee testimony result reveals from statements with no contradiction", () => {
    const source = mkInterrogationScene({
      phases: [
        mkTestimonyPhase({
          id: "source_testimony",
          statements: [mkTestimonyStatement({ id: "s", contradiction: null, onCorrect: "win" })],
          results: [mkResult({ id: "win", reveals: [{ kind: "statement", id: "future_statement" }] })],
        }),
      ],
      statementManifest: [mkStatement("future_statement")],
    });
    const later = mkInterrogationScene({
      phases: [mkTestimonyPhase({
        statements: [mkTestimonyStatement({
          id: "later_s",
          contradiction: { kind: "statement", id: "future_statement" },
          onCorrect: "later_win",
        })],
        results: [mkResult({ id: "later_win" })],
      })],
    });
    const errors = validate({
      chapters: [mkChapter(1, ["interrogation_scene_1.md", "interrogation_scene_2.md"])],
      scenes: [
        { chapterId: "chapter_1", file: "interrogation_scene_1.md", ast: source },
        { chapterId: "chapter_1", file: "interrogation_scene_2.md", ast: later },
      ],
    });
    expect(errors.find((e) => e.code === "crossSceneInventoryNotGuaranteed" && e.message.includes("future_statement"))).toBeDefined();
  });

  it("does not guarantee testimony result reveals that occur on only one alternate correct path", () => {
    const source = mkInterrogationScene({
      phases: [
        mkInquiryPhase({
          id: "source_inquiry",
          questions: [
            mkQuestion({
              id: "q",
              reveals: [
                { kind: "evidence", id: "log_a" },
                { kind: "evidence", id: "log_b" },
              ],
            }),
          ],
        }),
        mkTestimonyPhase({
          id: "source_testimony",
          statements: [
            mkTestimonyStatement({
              id: "a",
              contradiction: { kind: "evidence", id: "log_a" },
              onCorrect: "path_a",
            }),
            mkTestimonyStatement({
              id: "b",
              contradiction: { kind: "evidence", id: "log_b" },
              onCorrect: "path_b",
            }),
          ],
          results: [
            mkResult({ id: "path_a", reveals: [{ kind: "evidence", id: "only_path_a" }] }),
            mkResult({ id: "path_b", reveals: [{ kind: "evidence", id: "only_path_b" }] }),
          ],
        }),
      ],
      evidenceManifest: [
        mkEvidence("log_a"),
        mkEvidence("log_b"),
        mkEvidence("only_path_a"),
        mkEvidence("only_path_b"),
      ],
    });
    const later = mkInterrogationScene({
      phases: [mkTestimonyPhase({
        statements: [mkTestimonyStatement({
          id: "later_s",
          contradiction: { kind: "evidence", id: "only_path_a" },
          onCorrect: "later_win",
        })],
        results: [mkResult({ id: "later_win" })],
      })],
    });
    const errors = validate({
      chapters: [mkChapter(1, ["interrogation_scene_1.md", "interrogation_scene_2.md"])],
      scenes: [
        { chapterId: "chapter_1", file: "interrogation_scene_1.md", ast: source },
        { chapterId: "chapter_1", file: "interrogation_scene_2.md", ast: later },
      ],
    });
    expect(errors.find((e) => e.code === "crossSceneInventoryNotGuaranteed" && e.message.includes("only_path_a"))).toBeDefined();
  });

  it("does not guarantee inquiry question bonus reveals from one alternate completion source", () => {
    const source = mkInterrogationScene({
      phases: [
        mkInquiryPhase({
          id: "source_inquiry",
          complete: { predicate: "evidence_collected", id: "shared_gate" },
          questions: [
            mkQuestion({
              id: "path_a",
              reveals: [
                { kind: "evidence", id: "shared_gate" },
                { kind: "evidence", id: "only_path_a" },
              ],
            }),
            mkQuestion({
              id: "path_b",
              reveals: [
                { kind: "evidence", id: "shared_gate" },
                { kind: "evidence", id: "only_path_b" },
              ],
            }),
          ],
        }),
      ],
      evidenceManifest: [
        mkEvidence("shared_gate"),
        mkEvidence("only_path_a"),
        mkEvidence("only_path_b"),
      ],
    });
    const later = mkInterrogationScene({
      phases: [mkTestimonyPhase({
        statements: [mkTestimonyStatement({
          id: "later_s",
          contradiction: { kind: "evidence", id: "only_path_a" },
          onCorrect: "later_win",
        })],
        results: [mkResult({ id: "later_win" })],
      })],
    });
    const errors = validate({
      chapters: [mkChapter(1, ["interrogation_scene_1.md", "interrogation_scene_2.md"])],
      scenes: [
        { chapterId: "chapter_1", file: "interrogation_scene_1.md", ast: source },
        { chapterId: "chapter_1", file: "interrogation_scene_2.md", ast: later },
      ],
    });
    expect(errors.find((e) => e.code === "crossSceneInventoryNotGuaranteed" && e.message.includes("only_path_a"))).toBeDefined();
  });

  // ---- Interrogation outro reachability ----

  it("rejects an interrogation outro whose evidence_collected predicate references evidence never obtainable in the scene", () => {
    const scene = mkInterrogationScene({
      phases: [
        mkInquiryPhase({
          id: "inquiry",
          questions: [mkQuestion({ id: "q" })],
        }),
      ],
      evidenceManifest: [mkEvidence("phantom")],
      outro: {
        unlock: { predicate: "evidence_collected", id: "phantom" },
        dialogue: [],
      },
    });
    const errors = validate({
      chapters: [mkChapter(1, ["interrogation_scene_1.md"])],
      scenes: [{ chapterId: "chapter_1", file: "interrogation_scene_1.md", ast: scene }],
    });
    const outroErr = errors.find((e) => e.code === "interrogationOutroPredicateUnreachable" && e.message.includes("phantom"));
    expect(outroErr).toBeDefined();
  });

  it("accepts an interrogation outro whose evidence_collected predicate references evidence obtainable from a question reveal", () => {
    const scene = mkInterrogationScene({
      phases: [
        mkInquiryPhase({
          id: "inquiry",
          questions: [mkQuestion({ id: "q", reveals: [{ kind: "evidence", id: "key" }] })],
        }),
      ],
      evidenceManifest: [mkEvidence("key")],
      outro: {
        unlock: { predicate: "evidence_collected", id: "key" },
        dialogue: [],
      },
    });
    const errors = validate({
      chapters: [mkChapter(1, ["interrogation_scene_1.md"])],
      scenes: [{ chapterId: "chapter_1", file: "interrogation_scene_1.md", ast: scene }],
    });
    expect(errors.find((e) => e.code === "interrogationOutroPredicateUnreachable")).toBeUndefined();
  });

  it("rejects an interrogation outro whose statement_acquired predicate references a statement never obtainable in the scene", () => {
    const scene = mkInterrogationScene({
      phases: [
        mkInquiryPhase({
          id: "inquiry",
          questions: [mkQuestion({ id: "q" })],
        }),
      ],
      statementManifest: [mkStatement("ghost_stmt")],
      outro: {
        unlock: { predicate: "statement_acquired", id: "ghost_stmt" },
        dialogue: [],
      },
    });
    const errors = validate({
      chapters: [mkChapter(1, ["interrogation_scene_1.md"])],
      scenes: [{ chapterId: "chapter_1", file: "interrogation_scene_1.md", ast: scene }],
    });
    const outroErr = errors.find((e) => e.code === "interrogationOutroPredicateUnreachable" && e.message.includes("ghost_stmt"));
    expect(outroErr).toBeDefined();
  });

  it("rejects an interrogation outro whose phase_completed predicate references a phase with no valid completion path", () => {
    const scene = mkInterrogationScene({
      phases: [
        mkInquiryPhase({
          id: "dead_end",
          required: true,
          complete: { predicate: "evidence_collected", id: "missing" },
          questions: [mkQuestion({ id: "q" })],
        }),
      ],
      evidenceManifest: [mkEvidence("missing")],
      outro: {
        unlock: { predicate: "phase_completed", id: "dead_end" },
        dialogue: [],
      },
    });
    const errors = validate({
      chapters: [mkChapter(1, ["interrogation_scene_1.md"])],
      scenes: [{ chapterId: "chapter_1", file: "interrogation_scene_1.md", ast: scene }],
    });
    const outroErr = errors.find((e) => e.code === "interrogationOutroPredicateUnreachable" && e.message.includes("dead_end"));
    expect(outroErr).toBeDefined();
  });

  it("accepts an interrogation outro with a phase_completed predicate referencing a completable phase", () => {
    const scene = mkInterrogationScene({
      phases: [
        mkInquiryPhase({
          id: "inquiry",
          questions: [mkQuestion({ id: "q" })],
        }),
      ],
      outro: {
        unlock: { predicate: "phase_completed", id: "inquiry" },
        dialogue: [],
      },
    });
    const errors = validate({
      chapters: [mkChapter(1, ["interrogation_scene_1.md"])],
      scenes: [{ chapterId: "chapter_1", file: "interrogation_scene_1.md", ast: scene }],
    });
    expect(errors.find((e) => e.code === "interrogationOutroPredicateUnreachable")).toBeUndefined();
  });

  it("rejects an interrogation outro whose phase_completed predicate references an incompletable optional phase", () => {
    // The optional phase is reachable but requires unobtainable evidence to
    // complete.  The outro requires it completed, so the scene is unwinnable.
    const scene = mkInterrogationScene({
      phases: [
        mkInquiryPhase({
          id: "optional_dead",
          required: false,
          complete: { predicate: "evidence_collected", id: "missing" },
          questions: [mkQuestion({ id: "q" })],
        }),
      ],
      evidenceManifest: [mkEvidence("missing")],
      outro: {
        unlock: { predicate: "phase_completed", id: "optional_dead" },
        dialogue: [],
      },
    });
    const errors = validate({
      chapters: [mkChapter(1, ["interrogation_scene_1.md"])],
      scenes: [{ chapterId: "chapter_1", file: "interrogation_scene_1.md", ast: scene }],
    });
    const outroErr = errors.find((e) => e.code === "interrogationOutroPredicateUnreachable" && e.message.includes("optional_dead"));
    expect(outroErr).toBeDefined();
  });

  it("accepts an interrogation outro whose phase_completed predicate references a completable optional phase", () => {
    const scene = mkInterrogationScene({
      phases: [
        mkInquiryPhase({
          id: "optional_ok",
          required: false,
          questions: [mkQuestion({ id: "q" })],
        }),
      ],
      outro: {
        unlock: { predicate: "phase_completed", id: "optional_ok" },
        dialogue: [],
      },
    });
    const errors = validate({
      chapters: [mkChapter(1, ["interrogation_scene_1.md"])],
      scenes: [{ chapterId: "chapter_1", file: "interrogation_scene_1.md", ast: scene }],
    });
    expect(errors.find((e) => e.code === "interrogationOutroPredicateUnreachable")).toBeUndefined();
  });

  it("accepts outro requiring evidence from a forced optional inquiry phase", () => {
    // An optional inquiry phase reveals evidence that the outro requires.
    // Every successful playthrough must complete this phase, so it is forced
    // and the outro predicate should be reachable.
    const scene = mkInterrogationScene({
      phases: [
        mkInquiryPhase({
          id: "forced_inquiry",
          required: false,
          questions: [mkQuestion({ id: "q", reveals: [{ kind: "evidence", id: "clue" }] })],
        }),
      ],
      evidenceManifest: [mkEvidence("clue")],
      outro: {
        unlock: { predicate: "evidence_collected", id: "clue" },
        dialogue: [],
      },
    });
    const errors = validate({
      chapters: [mkChapter(1, ["interrogation_scene_1.md"])],
      scenes: [{ chapterId: "chapter_1", file: "interrogation_scene_1.md", ast: scene }],
    });
    expect(errors.find((e) => e.code === "interrogationOutroPredicateUnreachable")).toBeUndefined();
  });

  it("accepts outro requiring statement from a forced optional testimony phase", () => {
    // An optional testimony phase produces a statement via its correct-result
    // reveals. The outro requires that statement, forcing the phase.
    // A required inquiry phase provides the evidence needed for the contradiction.
    const scene = mkInterrogationScene({
      phases: [
        mkInquiryPhase({
          id: "required_inquiry",
          required: true,
          questions: [mkQuestion({ id: "rq", reveals: [{ kind: "evidence", id: "initial_ev" }] })],
        }),
        mkTestimonyPhase({
          id: "forced_testimony",
          required: false,
          statements: [
            mkTestimonyStatement({
              id: "s1",
              contradiction: { kind: "evidence", id: "initial_ev" },
              onCorrect: "correct",
            }),
          ],
          results: [mkResult({ id: "correct", reveals: [{ kind: "statement", id: "forced_stmt" }] })],
        }),
      ],
      evidenceManifest: [mkEvidence("initial_ev")],
      statementManifest: [mkStatement("forced_stmt")],
      outro: {
        unlock: { predicate: "statement_acquired", id: "forced_stmt" },
        dialogue: [],
      },
    });
    const errors = validate({
      chapters: [mkChapter(1, ["interrogation_scene_1.md"])],
      scenes: [{ chapterId: "chapter_1", file: "interrogation_scene_1.md", ast: scene }],
    });
    expect(errors.find((e) => e.code === "interrogationOutroPredicateUnreachable")).toBeUndefined();
  });

  it("guarantees forced optional phase reveals for cross-scene inventory", () => {
    // An optional inquiry phase reveals evidence that the outro requires.
    // The outro forces this phase, so its evidence should be guaranteed for
    // cross-scene inventory checks.
    const source = mkInterrogationScene({
      phases: [
        mkInquiryPhase({
          id: "forced_inquiry",
          required: false,
          questions: [mkQuestion({ id: "q", reveals: [{ kind: "evidence", id: "forced_ev" }] })],
        }),
      ],
      evidenceManifest: [mkEvidence("forced_ev")],
      outro: {
        unlock: { predicate: "evidence_collected", id: "forced_ev" },
        dialogue: [],
      },
    });
    const later = mkInterrogationScene({
      phases: [mkTestimonyPhase({
        statements: [mkTestimonyStatement({
          id: "later_s",
          contradiction: { kind: "evidence", id: "forced_ev" },
          onCorrect: "later_win",
        })],
        results: [mkResult({ id: "later_win" })],
      })],
    });
    const errors = validate({
      chapters: [mkChapter(1, ["interrogation_scene_1.md", "interrogation_scene_2.md"])],
      scenes: [
        { chapterId: "chapter_1", file: "interrogation_scene_1.md", ast: source },
        { chapterId: "chapter_1", file: "interrogation_scene_2.md", ast: later },
      ],
    });
    expect(errors.find((e) => e.code === "crossSceneInventoryNotGuaranteed" && e.message.includes("forced_ev"))).toBeUndefined();
  });

  it("does not force optional phases whose output the outro does not require", () => {
    // An optional phase reveals evidence, but the outro does NOT require it.
    // The phase remains truly optional and its evidence is NOT guaranteed.
    const source = mkInterrogationScene({
      phases: [
        mkInquiryPhase({
          id: "truly_optional",
          required: false,
          questions: [mkQuestion({ id: "q", reveals: [{ kind: "evidence", id: "optional_ev" }] })],
        }),
      ],
      evidenceManifest: [mkEvidence("optional_ev")],
    });
    const later = mkInterrogationScene({
      phases: [mkTestimonyPhase({
        statements: [mkTestimonyStatement({
          id: "later_s",
          contradiction: { kind: "evidence", id: "optional_ev" },
          onCorrect: "later_win",
        })],
        results: [mkResult({ id: "later_win" })],
      })],
    });
    const errors = validate({
      chapters: [mkChapter(1, ["interrogation_scene_1.md", "interrogation_scene_2.md"])],
      scenes: [
        { chapterId: "chapter_1", file: "interrogation_scene_1.md", ast: source },
        { chapterId: "chapter_1", file: "interrogation_scene_2.md", ast: later },
      ],
    });
    expect(errors.find((e) => e.code === "crossSceneInventoryNotGuaranteed" && e.message.includes("optional_ev"))).toBeDefined();
  });

  it("accepts outro AND expression when forced optional phases collectively satisfy all branches", () => {
    // Two optional phases: one reveals evidence_a, the other evidence_b.
    // The outro requires BOTH (AND). Both phases are forced.
    const scene = mkInterrogationScene({
      phases: [
        mkInquiryPhase({
          id: "opt_a",
          required: false,
          questions: [mkQuestion({ id: "qa", reveals: [{ kind: "evidence", id: "ev_a" }] })],
        }),
        mkInquiryPhase({
          id: "opt_b",
          required: false,
          questions: [mkQuestion({ id: "qb", reveals: [{ kind: "evidence", id: "ev_b" }] })],
        }),
      ],
      evidenceManifest: [mkEvidence("ev_a"), mkEvidence("ev_b")],
      outro: {
        unlock: {
          op: "and",
          left: { predicate: "evidence_collected", id: "ev_a" },
          right: { predicate: "evidence_collected", id: "ev_b" },
        },
        dialogue: [],
      },
    });
    const errors = validate({
      chapters: [mkChapter(1, ["interrogation_scene_1.md"])],
      scenes: [{ chapterId: "chapter_1", file: "interrogation_scene_1.md", ast: scene }],
    });
    expect(errors.find((e) => e.code === "interrogationOutroPredicateUnreachable")).toBeUndefined();
  });

  it("rejects an interrogation outro whose question_answered predicate references a question that is never answerable", () => {
    // "dead_q" is locked and requires evidence "unobtainable" which is never
    // revealed in this scene, so the question can never be answered even
    // though the phase itself is completable via the other required question.
    const scene = mkInterrogationScene({
      phases: [
        mkInquiryPhase({
          id: "inquiry",
          required: true,
          questions: [
            mkQuestion({ id: "reachable_q", reveals: [{ kind: "evidence", id: "phase_ev" }] }),
            mkQuestion({
              id: "dead_q",
              status: "locked",
              required: false,
              unlock: { predicate: "evidence_collected", id: "unobtainable" },
            }),
          ],
        }),
      ],
      evidenceManifest: [mkEvidence("phase_ev"), mkEvidence("unobtainable")],
      outro: {
        unlock: { predicate: "question_answered", id: "dead_q" },
        dialogue: [],
      },
    });
    const errors = validate({
      chapters: [mkChapter(1, ["interrogation_scene_1.md"])],
      scenes: [{ chapterId: "chapter_1", file: "interrogation_scene_1.md", ast: scene }],
    });
    const outroErr = errors.find((e) => e.code === "interrogationOutroPredicateUnreachable" && e.message.includes("dead_q"));
    expect(outroErr).toBeDefined();
  });

  it("rejects an interrogation outro requiring a question unlocked after explicit inquiry completion", () => {
    const scene = mkInterrogationScene({
      phases: [
        mkInquiryPhase({
          id: "inquiry",
          complete: { predicate: "question_answered", id: "q1" },
          questions: [
            mkQuestion({
              id: "q1",
              reveals: [{ kind: "question", id: "q2" }],
            }),
            mkQuestion({
              id: "q2",
              required: false,
              status: "locked",
            }),
          ],
        }),
      ],
      outro: {
        unlock: { predicate: "question_answered", id: "q2" },
        dialogue: [],
      },
    });
    const errors = validate({
      chapters: [mkChapter(1, ["interrogation_scene_1.md"])],
      scenes: [{ chapterId: "chapter_1", file: "interrogation_scene_1.md", ast: scene }],
    });
    const outroErr = errors.find((e) => e.code === "interrogationOutroPredicateUnreachable" && e.message.includes("q2"));
    expect(outroErr).toBeDefined();
  });

  it("accepts an interrogation outro OR expression when one branch is obtainable", () => {
    const scene = mkInterrogationScene({
      phases: [
        mkInquiryPhase({
          id: "inquiry",
          questions: [mkQuestion({ id: "q", reveals: [{ kind: "evidence", id: "real_ev" }] })],
        }),
      ],
      evidenceManifest: [mkEvidence("real_ev"), mkEvidence("red_herring")],
      outro: {
        unlock: {
          op: "or",
          left: { predicate: "evidence_collected", id: "real_ev" },
          right: { predicate: "evidence_collected", id: "red_herring" },
        },
        dialogue: [],
      },
    });
    const errors = validate({
      chapters: [mkChapter(1, ["interrogation_scene_1.md"])],
      scenes: [{ chapterId: "chapter_1", file: "interrogation_scene_1.md", ast: scene }],
    });
    expect(errors.find((e) => e.code === "interrogationOutroPredicateUnreachable")).toBeUndefined();
  });

  it("rejects an interrogation outro AND expression when one branch is unobtainable", () => {
    const scene = mkInterrogationScene({
      phases: [
        mkInquiryPhase({
          id: "inquiry",
          questions: [mkQuestion({ id: "q", reveals: [{ kind: "evidence", id: "real_ev" }] })],
        }),
      ],
      evidenceManifest: [mkEvidence("real_ev"), mkEvidence("phantom")],
      outro: {
        unlock: {
          op: "and",
          left: { predicate: "evidence_collected", id: "real_ev" },
          right: { predicate: "evidence_collected", id: "phantom" },
        },
        dialogue: [],
      },
    });
    const errors = validate({
      chapters: [mkChapter(1, ["interrogation_scene_1.md"])],
      scenes: [{ chapterId: "chapter_1", file: "interrogation_scene_1.md", ast: scene }],
    });
    const outroErr = errors.find((e) => e.code === "interrogationOutroPredicateUnreachable" && e.message.includes("phantom"));
    expect(outroErr).toBeDefined();
  });

  it("does not guarantee press-only reveals for cross-scene inventory", () => {
    // Press reveals are optional — the player may complete the testimony by
    // presenting without pressing any statement.  So a later scene should NOT
    // be able to depend on evidence only obtainable via a press reveal.
    const source = mkInterrogationScene({
      phases: [
        mkTestimonyPhase({
          id: "testimony",
          statements: [
            mkTestimonyStatement({
              id: "s1",
              reveals: [{ kind: "evidence", id: "press_only_ev" }],
              contradiction: { kind: "evidence", id: "initial_ev" },
              onCorrect: "win",
            }),
          ],
          results: [mkResult({ id: "win" })],
        }),
      ],
      evidenceManifest: [mkEvidence("initial_ev"), mkEvidence("press_only_ev")],
    });
    const later = mkInterrogationScene({
      phases: [mkTestimonyPhase({
        statements: [mkTestimonyStatement({
          id: "later_s",
          contradiction: { kind: "evidence", id: "press_only_ev" },
          onCorrect: "later_win",
        })],
        results: [mkResult({ id: "later_win" })],
      })],
    });
    const errors = validate({
      chapters: [mkChapter(1, ["interrogation_scene_1.md", "interrogation_scene_2.md"])],
      scenes: [
        { chapterId: "chapter_1", file: "interrogation_scene_1.md", ast: source },
        { chapterId: "chapter_1", file: "interrogation_scene_2.md", ast: later },
      ],
    });
    expect(errors.find((e) => e.code === "crossSceneInventoryNotGuaranteed" && e.message.includes("press_only_ev"))).toBeDefined();
  });

  it("rejects an interrogation outro question_answered predicate when the required phase has no guaranteed completion path", () => {
    // The question IS reachable in isolation, but the required phase has an
    // unsatisfiable completion condition (evidence:missing is never obtainable).
    // With guaranteed flow analysis, there are zero completion paths, so the
    // question is not in guaranteed answeredQuestions. The scene is unwinnable
    // regardless — the phase can't complete, so the outro is never reached.
    const scene = mkInterrogationScene({
      phases: [
        mkInquiryPhase({
          id: "inquiry",
          required: true,
          complete: { predicate: "evidence_collected", id: "missing" },
          questions: [mkQuestion({ id: "answerable_q" })],
        }),
      ],
      evidenceManifest: [mkEvidence("missing")],
      outro: {
        unlock: { predicate: "question_answered", id: "answerable_q" },
        dialogue: [],
      },
    });
    const errors = validate({
      chapters: [mkChapter(1, ["interrogation_scene_1.md"])],
      scenes: [{ chapterId: "chapter_1", file: "interrogation_scene_1.md", ast: scene }],
    });
    expect(errors.find((e) => e.code === "interrogationNoValidCompletionPath" && e.message.includes("inquiry"))).toBeDefined();
    expect(errors.find((e) => e.code === "interrogationOutroPredicateUnreachable" && e.message.includes("answerable_q"))).toBeDefined();
  });

  it("guarantees auto-complete optional follow-up reveals for cross-scene inventory", () => {
    // An auto-complete inquiry with a required question whose answer unlocks
    // an optional follow-up. The follow-up reveals evidence. Because auto-
    // complete waits for ALL unlocked questions (including optional ones),
    // the follow-up's reveals are guaranteed for cross-scene checks.
    const source = mkInterrogationScene({
      phases: [
        mkInquiryPhase({
          id: "inquiry",
          complete: "auto",
          questions: [
            mkQuestion({
              id: "required_q",
              required: true,
              status: "unlocked",
              unlock: null,
              reveals: [{ kind: "evidence", id: "followup_ev" }],
            }),
            mkQuestion({
              id: "optional_followup",
              required: false,
              kind: "followUp",
              parentQuestionId: "required_q",
              status: "locked",
              unlock: { predicate: "question_answered", id: "required_q" },
              reveals: [{ kind: "evidence", id: "followup_ev" }],
            }),
          ],
        }),
      ],
      evidenceManifest: [mkEvidence("followup_ev")],
    });
    const later = mkInterrogationScene({
      phases: [mkTestimonyPhase({
        statements: [mkTestimonyStatement({
          id: "later_s",
          contradiction: { kind: "evidence", id: "followup_ev" },
          onCorrect: "later_win",
        })],
        results: [mkResult({ id: "later_win" })],
      })],
    });
    const errors = validate({
      chapters: [mkChapter(1, ["interrogation_scene_1.md", "interrogation_scene_2.md"])],
      scenes: [
        { chapterId: "chapter_1", file: "interrogation_scene_1.md", ast: source },
        { chapterId: "chapter_1", file: "interrogation_scene_2.md", ast: later },
      ],
    });
    expect(errors.find((e) => e.code === "crossSceneInventoryNotGuaranteed" && e.message.includes("followup_ev"))).toBeUndefined();
  });

  it("guarantees explicit-complete optional question reveals for cross-scene inventory", () => {
    // An inquiry with explicit complete that references an optional question.
    // The completion expression makes that question mandatory regardless of
    // its Required flag, so its reveals should be guaranteed.
    const source = mkInterrogationScene({
      phases: [
        mkInquiryPhase({
          id: "inquiry",
          complete: { predicate: "question_answered", id: "optional_q" },
          questions: [
            mkQuestion({
              id: "optional_q",
              required: false,
              reveals: [{ kind: "evidence", id: "explicit_ev" }],
            }),
          ],
        }),
      ],
      evidenceManifest: [mkEvidence("explicit_ev")],
    });
    const later = mkInterrogationScene({
      phases: [mkTestimonyPhase({
        statements: [mkTestimonyStatement({
          id: "later_s",
          contradiction: { kind: "evidence", id: "explicit_ev" },
          onCorrect: "later_win",
        })],
        results: [mkResult({ id: "later_win" })],
      })],
    });
    const errors = validate({
      chapters: [mkChapter(1, ["interrogation_scene_1.md", "interrogation_scene_2.md"])],
      scenes: [
        { chapterId: "chapter_1", file: "interrogation_scene_1.md", ast: source },
        { chapterId: "chapter_1", file: "interrogation_scene_2.md", ast: later },
      ],
    });
    expect(errors.find((e) => e.code === "crossSceneInventoryNotGuaranteed" && e.message.includes("explicit_ev"))).toBeUndefined();
  });

  it("guarantees investigation reveals from transitively reachable locked blocks", () => {
    // An investigation with auto-outro where a locked hotspot's unlock is
    // satisfied by evidence from an initially unlocked hotspot. The locked
    // hotspot's reveals are guaranteed because the auto-outro requires the
    // player to clear all reachable blocks before leaving.
    const investigation = mkInvestigationScene({
      id: "investigation_1",
      sourceFile: "investigation_1.md",
      sublocations: [
        {
          id: "room",
          label: "Room",
          status: "unlocked",
          unlock: null,
          reveals: [],
          sceneTag: "tag",
          transitionDialogue: [],
          hotspots: [
            {
              id: "unlocked_h",
              label: "Unlocked Hotspot",
              description: "d",
              status: "unlocked",
              unlock: null,
              reveals: [{ kind: "evidence", id: "key_evidence" }],
              inspectDialogue: [],
              onReexamine: null,
              sourceFile: "investigation_1.md",
              line: 3,
            },
            {
              id: "locked_h",
              label: "Locked Hotspot",
              description: "d",
              status: "locked",
              unlock: { predicate: "evidence_collected", id: "key_evidence" },
              reveals: [{ kind: "evidence", id: "chained_evidence" }],
              inspectDialogue: [],
              onReexamine: null,
              sourceFile: "investigation_1.md",
              line: 8,
            },
          ],
          characters: [],
          sourceFile: "investigation_1.md",
          line: 2,
        },
      ],
      evidenceManifest: [mkEvidence("key_evidence"), mkEvidence("chained_evidence")],
    });
    const later = mkInterrogationScene({
      phases: [mkTestimonyPhase({
        statements: [mkTestimonyStatement({
          id: "later_s",
          contradiction: { kind: "evidence", id: "chained_evidence" },
          onCorrect: "later_win",
        })],
        results: [mkResult({ id: "later_win" })],
      })],
    });
    const errors = validate({
      chapters: [mkChapter(1, ["investigation_1.md", "interrogation_scene_2.md"])],
      scenes: [
        { chapterId: "chapter_1", file: "investigation_1.md", ast: investigation },
        { chapterId: "chapter_1", file: "interrogation_scene_2.md", ast: later },
      ],
    });
    expect(errors.find((e) => e.code === "crossSceneInventoryNotGuaranteed" && e.message.includes("chained_evidence"))).toBeUndefined();
  });

  it("does not guarantee entry reveals from non-first unlocked empty sub-locations", () => {
    // An investigation with auto-outro where an unlocked sub-location has no
    // hotspots or topics and is NOT the first unlocked sub-location. The player
    // never needs to enter it, so its entry reveals should NOT be guaranteed —
    // even if those reveals would unlock another sub-location.
    // (The first unlocked sub-location IS always auto-entered by the runtime.)
    const investigation = mkInvestigationScene({
      id: "investigation_1",
      sourceFile: "investigation_1.md",
      sublocations: [
        {
          id: "first_room",
          label: "First Room",
          status: "unlocked",
          unlock: null,
          reveals: [],
          sceneTag: "tag",
          transitionDialogue: [],
          hotspots: [
            {
              id: "first_h",
              label: "First Thing",
              description: "d",
              status: "unlocked",
              unlock: null,
              reveals: [],
              inspectDialogue: [],
              onReexamine: null,
              sourceFile: "investigation_1.md",
              line: 3,
            },
          ],
          characters: [],
          sourceFile: "investigation_1.md",
          line: 2,
        },
        {
          id: "empty_room",
          label: "Empty Room",
          status: "unlocked",
          unlock: null,
          reveals: [{ kind: "sublocation", id: "locked_room" }],
          sceneTag: "tag",
          transitionDialogue: [],
          hotspots: [],
          characters: [],
          sourceFile: "investigation_1.md",
          line: 5,
        },
        {
          id: "locked_room",
          label: "Locked Room",
          status: "locked",
          unlock: null,
          reveals: [],
          sceneTag: "tag",
          transitionDialogue: [],
          hotspots: [
            {
              id: "secret_h",
              label: "Secret",
              description: "d",
              status: "unlocked",
              unlock: null,
              reveals: [{ kind: "evidence", id: "unentered_evidence" }],
              inspectDialogue: [],
              onReexamine: null,
              sourceFile: "investigation_1.md",
              line: 11,
            },
          ],
          characters: [],
          sourceFile: "investigation_1.md",
          line: 9,
        },
      ],
      evidenceManifest: [mkEvidence("unentered_evidence")],
    });
    const later = mkInterrogationScene({
      phases: [mkTestimonyPhase({
        statements: [mkTestimonyStatement({
          id: "later_s",
          contradiction: { kind: "evidence", id: "unentered_evidence" },
          onCorrect: "later_win",
        })],
        results: [mkResult({ id: "later_win" })],
      })],
    });
    const errors = validate({
      chapters: [mkChapter(1, ["investigation_1.md", "interrogation_scene_2.md"])],
      scenes: [
        { chapterId: "chapter_1", file: "investigation_1.md", ast: investigation },
        { chapterId: "chapter_1", file: "interrogation_scene_2.md", ast: later },
      ],
    });
    // The empty_room is not first and not mandatory (no hotspots/topics), so
    // its entry reveals don't fire. locked_room never becomes reachable.
    // unentered_evidence is NOT guaranteed.
    expect(errors.find((e) => e.code === "crossSceneInventoryNotGuaranteed" && e.message.includes("unentered_evidence"))).toBeDefined();
  });

  it("guarantees entry reveals from auto-entered first empty sub-location", () => {
    // The runtime automatically enters the first unlocked sub-location
    // (advance_into_first_sublocation), firing its entry reveals even if it
    // has no hotspots or topics. Evidence from those entry reveals IS guaranteed.
    const investigation = mkInvestigationScene({
      id: "investigation_1",
      sourceFile: "investigation_1.md",
      sublocations: [
        {
          id: "empty_first",
          label: "Empty First Room",
          status: "unlocked",
          unlock: null,
          reveals: [
            { kind: "evidence", id: "auto_entry_evidence" },
            { kind: "sublocation", id: "locked_room" },
          ],
          sceneTag: "tag",
          transitionDialogue: [],
          hotspots: [],
          characters: [],
          sourceFile: "investigation_1.md",
          line: 2,
        },
        {
          id: "locked_room",
          label: "Locked Room",
          status: "locked",
          unlock: null,
          reveals: [],
          sceneTag: "tag",
          transitionDialogue: [],
          hotspots: [
            {
              id: "secret_h",
              label: "Secret",
              description: "d",
              status: "unlocked",
              unlock: null,
              reveals: [],
              inspectDialogue: [],
              onReexamine: null,
              sourceFile: "investigation_1.md",
              line: 8,
            },
          ],
          characters: [],
          sourceFile: "investigation_1.md",
          line: 6,
        },
      ],
      evidenceManifest: [mkEvidence("auto_entry_evidence")],
    });
    const later = mkInterrogationScene({
      phases: [mkTestimonyPhase({
        statements: [mkTestimonyStatement({
          id: "later_s",
          contradiction: { kind: "evidence", id: "auto_entry_evidence" },
          onCorrect: "later_win",
        })],
        results: [mkResult({ id: "later_win" })],
      })],
    });
    const errors = validate({
      chapters: [mkChapter(1, ["investigation_1.md", "interrogation_scene_2.md"])],
      scenes: [
        { chapterId: "chapter_1", file: "investigation_1.md", ast: investigation },
        { chapterId: "chapter_1", file: "interrogation_scene_2.md", ast: later },
      ],
    });
    // empty_first is auto-entered by the runtime, so auto_entry_evidence IS
    // guaranteed — no cross-scene error expected.
    expect(errors.find((e) => e.code === "crossSceneInventoryNotGuaranteed" && e.message.includes("auto_entry_evidence"))).toBeUndefined();
  });

  it("guarantees entry reveal inventory from mandatory sub-locations", () => {
    // A mandatory sub-location (has a hotspot) whose entry reveals include
    // evidence. Since the player must enter it for auto-outro, the entry
    // evidence IS guaranteed for cross-scene checks.
    const investigation = mkInvestigationScene({
      id: "investigation_1",
      sourceFile: "investigation_1.md",
      sublocations: [
        {
          id: "room",
          label: "Room",
          status: "unlocked",
          unlock: null,
          reveals: [{ kind: "evidence", id: "entry_evidence" }],
          sceneTag: "tag",
          transitionDialogue: [],
          hotspots: [
            {
              id: "thing",
              label: "Thing",
              description: "d",
              status: "unlocked",
              unlock: null,
              reveals: [],
              inspectDialogue: [],
              onReexamine: null,
              sourceFile: "investigation_1.md",
              line: 4,
            },
          ],
          characters: [],
          sourceFile: "investigation_1.md",
          line: 2,
        },
      ],
      evidenceManifest: [mkEvidence("entry_evidence")],
    });
    const later = mkInterrogationScene({
      phases: [mkTestimonyPhase({
        statements: [mkTestimonyStatement({
          id: "later_s",
          contradiction: { kind: "evidence", id: "entry_evidence" },
          onCorrect: "later_win",
        })],
        results: [mkResult({ id: "later_win" })],
      })],
    });
    const errors = validate({
      chapters: [mkChapter(1, ["investigation_1.md", "interrogation_scene_2.md"])],
      scenes: [
        { chapterId: "chapter_1", file: "investigation_1.md", ast: investigation },
        { chapterId: "chapter_1", file: "interrogation_scene_2.md", ast: later },
      ],
    });
    expect(errors.find((e) => e.code === "crossSceneInventoryNotGuaranteed" && e.message.includes("entry_evidence"))).toBeUndefined();
  });

  it("guarantees evidence from hotspot reveals when an explicit outro requires that hotspot investigated", () => {
    // An investigation scene with an explicit outro that requires hotspot:h1
    // investigated.  When the player investigates h1, its reveals fire.  Since
    // the outro forces the interaction, evidence from h1 is guaranteed.
    const investigation = mkInvestigationScene({
      id: "investigation_1",
      sourceFile: "investigation_1.md",
      sublocations: [
        {
          id: "room",
          label: "Room",
          status: "unlocked",
          unlock: null,
          reveals: [],
          sceneTag: "tag",
          transitionDialogue: [],
          hotspots: [
            {
              id: "h1",
              label: "Key Hotspot",
              description: "d",
              status: "unlocked",
              unlock: null,
              reveals: [{ kind: "evidence", id: "hotspot_evidence" }],
              inspectDialogue: [],
              onReexamine: null,
              sourceFile: "investigation_1.md",
              line: 3,
            },
          ],
          characters: [],
          sourceFile: "investigation_1.md",
          line: 2,
        },
      ],
      evidenceManifest: [mkEvidence("hotspot_evidence")],
      outro: {
        unlock: { predicate: "hotspot_investigated", id: "h1" },
        dialogue: [],
      },
    });
    const later = mkInterrogationScene({
      phases: [mkTestimonyPhase({
        statements: [mkTestimonyStatement({
          id: "later_s",
          contradiction: { kind: "evidence", id: "hotspot_evidence" },
          onCorrect: "later_win",
        })],
        results: [mkResult({ id: "later_win" })],
      })],
    });
    const errors = validate({
      chapters: [mkChapter(1, ["investigation_1.md", "interrogation_scene_2.md"])],
      scenes: [
        { chapterId: "chapter_1", file: "investigation_1.md", ast: investigation },
        { chapterId: "chapter_1", file: "interrogation_scene_2.md", ast: later },
      ],
    });
    expect(errors.find((e) => e.code === "crossSceneInventoryNotGuaranteed" && e.message.includes("hotspot_evidence"))).toBeUndefined();
  });

  it("guarantees evidence from topic reveals when an explicit outro requires that topic discussed", () => {
    // An investigation scene with an explicit outro that requires a topic
    // discussed.  The topic's reveals are guaranteed because the outro forces
    // the interaction.
    const investigation = mkInvestigationScene({
      id: "investigation_1",
      sourceFile: "investigation_1.md",
      sublocations: [
        {
          id: "room",
          label: "Room",
          status: "unlocked",
          unlock: null,
          reveals: [],
          sceneTag: "tag",
          transitionDialogue: [],
          hotspots: [],
          characters: [
            {
              id: "npc",
              label: "NPC",
              name: "NPC",
              role: "Witness",
              bio: "d",
              topics: [
                {
                  id: "motive",
                  label: "Motive",
                  status: "unlocked" as const,
                  unlock: null,
                  reveals: [{ kind: "evidence", id: "topic_evidence" }],
                  topicDialogue: [],
                  onReexamine: null,
                  sourceFile: "investigation_1.md",
                  line: 4,
                },
              ],
              sourceFile: "investigation_1.md",
              line: 3,
            },
          ],
          sourceFile: "investigation_1.md",
          line: 2,
        },
      ],
      evidenceManifest: [mkEvidence("topic_evidence")],
      outro: {
        unlock: { predicate: "topic_discussed", characterId: "npc", topicId: "motive" },
        dialogue: [],
      },
    });
    const later = mkInterrogationScene({
      phases: [mkTestimonyPhase({
        statements: [mkTestimonyStatement({
          id: "later_s",
          contradiction: { kind: "evidence", id: "topic_evidence" },
          onCorrect: "later_win",
        })],
        results: [mkResult({ id: "later_win" })],
      })],
    });
    const errors = validate({
      chapters: [mkChapter(1, ["investigation_1.md", "interrogation_scene_2.md"])],
      scenes: [
        { chapterId: "chapter_1", file: "investigation_1.md", ast: investigation },
        { chapterId: "chapter_1", file: "interrogation_scene_2.md", ast: later },
      ],
    });
    expect(errors.find((e) => e.code === "crossSceneInventoryNotGuaranteed" && e.message.includes("topic_evidence"))).toBeUndefined();
  });

  it("rejects a required testimony phase whose contradiction evidence comes from an earlier optional phase", () => {
    // When an optional phase is listed before a required phase in the file,
    // the runtime selects the required phase first (refresh_current_phase
    // prioritises required phases).  The validator must match this ordering —
    // otherwise the optional phase's reveals incorrectly satisfy the required
    // phase's completion, producing a scene that compiles but is unwinnable.
    const scene = mkInterrogationScene({
      phases: [
        // Optional inquiry listed first — reveals evidence.
        mkInquiryPhase({
          id: "optional_inquiry",
          required: false,
          questions: [
            mkQuestion({
              id: "opt_q1",
              required: false,
              reveals: [{ kind: "evidence", id: "opt_evidence" }],
            }),
          ],
        }),
        // Required testimony that depends on the optional phase's evidence.
        mkTestimonyPhase({
          id: "required_testimony",
          statements: [mkTestimonyStatement({
            id: "stmt",
            contradiction: { kind: "evidence", id: "opt_evidence" },
            onCorrect: "win",
          })],
          results: [mkResult({ id: "win" })],
        }),
      ],
      evidenceManifest: [mkEvidence("opt_evidence")],
    });
    const errors = validate({
      chapters: [mkChapter(1, ["interrogation_scene_1.md"])],
      scenes: [{ chapterId: "chapter_1", file: "interrogation_scene_1.md", ast: scene }],
    });
    expect(errors.find((e) => e.code === "interrogationNoValidContradictionPath" && e.message.includes("required_testimony"))).toBeDefined();
  });

  it("rejects a later required phase unlocked only by one alternate correct testimony result", () => {
    const scene = mkInterrogationScene({
      phases: [
        mkInquiryPhase({
          id: "source_inquiry",
          questions: [
            mkQuestion({
              id: "q",
              reveals: [
                { kind: "evidence", id: "log_a" },
                { kind: "evidence", id: "log_b" },
              ],
            }),
          ],
        }),
        mkTestimonyPhase({
          id: "source_testimony",
          statements: [
            mkTestimonyStatement({
              id: "a",
              contradiction: { kind: "evidence", id: "log_a" },
              onCorrect: "path_a",
            }),
            mkTestimonyStatement({
              id: "b",
              contradiction: { kind: "evidence", id: "log_b" },
              onCorrect: "path_b",
            }),
          ],
          results: [
            mkResult({ id: "path_a", reveals: [{ kind: "evidence", id: "only_path_a" }] }),
            mkResult({ id: "path_b", reveals: [{ kind: "evidence", id: "only_path_b" }] }),
          ],
        }),
        mkInquiryPhase({
          id: "branch_locked_followup",
          status: "locked",
          unlock: { predicate: "evidence_collected", id: "only_path_a" },
          questions: [mkQuestion({ id: "followup_q" })],
        }),
      ],
      evidenceManifest: [
        mkEvidence("log_a"),
        mkEvidence("log_b"),
        mkEvidence("only_path_a"),
        mkEvidence("only_path_b"),
      ],
    });
    const errors = validate({
      chapters: [mkChapter(1, ["interrogation_scene_1.md"])],
      scenes: [{ chapterId: "chapter_1", file: "interrogation_scene_1.md", ast: scene }],
    });
    expect(errors.find((e) => e.code === "interrogationNoValidCompletionPath" && e.message.includes("branch_locked_followup"))).toBeDefined();
  });

  it("does not guarantee inventory from only one branch of an OR complete expression for cross-scene checks", () => {
    // When an inquiry phase completes via `evidence_collected:A OR
    // question_answered:Q2`, only inventory items needed by BOTH branches are
    // guaranteed.  If evidence:A is only needed by one branch, a question
    // revealing evidence:A should NOT be mandatory, and evidence:A should not
    // be considered guaranteed for later scenes.
    const source = mkInterrogationScene({
      phases: [
        mkInquiryPhase({
          id: "source_inquiry",
          complete: {
            op: "or",
            left: { predicate: "evidence_collected", id: "branch_evidence" },
            right: { predicate: "question_answered", id: "gate_q" },
          },
          questions: [
            mkQuestion({
              id: "gate_q",
              required: true,
            }),
            mkQuestion({
              id: "evidence_q",
              required: false,
              reveals: [{ kind: "evidence", id: "branch_evidence" }],
            }),
          ],
        }),
      ],
      evidenceManifest: [mkEvidence("branch_evidence")],
    });
    const later = mkInterrogationScene({
      phases: [mkTestimonyPhase({
        statements: [mkTestimonyStatement({
          id: "later_s",
          contradiction: { kind: "evidence", id: "branch_evidence" },
          onCorrect: "later_win",
        })],
        results: [mkResult({ id: "later_win" })],
      })],
    });
    const errors = validate({
      chapters: [mkChapter(1, ["interrogation_scene_1.md", "interrogation_scene_2.md"])],
      scenes: [
        { chapterId: "chapter_1", file: "interrogation_scene_1.md", ast: source },
        { chapterId: "chapter_1", file: "interrogation_scene_2.md", ast: later },
      ],
    });
    expect(errors.find((e) => e.code === "crossSceneInventoryNotGuaranteed" && e.message.includes("branch_evidence"))).toBeDefined();
  });

  it("rejects an interrogation outro requiring evidence from only one of multiple correct testimony paths", () => {
    // Testimony phase has two valid correct paths (two contradictions with
    // different correct results). Result A reveals evidence:only_a, Result B
    // reveals evidence:only_b. The outro requires evidence:only_a — but the
    // player might pick path B and never obtain it, leaving the scene stuck.
    const scene = mkInterrogationScene({
      phases: [
        mkInquiryPhase({
          id: "setup",
          questions: [
            mkQuestion({
              id: "q",
              reveals: [
                { kind: "evidence", id: "log_a" },
                { kind: "evidence", id: "log_b" },
              ],
            }),
          ],
        }),
        mkTestimonyPhase({
          id: "testimony",
          statements: [
            mkTestimonyStatement({
              id: "s_a",
              contradiction: { kind: "evidence", id: "log_a" },
              onCorrect: "result_a",
            }),
            mkTestimonyStatement({
              id: "s_b",
              contradiction: { kind: "evidence", id: "log_b" },
              onCorrect: "result_b",
            }),
          ],
          results: [
            mkResult({ id: "result_a", reveals: [{ kind: "evidence", id: "only_a" }] }),
            mkResult({ id: "result_b", reveals: [{ kind: "evidence", id: "only_b" }] }),
          ],
        }),
      ],
      evidenceManifest: [
        mkEvidence("log_a"),
        mkEvidence("log_b"),
        mkEvidence("only_a"),
        mkEvidence("only_b"),
      ],
      outro: {
        unlock: { predicate: "evidence_collected", id: "only_a" },
        dialogue: [],
      },
    });
    const errors = validate({
      chapters: [mkChapter(1, ["interrogation_scene_1.md"])],
      scenes: [{ chapterId: "chapter_1", file: "interrogation_scene_1.md", ast: scene }],
    });
    expect(errors.find((e) => e.code === "interrogationOutroPredicateUnreachable" && e.message.includes("only_a"))).toBeDefined();
  });

  it("accepts an interrogation outro requiring evidence common to all correct testimony paths", () => {
    // Two valid correct paths that BOTH reveal the same evidence:shared.
    // The outro requires evidence:shared — guaranteed because every path
    // produces it.
    const scene = mkInterrogationScene({
      phases: [
        mkInquiryPhase({
          id: "setup",
          questions: [
            mkQuestion({
              id: "q",
              reveals: [
                { kind: "evidence", id: "log_a" },
                { kind: "evidence", id: "log_b" },
              ],
            }),
          ],
        }),
        mkTestimonyPhase({
          id: "testimony",
          statements: [
            mkTestimonyStatement({
              id: "s_a",
              contradiction: { kind: "evidence", id: "log_a" },
              onCorrect: "result_a",
            }),
            mkTestimonyStatement({
              id: "s_b",
              contradiction: { kind: "evidence", id: "log_b" },
              onCorrect: "result_b",
            }),
          ],
          results: [
            mkResult({ id: "result_a", reveals: [{ kind: "evidence", id: "shared" }] }),
            mkResult({ id: "result_b", reveals: [{ kind: "evidence", id: "shared" }] }),
          ],
        }),
      ],
      evidenceManifest: [
        mkEvidence("log_a"),
        mkEvidence("log_b"),
        mkEvidence("shared"),
      ],
      outro: {
        unlock: { predicate: "evidence_collected", id: "shared" },
        dialogue: [],
      },
    });
    const errors = validate({
      chapters: [mkChapter(1, ["interrogation_scene_1.md"])],
      scenes: [{ chapterId: "chapter_1", file: "interrogation_scene_1.md", ast: scene }],
    });
    expect(errors.find((e) => e.code === "interrogationOutroPredicateUnreachable")).toBeUndefined();
  });

  it("accepts a locked required phase unlocked by an earlier optional phase's reveals", () => {
    // When a required phase starts locked and an optional phase (appearing
    // earlier in source order) reveals the evidence or phase unlock that
    // satisfies the required phase's unlock condition, the runtime skips the
    // locked required phase, enters the optional phase, and then returns to
    // the now-unlocked required phase. The validator must not report a false
    // positive interrogationNoValidCompletionPath for this valid scene.
    const scene = mkInterrogationScene({
      phases: [
        mkInquiryPhase({
          id: "optional_setup",
          required: false,
          questions: [
            mkQuestion({
              id: "opt_q",
              required: false,
              reveals: [{ kind: "evidence", id: "unlock_key" }],
            }),
          ],
        }),
        mkInquiryPhase({
          id: "locked_required",
          required: true,
          status: "locked",
          unlock: { predicate: "evidence_collected", id: "unlock_key" },
          questions: [mkQuestion({ id: "locked_q" })],
        }),
      ],
      evidenceManifest: [mkEvidence("unlock_key")],
    });
    const errors = validate({
      chapters: [mkChapter(1, ["interrogation_scene_1.md"])],
      scenes: [{ chapterId: "chapter_1", file: "interrogation_scene_1.md", ast: scene }],
    });
    expect(errors.find((e) => e.code === "interrogationNoValidCompletionPath")).toBeUndefined();
  });

  it("still rejects a locked required phase when no phase reveals its unlock", () => {
    // A locked required phase whose unlock condition is never satisfied by
    // any phase in the scene should still produce an error, even with the
    // fixed-point iteration.
    const scene = mkInterrogationScene({
      phases: [
        mkInquiryPhase({
          id: "optional_setup",
          required: false,
          questions: [
            mkQuestion({
              id: "opt_q",
              required: false,
              reveals: [{ kind: "evidence", id: "wrong_key" }],
            }),
          ],
        }),
        mkInquiryPhase({
          id: "locked_required",
          required: true,
          status: "locked",
          unlock: { predicate: "evidence_collected", id: "missing_key" },
          questions: [mkQuestion({ id: "locked_q" })],
        }),
      ],
      evidenceManifest: [mkEvidence("wrong_key"), mkEvidence("missing_key")],
    });
    const errors = validate({
      chapters: [mkChapter(1, ["interrogation_scene_1.md"])],
      scenes: [{ chapterId: "chapter_1", file: "interrogation_scene_1.md", ast: scene }],
    });
    expect(errors.find((e) => e.code === "interrogationNoValidCompletionPath" && e.message.includes("locked_required"))).toBeDefined();
  });

  it("accepts a locked required phase unlocked by an optional phase's phase reveal", () => {
    // A locked required phase whose unlock condition references a phase
    // completion that is only produced by an optional phase should still
    // be accepted if the optional phase is the only unlocked path available.
    const scene = mkInterrogationScene({
      phases: [
        mkInquiryPhase({
          id: "optional_first",
          required: false,
          questions: [
            mkQuestion({
              id: "opt_q",
              required: false,
            }),
          ],
          reveals: [{ kind: "phase", id: "locked_required" }],
        }),
        mkInquiryPhase({
          id: "locked_required",
          required: true,
          status: "locked",
          unlock: null,
          questions: [mkQuestion({ id: "locked_q" })],
        }),
      ],
    });
    const errors = validate({
      chapters: [mkChapter(1, ["interrogation_scene_1.md"])],
      scenes: [{ chapterId: "chapter_1", file: "interrogation_scene_1.md", ast: scene }],
    });
    expect(errors.find((e) => e.code === "interrogationNoValidCompletionPath")).toBeUndefined();
  });

  it("guarantees entry reveals from first sub-location for explicit-outro investigations", () => {
    // Even with an explicit outro, the runtime auto-enters the first unlocked
    // sub-location, so its entry reveals are guaranteed for cross-scene checks.
    const investigation = mkInvestigationScene({
      id: "investigation_1",
      sourceFile: "investigation_1.md",
      sublocations: [
        {
          id: "entry_room",
          label: "Entry Room",
          status: "unlocked",
          unlock: null,
          reveals: [{ kind: "evidence", id: "entry_only_evidence" }],
          sceneTag: "tag",
          transitionDialogue: [],
          hotspots: [
            {
              id: "h1",
              label: "Hotspot",
              description: "d",
              status: "unlocked",
              unlock: null,
              reveals: [],
              inspectDialogue: [],
              onReexamine: null,
              sourceFile: "investigation_1.md",
              line: 3,
            },
          ],
          characters: [],
          sourceFile: "investigation_1.md",
          line: 2,
        },
      ],
      evidenceManifest: [mkEvidence("entry_only_evidence")],
      outro: {
        unlock: { predicate: "hotspot_investigated", id: "h1" },
        dialogue: [],
      },
    });
    const later = mkInterrogationScene({
      phases: [mkTestimonyPhase({
        statements: [mkTestimonyStatement({
          id: "later_s",
          contradiction: { kind: "evidence", id: "entry_only_evidence" },
          onCorrect: "later_win",
        })],
        results: [mkResult({ id: "later_win" })],
      })],
    });
    const errors = validate({
      chapters: [mkChapter(1, ["investigation_1.md", "interrogation_scene_2.md"])],
      scenes: [
        { chapterId: "chapter_1", file: "investigation_1.md", ast: investigation },
        { chapterId: "chapter_1", file: "interrogation_scene_2.md", ast: later },
      ],
    });
    expect(errors.find((e) => e.code === "crossSceneInventoryNotGuaranteed" && e.message.includes("entry_only_evidence"))).toBeUndefined();
  });

  it("forces an optional phase when the outro requires phase_completed for that phase", () => {
    // An interrogation scene where the outro uses a phase_completed predicate
    // for an optional phase.  The outro-forced loop must detect this via the
    // clone's completedPhases set, so the phase is promoted to forced and its
    // reveals become guaranteed.
    const scene = mkInterrogationScene({
      phases: [
        mkInquiryPhase({
          id: "optional_phase",
          required: false,
          questions: [
            mkQuestion({
              id: "opt_q",
              required: false,
              reveals: [{ kind: "evidence", id: "phase_forced_evidence" }],
            }),
          ],
        }),
      ],
      evidenceManifest: [mkEvidence("phase_forced_evidence")],
      outro: {
        unlock: { predicate: "phase_completed", id: "optional_phase" },
        dialogue: [],
      },
    });
    const later = mkInterrogationScene({
      phases: [mkTestimonyPhase({
        statements: [mkTestimonyStatement({
          id: "later_s",
          contradiction: { kind: "evidence", id: "phase_forced_evidence" },
          onCorrect: "later_win",
        })],
        results: [mkResult({ id: "later_win" })],
      })],
    });
    const errors = validate({
      chapters: [mkChapter(1, ["interrogation_scene_1.md", "interrogation_scene_2.md"])],
      scenes: [
        { chapterId: "chapter_1", file: "interrogation_scene_1.md", ast: scene },
        { chapterId: "chapter_1", file: "interrogation_scene_2.md", ast: later },
      ],
    });
    expect(errors.find((e) => e.code === "crossSceneInventoryNotGuaranteed" && e.message.includes("phase_forced_evidence"))).toBeUndefined();
  });
});

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
});

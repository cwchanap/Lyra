import { describe, expect, it } from "vitest";
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
  ASTTestimony,
  ASTTestimonyLine,
  DialogueItem,
  InterrogationRevealTarget,
  InventoryTarget,
} from "./types";

// Test helpers — minimal AST builders.

const mkLinearScene = (id: string): ASTLinearScene => ({
  kind: "linearScene",
  id,
  title: id,
  summary: id,
  summaryAuthored: false,
  queue: [],
  assetRefs: [],
  sourceFile: `${id}.md`,
  line: 1,
});

const mkInvestigationScene = (
  overrides: Partial<ASTInvestigationScene> = {},
): ASTInvestigationScene => ({
  kind: "investigationScene",
  id: overrides.id ?? "i",
  title: overrides.title ?? "i",
  summary: overrides.summary ?? overrides.title ?? "i",
  summaryAuthored: overrides.summaryAuthored ?? false,
  intro: [],
  sublocations: [
    {
      id: "room",
      label: "Room",
      status: "unlocked",
      unlock: null,
      reveals: [],
      sceneTag: "tag",
      assetCue: null,
      transitionDialogue: [],
      hotspots: [
        {
          id: "thing",
          label: "thing",
          description: "a thing",
          status: "unlocked",
          unlock: null,
          reveals: [],
          evidenceSource: null,
          sceneSourcePrompt: null,
          inspectDialogue: [
            { kind: "line", speaker: "A", text: "hi" },
          ] as DialogueItem[],
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
  assetRefs: [],
  outro: { unlock: "auto", dialogue: [] },
  sourceFile: "i.md",
  line: 1,
  ...overrides,
});

const mkEvidence = (
  id: string,
  sourceSublocationId: string | null = "room",
): ASTEvidence => ({
  id,
  name: id,
  description: id,
  details: id,
  imageCue: { imagePrompt: null, imageAssetId: null },
  sourceSublocationId,
  onCollect: [],
  onReexamine: null,
  sourceFile: "interrogation_scene_1.md",
  line: 1,
});

const line = (text: string): DialogueItem => ({
  kind: "line",
  speaker: "Speaker",
  text,
});

// A plain testimony line. By default an honest line (no Contradiction), so it
// is NOT a breakthrough. Use mkContradictionLine for a breakable line.
const mkLine = (
  overrides: Partial<ASTTestimonyLine> = {},
): ASTTestimonyLine => ({
  id: "line",
  label: "Line",
  content: [line("content")],
  contradiction: null,
  challenge: null,
  onCorrect: null,
  onWrongEvidence: null,
  reveals: [],
  sourceFile: "interrogation_scene_1.md",
  line: 1,
  ...overrides,
});

// A breakable Contradiction line: challenging it and presenting the correct
// evidence fires On Correct and applies `reveals`. Challenge / On Correct /
// On Wrong Evidence are all required whenever a Contradiction is present
// (parser-enforced), so they are always populated here.
const mkContradictionLine = (
  id: string,
  contradiction: InventoryTarget,
  reveals: InterrogationRevealTarget[] = [],
): ASTTestimonyLine =>
  mkLine({
    id,
    contradiction,
    challenge: [line("challenge")],
    onCorrect: [line("correct")],
    onWrongEvidence: [line("wrong")],
    reveals,
  });

const mkTestimony = (lines: ASTTestimonyLine[] = [mkLine()]): ASTTestimony => ({
  onLoop: [line("loop")],
  loopPrompt: lines.some((l) => l.contradiction !== null)
    ? [line("loop-prompt")]
    : null,
  defaultChallenge: null,
  defaultWrong: null,
  wrongReply: lines.some((l) => l.contradiction !== null)
    ? [line("wrong-reply")]
    : null,
  lines,
  sourceFile: "interrogation_scene_1.md",
  line: 1,
});

// Default question is OPTIONAL with a single honest line — a minimal phase of
// such questions auto-completes vacuously (no Required question needs a
// breakthrough). Tests that need a question to be broken pass a Contradiction
// line whose target is guaranteed in inventory.
const mkQuestion = (
  overrides: Partial<ASTInquiryQuestion> = {},
): ASTInquiryQuestion => ({
  id: "question",
  label: "Question",
  status: "unlocked",
  required: false,
  unlock: null,
  reveals: [],
  testimony: mkTestimony(),
  sourceFile: "interrogation_scene_1.md",
  line: 1,
  ...overrides,
});

const mkInquiryPhase = (
  overrides: Partial<ASTInquiryPhase> = {},
): ASTInquiryPhase => ({
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
  assetCue: null,
  entryDialogue: [],
  complete: "auto",
  questions: [mkQuestion()],
  sourceFile: "interrogation_scene_1.md",
  line: 1,
  ...overrides,
});

const mkInterrogationScene = (
  overrides: Partial<ASTInterrogationScene> = {},
): ASTInterrogationScene => {
  const phases = overrides.phases ?? [mkInquiryPhase()];

  return {
    kind: "interrogationScene",
    id: "interrogation_scene_1",
    title: "Interrogation",
    summary: overrides.summary ?? overrides.title ?? "Interrogation",
    summaryAuthored: overrides.summaryAuthored ?? false,
    intro: [],
    phases: phases as ASTInterrogationPhase[],
    evidenceManifest: [],
    statementManifest: [],
    assetRefs: [],
    outro: { unlock: "auto", dialogue: [] },
    sourceFile: "interrogation_scene_1.md",
    line: 1,
    ...overrides,
  };
};

// Compile a single interrogation scene (optionally with earlier scenes that
// establish guaranteed inventory) and return the validator errors.
const validateInterrogation = (
  scene: ASTInterrogationScene,
  priorScenes: {
    file: string;
    ast: ASTInvestigationScene | ASTInterrogationScene;
  }[] = [],
) => {
  const sceneFile = "interrogation_scene_1.md";
  const files = [...priorScenes.map((s) => s.file), sceneFile];
  return validate({
    chapters: [mkChapter(1, files)],
    scenes: [
      ...priorScenes.map((s) => ({
        chapterId: "chapter_1",
        file: s.file,
        ast: s.ast,
      })),
      { chapterId: "chapter_1", file: sceneFile, ast: scene },
    ],
  });
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
  it("rejects duplicate scene IDs within one chapter at the second scene", () => {
    const errors = validate({
      chapters: [mkChapter(1, ["scene_a.md", "scene_b.md"])],
      scenes: [
        {
          chapterId: "chapter_1",
          file: "scene_a.md",
          ast: {
            ...mkLinearScene("shared_scene"),
            sourceFile: "chapter_1/scene_a.md",
          },
        },
        {
          chapterId: "chapter_1",
          file: "scene_b.md",
          ast: {
            ...mkLinearScene("shared_scene"),
            sourceFile: "chapter_1/scene_b.md",
            line: 7,
          },
        },
      ],
    });

    expect(errors).toContainEqual(
      expect.objectContaining({
        code: "duplicateSceneId",
        sourceFile: "chapter_1/scene_b.md",
        line: 7,
      }),
    );
  });

  it("allows the same scene ID in different chapters", () => {
    expect(
      validate({
        chapters: [mkChapter(1, ["scene_a.md"]), mkChapter(2, ["scene_b.md"])],
        scenes: [
          {
            chapterId: "chapter_1",
            file: "scene_a.md",
            ast: {
              ...mkLinearScene("shared_scene"),
              sourceFile: "chapter_1/scene_a.md",
            },
          },
          {
            chapterId: "chapter_2",
            file: "scene_b.md",
            ast: {
              ...mkLinearScene("shared_scene"),
              sourceFile: "chapter_2/scene_b.md",
            },
          },
        ],
      }),
    ).toEqual([]);
  });

  it("accepts a valid minimal corpus", () => {
    const errors = validate({
      chapters: [mkChapter(1, ["scene_0.md", "investigation_scene_1.md"])],
      scenes: [
        {
          chapterId: "chapter_1",
          file: "scene_0.md",
          ast: mkLinearScene("scene_0"),
        },
        {
          chapterId: "chapter_1",
          file: "investigation_scene_1.md",
          ast: mkInvestigationScene({ id: "investigation_scene_1" }),
        },
      ],
    });
    expect(errors).toEqual([]);
  });

  it("rejects a chapter manifest pointing to a non-existent scene file", () => {
    const errors = validate({
      chapters: [mkChapter(1, ["missing.md"])],
      scenes: [],
    });
    expect(
      errors.find((e) => e.code === "chapterManifestMissingFile"),
    ).toBeDefined();
  });

  it("rejects a chapter whose only scenes are reserved placeholders", () => {
    const errors = validate({
      chapters: [mkChapter(1, ["interrogation_scene_1.md"])],
      scenes: [],
      skippedReservedFiles: new Set(["chapter_1/interrogation_scene_1.md"]),
    });
    expect(
      errors.find((e) => e.code === "chapterNoPlayableScenes"),
    ).toBeDefined();
    expect(
      errors.find((e) => e.code === "chapterManifestMissingFile"),
    ).toBeUndefined();
  });

  it("rejects a hotspot whose Reveals target an undeclared evidence id", () => {
    const scene = mkInvestigationScene({ id: "i" });
    scene.sublocations[0]!.hotspots[0]!.reveals = [
      { kind: "evidence", id: "ghost" },
    ];
    const errors = validate({
      chapters: [mkChapter(1, ["i.md"])],
      scenes: [{ chapterId: "chapter_1", file: "i.md", ast: scene }],
    });
    expect(
      errors.find((e) => e.code === "unresolvedRevealTarget"),
    ).toBeDefined();
  });

  describe("source sublocation validation", () => {
    const validateSourceScene = (scene: ASTInvestigationScene) =>
      validate({
        chapters: [mkChapter(1, ["i.md"])],
        scenes: [{ chapterId: "chapter_1", file: "i.md", ast: scene }],
      });

    const mkSourceSublocationScene = (): ASTInvestigationScene => {
      const scene = mkInvestigationScene({ id: "i" });
      const frontHotspot = scene.sublocations[0]!.hotspots[0]!;

      scene.sublocations = [
        {
          ...scene.sublocations[0]!,
          id: "front",
          label: "Front",
          sceneTag: "front",
          hotspots: [{ ...frontHotspot, id: "front_clue", line: 10 }],
          characters: [],
          line: 2,
        },
        {
          id: "corridor",
          label: "Corridor",
          status: "unlocked",
          unlock: null,
          reveals: [],
          sceneTag: "corridor",
          assetCue: null,
          transitionDialogue: [],
          hotspots: [{ ...frontHotspot, id: "corridor_clue", line: 20 }],
          characters: [],
          sourceFile: "i.md",
          line: 12,
        },
      ];

      return scene;
    };

    const mkSourceEvidence = (
      id: string,
      sourceSublocationId: string | null,
    ): ASTEvidence => ({
      ...mkEvidence(id),
      sourceFile: "i.md",
      line: 30,
      sourceSublocationId,
    });

    it("rejects evidence without source sublocation", () => {
      const scene = mkSourceSublocationScene();
      scene.evidenceManifest = [mkSourceEvidence("badge", null)];

      const errors = validateSourceScene(scene);

      expect(errors.map((e) => e.code)).toEqual([
        "evidenceSourceSublocationMissing",
      ]);
      expect(errors[0]!.line).toBe(30);
    });

    it("rejects evidence whose source sublocation field is omitted", () => {
      const scene = mkSourceSublocationScene();
      const evidence = mkSourceEvidence(
        "badge",
        "front",
      ) as Partial<ASTEvidence>;
      delete evidence.sourceSublocationId;
      scene.evidenceManifest = [evidence as ASTEvidence];

      const errors = validateSourceScene(scene);

      expect(errors.map((e) => e.code)).toEqual([
        "evidenceSourceSublocationMissing",
      ]);
      expect(errors[0]!.line).toBe(30);
    });

    it("rejects evidence with unknown source sublocation", () => {
      const scene = mkSourceSublocationScene();
      scene.evidenceManifest = [mkSourceEvidence("badge", "basement")];
      scene.sublocations[0]!.hotspots[0]!.reveals = [
        { kind: "evidence", id: "badge" },
      ];

      const errors = validateSourceScene(scene);

      expect(errors.map((e) => e.code)).toEqual([
        "evidenceSourceSublocationUnknown",
      ]);
      expect(errors[0]!.line).toBe(30);
    });

    it("rejects a hotspot source sublocation mismatch", () => {
      const scene = mkSourceSublocationScene();
      scene.evidenceManifest = [mkSourceEvidence("badge", "corridor")];
      scene.sublocations[0]!.hotspots[0]!.reveals = [
        { kind: "evidence", id: "badge" },
      ];

      const errors = validateSourceScene(scene);

      expect(errors.map((e) => e.code)).toEqual([
        "evidenceRevealOutsideSourceSublocation",
      ]);
      expect(errors[0]!.line).toBe(10);
    });

    it("rejects a sublocation entry source sublocation mismatch", () => {
      const scene = mkSourceSublocationScene();
      scene.evidenceManifest = [mkSourceEvidence("badge", "corridor")];
      scene.sublocations[0]!.reveals = [{ kind: "evidence", id: "badge" }];

      const errors = validateSourceScene(scene);

      expect(errors.map((e) => e.code)).toEqual([
        "evidenceRevealOutsideSourceSublocation",
      ]);
      expect(errors[0]!.line).toBe(2);
    });

    it("rejects a topic source sublocation mismatch", () => {
      const scene = mkSourceSublocationScene();
      scene.evidenceManifest = [mkSourceEvidence("badge", "corridor")];
      scene.sublocations[0]!.characters = [
        {
          id: "witness",
          name: "Witness",
          role: "Resident",
          bio: "Saw the corridor.",
          topics: [
            {
              id: "badge",
              label: "Badge",
              status: "unlocked",
              unlock: null,
              reveals: [{ kind: "evidence", id: "badge" }],
              topicDialogue: [],
              onReexamine: null,
              sourceFile: "i.md",
              line: 40,
            },
          ],
          sourceFile: "i.md",
          line: 38,
        },
      ];

      const errors = validateSourceScene(scene);

      expect(errors.map((e) => e.code)).toEqual([
        "evidenceRevealOutsideSourceSublocation",
      ]);
      expect(errors[0]!.line).toBe(40);
    });

    it("accepts a hotspot in the matching source sublocation", () => {
      const scene = mkSourceSublocationScene();
      scene.evidenceManifest = [mkSourceEvidence("badge", "corridor")];
      scene.sublocations[1]!.hotspots[0]!.reveals = [
        { kind: "evidence", id: "badge" },
      ];

      const errors = validateSourceScene(scene);

      expect(errors).toEqual([]);
    });
  });

  it("rejects duplicate global evidence ids across chapters", () => {
    const scene1 = mkInvestigationScene({ id: "a" });
    scene1.evidenceManifest = [
      {
        id: "dup",
        name: "n",
        description: "d",
        details: "x",
        imageCue: { imagePrompt: null, imageAssetId: null },
        sourceSublocationId: null,
        onCollect: [],
        onReexamine: null,
        sourceFile: "a.md",
        line: 10,
      },
    ];
    const scene2 = mkInvestigationScene({ id: "b" });
    scene2.evidenceManifest = [
      {
        id: "dup",
        name: "n",
        description: "d",
        details: "x",
        imageCue: { imagePrompt: null, imageAssetId: null },
        sourceSublocationId: null,
        onCollect: [],
        onReexamine: null,
        sourceFile: "b.md",
        line: 10,
      },
    ];
    const errors = validate({
      chapters: [mkChapter(1, ["a.md"]), mkChapter(2, ["b.md"])],
      scenes: [
        { chapterId: "chapter_1", file: "a.md", ast: scene1 },
        { chapterId: "chapter_2", file: "b.md", ast: scene2 },
      ],
    });
    expect(
      errors.find((e) => e.code === "duplicateGlobalEvidenceId"),
    ).toBeDefined();
  });

  it("rejects a cross-chapter Unlock predicate (v1 restriction)", () => {
    const scene1 = mkInvestigationScene({ id: "a" });
    scene1.evidenceManifest = [
      {
        id: "foo",
        name: "n",
        description: "d",
        details: "x",
        imageCue: { imagePrompt: null, imageAssetId: null },
        sourceSublocationId: null,
        onCollect: [],
        onReexamine: null,
        sourceFile: "a.md",
        line: 10,
      },
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
    expect(
      errors.find((e) => e.code === "unresolvedUnlockPredicate"),
    ).toBeDefined();
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
      assetCue: null,
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
    expect(
      errors.find((e) => e.code === "lockedBlockUnreachable"),
    ).toBeDefined();
  });

  it("rejects a block with BOTH an inbound Reveals and a self Unlock", () => {
    const scene = mkInvestigationScene({ id: "i" });
    scene.sublocations[0]!.hotspots[0]!.reveals = [
      { kind: "sublocation", id: "double_path" },
    ];
    scene.sublocations.push({
      id: "double_path",
      label: "Double Path",
      status: "locked",
      unlock: { predicate: "hotspot_investigated", id: "thing" },
      reveals: [],
      sceneTag: "t",
      assetCue: null,
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
        assetCue: null,
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
        assetCue: null,
        transitionDialogue: [],
        hotspots: [
          {
            id: "hb",
            label: "hb",
            description: "b",
            status: "unlocked",
            unlock: null,
            reveals: [],
            evidenceSource: null,
            sceneSourcePrompt: null,
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
        assetCue: null,
        transitionDialogue: [],
        hotspots: [
          {
            id: "hc",
            label: "hc",
            description: "c",
            status: "unlocked",
            unlock: null,
            reveals: [],
            evidenceSource: null,
            sceneSourcePrompt: null,
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
    const reachErr = errors.find(
      (e) =>
        e.code === "lockedBlockUnreachable" && e.message.includes("room_b"),
    );
    expect(reachErr).toBeDefined();
    const reachErr2 = errors.find(
      (e) =>
        e.code === "lockedBlockUnreachable" && e.message.includes("room_c"),
    );
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
        evidenceSource: null,
        sceneSourcePrompt: null,
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
      assetCue: null,
      transitionDialogue: [],
      hotspots: [
        {
          id: "h2",
          label: "h2",
          description: "h2",
          status: "locked",
          unlock: { predicate: "hotspot_investigated", id: "h1" },
          reveals: [],
          evidenceSource: null,
          sceneSourcePrompt: null,
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
      {
        id: "ev1",
        name: "ev1",
        description: "d",
        details: "x",
        imageCue: { imagePrompt: null, imageAssetId: null },
        sourceSublocationId: "room_b",
        onCollect: [],
        onReexamine: null,
        sourceFile: "i.md",
        line: 20,
      },
    ];
    scene.sublocations[0]!.hotspots = [
      {
        id: "h1",
        label: "h1",
        description: "h1",
        status: "unlocked",
        unlock: null,
        reveals: [],
        evidenceSource: null,
        sceneSourcePrompt: null,
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
        evidenceSource: null,
        sceneSourcePrompt: null,
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
    const reachErr = errors.find(
      (e) => e.code === "lockedBlockUnreachable" && e.message.includes("h2"),
    );
    expect(reachErr).toBeDefined();
  });

  it("accepts a locked block whose evidence_collected predicate references evidence revealed by a reachable block", () => {
    const scene = mkInvestigationScene({ id: "i" });
    scene.evidenceManifest = [
      {
        id: "ev1",
        name: "ev1",
        description: "d",
        details: "x",
        imageCue: { imagePrompt: null, imageAssetId: null },
        sourceSublocationId: "room",
        onCollect: [],
        onReexamine: null,
        sourceFile: "i.md",
        line: 20,
      },
    ];
    scene.sublocations[0]!.hotspots = [
      {
        id: "h1",
        label: "h1",
        description: "h1",
        status: "unlocked",
        unlock: null,
        reveals: [{ kind: "evidence", id: "ev1" }],
        evidenceSource: null,
        sceneSourcePrompt: null,
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
        evidenceSource: null,
        sceneSourcePrompt: null,
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
      {
        id: "st1",
        speaker: "X",
        content: "s",
        onAcquire: [],
        onReexamine: null,
        sourceFile: "i.md",
        line: 30,
      },
    ];
    scene.sublocations[0]!.hotspots = [
      {
        id: "h1",
        label: "h1",
        description: "h1",
        status: "unlocked",
        unlock: null,
        reveals: [],
        evidenceSource: null,
        sceneSourcePrompt: null,
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
        evidenceSource: null,
        sceneSourcePrompt: null,
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
        evidenceSource: null,
        sceneSourcePrompt: null,
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
    const reachErr = errors.find(
      (e) => e.code === "lockedBlockUnreachable" && e.message.includes("h2"),
    );
    expect(reachErr).toBeDefined();
  });

  it("rejects a locked sub-location whose evidence_collected unlock references evidence not revealed by any reachable sub-location", () => {
    const scene = mkInvestigationScene({ id: "i" });
    scene.evidenceManifest = [
      {
        id: "ev1",
        name: "ev1",
        description: "d",
        details: "x",
        imageCue: { imagePrompt: null, imageAssetId: null },
        sourceSublocationId: "room",
        onCollect: [],
        onReexamine: null,
        sourceFile: "i.md",
        line: 20,
      },
    ];
    scene.sublocations = [
      {
        id: "room_a",
        label: "Room A",
        status: "unlocked",
        unlock: null,
        reveals: [],
        sceneTag: "room a",
        assetCue: null,
        transitionDialogue: [],
        hotspots: [
          {
            id: "h1",
            label: "h1",
            description: "h1",
            status: "unlocked",
            unlock: null,
            reveals: [],
            evidenceSource: null,
            sceneSourcePrompt: null,
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
        assetCue: null,
        transitionDialogue: [],
        hotspots: [
          {
            id: "h2",
            label: "h2",
            description: "h2",
            status: "unlocked",
            unlock: null,
            reveals: [{ kind: "evidence", id: "ev1" }],
            evidenceSource: null,
            sceneSourcePrompt: null,
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
    const reachErr = errors.find(
      (e) =>
        e.code === "lockedBlockUnreachable" && e.message.includes("room_b"),
    );
    expect(reachErr).toBeDefined();
  });

  // ---- P1: cross-sublocation reveals in internal reachability ----

  it("accepts a locked topic whose evidence_collected predicate references evidence revealed by an unlocked hotspot in another sub-location", () => {
    const scene = mkInvestigationScene({ id: "i" });
    scene.evidenceManifest = [
      {
        id: "ev1",
        name: "ev1",
        description: "d",
        details: "x",
        imageCue: { imagePrompt: null, imageAssetId: null },
        sourceSublocationId: "room",
        onCollect: [],
        onReexamine: null,
        sourceFile: "i.md",
        line: 20,
      },
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
        evidenceSource: null,
        sceneSourcePrompt: null,
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
            topicDialogue: [
              { kind: "line", speaker: "NPC1", text: "unlocked" },
            ],
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
      assetCue: null,
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
              topicDialogue: [
                { kind: "line", speaker: "NPC2", text: "unlocked" },
              ],
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
      {
        id: "st1",
        speaker: "X",
        content: "s",
        onAcquire: [],
        onReexamine: null,
        sourceFile: "i.md",
        line: 30,
      },
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
        evidenceSource: null,
        sceneSourcePrompt: null,
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
      assetCue: null,
      transitionDialogue: [],
      hotspots: [
        {
          id: "h2",
          label: "h2",
          description: "h2",
          status: "locked",
          unlock: { predicate: "statement_acquired", id: "st1" },
          reveals: [],
          evidenceSource: null,
          sceneSourcePrompt: null,
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
      {
        id: "ev_entry",
        name: "ev_entry",
        description: "d",
        details: "x",
        imageCue: { imagePrompt: null, imageAssetId: null },
        sourceSublocationId: "room",
        onCollect: [],
        onReexamine: null,
        sourceFile: "i.md",
        line: 30,
      },
    ];
    scene.sublocations[0]!.reveals = [{ kind: "evidence", id: "ev_entry" }];
    scene.sublocations.push({
      id: "room_b",
      label: "Room B",
      status: "unlocked",
      unlock: null,
      reveals: [],
      sceneTag: "room b",
      assetCue: null,
      transitionDialogue: [],
      hotspots: [
        {
          id: "h2",
          label: "h2",
          description: "h2",
          status: "locked",
          unlock: { predicate: "evidence_collected", id: "ev_entry" },
          reveals: [],
          evidenceSource: null,
          sceneSourcePrompt: null,
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
      {
        id: "ev_chain",
        name: "ev_chain",
        description: "d",
        details: "x",
        imageCue: { imagePrompt: null, imageAssetId: null },
        sourceSublocationId: "room_b",
        onCollect: [],
        onReexamine: null,
        sourceFile: "i.md",
        line: 30,
      },
    ];
    scene.sublocations = [
      {
        id: "room_a",
        label: "Room A",
        status: "unlocked",
        unlock: null,
        reveals: [],
        sceneTag: "room a",
        assetCue: null,
        transitionDialogue: [],
        hotspots: [
          {
            id: "a1",
            label: "a1",
            description: "a1",
            status: "locked",
            unlock: { predicate: "evidence_collected", id: "ev_chain" },
            reveals: [],
            evidenceSource: null,
            sceneSourcePrompt: null,
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
        assetCue: null,
        transitionDialogue: [],
        hotspots: [
          {
            id: "b1",
            label: "b1",
            description: "b1",
            status: "unlocked",
            unlock: null,
            reveals: [{ kind: "hotspot", id: "b2" }],
            evidenceSource: null,
            sceneSourcePrompt: null,
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
            evidenceSource: null,
            sceneSourcePrompt: null,
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
        assetCue: null,
        transitionDialogue: [],
        hotspots: [
          {
            id: "hidden",
            label: "hidden",
            description: "hidden",
            status: "locked",
            unlock: null,
            reveals: [],
            evidenceSource: null,
            sceneSourcePrompt: null,
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
        assetCue: null,
        transitionDialogue: [],
        hotspots: [
          {
            id: "revealer",
            label: "revealer",
            description: "revealer",
            status: "unlocked",
            unlock: null,
            reveals: [{ kind: "hotspot", id: "hidden" }],
            evidenceSource: null,
            sceneSourcePrompt: null,
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
    const reachErr = errors.find(
      (e) =>
        e.code === "lockedBlockUnreachable" && e.message.includes("room_b"),
    );
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
      assetCue: null,
      transitionDialogue: [],
      hotspots: [
        {
          id: "thing", // duplicate of the hotspot in room
          label: "thing",
          description: "duplicate",
          status: "unlocked",
          unlock: null,
          reveals: [],
          evidenceSource: null,
          sceneSourcePrompt: null,
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
    const dup = errors.find(
      (e) => e.code === "duplicateSceneLocalId" && e.message.includes("thing"),
    );
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
      assetCue: null,
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
    const dup = errors.find(
      (e) =>
        e.code === "duplicateSceneLocalId" &&
        e.message.includes("sub-location") &&
        e.message.includes("room"),
    );
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
    const dup = errors.find(
      (e) =>
        e.code === "duplicateSceneLocalId" &&
        e.message.includes("character") &&
        e.message.includes("npc"),
    );
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
        topics: [
          {
            id: "alibi",
            label: "Alibi",
            status: "unlocked" as const,
            unlock: null,
            reveals: [],
            topicDialogue: [],
            onReexamine: null,
            sourceFile: "i.md",
            line: 10,
          },
        ],
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
      assetCue: null,
      transitionDialogue: [],
      hotspots: [],
      characters: [
        {
          id: "npc", // same character id, different sub-location — allowed
          name: "NPC Again",
          role: "suspect",
          bio: "bio",
          topics: [
            {
              id: "motive",
              label: "Motive",
              status: "unlocked" as const,
              unlock: null,
              reveals: [],
              topicDialogue: [],
              onReexamine: null,
              sourceFile: "i.md",
              line: 25,
            },
          ],
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
    const dup = errors.find(
      (e) =>
        e.code === "duplicateSceneLocalId" && e.message.includes("character"),
    );
    expect(dup).toBeUndefined();
  });

  // ---- P2: cycle detection across sub-location boundary via locked-block reveals ----

  it("rejects a cycle where a locked hotspot reveals evidence needed to unlock the sub-location containing its own unlock condition", () => {
    // Sub A (unlocked, entry): locked hotspot H1 reveals evidence:key, unlock: hotspot_investigated:H2
    // Sub B (locked, unlock: evidence_collected:key): unlocked hotspot H2
    // Cycle: to get evidence:key need H1, H1 needs H2 (in B), B needs evidence:key.
    const scene = mkInvestigationScene({ id: "i" });
    scene.evidenceManifest = [
      {
        id: "key",
        name: "key",
        description: "d",
        details: "x",
        imageCue: { imagePrompt: null, imageAssetId: null },
        sourceSublocationId: "room_a",
        onCollect: [],
        onReexamine: null,
        sourceFile: "i.md",
        line: 30,
      },
    ];
    scene.sublocations = [
      {
        id: "room_a",
        label: "Room A",
        status: "unlocked",
        unlock: null,
        reveals: [],
        sceneTag: "room a",
        assetCue: null,
        transitionDialogue: [],
        hotspots: [
          {
            id: "h1",
            label: "h1",
            description: "locked hotspot in entry",
            status: "locked",
            unlock: { predicate: "hotspot_investigated", id: "h2" },
            reveals: [{ kind: "evidence", id: "key" }],
            evidenceSource: null,
            sceneSourcePrompt: null,
            inspectDialogue: [
              { kind: "line", speaker: "A", text: "found key" },
            ],
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
        assetCue: null,
        transitionDialogue: [],
        hotspots: [
          {
            id: "h2",
            label: "h2",
            description: "unlocked hotspot in gated sub-location",
            status: "unlocked",
            unlock: null,
            reveals: [],
            evidenceSource: null,
            sceneSourcePrompt: null,
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
    const reachErr = errors.find(
      (e) =>
        e.code === "lockedBlockUnreachable" && e.message.includes("room_b"),
    );
    expect(reachErr).toBeDefined();
  });

  // ---- Outro predicate reachability ----

  it("rejects an Outro whose evidence_collected predicate references evidence never revealed by any reachable block", () => {
    const scene = mkInvestigationScene({ id: "i" });
    scene.evidenceManifest = [
      {
        id: "phantom",
        name: "Phantom",
        description: "d",
        details: "x",
        imageCue: { imagePrompt: null, imageAssetId: null },
        sourceSublocationId: "room",
        onCollect: [],
        onReexamine: null,
        sourceFile: "i.md",
        line: 20,
      },
    ];
    scene.sublocations[0]!.hotspots = [
      {
        id: "h1",
        label: "h1",
        description: "h1",
        status: "unlocked",
        unlock: null,
        reveals: [], // does NOT reveal evidence:phantom
        evidenceSource: null,
        sceneSourcePrompt: null,
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
    const outroErr = errors.find(
      (e) =>
        e.code === "outroPredicateUnreachable" && e.message.includes("phantom"),
    );
    expect(outroErr).toBeDefined();
  });

  it("rejects an Outro whose statement_acquired predicate references a statement never revealed by any reachable block", () => {
    const scene = mkInvestigationScene({ id: "i" });
    scene.statementManifest = [
      {
        id: "ghost_stmt",
        speaker: "X",
        content: "s",
        onAcquire: [],
        onReexamine: null,
        sourceFile: "i.md",
        line: 30,
      },
    ];
    scene.outro = {
      unlock: { predicate: "statement_acquired", id: "ghost_stmt" },
      dialogue: [],
    };
    const errors = validate({
      chapters: [mkChapter(1, ["i.md"])],
      scenes: [{ chapterId: "chapter_1", file: "i.md", ast: scene }],
    });
    const outroErr = errors.find(
      (e) =>
        e.code === "outroPredicateUnreachable" &&
        e.message.includes("ghost_stmt"),
    );
    expect(outroErr).toBeDefined();
  });

  it("accepts an Outro whose evidence_collected predicate references evidence revealed by a reachable block", () => {
    const scene = mkInvestigationScene({ id: "i" });
    scene.evidenceManifest = [
      {
        id: "real_ev",
        name: "Real",
        description: "d",
        details: "x",
        imageCue: { imagePrompt: null, imageAssetId: null },
        sourceSublocationId: "room",
        onCollect: [],
        onReexamine: null,
        sourceFile: "i.md",
        line: 20,
      },
    ];
    scene.sublocations[0]!.hotspots = [
      {
        id: "h1",
        label: "h1",
        description: "h1",
        status: "unlocked",
        unlock: null,
        reveals: [{ kind: "evidence", id: "real_ev" }],
        evidenceSource: null,
        sceneSourcePrompt: null,
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
      {
        id: "real_ev",
        name: "Real",
        description: "d",
        details: "x",
        imageCue: { imagePrompt: null, imageAssetId: null },
        sourceSublocationId: "room",
        onCollect: [],
        onReexamine: null,
        sourceFile: "i.md",
        line: 20,
      },
      {
        id: "red_herring",
        name: "Red Herring",
        description: "d",
        details: "x",
        imageCue: { imagePrompt: null, imageAssetId: null },
        sourceSublocationId: "room",
        onCollect: [],
        onReexamine: null,
        sourceFile: "i.md",
        line: 21,
      },
    ];
    scene.sublocations[0]!.hotspots = [
      {
        id: "h1",
        label: "h1",
        description: "h1",
        status: "unlocked",
        unlock: null,
        reveals: [{ kind: "evidence", id: "real_ev" }],
        evidenceSource: null,
        sceneSourcePrompt: null,
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
    expect(
      errors.find((e) => e.code === "outroPredicateUnreachable"),
    ).toBeUndefined();
  });

  it("rejects an Outro AND expression when one branch is unreachable", () => {
    const scene = mkInvestigationScene({ id: "i" });
    scene.evidenceManifest = [
      {
        id: "real_ev",
        name: "Real",
        description: "d",
        details: "x",
        imageCue: { imagePrompt: null, imageAssetId: null },
        sourceSublocationId: "room",
        onCollect: [],
        onReexamine: null,
        sourceFile: "i.md",
        line: 20,
      },
      {
        id: "red_herring",
        name: "Red Herring",
        description: "d",
        details: "x",
        imageCue: { imagePrompt: null, imageAssetId: null },
        sourceSublocationId: "room",
        onCollect: [],
        onReexamine: null,
        sourceFile: "i.md",
        line: 21,
      },
    ];
    scene.sublocations[0]!.hotspots = [
      {
        id: "h1",
        label: "h1",
        description: "h1",
        status: "unlocked",
        unlock: null,
        reveals: [{ kind: "evidence", id: "real_ev" }],
        evidenceSource: null,
        sceneSourcePrompt: null,
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
    const outroErr = errors.find(
      (e) =>
        e.code === "outroPredicateUnreachable" &&
        e.message.includes("red_herring"),
    );
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
        assetCue: null,
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
        assetCue: null,
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
      unlock: {
        predicate: "topic_discussed",
        characterId: "npc",
        topicId: "secret",
      },
      dialogue: [],
    };
    const errors = validate({
      chapters: [mkChapter(1, ["i.md"])],
      scenes: [{ chapterId: "chapter_1", file: "i.md", ast: scene }],
    });
    const outroErr = errors.find(
      (e) =>
        e.code === "outroPredicateUnreachable" &&
        e.message.includes("npc@secret"),
    );
    expect(outroErr).toBeDefined();
  });

  // ===========================================================================
  // Interrogation scenes (unified inquiry / testimony-line model).
  //
  // A Phase holds Questions; each Question owns a Testimony of Lines. A Line
  // with a Contradiction is a breakthrough point: presenting the correct
  // evidence fires On Correct and applies the line's Reveals (which may unlock
  // follow-up questions). A question is "answered/broken" only via such a
  // breakthrough; a phase auto-completes when every Required question is broken.
  // The guarantee analysis proves each required phase has a guaranteed
  // breakthrough and tracks which reveals propagate into guaranteed inventory.
  // ===========================================================================

  // An investigation scene with an auto outro whose single unlocked hotspot
  // reveals `evidenceId`. Auto-outro requires inspecting every reachable
  // hotspot, so `evidenceId` is guaranteed in inventory for later scenes.
  const mkGuaranteeingInvestigation = (
    evidenceId: string,
  ): { file: string; ast: ASTInvestigationScene } => {
    const ast = mkInvestigationScene({ id: "investigation_scene_0" });
    ast.sourceFile = "investigation_scene_0.md";
    ast.sublocations[0]!.hotspots[0]!.reveals = [
      { kind: "evidence", id: evidenceId },
    ];
    ast.evidenceManifest = [mkEvidence(evidenceId, "room")];
    return { file: "investigation_scene_0.md", ast };
  };

  // A prior interrogation scene (id/sourceFile fixed to _0) used to establish
  // cross-scene guaranteed inventory.
  const mkPriorInterrogation = (
    overrides: Partial<ASTInterrogationScene>,
  ): { file: string; ast: ASTInterrogationScene } => ({
    file: "interrogation_scene_0.md",
    ast: mkInterrogationScene({
      id: "interrogation_scene_0",
      sourceFile: "interrogation_scene_0.md",
      ...overrides,
    }),
  });

  // ---- ID uniqueness ----

  it("rejects a reserved phase id (inventory)", () => {
    const scene = mkInterrogationScene({
      phases: [mkInquiryPhase({ id: "inventory" })],
    });
    const errors = validateInterrogation(scene);
    expect(
      errors.find((e) => e.code === "interrogationPhaseReservedId"),
    ).toBeDefined();
  });

  it("rejects a duplicate phase id within an interrogation scene", () => {
    const scene = mkInterrogationScene({
      phases: [mkInquiryPhase({ id: "dup" }), mkInquiryPhase({ id: "dup" })],
    });
    const errors = validateInterrogation(scene);
    expect(
      errors.find((e) => e.code === "duplicateInterrogationId"),
    ).toBeDefined();
  });

  it("rejects a duplicate question id across phases", () => {
    const scene = mkInterrogationScene({
      phases: [
        mkInquiryPhase({ id: "p1", questions: [mkQuestion({ id: "q" })] }),
        mkInquiryPhase({ id: "p2", questions: [mkQuestion({ id: "q" })] }),
      ],
    });
    const errors = validateInterrogation(scene);
    expect(
      errors.find(
        (e) =>
          e.code === "duplicateInterrogationId" &&
          e.message.includes("question"),
      ),
    ).toBeDefined();
  });

  it("rejects a duplicate testimony line id", () => {
    const scene = mkInterrogationScene({
      phases: [
        mkInquiryPhase({
          id: "p",
          questions: [
            mkQuestion({
              id: "q",
              testimony: mkTestimony([
                mkLine({ id: "l" }),
                mkLine({ id: "l" }),
              ]),
            }),
          ],
        }),
      ],
    });
    const errors = validateInterrogation(scene);
    expect(
      errors.find(
        (e) =>
          e.code === "duplicateInterrogationId" &&
          e.message.includes("testimony line"),
      ),
    ).toBeDefined();
  });

  // ---- Reveal / unlock target resolution ----

  it("rejects a testimony line whose On Correct reveals an undeclared evidence id", () => {
    const scene = mkInterrogationScene({
      phases: [
        mkInquiryPhase({
          id: "p",
          reveals: [{ kind: "evidence", id: "seed" }],
          questions: [
            mkQuestion({
              id: "q",
              testimony: mkTestimony([
                mkContradictionLine("l", { kind: "evidence", id: "seed" }, [
                  { kind: "evidence", id: "ghost" },
                ]),
              ]),
            }),
          ],
        }),
      ],
      evidenceManifest: [mkEvidence("seed")],
    });
    const errors = validateInterrogation(scene);
    expect(
      errors.find((e) => e.code === "interrogationRevealUnresolved"),
    ).toBeDefined();
  });

  it("rejects a question reveals targeting an undeclared question id", () => {
    const scene = mkInterrogationScene({
      phases: [
        mkInquiryPhase({
          id: "p",
          questions: [
            mkQuestion({
              id: "q",
              reveals: [{ kind: "question", id: "ghost" }],
            }),
          ],
        }),
      ],
    });
    const errors = validateInterrogation(scene);
    expect(
      errors.find((e) => e.code === "interrogationRevealUnresolved"),
    ).toBeDefined();
  });

  it("rejects an unlock predicate referencing an undeclared question", () => {
    const scene = mkInterrogationScene({
      phases: [
        mkInquiryPhase({
          id: "p",
          questions: [
            mkQuestion({
              id: "q",
              status: "locked",
              unlock: { predicate: "question_answered", id: "ghost" },
            }),
          ],
        }),
      ],
    });
    const errors = validateInterrogation(scene);
    expect(
      errors.find((e) => e.code === "interrogationUnlockUnresolved"),
    ).toBeDefined();
  });

  // ---- Reachability of locked questions ----

  it("rejects a locked question with no inbound reveals and no unlock", () => {
    const scene = mkInterrogationScene({
      phases: [
        mkInquiryPhase({
          id: "p",
          questions: [
            mkQuestion({ id: "reachable" }),
            mkQuestion({ id: "orphan", status: "locked" }),
          ],
        }),
      ],
    });
    const errors = validateInterrogation(scene);
    expect(
      errors.find(
        (e) =>
          e.code === "interrogationLockedBlockUnreachable" &&
          e.message.includes("orphan"),
      ),
    ).toBeDefined();
  });

  it("rejects a locked question with BOTH an inbound reveal and a self unlock", () => {
    const scene = mkInterrogationScene({
      phases: [
        mkInquiryPhase({
          id: "p",
          reveals: [{ kind: "evidence", id: "seed" }],
          questions: [
            mkQuestion({
              id: "parent",
              testimony: mkTestimony([
                mkContradictionLine("l", { kind: "evidence", id: "seed" }, [
                  { kind: "question", id: "child" },
                ]),
              ]),
            }),
            mkQuestion({
              id: "child",
              status: "locked",
              unlock: { predicate: "question_answered", id: "parent" },
            }),
          ],
        }),
      ],
      evidenceManifest: [mkEvidence("seed")],
    });
    const errors = validateInterrogation(scene);
    expect(
      errors.find(
        (e) =>
          e.code === "interrogationRevealsAndUnlockBoth" &&
          e.message.includes("child"),
      ),
    ).toBeDefined();
  });

  it("accepts a locked follow-up question unlocked through a breakthrough reveal chain", () => {
    const scene = mkInterrogationScene({
      phases: [
        mkInquiryPhase({
          id: "p",
          reveals: [{ kind: "evidence", id: "seed" }],
          questions: [
            mkQuestion({
              id: "parent",
              testimony: mkTestimony([
                mkContradictionLine("l", { kind: "evidence", id: "seed" }, [
                  { kind: "question", id: "child" },
                ]),
              ]),
            }),
            mkQuestion({ id: "child", required: false, status: "locked" }),
          ],
        }),
      ],
      evidenceManifest: [mkEvidence("seed")],
    });
    expect(validateInterrogation(scene)).toEqual([]);
  });

  // ---- Contradiction target resolution ----

  it("rejects a contradiction targeting an unknown evidence id", () => {
    const scene = mkInterrogationScene({
      phases: [
        mkInquiryPhase({
          id: "p",
          questions: [
            mkQuestion({
              id: "q",
              testimony: mkTestimony([
                mkContradictionLine("l", { kind: "evidence", id: "phantom" }),
              ]),
            }),
          ],
        }),
      ],
    });
    const errors = validateInterrogation(scene);
    expect(
      errors.find((e) => e.code === "interrogationContradictionUnresolved"),
    ).toBeDefined();
  });

  it("rejects a local contradiction whose target is never obtainable", () => {
    const scene = mkInterrogationScene({
      phases: [
        mkInquiryPhase({
          id: "p",
          questions: [
            mkQuestion({
              id: "q",
              testimony: mkTestimony([
                mkContradictionLine("l", {
                  kind: "evidence",
                  id: "unrevealed",
                }),
              ]),
            }),
          ],
        }),
      ],
      evidenceManifest: [mkEvidence("unrevealed")],
    });
    const errors = validateInterrogation(scene);
    expect(
      errors.find((e) => e.code === "interrogationContradictionUnresolved"),
    ).toBeDefined();
  });

  it("rejects a cross-scene contradiction evidence that is not guaranteed", () => {
    const prior = mkGuaranteeingInvestigation("guaranteed_ev");
    // The interrogation targets an evidence declared only in the investigation
    // but NOT guaranteed by it (explicit outro that does not require it).
    prior.ast.evidenceManifest = [
      mkEvidence("guaranteed_ev", "room"),
      mkEvidence("bonus_ev", "room"),
    ];
    prior.ast.sublocations[0]!.hotspots[0]!.reveals = [
      { kind: "evidence", id: "guaranteed_ev" },
    ];
    // A locked second hotspot reveals bonus_ev; with an explicit outro that
    // only needs guaranteed_ev, bonus_ev is obtainable but not guaranteed.
    prior.ast.sublocations[0]!.hotspots.push({
      id: "extra",
      label: "extra",
      description: "d",
      status: "locked",
      unlock: { predicate: "hotspot_investigated", id: "thing" },
      reveals: [{ kind: "evidence", id: "bonus_ev" }],
      evidenceSource: null,
      sceneSourcePrompt: null,
      inspectDialogue: [],
      onReexamine: null,
      sourceFile: "investigation_scene_0.md",
      line: 9,
    });
    prior.ast.outro = {
      unlock: { predicate: "evidence_collected", id: "guaranteed_ev" },
      dialogue: [],
    };
    const scene = mkInterrogationScene({
      phases: [
        mkInquiryPhase({
          id: "p",
          questions: [
            mkQuestion({
              id: "q",
              testimony: mkTestimony([
                mkContradictionLine("l", { kind: "evidence", id: "bonus_ev" }),
              ]),
            }),
          ],
        }),
      ],
    });
    const errors = validateInterrogation(scene, [prior]);
    expect(
      errors.find(
        (e) =>
          e.code === "crossSceneInventoryNotGuaranteed" &&
          e.message.includes("bonus_ev"),
      ),
    ).toBeDefined();
  });

  // ---- Contradiction on an invisible (tag-only) line ----

  it("rejects a contradiction on a line whose content is only scene tags", () => {
    // The runtime testimony skipper (advance_playing_testimony) never
    // displays a line whose content is entirely SceneTag items — it applies
    // the cues and advances. Such a line can never be challenged, so a
    // required question whose only contradiction sits on it is permanently
    // unbreakable (begin_question sees the contradiction and refuses to
    // auto-break). The target here is valid and guaranteed, and On Correct
    // is non-empty, so the ONLY reason for rejection is the tag-only
    // content — proving the check fires independently of target resolution.
    const scene = mkInterrogationScene({
      phases: [
        mkInquiryPhase({
          id: "p",
          required: true,
          questions: [
            mkQuestion({
              id: "q",
              required: true,
              testimony: mkTestimony([
                mkContradictionLine("l", {
                  kind: "evidence",
                  id: "prior_ev",
                }),
              ]),
            }),
          ],
        }),
      ],
    });
    // Replace the contradiction line's visible content with scene tags only.
    scene.phases[0]!.questions[0]!.testimony.lines[0]!.content = [
      { kind: "sceneTag", text: "[場景：暗房]" },
    ];
    const errors = validateInterrogation(scene, [
      mkGuaranteeingInvestigation("prior_ev"),
    ]);
    expect(
      errors.find(
        (e) => e.code === "interrogationContradictionOnInvisibleLine",
      ),
    ).toBeDefined();
  });

  it("accepts a contradiction on a line whose content has visible dialogue", () => {
    // Sanity check: the new check does not false-positive on a normal
    // contradiction line that mixes a scene tag with suspect dialogue.
    const scene = mkInterrogationScene({
      phases: [
        mkInquiryPhase({
          id: "p",
          required: true,
          questions: [
            mkQuestion({
              id: "q",
              required: true,
              testimony: mkTestimony([
                mkContradictionLine("l", {
                  kind: "evidence",
                  id: "prior_ev",
                }),
              ]),
            }),
          ],
        }),
      ],
    });
    scene.phases[0]!.questions[0]!.testimony.lines[0]!.content = [
      { kind: "sceneTag", text: "[場景：暗房]" },
      line("我那天沒去。"),
    ];
    const errors = validateInterrogation(scene, [
      mkGuaranteeingInvestigation("prior_ev"),
    ]);
    expect(
      errors.find(
        (e) => e.code === "interrogationContradictionOnInvisibleLine",
      ),
    ).toBeUndefined();
  });

  // ---- The contradiction guarantee (core) ----

  it("accepts a contradiction satisfied by guaranteed prior-scene evidence", () => {
    const scene = mkInterrogationScene({
      phases: [
        mkInquiryPhase({
          id: "p",
          required: true,
          questions: [
            mkQuestion({
              id: "q",
              required: true,
              testimony: mkTestimony([
                mkContradictionLine("l", { kind: "evidence", id: "prior_ev" }),
              ]),
            }),
          ],
        }),
      ],
    });
    const errors = validateInterrogation(scene, [
      mkGuaranteeingInvestigation("prior_ev"),
    ]);
    expect(errors).toEqual([]);
  });

  it("accepts a required question broken by evidence revealed on phase entry", () => {
    const scene = mkInterrogationScene({
      phases: [
        mkInquiryPhase({
          id: "p",
          required: true,
          reveals: [{ kind: "evidence", id: "entry_ev" }],
          questions: [
            mkQuestion({
              id: "q",
              required: true,
              testimony: mkTestimony([
                mkContradictionLine("l", { kind: "evidence", id: "entry_ev" }),
              ]),
            }),
          ],
        }),
      ],
      evidenceManifest: [mkEvidence("entry_ev")],
    });
    expect(validateInterrogation(scene)).toEqual([]);
  });

  it("accepts a required follow-up unlocked and broken through a required parent's breakthrough", () => {
    const scene = mkInterrogationScene({
      phases: [
        mkInquiryPhase({
          id: "p",
          required: true,
          reveals: [{ kind: "evidence", id: "seed" }],
          questions: [
            mkQuestion({
              id: "parent",
              required: true,
              testimony: mkTestimony([
                mkContradictionLine("l_p", { kind: "evidence", id: "seed" }, [
                  { kind: "question", id: "child" },
                  { kind: "evidence", id: "child_key" },
                ]),
              ]),
            }),
            mkQuestion({
              id: "child",
              required: true,
              status: "locked",
              testimony: mkTestimony([
                mkContradictionLine("l_c", {
                  kind: "evidence",
                  id: "child_key",
                }),
              ]),
            }),
          ],
        }),
      ],
      evidenceManifest: [mkEvidence("seed"), mkEvidence("child_key")],
    });
    expect(validateInterrogation(scene)).toEqual([]);
  });

  // A required honest question (no Contradiction line anywhere) auto-breaks
  // the instant it is asked at runtime (there is nothing to press), firing
  // only its question-level reveals. The guarantee analysis must treat such a
  // question as guaranteed-answered — otherwise a required auto-complete phase
  // whose only required question is honest would falsely fail
  // interrogationUnguaranteedContradiction. See design §5 / SKILL "Honest
  // questions play only their first Line."
  it("accepts a required honest question in an auto-complete phase (auto-break, no false unguaranteed error)", () => {
    const scene = mkInterrogationScene({
      phases: [
        mkInquiryPhase({
          id: "p",
          required: true,
          questions: [
            mkQuestion({
              id: "q_honest",
              required: true,
              reveals: [{ kind: "evidence", id: "honest_reveal" }],
              testimony: mkTestimony([mkLine({ id: "l_honest" })]),
            }),
          ],
        }),
      ],
      evidenceManifest: [mkEvidence("honest_reveal")],
    });
    const errors = validateInterrogation(scene);
    expect(
      errors.some((e) => e.code === "interrogationUnguaranteedContradiction"),
    ).toBe(false);
  });

  it("propagates a required honest question's question-level reveals into guaranteed inventory", () => {
    // The honest question auto-breaks and fires its question-level reveal
    // (evidence:honest_key). A downstream required question in a later phase
    // whose contradiction targets honest_key must therefore be guaranteed —
    // proving the honest auto-break's reveals flow through the guarantee pass.
    const scene = mkInterrogationScene({
      phases: [
        mkInquiryPhase({
          id: "p1",
          required: true,
          questions: [
            mkQuestion({
              id: "q_honest",
              required: true,
              reveals: [{ kind: "evidence", id: "honest_key" }],
              testimony: mkTestimony([mkLine({ id: "l_honest" })]),
            }),
          ],
        }),
        mkInquiryPhase({
          id: "p2",
          required: true,
          status: "locked",
          unlock: { predicate: "phase_completed", id: "p1" },
          questions: [
            mkQuestion({
              id: "q_follow",
              required: true,
              testimony: mkTestimony([
                mkContradictionLine("l_follow", {
                  kind: "evidence",
                  id: "honest_key",
                }),
              ]),
            }),
          ],
        }),
      ],
      evidenceManifest: [mkEvidence("honest_key")],
    });
    const errors = validateInterrogation(scene);
    expect(
      errors.some((e) => e.code === "interrogationUnguaranteedContradiction"),
    ).toBe(false);
  });

  it("rejects a required contradiction that is only satisfiable through an optional breakthrough (Beat-10)", () => {
    const scene = mkInterrogationScene({
      phases: [
        mkInquiryPhase({
          id: "p",
          required: true,
          reveals: [{ kind: "evidence", id: "seed" }],
          questions: [
            mkQuestion({
              id: "q_opt",
              required: false,
              testimony: mkTestimony([
                mkContradictionLine("l_opt", { kind: "evidence", id: "seed" }, [
                  { kind: "evidence", id: "payoff" },
                ]),
              ]),
            }),
            mkQuestion({
              id: "q_req",
              required: true,
              testimony: mkTestimony([
                mkContradictionLine("l_req", {
                  kind: "evidence",
                  id: "payoff",
                }),
              ]),
            }),
          ],
        }),
      ],
      evidenceManifest: [mkEvidence("seed"), mkEvidence("payoff")],
    });
    const errors = validateInterrogation(scene);
    expect(
      errors.some((e) => e.code === "interrogationUnguaranteedContradiction"),
    ).toBe(true);
    // The payoff IS obtainable (via the optional breakthrough), so this is a
    // pure guarantee failure — no "unresolved contradiction" noise.
    expect(
      errors.find((e) => e.code === "interrogationContradictionUnresolved"),
    ).toBeUndefined();
  });

  it("does not propagate an On Correct reveal that fires on only one of several breakthrough lines", () => {
    const prior = mkPriorInterrogation({
      phases: [
        mkInquiryPhase({
          id: "p0",
          required: true,
          reveals: [
            { kind: "evidence", id: "seed_a" },
            { kind: "evidence", id: "seed_b" },
          ],
          questions: [
            mkQuestion({
              id: "q0",
              required: true,
              testimony: mkTestimony([
                mkContradictionLine("la", { kind: "evidence", id: "seed_a" }, [
                  { kind: "evidence", id: "only_a" },
                ]),
                mkContradictionLine("lb", { kind: "evidence", id: "seed_b" }, [
                  { kind: "evidence", id: "only_b" },
                ]),
              ]),
            }),
          ],
        }),
      ],
      evidenceManifest: [
        mkEvidence("seed_a"),
        mkEvidence("seed_b"),
        mkEvidence("only_a"),
        mkEvidence("only_b"),
      ],
    });
    const scene = mkInterrogationScene({
      phases: [
        mkInquiryPhase({
          id: "p",
          questions: [
            mkQuestion({
              id: "q",
              testimony: mkTestimony([
                mkContradictionLine("l", { kind: "evidence", id: "only_a" }),
              ]),
            }),
          ],
        }),
      ],
    });
    const errors = validateInterrogation(scene, [prior]);
    expect(
      errors.find(
        (e) =>
          e.code === "crossSceneInventoryNotGuaranteed" &&
          e.message.includes("only_a"),
      ),
    ).toBeDefined();
  });

  it("propagates an On Correct reveal common to every breakthrough line", () => {
    const prior = mkPriorInterrogation({
      phases: [
        mkInquiryPhase({
          id: "p0",
          required: true,
          reveals: [
            { kind: "evidence", id: "seed_a" },
            { kind: "evidence", id: "seed_b" },
          ],
          questions: [
            mkQuestion({
              id: "q0",
              required: true,
              testimony: mkTestimony([
                mkContradictionLine("la", { kind: "evidence", id: "seed_a" }, [
                  { kind: "evidence", id: "shared" },
                ]),
                mkContradictionLine("lb", { kind: "evidence", id: "seed_b" }, [
                  { kind: "evidence", id: "shared" },
                ]),
              ]),
            }),
          ],
        }),
      ],
      evidenceManifest: [
        mkEvidence("seed_a"),
        mkEvidence("seed_b"),
        mkEvidence("shared"),
      ],
    });
    const scene = mkInterrogationScene({
      phases: [
        mkInquiryPhase({
          id: "p",
          questions: [
            mkQuestion({
              id: "q",
              testimony: mkTestimony([
                mkContradictionLine("l", { kind: "evidence", id: "shared" }),
              ]),
            }),
          ],
        }),
      ],
    });
    const errors = validateInterrogation(scene, [prior]);
    expect(
      errors.find((e) => e.code === "crossSceneInventoryNotGuaranteed"),
    ).toBeUndefined();
  });

  // ---- Cross-scene guaranteed inventory (question-level Beat-10) ----

  it("does not guarantee an optional question's breakthrough reveal for a later scene", () => {
    const prior = mkPriorInterrogation({
      phases: [
        mkInquiryPhase({
          id: "p0",
          required: true,
          reveals: [{ kind: "evidence", id: "seed" }],
          questions: [
            mkQuestion({
              id: "optional_q",
              required: false,
              testimony: mkTestimony([
                mkContradictionLine("l", { kind: "evidence", id: "seed" }, [
                  { kind: "evidence", id: "optional_ev" },
                ]),
              ]),
            }),
          ],
        }),
      ],
      evidenceManifest: [mkEvidence("seed"), mkEvidence("optional_ev")],
    });
    const scene = mkInterrogationScene({
      phases: [
        mkInquiryPhase({
          id: "p",
          questions: [
            mkQuestion({
              id: "q",
              testimony: mkTestimony([
                mkContradictionLine("l", {
                  kind: "evidence",
                  id: "optional_ev",
                }),
              ]),
            }),
          ],
        }),
      ],
    });
    const errors = validateInterrogation(scene, [prior]);
    expect(
      errors.find(
        (e) =>
          e.code === "crossSceneInventoryNotGuaranteed" &&
          e.message.includes("optional_ev"),
      ),
    ).toBeDefined();
  });

  it("guarantees a required question's breakthrough reveal for a later scene", () => {
    const prior = mkPriorInterrogation({
      phases: [
        mkInquiryPhase({
          id: "p0",
          required: true,
          reveals: [{ kind: "evidence", id: "seed" }],
          questions: [
            mkQuestion({
              id: "required_q",
              required: true,
              testimony: mkTestimony([
                mkContradictionLine("l", { kind: "evidence", id: "seed" }, [
                  { kind: "evidence", id: "required_ev" },
                ]),
              ]),
            }),
          ],
        }),
      ],
      evidenceManifest: [mkEvidence("seed"), mkEvidence("required_ev")],
    });
    const scene = mkInterrogationScene({
      phases: [
        mkInquiryPhase({
          id: "p",
          questions: [
            mkQuestion({
              id: "q",
              testimony: mkTestimony([
                mkContradictionLine("l", {
                  kind: "evidence",
                  id: "required_ev",
                }),
              ]),
            }),
          ],
        }),
      ],
    });
    const errors = validateInterrogation(scene, [prior]);
    expect(
      errors.find((e) => e.code === "crossSceneInventoryNotGuaranteed"),
    ).toBeUndefined();
  });

  it("does not guarantee a required question's reveal when explicit completion can skip it", () => {
    const prior = mkPriorInterrogation({
      phases: [
        mkInquiryPhase({
          id: "p0",
          required: true,
          reveals: [{ kind: "evidence", id: "seed" }],
          complete: { predicate: "question_answered", id: "gate" },
          questions: [
            mkQuestion({
              id: "gate",
              required: true,
              testimony: mkTestimony([
                mkContradictionLine("lg", { kind: "evidence", id: "seed" }),
              ]),
            }),
            mkQuestion({
              id: "skippable",
              required: true,
              testimony: mkTestimony([
                mkContradictionLine("ls", { kind: "evidence", id: "seed" }, [
                  { kind: "evidence", id: "skippable_ev" },
                ]),
              ]),
            }),
          ],
        }),
      ],
      evidenceManifest: [mkEvidence("seed"), mkEvidence("skippable_ev")],
    });
    const scene = mkInterrogationScene({
      phases: [
        mkInquiryPhase({
          id: "p",
          questions: [
            mkQuestion({
              id: "q",
              testimony: mkTestimony([
                mkContradictionLine("l", {
                  kind: "evidence",
                  id: "skippable_ev",
                }),
              ]),
            }),
          ],
        }),
      ],
    });
    const errors = validateInterrogation(scene, [prior]);
    expect(
      errors.find(
        (e) =>
          e.code === "crossSceneInventoryNotGuaranteed" &&
          e.message.includes("skippable_ev"),
      ),
    ).toBeDefined();
  });

  it("guarantees investigation auto-outro evidence for a later interrogation contradiction", () => {
    const scene = mkInterrogationScene({
      phases: [
        mkInquiryPhase({
          id: "p",
          required: true,
          questions: [
            mkQuestion({
              id: "q",
              required: true,
              testimony: mkTestimony([
                mkContradictionLine("l", { kind: "evidence", id: "auto_ev" }),
              ]),
            }),
          ],
        }),
      ],
    });
    const errors = validateInterrogation(scene, [
      mkGuaranteeingInvestigation("auto_ev"),
    ]);
    expect(
      errors.find((e) => e.code === "crossSceneInventoryNotGuaranteed"),
    ).toBeUndefined();
  });

  // ---- Outro predicate reachability ----

  it("rejects an interrogation outro requiring evidence never obtainable in the scene", () => {
    const scene = mkInterrogationScene({
      phases: [
        mkInquiryPhase({ id: "p", questions: [mkQuestion({ id: "q" })] }),
      ],
      evidenceManifest: [mkEvidence("phantom")],
      outro: {
        unlock: { predicate: "evidence_collected", id: "phantom" },
        dialogue: [],
      },
    });
    const errors = validateInterrogation(scene);
    expect(
      errors.find(
        (e) =>
          e.code === "interrogationOutroPredicateUnreachable" &&
          e.message.includes("phantom"),
      ),
    ).toBeDefined();
  });

  it("accepts an interrogation outro requiring evidence obtainable from a required breakthrough", () => {
    const scene = mkInterrogationScene({
      phases: [
        mkInquiryPhase({
          id: "p",
          required: true,
          reveals: [{ kind: "evidence", id: "seed" }],
          questions: [
            mkQuestion({
              id: "q",
              required: true,
              testimony: mkTestimony([
                mkContradictionLine("l", { kind: "evidence", id: "seed" }, [
                  { kind: "evidence", id: "key" },
                ]),
              ]),
            }),
          ],
        }),
      ],
      evidenceManifest: [mkEvidence("seed"), mkEvidence("key")],
      outro: {
        unlock: { predicate: "evidence_collected", id: "key" },
        dialogue: [],
      },
    });
    expect(validateInterrogation(scene)).toEqual([]);
  });

  it("rejects an interrogation outro whose phase_completed predicate references an incompletable phase", () => {
    const scene = mkInterrogationScene({
      phases: [
        mkInquiryPhase({
          id: "dead_end",
          required: false,
          questions: [
            mkQuestion({
              id: "q",
              required: true,
              testimony: mkTestimony([
                mkContradictionLine("l", { kind: "evidence", id: "missing" }),
              ]),
            }),
          ],
        }),
      ],
      evidenceManifest: [mkEvidence("missing")],
      outro: {
        unlock: { predicate: "phase_completed", id: "dead_end" },
        dialogue: [],
      },
    });
    const errors = validateInterrogation(scene);
    expect(
      errors.find(
        (e) =>
          e.code === "interrogationOutroPredicateUnreachable" &&
          e.message.includes("dead_end"),
      ),
    ).toBeDefined();
  });

  it("rejects an interrogation outro whose question_answered predicate references a never-answerable question", () => {
    const scene = mkInterrogationScene({
      phases: [
        mkInquiryPhase({
          id: "p",
          required: true,
          reveals: [{ kind: "evidence", id: "seed" }],
          questions: [
            mkQuestion({
              id: "answerable",
              required: true,
              testimony: mkTestimony([
                mkContradictionLine("l", { kind: "evidence", id: "seed" }),
              ]),
            }),
            mkQuestion({
              id: "dead_q",
              required: false,
              status: "locked",
              unlock: { predicate: "evidence_collected", id: "unobtainable" },
            }),
          ],
        }),
      ],
      evidenceManifest: [mkEvidence("seed"), mkEvidence("unobtainable")],
      outro: {
        unlock: { predicate: "question_answered", id: "dead_q" },
        dialogue: [],
      },
    });
    const errors = validateInterrogation(scene);
    expect(
      errors.find(
        (e) =>
          e.code === "interrogationOutroPredicateUnreachable" &&
          e.message.includes("dead_q"),
      ),
    ).toBeDefined();
  });

  it("rejects an interrogation outro AND expression when one branch is unobtainable", () => {
    const scene = mkInterrogationScene({
      phases: [
        mkInquiryPhase({
          id: "p",
          required: true,
          reveals: [{ kind: "evidence", id: "seed" }],
          questions: [
            mkQuestion({
              id: "q",
              required: true,
              testimony: mkTestimony([
                mkContradictionLine("l", { kind: "evidence", id: "seed" }, [
                  { kind: "evidence", id: "real_ev" },
                ]),
              ]),
            }),
          ],
        }),
      ],
      evidenceManifest: [
        mkEvidence("seed"),
        mkEvidence("real_ev"),
        mkEvidence("phantom"),
      ],
      outro: {
        unlock: {
          op: "and",
          left: { predicate: "evidence_collected", id: "real_ev" },
          right: { predicate: "evidence_collected", id: "phantom" },
        },
        dialogue: [],
      },
    });
    const errors = validateInterrogation(scene);
    expect(
      errors.find(
        (e) =>
          e.code === "interrogationOutroPredicateUnreachable" &&
          e.message.includes("phantom"),
      ),
    ).toBeDefined();
  });

  // ---- Forced optional phases + phase ordering ----

  it("accepts an outro requiring evidence from a forced optional phase", () => {
    // The only phase is optional but its breakthrough reveal is what the outro
    // requires, so every winning playthrough must complete it — it is forced
    // and its evidence counts as guaranteed.
    const scene = mkInterrogationScene({
      phases: [
        mkInquiryPhase({
          id: "forced",
          required: false,
          reveals: [{ kind: "evidence", id: "seed" }],
          questions: [
            mkQuestion({
              id: "q",
              required: true,
              testimony: mkTestimony([
                mkContradictionLine("l", { kind: "evidence", id: "seed" }, [
                  { kind: "evidence", id: "clue" },
                ]),
              ]),
            }),
          ],
        }),
      ],
      evidenceManifest: [mkEvidence("seed"), mkEvidence("clue")],
      outro: {
        unlock: { predicate: "evidence_collected", id: "clue" },
        dialogue: [],
      },
    });
    expect(validateInterrogation(scene)).toEqual([]);
  });

  it("accepts a locked required phase unlocked by an earlier optional phase's breakthrough", () => {
    const scene = mkInterrogationScene({
      phases: [
        mkInquiryPhase({
          id: "optional_setup",
          required: false,
          reveals: [{ kind: "evidence", id: "seed" }],
          questions: [
            mkQuestion({
              id: "opt_q",
              required: true,
              testimony: mkTestimony([
                mkContradictionLine("l", { kind: "evidence", id: "seed" }, [
                  { kind: "evidence", id: "unlock_key" },
                ]),
              ]),
            }),
          ],
        }),
        mkInquiryPhase({
          id: "locked_required",
          required: true,
          status: "locked",
          unlock: { predicate: "evidence_collected", id: "unlock_key" },
          reveals: [{ kind: "evidence", id: "final_seed" }],
          questions: [
            mkQuestion({
              id: "locked_q",
              required: true,
              testimony: mkTestimony([
                mkContradictionLine("l2", {
                  kind: "evidence",
                  id: "final_seed",
                }),
              ]),
            }),
          ],
        }),
      ],
      evidenceManifest: [
        mkEvidence("seed"),
        mkEvidence("unlock_key"),
        mkEvidence("final_seed"),
      ],
    });
    expect(
      validateInterrogation(scene).find(
        (e) => e.code === "interrogationUnguaranteedContradiction",
      ),
    ).toBeUndefined();
  });

  it("still rejects a locked required phase when no phase unlocks it", () => {
    // The phase has an Unlock predicate (so it is not *structurally*
    // unreachable), but that predicate references evidence nothing reveals, so
    // the phase is never reached and a required phase that can never be
    // completed fails the contradiction guarantee.
    const scene = mkInterrogationScene({
      phases: [
        mkInquiryPhase({
          id: "optional_setup",
          required: false,
          questions: [mkQuestion({ id: "opt_q" })],
        }),
        mkInquiryPhase({
          id: "locked_required",
          required: true,
          status: "locked",
          unlock: { predicate: "evidence_collected", id: "missing_key" },
          questions: [mkQuestion({ id: "locked_q" })],
        }),
      ],
      evidenceManifest: [mkEvidence("missing_key")],
    });
    const errors = validateInterrogation(scene);
    expect(
      errors.find(
        (e) =>
          e.code === "interrogationUnguaranteedContradiction" &&
          e.message.includes("locked_required"),
      ),
    ).toBeDefined();
  });
});

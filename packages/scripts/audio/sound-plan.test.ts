import { describe, expect, it } from "vitest";
import { parseSoundPlanText, validateSoundPlan } from "./sound-plan";

const validPlan = `
schemaVersion: 1
chapterId: chapter_1
sources:
  - docs/stories_plan/chapter_1/scene_6.md
catalogSnapshot:
  bgm: []
  bgs: []
  sfx: []
entries:
  - id: rain_street_light
    channel: bgs
    status: approved
    loop: true
    intendedDurationSeconds: 30
    prompt: Steady light Tokyo street rain, no thunder, loopable.
    reuseRationale: Covers exterior rainy street scenes.
    evidence:
      - file: docs/stories_plan/chapter_1/scene_6.md
        line: 3
        note: rainy shopping street under an awning
cues:
  - file: docs/stories_plan/chapter_1/scene_6.md
    visualUnit: tag_001
    bgs: rain_street_light
rejected:
  - file: docs/stories_plan/chapter_1/investigation_scene_3.md
    line: 26
    sound: coin tray click
    reason: incidental texture, not persistent or emphasized
`;

const minimalValidPlan = `
schemaVersion: 1
chapterId: chapter_1
sources: []
catalogSnapshot:
  bgm: []
  bgs: []
  sfx: []
entries: []
cues: []
rejected: []
`;

function expectParseDiagnostic(
  text: string,
  code: string,
  path?: string,
): { code: string; message: string; path: string } {
  const parsed = parseSoundPlanText(text, "plan.yaml");
  expect(parsed.ok).toBe(false);
  if (parsed.ok) throw new Error("Expected parse diagnostics.");
  const diagnostic = parsed.diagnostics.find(
    (item) => item.code === code && (path === undefined || item.path === path),
  );
  expect(diagnostic).toEqual(
    expect.objectContaining({
      code,
      ...(path === undefined ? {} : { path }),
    }),
  );
  if (!diagnostic) throw new Error(`Expected ${code} diagnostic.`);
  return diagnostic;
}

function expectValidationDiagnostic(text: string, code: string, path?: string) {
  const parsed = parseSoundPlanText(text, "plan.yaml");
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) return;
  expect(validateSoundPlan(parsed.value)).toContainEqual(
    expect.objectContaining({
      code,
      ...(path === undefined ? {} : { path }),
    }),
  );
}

describe("sound plan validation", () => {
  it("parses a valid plan", () => {
    const parsed = parseSoundPlanText(validPlan, "plan.yaml");
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.entries[0]?.id).toBe("rain_street_light");
    expect(validateSoundPlan(parsed.value)).toEqual([]);
  });

  it("rejects duplicate entry ids", () => {
    expectValidationDiagnostic(
      validPlan.replace(
        "cues:",
        `  - id: rain_street_light
    channel: bgs
    status: approved
    loop: true
    intendedDurationSeconds: 20
    prompt: Duplicate rain.
    reuseRationale: Duplicate.
    evidence:
      - file: docs/stories_plan/chapter_1/scene_6.md
        line: 3
        note: duplicate
cues:`,
      ),
      "soundPlanDuplicateId",
      "entries[1]",
    );
  });

  it("rejects invalid snake_case ids", () => {
    expectValidationDiagnostic(
      validPlan.replace("id: rain_street_light", "id: Rain-Street"),
      "soundPlanIdInvalid",
      "entries[0].id",
    );
  });

  it("rejects missing prompts", () => {
    expectValidationDiagnostic(
      validPlan.replace(
        "prompt: Steady light Tokyo street rain, no thunder, loopable.",
        'prompt: ""',
      ),
      "soundPlanPromptMissing",
      "entries[0].prompt",
    );
  });

  it("rejects invalid durations", () => {
    expectValidationDiagnostic(
      validPlan.replace(
        "intendedDurationSeconds: 30",
        "intendedDurationSeconds: 0",
      ),
      "soundPlanDurationInvalid",
      "entries[0].intendedDurationSeconds",
    );
  });

  it("rejects missing evidence for non-rejected entries", () => {
    expectValidationDiagnostic(
      validPlan.replace(
        `evidence:
      - file: docs/stories_plan/chapter_1/scene_6.md
        line: 3
        note: rainy shopping street under an awning`,
        "evidence: []",
      ),
      "soundPlanEvidenceMissing",
      "entries[0].evidence",
    );
  });

  it("rejects unknown cue entries", () => {
    expectValidationDiagnostic(
      validPlan.replace("bgs: rain_street_light", "bgs: unknown_rain"),
      "soundPlanCueUnknownEntry",
      "cues[0].bgs",
    );
  });

  it("rejects cue channel mismatches", () => {
    expectValidationDiagnostic(
      validPlan.replace("channel: bgs", "channel: bgm"),
      "soundPlanCueChannelMismatch",
      "cues[0].bgs",
    );
  });

  it("rejects cue references to unapproved entries", () => {
    expectValidationDiagnostic(
      validPlan.replace("status: approved", "status: proposed"),
      "soundPlanCueUnapprovedEntry",
      "cues[0].bgs",
    );
  });

  it("rejects sfx cue fields in v1", () => {
    expectValidationDiagnostic(
      validPlan.replace("bgs: rain_street_light", "sfx: plastic_bag_crinkle"),
      "soundPlanSfxCueUnsupported",
      "cues[0].sfx",
    );
  });

  it("rejects blank bgm cue entries", () => {
    expectValidationDiagnostic(
      validPlan.replace("bgs: rain_street_light", 'bgm: ""'),
      "soundPlanCueBlankEntry",
      "cues[0].bgm",
    );
  });

  it("rejects blank bgs cue entries", () => {
    expectValidationDiagnostic(
      validPlan.replace("bgs: rain_street_light", 'bgs: ""'),
      "soundPlanCueBlankEntry",
      "cues[0].bgs",
    );
  });

  it("rejects blank sfx cue fields in v1", () => {
    expectValidationDiagnostic(
      validPlan.replace("bgs: rain_street_light", 'sfx: ""'),
      "soundPlanSfxCueUnsupported",
      "cues[0].sfx",
    );
  });

  it("returns diagnostics for invalid yaml", () => {
    expectParseDiagnostic(
      "schemaVersion: 1\nchapterId: [",
      "soundPlanYamlInvalid",
      "plan.yaml",
    );
  });

  it("returns diagnostics for invalid root shapes", () => {
    expectParseDiagnostic("not-a-plan", "soundPlanRootInvalid", "plan.yaml");
  });

  it.each([
    [
      "schemaVersion",
      minimalValidPlan.replace("schemaVersion: 1", "schemaVersion: 2"),
      "soundPlanSchemaVersionInvalid",
      "schemaVersion",
    ],
    [
      "chapterId",
      minimalValidPlan.replace("chapterId: chapter_1", "chapterId: 7"),
      "soundPlanChapterIdInvalid",
      "chapterId",
    ],
    [
      "sources array",
      minimalValidPlan.replace("sources: []", "sources: {}"),
      "soundPlanSourcesInvalid",
      "sources",
    ],
    [
      "sources item",
      minimalValidPlan.replace("sources: []", "sources:\n  - 7"),
      "soundPlanSourceInvalid",
      "sources[0]",
    ],
    [
      "catalogSnapshot object",
      minimalValidPlan.replace(
        `catalogSnapshot:
  bgm: []
  bgs: []
  sfx: []`,
        "catalogSnapshot: []",
      ),
      "soundPlanCatalogSnapshotInvalid",
      "catalogSnapshot",
    ],
    [
      "catalogSnapshot channel array",
      minimalValidPlan.replace("  bgm: []", "  bgm: {}"),
      "soundPlanCatalogSnapshotChannelInvalid",
      "catalogSnapshot.bgm",
    ],
    [
      "catalogSnapshot item",
      minimalValidPlan.replace("  bgm: []", "  bgm:\n    - 7"),
      "soundPlanCatalogSnapshotEntryInvalid",
      "catalogSnapshot.bgm[0]",
    ],
    [
      "entries array",
      minimalValidPlan.replace("entries: []", "entries: {}"),
      "soundPlanEntriesInvalid",
      "entries",
    ],
    [
      "cues array",
      minimalValidPlan.replace("cues: []", "cues: {}"),
      "soundPlanCuesInvalid",
      "cues",
    ],
    [
      "rejected array",
      minimalValidPlan.replace("rejected: []", "rejected: {}"),
      "soundPlanRejectedInvalid",
      "rejected",
    ],
  ])("returns diagnostics for malformed %s", (_name, text, code, path) => {
    expectParseDiagnostic(text, code, path);
  });

  it("returns indexed diagnostics for unsupported entry channels", () => {
    const diagnostic = expectParseDiagnostic(
      validPlan.replace("channel: bgs", "channel: voice"),
      "soundPlanEntryInvalid",
      "entries[0].channel",
    );
    expect(diagnostic.message).toContain("voice");
  });

  it.each([
    [
      "entry item",
      minimalValidPlan.replace("entries: []", "entries:\n  - not-an-object"),
      "soundPlanEntryInvalid",
      "entries[0]",
    ],
    [
      "evidence item",
      validPlan.replace(
        `evidence:
      - file: docs/stories_plan/chapter_1/scene_6.md
        line: 3
        note: rainy shopping street under an awning`,
        "evidence:\n      - not-an-object",
      ),
      "soundPlanEntryEvidenceInvalid",
      "entries[0].evidence[0]",
    ],
    [
      "evidence file",
      validPlan.replace(
        "file: docs/stories_plan/chapter_1/scene_6.md",
        'file: ""',
      ),
      "soundPlanEntryEvidenceInvalid",
      "entries[0].evidence[0].file",
    ],
    [
      "evidence line",
      validPlan.replace("line: 3", "line: 0"),
      "soundPlanEntryEvidenceInvalid",
      "entries[0].evidence[0].line",
    ],
    [
      "evidence note",
      validPlan.replace(
        "note: rainy shopping street under an awning",
        'note: ""',
      ),
      "soundPlanEntryEvidenceInvalid",
      "entries[0].evidence[0].note",
    ],
    [
      "cue item",
      minimalValidPlan.replace("cues: []", "cues:\n  - not-an-object"),
      "soundPlanCueInvalid",
      "cues[0]",
    ],
    [
      "cue field",
      validPlan.replace("visualUnit: tag_001", "visualUnit: 7"),
      "soundPlanCueInvalid",
      "cues[0].visualUnit",
    ],
    [
      "rejected item",
      minimalValidPlan.replace("rejected: []", "rejected:\n  - not-an-object"),
      "soundPlanRejectedInvalid",
      "rejected[0]",
    ],
    [
      "rejected field",
      validPlan.replace("sound: coin tray click", "sound: 7"),
      "soundPlanRejectedInvalid",
      "rejected[0].sound",
    ],
  ])(
    "returns diagnostics for malformed nested %s",
    (_name, text, code, path) => {
      expectParseDiagnostic(text, code, path);
    },
  );
});

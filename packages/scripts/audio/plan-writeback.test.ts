import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  applyGenerationMetadataToPlan,
  type GenerationMetadata,
} from "./plan-writeback";
import { parseSoundPlanText } from "./sound-plan";

const PLAN_WITH_COMMENTS = `# Chapter 1 sound plan.
schemaVersion: 1
chapterId: chapter_1
sources: []
catalogSnapshot:
  bgm: []
  bgs: []
  sfx: []
entries:
  # ---- BGM: sparse major-beat music ----
  - id: bgm_review_board_loss
    channel: bgm
    status: approved
    loop: true
    intendedDurationSeconds: 45
    prompt: >-
      Sparse restrained procedural tension.
    reuseRationale: >-
      Catalog is empty.
    evidence:
      - { file: docs/stories_plan/chapter_1/scene_5.md, line: 3, note: 審查會場 }
  - id: bgs_cafe_closed_night
    channel: bgs
    status: approved
    loop: true
    intendedDurationSeconds: 60
    prompt: Closed cafe night ambience.
    reuseRationale: Reusable.
    evidence:
      - { file: docs/stories_plan/chapter_1/investigation_scene_3.md, line: 3, note: 咖啡店 }
cues: []
rejected: []
`;

function metadataFor(
  id: string,
  overrides: Partial<GenerationMetadata> = {},
): GenerationMetadata {
  return {
    entryId: id,
    provider: "elevenlabs",
    endpoint: "https://api.elevenlabs.io/v1/music?output_format=mp3_44100_128",
    promptHash: "a1b2c3d4e5f6",
    generatedAt: "2026-06-21T12:00:00.000Z",
    outputPath: `static/assets/audio/bgm/${id}.ogg`,
    forced: false,
    ...overrides,
  };
}

function writePlan(text: string): string {
  const dir = mkdtempSync(join(tmpdir(), "lyra-writeback-"));
  const path = join(dir, "plan.yaml");
  writeFileSync(path, text);
  return path;
}

describe("applyGenerationMetadataToPlan — per-entry write-back (#3)", () => {
  it("sets status to generated and records all metadata fields on the matching entry", () => {
    const planPath = writePlan(PLAN_WITH_COMMENTS);
    applyGenerationMetadataToPlan(
      planPath,
      metadataFor("bgm_review_board_loss"),
    );

    const updated = readFileSync(planPath, "utf-8");
    const reparsed = parseSoundPlanText(updated, planPath);
    expect(reparsed.ok).toBe(true);
    if (!reparsed.ok) return;
    const entry = reparsed.value.entries.find(
      (e) => e.id === "bgm_review_board_loss",
    );
    expect(entry?.status).toBe("generated");
    expect(entry?.provider).toBe("elevenlabs");
    expect(entry?.endpoint).toContain("/v1/music");
    expect(entry?.promptHash).toBe("a1b2c3d4e5f6");
    expect(entry?.generatedAt).toBe("2026-06-21T12:00:00.000Z");
    expect(entry?.outputPath).toBe(
      "static/assets/audio/bgm/bgm_review_board_loss.ogg",
    );
    expect(entry?.forced).toBe(false);
  });

  it("leaves other entries untouched", () => {
    const planPath = writePlan(PLAN_WITH_COMMENTS);
    applyGenerationMetadataToPlan(
      planPath,
      metadataFor("bgm_review_board_loss"),
    );

    const updated = readFileSync(planPath, "utf-8");
    const reparsed = parseSoundPlanText(updated, planPath);
    expect(reparsed.ok).toBe(true);
    if (!reparsed.ok) return;
    const other = reparsed.value.entries.find(
      (e) => e.id === "bgs_cafe_closed_night",
    );
    expect(other?.status).toBe("approved");
    expect(other?.provider).toBeUndefined();
    expect(other?.outputPath).toBeUndefined();
  });

  it("preserves authoring comments in the plan YAML", () => {
    const planPath = writePlan(PLAN_WITH_COMMENTS);
    applyGenerationMetadataToPlan(
      planPath,
      metadataFor("bgm_review_board_loss"),
    );

    const updated = readFileSync(planPath, "utf-8");
    expect(updated).toContain("# Chapter 1 sound plan.");
    expect(updated).toContain("# ---- BGM: sparse major-beat music ----");
  });

  it("records optional normalizationNotes when provided", () => {
    const planPath = writePlan(PLAN_WITH_COMMENTS);
    applyGenerationMetadataToPlan(
      planPath,
      metadataFor("bgs_cafe_closed_night", {
        normalizationNotes: "converted from mp3 to ogg via ffmpeg libvorbis",
      }),
    );

    const updated = readFileSync(planPath, "utf-8");
    const reparsed = parseSoundPlanText(updated, planPath);
    expect(reparsed.ok).toBe(true);
    if (!reparsed.ok) return;
    const entry = reparsed.value.entries.find(
      (e) => e.id === "bgs_cafe_closed_night",
    );
    expect(entry?.normalizationNotes).toBe(
      "converted from mp3 to ogg via ffmpeg libvorbis",
    );
  });

  it("throws when the target entry id is not found", () => {
    const planPath = writePlan(PLAN_WITH_COMMENTS);
    expect(() =>
      applyGenerationMetadataToPlan(planPath, metadataFor("nonexistent_id")),
    ).toThrow(/nonexistent_id/);
  });

  it("records forced: true when generation was forced", () => {
    const planPath = writePlan(PLAN_WITH_COMMENTS);
    applyGenerationMetadataToPlan(
      planPath,
      metadataFor("bgm_review_board_loss", { forced: true }),
    );

    const updated = readFileSync(planPath, "utf-8");
    const reparsed = parseSoundPlanText(updated, planPath);
    expect(reparsed.ok).toBe(true);
    if (!reparsed.ok) return;
    const entry = reparsed.value.entries.find(
      (e) => e.id === "bgm_review_board_loss",
    );
    expect(entry?.forced).toBe(true);
  });
});

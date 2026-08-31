import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { portraitAssetId } from "@lyra/asset-paths";
import {
  expectedPath,
  publicPath,
  type AssetManifest,
  type AssetManifestEntry,
} from "@lyra/scripts/compile-scenes/assets/manifest";
import type { AssetReport } from "@lyra/scripts/compile-scenes/orchestrator";
import type {
  JSONInterrogationScene,
  JSONInvestigationScene,
  JSONLinearScene,
  PortraitRef,
} from "@lyra/scripts/compile-scenes/types";
import { assetUsageGroups, projectAssetWorkspace } from "./asset-workspace";
import type { WorkbenchAssetWorkspacePayload } from "./workbench-types";

const CHARACTERS_YAML = `
characters:
  - id: hayasaka_akane
    displayNames:
      - 早坂茜
    portraitMode: portrait
    visualPrompt: attorney in dark suit
    expressions:
      standard:
        prompt: neutral
      concerned:
        prompt: worried
`;

const AUDIO_YAML = `
bgm:
  rain:
    prompt: soft tension
  step:
    prompt: bgm step
bgs:
  street_rain:
    prompt: rain
sfx:
  step:
    prompt: footstep
`;

function entryBase(input: {
  assetId: string;
  type: AssetManifestEntry["type"];
  entryPrompt: string;
}) {
  const promptParts = {
    globalStyle: "noir style",
    typePrompt: "",
    subjectPrompt: "",
    entryPrompt: input.entryPrompt,
  };
  return {
    assetId: input.assetId,
    expectedPath: expectedPath(input.assetId, input.type),
    publicPath: publicPath(input.assetId, input.type),
    promptParts,
    finalPrompt: Object.values(promptParts).filter(Boolean).join("\n\n"),
  };
}

const manifest: AssetManifest = {
  enabled: true,
  entries: [
    {
      ...entryBase({
        assetId: "portrait.hayasaka_akane.standard",
        type: "portrait",
        entryPrompt: "neutral",
      }),
      type: "portrait",
      source: {
        chapterId: "chapter_1",
        sceneId: "scene_1",
        characterId: "hayasaka_akane",
        expression: "standard",
      },
    },
    {
      ...entryBase({
        assetId: "audio.bgm.rain",
        type: "audio",
        entryPrompt: "soft tension",
      }),
      type: "audio",
      source: {
        chapterId: "chapter_1",
        sceneId: "scene_1",
        channel: "bgm",
        id: "rain",
      },
    },
    {
      ...entryBase({
        assetId: "audio.bgm.step",
        type: "audio",
        entryPrompt: "bgm step",
      }),
      type: "audio",
      source: {
        chapterId: "chapter_1",
        sceneId: "scene_1",
        channel: "bgm",
        id: "step",
      },
    },
    {
      ...entryBase({
        assetId: "audio.bgs.street_rain",
        type: "audio",
        entryPrompt: "rain",
      }),
      type: "audio",
      source: {
        chapterId: "chapter_1",
        sceneId: "scene_1",
        channel: "bgs",
        id: "street_rain",
      },
    },
    {
      ...entryBase({
        assetId: "audio.sfx.step",
        type: "audio",
        entryPrompt: "footstep",
      }),
      type: "audio",
      source: {
        chapterId: "chapter_1",
        sceneId: "scene_1",
        channel: "sfx",
        id: "step",
      },
    },
  ],
};

const report: AssetReport = {
  enabled: true,
  requested: { background: 0, portrait: 1, standee: 0, evidence: 0, audio: 4 },
  warnings: [],
};

// Manifest whose audio entry's assetId suffix intentionally differs from its
// typed `source.id`. Used by the behavioral lock on the typed-manifest
// ownership contract: a Set cue on `audio.bgm.rain_alias` must credit the
// `rain` catalog row (via `source.id`), not a `rain_alias` row (via the
// assetId grammar). Any implementation that derives the catalog key by
// peeling `audio.<channel>.<id>` off the assetId fails regardless of how the
// string parsing is spelled.
const divergentSourceManifest: AssetManifest = {
  enabled: true,
  entries: [
    {
      ...entryBase({
        assetId: "portrait.hayasaka_akane.standard",
        type: "portrait",
        entryPrompt: "neutral",
      }),
      type: "portrait",
      source: {
        chapterId: "chapter_1",
        sceneId: "scene_1",
        characterId: "hayasaka_akane",
        expression: "standard",
      },
    },
    {
      ...entryBase({
        assetId: "audio.bgm.rain_alias",
        type: "audio",
        entryPrompt: "soft tension",
      }),
      type: "audio",
      source: {
        chapterId: "chapter_1",
        sceneId: "scene_1",
        channel: "bgm",
        id: "rain",
      },
    },
  ],
};

function payload(
  overrides: Partial<WorkbenchAssetWorkspacePayload> = {},
): WorkbenchAssetWorkspacePayload {
  return {
    manifest,
    report,
    configSources: {
      characters: {
        path: "static/assets/config/characters.yaml",
        content: CHARACTERS_YAML,
      },
      audio: { path: "static/assets/config/audio.yaml", content: AUDIO_YAML },
    },
    scenes: [],
    // Rust `load_asset_workspace` shape: repo-relative paths, never public
    // URL paths (publicPath-shaped entries masked F1).
    existingAssetPaths: ["static/assets/portraits/hayasaka_akane/standard.png"],
    ...overrides,
  };
}

// ---- scene usage projection fixtures ----------------------------------------

const AKANE_STANDARD: PortraitRef = {
  characterId: "hayasaka_akane",
  expression: "standard",
  assetId: "portrait.hayasaka_akane.standard",
};
const AKANE_CONCERNED: PortraitRef = {
  characterId: "hayasaka_akane",
  expression: "concerned",
  assetId: "portrait.hayasaka_akane.concerned",
};

function scenePayload<
  Scene extends WorkbenchAssetWorkspacePayload["scenes"][number]["scene"],
>(sceneId: string, scene: Scene) {
  return {
    chapterId: "chapter_1",
    sceneId,
    sourcePath: `docs/stories_plan/chapter_1/${sceneId}.md`,
    scene,
  };
}

const standardOnlyScene: JSONLinearScene = {
  type: "linear",
  id: "scene_s",
  title: "Standard",
  summary: "",
  queue: [{ kind: "line", speaker: "S", text: "a", portrait: AKANE_STANDARD }],
  assetRefs: [],
};

/** Two sceneTags: bgm.rain+bgs.street_rain set at item 0, bgm.step set at item 1. */
const audioCueScene: JSONLinearScene = {
  type: "linear",
  id: "scene_a",
  title: "Audio",
  summary: "",
  queue: [
    {
      kind: "sceneTag",
      text: "Scene:",
      assetCue: {
        backgroundAssetId: null,
        bgm: { channel: "bgm", assetId: "audio.bgm.rain" },
        bgs: { channel: "bgs", assetId: "audio.bgs.street_rain" },
      },
    },
    {
      kind: "sceneTag",
      text: "Scene:",
      assetCue: {
        backgroundAssetId: null,
        bgm: { channel: "bgm", assetId: "audio.bgm.step" },
        bgs: null,
      },
    },
  ],
  assetRefs: [],
};

/** One bgm Set cue on an assetId whose suffix differs from the manifest
 * `source.id` — the behavioral probe for the typed-manifest ownership
 * contract (see `divergentSourceManifest`). */
const divergentAudioCueScene: JSONLinearScene = {
  type: "linear",
  id: "scene_divergent",
  title: "Divergent",
  summary: "",
  queue: [
    {
      kind: "sceneTag",
      text: "Scene:",
      assetCue: {
        backgroundAssetId: null,
        bgm: { channel: "bgm", assetId: "audio.bgm.rain_alias" },
        bgs: null,
      },
    },
  ],
  assetRefs: [],
};

const cueLinearScene: JSONLinearScene = {
  type: "linear",
  id: "scene_cue",
  title: "Cue",
  summary: "",
  queue: [
    {
      kind: "sceneTag",
      text: "Scene:",
      assetCue: {
        backgroundAssetId: null,
        bgm: { channel: "bgm", assetId: null },
        bgs: { channel: "bgs", assetId: "audio.bgs.street_rain" },
      },
    },
  ],
  assetRefs: [],
};

const portraitOccurrencesScene: JSONLinearScene = {
  type: "linear",
  id: "scene_u",
  title: "Usage",
  summary: "",
  queue: [
    {
      kind: "sceneTag",
      text: "Scene:",
      assetCue: {
        backgroundAssetId: "background.chapter_1.scene_u.main",
        bgm: { channel: "bgm", assetId: "audio.bgm.rain" },
        bgs: null,
      },
    },
    { kind: "line", speaker: "S", text: "a", portrait: AKANE_STANDARD },
    { kind: "line", speaker: "S", text: "b", portrait: AKANE_STANDARD },
    { kind: "line", speaker: "S", text: "c", portrait: AKANE_CONCERNED },
  ],
  assetRefs: [],
};

const unresolvedScene: JSONLinearScene = {
  type: "linear",
  id: "scene_x",
  title: "Unresolved",
  summary: "",
  queue: [{ kind: "line", speaker: "S", text: "a", portrait: AKANE_CONCERNED }],
  assetRefs: [],
};

const deltaInvestigationScene: JSONInvestigationScene = {
  type: "investigation",
  id: "investigation_u",
  title: "Delta",
  summary: "",
  intro: [],
  assetRefs: [],
  sublocations: [
    {
      id: "hall",
      label: "Hall",
      status: "unlocked",
      unlock: null,
      reveals: [],
      sceneTag: "Scene:",
      backgroundAssetId: null,
      bgm: null,
      bgs: { channel: "bgs", assetId: null },
      transitionDialogue: [],
      hotspots: [],
      characters: [],
    },
  ],
  evidenceManifest: [],
  statementManifest: [],
  outro: { unlock: "auto", dialogue: [] },
};

const spriteScene: JSONInvestigationScene = {
  type: "investigation",
  id: "investigation_s",
  title: "Sprites",
  summary: "",
  intro: [],
  assetRefs: [],
  sublocations: [
    {
      id: "yard",
      label: "Yard",
      status: "unlocked",
      unlock: null,
      reveals: [],
      sceneTag: "Scene:",
      backgroundAssetId: null,
      bgm: null,
      bgs: null,
      transitionDialogue: [],
      hotspots: [],
      characters: [
        "standee.npc1.default",
        "portrait.hayasaka_akane.standard",
        "evidence.door_log",
        "background.chapter_1.investigation_s.wall",
      ].map((assetId, index) => ({
        id: `npc${index}`,
        name: `N${index}`,
        role: "R",
        bio: "",
        layout: {
          kind: "sprite" as const,
          assetId,
          x: 0.1,
          y: 0.1,
          w: 0.2,
          h: 0.3,
          anchor: "bottomCenter" as const,
        },
        topics: [],
      })),
    },
  ],
  evidenceManifest: [],
  statementManifest: [],
  outro: { unlock: "auto", dialogue: [] },
};

const deltaInterrogationScene: JSONInterrogationScene = {
  type: "interrogation",
  id: "interrogation_u",
  title: "Subject",
  summary: "",
  intro: [],
  assetRefs: [],
  phases: [
    {
      kind: "inquiry",
      id: "phase_u",
      label: "Phase",
      subject: {
        id: "suspect",
        name: "S",
        role: "R",
        bio: "",
        portrait: AKANE_STANDARD,
      },
      required: true,
      status: "unlocked",
      unlock: null,
      reveals: [],
      sceneTag: "Scene:",
      backgroundAssetId: null,
      bgm: null,
      bgs: null,
      entryDialogue: [],
      complete: "auto",
      questions: [
        {
          id: "q_u",
          label: "Q",
          status: "unlocked",
          required: true,
          unlock: null,
          reveals: [],
          testimony: {
            onLoop: [],
            loopPrompt: [],
            defaultChallenge: [],
            defaultWrong: [],
            wrongReply: [],
            lines: [],
          },
        },
      ],
    },
  ],
  evidenceManifest: [],
  statementManifest: [],
  outro: { unlock: "auto", dialogue: [] },
};

const spriteManifestEntryBase = { entryPrompt: "prompt" };

function spriteManifest(): AssetManifest {
  return {
    ...manifest,
    entries: [
      ...manifest.entries,
      // Inline correlated literals: each object matches one manifest union
      // member (type + typed source), so key renames fail TypeScript here too.
      {
        ...entryBase({
          assetId: "standee.npc1.default",
          type: "standee",
          ...spriteManifestEntryBase,
        }),
        type: "standee",
        source: {
          chapterId: "chapter_1",
          sceneId: "investigation_s",
          characterId: "npc1",
        },
      },
      {
        ...entryBase({
          assetId: "evidence.door_log",
          type: "evidence",
          ...spriteManifestEntryBase,
        }),
        type: "evidence",
        source: {
          chapterId: "chapter_1",
          sceneId: "investigation_s",
          evidenceId: "door_log",
        },
      },
      {
        ...entryBase({
          assetId: "background.chapter_1.investigation_s.wall",
          type: "background",
          ...spriteManifestEntryBase,
        }),
        type: "background",
        source: {
          chapterId: "chapter_1",
          sceneId: "investigation_s",
          unitId: "wall",
        },
      },
    ],
  };
}

describe("projectAssetWorkspace", () => {
  it("configured_unused_expression_uses_shared_identity_and_paths", () => {
    // One concrete line occurrence makes `standard` referenced; the manifest
    // entry alone is never a usage-count source (F4).
    const workspace = projectAssetWorkspace(
      payload({ scenes: [scenePayload("scene_s", standardOnlyScene)] }),
    );

    expect(workspace.characters).toHaveLength(1);
    const character = workspace.characters[0]!;
    expect(character.id).toBe("hayasaka_akane");
    // Both configured expressions appear, in catalog order.
    expect(character.expressions.map((e) => e.expressionId)).toEqual([
      "standard",
      "concerned",
    ]);

    const standard = character.expressions[0]!;
    expect(standard.referenced).toBe(true);
    expect(standard.usages).toBe(1);

    // The unused expression still gets shared identity and compiler paths.
    const concerned = character.expressions[1]!;
    expect(concerned.referenced).toBe(false);
    expect(concerned.usages).toBe(0);
    const expectedId = portraitAssetId("hayasaka_akane", "concerned");
    expect(expectedId).toBe("portrait.hayasaka_akane.concerned");
    expect(concerned.assetId).toBe(expectedId);
    expect(concerned.expectedPath).toBe(expectedPath(expectedId, "portrait"));
    expect(concerned.expectedPath).toBe(
      "static/assets/portraits/hayasaka_akane/concerned.png",
    );
    expect(concerned.publicPath).toBe(publicPath(expectedId, "portrait"));
    expect(concerned.prompt).toBe("worried");
  });

  it("unused_expressions_are_neutral_not_warnings", () => {
    const workspace = projectAssetWorkspace(
      payload({ scenes: [scenePayload("scene_s", standardOnlyScene)] }),
    );

    const concerned = workspace.characters[0]!.expressions.find(
      (expression) => expression.expressionId === "concerned",
    )!;
    expect(concerned.usages).toBe(0);
    expect(concerned.referenced).toBe(false);
    // Neutral fact: 0 usages never becomes a warning, an error, or an
    // approval/status entry.
    expect(workspace.diagnostics).toEqual([]);
    expect(workspace.report.warnings).toEqual([]);
  });

  it("drops_character_entries_that_omit_id", () => {
    // `parseCharacterEntry` returns `id: ""` (no error) for entries missing
    // `id`; the compiler-only missing-id check is not run here. Such entries
    // must not reach expressionRow, which would build `portrait..standard`
    // asset ids and empty headings with no diagnostic explaining them.
    const idLessYaml = `
characters:
  - displayNames:
      - 名無し
    expressions:
      standard:
        prompt: neutral
  - id: hayasaka_akane
    expressions:
      standard:
        prompt: neutral
`;
    const workspace = projectAssetWorkspace(
      payload({
        configSources: {
          characters: {
            path: "static/assets/config/characters.yaml",
            content: idLessYaml,
          },
          audio: {
            path: "static/assets/config/audio.yaml",
            content: AUDIO_YAML,
          },
        },
      }),
    );

    expect(workspace.characters.map((row) => row.id)).toEqual([
      "hayasaka_akane",
    ]);
    // No `portrait..standard` asset id leaks through.
    expect(
      workspace.characters.some((row) =>
        row.expressions.some((expr) => expr.assetId.startsWith("portrait..")),
      ),
    ).toBe(false);
  });

  it("skips_non_slug_character_id_and_surfaces_read_diagnostic", () => {
    // Character-id slug validation is compiler-only, so `id: foo.bar` is
    // non-empty and `malformed === false` here. `expressionRow` would build
    // `portrait.foo.bar.standard` (four segments), and `expectedPath`/
    // `publicPath` reject it because portrait ids require exactly three —
    // throwing would abort the whole Assets projection. The bad row is
    // skipped and surfaced as a read diagnostic; the rest stays usable.
    const nonSlugYaml = `
characters:
  - id: foo.bar
    displayNames:
      - バッド
    expressions:
      standard:
        prompt: neutral
  - id: hayasaka_akane
    expressions:
      standard:
        prompt: neutral
`;
    const workspace = projectAssetWorkspace(
      payload({
        configSources: {
          characters: {
            path: "static/assets/config/characters.yaml",
            content: nonSlugYaml,
          },
          audio: {
            path: "static/assets/config/audio.yaml",
            content: AUDIO_YAML,
          },
        },
        scenes: [scenePayload("scene_s", standardOnlyScene)],
      }),
    );

    // The bad row is dropped; the valid character still projects.
    expect(workspace.characters.map((row) => row.id)).toEqual([
      "hayasaka_akane",
    ]);
    // No `portrait.foo.bar.standard` asset id leaks through.
    expect(
      workspace.characters.some((row) =>
        row.expressions.some((expr) =>
          expr.assetId.startsWith("portrait.foo.bar"),
        ),
      ),
    ).toBe(false);
    // A read diagnostic explains the skipped row.
    const diagnostic = workspace.diagnostics.find(
      (d) => d.code === "assetCharacterIdNotPortraitSafe",
    );
    expect(diagnostic).toBeDefined();
    expect(diagnostic!.sourceFile).toBe("static/assets/config/characters.yaml");
    expect(diagnostic!.message).toContain("foo.bar");
    // The rest of the workspace stays usable: the valid character's standard
    // expression counts the one concrete occurrence, and audio still projects.
    const standard = workspace.characters[0]!.expressions[0]!;
    expect(standard.usages).toBe(1);
    expect(workspace.audio.bgm.map((row) => row.id)).toEqual(["rain", "step"]);
  });

  it("referenced_manifest_fields_are_not_recomputed", () => {
    const workspace = projectAssetWorkspace(payload());

    // Library rows are the manifest entries themselves — verbatim.
    expect(workspace.library).toBe(manifest.entries);
    expect(workspace.manifest).toBe(manifest);
    expect(workspace.report).toBe(report);
    expect(workspace.scenes).toEqual([]);
    expect(workspace.existingAssetPaths).toEqual([
      "static/assets/portraits/hayasaka_akane/standard.png",
    ]);

    const row = workspace.library[0]!;
    const entry = manifest.entries[0]!;
    expect(row.source).toBe(entry.source);
    expect(row.promptParts).toBe(entry.promptParts);
    expect(row.finalPrompt).toBe(entry.finalPrompt);
    expect(row.expectedPath).toBe(entry.expectedPath);
    expect(row.publicPath).toBe(entry.publicPath);
  });

  it("yaml_parse_failure_is_workbench_read_diagnostic", () => {
    const workspace = projectAssetWorkspace(
      payload({
        configSources: {
          characters: {
            path: "static/assets/config/characters.yaml",
            content: "characters: [unclosed\n",
          },
          audio: {
            path: "static/assets/config/audio.yaml",
            content: AUDIO_YAML,
          },
        },
      }),
    );

    const codes = workspace.diagnostics.map((d) => d.code);
    expect(codes).toContain("assetConfigUnreadable");
    // Compiler-only validity policy is NOT run in the editor.
    expect(codes).not.toContain("assetCharactersMissing");
    expect(codes).not.toContain("assetCharacterMissingDisplayNames");
    expect(workspace.characters).toEqual([]);
    // The unaffected catalog still projects.
    expect(workspace.audio.bgm.map((row) => row.id)).toEqual(["rain", "step"]);
  });

  it("audio_library_joins_by_typed_manifest_source", () => {
    // Two scenes with the same audioCueScene body: repeated set cues stay
    // concrete occurrences (F2/F4), and each channel's rows count only its
    // own channel's set cues — never manifest entry counts.
    const workspace = projectAssetWorkspace(
      payload({
        scenes: [
          scenePayload("scene_a", audioCueScene),
          scenePayload("scene_b", audioCueScene),
        ],
      }),
    );

    expect(workspace.audio.bgm).toEqual([
      {
        channel: "bgm",
        id: "rain",
        prompt: "soft tension",
        loop: true,
        usages: 2,
        referenced: true,
      },
      {
        channel: "bgm",
        id: "step",
        prompt: "bgm step",
        loop: true,
        usages: 2,
        referenced: true,
      },
    ]);
    expect(workspace.audio.bgs).toEqual([
      {
        channel: "bgs",
        id: "street_rain",
        prompt: "rain",
        loop: true,
        usages: 2,
        referenced: true,
      },
    ]);
    // SFX has no cue channel in scene payloads: catalog-only SFX rows stay
    // at zero usages even though the manifest holds an sfx entry.
    expect(workspace.audio.sfx).toEqual([
      {
        channel: "sfx",
        id: "step",
        prompt: "footstep",
        loop: true,
        usages: 0,
        referenced: false,
      },
    ]);
  });

  it("audio_usage_count_keys_off_typed_manifest_source_not_assetid", () => {
    // Behavioral lock on the typed-manifest ownership contract: the catalog
    // row that receives a Set-cue usage is selected by the manifest entry's
    // typed `source.{channel,id}`, never by peeling `audio.<channel>.<id>`
    // off the usage assetId. The scene references an assetId whose suffix
    // (`rain_alias`) intentionally differs from the manifest source id
    // (`rain`); only a typed-source join credits the `rain` catalog row. Any
    // implementation that derives the catalog key from the assetId grammar
    // fails here regardless of how the string parsing is spelled
    // (`audio.${...}`, `startsWith`/`slice`, `split`, etc.).
    const workspace = projectAssetWorkspace(
      payload({
        manifest: divergentSourceManifest,
        scenes: [scenePayload("scene_divergent", divergentAudioCueScene)],
      }),
    );

    // The Set cue on `audio.bgm.rain_alias` becomes a concrete usage row.
    expect(workspace.sceneUsages).toEqual([
      {
        chapterId: "chapter_1",
        sceneId: "scene_divergent",
        sceneSourcePath: "docs/stories_plan/chapter_1/scene_divergent.md",
        carrierId: "main",
        carrierLabel: "Main",
        role: "bgm",
        itemIndex: 0,
        assetId: "audio.bgm.rain_alias",
        type: "audio",
      },
    ]);
    // The `rain` catalog row (from AUDIO_YAML) gets the usage because the
    // manifest entry's typed source is `{ channel: "bgm", id: "rain" }`.
    // A string-parsing revert would key on `rain_alias` and leave `rain` at 0.
    expect(workspace.audio.bgm.find((row) => row.id === "rain")).toEqual({
      channel: "bgm",
      id: "rain",
      prompt: "soft tension",
      loop: true,
      usages: 1,
      referenced: true,
    });
    // No `rain_alias` catalog row exists (AUDIO_YAML has no such id), so a
    // string-parsing revert has no row to credit — the `rain` row above is
    // the only behavioral signal that the join used the typed source.
    expect(workspace.audio.bgm.map((row) => row.id)).not.toContain(
      "rain_alias",
    );
  });

  it("bgm_bgs_set_cues_produce_concrete_usages", () => {
    const workspace = projectAssetWorkspace(
      payload({ scenes: [scenePayload("scene_a", audioCueScene)] }),
    );

    // Set cues become usage rows (role bgm/bgs, manifest join by assetId)
    // with the scene source path and the Reader-owned carrier label; stop
    // cues (assetId null) stay deltas only.
    expect(workspace.sceneUsages).toEqual([
      {
        chapterId: "chapter_1",
        sceneId: "scene_a",
        sceneSourcePath: "docs/stories_plan/chapter_1/scene_a.md",
        carrierId: "main",
        carrierLabel: "Main",
        role: "bgm",
        itemIndex: 0,
        assetId: "audio.bgm.rain",
        type: "audio",
      },
      {
        chapterId: "chapter_1",
        sceneId: "scene_a",
        sceneSourcePath: "docs/stories_plan/chapter_1/scene_a.md",
        carrierId: "main",
        carrierLabel: "Main",
        role: "bgs",
        itemIndex: 0,
        assetId: "audio.bgs.street_rain",
        type: "audio",
      },
      {
        chapterId: "chapter_1",
        sceneId: "scene_a",
        sceneSourcePath: "docs/stories_plan/chapter_1/scene_a.md",
        carrierId: "main",
        carrierLabel: "Main",
        role: "bgm",
        itemIndex: 1,
        assetId: "audio.bgm.step",
        type: "audio",
      },
    ]);
  });

  it("portrait_usage_counts_come_from_concrete_occurrences", () => {
    const workspace = projectAssetWorkspace(
      payload({
        manifest: spriteManifest(),
        scenes: [
          scenePayload("scene_u", portraitOccurrencesScene),
          scenePayload("investigation_s", spriteScene),
        ],
      }),
    );

    const character = workspace.characters[0]!;
    const standard = character.expressions.find(
      (expression) => expression.expressionId === "standard",
    )!;
    const concerned = character.expressions.find(
      (expression) => expression.expressionId === "concerned",
    )!;
    // 2 dialogue occurrences + 1 sprite layout occurrence = 3 concrete rows,
    // even though the manifest holds a single deduped portrait entry.
    expect(standard.usages).toBe(3);
    expect(standard.referenced).toBe(true);
    // 1 dialogue occurrence; the manifest has no concerned entry at all.
    expect(concerned.usages).toBe(1);
    expect(concerned.referenced).toBe(true);
  });
});

describe("projectAssetWorkspace scene usage projection", () => {
  it("asset_projection_has_no_scene_specific_carrier_walk", () => {
    // Structural proof: every scene cue/usage input flows from the single
    // Reader walk's presentation facts — no scene-type switch and no
    // per-type carrier walk duplicated in the workspace projection.
    const source = readFileSync(
      resolve(process.cwd(), "src/lib/asset-workspace.ts"),
      "utf8",
    );
    expect(source).toContain("projectReaderScene");
    expect(source).toContain(".presentation");
    expect(source).not.toMatch(/scene\.type/);
    for (const sceneType of [
      '"linear"',
      '"investigation"',
      '"interrogation"',
    ]) {
      expect(source, sceneType).not.toContain(sceneType);
    }

    // Behavioral proof: all four public scene shapes project through the same
    // presentation path.
    const workspace = projectAssetWorkspace(
      payload({
        scenes: [
          scenePayload("scene_cue", cueLinearScene),
          scenePayload("investigation_u", deltaInvestigationScene),
          scenePayload("interrogation_u", deltaInterrogationScene),
        ],
      }),
    );
    expect(workspace.sceneUsages).toContainEqual({
      chapterId: "chapter_1",
      sceneId: "interrogation_u",
      sceneSourcePath: "docs/stories_plan/chapter_1/interrogation_u.md",
      carrierId: "phase:phase_u",
      carrierLabel: "Phase",
      role: "portrait",
      itemIndex: null,
      assetId: "portrait.hayasaka_akane.standard",
      type: "portrait",
    });
    expect(workspace.sceneAudioDeltas.length).toBeGreaterThan(0);
  });

  it("audio_delta_preserves_inherit_stop_set", () => {
    const workspace = projectAssetWorkspace(
      payload({
        scenes: [
          scenePayload("scene_cue", cueLinearScene),
          scenePayload("investigation_u", deltaInvestigationScene),
        ],
      }),
    );
    // Dialogue cue: null bgm cue = stop, concrete bgs cue = set.
    // Structural cue: null bgm = inherit, {assetId: null} bgs = stop.
    expect(workspace.sceneAudioDeltas).toEqual([
      {
        chapterId: "chapter_1",
        sceneId: "scene_cue",
        sceneSourcePath: "docs/stories_plan/chapter_1/scene_cue.md",
        carrierId: "main",
        carrierLabel: "Main",
        itemIndex: 0,
        channel: "bgm",
        state: "stop",
        assetId: null,
      },
      {
        chapterId: "chapter_1",
        sceneId: "scene_cue",
        sceneSourcePath: "docs/stories_plan/chapter_1/scene_cue.md",
        carrierId: "main",
        carrierLabel: "Main",
        itemIndex: 0,
        channel: "bgs",
        state: "set",
        assetId: "audio.bgs.street_rain",
      },
      {
        chapterId: "chapter_1",
        sceneId: "investigation_u",
        sceneSourcePath: "docs/stories_plan/chapter_1/investigation_u.md",
        carrierId: "sublocation:hall",
        carrierLabel: "Hall",
        itemIndex: null,
        channel: "bgm",
        state: "inherit",
        assetId: null,
      },
      {
        chapterId: "chapter_1",
        sceneId: "investigation_u",
        sceneSourcePath: "docs/stories_plan/chapter_1/investigation_u.md",
        carrierId: "sublocation:hall",
        carrierLabel: "Hall",
        itemIndex: null,
        channel: "bgs",
        state: "stop",
        assetId: null,
      },
    ]);
  });

  it("asset_usage_keeps_concrete_portrait_occurrences_when_display_collapses_state", () => {
    const workspace = projectAssetWorkspace(
      payload({
        scenes: [scenePayload("scene_u", portraitOccurrencesScene)],
      }),
    );
    // Two consecutive identical portraits stay two usage rows (item indexes
    // 1 and 2); a later Scene-cue display may collapse them, usage may not.
    expect(
      workspace.sceneUsages.filter((usage) => usage.role === "portrait"),
    ).toEqual([
      {
        chapterId: "chapter_1",
        sceneId: "scene_u",
        sceneSourcePath: "docs/stories_plan/chapter_1/scene_u.md",
        carrierId: "main",
        carrierLabel: "Main",
        role: "portrait",
        itemIndex: 1,
        assetId: "portrait.hayasaka_akane.standard",
        type: "portrait",
      },
      {
        chapterId: "chapter_1",
        sceneId: "scene_u",
        sceneSourcePath: "docs/stories_plan/chapter_1/scene_u.md",
        carrierId: "main",
        carrierLabel: "Main",
        role: "portrait",
        itemIndex: 2,
        assetId: "portrait.hayasaka_akane.standard",
        type: "portrait",
      },
      {
        chapterId: "chapter_1",
        sceneId: "scene_u",
        sceneSourcePath: "docs/stories_plan/chapter_1/scene_u.md",
        carrierId: "main",
        carrierLabel: "Main",
        role: "portrait",
        itemIndex: 3,
        assetId: "portrait.hayasaka_akane.concerned",
        type: null,
      },
    ]);
  });

  it("sprite_usage_uses_manifest_asset_type", () => {
    const workspace = projectAssetWorkspace(
      payload({
        manifest: spriteManifest(),
        scenes: [scenePayload("investigation_s", spriteScene)],
      }),
    );
    // The raw sprite asset IDs resolve their asset kind from the manifest
    // join — standee, portrait, evidence, and background all work. Sprite
    // carriers have no Reader group, so the label falls back to the carrier
    // id (no second carrier-ID grammar).
    expect(workspace.sceneUsages).toEqual([
      {
        chapterId: "chapter_1",
        sceneId: "investigation_s",
        sceneSourcePath: "docs/stories_plan/chapter_1/investigation_s.md",
        carrierId: "character:npc0",
        carrierLabel: "character:npc0",
        role: "sprite",
        itemIndex: null,
        assetId: "standee.npc1.default",
        type: "standee",
      },
      {
        chapterId: "chapter_1",
        sceneId: "investigation_s",
        sceneSourcePath: "docs/stories_plan/chapter_1/investigation_s.md",
        carrierId: "character:npc1",
        carrierLabel: "character:npc1",
        role: "sprite",
        itemIndex: null,
        assetId: "portrait.hayasaka_akane.standard",
        type: "portrait",
      },
      {
        chapterId: "chapter_1",
        sceneId: "investigation_s",
        sceneSourcePath: "docs/stories_plan/chapter_1/investigation_s.md",
        carrierId: "character:npc2",
        carrierLabel: "character:npc2",
        role: "sprite",
        itemIndex: null,
        assetId: "evidence.door_log",
        type: "evidence",
      },
      {
        chapterId: "chapter_1",
        sceneId: "investigation_s",
        sceneSourcePath: "docs/stories_plan/chapter_1/investigation_s.md",
        carrierId: "character:npc3",
        carrierLabel: "character:npc3",
        role: "sprite",
        itemIndex: null,
        assetId: "background.chapter_1.investigation_s.wall",
        type: "background",
      },
    ]);
  });

  it("unresolved_manifest_usage_remains_visible", () => {
    const workspace = projectAssetWorkspace(
      payload({
        scenes: [scenePayload("scene_x", unresolvedScene)],
      }),
    );
    // The usage stays visible; the missing manifest entry surfaces as an
    // explicit unresolved diagnostic instead of a silent drop.
    expect(workspace.sceneUsages).toEqual([
      {
        chapterId: "chapter_1",
        sceneId: "scene_x",
        sceneSourcePath: "docs/stories_plan/chapter_1/scene_x.md",
        carrierId: "main",
        carrierLabel: "Main",
        role: "portrait",
        itemIndex: 0,
        assetId: "portrait.hayasaka_akane.concerned",
        type: null,
      },
    ]);
    const unresolved = workspace.diagnostics.filter(
      (diagnostic) => diagnostic.code === "assetUsageUnresolved",
    );
    expect(unresolved).toHaveLength(1);
    expect(unresolved[0]?.message).toContain(
      '"portrait.hayasaka_akane.concerned"',
    );
    expect(unresolved[0]?.sourceFile).toBe(
      "docs/stories_plan/chapter_1/scene_x.md",
    );
  });
});

describe("assetUsageGroups", () => {
  it("groups_portrait_usages_by_scene_and_keeps_cross_scene_order", () => {
    const workspace = projectAssetWorkspace(
      payload({
        scenes: [
          scenePayload("scene_u", portraitOccurrencesScene),
          scenePayload("scene_x", unresolvedScene),
        ],
      }),
    );

    // Two same-scene occurrences collapse to one scene group; a second
    // scene appends its own group in authored walk order.
    expect(
      assetUsageGroups(workspace, "portrait.hayasaka_akane.standard").scenes,
    ).toEqual([{ chapterId: "chapter_1", sceneId: "scene_u" }]);
    expect(
      assetUsageGroups(workspace, "portrait.hayasaka_akane.concerned").scenes,
    ).toEqual([
      { chapterId: "chapter_1", sceneId: "scene_u" },
      { chapterId: "chapter_1", sceneId: "scene_x" },
    ]);
    expect(
      assetUsageGroups(workspace, "portrait.hayasaka_akane.standard").sprites,
    ).toEqual([]);
  });

  it("sprite_usages_match_parsed_portrait_identity", () => {
    const workspace = projectAssetWorkspace(
      payload({
        manifest: spriteManifest(),
        scenes: [scenePayload("investigation_s", spriteScene)],
      }),
    );

    // The raw sprite layout references the portrait asset id; the related
    // sprite usage stays concrete while the non-sprite group stays empty.
    expect(
      assetUsageGroups(workspace, "portrait.hayasaka_akane.standard"),
    ).toEqual({
      scenes: [],
      sprites: [
        {
          chapterId: "chapter_1",
          sceneId: "investigation_s",
          sceneSourcePath: "docs/stories_plan/chapter_1/investigation_s.md",
          carrierId: "character:npc1",
          carrierLabel: "character:npc1",
          role: "sprite",
          itemIndex: null,
          assetId: "portrait.hayasaka_akane.standard",
          type: "portrait",
        },
      ],
    });
  });
});

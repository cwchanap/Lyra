import { describe, expect, it } from "vitest";
import { portraitAssetId } from "@lyra/asset-paths";
import {
  expectedPath,
  publicPath,
  type AssetManifest,
  type AssetManifestEntry,
} from "@lyra/scripts/compile-scenes/assets/manifest";
import type { AssetReport } from "@lyra/scripts/compile-scenes/orchestrator";
import { projectAssetWorkspace } from "./asset-workspace";
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
    existingAssetPaths: ["/assets/portraits/hayasaka_akane/standard.png"],
    ...overrides,
  };
}

describe("projectAssetWorkspace", () => {
  it("configured_unused_expression_uses_shared_identity_and_paths", () => {
    const workspace = projectAssetWorkspace(payload());

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

  it("referenced_manifest_fields_are_not_recomputed", () => {
    const workspace = projectAssetWorkspace(payload());

    // Library rows are the manifest entries themselves — verbatim.
    expect(workspace.library).toBe(manifest.entries);
    expect(workspace.manifest).toBe(manifest);
    expect(workspace.report).toBe(report);
    expect(workspace.scenes).toEqual([]);
    expect(workspace.existingAssetPaths).toEqual([
      "/assets/portraits/hayasaka_akane/standard.png",
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
    const workspace = projectAssetWorkspace(payload());

    // Join happens on the typed manifest source fields (entry.type ===
    // "audio" + source.channel/source.id) — never on a reconstructed
    // `audio.<channel>.<id>` string. The colliding "step" id proves channel
    // filtering: each channel's row counts only its own manifest entries.
    expect(workspace.audio.bgm).toEqual([
      {
        channel: "bgm",
        id: "rain",
        prompt: "soft tension",
        loop: true,
        usages: 1,
        referenced: true,
      },
      {
        channel: "bgm",
        id: "step",
        prompt: "bgm step",
        loop: true,
        usages: 1,
        referenced: true,
      },
    ]);
    expect(workspace.audio.bgs).toEqual([
      {
        channel: "bgs",
        id: "street_rain",
        prompt: "rain",
        loop: true,
        usages: 1,
        referenced: true,
      },
    ]);
    expect(workspace.audio.sfx).toEqual([
      {
        channel: "sfx",
        id: "step",
        prompt: "footstep",
        loop: true,
        usages: 1,
        referenced: true,
      },
    ]);
  });
});

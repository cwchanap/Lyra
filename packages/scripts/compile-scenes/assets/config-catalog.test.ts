import { describe, expect, it } from "vitest";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadAssetConfig } from "./config";
import { parseAudioYamlText, parseCharactersYamlText } from "./config-catalog";

const CHARACTERS_YAML = `
characters:
  - id: hayasaka_akane
    displayNames:
      - "  早坂茜  "
      - 茜
    portraitMode: none
    visualPrompt: ""
    expressions:
      standard:
        prompt: neutral
      concerned:
        prompt: worried
`;

const AUDIO_YAML = `
bgm:
  rain_mystery_low:
    prompt: soft tension
bgs:
  street_rain:
    prompt: rain
sfx:
  plastic_bag_crinkle:
    prompt: crinkle
  explicit_no_loop:
    prompt: one shot
    loop: false
`;

function withConfig(
  files: Record<string, string>,
  run: (root: string) => void,
) {
  const root = mkdtempSync(resolve(tmpdir(), "lyra-config-catalog-"));
  try {
    mkdirSync(root, { recursive: true });
    for (const [name, body] of Object.entries(files)) {
      writeFileSync(resolve(root, name), body);
    }
    run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe("config-catalog shared normalization", () => {
  it("shared_character_catalog_normalization_matches_compiler", () => {
    const parsed = parseCharactersYamlText(CHARACTERS_YAML, "characters.yaml");
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.errors).toEqual([]);
    expect(parsed.characters).toHaveLength(1);

    const character = parsed.characters[0]!;
    expect(character.id).toBe("hayasaka_akane");
    // Aliases: trimmed, flattened display names.
    expect(character.displayNames).toEqual(["早坂茜", "茜"]);
    expect(character.portraitMode).toBe("none");
    // Nullable identity fields: empty/absent normalize to null.
    expect(character.visualPrompt).toBeNull();
    expect(character.referenceAssetId).toBeNull();
    // Expression map preserved in authored order.
    expect([...character.expressions.keys()]).toEqual([
      "standard",
      "concerned",
    ]);
    expect(character.expressions.get("concerned")).toEqual({
      id: "concerned",
      prompt: "worried",
    });

    // Cross-check against the compiler's own normalization.
    withConfig(
      {
        "policy.yaml": "assets:\n  enabled: false\n",
        "characters.yaml": CHARACTERS_YAML,
        "audio.yaml": "bgm: {}\nbgs: {}\n",
      },
      (root) => {
        const result = loadAssetConfig(root);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        const compiled = result.value.characters.byId.get("hayasaka_akane");
        expect(compiled).toEqual({
          id: "hayasaka_akane",
          displayNames: ["早坂茜", "茜"],
          portraitMode: "none",
          visualPrompt: null,
          referenceAssetId: null,
          expressions: character.expressions,
        });
        // Both aliases resolve to the same character in the compiler catalog.
        expect(result.value.characters.byDisplayName.get("早坂茜")?.id).toBe(
          "hayasaka_akane",
        );
        expect(result.value.characters.byDisplayName.get("茜")?.id).toBe(
          "hayasaka_akane",
        );
      },
    );
  });

  it("shared_audio_catalog_defaults_missing_loop_to_true", () => {
    const parsed = parseAudioYamlText(AUDIO_YAML, "audio.yaml");
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.errors).toEqual([]);
    expect(parsed.audio.bgm.get("rain_mystery_low")?.loop).toBe(true);
    expect(parsed.audio.bgs.get("street_rain")?.loop).toBe(true);
    expect(parsed.audio.sfx.get("plastic_bag_crinkle")?.loop).toBe(true);
    // Explicit loop: false is preserved.
    expect(parsed.audio.sfx.get("explicit_no_loop")?.loop).toBe(false);
  });

  it("shared_catalog_reports_yaml_parse_failure_without_node_fs", () => {
    const moduleSource = readFileSync(
      fileURLToPath(new URL("./config-catalog.ts", import.meta.url)),
      "utf-8",
    );
    expect(moduleSource).toContain(`from "yaml"`);
    expect(moduleSource).not.toContain("node:fs");
    expect(moduleSource).not.toContain("node:path");

    const characters = parseCharactersYamlText(
      "characters: [unclosed\n",
      "characters.yaml",
    );
    expect(characters.ok).toBe(false);
    if (characters.ok) return;
    expect(characters.errors.map((e) => e.code)).toContain(
      "assetConfigUnreadable",
    );

    const audio = parseAudioYamlText("bgm: [unclosed\n", "audio.yaml");
    expect(audio.ok).toBe(false);
    if (audio.ok) return;
    expect(audio.errors.map((e) => e.code)).toContain("assetConfigUnreadable");

    // Empty documents normalize to empty catalogs, matching the compiler's
    // missing-file default.
    const empty = parseCharactersYamlText("", "characters.yaml");
    expect(empty.ok).toBe(true);
    if (!empty.ok) return;
    expect(empty.characters).toEqual([]);
  });
});

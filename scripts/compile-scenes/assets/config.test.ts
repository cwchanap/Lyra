import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { loadAssetConfig } from "./config";

function withConfig(files: Record<string, string>, run: (root: string) => void) {
  const root = mkdtempSync(resolve(tmpdir(), "lyra-assets-config-"));
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

describe("loadAssetConfig", () => {
  it("loads a disabled policy without requiring populated catalogs", () => {
    withConfig({
      "policy.yaml": "assets:\n  enabled: false\n",
      "characters.yaml": "characters: []\n",
      "audio.yaml": "bgm: {}\nbgs: {}\n",
    }, (root) => {
      const result = loadAssetConfig(root);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.enabled).toBe(false);
      expect(result.value.characters.byId.size).toBe(0);
    });
  });

  it("loads enabled policy, characters, and audio IDs", () => {
    withConfig({
      "policy.yaml": `
assets:
  enabled: true
globalStyle:
  prompt: noir rain visual novel
types:
  background:
    dimensions: [1920, 1080]
    format: png
    transparency: false
    prompt: wide background
  portrait:
    dimensions: [768, 1024]
    format: png
    transparency: true
    prompt: transparent portrait
  evidence:
    dimensions: [512, 512]
    format: png
    transparency: true
    prompt: evidence icon
  audio:
    format: ogg
    loop: true
`,
      "characters.yaml": `
characters:
  - id: hayasaka_akane
    displayNames: ["早坂茜"]
    portraitMode: portrait
    visualPrompt: attorney in dark suit
    expressions:
      standard:
        prompt: neutral
      concerned:
        prompt: worried
`,
      "audio.yaml": `
bgm:
  rain_mystery_low:
    prompt: soft tension
    loop: true
bgs:
  indoor_rain_window:
    prompt: rain against windows
    loop: true
`,
    }, (root) => {
      const result = loadAssetConfig(root);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.enabled).toBe(true);
      expect(result.value.characters.byDisplayName.get("早坂茜")?.id).toBe("hayasaka_akane");
      expect(result.value.audio.bgm.has("rain_mystery_low")).toBe(true);
      expect(result.value.audio.bgs.has("indoor_rain_window")).toBe(true);
    });
  });

  it("rejects enabled portrait characters without standard expression", () => {
    withConfig({
      "policy.yaml": `
assets:
  enabled: true
globalStyle:
  prompt: style
types:
  background:
    dimensions: [1920, 1080]
    format: png
    transparency: false
    prompt: bg
  portrait:
    dimensions: [768, 1024]
    format: png
    transparency: true
    prompt: portrait
  evidence:
    dimensions: [512, 512]
    format: png
    transparency: true
    prompt: evidence
  audio:
    format: ogg
    loop: true
`,
      "characters.yaml": `
characters:
  - id: bad
    displayNames: ["壞例"]
    portraitMode: portrait
    visualPrompt: person
    expressions:
      angry:
        prompt: angry
`,
      "audio.yaml": "bgm: {}\nbgs: {}\n",
    }, (root) => {
      const result = loadAssetConfig(root);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.errors.some((e) => e.code === "assetCharacterMissingStandardExpression")).toBe(true);
    });
  });

  it("rejects malformed character catalog shapes without throwing", () => {
    withConfig({
      "policy.yaml": "assets:\n  enabled: false\n",
      "characters.yaml": "characters: {}\n",
      "audio.yaml": "bgm: {}\nbgs: {}\n",
    }, (root) => {
      const result = loadAssetConfig(root);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.errors.some((e) => e.code === "assetCharactersMalformed")).toBe(true);
    });
  });

  it("rejects malformed character expression entries without throwing", () => {
    withConfig({
      "policy.yaml": "assets:\n  enabled: false\n",
      "characters.yaml": `
characters:
  - id: draft
    displayNames: ["草稿"]
    expressions:
      standard:
`,
      "audio.yaml": "bgm: {}\nbgs: {}\n",
    }, (root) => {
      const result = loadAssetConfig(root);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.errors.some((e) => e.code === "assetCharacterExpressionMalformed")).toBe(true);
    });
  });

  it("rejects malformed audio entries without throwing", () => {
    withConfig({
      "policy.yaml": "assets:\n  enabled: false\n",
      "characters.yaml": "characters: []\n",
      "audio.yaml": "bgm:\n  rain:\nbgs: {}\n",
    }, (root) => {
      const result = loadAssetConfig(root);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.errors.some((e) => e.code === "assetAudioEntryMalformed")).toBe(true);
    });
  });

  it("rejects duplicate character IDs", () => {
    withConfig({
      "policy.yaml": "assets:\n  enabled: false\n",
      "characters.yaml": `
characters:
  - id: same
    displayNames: ["一"]
  - id: same
    displayNames: ["二"]
`,
      "audio.yaml": "bgm: {}\nbgs: {}\n",
    }, (root) => {
      const result = loadAssetConfig(root);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.errors.some((e) => e.code === "assetCharacterDuplicateId")).toBe(true);
    });
  });

  it("rejects character IDs that are not safe path slugs", () => {
    withConfig({
      "policy.yaml": "assets:\n  enabled: false\n",
      "characters.yaml": `
characters:
  - id: ../hayasaka
    displayNames: ["早坂茜"]
`,
      "audio.yaml": "bgm: {}\nbgs: {}\n",
    }, (root) => {
      const result = loadAssetConfig(root);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.errors.some((e) => e.code === "assetCharacterIdMalformed")).toBe(true);
    });
  });

  it("rejects character expression IDs that are not safe path slugs", () => {
    withConfig({
      "policy.yaml": "assets:\n  enabled: false\n",
      "characters.yaml": `
characters:
  - id: hayasaka_akane
    displayNames: ["早坂茜"]
    expressions:
      ../concerned:
        prompt: worried
`,
      "audio.yaml": "bgm: {}\nbgs: {}\n",
    }, (root) => {
      const result = loadAssetConfig(root);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.errors.some((e) => e.code === "assetCharacterExpressionIdMalformed")).toBe(true);
    });
  });

  it("returns fresh disabled config maps when policy is missing", () => {
    withConfig({}, (root) => {
      const first = loadAssetConfig(root);
      expect(first.ok).toBe(true);
      if (!first.ok) return;
      first.value.characters.byId.set("mutated", {
        id: "mutated",
        displayNames: ["mutated"],
        portraitMode: "none",
        visualPrompt: null,
        referenceAssetId: null,
        expressions: new Map(),
      });

      const second = loadAssetConfig(root);
      expect(second.ok).toBe(true);
      if (!second.ok) return;
      expect(second.value.characters.byId.has("mutated")).toBe(false);
    });
  });

  it("allows disabled draft portrait characters without standard expression", () => {
    withConfig({
      "policy.yaml": "assets:\n  enabled: false\n",
      "characters.yaml": `
characters:
  - id: draft
    displayNames: ["草稿"]
    portraitMode: portrait
`,
      "audio.yaml": "bgm: {}\nbgs: {}\n",
    }, (root) => {
      const result = loadAssetConfig(root);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.characters.byId.get("draft")?.expressions.size).toBe(0);
    });
  });

  it("rejects character id that is not a string", () => {
    withConfig({
      "policy.yaml": "assets:\n  enabled: false\n",
      "characters.yaml": `
characters:
  - id: 42
    displayNames: ["數字"]
`,
      "audio.yaml": "bgm: {}\nbgs: {}\n",
    }, (root) => {
      const result = loadAssetConfig(root);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.errors.some((e) => e.code === "assetCharacterIdWrongType")).toBe(true);
    });
  });

  it("warns when displayNames entry is not a string", () => {
    withConfig({
      "policy.yaml": "assets:\n  enabled: false\n",
      "characters.yaml": `
characters:
  - id: test
    displayNames: [42, "valid"]
`,
      "audio.yaml": "bgm: {}\nbgs: {}\n",
    }, (root) => {
      const result = loadAssetConfig(root);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.warnings.some((w) => w.code === "assetConfigWrongType" && w.message.includes('"displayNames"'))).toBe(true);
      // The valid string entry is still parsed
      expect(result.value.characters.byDisplayName.has("valid")).toBe(true);
    });
  });

  it("rejects unsupported image format in type policy", () => {
    withConfig({
      "policy.yaml": `
assets:
  enabled: false
types:
  background:
    format: webp
`,
      "characters.yaml": "characters: []\n",
      "audio.yaml": "bgm: {}\nbgs: {}\n",
    }, (root) => {
      const result = loadAssetConfig(root);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.errors.some((e) => e.code === "assetPolicyUnsupportedFormat" && e.message.includes("webp"))).toBe(true);
    });
  });

  it("rejects unsupported audio format in type policy", () => {
    withConfig({
      "policy.yaml": `
assets:
  enabled: false
types:
  audio:
    format: mp3
`,
      "characters.yaml": "characters: []\n",
      "audio.yaml": "bgm: {}\nbgs: {}\n",
    }, (root) => {
      const result = loadAssetConfig(root);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.errors.some((e) => e.code === "assetPolicyUnsupportedFormat" && e.message.includes("mp3"))).toBe(true);
    });
  });

  it("accepts default formats without error", () => {
    withConfig({
      "policy.yaml": `
assets:
  enabled: false
types:
  background:
    format: png
  portrait:
    format: png
  evidence:
    format: png
  audio:
    format: ogg
`,
      "characters.yaml": "characters: []\n",
      "audio.yaml": "bgm: {}\nbgs: {}\n",
    }, (root) => {
      const result = loadAssetConfig(root);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.types.background.format).toBe("png");
      expect(result.value.types.audio.format).toBe("ogg");
    });
  });

  it("warns when policy.yaml is absent but sibling catalog files exist", () => {
    withConfig({
      "characters.yaml": `
characters:
  - id: hayasaka_akane
    displayNames: ["早坂茜"]
`,
      "audio.yaml": "bgm: {}\nbgs: {}\n",
    }, (root) => {
      const result = loadAssetConfig(root);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.enabled).toBe(false);
      expect(result.warnings.some((w) => w.code === "assetPolicyMissing")).toBe(true);
      expect(result.warnings[0]?.message).toContain("characters.yaml");
    });
  });

  it("returns no warnings when policy.yaml is absent and no siblings exist", () => {
    withConfig({}, (root) => {
      const result = loadAssetConfig(root);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.warnings).toEqual([]);
    });
  });

  it("warns when image type transparency is present but not boolean", () => {
    withConfig({
      "policy.yaml": `
assets:
  enabled: false
types:
  background:
    transparency: "yes"
`,
      "characters.yaml": "characters: []\n",
      "audio.yaml": "bgm: {}\nbgs: {}\n",
    }, (root) => {
      const result = loadAssetConfig(root);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.warnings.some((w) => w.code === "assetConfigWrongType" && w.message.includes('"types.background.transparency"'))).toBe(true);
      // Falls back to default (false for background)
      expect(result.value.types.background.transparency).toBe(false);
    });
  });

  it("warns when audio loop is present but not boolean", () => {
    withConfig({
      "policy.yaml": `
assets:
  enabled: false
types:
  audio:
    loop: "always"
`,
      "characters.yaml": "characters: []\n",
      "audio.yaml": "bgm: {}\nbgs: {}\n",
    }, (root) => {
      const result = loadAssetConfig(root);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.warnings.some((w) => w.code === "assetConfigWrongType" && w.message.includes('"types.audio.loop"'))).toBe(true);
      // Falls back to default (true)
      expect(result.value.types.audio.loop).toBe(true);
    });
  });

  it("does not warn when transparency is omitted", () => {
    withConfig({
      "policy.yaml": `
assets:
  enabled: false
types:
  background:
    format: png
`,
      "characters.yaml": "characters: []\n",
      "audio.yaml": "bgm: {}\nbgs: {}\n",
    }, (root) => {
      const result = loadAssetConfig(root);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.warnings.some((w) => w.message.includes("transparency"))).toBe(false);
    });
  });

  it("does not warn when transparency is a valid boolean", () => {
    withConfig({
      "policy.yaml": `
assets:
  enabled: false
types:
  portrait:
    transparency: true
`,
      "characters.yaml": "characters: []\n",
      "audio.yaml": "bgm: {}\nbgs: {}\n",
    }, (root) => {
      const result = loadAssetConfig(root);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.warnings.some((w) => w.message.includes("transparency"))).toBe(false);
      expect(result.value.types.portrait.transparency).toBe(true);
    });
  });

  it("warns when type dimensions are present but malformed", () => {
    withConfig({
      "policy.yaml": `
assets:
  enabled: false
types:
  background:
    dimensions: "not-array"
    format: png
`,
      "characters.yaml": "characters: []\n",
      "audio.yaml": "bgm: {}\nbgs: {}\n",
    }, (root) => {
      const result = loadAssetConfig(root);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.warnings.some((w) => w.code === "assetConfigWrongType" && w.message.includes('"types.background.dimensions"'))).toBe(true);
      // Falls back to default dimensions
      expect(result.value.types.background.dimensions).toEqual([1920, 1080]);
    });
  });

  it("warns when type dimensions contain zero or negative values", () => {
    withConfig({
      "policy.yaml": `
assets:
  enabled: false
types:
  background:
    dimensions: [0, -5]
    format: png
`,
      "characters.yaml": "characters: []\n",
      "audio.yaml": "bgm: {}\nbgs: {}\n",
    }, (root) => {
      const result = loadAssetConfig(root);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.warnings.some((w) => w.code === "assetConfigWrongType" && w.message.includes('"types.background.dimensions"'))).toBe(true);
      expect(result.value.types.background.dimensions).toEqual([1920, 1080]);
    });
  });

  it("warns when type dimensions contain non-integer values", () => {
    withConfig({
      "policy.yaml": `
assets:
  enabled: false
types:
  portrait:
    dimensions: [768.5, 1024.9]
    format: png
`,
      "characters.yaml": "characters: []\n",
      "audio.yaml": "bgm: {}\nbgs: {}\n",
    }, (root) => {
      const result = loadAssetConfig(root);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.warnings.some((w) => w.code === "assetConfigWrongType" && w.message.includes('"types.portrait.dimensions"'))).toBe(true);
      expect(result.value.types.portrait.dimensions).toEqual([768, 1024]);
    });
  });
});

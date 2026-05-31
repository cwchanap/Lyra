import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { parseInvestigationScene } from "./parser-investigation";

describe("parseInvestigationScene", () => {
  it("parses the valid fixture investigation scene end-to-end", () => {
    const source = readFileSync(
      "scripts/__fixtures__/valid/chapter_1/investigation_scene_1.md",
      "utf-8",
    );
    const result = parseInvestigationScene(
      source,
      "chapter_1/investigation_scene_1.md",
      "investigation_scene_1",
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const scene = result.value;
    expect(scene.title).toBe("測試調查場景");
    expect(scene.intro.length).toBeGreaterThan(0);

    expect(scene.sublocations).toHaveLength(2);
    expect(scene.sublocations[0]?.id).toBe("main_hall");
    expect(scene.sublocations[0]?.status).toBe("unlocked");
    expect(scene.sublocations[1]?.id).toBe("back_room");
    expect(scene.sublocations[1]?.status).toBe("locked");

    const mainHall = scene.sublocations[0]!;
    expect(mainHall.hotspots).toHaveLength(2);
    expect(mainHall.hotspots[0]?.id).toBe("table");
    expect(mainHall.hotspots[0]?.reveals).toEqual([
      { kind: "evidence", id: "coffee" },
      { kind: "sublocation", id: "back_room" },
    ]);
    expect(mainHall.hotspots[0]?.onReexamine).not.toBeNull();

    expect(mainHall.characters).toHaveLength(1);
    expect(mainHall.characters[0]?.id).toBe("witness");
    expect(mainHall.characters[0]?.topics).toHaveLength(2);
    expect(mainHall.characters[0]?.topics[0]?.onReexamine).not.toBeNull();
    expect(mainHall.characters[0]?.topics[1]?.status).toBe("locked");

    expect(scene.evidenceManifest).toHaveLength(2);
    expect(scene.evidenceManifest[0]?.id).toBe("coffee");
    expect(scene.evidenceManifest[0]?.onCollect.length).toBeGreaterThan(0);
    expect(scene.evidenceManifest[0]?.onReexamine).not.toBeNull();

    expect(scene.statementManifest).toHaveLength(1);
    expect(scene.statementManifest[0]?.id).toBe("witness_alibi");

    expect(scene.outro.unlock).not.toBe("auto");
    expect(scene.outro.dialogue.length).toBeGreaterThan(0);
  });

  it("defaults outro.unlock to 'auto' when not specified", () => {
    const source = `
# Scene 1: x

## Intro

**A**：hi

## Sub-location: room {#room}
- **Status:** unlocked

[場景：a room]

### Hotspot: thing {#thing}
- **Description:** a thing

**A**：observed.

## Evidence Manifest

## Statement Manifest

## Outro

**A**：done.
`.trim();
    const result = parseInvestigationScene(source, "i.md", "i");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.outro.unlock).toBe("auto");
  });

  it("parses sub-location background and audio metadata", () => {
    const source = `
# Scene 1: x

## Sub-location: room {#room}
- **Status:** unlocked
- **Background Prompt:** Dim detective office with rain outside.
- **BGM:** none
- **BGS:** indoor_rain_window

[場景：a room]

### Hotspot: thing {#thing}
- **Description:** a thing

**A**：observed.

## Evidence Manifest

### evidence:foo {#foo}
- **Name:** Foo
- **Description:** A foo.
- **Details:** Detail.
- **Image Prompt:** Small brass key on transparent background.

#### On Collect

**A**：collected.

## Outro

**A**：done.
`.trim();
    const result = parseInvestigationScene(source, "i.md", "i");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.sublocations[0]?.assetCue).toMatchObject({
      backgroundPrompt: "Dim detective office with rain outside.",
      bgm: { channel: "bgm", assetId: null },
      bgs: { channel: "bgs", assetId: "indoor_rain_window" },
    });
    expect(result.value.evidenceManifest[0]?.imageCue.imagePrompt).toBe(
      "Small brass key on transparent background.",
    );
  });

  it("rejects evidence image metadata on a sub-location", () => {
    const source = `
# Scene 1: x

## Sub-location: room {#room}
- **Status:** unlocked
- **Image Prompt:** Small brass key on transparent background.

[場景：a room]

### Hotspot: thing {#thing}
- **Description:** a thing

**A**：observed.

## Outro

**A**：done.
`.trim();
    const result = parseInvestigationScene(source, "i.md", "i");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("assetMetadataUnknownKey");
  });

  it("rejects visual audio metadata on evidence", () => {
    const source = `
# Scene 1: x

## Sub-location: room {#room}
- **Status:** unlocked

[場景：a room]

### Hotspot: thing {#thing}
- **Description:** a thing

**A**：observed.

## Evidence Manifest

### evidence:foo {#foo}
- **Name:** Foo
- **Description:** A foo.
- **Details:** Detail.
- **BGM:** rain_mystery_low

#### On Collect

**A**：collected.

## Outro

**A**：done.
`.trim();
    const result = parseInvestigationScene(source, "i.md", "i");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("assetMetadataUnknownKey");
  });

  it("rejects reserved asset metadata on a hotspot", () => {
    const source = `
# Scene 1: x

## Sub-location: room {#room}
- **Status:** unlocked

[場景：a room]

### Hotspot: thing {#thing}
- **Description:** a thing
- **BGM:** rain_mystery_low

**A**：observed.

## Outro

**A**：done.
`.trim();
    const result = parseInvestigationScene(source, "i.md", "i");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("assetMetadataUnknownKey");
  });

  it("rejects reserved asset metadata on statement manifest entries", () => {
    const source = `
# Scene 1: x

## Sub-location: room {#room}
- **Status:** unlocked

[場景：a room]

### Hotspot: thing {#thing}
- **Description:** a thing

**A**：observed.

## Statement Manifest

### statement:foo {#foo}
- **Speaker:** A
- **Content:** Foo.
- **Image Prompt:** Small brass key on transparent background.

#### On Acquire

**A**：acquired.

## Outro

**A**：done.
`.trim();
    const result = parseInvestigationScene(source, "i.md", "i");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("assetMetadataUnknownKey");
  });

  it("defaults evidence image prompts to null", () => {
    const source = `
# Scene 1: x

## Sub-location: room {#room}
- **Status:** unlocked

[場景：a room]

### Hotspot: thing {#thing}
- **Description:** a thing

**A**：observed.

## Evidence Manifest

### evidence:foo {#foo}
- **Name:** Foo
- **Description:** A foo.
- **Details:** Detail.

#### On Collect

**A**：collected.

## Outro

**A**：done.
`.trim();
    const result = parseInvestigationScene(source, "i.md", "i");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.evidenceManifest[0]?.imageCue.imagePrompt).toBeNull();
  });

  it("rejects an investigation scene with no H1 title", () => {
    const source = `## Intro\n**A**：hi`;
    const result = parseInvestigationScene(source, "i.md", "i");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("investigationSceneMissingTitle");
  });

  it("rejects a sub-location without a scene tag", () => {
    const source = `
# Scene 1: x

## Sub-location: room {#room}
- **Status:** unlocked

### Hotspot: thing {#thing}
- **Description:** a thing

## Outro
`.trim();
    const result = parseInvestigationScene(source, "i.md", "i");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("sublocationNoSceneTag");
  });

  it("rejects a sub-location with no Status (Status is required)", () => {
    const source = `
# Scene 1: x

## Sub-location: room {#room}

[場景：a room]

### Hotspot: thing {#thing}
- **Description:** a thing

**A**：observed.

## Outro
`.trim();
    const result = parseInvestigationScene(source, "i.md", "i");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("sublocationMissingStatus");
  });

  it("rejects an invalid Status value on a sub-location", () => {
    const source = `
# Scene 1: x

## Sub-location: room {#room}
- **Status:** lockd

[場景：a room]

### Hotspot: thing {#thing}
- **Description:** a thing

**A**：observed.

## Outro
`.trim();
    const result = parseInvestigationScene(source, "i.md", "i");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("invalidStatusValue");
  });

  it("rejects an unrecognized dialogue line (typo'd speaker markup)", () => {
    const source = `
# Scene 1: x

## Intro

A：bad line missing the bold markup

## Sub-location: room {#room}
- **Status:** unlocked

[場景：a room]

### Hotspot: thing {#thing}
- **Description:** a thing

## Outro
`.trim();
    const result = parseInvestigationScene(source, "i.md", "i");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("unrecognizedDialogueLine");
  });

  it("rejects a stray H4 heading inside a sub-location body", () => {
    const source = `
# Scene 1: x

## Intro

**A**：hi

## Sub-location: room {#room}
- **Status:** unlocked

[場景：a room]

#### On Reexam

**A**：oops wrong heading

### Hotspot: thing {#thing}
- **Description:** a thing

**A**：observed.

## Outro

**A**：done.
`.trim();
    const result = parseInvestigationScene(source, "i.md", "i");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("sublocationStrayHeading");
  });

  it("parses an On Reexamine block for an evidence entry", () => {
    const source = `
# Scene 1: x

## Sub-location: room {#room}
- **Status:** unlocked

[場景：a room]

### Hotspot: thing {#thing}
- **Description:** a thing

## Evidence Manifest

### evidence:foo {#foo}
- **Name:** Foo
- **Description:** A foo.
- **Details:** Detail.

#### On Collect

**A**：collected.

#### On Reexamine

**A**：reexamined.

## Outro
`.trim();
    const result = parseInvestigationScene(source, "i.md", "i");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(
      result.value.evidenceManifest[0]?.onReexamine?.length,
    ).toBeGreaterThan(0);
  });

  it("rejects a hotspot with Unlock but no Status (defaults to unlocked)", () => {
    const source = `
# Scene 1: x

## Sub-location: room {#room}
- **Status:** unlocked

[場景：a room]

### Hotspot: thing {#thing}
- **Description:** a thing
- **Unlock:** evidence:key collected

**A**：observed.

## Outro
`.trim();
    const result = parseInvestigationScene(source, "i.md", "i");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("unlockOnNonLockedBlock");
  });

  it("rejects a hotspot with Unlock and Status: unlocked", () => {
    const source = `
# Scene 1: x

## Sub-location: room {#room}
- **Status:** unlocked

[場景：a room]

### Hotspot: thing {#thing}
- **Description:** a thing
- **Status:** unlocked
- **Unlock:** evidence:key collected

**A**：observed.

## Outro
`.trim();
    const result = parseInvestigationScene(source, "i.md", "i");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("unlockOnNonLockedBlock");
  });

  it("rejects a topic with Unlock but no Status (defaults to unlocked)", () => {
    const source = `
# Scene 1: x

## Sub-location: room {#room}
- **Status:** unlocked

[場景：a room]

### Character: npc {#npc}
- **Role:** witness
- **Bio:** bio

#### Topic: secret {#secret}
- **Label:** Secret
- **Unlock:** evidence:key collected

**npc**：secret.

## Outro
`.trim();
    const result = parseInvestigationScene(source, "i.md", "i");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("unlockOnNonLockedBlock");
  });
});

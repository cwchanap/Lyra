# Evidence Source Asset Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add explicit investigation hotspot evidence-source semantics, use them in asset background prompts, audit existing scenes, migrate the known Chapter 1 cases, and surface the classification in the layout editor.

**Architecture:** Keep story semantics in investigation Markdown and compile them into JSON. Parser/types carry `evidenceSource` and `sceneSourcePrompt`; asset enrichment validates enabled-corpus requirements and appends source guidance to background manifest prompts; the layout editor reads compiled JSON and changes only review/preview behavior, not authored Markdown.

**Tech Stack:** Bun, TypeScript, Vitest, Svelte 5 runes, existing Lyra scene compiler, existing Tauri layout-editor app.

---

## File Structure

- Modify `scripts/compile-scenes/types.ts`: add `EvidenceSource` and carry hotspot source fields through AST and emitted JSON types.
- Modify `scripts/compile-scenes/parser-investigation.ts`: parse `Evidence Source` and `Scene Source Prompt` on hotspot metadata, reject invalid values and impossible combinations.
- Modify `scripts/compile-scenes/parser-investigation.test.ts`: parser coverage for valid metadata, invalid source values, source prompt without source, and source on non-evidence hotspot.
- Modify `scripts/compile-scenes/emitter.ts`: emit `evidenceSource` and `sceneSourcePrompt` on investigation hotspots.
- Modify `scripts/compile-scenes/assets/enrich.ts`: enforce missing `Evidence Source` only when assets are enabled, and append sub-location source guidance to background manifest prompts.
- Modify `scripts/compile-scenes/assets/enrich.test.ts`: manifest prompt and enabled-validation coverage.
- Create `scripts/compile-scenes/evidence-sources-audit.ts`: scan playable investigation scenes and report current/suggested evidence-source classifications.
- Create `scripts/compile-scenes/evidence-sources-audit.test.ts`: unit tests for source suggestion and report shape.
- Modify `package.json`: add `evidence-sources:audit`.
- Modify `.claude/skills/writing-investigation-scene/SKILL.md`: document hotspot evidence-source metadata for writers.
- Modify `docs/stories_plan/chapter_1/investigation_scene_1.md`: mark `kagami_summary_hotspot` as `visible`.
- Modify `docs/stories_plan/chapter_1/investigation_scene_3.md`: mark `cctv_playback` as `implied` and `timecard` as `hidden`.
- Modify `apps/layout-editor/src/lib/layout-types.ts`: expose compiled hotspot source metadata to the editor.
- Modify `apps/layout-editor/src/lib/EditorCanvas.svelte`: render source badges, missing-source attention state, and source-aware hotspot previews.
- Modify `apps/layout-editor/src/lib/EditorCanvas.test.ts`: test badges and preview behavior.

## Task 1: Parser, Types, And JSON Contract

**Files:**
- Modify: `scripts/compile-scenes/types.ts`
- Modify: `scripts/compile-scenes/parser-investigation.ts`
- Modify: `scripts/compile-scenes/parser-investigation.test.ts`
- Modify: `scripts/compile-scenes/emitter.ts`

- [ ] **Step 1: Write parser tests for hotspot source metadata**

Add these tests to `scripts/compile-scenes/parser-investigation.test.ts` near the existing hotspot metadata tests:

```ts
it("parses evidence source metadata on a hotspot that reveals evidence", () => {
  const source = `
# Scene 1: x

## Sub-location: room {#room}
- **Status:** unlocked

[場景：a room]

### Hotspot: monitor {#monitor}
- **Description:** a small security monitor.
- **Reveals:** [evidence:cctv_screenshot]
- **Evidence Source:** implied
- **Scene Source Prompt:** Small security monitor beside the register, powered on but not showing readable footage.

**A**：observed.

## Evidence Manifest

### evidence:cctv_screenshot {#cctv_screenshot}
- **Name:** CCTV
- **Description:** A CCTV still.
- **Details:** The still shows a movement route.
- **Image Prompt:** Square CCTV still evidence icon, unreadable content.

#### On Collect

**A**：collected.

## Outro

**A**：done.
`.trim();

  const result = parseInvestigationScene(source, "i.md", "i");
  expect(result.ok).toBe(true);
  if (!result.ok) return;

  const hotspot = result.value.sublocations[0]?.hotspots[0];
  expect(hotspot).toMatchObject({
    id: "monitor",
    evidenceSource: "implied",
    sceneSourcePrompt:
      "Small security monitor beside the register, powered on but not showing readable footage.",
  });
});

it("rejects an invalid evidence source value", () => {
  const source = `
# Scene 1: x

## Sub-location: room {#room}
- **Status:** unlocked

[場景：a room]

### Hotspot: monitor {#monitor}
- **Description:** a small security monitor.
- **Reveals:** [evidence:cctv_screenshot]
- **Evidence Source:** screen

**A**：observed.

## Evidence Manifest

### evidence:cctv_screenshot {#cctv_screenshot}
- **Name:** CCTV
- **Description:** A CCTV still.
- **Details:** The still shows a movement route.

#### On Collect

**A**：collected.

## Outro

**A**：done.
`.trim();

  const result = parseInvestigationScene(source, "i.md", "i");
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.error.code).toBe("hotspotEvidenceSourceInvalid");
  expect(result.error.message).toContain("visible, implied, or hidden");
});

it("rejects a scene source prompt without evidence source", () => {
  const source = `
# Scene 1: x

## Sub-location: room {#room}
- **Status:** unlocked

[場景：a room]

### Hotspot: monitor {#monitor}
- **Description:** a small security monitor.
- **Reveals:** [evidence:cctv_screenshot]
- **Scene Source Prompt:** Small security monitor beside the register.

**A**：observed.

## Evidence Manifest

### evidence:cctv_screenshot {#cctv_screenshot}
- **Name:** CCTV
- **Description:** A CCTV still.
- **Details:** The still shows a movement route.

#### On Collect

**A**：collected.

## Outro

**A**：done.
`.trim();

  const result = parseInvestigationScene(source, "i.md", "i");
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.error.code).toBe("hotspotSceneSourcePromptWithoutSource");
});

it("rejects evidence source on a hotspot that does not reveal evidence", () => {
  const source = `
# Scene 1: x

## Sub-location: room {#room}
- **Status:** unlocked

[場景：a room]

### Hotspot: desk {#desk}
- **Description:** a desk.
- **Evidence Source:** visible

**A**：observed.

## Outro

**A**：done.
`.trim();

  const result = parseInvestigationScene(source, "i.md", "i");
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.error.code).toBe("hotspotEvidenceSourceWithoutEvidenceReveal");
});
```

- [ ] **Step 2: Run parser tests and verify they fail**

Run:

```bash
bunx vitest run --config vitest.scripts.config.ts scripts/compile-scenes/parser-investigation.test.ts
```

Expected: the new tests fail because `evidenceSource` and `sceneSourcePrompt` are not parsed yet.

- [ ] **Step 3: Add shared evidence source types**

In `scripts/compile-scenes/types.ts`, add the type near the shared atoms:

```ts
export type EvidenceSource = "visible" | "implied" | "hidden";
```

Extend `ASTHotspot`:

```ts
export type ASTHotspot = Located<{
  id: string;
  label: string;
  description: string;
  status: "locked" | "unlocked";
  unlock: UnlockExpr | null;
  reveals: RevealTarget[];
  evidenceSource: EvidenceSource | null;
  sceneSourcePrompt: string | null;
  inspectDialogue: DialogueItem[];
  onReexamine: DialogueItem[] | null;
  layout?: RectLayout | null;
}>;
```

Extend `JSONInvestigationScene` hotspot entries:

```ts
hotspots: Array<{
  id: string;
  label: string;
  description: string;
  status: "locked" | "unlocked";
  unlock: UnlockExpr | null;
  reveals: RevealTarget[];
  evidenceSource: EvidenceSource | null;
  sceneSourcePrompt: string | null;
  inspectDialogue: JSONDialogueItem[];
  onReexamine: JSONDialogueItem[] | null;
  layout: JSONHotspotLayout | null;
}>;
```

- [ ] **Step 4: Parse hotspot evidence-source metadata**

In `scripts/compile-scenes/parser-investigation.ts`, import `EvidenceSource` from `./types`.

Inside `parseHotspot`, after `reveals` is parsed and before `consumeDialogueUntilHeading`, add:

```ts
  const evidenceSource = parseEvidenceSource(
    meta.value["Evidence Source"],
    cur.sourceFile,
    head.line,
  );
  if (!evidenceSource.ok) return evidenceSource;

  const sceneSourcePrompt = meta.value["Scene Source Prompt"] ?? null;
  if (sceneSourcePrompt && !evidenceSource.value) {
    return fail(
      cur.sourceFile,
      head.line,
      "hotspotSceneSourcePromptWithoutSource",
      `Hotspot ${id} declares Scene Source Prompt but does not declare Evidence Source.`,
    );
  }

  const revealsEvidence = reveals.value.some(
    (reveal) => reveal.kind === "evidence",
  );
  if (evidenceSource.value && !revealsEvidence) {
    return fail(
      cur.sourceFile,
      head.line,
      "hotspotEvidenceSourceWithoutEvidenceReveal",
      `Hotspot ${id} declares Evidence Source but does not reveal evidence.`,
    );
  }
```

Add the fields to the returned hotspot value:

```ts
      evidenceSource: evidenceSource.value,
      sceneSourcePrompt,
```

Add this helper near `validateStatus`:

```ts
function parseEvidenceSource(
  raw: string | undefined,
  sourceFile: string,
  line: number,
):
  | { ok: true; value: EvidenceSource | null }
  | { ok: false; error: CompileError } {
  if (raw === undefined) return { ok: true, value: null };
  if (raw === "visible" || raw === "implied" || raw === "hidden") {
    return { ok: true, value: raw };
  }
  return fail(
    sourceFile,
    line,
    "hotspotEvidenceSourceInvalid",
    `Evidence Source must be visible, implied, or hidden; got "${raw}".`,
  );
}
```

- [ ] **Step 5: Emit source metadata into investigation JSON**

In `scripts/compile-scenes/emitter.ts`, extend the hotspot object in `emitInvestigationScene`:

```ts
      hotspots: sub.hotspots.map((h) => ({
        id: h.id,
        label: h.label,
        description: h.description,
        status: h.status,
        unlock: h.unlock,
        reveals: h.reveals,
        evidenceSource: h.evidenceSource,
        sceneSourcePrompt: h.sceneSourcePrompt,
        inspectDialogue: emitDialogueItems(h.inspectDialogue),
        onReexamine: emitNullableDialogueItems(h.onReexamine),
        layout: h.layout ?? null,
      })),
```

- [ ] **Step 6: Run parser tests and verify they pass**

Run:

```bash
bunx vitest run --config vitest.scripts.config.ts scripts/compile-scenes/parser-investigation.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit parser contract**

Run:

```bash
git add scripts/compile-scenes/types.ts scripts/compile-scenes/parser-investigation.ts scripts/compile-scenes/parser-investigation.test.ts scripts/compile-scenes/emitter.ts
git commit -m "feat(scenes): parse evidence source metadata"
```

## Task 2: Asset Validation And Background Prompt Guidance

**Files:**
- Modify: `scripts/compile-scenes/assets/enrich.ts`
- Modify: `scripts/compile-scenes/assets/enrich.test.ts`

- [ ] **Step 1: Write failing enrichment tests**

Add these tests to `scripts/compile-scenes/assets/enrich.test.ts`:

```ts
it("adds investigation source guidance to sublocation background prompts", () => {
  const scenes: SceneRecord[] = [
    {
      chapterId: "chapter_1",
      file: "investigation_scene_3.md",
      ast: {
        kind: "investigationScene",
        id: "investigation_scene_3",
        title: "調查",
        intro: [],
        sublocations: [
          {
            id: "front",
            label: "前場",
            status: "unlocked",
            unlock: null,
            reveals: [],
            sceneTag: "前場",
            assetCue: {
              backgroundPrompt: "Rain Bell cafe front room.",
              backgroundAssetId: null,
              bgm: { channel: "bgm", assetId: "rain_mystery_low" },
              bgs: { channel: "bgs", assetId: "street_rain" },
            },
            transitionDialogue: [],
            hotspots: [
              {
                id: "cctv_playback",
                label: "閉店監視器回放",
                description: "收銀台旁的小螢幕還能調出閉店前的監視器畫面。",
                status: "unlocked",
                unlock: null,
                reveals: [{ kind: "evidence", id: "cctv_screenshot" }],
                evidenceSource: "implied",
                sceneSourcePrompt:
                  "Small counter security monitor, powered on but not showing readable footage.",
                inspectDialogue: [],
                onReexamine: null,
                sourceFile: "chapter_1/investigation_scene_3.md",
                line: 20,
              },
              {
                id: "timecard",
                label: "三宅打卡紀錄",
                description: "收銀台後貼著當月的打卡表。",
                status: "unlocked",
                unlock: null,
                reveals: [{ kind: "evidence", id: "timecard_record" }],
                evidenceSource: "hidden",
                sceneSourcePrompt: null,
                inspectDialogue: [],
                onReexamine: null,
                sourceFile: "chapter_1/investigation_scene_3.md",
                line: 30,
              },
            ],
            characters: [],
            sourceFile: "chapter_1/investigation_scene_3.md",
            line: 10,
          },
        ],
        evidenceManifest: [
          {
            id: "cctv_screenshot",
            name: "閉店監視器回放",
            description: "CCTV playback.",
            details: "A playback still.",
            imageCue: {
              imagePrompt: "Square CCTV still icon with unreadable content.",
              imageAssetId: null,
            },
            onCollect: [],
            onReexamine: null,
            sourceFile: "chapter_1/investigation_scene_3.md",
            line: 100,
          },
          {
            id: "timecard_record",
            name: "三宅打卡紀錄",
            description: "Timecard record.",
            details: "A record that should not appear in the room.",
            imageCue: {
              imagePrompt: "Square timecard record icon with unreadable marks.",
              imageAssetId: null,
            },
            onCollect: [],
            onReexamine: null,
            sourceFile: "chapter_1/investigation_scene_3.md",
            line: 110,
          },
        ],
        statementManifest: [],
        outro: { unlock: "auto", dialogue: [] },
        assetRefs: [],
        sourceFile: "chapter_1/investigation_scene_3.md",
        line: 1,
      },
    },
  ];

  const result = enrichScenesWithAssets({ scenes, config: config() });
  expect(result.errors).toEqual([]);
  const background = result.manifest.entries.find(
    (entry) =>
      entry.assetId ===
      "background.chapter_1.investigation_scene_3.front",
  );

  expect(background?.promptParts.entryPrompt).toContain(
    "Investigation source guidance:",
  );
  expect(background?.promptParts.entryPrompt).toContain(
    "implied: cctv_playback",
  );
  expect(background?.promptParts.entryPrompt).toContain(
    "do not show the collected evidence image or readable evidence content",
  );
  expect(background?.promptParts.entryPrompt).toContain("hidden: timecard");
  expect(background?.promptParts.entryPrompt).toContain(
    "Do not show 三宅打卡紀錄",
  );
});

it("requires evidence source for evidence-revealing hotspots when assets are enabled", () => {
  const scenes: SceneRecord[] = [
    {
      chapterId: "chapter_1",
      file: "investigation_scene_1.md",
      ast: {
        kind: "investigationScene",
        id: "investigation_scene_1",
        title: "調查",
        intro: [],
        sublocations: [
          {
            id: "office",
            label: "事務所",
            status: "unlocked",
            unlock: null,
            reveals: [],
            sceneTag: "事務所",
            assetCue: {
              backgroundPrompt: "Detective office.",
              backgroundAssetId: null,
              bgm: { channel: "bgm", assetId: "rain_mystery_low" },
              bgs: { channel: "bgs", assetId: "street_rain" },
            },
            transitionDialogue: [],
            hotspots: [
              {
                id: "kagami_summary_hotspot",
                label: "KAGAMI 摘要副本",
                description: "桌上攤著一份 KAGAMI 系統輸出的摘要副本。",
                status: "unlocked",
                unlock: null,
                reveals: [{ kind: "evidence", id: "kagami_summary" }],
                evidenceSource: null,
                sceneSourcePrompt: null,
                inspectDialogue: [],
                onReexamine: null,
                sourceFile: "chapter_1/investigation_scene_1.md",
                line: 51,
              },
            ],
            characters: [],
            sourceFile: "chapter_1/investigation_scene_1.md",
            line: 10,
          },
        ],
        evidenceManifest: [
          {
            id: "kagami_summary",
            name: "KAGAMI 摘要副本",
            description: "Official summary.",
            details: "Official summary details.",
            imageCue: {
              imagePrompt: "Official summary document icon.",
              imageAssetId: null,
            },
            onCollect: [],
            onReexamine: null,
            sourceFile: "chapter_1/investigation_scene_1.md",
            line: 80,
          },
        ],
        statementManifest: [],
        outro: { unlock: "auto", dialogue: [] },
        assetRefs: [],
        sourceFile: "chapter_1/investigation_scene_1.md",
        line: 1,
      },
    },
  ];

  const result = enrichScenesWithAssets({ scenes, config: config() });
  expect(result.errors).toContainEqual(
    expect.objectContaining({
      code: "hotspotEvidenceSourceMissing",
      sourceFile: "chapter_1/investigation_scene_1.md",
      line: 51,
    }),
  );
});
```

- [ ] **Step 2: Run enrichment tests and verify they fail**

Run:

```bash
bunx vitest run --config vitest.scripts.config.ts scripts/compile-scenes/assets/enrich.test.ts
```

Expected: FAIL because background prompts do not include source guidance and missing source metadata is not validated.

- [ ] **Step 3: Add hotspot evidence-source validation**

In `scripts/compile-scenes/assets/enrich.ts`, add this helper:

```ts
function validateHotspotEvidenceSources(
  hotspots: ASTInvestigationScene["sublocations"][number]["hotspots"],
  context: EnrichContext,
): void {
  for (const hotspot of hotspots) {
    const evidenceReveals = hotspot.reveals.filter(
      (reveal) => reveal.kind === "evidence",
    );
    if (evidenceReveals.length === 0) continue;
    if (hotspot.evidenceSource) continue;

    context.errors.push(
      compileError(
        hotspot.sourceFile,
        hotspot.line,
        "hotspotEvidenceSourceMissing",
        `Hotspot "${hotspot.id}" reveals evidence but does not declare Evidence Source.`,
      ),
    );
  }
}
```

Call it at the start of each sublocation mapping in `enrichInvestigationScene`:

```ts
    sublocations: ast.sublocations.map((sub) => {
      validateHotspotEvidenceSources(sub.hotspots, context);
      const evidenceNameById = new Map(
        ast.evidenceManifest.map((evidence) => [evidence.id, evidence.name]),
      );
      return {
        ...sub,
        assetCue: enrichVisualCue(
          sub.assetCue,
          `${sub.id}`,
          sub.sourceFile,
          sub.line,
          context,
          sourceGuidanceForSublocation(sub, evidenceNameById),
        ),
        transitionDialogue: enrichDialogue(sub.transitionDialogue, context),
        hotspots: sub.hotspots.map((hotspot) => ({
          ...hotspot,
          inspectDialogue: enrichDialogue(hotspot.inspectDialogue, context),
          onReexamine: enrichNullableDialogue(hotspot.onReexamine, context),
        })),
        characters: sub.characters.map((character) => {
          enrichCharacterSpriteLayout(character, context);
          return {
            ...character,
            topics: character.topics.map((topic) => ({
              ...topic,
              topicDialogue: enrichDialogue(topic.topicDialogue, context),
              onReexamine: enrichNullableDialogue(topic.onReexamine, context),
            })),
          };
        }),
      };
    }),
```

- [ ] **Step 4: Add source-guidance prompt construction**

In `scripts/compile-scenes/assets/enrich.ts`, add this helper below `enrichInterrogationPhase`:

```ts
function sourceGuidanceForSublocation(
  sublocation: ASTInvestigationScene["sublocations"][number],
  evidenceNameById: Map<string, string>,
): string {
  const lines: string[] = [];

  for (const hotspot of sublocation.hotspots) {
    if (!hotspot.evidenceSource) continue;
    const evidenceNames = hotspot.reveals
      .filter((reveal) => reveal.kind === "evidence")
      .map((reveal) => evidenceNameById.get(reveal.id) ?? reveal.id)
      .join(", ");

    const sourceText =
      hotspot.sceneSourcePrompt ??
      `${hotspot.label}: ${hotspot.description}`;

    if (hotspot.evidenceSource === "visible") {
      lines.push(`- visible: ${hotspot.id}. Include ${sourceText}.`);
    } else if (hotspot.evidenceSource === "implied") {
      lines.push(
        `- implied: ${hotspot.id}. Include ${sourceText}; do not show the collected evidence image or readable evidence content for ${evidenceNames}.`,
      );
    } else {
      lines.push(
        `- hidden: ${hotspot.id}. Do not show ${evidenceNames}, the collected evidence image, or readable source record in the background.`,
      );
    }
  }

  if (lines.length === 0) return "";
  return `Investigation source guidance:\n${lines.join("\n")}`;
}
```

Update `enrichVisualCue` signature:

```ts
function enrichVisualCue(
  cue: VisualAssetCue | null,
  unitId: string,
  sourceFile: string,
  line: number,
  context: EnrichContext,
  promptSuffix = "",
): VisualAssetCue | null {
```

Update the background manifest request inside `enrichVisualCue`:

```ts
  putRequest(context.requests, {
    assetId: backgroundAssetId,
    type: "background",
    source: {
      chapterId: context.scene.chapterId,
      sceneId: context.scene.ast.id,
      unitId,
    },
    prompt: [cue.backgroundPrompt, promptSuffix].filter(Boolean).join("\n\n"),
  });
```

- [ ] **Step 5: Run enrichment tests and verify they pass**

Run:

```bash
bunx vitest run --config vitest.scripts.config.ts scripts/compile-scenes/assets/enrich.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit asset validation and prompt guidance**

Run:

```bash
git add scripts/compile-scenes/assets/enrich.ts scripts/compile-scenes/assets/enrich.test.ts
git commit -m "feat(assets): add evidence source prompt guidance"
```

## Task 3: Evidence Source Audit Command

**Files:**
- Create: `scripts/compile-scenes/evidence-sources-audit.ts`
- Create: `scripts/compile-scenes/evidence-sources-audit.test.ts`
- Modify: `package.json`

- [ ] **Step 1: Write audit tests**

Create `scripts/compile-scenes/evidence-sources-audit.test.ts`:

```ts
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  auditEvidenceSources,
  suggestEvidenceSource,
} from "./evidence-sources-audit";

describe("suggestEvidenceSource", () => {
  it("suggests implied for monitor and playback wording", () => {
    expect(
      suggestEvidenceSource({
        label: "閉店監視器回放",
        description: "收銀台旁的小螢幕還能調出閉店前的監視器畫面。",
      }),
    ).toBe("implied");
  });

  it("suggests hidden for timecard and record wording", () => {
    expect(
      suggestEvidenceSource({
        label: "三宅打卡紀錄",
        description: "系統查詢到當晚的打卡資料。",
      }),
    ).toBe("hidden");
  });

  it("suggests visible for physical document wording", () => {
    expect(
      suggestEvidenceSource({
        label: "KAGAMI 摘要副本",
        description: "桌上攤著一份 KAGAMI 系統輸出的摘要副本。",
      }),
    ).toBe("visible");
  });
});

describe("auditEvidenceSources", () => {
  it("reports evidence-revealing hotspots with suggested source values", () => {
    const root = mkdtempSync(resolve(tmpdir(), "lyra-source-audit-"));
    const chapterDir = resolve(root, "chapter_1");
    mkdirSync(chapterDir, { recursive: true });
    writeFileSync(
      resolve(chapterDir, "chapter.md"),
      `
# Chapter 1: Test

Summary: Test summary.

Scenes:
- investigation_scene_1.md
`.trim(),
    );
    writeFileSync(
      resolve(chapterDir, "investigation_scene_1.md"),
      `
# Scene 1: Test

## Sub-location: room {#room}
- **Status:** unlocked

[場景：a room]

### Hotspot: 閉店監視器回放 {#cctv_playback}
- **Description:** 收銀台旁的小螢幕還能調出閉店前的監視器畫面。
- **Reveals:** [evidence:cctv_screenshot]

**A**：observed.

## Evidence Manifest

### evidence:cctv_screenshot {#cctv_screenshot}
- **Name:** 閉店監視器回放
- **Description:** CCTV still.
- **Details:** Detail.
- **Image Prompt:** Square CCTV still icon.

#### On Collect

**A**：collected.

## Outro

**A**：done.
`.trim(),
    );

    const report = auditEvidenceSources([root]);
    expect(report).toEqual([
      expect.objectContaining({
        sceneFile: "chapter_1/investigation_scene_1.md",
        sublocationId: "room",
        hotspotId: "cctv_playback",
        currentSource: null,
        suggestedSource: "implied",
        evidence: [
          {
            id: "cctv_screenshot",
            name: "閉店監視器回放",
            imagePrompt: "Square CCTV still icon.",
          },
        ],
      }),
    ]);
  });
});
```

- [ ] **Step 2: Run audit tests and verify they fail**

Run:

```bash
bunx vitest run --config vitest.scripts.config.ts scripts/compile-scenes/evidence-sources-audit.test.ts
```

Expected: FAIL because the audit module does not exist.

- [ ] **Step 3: Implement the audit module**

Create `scripts/compile-scenes/evidence-sources-audit.ts`:

```ts
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { parseChapter } from "./parser-chapter";
import { parseInvestigationScene } from "./parser-investigation";
import type { EvidenceSource } from "./types";

export type EvidenceSourceSuggestion = EvidenceSource | "needs-review";

export type EvidenceSourceAuditItem = {
  sceneFile: string;
  sublocationId: string;
  hotspotId: string;
  hotspotLabel: string;
  hotspotDescription: string;
  currentSource: EvidenceSource | null;
  sceneSourcePrompt: string | null;
  backgroundPrompt: string | null;
  suggestedSource: EvidenceSourceSuggestion;
  evidence: Array<{
    id: string;
    name: string;
    imagePrompt: string | null;
  }>;
};

const DEFAULT_SOURCE_ROOTS = ["docs/stories_plan", "static/stories_plan"];

export function suggestEvidenceSource(input: {
  label: string;
  description: string;
}): EvidenceSourceSuggestion {
  const text = `${input.label} ${input.description}`.toLowerCase();

  if (/(監視器|回放|螢幕|monitor|screen)/i.test(text)) return "implied";
  if (/(打卡|紀錄|資料|系統|查詢)/i.test(text)) {
    if (/(副本|列印|文件|紙本|表|白板)/i.test(text)) return "visible";
    return "hidden";
  }
  if (/(副本|列印|文件|傘|盒|白板)/i.test(text)) return "visible";
  return "needs-review";
}

export function auditEvidenceSources(
  sourceRoots = DEFAULT_SOURCE_ROOTS,
): EvidenceSourceAuditItem[] {
  const items: EvidenceSourceAuditItem[] = [];

  for (const sourceRoot of sourceRoots) {
    if (!existsSync(sourceRoot)) continue;
    const chapters = readdirSync(sourceRoot)
      .filter(
        (entry) =>
          /^chapter_\d+$/.test(entry) &&
          statSync(resolve(sourceRoot, entry)).isDirectory(),
      )
      .sort();

    for (const chapter of chapters) {
      const chapterDir = resolve(sourceRoot, chapter);
      const manifestPath = resolve(chapterDir, "chapter.md");
      if (!existsSync(manifestPath)) continue;

      const parsedChapter = parseChapter(
        readFileSync(manifestPath, "utf-8"),
        `${chapter}/chapter.md`,
        chapter,
      );
      if (!parsedChapter.ok) continue;

      for (const file of parsedChapter.value.sceneFiles) {
        if (!file.startsWith("investigation_scene_")) continue;
        const scenePath = resolve(chapterDir, file);
        const sceneFile = `${chapter}/${file}`;
        const parsedScene = parseInvestigationScene(
          readFileSync(scenePath, "utf-8"),
          sceneFile,
          file.replace(/\.md$/, ""),
        );
        if (!parsedScene.ok) continue;

        const evidenceById = new Map(
          parsedScene.value.evidenceManifest.map((evidence) => [
            evidence.id,
            evidence,
          ]),
        );

        for (const sublocation of parsedScene.value.sublocations) {
          for (const hotspot of sublocation.hotspots) {
            const evidence = hotspot.reveals
              .filter((reveal) => reveal.kind === "evidence")
              .map((reveal) => evidenceById.get(reveal.id))
              .filter((entry): entry is NonNullable<typeof entry> => !!entry);
            if (evidence.length === 0) continue;

            items.push({
              sceneFile,
              sublocationId: sublocation.id,
              hotspotId: hotspot.id,
              hotspotLabel: hotspot.label,
              hotspotDescription: hotspot.description,
              currentSource: hotspot.evidenceSource,
              sceneSourcePrompt: hotspot.sceneSourcePrompt,
              backgroundPrompt: sublocation.assetCue?.backgroundPrompt ?? null,
              suggestedSource: suggestEvidenceSource({
                label: hotspot.label,
                description: hotspot.description,
              }),
              evidence: evidence.map((entry) => ({
                id: entry.id,
                name: entry.name,
                imagePrompt: entry.imageCue.imagePrompt,
              })),
            });
          }
        }
      }
    }
  }

  return items;
}

function printReport(items: EvidenceSourceAuditItem[]): void {
  if (items.length === 0) {
    console.log("No evidence-revealing hotspots found.");
    return;
  }

  for (const item of items) {
    console.log(
      [
        `${item.sceneFile} :: ${item.sublocationId} :: ${item.hotspotId}`,
        `  label: ${item.hotspotLabel}`,
        `  current: ${item.currentSource ?? "missing"}`,
        `  suggested: ${item.suggestedSource}`,
        `  evidence: ${item.evidence.map((entry) => `${entry.id} (${entry.name})`).join(", ")}`,
      ].join("\n"),
    );
  }
}

if (import.meta.main) {
  const roots = process.argv.slice(2);
  printReport(auditEvidenceSources(roots.length > 0 ? roots : DEFAULT_SOURCE_ROOTS));
}
```

- [ ] **Step 4: Add the root audit script**

In root `package.json`, add this script next to `scenes:compile`:

```json
"evidence-sources:audit": "bun run scripts/compile-scenes/evidence-sources-audit.ts",
```

- [ ] **Step 5: Run audit tests and command**

Run:

```bash
bunx vitest run --config vitest.scripts.config.ts scripts/compile-scenes/evidence-sources-audit.test.ts
bun run evidence-sources:audit
```

Expected: tests PASS. The audit command prints evidence-revealing hotspots, including missing metadata in current Chapter 1 before Task 4.

- [ ] **Step 6: Commit audit command**

Run:

```bash
git add package.json scripts/compile-scenes/evidence-sources-audit.ts scripts/compile-scenes/evidence-sources-audit.test.ts
git commit -m "feat(scenes): audit evidence source metadata"
```

## Task 4: Writer Instructions And Chapter 1 Migration

**Files:**
- Modify: `.claude/skills/writing-investigation-scene/SKILL.md`
- Modify: `docs/stories_plan/chapter_1/investigation_scene_1.md`
- Modify: `docs/stories_plan/chapter_1/investigation_scene_3.md`

- [ ] **Step 1: Update the investigation writer skill**

In `.claude/skills/writing-investigation-scene/SKILL.md`, under `### Hotspot (H3, inside a Sub-location)`, replace the optional-field sentence with:

```markdown
- **Optional:** `Status` (defaults to `unlocked`), `Unlock`, `Reveals` (list), `Evidence Source`, `Scene Source Prompt`
- **Required when assets are enabled and this hotspot reveals evidence:** `Evidence Source` — one of `visible`, `implied`, or `hidden`.
  - `visible`: the source object should appear in the sub-location background.
  - `implied`: a source or access point appears, but the collected evidence image/content should not appear there.
  - `hidden`: the collected evidence/source record should not appear in the background.
- **Optional with `Evidence Source`:** `Scene Source Prompt` — one-line English production guidance for the in-scene source only. It is not a filesystem path and does not replace the evidence `Image Prompt`.
```

- [ ] **Step 2: Add metadata to scene 1**

In `docs/stories_plan/chapter_1/investigation_scene_1.md`, update `kagami_summary_hotspot`:

```markdown
### Hotspot: KAGAMI 摘要副本 {#kagami_summary_hotspot}
- **Reveals:** [evidence:kagami_summary, topic:hayasaka@commission]
- **Evidence Source:** visible
- **Scene Source Prompt:** Printed KAGAMI case-summary document lying on the detective office desk, visible as a document prop but with no readable text.
- **Description:** 桌上攤著一份 KAGAMI 系統輸出的摘要副本，列著時間、門禁與鏡頭三項紀錄。
```

- [ ] **Step 3: Add metadata to scene 3 monitor hotspot**

In `docs/stories_plan/chapter_1/investigation_scene_3.md`, update `cctv_playback`:

```markdown
### Hotspot: 閉店監視器回放 {#cctv_playback}
- **Description:** 收銀台旁的小螢幕還能調出閉店前的監視器畫面。
- **Reveals:** [evidence:cctv_screenshot]
- **Evidence Source:** implied
- **Scene Source Prompt:** Small counter security monitor near the register, powered on as a source object but not showing a readable CCTV still.
```

- [ ] **Step 4: Add metadata to scene 3 timecard hotspot**

In `docs/stories_plan/chapter_1/investigation_scene_3.md`, update `timecard`:

```markdown
### Hotspot: 三宅打卡紀錄 {#timecard}
- **Description:** 收銀台後貼著當月的打卡表。
- **Reveals:** [evidence:timecard_record]
- **Evidence Source:** hidden
```

- [ ] **Step 5: Run compile and audit**

Run:

```bash
bun run scenes:compile
bun run evidence-sources:audit
```

Expected: `scenes:compile` succeeds. The audit output shows `kagami_summary_hotspot` as `current: visible`, `cctv_playback` as `current: implied`, and `timecard` as `current: hidden`.

- [ ] **Step 6: Commit writer guidance and scene migration**

Run:

```bash
git add .claude/skills/writing-investigation-scene/SKILL.md docs/stories_plan/chapter_1/investigation_scene_1.md docs/stories_plan/chapter_1/investigation_scene_3.md
git commit -m "docs(story): classify evidence sources in chapter one"
```

## Task 5: Layout Editor Source Badges And Preview Behavior

**Files:**
- Modify: `apps/layout-editor/src/lib/layout-types.ts`
- Modify: `apps/layout-editor/src/lib/EditorCanvas.svelte`
- Modify: `apps/layout-editor/src/lib/EditorCanvas.test.ts`

- [ ] **Step 1: Write editor tests**

Add a new test scene and tests to `apps/layout-editor/src/lib/EditorCanvas.test.ts`:

```ts
const sourceScene = {
  ...scene,
  id: "investigation_scene_sources",
  sublocations: [
    {
      ...scene.sublocations[0],
      hotspots: [
        {
          id: "visible_doc",
          label: "Visible Document",
          description: "A visible document.",
          reveals: [{ kind: "evidence", id: "visible_evidence" }],
          evidenceSource: "visible",
          sceneSourcePrompt: null,
          inspectDialogue: [],
          layout: null,
        },
        {
          id: "implied_monitor",
          label: "Monitor",
          description: "A monitor source.",
          reveals: [{ kind: "evidence", id: "monitor_evidence" }],
          evidenceSource: "implied",
          sceneSourcePrompt: "Small monitor.",
          inspectDialogue: [],
          layout: null,
        },
        {
          id: "hidden_record",
          label: "Hidden Record",
          description: "A hidden record.",
          reveals: [{ kind: "evidence", id: "hidden_evidence" }],
          evidenceSource: "hidden",
          sceneSourcePrompt: null,
          inspectDialogue: [],
          layout: null,
        },
        {
          id: "missing_source",
          label: "Missing Source",
          description: "Missing source classification.",
          reveals: [{ kind: "evidence", id: "missing_evidence" }],
          evidenceSource: null,
          sceneSourcePrompt: null,
          inspectDialogue: [],
          layout: null,
        },
      ],
    },
  ],
  evidenceManifest: [
    {
      id: "visible_evidence",
      name: "Visible Evidence",
      description: "Visible.",
      imageAssetId: "evidence.visible_evidence",
    },
    {
      id: "monitor_evidence",
      name: "Monitor Evidence",
      description: "Monitor.",
      imageAssetId: "evidence.monitor_evidence",
    },
    {
      id: "hidden_evidence",
      name: "Hidden Evidence",
      description: "Hidden.",
      imageAssetId: "evidence.hidden_evidence",
    },
    {
      id: "missing_evidence",
      name: "Missing Evidence",
      description: "Missing.",
      imageAssetId: "evidence.missing_evidence",
    },
  ],
} satisfies InvestigationSceneJson;

it("shows evidence source badges for hotspot targets", () => {
  const { container } = render(EditorCanvas, {
    scene: sourceScene,
    layout,
    sublocationId: "office",
    onHotspotLayoutChange: vi.fn(),
    onCharacterLayoutChange: vi.fn(),
  });

  expect(within(container).getByText("visible")).toBeInTheDocument();
  expect(within(container).getByText("implied")).toBeInTheDocument();
  expect(within(container).getByText("hidden")).toBeInTheDocument();
  expect(within(container).getByText("missing source")).toBeInTheDocument();
});

it("uses evidence image previews only for visible evidence sources", () => {
  const { container } = render(EditorCanvas, {
    scene: sourceScene,
    layout,
    sublocationId: "office",
    onHotspotLayoutChange: vi.fn(),
    onCharacterLayoutChange: vi.fn(),
  });

  const visibleTarget = container.querySelector(
    '[data-target-id="visible_doc"]',
  ) as HTMLElement;
  const impliedTarget = container.querySelector(
    '[data-target-id="implied_monitor"]',
  ) as HTMLElement;
  const hiddenTarget = container.querySelector(
    '[data-target-id="hidden_record"]',
  ) as HTMLElement;

  expect(visibleTarget.querySelector(".hotspot-preview")).not.toBeNull();
  expect(impliedTarget.querySelector(".hotspot-preview")).toBeNull();
  expect(impliedTarget.querySelector(".source-marker")).not.toBeNull();
  expect(hiddenTarget.querySelector(".hotspot-preview")).toBeNull();
});
```

- [ ] **Step 2: Run editor tests and verify they fail**

Run:

```bash
bun run --cwd apps/layout-editor test src/lib/EditorCanvas.test.ts
```

Expected: FAIL because editor types and markup do not expose source metadata yet.

- [ ] **Step 3: Extend editor scene types**

In `apps/layout-editor/src/lib/layout-types.ts`, add:

```ts
export type EvidenceSource = "visible" | "implied" | "hidden";
```

Extend hotspot entries:

```ts
    hotspots: Array<{
      id: string;
      label: string;
      description: string;
      reveals: RevealTarget[];
      evidenceSource: EvidenceSource | null;
      sceneSourcePrompt: string | null;
      inspectDialogue: DialogueItem[];
      layout: RectLayout | null;
    }>;
```

- [ ] **Step 4: Add source-aware helper functions**

In `apps/layout-editor/src/lib/EditorCanvas.svelte`, add:

```ts
  function sourceLabelForHotspot(hotspot: SceneHotspot): string | null {
    if (hotspot.evidenceSource) return hotspot.evidenceSource;
    return hotspot.reveals.some(isEvidenceReveal) ? "missing source" : null;
  }

  function shouldShowEvidencePreview(hotspot: SceneHotspot): boolean {
    return hotspot.evidenceSource === "visible";
  }

  function shouldShowSourceMarker(hotspot: SceneHotspot): boolean {
    return hotspot.evidenceSource === "implied";
  }

  function sourceTitleForHotspot(hotspot: SceneHotspot): string {
    const sourceLabel = sourceLabelForHotspot(hotspot);
    const sourceText = sourceLabel ? `source: ${sourceLabel}` : "source: none";
    const promptText = hotspot.sceneSourcePrompt
      ? `; ${hotspot.sceneSourcePrompt}`
      : "";
    return `${hotspot.description || hotspot.label} (${sourceText}${promptText})`;
  }
```

- [ ] **Step 5: Render source badges and source-aware previews**

In the hotspot target button markup, add a stable test selector and source classes:

```svelte
        <button
          type="button"
          class="target hotspot"
          class:dragging={dragState?.kind === "hotspot" &&
            dragState.id === hotspot.id}
          class:revealed={isRevealedTarget("hotspot", hotspot.id)}
          class:hidden={isHiddenTarget("hotspot", hotspot.id)}
          class:source-missing={sourceLabelForHotspot(hotspot) ===
            "missing source"}
          data-target-id={hotspot.id}
          style={layoutStyle(hotspot.layout)}
          onpointerdown={(event) =>
            startDrag("hotspot", hotspot.id, "move", hotspot.layout, event)}
        >
          {#if sourceLabelForHotspot(hotspot)}
            <small class="source-badge">{sourceLabelForHotspot(hotspot)}</small>
          {/if}
          {#if shouldShowEvidencePreview(hotspot) && assetUrl(hotspot.imageAssetId, "evidence")}
            <img
              class="hotspot-preview"
              src={assetUrl(hotspot.imageAssetId, "evidence")}
              alt=""
              aria-hidden="true"
              onerror={() =>
                handleAssetError(hotspot.imageAssetId ?? "", "evidence")}
            />
          {:else if shouldShowSourceMarker(hotspot)}
            <span class="source-marker" aria-hidden="true">source</span>
          {/if}
          <span>{hotspot.label}</span>
```

In target controls, change the hotspot `title`:

```svelte
          title={sourceTitleForHotspot(hotspot)}
```

Add CSS:

```css
  .source-badge {
    position: absolute;
    top: 3px;
    left: 3px;
    z-index: 2;
    max-width: calc(100% - 6px);
    padding: 2px 5px;
    border-radius: 4px;
    background: rgb(20 28 26 / 82%);
    color: #fff6d8;
    font-size: 0.62rem;
    font-weight: 700;
    letter-spacing: 0;
    line-height: 1;
    text-transform: uppercase;
    pointer-events: none;
  }

  .target.hotspot.source-missing {
    border-style: dashed;
    border-color: #f0b35b;
  }

  .source-marker {
    position: absolute;
    inset: 24px 6px 6px;
    display: grid;
    place-items: center;
    border: 1px solid rgb(255 255 255 / 40%);
    border-radius: 4px;
    background: rgb(28 42 48 / 55%);
    color: #f4ead7;
    font-size: 0.66rem;
    font-weight: 700;
    letter-spacing: 0;
    text-transform: uppercase;
    pointer-events: none;
  }
```

- [ ] **Step 6: Run editor tests and type check**

Run:

```bash
bun run --cwd apps/layout-editor test src/lib/EditorCanvas.test.ts
bun run editor:check
```

Expected: PASS.

- [ ] **Step 7: Commit layout editor changes**

Run:

```bash
git add apps/layout-editor/src/lib/layout-types.ts apps/layout-editor/src/lib/EditorCanvas.svelte apps/layout-editor/src/lib/EditorCanvas.test.ts
git commit -m "feat(editor): show evidence source metadata"
```

## Task 6: End-To-End Verification

**Files:**
- Verify only; no planned source edits.

- [ ] **Step 1: Run focused compiler tests**

Run:

```bash
bunx vitest run --config vitest.scripts.config.ts scripts/compile-scenes/parser-investigation.test.ts scripts/compile-scenes/assets/enrich.test.ts scripts/compile-scenes/evidence-sources-audit.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run focused editor tests**

Run:

```bash
bun run --cwd apps/layout-editor test src/lib/EditorCanvas.test.ts
```

Expected: PASS.

- [ ] **Step 3: Compile scenes**

Run:

```bash
bun run scenes:compile
```

Expected: PASS, with asset warnings only for missing loose files if assets have not been generated.

- [ ] **Step 4: Run full TypeScript/Svelte check**

Run:

```bash
bun run check
```

Expected: PASS.

- [ ] **Step 5: Run the evidence-source audit command**

Run:

```bash
bun run evidence-sources:audit
```

Expected: output includes evidence hotspots and shows the migrated scene 1 and scene 3 hotspots with their current classifications. Remaining `missing` items are acceptable only if they are outside this migration scope and captured for follow-up.

- [ ] **Step 6: Inspect final diff**

Run:

```bash
git status --short
git diff --stat
git diff --check
```

Expected: no whitespace errors; changes match the files listed in this plan.

## Self-Review Checklist

- Spec coverage: parser/source fields, enabled validation, background manifest guidance, audit workflow, Chapter 1 migration, writer skill update, layout editor badges/previews, and verification commands are each covered by a task.
- Scope check: no new scene-prop asset type, no image generation, no runtime gameplay changes, and no editor writes to Markdown are included.
- Type consistency: the plan uses `EvidenceSource`, `evidenceSource`, and `sceneSourcePrompt` consistently across AST, JSON, editor types, parser, emitter, and Svelte code.

# Evidence Carrier Assignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the layout editor assign evidence to physical hotspots, character topics, or generated standalone hidden hotspots while keeping authored Markdown and editor state synchronized.

**Architecture:** Introduce a typed evidence-carrier model in the layout editor. Markdown remains the source of truth; generated JSON is patched in memory after successful writes and refreshed by `bun run scenes:compile`. Generated standalone hotspots are identified by the `evidence_source_<evidence_id>` ID convention and are the only auto-deletable hotspots.

**Tech Stack:** Svelte 5 layout editor, TypeScript helper tests with Vitest, authored investigation Markdown, existing scene compiler validation.

---

## File Structure

- Modify `apps/layout-editor/src/lib/evidence-assignment.ts`
  - Owns carrier types, carrier discovery, Markdown patching, reveal movement, and generated hotspot ID helpers.
- Modify `apps/layout-editor/src/lib/evidence-assignment.test.ts`
  - Covers hotspot, topic, standalone hotspot, generated hotspot deletion, and authored hotspot preservation.
- Modify `apps/layout-editor/src/lib/layout-store.svelte.ts`
  - Queues assignment writes, calls the new carrier patcher, updates in-memory scene/layout after successful Markdown writes.
- Modify `apps/layout-editor/src/lib/layout-store.test.ts`
  - Covers assignment queue behavior, in-memory topic/hotspot updates, and layout sidecar cleanup.
- Modify `apps/layout-editor/src/lib/EvidenceAssignmentPanel.svelte`
  - Shows typed carrier options and sends carrier assignments instead of hotspot-only assignments.
- Modify `apps/layout-editor/src/lib/EvidenceAssignmentPanel.test.ts`
  - Covers current-sublocation evidence filtering, target labels, and assigning to topic/standalone carriers.
- Modify `apps/layout-editor/src/App.svelte`
  - Passes current sublocation and the carrier assignment handler.
- Modify `.claude/skills/writing-investigation-scene/SKILL.md`
  - Adds guidance that person-sourced evidence should be revealed by character topics.
- Modify `docs/stories_plan/chapter_1/investigation_scene_7.md`
  - Moves `法醫初步死亡範圍` from standalone hotspot `forensic_brief` to a 黑瀨 topic.
- Modify `docs/stories_plan/chapter_1/investigation_scene_7.layout.json`
  - Removes stale `forensic_brief` layout entry after the standalone hotspot is removed.
- Modify current dirty files `docs/stories_plan/chapter_1/investigation_scene_3.md` and `docs/stories_plan/chapter_1/investigation_scene_3.layout.json`
  - Preserve the user's current coordinate/reveal edits, and only fix the invalid `register` source metadata created by moving `two_coffee_order` to `counter_admin_records`.

---

### Task 1: Add Typed Carrier Discovery

**Files:**

- Modify: `apps/layout-editor/src/lib/evidence-assignment.ts`
- Modify: `apps/layout-editor/src/lib/evidence-assignment.test.ts`

- [ ] **Step 1: Write failing carrier discovery tests**

Add these imports in `apps/layout-editor/src/lib/evidence-assignment.test.ts`:

```ts
import {
  carrierOptionsForEvidence,
  evidenceAssignmentsForScene,
  generatedStandaloneHotspotId,
} from "./evidence-assignment";
```

Add a character with a topic to `sourceSublocationScene.sublocations[1]`:

```ts
characters: [
  {
    id: "kurose",
    name: "黑瀨徹",
    role: "刑警",
    bio: "提供程序內可公開的資訊。",
    layout: null,
    topics: [
      {
        id: "forensic_brief",
        label: "法醫初步簡報",
        status: "unlocked",
        reveals: [],
        topicDialogue: [],
      },
    ],
  },
],
```

Add tests:

```ts
describe("carrierOptionsForEvidence", () => {
  it("lists evidence-capable hotspots, character topics, and standalone creation in the evidence source sublocation", () => {
    expect(
      carrierOptionsForEvidence(
        sourceSublocationScene,
        sourceSublocationScene.evidenceManifest[0],
      ),
    ).toEqual([
      {
        label: "Corridor / Access panel",
        carrier: {
          kind: "hotspot",
          sublocationId: "corridor",
          hotspotId: "access-panel",
        },
      },
      {
        label: "Corridor / 黑瀨徹 / 法醫初步簡報",
        carrier: {
          kind: "topic",
          sublocationId: "corridor",
          characterId: "kurose",
          topicId: "forensic_brief",
        },
      },
      {
        label: "Create standalone hotspot",
        carrier: {
          kind: "standalone_hotspot",
          sublocationId: "corridor",
        },
      },
    ]);
  });

  it("does not list non-source sublocation targets", () => {
    const labels = carrierOptionsForEvidence(
      sourceSublocationScene,
      sourceSublocationScene.evidenceManifest[0],
    ).map((option) => option.label);

    expect(labels).not.toContain("Front / Front door");
  });
});

describe("generatedStandaloneHotspotId", () => {
  it("uses the evidence_source id convention", () => {
    expect(generatedStandaloneHotspotId("forensic_prelim_range")).toBe(
      "evidence_source_forensic_prelim_range",
    );
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
bun run --cwd apps/layout-editor test src/lib/evidence-assignment.test.ts -t "carrierOptionsForEvidence|generatedStandaloneHotspotId"
```

Expected: fail because `carrierOptionsForEvidence` and `generatedStandaloneHotspotId` are not exported.

- [ ] **Step 3: Add carrier types and discovery implementation**

In `apps/layout-editor/src/lib/evidence-assignment.ts`, add:

```ts
export type EvidenceCarrier =
  | { kind: "hotspot"; sublocationId: string; hotspotId: string }
  | {
      kind: "topic";
      sublocationId: string;
      characterId: string;
      topicId: string;
    }
  | { kind: "standalone_hotspot"; sublocationId: string };

export type EvidenceCarrierOption = {
  label: string;
  carrier: EvidenceCarrier;
};

export function generatedStandaloneHotspotId(evidenceId: string): string {
  return `evidence_source_${evidenceId}`;
}
```

Add:

```ts
export function carrierOptionsForEvidence(
  scene: InvestigationSceneJson,
  evidence: EvidenceManifestItem,
): EvidenceCarrierOption[] {
  const options: EvidenceCarrierOption[] = [];

  for (const sublocation of scene.sublocations) {
    if (
      evidence.sourceSublocationId &&
      sublocation.id !== evidence.sourceSublocationId
    ) {
      continue;
    }

    for (const hotspot of sublocation.hotspots) {
      if (hotspot.evidenceSource === null) continue;
      options.push({
        label: `${sublocation.label} / ${hotspot.label}`,
        carrier: {
          kind: "hotspot",
          sublocationId: sublocation.id,
          hotspotId: hotspot.id,
        },
      });
    }

    for (const character of sublocation.characters) {
      for (const topic of character.topics) {
        options.push({
          label: `${sublocation.label} / ${character.name} / ${topic.label}`,
          carrier: {
            kind: "topic",
            sublocationId: sublocation.id,
            characterId: character.id,
            topicId: topic.id,
          },
        });
      }
    }

    options.push({
      label: "Create standalone hotspot",
      carrier: {
        kind: "standalone_hotspot",
        sublocationId: sublocation.id,
      },
    });
  }

  return options;
}
```

- [ ] **Step 4: Run carrier discovery tests**

Run:

```bash
bun run --cwd apps/layout-editor test src/lib/evidence-assignment.test.ts -t "carrierOptionsForEvidence|generatedStandaloneHotspotId"
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add apps/layout-editor/src/lib/evidence-assignment.ts apps/layout-editor/src/lib/evidence-assignment.test.ts
git commit -m "feat(editor): discover evidence carriers"
```

---

### Task 2: Patch Markdown For Hotspot, Topic, And Standalone Carriers

**Files:**

- Modify: `apps/layout-editor/src/lib/evidence-assignment.ts`
- Modify: `apps/layout-editor/src/lib/evidence-assignment.test.ts`

- [ ] **Step 1: Write failing Markdown patch tests**

Add this Markdown fixture in `apps/layout-editor/src/lib/evidence-assignment.test.ts`:

```ts
const carrierMarkdown = `# Investigation

## Sub-location: Inner storage {#inner}
- **Status:** unlocked

[場景：內側倉庫。]

### Hotspot: 法醫初步簡報 {#evidence_source_forensic_prelim_range}
- **Description:** 編輯器產生的隱藏證據來源。
- **Evidence Source:** hidden
- **Scene Source Prompt:** Hidden local evidence source generated by the layout editor; the collected evidence is not visibly readable in the background.
- **Reveals:** [evidence:forensic_prelim_range]

[黑瀨遞出簡報。]

### Hotspot: 後場入口 {#back_entrance}
- **Description:** 通往走廊的入口。
- **Reveals:** [sublocation:corridor]

[相馬往後場看。]

### Character: 黑瀨徹 {#kurose}
- **Role:** 刑警
- **Bio:** 提供程序內可公開的資訊。

#### Topic: 法醫初步簡報 {#forensic_brief}
- **Status:** unlocked

**黑瀨徹**：法醫初步。死亡時間給的是一段範圍。
`;
```

Add tests:

```ts
describe("updateEvidenceCarrierInMarkdown", () => {
  it("moves evidence from generated standalone hotspot to a character topic and removes the empty generated hotspot", () => {
    const result = updateEvidenceCarrierInMarkdown(carrierMarkdown, {
      evidenceId: "forensic_prelim_range",
      evidenceName: "法醫初步死亡範圍",
      sourceSublocationId: "inner",
      carrier: {
        kind: "topic",
        sublocationId: "inner",
        characterId: "kurose",
        topicId: "forensic_brief",
      },
    });

    expect(result.changed).toBe(true);
    expect(result.removedStandaloneHotspotIds).toEqual([
      "evidence_source_forensic_prelim_range",
    ]);
    expect(result.contents).not.toContain(
      "### Hotspot: 法醫初步簡報 {#evidence_source_forensic_prelim_range}",
    );
    expect(result.contents).toContain(
      "#### Topic: 法醫初步簡報 {#forensic_brief}\n- **Status:** unlocked\n- **Reveals:** [evidence:forensic_prelim_range]",
    );
    expect(result.contents).toContain("### Hotspot: 後場入口 {#back_entrance}");
  });

  it("creates a hidden standalone hotspot in the source sublocation", () => {
    const result = updateEvidenceCarrierInMarkdown(carrierMarkdown, {
      evidenceId: "new_record",
      evidenceName: "新紀錄",
      sourceSublocationId: "inner",
      carrier: { kind: "standalone_hotspot", sublocationId: "inner" },
    });

    expect(result.createdStandaloneHotspotId).toBe(
      "evidence_source_new_record",
    );
    expect(result.contents).toContain(
      "### Hotspot: 新紀錄 {#evidence_source_new_record}\n- **Description:** 編輯器產生的隱藏證據來源。\n- **Evidence Source:** hidden\n- **Scene Source Prompt:** Hidden local evidence source generated by the layout editor; the collected evidence is not visibly readable in the background.\n- **Reveals:** [evidence:new_record]",
    );
  });

  it("does not delete authored hotspots after moving their final evidence reveal", () => {
    const authored = carrierMarkdown.replace(
      "- **Reveals:** [sublocation:corridor]",
      "- **Reveals:** [sublocation:corridor, evidence:new_record]",
    );
    const result = updateEvidenceCarrierInMarkdown(authored, {
      evidenceId: "new_record",
      evidenceName: "新紀錄",
      sourceSublocationId: "inner",
      carrier: {
        kind: "topic",
        sublocationId: "inner",
        characterId: "kurose",
        topicId: "forensic_brief",
      },
    });

    expect(result.contents).toContain("### Hotspot: 後場入口 {#back_entrance}");
    expect(result.contents).toContain("- **Reveals:** [sublocation:corridor]");
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
bun run --cwd apps/layout-editor test src/lib/evidence-assignment.test.ts -t "updateEvidenceCarrierInMarkdown"
```

Expected: fail because `updateEvidenceCarrierInMarkdown` does not exist.

- [ ] **Step 3: Replace hotspot-only assignment patcher**

In `apps/layout-editor/src/lib/evidence-assignment.ts`, add result fields:

```ts
export type EvidenceCarrierAssignment = {
  evidenceId: string;
  evidenceName: string;
  sourceSublocationId: string;
  carrier: EvidenceCarrier | null;
};

export type EvidenceCarrierAssignmentResult = {
  contents: string;
  changed: boolean;
  createdStandaloneHotspotId: string | null;
  removedStandaloneHotspotIds: string[];
};
```

Add block parsing types:

```ts
type TopicBlock = {
  characterId: string;
  id: string;
  start: number;
  end: number;
  revealsLine: number | null;
};

type SublocationBlock = {
  id: string;
  start: number;
  end: number;
};

const sublocationHeadingPattern = /^## Sub-location: .+ \{#([^}]+)\}$/;
const characterHeadingPattern = /^### Character: .+ \{#([^}]+)\}$/;
const topicHeadingPattern = /^#### Topic: .+ \{#([^}]+)\}$/;
```

Implement the new exported function:

```ts
export function updateEvidenceCarrierInMarkdown(
  contents: string,
  assignment: EvidenceCarrierAssignment,
): EvidenceCarrierAssignmentResult {
  const hadFinalNewline = contents.endsWith("\n");
  const lines = contents.split("\n");
  if (hadFinalNewline) lines.pop();

  const revealToken = `evidence:${assignment.evidenceId}`;
  const removedStandaloneHotspotIds: string[] = [];
  let changed = false;

  for (const block of [...findHotspotBlocks(lines), ...findTopicBlocks(lines)]) {
    if (block.revealsLine === null) continue;
    const items = parseReveals(lines[block.revealsLine]);
    if (!items.includes(revealToken)) continue;

    const nextItems = items.filter((item) => item !== revealToken);
    if (nextItems.length === 0) {
      lines.splice(block.revealsLine, 1);
      changed = true;
    } else {
      lines[block.revealsLine] = formatReveals(nextItems);
      changed = true;
    }
  }

  for (const block of findHotspotBlocks(lines).toReversed()) {
    if (!isGeneratedStandaloneHotspotId(block.id)) continue;
    if (hotspotHasEvidenceReveal(lines, block)) continue;
    lines.splice(block.start, block.end - block.start);
    removedStandaloneHotspotIds.push(block.id);
    changed = true;
  }

  let createdStandaloneHotspotId: string | null = null;
  if (assignment.carrier?.kind === "hotspot") {
    changed =
      addRevealToHotspot(lines, assignment.carrier.hotspotId, revealToken) ||
      changed;
  } else if (assignment.carrier?.kind === "topic") {
    changed =
      addRevealToTopic(
        lines,
        assignment.carrier.characterId,
        assignment.carrier.topicId,
        revealToken,
      ) || changed;
  } else if (assignment.carrier?.kind === "standalone_hotspot") {
    createdStandaloneHotspotId = generatedStandaloneHotspotId(
      assignment.evidenceId,
    );
    insertStandaloneHotspot(lines, {
      sublocationId: assignment.carrier.sublocationId,
      hotspotId: createdStandaloneHotspotId,
      evidenceName: assignment.evidenceName,
      revealToken,
    });
    changed = true;
  }

  const nextContents = joinLines(lines, hadFinalNewline);
  return {
    contents: nextContents,
    changed: changed || nextContents !== contents,
    createdStandaloneHotspotId,
    removedStandaloneHotspotIds: removedStandaloneHotspotIds.toReversed(),
  };
}
```

Add helper signatures and implement them in the same file:

```ts
function isGeneratedStandaloneHotspotId(id: string): boolean {
  return /^evidence_source_[a-z0-9_]+$/.test(id);
}

function hotspotHasEvidenceReveal(lines: string[], block: HotspotBlock): boolean {
  if (block.revealsLine === null) return false;
  return parseReveals(lines[block.revealsLine]).some((item) =>
    item.startsWith("evidence:"),
  );
}
```

`findTopicBlocks`, `addRevealToHotspot`, `addRevealToTopic`, and
`insertStandaloneHotspot` should use the same `findRevealInsertIndex`,
`parseReveals`, and `formatReveals` conventions already used by hotspot reveals.

- [ ] **Step 4: Run Markdown patch tests**

Run:

```bash
bun run --cwd apps/layout-editor test src/lib/evidence-assignment.test.ts -t "updateEvidenceCarrierInMarkdown"
```

Expected: pass.

- [ ] **Step 5: Keep compatibility wrapper temporarily**

Leave `updateEvidenceAssignmentInMarkdown` exported as a thin wrapper for tests or
callers not yet migrated:

```ts
export function updateEvidenceAssignmentInMarkdown(
  contents: string,
  assignment: EvidenceAssignment,
): EvidenceAssignmentResult {
  const result = updateEvidenceCarrierInMarkdown(contents, {
    evidenceId: assignment.evidenceId,
    evidenceName: assignment.evidenceId,
    sourceSublocationId: "",
    carrier: assignment.hotspotId
      ? { kind: "hotspot", sublocationId: "", hotspotId: assignment.hotspotId }
      : null,
  });
  return { contents: result.contents, changed: result.changed };
}
```

- [ ] **Step 6: Commit**

```bash
git add apps/layout-editor/src/lib/evidence-assignment.ts apps/layout-editor/src/lib/evidence-assignment.test.ts
git commit -m "feat(editor): patch typed evidence carriers"
```

---

### Task 3: Synchronize In-Memory Scene And Layout State

**Files:**

- Modify: `apps/layout-editor/src/lib/evidence-assignment.ts`
- Modify: `apps/layout-editor/src/lib/layout-store.svelte.ts`
- Modify: `apps/layout-editor/src/lib/layout-store.test.ts`

- [ ] **Step 1: Write failing layout-store tests**

In `apps/layout-editor/src/lib/layout-store.test.ts`, add a test under
`describe("assignEvidenceToHotspot")`; keep the describe name for now to avoid a
large test restructure:

```ts
it("assigns evidence to a topic and removes generated standalone layout", async () => {
  editorState.storyScenePath =
    "docs/stories_plan/chapter_1/investigation_scene_7.md";
  editorState.storySceneContents = carrierMarkdownForStoreTest;
  editorState.layout = {
    version: 1,
    sceneId: "investigation_scene_7",
    sublocations: {
      inner: {
        hotspots: {
          evidence_source_forensic_prelim_range: {
            kind: "rect",
            x: 0.4,
            y: 0.4,
            w: 0.12,
            h: 0.1,
          },
        },
        characters: {},
      },
    },
  };
  editorState.scene = sceneWithGeneratedForensicHotspotAndKuroseTopic;
  mockInvoke.mockResolvedValueOnce(undefined);

  await assignEvidenceToCarrier("forensic_prelim_range", {
    kind: "topic",
    sublocationId: "inner",
    characterId: "kurose",
    topicId: "forensic_brief",
  });

  expect(editorState.storySceneContents).toContain(
    "#### Topic: 法醫初步簡報 {#forensic_brief}\n- **Status:** unlocked\n- **Reveals:** [evidence:forensic_prelim_range]",
  );
  expect(
    editorState.layout?.sublocations.inner.hotspots
      .evidence_source_forensic_prelim_range,
  ).toBeUndefined();
  const kurose = editorState.scene.sublocations[0].characters[0];
  expect(kurose.topics[0].reveals).toEqual([
    { kind: "evidence", id: "forensic_prelim_range" },
  ]);
});
```

Define `carrierMarkdownForStoreTest` and
`sceneWithGeneratedForensicHotspotAndKuroseTopic` in the test file using the same
shape as existing `InvestigationSceneJson` fixtures.

- [ ] **Step 2: Run the layout-store test to verify failure**

Run:

```bash
bun run --cwd apps/layout-editor test src/lib/layout-store.test.ts -t "assigns evidence to a topic"
```

Expected: fail because `assignEvidenceToCarrier` does not exist.

- [ ] **Step 3: Add in-memory carrier movement helpers**

In `apps/layout-editor/src/lib/evidence-assignment.ts`, add:

```ts
export function moveEvidenceRevealToCarrierInScene(
  scene: InvestigationSceneJson,
  evidenceId: string,
  carrier: EvidenceCarrier | null,
): InvestigationSceneJson {
  return {
    ...scene,
    sublocations: scene.sublocations.map((sublocation) => ({
      ...sublocation,
      hotspots: sublocation.hotspots
        .filter(
          (hotspot) =>
            !(
              isGeneratedStandaloneHotspotId(hotspot.id) &&
              hotspot.id === generatedStandaloneHotspotId(evidenceId)
            ),
        )
        .map((hotspot) => ({
          ...hotspot,
          reveals: nextRevealsForCarrier(
            hotspot.reveals,
            evidenceId,
            carrier?.kind === "hotspot" && carrier.hotspotId === hotspot.id,
          ),
        })),
      characters: sublocation.characters.map((character) => ({
        ...character,
        topics: character.topics.map((topic) => ({
          ...topic,
          reveals: nextRevealsForCarrier(
            topic.reveals,
            evidenceId,
            carrier?.kind === "topic" &&
              carrier.characterId === character.id &&
              carrier.topicId === topic.id,
          ),
        })),
      })),
    })),
  };
}

function nextRevealsForCarrier(
  reveals: RevealTarget[],
  evidenceId: string,
  shouldCarryEvidence: boolean,
): RevealTarget[] {
  const next = reveals.filter(
    (reveal) => !(reveal.kind === "evidence" && reveal.id === evidenceId),
  );
  if (shouldCarryEvidence) next.push({ kind: "evidence", id: evidenceId });
  return next as RevealTarget[];
}
```

- [ ] **Step 4: Add layout sidecar cleanup**

In `apps/layout-editor/src/lib/layout-store.svelte.ts`, add:

```ts
function removeHotspotLayouts(hotspotIds: string[]) {
  if (!editorState.layout || hotspotIds.length === 0) return;
  const ids = new Set(hotspotIds);

  editorState.layout = {
    ...editorState.layout,
    sublocations: Object.fromEntries(
      Object.entries(editorState.layout.sublocations).map(
        ([sublocationId, sublocation]) => [
          sublocationId,
          {
            hotspots: Object.fromEntries(
              Object.entries(sublocation.hotspots).filter(
                ([hotspotId]) => !ids.has(hotspotId),
              ),
            ),
            characters: sublocation.characters,
          },
        ],
      ),
    ),
  };
}
```

- [ ] **Step 5: Rename assignment flow**

In `layout-store.svelte.ts`, export:

```ts
export function assignEvidenceToCarrier(
  evidenceId: string,
  carrier: EvidenceCarrier | null,
): Promise<void> {
  // Same queue pattern as assignEvidenceToHotspot, but calls
  // updateEvidenceCarrierInMarkdown and moveEvidenceRevealToCarrierInScene.
}
```

Keep `assignEvidenceToHotspot` as a wrapper:

```ts
export function assignEvidenceToHotspot(
  evidenceId: string,
  hotspotId: string | null,
): Promise<void> {
  return assignEvidenceToCarrier(
    evidenceId,
    hotspotId ? { kind: "hotspot", sublocationId: "", hotspotId } : null,
  );
}
```

Inside the queued implementation, find the evidence before writing:

```ts
const evidence = scene.evidenceManifest.find((item) => item.id === evidenceId);
if (!evidence?.sourceSublocationId) return;
```

Call:

```ts
const result = updateEvidenceCarrierInMarkdown(storySceneContents, {
  evidenceId,
  evidenceName: evidence.name,
  sourceSublocationId: evidence.sourceSublocationId,
  carrier,
});
```

After `write_story_scene_file` succeeds and the scene guard still matches:

```ts
editorState.storySceneContents = result.contents;
removeHotspotLayouts(result.removedStandaloneHotspotIds);
editorState.scene = moveEvidenceRevealToCarrierInScene(scene, evidenceId, carrier);
```

- [ ] **Step 6: Run layout-store tests**

Run:

```bash
bun run --cwd apps/layout-editor test src/lib/layout-store.test.ts
```

Expected: pass.

- [ ] **Step 7: Commit**

```bash
git add apps/layout-editor/src/lib/evidence-assignment.ts apps/layout-editor/src/lib/layout-store.svelte.ts apps/layout-editor/src/lib/layout-store.test.ts
git commit -m "feat(editor): sync typed carrier assignments"
```

---

### Task 4: Update Evidence Assignment Panel UI

**Files:**

- Modify: `apps/layout-editor/src/lib/EvidenceAssignmentPanel.svelte`
- Modify: `apps/layout-editor/src/lib/EvidenceAssignmentPanel.test.ts`
- Modify: `apps/layout-editor/src/App.svelte`
- Modify: `apps/layout-editor/src/App.test.ts`

- [ ] **Step 1: Write failing panel tests**

In `EvidenceAssignmentPanel.test.ts`, add:

```ts
it("renders hotspot, topic, and standalone carrier choices", () => {
  render(EvidenceAssignmentPanel, {
    scene,
    sublocationId: "corridor",
    disabled: false,
    onAssignEvidence: vi.fn(),
  });

  const labels = Array.from(
    (screen.getByLabelText("Assign Access log") as HTMLSelectElement).options,
    (option) => option.textContent,
  );

  expect(labels).toContain("Corridor / Terminal");
  expect(labels).toContain("Corridor / 黑瀨徹 / 法醫初步簡報");
  expect(labels).toContain("Create standalone hotspot");
});

it("passes a typed topic carrier to the assignment handler", async () => {
  const user = userEvent.setup();
  const onAssignEvidence = vi.fn();
  render(EvidenceAssignmentPanel, {
    scene,
    sublocationId: "corridor",
    disabled: false,
    onAssignEvidence,
  });

  await user.selectOptions(screen.getByLabelText("Assign Access log"), [
    "topic:corridor:kurose:forensic_brief",
  ]);

  expect(onAssignEvidence).toHaveBeenCalledWith("log", {
    kind: "topic",
    sublocationId: "corridor",
    characterId: "kurose",
    topicId: "forensic_brief",
  });
});
```

Update the fixture scene to include `kurose` with topic `forensic_brief` in the
`corridor` sublocation.

- [ ] **Step 2: Run panel tests to verify failure**

Run:

```bash
bun run --cwd apps/layout-editor test src/lib/EvidenceAssignmentPanel.test.ts
```

Expected: fail because the panel still renders hotspot-only options and emits a
hotspot id string.

- [ ] **Step 3: Add carrier value encoding**

In `EvidenceAssignmentPanel.svelte`, add:

```ts
function carrierValue(carrier: EvidenceCarrier): string {
  if (carrier.kind === "hotspot") {
    return `hotspot:${carrier.sublocationId}:${carrier.hotspotId}`;
  }
  if (carrier.kind === "topic") {
    return `topic:${carrier.sublocationId}:${carrier.characterId}:${carrier.topicId}`;
  }
  return `standalone:${carrier.sublocationId}`;
}

function carrierFromValue(value: string): EvidenceCarrier | null {
  if (value === "") return null;
  const parts = value.split(":");
  if (parts[0] === "hotspot") {
    return {
      kind: "hotspot",
      sublocationId: parts[1],
      hotspotId: parts[2],
    };
  }
  if (parts[0] === "topic") {
    return {
      kind: "topic",
      sublocationId: parts[1],
      characterId: parts[2],
      topicId: parts[3],
    };
  }
  return { kind: "standalone_hotspot", sublocationId: parts[1] };
}
```

Change the prop:

```ts
onAssignEvidence: (evidenceId: string, carrier: EvidenceCarrier | null) => void;
```

Use `carrierOptionsForEvidence(scene, assignment.evidence)` instead of
`hotspotOptionsForEvidence`.

- [ ] **Step 4: Wire App to carrier assignment**

In `apps/layout-editor/src/App.svelte`, change:

```ts
import { assignEvidenceToCarrier, ... } from "./lib/layout-store.svelte";
```

And:

```svelte
<EvidenceAssignmentPanel
  scene={editorState.scene}
  sublocationId={currentSublocationId}
  disabled={!editorState.storyScenePath}
  onAssignEvidence={assignEvidenceToCarrier}
/>
```

- [ ] **Step 5: Run panel and app tests**

Run:

```bash
bun run --cwd apps/layout-editor test src/lib/EvidenceAssignmentPanel.test.ts src/App.test.ts
```

Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add apps/layout-editor/src/lib/EvidenceAssignmentPanel.svelte apps/layout-editor/src/lib/EvidenceAssignmentPanel.test.ts apps/layout-editor/src/App.svelte apps/layout-editor/src/App.test.ts
git commit -m "feat(editor): assign evidence to typed carriers"
```

---

### Task 5: Story Cleanup For Person-Sourced And Dirty Scene Evidence

**Files:**

- Modify: `docs/stories_plan/chapter_1/investigation_scene_3.md`
- Modify: `docs/stories_plan/chapter_1/investigation_scene_3.layout.json`
- Modify: `docs/stories_plan/chapter_1/investigation_scene_7.md`
- Modify: `docs/stories_plan/chapter_1/investigation_scene_7.layout.json`
- Modify: `.claude/skills/writing-investigation-scene/SKILL.md`

- [ ] **Step 1: Fix current Scene 3 dirty state**

In `docs/stories_plan/chapter_1/investigation_scene_3.md`, preserve the current
user edit that moved `two_coffee_order` to `counter_admin_records`:

```md
- **Reveals:** [evidence:timecard_record, evidence:doorlock_summary_timetable, evidence:two_coffee_order]
```

Remove these two lines from `register`, because it no longer reveals evidence:

```md
- **Evidence Source:** implied
- **Scene Source Prompt:** Register and order-slip area behind the cafe counter, visible as the source of order records but with no readable receipt text.
```

Do not revert the current coordinate edits in
`docs/stories_plan/chapter_1/investigation_scene_3.layout.json`.

- [ ] **Step 2: Move forensic evidence to 黑瀨 topic**

In `docs/stories_plan/chapter_1/investigation_scene_7.md`, delete the standalone
hotspot block:

```md
### Hotspot: 法醫初步簡報 {#forensic_brief}
...
```

Find the 黑瀨 character:

```md
### Character: 黑瀨徹 {#kurose}
```

Add or update a topic:

```md
#### Topic: 法醫初步簡報 {#forensic_brief}
- **Status:** unlocked
- **Reveals:** [evidence:forensic_prelim_range]

[黑瀨徹把一頁簡報摘錄遞給相馬律，動作隨意但紙面朝上。]

**黑瀨徹**：法醫初步。後頭部鈍器傷。死亡時間給的是一段範圍。

**相馬律**：範圍。不是某一分鐘。

**黑瀨徹**：對。但那段範圍，跟 22:58 那個衝突點，不衝突。我只能給你這些。
```

Keep the existing `### evidence:forensic_prelim_range` manifest entry unchanged
except for dialogue only if duplication becomes awkward.

- [ ] **Step 3: Remove stale forensic layout**

In `docs/stories_plan/chapter_1/investigation_scene_7.layout.json`, remove the
hotspot entry:

```json
"forensic_brief": { ... }
```

Do not remove 黑瀨's character layout if present.

- [ ] **Step 4: Update investigation writing skill**

In `.claude/skills/writing-investigation-scene/SKILL.md`, add this guidance under
Topic or Evidence Manifest rules:

```md
- **Person-sourced evidence:** if the evidence comes from what a person provides,
  reveal it from the specific `#### Topic:` where that person gives the
  information. Do not invent a standalone document hotspot unless the player
  actually inspects a local physical source.
```

- [ ] **Step 5: Compile and audit**

Run:

```bash
bun run scenes:compile
bun run evidence-sources:audit
```

Expected: both pass. `evidence-sources:audit` should no longer report a parse
error for `register`, and `forensic_prelim_range` should no longer depend on a
standalone `forensic_brief` hotspot.

- [ ] **Step 6: Commit**

```bash
git add docs/stories_plan/chapter_1/investigation_scene_3.md docs/stories_plan/chapter_1/investigation_scene_3.layout.json docs/stories_plan/chapter_1/investigation_scene_7.md docs/stories_plan/chapter_1/investigation_scene_7.layout.json .claude/skills/writing-investigation-scene/SKILL.md
git commit -m "docs(story): move person evidence to topics"
```

---

### Task 6: Final Verification

**Files:**

- No new source files unless verification reveals a focused gap.

- [ ] **Step 1: Run focused tests**

Run:

```bash
bun run --cwd apps/layout-editor test src/lib/evidence-assignment.test.ts src/lib/EvidenceAssignmentPanel.test.ts src/lib/layout-store.test.ts src/lib/EditorCanvas.test.ts
```

Expected: all tests pass.

- [ ] **Step 2: Run compiler tests**

Run:

```bash
bunx vitest run scripts/compile-scenes/parser-investigation.test.ts scripts/compile-scenes/validator.test.ts scripts/compile-scenes/emitter.test.ts
```

Expected: all tests pass.

- [ ] **Step 3: Compile and audit**

Run:

```bash
bun run scenes:compile
bun run evidence-sources:audit
```

Expected: both pass.

- [ ] **Step 4: Direct Chapter 1 locality check**

Run:

```bash
bun --eval "const fs=require('fs'); const path=require('path'); const dir='apps/game/src-tauri/resources/scenes/chapter_1'; const files=fs.readdirSync(dir).filter(f=>f.startsWith('investigation_scene_')&&f.endsWith('.json')).sort((a,b)=>a.localeCompare(b, undefined, {numeric:true})); let failed=false; for (const file of files){ const scene=JSON.parse(fs.readFileSync(path.join(dir,file),'utf8')); const evidence=new Map((scene.evidenceManifest||[]).map(e=>[e.id,e.sourceSublocationId])); const issues=[]; const check=(sourceId, owner, reveals=[])=>{ for (const r of reveals||[]) if (r.kind==='evidence'){ const expected=evidence.get(r.id); if (expected!==sourceId) issues.push(owner+' reveals '+r.id+' from '+sourceId+' but expected '+expected); } }; for (const sub of scene.sublocations||[]){ check(sub.id, 'sublocation:'+sub.id, sub.reveals); for (const hs of sub.hotspots||[]) check(sub.id, 'hotspot:'+sub.id+'/'+hs.id, hs.reveals); for (const ch of sub.characters||[]) for (const topic of ch.topics||[]) check(sub.id, 'topic:'+sub.id+'/'+ch.id+'@'+topic.id, topic.reveals); } if (issues.length){ failed=true; console.log(file+': FAIL'); for (const issue of issues) console.log('  - '+issue); } else { console.log(file+': all evidence local'); } } if (failed) process.exit(1);"
```

Expected:

```text
investigation_scene_1.json: all evidence local
investigation_scene_3.json: all evidence local
investigation_scene_7.json: all evidence local
investigation_scene_8.json: all evidence local
investigation_scene_9.json: all evidence local
```

- [ ] **Step 5: Run broad checks**

Run:

```bash
bun run check
bun run lint:all
```

Expected: both pass.

- [ ] **Step 6: Commit verification fixes only if needed**

If verification changes code or story files, commit them:

```bash
git add <changed-files>
git commit -m "fix: tighten evidence carrier assignment"
```

If verification creates only ignored generated resources under
`apps/game/src-tauri/resources`, do not commit those files.

---

## Self-Review

- Spec coverage: The plan covers typed hotspot/topic/standalone carriers,
  standalone generated deletion by ID convention, person-sourced evidence through
  topics, Markdown-first sync, current Scene 3 dirty-state cleanup, Scene 7
  forensic topic cleanup, and verification.
- Placeholder scan: The plan has no `TBD`, no generic "add tests" step without
  concrete test examples, and no unbounded "handle edge cases" instruction.
- Type consistency: The plan consistently uses `EvidenceCarrier`,
  `carrierOptionsForEvidence`, `updateEvidenceCarrierInMarkdown`,
  `moveEvidenceRevealToCarrierInScene`, and `assignEvidenceToCarrier`.

# Local Evidence Collection Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enforce same-sublocation evidence collection, update the editor assignment flow to respect that boundary, and repair Chapter 1 Scene 3 so evidence is collected from believable local triggers.

**Architecture:** Add optional `Source Sublocation` metadata to shared evidence parsing, then make it mandatory for investigation scenes in validation. Emit the source sublocation into generated investigation JSON for editor use, and filter assignment choices to that source sublocation. Runtime inventory remains scene-level; the local restriction is an authoring/compiler/editor contract.

**Tech Stack:** TypeScript compiler scripts, Svelte 5 layout editor, Vitest, existing scene Markdown.

---

### Task 1: Parse and Emit Evidence Source Sublocation

**Files:**

- Modify: `scripts/compile-scenes/types.ts`
- Modify: `scripts/compile-scenes/parser-manifest.ts`
- Modify: `scripts/compile-scenes/parser-investigation.test.ts`
- Modify: `scripts/compile-scenes/emitter.ts`
- Modify: `scripts/compile-scenes/emitter.test.ts`
- Modify: `apps/layout-editor/src/lib/layout-types.ts`

**Step 1: Write parser test**

Add a `parser-investigation.test.ts` case that parses:

```md
## Evidence Manifest

### evidence:record {#record}
- **Name:** Record
- **Description:** Local record.
- **Details:** Record details.
- **Source Sublocation:** front
- **Image Prompt:** Record evidence icon.

#### On Collect

**相馬律**：記下來。
```

Expected assertion:

```ts
expect(result.value.evidenceManifest[0]?.sourceSublocationId).toBe("front");
```

Also add a shared-parser guard case where `Source Sublocation` is absent and
`sourceSublocationId` is `null`.

**Step 2: Run parser test to verify failure**

Run:

```bash
bunx vitest run scripts/compile-scenes/parser-investigation.test.ts -t "Source Sublocation"
```

Expected: fail because `sourceSublocationId` is not parsed.

**Step 3: Add AST field and parser support**

In `scripts/compile-scenes/types.ts`, add to `ASTEvidence`:

```ts
sourceSublocationId: string | null;
```

In `scripts/compile-scenes/parser-manifest.ts`, read:

```ts
const sourceSublocationId = meta.value["Source Sublocation"] ?? null;
```

and return it on the evidence AST value.

Do not require it in the shared parser because interrogation scenes also use
`parseEvidenceManifest`.

**Step 4: Emit source sublocation to investigation JSON**

In `scripts/compile-scenes/types.ts`, add `sourceSublocationId: string | null`
to the generated investigation evidence manifest item type.

In `scripts/compile-scenes/emitter.ts`, include:

```ts
sourceSublocationId: e.sourceSublocationId,
```

for investigation scene evidence manifest entries. Keep interrogation output as-is
unless existing shared helper code makes a small DRY update safer.

In `apps/layout-editor/src/lib/layout-types.ts`, add:

```ts
sourceSublocationId: string | null;
```

to the editor evidence manifest item.

**Step 5: Run tests**

Run:

```bash
bunx vitest run scripts/compile-scenes/parser-investigation.test.ts scripts/compile-scenes/emitter.test.ts
```

Expected: pass.

**Step 6: Commit**

```bash
git add scripts/compile-scenes/types.ts scripts/compile-scenes/parser-manifest.ts scripts/compile-scenes/parser-investigation.test.ts scripts/compile-scenes/emitter.ts scripts/compile-scenes/emitter.test.ts apps/layout-editor/src/lib/layout-types.ts
git commit -m "feat(scene): emit evidence source sublocations"
```

### Task 2: Validate Same-Sublocation Evidence Reveals

**Files:**

- Modify: `scripts/compile-scenes/validator.ts`
- Modify: `scripts/compile-scenes/validator.test.ts`
- Optional fixtures: `scripts/__fixtures__/invalid/<case>/...`

**Step 1: Write failing validation tests**

Add tests for investigation scenes:

- Evidence without `sourceSublocationId` produces code `evidenceSourceSublocationMissing`.
- Evidence with unknown source sublocation produces code `evidenceSourceSublocationUnknown`.
- A hotspot in `front` revealing evidence whose source is `corridor` produces code `evidenceRevealOutsideSourceSublocation`.
- A topic in a character under the wrong sublocation revealing that evidence also fails.
- A hotspot in the correct sublocation passes.

Minimal failing scene shape:

```ts
const scene = mkInvestigationScene();
scene.sublocations = [
  {
    id: "front",
    hotspots: [{ id: "desk", reveals: [{ kind: "evidence", id: "log" }] }],
    characters: [],
  },
  { id: "corridor", hotspots: [], characters: [] },
];
scene.evidenceManifest = [
  { ...mkEvidence("log"), sourceSublocationId: "corridor" },
];
```

**Step 2: Run validator test to verify failure**

Run:

```bash
bunx vitest run scripts/compile-scenes/validator.test.ts -t "source sublocation"
```

Expected: fail because validation is missing.

**Step 3: Implement validation**

In `validateInvestigationScene`, build:

```ts
const evidenceSourceSublocation = new Map<string, ASTEvidence>();
```

For each evidence:

- if `sourceSublocationId` is `null`, push `evidenceSourceSublocationMissing`;
- if it is not in `localSublocation`, push `evidenceSourceSublocationUnknown`;
- otherwise store the expected sublocation.

When checking reveal lists, pass the containing sublocation id into `checkReveals`.
For every `RevealTarget` of kind `evidence`, compare the revealer sublocation to
the evidence `sourceSublocationId`. If they differ, push:

```ts
{
  code: "evidenceRevealOutsideSourceSublocation",
  message: `Evidence ${r.id} belongs to sublocation ${expected}, but is revealed from ${actual}.`,
  sourceFile: scene.sourceFile,
  line,
}
```

**Step 4: Run validator tests**

Run:

```bash
bunx vitest run scripts/compile-scenes/validator.test.ts -t "source sublocation"
```

Expected: pass.

**Step 5: Commit**

```bash
git add scripts/compile-scenes/validator.ts scripts/compile-scenes/validator.test.ts
git commit -m "feat(scene): validate local evidence reveals"
```

### Task 3: Restrict Editor Assignment Choices

**Files:**

- Modify: `apps/layout-editor/src/lib/evidence-assignment.ts`
- Modify: `apps/layout-editor/src/lib/evidence-assignment.test.ts`
- Modify: `apps/layout-editor/src/lib/EvidenceAssignmentPanel.svelte`
- Modify: `apps/layout-editor/src/lib/EvidenceAssignmentPanel.test.ts`

**Step 1: Write failing helper test**

Add a scene with evidence:

```ts
{ id: "log", sourceSublocationId: "corridor" }
```

and hotspots in `front` and `corridor`. Assert that the assignment choices for
`log` include only `corridor` hotspots.

Suggested helper:

```ts
hotspotOptionsForEvidence(scene, evidence)
```

Expected:

```ts
expect(options.map((option) => option.id)).toEqual(["corridor_board"]);
```

**Step 2: Run helper test to verify failure**

Run:

```bash
bun run --cwd apps/layout-editor test src/lib/evidence-assignment.test.ts
```

Expected: fail because filtering helper is missing.

**Step 3: Implement filtering helper**

Add:

```ts
export function hotspotOptionsForEvidence(scene, evidence) {
  return scene.sublocations
    .filter((sublocation) =>
      evidence.sourceSublocationId
        ? sublocation.id === evidence.sourceSublocationId
        : true,
    )
    .flatMap(...);
}
```

Keep the fallback permissive only for old generated JSON while migration is in progress.
Once all authored investigation evidence has `Source Sublocation`, the compiler will
enforce it.

**Step 4: Update panel test**

Assert the select for a corridor-owned evidence item does not include front hotspots.

**Step 5: Update component**

In `EvidenceAssignmentPanel.svelte`, replace the scene-wide `hotspots` list with
`hotspotOptionsForEvidence(scene, assignment.evidence)` per row.

**Step 6: Run editor tests**

Run:

```bash
bun run --cwd apps/layout-editor test src/lib/evidence-assignment.test.ts src/lib/EvidenceAssignmentPanel.test.ts src/lib/layout-store.test.ts
```

Expected: pass.

**Step 7: Commit**

```bash
git add apps/layout-editor/src/lib/evidence-assignment.ts apps/layout-editor/src/lib/evidence-assignment.test.ts apps/layout-editor/src/lib/EvidenceAssignmentPanel.svelte apps/layout-editor/src/lib/EvidenceAssignmentPanel.test.ts
git commit -m "feat(editor): restrict evidence assignment by sublocation"
```

### Task 4: Backfill Chapter 1 Evidence Source Sublocations

**Files:**

- Modify: `docs/stories_plan/chapter_1/investigation_scene_1.md`
- Modify: `docs/stories_plan/chapter_1/investigation_scene_3.md`
- Modify: `docs/stories_plan/chapter_1/investigation_scene_7.md`
- Modify: `docs/stories_plan/chapter_1/investigation_scene_8.md`
- Modify: `docs/stories_plan/chapter_1/investigation_scene_9.md`
- Modify if needed: `.claude/skills/writing-investigation-scene/SKILL.md`

**Step 1: Add Source Sublocation metadata**

For every `### evidence:<id>` in Chapter 1 investigation scenes, add:

```md
- **Source Sublocation:** <sublocation_id>
```

Use the current hotspot reveal owner as the starting point, then correct any story
mismatches manually.

**Step 2: Repair Scene 3 trigger naming and reveal ownership**

Update Scene 3 as follows:

- Replace `front/timecard` and `front/doorlock_summary` with a broader local trigger
  such as `front/counter_admin_records`, revealing both `timecard_record` and
  `doorlock_summary_timetable`.
- Keep `front/cctv_playback` for `cctv_screenshot`.
- Keep `front/register` for `two_coffee_order`.
- Rename `corridor/sop_whiteboard` to a local visible trigger such as
  `corridor/wall_notice_board` if the prose/image fit better. It reveals
  `closing_routine`.
- Replace `inner_entry/l_floorplan` prose with derived spatial evidence. Suggested
  hotspot id: `inner_entry/storage_sightline`. It reveals `backroom_floorplan`, whose
  name can become `後場 L 型動線草圖`.

Preserve story meaning: the player learns the L-shaped layout from the inner-entry
geometry, not from a literal wall map.

**Step 3: Update layout sidecar ids**

Modify `docs/stories_plan/chapter_1/investigation_scene_3.layout.json` so renamed
hotspots keep sensible existing rectangles:

- `timecard` and `doorlock_summary` can collapse into `counter_admin_records`, using
  a rectangle over the counter/POS/admin-record area.
- `sop_whiteboard` can become `wall_notice_board` using the same rectangle if the board
  remains visually plausible.
- `l_floorplan` can become `storage_sightline`, using a rectangle around the shelving,
  door, or occluded sightline rather than the distant wall panel.

**Step 4: Update writer skill instructions**

In `.claude/skills/writing-investigation-scene/SKILL.md`, add guidance:

- every investigation evidence item must declare `Source Sublocation`;
- evidence may only be revealed by a trigger in that sublocation;
- if the background lacks a physical document, write the evidence as hidden/implied or
  derived from a local trigger rather than inventing an invisible document hotspot.

**Step 5: Compile**

Run:

```bash
bun run scenes:compile
```

Expected: pass.

**Step 6: Audit evidence sources**

Run:

```bash
bun run evidence-sources:audit
```

Expected: pass and report Scene 3 evidence on believable local triggers.

**Step 7: Commit**

```bash
git add docs/stories_plan/chapter_1/investigation_scene_*.md docs/stories_plan/chapter_1/investigation_scene_3.layout.json .claude/skills/writing-investigation-scene/SKILL.md
git commit -m "docs(story): localize chapter 1 evidence sources"
```

### Task 5: Final Verification

**Files:**

- No new source files unless verification reveals a gap.

**Step 1: Run compiler and focused tests**

Run:

```bash
bunx vitest run scripts/compile-scenes/parser-investigation.test.ts scripts/compile-scenes/validator.test.ts scripts/compile-scenes/emitter.test.ts
bun run --cwd apps/layout-editor test src/lib/evidence-assignment.test.ts src/lib/EvidenceAssignmentPanel.test.ts src/lib/layout-store.test.ts src/lib/EditorCanvas.test.ts
bun run scenes:compile
bun run evidence-sources:audit
```

Expected: all pass.

**Step 2: Run broad checks**

Run:

```bash
bun run check
bun run lint:all
```

Expected: both pass.

**Step 3: Direct Chapter 1 locality check**

Run a small script over `apps/game/src-tauri/resources/scenes/chapter_1/*.json` to
confirm every investigation evidence item has `sourceSublocationId` and every reveal
of that evidence comes from that same sublocation.

Expected summary:

```text
investigation_scene_1.json: all evidence local
investigation_scene_3.json: all evidence local
investigation_scene_7.json: all evidence local
investigation_scene_8.json: all evidence local
investigation_scene_9.json: all evidence local
```

**Step 4: Commit any verification-driven fixes**

If verification required changes:

```bash
git add <changed-files>
git commit -m "fix: tighten evidence locality checks"
```

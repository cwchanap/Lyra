# HPA-123 Chapter 1 Hotspot Overlap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the five player-facing Chapter 1 investigation hotspot intersections without changing investigation runtime behavior or story logic.

**Architecture:** Keep the existing investigation renderer and layout schema unchanged. Use the existing layout editor to correct three broad authored rectangles (`old_request_slips`, `takase_replay`, `fire_door_7`), keep the proof-bearing target rectangles stable, remove the now-obsolete `intentionalOverlaps` opt-outs, and verify the exact five pairs with a one-off geometry assertion plus the normal scene compiler and real UI smoke.

**Tech Stack:** Bun 1.3.1, existing Lyra investigation layout sidecars, existing Tauri/Svelte layout editor, existing scene compiler.

## Global Constraints

- Start the implementation branch from the latest `main`, not from the planning branch.
- Production diff is limited to:
  - `docs/stories_plan/chapter_1/investigation_scene_1.layout.json`
  - `docs/stories_plan/chapter_1/investigation_scene_7.layout.json`
- Do not edit the investigation Markdown, renderer, compiler, layout-store code, schema, runtime, or assets.
- Do not change hotspot IDs, declaration order, labels, reveals, accessible names, or keyboard behavior.
- Protect the existing geometry of `kagami_summary_hotspot`, `canned_coffee`, `miyake_replay`, `bean_can`, and `floor_water` unless visual inspection proves a tiny adjustment is strictly required. The default plan is to leave all five unchanged.
- Adjust only `old_request_slips`, `takase_replay`, and `fire_door_7`.
- All five HPA-123 hotspot pairs must end with zero shared interior area.
- Remove the three obsolete `intentionalOverlaps` groups once the rectangles are disjoint.
- Do not add a reusable geometry script, lower the global overlap-warning threshold, or create a new renderer abstraction for this ticket.

---

## Task 1: Establish the RED baseline and freeze protected geometry

**Files:**
- Read: `docs/stories_plan/chapter_1/investigation_scene_1.layout.json`
- Read: `docs/stories_plan/chapter_1/investigation_scene_7.layout.json`
- Read: `packages/scripts/compile-scenes/layout.ts`
- No production edits in this task.

- [ ] **Step 1: Confirm the branch is based on current `main` and the working tree is clean**

```bash
git status --short
git branch --show-current
git log -1 --oneline
```

Expected: no unrelated local changes.

- [ ] **Step 2: Record the protected hotspot geometry before editing**

The implementation must preserve these current normalized rectangles by default:

| Scene / sublocation | Hotspot | `x` | `y` | `w` | `h` |
| --- | --- | ---: | ---: | ---: | ---: |
| scene 1 / office | `kagami_summary_hotspot` | `0.245916` | `0.289239` | `0.220529` | `0.201036` |
| scene 1 / office | `canned_coffee` | `0.520697` | `0.362626` | `0.068254` | `0.141806` |
| scene 7 / inner | `miyake_replay` | `0.264` | `0.11` | `0.092` | `0.46` |
| scene 7 / inner | `bean_can` | `0.374` | `0.455` | `0.115` | `0.15` |
| scene 7 / back_door | `floor_water` | `0.365519` | `0.624898` | `0.312777` | `0.222284` |

The three rectangles that are expected to move/shrink start at:

| Scene / sublocation | Hotspot | `x` | `y` | `w` | `h` |
| --- | --- | ---: | ---: | ---: | ---: |
| scene 1 / office | `old_request_slips` | `0.336339` | `0.273903` | `0.286957` | `0.182609` |
| scene 7 / inner | `takase_replay` | `0.274` | `0.472` | `0.124` | `0.28` |
| scene 7 / back_door | `fire_door_7` | `0.6304` | `0.068032` | `0.066465` | `0.72038` |

- [ ] **Step 3: Run the normal compiler baseline**

```bash
bun run scenes:compile
```

Expected: compilation succeeds. Do **not** treat `Layout warnings (0)` as proof that HPA-123 is fixed; `detectLayoutOverlaps()` only warns on high-coverage intersections and the current pairs are also opt-out entries.

- [ ] **Step 4: Run the exact five-pair geometry assertion and watch it fail**

```bash
bun -e '
import { readFileSync } from "node:fs";

const cases = [
  ["docs/stories_plan/chapter_1/investigation_scene_1.layout.json", "office", "old_request_slips", "kagami_summary_hotspot"],
  ["docs/stories_plan/chapter_1/investigation_scene_1.layout.json", "office", "old_request_slips", "canned_coffee"],
  ["docs/stories_plan/chapter_1/investigation_scene_7.layout.json", "inner", "takase_replay", "miyake_replay"],
  ["docs/stories_plan/chapter_1/investigation_scene_7.layout.json", "inner", "takase_replay", "bean_can"],
  ["docs/stories_plan/chapter_1/investigation_scene_7.layout.json", "back_door", "fire_door_7", "floor_water"],
];

const cache = new Map();
function load(path) {
  if (!cache.has(path)) cache.set(path, JSON.parse(readFileSync(path, "utf8")));
  return cache.get(path);
}
function intersects(a, b) {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0;
}

const failures = [];
for (const [path, sublocation, aId, bId] of cases) {
  const hotspots = load(path).sublocations[sublocation].hotspots;
  if (intersects(hotspots[aId], hotspots[bId])) {
    failures.push(`${path}:${sublocation}:${aId}<->${bId}`);
  }
}

if (failures.length > 0) {
  console.error(`HPA-123 overlaps still present (${failures.length}):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log("HPA-123 exact hotspot overlaps: 0");
'
```

Expected RED result on the pre-fix sidecars: exit status `1`, reporting all five named pairs.

If this command passes before editing, stop and re-check `main`; the ticket may have been fixed since this plan was written.

---

## Task 2: Fix `investigation_scene_1 / office`

**Files:**
- Modify: `docs/stories_plan/chapter_1/investigation_scene_1.layout.json`

- [ ] **Step 1: Compile current scenes, then launch the existing layout editor**

```bash
bun run scenes:compile
bun run dev:editor
```

In the editor, open Chapter 1 → `investigation_scene_1` → `office`.

- [ ] **Step 2: Resize/reposition only `old_request_slips` against the real background**

Requirements:

- the rectangle still clearly covers the visible stack of old request papers;
- it has zero interior intersection with `kagami_summary_hotspot`;
- it has zero interior intersection with `canned_coffee`;
- `kagami_summary_hotspot`, `canned_coffee`, and `broken_coffee_machine` remain unchanged;
- the resulting target is still comfortably clickable rather than collapsed into a tiny box.

Save the editor-produced normalized geometry.

- [ ] **Step 3: Remove the obsolete Scene 1 overlap opt-outs**

Delete the two `office.intentionalOverlaps` entries:

```json
{ "hotspots": ["kagami_summary_hotspot", "old_request_slips"] }
{ "hotspots": ["canned_coffee", "old_request_slips"] }
```

With no remaining intentional overlap in `office`, omit the `intentionalOverlaps` property entirely.

The editor intentionally preserves this metadata, so this cleanup must be explicit after the geometry save.

- [ ] **Step 4: Verify the Scene 1 pair geometry**

Run the exact checker from Task 1. It may still fail for the three Scene 7 pairs, but the two Scene 1 pair names must no longer appear in the failure list.

- [ ] **Step 5: Inspect the diff for accidental geometry drift**

```bash
git diff -- docs/stories_plan/chapter_1/investigation_scene_1.layout.json
```

Expected diff:

- `old_request_slips` normalized coordinates change;
- the Scene 1 `intentionalOverlaps` property is removed;
- no other hotspot/character geometry or IDs change.

- [ ] **Step 6: Commit the Scene 1 correction**

```bash
git add docs/stories_plan/chapter_1/investigation_scene_1.layout.json
git commit -m "fix(story): separate office investigation hotspots"
```

---

## Task 3: Fix `investigation_scene_7 / inner` and `/back_door`

**Files:**
- Modify: `docs/stories_plan/chapter_1/investigation_scene_7.layout.json`

- [ ] **Step 1: Open Scene 7 in the existing layout editor**

If the editor is not already running:

```bash
bun run scenes:compile
bun run dev:editor
```

Open Chapter 1 → `investigation_scene_7`.

- [ ] **Step 2: Fix `inner / takase_replay` without moving the evidence target**

Use the real inner-storage background to shrink/reposition `takase_replay` so it still represents the Takase replay route/position and has zero interior intersection with both:

- `miyake_replay`;
- `bean_can`.

Keep `miyake_replay`, `bean_can`, `phone_drop`, `old_clock`, and `corridor_scuff` unchanged.

Do not solve the collision by moving `bean_can` away from the murder-weapon artwork.

- [ ] **Step 3: Fix `back_door / fire_door_7` without moving `floor_water`**

Resize/reposition the tall `fire_door_7` rectangle so it still covers the visible half-open fire door and has zero interior intersection with `floor_water`.

Keep `floor_water`, `umbrella_sleeve`, `alley_drain_rain`, and `staff_shelf` unchanged.

The expected direction is to narrow/shorten the broad door navigation hitbox, not to reduce the required water-evidence target.

- [ ] **Step 4: Remove the obsolete Scene 7 overlap opt-outs**

Remove:

```json
{ "hotspots": ["takase_replay", "miyake_replay"] }
{ "hotspots": ["takase_replay", "bean_can"] }
{ "hotspots": ["fire_door_7", "floor_water"] }
```

Omit `inner.intentionalOverlaps` and `back_door.intentionalOverlaps` entirely if no other opt-outs remain.

- [ ] **Step 5: Run the exact checker from Task 1 and verify GREEN**

Expected output:

```text
HPA-123 exact hotspot overlaps: 0
```

Expected exit status: `0`.

- [ ] **Step 6: Inspect the Scene 7 diff for accidental drift**

```bash
git diff -- docs/stories_plan/chapter_1/investigation_scene_7.layout.json
```

Expected diff:

- `takase_replay` normalized coordinates change;
- `fire_door_7` normalized coordinates change;
- `inner.intentionalOverlaps` is removed;
- `back_door.intentionalOverlaps` is removed;
- protected evidence/replay rectangles and character placement remain unchanged.

- [ ] **Step 7: Commit the Scene 7 correction**

```bash
git add docs/stories_plan/chapter_1/investigation_scene_7.layout.json
git commit -m "fix(story): separate replay and evidence hotspots"
```

---

## Task 4: Compile and perform the player-facing acceptance smoke

**Files:**
- Verify only: `docs/stories_plan/chapter_1/investigation_scene_1.layout.json`
- Verify only: `docs/stories_plan/chapter_1/investigation_scene_7.layout.json`

- [ ] **Step 1: Re-run the exact geometry assertion**

Run the Task 1 checker again.

Expected:

```text
HPA-123 exact hotspot overlaps: 0
```

- [ ] **Step 2: Run the existing scene compiler**

```bash
bun run scenes:compile
```

Expected:

- compilation succeeds;
- `Layout warnings (0)`.

- [ ] **Step 3: Run a diff hygiene check**

```bash
git diff --check main...HEAD
git diff --stat main...HEAD
git diff main...HEAD -- \
  docs/stories_plan/chapter_1/investigation_scene_1.layout.json \
  docs/stories_plan/chapter_1/investigation_scene_7.layout.json
```

Expected production implementation scope: exactly the two layout sidecars, with no Markdown/runtime/compiler/schema changes.

- [ ] **Step 4: Launch the real game for pointer acceptance**

```bash
bun run dev:game
```

Use a development path/save that reaches the affected scenes and verify each target from the intended visual object.

Scene 1 / office:

1. click `桌上舊委託單` → old-request-slips interaction;
2. click the KAGAMI folder → `桌面卷宗夾` / KAGAMI summary interaction;
3. click the canned coffee → `便利店罐咖啡` interaction.

Each must be independently selectable without triggering another target.

Scene 7 / inner:

1. activate the Takase replay target;
2. activate the Miyake replay target;
3. click the bean can and confirm the murder-weapon-candidate inspection runs rather than either replay.

Scene 7 / back door:

1. click the fire door and confirm sublocation navigation behaves as authored;
2. click the half-dry water trace and confirm the `floor_water` inspection runs without entering the inner sublocation.

- [ ] **Step 5: Verify keyboard/accessibility behavior did not regress**

Tab to the affected controls in the same real-game smoke and activate representative controls with the keyboard.

Expected:

- existing `調查：...` accessible labels remain unchanged;
- the controls remain native buttons and keyboard-activatable;
- no new focus order or interaction mechanism was introduced.

- [ ] **Step 6: Final scope review**

```bash
git status --short
git log --oneline --decorate main..HEAD
git diff --name-only main...HEAD
```

Expected implementation file list:

```text
docs/stories_plan/chapter_1/investigation_scene_1.layout.json
docs/stories_plan/chapter_1/investigation_scene_7.layout.json
```

If any runtime, compiler, schema, Markdown, or asset file appears, stop and justify it against HPA-123 before publishing; the default answer is to revert it.

---

## Task 5: Publish the implementation PR and hand off to Chapter 1 work

- [ ] **Step 1: Push the implementation branch**

```bash
git push -u origin HEAD
```

- [ ] **Step 2: Open the implementation PR against `main`**

PR summary should state:

- HPA-123 fixes authored geometry only;
- the three broad rectangles changed;
- the five target pairs now have zero intersection;
- stale `intentionalOverlaps` entries were removed;
- no renderer/schema/compiler behavior changed;
- `bun run scenes:compile` and real pointer/keyboard smoke passed.

- [ ] **Step 3: Update HPA-123 with the implementation PR link and acceptance evidence**

Keep the issue focused on the blocker. Do not pull HPA-265, HPA-262, HPA-264, or broader layout cleanup into the implementation PR.

## Stop conditions

Stop and re-plan rather than expanding HPA-123 if any of the following is discovered during implementation:

1. One of the three broad targets cannot be made both visually truthful and independently clickable without changing the background asset.
2. The real renderer exhibits click stealing even after the exact rectangle pairs are disjoint.
3. The layout editor rewrites unrelated hotspot/character geometry and the drift cannot be cleanly reverted.
4. A protected evidence target is visually wrong on the current background and would require a broader scene-layout redesign.

Those would be evidence for a separate follow-up. They are not permission to add runtime arbitration or a new hotspot abstraction inside HPA-123.

## Final verification checklist

- [ ] Exact five-pair checker fails before the geometry edit and passes after it.
- [ ] Scene 1 `old_request_slips` no longer intersects KAGAMI summary or canned coffee.
- [ ] Scene 7 `takase_replay` no longer intersects Miyake replay or bean can.
- [ ] Scene 7 `fire_door_7` no longer intersects floor water.
- [ ] Three obsolete `intentionalOverlaps` groups are removed.
- [ ] Protected proof-bearing hotspot geometry remains stable by default.
- [ ] `bun run scenes:compile` succeeds with `Layout warnings (0)`.
- [ ] All affected targets are independently pointer-reachable on the intended objects.
- [ ] `bean_can` and `floor_water` cannot be stolen by replay/navigation targets.
- [ ] Keyboard/accessibility labels and activation remain unchanged.
- [ ] Production diff contains only the two Chapter 1 layout sidecars.

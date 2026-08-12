# HPA-123 Chapter 1 Hotspot Overlap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the five Chapter 1 investigation hotspot intersections without changing investigation runtime behavior or story logic.

**Architecture:** Keep the current renderer and layout schema. Use the existing layout editor to resize/reposition three broad authored rectangles, remove their stale `intentionalOverlaps` opt-outs, then verify the exact five pairs, compile Chapter 1, and smoke-test the real pointer/keyboard interactions.

**Tech Stack:** Bun 1.3.1, existing investigation layout sidecars, existing Tauri/Svelte layout editor, existing scene compiler.

## Global Constraints

- Start implementation from latest `main`, not this planning branch.
- Production diff is exactly:
  - `docs/stories_plan/chapter_1/investigation_scene_1.layout.json`
  - `docs/stories_plan/chapter_1/investigation_scene_7.layout.json`
- Change only these hotspot rectangles:
  - `old_request_slips`;
  - `takase_replay`;
  - `fire_door_7`.
- Keep `kagami_summary_hotspot`, `canned_coffee`, `miyake_replay`, `bean_can`, and `floor_water` geometry unchanged.
- Do not change hotspot IDs, order, labels, reveals, Markdown, assets, renderer, compiler, schema, or runtime.
- Do not add a reusable overlap checker or lower the global warning threshold.

---

## Task 1: Prove the current bug before editing

**Files:**
- Read: `docs/stories_plan/chapter_1/investigation_scene_1.layout.json`
- Read: `docs/stories_plan/chapter_1/investigation_scene_7.layout.json`
- Read: `packages/scripts/compile-scenes/layout.ts`

- [ ] **Step 1: Confirm a clean branch from current `main`**

```bash
git status --short
git branch --show-current
git log -1 --oneline
```

- [ ] **Step 2: Run the normal compiler baseline**

```bash
bun run scenes:compile
```

Expected: compile succeeds. `Layout warnings (0)` does not prove this bug absent because the compiler only warns on high-coverage intersections.

- [ ] **Step 3: Run the exact five-pair check and watch it fail**

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
const load = (path) => {
  if (!cache.has(path)) cache.set(path, JSON.parse(readFileSync(path, "utf8")));
  return cache.get(path);
};
const intersects = (a, b) =>
  Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 0 &&
  Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > 0;

const failures = cases.filter(([path, sublocation, aId, bId]) => {
  const hotspots = load(path).sublocations[sublocation].hotspots;
  return intersects(hotspots[aId], hotspots[bId]);
});

if (failures.length) {
  for (const [path, sublocation, aId, bId] of failures) {
    console.error(`${path}:${sublocation}:${aId}<->${bId}`);
  }
  process.exit(1);
}
console.log("HPA-123 exact hotspot overlaps: 0");
'
```

Expected RED result on current `main`: exit `1` with all five pair names.

If it passes before edits, stop: the ticket has likely become stale and should be re-evaluated instead of implemented.

---

## Task 2: Correct the two authored sidecars

**Files:**
- Modify: `docs/stories_plan/chapter_1/investigation_scene_1.layout.json`
- Modify: `docs/stories_plan/chapter_1/investigation_scene_7.layout.json`

- [ ] **Step 1: Launch the existing layout editor**

```bash
bun run scenes:compile
bun run dev:editor
```

Use the real backgrounds; do not invent replacement coordinates from this plan.

- [ ] **Step 2: Fix Scene 1 / `office`**

Resize/reposition only `old_request_slips` so it still covers the visible paper stack and is disjoint from:

- `kagami_summary_hotspot`;
- `canned_coffee`.

Keep these current protected rectangles unchanged:

```text
kagami_summary_hotspot = x 0.245916, y 0.289239, w 0.220529, h 0.201036
canned_coffee          = x 0.520697, y 0.362626, w 0.068254, h 0.141806
```

After saving, remove `office.intentionalOverlaps` entirely; its two entries cover only the pairs being fixed.

- [ ] **Step 3: Fix Scene 7 / `inner`**

Resize/reposition only `takase_replay` so it still represents Takase's replay route/position and is disjoint from:

- `miyake_replay`;
- `bean_can`.

Keep these protected rectangles unchanged:

```text
miyake_replay = x 0.264, y 0.11,  w 0.092, h 0.46
bean_can      = x 0.374, y 0.455, w 0.115, h 0.15
```

Remove `inner.intentionalOverlaps` entirely.

- [ ] **Step 4: Fix Scene 7 / `back_door`**

Shorten/reposition only `fire_door_7` so it still covers the visible half-open fire door and is disjoint from `floor_water`.

Keep `floor_water` unchanged:

```text
floor_water = x 0.365519, y 0.624898, w 0.312777, h 0.222284
```

Remove `back_door.intentionalOverlaps` entirely.

- [ ] **Step 5: Re-run the exact checker from Task 1**

Expected GREEN result:

```text
HPA-123 exact hotspot overlaps: 0
```

- [ ] **Step 6: Inspect the production diff before committing**

```bash
git diff -- \
  docs/stories_plan/chapter_1/investigation_scene_1.layout.json \
  docs/stories_plan/chapter_1/investigation_scene_7.layout.json
```

Expected semantic diff only:

- `old_request_slips` coordinates change;
- `takase_replay` coordinates change;
- `fire_door_7` coordinates change;
- three obsolete `intentionalOverlaps` groups disappear;
- all protected hotspot and character geometry remains byte-for-byte unchanged.

- [ ] **Step 7: Commit the geometry fix**

```bash
git add \
  docs/stories_plan/chapter_1/investigation_scene_1.layout.json \
  docs/stories_plan/chapter_1/investigation_scene_7.layout.json
git commit -m "fix(story): separate Chapter 1 investigation hotspots"
```

---

## Task 3: Verify player behavior and publish

- [ ] **Step 1: Run final automated checks**

```bash
# exact checker from Task 1
bun run scenes:compile
git diff --check main...HEAD
git diff --name-only main...HEAD
```

Expected:

- exact checker: `HPA-123 exact hotspot overlaps: 0`;
- scene compile succeeds with `Layout warnings (0)`;
- implementation diff lists only the two layout sidecars.

- [ ] **Step 2: Smoke-test the real game**

```bash
bun run dev:game
```

Verify from the intended visual objects:

**Scene 1 / office**

- old request slips triggers only `old_request_slips`;
- KAGAMI folder triggers only `kagami_summary_hotspot`;
- canned coffee triggers only `canned_coffee`.

**Scene 7 / inner**

- Takase replay and Miyake replay are independently selectable;
- bean can triggers its inspection and never a replay.

**Scene 7 / back door**

- fire door opens the authored inner route;
- half-dry water trace triggers `floor_water` and never the fire-door navigation.

- [ ] **Step 3: Keyboard/accessibility smoke**

Tab to representative affected controls and activate them by keyboard.

Expected: existing native-button behavior and `調查：...` accessible labels are unchanged because no Markdown IDs/labels or renderer code changed.

- [ ] **Step 4: Final scope check**

```bash
git status --short
git log --oneline main..HEAD
git diff --name-only main...HEAD
```

If anything beyond the two layout sidecars appears in the implementation diff, revert it unless HPA-123 is explicitly re-scoped first.

- [ ] **Step 5: Push and open the implementation PR**

```bash
git push -u origin HEAD
```

PR acceptance evidence should include:

- five exact intersections: `0`;
- `bun run scenes:compile` with `Layout warnings (0)`;
- real pointer smoke for all affected targets;
- keyboard/accessibility smoke;
- confirmation that no runtime/schema/compiler behavior changed.

Attach the implementation PR to HPA-123 and keep HPA-265/HPA-262/HPA-264 out of scope.

## Stop Conditions

Stop and create a separate follow-up instead of expanding HPA-123 if:

- one of the three broad hitboxes cannot be made visually truthful and disjoint using the current background;
- click stealing persists after the rectangles are mathematically disjoint;
- the layout editor rewrites unrelated geometry that cannot be cleanly reverted.

Those findings may justify asset/layout-editor/runtime work later; they do not justify adding it pre-emptively to this blocker.

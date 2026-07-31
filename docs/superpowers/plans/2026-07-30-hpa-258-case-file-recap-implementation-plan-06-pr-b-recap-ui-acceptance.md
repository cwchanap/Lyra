# HPA-258 PR B Recap UI and Acceptance — Implementation Tasks 15–16

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans`. Follow the parent plan `2026-07-30-hpa-258-case-file-recap-implementation-plan.md`, execute these tasks in order, verify each red test fails for the intended reason, and commit only after the focused green commands pass.

## Task 15: Share recap text across Save Browser and Continue

**Files:**
- Modify: `apps/game/src/lib/persistence/types.ts`
- Create: `apps/game/src/lib/components/SaveRecapDetails.svelte`
- Create: `apps/game/src/lib/components/SaveRecapDetails.test.ts`
- Modify: `apps/game/src/lib/components/SaveCard.svelte`
- Modify: `apps/game/src/lib/components/SaveCard.test.ts`

**Interfaces:**
- Consumes: V2 public metadata from Task 14.
- Produces: reusable compact/expanded textual recap with no thumbnail side effects.

- [ ] **Step 1: Mirror nullable V2 summary types**

Add `chapterSummary`, `sceneSummary`, and `activePrimaryObjectiveSummary` as `string | null`. Keep valid and readable-invalid metadata summary types aligned with Rust.

- [ ] **Step 2: Write failing shared component tests**

Props:

```ts
let {
  slotType,
  savedAt,
  summary,
  density = "compact",
}: {
  slotType: "auto" | "manual";
  savedAt: string | null;
  summary: SaveSummaryView;
  density?: "compact" | "expanded";
} = $props();
```

Assert save type/time, titles, optional summaries, objective label/summary, compact clamp classes, expanded classes, and clean omission of null summary copy. The component must not call `readSaveThumbnail`.

- [ ] **Step 3: Run red**

```bash
rtk bun run --cwd apps/game test \
  src/lib/components/SaveRecapDetails.test.ts \
  src/lib/components/SaveCard.test.ts
```

- [ ] **Step 4: Extract text from SaveCard**

Keep thumbnail URL ownership, placeholders, selection/load/delete actions, and diagnostics in `SaveCard`. Replace the inline chapter/scene/objective/time block with `SaveRecapDetails density="compact"` when summary exists.

- [ ] **Step 5: Green**

```bash
rtk bun run --cwd apps/game test \
  src/lib/components/SaveRecapDetails.test.ts \
  src/lib/components/SaveCard.test.ts
rtk bun run check
```

- [ ] **Step 6: Commit**

```bash
rtk git add \
  apps/game/src/lib/persistence/types.ts \
  apps/game/src/lib/components/SaveRecapDetails.svelte \
  apps/game/src/lib/components/SaveRecapDetails.test.ts \
  apps/game/src/lib/components/SaveCard.svelte \
  apps/game/src/lib/components/SaveCard.test.ts
rtk git commit -m "feat: share save recap details"
```

---

## Task 16: Add the title Continue recap and close PR B

**Files:**
- Modify: `apps/game/src/lib/components/MainMenu.svelte`
- Modify: `apps/game/src/lib/components/MainMenu.test.ts`
- Modify: `apps/game/src/routes/+page.svelte`
- Modify: `apps/game/src/routes/page.test.ts`
- Modify: `apps/game/e2e-tauri/app.e2e.ts`
- Modify: packaged persistence E2E specs that construct/read save summaries
- Modify: save-content revision golden fixture if required by the compiler test output

**Interfaces:**
- Consumes: `SaveRecapDetails`, V2 summaries, and scene summary public view.
- Produces: expanded newest-written recap beside Continue and V2 manual-save preview summary.

- [ ] **Step 1: Write failing page summary tests**

Update `currentSaveSummary` to include:

```ts
chapterSummary: state.chapter.summary,
sceneSummary: state.scene.summary,
activePrimaryObjectiveSummary: activePrimaryObjective?.summary ?? null,
```

Assert the manual-save name/overwrite flow receives all V2 fields.

- [ ] **Step 2: Write failing MainMenu recap tests**

Construct a valid newest candidate and assert the main menu renders one `繼續遊戲摘要` region with expanded chapter/scene/objective recap and no thumbnail read. Construct an invalid newest candidate with readable metadata and assert retained recap copy is shown while clicking Continue still follows the existing diagnostic path. Unreadable invalid metadata shows no invented recap.

- [ ] **Step 3: Run red**

```bash
rtk bun run --cwd apps/game test \
  src/lib/components/MainMenu.test.ts \
  src/routes/page.test.ts
```

- [ ] **Step 4: Resolve the newest slot without changing selection semantics**

In `MainMenu`, find the slot whose reference equals `discovery.continueCandidate`. Derive metadata from valid status or readable invalid status. Render `SaveRecapDetails density="expanded"` only when a summary is available. Continue/Load enablement and newest-invalid behavior remain unchanged.

- [ ] **Step 5: Update packaged E2E**

Add assertions that a schema-v2 save appears in Save Browser and the title screen shows available recap fields before Continue. Preserve the HPA-392 rule that an invalid newest save blocks Continue and offers Load Game rather than silently choosing an older slot.

- [ ] **Step 6: Run full PR B verification**

```bash
rtk bun run test:scripts
rtk bun run test
rtk bun run check:scripts
rtk bun run check
rtk bun run --cwd apps/game check:e2e
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml
rtk bun run lint:all
rtk bun run scenes:compile
```

Then run packaged E2E:

```bash
rtk bun run test:e2e
```

- [ ] **Step 7: Inspect compatibility evidence**

Record in the PR description:

- one schema-v1 fixture migrated structurally to V2 under a matching synthetic revision;
- one old-package save rejected for `contentRevision` mismatch after migration;
- new saves written as schema 2;
- `SaveSnapshotV1` unchanged;
- no generated resource JSON tracked.

- [ ] **Step 8: Commit final acceptance**

```bash
rtk git add \
  apps/game/src/lib/components/MainMenu.svelte \
  apps/game/src/lib/components/MainMenu.test.ts \
  apps/game/src/routes/+page.svelte \
  apps/game/src/routes/page.test.ts \
  apps/game/e2e-tauri \
  packages/scripts/__fixtures__ \
  packages/scripts/__snapshots__
rtk git commit -m "feat: show continue recap"
```

- [ ] **Step 9: Open PR B**

The PR description must explicitly state that scene summaries intentionally change `contentRevision`, so pre-release saves from the preceding package are content-incompatible even though schema-v1 decoding and migration work.

---

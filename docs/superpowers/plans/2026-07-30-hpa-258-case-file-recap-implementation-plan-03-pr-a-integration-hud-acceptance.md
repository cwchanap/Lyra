# HPA-258 PR A Integration, HUD, and Acceptance — Implementation Tasks 7–9

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans`. Follow the parent plan `2026-07-30-hpa-258-case-file-recap-implementation-plan.md`, execute these tasks in order, verify each red test fails for the intended reason, and commit only after the focused green commands pass.

## Task 7: Replace the Evidence submenu and preserve menu/focus behavior

**Files:**
- Modify: `apps/game/src/lib/components/GameShell.svelte`
- Modify: `apps/game/src/lib/components/GameShell.test.ts`
- Modify: `apps/game/src/lib/test-harnesses/GameShellHarness.svelte`
- Modify: `apps/game/src/routes/+page.svelte`
- Modify: `apps/game/src/routes/page.test.ts`
- Modify: `apps/game/src/lib/state/mode.ts`
- Modify: `apps/game/src/lib/state/mode.test.ts`
- Delete: `apps/game/src/lib/components/InventoryPanel.svelte`
- Delete: `apps/game/src/lib/components/InventoryPanel.test.ts`
- Modify: `apps/game/e2e-tauri/production-anchors.ts`
- Modify: `apps/game/e2e-tauri/app.e2e.ts`

**Interfaces:**
- Consumes: `CaseFilePanel` from Tasks 5–6.
- Produces: `caseFileMenuEnabled`, `caseFile` submenu ID/copy, section persistence across menu close/reopen, and initial-focus delegation.

- [ ] **Step 1: Rename mode helpers under failing tests**

Replace `shouldShowInventoryPanel` with `shouldShowCaseFile`; keep `canReexamineInventory` or rename it consistently to `canReexamineCaseRecords`. Assert Case File is hidden only in `gameComplete` and re-examination remains explore/interrogation only.

- [ ] **Step 2: Write failing GameShell rename/focus tests**

Update expectations from `物證檔案` to `案件檔案`. Add a submenu fixture containing `[data-submenu-initial-focus]` and assert opening the Case File focuses that element, while scene/sound submenus without the marker still focus Back. Escape/BACK must restore focus to the `案件檔案` root button.

- [ ] **Step 3: Run red**

```bash
rtk bun run --cwd apps/game test \
  src/lib/state/mode.test.ts \
  src/lib/components/GameShell.test.ts \
  src/routes/page.test.ts
```

- [ ] **Step 4: Update GameShell’s semantic contract**

Rename:

```ts
type MenuPanel = "scene" | "caseFile" | "sound" | null;
caseFileMenuEnabled?: boolean;
```

Use `data-opens="caseFile"`, `案件檔案`, and `CASE FILE`. After opening a submenu:

```ts
const target = gameMenuPanel?.querySelector<HTMLElement>(
  "[data-submenu-initial-focus]",
);
(target ?? submenuBackButton)?.focus();
```

Do not add a new window-level key listener.

- [ ] **Step 5: Integrate the page and reset only on session replacement**

Replace the hoisted `inventoryPanelOpen` with:

```ts
let caseFileSection = $state<CaseFileSection>("objective");
let observedCaseFileEpoch = presentationState.sessionEpoch;

$effect(() => {
  const epoch = presentationState.sessionEpoch;
  if (epoch !== observedCaseFileEpoch) {
    observedCaseFileEpoch = epoch;
    caseFileSection = "objective";
  }
});
```

Bind `section={caseFileSection}`. Keep existing `handleReexamineEvidence/Statement` so the menu closes after command resolution/error.

- [ ] **Step 6: Remove the legacy panel**

Delete `InventoryPanel` and its tests only after all image/re-examination regressions exist in Task 6. Confirm no imports or strings remain:

```bash
rtk rg "InventoryPanel|inventoryPanelOpen|物證檔案|evidenceMenuEntry|evidenceFile" apps/game/src apps/game/e2e-tauri
```

Expected after the rename: no legacy component/state/anchor names.

- [ ] **Step 7: Update packaged anchor coupling**

In `production-anchors.ts` use:

```ts
caseFileMenuEntry: "案件檔案",
caseFile: "案件檔案",
```

Update `app.e2e.ts` to open the Case File and verify the acquired production evidence appears.

- [ ] **Step 8: Green**

```bash
rtk bun run --cwd apps/game test \
  src/lib/state/mode.test.ts \
  src/lib/components/GameShell.test.ts \
  src/lib/components/case-file/CaseFilePanel.test.ts \
  src/routes/page.test.ts
rtk bun run check
rtk bun run --cwd apps/game check:e2e
```

- [ ] **Step 9: Commit**

```bash
rtk git add -A apps/game/src apps/game/e2e-tauri
rtk git commit -m "feat: replace evidence menu with case file"
```

---

## Task 8: Add the active-primary-objective HUD

**Files:**
- Create: `apps/game/src/lib/components/PrimaryObjectiveHud.svelte`
- Create: `apps/game/src/lib/components/PrimaryObjectiveHud.test.ts`
- Modify: `apps/game/src/lib/components/GameShell.svelte`
- Modify: `apps/game/src/lib/components/GameShell.test.ts`
- Modify: `apps/game/src/lib/components/ExploreView.svelte`
- Modify: `apps/game/src/lib/components/ExploreView.test.ts`
- Modify: `apps/game/src/routes/+page.svelte`
- Modify: `apps/game/src/routes/page.test.ts`

**Interfaces:**
- Consumes: public objectives; active objective is the unique `activePrimary && !completed` item.
- Produces: non-interactive compact HUD in dialogue/interrogation and exploration’s existing `hud` snippet.

- [ ] **Step 1: Write failing component tests**

Assert the component renders `主要目標 / PRIMARY OBJECTIVE` and the label, has a non-interactive status/region semantics, renders nothing for null, and never shows the full summary.

- [ ] **Step 2: Write failing placement tests**

In GameShell tests, active primary appears below chapter copy for dialogue/interrogation but not game complete. In ExploreView/page tests, pass the same component through the existing `hud` snippet beside sublocation navigation. Assert no duplicate HUD in exploration.

- [ ] **Step 3: Run red**

```bash
rtk bun run --cwd apps/game test \
  src/lib/components/PrimaryObjectiveHud.test.ts \
  src/lib/components/GameShell.test.ts \
  src/lib/components/ExploreView.test.ts \
  src/routes/page.test.ts
```

- [ ] **Step 4: Implement one selector and two placements**

Derive once in `+page.svelte`:

```ts
let activePrimaryObjective = $derived(
  gameState.value?.story.objectives.find(
    (objective) => objective.activePrimary && !objective.completed,
  ) ?? null,
);
```

Pass the value to GameShell for non-explore header rendering and render the same component in ExploreView’s `hud` snippet. Do not make the HUD a menu opener.

- [ ] **Step 5: Green**

```bash
rtk bun run --cwd apps/game test \
  src/lib/components/PrimaryObjectiveHud.test.ts \
  src/lib/components/GameShell.test.ts \
  src/lib/components/ExploreView.test.ts \
  src/routes/page.test.ts
rtk bun run check
```

- [ ] **Step 6: Commit**

```bash
rtk git add \
  apps/game/src/lib/components/PrimaryObjectiveHud.svelte \
  apps/game/src/lib/components/PrimaryObjectiveHud.test.ts \
  apps/game/src/lib/components/GameShell.svelte \
  apps/game/src/lib/components/GameShell.test.ts \
  apps/game/src/lib/components/ExploreView.svelte \
  apps/game/src/lib/components/ExploreView.test.ts \
  apps/game/src/routes/+page.svelte \
  apps/game/src/routes/page.test.ts
rtk git commit -m "feat: show primary objective hud"
```

---

## Task 9: Add the synthetic populated acceptance fixture and close PR A

**Files:**
- Create: `apps/game/src-tauri/src/game/case_file_integration_tests.rs`
- Modify: `apps/game/src-tauri/src/game/mod.rs`
- Modify: `apps/game/src-tauri/src/game/test_support.rs`
- Modify: `apps/game/src/lib/case-file/case-file-model.test.ts`
- Modify: `apps/game/src/lib/components/case-file/CaseFilePanel.test.ts`
- Modify: `apps/game/e2e-tauri/app.e2e.ts`
- Modify: `apps/game/e2e-tauri/production-anchors.ts`

**Interfaces:**
- Consumes: all PR A contracts.
- Produces: one deterministic cross-layer fixture proving populated behavior without production story mutations.

- [ ] **Step 1: Build the fixture**

Include exactly:

- one active primary objective;
- two incomplete secondaries;
- four completed objectives;
- same-slug evidence and statement;
- an acquired evidence→statement or statement→evidence supersession chain;
- one neutral record;
- one record with source group and proof capabilities;
- asserted facts with direct record and fact support;
- one open and one resolved question;
- one granted authorization;
- one locked/unrevealed definition in each catalog family.

- [ ] **Step 2: Write Rust acceptance assertions**

Assert view JSON contains only acquired/revealed values, exact location/origin titles, no group members, no hidden predecessor/future successor, and stable acquisition order. Capture and restore the existing `SaveSnapshotV1`, rebuild the view, and compare the complete public Case File inputs before/after.

- [ ] **Step 3: Write frontend acceptance assertions**

Feed the equivalent wire fixture through `buildCaseFileModel` and `CaseFilePanel`; visit every section, follow support/supersession links, expand older completed objectives, and assert locked IDs never occur in `container.textContent` or accessible names.

- [ ] **Step 4: Run PR A verification**

```bash
rtk bun run --cwd apps/game test \
  src/lib/case-file/case-file-model.test.ts \
  src/lib/components/case-file/CaseFilePanel.test.ts \
  src/lib/components/case-file/CaseFileRecordDetail.test.ts \
  src/lib/components/PrimaryObjectiveHud.test.ts \
  src/lib/components/GameShell.test.ts \
  src/routes/page.test.ts
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml case_file -- --nocapture
rtk bun run check
rtk bun run --cwd apps/game check:e2e
rtk bun run lint:all
```

- [ ] **Step 5: Run packaged smoke when the debug E2E binary is available**

```bash
rtk bun run test:e2e
```

Required assertions: open `案件檔案`, see production acquired evidence after collection, re-examine in a supported mode, Escape back one layer, and keep focus inside the menu. Do not fabricate objectives/authorizations in production content.

- [ ] **Step 6: Commit PR A acceptance**

```bash
rtk git add \
  apps/game/src-tauri/src/game/case_file_integration_tests.rs \
  apps/game/src-tauri/src/game/mod.rs \
  apps/game/src-tauri/src/game/test_support.rs \
  apps/game/src/lib/case-file/case-file-model.test.ts \
  apps/game/src/lib/components/case-file/CaseFilePanel.test.ts \
  apps/game/e2e-tauri
rtk git commit -m "test: cover case file acceptance"
```

- [ ] **Step 7: Open PR A and stop before PR B**

PR description must say existing saves/content revision remain compatible and list HPA-265/HPA-266 packaged-population deferrals. Wait for PR A review/merge before branching PR B from updated `main`.

---

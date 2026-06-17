# Multi-Evidence Hotspot Correlation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Show every evidence item correlated to a single investigation hotspot in the layout editor, document the writer contract, and add runtime coverage for multi-evidence hotspot collection.

**Architecture:** Keep `Reveals` as the only correlation source. The editor derives display metadata from `hotspot.reveals` plus `evidenceManifest`; no compiler schema changes are required. The writer skill explains when multiple evidence reveals belong on one hotspot and when to split them.

**Tech Stack:** Svelte 5, Vitest, Rust unit tests, Lyra scene compiler/runtime types.

---

### Task 1: Runtime Regression Coverage

**Files:**
- Modify: `apps/game/src-tauri/src/game/reveals.rs`

**Step 1: Write the failing test**

Add a Rust unit test proving `apply_reveals_and_build_queue` collects two
different evidence items from one reveal list and appends both `on_collect`
dialogue blocks in order.

**Step 2: Run test to verify behavior**

Run:

```bash
cargo test --manifest-path apps/game/src-tauri/Cargo.toml reveals_multiple_evidence_items_from_one_trigger
```

Expected before any runtime change: pass if existing runtime support is intact.

### Task 2: Editor Multi-Evidence Display

**Files:**
- Modify: `apps/layout-editor/src/lib/EditorCanvas.test.ts`
- Modify: `apps/layout-editor/src/lib/EditorCanvas.svelte`

**Step 1: Write failing editor tests**

Add tests proving:
- a `visible` hotspot with two evidence reveals renders two evidence previews;
- non-visible source hotspots expose evidence correlations as chips without
  rendering collected evidence thumbnails;
- hotspot control titles list all correlated evidence names and IDs.

**Step 2: Verify RED**

Run:

```bash
bun run --cwd apps/layout-editor test src/lib/EditorCanvas.test.ts
```

Expected: fail because the editor currently chooses only the first evidence
asset and does not render correlation chips.

**Step 3: Implement minimal editor changes**

Replace the single `imageAssetId` derivation with an evidence-correlation list
derived from `hotspot.reveals`. Render visible-source previews from that list
and render compact evidence chips for any evidence-revealing hotspot.

**Step 4: Verify GREEN**

Run the same editor test command and expect all `EditorCanvas` tests to pass.

### Task 3: Writer Skill Update

**Files:**
- Modify: `.claude/skills/writing-investigation-scene/SKILL.md`

Update hotspot guidance to state that multiple `[evidence:...]` targets in
`Reveals` are the canonical way to correlate multiple evidence items to one
hotspot, and that `Evidence Source` / `Scene Source Prompt` apply to the
hotspot as a whole.

### Task 4: Final Verification

Run:

```bash
bun run --cwd apps/layout-editor test src/lib/EditorCanvas.test.ts
cargo test --manifest-path apps/game/src-tauri/Cargo.toml reveals_multiple_evidence_items_from_one_trigger
bun run check
git diff --check
```

Commit the implementation after verification.

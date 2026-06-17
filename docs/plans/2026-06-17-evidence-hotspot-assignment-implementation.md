# Evidence Hotspot Assignment Editor Implementation Plan

> **For Chan Wai Chan:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan.

**Goal:** Let the layout editor assign existing evidence to investigation hotspots by
writing authored scene Markdown, and confirm Chapter 1 evidence is assigned according
to written content.

**Architecture:** Add a pure TypeScript Markdown patcher and scene reveal updater, a
small Svelte evidence assignment panel, and narrow Tauri commands for resolving and
writing authored investigation scene Markdown.

**Tech Stack:** Svelte 5, TypeScript, Vitest, Tauri 2 Rust commands.

### Task 1: Add Pure Assignment Helpers

**Files:**
- Create: `apps/layout-editor/src/lib/evidence-assignment.ts`
- Create: `apps/layout-editor/src/lib/evidence-assignment.test.ts`

**Step 1: Write failing tests**

Test these cases:
- Move `evidence:<id>` from one hotspot to another while preserving `topic:<id>`.
- Add `evidence:<id>` to a hotspot with no `Reveals` line.
- Detach evidence and remove an empty `Reveals` line.
- Put multiple evidence items on the same hotspot.
- Update the in-memory scene graph reveal arrays the same way.

**Step 2: Implement helper functions**

Add:
- `updateEvidenceAssignmentInMarkdown(contents, assignment)`
- `evidenceAssignmentsForScene(scene)`
- `moveEvidenceRevealInScene(scene, evidenceId, hotspotId)`

**Step 3: Verify**

Run `bun run --cwd apps/layout-editor test src/lib/evidence-assignment.test.ts`.

### Task 2: Add Tauri Markdown Resolution and Write Commands

**Files:**
- Modify: `apps/layout-editor/src-tauri/src/lib.rs`

**Step 1: Write Rust tests**

Add coverage for:
- Resolving generated scene JSON to authored investigation Markdown.
- Allowing writes only to authored `investigation_scene_*.md`.
- Rejecting generated JSON, `.layout.json`, non-investigation scene Markdown, and
  parent traversal.

**Step 2: Implement commands**

Add:
- `resolve_story_scene_path(scene_path: String) -> Result<String, EditorError>`
- `write_story_scene_file(path: String, contents: String) -> Result<(), EditorError>`

Reuse the existing root/path/symlink checks.

**Step 3: Verify**

Run `cargo test --manifest-path apps/layout-editor/src-tauri/Cargo.toml`.

### Task 3: Wire Store State and Persistence

**Files:**
- Modify: `apps/layout-editor/src/lib/layout-store.svelte.ts`

**Step 1: Load authored Markdown**

When loading an investigation scene, resolve and read the authored Markdown path in
addition to generated JSON and layout sidecar.

**Step 2: Save evidence assignments**

Add `assignEvidenceToHotspot(evidenceId, hotspotId)` that:
- Patches Markdown.
- Calls `write_story_scene_file`.
- Updates local Markdown state.
- Updates the in-memory generated scene graph so the panel and hotspot menu refresh
  immediately.

**Step 3: Verify**

Extend existing store tests or rely on helper/component tests if the Tauri `invoke`
mock coverage would duplicate implementation details.

### Task 4: Add Assignment Panel UI

**Files:**
- Create: `apps/layout-editor/src/lib/EvidenceAssignmentPanel.svelte`
- Create: `apps/layout-editor/src/lib/EvidenceAssignmentPanel.test.ts`
- Modify: `apps/layout-editor/src/App.svelte`

**Step 1: Write failing component test**

Test that the panel:
- Lists evidence with current assignment.
- Shows evidence thumbnails when image assets exist.
- Calls the assignment callback when a hotspot is selected.

**Step 2: Implement component and mount it**

Render the panel near the scene metadata before the canvas. Keep the UI dense and
editor-like.

**Step 3: Verify**

Run focused layout-editor tests.

### Task 5: Backfill and Verify Chapter 1

**Files:**
- Review: `static/stories_plan/chapter_1/investigation_scene_*.md` or
  `docs/stories_plan/chapter_1/investigation_scene_*.md`

**Step 1: Audit assignments**

Compile and inspect Chapter 1 evidence-to-hotspot mappings.

**Step 2: Manually patch authored scenes only if needed**

Use written content to assign any evidence that remains uncorrelated or correlated to a
wrong hotspot. Do not edit generated JSON.

**Step 3: Verify**

Run:
- `bun run scenes:compile`
- `bun run evidence-sources:audit`
- focused layout-editor tests
- `bun run check`

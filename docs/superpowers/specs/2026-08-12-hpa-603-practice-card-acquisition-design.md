# HPA-603 Practice-Card Acquisition Design

## Status

Planning only. This design resolves the conflicting practice-card models left by HPA-260 without changing Chapter 1 story content or reworking the broader Analysis runtime.

## Why this is the next actionable task

HPA-603 is High priority, has no blockers, and affects the real Chapter 1 P1 tutorial path. HPA-262 is also now unblocked, but its purpose is cross-layer integration and acceptance of the real three-board Beat 8.5 flow. Fixing practice-card ownership first keeps that acceptance work from building on a known incorrect tutorial/runtime contract.

HPA-123 has been deprioritized separately and is not part of this work.

## Root cause

HPA-260 correctly replaced the old board-specific mutable Analysis model with typed drafts, qualified completion, action tokens, and derived board availability. During that migration, however, practice-card ownership was only removed from the Analysis side.

Current `main` still has the acquisition model on the Investigation side:

- `InvestigationSceneState.practice_card_ids` records tutorial-local acquisitions.
- `RevealTarget::Practice` inserts into that set.
- Investigation save capture/restore persists it.
- Analysis scenes using practice cards must still immediately follow an Investigation scene.

But current Analysis does the opposite:

- `AnalysisSceneState` has no practice-card set.
- `card_is_available(Practice)` returns `true` unconditionally.
- Investigation -> Analysis navigation no longer transfers the acquired set.
- direct scene navigation no longer seeds practice cards.
- Analysis save capture/restore has no practice-card field.

This is a half-migration, not an authoring problem. The P1 content still explicitly reveals four `practice:` records from four investigation hotspots, and the following Analysis board references exactly those four sources.

## Working reference

Before HPA-260, the Analysis state held a scene-local `BTreeSet<String>` of acquired practice-card IDs. Evidence/Statement cards still used global Inventory, while Practice cards checked the local set. Natural Investigation -> Analysis navigation copied the set, and direct scene navigation seeded authored practice cards so scene-select/replay remained usable.

That ownership boundary is still appropriate. What should not return is the old board-specific draft/completion/feedback model that HPA-260 intentionally replaced.

## Goals

1. Make a practice card available in Analysis only when its ID was acquired in the immediately preceding Investigation.
2. Preserve practice cards as tutorial-local state; never publish them into Inventory or the Case File.
3. Preserve the current HPA-260/HPA-261 Analysis architecture: typed drafts, derived board availability, action-token fencing, qualified completion, and read-only reopening.
4. Persist the Analysis-local acquired practice-card set so save/Continue during Analysis restores exact availability.
5. Keep direct scene navigation usable by seeding all authored practice cards for the selected Analysis scene.
6. Keep the existing Investigation -> Analysis adjacency rule, but restore its correct acquisition-handoff meaning.

## Non-goals

- No Chapter 1 P1 content rewrite.
- No changes to `practice:` authoring syntax or compiler schema.
- No new global tutorial-card catalog/state.
- No practice cards in Inventory, Case File, acquisition popups, or StoryState.
- No changes to Evidence/Statement availability.
- No rewrite of Analysis draft/evaluation/completion behavior.
- No HPA-601 must-reachability work.
- No HPA-262 real Beat 8.5 content integration.
- No save migration or backward-compatibility machinery for pre-release development saves.

## Approaches considered

### A. Restore scene-local acquisition semantics — selected

Add `practice_card_ids` back to the current `AnalysisSceneState`, use it for Practice availability, copy it across the direct Investigation -> Analysis transition, seed it for direct scene navigation, and persist it in the current Analysis snapshot.

Why selected:

- matches the authored P1 interaction;
- reuses the still-live Investigation reveal machinery;
- smallest behavioral change;
- keeps tutorial data out of global state;
- preserves all modern HPA-260/HPA-261 contracts.

### B. Finish the migration to authored-static practice cards — rejected

Remove Investigation practice acquisition, save state, reveal handling, adjacency semantics, and P1 practice reveals.

Rejected because it makes the four P1 hotspot investigations irrelevant to the workbench and requires a larger story/runtime cleanup just to preserve behavior that is currently less useful.

### C. Move practice cards into Inventory or StoryState — rejected

This would make availability durable automatically, but introduces a new global record/progression category for a one-scene tutorial concern. It risks Case File leakage and broadens persistence/catalog contracts unnecessarily.

## Selected design

### 1. Analysis owns the transferred local set

`AnalysisSceneState` gains:

```rust
pub practice_card_ids: BTreeSet<String>,
```

`from_json()` initializes it empty.

The field is deliberately independent from `available_board_ids`:

- board availability remains a pure projection of authored unlock expressions + StoryState;
- card availability remains a projection of card source + Inventory/local practice acquisition.

Do not merge these concepts.

### 2. Practice availability checks acquisition

`card_is_available()` keeps current behavior for Evidence/Statement and changes only Practice:

```rust
AnalysisCardSource::Practice { id } => self.practice_card_ids.contains(id)
```

The public Analysis card view already exposes `available`; no frontend contract or Svelte change is required.

### 3. Natural navigation transfers the set

When `advance_scene()` loads an Analysis scene immediately after an Investigation scene, copy:

```text
current Investigation practice_card_ids
    -> next Analysis practice_card_ids
```

This happens before the new scene is committed. All other scene boundaries naturally drop the set because it is scene-local.

The existing adjacency validation remains: an Analysis scene using practice cards must immediately follow Investigation. Its comments/documentation should again describe an acquisition handoff, not authored-static always-available cards.

### 4. Direct scene navigation seeds authored practice cards

`jump_to_scene_inner()` does not have a predecessor Investigation runtime. To keep scene-select/debug/replay of an Analysis scene usable, seed every `Practice { id }` referenced by that selected Analysis definition before installing it.

This is navigation convenience only. Normal gameplay still receives exactly what the predecessor Investigation acquired.

Do not grant Evidence/Statement cards through this mechanism; existing debug inventory behavior remains separate.

### 5. Save the Analysis-local set

Add to the current `SceneProgressSnapshot::Analysis`:

```rust
practice_card_ids: Vec<String>,
```

No legacy migration/default is needed. The project is pre-release and HPA-540 already established one current save model.

Capture serializes the `BTreeSet` in deterministic order.

Restore reconstructs the set exactly.

### 6. Validate saved practice IDs against the packaged Analysis definition

The saved list is allowed to be a subset because the player may enter Analysis without having inspected every optional practice producer in future authored content.

Restore must reject:

- duplicate IDs in the saved vector;
- IDs that are not referenced as `Practice` sources by the packaged Analysis scene.

Capture should apply the same authored-subset invariant to live state so invalid runtime state cannot be serialized.

This is definition validation, not anti-tamper hardening.

### 7. Do not clear practice cards on final board completion

The ticket notes an older clear-on-completion behavior, but it is unnecessary in the current architecture and can conflict with completed-board read-only presentation or save during result/outro dialogue.

The set is already scoped to `AnalysisSceneState`. Leaving the scene destroys it naturally. Therefore cleanup is simply scene lifetime:

```text
Investigation acquisition -> Analysis local set -> scene transition -> dropped
```

No extra completion mutation is needed.

## Test strategy

### Runtime unit test

Add focused coverage in `scenes/analysis.rs` proving:

- a Practice card is unavailable in a fresh Analysis state;
- inserting/acquiring its ID makes it available;
- Evidence/Statement behavior remains unchanged.

### Navigation integration coverage

Cover both entry paths:

1. normal Investigation -> Analysis copies only acquired IDs;
2. direct `jump_to_scene` into Analysis seeds all authored Practice IDs.

Use existing game/navigation test fixtures rather than creating another navigation subsystem.

### Save/restore coverage

Extend current Analysis save tests to prove:

- a partial practice set survives capture/restore exactly;
- unavailable Practice cards remain unavailable after restore;
- duplicate or unknown saved practice IDs are rejected;
- result/outro saves retain the local set until scene exit.

### Production P1 acceptance

The existing P1 production journey should assert that the practice cards become available only after the four authored investigation reveals have been collected before entering `analysis_scene_p1_5`.

Do not add a second E2E suite; extend the existing production journey/checkpoint only if lower-level integration coverage cannot prove the player-visible gating.

## Expected implementation surface

Primary production files:

- `apps/game/src-tauri/src/game/scenes/analysis.rs`
- `apps/game/src-tauri/src/game/navigation.rs`
- `apps/game/src-tauri/src/game/save/schema.rs`
- `apps/game/src-tauri/src/game/save/capture.rs`
- `apps/game/src-tauri/src/game/save/restore.rs`

Likely tests in the existing nearby Rust modules/integration suites; optionally one existing production-journey assertion.

No TypeScript/Svelte/story/compiler change is expected.

## Acceptance summary

HPA-603 is complete when:

- normal P1 Investigation acquisition determines Analysis Practice-card availability;
- unacquired practice cards cannot be used merely because they are authored;
- direct Analysis scene navigation remains usable by seeding authored practice cards;
- Analysis save/restore preserves the exact acquired practice set;
- invalid saved practice IDs fail closed against the packaged definition;
- practice cards remain absent from Inventory/Case File;
- current Analysis board/draft/completion semantics are unchanged;
- no global tutorial-card architecture or story rewrite is introduced.

# HPA-258 PR A Runtime and Public Views — Implementation Tasks 1–3

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans`. Follow the parent plan `2026-07-30-hpa-258-case-file-recap-implementation-plan.md`, execute these tasks in order, verify each red test fails for the intended reason, and commit only after the focused green commands pass.

## Task 1: Build and retain one immutable story-location index

**Files:**
- Create: `apps/game/src-tauri/src/game/story_location.rs`
- Modify: `apps/game/src-tauri/src/game/mod.rs`
- Modify: `apps/game/src-tauri/src/game/navigation.rs`
- Modify: `apps/game/src-tauri/src/game/error.rs`
- Modify: `apps/game/src-tauri/src/game/save/capture.rs`
- Modify: `apps/game/src-tauri/src/game/save/restore.rs`
- Modify: `apps/game/src-tauri/src/game/test_support.rs`
- Test: inline tests in `apps/game/src-tauri/src/game/story_location.rs`
- Test: `apps/game/src-tauri/src/game/case_record_integration_tests.rs`

**Interfaces:**
- Consumes: `ChapterManifest`, `StoryCatalog`, `load_chapter_scene_jsons`, and `scene_json_identity`.
- Produces: `StoryLocationIndex::load(...)`, `StoryLocationIndex::resolve_scene(...)`, and serializable `SceneLocationContextView` for Tasks 2–3.

- [ ] **Step 1: Write failing index tests**

Add tests that create two chapter manifests and scene JSON fixtures, then assert exact resolved IDs/titles, duplicate scene rejection within a chapter, and a typed missing-location error:

```rust
#[test]
fn resolves_scene_titles_without_player_facing_slugs() {
    let index = fixture_location_index();
    let location = index.resolve_scene("chapter_1", "scene_2").unwrap();
    assert_eq!(location.chapter_title, "雨鐘咖啡館殺人事件");
    assert_eq!(location.scene_title, "委託與程序入口 — 三宅母親求助");
}

#[test]
fn missing_scene_is_a_typed_view_invariant_error() {
    let error = fixture_location_index()
        .resolve_scene("chapter_1", "missing")
        .unwrap_err();
    assert_eq!(error.code, "storyLocationMissing");
}
```

- [ ] **Step 2: Run the Rust test and confirm red**

```bash
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml story_location -- --nocapture
```

Expected: compile failure because `story_location` and `storyLocationMissing` do not exist.

- [ ] **Step 3: Implement the index**

Build the map once by loading every chapter’s scene JSON through the existing catalog-validating loader. Reject duplicate `(chapter_id, scene_id)` keys. Return owned `SceneLocationContextView` values from `resolve_scene` so public view construction does not borrow internal maps across serialization.

Add:

```rust
pub(crate) fn story_location_missing(chapter_id: &str, scene_id: &str) -> Self {
    Self {
        code: "storyLocationMissing".into(),
        message: format!(
            "案件位置資料不完整：{chapter_id}/{scene_id}。"
        ),
        failure_token: None,
    }
}
```

- [ ] **Step 4: Retain the index on every engine construction path**

Add `story_locations: StoryLocationIndex` to `GameEngine`. Build it in `new_started` after chapters/catalog load and in `build_restore_candidate` before returning the candidate engine. Update exhaustive destructures in save capture and test helpers to classify it as immutable package-derived state:

```rust
story_locations: _immutable_story_locations,
```

Do not add it to rollback or save snapshots.

- [ ] **Step 5: Prove the hot path does not reload scenes**

Add an instrumentation test using a counting fixture loader or a source-level invariant scoped only to `GameEngine::view()` that proves index construction occurs in engine creation/restore, not in `view()`. Do not assert arbitrary prose; assert call counts or the absence of loader invocations from the method under test.

- [ ] **Step 6: Run focused green tests**

```bash
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml story_location -- --nocapture
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml restore -- --nocapture
rtk cargo check --manifest-path apps/game/src-tauri/Cargo.toml
```

- [ ] **Step 7: Commit**

```bash
rtk git add \
  apps/game/src-tauri/src/game/story_location.rs \
  apps/game/src-tauri/src/game/mod.rs \
  apps/game/src-tauri/src/game/navigation.rs \
  apps/game/src-tauri/src/game/error.rs \
  apps/game/src-tauri/src/game/save/capture.rs \
  apps/game/src-tauri/src/game/save/restore.rs \
  apps/game/src-tauri/src/game/test_support.rs \
  apps/game/src-tauri/src/game/case_record_integration_tests.rs
rtk git commit -m "feat: index story locations for public views"
```

---

## Task 2: Project acquired record locations and source groups

**Files:**
- Modify: `apps/game/src-tauri/src/game/view.rs`
- Modify: `apps/game/src-tauri/src/game/story/catalog.rs`
- Modify: `apps/game/src-tauri/src/game/mod.rs`
- Modify: `apps/game/src-tauri/src/game/test_support.rs`
- Test: inline tests in `apps/game/src-tauri/src/game/view.rs`
- Test: `apps/game/src-tauri/src/game/case_record_integration_tests.rs`

**Interfaces:**
- Consumes: `StoryLocationIndex` and `SceneLocationContextView` from Task 1; validated source-group definitions from `StoryCatalog`.
- Produces: `EvidenceRecordView.acquisition_context`, `StatementRecordView.acquisition_context`, and `source_group` for Task 4/frontend.

- [ ] **Step 1: Write failing projection tests**

Cover:

```rust
#[test]
fn acquired_record_view_resolves_location_and_group_without_membership() {
    let view = fixture_inventory_view().unwrap();
    let evidence = &view.evidence[0];
    assert_eq!(evidence.acquisition_context.scene_title, "反轉調查");
    assert_eq!(evidence.source_group.as_ref().unwrap().label, "雨鐘門鎖原始來源");
    let json = serde_json::to_value(evidence).unwrap();
    assert!(json["sourceGroup"].get("members").is_none());
}
```

Also assert acquisition order remains unchanged, neutral records receive `sourceGroup: null`, and a missing acquisition location returns `storyLocationMissing` for the complete view.

- [ ] **Step 2: Run red**

```bash
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml public_inventory -- --nocapture
```

Expected: compile failure for missing fields/signature.

- [ ] **Step 3: Expose a read-only source-group accessor**

Keep `StoryCatalog::source_group` crate-visible and return immutable definitions. Do not expose member arrays through public views.

- [ ] **Step 4: Make inventory projection location-aware**

Change the signature and both record builders:

```rust
InventoryView::from_inventory(
    &self.story_catalog,
    &self.inventory,
    &self.story_locations,
)?;
```

Resolve acquisition context from the record’s persisted chapter/scene IDs. Resolve `source_group` only when `provenance.source_group_id` is non-null; an impossible unresolved group returns `GameError::internal` as defense-in-depth because catalog load already rejects it.

- [ ] **Step 5: Preserve HPA-256 redaction exactly**

Keep `public_provenance` responsible only for acquired-predecessor redaction. Do not add `successor`, `hasHiddenPredecessor`, or membership fields.

- [ ] **Step 6: Green**

```bash
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml public_inventory -- --nocapture
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml case_record_integration -- --nocapture
rtk cargo clippy --manifest-path apps/game/src-tauri/Cargo.toml -- -D warnings
```

- [ ] **Step 7: Commit**

```bash
rtk git add \
  apps/game/src-tauri/src/game/view.rs \
  apps/game/src-tauri/src/game/story/catalog.rs \
  apps/game/src-tauri/src/game/mod.rs \
  apps/game/src-tauri/src/game/test_support.rs \
  apps/game/src-tauri/src/game/case_record_integration_tests.rs
rtk git commit -m "feat: expose acquired record context"
```

---

## Task 3: Make story views origin-aware and fallible

**Files:**
- Modify: `apps/game/src-tauri/src/game/story/view.rs`
- Modify: `apps/game/src-tauri/src/game/story/mod.rs`
- Modify: `apps/game/src-tauri/src/game/mod.rs`
- Modify: `apps/game/src-tauri/src/game/case_record_integration_tests.rs`
- Test: inline tests in `apps/game/src-tauri/src/game/story/view.rs`

**Interfaces:**
- Consumes: `StoryLocationIndex` from Task 1 and existing `AssertionOrigin` variants.
- Produces: `OriginContextView` on facts/authorizations and `Result<StoryStateView, GameError>`.

- [ ] **Step 1: Write failing origin tests**

Add one test per origin variant:

```rust
#[test]
fn scene_event_origin_resolves_titles() {
    let view = build_story_view_with_origin(AssertionOrigin::SceneEvent { /* fixture */ })
        .unwrap();
    assert!(matches!(
        view.facts[0].origin_context,
        OriginContextView::Scene {
            origin_kind: OriginContextKindView::SceneEvent,
            ..
        }
    ));
}

#[test]
fn migration_origin_never_requires_scene_lookup() {
    let view = build_story_view_with_origin(AssertionOrigin::Migration {
        migration_id: "save_v1".into(),
    })
    .unwrap();
    assert_eq!(view.facts[0].origin_context, OriginContextView::Migration);
}
```

Add an unknown scene-origin test expecting `storyLocationMissing`.

- [ ] **Step 2: Run red**

```bash
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml story_state_view -- --nocapture
```

- [ ] **Step 3: Implement exact origin mapping**

Map `SceneEvent` and `AnalysisBoard` to `OriginContextView::Scene` with the corresponding `origin_kind`; map `Migration` to `Migration`. Keep `first_origin` unchanged in the public wire.

- [ ] **Step 4: Change every caller to handle `Result`**

Change `from_catalog_state` from `Self` to `Result<Self, GameError>` and collect fallible iterators with `collect::<Result<Vec<_>, _>>()?`. Update `GameEngine::view()` to use `?` and update every direct unit/integration caller found by:

```bash
rtk rg "StoryStateView::from_catalog_state" apps/game/src-tauri/src/game
```

The command must return no caller still treating the function as infallible.

- [ ] **Step 5: Green**

```bash
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml story_state_view -- --nocapture
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml case_record_integration -- --nocapture
rtk cargo check --manifest-path apps/game/src-tauri/Cargo.toml
```

- [ ] **Step 6: Commit**

```bash
rtk git add \
  apps/game/src-tauri/src/game/story/view.rs \
  apps/game/src-tauri/src/game/story/mod.rs \
  apps/game/src-tauri/src/game/mod.rs \
  apps/game/src-tauri/src/game/case_record_integration_tests.rs
rtk git commit -m "feat: expose story assertion origins"
```

---

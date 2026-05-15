# Scene Pipeline Plan B: Engine, Frontend, and Acceptance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hardcoded Rust demo case with a JSON-driven game engine, rewrite the Svelte UI as a mode-driven shell with VN-style dialogue playback, port the authored chapter 1 content to the finalized schema, and verify a packaged-bundle playthrough.

**Architecture:** Rust engine deserializes the Plan A JSON output (under `src-tauri/resources/scenes/`), drives a `GameState → ChapterState → SceneRuntime` hierarchy with a mode state machine (`Dialogue | Explore | GameComplete`), and exposes `start_game`, `advance_dialogue`, `inspect_hotspot`, `interview_topic`, `enter_sublocation`, `reexamine_evidence`, `reexamine_statement`, `reset_game`, `get_state` Tauri commands. Frontend renders mode-appropriate components (`DialogueBox`, `ExploreView`, `InventoryPanel`) and never decides what mode to be in.

**Tech Stack:** Tauri 2, Rust 2021 (serde, serde_json, std::fs), Svelte 5 runes, TypeScript, Bun.

**Spec reference:** [`docs/superpowers/specs/2026-05-13-scene-pipeline-design.md`](../specs/2026-05-13-scene-pipeline-design.md). Normative for all types, modes, command shapes, and validation rules.

**Prerequisite:** Plan A is complete and tests pass. The fixture chapter at `scripts/__fixtures__/valid/chapter_1/` compiles cleanly; its JSON output under a temp directory matches the committed snapshots.

---

## Context for the implementer

The Plan A compile script produces typed JSON; this plan builds the consumer. Critical conventions to remember:

- **Tauri JSON ↔ Rust serde:** the JSON shapes use `camelCase`. Every Rust serde struct must declare `#[serde(rename_all = "camelCase")]` so deserialization works. Variants like `Mode` use `#[serde(tag = "type", rename_all = "camelCase")]` to match the discriminator.
- **Tauri JS ↔ Rust arg conversion:** Tauri converts JS arg names to snake_case on the way in. Frontend `invoke("inspect_hotspot", { hotspotId: "x" })` → Rust `fn inspect_hotspot(hotspot_id: String)`. For struct args (like `QueueToken`), serde does the field mapping.
- **Sync mutex pattern:** `Mutex<Option<GameEngine>>` in `AppState`. Engine is `None` before `start_game`. Map poison errors to a typed `GameError`. Match the existing `unavailable_error()` pattern in `lib.rs`.
- **No Rust async:** the existing code uses `std::sync::Mutex` and sync `fs`. Keep it that way — scene JSON is small (~tens of KB), sync I/O is fine, and async would force `tokio::sync::Mutex` rippling through everything.
- **Tauri 2 path resolution:** `app.path().resolve("scenes/chapters.json", BaseDirectory::Resource)` returns the right path in both dev and packaged builds. The engine stores `resources_dir: PathBuf` after `start_game` and uses it for lazy scene loading.
- **Svelte 5 runes only:** state via `$state`, props via `$props`, derived via `$derived`. Event attributes are `onclick={...}` not `on:click={...}`. No legacy reactivity.
- **No frontend test framework** is added in this slice. Verification = `bun run check` (TypeScript) + manual playthrough.

**Files this plan creates or modifies:**

```
src-tauri/src/
  lib.rs                                  (rewrite — commands + AppState)
  investigation.rs                        (delete)
  game/
    mod.rs                                (create — GameEngine orchestrator + pub use)
    schema.rs                             (create — serde types matching JSON 1:1)
    state.rs                              (create — GameState, ChapterState, Inventory)
    unlock.rs                             (create — UnlockExpr evaluator)
    reveals.rs                            (create — reveal application + queue construction)
    scenes/
      mod.rs                              (create — SceneRuntime enum)
      linear.rs                           (create — LinearSceneState + advance)
      investigation.rs                    (create — InvestigationSceneState + reveal pipeline)
    loader.rs                             (create — JSON file loading via BaseDirectory::Resource)
    view.rs                               (create — GameStateView snapshot)
    error.rs                              (create — GameError types + codes)

src-tauri/tests/
  full_playthrough.rs                     (create — integration test)

src/lib/components/
  GameShell.svelte                        (create)
  DialogueBox.svelte                      (create)
  ExploreView.svelte                      (create)
  SublocationNav.svelte                   (create)
  HotspotGrid.svelte                      (create)
  CharacterList.svelte                    (create)
  InventoryPanel.svelte                   (create)
  SceneBackdrop.svelte                    (create)
  ErrorBanner.svelte                      (create)
  GameComplete.svelte                     (create — small "the end" screen)

src/lib/state/
  types.ts                                (create — mirrors Rust GameStateView)
  game-client.ts                          (create — invoke wrappers + state store)

src/routes/
  +page.svelte                            (rewrite — thin shell)

static/stories_plan/
  chapter_1/chapter.md                    (create)
  chapter_1/scene_0.md                    (port to finalized schema)
  chapter_1/investigation_scene_1.md      (port to finalized schema)
```

---

## Phase B1: Pre-flight clean-up

### Task 1: Delete the demo case and deduction system

**Files:**
- Delete: `src-tauri/src/investigation.rs` (916 lines)
- Modify: `src-tauri/src/lib.rs` (drop demo wiring; commands will be re-added in Phase B4)

- [ ] **Step 1: Delete `investigation.rs`**

```bash
git rm src-tauri/src/investigation.rs
```

- [ ] **Step 2: Replace `lib.rs` with a minimal scaffold that still compiles**

Overwrite `src-tauri/src/lib.rs` with:

```rust
// Game engine lives under `game::*`. lib.rs only registers Tauri commands.
//
// `pub mod game` (not `mod game`) — integration tests under src-tauri/tests/
// access the module via the public crate API (`lyra_lib::game::*`).
pub mod game;

use std::sync::Mutex;
use game::GameEngine;

struct AppState {
    engine: Mutex<Option<GameEngine>>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(AppState {
            engine: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![
            // Commands will be added in Phase B4.
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

This compiles to a binary that launches Tauri with no commands registered. The frontend won't be functional yet; we're just establishing a compiling baseline.

- [ ] **Step 3: Create the `game/` module structure with empty placeholders**

```bash
mkdir -p src-tauri/src/game/scenes
```

Create `src-tauri/src/game/mod.rs`:

```rust
// Game engine module. Each submodule has a single responsibility; see the
// scene-pipeline spec §4a for the layout rationale.

pub mod error;
pub mod schema;
pub mod state;
pub mod unlock;
pub mod reveals;
pub mod scenes;
pub mod loader;
pub mod view;

pub use error::GameError;

/// Top-level engine orchestrator. Fully assembled in Task 13.
pub struct GameEngine {
    // fields added in later tasks
}
```

Create the empty stubs (overwritten by later tasks):

```bash
for f in error.rs schema.rs state.rs unlock.rs reveals.rs loader.rs view.rs scenes/mod.rs scenes/linear.rs scenes/investigation.rs; do
  touch "src-tauri/src/game/$f"
done
```

In each empty file, add a placeholder so `cargo check` doesn't complain about unresolved modules:

```bash
for f in error.rs schema.rs state.rs unlock.rs reveals.rs loader.rs view.rs; do
  echo "// Implemented in a later task." > "src-tauri/src/game/$f"
done
echo "pub mod linear;\npub mod investigation;" > src-tauri/src/game/scenes/mod.rs
echo "// Implemented in a later task." > src-tauri/src/game/scenes/linear.rs
echo "// Implemented in a later task." > src-tauri/src/game/scenes/investigation.rs
```

Wait — `error.rs` is referenced via `pub use error::GameError` from `mod.rs`, so an empty `error.rs` will fail. Stub it minimally:

```rust
// src-tauri/src/game/error.rs
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GameError {
    pub code: String,
    pub message: String,
}

impl GameError {
    pub fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self { code: code.into(), message: message.into() }
    }
}
```

The other modules can be `// stub` files for now since `game/mod.rs` doesn't `use` anything from them yet.

- [ ] **Step 4: Verify the crate compiles**

```bash
cd src-tauri && cargo check && cd ..
```

Expected: passes with warnings about unused module declarations (acceptable for an intermediate state).

- [ ] **Step 5: Commit**

```bash
git add -A src-tauri/src/
git commit -m "refactor(engine): delete demo case and deduction; scaffold game module tree"
```

---

## Phase B2: Schema types and error types

### Task 2: Implement `game/schema.rs` — serde types mirroring the JSON 1:1

**Files:**
- Modify: `src-tauri/src/game/schema.rs`

These structs deserialize the JSON produced by Plan A. They are the **on-disk format**; runtime state structs (`InvestigationSceneState`, etc.) are separate (Task 5+).

- [ ] **Step 1: Write the failing test**

Add to the end of `src-tauri/src/game/schema.rs`:

```rust
// src-tauri/src/game/schema.rs
use serde::{Deserialize, Serialize};

// ============================================================================
// Shared atoms
// ============================================================================

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum DialogueItem {
    SceneTag { text: String },
    Action { text: String },
    Line { speaker: String, text: String },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum RevealTarget {
    Evidence { id: String },
    Statement { id: String },
    Topic { character_id: String, topic_id: String },
    Hotspot { id: String },
    Sublocation { id: String },
}

/// `unlock` JSON values are either the literal string "auto" (Outro auto-mode)
/// or a tagged tree of predicates and combinators. We represent that as an
/// untagged enum.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum OutroUnlock {
    Auto(AutoMarker),
    Expr(UnlockExpr),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum AutoMarker {
    #[serde(rename = "auto")]
    Auto,
}

/// Per-block (non-Outro) Unlock JSON: null or UnlockExpr.
/// Represented in Rust as Option<UnlockExpr>.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum UnlockExpr {
    Combinator {
        op: Combinator,
        left: Box<UnlockExpr>,
        right: Box<UnlockExpr>,
    },
    EvidenceCollected {
        #[serde(rename = "predicate")]
        _predicate: PredicateEvidenceCollected,
        id: String,
    },
    StatementAcquired {
        #[serde(rename = "predicate")]
        _predicate: PredicateStatementAcquired,
        id: String,
    },
    TopicDiscussed {
        #[serde(rename = "predicate")]
        _predicate: PredicateTopicDiscussed,
        character_id: String,
        topic_id: String,
    },
    HotspotInvestigated {
        #[serde(rename = "predicate")]
        _predicate: PredicateHotspotInvestigated,
        id: String,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Combinator { And, Or }

// Marker enums for each predicate kind, so serde's untagged dispatch picks the
// right variant from the `predicate` discriminator field.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum PredicateEvidenceCollected {
    #[serde(rename = "evidence_collected")] X,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum PredicateStatementAcquired {
    #[serde(rename = "statement_acquired")] X,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum PredicateTopicDiscussed {
    #[serde(rename = "topic_discussed")] X,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum PredicateHotspotInvestigated {
    #[serde(rename = "hotspot_investigated")] X,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LockStatus { Locked, Unlocked }

// ============================================================================
// Chapters index
// ============================================================================

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChaptersIndexJson {
    pub chapters: Vec<ChapterEntryJson>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChapterEntryJson {
    pub id: String,
    pub title: String,
    pub summary: String,
    pub scenes: Vec<SceneEntryJson>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SceneEntryJson {
    #[serde(rename = "type")]
    pub scene_type: SceneType,
    pub file: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SceneType { Linear, Investigation }

// ============================================================================
// Scene JSON (tagged-union, discriminator: "type")
// ============================================================================

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum SceneJson {
    #[serde(rename = "linear")]
    Linear(LinearSceneJson),
    #[serde(rename = "investigation")]
    Investigation(InvestigationSceneJson),
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LinearSceneJson {
    pub id: String,
    pub title: String,
    pub queue: Vec<DialogueItem>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InvestigationSceneJson {
    pub id: String,
    pub title: String,
    pub intro: Vec<DialogueItem>,
    pub sublocations: Vec<SublocationJson>,
    pub evidence_manifest: Vec<EvidenceJson>,
    pub statement_manifest: Vec<StatementJson>,
    pub outro: OutroJson,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SublocationJson {
    pub id: String,
    pub status: LockStatus,
    pub unlock: Option<UnlockExpr>,
    pub reveals: Vec<RevealTarget>,
    pub scene_tag: String,
    pub transition_dialogue: Vec<DialogueItem>,
    pub hotspots: Vec<HotspotJson>,
    pub characters: Vec<CharacterJson>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HotspotJson {
    pub id: String,
    pub label: String,
    pub description: String,
    pub status: LockStatus,
    pub unlock: Option<UnlockExpr>,
    pub reveals: Vec<RevealTarget>,
    pub inspect_dialogue: Vec<DialogueItem>,
    pub on_reexamine: Option<Vec<DialogueItem>>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CharacterJson {
    pub id: String,
    pub name: String,
    pub role: String,
    pub bio: String,
    pub topics: Vec<TopicJson>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TopicJson {
    pub id: String,
    pub label: String,
    pub status: LockStatus,
    pub unlock: Option<UnlockExpr>,
    pub reveals: Vec<RevealTarget>,
    pub topic_dialogue: Vec<DialogueItem>,
    pub on_reexamine: Option<Vec<DialogueItem>>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EvidenceJson {
    pub id: String,
    pub name: String,
    pub description: String,
    pub details: String,
    pub on_collect: Vec<DialogueItem>,
    pub on_reexamine: Option<Vec<DialogueItem>>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StatementJson {
    pub id: String,
    pub speaker: String,
    pub content: String,
    pub on_acquire: Vec<DialogueItem>,
    pub on_reexamine: Option<Vec<DialogueItem>>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OutroJson {
    pub unlock: OutroUnlock,
    pub dialogue: Vec<DialogueItem>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deserializes_linear_scene() {
        let json = r#"{
            "type": "linear",
            "id": "scene_0",
            "title": "接案",
            "queue": [
                {"kind": "sceneTag", "text": "街道"},
                {"kind": "action", "text": "推開門"},
                {"kind": "line", "speaker": "A", "text": "hi"}
            ]
        }"#;
        let parsed: SceneJson = serde_json::from_str(json).unwrap();
        match parsed {
            SceneJson::Linear(s) => {
                assert_eq!(s.id, "scene_0");
                assert_eq!(s.queue.len(), 3);
            }
            _ => panic!("expected Linear variant"),
        }
    }

    #[test]
    fn deserializes_unlock_expr_predicate() {
        let json = r#"{"predicate": "evidence_collected", "id": "blue_umbrella"}"#;
        let parsed: UnlockExpr = serde_json::from_str(json).unwrap();
        match parsed {
            UnlockExpr::EvidenceCollected { id, .. } => assert_eq!(id, "blue_umbrella"),
            _ => panic!("expected EvidenceCollected"),
        }
    }

    #[test]
    fn deserializes_unlock_expr_combinator() {
        let json = r#"{
            "op": "and",
            "left": {"predicate": "hotspot_investigated", "id": "a"},
            "right": {"predicate": "statement_acquired", "id": "b"}
        }"#;
        let parsed: UnlockExpr = serde_json::from_str(json).unwrap();
        match parsed {
            UnlockExpr::Combinator { op, .. } => assert_eq!(op, Combinator::And),
            _ => panic!("expected Combinator"),
        }
    }

    #[test]
    fn deserializes_outro_auto() {
        let json = r#""auto""#;
        let parsed: OutroUnlock = serde_json::from_str(json).unwrap();
        assert!(matches!(parsed, OutroUnlock::Auto(AutoMarker::Auto)));
    }

    #[test]
    fn deserializes_outro_with_expr() {
        let json = r#"{"predicate": "hotspot_investigated", "id": "x"}"#;
        let parsed: OutroUnlock = serde_json::from_str(json).unwrap();
        assert!(matches!(parsed, OutroUnlock::Expr(_)));
    }

    #[test]
    fn deserializes_topic_reveal_with_underscore_keys() {
        let json = r#"{"kind": "topic", "characterId": "witness", "topicId": "motive"}"#;
        let parsed: RevealTarget = serde_json::from_str(json).unwrap();
        match parsed {
            RevealTarget::Topic { character_id, topic_id } => {
                assert_eq!(character_id, "witness");
                assert_eq!(topic_id, "motive");
            }
            _ => panic!("expected Topic"),
        }
    }
}
```

- [ ] **Step 2: Run tests, verify they fail**

```bash
cd src-tauri && cargo test --lib game::schema && cd ..
```

Expected: FAIL — fixture json's quoting may not match the expected Rust enum variants.

- [ ] **Step 3: Iterate until all 6 tests pass**

The most likely issue: the untagged enum dispatch on `UnlockExpr` requires the variants to be unambiguously distinguishable from each other and from `OutroUnlock::Auto`. If you hit "data did not match any variant", consider:
- Removing the leading-underscore on `_predicate` fields (it's a hint to readers that the value is consumed by serde's discriminator dispatch, not for runtime use; serde doesn't care about the rename).
- The `predicate` value is a `String`-like discriminator; serde's `untagged` enum picks the variant whose marker enum matches that string.

Iterate parser ↔ test until all pass:

```bash
cd src-tauri && cargo test --lib game::schema && cd ..
```

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/game/schema.rs
git commit -m "feat(engine): schema.rs — serde types mirroring scene JSON"
```

---

### Task 3: Flesh out `game/error.rs` with all error codes

**Files:**
- Modify: `src-tauri/src/game/error.rs`

Replace the stub from Task 1.

- [ ] **Step 1: Write the file**

```rust
// src-tauri/src/game/error.rs
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GameError {
    pub code: String,
    pub message: String,
}

impl GameError {
    pub fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self { code: code.into(), message: message.into() }
    }
}

// ----- Convenience constructors for the codes spec §4g enumerates ---------

impl GameError {
    pub fn unavailable() -> Self { Self::new("stateUnavailable", "The game engine is unavailable.") }
    pub fn game_not_started() -> Self { Self::new("gameNotStarted", "Call start_game first.") }
    pub fn wrong_mode(action: &str, mode: &str) -> Self {
        Self::new("wrongMode", format!("Action '{action}' is not valid while in mode '{mode}'."))
    }
    pub fn no_active_dialogue() -> Self { Self::new("noActiveDialogue", "No dialogue queue is currently active.") }
    pub fn unknown_hotspot(id: &str) -> Self { Self::new("unknownHotspot", format!("Hotspot '{id}' does not exist in the current scene.")) }
    pub fn locked_hotspot(id: &str) -> Self { Self::new("lockedHotspot", format!("Hotspot '{id}' is locked.")) }
    pub fn unknown_character(id: &str) -> Self { Self::new("unknownCharacter", format!("Character '{id}' does not exist.")) }
    pub fn unknown_topic(c: &str, t: &str) -> Self { Self::new("unknownTopic", format!("Topic '{c}@{t}' does not exist.")) }
    pub fn locked_topic(c: &str, t: &str) -> Self { Self::new("lockedTopic", format!("Topic '{c}@{t}' is locked.")) }
    pub fn unknown_sublocation(id: &str) -> Self { Self::new("unknownSublocation", format!("Sub-location '{id}' does not exist.")) }
    pub fn locked_sublocation(id: &str) -> Self { Self::new("lockedSublocation", format!("Sub-location '{id}' is locked.")) }
    pub fn unknown_evidence(id: &str) -> Self { Self::new("unknownEvidence", format!("Evidence '{id}' is not in the inventory.")) }
    pub fn unknown_statement(id: &str) -> Self { Self::new("unknownStatement", format!("Statement '{id}' is not in the inventory.")) }
    pub fn scene_load_failed(detail: String) -> Self { Self::new("sceneLoadFailed", detail) }
    pub fn chapter_load_failed(detail: String) -> Self { Self::new("chapterLoadFailed", detail) }
    pub fn parse_failure(detail: String) -> Self { Self::new("parseFailure", detail) }
    pub fn game_complete() -> Self { Self::new("gameComplete", "The game has been completed; reset to play again.") }
}
```

- [ ] **Step 2: Verify it compiles**

```bash
cd src-tauri && cargo check && cd ..
```

Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/game/error.rs
git commit -m "feat(engine): GameError type + constructors per spec §4g"
```

---

## Phase B3: Subsystems

### Task 4: Implement `game/unlock.rs` — UnlockExpr evaluator

**Files:**
- Modify: `src-tauri/src/game/unlock.rs`

The evaluator answers "given current scene + inventory state, does this UnlockExpr hold?" The inputs are passed by trait so we don't have to construct a full `InvestigationSceneState` in tests.

- [ ] **Step 1: Write the test cases (and the trait the evaluator depends on) inline**

```rust
// src-tauri/src/game/unlock.rs
use crate::game::schema::{Combinator, UnlockExpr};

/// What the evaluator needs to know about runtime state. Implementations live
/// on `InvestigationSceneState` (Task 7) and on the `Inventory` (Task 5);
/// during unit tests we use the lightweight `TestState` defined below.
pub trait UnlockContext {
    fn evidence_collected(&self, id: &str) -> bool;
    fn statement_acquired(&self, id: &str) -> bool;
    fn topic_discussed(&self, character_id: &str, topic_id: &str) -> bool;
    fn hotspot_investigated(&self, id: &str) -> bool;
}

pub fn evaluate(expr: &UnlockExpr, ctx: &dyn UnlockContext) -> bool {
    match expr {
        UnlockExpr::Combinator { op, left, right } => match op {
            Combinator::And => evaluate(left, ctx) && evaluate(right, ctx),
            Combinator::Or => evaluate(left, ctx) || evaluate(right, ctx),
        },
        UnlockExpr::EvidenceCollected { id, .. } => ctx.evidence_collected(id),
        UnlockExpr::StatementAcquired { id, .. } => ctx.statement_acquired(id),
        UnlockExpr::TopicDiscussed { character_id, topic_id, .. } => {
            ctx.topic_discussed(character_id, topic_id)
        }
        UnlockExpr::HotspotInvestigated { id, .. } => ctx.hotspot_investigated(id),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::game::schema::{PredicateEvidenceCollected, PredicateHotspotInvestigated};

    struct TestState {
        evidence: Vec<String>,
        hotspots: Vec<String>,
    }
    impl UnlockContext for TestState {
        fn evidence_collected(&self, id: &str) -> bool { self.evidence.iter().any(|e| e == id) }
        fn statement_acquired(&self, _id: &str) -> bool { false }
        fn topic_discussed(&self, _c: &str, _t: &str) -> bool { false }
        fn hotspot_investigated(&self, id: &str) -> bool { self.hotspots.iter().any(|h| h == id) }
    }

    fn evidence(id: &str) -> UnlockExpr {
        UnlockExpr::EvidenceCollected { _predicate: PredicateEvidenceCollected::X, id: id.into() }
    }
    fn hotspot(id: &str) -> UnlockExpr {
        UnlockExpr::HotspotInvestigated { _predicate: PredicateHotspotInvestigated::X, id: id.into() }
    }

    #[test]
    fn evidence_collected_predicate_is_true_when_in_inventory() {
        let ctx = TestState { evidence: vec!["foo".into()], hotspots: vec![] };
        assert!(evaluate(&evidence("foo"), &ctx));
        assert!(!evaluate(&evidence("bar"), &ctx));
    }

    #[test]
    fn and_combinator_requires_both_branches() {
        let expr = UnlockExpr::Combinator {
            op: Combinator::And,
            left: Box::new(evidence("foo")),
            right: Box::new(hotspot("x")),
        };
        assert!(evaluate(&expr, &TestState { evidence: vec!["foo".into()], hotspots: vec!["x".into()] }));
        assert!(!evaluate(&expr, &TestState { evidence: vec!["foo".into()], hotspots: vec![] }));
    }

    #[test]
    fn or_combinator_requires_either_branch() {
        let expr = UnlockExpr::Combinator {
            op: Combinator::Or,
            left: Box::new(evidence("foo")),
            right: Box::new(hotspot("x")),
        };
        assert!(evaluate(&expr, &TestState { evidence: vec!["foo".into()], hotspots: vec![] }));
        assert!(evaluate(&expr, &TestState { evidence: vec![], hotspots: vec!["x".into()] }));
        assert!(!evaluate(&expr, &TestState { evidence: vec![], hotspots: vec![] }));
    }
}
```

- [ ] **Step 2: Run tests**

```bash
cd src-tauri && cargo test --lib game::unlock && cd ..
```

Expected: PASS (3 tests).

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/game/unlock.rs
git commit -m "feat(engine): UnlockExpr evaluator with UnlockContext trait"
```

---

### Task 5: Implement `game/state.rs` — Inventory, GameState, ChapterState

**Files:**
- Modify: `src-tauri/src/game/state.rs`

Note: spec §4b says `EvidenceRecord` and `StatementRecord` are snapshots — they carry `on_reexamine` cloned from the source scene's def so reexamine works after the scene unloads.

- [ ] **Step 1: Write the file**

```rust
// src-tauri/src/game/state.rs
use std::collections::HashMap;
use serde::Serialize;
use crate::game::schema::{DialogueItem, EvidenceJson, StatementJson};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EvidenceRecord {
    pub id: String,
    pub name: String,
    pub description: String,
    pub details: String,
    pub on_reexamine: Option<Vec<DialogueItem>>,
    pub collected_in_chapter_id: String,
    pub collected_in_scene_id: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatementRecord {
    pub id: String,
    pub speaker: String,
    pub content: String,
    pub on_reexamine: Option<Vec<DialogueItem>>,
    pub acquired_in_chapter_id: String,
    pub acquired_in_scene_id: String,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Inventory {
    pub evidence: Vec<EvidenceRecord>,
    pub statements: Vec<StatementRecord>,
}

impl Inventory {
    pub fn has_evidence(&self, id: &str) -> bool {
        self.evidence.iter().any(|e| e.id == id)
    }
    pub fn has_statement(&self, id: &str) -> bool {
        self.statements.iter().any(|s| s.id == id)
    }
    pub fn add_evidence_from_def(
        &mut self,
        def: &EvidenceJson,
        chapter_id: &str,
        scene_id: &str,
    ) -> bool {
        if self.has_evidence(&def.id) { return false; }
        self.evidence.push(EvidenceRecord {
            id: def.id.clone(),
            name: def.name.clone(),
            description: def.description.clone(),
            details: def.details.clone(),
            on_reexamine: def.on_reexamine.clone(),
            collected_in_chapter_id: chapter_id.into(),
            collected_in_scene_id: scene_id.into(),
        });
        true
    }
    pub fn add_statement_from_def(
        &mut self,
        def: &StatementJson,
        chapter_id: &str,
        scene_id: &str,
    ) -> bool {
        if self.has_statement(&def.id) { return false; }
        self.statements.push(StatementRecord {
            id: def.id.clone(),
            speaker: def.speaker.clone(),
            content: def.content.clone(),
            on_reexamine: def.on_reexamine.clone(),
            acquired_in_chapter_id: chapter_id.into(),
            acquired_in_scene_id: scene_id.into(),
        });
        true
    }
}

/// Minimal chapter manifest in memory.
#[derive(Debug, Clone)]
pub struct ChapterManifest {
    pub id: String,
    pub title: String,
    pub summary: String,
    pub scenes: Vec<SceneRef>,
}

#[derive(Debug, Clone)]
pub struct SceneRef {
    pub scene_type: crate::game::schema::SceneType,
    pub file: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn def(id: &str) -> EvidenceJson {
        EvidenceJson {
            id: id.into(),
            name: id.into(),
            description: id.into(),
            details: id.into(),
            on_collect: vec![],
            on_reexamine: None,
        }
    }

    #[test]
    fn inventory_dedupes_evidence_on_double_add() {
        let mut inv = Inventory::default();
        assert!(inv.add_evidence_from_def(&def("foo"), "chapter_1", "scene_1"));
        assert!(!inv.add_evidence_from_def(&def("foo"), "chapter_1", "scene_1"));
        assert_eq!(inv.evidence.len(), 1);
        assert!(inv.has_evidence("foo"));
    }
}
```

- [ ] **Step 2: Run tests**

```bash
cd src-tauri && cargo test --lib game::state && cd ..
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/game/state.rs
git commit -m "feat(engine): Inventory + EvidenceRecord/StatementRecord with snapshot semantics"
```

---

## Phase B4: Scene runtimes

### Task 6: Implement `game/scenes/linear.rs` — LinearSceneState

**Files:**
- Modify: `src-tauri/src/game/scenes/linear.rs`

- [ ] **Step 1: Write the file**

```rust
// src-tauri/src/game/scenes/linear.rs
use crate::game::schema::{DialogueItem, LinearSceneJson};

#[derive(Debug, Clone)]
pub struct LinearSceneState {
    pub id: String,
    pub title: String,
    pub queue: Vec<DialogueItem>,
    pub cursor: usize,
    pub queue_gen: u64,
}

impl LinearSceneState {
    pub fn from_json(j: LinearSceneJson, queue_gen: u64) -> Self {
        Self {
            id: j.id,
            title: j.title,
            queue: j.queue,
            cursor: 0,
            queue_gen,
        }
    }

    pub fn current(&self) -> Option<&DialogueItem> {
        self.queue.get(self.cursor)
    }

    pub fn queue_remaining(&self) -> usize {
        self.queue.len().saturating_sub(self.cursor + 1).max(0)
    }

    /// Returns true if the queue is exhausted (scene should advance).
    pub fn advance(&mut self) -> bool {
        self.cursor += 1;
        self.cursor >= self.queue.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn line(text: &str) -> DialogueItem {
        DialogueItem::Line { speaker: "A".into(), text: text.into() }
    }

    #[test]
    fn advance_walks_through_queue_and_signals_completion() {
        let mut s = LinearSceneState {
            id: "s".into(),
            title: "t".into(),
            queue: vec![line("a"), line("b")],
            cursor: 0,
            queue_gen: 1,
        };
        assert_eq!(s.current(), Some(&line("a")));
        assert!(!s.advance());
        assert_eq!(s.current(), Some(&line("b")));
        assert!(s.advance());  // cursor now past the end
        assert_eq!(s.current(), None);
    }
}
```

- [ ] **Step 2: Run test**

```bash
cd src-tauri && cargo test --lib game::scenes::linear && cd ..
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/game/scenes/linear.rs
git commit -m "feat(engine): LinearSceneState with cursor + queue_gen + advance"
```

---

### Task 7: Implement `game/scenes/investigation.rs` — InvestigationSceneState

**Files:**
- Modify: `src-tauri/src/game/scenes/investigation.rs`

This is the meatiest scene type. Strategy: keep `InvestigationSceneJson` around (it's our source of truth for defs) and overlay mutable runtime state alongside (which hotspots inspected, which topics discussed, which sublocations entered, current_sublocation, pending_queue).

- [ ] **Step 1: Write the file**

```rust
// src-tauri/src/game/scenes/investigation.rs
use std::collections::HashSet;
use crate::game::schema::{
    DialogueItem, InvestigationSceneJson, LockStatus, OutroUnlock,
    UnlockExpr,
};
use crate::game::unlock::{self, UnlockContext};

/// Runtime state overlaid on a frozen `InvestigationSceneJson` def. We never
/// mutate the def itself; all runtime data lives in this struct.
#[derive(Debug, Clone)]
pub struct InvestigationSceneState {
    pub def: InvestigationSceneJson,
    pub intro_played: bool,
    pub outro_played: bool,
    pub current_sublocation_id: Option<String>,
    pub pending_queue: Option<DialogueQueue>,
    pub inspected_hotspots: HashSet<String>,
    pub discussed_topics: HashSet<(String, String)>,
    pub entered_sublocations: HashSet<String>,
    /// Locked blocks (hotspot/topic/sublocation IDs) that have been unlocked
    /// via inbound `Reveals`. Used to track silent unlocks.
    pub unlocked_overrides: HashSet<String>,
}

#[derive(Debug, Clone)]
pub struct DialogueQueue {
    pub items: Vec<DialogueItem>,
    pub cursor: usize,
    pub queue_gen: u64,
}

impl InvestigationSceneState {
    pub fn from_json(def: InvestigationSceneJson) -> Self {
        Self {
            def,
            intro_played: false,
            outro_played: false,
            current_sublocation_id: None,
            pending_queue: None,
            inspected_hotspots: HashSet::new(),
            discussed_topics: HashSet::new(),
            entered_sublocations: HashSet::new(),
            unlocked_overrides: HashSet::new(),
        }
    }

    pub fn id(&self) -> &str { &self.def.id }
    pub fn title(&self) -> &str { &self.def.title }

    pub fn outro_satisfied(&self, inv: &impl UnlockContext) -> bool {
        match &self.def.outro.unlock {
            OutroUnlock::Auto(_) => self.all_unlocked_hotspots_inspected() && self.all_unlocked_topics_discussed(),
            OutroUnlock::Expr(expr) => unlock::evaluate(expr, inv),
        }
    }

    fn all_unlocked_hotspots_inspected(&self) -> bool {
        for sub in &self.def.sublocations {
            if !self.is_sublocation_unlocked(&sub.id) { continue; }
            for h in &sub.hotspots {
                if self.is_block_unlocked(&format!("hotspot:{}", h.id), h.status, h.unlock.as_ref()) {
                    if !self.inspected_hotspots.contains(&h.id) { return false; }
                }
            }
        }
        true
    }

    fn all_unlocked_topics_discussed(&self) -> bool {
        for sub in &self.def.sublocations {
            if !self.is_sublocation_unlocked(&sub.id) { continue; }
            for c in &sub.characters {
                for t in &c.topics {
                    if self.is_block_unlocked(&format!("topic:{}@{}", c.id, t.id), t.status, t.unlock.as_ref()) {
                        if !self.discussed_topics.contains(&(c.id.clone(), t.id.clone())) { return false; }
                    }
                }
            }
        }
        true
    }

    pub fn is_sublocation_unlocked(&self, id: &str) -> bool {
        let key = format!("sublocation:{id}");
        let def = self.def.sublocations.iter().find(|s| s.id == id);
        match def {
            None => false,
            Some(s) => self.is_block_unlocked(&key, s.status, s.unlock.as_ref()),
        }
    }

    pub fn is_block_unlocked(&self, key: &str, status: LockStatus, _unlock: Option<&UnlockExpr>) -> bool {
        match status {
            LockStatus::Unlocked => true,
            LockStatus::Locked => self.unlocked_overrides.contains(key),
        }
    }

    pub fn record_inspect(&mut self, hotspot_id: &str) {
        self.inspected_hotspots.insert(hotspot_id.into());
    }
    pub fn record_topic_discussed(&mut self, character_id: &str, topic_id: &str) {
        self.discussed_topics.insert((character_id.into(), topic_id.into()));
    }
    pub fn record_sublocation_entered(&mut self, id: &str) {
        self.entered_sublocations.insert(id.into());
    }
    pub fn unlock_override(&mut self, key: &str) {
        self.unlocked_overrides.insert(key.into());
    }
}

impl UnlockContext for InvestigationSceneState {
    fn evidence_collected(&self, _id: &str) -> bool { false /* inventory check is done by the caller, not here */ }
    fn statement_acquired(&self, _id: &str) -> bool { false }
    fn topic_discussed(&self, c: &str, t: &str) -> bool {
        self.discussed_topics.contains(&(c.to_string(), t.to_string()))
    }
    fn hotspot_investigated(&self, id: &str) -> bool {
        self.inspected_hotspots.contains(id)
    }
}

#[cfg(test)]
mod tests {
    // Reveal-application tests are in reveals.rs (Task 8). This file's tests
    // focus on simple state mutation.
    use super::*;

    #[test]
    fn record_inspect_marks_hotspot() {
        let mut s = InvestigationSceneState {
            def: InvestigationSceneJson {
                id: "i".into(), title: "i".into(), intro: vec![],
                sublocations: vec![], evidence_manifest: vec![],
                statement_manifest: vec![],
                outro: crate::game::schema::OutroJson {
                    unlock: OutroUnlock::Auto(crate::game::schema::AutoMarker::Auto),
                    dialogue: vec![],
                },
            },
            intro_played: false, outro_played: false,
            current_sublocation_id: None, pending_queue: None,
            inspected_hotspots: HashSet::new(),
            discussed_topics: HashSet::new(),
            entered_sublocations: HashSet::new(),
            unlocked_overrides: HashSet::new(),
        };
        s.record_inspect("foo");
        assert!(s.inspected_hotspots.contains("foo"));
    }
}
```

The `InvestigationSceneState::evidence_collected` and `statement_acquired` returning `false` is **intentional**: when evaluating an Outro `Unlock` that mentions evidence/statement, the GameEngine merges this scene's `UnlockContext` with the global `Inventory` (Task 11). The scene alone doesn't know about inventory.

- [ ] **Step 2: Run test**

```bash
cd src-tauri && cargo test --lib game::scenes::investigation && cd ..
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/game/scenes/investigation.rs
git commit -m "feat(engine): InvestigationSceneState — runtime overlay on frozen def"
```

---

### Task 8: Implement `game/reveals.rs` — reveal application + queue construction

**Files:**
- Modify: `src-tauri/src/game/reveals.rs`

This implements the §4d algorithm: given a trigger (hotspot/topic/sublocation), build the chained dialogue queue (trigger body + each on_collect/on_acquire), mark items collected in inventory, and silently unlock targeted blocks.

- [ ] **Step 1: Write the file**

```rust
// src-tauri/src/game/reveals.rs
use crate::game::schema::{DialogueItem, RevealTarget};
use crate::game::scenes::investigation::InvestigationSceneState;
use crate::game::state::Inventory;

/// Build a queue from a trigger's body + chained reveals. Mutates inventory
/// and the scene's silent-unlock set as a side effect.
///
/// Per spec §4d "Play order":
///   1. trigger body dialogue
///   2. for each reveal in declared order:
///        evidence:X    → add to inventory; append X.on_collect
///        statement:X   → add to inventory; append X.on_acquire
///        topic/hotspot/sublocation → silent unlock; no dialogue appended
pub fn apply_reveals_and_build_queue(
    scene: &mut InvestigationSceneState,
    inventory: &mut Inventory,
    trigger_body: Vec<DialogueItem>,
    reveals: &[RevealTarget],
    chapter_id: &str,
) -> Vec<DialogueItem> {
    let mut queue = trigger_body;
    for r in reveals {
        match r {
            RevealTarget::Evidence { id } => {
                if let Some(def) = scene.def.evidence_manifest.iter().find(|e| e.id == *id) {
                    let newly_added = inventory.add_evidence_from_def(def, chapter_id, &scene.def.id);
                    if newly_added {
                        queue.extend(def.on_collect.iter().cloned());
                    }
                }
            }
            RevealTarget::Statement { id } => {
                if let Some(def) = scene.def.statement_manifest.iter().find(|s| s.id == *id) {
                    let newly_added = inventory.add_statement_from_def(def, chapter_id, &scene.def.id);
                    if newly_added {
                        queue.extend(def.on_acquire.iter().cloned());
                    }
                }
            }
            RevealTarget::Topic { character_id, topic_id } => {
                scene.unlock_override(&format!("topic:{character_id}@{topic_id}"));
            }
            RevealTarget::Hotspot { id } => {
                scene.unlock_override(&format!("hotspot:{id}"));
            }
            RevealTarget::Sublocation { id } => {
                scene.unlock_override(&format!("sublocation:{id}"));
            }
        }
    }
    queue
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::game::schema::{
        AutoMarker, DialogueItem, EvidenceJson, InvestigationSceneJson, OutroJson, OutroUnlock,
    };

    fn evidence_def(id: &str) -> EvidenceJson {
        EvidenceJson {
            id: id.into(),
            name: id.into(),
            description: id.into(),
            details: id.into(),
            on_collect: vec![DialogueItem::Line { speaker: "A".into(), text: format!("collected {id}") }],
            on_reexamine: None,
        }
    }

    fn empty_scene_with_evidence(defs: Vec<EvidenceJson>) -> InvestigationSceneState {
        InvestigationSceneState::from_json(InvestigationSceneJson {
            id: "i".into(), title: "i".into(), intro: vec![],
            sublocations: vec![], evidence_manifest: defs,
            statement_manifest: vec![],
            outro: OutroJson { unlock: OutroUnlock::Auto(AutoMarker::Auto), dialogue: vec![] },
        })
    }

    #[test]
    fn reveals_evidence_appends_on_collect_to_queue() {
        let mut scene = empty_scene_with_evidence(vec![evidence_def("coffee")]);
        let mut inv = Inventory::default();
        let queue = apply_reveals_and_build_queue(
            &mut scene,
            &mut inv,
            vec![DialogueItem::Line { speaker: "A".into(), text: "trigger".into() }],
            &[RevealTarget::Evidence { id: "coffee".into() }],
            "chapter_1",
        );
        assert_eq!(queue.len(), 2);  // trigger line + on_collect line
        assert!(inv.has_evidence("coffee"));
    }

    #[test]
    fn double_reveal_of_same_evidence_does_not_double_append() {
        let mut scene = empty_scene_with_evidence(vec![evidence_def("coffee")]);
        let mut inv = Inventory::default();
        let _ = apply_reveals_and_build_queue(
            &mut scene, &mut inv,
            vec![],
            &[RevealTarget::Evidence { id: "coffee".into() }],
            "chapter_1",
        );
        // Second call: the evidence is already in inventory, so on_collect should NOT replay.
        let queue2 = apply_reveals_and_build_queue(
            &mut scene, &mut inv,
            vec![],
            &[RevealTarget::Evidence { id: "coffee".into() }],
            "chapter_1",
        );
        assert!(queue2.is_empty());
    }

    #[test]
    fn reveals_sublocation_silently_unlocks_it() {
        let mut scene = empty_scene_with_evidence(vec![]);
        let mut inv = Inventory::default();
        let queue = apply_reveals_and_build_queue(
            &mut scene, &mut inv,
            vec![],
            &[RevealTarget::Sublocation { id: "back_room".into() }],
            "chapter_1",
        );
        assert!(queue.is_empty());
        assert!(scene.unlocked_overrides.contains("sublocation:back_room"));
    }
}
```

- [ ] **Step 2: Run tests**

```bash
cd src-tauri && cargo test --lib game::reveals && cd ..
```

Expected: 3 tests PASS.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/game/reveals.rs
git commit -m "feat(engine): reveal application + chained queue construction"
```

---

## Phase B5: Loader

### Task 9: Implement `game/loader.rs` — read JSON via BaseDirectory::Resource

**Files:**
- Modify: `src-tauri/src/game/loader.rs`

- [ ] **Step 1: Write the file**

```rust
// src-tauri/src/game/loader.rs
use std::fs;
use std::path::{Path, PathBuf};
use crate::game::error::GameError;
use crate::game::schema::{ChaptersIndexJson, SceneJson};

/// Reads and deserializes chapters.json from the given resources directory.
pub fn load_chapters_index(resources_dir: &Path) -> Result<ChaptersIndexJson, GameError> {
    let path = resources_dir.join("chapters.json");
    let raw = fs::read_to_string(&path).map_err(|e| {
        GameError::scene_load_failed(format!("failed to read {}: {}", path.display(), e))
    })?;
    serde_json::from_str(&raw).map_err(|e| {
        GameError::parse_failure(format!("invalid chapters.json: {}", e))
    })
}

/// Reads and deserializes one scene JSON, given its file path relative to the
/// resources root.
pub fn load_scene(resources_dir: &Path, file_rel: &str) -> Result<SceneJson, GameError> {
    let path = resources_dir.join(file_rel);
    let raw = fs::read_to_string(&path).map_err(|e| {
        GameError::scene_load_failed(format!("failed to read {}: {}", path.display(), e))
    })?;
    serde_json::from_str(&raw).map_err(|e| {
        GameError::parse_failure(format!("invalid scene JSON {}: {}", path.display(), e))
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use std::path::PathBuf;

    fn temp_dir() -> PathBuf {
        let d = std::env::temp_dir().join(format!("lyra-test-{}", std::process::id()));
        fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn loads_a_valid_chapters_index() {
        let d = temp_dir();
        let p = d.join("chapters.json");
        let mut f = fs::File::create(&p).unwrap();
        writeln!(f, r#"{{"chapters":[]}}"#).unwrap();
        let idx = load_chapters_index(&d).unwrap();
        assert!(idx.chapters.is_empty());
        let _ = fs::remove_dir_all(d);
    }

    #[test]
    fn surfaces_a_typed_error_for_missing_file() {
        let d = temp_dir();
        let err = load_chapters_index(&d).unwrap_err();
        assert_eq!(err.code, "sceneLoadFailed");
        let _ = fs::remove_dir_all(d);
    }
}
```

- [ ] **Step 2: Run tests**

```bash
cd src-tauri && cargo test --lib game::loader && cd ..
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/game/loader.rs
git commit -m "feat(engine): JSON loader (chapters index + scene file)"
```

---

## Phase B6: View + scenes/mod.rs + GameEngine

### Task 10: Implement `game/view.rs` — GameStateView

**Files:**
- Modify: `src-tauri/src/game/view.rs`

This is the serializable snapshot the frontend reads. Every Tauri command returns this.

- [ ] **Step 1: Write the file**

```rust
// src-tauri/src/game/view.rs
use serde::Serialize;
use crate::game::schema::{DialogueItem, LockStatus, RevealTarget};
use crate::game::state::Inventory;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GameStateView {
    pub mode: ModeView,
    pub chapter: ChapterView,
    pub scene: SceneView,
    pub inventory: Inventory,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ModeView {
    Dialogue {
        current: DialogueItem,
        queue_remaining: usize,
        scene_tag: Option<String>,
        queue_token: QueueToken,
    },
    Explore { sublocation_id: String },
    GameComplete,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct QueueToken {
    pub scene_id: String,
    pub queue_gen: u64,
    pub cursor: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChapterView {
    pub id: String,
    pub title: String,
    pub summary: String,
    pub index: usize,
    pub total: usize,
}

/// The frontend renders different shapes for linear vs. investigation scenes.
/// `kind` discriminates.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum SceneView {
    Linear { id: String, title: String, index: usize, total: usize },
    Investigation {
        id: String,
        title: String,
        index: usize,
        total: usize,
        current_sublocation_id: Option<String>,
        visible_sublocations: Vec<SublocationView>,
    },
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SublocationView {
    pub id: String,
    pub scene_tag: String,
    pub hotspots: Vec<HotspotView>,
    pub characters: Vec<CharacterView>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HotspotView {
    pub id: String,
    pub label: String,
    pub description: String,
    pub inspected: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CharacterView {
    pub id: String,
    pub name: String,
    pub role: String,
    pub bio: String,
    pub topics: Vec<TopicView>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TopicView {
    pub id: String,
    pub label: String,
    pub discussed: bool,
}
```

The view *hides locked* sublocations/hotspots/topics — the engine constructs the `SceneView` by filtering. Locked blocks simply don't appear in the snapshot the frontend renders.

- [ ] **Step 2: Verify it compiles**

```bash
cd src-tauri && cargo check && cd ..
```

Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/game/view.rs
git commit -m "feat(engine): GameStateView snapshot types (mode-tagged, locked items hidden)"
```

---

### Task 11: Implement `game/scenes/mod.rs` — SceneRuntime enum dispatch

**Files:**
- Modify: `src-tauri/src/game/scenes/mod.rs`

- [ ] **Step 1: Write the file**

```rust
// src-tauri/src/game/scenes/mod.rs
pub mod linear;
pub mod investigation;

use linear::LinearSceneState;
use investigation::InvestigationSceneState;

#[derive(Debug, Clone)]
pub enum SceneRuntime {
    Linear(LinearSceneState),
    Investigation(InvestigationSceneState),
    // Future: Interrogation(InterrogationSceneState) — see spec §6c.
}

impl SceneRuntime {
    pub fn id(&self) -> &str {
        match self {
            SceneRuntime::Linear(s) => &s.id,
            SceneRuntime::Investigation(s) => s.id(),
        }
    }
    pub fn title(&self) -> &str {
        match self {
            SceneRuntime::Linear(s) => &s.title,
            SceneRuntime::Investigation(s) => s.title(),
        }
    }
}
```

- [ ] **Step 2: Verify it compiles**

```bash
cd src-tauri && cargo check && cd ..
```

Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/game/scenes/mod.rs
git commit -m "feat(engine): SceneRuntime enum dispatch"
```

---

### Task 12: Implement `game/mod.rs` — GameEngine orchestrator (the heart of the engine)

**Files:**
- Modify: `src-tauri/src/game/mod.rs`

This is the biggest task — the engine's mode state machine, command implementations, queue construction, scene transitions. Build it incrementally.

- [ ] **Step 1: Replace `game/mod.rs` with the full orchestrator**

```rust
// src-tauri/src/game/mod.rs
//
// GameEngine — the single owner of mutable game state.

pub mod error;
pub mod schema;
pub mod state;
pub mod unlock;
pub mod reveals;
pub mod scenes;
pub mod loader;
pub mod view;

pub use error::GameError;
pub use view::{GameStateView, ModeView, QueueToken};

use std::path::PathBuf;
use scenes::SceneRuntime;
use scenes::investigation::{DialogueQueue, InvestigationSceneState};
use scenes::linear::LinearSceneState;
use schema::{
    DialogueItem, LockStatus, RevealTarget, SceneJson, SceneType,
};
use state::{ChapterManifest, Inventory, SceneRef};
use view::{
    CharacterView, ChapterView, HotspotView, SceneView, SublocationView, TopicView,
};

pub struct GameEngine {
    resources_dir: PathBuf,
    chapters: Vec<ChapterManifest>,
    current_chapter_idx: usize,
    current_scene_idx: usize,
    scene: SceneRuntime,
    last_scene_tag: Option<String>,
    inventory: Inventory,
    next_queue_gen: u64,
}

const REEXAMINE_FALLBACK_TEXT: &str = "（沒有新發現。）";

impl GameEngine {
    /// Bootstraps from chapters.json + the first chapter's first scene.
    pub fn new_started(resources_dir: PathBuf) -> Result<Self, GameError> {
        let index = loader::load_chapters_index(&resources_dir)?;

        let chapters: Vec<ChapterManifest> = index
            .chapters
            .into_iter()
            .map(|c| ChapterManifest {
                id: c.id,
                title: c.title,
                summary: c.summary,
                scenes: c
                    .scenes
                    .into_iter()
                    .map(|s| SceneRef { scene_type: s.scene_type, file: s.file })
                    .collect(),
            })
            .collect();

        if chapters.is_empty() {
            return Err(GameError::chapter_load_failed("chapters.json has no chapters.".into()));
        }

        let first_scene_ref = chapters[0]
            .scenes
            .first()
            .ok_or_else(|| GameError::chapter_load_failed("chapter 1 has no scenes.".into()))?;
        let mut engine = Self {
            resources_dir: resources_dir.clone(),
            chapters,
            current_chapter_idx: 0,
            current_scene_idx: 0,
            scene: load_scene_runtime(&resources_dir, first_scene_ref, 1)?,
            last_scene_tag: None,
            inventory: Inventory::default(),
            next_queue_gen: 2,  // 1 was used by the first scene; next allocation starts at 2
        };
        engine.prime_initial_queue();
        Ok(engine)
    }

    fn prime_initial_queue(&mut self) {
        match &mut self.scene {
            SceneRuntime::Linear(_) => {
                // Linear scene already has its queue ready from from_json. Nothing to prime.
            }
            SceneRuntime::Investigation(inv) => {
                if !inv.intro_played && !inv.def.intro.is_empty() {
                    inv.pending_queue = Some(DialogueQueue {
                        items: inv.def.intro.clone(),
                        cursor: 0,
                        queue_gen: 1,
                    });
                    inv.intro_played = true;  // will be true once played
                } else {
                    // No intro — entry into first unlocked sub-location instead.
                    self.advance_into_first_sublocation();
                }
            }
        }
    }

    pub fn view(&self) -> GameStateView {
        GameStateView {
            mode: self.mode_view(),
            chapter: self.chapter_view(),
            scene: self.scene_view(),
            inventory: self.inventory.clone(),
        }
    }

    pub fn advance_dialogue(&mut self, expected: QueueToken) -> Result<GameStateView, GameError> {
        let mut current_token = match self.current_queue_token() {
            Some(t) => t,
            None => return Err(GameError::no_active_dialogue()),
        };
        if current_token != expected {
            // Stale or duplicate request — return current state unchanged.
            return Ok(self.view());
        }
        // Match — advance.
        let exhausted = match &mut self.scene {
            SceneRuntime::Linear(s) => s.advance(),
            SceneRuntime::Investigation(inv) => {
                let q = inv.pending_queue.as_mut().ok_or_else(GameError::no_active_dialogue)?;
                q.cursor += 1;
                q.cursor >= q.items.len()
            }
        };
        // Update last_scene_tag from the item we just left.
        if let Some(item) = self.peek_just_consumed() {
            if let DialogueItem::SceneTag { text } = item {
                self.last_scene_tag = Some(text);
            }
        }
        if exhausted {
            self.on_queue_exhausted()?;
        }
        Ok(self.view())
    }

    fn peek_just_consumed(&self) -> Option<DialogueItem> {
        match &self.scene {
            SceneRuntime::Linear(s) => s.queue.get(s.cursor.saturating_sub(1)).cloned(),
            SceneRuntime::Investigation(inv) => inv
                .pending_queue
                .as_ref()
                .and_then(|q| q.items.get(q.cursor.saturating_sub(1)).cloned()),
        }
    }

    fn on_queue_exhausted(&mut self) -> Result<(), GameError> {
        // For investigation: clear pending_queue and decide next mode (Outro, Explore, scene-advance).
        match &mut self.scene {
            SceneRuntime::Linear(_) => {
                // Linear queue done → scene advance.
                self.advance_scene()?;
            }
            SceneRuntime::Investigation(_inv) => {
                let advance_inv = self.try_advance_investigation()?;
                if advance_inv {
                    self.advance_scene()?;
                }
            }
        }
        Ok(())
    }

    /// Returns true if the investigation scene is finished (outro played) and the engine should advance.
    fn try_advance_investigation(&mut self) -> Result<bool, GameError> {
        let outro_satisfied;
        let outro_already_played;
        let outro_dialogue;
        {
            let inv = match &mut self.scene {
                SceneRuntime::Investigation(i) => i,
                _ => return Ok(false),
            };
            inv.pending_queue = None;
            // Determine state needs.
            let ctx = SceneAndInventoryCtx { scene: inv, inventory: &self.inventory };
            outro_satisfied = inv.outro_satisfied(&ctx);
            outro_already_played = inv.outro_played;
            outro_dialogue = inv.def.outro.dialogue.clone();
        }

        // First-time intro completion: enter the first unlocked sub-location.
        let need_initial_sublocation = matches!(&self.scene, SceneRuntime::Investigation(i) if i.current_sublocation_id.is_none());
        if need_initial_sublocation {
            self.advance_into_first_sublocation();
            return Ok(false);
        }

        if !outro_already_played && outro_satisfied {
            // Queue the outro.
            let queue_gen = self.alloc_queue_gen();
            if let SceneRuntime::Investigation(inv) = &mut self.scene {
                inv.pending_queue = Some(DialogueQueue {
                    items: outro_dialogue,
                    cursor: 0,
                    queue_gen,
                });
                inv.outro_played = true;
            }
            return Ok(false);
        }

        if outro_already_played {
            return Ok(true);  // engine should advance to next scene
        }
        // Otherwise: back to Explore mode.
        Ok(false)
    }

    fn advance_into_first_sublocation(&mut self) {
        if let SceneRuntime::Investigation(inv) = &mut self.scene {
            if let Some(first) = inv.def.sublocations.iter().find(|s| s.status == LockStatus::Unlocked) {
                let id = first.id.clone();
                inv.current_sublocation_id = Some(id.clone());
                inv.record_sublocation_entered(&id);
                if !first.transition_dialogue.is_empty() {
                    let queue_gen = self.alloc_queue_gen();
                    if let SceneRuntime::Investigation(inv) = &mut self.scene {
                        inv.pending_queue = Some(DialogueQueue {
                            items: first.transition_dialogue.clone(),
                            cursor: 0,
                            queue_gen,
                        });
                    }
                }
            }
        }
    }

    fn alloc_queue_gen(&mut self) -> u64 {
        let g = self.next_queue_gen;
        self.next_queue_gen += 1;
        g
    }

    /// Advances scene_idx → loads next scene → primes its initial queue.
    /// If no more scenes in this chapter, advance chapter_idx. If no more chapters, game complete.
    fn advance_scene(&mut self) -> Result<(), GameError> {
        self.current_scene_idx += 1;
        let chapter = &self.chapters[self.current_chapter_idx];
        if self.current_scene_idx >= chapter.scenes.len() {
            // Chapter complete → next chapter
            self.current_chapter_idx += 1;
            self.current_scene_idx = 0;
            if self.current_chapter_idx >= self.chapters.len() {
                // Game complete — leave state as-is, mode_view will report GameComplete.
                return Ok(());
            }
        }
        let chapter = &self.chapters[self.current_chapter_idx];
        let scene_ref = chapter
            .scenes
            .get(self.current_scene_idx)
            .ok_or_else(|| GameError::chapter_load_failed("scene index out of bounds".into()))?;
        let new_scene = load_scene_runtime(&self.resources_dir, scene_ref, self.alloc_queue_gen())?;
        self.scene = new_scene;
        self.prime_initial_queue();
        Ok(())
    }

    // ----- Command implementations -----

    pub fn inspect_hotspot(&mut self, hotspot_id: &str) -> Result<GameStateView, GameError> {
        let chapter_id = self.chapters[self.current_chapter_idx].id.clone();
        let inv = match &mut self.scene {
            SceneRuntime::Investigation(i) => i,
            _ => return Err(GameError::wrong_mode("inspect_hotspot", "linear")),
        };
        let sublocation_id = inv
            .current_sublocation_id
            .clone()
            .ok_or_else(|| GameError::wrong_mode("inspect_hotspot", "no sublocation entered"))?;
        // Find hotspot in current sublocation.
        let sub_def = inv
            .def
            .sublocations
            .iter()
            .find(|s| s.id == sublocation_id)
            .ok_or_else(|| GameError::unknown_sublocation(&sublocation_id))?;
        let hot_def = sub_def
            .hotspots
            .iter()
            .find(|h| h.id == hotspot_id)
            .ok_or_else(|| GameError::unknown_hotspot(hotspot_id))?
            .clone();
        // Locked?
        if !inv.is_block_unlocked(&format!("hotspot:{}", hotspot_id), hot_def.status, hot_def.unlock.as_ref()) {
            return Err(GameError::locked_hotspot(hotspot_id));
        }
        let first_time = !inv.inspected_hotspots.contains(hotspot_id);
        let queue_items = if first_time {
            inv.record_inspect(hotspot_id);
            let body = hot_def.inspect_dialogue.clone();
            reveals::apply_reveals_and_build_queue(
                inv,
                &mut self.inventory,
                body,
                &hot_def.reveals,
                &chapter_id,
            )
        } else {
            // Re-examine path: play On Reexamine if present; else fallback line.
            match hot_def.on_reexamine.clone() {
                Some(q) if !q.is_empty() => q,
                _ => vec![DialogueItem::Action { text: REEXAMINE_FALLBACK_TEXT.into() }],
            }
        };
        let queue_gen = self.alloc_queue_gen();
        if let SceneRuntime::Investigation(inv) = &mut self.scene {
            inv.pending_queue = Some(DialogueQueue { items: queue_items, cursor: 0, queue_gen });
        }
        Ok(self.view())
    }

    pub fn interview_topic(&mut self, character_id: &str, topic_id: &str) -> Result<GameStateView, GameError> {
        let chapter_id = self.chapters[self.current_chapter_idx].id.clone();
        let inv = match &mut self.scene {
            SceneRuntime::Investigation(i) => i,
            _ => return Err(GameError::wrong_mode("interview_topic", "linear")),
        };
        let sub_id = inv.current_sublocation_id.clone().ok_or_else(|| GameError::wrong_mode("interview_topic", "no sublocation entered"))?;
        let sub_def = inv.def.sublocations.iter().find(|s| s.id == sub_id).ok_or_else(|| GameError::unknown_sublocation(&sub_id))?;
        let character = sub_def.characters.iter().find(|c| c.id == character_id).ok_or_else(|| GameError::unknown_character(character_id))?;
        let topic = character.topics.iter().find(|t| t.id == topic_id).ok_or_else(|| GameError::unknown_topic(character_id, topic_id))?.clone();
        let key = format!("topic:{character_id}@{topic_id}");
        if !inv.is_block_unlocked(&key, topic.status, topic.unlock.as_ref()) {
            return Err(GameError::locked_topic(character_id, topic_id));
        }
        let first_time = !inv.discussed_topics.contains(&(character_id.into(), topic_id.into()));
        let queue_items = if first_time {
            inv.record_topic_discussed(character_id, topic_id);
            let body = topic.topic_dialogue.clone();
            reveals::apply_reveals_and_build_queue(inv, &mut self.inventory, body, &topic.reveals, &chapter_id)
        } else {
            match topic.on_reexamine.clone() {
                Some(q) if !q.is_empty() => q,
                _ => vec![DialogueItem::Action { text: REEXAMINE_FALLBACK_TEXT.into() }],
            }
        };
        let queue_gen = self.alloc_queue_gen();
        if let SceneRuntime::Investigation(inv) = &mut self.scene {
            inv.pending_queue = Some(DialogueQueue { items: queue_items, cursor: 0, queue_gen });
        }
        Ok(self.view())
    }

    pub fn enter_sublocation(&mut self, sublocation_id: &str) -> Result<GameStateView, GameError> {
        let inv = match &mut self.scene {
            SceneRuntime::Investigation(i) => i,
            _ => return Err(GameError::wrong_mode("enter_sublocation", "linear")),
        };
        let def = inv.def.sublocations.iter().find(|s| s.id == sublocation_id).ok_or_else(|| GameError::unknown_sublocation(sublocation_id))?.clone();
        if !inv.is_block_unlocked(&format!("sublocation:{}", sublocation_id), def.status, def.unlock.as_ref()) {
            return Err(GameError::locked_sublocation(sublocation_id));
        }
        inv.current_sublocation_id = Some(sublocation_id.into());
        let first_entry = !inv.entered_sublocations.contains(sublocation_id);
        inv.record_sublocation_entered(sublocation_id);
        if first_entry && !def.transition_dialogue.is_empty() {
            let queue_gen = self.alloc_queue_gen();
            inv.pending_queue = Some(DialogueQueue { items: def.transition_dialogue.clone(), cursor: 0, queue_gen });
        }
        Ok(self.view())
    }

    pub fn reexamine_evidence(&mut self, id: &str) -> Result<GameStateView, GameError> {
        let rec = self.inventory.evidence.iter().find(|e| e.id == id).cloned().ok_or_else(|| GameError::unknown_evidence(id))?;
        let queue_items = match rec.on_reexamine.clone() {
            Some(q) if !q.is_empty() => q,
            _ => vec![DialogueItem::Action { text: REEXAMINE_FALLBACK_TEXT.into() }],
        };
        let queue_gen = self.alloc_queue_gen();
        // We attach the queue to the current scene's pending_queue if it's investigation; for linear we can't.
        match &mut self.scene {
            SceneRuntime::Investigation(inv) => {
                inv.pending_queue = Some(DialogueQueue { items: queue_items, cursor: 0, queue_gen });
            }
            SceneRuntime::Linear(_) => {
                return Err(GameError::wrong_mode("reexamine_evidence", "linear"));
            }
        }
        Ok(self.view())
    }

    pub fn reexamine_statement(&mut self, id: &str) -> Result<GameStateView, GameError> {
        let rec = self.inventory.statements.iter().find(|s| s.id == id).cloned().ok_or_else(|| GameError::unknown_statement(id))?;
        let queue_items = match rec.on_reexamine.clone() {
            Some(q) if !q.is_empty() => q,
            _ => vec![DialogueItem::Action { text: REEXAMINE_FALLBACK_TEXT.into() }],
        };
        let queue_gen = self.alloc_queue_gen();
        match &mut self.scene {
            SceneRuntime::Investigation(inv) => {
                inv.pending_queue = Some(DialogueQueue { items: queue_items, cursor: 0, queue_gen });
            }
            SceneRuntime::Linear(_) => {
                return Err(GameError::wrong_mode("reexamine_statement", "linear"));
            }
        }
        Ok(self.view())
    }

    // ----- View construction -----

    fn current_queue_token(&self) -> Option<QueueToken> {
        match &self.scene {
            SceneRuntime::Linear(s) => {
                if s.cursor < s.queue.len() {
                    Some(QueueToken { scene_id: s.id.clone(), queue_gen: s.queue_gen, cursor: s.cursor })
                } else { None }
            }
            SceneRuntime::Investigation(inv) => match &inv.pending_queue {
                Some(q) if q.cursor < q.items.len() => Some(QueueToken {
                    scene_id: inv.def.id.clone(),
                    queue_gen: q.queue_gen,
                    cursor: q.cursor,
                }),
                _ => None,
            },
        }
    }

    fn mode_view(&self) -> ModeView {
        if self.current_chapter_idx >= self.chapters.len() {
            return ModeView::GameComplete;
        }
        let token = self.current_queue_token();
        let current_item: Option<DialogueItem> = match &self.scene {
            SceneRuntime::Linear(s) => s.current().cloned(),
            SceneRuntime::Investigation(inv) => inv
                .pending_queue
                .as_ref()
                .and_then(|q| q.items.get(q.cursor).cloned()),
        };
        match (current_item, token) {
            (Some(item), Some(t)) => ModeView::Dialogue {
                current: item,
                queue_remaining: match &self.scene {
                    SceneRuntime::Linear(s) => s.queue_remaining(),
                    SceneRuntime::Investigation(inv) => inv
                        .pending_queue
                        .as_ref()
                        .map(|q| q.items.len().saturating_sub(q.cursor + 1))
                        .unwrap_or(0),
                },
                scene_tag: self.last_scene_tag.clone(),
                queue_token: t,
            },
            _ => match &self.scene {
                SceneRuntime::Investigation(inv) => match &inv.current_sublocation_id {
                    Some(sub_id) => ModeView::Explore { sublocation_id: sub_id.clone() },
                    None => ModeView::GameComplete,  // shouldn't happen in normal flow
                },
                SceneRuntime::Linear(_) => ModeView::GameComplete,  // linear has no Explore mode
            },
        }
    }

    fn chapter_view(&self) -> ChapterView {
        let c = &self.chapters[self.current_chapter_idx.min(self.chapters.len() - 1)];
        ChapterView {
            id: c.id.clone(),
            title: c.title.clone(),
            summary: c.summary.clone(),
            index: self.current_chapter_idx,
            total: self.chapters.len(),
        }
    }

    fn scene_view(&self) -> SceneView {
        let total = self.chapters[self.current_chapter_idx.min(self.chapters.len() - 1)].scenes.len();
        match &self.scene {
            SceneRuntime::Linear(s) => SceneView::Linear {
                id: s.id.clone(),
                title: s.title.clone(),
                index: self.current_scene_idx,
                total,
            },
            SceneRuntime::Investigation(inv) => {
                let visible_sublocations: Vec<SublocationView> = inv
                    .def
                    .sublocations
                    .iter()
                    .filter(|s| inv.is_block_unlocked(&format!("sublocation:{}", s.id), s.status, s.unlock.as_ref()))
                    .map(|s| SublocationView {
                        id: s.id.clone(),
                        scene_tag: s.scene_tag.clone(),
                        hotspots: s.hotspots.iter()
                            .filter(|h| inv.is_block_unlocked(&format!("hotspot:{}", h.id), h.status, h.unlock.as_ref()))
                            .map(|h| HotspotView {
                                id: h.id.clone(),
                                label: h.label.clone(),
                                description: h.description.clone(),
                                inspected: inv.inspected_hotspots.contains(&h.id),
                            }).collect(),
                        characters: s.characters.iter().map(|c| CharacterView {
                            id: c.id.clone(),
                            name: c.name.clone(),
                            role: c.role.clone(),
                            bio: c.bio.clone(),
                            topics: c.topics.iter()
                                .filter(|t| inv.is_block_unlocked(&format!("topic:{}@{}", c.id, t.id), t.status, t.unlock.as_ref()))
                                .map(|t| TopicView {
                                    id: t.id.clone(),
                                    label: t.label.clone(),
                                    discussed: inv.discussed_topics.contains(&(c.id.clone(), t.id.clone())),
                                }).collect(),
                        }).collect(),
                    }).collect();

                SceneView::Investigation {
                    id: inv.def.id.clone(),
                    title: inv.def.title.clone(),
                    index: self.current_scene_idx,
                    total,
                    current_sublocation_id: inv.current_sublocation_id.clone(),
                    visible_sublocations,
                }
            }
        }
    }
}

fn load_scene_runtime(
    resources_dir: &std::path::Path,
    scene_ref: &SceneRef,
    queue_gen: u64,
) -> Result<SceneRuntime, GameError> {
    let json = loader::load_scene(resources_dir, &scene_ref.file)?;
    Ok(match json {
        SceneJson::Linear(j) => SceneRuntime::Linear(LinearSceneState::from_json(j, queue_gen)),
        SceneJson::Investigation(j) => SceneRuntime::Investigation(InvestigationSceneState::from_json(j)),
    })
}

/// Combined UnlockContext that merges scene state with inventory.
struct SceneAndInventoryCtx<'a> {
    scene: &'a InvestigationSceneState,
    inventory: &'a Inventory,
}
impl<'a> unlock::UnlockContext for SceneAndInventoryCtx<'a> {
    fn evidence_collected(&self, id: &str) -> bool { self.inventory.has_evidence(id) }
    fn statement_acquired(&self, id: &str) -> bool { self.inventory.has_statement(id) }
    fn topic_discussed(&self, c: &str, t: &str) -> bool { self.scene.topic_discussed(c, t) }
    fn hotspot_investigated(&self, id: &str) -> bool { self.scene.hotspot_investigated(id) }
}
```

- [ ] **Step 2: Verify it compiles — expect borrow-checker iteration**

```bash
cd src-tauri && cargo check && cd ..
```

**Expected:** the borrow checker will reject several methods because they try to mutate `&mut self.scene` while simultaneously reading from `&self.inventory` (used to build `SceneAndInventoryCtx`) or while holding an immutable borrow into the scene's `def`. This is the most common Rust friction with state machines that have nested mutable+immutable accesses.

The fix pattern is **always the same: three-phase mutation**:

```rust
// Phase 1 — read: clone or extract everything you need out of &self, holding only short-lived shared borrows.
let (data_a, data_b) = match &self.scene { ... };
// Phase 2 — compute: invoke &self methods (alloc_queue_gen, etc.) that need exclusive access.
let queue_gen = self.alloc_queue_gen();
// Phase 3 — write: re-borrow &mut self.scene and mutate using the values from Phases 1 & 2.
if let SceneRuntime::Investigation(inv) = &mut self.scene {
    inv.pending_queue = Some(DialogueQueue { items: data_a, cursor: 0, queue_gen });
    inv.current_sublocation_id = Some(data_b);
}
```

The two methods most likely to need this restructure: `try_advance_investigation` and `advance_into_first_sublocation`. Each method's logic stays the same; the layout changes.

Iterate `cargo check` until it passes. Then run unit tests to make sure nothing regressed:

```bash
cd src-tauri && cargo test --lib && cd ..
```

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/game/mod.rs
git commit -m "feat(engine): GameEngine orchestrator — mode machine + commands"
```

---

## Phase B7: Tauri commands

### Task 13: Wire up Tauri commands in `lib.rs`

**Files:**
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Replace `lib.rs` with the full command surface**

```rust
pub mod game;

use std::sync::Mutex;
use tauri::Manager;
use tauri::path::BaseDirectory;

use game::{GameEngine, GameError, GameStateView, QueueToken};

struct AppState {
    engine: Mutex<Option<GameEngine>>,
}

fn unavailable_error() -> GameError {
    GameError::unavailable()
}

#[tauri::command]
fn start_game(app: tauri::AppHandle, state: tauri::State<'_, AppState>) -> Result<GameStateView, GameError> {
    let resources_dir = app
        .path()
        .resolve("scenes", BaseDirectory::Resource)
        .map_err(|e| GameError::scene_load_failed(format!("cannot resolve resources dir: {e}")))?;
    let engine = GameEngine::new_started(resources_dir)?;
    let mut guard = state.engine.lock().map_err(|_| unavailable_error())?;
    let view = engine.view();
    *guard = Some(engine);
    Ok(view)
}

#[tauri::command]
fn reset_game(app: tauri::AppHandle, state: tauri::State<'_, AppState>) -> Result<GameStateView, GameError> {
    // Reset is implemented as start_game over the same Mutex slot.
    start_game(app, state)
}

#[tauri::command]
fn get_state(state: tauri::State<'_, AppState>) -> Result<GameStateView, GameError> {
    let guard = state.engine.lock().map_err(|_| unavailable_error())?;
    guard.as_ref().map(|e| e.view()).ok_or_else(GameError::game_not_started)
}

#[tauri::command]
fn advance_dialogue(state: tauri::State<'_, AppState>, expected: QueueToken) -> Result<GameStateView, GameError> {
    let mut guard = state.engine.lock().map_err(|_| unavailable_error())?;
    let engine = guard.as_mut().ok_or_else(GameError::game_not_started)?;
    engine.advance_dialogue(expected)
}

#[tauri::command]
fn inspect_hotspot(state: tauri::State<'_, AppState>, hotspot_id: String) -> Result<GameStateView, GameError> {
    let mut guard = state.engine.lock().map_err(|_| unavailable_error())?;
    let engine = guard.as_mut().ok_or_else(GameError::game_not_started)?;
    engine.inspect_hotspot(&hotspot_id)
}

#[tauri::command]
fn interview_topic(state: tauri::State<'_, AppState>, character_id: String, topic_id: String) -> Result<GameStateView, GameError> {
    let mut guard = state.engine.lock().map_err(|_| unavailable_error())?;
    let engine = guard.as_mut().ok_or_else(GameError::game_not_started)?;
    engine.interview_topic(&character_id, &topic_id)
}

#[tauri::command]
fn enter_sublocation(state: tauri::State<'_, AppState>, sublocation_id: String) -> Result<GameStateView, GameError> {
    let mut guard = state.engine.lock().map_err(|_| unavailable_error())?;
    let engine = guard.as_mut().ok_or_else(GameError::game_not_started)?;
    engine.enter_sublocation(&sublocation_id)
}

#[tauri::command]
fn reexamine_evidence(state: tauri::State<'_, AppState>, evidence_id: String) -> Result<GameStateView, GameError> {
    let mut guard = state.engine.lock().map_err(|_| unavailable_error())?;
    let engine = guard.as_mut().ok_or_else(GameError::game_not_started)?;
    engine.reexamine_evidence(&evidence_id)
}

#[tauri::command]
fn reexamine_statement(state: tauri::State<'_, AppState>, statement_id: String) -> Result<GameStateView, GameError> {
    let mut guard = state.engine.lock().map_err(|_| unavailable_error())?;
    let engine = guard.as_mut().ok_or_else(GameError::game_not_started)?;
    engine.reexamine_statement(&statement_id)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(AppState { engine: Mutex::new(None) })
        .invoke_handler(tauri::generate_handler![
            start_game,
            reset_game,
            get_state,
            advance_dialogue,
            inspect_hotspot,
            interview_topic,
            enter_sublocation,
            reexamine_evidence,
            reexamine_statement,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

- [ ] **Step 2: Verify it builds**

```bash
cd src-tauri && cargo check && cargo test --lib && cd ..
```

Expected: builds; all per-module tests still pass.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "feat(engine): wire all Tauri commands + AppState"
```

---

## Phase B8: Integration test

### Task 14: Write the full-playthrough integration test

**Files:**
- Create: `src-tauri/tests/full_playthrough.rs`
- The test depends on Plan A's compile script having been run against a fixture chapter. We'll generate the fixture JSON in the test setup using `bun run`.

- [ ] **Step 1: Generate fixture JSON for the test**

The integration test needs JSON to load. The cleanest way: have the test compile the fixture corpus at the start using `bun run scripts/compile-scenes.ts` against a fixture root.

Add a script under `src-tauri/tests/fixtures/` that the test references:

```bash
mkdir -p src-tauri/tests/fixtures
# Copy the same minimal fixture from Plan A
cp -r ../scripts/__fixtures__/valid/chapter_1 src-tauri/tests/fixtures/
# Pre-compile it (run from the repo root once before running tests)
```

Actually, doing this inside a `cargo test` run is messy because `cargo test` doesn't have a way to invoke `bun`. The cleaner approach: commit a pre-compiled JSON corpus next to the test under `src-tauri/tests/fixtures/scenes/`.

```bash
# From the repo root:
bun run scripts/compile-scenes.ts  # This will fail against the real chapter_1 — that's OK for now.
# Instead, run the orchestrator pointed at the fixture:
bun --eval 'import("./scripts/compile-scenes/orchestrator.ts").then((m) => {
  const r = m.compile({ sourceRoot: "scripts/__fixtures__/valid", outputRoot: "src-tauri/tests/fixtures/scenes" });
  console.log(r);
})'
```

After this command runs, `src-tauri/tests/fixtures/scenes/` contains the compiled fixture JSON. Commit it.

Then the integration test points at this fixed path.

- [ ] **Step 2: Write the integration test**

Create `src-tauri/tests/full_playthrough.rs`:

```rust
// Integration test that exercises the full mode machine on the fixture corpus.
// Resources dir is hard-coded to src-tauri/tests/fixtures/scenes (committed).

use std::path::PathBuf;

// We need access to game::*, which is crate-private. To test from outside,
// the crate's root must re-export it. Confirm that lib.rs has `mod game;`
// without `pub mod game;` and that integration tests can reach it via the
// `lyra_lib::game::*` path — Tauri's crate name from Cargo.toml.

use lyra_lib::game::{GameEngine, GameStateView, QueueToken};
use lyra_lib::game::view::ModeView;

fn fixture_resources() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/scenes")
}

fn token_from(view: &GameStateView) -> QueueToken {
    match &view.mode {
        ModeView::Dialogue { queue_token, .. } => queue_token.clone(),
        _ => panic!("expected Dialogue mode, got: {:?}", view.mode),
    }
}

#[test]
fn full_playthrough_starts_at_dialogue_with_intro() {
    let mut engine = GameEngine::new_started(fixture_resources()).unwrap();
    let view = engine.view();
    matches!(view.mode, ModeView::Dialogue { .. });
}

#[test]
fn advance_dialogue_is_idempotent_under_stale_token() {
    let mut engine = GameEngine::new_started(fixture_resources()).unwrap();
    let initial = engine.view();
    let token = token_from(&initial);

    // First advance — consumes one item.
    let v1 = engine.advance_dialogue(token.clone()).unwrap();

    // Second advance with the SAME token — engine sees stale, returns current state, no change.
    let v2 = engine.advance_dialogue(token).unwrap();

    // v1 and v2 should be at the same cursor position.
    let t1 = token_from(&v1);
    let t2 = token_from(&v2);
    assert_eq!(t1, t2);
}
```

For this to compile, you must either:
- (a) Tauri's lib crate name is configured as `lyra_lib` per `src-tauri/Cargo.toml`'s `name = "lyra_lib"` (CLAUDE.md mentions `_lib` suffix). Check `Cargo.toml`.
- (b) Add `pub` to `mod game;` in `lib.rs` so integration tests can reach it.

Verify by reading `src-tauri/Cargo.toml`:

```bash
cat src-tauri/Cargo.toml
```

If the lib name is `lyra_lib`, the integration test imports `lyra_lib::game::*`. If not, adjust accordingly.

- [ ] **Step 3: Run the integration test**

```bash
cd src-tauri && cargo test --test full_playthrough && cd ..
```

Expected: both tests PASS. If the import path is wrong, fix it; if borrow-checker issues surface in `mod.rs`, iterate.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/tests/fixtures/ src-tauri/tests/full_playthrough.rs
git commit -m "test(engine): integration test (start, advance, idempotency)"
```

---

## Phase B9: Frontend types + game client

### Task 15: Define frontend TS types mirroring the Rust GameStateView

**Files:**
- Create: `src/lib/state/types.ts`

- [ ] **Step 1: Create the file**

```typescript
// src/lib/state/types.ts
// Mirrors the Rust GameStateView via Tauri's invoke() serialization.

export type DialogueItem =
  | { kind: "sceneTag"; text: string }
  | { kind: "action"; text: string }
  | { kind: "line"; speaker: string; text: string };

export type QueueToken = {
  sceneId: string;
  queueGen: number;
  cursor: number;
};

export type Mode =
  | { type: "dialogue"; current: DialogueItem; queueRemaining: number; sceneTag: string | null; queueToken: QueueToken }
  | { type: "explore"; sublocationId: string }
  | { type: "gameComplete" };

export type ChapterView = {
  id: string;
  title: string;
  summary: string;
  index: number;
  total: number;
};

export type HotspotView = {
  id: string;
  label: string;
  description: string;
  inspected: boolean;
};
export type TopicView = {
  id: string;
  label: string;
  discussed: boolean;
};
export type CharacterView = {
  id: string;
  name: string;
  role: string;
  bio: string;
  topics: TopicView[];
};
export type SublocationView = {
  id: string;
  sceneTag: string;
  hotspots: HotspotView[];
  characters: CharacterView[];
};

export type SceneView =
  | { kind: "linear"; id: string; title: string; index: number; total: number }
  | {
      kind: "investigation";
      id: string;
      title: string;
      index: number;
      total: number;
      currentSublocationId: string | null;
      visibleSublocations: SublocationView[];
    };

export type EvidenceRecord = {
  id: string;
  name: string;
  description: string;
  details: string;
  onReexamine: DialogueItem[] | null;
  collectedInChapterId: string;
  collectedInSceneId: string;
};
export type StatementRecord = {
  id: string;
  speaker: string;
  content: string;
  onReexamine: DialogueItem[] | null;
  acquiredInChapterId: string;
  acquiredInSceneId: string;
};
export type Inventory = {
  evidence: EvidenceRecord[];
  statements: StatementRecord[];
};

export type GameStateView = {
  mode: Mode;
  chapter: ChapterView;
  scene: SceneView;
  inventory: Inventory;
};

export type GameError = {
  code: string;
  message: string;
};
```

- [ ] **Step 2: Verify types check**

```bash
bun run check
```

Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add src/lib/state/types.ts
git commit -m "feat(ui): TS types mirroring Rust GameStateView"
```

---

### Task 16: Implement `game-client.ts` — invoke wrappers + state store

**Files:**
- Create: `src/lib/state/game-client.ts`

- [ ] **Step 1: Create the file**

```typescript
// src/lib/state/game-client.ts
import { invoke } from "@tauri-apps/api/core";
import type { GameError, GameStateView, QueueToken } from "./types";

export const gameState = $state<{ value: GameStateView | null; error: string | null; loading: boolean; inFlight: boolean }>({
  value: null,
  error: null,
  loading: true,
  inFlight: false,
});

function normalizeError(error: unknown): string {
  if (error && typeof error === "object" && "message" in error) return String((error as GameError).message);
  if (typeof error === "string") return error;
  return "Game command failed.";
}

async function runCommand<T>(command: string, args?: Record<string, unknown>): Promise<T | null> {
  gameState.error = null;
  try {
    return await invoke<T>(command, args);
  } catch (e) {
    gameState.error = normalizeError(e);
    return null;
  }
}

export async function startGame() {
  gameState.loading = true;
  const v = await runCommand<GameStateView>("start_game");
  if (v) gameState.value = v;
  gameState.loading = false;
}

export async function resetGame() {
  gameState.loading = true;
  const v = await runCommand<GameStateView>("reset_game");
  if (v) gameState.value = v;
  gameState.loading = false;
}

export async function advanceDialogue(expected: QueueToken) {
  if (gameState.inFlight) return;
  gameState.inFlight = true;
  try {
    const v = await runCommand<GameStateView>("advance_dialogue", { expected });
    if (v) gameState.value = v;
  } finally {
    gameState.inFlight = false;
  }
}

export async function inspectHotspot(hotspotId: string) {
  const v = await runCommand<GameStateView>("inspect_hotspot", { hotspotId });
  if (v) gameState.value = v;
}
export async function interviewTopic(characterId: string, topicId: string) {
  const v = await runCommand<GameStateView>("interview_topic", { characterId, topicId });
  if (v) gameState.value = v;
}
export async function enterSublocation(sublocationId: string) {
  const v = await runCommand<GameStateView>("enter_sublocation", { sublocationId });
  if (v) gameState.value = v;
}
export async function reexamineEvidence(evidenceId: string) {
  const v = await runCommand<GameStateView>("reexamine_evidence", { evidenceId });
  if (v) gameState.value = v;
}
export async function reexamineStatement(statementId: string) {
  const v = await runCommand<GameStateView>("reexamine_statement", { statementId });
  if (v) gameState.value = v;
}
```

- [ ] **Step 2: Verify it checks**

```bash
bun run check
```

Expected: passes. (If the `$state` usage at module level isn't allowed, the alternative is a class-based store. Svelte 5 supports module-level `$state` in `.ts` files via the Svelte plugin.)

- [ ] **Step 3: Commit**

```bash
git add src/lib/state/game-client.ts
git commit -m "feat(ui): game-client (invoke wrappers + module-level state store)"
```

---

## Phase B10: UI components (leaves)

### Task 17: Implement `SceneBackdrop.svelte`

**Files:**
- Create: `src/lib/components/SceneBackdrop.svelte`

- [ ] **Step 1: Create the component**

```svelte
<script lang="ts">
  let { sceneTag }: { sceneTag: string | null } = $props();
</script>

{#if sceneTag}
  <div class="backdrop">
    <span class="tag">場景：{sceneTag}</span>
  </div>
{/if}

<style>
  .backdrop {
    padding: 12px 24px;
    background: linear-gradient(180deg, #0d1117 0%, #1a1f2a 100%);
    color: #d0d7de;
    border-bottom: 1px solid #30363d;
  }
  .tag {
    font-size: 0.85rem;
    font-style: italic;
    opacity: 0.85;
  }
</style>
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/components/SceneBackdrop.svelte
git commit -m "feat(ui): SceneBackdrop component (renders scene tag caption)"
```

---

### Task 18: Implement `DialogueBox.svelte`

**Files:**
- Create: `src/lib/components/DialogueBox.svelte`

- [ ] **Step 1: Create the component**

```svelte
<script lang="ts">
  import type { DialogueItem, QueueToken } from "../state/types";

  let { current, queueToken, onAdvance }: {
    current: DialogueItem;
    queueToken: QueueToken;
    onAdvance: (t: QueueToken) => void;
  } = $props();

  function handleClick() {
    onAdvance(queueToken);
  }
  function handleKey(e: KeyboardEvent) {
    if (e.repeat) return;
    if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      onAdvance(queueToken);
    }
  }
</script>

<svelte:window onkeydown={handleKey} />

<button class="box" onclick={handleClick} type="button" aria-label="Advance dialogue">
  {#if current.kind === "sceneTag"}
    <!-- sceneTag is consumed silently by SceneBackdrop; we still show the click target for advance -->
    <span class="placeholder">（場景切換）</span>
  {:else if current.kind === "action"}
    <p class="action">{current.text}</p>
  {:else if current.kind === "line"}
    <div class="line">
      <span class="speaker">{current.speaker}</span>
      <p class="text">{current.text}</p>
    </div>
  {/if}
  <span class="hint">點擊或按 Space ▶</span>
</button>

<style>
  .box {
    position: fixed;
    left: 50%;
    bottom: 32px;
    transform: translateX(-50%);
    min-width: 60ch;
    max-width: 80ch;
    padding: 24px 28px 32px;
    background: rgba(13, 17, 23, 0.95);
    color: #e6edf3;
    border: 1px solid #30363d;
    border-radius: 12px;
    text-align: left;
    cursor: pointer;
    font: inherit;
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.4);
  }
  .box:hover { border-color: #58a6ff; }
  .speaker { font-weight: 700; color: #58a6ff; display: block; margin-bottom: 6px; }
  .text { margin: 0; line-height: 1.6; }
  .action { margin: 0; font-style: italic; color: #8b949e; text-align: center; }
  .placeholder { color: #8b949e; font-style: italic; }
  .hint { position: absolute; right: 14px; bottom: 8px; font-size: 0.75rem; color: #8b949e; }
</style>
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/components/DialogueBox.svelte
git commit -m "feat(ui): DialogueBox component (VN-style, click/Space to advance)"
```

---

### Task 19: Implement `SublocationNav.svelte`

**Files:**
- Create: `src/lib/components/SublocationNav.svelte`

- [ ] **Step 1: Create the component**

```svelte
<script lang="ts">
  import type { SublocationView } from "../state/types";

  let {
    sublocations,
    currentId,
    onEnter,
  }: {
    sublocations: SublocationView[];
    currentId: string | null;
    onEnter: (id: string) => void;
  } = $props();
</script>

<nav class="nav">
  {#each sublocations as sub}
    <button
      class:active={sub.id === currentId}
      onclick={() => onEnter(sub.id)}
      type="button"
    >
      {sub.id}
    </button>
  {/each}
</nav>

<style>
  .nav { display: flex; gap: 8px; padding: 12px 24px; }
  button {
    padding: 8px 14px; border: 1px solid #30363d; border-radius: 999px;
    background: #161b22; color: #d0d7de; cursor: pointer; font: inherit;
  }
  button.active { border-color: #58a6ff; background: #0c2d6b; }
</style>
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/components/SublocationNav.svelte
git commit -m "feat(ui): SublocationNav (unlocked sub-location chips)"
```

---

### Task 20: Implement `HotspotGrid.svelte`

**Files:**
- Create: `src/lib/components/HotspotGrid.svelte`

- [ ] **Step 1: Create the component**

```svelte
<script lang="ts">
  import type { HotspotView } from "../state/types";
  let { hotspots, onInspect }: { hotspots: HotspotView[]; onInspect: (id: string) => void } = $props();
</script>

<section class="grid">
  {#each hotspots as h}
    <button class:done={h.inspected} type="button" onclick={() => onInspect(h.id)}>
      <strong>{h.label}</strong>
      <small>{h.description}</small>
    </button>
  {/each}
</section>

<style>
  .grid {
    display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: 12px; padding: 12px 24px;
  }
  button {
    text-align: left; padding: 14px; background: #161b22; color: #e6edf3;
    border: 1px solid #30363d; border-radius: 10px; cursor: pointer; font: inherit;
  }
  button:hover { border-color: #58a6ff; }
  button.done { opacity: 0.75; }
  strong { display: block; margin-bottom: 6px; }
  small { color: #8b949e; }
</style>
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/components/HotspotGrid.svelte
git commit -m "feat(ui): HotspotGrid component"
```

---

### Task 21: Implement `CharacterList.svelte`

**Files:**
- Create: `src/lib/components/CharacterList.svelte`

- [ ] **Step 1: Create the component**

```svelte
<script lang="ts">
  import type { CharacterView } from "../state/types";
  let { characters, onInterview }: { characters: CharacterView[]; onInterview: (cId: string, tId: string) => void } = $props();
</script>

{#if characters.length > 0}
  <section class="list">
    {#each characters as c}
      <article>
        <header>
          <strong>{c.name}</strong>
          <small>{c.role}</small>
        </header>
        <p class="bio">{c.bio}</p>
        <div class="topics">
          {#each c.topics as t}
            <button class:done={t.discussed} type="button" onclick={() => onInterview(c.id, t.id)}>
              • {t.label}
            </button>
          {/each}
        </div>
      </article>
    {/each}
  </section>
{/if}

<style>
  .list { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 16px; padding: 12px 24px; }
  article { background: #161b22; border: 1px solid #30363d; border-radius: 10px; padding: 14px; color: #e6edf3; }
  header strong { display: block; }
  header small { color: #8b949e; }
  .bio { margin: 8px 0 12px; color: #c9d1d9; font-size: 0.9rem; }
  .topics { display: flex; flex-direction: column; gap: 6px; }
  .topics button {
    text-align: left; padding: 8px 10px; background: #0d1117; border: 1px solid #30363d;
    border-radius: 6px; color: #d0d7de; cursor: pointer; font: inherit;
  }
  .topics button:hover { border-color: #58a6ff; }
  .topics button.done { opacity: 0.7; }
</style>
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/components/CharacterList.svelte
git commit -m "feat(ui): CharacterList component (with nested topic buttons)"
```

---

### Task 22: Implement `InventoryPanel.svelte`

**Files:**
- Create: `src/lib/components/InventoryPanel.svelte`

- [ ] **Step 1: Create the component**

```svelte
<script lang="ts">
  import type { Inventory } from "../state/types";
  let { inventory, onReexamineEvidence, onReexamineStatement }: {
    inventory: Inventory;
    onReexamineEvidence: (id: string) => void;
    onReexamineStatement: (id: string) => void;
  } = $props();
  let open = $state(false);
</script>

<aside class:open>
  <button class="toggle" type="button" onclick={() => (open = !open)}>
    📋 {open ? "Hide" : "Inventory"} ({inventory.evidence.length}/{inventory.statements.length})
  </button>
  {#if open}
    <div class="panel">
      <section>
        <h3>證物 ({inventory.evidence.length})</h3>
        {#if inventory.evidence.length === 0}
          <p class="empty">尚未收集。</p>
        {/if}
        {#each inventory.evidence as e}
          <button type="button" onclick={() => onReexamineEvidence(e.id)}>
            <strong>{e.name}</strong>
            <small>{e.description}</small>
          </button>
        {/each}
      </section>
      <section>
        <h3>證言 ({inventory.statements.length})</h3>
        {#if inventory.statements.length === 0}
          <p class="empty">尚未取得。</p>
        {/if}
        {#each inventory.statements as s}
          <button type="button" onclick={() => onReexamineStatement(s.id)}>
            <strong>{s.speaker}</strong>
            <small>{s.content}</small>
          </button>
        {/each}
      </section>
    </div>
  {/if}
</aside>

<style>
  aside { position: fixed; top: 24px; right: 24px; width: 320px; }
  .toggle { padding: 8px 14px; background: #161b22; color: #e6edf3; border: 1px solid #30363d; border-radius: 999px; cursor: pointer; font: inherit; }
  .panel { margin-top: 8px; padding: 14px; background: #0d1117; border: 1px solid #30363d; border-radius: 10px; max-height: 70vh; overflow-y: auto; }
  h3 { margin: 12px 0 8px; color: #e6edf3; font-size: 0.9rem; }
  section button { display: block; width: 100%; text-align: left; padding: 8px 10px; margin-bottom: 6px; background: #161b22; border: 1px solid #30363d; border-radius: 6px; color: #d0d7de; cursor: pointer; font: inherit; }
  section button:hover { border-color: #58a6ff; }
  section button strong { display: block; color: #58a6ff; }
  section button small { color: #8b949e; }
  .empty { color: #8b949e; font-size: 0.85rem; }
</style>
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/components/InventoryPanel.svelte
git commit -m "feat(ui): InventoryPanel (collapsible drawer with reexamine triggers)"
```

---

### Task 23: Implement `ErrorBanner.svelte` and `GameComplete.svelte`

**Files:**
- Create: `src/lib/components/ErrorBanner.svelte`
- Create: `src/lib/components/GameComplete.svelte`

- [ ] **Step 1: Create both small components**

```svelte
<!-- src/lib/components/ErrorBanner.svelte -->
<script lang="ts">
  let { message }: { message: string } = $props();
</script>

<p class="banner" role="alert">{message}</p>

<style>
  .banner { margin: 16px; padding: 12px 14px; border-radius: 6px; color: #ffa198; background: #67060c; border: 1px solid #f85149; }
</style>
```

```svelte
<!-- src/lib/components/GameComplete.svelte -->
<script lang="ts">
  let { onReset }: { onReset: () => void } = $props();
</script>

<section class="complete">
  <h1>第零證人</h1>
  <p>調查結束。</p>
  <button onclick={onReset} type="button">重新開始</button>
</section>

<style>
  .complete { display: grid; place-items: center; min-height: 60vh; gap: 16px; color: #e6edf3; text-align: center; }
  button { padding: 10px 22px; background: #58a6ff; color: #0d1117; border: 0; border-radius: 8px; cursor: pointer; font: inherit; font-weight: 700; }
</style>
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/components/ErrorBanner.svelte src/lib/components/GameComplete.svelte
git commit -m "feat(ui): ErrorBanner + GameComplete small components"
```

---

## Phase B11: Composite components + page shell

### Task 24: Implement `ExploreView.svelte`

**Files:**
- Create: `src/lib/components/ExploreView.svelte`

- [ ] **Step 1: Create the component**

```svelte
<script lang="ts">
  import type { SceneView } from "../state/types";
  import SublocationNav from "./SublocationNav.svelte";
  import HotspotGrid from "./HotspotGrid.svelte";
  import CharacterList from "./CharacterList.svelte";

  let {
    scene,
    onInspect,
    onInterview,
    onEnterSublocation,
  }: {
    scene: SceneView;
    onInspect: (id: string) => void;
    onInterview: (cId: string, tId: string) => void;
    onEnterSublocation: (id: string) => void;
  } = $props();

  // Type guard.
  let inv = $derived(scene.kind === "investigation" ? scene : null);
  let currentSub = $derived(
    inv?.visibleSublocations.find((s) => s.id === inv.currentSublocationId) ?? null,
  );
</script>

{#if inv && currentSub}
  <SublocationNav
    sublocations={inv.visibleSublocations}
    currentId={inv.currentSublocationId}
    onEnter={onEnterSublocation}
  />
  <HotspotGrid hotspots={currentSub.hotspots} {onInspect} />
  <CharacterList characters={currentSub.characters} {onInterview} />
{:else if inv}
  <p class="muted">尚未進入任何地點。</p>
{/if}

<style>
  .muted { padding: 24px; color: #8b949e; }
</style>
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/components/ExploreView.svelte
git commit -m "feat(ui): ExploreView composite (nav + hotspots + characters)"
```

---

### Task 25: Implement `GameShell.svelte`

**Files:**
- Create: `src/lib/components/GameShell.svelte`

- [ ] **Step 1: Create the component**

```svelte
<script lang="ts">
  import type { Snippet } from "svelte";
  import type { GameStateView } from "../state/types";

  let {
    gameState,
    onReset,
    children,
  }: {
    gameState: GameStateView;
    onReset: () => void;
    children: Snippet;
  } = $props();
</script>

<header>
  <div>
    <small class="eyebrow">第 {gameState.chapter.index + 1} 章 / {gameState.chapter.total}</small>
    <h1>{gameState.chapter.title}</h1>
    <p class="summary">{gameState.chapter.summary}</p>
  </div>
  <button type="button" onclick={onReset}>重新開始</button>
</header>

{@render children()}

<style>
  header {
    display: flex; align-items: flex-start; justify-content: space-between;
    padding: 24px; border-bottom: 1px solid #30363d; background: #0d1117; color: #e6edf3;
  }
  .eyebrow { color: #58a6ff; font-size: 0.75rem; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; }
  h1 { margin: 4px 0 6px; font-size: 1.4rem; }
  .summary { margin: 0; color: #8b949e; max-width: 600px; }
  header > button {
    padding: 8px 14px; background: transparent; color: #d0d7de;
    border: 1px solid #30363d; border-radius: 6px; cursor: pointer; font: inherit;
  }
  header > button:hover { border-color: #58a6ff; }
</style>
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/components/GameShell.svelte
git commit -m "feat(ui): GameShell (top header + reset button + children slot)"
```

---

### Task 26: Replace `src/routes/+page.svelte` with the new mode-driven shell

**Files:**
- Replace: `src/routes/+page.svelte`

- [ ] **Step 1: Overwrite the file**

```svelte
<script lang="ts">
  import { onMount } from "svelte";
  import {
    gameState,
    startGame,
    resetGame,
    advanceDialogue,
    inspectHotspot,
    interviewTopic,
    enterSublocation,
    reexamineEvidence,
    reexamineStatement,
  } from "$lib/state/game-client";
  import DialogueBox from "$lib/components/DialogueBox.svelte";
  import ExploreView from "$lib/components/ExploreView.svelte";
  import SceneBackdrop from "$lib/components/SceneBackdrop.svelte";
  import GameShell from "$lib/components/GameShell.svelte";
  import InventoryPanel from "$lib/components/InventoryPanel.svelte";
  import ErrorBanner from "$lib/components/ErrorBanner.svelte";
  import GameComplete from "$lib/components/GameComplete.svelte";

  onMount(() => {
    void startGame();
  });
</script>

{#if gameState.loading}
  <main><p class="status">Loading…</p></main>
{:else if gameState.value}
  <GameShell gameState={gameState.value} onReset={resetGame}>
    {#if gameState.error}
      <ErrorBanner message={gameState.error} />
    {/if}
    {#if gameState.value.mode.type === "dialogue"}
      <SceneBackdrop sceneTag={gameState.value.mode.sceneTag} />
      <DialogueBox
        current={gameState.value.mode.current}
        queueToken={gameState.value.mode.queueToken}
        onAdvance={advanceDialogue}
      />
    {:else if gameState.value.mode.type === "explore"}
      <ExploreView
        scene={gameState.value.scene}
        onInspect={inspectHotspot}
        onInterview={interviewTopic}
        onEnterSublocation={enterSublocation}
      />
    {:else if gameState.value.mode.type === "gameComplete"}
      <GameComplete onReset={resetGame} />
    {/if}
    <InventoryPanel
      inventory={gameState.value.inventory}
      onReexamineEvidence={reexamineEvidence}
      onReexamineStatement={reexamineStatement}
    />
  </GameShell>
{:else if gameState.error}
  <main>
    <ErrorBanner message={gameState.error} />
    <button onclick={startGame} type="button">Retry</button>
  </main>
{/if}

<style>
  :global(body) {
    margin: 0;
    background: #0d1117;
    color: #e6edf3;
    font-family: Inter, system-ui, -apple-system, sans-serif;
    min-height: 100vh;
  }
  .status { padding: 32px; color: #8b949e; }
</style>
```

- [ ] **Step 2: Verify TypeScript checks**

```bash
bun run check
```

Expected: passes. Iterate on any type mismatches.

- [ ] **Step 3: Commit**

```bash
git add src/routes/+page.svelte
git commit -m "feat(ui): replace page with mode-driven shell"
```

---

## Phase B12: Port real content

### Task 27: Author `chapter_1/chapter.md`

**Files:**
- Create: `static/stories_plan/chapter_1/chapter.md`

- [ ] **Step 1: Create the file**

```markdown
# Chapter 1: 雨鐘咖啡館殺人事件

**Summary:** 律師相馬律與早坂茜在深夜的雨鐘咖啡館，調查若槻蓮被指控殺害增田圭的命案。

## Scenes
1. scene_0.md
2. investigation_scene_1.md
```

- [ ] **Step 2: Commit**

```bash
git add static/stories_plan/chapter_1/chapter.md
git commit -m "content(ch1): author chapter manifest"
```

---

### Task 28: Port `scene_0.md` to finalized linear-scene format

**Files:**
- Modify: `static/stories_plan/chapter_1/scene_0.md`

- [ ] **Step 1: Audit the existing file**

```bash
head -40 static/stories_plan/chapter_1/scene_0.md
```

The existing file may already be close to the format from Plan A Task 2's `writing-detective-game-dialogue` linear-scene section. Check:
- Exactly one H1 at the top
- No H2+ headings anywhere
- Every dialogue line is `**Name**：text` with full-width colon
- Every scene change has a `[場景：...]` tag

- [ ] **Step 2: Fix violations**

If any H2+ headings exist, either restructure (move that beat into a new linear scene file) or remove the heading. If any half-width colons appear in dialogue, convert them.

- [ ] **Step 3: Verify by compiling**

```bash
bun run scenes:compile
```

If the compile fails, iterate. If it succeeds, scene_0.md is ported.

- [ ] **Step 4: Commit**

```bash
git add static/stories_plan/chapter_1/scene_0.md
git commit -m "content(ch1): port scene_0 to linear-scene format"
```

---

### Task 29: Port `investigation_scene_1.md` to finalized investigation-scene format

**Files:**
- Modify: `static/stories_plan/chapter_1/investigation_scene_1.md`

This is the heavy task — the existing 967-line file uses the old schema. It needs:
- Hotspots/Topics to optionally gain `#### On Reexamine` blocks.
- The Outro at the end to declare an explicit `**Unlock:**` predicate (or be acceptable as `"auto"`).
- All locked blocks to have either inbound `Reveals` OR a self `Unlock`, never both.
- All `Reveals:` / `Unlock:` IDs to resolve within this file.

- [ ] **Step 1: Read the existing file end-to-end**

```bash
cat static/stories_plan/chapter_1/investigation_scene_1.md | head -200
```

Then continue reading in chunks.

- [ ] **Step 2: Audit against the §3d validation rules**

Specifically check:
- Every `Reveals:` target's ID matches an anchor declared somewhere in this file.
- Every `Unlock:` predicate's ID matches an anchor declared somewhere in this file.
- The Outro at the very bottom has an explicit `**Unlock:**` if the auto-completion behavior isn't appropriate.

- [ ] **Step 3: Apply fixes**

Make narrative-preserving edits to satisfy validator rules. Where existing locked blocks have only a vague "complete enough investigation" intent, choose either an explicit `Unlock:` predicate or rely on inbound `Reveals` from a hotspot. Prefer inbound `Reveals` for simple unlock chains.

- [ ] **Step 4: Compile to verify**

```bash
bun run scenes:compile
```

Iterate until the compile passes with zero errors. Commit incrementally if helpful.

- [ ] **Step 5: Final commit**

```bash
git add static/stories_plan/chapter_1/investigation_scene_1.md
git commit -m "content(ch1): port investigation_scene_1 to finalized schema"
```

---

## Phase B13: Acceptance

### Task 30: Manual dev playthrough

**Files:** none — verification step.

- [ ] **Step 1: Run the dev loop**

```bash
bun run tauri dev
```

Expected: window opens; the chapter title appears; intro dialogue plays; you can advance with click or Space; reveals fire; sub-locations unlock; the Outro plays when its Unlock condition is met; chapter completes.

- [ ] **Step 2: Verify behaviors against the spec**

Walk through:
- Click a hotspot → its body dialogue + reveal chain queues correctly
- Double-click the dialogue box rapidly → no line is skipped
- Hold Space → no line is skipped
- Inspect a hotspot twice → first time plays body; second time plays On Reexamine (or fallback)
- Open Inventory → click evidence → re-examination dialogue plays
- Locked sub-locations are hidden until revealed
- Hidden topics become visible after their unlock chain completes

If any behavior is wrong, file a bug to investigate in the relevant engine module before continuing.

- [ ] **Step 3: Commit no code; this is verification.**

If there were bug fixes needed, commit them with a clear `fix:` prefix.

---

### Task 31: Packaged-build smoke test (acceptance gate)

**Files:** none — final verification.

- [ ] **Step 1: Build the production bundle**

```bash
bun run tauri build
```

Expected: produces a bundle under `src-tauri/target/release/bundle/`.

- [ ] **Step 2: Launch the bundle**

Open the produced `.app` (macOS), `.exe` (Windows), or executable (Linux). Verify:
- The window opens
- `start_game` returns a valid `GameStateView` (not a `sceneLoadFailed` error)
- The intro plays
- A full chapter-1 playthrough completes

This is the spec's acceptance gate — **the slice is not done until a packaged bundle plays the fixture chapter end-to-end.**

- [ ] **Step 3: Commit a final note (optional)**

If everything passes, no commit needed. If you discovered any tweaks (e.g., `bundle.resources` glob adjustments), commit them with a `fix(bundle):` prefix.

---

## Plan B complete

At this point:

- The Rust engine deserializes Plan A's JSON, drives the mode state machine, exposes the full command surface.
- The Svelte UI renders mode-appropriate components and never decides its own mode.
- Chapter 1 content has been ported to the finalized schema.
- Both `bun run tauri dev` and `bun run tauri build` produce a playable chapter-1 experience.

Verify by running:

```bash
bun test                            # all Plan A tests still pass
cd src-tauri && cargo test && cd .. # all Rust tests pass
bun run check                       # TypeScript clean
bun run tauri dev                   # manual smoke
bun run tauri build                 # packaged smoke
```

---

## Out of scope (future plans)

- Interrogation scene type — reserved by the design, not implemented here.
- Chapter selector / save-load.
- AI scene backgrounds (the `SceneBackdrop` hook is ready when the integration happens).
- Dialogue transcript / replay log.
- Frontend test framework (Playwright/Vitest).
- Cross-chapter `Unlock:` predicates and the reachability validator (per spec §3d, blocked behind chapter 2+ authoring).

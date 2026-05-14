# Scene Pipeline Design — Wiring Authored Scenes Into the Engine and UI

**Date:** 2026-05-13
**Status:** Approved (brainstorm complete; implementation plan to follow)
**Related spec:** [`2026-05-13-investigation-scene-skill-design.md`](./2026-05-13-investigation-scene-skill-design.md) (authoring side)

## Goal

The writer agent uses `writing-investigation-scene` and `writing-detective-game-dialogue` to author markdown under `static/stories_plan/`. The Rust engine and Svelte UI do not currently consume those files — `InvestigationEngine::new_demo_case()` hardcodes an English demo case unrelated to the authored content. This spec defines the pipeline that takes the writer's output and makes it playable, scalable across all chapters and across multiple scene types.

The pipeline is **scene-type-specific, not scene-specific.** Adding a new investigation scene or linear-dialogue scene is an authoring action; adding a new *kind* of scene (e.g., interrogation later) is a development action with clear extension points.

## Scope

### In scope

1. A build-time compile step that parses authored markdown into typed JSON.
2. A revised Rust engine that loads scene JSON, owns game/chapter/scene state, drives a mode state machine, and exposes Tauri commands.
3. A frontend rewrite that renders mode-driven UI: VN-style dialogue playback and sub-location exploration, with a game-global inventory drawer.
4. Two scene types supported at v1: **linear** (`scene_<K>.md`) and **investigation** (`investigation_scene_<K>.md`).
5. Skill updates required to align the writer's output with the parser schema.
6. Deletion of the existing demo case and deduction system.

### Out of scope (deferred follow-ups)

- Interrogation scene type — design leaves explicit extension points but does not implement.
- Chapter selector / save-load / replay-from-chapter UI.
- AI-generated scene backgrounds (a hook is exposed in `SceneBackdrop`).
- Dialogue transcript / replay log.
- Auto-advance / skip-read / text-speed settings.
- Audio (music, voice, SFX).
- Frontend test framework.
- Cross-chapter foreshadow-payoff fixtures (await chapter 2+ authoring).

## Architecture overview

Four layers, each with a single responsibility. The pipeline is one-directional: authoring → compile → engine → presentation.

```
┌────────────────────────────────────────────────────────────────┐
│  AUTHORING LAYER  (static/stories_plan/**)                     │
│  Writer agent uses skills to produce .md files.                │
│                                                                │
│  static/stories_plan/                                          │
│    General Plan.md                ← reference, not parsed      │
│    chapter_<N>/                                                │
│      chapter.md                   ← NEW: per-chapter manifest  │
│      scene_<K>.md                 ← linear scene               │
│      investigation_scene_<K>.md   ← investigation scene        │
│      interrogation_scene_<K>.md   ← reserved (future)          │
└─────────────────────────┬──────────────────────────────────────┘
                          │ at build / on watch
                          ▼
┌────────────────────────────────────────────────────────────────┐
│  COMPILE LAYER  (scripts/compile-scenes.ts, run by Bun)        │
│  Pure function: .md → validated typed JSON.                    │
│  - Resolves every reveal/unlock ID inside the source file.     │
│  - Emits one JSON per scene + one chapters.json index.         │
│  - Fails the build on schema or reference errors.              │
│                                                                │
│  src-tauri/resources/scenes/      ← generated, gitignored,     │
│                                     bundled as Tauri resources │
│    chapters.json                  ← chapter order + scene refs │
│    chapter_<N>/scene_<K>.json     ← one per scene              │
└─────────────────────────┬──────────────────────────────────────┘
                          │ read from disk at runtime via tokio::fs
                          ▼
┌────────────────────────────────────────────────────────────────┐
│  ENGINE LAYER  (src-tauri/src/, Rust)                          │
│  Owns the only authoritative state:                            │
│                                                                │
│    GameState { inventory, currentChapterIdx, chapter, ... }    │
│      └─ ChapterState { currentSceneIdx, scene }                │
│           └─ SceneRuntime (Linear | Investigation)             │
│                                                                │
│  Scene-type dispatch via Rust enum. Adding interrogation       │
│  later = add a third variant + its commands. No core rewrite.  │
└─────────────────────────┬──────────────────────────────────────┘
                          │ invoke / state snapshot
                          ▼
┌────────────────────────────────────────────────────────────────┐
│  PRESENTATION LAYER  (src/routes/+page.svelte + components)    │
│  Reads state, renders mode-appropriate UI:                     │
│  - Dialogue mode: VN box, click-to-advance                     │
│  - Explore mode: sub-location nav + hotspot/character grid     │
│  - Inventory panel: always available                           │
│  No gameplay logic. No markdown parsing.                       │
└────────────────────────────────────────────────────────────────┘
```

### Layer invariants

- The compile script and the engine never both parse markdown. Markdown stops at the compile boundary; everything past is typed JSON.
- The engine drives the mode state machine. The frontend renders whatever `mode` the engine reports; the frontend never decides what mode it is in.
- Scene-type extensibility is via a Rust `SceneRuntime` enum and a TypeScript-discriminated `type` field on the scene JSON. Both leave explicit room for a third scene type without changes to `GameState`, `ChapterState`, or `Inventory`.

### State scope

State is hierarchical to match detective-genre semantics — evidence and statements accumulate game-wide so foreshadow payoffs can span chapters.

| Scope | What lives here | Resets when |
|---|---|---|
| **Game** | Evidence inventory, statement inventory, completed chapter IDs | Game reset |
| **Chapter** | `currentSceneIdx`, chapter-local progress | Chapter advance |
| **Scene** | Hotspot/topic/sub-location/dialogue-queue state | Scene advance (state frozen, not reset, on completion) |

Authored unlock expressions in chapter 5 can therefore reference `evidence:blue_umbrella` collected in chapter 1.

### ID namespace

- **Evidence and statement IDs are game-global.** Unique across all chapters. Compile-time error on collision.
- **Hotspot, topic, sub-location IDs are scene-local.** Declared inside one investigation scene via `{#id}`. Can repeat across files; cross-scene references are not supported.

## Authoring schemas

### 2a. Chapter manifest — `chapter_<N>/chapter.md` (NEW)

Minimal, declarative. Scene type is inferred from filename prefix.

```markdown
# Chapter 1: 雨鐘咖啡館殺人事件

**Summary:** 律師相馬律與早坂茜調查咖啡館內的殺人事件。

## Scenes
1. scene_0.md
2. investigation_scene_1.md
3. scene_1.md
4. investigation_scene_2.md
```

**Filename prefix → scene type:**
- `scene_*.md` → linear
- `investigation_scene_*.md` → investigation
- `interrogation_scene_*.md` → reserved (parser warns, does not emit)

Chapter order is by directory name (`chapter_1`, `chapter_2`, …). No top-level index file is needed.

### 2b. Linear scene — `scene_<K>.md`

One linear dialogue queue. The parser walks top-to-bottom and emits items in order. No metadata beyond the H1 title.

```markdown
# Scene 0: 接案

[場景：吉祥寺街道，深夜，雨夜。律師相馬律撐傘走進雨鐘咖啡館。]

[相馬律收起傘，在門口抖了抖。]

**早坂茜**：你來得比我想的快。

**相馬律**：黑瀨刑警在嗎？
```

End-of-file = end-of-scene → advance to next scene in the chapter manifest.

### 2c. Investigation scene — `investigation_scene_<K>.md`

Existing `writing-investigation-scene` schema preserved except for three additions:

1. **`## Outro` may carry one optional metadata field:** `**Unlock:**` (a boolean expression over `evidence_collected` / `statement_acquired` / `topic_discussed` / `hotspot_investigated` predicates, combined with `and`/`or`). When omitted, the Outro's unlock defaults to `"auto"` (all unlocked hotspots inspected + all unlocked topics discussed).

2. **`### Hotspot:` and `#### Topic:` blocks may have an optional `#### On Reexamine` H4 sub-block.** Plays on the second-and-onward click; no new reveals fire. If absent, subsequent clicks play an engine-provided fallback line.

3. **Locked blocks are hidden from the player** (sub-locations, hotspots, topics). The skill's prior implication that `locked_reason` is player-visible is removed. Lock hints render nowhere — the writer's `Unlock:` expression is parser-internal.

### 2d. Shared dialogue idioms (unchanged from existing skills)

- `[場景：...]` scene tag — passed through to the engine as `DialogueItem.kind = "sceneTag"`; the frontend's `SceneBackdrop` consumes it.
- `[bracketed text]` — non-scene-tag bracketed lines render as narration / stage direction (`kind = "action"`).
- `**Speaker**：text` — dialogue lines (`kind = "line"`).
- ≤100 Chinese-character per dialogue line (warning, not error).

## Compile pipeline

### 3a. Layout

```
scripts/
  compile-scenes.ts        ← Bun TS, parser & validator
  compile-scenes.test.ts   ← bun:test, parser/validator coverage
  __fixtures__/            ← golden inputs for tests + Rust integration test

static/stories_plan/...    ← authored source (existing)
src-tauri/resources/scenes/...   ← generated, gitignored, bundled as Tauri resources
```

Two `package.json` scripts:
- `scenes:compile` — one-shot. Wired into `tauri.conf.json`'s `beforeDevCommand` and `beforeBuildCommand`.
- `scenes:watch` — chokidar-watches `static/stories_plan/**/*.md`, recompiles affected files on save.

### 3a.1. Scene asset delivery (hard invariant)

Generated scene JSON is **bundled as Tauri resources**, not served by Vite. This is the only path that works identically in dev and packaged builds; it also keeps the "engine owns the data" invariant intact (the frontend never fetches scene JSON over HTTP).

- **Output directory:** `src-tauri/resources/scenes/` (a sibling of `src-tauri/src/`, gitignored).
- **`tauri.conf.json`:** `bundle.resources` must include `"resources/scenes/**/*"`. The compile script's first action on every run is to create the directory if missing; CI fails the build if `bundle.resources` is missing this entry (asserted by a one-line test in `compile-scenes.ts`).
- **Runtime resolution (Rust):** the loader uses `app.path().resolve("scenes/chapters.json", BaseDirectory::Resource)?` to obtain the absolute path, then reads via `tokio::fs::read`. Same code path in dev and prod — Tauri's `BaseDirectory::Resource` resolves to the dev resource dir during `tauri dev` and to the bundled resource dir in packaged builds.
- **Frontend:** never reads scene JSON directly. All access is via Tauri commands.
- **Acceptance gate:** step 7 of the implementation order adds a packaged-build smoke test — `bun run tauri build`, launch the produced bundle on the host platform, verify `start_game` returns a valid `GameStateView` (not a `sceneLoadFailed` error). This is non-negotiable; the design is wrong if the bundle can't find scenes.

### 3b. JSON output shape

**`src-tauri/resources/scenes/chapters.json`** — `id` is the source directory name; `title` and `summary` come from the chapter manifest's H1 and `**Summary:**` field. `file` paths are relative to the `scenes/` resource root.

```json
{
  "chapters": [
    {
      "id": "chapter_1",
      "title": "雨鐘咖啡館殺人事件",
      "summary": "律師相馬律與早坂茜...",
      "scenes": [
        { "type": "linear", "file": "chapter_1/scene_0.json" },
        { "type": "investigation", "file": "chapter_1/investigation_scene_1.json" }
      ]
    }
  ]
}
```

**Linear scene JSON:**

```json
{
  "type": "linear",
  "id": "scene_0",
  "title": "接案",
  "queue": [
    { "kind": "sceneTag", "text": "吉祥寺街道..." },
    { "kind": "action",   "text": "相馬律收起傘..." },
    { "kind": "line",     "speaker": "早坂茜", "text": "你來得比我想的快。" }
  ]
}
```

**Investigation scene JSON:**

```json
{
  "type": "investigation",
  "id": "investigation_scene_1",
  "title": "...",
  "intro": [ /* DialogueItem[] */ ],
  "sublocations": [
    {
      "id": "entrance",
      "status": "unlocked",
      "unlock": null,
      "reveals": [],
      "sceneTag": "雨鐘咖啡館正門內側...",
      "transitionDialogue": [ /* DialogueItem[] */ ],
      "hotspots": [
        {
          "id": "blue_umbrella_stand",
          "label": "...",
          "description": "...",
          "status": "unlocked",
          "unlock": null,
          "reveals": [ { "kind": "evidence", "id": "blue_umbrella" } ],
          "inspectDialogue": [ /* DialogueItem[] */ ],
          "onReexamine": null
        }
      ],
      "characters": [
        {
          "id": "hayasaka",
          "name": "...",
          "role": "...",
          "bio": "...",
          "topics": [
            {
              "id": "timeline",
              "label": "...",
              "status": "unlocked",
              "unlock": null,
              "reveals": [],
              "topicDialogue": [ /* DialogueItem[] */ ],
              "onReexamine": null
            }
          ]
        }
      ]
    }
  ],
  "evidenceManifest": [
    {
      "id": "blue_umbrella",
      "name": "...",
      "description": "...",
      "details": "...",
      "onCollect":   [ /* DialogueItem[] */ ],
      "onReexamine": null
    }
  ],
  "statementManifest": [
    {
      "id": "...",
      "speaker": "...",
      "content": "...",
      "onAcquire":   [ /* DialogueItem[] */ ],
      "onReexamine": null
    }
  ],
  "outro": {
    "unlock":  "auto",
    "dialogue": [ /* DialogueItem[] */ ]
  }
}
```

**Shared atoms:**

```ts
type DialogueItem =
  | { kind: "sceneTag"; text: string }
  | { kind: "action"; text: string }
  | { kind: "line"; speaker: string; text: string };

type RevealTarget =
  | { kind: "evidence"; id: string }
  | { kind: "statement"; id: string }
  | { kind: "topic"; characterId: string; topicId: string }
  | { kind: "hotspot"; id: string }
  | { kind: "sublocation"; id: string };

type UnlockExpr =
  | { op: "and" | "or"; left: UnlockExpr; right: UnlockExpr }
  | { predicate: "evidence_collected";  id: string }
  | { predicate: "statement_acquired";  id: string }
  | { predicate: "topic_discussed";     characterId: string; topicId: string }
  | { predicate: "hotspot_investigated"; id: string };
```

`outro.unlock = "auto"` is preserved as a real engine concept (not unrolled at parse time). The engine resolves it dynamically against the current scene state.

### 3c. Parser approach

A custom line-oriented recursive-descent parser, not `remark`. The grammar is small and rigid enough that a 300–400 line parser produces better error messages than a generic markdown AST + post-validator.

A single run of `compile-scenes.ts` processes the whole `static/stories_plan/` tree:

1. **Discover.** Scan `static/stories_plan/chapter_*/` directories, sorted by directory name. Each directory's `chapter.md` is required.
2. **Parse.** Per-file AST for every `.md` referenced by any chapter manifest. Chapter ID is derived from the directory name (e.g., `chapter_1`); the H1 title and `Summary:` come from `chapter.md`.
3. **Resolve & validate** across all files — builds a single game-global registry of evidence and statement IDs so cross-chapter collisions can be detected.
4. **Emit** JSON files under `src-tauri/resources/scenes/` mirroring the source directory structure, plus the top-level `chapters.json` index.

### 3d. Validation (compile-time errors)

Per-file (extends the writer-skill's existing parser-guarantee list):
- H1 title present; exactly one.
- First sub-location is `Status: unlocked`.
- Every sub-location has one `[場景：...]` tag.
- **Every `Reveals:` target ID resolves to a declaration in the same scene file** — for *all* target kinds (`evidence:`, `statement:`, `topic:`, `hotspot:`, `sublocation:`). Cross-scene reveal targets are a validation error. Rationale: a reveal newly *adds* an item or unlocks a block; both operations require the definition (dialogue body, manifest entry) to be physically present in this scene's JSON. A later chapter cannot "newly collect" an item already collected in an earlier one.
- **Every `Unlock:` predicate ID may reference either the same scene or any prior chapter** for the `evidence_collected` and `statement_acquired` predicates (these are read-only inventory checks). The `topic_discussed` and `hotspot_investigated` predicates remain strictly scene-local — they reference per-scene runtime state, which does not persist across scenes.
- Every locked block has at least one unlock path; no circular chains.
- No block has both an inbound `Reveals` and a self `Unlock`.
- Every Evidence Manifest entry has `#### On Collect`; every Statement entry has `#### On Acquire`.

Cross-file (built from the single compile run's global registry):
- Every chapter manifest references files that exist in the same chapter directory with valid scene-type prefixes.
- Evidence and statement IDs are unique across the entire game (compile error on collision; both source locations reported). This uniqueness is what lets a later-chapter `Unlock:` predicate reference an earlier-chapter ID unambiguously.
- An `Unlock:` predicate referencing an evidence/statement ID declared in a *later* chapter (by `chapter_<N>` ordering) fails validation — enforces one-way foreshadow payoff and prevents temporal-paradox unlock chains.
- Hotspot/topic/sub-location IDs are scene-local — no global check.

**Engine implication of the Reveals-is-scene-local rule:** `EvidenceDef` and `StatementDef` stay on `InvestigationSceneState`; no game-global definition registry is needed. The `Inventory` holds *snapshots* of each collected item's def (name, description, details, `onReexamine`), cloned in at collection time — see §4b. This is how reexamine still works for a chapter-1 clue while playing chapter 5: the inventory record carries everything it needs, the source scene is free to unload.

Warnings (don't fail the build):
- Dialogue line over 100 Chinese characters.
- Reserved prefix in `Reveals:` / `Unlock:` (`chapter:`, `flag:`).
- Outro without explicit `Unlock` (informational — falls back to `"auto"`).

## Rust engine

### 4a. Module layout

The current single `investigation.rs` (916 lines) is split:

```
src-tauri/src/
  lib.rs                  ← Tauri commands; AppState; handler registration
  game/
    mod.rs                ← pub use; GameEngine struct (orchestrator)
    state.rs              ← GameState, ChapterState, Inventory types
    scenes/
      mod.rs              ← SceneRuntime enum dispatch
      linear.rs           ← LinearScene + advance_dialogue impl
      investigation.rs    ← InvestigationScene + reveal/unlock impl
    schema.rs             ← serde types matching compile-script JSON 1:1
    unlock.rs             ← UnlockExpr evaluator + "auto" mode resolution
    reveals.rs            ← RevealTarget application; chained-queue construction
    loader.rs             ← read src-tauri/resources/scenes/** via BaseDirectory::Resource
    view.rs               ← GameStateView (camelCase snapshot for FE)
    error.rs              ← GameError (renamed from InvestigationError)
```

### 4b. State hierarchy

```rust
pub struct GameEngine {
    chapters: Vec<ChapterManifest>,      // immutable, loaded once
    state: GameState,                    // mutable runtime state
}

pub struct GameState {
    inventory: Inventory,                // game-global
    current_chapter_idx: usize,
    chapter: ChapterState,
    completed_chapter_ids: Vec<String>,
}

pub struct Inventory {
    evidence: HashMap<String, EvidenceRecord>,    // see note below
    statements: HashMap<String, StatementRecord>,
}

// Inventory records are self-contained snapshots. When a reveal collects
// evidence or acquires a statement, the engine clones the relevant
// EvidenceDef / StatementDef from the source InvestigationSceneState into
// the record. The inventory then carries name, description, details, and
// onReexamine dialogue forward — so reexamine still works after the
// source scene is unloaded (e.g., reexamining a chapter-1 clue while in
// chapter 5). The source scene's defs remain scene-local; the inventory
// holds a frozen copy taken at collection time.
pub struct EvidenceRecord {
    id: String,
    name: String,
    description: String,
    details: String,
    on_reexamine: Option<Vec<DialogueItem>>,
    collected_in_chapter_id: String,
    collected_in_scene_id: String,
}
pub struct StatementRecord {
    id: String,
    speaker: String,
    content: String,
    on_reexamine: Option<Vec<DialogueItem>>,
    acquired_in_chapter_id: String,
    acquired_in_scene_id: String,
}

pub struct ChapterState {
    current_scene_idx: usize,
    scene: SceneRuntime,
}

pub enum SceneRuntime {
    Linear(LinearSceneState),
    Investigation(InvestigationSceneState),
    // Future: Interrogation(InterrogationSceneState) — see §6c.
    // Not added as a real variant in v1 to avoid an unreachable arm.
}

pub struct LinearSceneState {
    id: String,
    title: String,
    queue: Vec<DialogueItem>,
    cursor: usize,
}

pub struct InvestigationSceneState {
    id: String,
    title: String,
    sublocations: Vec<SublocationState>,
    evidence_defs: HashMap<String, EvidenceDef>,
    statement_defs: HashMap<String, StatementDef>,
    intro_played: bool,
    outro_def: OutroDef,
    outro_played: bool,
    current_sublocation_id: Option<String>,
    pending_queue: Option<DialogueQueue>,
}

pub struct DialogueQueue {
    items: Vec<DialogueItem>,
    cursor: usize,
}
```

Defs (`EvidenceDef`, `StatementDef`, hotspot/topic defs) are immutable, loaded from JSON. Runtime state tracks inspected/discussed/collected. Reset = discard runtime, keep defs.

### 4c. Mode state machine

```rust
pub enum Mode {
    Dialogue {
        current: DialogueItem,
        queue_remaining: usize,
        scene_tag: Option<String>,   // last sceneTag seen — for backdrop
    },
    Explore { sublocation_id: String },
    GameComplete,
}
```

No `SceneTransition` variant. Scene loading is fully internal to `advance_dialogue` — when an outro queue empties, the engine advances the scene index, loads the next scene, primes its intro queue (if any), and returns a `Dialogue` (or `Explore`) snapshot in the **same call**. The frontend never lands on a "transitional" mode it can't exit.

A scene change is visible to the FE as `chapter.id` or `scene.id` differing between consecutive snapshots — sufficient for a CSS fade animation if desired. The chapter→chapter transition is the same: when the last scene of the last chapter advances, the engine returns `GameComplete`; the FE never needs an explicit "acknowledge transition" command.

```
                    ┌──────────────┐
   start_game ────► │  Dialogue    │  ← intro / inspect / on_collect queues
                    └──────┬───────┘
                           │ advance_dialogue, queue empties
                           ▼
                    ┌──────────────┐
                    │  Explore     │  ← sub-location's hotspot + character grid
                    └──┬─────────┬─┘
        inspect_hotspot│         │interview_topic / enter_sublocation /
        OR reexamine_X │         │reexamine_X
                       ▼         ▼
                  back to Dialogue (new queue)
                       │
                       │ trigger satisfied outro.unlock
                       ▼
                  Dialogue plays outro
                       │
                       │ outro queue empties → engine internally:
                       │   advance scene_idx, load next scene,
                       │   prime its intro queue
                       ▼
                  (same advance_dialogue call returns Dialogue
                   for the new scene's intro, or Explore if no intro)
                       │
                       │ ... eventually last scene of last chapter
                       │     completes its outro
                       ▼
                  GameComplete
```

### 4d. Reveal/queue construction

When `inspect_hotspot(hotspot_id)` is called (similar for `interview_topic`, `enter_sublocation`):

```
1. Lookup hotspot. Error if unknown or locked.
2. Build a new DialogueQueue:
     - If first inspect: items = hotspot.inspect_dialogue.clone()
     - If reexamine and hotspot.on_reexamine.is_some(): items = on_reexamine.clone()
     - If reexamine and on_reexamine.is_none(): items = [engine_fallback_line()]
3. If first inspect: for each reveal in hotspot.reveals (in declared order):
     match reveal {
       evidence:X    => inventory.add(X) if absent; append X.on_collect to queue
       statement:X   => inventory.add(X) if absent; append X.on_acquire to queue
       topic:C@T     => unlock that topic (silent — no append)
       hotspot:X     => unlock that hotspot (silent)
       sublocation:X => unlock that sub-location (silent)
     }
4. Mark hotspot.inspected = true (first time only).
5. Re-evaluate every locked block's unlock condition.
6. Set scene.pending_queue = Some(queue); mode := Dialogue.
7. Return GameStateView.
```

The "Play order" rule from the writer skill — trigger body first, then each reveal target's reveal dialogue in declared order — is honored by linear concatenation in step 3. **One queue at a time**; no nested or parallel queues.

When `advance_dialogue` is called:

```
1. Increment queue.cursor.
2. If cursor < queue.len(), return view with next DialogueItem.
3. Else (queue empty):
    a. Clear pending_queue.
    b. If outro just finished → mark outro_played; advance scene_idx;
       load next scene; init intro queue if any.
    c. Else if outro.unlock now evaluates true and outro_played == false →
       set pending_queue = outro.dialogue.clone(); mode stays Dialogue.
    d. Else if scene was in "intro" phase → set current_sublocation_id to
       the first unlocked sublocation; play its transition dialogue if any;
       else mode := Explore.
    e. Else → mode := Explore.
4. Return view.
```

### 4e. Unlock evaluator

```rust
impl UnlockExpr {
    pub fn evaluate(&self, scene: &InvestigationSceneState, inv: &Inventory) -> bool {
        match self {
            UnlockExpr::And(a, b) => a.evaluate(scene, inv) && b.evaluate(scene, inv),
            UnlockExpr::Or(a, b)  => a.evaluate(scene, inv) || b.evaluate(scene, inv),
            UnlockExpr::EvidenceCollected(id)  => inv.has_evidence(id),
            UnlockExpr::StatementAcquired(id)  => inv.has_statement(id),
            UnlockExpr::TopicDiscussed(c, t)   => scene.is_topic_discussed(c, t),
            UnlockExpr::HotspotInvestigated(id) => scene.is_hotspot_inspected(id),
        }
    }
}

pub enum OutroDef {
    Auto { dialogue: Vec<DialogueItem> },
    Conditional { unlock: UnlockExpr, dialogue: Vec<DialogueItem> },
}

fn outro_satisfied(scene: &InvestigationSceneState, inv: &Inventory) -> bool {
    match &scene.outro_def {
        OutroDef::Auto { .. }
            => scene.all_unlocked_hotspots_inspected()
            && scene.all_unlocked_topics_discussed(),
        OutroDef::Conditional { unlock, .. }
            => unlock.evaluate(scene, inv),
    }
}
```

### 4f. Tauri command surface

```rust
#[tauri::command] fn start_game(state)                            -> Result<GameStateView, GameError>
#[tauri::command] fn get_state(state)                             -> Result<GameStateView, GameError>
#[tauri::command] fn advance_dialogue(state)                      -> Result<GameStateView, GameError>
#[tauri::command] fn enter_sublocation(state, sublocationId)      -> Result<GameStateView, GameError>
#[tauri::command] fn inspect_hotspot(state, hotspotId)            -> Result<GameStateView, GameError>
#[tauri::command] fn interview_topic(state, characterId, topicId) -> Result<GameStateView, GameError>
#[tauri::command] fn reexamine_evidence(state, evidenceId)        -> Result<GameStateView, GameError>
#[tauri::command] fn reexamine_statement(state, statementId)      -> Result<GameStateView, GameError>
#[tauri::command] fn reset_game(state)                            -> Result<GameStateView, GameError>
```

Removed: `start_case`, `get_case_state`, `interview_character`, `submit_deduction`.

Every command returns the full `GameStateView` snapshot. The frontend replaces local state with the snapshot. No partial updates, no client-side merging.

### 4g. Error contract

`GameError { code, message }` preserves the existing shape (renamed from `InvestigationError`). Frontend's `normalizeError` reads `error.message` unchanged.

New codes:
- `unknownSublocation`, `lockedSublocation`
- `unknownHotspot`, `lockedHotspot`
- `unknownTopic`, `lockedTopic`, `unknownCharacter`
- `unknownEvidence`, `unknownStatement` (for reexamine of items not in inventory)
- `noActiveDialogue` (advance_dialogue while in Explore)
- `wrongMode` (defense-in-depth for any command not applicable to current mode)
- `sceneLoadFailed`, `chapterLoadFailed`, `parseFailure`
- `gameComplete` (any state-changing command after final chapter outro)

## Frontend UI

### 5a. Component layout

```
src/lib/components/
  GameShell.svelte           ← top-level: chapter title, reset button, layout
  DialogueBox.svelte         ← VN-style dialogue, click-to-advance
  ExploreView.svelte         ← sub-location nav + hotspot/character grid
  SublocationNav.svelte      ← chips for unlocked sublocations
  HotspotGrid.svelte         ← hotspot buttons for current sublocation
  CharacterList.svelte       ← character cards with nested topic buttons
  InventoryPanel.svelte      ← collapsible drawer: evidence + statements
  SceneBackdrop.svelte       ← reads sceneTag → styled caption now,
                               slot for AI-generated background later
  ErrorBanner.svelte         ← (unchanged from today)

src/lib/state/
  game-client.ts             ← thin invoke wrapper, central state store
  types.ts                   ← TS mirrors of GameStateView

src/routes/
  +page.svelte               ← thin shell: <GameShell />
  +layout.ts                 ← unchanged (ssr = false)
```

### 5b. Mode-driven rendering

The frontend reads `gameState.mode.type` and renders the matching component. It never decides what mode to be in.

```svelte
{#if gameState.mode.type === "dialogue"}
  <DialogueBox dialogue={gameState.mode.current}
               sceneTag={gameState.mode.sceneTag}
               onAdvance={advanceDialogue} />
  <ExploreView {gameState} dimmed />   <!-- read-only beneath -->
{:else if gameState.mode.type === "explore"}
  <ExploreView {gameState}
               onInspect={inspectHotspot}
               onInterview={interviewTopic}
               onEnterSublocation={enterSublocation} />
{:else if gameState.mode.type === "gameComplete"}
  <GameComplete />
{/if}

<InventoryPanel inventory={gameState.inventory}
                onReexamineEvidence={reexamineEvidence}
                onReexamineStatement={reexamineStatement} />
```

### 5c. DialogueBox

Three render variants keyed off `DialogueItem.kind`:

| Kind | Render |
|---|---|
| `sceneTag` | Consumed silently by `SceneBackdrop`. Not shown in the dialogue box itself. |
| `action` | Italic narration; centered/left-flush; no speaker label. |
| `line` | Speaker label + text bubble. |

Advance: click on the box, or press Space / Enter. A small chevron indicates the affordance.

`SceneBackdrop` reads the most-recent `sceneTag` from `gameState.mode.sceneTag` (the engine threads the last-seen scene tag through). For v1 it renders a styled caption banner; the hook for AI-generated backgrounds is the same prop.

### 5d. ExploreView

```
┌────────────────────────────────────────────────────────────┐
│  [場景：雨鐘咖啡館主廳]                  [章 1 · 場 2]      │
├────────────────────────────────────────────────────────────┤
│  Sub-location:  [正門與傘架]  [主廳客席區]                  │
│                                                            │
│  ┌───────────────┐  ┌───────────────┐  ┌───────────────┐  │
│  │ 黃銅桌鈴      │  │ 入口監視器    │  │ 滾輪貨架      │  │
│  │ 吧台上的桌鈴  │  │ 紅燈閃爍      │  │ 半遮舊門      │  │
│  └───────────────┘  └───────────────┘  └───────────────┘  │
│                                                            │
│  人物 (in 主廳客席區)                                       │
│  ┌──────────────────┐  ┌──────────────────┐               │
│  │ 黑瀨徹           │  │ 早坂茜           │               │
│  │ 警視廳刑警       │  │ 律師             │               │
│  │ ─────────────    │  │ ─────────────    │               │
│  │ • 官方時間線     │  │ • 案發時間       │               │
│  │ • 自己的疑惑     │  │ • 死者背景       │               │
│  └──────────────────┘  └──────────────────┘               │
└────────────────────────────────────────────────────────────┘
                                              [📋 Inventory ▸]
```

- **Locked sub-locations, hotspots, and topics are hidden** until revealed.
- **Hotspots and topics are re-clickable.** First click plays the body dialogue + reveals; subsequent clicks play `On Reexamine` if present, else a fallback line. Visual marker indicates "first inspect done" but does not disable the button.
- Sub-location switching is free among unlocked ones. Only first entry of a sub-location plays its transition dialogue.

### 5e. InventoryPanel

Right-side collapsible drawer. Two lists:

- **Evidence** — collected only. Click → `reexamine_evidence(id)` → engine queues `onReexamine` (or fallback) and switches to Dialogue mode.
- **Statements** — discovered only. Same pattern.

Inventory persists across scenes and chapters.

### 5f. Initial load

```
onMount:
  invoke("start_game")    ← engine starts chapter 1, scene 0, intro queue
```

No chapter picker for v1; chapter 1 always boots. Loading state reuses the current "Loading investigation..." status line.

### 5g. Styling

Visual register beyond structural decisions is deferred to the `frontend-design` skill during implementation.

## Error handling, testing, forward compatibility

### 6a. Error boundaries

| Boundary | Behavior |
|---|---|
| **Compile-time** (Bun parser) | Errors fail the build with `file:line:col` formatting. CI green ⇔ scenes valid. Warnings printed but don't fail. |
| **Engine startup** (`start_game`) | IO or JSON deserialization errors → `GameError { code: "sceneLoadFailed", ... }`. Engine stays in uninitialized state; FE shows banner + Retry. |
| **Runtime** (per-command) | Typed `GameError`. New codes listed in §4g. Calling a non-applicable command for the current mode returns `wrongMode` (defense-in-depth — FE button gating should prevent these). |

### 6b. Testing

**Compile script (bun:test):**
- `parser/` tests: golden inputs → expected AST. Fixture corpus under `scripts/__fixtures__/`.
- `validator/` tests: positive + negative case for each rule from §3d.
- One snapshot test compiling the real `chapter_1/` and asserting the JSON output matches a committed snapshot.

**Rust engine (`cargo test`, tests next to code via `#[cfg(test)] mod tests`):**

| Module | Coverage |
|---|---|
| `unlock.rs` | Every predicate; and/or combinators; auto-mode satisfaction. |
| `reveals.rs` | Queue construction; dialogue ordering matches writer-skill "Play order"; silent unlocks for topic/hotspot/sublocation. |
| `scenes/investigation.rs` | inspect / interview / enter flows; locked-block errors; first-inspect vs. reexamine semantics. |
| `scenes/linear.rs` | advance_dialogue cursor; queue-empty transition. |
| `state.rs` | Inventory add/dedup; chapter-state advance; cross-scene inventory persistence. |
| `loader.rs` | Round-trip a fixture JSON via serde; missing-file error path. |

One integration test under `src-tauri/tests/full_playthrough.rs` loads a fixture chapter and walks the full mode machine: `start_game` → intro → `inspect_hotspot` → chained queue → drain → outro → assert next scene loaded inside the same `advance_dialogue` return (no transient transition mode) → ... → `GameComplete`.

**Frontend:** no test runner today. Rely on `bun run check` for type safety and manual verification. Adding Playwright/Vitest is deferred.

### 6c. Forward compatibility — interrogation slot

| Layer | What stays open |
|---|---|
| **Authoring** | Filename prefix `interrogation_scene_*.md` reserved. Chapter manifest scene list is a flat ordered array — slots in anywhere. |
| **Compile script** | Scene-type dispatch is a `switch`; adding interrogation = add a third case + parser. Existing JSON shapes unchanged. |
| **JSON atoms** | `DialogueItem`, `RevealTarget`, `UnlockExpr` are scene-type-agnostic. Reusable. |
| **Engine** | `SceneRuntime` enum has a commented-out `Interrogation` line. `Mode` enum can grow new variants — Rust exhaustiveness forces every match site to handle them. |
| **Commands** | Investigation command names stay specific (`inspect_hotspot`). Interrogation gets its own (`present_evidence`, `press_witness`). No collisions. |
| **Frontend** | Mode-driven render adds an `else if mode === "interrogation"` branch. `<DialogueBox />` is reused. |
| **Inventory** | Already game-global; interrogation can present any collected evidence/statement. |

Deliberately not pre-built: no `InterrogationSceneState` struct stub, no interrogation commands defined. Adding them is a few-line change when the time comes.

## Migration

### 7a. What gets deleted

| File / type | Action |
|---|---|
| `InvestigationEngine::new_demo_case()` | Delete. |
| `DeductionSlotState`, `DeductionAnswer`, `DeductionFeedback`, `DeductionSlotResult` | Delete. |
| `submit_deduction` command + handler entry | Delete. |
| `get_case_state` command | Delete (replaced by `get_state`). |
| `CaseState`, `CaseStatus` | Delete. |
| `start_case` command | Replaced by `start_game`. |
| `interview_character` command | Renamed to `interview_topic`. |
| `+page.svelte` Deduction tab and all deduction logic, types, `draftAnswers`, `lastSubmittedAnswers`, `feedbackForSlot` | Delete. |
| Tab-switcher (`Scene/People/Evidence/Deduction`) | Replaced by mode-driven render + Inventory drawer. |
| All English content in `+page.svelte` | Replaced or made data-driven from scene JSON. |
| Existing Rust tests in `investigation.rs` | Replaced by tests in §6b. |

### 7b. Skill updates (in scope for the implementation plan)

| File | Change |
|---|---|
| `.claude/skills/writing-investigation-scene/SKILL.md` | (1) Allow `**Unlock:**` on `## Outro` (optional; default = auto). (2) Add optional `#### On Reexamine` under `### Hotspot:` and `#### Topic:`. (3) Update heading-hierarchy table and worked example. (4) Add "Game-global ID namespace" callout. (5) Remove implication that `locked_reason` is player-facing. |
| `.claude/skills/writing-detective-game-dialogue/SKILL.md` | Add "Linear scene file format" section: `chapter_<N>/scene_<K>.md` is a minimal wrapper (H1 title + dialogue queue; no other H2+ headers). |
| **NEW:** `.claude/skills/writing-chapter-manifest/SKILL.md` | ~20-line skill defining `chapter_<N>/chapter.md` format. |
| `CLAUDE.md` "Project domain" section | Update the line "The Rust engine does not load these markdown files" — describe the compile pipeline and the three writer skills. Mention `bun run scenes:compile` / `scenes:watch`. |

### 7c. Implementation order

Skills first → parser → engine → frontend → port real drafts. Each phase has a clean stopping point.

1. **Skill updates.** Update `writing-investigation-scene`, `writing-detective-game-dialogue`, create `writing-chapter-manifest`, update `CLAUDE.md`.
2. **Author test corpus.** Minimal `chapter.md`, tiny linear scene, tiny investigation scene exercising every block type. Under `scripts/__fixtures__/`. Used by both Bun parser tests and Rust integration test.
3. **Bun compile script.** Tokenizer → AST → validator → JSON emitter. bun:test coverage per §6b. Wire `scenes:compile` / `scenes:watch` into `package.json` and `tauri.conf.json`.
4. **Rust engine**, built in layers, each greenlit by `cargo test` before the next:
   - `schema.rs` (serde types; deserialize fixture as smoke test)
   - `unlock.rs`
   - `state.rs`
   - `scenes/linear.rs`
   - `reveals.rs` + `scenes/investigation.rs`
   - `loader.rs`
   - `view.rs`
   - `error.rs`
   - `lib.rs` (commands + AppState wiring)
   - Integration test under `src-tauri/tests/full_playthrough.rs` lights up at the end.
5. **Frontend rewrite.** Types → game-client → components → replace `+page.svelte`. `bun run check` greenlit. Manual playthrough of the fixture chapter via `bun run tauri dev`.
6. **Port the existing drafts** (`chapter_1/scene_0.md`, `chapter_1/investigation_scene_1.md`) to the finalized schema. Author `chapter_1/chapter.md`. Verify full chapter-1 playthrough.
7. **Tauri bundling acceptance gate.** Ensure `tauri.conf.json` `bundle.resources` includes `"resources/scenes/**/*"`. No new filesystem capability is needed (the loader uses `BaseDirectory::Resource`, which is always permitted to the app). Run `bun run tauri build`, launch the produced bundle, and verify `start_game` returns a real `GameStateView` rather than `sceneLoadFailed`. This is an acceptance gate — the slice is not done until a packaged bundle plays the fixture chapter end-to-end.

## Open questions reserved for the implementation plan

These are the small choices that don't change the design but need to be decided during implementation:

- Whether to embed `chapters.json` via `include_str!` at build time vs. always read from disk via `tokio::fs` (currently leaning toward disk-read always, for simplicity).
- Engine-provided fallback dialogue line text for reexamine without `On Reexamine` ("（沒有新發現。）" or similar).
- Whether `bun run scenes:watch` should be auto-spawned by `bun run tauri dev` via `concurrently`, or run manually in a second terminal.
- Exact CSS register for the dialogue box (handled by `frontend-design` skill during implementation).

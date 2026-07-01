# Dialogue History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Rust-owned 50-entry RPG dialogue history log that opens from the dialogue box with a `LOG` button and keyboard shortcut.

**Architecture:** The Rust `GameEngine` records visible dialogue beats when they become current and serializes the capped log through `GameStateView`. Svelte treats the log as read-only state, renders it through a focused `DialogueHistoryPanel`, and uses the existing escape-coordinator so Escape closes the log before the global game menu opens.

**Tech Stack:** Rust, Tauri 2 command views, Svelte 5 runes, Vitest, Svelte Testing Library, Bun.

**Source spec:** `docs/superpowers/specs/2026-07-01-dialogue-history-design.md`

---

## File Structure

| Path | Responsibility | Action |
|---|---|---|
| `apps/game/src-tauri/src/game/view.rs` | Add serializable `DialogueHistoryEntry` and expose `dialogueHistory` on `GameStateView`. | Modify |
| `apps/game/src-tauri/src/game/mod.rs` | Store, cap, record, snapshot, reset, and test dialogue history in `GameEngine`. | Modify |
| `apps/game/src/lib/state/types.ts` | Mirror the new Rust wire type and `GameStateView.dialogueHistory`. | Modify |
| `apps/game/src/lib/components/DialogueHistoryPanel.svelte` | Render the read-only transcript panel and own panel-local focus trapping. | Create |
| `apps/game/src/lib/components/DialogueHistoryPanel.test.ts` | Cover transcript rendering and focus trap behavior. | Create |
| `apps/game/src/lib/components/DialogueBox.svelte` | Add `history` prop, `LOG` button, `L` toggle, Escape claim, and advance suppression while the log is open. | Modify |
| `apps/game/src/lib/components/DialogueBox.test.ts` | Cover log button, keyboard toggle, Space/Enter suppression, and escape-coordinator integration. | Modify |
| `apps/game/src/routes/+page.svelte` | Pass `gameState.value.dialogueHistory` into `DialogueBox`. | Modify |
| `apps/game/src/lib/components/GameShell.test.ts` | Update local `GameStateView` fixtures to include `dialogueHistory`. | Modify |
| `apps/game/src/lib/audio/sfx-events.test.ts` | Update local `GameStateView` fixture helper to include `dialogueHistory`. | Modify |
| `apps/game/src/routes/page.test.ts` | Update route-level `GameStateView` fixtures to include `dialogueHistory`. | Modify |
| `apps/game/src/lib/components/SceneNavigationPanel.test.ts` | Update scene-navigation `GameStateView` fixtures to include `dialogueHistory`. | Modify |
| `apps/game/src/lib/state/game-client-source.test.ts` | Update game-client `GameStateView` fixture helper to include `dialogueHistory`. | Modify |

---

### Task 1: Add Rust Dialogue History Recording

**Files:**
- Modify: `apps/game/src-tauri/src/game/view.rs`
- Modify: `apps/game/src-tauri/src/game/mod.rs`

- [ ] **Step 1: Add failing Rust tests for history behavior**

In `apps/game/src-tauri/src/game/mod.rs`, inside `#[cfg(test)] mod tests`, add these helpers near `token_from`:

```rust
    fn history_labels(view: &GameStateView) -> Vec<String> {
        view.dialogue_history
            .iter()
            .map(|entry| match entry {
                DialogueHistoryEntry::Line { speaker, text, .. } => {
                    format!("{speaker}: {text}")
                }
                DialogueHistoryEntry::Action { text, .. } => format!("narration: {text}"),
            })
            .collect()
    }

    fn dialogue_history_fixture_resources(line_count: usize) -> PathBuf {
        use std::fs;
        use std::sync::atomic::{AtomicU64, Ordering};

        static SEQ: AtomicU64 = AtomicU64::new(0);
        let n = SEQ.fetch_add(1, Ordering::Relaxed);
        let d = std::env::temp_dir().join(format!(
            "lyra-dialogue-history-test-{}-{}",
            std::process::id(),
            n
        ));
        let chapter_dir = d.join("chapter_1");
        fs::create_dir_all(&chapter_dir).unwrap();
        fs::write(
            d.join("chapters.json"),
            r#"{
                "chapters": [{
                    "id": "chapter_1",
                    "title": "Chapter One",
                    "summary": "First",
                    "scenes": [
                        { "type": "linear", "file": "chapter_1/scene_0.json" },
                        { "type": "linear", "file": "chapter_1/scene_1.json" }
                    ]
                }]
            }"#,
        )
        .unwrap();

        let mut queue_items = Vec::new();
        queue_items.push(
            r#"{ "kind": "sceneTag", "text": "opening", "assetCue": { "backgroundAssetId": "background.opening" } }"#.to_string(),
        );
        for i in 0..line_count {
            if i % 2 == 0 {
                queue_items.push(format!(
                    r#"{{ "kind": "line", "speaker": "A", "text": "line {i}" }}"#
                ));
            } else {
                queue_items.push(format!(
                    r#"{{ "kind": "action", "text": "action {i}" }}"#
                ));
            }
        }
        fs::write(
            chapter_dir.join("scene_0.json"),
            format!(
                r#"{{
                    "type": "linear",
                    "id": "scene_0",
                    "title": "Opening",
                    "queue": [{}]
                }}"#,
                queue_items.join(",")
            ),
        )
        .unwrap();
        fs::write(
            chapter_dir.join("scene_1.json"),
            r#"{
                "type": "linear",
                "id": "scene_1",
                "title": "Next",
                "queue": [{ "kind": "line", "speaker": "B", "text": "next scene" }]
            }"#,
        )
        .unwrap();
        d
    }
```

Add these tests in the same module:

```rust
    #[test]
    fn dialogue_history_records_initial_visible_item_and_skips_scene_tags() {
        let d = dialogue_history_fixture_resources(2);
        let engine = GameEngine::new_started(d.clone()).unwrap();
        let view = engine.view();

        assert_eq!(history_labels(&view), vec!["A: line 0"]);
        assert_eq!(view.dialogue_history.len(), 1);
        match &view.dialogue_history[0] {
            DialogueHistoryEntry::Line {
                id,
                speaker,
                text,
                chapter_title,
                scene_title,
            } => {
                assert_eq!(*id, 1);
                assert_eq!(speaker, "A");
                assert_eq!(text, "line 0");
                assert_eq!(chapter_title, "Chapter One");
                assert_eq!(scene_title, "Opening");
            }
            other => panic!("expected line history entry, got {other:?}"),
        }

        let _ = std::fs::remove_dir_all(d);
    }

    #[test]
    fn dialogue_history_records_action_and_line_items_and_keeps_newest_fifty() {
        let d = dialogue_history_fixture_resources(55);
        let mut engine = GameEngine::new_started(d.clone()).unwrap();

        while matches!(engine.view().mode, ModeView::Dialogue { .. }) {
            let token = token_from(&engine.view());
            let _ = engine.advance_dialogue(token);
            if matches!(engine.view().mode, ModeView::GameComplete) {
                break;
            }
        }

        let view = engine.view();
        assert_eq!(view.dialogue_history.len(), 50);
        assert_eq!(history_labels(&view).first().unwrap(), "A: line 6");
        assert_eq!(history_labels(&view).last().unwrap(), "B: next scene");

        let _ = std::fs::remove_dir_all(d);
    }

    #[test]
    fn dialogue_history_ignores_stale_queue_tokens() {
        let d = dialogue_history_fixture_resources(3);
        let mut engine = GameEngine::new_started(d.clone()).unwrap();
        let stale = token_from(&engine.view());

        let after_first = engine.advance_dialogue(stale.clone()).unwrap();
        assert_eq!(
            history_labels(&after_first),
            vec!["A: line 0", "narration: action 1"]
        );

        let after_stale = engine.advance_dialogue(stale).unwrap();
        assert_eq!(
            history_labels(&after_stale),
            vec!["A: line 0", "narration: action 1"]
        );

        let _ = std::fs::remove_dir_all(d);
    }

    #[test]
    fn dialogue_history_resets_on_scene_jump() {
        let d = scene_jump_fixture_resources();
        let mut engine = GameEngine::new_started(d.clone()).unwrap();
        assert_eq!(history_labels(&engine.view()), vec!["A: linear start"]);

        let view = engine
            .jump_to_scene("chapter_1", "investigation_scene_1")
            .unwrap();

        assert_eq!(history_labels(&view), vec!["B: investigation intro"]);

        let _ = std::fs::remove_dir_all(d);
    }
```

In the existing `failed_scene_advance_keeps_previous_dialogue_view` test, add this assertion after `let before = engine.view();`:

```rust
        assert_eq!(history_labels(&before), vec!["A: before"]);
```

And add this assertion after `let after = engine.view();`:

```rust
        assert_eq!(history_labels(&after), vec!["A: before"]);
```

Expected failing result:

```bash
cargo test --manifest-path apps/game/src-tauri/Cargo.toml dialogue_history -- --nocapture
```

Expected: compile fails because `DialogueHistoryEntry` and `GameStateView.dialogue_history` do not exist yet.

- [ ] **Step 2: Add history wire types**

In `apps/game/src-tauri/src/game/view.rs`, change the `GameStateView` struct to include `dialogue_history`:

```rust
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GameStateView {
    pub mode: ModeView,
    pub chapter: ChapterView,
    pub scene: SceneView,
    pub inventory: Inventory,
    pub dialogue_history: Vec<DialogueHistoryEntry>,
}
```

In the same file, add this enum after `GameStateView`:

```rust
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum DialogueHistoryEntry {
    Line {
        id: u64,
        speaker: String,
        text: String,
        chapter_title: String,
        scene_title: String,
    },
    Action {
        id: u64,
        text: String,
        chapter_title: String,
        scene_title: String,
    },
}
```

- [ ] **Step 3: Add engine storage and snapshots**

In `apps/game/src-tauri/src/game/mod.rs`, extend the `use view::{ ... }` import list with `DialogueHistoryEntry`.

Add this constant near the existing fallback text constants:

```rust
const DIALOGUE_HISTORY_LIMIT: usize = 50;
```

Extend `GameEngine`:

```rust
pub struct GameEngine {
    resources_dir: PathBuf,
    chapters: Vec<ChapterManifest>,
    current_chapter_idx: usize,
    current_scene_idx: usize,
    scene: SceneRuntime,
    last_visual_cue: LastVisualCue,
    inventory: Inventory,
    next_queue_gen: u64,
    dialogue_history: Vec<DialogueHistoryEntry>,
    next_dialogue_history_id: u64,
    last_recorded_dialogue_token: Option<QueueToken>,
}
```

Extend `GameSnapshot`:

```rust
struct GameSnapshot {
    current_chapter_idx: usize,
    current_scene_idx: usize,
    scene: SceneRuntime,
    last_visual_cue: LastVisualCue,
    inventory: Inventory,
    next_queue_gen: u64,
    dialogue_history: Vec<DialogueHistoryEntry>,
    next_dialogue_history_id: u64,
    last_recorded_dialogue_token: Option<QueueToken>,
}
```

Update every manual `GameEngine { ... }` literal in `apps/game/src-tauri/src/game/mod.rs` tests by adding:

```rust
            dialogue_history: vec![],
            next_dialogue_history_id: 1,
            last_recorded_dialogue_token: None,
```

- [ ] **Step 4: Implement recording helpers**

In `impl GameEngine`, add these helpers near `view(&self)`:

```rust
    fn view_with_history(&mut self) -> GameStateView {
        self.record_current_dialogue_history();
        self.view()
    }

    fn record_current_dialogue_history(&mut self) {
        let Some(token) = self.current_queue_token() else {
            return;
        };
        if self.last_recorded_dialogue_token.as_ref() == Some(&token) {
            return;
        }
        let Some(item) = self.current_dialogue_item() else {
            return;
        };

        let id = self.next_dialogue_history_id;
        let chapter_title = self.chapters[self.current_chapter_idx.min(self.chapters.len() - 1)]
            .title
            .clone();
        let scene_title = self.current_scene_title();
        let entry = match item {
            DialogueItem::Line {
                speaker,
                text,
                portrait: _,
            } => DialogueHistoryEntry::Line {
                id,
                speaker,
                text,
                chapter_title,
                scene_title,
            },
            DialogueItem::Action { text } => DialogueHistoryEntry::Action {
                id,
                text,
                chapter_title,
                scene_title,
            },
            DialogueItem::SceneTag { .. } => return,
        };

        self.next_dialogue_history_id += 1;
        self.last_recorded_dialogue_token = Some(token);
        self.dialogue_history.push(entry);
        let overflow = self.dialogue_history.len().saturating_sub(DIALOGUE_HISTORY_LIMIT);
        if overflow > 0 {
            self.dialogue_history.drain(0..overflow);
        }
    }

    fn current_dialogue_item(&self) -> Option<DialogueItem> {
        match &self.scene {
            SceneRuntime::Linear(s) => s.current().cloned(),
            SceneRuntime::Investigation(inv) => inv
                .pending_queue
                .as_ref()
                .and_then(|q| q.items.get(q.cursor).cloned()),
            SceneRuntime::Interrogation(scene) => scene
                .pending_queue
                .as_ref()
                .and_then(|q| q.items.get(q.cursor).cloned()),
        }
    }

    fn current_scene_title(&self) -> String {
        match &self.scene {
            SceneRuntime::Linear(s) => s.title.clone(),
            SceneRuntime::Investigation(inv) => inv.title().to_string(),
            SceneRuntime::Interrogation(scene) => scene.title().to_string(),
        }
    }
```

`InvestigationSceneState` and `InterrogationSceneState` already expose
`title()`, so no scene-state file split is needed for this helper.

- [ ] **Step 5: Wire history into lifecycle and view output**

In `new_started`, initialize the new fields:

```rust
            dialogue_history: vec![],
            next_dialogue_history_id: 1,
            last_recorded_dialogue_token: None,
```

Then record after priming:

```rust
        engine.prime_initial_queue()?;
        engine.record_current_dialogue_history();
        Ok(engine)
```

In `jump_to_scene`, reset history before priming the selected scene:

```rust
        self.dialogue_history = vec![];
        self.next_dialogue_history_id = 1;
        self.last_recorded_dialogue_token = None;
```

Inside the `jump_to_scene` result closure, return `self.view_with_history()`:

```rust
        let result = (|| -> Result<GameStateView, GameError> {
            self.prime_initial_queue()?;
            Ok(self.view_with_history())
        })();
```

In `view(&self)`, include the new field:

```rust
            dialogue_history: self.dialogue_history.clone(),
```

In `snapshot(&self)`, include:

```rust
            dialogue_history: self.dialogue_history.clone(),
            next_dialogue_history_id: self.next_dialogue_history_id,
            last_recorded_dialogue_token: self.last_recorded_dialogue_token.clone(),
```

In `restore_snapshot`, include:

```rust
        self.dialogue_history = snapshot.dialogue_history;
        self.next_dialogue_history_id = snapshot.next_dialogue_history_id;
        self.last_recorded_dialogue_token = snapshot.last_recorded_dialogue_token;
```

Replace successful command returns that currently use `Ok(self.view())` after a state mutation with:

```rust
Ok(self.view_with_history())
```

The replacements must include `advance_dialogue`, `inspect_hotspot`, `interview_topic`, `enter_sublocation`, `reexamine_evidence`, `reexamine_statement`, `answer_interrogation_question`, `press_testimony_statement`, and `present_testimony_item`.

- [ ] **Step 6: Run focused Rust tests**

Run:

```bash
cargo test --manifest-path apps/game/src-tauri/Cargo.toml dialogue_history -- --nocapture
```

Expected: all `dialogue_history_*` tests pass.

Run the rollback test touched in this task:

```bash
cargo test --manifest-path apps/game/src-tauri/Cargo.toml failed_scene_advance_keeps_previous_dialogue_view -- --nocapture
```

Expected: pass.

- [ ] **Step 7: Commit backend history contract**

```bash
git add apps/game/src-tauri/src/game/view.rs apps/game/src-tauri/src/game/mod.rs apps/game/src-tauri/src/game/scenes/interrogation.rs
git commit -m "feat: record dialogue history in engine"
```

---

### Task 2: Add Frontend Types And Transcript Panel

**Files:**
- Modify: `apps/game/src/lib/state/types.ts`
- Create: `apps/game/src/lib/components/DialogueHistoryPanel.svelte`
- Create: `apps/game/src/lib/components/DialogueHistoryPanel.test.ts`

- [ ] **Step 1: Add failing component tests for transcript rendering**

Create `apps/game/src/lib/components/DialogueHistoryPanel.test.ts`:

```ts
import { render, screen } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import DialogueHistoryPanel from "./DialogueHistoryPanel.svelte";
import type { DialogueHistoryEntry } from "../state/types";

const history: DialogueHistoryEntry[] = [
  {
    id: 1,
    kind: "line",
    speaker: "相馬律",
    text: "雨聲太乾淨了。",
    chapterTitle: "雨夜的第一份證詞",
    sceneTitle: "Opening",
  },
  {
    id: 2,
    kind: "action",
    text: "他把錄音筆放回口袋。",
    chapterTitle: "雨夜的第一份證詞",
    sceneTitle: "Opening",
  },
];

describe("DialogueHistoryPanel", () => {
  it("renders spoken lines and narration in play order", () => {
    render(DialogueHistoryPanel, { history, onClose: vi.fn() });

    const entries = screen.getAllByRole("listitem");
    expect(entries).toHaveLength(2);
    expect(entries[0]).toHaveTextContent("相馬律");
    expect(entries[0]).toHaveTextContent("雨聲太乾淨了。");
    expect(entries[1]).toHaveTextContent("敘述");
    expect(entries[1]).toHaveTextContent("他把錄音筆放回口袋。");
  });

  it("renders an empty state when no entries are available", () => {
    render(DialogueHistoryPanel, { history: [], onClose: vi.fn() });

    expect(screen.getByText("尚無對話紀錄")).toBeInTheDocument();
  });

  it("calls onClose from the close button", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(DialogueHistoryPanel, { history, onClose });

    await user.click(screen.getByRole("button", { name: "關閉對話紀錄" }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("traps Tab focus between panel controls", async () => {
    const user = userEvent.setup();
    render(DialogueHistoryPanel, { history, onClose: vi.fn() });

    const closeButton = screen.getByRole("button", { name: "關閉對話紀錄" });
    await user.tab();
    expect(closeButton).toHaveFocus();

    await user.tab();
    expect(closeButton).toHaveFocus();

    await user.keyboard("{Shift>}{Tab}{/Shift}");
    expect(closeButton).toHaveFocus();
  });
});
```

Run:

```bash
bun run --cwd apps/game test src/lib/components/DialogueHistoryPanel.test.ts
```

Expected: fail because the component and type do not exist.

- [ ] **Step 2: Add TypeScript history types**

In `apps/game/src/lib/state/types.ts`, add this type after `DialogueItem`:

```ts
export type DialogueHistoryEntry =
  | {
      id: number;
      kind: "line";
      speaker: string;
      text: string;
      chapterTitle: string;
      sceneTitle: string;
    }
  | {
      id: number;
      kind: "action";
      text: string;
      chapterTitle: string;
      sceneTitle: string;
    };
```

Add `dialogueHistory` to `GameStateView`:

```ts
export type GameStateView = {
  mode: Mode;
  chapter: ChapterView;
  scene: SceneView;
  inventory: Inventory;
  dialogueHistory: DialogueHistoryEntry[];
};
```

- [ ] **Step 3: Create `DialogueHistoryPanel.svelte`**

Create `apps/game/src/lib/components/DialogueHistoryPanel.svelte`:

```svelte
<script lang="ts">
  import { onMount, tick } from "svelte";
  import type { DialogueHistoryEntry } from "../state/types";

  let {
    history,
    onClose,
  }: {
    history: DialogueHistoryEntry[];
    onClose: () => void;
  } = $props();

  let panel: HTMLDivElement | undefined = $state();
  let closeButton: HTMLButtonElement | undefined = $state();

  const focusableSelector = [
    "button:not(:disabled)",
    "[href]",
    "input:not(:disabled)",
    "select:not(:disabled)",
    "textarea:not(:disabled)",
    '[tabindex]:not([tabindex="-1"])',
  ].join(",");

  onMount(() => {
    void tick().then(() => closeButton?.focus());
  });

  function handleKeydown(event: KeyboardEvent) {
    if (event.key !== "Tab" || !panel) return;

    const focusableElements = Array.from(
      panel.querySelectorAll<HTMLElement>(focusableSelector),
    ).filter((element) => {
      const style = getComputedStyle(element);
      return style.display !== "none" && style.visibility !== "hidden";
    });

    if (focusableElements.length === 0) {
      event.preventDefault();
      panel.focus();
      return;
    }

    const firstElement = focusableElements[0];
    const lastElement = focusableElements.at(-1);

    if (event.shiftKey && document.activeElement === firstElement) {
      event.preventDefault();
      lastElement?.focus();
      return;
    }

    if (!event.shiftKey && document.activeElement === lastElement) {
      event.preventDefault();
      firstElement.focus();
    }
  }
</script>

<div
  bind:this={panel}
  class="history-panel"
  role="dialog"
  aria-modal="false"
  aria-labelledby="dialogue-history-title"
  tabindex="-1"
  onkeydown={handleKeydown}
>
  <header>
    <div>
      <p class="eyebrow">LOG</p>
      <h2 id="dialogue-history-title">對話紀錄</h2>
    </div>
    <button
      bind:this={closeButton}
      class="close-button"
      type="button"
      aria-label="關閉對話紀錄"
      onclick={onClose}
    >
      CLOSE
    </button>
  </header>

  {#if history.length === 0}
    <p class="empty">尚無對話紀錄</p>
  {:else}
    <ol class="history-list">
      {#each history as entry (entry.id)}
        <li>
          {#if entry.kind === "line"}
            <p class="speaker">{entry.speaker}</p>
            <p class="text">{entry.text}</p>
          {:else}
            <p class="speaker narration">敘述</p>
            <p class="text">{entry.text}</p>
          {/if}
        </li>
      {/each}
    </ol>
  {/if}
</div>

<style>
  .history-panel {
    position: fixed;
    left: 50%;
    bottom: 170px;
    z-index: 35;
    width: min(900px, calc(100vw - 56px));
    max-height: min(460px, calc(100dvh - 220px));
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    gap: 18px;
    padding: 20px;
    overflow: hidden;
    transform: translateX(-50%);
    border: 1px solid var(--rule-strong);
    background: rgba(8, 8, 14, 0.96);
    color: var(--bone);
    box-shadow: 0 22px 70px rgba(0, 0, 0, 0.52);
  }

  header {
    display: flex;
    align-items: start;
    justify-content: space-between;
    gap: 16px;
  }

  h2,
  p {
    margin: 0;
  }

  h2 {
    font-family: var(--display-jp);
    font-weight: 400;
    font-size: 24px;
    line-height: 1;
    letter-spacing: 0.06em;
  }

  .eyebrow,
  .close-button {
    font-family: var(--impact);
    font-size: 10px;
    letter-spacing: 0.24em;
    color: var(--crimson);
  }

  .close-button {
    min-height: 34px;
    padding: 8px 10px;
    border: 1px solid var(--rule-strong);
    background: rgba(236, 228, 207, 0.04);
    color: var(--bone);
    cursor: pointer;
  }

  .close-button:hover,
  .close-button:focus-visible {
    border-color: var(--crimson);
    background: var(--crimson-soft);
  }

  .history-list {
    min-height: 0;
    margin: 0;
    padding: 0;
    overflow-y: auto;
    list-style: none;
    display: grid;
    align-content: end;
    gap: 12px;
  }

  li {
    display: grid;
    gap: 4px;
    padding: 12px 0;
    border-top: 1px solid rgba(236, 228, 207, 0.12);
  }

  .speaker {
    font-family: var(--impact);
    font-size: 11px;
    letter-spacing: 0.18em;
    color: var(--cyan);
  }

  .speaker.narration {
    color: var(--bone-faint);
  }

  .text,
  .empty {
    font-family: var(--serif-jp);
    font-size: 15px;
    line-height: 1.65;
    color: var(--bone);
  }

  .empty {
    color: var(--bone-dim);
  }

  @media (max-width: 720px) {
    .history-panel {
      bottom: 150px;
      width: min(900px, calc(100vw - 36px));
      max-height: min(440px, calc(100dvh - 190px));
      padding: 18px;
    }
  }
</style>
```

- [ ] **Step 4: Run panel tests**

Run:

```bash
bun run --cwd apps/game test src/lib/components/DialogueHistoryPanel.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit frontend panel**

```bash
git add apps/game/src/lib/state/types.ts apps/game/src/lib/components/DialogueHistoryPanel.svelte apps/game/src/lib/components/DialogueHistoryPanel.test.ts
git commit -m "feat: add dialogue history panel"
```

---

### Task 3: Integrate History Into DialogueBox

**Files:**
- Modify: `apps/game/src/lib/components/DialogueBox.svelte`
- Modify: `apps/game/src/lib/components/DialogueBox.test.ts`
- Modify: `apps/game/src/routes/+page.svelte`

- [ ] **Step 1: Add failing DialogueBox tests**

In `apps/game/src/lib/components/DialogueBox.test.ts`, update imports:

```ts
import {
  claimEscape,
  closeTopmostEscapeClaim,
  resetEscapeCoordinator,
} from "$lib/state/escape-coordinator";
import type { DialogueHistoryEntry, DialogueItem, QueueToken } from "../state/types";
```

Change the existing `afterEach` block to reset escape claims:

```ts
  afterEach(() => {
    vi.unstubAllGlobals();
    resetEscapeCoordinator();
  });
```

Add this test history near `const token`:

```ts
const history: DialogueHistoryEntry[] = [
  {
    id: 1,
    kind: "line",
    speaker: "若月",
    text: "你好。",
    chapterTitle: "Chapter",
    sceneTitle: "Scene",
  },
  {
    id: 2,
    kind: "action",
    text: "雨聲壓過車流。",
    chapterTitle: "Chapter",
    sceneTitle: "Scene",
  },
];
```

Update `renderDialogueBox` so tests can pass history:

```ts
function renderDialogueBox(
  current: DialogueItem,
  overrides?: {
    disabled?: boolean;
    onAdvanceFeedback?: () => void;
    history?: DialogueHistoryEntry[];
  },
) {
  const onAdvance = vi.fn();
  const result = render(DialogueBox, {
    current,
    queueToken: token,
    onAdvance,
    history: overrides?.history ?? [],
    disabled: overrides?.disabled,
    onAdvanceFeedback: overrides?.onAdvanceFeedback,
  });
  return { onAdvance, ...result };
}
```

Add these tests:

```ts
  it("opens dialogue history from the LOG button", async () => {
    const user = userEvent.setup();
    renderDialogueBox(
      { kind: "line", speaker: "若月", text: "你好。" },
      { history },
    );

    await user.click(screen.getByRole("button", { name: "開啟對話紀錄" }));

    expect(screen.getByRole("dialog", { name: "對話紀錄" })).toBeInTheDocument();
    expect(screen.getByText("若月")).toBeInTheDocument();
    expect(screen.getByText("雨聲壓過車流。")).toBeInTheDocument();
  });

  it("toggles dialogue history with L when focus is not inside a control", () => {
    renderDialogueBox(
      { kind: "line", speaker: "若月", text: "你好。" },
      { history },
    );

    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "l", bubbles: true }),
    );

    expect(screen.getByRole("dialog", { name: "對話紀錄" })).toBeInTheDocument();

    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "L", bubbles: true }),
    );

    expect(screen.queryByRole("dialog", { name: "對話紀錄" })).toBeNull();
  });

  it("does not toggle dialogue history with L while another control is focused", () => {
    renderDialogueBox(
      { kind: "line", speaker: "若月", text: "你好。" },
      { history },
    );
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();

    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "l", bubbles: true }),
    );

    input.remove();
    expect(screen.queryByRole("dialog", { name: "對話紀錄" })).toBeNull();
  });

  it("does not advance with Space or Enter while dialogue history is open", async () => {
    const user = userEvent.setup();
    const { onAdvance } = renderDialogueBox(
      { kind: "line", speaker: "若月", text: "你好。" },
      { history },
    );

    await user.click(screen.getByRole("button", { name: "開啟對話紀錄" }));
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: " ", bubbles: true }),
    );
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );

    expect(onAdvance).not.toHaveBeenCalled();
  });

  it("registers an Escape claim while dialogue history is open", async () => {
    const user = userEvent.setup();
    renderDialogueBox(
      { kind: "line", speaker: "若月", text: "你好。" },
      { history },
    );

    await user.click(screen.getByRole("button", { name: "開啟對話紀錄" }));
    expect(screen.getByRole("dialog", { name: "對話紀錄" })).toBeInTheDocument();

    expect(closeTopmostEscapeClaim()).toBe(true);

    expect(screen.queryByRole("dialog", { name: "對話紀錄" })).toBeNull();
    expect(screen.getByRole("button", { name: "開啟對話紀錄" })).toHaveFocus();
  });

  it("does not release another overlay claim when dialogue history closes", async () => {
    const user = userEvent.setup();
    const otherCloser = vi.fn();
    claimEscape(otherCloser);
    renderDialogueBox(
      { kind: "line", speaker: "若月", text: "你好。" },
      { history },
    );

    await user.click(screen.getByRole("button", { name: "開啟對話紀錄" }));
    await user.click(screen.getByRole("button", { name: "關閉對話紀錄" }));

    expect(closeTopmostEscapeClaim()).toBe(true);
    expect(otherCloser).toHaveBeenCalledTimes(1);
  });
```

Update the existing click tests in `DialogueBox.test.ts` so they target the
named advance control instead of the first button on the page:

```ts
    await user.click(screen.getByRole("button", { name: "推進對話" }));
```

Make this replacement in:

- `calls onAdvance with queueToken on click`
- `plays advance feedback before dispatching advance on click`
- `plays advance feedback even when command dispatch is disabled`

Run:

```bash
bun run --cwd apps/game test src/lib/components/DialogueBox.test.ts
```

Expected: fail because `DialogueBox` has no `history` prop or log controls.

- [ ] **Step 2: Integrate the panel into `DialogueBox.svelte`**

In `apps/game/src/lib/components/DialogueBox.svelte`, update imports:

```ts
  import { tick } from "svelte";
  import { claimEscape } from "$lib/state/escape-coordinator";
  import DialogueHistoryPanel from "./DialogueHistoryPanel.svelte";
  import type {
    DialogueHistoryEntry,
    DialogueItem,
    QueueToken,
  } from "../state/types";
```

Update props:

```ts
  let {
    current,
    queueToken,
    history = [],
    onAdvance,
    onAdvanceFeedback,
    disabled = false,
  }: {
    current: DialogueItem;
    queueToken: QueueToken;
    history?: DialogueHistoryEntry[];
    onAdvance: (t: QueueToken) => void;
    onAdvanceFeedback?: () => void;
    disabled?: boolean;
  } = $props();
```

Add state and helpers after `let portraitAsset`:

```ts
  let historyOpen = $state(false);
  let logButton: HTMLButtonElement | undefined = $state();

  function isInteractiveElement(element: Element | null) {
    if (!(element instanceof HTMLElement)) return false;
    return Boolean(
      element.closest(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      ),
    );
  }

  function openHistory() {
    historyOpen = true;
  }

  function closeHistory() {
    if (!historyOpen) return;
    historyOpen = false;
    void tick().then(() => logButton?.focus());
  }

  function toggleHistory() {
    if (historyOpen) {
      closeHistory();
    } else {
      openHistory();
    }
  }
```

Add this effect after the portrait-loading effect:

```ts
  $effect(() => {
    if (!historyOpen) return;
    return claimEscape(closeHistory);
  });
```

Update `handleKey` so it handles `L` and blocks advance while the log is open:

```ts
  function handleKey(e: KeyboardEvent) {
    if (e.repeat) return;

    if (e.key === "l" || e.key === "L") {
      if (isInteractiveElement(document.activeElement)) return;
      e.preventDefault();
      toggleHistory();
      return;
    }

    if (e.key !== " " && e.key !== "Enter") return;
    if (historyOpen) {
      e.preventDefault();
      return;
    }
    const active = document.activeElement;
    if (active && active !== document.body) return;
    e.preventDefault();
    onAdvanceFeedback?.();
    if (disabled) return;
    onAdvance(queueToken);
  }
```

Add a local keyboard handler for the focusable dialogue control:

```ts
  function handleBoxKeydown(e: KeyboardEvent) {
    if (e.repeat) return;
    if (e.key !== " " && e.key !== "Enter") return;
    e.preventDefault();
    if (historyOpen) return;
    onAdvanceFeedback?.();
    if (disabled) return;
    onAdvance(queueToken);
  }
```

Add the panel before the dialogue `.wrapper`:

```svelte
{#if historyOpen}
  <DialogueHistoryPanel history={history} onClose={closeHistory} />
{/if}
```

Add the `LOG` button inside `.box`, before the `{#if current.kind === ...}` block:

```svelte
    <button
      bind:this={logButton}
      class="log-button"
      type="button"
      aria-label="開啟對話紀錄"
      aria-pressed={historyOpen}
      onclick={(event) => {
        event.stopPropagation();
        toggleHistory();
      }}
    >
      LOG
    </button>
```

Because nested buttons are invalid HTML, change the outer dialogue advance control from `<button class="box" ...>` to a focusable `<div class="box" role="button" tabindex="0" ...>`. Use this opening tag:

```svelte
  <div
    class="box"
    class:scene={current.kind === "sceneTag"}
    class:action={current.kind === "action"}
    class:line={current.kind === "line"}
    role="button"
    tabindex="0"
    onclick={handleClick}
    onkeydown={handleBoxKeydown}
    aria-label="推進對話"
    aria-disabled={disabled}
  >
```

And replace the closing `</button>` with:

```svelte
  </div>
```

Add CSS for the log button:

```css
  .log-button {
    position: absolute;
    top: 12px;
    right: 18px;
    z-index: 1;
    min-height: 30px;
    padding: 6px 9px;
    border: 1px solid var(--rule-strong);
    background: rgba(236, 228, 207, 0.04);
    color: var(--bone);
    font-family: var(--impact);
    font-size: 10px;
    letter-spacing: 0.2em;
    cursor: pointer;
  }

  .log-button:hover,
  .log-button:focus-visible,
  .log-button[aria-pressed="true"] {
    border-color: var(--crimson);
    background: var(--crimson-soft);
  }
```

Update `.hint` so it does not collide with the `LOG` button:

```css
  .hint {
    position: absolute;
    right: 22px;
    bottom: 10px;
```

Keep the existing values for the rest of `.hint`.

- [ ] **Step 3: Pass history from the page**

In `apps/game/src/routes/+page.svelte`, update the `DialogueBox` call:

```svelte
      <DialogueBox
        current={gameState.value.mode.current}
        queueToken={gameState.value.mode.queueToken}
        history={gameState.value.dialogueHistory}
        onAdvance={advanceDialogue}
        onAdvanceFeedback={() => playGameplaySfxEvent("ui:menu-confirm")}
        disabled={gameState.inFlight}
      />
```

- [ ] **Step 4: Run focused DialogueBox tests**

Run:

```bash
bun run --cwd apps/game test src/lib/components/DialogueBox.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit DialogueBox integration**

```bash
git add apps/game/src/lib/components/DialogueBox.svelte apps/game/src/lib/components/DialogueBox.test.ts apps/game/src/routes/+page.svelte
git commit -m "feat: open dialogue history from dialogue box"
```

---

### Task 4: Fix Typed Fixtures And Run Frontend Checks

**Files:**
- Modify: `apps/game/src/lib/components/GameShell.test.ts`
- Modify: `apps/game/src/lib/audio/sfx-events.test.ts`
- Modify: `apps/game/src/routes/page.test.ts`
- Modify: `apps/game/src/lib/components/SceneNavigationPanel.test.ts`
- Modify: `apps/game/src/lib/state/game-client-source.test.ts`

- [ ] **Step 1: Run frontend type-check to find missing `dialogueHistory` fields**

Run:

```bash
bun run check
```

Expected: fail if any `GameStateView` literal is missing `dialogueHistory`.

- [ ] **Step 2: Update `GameShell.test.ts` fixture**

In `apps/game/src/lib/components/GameShell.test.ts`, update the `state()` helper return value:

```ts
  return {
    chapter: {
      id: "chapter_1",
      title: "雨夜的第一份證詞",
      summary: "案件摘要",
      index: 0,
      total: 3,
    },
    scene: { kind: "linear", id: "scene_1", title: "", index: 0, total: 1 },
    mode,
    inventory: { evidence: [], statements: [] },
    dialogueHistory: [],
  };
```

- [ ] **Step 3: Update the remaining typed fixture helpers**

In `apps/game/src/lib/audio/sfx-events.test.ts`, update the `state()` helper
return value by adding the field before `...overrides`:

```ts
    inventory: { evidence: [], statements: [] },
    dialogueHistory: [],
    ...overrides,
```

In `apps/game/src/lib/state/game-client-source.test.ts`, update the `state()`
helper return value:

```ts
    inventory: { evidence: [], statements: [] },
    dialogueHistory: [],
  };
```

In `apps/game/src/routes/page.test.ts`, update `currentState()`,
`gameCompleteState()`, and `jumpedState()` by adding:

```ts
dialogueHistory: [],
```

Place it beside the existing `inventory` field in each returned object.

In `apps/game/src/lib/components/SceneNavigationPanel.test.ts`, update
`currentState()` and both local `gameCompleteState` object literals by adding:

```ts
dialogueHistory: [],
```

Place it beside the existing `inventory` field. Do not add client-side history
construction to tests. Only satisfy the new required wire field.

- [ ] **Step 4: Run frontend checks and focused tests**

Run:

```bash
bun run --cwd apps/game test src/lib/components/DialogueHistoryPanel.test.ts src/lib/components/DialogueBox.test.ts src/lib/components/GameShell.test.ts
```

Expected: pass.

Run:

```bash
bun run check
```

Expected: pass.

- [ ] **Step 5: Commit typed fixture cleanup**

```bash
git add apps/game/src/lib/components/GameShell.test.ts
git add apps/game/src
git commit -m "test: update game state fixtures for dialogue history"
```

---

### Task 5: Final Verification

**Files:**
- No new files.
- Verify all files changed by Tasks 1-4.

- [ ] **Step 1: Run Rust history and rollback tests**

Run:

```bash
cargo test --manifest-path apps/game/src-tauri/Cargo.toml dialogue_history -- --nocapture
```

Expected: pass.

Run:

```bash
cargo test --manifest-path apps/game/src-tauri/Cargo.toml failed_scene_advance_keeps_previous_dialogue_view -- --nocapture
```

Expected: pass.

- [ ] **Step 2: Run frontend focused tests**

Run:

```bash
bun run --cwd apps/game test src/lib/components/DialogueHistoryPanel.test.ts src/lib/components/DialogueBox.test.ts src/lib/components/GameShell.test.ts
```

Expected: pass.

- [ ] **Step 3: Run frontend type-check**

Run:

```bash
bun run check
```

Expected: pass.

- [ ] **Step 4: Run broader Rust test suite for the game shell**

Run:

```bash
cargo test --manifest-path apps/game/src-tauri/Cargo.toml
```

Expected: pass.

- [ ] **Step 5: Inspect final diff**

Run:

```bash
git status --short
git diff --stat HEAD
```

Expected: only intentional dialogue-history files remain uncommitted. If Tasks 1-4 were committed exactly as written, `git status --short` should be clean.

- [ ] **Step 6: Final commit if verification changed files**

If Step 5 shows uncommitted verification-driven fixes, commit them:

```bash
git add apps/game/src-tauri/src/game apps/game/src/lib apps/game/src/routes
git commit -m "fix: finish dialogue history verification"
```

Expected: commit succeeds, or no commit is needed because the worktree is clean.

---

## Self-Review Notes

- Spec coverage: backend-owned history, 50-entry cap, line/action inclusion, sceneTag exclusion, scene-transition persistence, scene-jump reset, `LOG` button, `L` shortcut, Escape precedence, focus behavior, and focused verification are covered by Tasks 1-5.
- Scope check: this is a single runtime/frontend feature. It does not introduce save-file persistence, audio replay, authoring changes, compiler changes, or Escape-menu history access.
- Type consistency: Rust uses `dialogue_history` with serde camelCase; TypeScript uses `dialogueHistory`. Rust enum variants serialize as `kind: "line" | "action"` and match the TypeScript union.

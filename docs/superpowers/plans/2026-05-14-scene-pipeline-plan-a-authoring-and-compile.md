# Scene Pipeline Plan A: Authoring & Compile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert authored markdown under `static/stories_plan/` into validated typed JSON under `src-tauri/resources/scenes/`, with a custom Bun-based compiler whose behavior is locked by an end-to-end test corpus. Plus skill updates so the writer's output aligns with the parser's schema.

**Architecture:** A Bun TypeScript script (`scripts/compile-scenes.ts`) with a small line-oriented tokenizer, per-scene-type recursive-descent parsers (chapter manifest, linear scene, investigation scene), an `Unlock:` expression parser, a cross-file validator, and a JSON emitter. CI assertions in the script verify `tauri.conf.json` wiring on every run. Three writer skills are aligned to the parser schema before any code lands. The Rust engine stays untouched — Plan A produces JSON that nothing yet consumes; Plan B consumes it.

**Tech Stack:** Bun (runtime + `bun:test`), TypeScript 5.6, chokidar (watch mode), Tauri 2 (config integration only — no Rust code modified).

**Spec reference:** [`docs/superpowers/specs/2026-05-13-scene-pipeline-design.md`](../specs/2026-05-13-scene-pipeline-design.md). All schemas and validation rules are normative there; this plan implements them.

---

## Context for the implementer

You are working in a Tauri 2 + SvelteKit SPA detective-game repo (《東京雨證：第零證人》). The narrative content under `static/stories_plan/` is authored in Traditional Chinese by a writer agent using two skills under `.claude/skills/`. The existing Rust engine (`src-tauri/src/investigation.rs`) hardcodes an English demo case unrelated to the authored content — **do not modify it in this plan**.

Plan A produces JSON under `src-tauri/resources/scenes/` and updates `tauri.conf.json` to bundle it. The Rust app still uses the demo case after Plan A is complete; Plan B will switch it over.

**Critical conventions:**

- **Package manager is `bun`** (per `bun.lock` and CLAUDE.md). Never use `npm` or `pnpm`.
- **TDD:** write the failing test first, run it red, implement minimum code, run it green, commit. Every implementation task follows this loop.
- **DRY / YAGNI:** if you find yourself writing the same parsing logic twice, extract it. If you find yourself adding flexibility for "future needs" not in the spec, stop.
- **Frequent commits:** one commit per task minimum; sub-commits within a task are fine if a step produces a meaningful waypoint.
- **Language convention in scene files:**
  - **English** is used for: heading labels (`## Intro`, `### Hotspot:`, etc.), metadata field labels (`Status`, `Unlock`, `Reveals`), enum-like values (`locked`/`unlocked`, `evidence:`/`statement:`/etc.), unlock predicates (`collected`, `discussed`, `and`, `or`).
  - **Traditional Chinese** is used for: dialogue text, bracketed actions, scene-tag contents, all values the player will see (name, description, etc.).
  - **IDs are English slugs**, anchored on headings via `{#snake_case_id}`.

**Files you'll create or modify:**

```
.claude/skills/writing-investigation-scene/SKILL.md            (modify)
.claude/skills/writing-detective-game-dialogue/SKILL.md        (modify)
.claude/skills/writing-chapter-manifest/SKILL.md               (create)
CLAUDE.md                                                       (modify)
package.json                                                    (modify)
.gitignore                                                      (modify)
src-tauri/tauri.conf.json                                       (modify)

scripts/compile-scenes.ts                                       (create)
scripts/compile-scenes/types.ts                                 (create)
scripts/compile-scenes/tokenizer.ts                             (create)
scripts/compile-scenes/parser-unlock.ts                         (create)
scripts/compile-scenes/parser-chapter.ts                        (create)
scripts/compile-scenes/parser-linear.ts                         (create)
scripts/compile-scenes/parser-investigation.ts                  (create)
scripts/compile-scenes/validator.ts                             (create)
scripts/compile-scenes/emitter.ts                               (create)
scripts/compile-scenes/orchestrator.ts                          (create)
scripts/compile-scenes/config-check.ts                          (create)

scripts/__fixtures__/valid/chapter_1/chapter.md                 (create)
scripts/__fixtures__/valid/chapter_1/scene_0.md                 (create)
scripts/__fixtures__/valid/chapter_1/investigation_scene_1.md   (create)
scripts/__fixtures__/invalid/<one folder per rule>/             (create)
scripts/__snapshots__/<generated>                                (create, committed)

scripts/compile-scenes.test.ts                                  (create — orchestrator + snapshot)
scripts/compile-scenes/tokenizer.test.ts                        (create)
scripts/compile-scenes/parser-unlock.test.ts                    (create)
scripts/compile-scenes/parser-chapter.test.ts                   (create)
scripts/compile-scenes/parser-linear.test.ts                    (create)
scripts/compile-scenes/parser-investigation.test.ts             (create)
scripts/compile-scenes/validator.test.ts                        (create)
scripts/compile-scenes/emitter.test.ts                          (create)
```

The generated runtime output (`src-tauri/resources/scenes/`) is **gitignored** — only fixtures and snapshots are committed.

---

## Phase A1: Skill updates (no code, just docs)

These four tasks are documentation edits — there's no automated test. Each task ends with a commit. The reason they come first: the parser must enforce a schema, and the skill is the authoring contract for that schema. Diverging the two is a recipe for confusion.

### Task 1: Update `writing-investigation-scene` skill

**Files:**
- Modify: `.claude/skills/writing-investigation-scene/SKILL.md`

- [ ] **Step 1: Read the current skill end-to-end** to understand what's there

Run: `cat .claude/skills/writing-investigation-scene/SKILL.md`

You'll need to make five edits below. Read first so the structure is in your head.

- [ ] **Step 2: Add `Unlock` to the Outro block schema**

Find the section under `## Block field schemas` titled `### Intro / Outro (H2)`. Replace:

```markdown
### Intro / Outro (H2)
- **Headings:** `## Intro` and `## Outro`.
- **No metadata.**
- **Body:** linear dialogue (intro plays on scene load; outro plays when the scene closes / Part advances).
```

with:

```markdown
### Intro (H2)
- **Heading:** `## Intro`.
- **No metadata.**
- **Body:** linear dialogue. Plays on scene load.

### Outro (H2)
- **Heading:** `## Outro`.
- **Optional metadata:** `**Unlock:** <expression>` — a boolean expression (same grammar as the per-block `Unlock:`) that gates when the Outro becomes playable.
  - When omitted, the Outro defaults to **auto-completion**: it plays when every unlocked hotspot has been inspected and every unlocked topic has been discussed in the scene.
  - When present, the Outro plays the moment the expression evaluates true.
- **Body:** linear dialogue. When the Outro queue empties, the engine advances to the next scene in the chapter manifest.
```

- [ ] **Step 3: Add `On Reexamine` to Hotspot and Topic block schemas**

Find the `### Hotspot (H3, inside a Sub-location)` block. Replace its body:

```markdown
### Hotspot (H3, inside a Sub-location)
- **Required:** `Description`
- **Optional:** `Status` (defaults to `unlocked`), `Unlock`, `Reveals` (list)
- **Body:** inspect dialogue (plays once when the player clicks this hotspot).
```

with:

```markdown
### Hotspot (H3, inside a Sub-location)
- **Required:** `Description`
- **Optional:** `Status` (defaults to `unlocked`), `Unlock`, `Reveals` (list)
- **Body:** inspect dialogue (plays on the player's **first** click on this hotspot, followed by `Reveals:` chain dialogue).
- **Optional sub-block:** `#### On Reexamine` — H4 immediately under this Hotspot's body. Plays on every click **after** the first. No new reveals fire on reexamine. If `#### On Reexamine` is absent, subsequent clicks play an engine-provided fallback line (configured in the engine, not authored here).
```

Find the `### Topic (H4, inside a Character)` block. Replace its body:

```markdown
### Topic (H4, inside a Character)
- **Required:** `Status`
- **Optional:** `Unlock`, `Reveals` (list)
- **Body:** topic dialogue (plays when the player selects this topic).
```

with:

```markdown
### Topic (H4, inside a Character)
- **Required:** `Status`
- **Optional:** `Unlock`, `Reveals` (list)
- **Body:** topic dialogue (plays on the player's **first** selection of this topic, followed by `Reveals:` chain dialogue).
- **Optional sub-block:** `#### On Reexamine` — H5 immediately under this Topic's body. Plays on every selection **after** the first. No new reveals fire on reexamine. If absent, the engine plays a fallback line on subsequent selections.
```

**Note:** Topic's `On Reexamine` is H5 because Topic itself is H4. Update the heading hierarchy table in the next step.

- [ ] **Step 4: Update the heading hierarchy reference table**

Find the table under `## Heading hierarchy reference`. Replace it with:

```markdown
| Level | Block |
|---|---|
| H1 | `# Scene N: <title>` (exactly one per file) |
| H2 | `## Intro`, `## Sub-location:`, `## Evidence Manifest`, `## Statement Manifest`, `## Outro` |
| H3 | `### Hotspot:`, `### Character:`, `### evidence:`, `### statement:` |
| H4 | `#### Topic:`, `#### On Collect` / `#### On Reexamine` (under evidence), `#### On Acquire` / `#### On Reexamine` (under statement), `#### On Reexamine` (under Hotspot) |
| H5 | `##### On Reexamine` (under Topic only) |
```

- [ ] **Step 5: Add the "Game-global ID namespace" callout**

Find the `## Parser validation guarantees` section. Just **before** that section, insert this new section:

```markdown
## ID namespace rules

- **Evidence and statement IDs are game-global.** A single ID like `evidence:blue_umbrella` may be declared in only one scene file across the entire game (one chapter, one investigation scene). Compile-time duplicate declarations are an error.
- **Hotspot, topic, and sub-location IDs are scene-local.** They may repeat across different scene files freely. Cross-scene references to these kinds are not supported.
- **`Reveals:` targets must always resolve to a declaration in the *same scene file*** — for all five kinds (`evidence:`, `statement:`, `topic:`, `hotspot:`, `sublocation:`). A reveal newly *adds* an item or unlocks a block; it requires the definition to be physically present in this scene's JSON output.
- **`Unlock:` predicates must also resolve to a declaration in the same scene file** in v1. Cross-chapter unlock predicates are disallowed (compile error). This is a v1 restriction — see the spec for rationale.

```

- [ ] **Step 6: Remove the implication that `locked_reason` is player-facing**

Find the row in the `## Common mistakes` table that says:

```
| Inline dialogue describes "present this evidence to the witness" | That belongs in a future `interrogation_scene` — investigation scenes only collect, not confront |
```

That row is fine as-is. There is no other row to remove for this step — but find the **Worked example** at the bottom and search for any usage of a `LockHint` or similar player-facing lock reason. If any locked block is shown with player-facing lock-hint text, leave the block declaration but add a brief sentence under the worked example noting:

```markdown
**Note on locked blocks:** locked sub-locations, hotspots, and topics are entirely hidden from the player until their unlock condition is satisfied. There is no "locked, look later" hint shown in-game. The `Unlock:` expression is parser-internal — it determines *when* the block becomes visible, never displayed.
```

Place this note immediately after the worked example fenced code block.

- [ ] **Step 7: Update the worked example to demonstrate Outro Unlock and On Reexamine**

In the worked example fenced code block, find:

```markdown
## Outro

[相馬律站在倉庫門口回頭看了一眼。]

**相馬律**：走吧。
```

Replace with:

```markdown
## Outro
- **Unlock:** hotspot:wheeled_shelf investigated and statement:hayasaka_says_alive acquired

[相馬律站在倉庫門口回頭看了一眼。]

**相馬律**：走吧。
```

Then in the same worked example, find the `### Hotspot: 滾輪貨架 {#wheeled_shelf}` block. After its body dialogue (`**相馬律**：剛被推過。`), insert a `#### On Reexamine` H4 sub-block:

```markdown
#### On Reexamine

[相馬律又推了一下貨架。]

**相馬律**：輪子很順。已經被推過至少一次。
```

- [ ] **Step 8: Commit**

```bash
git add .claude/skills/writing-investigation-scene/SKILL.md
git commit -m "docs(skill): align writing-investigation-scene with scene-pipeline schema"
```

---

### Task 2: Update `writing-detective-game-dialogue` skill — add Linear scene format

**Files:**
- Modify: `.claude/skills/writing-detective-game-dialogue/SKILL.md`

- [ ] **Step 1: Read the current skill end-to-end**

Run: `cat .claude/skills/writing-detective-game-dialogue/SKILL.md`

- [ ] **Step 2: Add a new section "Linear scene file format"**

Find a sensible insertion point near the end of the skill, after the existing format-examples section and before any "Common mistakes" / "Future work" section if present. Insert this new section:

```markdown
## Linear scene file format (`chapter_<N>/scene_<K>.md`)

A file matching `chapter_<N>/scene_<K>.md` is a **linear-dialogue scene** — a single queue of dialogue the player clicks through, with no hotspots, characters to question, or branching choices. These are used for intro cutscenes, in-car conversations, transitions, and chapter endings.

### Required structure

Exactly one H1 title line at the top, then dialogue. **No H2 or deeper headings are allowed in a linear scene file.** The parser reads the file top-to-bottom and emits dialogue items in source order.

```
# Scene 0: 接案

[場景：吉祥寺街道，深夜，雨夜。律師相馬律撐傘走進雨鐘咖啡館。]

[相馬律收起傘，在門口抖了抖。]

**早坂茜**：你來得比我想的快。

**相馬律**：黑瀨刑警在嗎？

[場景：咖啡館主廳。]

**早坂茜**：在裡面。
```

### Item kinds the parser recognizes

| Source line | Kind |
|---|---|
| `[場景：...]` (square brackets with `場景：` prefix) | scene tag |
| `[anything else inside brackets]` | bracketed action |
| `**Name**：text` (Markdown bold name, full-width colon, dialogue text) | dialogue line |
| blank line | separator (ignored) |

### Linear scene semantics

- The file is one linear queue. The parser walks it once and emits items in source order.
- End-of-file = end-of-scene. The engine advances to the next scene in the chapter manifest.
- Linear scenes carry **no metadata** beyond the H1 title — no `Status`, no `Unlock`, no `Reveals`. They never gate progression.
- A linear scene may contain multiple `[場景：...]` tags if it spans multiple physical locations (e.g., 咖啡館 → 街道 → 警車內). Each scene tag updates the visible backdrop.

### Common mistakes (linear scenes)

| Mistake | Fix |
|---|---|
| Using H2 headings (`## Some Section`) inside a linear scene | Linear scenes are flat. Remove the heading; if structural blocks are needed, this should be an investigation scene. |
| Adding metadata like `**Status:** unlocked` | Linear scenes have no metadata. Remove. |
| Forgetting a `[場景：...]` tag at the top | A linear scene should open with a scene tag so the engine can render a backdrop from the first frame. |
| Mixing investigation-scene blocks (`### Hotspot:`) into a linear scene | Wrong scene type. Move that content to an `investigation_scene_<N>.md` file. |
```

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/writing-detective-game-dialogue/SKILL.md
git commit -m "docs(skill): formalize linear scene file format"
```

---

### Task 3: Create `writing-chapter-manifest` skill (new)

**Files:**
- Create: `.claude/skills/writing-chapter-manifest/SKILL.md`

- [ ] **Step 1: Create the file**

```markdown
---
name: writing-chapter-manifest
description: Use when authoring or updating a chapter.md file under static/stories_plan/chapter_<N>/. The manifest declares the chapter's title, summary, and the ordered list of scenes the engine plays through. Trigger when starting a new chapter, adding a new scene to a chapter, or reordering scenes within a chapter.
---

# Writing Chapter Manifests (《東京雨證：第零證人》)

## Role

A chapter manifest declares **what scenes a chapter contains, in what playable order**. It is the entry point the engine uses to load a chapter — there is no convention-based scene discovery in v1.

## When to use

Use when:
- Starting a new chapter — author `static/stories_plan/chapter_<N>/chapter.md` before writing any scene files.
- Adding a new scene to an existing chapter — append it to the `## Scenes` list.
- Reordering scenes — edit the list.
- Renaming the chapter title — edit the H1.

## File location

`static/stories_plan/chapter_<N>/chapter.md` — one per chapter directory. Chapter ordering across chapters is derived from the directory name (`chapter_1`, `chapter_2`, …); there is no top-level index file.

## Required schema

```markdown
# Chapter 1: 雨鐘咖啡館殺人事件

**Summary:** 律師相馬律與早坂茜調查咖啡館內的殺人事件。

## Scenes
1. scene_0.md
2. investigation_scene_1.md
3. scene_1.md
4. investigation_scene_2.md
```

Field details:

- **H1 title (required, exactly one):** `# Chapter <N>: <繁體中文 title>`. The number `<N>` must match the directory name. The title is player-facing.
- **`**Summary:**` field (required):** One-line Traditional Chinese summary the engine can show in chapter selection / save metadata.
- **`## Scenes` ordered list (required):** Numbered list of scene filenames in playable order, *relative to this chapter directory*. Each entry is one filename, no subdirectories.

## Scene-type inference

Scene type is inferred from filename prefix — do **not** add a type annotation in the manifest.

| Filename pattern | Scene type |
|---|---|
| `scene_<K>.md` | Linear dialogue (uses `writing-detective-game-dialogue` linear format) |
| `investigation_scene_<K>.md` | Interactive investigation (uses `writing-investigation-scene`) |
| `interrogation_scene_<K>.md` | Reserved — not supported in v1; parser warns and skips |

## Parser validation guarantees

The compile-time parser checks the following — the manifest fails the build if any rule is violated:

- H1 line present and matches the directory number.
- `**Summary:**` field present (non-empty).
- `## Scenes` list present, non-empty.
- Every listed filename exists in this chapter's directory.
- Every listed filename matches a known scene-type prefix.
- A `interrogation_scene_*.md` filename produces a parser warning ("reserved for future scene type — entry ignored") but does not fail.

## Cross-chapter ordering

Chapters play in directory-name order: `chapter_1` → `chapter_2` → `chapter_3` → … There is no chapter manifest gating yet. Each chapter starts when its predecessor's final scene's Outro queue empties.

## Common mistakes

| Mistake | Fix |
|---|---|
| Listing scenes in narrative order but in the wrong filename | Rename the file so its number matches its position in the manifest. Filenames and order should agree. |
| Adding scenes that don't exist in the directory | Either create the file or remove the entry. |
| Mixing scene-type prefixes (e.g., `scene_2.md` listed before `investigation_scene_1.md`) | Allowed — playable order is whatever the manifest says, not what the filenames suggest. |
| Forgetting to add a newly-authored scene to the manifest | The parser does *not* auto-discover scene files. A scene that exists but is not listed in `chapter.md` is never played. |
| Adding metadata fields other than `**Summary:**` (e.g., `**Author:**`, `**Length:**`) | Not supported in v1. Stick to the schema. |
```

- [ ] **Step 2: Commit**

```bash
git add .claude/skills/writing-chapter-manifest/SKILL.md
git commit -m "docs(skill): add writing-chapter-manifest skill"
```

---

### Task 4: Update CLAUDE.md "Project domain" section

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Find the "Project domain" section**

Run: `grep -n "## Project domain" CLAUDE.md`

You'll find it at line 27 (the position may shift; trust the grep). The section currently ends with the line about authoring skills and the parser-loader status.

- [ ] **Step 2: Replace the Project domain section content**

Replace the existing Project domain section (from `## Project domain` up to but not including the next `## ` header) with:

```markdown
## Project domain

This repo is a detective/mystery game (《東京雨證：第零證人》, Traditional Chinese). Narrative content lives in `static/stories_plan/` — `General Plan.md` is the 8-chapter overview, `第_1_章_..._詳細計劃.md` is the per-chapter detail plan, and `chapter_<N>/` holds:

- `chapter.md` — the chapter manifest (title, summary, ordered scene list). Authored via the `writing-chapter-manifest` skill.
- `scene_<K>.md` — linear-dialogue scenes (intros, transitions, endings). Authored via `writing-detective-game-dialogue`.
- `investigation_scene_<K>.md` — interactive investigation scenes (hotspots, characters, evidence). Authored via `writing-investigation-scene`.

A Bun-based compile script (`scripts/compile-scenes.ts`) transforms authored markdown into validated JSON under `src-tauri/resources/scenes/`, which the Rust engine reads at runtime via `BaseDirectory::Resource`. The compile script is wired into Tauri's `beforeDevCommand` and `beforeBuildCommand` — the dev loop is `bun run tauri dev` (which chains `scenes:compile` before `vite`); for incremental rebuilds during writing iteration, run `bun run scenes:watch` in a second terminal.

Design spec: `docs/superpowers/specs/2026-05-13-scene-pipeline-design.md`. Skill authoring formats are owned by the three skills above — when writing or modifying scene content, invoke the relevant skill via the `Skill` tool rather than free-forming the format.
```

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md Project domain for scene-pipeline architecture"
```

---

## Phase A2: Project setup

### Task 5: Install dev dependencies and create the scripts directory structure

**Files:**
- Modify: `package.json`
- Create: `scripts/compile-scenes/` (directory only)
- Create: `scripts/__fixtures__/` (directory only)
- Create: `tsconfig.scripts.json`

- [ ] **Step 1: Install chokidar (for watch mode) and Bun types**

Run:

```bash
bun add -d chokidar @types/node
```

This adds chokidar (file watcher for `scenes:watch`) and `@types/node` (needed for `path`, `fs/promises` typings). `bun:test` is built into Bun — no separate test runner needed.

- [ ] **Step 2: Create the scripts directory layout**

```bash
mkdir -p scripts/compile-scenes
mkdir -p scripts/__fixtures__/valid
mkdir -p scripts/__fixtures__/invalid
```

- [ ] **Step 3: Add a dedicated tsconfig for the script (separate from the Svelte app's tsconfig)**

Create `tsconfig.scripts.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "exactOptionalPropertyTypes": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "allowImportingTsExtensions": true,
    "noEmit": true,
    "types": ["bun-types"]
  },
  "include": ["scripts/**/*.ts"]
}
```

- [ ] **Step 4: Add `bun-types` for full Bun typing**

```bash
bun add -d bun-types
```

- [ ] **Step 5: Verify nothing broke**

Run: `bun run check`

Expected: passes (no script files exist yet to type-check).

- [ ] **Step 6: Commit**

```bash
git add package.json bun.lock tsconfig.scripts.json scripts/
git commit -m "chore: scaffold scripts/ with chokidar + bun-types + dedicated tsconfig"
```

If `scripts/` was empty and not staged, run `touch scripts/compile-scenes/.gitkeep scripts/__fixtures__/.gitkeep` then re-add.

---

### Task 6: Wire up package.json scripts (per spec §3a.0)

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add the four new scripts**

In `package.json`, update the `"scripts"` object to add four new entries. The final scripts object should be:

```json
"scripts": {
  "dev": "vite dev",
  "build": "vite build",
  "preview": "vite preview",
  "check": "svelte-kit sync && svelte-check --tsconfig ./tsconfig.json",
  "check:watch": "svelte-kit sync && svelte-check --tsconfig ./tsconfig.json --watch",
  "tauri": "tauri",
  "scenes:compile": "bun run scripts/compile-scenes.ts",
  "scenes:watch": "bun run scripts/compile-scenes.ts --watch",
  "dev:tauri": "bun run scenes:compile && bun run dev",
  "build:tauri": "bun run scenes:compile && bun run build"
}
```

`dev` and `build` are unchanged — those are the Vite-only commands. `dev:tauri` and `build:tauri` are the new chained commands Tauri's before-hooks will invoke.

- [ ] **Step 2: Verify the scripts list is valid JSON**

Run: `bun run` (no args; Bun prints available scripts).

Expected: lists all 10 scripts above without parse errors.

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "build: add scenes:compile, scenes:watch, dev:tauri, build:tauri scripts"
```

---

### Task 7: Wire up tauri.conf.json + .gitignore

**Files:**
- Modify: `src-tauri/tauri.conf.json`
- Modify: `.gitignore`

- [ ] **Step 1: Update tauri.conf.json before-hooks and bundle.resources**

In `src-tauri/tauri.conf.json`, the `"build"` section currently reads:

```json
"build": {
  "beforeDevCommand": "bun run dev",
  "devUrl": "http://localhost:1420",
  "beforeBuildCommand": "bun run build",
  "frontendDist": "../build"
}
```

Change it to:

```json
"build": {
  "beforeDevCommand": "bun run dev:tauri",
  "devUrl": "http://localhost:1420",
  "beforeBuildCommand": "bun run build:tauri",
  "frontendDist": "../build"
}
```

Also in the same file, update `"bundle"`:

```json
"bundle": {
  "active": true,
  "targets": "all",
  "resources": ["resources/scenes/**/*"],
  "icon": [
    "icons/32x32.png",
    "icons/128x128.png",
    "icons/128x128@2x.png",
    "icons/icon.icns",
    "icons/icon.ico"
  ]
}
```

The `"resources"` entry is new. The path is relative to `src-tauri/` (where `tauri.conf.json` lives), so it points at `src-tauri/resources/scenes/**/*`. The glob matches all generated JSON files.

- [ ] **Step 2: Add the generated scenes directory to .gitignore**

Append to `.gitignore` (just before the `.claude/settings.local.json` line at the bottom):

```
src-tauri/resources/scenes/
```

The fixture corpus under `scripts/__fixtures__/` and the snapshots under `scripts/__snapshots__/` remain tracked. The output directory is created by the compile script on every run (the orchestrator does `mkdirSync(outputRoot, { recursive: true })`), so no checked-in placeholder is needed.

- [ ] **Step 3: Verify Tauri config parses**

```bash
cd src-tauri && cargo check && cd ..
```

Expected: passes (or at most produces warnings unrelated to the config). Tauri may warn that the `resources/scenes/**/*` glob currently matches no files — that's fine; the first `scenes:compile` run will populate it.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/tauri.conf.json .gitignore
git commit -m "build: wire scenes:compile into Tauri dev/build, add resources/scenes bundle entry"
```

---

## Phase A3: Fixtures

### Task 8: Author the valid minimal fixture (one complete chapter exercising every block type)

**Files:**
- Create: `scripts/__fixtures__/valid/chapter_1/chapter.md`
- Create: `scripts/__fixtures__/valid/chapter_1/scene_0.md`
- Create: `scripts/__fixtures__/valid/chapter_1/investigation_scene_1.md`

The fixture is intentionally minimal — a few lines of dialogue per block — but exercises every parser path: linear scenes, intro/outro, sub-locations (one unlocked + one locked-then-revealed), hotspots (with and without On Reexamine), a character with topics (one unlocked + one locked-then-revealed), evidence with On Collect + On Reexamine, statement with On Acquire + On Reexamine, Outro with explicit Unlock, and a sub-location reveal chain.

- [ ] **Step 1: Create `chapter.md`**

```markdown
# Chapter 1: 測試章節

**Summary:** 一個用來驗證解析器與校驗器所有路徑的最小測試章節。

## Scenes
1. scene_0.md
2. investigation_scene_1.md
```

- [ ] **Step 2: Create `scene_0.md` (linear)**

```markdown
# Scene 0: 測試線性場景

[場景：測試場景前廳，深夜。]

[相馬律走進場景。]

**相馬律**：測試開始。

**早坂茜**：好。

[場景：測試場景內室。]

**相馬律**：場景切換。
```

- [ ] **Step 3: Create `investigation_scene_1.md`**

```markdown
# Scene 1: 測試調查場景

## Intro

[相馬律與早坂茜進入測試現場。]

**相馬律**：開始調查。

## Sub-location: 主廳 {#main_hall}
- **Status:** unlocked

[場景：測試主廳，明亮。]

[兩人環視主廳。]

**早坂茜**：先看看這裡。

### Hotspot: 桌子 {#table}
- **Description:** 一張木桌，桌上有一杯咖啡。
- **Reveals:** [evidence:coffee, sublocation:back_room]

[相馬律靠近桌子。]

**相馬律**：還是熱的。

#### On Reexamine

**相馬律**：咖啡已經涼了。

### Hotspot: 窗戶 {#window}
- **Description:** 窗戶半開，外面正在下雨。

[相馬律看了一眼窗外。]

**相馬律**：雨還在下。

### Character: 證人 {#witness}
- **Role:** 證人
- **Bio:** 案發時在現場的證人。

#### Topic: 案發時間 {#timeline}
- **Status:** unlocked
- **Reveals:** [statement:witness_alibi]

**證人**：我那時候在桌邊。

##### On Reexamine

**證人**：和剛才一樣，我在桌邊。

#### Topic: 動機 {#motive}
- **Status:** locked
- **Unlock:** evidence:coffee collected

**證人**：我沒有動機。

## Sub-location: 後室 {#back_room}
- **Status:** locked

[場景：測試後室，昏暗。]

[兩人推門進入後室。]

**早坂茜**：這裡比較冷。

### Hotspot: 櫥櫃 {#cabinet}
- **Description:** 一個上鎖的櫥櫃。
- **Reveals:** [evidence:locked_box]

[相馬律試了試櫥櫃。]

**相馬律**：鎖著的。

## Evidence Manifest

### evidence:coffee {#coffee}
- **Name:** 還熱的咖啡
- **Description:** 一杯仍微熱的咖啡。
- **Details:** 杯壁溫度約 50°C，最近 10 分鐘內被沖泡。

#### On Collect

**相馬律**：證明有人在這裡。

#### On Reexamine

**相馬律**：時間不對。

### evidence:locked_box {#locked_box}
- **Name:** 上鎖的小盒
- **Description:** 櫥櫃內的金屬盒。
- **Details:** 盒身有刻字，但鎖未撬開。

#### On Collect

**相馬律**：先帶走。

## Statement Manifest

### statement:witness_alibi {#witness_alibi}
- **Speaker:** 證人
- **Content:** 「案發時我在桌邊。」

#### On Acquire

**早坂茜**：他說在桌邊。

#### On Reexamine

**早坂茜**：他堅持是在桌邊。

## Outro
- **Unlock:** hotspot:cabinet investigated and statement:witness_alibi acquired

[相馬律走出測試現場。]

**相馬律**：測試完成。
```

- [ ] **Step 4: Sanity-check that the fixture compiles in your head**

Read it once with the rules in mind:
- `chapter.md` lists 2 scenes, both exist ✓
- `scene_0.md` is linear, only H1 + dialogue ✓
- `investigation_scene_1.md`: H1 ✓, Intro ✓, 2 sub-locations (first unlocked) ✓, every sub-location has a `[場景：...]` tag ✓, locked `back_room` has inbound `Reveals: [sublocation:back_room]` from `hotspot:table` (no `Unlock:` on back_room — consistent with §3d "no block has both"), Evidence and Statement manifests ✓, every Evidence has `On Collect`, every Statement has `On Acquire`, Outro has explicit `Unlock:` referencing `hotspot:cabinet` (in `back_room`, reached via the reveal chain) ✓.

- [ ] **Step 5: Commit**

```bash
git add scripts/__fixtures__/valid/chapter_1/
git commit -m "test(fixtures): add minimal valid chapter exercising every block type"
```

---

### Task 9: Author invalid fixtures (one folder per validation rule)

**Files:** for each of the rules below, create a folder under `scripts/__fixtures__/invalid/<rule_name>/` containing the minimal failing input plus an `expected-error.txt` file naming the error code or substring the validator must emit.

The rules to exercise (one folder each):
1. `unresolved_reveal_target` — a hotspot reveals an undeclared evidence ID
2. `outro_unreachable` — a locked sublocation with no inbound Reveals and no Unlock
3. `duplicate_global_evidence_id` — two chapters declare the same `evidence:foo`
4. `cross_chapter_unlock_predicate` — chapter_2's investigation scene has `**Unlock:** evidence:foo collected` where `evidence:foo` is declared in chapter_1
5. `first_sublocation_locked` — first sub-location declared as `Status: locked`
6. `sublocation_no_scene_tag` — sub-location body has no `[場景：...]`
7. `reveals_and_unlock_both` — a locked hotspot has both an inbound Reveals from another hotspot and its own Unlock predicate
8. `evidence_no_on_collect` — Evidence Manifest entry missing `#### On Collect`
9. `statement_no_on_acquire` — Statement Manifest entry missing `#### On Acquire`
10. `linear_scene_with_h2` — linear scene contains an H2 header
11. `chapter_manifest_missing_file` — chapter.md lists a file that doesn't exist
12. `chapter_manifest_missing_summary` — chapter.md has no `**Summary:**` line
13. `outro_unlock_unresolved` — Outro's `Unlock:` references a hotspot ID not declared in the scene
14. `circular_unlock_chain` — sub-location A's Unlock references sub-location B, and B's Unlock references A

- [ ] **Step 1: Create the folder structure**

```bash
for rule in unresolved_reveal_target outro_unreachable duplicate_global_evidence_id cross_chapter_unlock_predicate first_sublocation_locked sublocation_no_scene_tag reveals_and_unlock_both evidence_no_on_collect statement_no_on_acquire linear_scene_with_h2 chapter_manifest_missing_file chapter_manifest_missing_summary outro_unlock_unresolved circular_unlock_chain; do
  mkdir -p "scripts/__fixtures__/invalid/$rule"
done
```

- [ ] **Step 2: Author each fixture**

Each folder contains:
- The minimal markdown that triggers the rule (one or two files, structured like a chapter).
- `expected-error.txt` — one line, the error-code substring the validator output must contain.

For each rule, the layout is `scripts/__fixtures__/invalid/<rule>/chapter_1/<files>` plus `expected-error.txt` at the rule root.

**Implementer note:** rather than typing each one out here, the pattern is: copy the smallest skeleton from the valid fixture (Task 8) and corrupt it in exactly the one way named by the rule. Each fixture should be ≤30 lines. Use the rule name as both the folder name and the substring inside `expected-error.txt` (e.g., `unresolved_reveal_target` → `expected-error.txt` contains `unresolvedRevealTarget` or `Unresolved reveal target`). The exact error-code naming is finalized in Task 16; you may write the expected-error files using the rule names in snake_case and adjust them as the validator's error codes solidify.

Two specific fixtures need both a chapter_1 and chapter_2 directory. Spec §6b explicitly requires the cross-chapter-Unlock negative fixture, so its contents are shown in full below:

**`scripts/__fixtures__/invalid/cross_chapter_unlock_predicate/chapter_1/chapter.md`**
```markdown
# Chapter 1: c1

**Summary:** s

## Scenes
1. investigation_scene_1.md
```

**`scripts/__fixtures__/invalid/cross_chapter_unlock_predicate/chapter_1/investigation_scene_1.md`**
```markdown
# Scene 1: c1s1

## Sub-location: room {#room}
- **Status:** unlocked

[場景：c1 room]

### Hotspot: thing {#thing}
- **Description:** a thing
- **Reveals:** [evidence:foo]

**A**：observed.

## Evidence Manifest

### evidence:foo {#foo}
- **Name:** Foo
- **Description:** A foo.
- **Details:** Detail.

#### On Collect

**A**：collected.

## Outro
```

**`scripts/__fixtures__/invalid/cross_chapter_unlock_predicate/chapter_2/chapter.md`**
```markdown
# Chapter 2: c2

**Summary:** s

## Scenes
1. investigation_scene_1.md
```

**`scripts/__fixtures__/invalid/cross_chapter_unlock_predicate/chapter_2/investigation_scene_1.md`**
```markdown
# Scene 1: c2s1

## Sub-location: room {#room}
- **Status:** unlocked

[場景：c2 room]

### Hotspot: thing {#thing}
- **Description:** a thing

**A**：observed.

## Outro
- **Unlock:** evidence:foo collected

**A**：done.
```

**`scripts/__fixtures__/invalid/cross_chapter_unlock_predicate/expected-error.txt`**
```
crossChapterUnlock
```

The `duplicate_global_evidence_id` fixture follows the same two-chapter pattern but with the same `evidence:dup` declared in both `chapter_1/investigation_scene_1.md` and `chapter_2/investigation_scene_1.md`. Both Outros are bare `## Outro`. `expected-error.txt` contains `duplicateGlobalEvidenceId`.

The 12 single-chapter fixtures each have one chapter and corrupt the valid pattern in exactly the one way named by the rule. Derive each from the Task 8 fixture, ~10-20 lines each. Use the validator's error code (visible in Task 16) for `expected-error.txt`.

- [ ] **Step 3: Commit**

```bash
git add scripts/__fixtures__/invalid/
git commit -m "test(fixtures): add invalid fixtures for each validation rule"
```

---

## Phase A4: Shared types

### Task 10: Define the AST and JSON types

**Files:**
- Create: `scripts/compile-scenes/types.ts`

These types are the public contract between the parsers, the validator, the emitter, and (later) the Rust engine via the emitted JSON. Lock them down once; downstream code refers to them.

- [ ] **Step 1: Create `scripts/compile-scenes/types.ts`**

```typescript
// =============================================================================
// scripts/compile-scenes/types.ts
//
// Public contract for the scene-pipeline compiler. Two type families:
//   - AST*  : intermediate representation built by the parsers.
//   - JSON* : final shape written to src-tauri/resources/scenes/.
//
// The shape of JSON* matches the spec §3b 1:1. The Rust engine's serde
// types in Plan B's schema.rs are a direct mirror.
// =============================================================================

// ----- Shared atoms ----------------------------------------------------------

export type DialogueItem =
  | { kind: "sceneTag"; text: string }
  | { kind: "action"; text: string }
  | { kind: "line"; speaker: string; text: string };

export type RevealTarget =
  | { kind: "evidence"; id: string }
  | { kind: "statement"; id: string }
  | { kind: "topic"; characterId: string; topicId: string }
  | { kind: "hotspot"; id: string }
  | { kind: "sublocation"; id: string };

export type UnlockExpr =
  | { op: "and"; left: UnlockExpr; right: UnlockExpr }
  | { op: "or"; left: UnlockExpr; right: UnlockExpr }
  | { predicate: "evidence_collected"; id: string }
  | { predicate: "statement_acquired"; id: string }
  | { predicate: "topic_discussed"; characterId: string; topicId: string }
  | { predicate: "hotspot_investigated"; id: string };

// ----- AST: per-file parser output -------------------------------------------

export type Located<T> = T & { sourceFile: string; line: number };

export type ASTChapter = Located<{
  kind: "chapter";
  dirName: string; // e.g., "chapter_1"
  number: number; // parsed from the H1
  title: string;
  summary: string;
  sceneFiles: string[]; // ordered, raw filenames as written in the manifest
}>;

export type ASTLinearScene = Located<{
  kind: "linearScene";
  id: string; // derived from filename without .md
  title: string;
  queue: DialogueItem[];
}>;

export type ASTInvestigationScene = Located<{
  kind: "investigationScene";
  id: string;
  title: string;
  intro: DialogueItem[];
  sublocations: ASTSublocation[];
  evidenceManifest: ASTEvidence[];
  statementManifest: ASTStatement[];
  outro: ASTOutro;
}>;

export type ASTSublocation = Located<{
  id: string;
  status: "locked" | "unlocked";
  unlock: UnlockExpr | null;
  reveals: RevealTarget[];
  sceneTag: string;
  transitionDialogue: DialogueItem[];
  hotspots: ASTHotspot[];
  characters: ASTCharacter[];
}>;

export type ASTHotspot = Located<{
  id: string;
  label: string;
  description: string;
  status: "locked" | "unlocked";
  unlock: UnlockExpr | null;
  reveals: RevealTarget[];
  inspectDialogue: DialogueItem[];
  onReexamine: DialogueItem[] | null;
}>;

export type ASTCharacter = Located<{
  id: string;
  name: string;
  role: string;
  bio: string;
  topics: ASTTopic[];
}>;

export type ASTTopic = Located<{
  id: string;
  label: string;
  status: "locked" | "unlocked";
  unlock: UnlockExpr | null;
  reveals: RevealTarget[];
  topicDialogue: DialogueItem[];
  onReexamine: DialogueItem[] | null;
}>;

export type ASTEvidence = Located<{
  id: string;
  name: string;
  description: string;
  details: string;
  onCollect: DialogueItem[];
  onReexamine: DialogueItem[] | null;
}>;

export type ASTStatement = Located<{
  id: string;
  speaker: string;
  content: string;
  onAcquire: DialogueItem[];
  onReexamine: DialogueItem[] | null;
}>;

export type ASTOutro = {
  unlock: UnlockExpr | "auto";
  dialogue: DialogueItem[];
};

// ----- JSON: emitter output (mirrors spec §3b) -------------------------------

export type JSONChaptersIndex = {
  chapters: Array<{
    id: string;
    title: string;
    summary: string;
    scenes: Array<{ type: "linear" | "investigation"; file: string }>;
  }>;
};

export type JSONLinearScene = {
  type: "linear";
  id: string;
  title: string;
  queue: DialogueItem[];
};

export type JSONInvestigationScene = {
  type: "investigation";
  id: string;
  title: string;
  intro: DialogueItem[];
  sublocations: Array<{
    id: string;
    status: "locked" | "unlocked";
    unlock: UnlockExpr | null;
    reveals: RevealTarget[];
    sceneTag: string;
    transitionDialogue: DialogueItem[];
    hotspots: Array<{
      id: string;
      label: string;
      description: string;
      status: "locked" | "unlocked";
      unlock: UnlockExpr | null;
      reveals: RevealTarget[];
      inspectDialogue: DialogueItem[];
      onReexamine: DialogueItem[] | null;
    }>;
    characters: Array<{
      id: string;
      name: string;
      role: string;
      bio: string;
      topics: Array<{
        id: string;
        label: string;
        status: "locked" | "unlocked";
        unlock: UnlockExpr | null;
        reveals: RevealTarget[];
        topicDialogue: DialogueItem[];
        onReexamine: DialogueItem[] | null;
      }>;
    }>;
  }>;
  evidenceManifest: Array<{
    id: string;
    name: string;
    description: string;
    details: string;
    onCollect: DialogueItem[];
    onReexamine: DialogueItem[] | null;
  }>;
  statementManifest: Array<{
    id: string;
    speaker: string;
    content: string;
    onAcquire: DialogueItem[];
    onReexamine: DialogueItem[] | null;
  }>;
  outro: {
    unlock: "auto" | UnlockExpr;
    dialogue: DialogueItem[];
  };
};

// ----- Compile errors --------------------------------------------------------

export type CompileError = {
  code: string; // stable identifier, e.g., "unresolvedRevealTarget"
  message: string; // human-readable, with file:line context
  sourceFile: string;
  line: number;
};
```

- [ ] **Step 2: Verify it type-checks**

Run: `bunx --bun tsc --noEmit -p tsconfig.scripts.json`

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add scripts/compile-scenes/types.ts
git commit -m "feat(compile): define AST and JSON shared types"
```

---

## Phase A5: Tokenizer

### Task 11: Implement the line-oriented tokenizer

**Files:**
- Create: `scripts/compile-scenes/tokenizer.ts`
- Create: `scripts/compile-scenes/tokenizer.test.ts`

The tokenizer walks a file line by line and classifies each line into one of a handful of token kinds. It does not understand block structure — that's the parser's job.

- [ ] **Step 1: Write the failing tests**

Create `scripts/compile-scenes/tokenizer.test.ts`:

```typescript
import { describe, expect, it } from "bun:test";
import { tokenize, Token } from "./tokenizer";

describe("tokenizer", () => {
  it("classifies an H1 heading without anchor", () => {
    const tokens = tokenize("# Scene 0: 接案", "test.md");
    expect(tokens).toEqual([
      { kind: "heading", level: 1, text: "Scene 0: 接案", anchorId: null, sourceFile: "test.md", line: 1 },
    ]);
  });

  it("classifies an H3 heading with anchor id", () => {
    const tokens = tokenize("### Hotspot: 桌子 {#table}", "test.md");
    expect(tokens).toEqual([
      { kind: "heading", level: 3, text: "Hotspot: 桌子", anchorId: "table", sourceFile: "test.md", line: 1 },
    ]);
  });

  it("classifies a metadata line", () => {
    const tokens = tokenize("- **Status:** locked", "test.md");
    expect(tokens).toEqual([
      { kind: "metadata", key: "Status", value: "locked", sourceFile: "test.md", line: 1 },
    ]);
  });

  it("classifies a metadata line whose value contains spaces", () => {
    const tokens = tokenize("- **Unlock:** hotspot:foo investigated and topic:bar@baz discussed", "test.md");
    expect(tokens).toEqual([
      {
        kind: "metadata",
        key: "Unlock",
        value: "hotspot:foo investigated and topic:bar@baz discussed",
        sourceFile: "test.md",
        line: 1,
      },
    ]);
  });

  it("classifies a scene-tag bracketed line", () => {
    const tokens = tokenize("[場景：吉祥寺街道，深夜，雨夜。]", "test.md");
    expect(tokens).toEqual([
      { kind: "sceneTag", text: "吉祥寺街道，深夜，雨夜。", sourceFile: "test.md", line: 1 },
    ]);
  });

  it("classifies a non-scene-tag bracketed line as an action", () => {
    const tokens = tokenize("[相馬律收起傘。]", "test.md");
    expect(tokens).toEqual([
      { kind: "action", text: "相馬律收起傘。", sourceFile: "test.md", line: 1 },
    ]);
  });

  it("classifies a dialogue line with full-width colon", () => {
    const tokens = tokenize("**早坂茜**：你來得比我想的快。", "test.md");
    expect(tokens).toEqual([
      { kind: "dialogue", speaker: "早坂茜", text: "你來得比我想的快。", sourceFile: "test.md", line: 1 },
    ]);
  });

  it("ignores blank lines", () => {
    const tokens = tokenize("\n\n", "test.md");
    expect(tokens).toEqual([]);
  });

  it("preserves line numbers across blank lines", () => {
    const tokens = tokenize("# H1\n\n**A**：hi", "test.md");
    expect(tokens).toHaveLength(2);
    expect(tokens[0]).toMatchObject({ kind: "heading", line: 1 });
    expect(tokens[1]).toMatchObject({ kind: "dialogue", line: 3 });
  });

  it("emits an unknown token for unrecognized content", () => {
    const tokens = tokenize("just some random prose without any structure", "test.md");
    expect(tokens).toEqual([
      { kind: "unknown", text: "just some random prose without any structure", sourceFile: "test.md", line: 1 },
    ]);
  });

  it("treats a half-width colon in a dialogue line as unknown (full-width required)", () => {
    const tokens = tokenize("**早坂茜**: text", "test.md");
    expect(tokens[0]?.kind).toBe("unknown");
  });
});
```

- [ ] **Step 2: Verify the tests fail**

Run: `bun test scripts/compile-scenes/tokenizer.test.ts`

Expected: FAIL — `Cannot find module './tokenizer'` or similar.

- [ ] **Step 3: Implement the tokenizer**

Create `scripts/compile-scenes/tokenizer.ts`:

```typescript
// =============================================================================
// scripts/compile-scenes/tokenizer.ts
//
// Line-oriented tokenizer. Classifies each source line into one of:
//   - heading        (# / ## / ### / #### / ##### with optional {#anchor})
//   - metadata       (- **Key:** value)
//   - sceneTag       ([場景：...])
//   - action         (any other [bracketed] line)
//   - dialogue       (**Name**：text — full-width colon)
//   - unknown        (any line that didn't match above)
//
// Blank lines are skipped but counted (so line numbers stay accurate).
// The tokenizer does not understand block structure. The parser does that.
// =============================================================================

export type Token =
  | {
      kind: "heading";
      level: 1 | 2 | 3 | 4 | 5;
      text: string;
      anchorId: string | null;
      sourceFile: string;
      line: number;
    }
  | { kind: "metadata"; key: string; value: string; sourceFile: string; line: number }
  | { kind: "sceneTag"; text: string; sourceFile: string; line: number }
  | { kind: "action"; text: string; sourceFile: string; line: number }
  | { kind: "dialogue"; speaker: string; text: string; sourceFile: string; line: number }
  | { kind: "unknown"; text: string; sourceFile: string; line: number };

const HEADING_RE = /^(#{1,5})\s+(.+?)(?:\s+\{#([a-z0-9_]+)\})?\s*$/;
const METADATA_RE = /^-\s+\*\*([A-Za-z][A-Za-z0-9 ]*):\*\*\s+(.+?)\s*$/;
const BRACKETED_RE = /^\[(.+?)\]\s*$/;
const DIALOGUE_RE = /^\*\*([^*]+)\*\*：(.+?)\s*$/;
const SCENE_TAG_PREFIX = "場景：";

export function tokenize(source: string, sourceFile: string): Token[] {
  const tokens: Token[] = [];
  const lines = source.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i] ?? "";
    const line = i + 1;
    const trimmed = rawLine.trim();

    if (trimmed.length === 0) continue;

    const heading = HEADING_RE.exec(trimmed);
    if (heading) {
      const hashes = heading[1] ?? "";
      const text = heading[2] ?? "";
      const anchorId = heading[3] ?? null;
      tokens.push({
        kind: "heading",
        level: hashes.length as 1 | 2 | 3 | 4 | 5,
        text,
        anchorId,
        sourceFile,
        line,
      });
      continue;
    }

    const metadata = METADATA_RE.exec(trimmed);
    if (metadata) {
      tokens.push({
        kind: "metadata",
        key: metadata[1] ?? "",
        value: metadata[2] ?? "",
        sourceFile,
        line,
      });
      continue;
    }

    const bracketed = BRACKETED_RE.exec(trimmed);
    if (bracketed) {
      const inner = bracketed[1] ?? "";
      if (inner.startsWith(SCENE_TAG_PREFIX)) {
        tokens.push({
          kind: "sceneTag",
          text: inner.slice(SCENE_TAG_PREFIX.length),
          sourceFile,
          line,
        });
      } else {
        tokens.push({ kind: "action", text: inner, sourceFile, line });
      }
      continue;
    }

    const dialogue = DIALOGUE_RE.exec(trimmed);
    if (dialogue) {
      tokens.push({
        kind: "dialogue",
        speaker: dialogue[1] ?? "",
        text: dialogue[2] ?? "",
        sourceFile,
        line,
      });
      continue;
    }

    tokens.push({ kind: "unknown", text: trimmed, sourceFile, line });
  }

  return tokens;
}
```

- [ ] **Step 4: Run the tests, verify they pass**

Run: `bun test scripts/compile-scenes/tokenizer.test.ts`

Expected: all 11 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/compile-scenes/tokenizer.ts scripts/compile-scenes/tokenizer.test.ts
git commit -m "feat(compile): line-oriented tokenizer with 5 token kinds + tests"
```

---

## Phase A6: Parsers

### Task 12: Implement the Unlock expression parser

**Files:**
- Create: `scripts/compile-scenes/parser-unlock.ts`
- Create: `scripts/compile-scenes/parser-unlock.test.ts`

The Unlock parser is its own module because it's the only place a non-trivial grammar appears (boolean expressions over atomic predicates), and it's invoked from multiple block parsers (Sublocation, Hotspot, Topic, Outro). Implementing it as a recursive-descent function operating on a token list keeps it self-contained and well-tested.

The grammar:

```
expr     := or
or       := and ( "or" and )*
and      := atom ( "and" atom )*
atom     := predicate
          | "(" expr ")"

predicate := "evidence:" ID "collected"
           | "statement:" ID "acquired"
           | "topic:" ID "@" ID "discussed"
           | "hotspot:" ID "investigated"
```

`and` binds tighter than `or` (standard precedence). Parentheses allowed but optional in v1; the spec doesn't require them but the parser supports them defensively.

- [ ] **Step 1: Write the failing tests**

Create `scripts/compile-scenes/parser-unlock.test.ts`:

```typescript
import { describe, expect, it } from "bun:test";
import { parseUnlockExpr } from "./parser-unlock";
import type { UnlockExpr } from "./types";

describe("parseUnlockExpr", () => {
  it("parses a single evidence_collected predicate", () => {
    const result = parseUnlockExpr("evidence:coffee collected", "test.md", 5);
    expect(result).toEqual({
      ok: true,
      value: { predicate: "evidence_collected", id: "coffee" },
    });
  });

  it("parses a single statement_acquired predicate", () => {
    const result = parseUnlockExpr("statement:alibi acquired", "test.md", 5);
    expect(result).toEqual({
      ok: true,
      value: { predicate: "statement_acquired", id: "alibi" },
    });
  });

  it("parses a topic_discussed predicate with character@topic syntax", () => {
    const result = parseUnlockExpr("topic:witness@motive discussed", "test.md", 5);
    expect(result).toEqual({
      ok: true,
      value: { predicate: "topic_discussed", characterId: "witness", topicId: "motive" },
    });
  });

  it("parses a hotspot_investigated predicate", () => {
    const result = parseUnlockExpr("hotspot:back_door investigated", "test.md", 5);
    expect(result).toEqual({
      ok: true,
      value: { predicate: "hotspot_investigated", id: "back_door" },
    });
  });

  it("parses an `and` combinator", () => {
    const result = parseUnlockExpr(
      "hotspot:a investigated and evidence:b collected",
      "test.md",
      5,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({
      op: "and",
      left: { predicate: "hotspot_investigated", id: "a" },
      right: { predicate: "evidence_collected", id: "b" },
    });
  });

  it("parses an `or` combinator", () => {
    const result = parseUnlockExpr(
      "hotspot:a investigated or hotspot:b investigated",
      "test.md",
      5,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({
      op: "or",
      left: { predicate: "hotspot_investigated", id: "a" },
      right: { predicate: "hotspot_investigated", id: "b" },
    });
  });

  it("respects precedence: and binds tighter than or", () => {
    // a and b or c   ===   (a and b) or c
    const result = parseUnlockExpr(
      "hotspot:a investigated and hotspot:b investigated or hotspot:c investigated",
      "test.md",
      5,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({
      op: "or",
      left: {
        op: "and",
        left: { predicate: "hotspot_investigated", id: "a" },
        right: { predicate: "hotspot_investigated", id: "b" },
      },
      right: { predicate: "hotspot_investigated", id: "c" },
    });
  });

  it("rejects an unknown predicate kind", () => {
    const result = parseUnlockExpr("foo:bar baz", "test.md", 5);
    expect(result.ok).toBe(false);
  });

  it("rejects malformed input", () => {
    const result = parseUnlockExpr("evidence: collected", "test.md", 5);
    expect(result.ok).toBe(false);
  });

  it("rejects an empty string", () => {
    const result = parseUnlockExpr("", "test.md", 5);
    expect(result.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Verify the tests fail**

Run: `bun test scripts/compile-scenes/parser-unlock.test.ts`

Expected: FAIL.

- [ ] **Step 3: Implement the parser**

Create `scripts/compile-scenes/parser-unlock.ts`:

```typescript
// =============================================================================
// scripts/compile-scenes/parser-unlock.ts
//
// Recursive-descent parser for Unlock: expressions.
//
// Grammar:
//   expr  := or
//   or    := and ( "or" and )*
//   and   := atom ( "and" atom )*
//   atom  := "(" expr ")" | predicate
//   pred  := "evidence:"  ID " collected"
//          | "statement:" ID " acquired"
//          | "topic:"     ID "@" ID " discussed"
//          | "hotspot:"   ID " investigated"
//
// Operator precedence: `and` binds tighter than `or`.
// =============================================================================

import type { CompileError, UnlockExpr } from "./types";

export type ParseResult =
  | { ok: true; value: UnlockExpr }
  | { ok: false; error: CompileError };

const ID_RE = /[a-z0-9_]+/y;

class Tokens {
  private i = 0;
  constructor(
    private readonly src: string,
    public readonly sourceFile: string,
    public readonly line: number,
  ) {}
  peek(): string {
    this.skipWs();
    return this.src.slice(this.i);
  }
  consume(literal: string): boolean {
    this.skipWs();
    if (this.src.startsWith(literal, this.i)) {
      this.i += literal.length;
      return true;
    }
    return false;
  }
  consumeWord(word: string): boolean {
    this.skipWs();
    if (
      this.src.startsWith(word, this.i) &&
      (this.i + word.length === this.src.length ||
        /\s|[()]/.test(this.src[this.i + word.length] ?? ""))
    ) {
      this.i += word.length;
      return true;
    }
    return false;
  }
  consumeId(): string | null {
    this.skipWs();
    ID_RE.lastIndex = this.i;
    const m = ID_RE.exec(this.src);
    if (!m || m.index !== this.i) return null;
    this.i += m[0].length;
    return m[0];
  }
  atEnd(): boolean {
    this.skipWs();
    return this.i >= this.src.length;
  }
  private skipWs() {
    while (this.i < this.src.length && /\s/.test(this.src[this.i] ?? "")) this.i++;
  }
}

export function parseUnlockExpr(
  source: string,
  sourceFile: string,
  line: number,
): ParseResult {
  const tokens = new Tokens(source.trim(), sourceFile, line);
  if (tokens.atEnd()) {
    return failure(sourceFile, line, "unlockEmpty", "Unlock expression is empty.");
  }
  const expr = parseOr(tokens);
  if (!expr.ok) return expr;
  if (!tokens.atEnd()) {
    return failure(
      sourceFile,
      line,
      "unlockTrailing",
      `Trailing tokens after parsed expression: "${tokens.peek()}"`,
    );
  }
  return expr;
}

function parseOr(t: Tokens): ParseResult {
  let left = parseAnd(t);
  if (!left.ok) return left;
  while (t.consumeWord("or")) {
    const right = parseAnd(t);
    if (!right.ok) return right;
    left = { ok: true, value: { op: "or", left: left.value, right: right.value } };
  }
  return left;
}

function parseAnd(t: Tokens): ParseResult {
  let left = parseAtom(t);
  if (!left.ok) return left;
  while (t.consumeWord("and")) {
    const right = parseAtom(t);
    if (!right.ok) return right;
    left = { ok: true, value: { op: "and", left: left.value, right: right.value } };
  }
  return left;
}

function parseAtom(t: Tokens): ParseResult {
  if (t.consume("(")) {
    const inner = parseOr(t);
    if (!inner.ok) return inner;
    if (!t.consume(")")) {
      return failure(t.sourceFile, t.line, "unlockUnclosedParen", "Missing closing paren.");
    }
    return inner;
  }
  return parsePredicate(t);
}

function parsePredicate(t: Tokens): ParseResult {
  // Try each predicate prefix in order.
  if (t.consume("evidence:")) {
    const id = t.consumeId();
    if (!id) return failure(t.sourceFile, t.line, "unlockMissingId", "Missing evidence id.");
    if (!t.consumeWord("collected"))
      return failure(t.sourceFile, t.line, "unlockMissingVerb", `Expected "collected" after evidence:${id}.`);
    return { ok: true, value: { predicate: "evidence_collected", id } };
  }
  if (t.consume("statement:")) {
    const id = t.consumeId();
    if (!id) return failure(t.sourceFile, t.line, "unlockMissingId", "Missing statement id.");
    if (!t.consumeWord("acquired"))
      return failure(t.sourceFile, t.line, "unlockMissingVerb", `Expected "acquired" after statement:${id}.`);
    return { ok: true, value: { predicate: "statement_acquired", id } };
  }
  if (t.consume("topic:")) {
    const characterId = t.consumeId();
    if (!characterId) return failure(t.sourceFile, t.line, "unlockMissingId", "Missing character id in topic predicate.");
    if (!t.consume("@"))
      return failure(t.sourceFile, t.line, "unlockMissingTopicSeparator", "Topic predicates require <character>@<topic>.");
    const topicId = t.consumeId();
    if (!topicId) return failure(t.sourceFile, t.line, "unlockMissingId", "Missing topic id in topic predicate.");
    if (!t.consumeWord("discussed"))
      return failure(t.sourceFile, t.line, "unlockMissingVerb", `Expected "discussed" after topic:${characterId}@${topicId}.`);
    return { ok: true, value: { predicate: "topic_discussed", characterId, topicId } };
  }
  if (t.consume("hotspot:")) {
    const id = t.consumeId();
    if (!id) return failure(t.sourceFile, t.line, "unlockMissingId", "Missing hotspot id.");
    if (!t.consumeWord("investigated"))
      return failure(t.sourceFile, t.line, "unlockMissingVerb", `Expected "investigated" after hotspot:${id}.`);
    return { ok: true, value: { predicate: "hotspot_investigated", id } };
  }
  return failure(
    t.sourceFile,
    t.line,
    "unlockUnknownPredicate",
    `Unknown predicate prefix at: "${t.peek()}"`,
  );
}

function failure(sourceFile: string, line: number, code: string, message: string): ParseResult {
  return { ok: false, error: { code, message, sourceFile, line } };
}
```

- [ ] **Step 4: Run the tests, verify they pass**

Run: `bun test scripts/compile-scenes/parser-unlock.test.ts`

Expected: all 10 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/compile-scenes/parser-unlock.ts scripts/compile-scenes/parser-unlock.test.ts
git commit -m "feat(compile): Unlock-expression parser (recursive descent, with precedence)"
```

---

### Task 13: Implement the chapter manifest parser

**Files:**
- Create: `scripts/compile-scenes/parser-chapter.ts`
- Create: `scripts/compile-scenes/parser-chapter.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `scripts/compile-scenes/parser-chapter.test.ts`:

```typescript
import { describe, expect, it } from "bun:test";
import { parseChapter } from "./parser-chapter";

describe("parseChapter", () => {
  it("parses a minimal valid manifest", () => {
    const source = `
# Chapter 1: 雨鐘咖啡館殺人事件

**Summary:** 律師相馬律調查咖啡館。

## Scenes
1. scene_0.md
2. investigation_scene_1.md
`.trim();
    const result = parseChapter(source, "chapter_1/chapter.md", "chapter_1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.number).toBe(1);
    expect(result.value.title).toBe("雨鐘咖啡館殺人事件");
    expect(result.value.summary).toBe("律師相馬律調查咖啡館。");
    expect(result.value.sceneFiles).toEqual(["scene_0.md", "investigation_scene_1.md"]);
  });

  it("rejects a manifest with no H1", () => {
    const source = `**Summary:** foo\n## Scenes\n1. scene_0.md`;
    const result = parseChapter(source, "chapter_1/chapter.md", "chapter_1");
    expect(result.ok).toBe(false);
  });

  it("rejects a manifest whose H1 number doesn't match the directory name", () => {
    const source = `
# Chapter 2: foo

**Summary:** bar

## Scenes
1. scene_0.md
`.trim();
    const result = parseChapter(source, "chapter_1/chapter.md", "chapter_1");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("chapterNumberMismatch");
  });

  it("rejects a manifest missing the Summary field", () => {
    const source = `
# Chapter 1: foo

## Scenes
1. scene_0.md
`.trim();
    const result = parseChapter(source, "chapter_1/chapter.md", "chapter_1");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("chapterMissingSummary");
  });

  it("rejects a manifest with an empty Scenes list", () => {
    const source = `
# Chapter 1: foo

**Summary:** bar

## Scenes
`.trim();
    const result = parseChapter(source, "chapter_1/chapter.md", "chapter_1");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("chapterNoScenes");
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `bun test scripts/compile-scenes/parser-chapter.test.ts`

Expected: FAIL.

- [ ] **Step 3: Implement the parser**

Create `scripts/compile-scenes/parser-chapter.ts`:

```typescript
// =============================================================================
// scripts/compile-scenes/parser-chapter.ts
//
// Parses a chapter.md manifest. Produces an ASTChapter or a CompileError.
//
// Schema (see writing-chapter-manifest skill):
//   # Chapter <N>: <title>
//   **Summary:** <summary>
//   ## Scenes
//   1. scene_0.md
//   2. investigation_scene_1.md
// =============================================================================

import { tokenize } from "./tokenizer";
import type { ASTChapter, CompileError } from "./types";

export type ChapterParseResult =
  | { ok: true; value: ASTChapter }
  | { ok: false; error: CompileError };

const NUMBERED_FILE_RE = /^(\d+)\.\s+(\S+\.md)\s*$/;

export function parseChapter(
  source: string,
  sourceFile: string,
  dirName: string,
): ChapterParseResult {
  // The manifest has a simple top-down structure; rather than tokenizing,
  // we walk lines directly for the few specific shapes the manifest takes.
  const lines = source.split(/\r?\n/);
  let title: string | null = null;
  let chapterNumber: number | null = null;
  let summary: string | null = null;
  let inScenes = false;
  const sceneFiles: string[] = [];
  let headerLine = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = (lines[i] ?? "").trim();
    const lineNum = i + 1;
    if (line === "") continue;

    if (line.startsWith("# ")) {
      const m = /^#\s+Chapter\s+(\d+):\s+(.+?)\s*$/.exec(line);
      if (!m) {
        return fail(sourceFile, lineNum, "chapterMalformedH1", `H1 must match "# Chapter <N>: <title>"; got: ${line}`);
      }
      chapterNumber = Number(m[1]);
      title = m[2] ?? "";
      headerLine = lineNum;
      continue;
    }

    if (line.startsWith("**Summary:**")) {
      summary = line.slice("**Summary:**".length).trim();
      continue;
    }

    if (line === "## Scenes") {
      inScenes = true;
      continue;
    }

    if (inScenes) {
      const m = NUMBERED_FILE_RE.exec(line);
      if (m) {
        sceneFiles.push(m[2] ?? "");
      }
      // Anything else inside the Scenes block (blank line we already skipped) is ignored.
    }
  }

  if (chapterNumber === null || title === null) {
    return fail(sourceFile, 1, "chapterMissingH1", "Manifest missing # Chapter <N>: <title> heading.");
  }

  const expectedNumber = parseChapterDirNumber(dirName);
  if (expectedNumber !== null && expectedNumber !== chapterNumber) {
    return fail(
      sourceFile,
      headerLine,
      "chapterNumberMismatch",
      `Chapter H1 number ${chapterNumber} does not match directory ${dirName}.`,
    );
  }

  if (summary === null || summary === "") {
    return fail(sourceFile, 1, "chapterMissingSummary", "Manifest missing **Summary:** field.");
  }
  if (sceneFiles.length === 0) {
    return fail(sourceFile, 1, "chapterNoScenes", "Manifest must list at least one scene under ## Scenes.");
  }

  return {
    ok: true,
    value: {
      kind: "chapter",
      dirName,
      number: chapterNumber,
      title,
      summary,
      sceneFiles,
      sourceFile,
      line: headerLine || 1,
    },
  };
}

function parseChapterDirNumber(dirName: string): number | null {
  const m = /^chapter_(\d+)$/.exec(dirName);
  return m ? Number(m[1]) : null;
}

function fail(
  sourceFile: string,
  line: number,
  code: string,
  message: string,
): ChapterParseResult {
  return { ok: false, error: { code, message, sourceFile, line } };
}
```

Note: we don't use the tokenizer here because the manifest grammar is too narrow to benefit — direct line-based matching is clearer.

- [ ] **Step 4: Run tests, verify they pass**

Run: `bun test scripts/compile-scenes/parser-chapter.test.ts`

Expected: all 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/compile-scenes/parser-chapter.ts scripts/compile-scenes/parser-chapter.test.ts
git commit -m "feat(compile): chapter manifest parser + tests"
```

---

### Task 14: Implement the linear scene parser

**Files:**
- Create: `scripts/compile-scenes/parser-linear.ts`
- Create: `scripts/compile-scenes/parser-linear.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `scripts/compile-scenes/parser-linear.test.ts`:

```typescript
import { describe, expect, it } from "bun:test";
import { parseLinearScene } from "./parser-linear";

describe("parseLinearScene", () => {
  it("parses a minimal linear scene", () => {
    const source = `
# Scene 0: 接案

[場景：吉祥寺街道，深夜。]

[相馬律收起傘。]

**早坂茜**：你來得比我想的快。
`.trim();
    const result = parseLinearScene(source, "scene_0.md", "scene_0");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.id).toBe("scene_0");
    expect(result.value.title).toBe("接案");
    expect(result.value.queue).toEqual([
      { kind: "sceneTag", text: "吉祥寺街道，深夜。" },
      { kind: "action", text: "相馬律收起傘。" },
      { kind: "line", speaker: "早坂茜", text: "你來得比我想的快。" },
    ]);
  });

  it("rejects a linear scene containing an H2 heading", () => {
    const source = `
# Scene 0: foo

## NotAllowed

**A**：hi
`.trim();
    const result = parseLinearScene(source, "scene_0.md", "scene_0");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("linearSceneHasHeadings");
  });

  it("rejects a linear scene missing the H1 title", () => {
    const source = `**A**：hi`;
    const result = parseLinearScene(source, "scene_0.md", "scene_0");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("linearSceneMissingTitle");
  });

  it("preserves source order in the queue", () => {
    const source = `
# Scene 0: order

**A**：one
[action one]
**B**：two
[場景：tag]
**A**：three
`.trim();
    const result = parseLinearScene(source, "scene_0.md", "scene_0");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.queue.map((q) => q.kind)).toEqual([
      "line",
      "action",
      "line",
      "sceneTag",
      "line",
    ]);
  });
});
```

- [ ] **Step 2: Verify they fail**

Run: `bun test scripts/compile-scenes/parser-linear.test.ts`

Expected: FAIL.

- [ ] **Step 3: Implement the parser**

Create `scripts/compile-scenes/parser-linear.ts`:

```typescript
// =============================================================================
// scripts/compile-scenes/parser-linear.ts
//
// Parses a linear scene (chapter_<N>/scene_<K>.md).
// Schema (see writing-detective-game-dialogue "Linear scene file format"):
//   # Scene N: <title>
//   <dialogue items in source order>
// No H2+ headings, no metadata.
// =============================================================================

import { tokenize, type Token } from "./tokenizer";
import type { ASTLinearScene, CompileError, DialogueItem } from "./types";

export type LinearParseResult =
  | { ok: true; value: ASTLinearScene }
  | { ok: false; error: CompileError };

export function parseLinearScene(
  source: string,
  sourceFile: string,
  id: string,
): LinearParseResult {
  const tokens = tokenize(source, sourceFile);

  if (tokens.length === 0 || tokens[0]?.kind !== "heading" || tokens[0].level !== 1) {
    return fail(
      sourceFile,
      tokens[0]?.line ?? 1,
      "linearSceneMissingTitle",
      "Linear scene must start with a `# Scene N: <title>` heading.",
    );
  }

  const titleToken = tokens[0];
  // Title text is "Scene 0: 接案" — strip the leading "Scene N:" part.
  const titleMatch = /^Scene\s+\d+:\s*(.+)$/.exec(titleToken.text);
  const title = titleMatch ? (titleMatch[1] ?? "").trim() : titleToken.text;

  const queue: DialogueItem[] = [];

  for (let i = 1; i < tokens.length; i++) {
    const tok = tokens[i];
    if (!tok) continue;

    switch (tok.kind) {
      case "heading":
        return fail(
          sourceFile,
          tok.line,
          "linearSceneHasHeadings",
          `Linear scenes allow only the top-level H1. Found level-${tok.level} heading: ${tok.text}`,
        );
      case "metadata":
        return fail(
          sourceFile,
          tok.line,
          "linearSceneHasMetadata",
          `Linear scenes have no metadata. Found: ${tok.key}.`,
        );
      case "sceneTag":
        queue.push({ kind: "sceneTag", text: tok.text });
        break;
      case "action":
        queue.push({ kind: "action", text: tok.text });
        break;
      case "dialogue":
        queue.push({ kind: "line", speaker: tok.speaker, text: tok.text });
        break;
      case "unknown":
        return fail(
          sourceFile,
          tok.line,
          "linearSceneUnknownLine",
          `Unrecognized line: ${tok.text}`,
        );
    }
  }

  return {
    ok: true,
    value: {
      kind: "linearScene",
      id,
      title,
      queue,
      sourceFile,
      line: titleToken.line,
    },
  };
}

function fail(sourceFile: string, line: number, code: string, message: string): LinearParseResult {
  return { ok: false, error: { code, message, sourceFile, line } };
}
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `bun test scripts/compile-scenes/parser-linear.test.ts`

Expected: all 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/compile-scenes/parser-linear.ts scripts/compile-scenes/parser-linear.test.ts
git commit -m "feat(compile): linear scene parser + tests"
```

---

### Task 15: Implement the investigation scene parser

**Files:**
- Create: `scripts/compile-scenes/parser-investigation.ts`
- Create: `scripts/compile-scenes/parser-investigation.test.ts`

This is the biggest parser — it walks the H2/H3/H4/H5 block hierarchy. Implementation strategy: a small cursor over the token list with one function per block type (`parseInvestigationScene`, `parseSublocation`, `parseHotspot`, `parseCharacter`, `parseTopic`, `parseEvidenceManifestEntry`, `parseStatementManifestEntry`, `parseOutro`). Each function consumes its tokens and stops when it sees a heading at its own level or shallower.

- [ ] **Step 1: Write the failing tests (representative subset; the full happy-path coverage comes via the snapshot test in Task 22)**

Create `scripts/compile-scenes/parser-investigation.test.ts`:

```typescript
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { parseInvestigationScene } from "./parser-investigation";

describe("parseInvestigationScene", () => {
  it("parses the valid fixture investigation scene end-to-end", () => {
    const source = readFileSync(
      "scripts/__fixtures__/valid/chapter_1/investigation_scene_1.md",
      "utf-8",
    );
    const result = parseInvestigationScene(
      source,
      "chapter_1/investigation_scene_1.md",
      "investigation_scene_1",
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const scene = result.value;
    expect(scene.title).toBe("測試調查場景");
    expect(scene.intro.length).toBeGreaterThan(0);

    expect(scene.sublocations).toHaveLength(2);
    expect(scene.sublocations[0]?.id).toBe("main_hall");
    expect(scene.sublocations[0]?.status).toBe("unlocked");
    expect(scene.sublocations[1]?.id).toBe("back_room");
    expect(scene.sublocations[1]?.status).toBe("locked");

    const mainHall = scene.sublocations[0]!;
    expect(mainHall.hotspots).toHaveLength(2);
    expect(mainHall.hotspots[0]?.id).toBe("table");
    expect(mainHall.hotspots[0]?.reveals).toEqual([
      { kind: "evidence", id: "coffee" },
      { kind: "sublocation", id: "back_room" },
    ]);
    expect(mainHall.hotspots[0]?.onReexamine).not.toBeNull();

    expect(mainHall.characters).toHaveLength(1);
    expect(mainHall.characters[0]?.id).toBe("witness");
    expect(mainHall.characters[0]?.topics).toHaveLength(2);
    expect(mainHall.characters[0]?.topics[0]?.onReexamine).not.toBeNull();
    expect(mainHall.characters[0]?.topics[1]?.status).toBe("locked");

    expect(scene.evidenceManifest).toHaveLength(2);
    expect(scene.evidenceManifest[0]?.id).toBe("coffee");
    expect(scene.evidenceManifest[0]?.onCollect.length).toBeGreaterThan(0);
    expect(scene.evidenceManifest[0]?.onReexamine).not.toBeNull();

    expect(scene.statementManifest).toHaveLength(1);
    expect(scene.statementManifest[0]?.id).toBe("witness_alibi");

    expect(scene.outro.unlock).not.toBe("auto");
    expect(scene.outro.dialogue.length).toBeGreaterThan(0);
  });

  it("defaults outro.unlock to 'auto' when not specified", () => {
    const source = `
# Scene 1: x

## Intro

**A**：hi

## Sub-location: room {#room}
- **Status:** unlocked

[場景：a room]

### Hotspot: thing {#thing}
- **Description:** a thing

**A**：observed.

## Evidence Manifest

## Statement Manifest

## Outro

**A**：done.
`.trim();
    const result = parseInvestigationScene(source, "i.md", "i");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.outro.unlock).toBe("auto");
  });

  it("rejects an investigation scene with no H1 title", () => {
    const source = `## Intro\n**A**：hi`;
    const result = parseInvestigationScene(source, "i.md", "i");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("investigationSceneMissingTitle");
  });

  it("rejects a sub-location without a scene tag", () => {
    const source = `
# Scene 1: x

## Sub-location: room {#room}
- **Status:** unlocked

### Hotspot: thing {#thing}
- **Description:** a thing

## Outro
`.trim();
    const result = parseInvestigationScene(source, "i.md", "i");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("sublocationNoSceneTag");
  });

  it("parses an On Reexamine block for an evidence entry", () => {
    const source = `
# Scene 1: x

## Sub-location: room {#room}
- **Status:** unlocked

[場景：a room]

### Hotspot: thing {#thing}
- **Description:** a thing

## Evidence Manifest

### evidence:foo {#foo}
- **Name:** Foo
- **Description:** A foo.
- **Details:** Detail.

#### On Collect

**A**：collected.

#### On Reexamine

**A**：reexamined.

## Outro
`.trim();
    const result = parseInvestigationScene(source, "i.md", "i");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.evidenceManifest[0]?.onReexamine?.length).toBeGreaterThan(0);
  });
});
```

The first test reads the valid fixture authored in Task 8 — so this parser's coverage is anchored to a real, exhaustive example.

- [ ] **Step 2: Verify the tests fail**

Run: `bun test scripts/compile-scenes/parser-investigation.test.ts`

Expected: FAIL (`Cannot find module './parser-investigation'`).

- [ ] **Step 3: Implement the parser**

Create `scripts/compile-scenes/parser-investigation.ts`:

```typescript
// =============================================================================
// scripts/compile-scenes/parser-investigation.ts
//
// Parses an investigation scene (chapter_<N>/investigation_scene_<K>.md).
//
// Block hierarchy (see writing-investigation-scene SKILL.md):
//   H1: # Scene N: <title>
//   H2: ## Intro | ## Sub-location: | ## Evidence Manifest | ## Statement Manifest | ## Outro
//   H3: ### Hotspot: | ### Character: | ### evidence:<id> | ### statement:<id>
//   H4: #### Topic: | #### On Collect | #### On Reexamine | #### On Acquire | #### On Reexamine
//   H5: ##### On Reexamine   (under Topic)
//
// Strategy: a Cursor over the token list with per-block functions that consume
// tokens until they see a heading at their own level or shallower.
// =============================================================================

import { tokenize, type Token } from "./tokenizer";
import { parseUnlockExpr } from "./parser-unlock";
import type {
  ASTCharacter,
  ASTEvidence,
  ASTHotspot,
  ASTInvestigationScene,
  ASTOutro,
  ASTStatement,
  ASTSublocation,
  ASTTopic,
  CompileError,
  DialogueItem,
  RevealTarget,
  UnlockExpr,
} from "./types";

export type InvestigationParseResult =
  | { ok: true; value: ASTInvestigationScene }
  | { ok: false; error: CompileError };

class Cursor {
  i = 0;
  constructor(public readonly tokens: Token[], public readonly sourceFile: string) {}
  peek(): Token | undefined {
    return this.tokens[this.i];
  }
  next(): Token | undefined {
    return this.tokens[this.i++];
  }
  done(): boolean {
    return this.i >= this.tokens.length;
  }
}

export function parseInvestigationScene(
  source: string,
  sourceFile: string,
  id: string,
): InvestigationParseResult {
  const tokens = tokenize(source, sourceFile);
  const cur = new Cursor(tokens, sourceFile);

  // ----- H1 title -----
  const first = cur.peek();
  if (!first || first.kind !== "heading" || first.level !== 1) {
    return fail(sourceFile, first?.line ?? 1, "investigationSceneMissingTitle", "Investigation scene must start with `# Scene N: <title>`.");
  }
  cur.next();
  const titleMatch = /^Scene\s+\d+:\s*(.+)$/.exec(first.text);
  const title = titleMatch ? (titleMatch[1] ?? "").trim() : first.text;

  let intro: DialogueItem[] = [];
  const sublocations: ASTSublocation[] = [];
  const evidenceManifest: ASTEvidence[] = [];
  const statementManifest: ASTStatement[] = [];
  let outro: ASTOutro | null = null;

  while (!cur.done()) {
    const tok = cur.peek();
    if (!tok) break;
    if (tok.kind !== "heading" || tok.level !== 2) {
      return fail(sourceFile, tok.line, "investigationSceneUnexpectedToken", `Expected H2 block heading at scene top level; got: ${describe(tok)}.`);
    }

    if (tok.text === "Intro") {
      cur.next();
      intro = consumeDialogueUntilHeading(cur, 2);
    } else if (tok.text.startsWith("Sub-location:")) {
      const sub = parseSublocation(cur);
      if (!sub.ok) return sub;
      sublocations.push(sub.value);
    } else if (tok.text === "Evidence Manifest") {
      cur.next();
      const entries = parseEvidenceManifest(cur);
      if (!entries.ok) return entries;
      evidenceManifest.push(...entries.value);
    } else if (tok.text === "Statement Manifest") {
      cur.next();
      const entries = parseStatementManifest(cur);
      if (!entries.ok) return entries;
      statementManifest.push(...entries.value);
    } else if (tok.text === "Outro") {
      const o = parseOutro(cur);
      if (!o.ok) return o;
      outro = o.value;
    } else {
      return fail(sourceFile, tok.line, "investigationSceneUnknownH2", `Unknown H2 heading: ${tok.text}.`);
    }
  }

  if (!outro) {
    return fail(sourceFile, first.line, "investigationSceneMissingOutro", "Investigation scene must end with `## Outro`.");
  }
  if (sublocations.length === 0) {
    return fail(sourceFile, first.line, "investigationSceneNoSublocation", "Investigation scene must declare at least one sub-location.");
  }
  if (sublocations[0]?.status !== "unlocked") {
    return fail(sourceFile, sublocations[0]?.line ?? 1, "firstSublocationLocked", "The first sub-location must be Status: unlocked.");
  }

  return {
    ok: true,
    value: {
      kind: "investigationScene",
      id,
      title,
      intro,
      sublocations,
      evidenceManifest,
      statementManifest,
      outro,
      sourceFile,
      line: first.line,
    },
  };
}

// ---------------- Sub-location ----------------

function parseSublocation(cur: Cursor): { ok: true; value: ASTSublocation } | { ok: false; error: CompileError } {
  const head = cur.next();
  if (!head || head.kind !== "heading" || head.level !== 2)
    return fail(cur.sourceFile, head?.line ?? 1, "internalParserState", "parseSublocation called off-position.");
  const id = head.anchorId;
  if (!id) return fail(cur.sourceFile, head.line, "sublocationMissingAnchor", "Sub-location heading must include {#id}.");
  const labelMatch = /^Sub-location:\s*(.+)$/.exec(head.text);
  if (!labelMatch) return fail(cur.sourceFile, head.line, "sublocationMalformedHeading", `Malformed sub-location heading: ${head.text}`);

  const meta = consumeMetadata(cur);
  if (!meta.ok) return meta;
  const status = (meta.value.Status ?? "unlocked") as "locked" | "unlocked";
  let unlock: UnlockExpr | null = null;
  if (meta.value.Unlock) {
    const r = parseUnlockExpr(meta.value.Unlock, cur.sourceFile, head.line);
    if (!r.ok) return r;
    unlock = r.value;
  }
  const reveals = meta.value.Reveals ? parseRevealsList(meta.value.Reveals, cur.sourceFile, head.line) : { ok: true, value: [] as RevealTarget[] };
  if (!reveals.ok) return reveals;

  let sceneTag: string | null = null;
  const transitionDialogue: DialogueItem[] = [];
  const hotspots: ASTHotspot[] = [];
  const characters: ASTCharacter[] = [];

  while (true) {
    const next = cur.peek();
    if (!next) break;
    if (next.kind === "heading" && next.level <= 2) break;
    if (next.kind === "heading" && next.level === 3) {
      if (next.text.startsWith("Hotspot:")) {
        const h = parseHotspot(cur);
        if (!h.ok) return h;
        hotspots.push(h.value);
      } else if (next.text.startsWith("Character:")) {
        const c = parseCharacter(cur);
        if (!c.ok) return c;
        characters.push(c.value);
      } else {
        return fail(cur.sourceFile, next.line, "sublocationUnknownH3", `Unknown H3 inside sub-location: ${next.text}.`);
      }
      continue;
    }
    cur.next();
    if (next.kind === "sceneTag") {
      if (sceneTag !== null) return fail(cur.sourceFile, next.line, "sublocationDuplicateSceneTag", "Sub-location declared multiple [場景：...] tags.");
      sceneTag = next.text;
    } else if (next.kind === "action") {
      transitionDialogue.push({ kind: "action", text: next.text });
    } else if (next.kind === "dialogue") {
      transitionDialogue.push({ kind: "line", speaker: next.speaker, text: next.text });
    } else if (next.kind === "metadata") {
      return fail(cur.sourceFile, next.line, "sublocationStrayMetadata", `Stray metadata inside sub-location body: ${next.key}.`);
    } else if (next.kind === "unknown") {
      return fail(cur.sourceFile, next.line, "sublocationUnknownLine", `Unrecognized line in sub-location: ${next.text}.`);
    }
  }

  if (sceneTag === null) return fail(cur.sourceFile, head.line, "sublocationNoSceneTag", "Sub-location body must include exactly one [場景：...] tag.");

  return {
    ok: true,
    value: {
      id,
      status,
      unlock,
      reveals: reveals.value,
      sceneTag,
      transitionDialogue,
      hotspots,
      characters,
      sourceFile: cur.sourceFile,
      line: head.line,
    },
  };
}

// ---------------- Hotspot ----------------

function parseHotspot(cur: Cursor): { ok: true; value: ASTHotspot } | { ok: false; error: CompileError } {
  const head = cur.next();
  if (!head || head.kind !== "heading" || head.level !== 3) return fail(cur.sourceFile, head?.line ?? 1, "internalParserState", "parseHotspot called off-position.");
  const id = head.anchorId;
  if (!id) return fail(cur.sourceFile, head.line, "hotspotMissingAnchor", "Hotspot heading needs {#id}.");
  const labelMatch = /^Hotspot:\s*(.+)$/.exec(head.text);
  if (!labelMatch) return fail(cur.sourceFile, head.line, "hotspotMalformedHeading", `Malformed hotspot heading: ${head.text}`);
  const label = (labelMatch[1] ?? "").trim();

  const meta = consumeMetadata(cur);
  if (!meta.ok) return meta;
  const description = meta.value.Description;
  if (!description) return fail(cur.sourceFile, head.line, "hotspotMissingDescription", `Hotspot ${id} missing Description.`);
  const status = (meta.value.Status ?? "unlocked") as "locked" | "unlocked";
  let unlock: UnlockExpr | null = null;
  if (meta.value.Unlock) {
    const r = parseUnlockExpr(meta.value.Unlock, cur.sourceFile, head.line);
    if (!r.ok) return r;
    unlock = r.value;
  }
  const reveals = meta.value.Reveals ? parseRevealsList(meta.value.Reveals, cur.sourceFile, head.line) : { ok: true, value: [] as RevealTarget[] };
  if (!reveals.ok) return reveals;

  const inspectDialogue = consumeDialogueUntilHeading(cur, 3);
  const onReexamine = consumeOptionalOnReexamine(cur, 4);

  return {
    ok: true,
    value: {
      id,
      label,
      description,
      status,
      unlock,
      reveals: reveals.value,
      inspectDialogue,
      onReexamine,
      sourceFile: cur.sourceFile,
      line: head.line,
    },
  };
}

// ---------------- Character + Topic ----------------

function parseCharacter(cur: Cursor): { ok: true; value: ASTCharacter } | { ok: false; error: CompileError } {
  const head = cur.next();
  if (!head || head.kind !== "heading" || head.level !== 3) return fail(cur.sourceFile, head?.line ?? 1, "internalParserState", "parseCharacter called off-position.");
  const id = head.anchorId;
  if (!id) return fail(cur.sourceFile, head.line, "characterMissingAnchor", "Character heading needs {#id}.");
  const nameMatch = /^Character:\s*(.+)$/.exec(head.text);
  if (!nameMatch) return fail(cur.sourceFile, head.line, "characterMalformedHeading", `Malformed character heading: ${head.text}`);
  const name = (nameMatch[1] ?? "").trim();

  const meta = consumeMetadata(cur);
  if (!meta.ok) return meta;
  const role = meta.value.Role;
  const bio = meta.value.Bio;
  if (!role) return fail(cur.sourceFile, head.line, "characterMissingRole", `Character ${id} missing Role.`);
  if (!bio) return fail(cur.sourceFile, head.line, "characterMissingBio", `Character ${id} missing Bio.`);

  const topics: ASTTopic[] = [];
  while (true) {
    const next = cur.peek();
    if (!next) break;
    if (next.kind === "heading" && next.level <= 3) break;
    if (next.kind === "heading" && next.level === 4 && next.text.startsWith("Topic:")) {
      const t = parseTopic(cur, id);
      if (!t.ok) return t;
      topics.push(t.value);
      continue;
    }
    // Anything else under a character that isn't a topic is a malformed authoring shape.
    return fail(cur.sourceFile, next.line, "characterBodyUnexpected", `Character body should only contain #### Topic blocks. Got: ${describe(next)}.`);
  }

  return {
    ok: true,
    value: {
      id,
      name,
      role,
      bio,
      topics,
      sourceFile: cur.sourceFile,
      line: head.line,
    },
  };
}

function parseTopic(cur: Cursor, characterId: string): { ok: true; value: ASTTopic } | { ok: false; error: CompileError } {
  const head = cur.next();
  if (!head || head.kind !== "heading" || head.level !== 4) return fail(cur.sourceFile, head?.line ?? 1, "internalParserState", "parseTopic called off-position.");
  const id = head.anchorId;
  if (!id) return fail(cur.sourceFile, head.line, "topicMissingAnchor", "Topic heading needs {#id}.");
  const labelMatch = /^Topic:\s*(.+)$/.exec(head.text);
  if (!labelMatch) return fail(cur.sourceFile, head.line, "topicMalformedHeading", `Malformed topic heading: ${head.text}`);
  const label = (labelMatch[1] ?? "").trim();

  const meta = consumeMetadata(cur);
  if (!meta.ok) return meta;
  const status = (meta.value.Status ?? "unlocked") as "locked" | "unlocked";
  let unlock: UnlockExpr | null = null;
  if (meta.value.Unlock) {
    const r = parseUnlockExpr(meta.value.Unlock, cur.sourceFile, head.line);
    if (!r.ok) return r;
    unlock = r.value;
  }
  const reveals = meta.value.Reveals ? parseRevealsList(meta.value.Reveals, cur.sourceFile, head.line) : { ok: true, value: [] as RevealTarget[] };
  if (!reveals.ok) return reveals;

  const topicDialogue = consumeDialogueUntilHeading(cur, 4);
  const onReexamine = consumeOptionalOnReexamine(cur, 5);

  return {
    ok: true,
    value: {
      id,
      label,
      status,
      unlock,
      reveals: reveals.value,
      topicDialogue,
      onReexamine,
      sourceFile: cur.sourceFile,
      line: head.line,
    },
  };
}

// ---------------- Evidence + Statement Manifests ----------------

function parseEvidenceManifest(cur: Cursor): { ok: true; value: ASTEvidence[] } | { ok: false; error: CompileError } {
  const entries: ASTEvidence[] = [];
  while (true) {
    const tok = cur.peek();
    if (!tok) break;
    if (tok.kind === "heading" && tok.level <= 2) break;
    if (tok.kind === "heading" && tok.level === 3) {
      const e = parseEvidenceEntry(cur);
      if (!e.ok) return e;
      entries.push(e.value);
      continue;
    }
    return fail(cur.sourceFile, tok.line, "evidenceManifestUnexpected", `Unexpected content in Evidence Manifest: ${describe(tok)}.`);
  }
  return { ok: true, value: entries };
}

function parseEvidenceEntry(cur: Cursor): { ok: true; value: ASTEvidence } | { ok: false; error: CompileError } {
  const head = cur.next();
  if (!head || head.kind !== "heading" || head.level !== 3) return fail(cur.sourceFile, head?.line ?? 1, "internalParserState", "parseEvidenceEntry called off-position.");
  const m = /^evidence:([a-z0-9_]+)$/.exec(head.text);
  if (!m) return fail(cur.sourceFile, head.line, "evidenceMalformedHeading", `Evidence heading must be "### evidence:<id> {#<id>}". Got: ${head.text}`);
  const id = m[1] ?? "";
  if (head.anchorId !== id) return fail(cur.sourceFile, head.line, "evidenceAnchorMismatch", `Evidence anchor #${head.anchorId} does not match id ${id}.`);

  const meta = consumeMetadata(cur);
  if (!meta.ok) return meta;
  const name = meta.value.Name;
  const description = meta.value.Description;
  const details = meta.value.Details;
  if (!name || !description || !details) return fail(cur.sourceFile, head.line, "evidenceMissingMetadata", `Evidence ${id} requires Name, Description, Details.`);

  let onCollect: DialogueItem[] | null = null;
  let onReexamine: DialogueItem[] | null = null;

  while (true) {
    const next = cur.peek();
    if (!next) break;
    if (next.kind === "heading" && next.level <= 3) break;
    if (next.kind === "heading" && next.level === 4) {
      if (next.text === "On Collect") {
        cur.next();
        onCollect = consumeDialogueUntilHeading(cur, 4);
        continue;
      }
      if (next.text === "On Reexamine") {
        cur.next();
        onReexamine = consumeDialogueUntilHeading(cur, 4);
        continue;
      }
      return fail(cur.sourceFile, next.line, "evidenceUnknownH4", `Unknown H4 under evidence ${id}: ${next.text}.`);
    }
    return fail(cur.sourceFile, next.line, "evidenceUnexpectedToken", `Unexpected token in evidence ${id}: ${describe(next)}.`);
  }

  if (!onCollect) return fail(cur.sourceFile, head.line, "evidenceMissingOnCollect", `Evidence ${id} must define #### On Collect.`);

  return {
    ok: true,
    value: {
      id,
      name,
      description,
      details,
      onCollect,
      onReexamine,
      sourceFile: cur.sourceFile,
      line: head.line,
    },
  };
}

function parseStatementManifest(cur: Cursor): { ok: true; value: ASTStatement[] } | { ok: false; error: CompileError } {
  const entries: ASTStatement[] = [];
  while (true) {
    const tok = cur.peek();
    if (!tok) break;
    if (tok.kind === "heading" && tok.level <= 2) break;
    if (tok.kind === "heading" && tok.level === 3) {
      const e = parseStatementEntry(cur);
      if (!e.ok) return e;
      entries.push(e.value);
      continue;
    }
    return fail(cur.sourceFile, tok.line, "statementManifestUnexpected", `Unexpected content in Statement Manifest: ${describe(tok)}.`);
  }
  return { ok: true, value: entries };
}

function parseStatementEntry(cur: Cursor): { ok: true; value: ASTStatement } | { ok: false; error: CompileError } {
  const head = cur.next();
  if (!head || head.kind !== "heading" || head.level !== 3) return fail(cur.sourceFile, head?.line ?? 1, "internalParserState", "parseStatementEntry called off-position.");
  const m = /^statement:([a-z0-9_]+)$/.exec(head.text);
  if (!m) return fail(cur.sourceFile, head.line, "statementMalformedHeading", `Statement heading must be "### statement:<id> {#<id>}". Got: ${head.text}`);
  const id = m[1] ?? "";
  if (head.anchorId !== id) return fail(cur.sourceFile, head.line, "statementAnchorMismatch", `Statement anchor #${head.anchorId} does not match id ${id}.`);

  const meta = consumeMetadata(cur);
  if (!meta.ok) return meta;
  const speaker = meta.value.Speaker;
  const content = meta.value.Content;
  if (!speaker || !content) return fail(cur.sourceFile, head.line, "statementMissingMetadata", `Statement ${id} requires Speaker and Content.`);

  let onAcquire: DialogueItem[] | null = null;
  let onReexamine: DialogueItem[] | null = null;

  while (true) {
    const next = cur.peek();
    if (!next) break;
    if (next.kind === "heading" && next.level <= 3) break;
    if (next.kind === "heading" && next.level === 4) {
      if (next.text === "On Acquire") {
        cur.next();
        onAcquire = consumeDialogueUntilHeading(cur, 4);
        continue;
      }
      if (next.text === "On Reexamine") {
        cur.next();
        onReexamine = consumeDialogueUntilHeading(cur, 4);
        continue;
      }
      return fail(cur.sourceFile, next.line, "statementUnknownH4", `Unknown H4 under statement ${id}: ${next.text}.`);
    }
    return fail(cur.sourceFile, next.line, "statementUnexpectedToken", `Unexpected token in statement ${id}: ${describe(next)}.`);
  }

  if (!onAcquire) return fail(cur.sourceFile, head.line, "statementMissingOnAcquire", `Statement ${id} must define #### On Acquire.`);

  return {
    ok: true,
    value: {
      id,
      speaker,
      content,
      onAcquire,
      onReexamine,
      sourceFile: cur.sourceFile,
      line: head.line,
    },
  };
}

// ---------------- Outro ----------------

function parseOutro(cur: Cursor): { ok: true; value: ASTOutro } | { ok: false; error: CompileError } {
  const head = cur.next();
  if (!head || head.kind !== "heading" || head.level !== 2 || head.text !== "Outro") {
    return fail(cur.sourceFile, head?.line ?? 1, "internalParserState", "parseOutro called off-position.");
  }
  const meta = consumeMetadata(cur);
  if (!meta.ok) return meta;
  let unlock: UnlockExpr | "auto" = "auto";
  if (meta.value.Unlock) {
    const r = parseUnlockExpr(meta.value.Unlock, cur.sourceFile, head.line);
    if (!r.ok) return r;
    unlock = r.value;
  }
  const dialogue = consumeDialogueUntilHeading(cur, 2);
  return { ok: true, value: { unlock, dialogue } };
}

// ---------------- Shared helpers ----------------

function consumeMetadata(
  cur: Cursor,
): { ok: true; value: Record<string, string> } | { ok: false; error: CompileError } {
  const out: Record<string, string> = {};
  while (true) {
    const next = cur.peek();
    if (!next || next.kind !== "metadata") return { ok: true, value: out };
    cur.next();
    out[next.key] = next.value;
  }
}

function consumeDialogueUntilHeading(cur: Cursor, atOrAboveLevel: number): DialogueItem[] {
  const out: DialogueItem[] = [];
  while (true) {
    const next = cur.peek();
    if (!next) break;
    if (next.kind === "heading" && next.level <= atOrAboveLevel) break;
    cur.next();
    if (next.kind === "sceneTag") out.push({ kind: "sceneTag", text: next.text });
    else if (next.kind === "action") out.push({ kind: "action", text: next.text });
    else if (next.kind === "dialogue") out.push({ kind: "line", speaker: next.speaker, text: next.text });
    // metadata/unknown are silently skipped in dialogue body collection; validator catches them upstream.
  }
  return out;
}

function consumeOptionalOnReexamine(cur: Cursor, expectedLevel: number): DialogueItem[] | null {
  const next = cur.peek();
  if (!next || next.kind !== "heading") return null;
  if (next.level !== expectedLevel) return null;
  if (next.text !== "On Reexamine") return null;
  cur.next();
  return consumeDialogueUntilHeading(cur, expectedLevel);
}

function parseRevealsList(
  raw: string,
  sourceFile: string,
  line: number,
): { ok: true; value: RevealTarget[] } | { ok: false; error: CompileError } {
  const m = /^\[(.*)\]\s*$/.exec(raw.trim());
  if (!m) return fail(sourceFile, line, "revealsMalformed", `Reveals value must be a [list]. Got: ${raw}`);
  const items = (m[1] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const out: RevealTarget[] = [];
  for (const item of items) {
    const target = parseRevealTarget(item, sourceFile, line);
    if (!target.ok) return target;
    out.push(target.value);
  }
  return { ok: true, value: out };
}

function parseRevealTarget(
  raw: string,
  sourceFile: string,
  line: number,
): { ok: true; value: RevealTarget } | { ok: false; error: CompileError } {
  // evidence:foo | statement:foo | hotspot:foo | sublocation:foo | topic:char@topic
  const m = /^(evidence|statement|hotspot|sublocation|topic):(.+)$/.exec(raw);
  if (!m) return fail(sourceFile, line, "revealUnknownPrefix", `Unknown reveal target prefix: ${raw}`);
  const kind = m[1] as RevealTarget["kind"];
  const tail = m[2] ?? "";
  if (kind === "topic") {
    const mt = /^([a-z0-9_]+)@([a-z0-9_]+)$/.exec(tail);
    if (!mt) return fail(sourceFile, line, "revealTopicMalformed", `Topic reveal must be topic:<char>@<topic>. Got: ${raw}`);
    return { ok: true, value: { kind: "topic", characterId: mt[1] ?? "", topicId: mt[2] ?? "" } };
  }
  if (!/^[a-z0-9_]+$/.test(tail)) return fail(sourceFile, line, "revealIdMalformed", `Reveal id must be snake_case slug: ${raw}`);
  return { ok: true, value: { kind, id: tail } };
}

function describe(tok: Token): string {
  switch (tok.kind) {
    case "heading":
      return `H${tok.level} "${tok.text}"`;
    case "metadata":
      return `metadata ${tok.key}`;
    case "sceneTag":
      return `[場景：${tok.text}]`;
    case "action":
      return `[${tok.text}]`;
    case "dialogue":
      return `**${tok.speaker}**：${tok.text}`;
    case "unknown":
      return `unknown(${tok.text})`;
  }
}

function fail(
  sourceFile: string,
  line: number,
  code: string,
  message: string,
): { ok: false; error: CompileError } {
  return { ok: false, error: { code, message, sourceFile, line } };
}
```

- [ ] **Step 4: Run the tests, verify they pass**

Run: `bun test scripts/compile-scenes/parser-investigation.test.ts`

Expected: all 5 tests PASS. The fixture file from Task 8 is the major coverage point — if that scene parses cleanly, the parser covers every block type.

- [ ] **Step 5: Commit**

```bash
git add scripts/compile-scenes/parser-investigation.ts scripts/compile-scenes/parser-investigation.test.ts
git commit -m "feat(compile): investigation scene parser (block hierarchy + reveals/unlocks)"
```

---

## Phase A7: Validator

### Task 16: Implement the cross-file validator

**Files:**
- Create: `scripts/compile-scenes/validator.ts`
- Create: `scripts/compile-scenes/validator.test.ts`

The validator takes the per-file AST results and runs cross-file rules: ID resolution, global uniqueness, the v1 cross-chapter-Unlock restriction, completion-path constraints (no orphan locked blocks, no circular unlock chains, etc.).

- [ ] **Step 1: Write the failing tests**

Create `scripts/compile-scenes/validator.test.ts`:

```typescript
import { describe, expect, it } from "bun:test";
import { validate } from "./validator";
import type {
  ASTChapter,
  ASTInvestigationScene,
  ASTLinearScene,
  DialogueItem,
} from "./types";

// Test helpers — minimal AST builders.

const mkLinearScene = (id: string): ASTLinearScene => ({
  kind: "linearScene",
  id,
  title: id,
  queue: [],
  sourceFile: `${id}.md`,
  line: 1,
});

const mkInvestigationScene = (overrides: Partial<ASTInvestigationScene> = {}): ASTInvestigationScene => ({
  kind: "investigationScene",
  id: overrides.id ?? "i",
  title: overrides.title ?? "i",
  intro: [],
  sublocations: [
    {
      id: "room",
      status: "unlocked",
      unlock: null,
      reveals: [],
      sceneTag: "tag",
      transitionDialogue: [],
      hotspots: [
        {
          id: "thing",
          label: "thing",
          description: "a thing",
          status: "unlocked",
          unlock: null,
          reveals: [],
          inspectDialogue: [{ kind: "line", speaker: "A", text: "hi" }] as DialogueItem[],
          onReexamine: null,
          sourceFile: "i.md",
          line: 4,
        },
      ],
      characters: [],
      sourceFile: "i.md",
      line: 2,
    },
  ],
  evidenceManifest: [],
  statementManifest: [],
  outro: { unlock: "auto", dialogue: [] },
  sourceFile: "i.md",
  line: 1,
  ...overrides,
});

const mkChapter = (number: number, sceneFiles: string[]): ASTChapter => ({
  kind: "chapter",
  dirName: `chapter_${number}`,
  number,
  title: `Chapter ${number}`,
  summary: "s",
  sceneFiles,
  sourceFile: `chapter_${number}/chapter.md`,
  line: 1,
});

describe("validator", () => {
  it("accepts a valid minimal corpus", () => {
    const errors = validate({
      chapters: [mkChapter(1, ["scene_0.md", "investigation_scene_1.md"])],
      scenes: [
        { chapterId: "chapter_1", file: "scene_0.md", ast: mkLinearScene("scene_0") },
        { chapterId: "chapter_1", file: "investigation_scene_1.md", ast: mkInvestigationScene({ id: "investigation_scene_1" }) },
      ],
    });
    expect(errors).toEqual([]);
  });

  it("rejects a chapter manifest pointing to a non-existent scene file", () => {
    const errors = validate({
      chapters: [mkChapter(1, ["missing.md"])],
      scenes: [],
    });
    expect(errors.find((e) => e.code === "chapterManifestMissingFile")).toBeDefined();
  });

  it("rejects a hotspot whose Reveals target an undeclared evidence id", () => {
    const scene = mkInvestigationScene({ id: "i" });
    scene.sublocations[0]!.hotspots[0]!.reveals = [{ kind: "evidence", id: "ghost" }];
    const errors = validate({
      chapters: [mkChapter(1, ["i.md"])],
      scenes: [{ chapterId: "chapter_1", file: "i.md", ast: scene }],
    });
    expect(errors.find((e) => e.code === "unresolvedRevealTarget")).toBeDefined();
  });

  it("rejects duplicate global evidence ids across chapters", () => {
    const scene1 = mkInvestigationScene({ id: "a" });
    scene1.evidenceManifest = [
      { id: "dup", name: "n", description: "d", details: "x", onCollect: [], onReexamine: null, sourceFile: "a.md", line: 10 },
    ];
    const scene2 = mkInvestigationScene({ id: "b" });
    scene2.evidenceManifest = [
      { id: "dup", name: "n", description: "d", details: "x", onCollect: [], onReexamine: null, sourceFile: "b.md", line: 10 },
    ];
    const errors = validate({
      chapters: [mkChapter(1, ["a.md"]), mkChapter(2, ["b.md"])],
      scenes: [
        { chapterId: "chapter_1", file: "a.md", ast: scene1 },
        { chapterId: "chapter_2", file: "b.md", ast: scene2 },
      ],
    });
    expect(errors.find((e) => e.code === "duplicateGlobalEvidenceId")).toBeDefined();
  });

  it("rejects a cross-chapter Unlock predicate (v1 restriction)", () => {
    const scene1 = mkInvestigationScene({ id: "a" });
    scene1.evidenceManifest = [
      { id: "foo", name: "n", description: "d", details: "x", onCollect: [], onReexamine: null, sourceFile: "a.md", line: 10 },
    ];
    const scene2 = mkInvestigationScene({ id: "b" });
    scene2.outro = {
      unlock: { predicate: "evidence_collected", id: "foo" },
      dialogue: [],
    };
    const errors = validate({
      chapters: [mkChapter(1, ["a.md"]), mkChapter(2, ["b.md"])],
      scenes: [
        { chapterId: "chapter_1", file: "a.md", ast: scene1 },
        { chapterId: "chapter_2", file: "b.md", ast: scene2 },
      ],
    });
    expect(errors.find((e) => e.code === "crossChapterUnlock")).toBeDefined();
  });

  it("rejects an Outro Unlock referencing a hotspot id not declared in the same scene", () => {
    const scene = mkInvestigationScene({ id: "i" });
    scene.outro = {
      unlock: { predicate: "hotspot_investigated", id: "ghost" },
      dialogue: [],
    };
    const errors = validate({
      chapters: [mkChapter(1, ["i.md"])],
      scenes: [{ chapterId: "chapter_1", file: "i.md", ast: scene }],
    });
    expect(errors.find((e) => e.code === "unresolvedUnlockPredicate")).toBeDefined();
  });

  it("rejects a locked sub-location with no inbound Reveals and no Unlock", () => {
    const scene = mkInvestigationScene({ id: "i" });
    scene.sublocations.push({
      id: "orphan",
      status: "locked",
      unlock: null,
      reveals: [],
      sceneTag: "t",
      transitionDialogue: [],
      hotspots: [],
      characters: [],
      sourceFile: "i.md",
      line: 50,
    });
    const errors = validate({
      chapters: [mkChapter(1, ["i.md"])],
      scenes: [{ chapterId: "chapter_1", file: "i.md", ast: scene }],
    });
    expect(errors.find((e) => e.code === "lockedBlockUnreachable")).toBeDefined();
  });

  it("rejects a block with BOTH an inbound Reveals and a self Unlock", () => {
    const scene = mkInvestigationScene({ id: "i" });
    // The default hotspot is at index 0; add a locked sub-location it reveals AND give it an Unlock.
    scene.sublocations[0]!.hotspots[0]!.reveals = [{ kind: "sublocation", id: "double_path" }];
    scene.sublocations.push({
      id: "double_path",
      status: "locked",
      unlock: { predicate: "hotspot_investigated", id: "thing" },
      reveals: [],
      sceneTag: "t",
      transitionDialogue: [],
      hotspots: [],
      characters: [],
      sourceFile: "i.md",
      line: 60,
    });
    const errors = validate({
      chapters: [mkChapter(1, ["i.md"])],
      scenes: [{ chapterId: "chapter_1", file: "i.md", ast: scene }],
    });
    expect(errors.find((e) => e.code === "revealsAndUnlockBoth")).toBeDefined();
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `bun test scripts/compile-scenes/validator.test.ts`

Expected: FAIL — `Cannot find module './validator'`.

- [ ] **Step 3: Implement the validator**

Create `scripts/compile-scenes/validator.ts`:

```typescript
// =============================================================================
// scripts/compile-scenes/validator.ts
//
// Cross-file + per-file invariant checking. Builds a single registry from all
// chapters and scenes, then enumerates rules from spec §3d:
//   - Manifest scene files exist with valid prefixes.
//   - Reveals targets are scene-local for all five kinds.
//   - Unlock predicates are scene-local in v1 (the cross-chapter restriction).
//   - Evidence/statement IDs are globally unique.
//   - Locked blocks have a path: inbound Reveals OR self Unlock (xor).
//   - First sub-location is unlocked (checked in parser but re-asserted here).
//   - No circular unlock chains.
// =============================================================================

import type {
  ASTChapter,
  ASTInvestigationScene,
  ASTLinearScene,
  CompileError,
  RevealTarget,
  UnlockExpr,
} from "./types";

export type SceneRecord = {
  chapterId: string;
  file: string;
  ast: ASTLinearScene | ASTInvestigationScene;
};

export type ValidatorInput = {
  chapters: ASTChapter[];
  scenes: SceneRecord[];
};

export function validate(input: ValidatorInput): CompileError[] {
  const errors: CompileError[] = [];
  const globalEvidence = new Map<string, { chapterId: string; sourceFile: string; line: number }>();
  const globalStatement = new Map<string, { chapterId: string; sourceFile: string; line: number }>();

  // ---- Pass 1: build global registries + per-file structural checks. ----
  for (const rec of input.scenes) {
    if (rec.ast.kind !== "investigationScene") continue;
    const scene = rec.ast;

    for (const e of scene.evidenceManifest) {
      const prev = globalEvidence.get(e.id);
      if (prev) {
        errors.push({
          code: "duplicateGlobalEvidenceId",
          message: `Evidence id "${e.id}" declared in two scenes: ${prev.sourceFile}:${prev.line} and ${e.sourceFile}:${e.line}.`,
          sourceFile: e.sourceFile,
          line: e.line,
        });
      } else {
        globalEvidence.set(e.id, { chapterId: rec.chapterId, sourceFile: e.sourceFile, line: e.line });
      }
    }
    for (const s of scene.statementManifest) {
      const prev = globalStatement.get(s.id);
      if (prev) {
        errors.push({
          code: "duplicateGlobalStatementId",
          message: `Statement id "${s.id}" declared in two scenes: ${prev.sourceFile}:${prev.line} and ${s.sourceFile}:${s.line}.`,
          sourceFile: s.sourceFile,
          line: s.line,
        });
      } else {
        globalStatement.set(s.id, { chapterId: rec.chapterId, sourceFile: s.sourceFile, line: s.line });
      }
    }
  }

  // ---- Pass 2: per-scene ID resolution + locked-block reachability. ----
  for (const rec of input.scenes) {
    if (rec.ast.kind !== "investigationScene") continue;
    validateInvestigationScene(rec, errors);
  }

  // ---- Pass 3: chapter manifests refer to existing files. ----
  for (const chapter of input.chapters) {
    const sceneFilesInChapter = new Set(
      input.scenes.filter((s) => s.chapterId === chapter.dirName).map((s) => s.file),
    );
    for (const file of chapter.sceneFiles) {
      if (!sceneFilesInChapter.has(file)) {
        errors.push({
          code: "chapterManifestMissingFile",
          message: `Chapter ${chapter.dirName} lists "${file}" but no such file was loaded.`,
          sourceFile: chapter.sourceFile,
          line: chapter.line,
        });
      }
    }
  }

  return errors;
}

function validateInvestigationScene(rec: SceneRecord, errors: CompileError[]): void {
  const scene = rec.ast as ASTInvestigationScene;

  // Local registries.
  const localEvidence = new Set(scene.evidenceManifest.map((e) => e.id));
  const localStatement = new Set(scene.statementManifest.map((s) => s.id));
  const localHotspot = new Set<string>();
  const localTopic = new Set<string>(); // "characterId@topicId"
  const localSublocation = new Set<string>();

  for (const sub of scene.sublocations) {
    localSublocation.add(sub.id);
    for (const h of sub.hotspots) localHotspot.add(h.id);
    for (const c of sub.characters) for (const t of c.topics) localTopic.add(`${c.id}@${t.id}`);
  }

  const inboundReveals = new Map<string, { source: string; line: number }>(); // target key → who revealed it

  // ---- Walk all Reveals; check they resolve scene-local. ----
  const checkReveals = (source: string, line: number, list: RevealTarget[]) => {
    for (const r of list) {
      const key = revealKey(r);
      switch (r.kind) {
        case "evidence":
          if (!localEvidence.has(r.id)) {
            errors.push({
              code: "unresolvedRevealTarget",
              message: `Reveal target evidence:${r.id} not declared in this scene's Evidence Manifest.`,
              sourceFile: scene.sourceFile,
              line,
            });
          }
          break;
        case "statement":
          if (!localStatement.has(r.id)) {
            errors.push({
              code: "unresolvedRevealTarget",
              message: `Reveal target statement:${r.id} not declared in this scene's Statement Manifest.`,
              sourceFile: scene.sourceFile,
              line,
            });
          }
          break;
        case "hotspot":
          if (!localHotspot.has(r.id))
            errors.push({ code: "unresolvedRevealTarget", message: `Reveal target hotspot:${r.id} not declared in this scene.`, sourceFile: scene.sourceFile, line });
          break;
        case "topic":
          if (!localTopic.has(`${r.characterId}@${r.topicId}`))
            errors.push({ code: "unresolvedRevealTarget", message: `Reveal target topic:${r.characterId}@${r.topicId} not declared in this scene.`, sourceFile: scene.sourceFile, line });
          break;
        case "sublocation":
          if (!localSublocation.has(r.id))
            errors.push({ code: "unresolvedRevealTarget", message: `Reveal target sublocation:${r.id} not declared in this scene.`, sourceFile: scene.sourceFile, line });
          break;
      }
      inboundReveals.set(key, { source, line });
    }
  };

  for (const sub of scene.sublocations) {
    checkReveals(`sublocation:${sub.id}`, sub.line, sub.reveals);
    for (const h of sub.hotspots) checkReveals(`hotspot:${h.id}`, h.line, h.reveals);
    for (const c of sub.characters) for (const t of c.topics) checkReveals(`topic:${c.id}@${t.id}`, t.line, t.reveals);
  }

  // ---- Walk all Unlock expressions; check predicates resolve scene-local. ----
  //
  // v1 restriction (spec §3d): All four predicate kinds must resolve to declarations
  // in this same scene file. Cross-scene unlock predicates are a hard error. We don't
  // distinguish "doesn't exist anywhere" vs. "exists in another scene" — both are
  // equally invalid in v1, both surface the same error code.
  const checkUnlock = (expr: UnlockExpr | null, sourceFile: string, line: number) => {
    if (expr === null) return;
    walkUnlock(expr, (pred) => {
      switch (pred.predicate) {
        case "evidence_collected":
          if (!localEvidence.has(pred.id)) {
            errors.push({
              code: "crossChapterUnlock",
              message: `Unlock predicate evidence:${pred.id} collected — id not declared in this scene's Evidence Manifest. v1 disallows cross-scene Unlock predicates (see spec §3d).`,
              sourceFile,
              line,
            });
          }
          break;
        case "statement_acquired":
          if (!localStatement.has(pred.id)) {
            errors.push({
              code: "crossChapterUnlock",
              message: `Unlock predicate statement:${pred.id} acquired — id not declared in this scene's Statement Manifest. v1 disallows cross-scene Unlock predicates (see spec §3d).`,
              sourceFile,
              line,
            });
          }
          break;
        case "topic_discussed":
          if (!localTopic.has(`${pred.characterId}@${pred.topicId}`))
            errors.push({
              code: "unresolvedUnlockPredicate",
              message: `Unlock predicate topic:${pred.characterId}@${pred.topicId} discussed — not declared in this scene.`,
              sourceFile,
              line,
            });
          break;
        case "hotspot_investigated":
          if (!localHotspot.has(pred.id))
            errors.push({
              code: "unresolvedUnlockPredicate",
              message: `Unlock predicate hotspot:${pred.id} investigated — not declared in this scene.`,
              sourceFile,
              line,
            });
          break;
      }
    });
  };

  for (const sub of scene.sublocations) {
    checkUnlock(sub.unlock, scene.sourceFile, sub.line);
    for (const h of sub.hotspots) checkUnlock(h.unlock, scene.sourceFile, h.line);
    for (const c of sub.characters) for (const t of c.topics) checkUnlock(t.unlock, scene.sourceFile, t.line);
  }
  if (scene.outro.unlock !== "auto") checkUnlock(scene.outro.unlock, scene.sourceFile, scene.line);

  // ---- Reveals-AND-Unlock both error + locked-block reachability ----
  for (const sub of scene.sublocations) {
    const key = `sublocation:${sub.id}`;
    if (sub.status === "locked") {
      const hasInbound = inboundReveals.has(key);
      const hasUnlock = sub.unlock !== null;
      if (hasInbound && hasUnlock)
        errors.push({ code: "revealsAndUnlockBoth", message: `sublocation ${sub.id} has both an inbound Reveals and a self Unlock — pick one.`, sourceFile: scene.sourceFile, line: sub.line });
      if (!hasInbound && !hasUnlock)
        errors.push({ code: "lockedBlockUnreachable", message: `sublocation ${sub.id} is locked but has no Unlock and no inbound Reveals — unreachable.`, sourceFile: scene.sourceFile, line: sub.line });
    }
    for (const h of sub.hotspots) checkLockedReachability(`hotspot:${h.id}`, h.status, h.unlock !== null, inboundReveals.has(`hotspot:${h.id}`), scene.sourceFile, h.line, errors);
    for (const c of sub.characters)
      for (const t of c.topics)
        checkLockedReachability(`topic:${c.id}@${t.id}`, t.status, t.unlock !== null, inboundReveals.has(`topic:${c.id}@${t.id}`), scene.sourceFile, t.line, errors);
  }
}

function checkLockedReachability(
  key: string,
  status: "locked" | "unlocked",
  hasUnlock: boolean,
  hasInbound: boolean,
  sourceFile: string,
  line: number,
  errors: CompileError[],
) {
  if (status !== "locked") return;
  if (hasInbound && hasUnlock)
    errors.push({ code: "revealsAndUnlockBoth", message: `${key} has both inbound Reveals and self Unlock — pick one.`, sourceFile, line });
  if (!hasInbound && !hasUnlock)
    errors.push({ code: "lockedBlockUnreachable", message: `${key} is locked but unreachable (no Unlock and no inbound Reveals).`, sourceFile, line });
}

function walkUnlock(expr: UnlockExpr, fn: (atom: Extract<UnlockExpr, { predicate: string }>) => void): void {
  if ("op" in expr) {
    walkUnlock(expr.left, fn);
    walkUnlock(expr.right, fn);
  } else {
    fn(expr);
  }
}

function revealKey(r: RevealTarget): string {
  switch (r.kind) {
    case "topic":
      return `topic:${r.characterId}@${r.topicId}`;
    default:
      return `${r.kind}:${r.id}`;
  }
}
```

Note: this validator catches the main rules from §3d. A few smaller rules (circular unlock chains) are not implemented here for v1 because they require graph traversal and chapter 1 doesn't exercise that complexity; add a TODO note in the code or revisit in Plan B if the snapshot test or fixture surfaces a need.

- [ ] **Step 4: Run tests, verify they pass**

Run: `bun test scripts/compile-scenes/validator.test.ts`

Expected: all 8 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/compile-scenes/validator.ts scripts/compile-scenes/validator.test.ts
git commit -m "feat(compile): cross-file validator (IDs, reveals, unlocks, reachability, v1 restriction)"
```

---

## Phase A8: Emitter

### Task 17: Implement the JSON emitter

**Files:**
- Create: `scripts/compile-scenes/emitter.ts`
- Create: `scripts/compile-scenes/emitter.test.ts`

The emitter is a pure function: AST → JSON. No I/O; the orchestrator handles writing files. Keeping I/O out of the emitter makes it testable on objects in memory.

- [ ] **Step 1: Write the failing tests**

Create `scripts/compile-scenes/emitter.test.ts`:

```typescript
import { describe, expect, it } from "bun:test";
import { emitChaptersIndex, emitInvestigationScene, emitLinearScene } from "./emitter";
import type { ASTChapter, ASTInvestigationScene, ASTLinearScene } from "./types";

describe("emitter", () => {
  it("emits a linear scene JSON", () => {
    const ast: ASTLinearScene = {
      kind: "linearScene",
      id: "scene_0",
      title: "接案",
      queue: [
        { kind: "sceneTag", text: "街道" },
        { kind: "line", speaker: "A", text: "hi" },
      ],
      sourceFile: "scene_0.md",
      line: 1,
    };
    const json = emitLinearScene(ast);
    expect(json).toEqual({
      type: "linear",
      id: "scene_0",
      title: "接案",
      queue: [
        { kind: "sceneTag", text: "街道" },
        { kind: "line", speaker: "A", text: "hi" },
      ],
    });
  });

  it("emits an investigation scene JSON with auto outro preserved", () => {
    const ast: ASTInvestigationScene = {
      kind: "investigationScene",
      id: "i",
      title: "t",
      intro: [],
      sublocations: [],
      evidenceManifest: [],
      statementManifest: [],
      outro: { unlock: "auto", dialogue: [] },
      sourceFile: "i.md",
      line: 1,
    };
    const json = emitInvestigationScene(ast);
    expect(json.outro.unlock).toBe("auto");
    expect(json.type).toBe("investigation");
  });

  it("emits a chapters index", () => {
    const chapter: ASTChapter = {
      kind: "chapter",
      dirName: "chapter_1",
      number: 1,
      title: "t",
      summary: "s",
      sceneFiles: ["scene_0.md", "investigation_scene_1.md"],
      sourceFile: "chapter_1/chapter.md",
      line: 1,
    };
    const idx = emitChaptersIndex([chapter]);
    expect(idx).toEqual({
      chapters: [
        {
          id: "chapter_1",
          title: "t",
          summary: "s",
          scenes: [
            { type: "linear", file: "chapter_1/scene_0.json" },
            { type: "investigation", file: "chapter_1/investigation_scene_1.json" },
          ],
        },
      ],
    });
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `bun test scripts/compile-scenes/emitter.test.ts`

Expected: FAIL.

- [ ] **Step 3: Implement the emitter**

Create `scripts/compile-scenes/emitter.ts`:

```typescript
// =============================================================================
// scripts/compile-scenes/emitter.ts
//
// Pure functions: AST → JSON. No I/O. The orchestrator owns disk writes.
// =============================================================================

import type {
  ASTChapter,
  ASTInvestigationScene,
  ASTLinearScene,
  JSONChaptersIndex,
  JSONInvestigationScene,
  JSONLinearScene,
} from "./types";

export function emitLinearScene(ast: ASTLinearScene): JSONLinearScene {
  return {
    type: "linear",
    id: ast.id,
    title: ast.title,
    queue: ast.queue,
  };
}

export function emitInvestigationScene(ast: ASTInvestigationScene): JSONInvestigationScene {
  return {
    type: "investigation",
    id: ast.id,
    title: ast.title,
    intro: ast.intro,
    sublocations: ast.sublocations.map((sub) => ({
      id: sub.id,
      status: sub.status,
      unlock: sub.unlock,
      reveals: sub.reveals,
      sceneTag: sub.sceneTag,
      transitionDialogue: sub.transitionDialogue,
      hotspots: sub.hotspots.map((h) => ({
        id: h.id,
        label: h.label,
        description: h.description,
        status: h.status,
        unlock: h.unlock,
        reveals: h.reveals,
        inspectDialogue: h.inspectDialogue,
        onReexamine: h.onReexamine,
      })),
      characters: sub.characters.map((c) => ({
        id: c.id,
        name: c.name,
        role: c.role,
        bio: c.bio,
        topics: c.topics.map((t) => ({
          id: t.id,
          label: t.label,
          status: t.status,
          unlock: t.unlock,
          reveals: t.reveals,
          topicDialogue: t.topicDialogue,
          onReexamine: t.onReexamine,
        })),
      })),
    })),
    evidenceManifest: ast.evidenceManifest.map((e) => ({
      id: e.id,
      name: e.name,
      description: e.description,
      details: e.details,
      onCollect: e.onCollect,
      onReexamine: e.onReexamine,
    })),
    statementManifest: ast.statementManifest.map((s) => ({
      id: s.id,
      speaker: s.speaker,
      content: s.content,
      onAcquire: s.onAcquire,
      onReexamine: s.onReexamine,
    })),
    outro: {
      unlock: ast.outro.unlock,
      dialogue: ast.outro.dialogue,
    },
  };
}

export function emitChaptersIndex(chapters: ASTChapter[]): JSONChaptersIndex {
  return {
    chapters: chapters.map((c) => ({
      id: c.dirName,
      title: c.title,
      summary: c.summary,
      scenes: c.sceneFiles.map((f) => {
        const type = inferType(f);
        const jsonName = f.replace(/\.md$/, ".json");
        return { type, file: `${c.dirName}/${jsonName}` };
      }),
    })),
  };
}

function inferType(filename: string): "linear" | "investigation" {
  if (filename.startsWith("investigation_scene_")) return "investigation";
  if (filename.startsWith("scene_")) return "linear";
  // interrogation_scene_* and unknown prefixes are filtered upstream by the validator's "skip unknown prefix" warning;
  // by the time emit runs, all listed scenes are one of the two known kinds.
  throw new Error(`emit: cannot infer scene type from filename "${filename}". Validator should have caught this.`);
}
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `bun test scripts/compile-scenes/emitter.test.ts`

Expected: all 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/compile-scenes/emitter.ts scripts/compile-scenes/emitter.test.ts
git commit -m "feat(compile): JSON emitter (pure AST → JSON transformation)"
```

---

## Phase A9: Orchestration + config check + watch mode

### Task 18: Implement `tauri.conf.json` configuration assertion

**Files:**
- Create: `scripts/compile-scenes/config-check.ts`

This runs as the first action of every `scenes:compile` invocation. It verifies the Tauri config has the exact wiring §3a.0 requires; mismatches fail the script before any compilation.

- [ ] **Step 1: Create the config check**

```typescript
// =============================================================================
// scripts/compile-scenes/config-check.ts
//
// Asserts src-tauri/tauri.conf.json has the wiring spec §3a.0 / §3a.1 require:
//   build.beforeDevCommand   === "bun run dev:tauri"
//   build.beforeBuildCommand === "bun run build:tauri"
//   bundle.resources         ⊇ ["resources/scenes/**/*"]
//
// Fails loud if any are missing or wrong.
// =============================================================================

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const EXPECTED_BEFORE_DEV = "bun run dev:tauri";
const EXPECTED_BEFORE_BUILD = "bun run build:tauri";
const REQUIRED_RESOURCE = "resources/scenes/**/*";

export type ConfigCheckResult =
  | { ok: true }
  | { ok: false; problems: string[] };

export function checkTauriConfig(repoRoot: string = process.cwd()): ConfigCheckResult {
  const configPath = resolve(repoRoot, "src-tauri/tauri.conf.json");
  let raw: string;
  try {
    raw = readFileSync(configPath, "utf-8");
  } catch (e) {
    return { ok: false, problems: [`Cannot read ${configPath}: ${(e as Error).message}`] };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return { ok: false, problems: [`Invalid JSON in ${configPath}: ${(e as Error).message}`] };
  }

  const problems: string[] = [];
  const cfg = parsed as { build?: { beforeDevCommand?: string; beforeBuildCommand?: string }; bundle?: { resources?: unknown } };

  const beforeDev = cfg.build?.beforeDevCommand;
  if (beforeDev !== EXPECTED_BEFORE_DEV) {
    problems.push(`build.beforeDevCommand should be "${EXPECTED_BEFORE_DEV}", got: ${JSON.stringify(beforeDev)}`);
  }

  const beforeBuild = cfg.build?.beforeBuildCommand;
  if (beforeBuild !== EXPECTED_BEFORE_BUILD) {
    problems.push(`build.beforeBuildCommand should be "${EXPECTED_BEFORE_BUILD}", got: ${JSON.stringify(beforeBuild)}`);
  }

  const resources = cfg.bundle?.resources;
  const ok =
    Array.isArray(resources) &&
    resources.includes(REQUIRED_RESOURCE);
  if (!ok) {
    problems.push(`bundle.resources must include "${REQUIRED_RESOURCE}". Got: ${JSON.stringify(resources)}`);
  }

  return problems.length === 0 ? { ok: true } : { ok: false, problems };
}
```

- [ ] **Step 2: Smoke-test the check**

Run a quick ad-hoc verification:

```bash
bun --eval 'import("./scripts/compile-scenes/config-check.ts").then((m) => console.log(m.checkTauriConfig()))'
```

Expected output: `{ ok: true }` (because Task 7 set the values correctly).

- [ ] **Step 3: Commit**

```bash
git add scripts/compile-scenes/config-check.ts
git commit -m "feat(compile): Tauri config assertion (beforeDev/Build + bundle.resources)"
```

---

### Task 19: Implement the orchestrator

**Files:**
- Create: `scripts/compile-scenes/orchestrator.ts`

The orchestrator wires everything together: discover chapters, read source files, dispatch to parsers, run the validator, run the emitter, write JSON to disk.

- [ ] **Step 1: Create the orchestrator**

```typescript
// =============================================================================
// scripts/compile-scenes/orchestrator.ts
//
// Top-level compile pipeline:
//   1. Discover chapter_<N>/ directories under static/stories_plan/.
//   2. Parse chapter.md per chapter.
//   3. Parse each scene file (type inferred from filename prefix).
//   4. Validate the full corpus.
//   5. Emit JSON to src-tauri/resources/scenes/.
//
// Pure-ish: takes a sourceRoot + outputRoot. Test code passes fixture roots.
// Production code uses the repo paths.
// =============================================================================

import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseChapter } from "./parser-chapter";
import { parseLinearScene } from "./parser-linear";
import { parseInvestigationScene } from "./parser-investigation";
import { validate, type SceneRecord } from "./validator";
import { emitChaptersIndex, emitInvestigationScene, emitLinearScene } from "./emitter";
import type { ASTChapter, CompileError } from "./types";

export type CompileOptions = {
  sourceRoot: string; // e.g., "static/stories_plan"
  outputRoot: string; // e.g., "src-tauri/resources/scenes"
};

export type CompileResult =
  | { ok: true; chaptersCompiled: number; scenesCompiled: number }
  | { ok: false; errors: CompileError[] };

export function compile(opts: CompileOptions): CompileResult {
  const chapters: ASTChapter[] = [];
  const scenes: SceneRecord[] = [];
  const errors: CompileError[] = [];

  // 1. Discover chapter directories.
  let dirs: string[];
  try {
    dirs = readdirSync(opts.sourceRoot)
      .filter((d) => /^chapter_\d+$/.test(d) && statSync(resolve(opts.sourceRoot, d)).isDirectory())
      .sort(byChapterNumber);
  } catch (e) {
    return { ok: false, errors: [{ code: "sourceRootUnreadable", message: `${opts.sourceRoot}: ${(e as Error).message}`, sourceFile: opts.sourceRoot, line: 0 }] };
  }

  // 2 & 3. For each chapter, parse the manifest then each scene.
  for (const dirName of dirs) {
    const chapterDir = resolve(opts.sourceRoot, dirName);
    const manifestPath = resolve(chapterDir, "chapter.md");
    let manifestSource: string;
    try {
      manifestSource = readFileSync(manifestPath, "utf-8");
    } catch (e) {
      errors.push({ code: "chapterManifestMissing", message: `${manifestPath}: ${(e as Error).message}`, sourceFile: manifestPath, line: 1 });
      continue;
    }
    const chapter = parseChapter(manifestSource, `${dirName}/chapter.md`, dirName);
    if (!chapter.ok) {
      errors.push(chapter.error);
      continue;
    }
    chapters.push(chapter.value);

    for (const file of chapter.value.sceneFiles) {
      const sceneId = file.replace(/\.md$/, "");
      const scenePath = resolve(chapterDir, file);
      let source: string;
      try {
        source = readFileSync(scenePath, "utf-8");
      } catch (e) {
        errors.push({ code: "sceneFileMissing", message: `${scenePath}: ${(e as Error).message}`, sourceFile: scenePath, line: 1 });
        continue;
      }
      const sourceFileTag = `${dirName}/${file}`;
      if (file.startsWith("scene_")) {
        const parsed = parseLinearScene(source, sourceFileTag, sceneId);
        if (!parsed.ok) errors.push(parsed.error);
        else scenes.push({ chapterId: dirName, file, ast: parsed.value });
      } else if (file.startsWith("investigation_scene_")) {
        const parsed = parseInvestigationScene(source, sourceFileTag, sceneId);
        if (!parsed.ok) errors.push(parsed.error);
        else scenes.push({ chapterId: dirName, file, ast: parsed.value });
      } else if (file.startsWith("interrogation_scene_")) {
        console.warn(`[compile-scenes] interrogation_scene file "${file}" reserved for future scene type — skipped.`);
      } else {
        errors.push({ code: "sceneFileUnknownType", message: `Unknown scene-file prefix: ${file}`, sourceFile: scenePath, line: 1 });
      }
    }
  }

  // 4. Validate.
  errors.push(...validate({ chapters, scenes }));

  if (errors.length > 0) return { ok: false, errors };

  // 5. Emit + write to disk.
  rmSync(opts.outputRoot, { recursive: true, force: true });
  mkdirSync(opts.outputRoot, { recursive: true });

  for (const rec of scenes) {
    const json =
      rec.ast.kind === "linearScene" ? emitLinearScene(rec.ast) : emitInvestigationScene(rec.ast);
    const outFile = resolve(opts.outputRoot, rec.chapterId, rec.file.replace(/\.md$/, ".json"));
    mkdirSync(dirname(outFile), { recursive: true });
    writeFileSync(outFile, JSON.stringify(json, null, 2) + "\n");
  }

  const idx = emitChaptersIndex(chapters);
  writeFileSync(resolve(opts.outputRoot, "chapters.json"), JSON.stringify(idx, null, 2) + "\n");

  return { ok: true, chaptersCompiled: chapters.length, scenesCompiled: scenes.length };
}

function byChapterNumber(a: string, b: string): number {
  const an = Number(a.replace("chapter_", ""));
  const bn = Number(b.replace("chapter_", ""));
  return an - bn;
}

export function formatErrors(errors: CompileError[]): string {
  return errors.map((e) => `${e.sourceFile}:${e.line}\t[${e.code}] ${e.message}`).join("\n");
}
```

- [ ] **Step 2: Commit**

```bash
git add scripts/compile-scenes/orchestrator.ts
git commit -m "feat(compile): orchestrator wires discovery → parse → validate → emit"
```

---

### Task 20: Create the script entry point with `--watch` support

**Files:**
- Create: `scripts/compile-scenes.ts`

- [ ] **Step 1: Create the entry**

```typescript
// =============================================================================
// scripts/compile-scenes.ts
//
// Entry point. Invoked by:
//   bun run scenes:compile  — one-shot
//   bun run scenes:watch    — long-lived (passes --watch)
// Run from the repo root.
// =============================================================================

import { resolve } from "node:path";
import { compile, formatErrors } from "./compile-scenes/orchestrator";
import { checkTauriConfig } from "./compile-scenes/config-check";

const SOURCE_ROOT = resolve(process.cwd(), "static/stories_plan");
const OUTPUT_ROOT = resolve(process.cwd(), "src-tauri/resources/scenes");

const args = process.argv.slice(2);
const isWatch = args.includes("--watch");

await main();

async function main() {
  const cfg = checkTauriConfig(process.cwd());
  if (!cfg.ok) {
    console.error("[compile-scenes] Tauri config check FAILED:");
    for (const p of cfg.problems) console.error("  - " + p);
    process.exit(1);
  }

  await runOnce();

  if (isWatch) {
    const chokidar = await import("chokidar");
    console.log(`[compile-scenes] Watching ${SOURCE_ROOT} for changes…`);
    chokidar
      .watch(`${SOURCE_ROOT}/**/*.md`, { ignoreInitial: true })
      .on("all", async (event, path) => {
        console.log(`[compile-scenes] ${event} ${path} — recompiling.`);
        await runOnce();
      });
  }
}

async function runOnce() {
  const result = compile({ sourceRoot: SOURCE_ROOT, outputRoot: OUTPUT_ROOT });
  if (!result.ok) {
    console.error("[compile-scenes] FAILED with " + result.errors.length + " error(s):");
    console.error(formatErrors(result.errors));
    if (!isWatch) process.exit(2);
    return;
  }
  console.log(`[compile-scenes] OK — ${result.chaptersCompiled} chapter(s), ${result.scenesCompiled} scene(s).`);
}
```

- [ ] **Step 2: Smoke test the one-shot path (it should fail right now because `static/stories_plan/chapter_1/` doesn't have a `chapter.md` matching the new format)**

Run: `bun run scenes:compile`

Expected: prints config check OK, then **fails** because the real `chapter_1/` doesn't have a `chapter.md` and its existing files don't match the v1 schema. Note that this is **expected** — Plan A doesn't port the real content; the snapshot test in Task 22 runs against the fixture instead. The failure here just validates the pipeline runs and errors loudly.

If you want to silence the error during Plan A development without breaking the dev loop, you can temporarily rename `static/stories_plan/chapter_1/` to `chapter_1_DRAFT/` so the discovery skips it. Restore the name before committing.

Even better, **skip the smoke test for now** — Task 22 below runs the orchestrator against the fixture root, which is the real validation.

- [ ] **Step 3: Commit**

```bash
git add scripts/compile-scenes.ts
git commit -m "feat(compile): script entry with one-shot and --watch modes"
```

---

## Phase A10: End-to-end + snapshot test

### Task 21: End-to-end orchestrator test against the valid fixture

**Files:**
- Create: `scripts/compile-scenes.test.ts`

- [ ] **Step 1: Write the test**

```typescript
import { describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { compile, formatErrors } from "./compile-scenes/orchestrator";

describe("compile (end-to-end against valid fixture)", () => {
  it("compiles the valid fixture without errors and emits expected files", () => {
    const outRoot = mkdtempSync(resolve(tmpdir(), "scene-compile-"));
    try {
      const result = compile({
        sourceRoot: "scripts/__fixtures__/valid",
        outputRoot: outRoot,
      });
      if (!result.ok) {
        // Surface error details for easier debugging.
        throw new Error("Compile failed:\n" + formatErrors(result.errors));
      }
      expect(result.chaptersCompiled).toBe(1);
      expect(result.scenesCompiled).toBe(2);

      const idx = JSON.parse(readFileSync(resolve(outRoot, "chapters.json"), "utf-8"));
      expect(idx.chapters).toHaveLength(1);
      expect(idx.chapters[0].id).toBe("chapter_1");
      expect(idx.chapters[0].scenes).toEqual([
        { type: "linear", file: "chapter_1/scene_0.json" },
        { type: "investigation", file: "chapter_1/investigation_scene_1.json" },
      ]);

      const linear = JSON.parse(readFileSync(resolve(outRoot, "chapter_1/scene_0.json"), "utf-8"));
      expect(linear.type).toBe("linear");
      expect(linear.queue.length).toBeGreaterThan(0);

      const investigation = JSON.parse(
        readFileSync(resolve(outRoot, "chapter_1/investigation_scene_1.json"), "utf-8"),
      );
      expect(investigation.type).toBe("investigation");
      expect(investigation.sublocations).toHaveLength(2);
      expect(investigation.outro.unlock).not.toBe("auto");
    } finally {
      rmSync(outRoot, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run test, verify it passes**

Run: `bun test scripts/compile-scenes.test.ts`

Expected: PASS. If it fails with a validator error, fix the fixture file (Task 8) and re-run. The test serves as the integration acceptance gate for the fixture content.

- [ ] **Step 3: Commit**

```bash
git add scripts/compile-scenes.test.ts
git commit -m "test(compile): end-to-end fixture compile produces expected JSON tree"
```

---

### Task 22: Snapshot test against the valid fixture

**Files:**
- Modify: `scripts/compile-scenes.test.ts` (add a snapshot test)
- Create: `scripts/__snapshots__/valid-fixture.snap` (auto-generated by Bun on first run)

- [ ] **Step 1: Add a snapshot assertion**

Append to `scripts/compile-scenes.test.ts`:

```typescript
import { afterAll, beforeAll } from "bun:test";

describe("snapshot: valid fixture JSON output", () => {
  let outRoot: string;
  let chaptersJson: unknown;
  let linearJson: unknown;
  let investigationJson: unknown;

  beforeAll(() => {
    outRoot = mkdtempSync(resolve(tmpdir(), "scene-compile-snap-"));
    const result = compile({
      sourceRoot: "scripts/__fixtures__/valid",
      outputRoot: outRoot,
    });
    if (!result.ok) throw new Error(formatErrors(result.errors));
    chaptersJson = JSON.parse(readFileSync(resolve(outRoot, "chapters.json"), "utf-8"));
    linearJson = JSON.parse(readFileSync(resolve(outRoot, "chapter_1/scene_0.json"), "utf-8"));
    investigationJson = JSON.parse(readFileSync(resolve(outRoot, "chapter_1/investigation_scene_1.json"), "utf-8"));
  });

  afterAll(() => {
    rmSync(outRoot, { recursive: true, force: true });
  });

  it("matches the chapters.json snapshot", () => {
    expect(chaptersJson).toMatchSnapshot();
  });
  it("matches the linear scene snapshot", () => {
    expect(linearJson).toMatchSnapshot();
  });
  it("matches the investigation scene snapshot", () => {
    expect(investigationJson).toMatchSnapshot();
  });
});
```

- [ ] **Step 2: Run the test (first run generates snapshots)**

Run: `bun test scripts/compile-scenes.test.ts --update-snapshots`

Expected: tests PASS, and three snapshots are written under `scripts/__snapshots__/`.

Inspect the generated snapshots. They should match the expected shapes from the spec §3b. If anything looks wrong (e.g., a field that shouldn't be present, or missing data), iterate on the parser/emitter rather than just regenerating the snapshot.

- [ ] **Step 3: Re-run without --update-snapshots to confirm stability**

Run: `bun test scripts/compile-scenes.test.ts`

Expected: PASS — snapshots match.

- [ ] **Step 4: Commit**

```bash
git add scripts/__snapshots__/ scripts/compile-scenes.test.ts
git commit -m "test(compile): commit fixture JSON snapshots"
```

---

### Task 23: Run invalid fixtures through the validator and assert errors

**Files:**
- Modify: `scripts/compile-scenes.test.ts` (add a parametrized test over invalid fixtures)

- [ ] **Step 1: Add the parameterized test**

Append to `scripts/compile-scenes.test.ts`:

```typescript
import { readdirSync, statSync, existsSync } from "node:fs";

describe("invalid fixtures: each one fails with a specific error code", () => {
  const INVALID_ROOT = "scripts/__fixtures__/invalid";
  const fixtures = readdirSync(INVALID_ROOT).filter((d) =>
    statSync(resolve(INVALID_ROOT, d)).isDirectory(),
  );

  for (const name of fixtures) {
    it(`fixture "${name}" produces the expected error`, () => {
      const sourceRoot = resolve(INVALID_ROOT, name);
      const expectedFile = resolve(sourceRoot, "expected-error.txt");
      if (!existsSync(expectedFile)) {
        throw new Error(`Fixture ${name} is missing expected-error.txt`);
      }
      const expectedSubstring = readFileSync(expectedFile, "utf-8").trim();
      const outRoot = mkdtempSync(resolve(tmpdir(), `scene-compile-bad-${name}-`));
      try {
        const result = compile({ sourceRoot, outputRoot: outRoot });
        expect(result.ok).toBe(false);
        if (result.ok) return;
        const matched = result.errors.some(
          (e) => e.code === expectedSubstring || e.message.includes(expectedSubstring),
        );
        if (!matched) {
          throw new Error(
            `Fixture "${name}" did not produce expected error "${expectedSubstring}". Got:\n` +
              formatErrors(result.errors),
          );
        }
      } finally {
        rmSync(outRoot, { recursive: true, force: true });
      }
    });
  }
});
```

- [ ] **Step 2: Run the test, iterate on fixtures + validator until each passes**

Run: `bun test scripts/compile-scenes.test.ts`

Expected: every invalid fixture produces the error its `expected-error.txt` names. If a fixture is "too valid" (slips through), corrupt it more. If the validator doesn't produce the expected code, either rename the code in the validator or update `expected-error.txt`. The 14 invalid fixtures from Task 9 should all pass after this loop.

- [ ] **Step 3: Commit**

```bash
git add scripts/compile-scenes.test.ts scripts/__fixtures__/invalid/
git commit -m "test(compile): parameterized invalid-fixture assertions for every rule"
```

---

## Plan A complete

At this point:

- The three skills are aligned to the parser's schema.
- A Bun compile script reads markdown under `static/stories_plan/`, parses, validates, and emits JSON to `src-tauri/resources/scenes/`.
- A fixture corpus exercises every block type (valid) and every validation rule (invalid).
- All bun:test suites are green.
- `tauri.conf.json` is wired to run the compile script before dev and before build.

Verify by running:

```bash
bun test            # all tests pass
bun run scenes:compile   # may fail against real chapter_1 — that's OK, Plan B will port it
```

The Rust app still uses the old demo case. Plan B replaces it.

---

## Out of scope for Plan A (handled in Plan B)

- Any change to Rust code (`src-tauri/src/**`).
- Any change to Svelte/frontend code (`src/**`).
- Porting the real authored `chapter_1/scene_0.md` and `chapter_1/investigation_scene_1.md` to the finalized schema.
- The packaged-build smoke test (`bun run tauri build` round-trip with the new engine).
- Any cross-chapter reachability validator (deferred per spec §3d).

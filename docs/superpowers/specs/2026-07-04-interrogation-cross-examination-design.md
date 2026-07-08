# Interrogation Cross-Examination Redesign

**Status:** Approved design (brainstorm) — pending implementation plan
**Date:** 2026-07-04
**Scope:** Unify interrogation phases into a single cross-examinable model, add
evidence-presentation to the questioning flow, and revamp the interrogation UI.
Touches the authored markdown format, the compiler (parser + validator +
emitter), the Rust runtime (schema + engine + view + IPC), the frontend
(`InterrogationView` + dialogue surface), and the `writing-interrogation-scene`
skill.

---

## 1. Motivation

Today an interrogation scene has two distinct phase kinds:

- **Inquiry** — a flat grid of question cards. Follow-ups (`kind: FollowUp`,
  `parent_question_id`) start locked and, once unlocked, are *flattened* into the
  same grid (`view.rs` `InquiryQuestionView` = `{id,label,answered}`,
  `mod.rs:1842`), so a follow-up just appears as another card after its parent is
  answered. There is no sense of choosing a follow-up and no evidence
  interaction.
- **Testimony** — a list of statements, each rendered with a Press button and a
  brute-force row of *every* inventory item as a "present" button.

We want the questioning flow ("asking the culprit") to itself be a
cross-examination: the suspect's answer plays as normal dialogue, the player
decides which line is a lie, and presents evidence against it — the
Danganronpa / Ace Attorney loop. This makes the separate testimony phase
redundant, so the two collapse into one.

**Enabling fact:** there are no authored `interrogation_scene_*.md` files in the
live tree yet (only compiler fixtures under `packages/scripts/__fixtures__/`).
There is no content migration; we are free to redefine the format, and the
fixtures + tests are rewritten as part of the work.

---

## 2. The unified model

There is exactly one phase kind: **inquiry**. `Testimony`, `Statement`, and
`Result` blocks are removed.

- A **Phase** has one **Subject** and a set of **Questions**.
- Each **Question**, when asked, plays a **Testimony**: an ordered list of
  **Lines** delivered one at a time through the normal dialogue box.
- The player cross-examines the testimony: at each line they may **反駁
  (challenge)**, **繼續 (proceed)**, or **退下 (withdraw to the question menu)**.
- A **Line** may carry a **Contradiction** (an `evidence:` / `statement:`
  inventory target). Challenging a line plays the line's authored
  main-character **Challenge** lead-in, then opens the evidence tray:
  - correct evidence on a contradiction line → authored **On Correct** dialogue
    + `Reveals` (which unlock follow-up questions and/or add inventory);
  - wrong evidence on a contradiction line → authored **On Wrong Evidence**
    rebuff → return to the loop;
  - challenging a line with **no** contradiction → the testimony's
    **Default Challenge** lead-in + **Default Wrong** rebuff → return to the
    loop. (Both overridable per line.)
- Reaching the last line without a breakthrough plays the testimony's authored
  **On Loop** main-character line, then repeats from line 1.
- **Follow-ups** are ordinary `### Question` blocks that start `locked` and are
  unlocked by a line's `On Correct` → `Reveals: [question:<id>]`. "Same
  testimony, deeper" vs "a different question" is purely which question IDs a
  breakthrough reveals. Follow-ups are themselves full Questions with their own
  Testimony, so the structure is naturally recursive with no special-casing.

Nothing is flagged in the UI: lies and honest lines render identically. The
player must deduce which line to challenge and with what — the honest-line and
wrong-evidence rebuffs are authored precisely so a wrong guess is a satisfying
dead end rather than a blocked action.

### 2.1 Flow

```
QUESTION MENU ──ask──▶ TESTIMONY PLAYBACK (line i of n)
                          │  繼續  ──▶ line i+1 … last line ──▶ ON LOOP ★ ──▶ line 1
                          │  退下  ──▶ QUESTION MENU
                          │  反駁  ──▶ CHALLENGE LEAD-IN ★ ──▶ EVIDENCE TRAY ──present──▶
                          │              ├ right line + right evidence ▶ ON CORRECT ★ + Reveals ▶ phase advances / follow-ups unlock
                          │              ├ right line + wrong evidence ▶ ON WRONG EVIDENCE ★ ▶ back to loop
                          │              └ honest line (any evidence)  ▶ DEFAULT WRONG ★ ▶ back to loop
                          ▼
                    (★ = writer-authored dialogue)
```

### 2.2 UI layout

`InterrogationView` becomes a **cross-examination surface** that reuses the
existing `DialogueBox` visual language:

- **Question menu** (between testimonies, and after 退下): subject header
  (portrait/name/role/bio) + the list of askable questions and unlocked
  follow-ups (locked follow-ups shown as 🔒, answered/broken questions marked).
- **Testimony playback**: the current line in the dialogue box styling, with
  `反駁 / 繼續聆聽 / 退下` controls and a `i / n · ↻` progress affordance.
- **Challenge**: the lead-in plays as a normal dialogue beat, then the controls
  are replaced by the **evidence tray** (inventory evidence + statements) scoped
  to "針對：<challenged line>", with a 收回 (cancel) affordance.

This is a full replacement of the current card-grid + statement-list component.
All suspect/detective speech continues to flow through the normal dialogue box
and into the existing dialogue history/LOG.

---

## 3. Authored markdown format

Canonical order inside a scene is unchanged at the top level
(`## Intro`, `## Phase:` …, `## Evidence Manifest`, `## Statement Manifest`,
`## Outro`). The phase body is redefined.

```markdown
## Phase: 訊問若槻 {#press_wakatsuki}
- **Kind:** inquiry            # the only kind
- **Required:** true
- **Status:** unlocked
[場景：審訊室、深夜、雨聲]

### Subject: 若槻悠真 {#wakatsuki}
- **Role:** 清掃員
- **Bio:** 命案當晚值夜班的清潔工。

### Question: 當晚行蹤 {#alibi}
- **Status:** unlocked
- **Required:** true

#### Testimony
- **On Loop:** **相馬律**：…還有哪裡對不上。再說一次。       # required end-of-loop line
- **Default Challenge:** **相馬律**：等等，這句話讓我想想。   # optional; used for honest-line challenges
- **Default Wrong:** **若槻悠真**：這句話沒問題吧？          # optional; suspect brushes off a baseless challenge

##### Line: 下班時間 {#l_offwork}
**若槻悠真**：八點就下班了，之後沒再回去。                    # honest line — no metadata

##### Line: 否認接觸 {#l_denial}
**若槻悠真**：那台機器我根本沒碰過。
- **Contradiction:** evidence:cleaning_log
- **Challenge:** **相馬律**：等一下，這句話和我手上的東西對不上。   # authored lead-in
- **On Correct:** **若槻悠真**：…日誌上是我的簽名。好吧，我碰過。   # authored breakthrough
  - **Reveals:** [question:cleaning_time, evidence:signature_admission]
- **On Wrong Evidence:** **若槻悠真**：這能證明什麼？             # authored wrong-proof rebuff

##### Line: 推託 {#l_deflect}
**若槻悠真**：細節去問值班經理。

### Question: 追問：清掃時間 {#cleaning_time}   # a follow-up = a locked question
- **Status:** locked                          # unlocked by l_denial's On Correct reveal
#### Testimony
- **On Loop:** **相馬律**：…你在迴避什麼？
  ##### Line: … {#…}
  …

## Evidence Manifest
## Statement Manifest
## Outro
```

### 3.1 Block schemas

**Phase (H2)** — unchanged except `Kind` is always `inquiry` (the value is kept
for forward compatibility and to keep the parser's dispatch stable). Existing
`Required` / `Status` / `Unlock` / `Reveals` / scene-tag + asset metadata rules
carry over unchanged.

**Subject (H3)** — unchanged (`Role`, `Bio`; one per phase; identical fields if
a subject ID repeats).

**Question (H3)** — `### Question: <label> {#id}` with optional
`Status` (default `unlocked`), `Required` (default `true`), `Unlock`, `Reveals`.
Body is a single `#### Testimony`. The `#### Follow-up:` H4 block is **removed**;
follow-ups are just locked Questions. `InquiryQuestionKind` / `parent_question_id`
/ `#### On Reask` are removed.

**Testimony (H4)** — `#### Testimony` under a Question.
- Required: `On Loop` (main-character dialogue).
- Optional: `Default Challenge`, `Default Wrong` (main-character / suspect
  dialogue used when an honest line is challenged; defaulted to a generic beat by
  the parser if omitted — see Open Questions).
- Body: one or more `##### Line:` blocks in play order.

**Line (H5)** — `##### Line: <label> {#id}` followed by exactly one dialogue
line of `Content` (the suspect statement, authored as a normal bold-label
dialogue line; `Speaker` defaults to the phase Subject and may be overridden by
the dialogue label).
- Optional: `Contradiction` (`evidence:<id>` / `statement:<id>`).
- Required **iff** `Contradiction` is present: `Challenge` (lead-in),
  `On Correct` (dialogue), and `On Correct` must carry the `Reveals` that the
  phase relies on. `On Wrong Evidence` is required when `Contradiction` is
  present.
- A line without `Contradiction` is an honest line; challenging it uses the
  testimony `Default Challenge` / `Default Wrong`. Per-line overrides
  `Challenge` / `On Wrong Evidence` are allowed on honest lines too.

### 3.2 Reveal & unlock syntax

Unchanged. `Reveals: [evidence:…, statement:…, question:…, phase:…]` on
questions and on line `On Correct`. `Unlock` / `Complete` expressions still use
`evidence:<id> collected`, `statement:<id> acquired`, `question:<id> answered`,
`phase:<id> completed`, and `and` / `or`. A `question:<id> answered` predicate is
satisfied when that question's testimony has been **broken** (its required
contradiction landed) — see §5 for the precise "answered/broken" definition.

---

## 4. Compiler changes (`packages/scripts/compile-scenes/`)

- **AST types** (`types.ts`): replace `ASTTestimonyPhase`,
  `ASTTestimonyStatement`, `ASTTestimonyResult`, and the inquiry
  question/follow-up shapes with a single inquiry model:
  `ASTInquiryPhase { subject, questions }`,
  `ASTQuestion { id,label,status,required,unlock,reveals, testimony }`,
  `ASTTestimony { onLoop, defaultChallenge?, defaultWrong?, lines }`,
  `ASTTestimonyLine { id,label,speaker,content, contradiction?, challenge?,
  onCorrect?, onWrongEvidence?, revealsOnCorrect }`.
- **Parser** (`parser-interrogation.ts`): rewrite `parsePhase` /
  `parseInquiryPhase`; delete `parseTestimonyPhase` and the `Follow-up:` /
  `On Reask` handling; add `parseTestimony` + `parseTestimonyLine`. Update the
  heading-hierarchy doc comment at the top of the file.
- **Validator** (`validator.ts`): the guarantee analysis
  (`analyzeInterrogationInventory`, `interrogationRevealKey`, the
  `mode: "guaranteed"` pass) is retargeted from testimony statements/results to
  question lines. Rules to preserve/port:
  - IDs unique within scene (phases, questions, lines, evidence, statements).
  - Locked questions reachable via a `Reveals: [question:…]` chain or an
    `Unlock` expr (no cycles/dead-ends).
  - **Contradiction reachability guarantee (critical):** every `Contradiction`
    target must be an exact inventory item that is *guaranteed available* at the
    point the line can be challenged — from a prior guaranteed scene or from an
    earlier guaranteed breakthrough in this scene. A required phase must have at
    least one reachable line whose `Contradiction` is guaranteed and whose
    `On Correct` can fire (this is the "Beat-10 compile trap": reveals that only
    happen inside an *optional* breakthrough are **not** guaranteed to later
    scenes).
  - Every `Contradiction` line has `Challenge`, `On Correct`, `On Wrong
    Evidence`; every testimony has `On Loop`.
- **Emitter** (`emitter.ts`): emit the new inquiry JSON (see §5) instead of the
  testimony JSON. Interrogation types remain compiler-internal + Rust only; they
  are **not** added to `@lyra/scene-types` (same exception as `DialogueItem`).
- **Fixtures**: rewrite `valid_interrogation/` and the relevant `invalid/<case>/`
  fixtures (+ `expected-error.txt`) to the new format; add fixtures for the new
  error cases (contradiction line missing `Challenge`/`On Correct`/`On Wrong
  Evidence`, testimony missing `On Loop`, unguaranteed contradiction).

---

## 5. Rust runtime (`apps/game/src-tauri/src/game/`)

**Schema** (`schema.rs`): remove `InterrogationPhaseJson::Testimony`,
`TestimonyStatementJson`, `TestimonyResultJson`, `InquiryQuestionKind`,
`parent_question_id`, `on_reask`. `InterrogationPhaseJson` becomes a struct (no
enum) or a single-variant inquiry. New:
`InquiryQuestionJson { id,label,status,required,unlock,reveals, testimony }`,
`TestimonyJson { on_loop, default_challenge, default_wrong, lines }`,
`TestimonyLineJson { id,label,speaker,content, contradiction, challenge,
on_correct, on_wrong_evidence, reveals }` (all `#[serde(rename_all="camelCase")]`).

**Engine state** (`scenes/interrogation.rs`): replace `pressed_statements`,
`wrong_presented_statements`, and the testimony-completion logic with
cross-examination state:
- `broken_questions: HashSet<String>` — a question is "broken" once a required
  contradiction line's `On Correct` has fired (this is what
  `question:<id> answered` predicates test).
- Active cross-examination cursor: `Option<{ question_id, line_index,
  pending_challenge: Option<line_id> }>` (or an explicit sub-state enum). Loop =
  incrementing `line_index` past the end wraps to 0 after enqueuing `On Loop`.
- `phase_complete` for the unified phase: `auto` when all `Required` questions
  are broken (and no unlocked-unanswered required questions remain), or an
  explicit `Complete:` expr. `outro_satisfied` unchanged in spirit.

  **Manual completion (implemented addition).** For an `Auto` inquiry phase the
  engine does *not* auto-advance the moment the last required question breaks.
  Instead the player explicitly concludes the phase via a `complete_interrogation_phase`
  command, surfaced in the question menu as a "完成訊問" button that is disabled
  until `current_phase_can_complete()` (every required question broken, no
  dialogue active). This lets the player keep re-asking or re-examining
  already-broken questions before choosing to move on. The command rejects with
  `interrogationPhaseNotCompletable` when the guard fails, and on success drives
  phase-advance / outro through the same `on_queue_exhausted` path a drained
  dialogue queue uses. `Expr` phases remain auto-evaluated and are not
  manually completable.

**Mode / view** (`view.rs`, `mod.rs`): the `ModeView::Interrogation` view is
extended to describe the cross-examination sub-state. `InterrogationPhaseView`
carries the subject + questions (with `broken`/`locked` flags) for the menu; a
new view branch describes the active testimony line (`content`, `speaker`,
`lineIndex`, `total`, `canChallenge`, `presentPending`) so the frontend can
render playback vs tray. Remove `TestimonyStatementView`; rework
`InquiryQuestionView` to `{ id, label, broken, locked }`.

**IPC commands** (`lib.rs` + `mod.rs`): replace `answer_interrogation_question`,
`press_testimony_statement`, `present_testimony_item` with:
- `ask_interrogation_question(questionId)` — start/replay a testimony (enqueue
  line 1 as dialogue).
- `challenge_interrogation_line(lineId)` — enqueue the `Challenge` /
  `Default Challenge` lead-in, then set `present_pending`.
- `present_interrogation_evidence(lineId, itemKind, itemId)` — resolve
  correct/wrong; on correct apply `reveals` via
  `reveals::apply_interrogation_reveals_and_build_queue` and mark the question
  broken; on wrong enqueue the rebuff.
- `withdraw_interrogation()` — return to the question menu.
- `complete_interrogation_phase()` — manually conclude the current `Auto`
  inquiry phase from the question menu (see "Manual completion" above).
- `resume_interrogation_testimony()` — back out of the evidence tray
  (`Presenting`) to the challenged testimony line without presenting anything.
Register each in `generate_handler!`. Errors stay typed `GameError`
(`locked_interrogation_question`, a new `not_in_cross_examination`,
`interrogationPhaseNotCompletable`, etc.).

> **Implementation deviation (繼續聆聽 / `proceed_interrogation_line`).** The
> original design listed a dedicated `proceed_interrogation_line()` IPC command
> for the 繼續聆聽 affordance. This was **folded into the existing dialogue-box
> advance path** during implementation: the testimony line renders through the
> normal `DialogueBox` (which carries `role="button"` + Space/Enter advance), so
> `advance_dialogue` → `on_queue_exhausted` → `advance_playing_testimony` already
> advances to the next line or fires `On Loop` and wraps. No separate command is
> registered. The §2.2 "繼續聆聽" control and the §2.1 "繼續 ──▶ line i+1" flow
> remain accurate as *player-facing* affordances; only the IPC surface was
> simplified. Restore the dedicated command if playtesting finds the unified
> advance path conflates testimony advance with non-testimony dialogue advance.

**Reveals/unlock** (`reveals.rs`, `unlock.rs`): reuse the interrogation reveal
plumbing; `question:<id> answered` now means "broken".

---

## 6. Frontend (`apps/game/src/`)

- `lib/components/InterrogationView.svelte`: full rewrite to the cross-examination
  surface (menu / playback / tray states) described in §2.2, reusing `DialogueBox`
  styling tokens. The active line renders through the dialogue-mode path; the
  menu + controls + tray render in the interrogation-mode path.
- `routes/+page.svelte`: wire the new command set; the interrogation branch gains
  the playback/tray controls and passes the new callbacks.
- `lib/state/game-client.svelte.ts`, `lib/state/types.ts`, `lib/state/mode.ts`:
  update the typed client + view types + mode discriminants for the new commands
  and view shape.
- `lib/audio/sfx-events.ts`: add cues for challenge / correct / wrong / loop
  (reuse existing UI cues where sensible).
- Update `InterrogationView.test.ts` (and any GameShell tests referencing
  testimony) to the new model.

---

## 7. Writing skill (`.claude/skills/writing-interrogation-scene/SKILL.md`)

Rewrite around the unified Question → Testimony → Line model:

- Remove the testimony/statement/result and follow-up/`On Reask` sections and
  the two-phase-kinds framing.
- Document the required authored beats: per contradiction line `Challenge`,
  `On Correct` (+`Reveals`), `On Wrong Evidence`; per testimony `On Loop` (and
  the optional `Default Challenge` / `Default Wrong` for honest-line challenges).
- Document follow-ups as locked Questions unlocked by `On Correct` reveals, and
  the "same testimony deeper vs different question" pattern.
- Update the heading-hierarchy table, the block-field schemas, the workflow, and
  the common-mistakes table. Keep the reused rules: Traditional Chinese
  player-facing text, `**角色名**：內容`, `[場景：…]`, exact `evidence:`/
  `statement:` targets, and the contradiction-must-be-guaranteed rule.

---

## 8. Resolved decisions

- **Mechanic:** present-to-unlock challenge (not evidence-backed asking or a
  claim board).
- **Phase kinds:** unified into one (`inquiry`); testimony removed.
- **Answer delivery:** the existing dialogue box, line by line — not a custom
  transcript panel.
- **Discovery:** challengeable lines are **not** flagged; the player deduces.
- **Authored failure branches:** `On Wrong Evidence` (right line, wrong proof)
  and `Default Wrong` (honest line) are writer-authored, as is the `Challenge`
  lead-in and `On Loop`.
- **退下:** the player may withdraw to the question menu mid-loop (prevents
  soft-locks when the needed evidence comes from another question).
- **Consequence of wrong guesses:** none beyond the rebuff + loop (no
  health/penalty system).
- **Follow-ups:** ordinary locked questions unlocked via `On Correct` reveals;
  "same line deeper" and "different line" are both just revealed question IDs.

## 9. Open questions (safe defaults chosen; revisit in the plan)

- **`Default Challenge` / `Default Wrong` omitted:** parser supplies a generic
  built-in beat vs. requires them. Default: **optional**, parser injects a
  neutral built-in if absent, writer may override globally or per line.
- **Present interaction order:** line-first (challenge a line → tray) is fixed by
  the flow. Evidence-first is out of scope.
- **Multiple contradiction lines per testimony:** allowed; each is independently
  challengeable and may reveal different follow-ups.

## 10. Out of scope

- Any health/penalty/scoring system.
- Drag-and-drop evidence (Direction C).
- Changes to investigation or linear scene formats.
- Adding interrogation types to `@lyra/scene-types`.

## 11. Verification

- Compiler: focused Vitest under `packages/scripts/` (parser + validator +
  emitter + rewritten fixtures), then `bun run scenes:compile`, then
  `bun run check:scripts`.
- Rust: focused `cargo test` on `scenes::interrogation` + IPC command tests,
  then `cargo test --manifest-path apps/game/src-tauri/Cargo.toml`, then
  `bun run rust:lint`.
- Frontend: `InterrogationView.test.ts` + affected GameShell tests, then
  `bun run check`.
- Smoke: `bun run dev:game` against a rewritten authored interrogation scene to
  exercise real IPC + the loop.
```

# Interrogation Detective Beats — Design

**Goal:** Guarantee a protagonist (detective 相馬律) dialogue beat at two points
of an interrogation cross-examination — when the testimony loops, and when the
player presents wrong evidence — by adding two new **required** authored fields
to the interrogation testimony format.

**Status:** Design approved 2026-07-06. Branch: `interrogation-cross-examination`.

## Problem

The cross-examination flow has two moments where the suspect speaks but the
detective does not, so the beat reads as flat or (to the player) "missing":

1. **On loop.** After the last testimony line, `advance_playing_testimony`
   composes `On Loop ++ line[0]` and restarts. `On Loop` is authored as the
   *suspect's* repeat (三宅蒼太 / 神谷澪). The detective never reacts before the
   statement replays.
2. **On a wrong present.** `present_interrogation_evidence` (wrong branch) plays
   the line's `On Wrong Evidence` (or the testimony's `Default Wrong`). That
   field is already required for contradiction lines, but its voice is
   inconsistent — the detective in `interrogation_scene_4`, the suspect
   (神谷澪) in `interrogation_scene_10` — so there is no guaranteed detective
   reaction.

We want a **guaranteed, structurally-distinct detective beat** at both points,
enforced by the compiler so a writer cannot forget it.

## Approach

Add two new **testimony-level** authored fields, each a dialogue block:

| Field (markdown) | JSON / schema key | Plays |
|---|---|---|
| `Loop Prompt` | `loopPrompt` | on loop, after the suspect's `On Loop`, before line 0 replays |
| `Wrong Reply` | `wrongReply` | on a wrong present, after the suspect's `On Wrong Evidence` / `Default Wrong` |

Both are the detective's voice by authoring convention (the compiler requires
the field to be present and non-empty; it does not attempt to validate the
speaker id, which stays a content/skill concern — consistent with how the
format already treats speakers).

### Required rule

`Loop Prompt` and `Wrong Reply` are required **iff the testimony has ≥1
`Contradiction` line**. This mirrors the existing "`Challenge` / `On Correct` /
`On Wrong Evidence` required iff `Contradiction`" rule. Rationale: an honest
question (no contradiction line) auto-breaks on ask and never loops or receives
an evidence present, so those beats are unreachable and must not be forced.

A testimony with no contradiction line may omit both fields (and if present,
they are still parsed/emitted but never played).

### Runtime composition

- **Loop** (`advance_playing_testimony`, `AdvanceOutcome::Loop` branch):
  `on_loop ++ loop_prompt ++ lines[0].content` (was `on_loop ++ lines[0]`).
- **Wrong present** (`present_interrogation_evidence`, wrong branch):
  `on_wrong ++ wrong_reply`, where `on_wrong` is the existing
  `line.on_wrong_evidence` (non-empty) or `default_wrong` fallback. The
  destination after the beat is unchanged — `return_to_line()` then resume the
  looping testimony in the dialogue box.

Because `wrong_reply` is required and non-empty whenever a contradiction line
exists, a wrong present in such a testimony now *always* produces a visible
dialogue beat — including the case where a non-contradiction line is challenged
and `Default Wrong` is empty (previously that produced no dialogue and looped
silently). This is the concrete fix for the "rebuff isn't appearing" report.

## Layers touched

1. **`packages/scripts/compile-scenes/parser-interrogation.ts`**
   - Add `"Loop Prompt"`, `"Wrong Reply"` to `TESTIMONY_FIELDS`.
   - Parse each via `parseDialogueFieldValue` (nullable, like `Default Wrong`).
   - After parsing lines, if any line has a `Contradiction`, require both
     fields non-null with new error codes `interrogationMissingLoopPrompt` and
     `interrogationMissingWrongReply`.
   - Add `loopPrompt` / `wrongReply` to the returned AST value.
2. **`packages/scripts/compile-scenes/types.ts`**
   - `ASTTestimony`: `loopPrompt: DialogueItem[] | null`, `wrongReply: DialogueItem[] | null`.
   - JSON testimony type: `loopPrompt: JSONDialogueItem[]`, `wrongReply: JSONDialogueItem[]`.
3. **`packages/scripts/compile-scenes/emitter.ts`**
   - Emit `loopPrompt: emitDialogueItems(ast.loopPrompt ?? [])` and
     `wrongReply: emitDialogueItems(ast.wrongReply ?? [])` (empty array when
     absent, matching how `defaultChallenge` / `defaultWrong` emit).
4. **`packages/scripts/compile-scenes/assets/enrich.ts`**
   - Enrich `loopPrompt` / `wrongReply` alongside the other nullable testimony
     dialogue arrays.
5. **Rust `apps/game/src-tauri/src/game/schema.rs` — `TestimonyJson`**
   - Add `pub loop_prompt: Vec<DialogueItem>` and `pub wrong_reply: Vec<DialogueItem>`
     with `#[serde(default)]` (so pre-existing JSON / test fixtures without them
     deserialize cleanly). camelCase is already applied at the struct level.
6. **Rust runtime `apps/game/src-tauri/src/game/mod.rs`**
   - `advance_playing_testimony` Loop branch: insert `loop_prompt` between
     `on_loop` and `lines[0].content`.
   - `present_interrogation_evidence` wrong branch: append `wrong_reply` to the
     wrong-response queue.
7. **`.claude/skills/writing-interrogation-scene/SKILL.md`**
   - Document `Loop Prompt` / `Wrong Reply`: what they are, the detective voice
     convention, the "required iff Contradiction" rule, and where each plays.
8. **Content**
   - Author `Loop Prompt` and `Wrong Reply` in every contradiction-bearing
     testimony of `docs/stories_plan/chapter_1/interrogation_scene_4.md` and
     `interrogation_scene_10.md`, then `bun run scenes:compile`.
9. **Compiler fixtures**
   - Update `packages/scripts/__fixtures__/valid_interrogation/` (and any other
     valid fixture with a contradiction line) to include the fields; add an
     `invalid/` case with a contradiction line but a missing `Loop Prompt` (and
     one for `Wrong Reply`) plus matching `expected-error.txt`.

## Error handling

New compile errors, surfaced through the existing `fail(...)` path with a code
and a message naming the question:

- `interrogationMissingLoopPrompt` — "Question `<id>`'s #### Testimony has a
  Contradiction line and requires Loop Prompt dialogue."
- `interrogationMissingWrongReply` — "Question `<id>`'s #### Testimony has a
  Contradiction line and requires Wrong Reply dialogue."

Unknown-field rejection is unchanged: `Loop Prompt` / `Wrong Reply` become known
`TESTIMONY_FIELDS`, so authoring them is accepted; any other key still errors.

## Testing

- **Compiler unit tests** (`packages/scripts`): a `valid_interrogation` fixture
  compiles with the fields and emits `loopPrompt` / `wrongReply`; new `invalid/`
  fixtures assert the two new error codes; a testimony with no contradiction
  line compiles without the fields.
- **Rust runtime tests** (`apps/game/src-tauri/src/game/mod.rs`): draining an
  unbroken testimony to its loop plays `loop_prompt` before line 0; a wrong
  present plays `wrong_reply` after the wrong response. Extend the existing
  `two_line_question_scene` / `single_required_question_scene` fixtures with the
  new `TestimonyJson` fields.
- **Content**: `bun run scenes:compile` succeeds after authoring; `bun run check:scripts`.

## Out of scope

- No change to the wrong-present *destination* (still resumes the testimony via
  `return_to_line`; the evidence-tray back button already resumes it via #2).
- No speaker-id validation (the detective voice is an authoring convention, not
  compiler-enforced).
- No new field for the correct-present or challenge lead-in beats.

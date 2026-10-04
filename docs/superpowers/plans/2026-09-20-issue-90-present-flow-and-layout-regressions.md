# Issue #90 Remediation Phase 1: Present Flow + Layout Regressions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the cross-examination Present softlock (challenge lead-in must drain before the evidence tray activates; 反駁 becomes a normal single-click), gate live Chapter 1 content on every investigation target being placed, tighten the hotspot-overlap warning threshold so the scene 9 packet overlap class cannot recur silently, retune the verified scene 7/9 rects, and reject literal backticks in authored scene sources.

**Architecture:** The Present-flow fix is two surgical changes: one expression in the Rust view builder (`presenting` is only true when no dialogue queue is pending) and deletion of the frontend 600 ms hold machinery. Content gates live in tests, not the compiler — the live-baseline test asserts every compiled investigation target is placed (a hard compiler error would break the layout editor's placement loop), and lowering `OVERLAP_WARN_THRESHOLD` to 0.5 makes the existing warnings-count assertion catch partial overlaps. The backtick leak gets a compiler error because it is never intentional syntax, plus fixes for the three live leaks. Layout/content fixes are data-only edits followed by `scenes:compile` and golden-snapshot refresh.

**Tech Stack:** Rust (Tauri 2 engine), Svelte 5 runes frontend, TypeScript compile-scenes pipeline (Vitest), Bun 1.3.1.

**Spec:** https://github.com/cwchanap/Lyra/issues/90 — the issue body plus the 2026-09-20 validity-review comment (the last comment) is the spec. Confirmed-against-`main` findings from that review: A1/A2 already fixed; H1b, H1a, C4, B3, E3 open; C1–C3/H2 dismissed pending retest; inventory softlock, WebKit SIGABRT (I), D typography, F art out of scope (see below).

## Global Constraints

- Package manager is bun pinned to `bun@1.3.1`; app tests via `bun run --cwd apps/game test <file>`, script tests via `bun run test:scripts <filter>`.
- Generated JSON under `apps/game/src-tauri/resources/` is never hand-edited; regenerate with `bun run scenes:compile`.
- Rust domain types serialized to the frontend use `#[serde(rename_all = "camelCase")]` (e.g. view field `presenting`).
- Authored game content is Traditional Chinese; keep full-width punctuation (`（）`) in authored names.
- Rust changes must pass `cargo clippy` with warnings denied (`bun run rust:lint`); script changes must pass `bun run check:scripts`.
- Compiler unit tests use fixtures under `packages/scripts/__fixtures__/`, not the live `docs/stories_plan/` tree.
- Commits follow the existing conventional style (`fix(game): …`, `test(scripts): …`, `fix(ch1): …`).

## Out of scope (tracked in #90, not this plan)

- Final-hearing inventory softlock: root cause hypothesis is the dev-only `jump_to_scene_inner` inventory wipe (navigation.rs:72) reached via the new MCP debug bridge; needs playtest-session audit before any product fix.
- WebKit SIGABRT (section I), CJK typography pass (D), art regeneration (F), auto-outro progress affordance (G), evidence-card art polish (E1/E2).
- H2 (tile double-click) and C1–C3 retest: dismissed as separate fixes by the validity review; the existing packaged smoke (`analysis-beat85` challenges 反駁 → advances lead-in → waits for `crossExam?.presenting` → presents) exercises the repaired flow end-to-end and needs no spec change — run it as the final gate after Tasks 1–2 if in doubt.
- Requiring layout sidecars for every investigation scene (would break the `analysis-chapter-1` and `hpa_257_valid` fixture corpora, which legitimately have none); a compile-time unplaced-target warning (the Task 3 test gate plus the visible UNPLACED panel already cover it).

## Review Focus

- Empty or all-`SceneTag` challenge lead-in: with no visible items the queue drains inside the challenge command itself — empty segments short-circuit in `install_or_exhaust` (dialogue.rs:236-237), all-tag segments drain via `consume_scene_tags_at_cursor` after install (dialogue.rs:314-316) — and `try_advance_interrogation` clears `pending_queue`, so the tray must be shown immediately on the challenge's own returned view. Pinned in Task 1 (`l_off`).
- Save/load mid-lead-in: capture already snapshots `Presenting` plus the live queue (save/capture.rs:1769-1826); restore renders through the same view builder. Pinned by the restore case in Task 1 (save/restore.rs:2717). No new schema field — do not add one.
- Unplaced investigation targets must still compile — the layout editor's placement loop reads the compiler's output (the editor cannot place what the compiler refuses to emit); the gate is the live-content test, not a compiler error. Pinned in Task 3.
- Any future ≥50% hotspot overlap in any live scene must fail the baseline warnings-count assertion, not just the specific scene 9 rects. Pinned in Task 4 (threshold 0.5 + existing count check).
- A future literal-backtick leak in any authored scene field (Name, Summary, dialogue) must fail compile with a line number. Pinned in Task 5.
- After hold removal, one activation (pointer click, Enter, Space, programmatic `.click()`) must fire exactly one challenge — no double-fire from leftover suppression paths. Pinned in Task 2.

---

### Task 1: Rust view — evidence tray only after the challenge lead-in drains (H1b)

**Files:**
- Modify: `apps/game/src-tauri/src/game/mod.rs:2815` (the `CrossExam::Presenting` arm of `cross_exam_view` construction, `presenting: true`)
- Modify: `apps/game/src-tauri/src/game/view.rs:616-617` (doc comment on `CrossExamView.presenting`)
- Test: `apps/game/src-tauri/src/game/mod.rs` (`challenge_lead_in_hides_cross_exam_line_id` ~:6709 and `challenge_fires_during_active_testimony_dialogue` ~:6793) and `apps/game/src-tauri/src/game/save/restore.rs` (`playing_and_presenting_cross_exam_round_trip_exactly` ~:2717)

**Interfaces:**
- Consumes: `InterrogationSceneState.pending_queue: Option<ActiveDialogueQueue>` (already pub(crate)); view construction already borrows `scene`.
- Produces: `CrossExamView.presenting: bool` semantics change — now `true` only when `scene.pending_queue.is_none()`. Frontend (`InterrogationStage.svelte:71`, packaged e2e `state.scene.visiblePhases[].crossExam?.presenting`) consume the flag unchanged.

Verified behavior chain (do not re-litigate): `challenge_interrogation_line` (mod.rs:1557) sets `CrossExam::Presenting` and installs the lead-in queue in one action, so `pending_queue` is `Some` for the whole lead-in. The tray gate is `InterrogationStage`'s `{#if presenting && crossExam}` — the stage is always mounted and `active` during the lead-in via `isInterrogationPresentationActive` (mode dialogue + `queueToken.sceneId` match; `lib/interrogation/presentation.ts`). `playing_unbroken_line_id` already returns `None` during the lead-in (no 反駁 row renders). When the lead-in drains, `on_queue_exhausted` → `try_advance_interrogation` sets `pending_queue = None` (mod.rs:716), installs no successor (phase already entered), and `mode_view`'s `(Some(item), Some(t))` match fails → mode becomes `Interrogation`. Therefore `pending_queue.is_none()` is false for the whole lead-in and true exactly from the drain onward — the tray opens one advance later, never over pending dialogue. (A review proposed keying the tray off a mode-branch change instead; that is unnecessary — the lead-in text renders through the Dialogue-mode children branch, which that design would have to re-plumb.)

- [ ] **Step 1: Extend the existing tests with the view assertions**

Do not create new test functions — extend the two that already have the setup, and add one restore case. All assertions go on returned views (`challenge_interrogation_line` and `advance_dialogue` each return `GameStateView`); never rebuild a second view of the same state.

1. `challenge_lead_in_hides_cross_exam_line_id` (mod.rs:6709) — after the existing `cross_exam_line_id == None` assertion on the challenge's returned view, add `view_presenting(&view) == false` (tray closed while the lead-in queue is pending); then `let drained = engine.advance_dialogue(token_from(&view)).unwrap();` and on that returned view assert `matches!(drained.mode, ModeView::Interrogation { .. })` and `view_presenting(&drained)` (queue cleared by `try_advance_interrogation`, mode flipped).
2. `challenge_fires_during_active_testimony_dialogue` (mod.rs:6793) — after the existing `Presenting` enum assertion for `l_off` (whose `challenge: []`/`default_challenge: []` drain the queue inside the command, test_support.rs:2204/2215), assert on the challenge's own returned view: mode `Interrogation` and `presenting == true`.
3. `playing_and_presenting_cross_exam_round_trip_exactly` (save/restore.rs:2717) — its `Presenting` arm currently covers only a drained queue (and its `round_trip` helper at :1584 is private to that module). Add a third case there: restore `Presenting` **with the lead-in queue still pending** and assert the restored view is Dialogue mode with `presenting == false`. That restored state is currently untested.

Helper `view_presenting(view)` walks `SceneView::Interrogation { visible_phases, .. }` → `phase.cross_exam.as_ref().unwrap().presenting`. If `l_deny`'s lead-in is a single item, one `advance_dialogue` drains it.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test --manifest-path apps/game/src-tauri/Cargo.toml challenge_ -- presented cross_exam_round_trip`
Expected: FAIL — the extended lead-in test sees `presenting == true` while the queue is pending (the restore case may already pass; its assertion is a pin, and if it fails that is a separate pre-existing restore bug worth knowing about).

- [ ] **Step 3: Implement the one-expression fix**

In the `CrossExam::Presenting` arm (~mod.rs:2815): `presenting: true` → `presenting: scene.pending_queue.is_none()`. Update the `CrossExamView.presenting` doc comment (view.rs) to: "True when the evidence tray should be shown — only once no dialogue queue is pending, so the challenge lead-in drains before the tray activates."

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo test --manifest-path apps/game/src-tauri/Cargo.toml challenge_`
Expected: PASS (including pre-existing `challenge_lead_in_hides_cross_exam_line_id` and the present-flow tests at ~5577).

- [ ] **Step 5: Full Rust gates**

Run: `cargo test --manifest-path apps/game/src-tauri/Cargo.toml && bun run rust:lint`
Expected: PASS, no clippy warnings.

- [ ] **Step 6: Commit**

```bash
git add apps/game/src-tauri/src/game/mod.rs apps/game/src-tauri/src/game/view.rs
git commit -m "fix(game): open the interrogation evidence tray only after the lead-in drains"
```

### Task 2: Frontend — replace the 反駁 600 ms hold with normal single-click activation (H1a)

**Files:**
- Modify: `apps/game/src/lib/components/DialogueBox.svelte` (hold machinery inventory below)
- Modify: `apps/game/src/lib/components/InterrogationChrome.test.ts:43` (asserts the source contains `長按`)
- Test: `apps/game/src/lib/components/DialogueBox.test.ts`

**Interfaces:**
- Consumes: `crossExam.onChallenge` prop (unchanged).
- Produces: `button.xexam-challenge` activates on any single activation path (pointer click, Enter, Space, programmatic click). No new exports.

Delete every hold-only identifier (verified current locations): `challengeHoldDurationMs` (:19); state at :77-81 (`challengeHoldTimer`, `challengeSuppressionTimer`, `heldChallengePointerId`, `suppressNextPhysicalChallengeClick`, `challengeCharging`); the timer/suppression functions and `handleChallengePointerDown` / `cancelChallengePointerSequence` (:200-262); the `clearChallengeHold()` call in `onDestroy` (:~290); markup `onpointerdown/onpointerup/onpointercancel/onpointerleave` attributes, `class:charging`, and both `<span class="hold-cue">長按</span>` (:727-750); CSS `.xexam-challenge-wrap:has(.xexam-challenge.charging)` (:1195), `.hold-cue` (:1242, :1443), `.xexam-challenge.charging` (:1355, :1435).

Keep: the `.xexam-challenge-wrap` element and its base CSS (the ring, OBJECT lockup, and absolute positioning live on it — :724, :1176-1220); the keyboard/synthetic-click test at DialogueBox.test.ts:~1913 (`detail: 0` immediate challenge — packaged e2e presses 反駁 via `button.click()` in helpers.ts:893-905, so this is the contract those suites exercise); and the disabled test at :~1962. Do not rewrite either.

`handleChallengeClick` shrinks to `event.stopPropagation(); invokeChallenge();` — `invokeChallenge` (:195) already guards `disabled || !crossExam`.

Also amend the spec: `docs/superpowers/specs/2026-08-14-interrogation-scene-redesign-design.md:210-216` still specifies the 600 ms charge and click-suppression semantics — replace those lines with single-click activation (one activation path, native button semantics for keyboard/AT/programmatic clicks) in the same commit, or a later spec-following agent will reintroduce the hold.

- [ ] **Step 1: Replace the hold tests with one single-click test**

Delete the five hold tests at DialogueBox.test.ts:1763 (non-primary buttons), 1795 (completed hold — this is the test that encodes the old suppression semantics), 1820 (suppression until release), 1980 (disabled pointerdown), 2041 (foreign pointer id). Crib the mount/assert pattern from :1795 and write exactly one new test:

```ts
it("activates the challenge on a single pointer click", async () => {
  // pointerdown, pointerup, click with detail: 1 — no timer advance.
  // Current code fires ZERO challenges (hold cancelled at pointerup arms
  // suppression, which swallows the physical click); after deletion this
  // sequence must fire exactly one onChallenge. Red for the right reason:
  // one activation must equal one challenge.
});
```

In `InterrogationChrome.test.ts`, drop only the `expect(dialogue).toContain("長按")` line (:43) — the neighboring `.xexam-challenge-wrap`, `conic-gradient`, and `OBJECT` assertions stay.

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run --cwd apps/game test src/lib/components/DialogueBox.test.ts src/lib/components/InterrogationChrome.test.ts`
Expected: FAIL — the new click test sees zero challenges (hold still gates); the chrome test still expects `長按`.

- [ ] **Step 3: Delete the hold machinery and simplify `handleChallengeClick`** (inventory above).

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun run --cwd apps/game test src/lib/components/DialogueBox.test.ts src/lib/components/InterrogationChrome.test.ts && bun run check`
Expected: PASS, svelte-check clean.

- [ ] **Step 5: Commit**

```bash
git add apps/game/src/lib/components/DialogueBox.svelte apps/game/src/lib/components/DialogueBox.test.ts apps/game/src/lib/components/InterrogationChrome.test.ts docs/superpowers/specs/2026-08-14-interrogation-scene-redesign-design.md
git commit -m "fix(game): make 反駁 a normal single-click challenge control"
```

### Task 3: Live-content gate — every compiled investigation target must be placed (A follow-up)

**Files:**
- Modify: `packages/scripts/compile-scenes.test.ts` — the live-baseline test "keeps the Chapter 1 warning and save-content manifest baseline" (:2690), which already compiles `docs/stories_plan` into a tmp `outRoot`

**Interfaces:**
- Consumes: the live-baseline test's existing `result`/`outRoot`; compiled investigation scene JSON shape `sublocations[].hotspots[].layout` / `sublocations[].characters[].layout`.
- Produces: a test-only gate. No compiler change, no fixture change, no snapshot churn.

Why not a compiler error (do not re-litigate): a hard error breaks the editor placement loop — the layout editor loads its scenes from the compiler's output (`layout-editor/src-tauri/src/lib.rs:75-76` reads `apps/game/src-tauri/resources/scenes`), the compiler writes nothing when it errors (orchestrator.ts:684), and the editor's sidecar starts empty and fills per-drag (`layout-store.svelte.ts:86, 123-148`) — so a newly authored hotspot in a sidecar'd scene could never reach the editor to be placed. The live-content gate is also strictly broader: compiled output carries `layout: null` for BOTH failure modes (missing sidecar file and missing entries), so one assertion catches what the compiler error caught plus the no-sidecar case, while the sidecar-less fixture corpora (`analysis-chapter-1`, `hpa_257_valid`, `asset_enabled`) stay untouched. The nine `investigation_scene_map_*` scenes have zero targets, so no exception is needed. Deliberately skipped: a `scenes:compile` warning — the test gate already fails CI and local `bun run test:scripts`, and the UNPLACED panel is itself visible feedback in dev.

This is a pinning test, not a bug fix: the live corpus is fully placed today (A1/A2 landed in commits `895be620`/`3eb0b0d5`; verified by walking the compiled output — zero `layout: null` targets).

- [ ] **Step 1: Add the placement walk to the live-baseline test**

After the existing `result.ok` / warnings assertions in the :2690 test, read every `investigation_scene_*.json` under `outRoot`'s chapter directory and assert each hotspot and character has `layout !== null`, failing with scene/sublocation/target ids in the message.

- [ ] **Step 2: Run it and confirm it pins**

Run: `bun run test:scripts compile-scenes.test.ts -t "live"`
Expected: PASS (all placed today). Optionally verify the gate bites by temporarily removing one placement from a sidecar and re-running — expect FAIL naming that target, then restore.

- [ ] **Step 3: Commit**

```bash
git add packages/scripts/compile-scenes.test.ts
git commit -m "test(scripts): gate live Chapter 1 on every investigation target being placed"
```

**Interfaces:**
- Consumes: existing `CompileError`/`error()` helper pattern in layout.ts; the invalid-fixture auto-discovery describe in `packages/scripts/compile-scenes.test.ts:1112` (new fixture dirs are picked up automatically; `expected-error.txt` contains just the error code).
### Task 4: Lower the overlap-warn threshold to 0.5, then retune scene 9/7 rects (C4 + B1–B4)

**Files:**
- Modify: `packages/scripts/compile-scenes/layout.ts:689` (`OVERLAP_WARN_THRESHOLD = 0.8` → `0.5`)
- Modify: `packages/scripts/compile-scenes/layout.test.ts:509-541` (threshold boundary tests)
- Modify: `docs/stories_plan/chapter_1/investigation_scene_9.layout.json` (sublocation `contractor_desk`)
- Modify: `docs/stories_plan/chapter_1/investigation_scene_7.layout.json` (sublocations `inner`, `back_door`)
- Snapshot: `packages/scripts/__snapshots__/compile-scenes.test.ts.snap` (contentRevision hash)

**Interfaces:**
- Consumes: `detectLayoutOverlaps` / `overlapRatio` (layout.ts:538, :699) unchanged; the live-baseline warnings-count assertion (compile-scenes.test.ts:2701 — `result.warnings` length 1).
- Produces: a general ≥50% overlap gate for every live scene (via the existing count check) instead of a scene-9-specific test — no pinned three-hotspot test.

Measured live census (every Chapter 1 sidecar, `overlapRatio` semantics): exactly three pairs share area above zero — `workorder`/`access_permission_list` 0.733 and `workorder`/`material_kit_list` 0.733 in scene 9's `contractor_desk` (fixed by this task), and `counter_admin_records`/`katase_register_gap` 0.20 in scene 3 (silent under 0.5). So 0.5 adds zero live warnings after the scene 9 fix, and the existing warnings-length-1 assertion then catches any future ≥50% partial overlap in any scene. Scene 7 verified issues: `old_clock` (.496, .191) sits on a shelf canister while the painted wall clock is inside the `miyake_replay` column (x .264–.356); `phone_drop` (.455–.615 x) is center-floor, painted phone is lower-left; `staff_shelf` anchored x: 0 is clipped by the cover plane (`--scene-cover-width: max(100vw, 177.78vh)`, InvestigationSceneSurface.svelte:451-458 — ~12.5% overhang per side at 800×600, so x ≥ 0.13 is the on-screen floor, not the art position; the painted shelf runs x≈0–0.22, so 0.13–0.22 stays on it at both aspect ratios); `fire_door_7` (.365, .15) must clear `.scene-label` (top: 22px, on the coordinate plane) and the `.explore-hud` block (top: 76px, ExploreView.svelte:83-85) — not just one of them.

This task needs the background art — read the PNGs (`static/assets/backgrounds/chapter_1/investigation_scene_9/contractor_desk.png`, `.../investigation_scene_7/` variants) and pick final numbers from what is actually painted.

- [ ] **Step 1: Lower the threshold and update the boundary tests**

Set `OVERLAP_WARN_THRESHOLD = 0.5`; rewrite the two boundary tests at layout.test.ts:509-541 around the new value (cases ~0.499 / 0.5 exactly / ~0.501 using the same `dx`-offset construction; the existing ~49% "below threshold" case stays below).

- [ ] **Step 2: Run to verify the failing state**

Run: `bun run test:scripts compile-scenes`
Expected: layout unit tests PASS; the live-baseline test FAILS — `result.warnings` length is now 2 (the scene 9 pair joins the `story_catalog.md` singleton warning). That is the red that drives the rect fix.

- [ ] **Step 3: Scene 9 — separate the three packet rects**

Open `contractor_desk.png`; locate the three packet sheets; set `workorder`, `access_permission_list`, `material_kit_list` to disjoint rects each covering its painted sheet (keep `access`/`material` where they are if they already sit on their sheets; move/shrink `workorder` to the painted workorder sheet's exclusive region). If the sheets genuinely share painted area, split at the visual seam so the topmost sheet's exclusive region owns the shared pixels. Re-run Step 2's command: warnings back to length 1.

- [ ] **Step 4: Scene 7 — fix the four mismatches**

Move `old_clock` onto the painted wall clock; move `phone_drop` onto the lower-left painted phone; shift `staff_shelf` to the x 0.13–0.22 band (on-screen floor at 800×600, final position from where the painted shelf actually is); nudge `fire_door_7` clear of both `.scene-label` (top 22px) and the 76px `.explore-hud` band (verify in the layout editor preview via `bun run dev:editor` if faster than math).

- [ ] **Step 5: Compile, verify, and refresh goldens**

Run: `bun run scenes:compile && bun run test:scripts && bun run check:scripts`
Expected: compile succeeds with the pre-existing single live warning; the placement walk from Task 3 still passes (all targets placed); update `packages/scripts/__snapshots__/compile-scenes.test.ts.snap` via vitest `-u` — the diff should be the `contentRevision` hash only.

- [ ] **Step 6: Commit**

```bash
git add packages/scripts/compile-scenes/layout.ts packages/scripts/compile-scenes/layout.test.ts docs/stories_plan/chapter_1/investigation_scene_9.layout.json docs/stories_plan/chapter_1/investigation_scene_7.layout.json packages/scripts/__snapshots__/
git commit -m "fix(ch1): tighten hotspot-overlap gate and align scene 7/9 rects with painted art"
```

### Task 5: Reject literal backticks in scene sources; fix the three live leaks (E3)

**Files:**
- Modify: `packages/scripts/compile-scenes/orchestrator.ts:320` area (scene-source read — add the check)
- Create fixture: `packages/scripts/__fixtures__/invalid/investigation_scene_source_backtick/` (`chapter_1/chapter.md`, one scene file containing a backtick, `expected-error.txt`)
- Modify: `docs/stories_plan/chapter_1/investigation_scene_3.md:394` (Name), `analysis_scene_p1_5.md:35` (Summary), `investigation_scene_p1.md:55` (dialogue line)
- Snapshot: `packages/scripts/__snapshots__/compile-scenes.test.ts.snap` (contentRevision hash)

**Interfaces:**
- Consumes: the invalid-fixture auto-discovery describe at compile-scenes.test.ts:1112 (`expected-error.txt` = error code only).
- Produces: error code `sceneSourceBacktick` (per-occurrence, with `sourceFile` + line), emitted for every scene file read at orchestrator.ts:320 regardless of prefix (linear/investigation/interrogation/analysis).

Verified: three live leaks across three field types — `investigation_scene_3.md:394` Name ``兩杯咖啡訂單 `K.` ``, `analysis_scene_p1_5.md:35` Summary ``…明確印著 `REPRINT` ``, `investigation_scene_p1.md:55` dialogue line ``` `REPRINT` ``` (she reads the printed word aloud). Nothing in `compile-scenes/` or the game frontend handles inline code — backticks always render literally. The remaining chapter_1 backtick hits are in `background-variety-audit.md`, which the compiler never reads (only manifest-listed scene files).

- [ ] **Step 1: Add the invalid fixture**

Minimal chapter (`chapter.md` + one scene file with a single backtick anywhere in authored text); `expected-error.txt` content: `sceneSourceBacktick`.

- [ ] **Step 2: Run to verify it fails**

Run: `bun run test:scripts compile-scenes.test.ts -t "invalid fixtures"`
Expected: FAIL — the new fixture compiles without error (check not implemented), so the expected-error assertion mismatches.

- [ ] **Step 3: Implement the check at the scene-source read**

Where orchestrator.ts:320 reads a scene file's `source`, scan for the backtick character and push one `sceneSourceBacktick` error per occurrence with `sourceFile` and the 1-based line number; the message tells the author to use 「」 or （） instead (backticks render literally).

- [ ] **Step 4: Run to verify the second failing state, then fix the three leaks**

Run: `bun run test:scripts compile-scenes.test.ts -t "invalid fixtures"` — the fixture now passes; then `bun run scenes:compile` FAILS on the three live leaks (with line numbers). Fix them: `兩杯咖啡訂單（K.）` (Name, full-width parens — house style) and `「REPRINT」` in the Summary and the dialogue line (quoted printed text).

- [ ] **Step 5: Compile, verify, and refresh goldens**

Run: `bun run scenes:compile && bun run test:scripts && bun run check:scripts`
Expected: compile clean; live-snapshot `contentRevision` moves (update via vitest `-u`) and the snapshot diff shows the three renamed strings — this is the durable check. Do not verify by grepping `apps/game/src-tauri/resources/` (untracked, exists only locally).

- [ ] **Step 6: Commit**

```bash
git add packages/scripts/compile-scenes/orchestrator.ts packages/scripts/__fixtures__/invalid/investigation_scene_source_backtick/ docs/stories_plan/chapter_1/investigation_scene_3.md docs/stories_plan/chapter_1/analysis_scene_p1_5.md docs/stories_plan/chapter_1/investigation_scene_p1.md packages/scripts/__snapshots__/
git commit -m "fix(ch1): reject literal backticks in scene sources and quote printed text properly"
```

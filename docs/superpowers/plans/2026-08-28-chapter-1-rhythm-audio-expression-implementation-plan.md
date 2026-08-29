# Chapter 1 Rhythm, Audio, and Portrait Expression Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不改變第 1 章案件答案、證據取得程序與 17-scene manifest 的前提下，收斂重複內容、重建情緒節奏、增加四首功能性 BGM，並以九張新表情立繪讓主要角色的情緒轉折可見。

**Architecture:** 保留現有 Markdown scene grammar、asset compiler、portrait asset ID、audio cue、GameplayAudioController、DialogueBox、Analysis 與 Interrogation runtime。所有改動落在 authored scene、`characters.yaml`、sound plan、既有 catalog、production coupling、tests/audits 與生成資產；不新增 runtime/framework。Scene 10 使用既有 multi-question inquiry 能力把前三段審查收成一個 phase；音樂只在既有 visual/phase/scene-tag 邊界切換。

**Tech Stack:** Markdown story scenes, YAML asset config, Lyra scene compiler, existing audio plan/apply/generate tooling, ElevenLabs, built-in OpenAI image generation/editing, PNG normalization, Svelte/Tauri existing runtime, Vitest, WDIO packaged E2E.

**Spec:** `docs/superpowers/specs/2026-08-28-chapter-1-rhythm-audio-expression-design.md`

## Global constraints

- Deliver everything as **one PR**.
- Keep all 17 manifest scenes and their order.
- Preserve culprit, three front-facing evidence packages, required evidence/reveals, procedure gates, legal authority and fair-play physical anchors.
- Chapter 1 teaches only 摘要／本機順序／核准片段.
- Aoba may be named only in the post-case media bridge; do not reveal official reenactment, A-90, Soma's old witness role, left/right route truth, or `ZW_A16.lock` meaning.
- Keep `ZW_A16.lock` and public Aoba media as separate source chains and separate visual/dialogue frames.
- No new parser, music engine, stop-cue feature, crossfade framework, expression state machine, tutorial branch, generic asset validator, background raster set, or evidence raster regeneration.
- New portrait assets: exactly 9 transparent `768x1024` RGBA PNGs.
- New BGM assets: exactly 4 reusable loopable OGG tracks, target 45 seconds each.
- Existing `bgm_review_board_loss`, `bgm_review_board_victory`, and `bgm_chapter_close` remain.
- Never hand-edit generated JSON under `apps/game/src-tauri/resources/**`.
- `compile-scenes.test.ts` live-corpus assertions, snapshots, `background-variety-audit.md`, `production-anchors.ts`, and packaged E2E are production contracts, not cleanup deferred to the end.

---

## Task 1: Compress the opening and close its anchor/timing coupling

**Files:**
- Modify: `docs/stories_plan/chapter_1/scene_p0.md`
- Modify: `docs/stories_plan/chapter_1/investigation_scene_p1.md`
- Modify: `docs/stories_plan/chapter_1/analysis_scene_p1_5.md`
- Modify: `docs/stories_plan/chapter_1/scene_p2.md`
- Modify: `docs/stories_plan/chapter_1/investigation_scene_1.md`
- Modify: `docs/stories_plan/chapter_1/scene_2.md`
- Modify if anchored copy changes: `apps/game/e2e-tauri/production-anchors.ts`

### Step 1: Baseline the actual rhythm proxy before editing

Run:

```bash
bun run scenes:compile
bun run test:scripts -- packages/scripts/compile-scenes.test.ts
bun run --cwd apps/game check:e2e
bun run audio:validate docs/audio_plans/chapter_1.sound-plan.yaml
```

Record before editing:

- current `contentRevision`;
- total opening production advance count (`N=274` baseline comment today);
- **per-scene mandatory advance counts** for P0, P1, P1.5, P2, Scene 0 and Investigation Scene 1 intro using the same compiled corpus used by the production journey;
- one normal-speed elapsed-time sample for P0/P1/P1.5/P2 and aggregate time to Scene 0.

Before editing, convert each authored time target into a numeric advance band from the observed baseline ratio:

```text
target advances ≈ baseline advances × target seconds / baseline observed seconds
```

For P1/P1.5, apply this only to mandatory authored dialogue/board-result segments; required player interactions remain fixed and are measured separately. Write the resulting bands in implementation notes before changing text so the bands cannot move to fit the result.

Targets:

- P0 45–60s;
- P1 4–6m;
- P1.5 1.5–2.5m;
- P2 2–3m;
- Scene 0 around 10–12m from New Game, hard max 14m.

### Step 2: P0 → one compact city/system overture

Keep all four visual units and only unique beats: KAGAMI routine, one citizen trusting automatic organization, blue reflection/umbrella seed, wet osmanthus atmosphere. Remove repeated “nobody noticed / city moved on” variants.

### Step 3: P1 → 4–6 minutes without changing hotspot contracts

Move Hayasaka into the shop before the long hotspot sequence. Preserve hotspot IDs/reveals `receipt`, `register`, `cctv`, `ledger`; keep each unique fact once; CCTV remains plausible but insufficient.

### Step 4: P1.5 → one short comparison board

Keep `p1_reprint_time_board`, card IDs, accepted/incorrect answers, hint and unlock. Result dialogue establishes only: receipt genuine/reprint-time, ledger fixes payment-time, CCTV supports departure, neither person fabricated the transaction.

If `anchors.p1Practice.acceptedCards` labels change, update them **in this task**. Prefer keeping labels stable when content meaning is unchanged.

### Step 5: P2 → 2–3 minute montage

Keep existing visual units and exact seeds: cake edge, slow old clock, Masuda/osmanthus/K., Katase last-train, espresso/backflush, closing whiteboard, unfinished latte/clock. Cut repeated routine replies.

### Step 6: Scene 1/2 method-speech reduction

Keep Soma's one explicit wrong assumption, broken coffee machine, Hayasaka's paper habit, Miyake mother/rice-ball/cake/commission stakes and legal gate. Explain access limits once.

`production-anchors.ts` currently pins Scene 2 strings under `captureProof` (`sceneEntryDialogue`, `preSwapDialogue`, `recoveryPortraitDialogue`). If any of those authored lines change, update the anchor in the same commit; do not defer to Task 7.

### Step 7: Immediate timing/anchor gate

Recompile and remeasure the same per-scene counts. Required:

- each planned opening scene falls inside the numeric band frozen in Step 1, or the implementation note explains the fixed interaction cost that prevents it;
- aggregate normal-speed spot check reaches Scene 0 by 14m, target 10–12m;
- no required hotspot/card/evidence ID changed accidentally;
- `check:e2e` passes with any necessary production-anchor text updates.

```bash
bun run scenes:compile
bun run --cwd apps/game check:e2e
bun run background-cues:audit --chapter chapter_1
```

Do **not** run `--check-report` yet; dialogue cuts can renumber queue-index cue keys. Task 3 owns the first exact cue-report recouple after the full structural edit.

Commit Task 1 authored files plus any same-cause `production-anchors.ts` change.

---

## Task 2: Rebalance first investigation, defeat, and breathing beat

**Files:**
- Modify: `docs/stories_plan/chapter_1/investigation_scene_3.md`
- Modify: `docs/stories_plan/chapter_1/interrogation_scene_4.md`
- Modify: `docs/stories_plan/chapter_1/scene_5.md`
- Modify: `docs/stories_plan/chapter_1/scene_6.md`
- Modify if anchored copy changes: `apps/game/e2e-tauri/production-anchors.ts`

### Step 1: Move required witness timing into Scene 3

Move Katase's complete last-train timing clarification into the existing Scene 3 topic. Do not duplicate it in Scene 6.

Trim Scene 3 repeated explanation while preserving L-turn, maintenance routine, sound masking, two-coffee/K., clock, rain, required evidence and reveals.

### Step 2: Keep Scene 4 mechanically identical, shorter in coaching

Preserve all question IDs, contradiction targets, required/optional flags, evidence, wrong feedback and reveals. Trim repeated coaching/recap only.

`production-anchors.ts` pins `unicodeSave.interrogationEntryDialogue`. If that exact line changes, update the anchor now; otherwise leave it stable deliberately.

### Step 3: Make Scene 5 loss land and exit

Keep the actual loss. After the decision, move quickly to hallway/recovery rather than explaining the same weakness again.

### Step 4: Make Scene 6 a true breather

Required shape:

1. food/coffee;
2. shared-work history;
3. Soma admits first-hearing panic and character-argument drift;
4. Hayasaka responds as partner;
5. at most one concise evidence-sorting line;
6. passerby discards wet umbrella sleeve;
7. Katase may pass/greet but no interview;
8. Soma decides to re-walk Rain Bell.

Hard line-count gate before commit:

- ≥50% spoken lines = rest/relationship/emotion;
- ≤25% spoken lines = direct evidence recap;
- zero full Katase timing interview lines.

Verification:

```bash
bun run scenes:compile
bun run evidence-sources:audit
bun run --cwd apps/game check:e2e
```

Commit authored files plus any same-cause `production-anchors.ts` change.

---

## Task 3: Closed late-arc structural commit

**Files:**
- Modify: `docs/stories_plan/chapter_1/investigation_scene_7.md`
- Modify: `docs/stories_plan/chapter_1/investigation_scene_8.md`
- Modify: `docs/stories_plan/chapter_1/analysis_scene_8_5.md`
- Modify: `docs/stories_plan/chapter_1/investigation_scene_9.md`
- Modify: `docs/stories_plan/chapter_1/interrogation_scene_10.md`
- Modify: `docs/stories_plan/chapter_1/scene_11.md`
- Modify: `docs/stories_plan/chapter_1/background-variety-audit.md`
- Modify: `packages/scripts/compile-scenes.test.ts`
- Modify: `packages/scripts/__snapshots__/compile-scenes.test.ts.snap`
- Modify: `apps/game/e2e-tauri/analysis-beat85.e2e.ts`
- Modify if anchored copy changes: `apps/game/e2e-tauri/production-anchors.ts`
- Read-only: `docs/stories_plan/story_catalog.md`
- Read-only: `apps/game/src-tauri/src/game/analysis_integration_tests.rs`

**This task must end green before portrait/audio work begins.**

### Step 1: Scene 7/8 deduction compression

Keep one concise deduction per major discovery. Scene 8 keeps Takase screenshot as lead, Kurose formal fixation, device identity, local sequence and telecom confirmation; UI carries the full `1841–1844` enumeration after first read. Identity remains blank.

`production-anchors.ts` pins `unicodeSave.compositeHotspot` in Scene 7. Preserve that hotspot label when possible; if authored label must change, recouple the anchor in this task.

### Step 2: Scene 8.5 keeps three boards but removes the repeated interaction

Do **not** delete `evidence_packages`.

Shrink it from 7 cards / 3 groups to **3 cards / 2 groups**:

```text
Cards:
- miyake_call
- miyake_pov_replay
- external_credential_event

Groups:
- miyake_small_lies
- earlier_third_party
```

Delete from `evidence_packages`:

- `event_1841`
- `event_1842`
- `event_1843`
- `event_1844`
- `lock_chronology`

Keep its existing Reveals:

```text
assert_fact:miyake_known_lies_are_unrelated_to_murder
assert_fact:earlier_external_entry_exists
```

Then `local_event_sequence` remains the only board that manipulates `event_1841 → event_1842 → event_1843 → event_1844`; keep its existing unlock from `evidence_packages completed` and existing `merge_time_is_not_event_time` reveal.

Keep `narrow_request_basis` and its distinct-source threshold/objective unchanged.

At the end of the classify board's Result Dialogue, immediately before the order board begins, add a `[場景：]` visual boundary reusing:

```text
background.chapter_1.investigation_scene_8.fixed_panel
```

This is the `tag_002` BGM boundary; no new raster.

### Step 3: Scene 9 optional-life consolidation

Keep `other_k_name`; merge `clerk_long_day` + `clerk_thermos`; keep one worn-sleeve/barley-tea beat; keep Kitami `early_shift`; remove separate `kitami_glasses` topic but retain slipping glasses as action motif. Preserve required evidence/reveals.

### Step 4: Scene 10 → exactly four phases

Final phase IDs:

```text
p1
gate
p4
p5
```

`p1` owns `q_p1`, `q_p2`, `q_p3` in sequence. `q_p2` unlocks on `question:q_p1 answered`; `q_p3` unlocks on `question:q_p2 answered`. Delete old `p2`/`p3` wrappers. `gate` unlocks on:

```text
phase:p1 completed and objective:prepare_narrow_lock_request completed
```

Use expression-neutral dialogue in Task 3; Task 4 owns new slugs.

**Known visual tradeoff:** p2/p3 phase backgrounds retire because interrogation visual cues are phase-level. Do not attempt question-body `[場景：]` rescue; those tags compile with `assetCue: null` in testimony dialogue.

Add one scene tag at the start of Outro before formal ruling, reusing the current p5 final-hearing plate. This becomes the victory-BGM boundary.

### Step 5: Scene 11 → one ending curve + Aoba bridge

Keep too-sweet latte, temporary closure/short-work bridge, clock packing, USB `ZW_A16.lock`, Amemiya source mismatch and final blue umbrella. Compress Amemiya confirmation into a short police-transfer note. Remove Soma's later physical walk back to Rain Bell.

Add the required 45–90 second media bridge:

> Rain Bell/KAGAMI follow-up → lawful café entrance image with umbrella edge → Mashiro says 「2016 年青葉記憶研究所火災」 → one unlabeled low-res corridor/fire frame → Soma quickly mutes → final real café/umbrella image.

Minimize/close USB first. Never show/confirm Aoba and `ZW_A16.lock` together.

### Step 6: Recouple the exact background inventory and document retired hearing plates

Generate inventory:

```bash
bun run scenes:compile
bun run background-cues:audit --chapter chapter_1
```

Update `background-variety-audit.md` to exact compiler-owned cue keys:

- add keep/B row for Scene 8.5 `tag_002` reusing fixed-panel;
- remove stale p2/p3 **cue rows** because exact report coverage forbids stale keys;
- remap gate/p4/p5 to new phase indices;
- add keep/B row for Scene 10 Outro ruling tag;
- recouple all queue-index cue keys shifted by dialogue cuts in Tasks 1–3, preserving the same semantic decision/priority unless visual function changed.

Additionally add a short prose subsection such as `### Retired hearing plates` recording:

- former p2 plate: time-record comparison;
- former p3 plate: L-shaped floor-plan reconstruction;
- retirement is intentional consequence of the p1 multi-question merge;
- per-question visual re-cue is unavailable in current grammar;
- fallback if playtest is too flat = restore phase split, not add runtime.

Then require exact report coverage:

```bash
bun run background-cues:audit --chapter chapter_1 --check-report docs/stories_plan/chapter_1/background-variety-audit.md
```

### Step 7: Update packaged Beat 8.5 expectations, not its architecture

`analysis-beat85.e2e.ts` remains the production classify → order → threshold → hearing journey.

Update only what the authored reduction changes:

- classify expected card set becomes the 3 cards above;
- classify expected groups become 2 groups;
- preserve partial Classify Save → Title → Continue restoration;
- preserve Order pointer/ordering behavior;
- preserve Threshold invalid/valid selection and objective completion;
- preserve handoff to Scene 10 and testimony/present journey through p4;
- preserve packaged Analysis/interrogation geometry/semantics checks.

### Step 8: Recouple the tracked production compiler tests **before** snapshot update

After the authored structural edits, first run the live-corpus test without `-u`:

```bash
bun run test:scripts -- packages/scripts/compile-scenes.test.ts
```

Expected failures are explicit production-corpus assertions, not merely snapshots. Hand-edit the two relevant `it` blocks:

1. `compiles the canonical HPA-265 Analysis scene with only the requested outputs`
   - board kinds/IDs remain classify/order/threshold;
   - classify groups become two;
   - classify card/source list becomes three;
   - two assertFact reveals remain on classify.
2. `keeps the HPA-265 hearing gate objective, authority, atomic grant, and p4 authorization fence`
   - find `q_p2` under `p1` rather than `p2`;
   - preserve its expected onCorrect semantic text (update literal only if deliberately re-authored);
   - gate unlock left side becomes `phase_completed: p1` rather than `p3`.

Do **not** modify `apps/game/src-tauri/src/game/analysis_integration_tests.rs` merely because it also names `evidence_packages`; that file uses a synthetic fixture to test generic Analysis persistence/capability and should stay intact.

Once the explicit test assertions match the new production contract:

```bash
bun run test:scripts -- -u packages/scripts/compile-scenes.test.ts
bun run test:scripts -- packages/scripts/compile-scenes.test.ts
```

Inspect snapshot diff for only intended corpus changes.

### Step 9: Run the focused packaged structural owner

```bash
cd apps/game
node scripts/build-e2e.mjs
node scripts/run-save-e2e.mjs --suite analysis-beat85
cd ../..
```

Expected: PASS through compact classify → local order → threshold → Scene 10 → p4. If the E2E binary cannot build/launch, report `BLOCKED`; do not substitute `check:e2e`.

### Step 10: Commit the closed structural slice

Commit story files together with background audit, explicit production compiler test, snapshot, Beat 8.5 E2E and any same-cause production-anchor update.

---

## Task 4: Add expression vocabulary and authored expression runs

**Files:**
- Modify first: `static/assets/config/characters.yaml`
- Then modify: Chapter 1 authored scene Markdown
- Inspect: `packages/scripts/compile-scenes/tokenizer.ts`
- Inspect: `packages/scripts/compile-scenes/assets/enrich.ts`

Add exactly:

```text
soma_ritsu: determined, shaken, relieved
hayasaka_akane: softened
miyake_sota: relieved
kamiya_mio: skeptical, conceding
kitami_shuichi: defensive, cornered
```

Add keys to `characters.yaml` **before** any corresponding `**Speaker**[slug]` line.

Expression-run rules:

- normally 2–5 consecutive spoken lines;
- no expression on narration/action;
- avoid one-line flicker;
- roughly ≤3 changes/character in an ordinary scene;
- Soma stays `standard` during Aoba mute.

Verification uses focused asset/config owners so the final `contentRevision` snapshot is not prematurely treated as green:

```bash
bun run scenes:compile
bun run test:scripts -- packages/scripts/compile-scenes/assets/config.test.ts packages/scripts/compile-scenes/assets/enrich.test.ts
bun run --cwd apps/game test
bun run --cwd apps/game check
```

Expected: no `assetUnknownExpression`; nine intended portrait asset IDs exist in compiled references; PNG files may still be missing until Task 5.

---

## Task 5: Generate exactly nine portrait assets

**Files to add:**

```text
static/assets/portraits/soma_ritsu/determined.png
static/assets/portraits/soma_ritsu/shaken.png
static/assets/portraits/soma_ritsu/relieved.png
static/assets/portraits/hayasaka_akane/softened.png
static/assets/portraits/miyake_sota/relieved.png
static/assets/portraits/kamiya_mio/skeptical.png
static/assets/portraits/kamiya_mio/conceding.png
static/assets/portraits/kitami_shuichi/defensive.png
static/assets/portraits/kitami_shuichi/cornered.png
```

- [ ] Inspect each corresponding `standard.png` before generation.
- [ ] Follow `.claude/skills/generating-lyra-image-assets/SKILL.md` and `static/assets/config/policy.yaml`.
- [ ] Preserve face, hair, outfit, crop and lighting; expression/posture delta only.
- [ ] Normalize each to exact `768x1024`, RGBA transparency, bottom-aligned, no stretching/chroma fringe.

Verification:

```bash
file -b static/assets/portraits/soma_ritsu/*.png \
  static/assets/portraits/hayasaka_akane/*.png \
  static/assets/portraits/miyake_sota/*.png \
  static/assets/portraits/kamiya_mio/*.png \
  static/assets/portraits/kitami_shuichi/*.png
bun run scenes:compile
bun run --cwd apps/game test
bun run --cwd apps/game check
```

Manually inspect Scene 5, Scene 9, Scene 10 and Scene 11 expression transitions.

---

## Task 6: Rebuild Chapter 1 sound plan and generate four BGM tracks

**Files:**
- Modify: `docs/audio_plans/chapter_1.sound-plan.yaml`
- Modify via tooling: `static/assets/config/audio.yaml`
- Modify via tooling: Chapter 1 scene Markdown audio cues
- Add:
  - `static/assets/audio/bgm/bgm_city_summary_motif.ogg`
  - `static/assets/audio/bgm/bgm_casework_day.ogg`
  - `static/assets/audio/bgm/bgm_rain_bell_daily.ogg`
  - `static/assets/audio/bgm/bgm_breakthrough_pursuit.ogg`

Use `.claude/skills/designing-lyra-sound-assets/SKILL.md`.

- [ ] Replace stale sound-plan sources with current manifest filenames (`investigation_scene_p1.md`, `analysis_scene_p1_5.md`, `analysis_scene_8_5.md`).
- [ ] Refresh `catalogSnapshot` from current `audio.yaml`.
- [ ] Keep existing three BGM prompts/files; revise reuse rationale/cue usage only.
- [ ] Add four reusable tracks from the spec, target 45s and loopable.
- [ ] Scene 6 / hearing open use `BGM: none`; do not create a stop-cue feature.
- [ ] Scene 10 p1/gate stays procedural silence/BGS; p4 breakthrough; p5 does not pre-play victory; Outro ruling tag starts existing victory.
- [ ] Scene 11 café uses ordinary/warm state; USB/Aoba/blue-umbrella tail earns existing chapter-close.

Validate and apply first:

```bash
bun run audio:validate docs/audio_plans/chapter_1.sound-plan.yaml
bun run audio:apply docs/audio_plans/chapter_1.sound-plan.yaml
```

Before spending generation credits:

```bash
bun run audio:generate docs/audio_plans/chapter_1.sound-plan.yaml --dry-run
```

Inspect the target list. Generate only the four new IDs, one at a time:

```bash
bun run audio:generate docs/audio_plans/chapter_1.sound-plan.yaml --only bgm_city_summary_motif
bun run audio:generate docs/audio_plans/chapter_1.sound-plan.yaml --only bgm_casework_day
bun run audio:generate docs/audio_plans/chapter_1.sound-plan.yaml --only bgm_rain_bell_daily
bun run audio:generate docs/audio_plans/chapter_1.sound-plan.yaml --only bgm_breakthrough_pursuit
```

Then:

```bash
bun run audio:apply docs/audio_plans/chapter_1.sound-plan.yaml --check
bun run audio:validate docs/audio_plans/chapter_1.sound-plan.yaml
bun run scenes:compile
```

Inspect OGG metadata and audition representative transitions. Fix bad edit points by cue placement or regeneration, not runtime crossfade work.

---

## Task 7: Final recouple and complete verification

**Files:**
- Modify again if final revision changed: `packages/scripts/compile-scenes.test.ts`
- Modify again if final revision changed: `packages/scripts/__snapshots__/compile-scenes.test.ts.snap`
- Modify: `docs/stories_plan/chapter_1/semantic-content-reaudit.md`
- Verify: `apps/game/e2e-tauri/production-anchors.ts`
- Verify: `apps/game/e2e-tauri/analysis-beat85.e2e.ts`
- Verify: `docs/stories_plan/chapter_1/background-variety-audit.md`

### Step 1: Semantic-audit supersession note

Add a dated note superseding only old findings for P1 tutorial duplication/partner-life share, Scene 6 breathing failure, Scene 8.5 repetitive local-sequence classification, and major-character expression coverage. Preserve historical/unrelated findings.

Do **not** claim “Scene 8.5 now has two boards”; the accepted shape is three compact, non-duplicative board actions.

### Step 2: Final tracked compiler/contentRevision recouple

Expression/audio authoring changes final corpus metadata after Task 3. Re-run the explicit live-corpus test first, then snapshot update:

```bash
bun run scenes:compile
bun run test:scripts -- packages/scripts/compile-scenes.test.ts
bun run test:scripts -- -u packages/scripts/compile-scenes.test.ts
bun run test:scripts -- packages/scripts/compile-scenes.test.ts
```

Any explicit live-corpus assertion failure must be understood and updated intentionally before `-u` is treated as sufficient.

### Step 3: Final production-anchor and opening rhythm remeasure

Re-read every `production-anchors.ts` string against current authored text. Anchors should already have moved with their cause in Tasks 1–3; Task 7 is verification, not the normal place to discover stale text.

Re-measure:

- total opening advance count and update the `N=...` comment;
- per-scene advance counts against Task 1 frozen bands;
- normal-speed elapsed time to Scene 0 (target 10–12m, max 14m);
- Aoba media bridge elapsed time (45–90s).

Keep `DIALOGUE_DRAIN_CAP = 600` unless actual measurement proves insufficient.

### Step 4: Focused static gate

```bash
bun run scenes:compile
bun run background-cues:audit --chapter chapter_1 --check-report docs/stories_plan/chapter_1/background-variety-audit.md
bun run evidence-sources:audit
bun run audio:validate docs/audio_plans/chapter_1.sound-plan.yaml
bun run audio:apply docs/audio_plans/chapter_1.sound-plan.yaml --check
bun run test:scripts -- packages/scripts/compile-scenes.test.ts
bun run --cwd apps/game test
bun run --cwd apps/game check:e2e
```

### Step 5: Build once and run the **full packaged registry**

The authored changes touch production anchors consumed by gameplay, capture-proof and persistence suites, not only `analysis-beat85`. Build once, then run all registered suites:

```bash
cd apps/game
node scripts/build-e2e.mjs
node scripts/run-save-e2e.mjs --full
cd ../..
```

This includes `production-journey`, `analysis-beat85`, `capture-proof`, `save-core`, `save-management` and the rest of the registered full surface. If the binary cannot build/launch, report `BLOCKED`; do not substitute `check:e2e` or manual playthrough.

### Step 6: Full repository verification

```bash
bun run check:scripts
bun run check
bun run test
bun run lint
bun run format:check
bun run rust:fmt
bun run rust:lint
cargo test --manifest-path apps/game/src-tauri/Cargo.toml
```

Do not add a duplicate `cargo test --all-features` gate for this content-only change; `rust:lint` already exercises all-targets/all-features clippy, while the packaged `--full` E2E is materially more relevant to authored corpus changes.

Record exact unrelated/pre-existing failures; do not silently declare success.

### Step 7: Manual Chapter 1 playthrough at normal text speed

Acceptance:

**Opening**
- P0 45–60s.
- Scene 0 begins around 10–12m, max 14m.
- P1/P1.5 still teach inspection/analysis.
- P2 reads as montage.

**First arc**
- Scene 3 fair-play evidence intact.
- Scene 5 loss lands clearly.
- Scene 6 genuinely lowers cognitive load and no longer hosts Katase's full interview.

**Late arc**
- Scene 7/8 escalate without repeated inference.
- Scene 8.5 classify uses only three unique fact cards; event ordering happens once, on `local_event_sequence`.
- Scene 9 moves quickly to Kitami.

**Final hearing**
- four movements are perceptible;
- p1's three questions on one plate do not feel visually dead;
- if they do, fallback is restoring phase split—not inventing per-question cue runtime;
- opening uses BGS/procedural silence, not victory;
- p4 is deduction climax;
- Kamiya skeptical → conceding arc visible;
- victory begins only at formal ruling.

**Ending**
- café relief precedes USB hook;
- `ZW_A16.lock` and Aoba are separated;
- media bridge 45–90s;
- Soma's Aoba reaction subtle;
- blue umbrella is final image.

**Portrait quality**
- no expression flicker;
- identity/costume/crop stable;
- no placeholder portrait;
- interrogation current-line portraits override standard subject art when authored.

### Step 8: Final diff self-review

```bash
git diff --stat main...HEAD
git diff main...HEAD -- \
  packages/scripts/compile-scenes \
  apps/game/src/lib/audio \
  apps/game/src/lib/components
```

Expected: no production parser/runtime/component change unless a separately reproduced defect was explicitly brought into scope.

Confirm exactly nine intended new portrait files and four intended new BGM files. Final working tree must be clean.

---

## Final self-review checklist

- KISS/YAGNI: no new runtime/parser/framework; `BGM: none` reuses existing silence semantics.
- Story integrity: case/procedure/fair-play/canon unchanged.
- Scene 8.5: player still earns the two classify facts; duplicate `event_184x` classify cards are gone; order cards appear only once.
- Production compiler: both explicit live-corpus `it` blocks and snapshot are recoupled; `-u` is never treated as sufficient by itself.
- Rust fixture scope: synthetic `analysis_integration_tests.rs` stays untouched.
- Background safety: exact cue report recoupled; retired p2/p3 plates documented as an explicit phase-merge tradeoff.
- Anchor safety: `production-anchors.ts` updates happen in the task that changes the referenced authored line.
- E2E safety: Task 3 runs focused `analysis-beat85`; Task 7 runs the full packaged registry, covering gameplay + persistence/capture owners.
- Rhythm safety: opening has per-scene advance bands and immediate Task 1 remeasure, plus final stopwatch check.
- Expression safety: Task 3 uses no new slugs; Task 4 defines YAML keys before authored usage.
- Audio safety: dry-run first, then exactly four `--only` generation calls.
- Single PR: story, portraits, audio, tests, audits, snapshots, anchors and verification ship together.
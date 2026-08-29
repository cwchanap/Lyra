# Chapter 1 Rhythm, Audio, and Portrait Expression Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不改變第 1 章案件答案、證據取得程序與 17-scene manifest 的前提下，收斂重複內容、重建情緒節奏、增加四首功能性 BGM，並以九張新表情立繪讓主要角色的情緒轉折可見。

**Architecture:** 保留現有 Markdown scene grammar、asset compiler、portrait asset ID、audio cue、GameplayAudioController、DialogueBox 與 InterrogationStage。所有改動落在 authored scene、`characters.yaml`、sound plan、既有 catalog、production coupling 與生成資產；不新增 runtime/framework。Scene 10 使用既有 multi-question inquiry 能力把前三段審查收成一個 phase；音樂只在既有 visual/phase/scene-tag 邊界切換。

**Tech Stack:** Markdown story scenes, YAML asset config, Lyra scene compiler, existing audio plan/apply/generate tooling, ElevenLabs, built-in OpenAI image generation/editing, PNG normalization, Svelte/Tauri existing runtime, Vitest, WDIO packaged E2E.

**Spec:** `docs/superpowers/specs/2026-08-28-chapter-1-rhythm-audio-expression-design.md`

## Global Constraints

- Deliver everything as **one PR**.
- Keep all 17 manifest scenes and their order.
- Preserve culprit, three evidence packages, required evidence/reveals, procedure gates, legal authority and fair-play physical anchors.
- Chapter 1 teaches only 摘要／本機順序／核准片段.
- Aoba may be named only in the post-case media bridge; do not reveal official reenactment, A-90, Soma's old witness role, left/right route truth, or `ZW_A16.lock` meaning.
- Keep `ZW_A16.lock` and public Aoba media as separate source chains and separate visual/dialogue frames.
- No new parser, music engine, crossfade framework, expression state machine, tutorial branch, generic asset validator, background raster set, or evidence raster regeneration.
- New portrait assets: exactly 9 transparent `768x1024` RGBA PNGs.
- New BGM assets: exactly 4 reusable loopable OGG tracks, target 45 seconds each.
- Existing `bgm_review_board_loss`, `bgm_review_board_victory`, and `bgm_chapter_close` remain; do not regenerate them unless a prompt is intentionally changed.
- Never hand-edit generated JSON under `apps/game/src-tauri/resources/**`.

---

## Task 0: Planning contract

**Files:**
- Existing: `docs/superpowers/specs/2026-08-28-chapter-1-rhythm-audio-expression-design.md`
- Existing: `docs/superpowers/plans/2026-08-28-chapter-1-rhythm-audio-expression-implementation-plan.md`

- [ ] Confirm both documents reference `docs/stories_plan/final_story_bible.md`, `docs/stories_plan/chapter_1_plan.md`, `docs/stories_plan/chapter_1/chapter.md`, and current manifest scenes.
- [ ] Treat this reviewed plan as the execution contract; do not create a second implementation framework/ticket split.

---

## Task 1: Compress the opening without changing its gameplay contracts

**Files:**
- Modify: `docs/stories_plan/chapter_1/scene_p0.md`
- Modify: `docs/stories_plan/chapter_1/investigation_scene_p1.md`
- Modify: `docs/stories_plan/chapter_1/analysis_scene_p1_5.md`
- Modify: `docs/stories_plan/chapter_1/scene_p2.md`
- Modify: `docs/stories_plan/chapter_1/investigation_scene_1.md`
- Modify: `docs/stories_plan/chapter_1/scene_2.md`
- Inspect: `apps/game/e2e-tauri/production-anchors.ts`

- [ ] **Step 1: Baseline**

```bash
bun run scenes:compile
bun run test:scripts -- packages/scripts/compile-scenes.test.ts
bun run --cwd apps/game check:e2e
bun run audio:validate docs/audio_plans/chapter_1.sound-plan.yaml
```

Record current `contentRevision`, current opening advance count, and current stale-audio diagnostics in implementation notes.

- [ ] **Step 2: P0 → 45–60 seconds**

Keep all four existing visual units and only these beats: KAGAMI is routine, one citizen trusts automatic organization, blue reflection touches transparent umbrellas, wet osmanthus atmospheric seed. Remove repeated “nobody noticed / city moved on” variants.

- [ ] **Step 3: P1 → 4–6 minutes**

Move Hayasaka into the shop before the long hotspot sequence. Preserve hotspot IDs/reveals `receipt`, `register`, `cctv`, `ledger`; keep each unique fact once; retain CCTV as plausible-but-insufficient.

- [ ] **Step 4: P1.5 → 1.5–2.5 minutes**

Keep `p1_reprint_time_board`, accepted/incorrect answers, hint and unlock. Result dialogue should establish only: receipt genuine/reprint-time, ledger fixes payment-time, CCTV supports departure, neither person fabricated the transaction.

- [ ] **Step 5: P2 → 2–3 minute montage**

Keep existing visual tags and exact seeds: cake edge, slow old clock, Masuda/osmanthus/K., Katase last-train notice, espresso/backflush, closing whiteboard, unfinished latte/clock image. Cut repeated routine replies and hard-cut into Scene 0.

- [ ] **Step 6: Scene 1/2 method-speech reduction**

Keep Soma's one explicit wrong assumption, broken coffee machine, Hayasaka's paper habit, Miyake mother/rice-ball/cake/commission stakes and legal gate. Explain access limits once.

- [ ] **Step 7: Verify this slice without invoking the stale production snapshot owner**

```bash
bun run scenes:compile
bun run background-cues:audit --chapter chapter_1
```

Dialogue trimming can renumber queue-index cue keys even when visual units/raster IDs stay the same. Do **not** run `--check-report` here; Task 3 owns the first exact cue-report recouple after the full structural cut.

Commit only these authored files.

---

## Task 2: Rebalance first investigation, defeat, and breathing beat

**Files:**
- Modify: `docs/stories_plan/chapter_1/investigation_scene_3.md`
- Modify: `docs/stories_plan/chapter_1/interrogation_scene_4.md`
- Modify: `docs/stories_plan/chapter_1/scene_5.md`
- Modify: `docs/stories_plan/chapter_1/scene_6.md`

- [ ] Move Katase's required timing statement into Scene 3 where it belongs to first-site investigation; do not duplicate it in Scene 6.
- [ ] Trim Scene 3 repeated explanation while preserving L-turn, maintenance routine, sound masking, two-coffee/K., clock, rain, and all required evidence/reveals.
- [ ] Trim Scene 4 coaching/recap while preserving all questions, contradiction targets, admissions, required/optional flags and reveals.
- [ ] Keep Scene 5's loss sharp; after the decision, exit quickly to the hallway instead of continuing case explanation.
- [ ] Rewrite Scene 6 as a real breather: food/drink, Soma admits the first hearing shook him, short relationship beat, wet umbrella-sleeve sensory trigger, decide to re-walk Rain Bell. At least half of spoken lines should be rest/relationship/emotion rather than case recap.

Verification:

```bash
bun run scenes:compile
bun run evidence-sources:audit
```

Do not run the production compile snapshot here; Task 3 closes the structural checkpoint.

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
- Modify: `packages/scripts/__snapshots__/compile-scenes.test.ts.snap`
- Modify: `apps/game/e2e-tauri/analysis-beat85.e2e.ts`
- Read-only: `docs/stories_plan/story_catalog.md`

**This task must end green before portrait/audio work begins.**

- [ ] **Step 1: Scene 7/8 deduction compression**

Keep one concise deduction per major discovery. Scene 8 keeps Takase screenshot as lead, Kurose's formal fixation, device identity, local sequence and telecom confirmation; UI carries the full `1841–1844` enumeration after first read. Identity remains blank.

- [ ] **Step 2: Scene 8.5 becomes two boards**

Delete `evidence_packages`; make `local_event_sequence` first; preserve accepted order `1841 → 1842 → 1843 → 1844`; keep `narrow_request_basis` with distinct-source constraint and objective completion.

The deleted classify board currently owns two catalog fact assertions. Preserve them; do not delete their catalog entries. `local_event_sequence` must carry:

```markdown
- **Reveals:** [assert_fact:miyake_known_lies_are_unrelated_to_murder, assert_fact:earlier_external_entry_exists, assert_fact:merge_time_is_not_event_time]
```

The intro/result dialogue must still explicitly carry the first two already-established conclusions: Miyake's known lies do not prove murder; an earlier external entry exists but has no identity yet.

Add a second intro scene tag immediately before the order board, reusing:

```text
background.chapter_1.investigation_scene_8.fixed_panel
```

This is a BGM boundary, not a new raster.

- [ ] **Step 3: Scene 9 optional-life consolidation**

Keep `other_k_name`; merge `clerk_long_day` + `clerk_thermos`; keep one memorable worn-sleeve/barley-tea beat; keep Kitami `early_shift`; remove separate `kitami_glasses` topic but retain slipping glasses as action motif; keep all required hotspots/reveals.

- [ ] **Step 4: Scene 10 → exactly four phases**

Final phase IDs:

```text
p1
gate
p4
p5
```

`p1` becomes 「把三宅移出摘要故事」 and owns `q_p1`, `q_p2`, `q_p3` in sequence. `q_p2` unlocks on `q_p1 answered`; `q_p3` unlocks on `q_p2 answered`. Delete old `p2`/`p3` wrappers and duplicated Subjects/tags. `gate` unlocks on `phase:p1 completed and objective:prepare_narrow_lock_request completed`.

Use unannotated dialogue here; Task 4 owns new expression slugs. Example:

```markdown
- **Challenge:** **相馬律**：他說的那兩個謊，我都能對上該有的東西。先看那段閉店流程。
- **On Correct:** **神谷澪**：蛋糕盒與母親通話都對得上閉店流程。是小謊，撐不起殺人指控。
```

Add one scene tag at the start of Outro before the formal ruling and reuse the existing final-hearing `p5` background. This tag becomes the victory-BGM boundary.

- [ ] **Step 5: Scene 11 → one ending curve + Aoba bridge**

Keep too-sweet latte, temporary closure/short-work bridge, clock packing, USB `ZW_A16.lock`, Amemiya source mismatch, final blue umbrella. Compress Amemiya confirmation into a short police-transfer note. Remove Soma's later physical walk back to Rain Bell.

Add the required 45–90 second media bridge: Rain Bell/KAGAMI follow-up → lawful café entrance image with umbrella edge → Mashiro says 「2016 年青葉記憶研究所火災」 → one unlabeled low-res corridor/fire frame → Soma quickly mutes → final real café/umbrella image. Minimize/close USB first; never show/confirm Aoba and `ZW_A16.lock` together.

- [ ] **Step 6: Recouple background-cue inventory**

First generate the exact inventory:

```bash
bun run scenes:compile
bun run background-cues:audit --chapter chapter_1
```

Update `background-variety-audit.md` to the exact compiler-owned cue keys. Required handling:

- add keep/B row for the second 8.5 intro tag reusing fixed-panel;
- remove stale Scene 10 p2/p3 rows;
- remap gate/p4/p5 to new phase array indices;
- add keep/B row for the Scene 10 Outro tag reusing final hearing plate;
- recouple any queue-index cue keys shifted by dialogue cuts in Tasks 1–3, preserving semantic decisions/priorities unless the visual function truly changed.

Then require exact coverage:

```bash
bun run background-cues:audit --chapter chapter_1 --check-report docs/stories_plan/chapter_1/background-variety-audit.md
```

- [ ] **Step 7: Rewrite the packaged Beat 8.5 production owner**

In `apps/game/e2e-tauri/analysis-beat85.e2e.ts`:

- start on `local_event_sequence`, not `evidence_packages`;
- remove classify-only draft/geometry assertions;
- preserve partial Order draft Save → Title → Continue restoration and pointer ordering;
- preserve Threshold invalid/valid selection and objective completion;
- preserve handoff into `interrogation_scene_10` and testimony/present journey through `p4`;
- keep existing packaged interrogation geometry/semantics checks.

- [ ] **Step 8: Recouple the production compile snapshot now**

```bash
bun run test:scripts -- -u packages/scripts/compile-scenes.test.ts
bun run test:scripts -- packages/scripts/compile-scenes.test.ts
```

Inspect the snapshot diff; it should represent only intended corpus/structure changes. Task 7 may update this snapshot again after expression/audio metadata changes, but Task 3 itself must be green.

- [ ] **Step 9: Run focused packaged E2E before commit**

```bash
cd apps/game
node scripts/build-e2e.mjs
node scripts/run-save-e2e.mjs --suite analysis-beat85
cd ../..
```

Expected: PASS through `local_event_sequence → narrow_request_basis → interrogation_scene_10 → p4`. If the E2E binary cannot be built/launched, stop and report `BLOCKED`; do not commit or call Task 3 green.

- [ ] **Step 10: Commit the closed structural slice**

Commit story files together with `background-variety-audit.md`, `compile-scenes.test.ts.snap`, and `analysis-beat85.e2e.ts`.

---

## Task 4: Add expression vocabulary and authored expression runs

**Files:**
- Modify: `static/assets/config/characters.yaml`
- Modify: Chapter 1 authored scene Markdown
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

Prompts/usage follow the design spec. Add keys to `characters.yaml` **before** introducing any corresponding `**Speaker**[slug]` authoring.

Expression-run rules: normally 2–5 consecutive spoken lines; no narration/action expression; avoid flicker; roughly ≤3 changes/character in an ordinary scene. Keep Soma `standard` during the Aoba mute beat.

Verification uses focused asset/config owners so the intentionally changed final `contentRevision` snapshot is not treated as green prematurely:

```bash
bun run scenes:compile
bun run test:scripts -- packages/scripts/compile-scenes/assets/config.test.ts packages/scripts/compile-scenes/assets/enrich.test.ts
bun run --cwd apps/game test
```

Expected: no `assetUnknownExpression`; all nine expected portrait asset IDs appear; only those nine PNGs may still be missing.

---

## Task 5: Generate nine portrait assets

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

- [ ] Inspect each corresponding `standard.png` before generation; preserve face, hair, outfit, crop, lighting and identity.
- [ ] Follow `.claude/skills/generating-lyra-image-assets/SKILL.md` and `static/assets/config/policy.yaml`.
- [ ] Generate/edit one asset at a time; expression/posture delta only.
- [ ] Normalize to `768x1024` RGBA, transparent, bottom aligned, no stretching/chroma fringe.

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

- [ ] Replace stale sound-plan sources with current manifest filenames including `investigation_scene_p1.md`, `analysis_scene_p1_5.md`, `analysis_scene_8_5.md`.
- [ ] Refresh `catalogSnapshot` from current `audio.yaml`.
- [ ] Keep existing three BGM prompts/files; revise reuse rationale/cue usage only.
- [ ] Add the four reusable tracks from the design spec, each loopable and target 45 seconds.
- [ ] Cue intentions:
  - P0: city-summary motif, not chapter-close full track;
  - P1/P1.5/office early work: casework/daylife where useful;
  - P2 ordinary Rain Bell: rain-bell daily;
  - Scene 5: existing loss track;
  - Scene 6: mostly silence/BGS;
  - Scene 7/8.5 breakthrough: breakthrough/pursuit at clean existing/new tag boundary;
  - Scene 10 intro/p1/gate: review-room BGS/procedural silence;
  - Scene 10 p4: breakthrough/pursuit;
  - Scene 10 p5: do not pre-play victory;
  - Scene 10 Outro ruling tag: existing victory track;
  - Scene 11 café: ordinary/warm state; USB/Aoba/blue-umbrella tail uses existing `bgm_chapter_close` only where earned.

Validate → apply → generate → check idempotence:

```bash
bun run audio:validate docs/audio_plans/chapter_1.sound-plan.yaml
bun run audio:apply docs/audio_plans/chapter_1.sound-plan.yaml
bun run audio:generate docs/audio_plans/chapter_1.sound-plan.yaml
bun run audio:apply docs/audio_plans/chapter_1.sound-plan.yaml --check
bun run audio:validate docs/audio_plans/chapter_1.sound-plan.yaml
bun run scenes:compile
```

Inspect OGG metadata and audition representative transitions. Do not add runtime crossfade work to fix a bad edit point; move the cue or regenerate the track.

---

## Task 7: Final recouple and complete verification

**Files:**
- Modify again if final revision changed: `packages/scripts/__snapshots__/compile-scenes.test.ts.snap`
- Modify: `apps/game/e2e-tauri/production-anchors.ts`
- Modify: `docs/stories_plan/chapter_1/semantic-content-reaudit.md`
- Verify: `apps/game/e2e-tauri/analysis-beat85.e2e.ts`
- Verify: `docs/stories_plan/chapter_1/background-variety-audit.md`

- [ ] **Step 1: Semantic-audit supersession note**

Add a dated note superseding only old findings for P1 tutorial duplication/partner-life share, Scene 6 breathing failure, Scene 8.5 repeated classification, and major-character expression coverage. Preserve historical/unrelated findings.

- [ ] **Step 2: Final `contentRevision` recouple**

Task 3 established a green structural checkpoint; expression/audio authoring changed revision afterward. Regenerate and update the snapshot again:

```bash
bun run scenes:compile
bun run test:scripts -- -u packages/scripts/compile-scenes.test.ts
bun run test:scripts -- packages/scripts/compile-scenes.test.ts
```

- [ ] **Step 3: Re-measure production dialogue drain**

Measure the existing opening journey (`scene_p0`, P1, P1.5, P2, Scene 0, Investigation Scene 1 intro) using the existing production method. Update `N=274` comment to the measured value. Keep `DIALOGUE_DRAIN_CAP = 600` unless measurement proves it insufficient. Update only intentionally changed anchored dialogue text.

- [ ] **Step 4: Focused structural/static gate**

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

- [ ] **Step 5: Final focused packaged Analysis/hearing gate**

```bash
cd apps/game
node scripts/build-e2e.mjs
node scripts/run-save-e2e.mjs --suite analysis-beat85
cd ../..
```

Expected: PASS through `local_event_sequence → narrow_request_basis → interrogation_scene_10 → p4`. If build/launch is unavailable, stop and report `BLOCKED`; do not substitute `check:e2e` or manual playthrough.

- [ ] **Step 6: Full repository verification**

```bash
bun run check:scripts
bun run check
bun run test
bun run lint
bun run format:check
bun run rust:fmt
bun run rust:lint
cargo test --manifest-path apps/game/src-tauri/Cargo.toml
cargo test --manifest-path apps/game/src-tauri/Cargo.toml --all-features
```

Record exact unrelated/pre-existing failures; do not silently declare success.

- [ ] **Step 7: Manual Chapter 1 playthrough at normal text speed**

Acceptance:

**Opening**
- P0 ~45–60s.
- Scene 0 begins around 10–12 min, hard max 14 min.
- P1/P1.5 still teach inspection/analysis.
- P2 reads as montage.

**First arc**
- Scene 3 fair-play evidence intact.
- Scene 5 loss lands clearly.
- Scene 6 genuinely lowers cognitive load and no longer hosts Katase's full interview.

**Late arc**
- Scene 7/8 escalate without repeated inference.
- Scene 8.5 has two boards and real rest.
- Scene 9 moves quickly to Kitami.

**Final hearing**
- four movements are perceptible;
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
- interrogation current-line portraits visibly override standard subject art when authored.

- [ ] **Step 8: Final diff self-review**

```bash
git diff --stat main...HEAD
git diff main...HEAD -- \
  packages/scripts/compile-scenes \
  apps/game/src/lib/audio \
  apps/game/src/lib/components
```

Expected: no production runtime/compiler changes unless a separately reproduced defect was explicitly brought into scope.

Confirm exactly nine intended new portrait files and four intended new BGM files. Final working tree must be clean.

---

## Final Self-Review

- KISS/YAGNI: no new runtime/parser/framework.
- Story integrity: case/procedure/fair-play/canon unchanged.
- Structural safety: Scene 8.5 fact assertions remain reachable after classify deletion; packaged Beat 8.5 → hearing journey stays green.
- Background safety: report is recoupled from compiler-owned exact cue inventory, including queue-index shifts and reused scene tags.
- Expression safety: Task 3 never references new slugs before Task 4 defines them.
- Audio safety: four reusable tracks, existing victory/close tracks used only at earned boundaries.
- Single PR: story, portraits, audio, snapshots, background audit, E2E recouple, semantic note and production anchor ship together.

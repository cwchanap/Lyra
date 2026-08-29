# Chapter 1 Rhythm, Audio, and Portrait Expression Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Track every step with the checkbox markers below.

**Goal:** 在不改變第 1 章案件答案、證據取得程序與 17-scene manifest 的前提下，收斂重複內容、重建情緒節奏、增加四首功能性 BGM，並以九張新表情立繪讓主要角色的情緒轉折可見。

**Architecture:** 保留現有 Markdown scene grammar、asset compiler、portrait asset ID、audio cue、GameplayAudioController、DialogueBox 與 InterrogationStage。所有改動落在 authored scene、`characters.yaml`、sound plan、既有 catalog 與生成資產；不新增 runtime/framework。Scene 10 使用現有「一個 inquiry phase 可包含多個 question」能力，把前三個審查段合併；音樂只在既有 visual/phase 邊界切換。

**Tech Stack:** Markdown story scenes, YAML asset config, Lyra scene compiler, existing audio plan/apply/generate tooling, ElevenLabs audio generation, built-in OpenAI image editing/generation, PNG normalization, Svelte/Tauri existing runtime, Vitest, WDIO production anchors.

**Spec:** `docs/superpowers/specs/2026-08-28-chapter-1-rhythm-audio-expression-design.md`

**Primary canon sources:**

- `docs/stories_plan/final_story_bible.md`
- `docs/stories_plan/chapter_1/chapter.md`
- `docs/stories_plan/chapter_1_plan.md`
- Current manifest-listed Chapter 1 authored scenes

## Global Constraints

- Deliver everything as **one PR**.
- Keep all 17 manifest scenes and their order.
- Preserve the three front-facing evidence packages and the case truth.
- Preserve all required evidence, reveals, unlocks, procedure gates, legal authority and fair-play physical anchors unless this plan explicitly moves dialogue between existing locations.
- Do not create a tutorial branch, generic rhythm framework, expression state machine, dynamic music engine, BGM crossfade implementation, new SFX cue system, or new asset validation framework.
- Do not hand-edit generated JSON under `apps/game/src-tauri/resources/**`; regenerate with `bun run scenes:compile` and leave generated resource output according to the repository's existing tracking policy.
- New portrait assets: exactly 9 PNGs, `768x1024`, RGBA, transparent.
- New audio assets: exactly 4 loopable OGG BGM files, each targeted at 45 seconds.
- No background or evidence raster regeneration in this PR.
- Chapter 1 may name 青葉 only in the required post-case media bridge. It must not reveal the official-reenactment fact, A-90, Soma's witness history, left/right route truth, or the meaning of `ZW_A16.lock`.
- Use existing `bgm_review_board_loss`, `bgm_review_board_victory`, and `bgm_chapter_close`; do not regenerate them unless an actual prompt change is intentionally approved during implementation.

---

## Task 0: Check in the approved design and implementation plan

**Files:**

- Add: `docs/superpowers/specs/2026-08-28-chapter-1-rhythm-audio-expression-design.md`
- Add: `docs/superpowers/plans/2026-08-28-chapter-1-rhythm-audio-expression-implementation-plan.md`

- [ ] **Step 1: Copy the approved artifacts into the repository**

Use the downloaded design and plan verbatim. Do not summarize them into a ticket-only description; these documents are the durable contract for the single PR.

- [ ] **Step 2: Verify source-of-truth references**

Confirm the documents point to:

```text
docs/stories_plan/final_story_bible.md
docs/stories_plan/chapter_1_plan.md
docs/stories_plan/chapter_1/chapter.md
```

and the current manifest-listed scene files.

- [ ] **Step 3: Commit the planning contract**

```bash
git add \
  docs/superpowers/specs/2026-08-28-chapter-1-rhythm-audio-expression-design.md \
  docs/superpowers/plans/2026-08-28-chapter-1-rhythm-audio-expression-implementation-plan.md
git commit -m "docs: plan chapter 1 rhythm and expression pass"
```

---

## Task 1: Establish the baseline and compress the prologue/setup

**Files:**

- Modify: `docs/stories_plan/chapter_1/scene_p0.md`
- Modify: `docs/stories_plan/chapter_1/investigation_scene_p1.md`
- Modify: `docs/stories_plan/chapter_1/analysis_scene_p1_5.md`
- Modify: `docs/stories_plan/chapter_1/scene_p2.md`
- Modify: `docs/stories_plan/chapter_1/investigation_scene_1.md`
- Modify: `docs/stories_plan/chapter_1/scene_2.md`
- Inspect: `docs/stories_plan/chapter_1/chapter.md`
- Inspect: `apps/game/e2e-tauri/production-anchors.ts`

**Interfaces:**

- Produces a 10～12 minute pre-case opening while preserving every manifest entry.
- Preserves P1's four hotspots and P1.5's existing threshold board contract.
- Preserves P2's required cake-edge, old-clock, Masuda/K., Katase/last-train, backflush and closing-board seeds.
- Does not change background cue count or asset IDs in P0/P1/P2.

- [ ] **Step 1: Record the current structural baseline**

Run:

```bash
bun run scenes:compile
bun run test:scripts -- packages/scripts/compile-scenes.test.ts
bun run --cwd apps/game check:e2e
```

Record in the implementation notes, not a new repository document:

- current compiler success/fail state
- current Chapter 1 production revision
- current measured prologue advance count from `apps/game/e2e-tauri/production-anchors.ts`
- current `audio:validate` diagnostics for the stale sound plan

Also run:

```bash
bun run audio:validate docs/audio_plans/chapter_1.sound-plan.yaml
```

Expected at baseline: the sound plan may report stale corpus paths such as old P1 / Scene 8.5 ownership. Do not repair audio yet; Task 6 owns it.

- [ ] **Step 2: Compress P0 without changing its four visual units**

In `scene_p0.md`:

1. Keep station platform, shopping-street awning, crossing, and legal-aid billboard scene tags so existing `tag_001`～`tag_004` background assets remain stable.
2. Limit each visual unit to one observation and one response at most.
3. Keep exactly these semantic beats:
   - KAGAMI public pilot has become routine.
   - one ordinary citizen thinks automatic organization may reduce wrongful accusation.
   - blue sign reflection briefly colours transparent umbrellas.
   - wet osmanthus appears as an atmospheric seed.
4. Remove repeated variants of:
   - 「沒有人多看一眼」
   - 「沒有人討論」
   - 「沒有人抬頭」
   - 「城市繼續前進」
5. Target 45～60 seconds at normal reading speed.

Run:

```bash
bun run scenes:compile
```

Expected: compile succeeds; only production content revision/count changes are deferred to Task 7.

- [ ] **Step 3: Tighten P1 while preserving all four hotspots**

In `investigation_scene_p1.md`:

1. Move Hayasaka's current arrival from P1.5 into the shop before the first hotspot or immediately after the dispute setup, so partner chemistry appears before the long evidence sequence.
2. Keep hotspot IDs and reveals unchanged:

```text
receipt
register
cctv
ledger
```

3. Keep each hotspot's unique fact, but remove the second explanation when another later line repeats it.
4. Keep CCTV as a plausible but insufficient clue.
5. Keep the proprietor and student conflict readable without turning it into a second full case.
6. Target 4～6 minutes.

Do not change evidence IDs or practice source IDs.

Run:

```bash
bun run scenes:compile
bun run test:scripts
```

- [ ] **Step 4: Tighten P1.5 result dialogue**

In `analysis_scene_p1_5.md`:

- Keep board ID `p1_reprint_time_board`.
- Keep eligible cards, accepted answer, incorrect selections, hint, and unlock behavior.
- Reduce the result to:
  1. receipt is genuine but records reprint time;
  2. ledger fixes payment time;
  3. CCTV supports departure but is not required to explain reprint;
  4. neither person fabricated the transaction.
- Remove the now-duplicated Hayasaka arrival explanation because she is already present from P1.
- Keep Hayasaka retaining a paper copy as the final character beat.
- Target 1.5～2.5 minutes.

Run:

```bash
bun run scenes:compile
```

- [ ] **Step 5: Convert P2 into a concise ordinary-day montage**

In `scene_p2.md` keep all existing visual tags and these exact seeds:

```text
cake edge registration
Takase notices the old clock running slow
Masuda orders osmanthus latte and receives loyalty-card treatment
Katase checks the last-train notification
espresso/backflush sound
closing-procedure whiteboard
unfinished latte and stopped/slow clock final image
```

Remove repeated replies that only restate a character's routine. Do not alter the old-clock identity/placement contract established by HPA-602. Target 2～3 minutes and make the last action cut directly into `scene_0.md`.

Run:

```bash
bun run scenes:compile
bun run background-cues:audit --chapter chapter_1 --check-report docs/stories_plan/chapter_1/background-variety-audit.md
```

Expected: no background cue ownership change because visual units remain stable.

- [ ] **Step 6: Remove repeated method speeches from Scene 1 and Scene 2**

In `investigation_scene_1.md`:

- Keep one opening orderliness action.
- Keep one explicit wrong assumption: 「時間、門、鏡頭，三條線都對上了。」
- Keep the broken coffee machine and Hayasaka's paper habits.
- Remove duplicate lines claiming that arranged paper cannot be wrong.

In `scene_2.md`:

- Keep Miyake's mother, rice-ball bag, cake-edge purpose, handwritten schedule copy, commission acceptance and same-day stakes.
- Keep the clerk gate and Hayasaka's legal authority.
- Explain the access boundary once in plain language: summary is available; approved clips require a concrete contradiction.
- Remove repeated versions of “you are not police / only a narrow opening / not all data.”

Run:

```bash
bun run scenes:compile
```

- [ ] **Step 7: Review and commit the opening slice**

Review:

```bash
git diff -- \
  docs/stories_plan/chapter_1/scene_p0.md \
  docs/stories_plan/chapter_1/investigation_scene_p1.md \
  docs/stories_plan/chapter_1/analysis_scene_p1_5.md \
  docs/stories_plan/chapter_1/scene_p2.md \
  docs/stories_plan/chapter_1/investigation_scene_1.md \
  docs/stories_plan/chapter_1/scene_2.md
```

Gate:

- no hotspot/reveal/evidence ID changes
- no scene tag removal or renumbering
- no early Aoba explanation
- no new terminology beyond 摘要／本機順序／核准片段

Commit:

```bash
git add \
  docs/stories_plan/chapter_1/scene_p0.md \
  docs/stories_plan/chapter_1/investigation_scene_p1.md \
  docs/stories_plan/chapter_1/analysis_scene_p1_5.md \
  docs/stories_plan/chapter_1/scene_p2.md \
  docs/stories_plan/chapter_1/investigation_scene_1.md \
  docs/stories_plan/chapter_1/scene_2.md
git commit -m "refactor: tighten chapter 1 opening rhythm"
```

---

## Task 2: Rebalance the first investigation, defeat, and breathing scene

**Files:**

- Modify: `docs/stories_plan/chapter_1/investigation_scene_3.md`
- Modify: `docs/stories_plan/chapter_1/interrogation_scene_4.md`
- Modify: `docs/stories_plan/chapter_1/scene_5.md`
- Modify: `docs/stories_plan/chapter_1/scene_6.md`

**Interfaces:**

- Keeps Scene 3 evidence sources, hotspot IDs, scene geometry and baked-character layout unchanged.
- Keeps Scene 4 question IDs and contradiction wiring unchanged.
- Keeps first-hearing loss result unchanged.
- Makes Scene 6 a real pause without creating a new scene or board.

- [ ] **Step 1: Move Katase's timing clarification into Scene 3**

In the existing Katase character block in `investigation_scene_3.md`, add or revise one topic so it contains the only complete version of:

```text
Katase remembers time by the last train and ordinary closing routine.
She did not watch a clock and is estimating, not lying.
```

Reuse the current character and sublocation; do not add a witness, evidence item or reveal. The topic remains optional/contextual and must not become a proof-order requirement.

- [ ] **Step 2: Trim Scene 3 duplicate clue explanations**

For each required evidence source, keep:

1. the observable object/action;
2. one concise inference;
3. Hayasaka/another character's limit when needed.

Remove extra restatements after collection. Preserve:

- two-coffee order and `K.`
- closing playback/routine
- duty and doorlock summary
- L-shaped sightline
- blue umbrella and osmanthus as untouched atmosphere
- maintenance checklist seeds
- transition to Miyake questioning

Run:

```bash
bun run scenes:compile
bun run evidence-sources:audit
```

- [ ] **Step 3: Tighten Scene 4 without changing the cross-examination contract**

In `interrogation_scene_4.md`:

- Keep questions `q_whereabouts`, `q_backroom`, `q_inner_storage`, `q_masuda` and all required/optional flags.
- Keep `closing_routine` and `cctv_screenshot` contradiction targets.
- Keep the two admissions and their reveals.
- Remove repeated pre-question coaching and repeated end recap.
- Preserve the conclusion: small lies explain pressure but do not yet defeat the summary.

Run:

```bash
bun run scenes:compile
bun run test:scripts
```

- [ ] **Step 4: Keep Scene 5 sharp and stop immediately after the loss**

In `scene_5.md`:

- Preserve every argument needed to establish why the summary wins.
- Keep Kamiya's “attitude is not evidence” position.
- Keep the low-weight external contractor item.
- Keep Kamiya's source-comparison notes, Kitami cameo and Kurose's demand for fixed evidence.
- Remove any duplicate explanation of the same loss after the hallway transition.
- End with one forward motion: return to the physical scene.

Run:

```bash
bun run scenes:compile
```

- [ ] **Step 5: Rewrite Scene 6 as a breathing beat**

Keep the existing scene tags/background assets stable. Use the existing Katase visual tag, but change the action so she only hurries past, acknowledges the pair and does not stop for questioning.

Required spoken sequence:

1. Hayasaka buys coffee and asks what Soma ate.
2. One short shared-work-history exchange.
3. Soma admits he was trying to argue from “he does not look like a killer” because he panicked.
4. Hayasaka responds as partner, not lecturer.
5. At most one concise sorting instruction separates testimony / objects / summary.
6. A passerby throws away a wet umbrella sleeve.
7. Katase passes silently or with one greeting.
8. Soma decides to re-walk Rain Bell.

Delete the full Katase timing interview from this scene because Task 2 Step 1 owns it.

Manual line-classification gate:

- at least 50% of spoken lines are rest, food, work history, partnership or emotion;
- no more than 25% are direct evidence recap;
- the remaining lines may trigger the next investigation.

Run:

```bash
bun run scenes:compile
```

- [ ] **Step 6: Review and commit the first-half slice**

Review the diff and confirm no evidence source or interrogation wiring changed:

```bash
git diff -- \
  docs/stories_plan/chapter_1/investigation_scene_3.md \
  docs/stories_plan/chapter_1/interrogation_scene_4.md \
  docs/stories_plan/chapter_1/scene_5.md \
  docs/stories_plan/chapter_1/scene_6.md
```

Commit:

```bash
git add \
  docs/stories_plan/chapter_1/investigation_scene_3.md \
  docs/stories_plan/chapter_1/interrogation_scene_4.md \
  docs/stories_plan/chapter_1/scene_5.md \
  docs/stories_plan/chapter_1/scene_6.md
git commit -m "refactor: restore chapter 1 breathing and escalation"
```

---

## Task 3: Simplify the late investigation and rebuild the ending curve

**Files:**

- Modify: `docs/stories_plan/chapter_1/investigation_scene_7.md`
- Modify: `docs/stories_plan/chapter_1/investigation_scene_8.md`
- Modify: `docs/stories_plan/chapter_1/analysis_scene_8_5.md`
- Modify: `docs/stories_plan/chapter_1/investigation_scene_9.md`
- Modify: `docs/stories_plan/chapter_1/interrogation_scene_10.md`
- Modify: `docs/stories_plan/chapter_1/scene_11.md`

**Interfaces:**

- Preserves Scene 7's two replay facts and all required evidence reveals.
- Preserves the local sequence and limited-request proof requirements.
- Reduces Scene 8.5 from three boards to two.
- Reuses interrogation multi-question phase support to produce four major hearing movements.
- Adds the V3.8 Aoba media bridge without adding a manifest scene or new background asset.

- [ ] **Step 1: Remove duplicate deductions from Scene 7**

Keep all existing evidence/reveal IDs and physical anchors. For each major discovery, retain one concise deduction:

- water trace / Amemiya thumbnail
- wet umbrella sleeve as later context, not identity proof
- Miyake 23:06 blocked sightline
- Takase 23:20 discovery sightline
- victim phone notification / clock impact / forensic range
- backflush misheard thud

Do not let characters repeat “someone entered earlier” after every item.

Run:

```bash
bun run scenes:compile
bun run evidence-sources:audit
```

- [ ] **Step 2: Shorten Scene 8's spoken event enumeration**

In `investigation_scene_8.md`:

- Keep Takase's screenshot as lead.
- Keep Kurose refusing to accept the screenshot itself.
- Keep the forensic fixation, device identity, local event sequence and telecom confirmation.
- Let the panel/analysis UI carry the full `1841～1844` sequence after the first read; do not verbally enumerate it multiple times.
- Keep the conclusion at third-party level; do not name Kitami here.

Run:

```bash
bun run scenes:compile
```

- [ ] **Step 3: Remove the redundant classification board from Scene 8.5**

In `analysis_scene_8_5.md`:

1. Delete board `evidence_packages` and its cards/groups/result dialogue.
2. Make `local_event_sequence` the first board and remove its old unlock dependency on `evidence_packages`.
3. Keep accepted order:

```text
event_1841
event_1842
event_1843
event_1844
```

4. Keep `narrow_request_basis`, its distinct-source constraint, incorrect selection, hint and objective completion.
5. Rewrite intro so Soma sits, drinks water and admits he prematurely called the external credential “the killer.”
6. After the water/biscuit pause and immediately before `local_event_sequence`, add a second scene tag that reuses the existing fixed-panel background instead of creating a raster:

```markdown
[場景：同一張保全鏈固定桌。相馬把水瓶放下，將四張事件卡排開。]
- **Background Prompt:** Same Rain Bell fixed-panel evidence table after a brief rest, open maintenance panel and four local-event cards under the same work lamp, dark shelves and rain-streaked window unchanged, no readable text.
- **Background Asset ID:** background.chapter_1.investigation_scene_8.fixed_panel
```

This becomes the clean BGM boundary used by Task 6.
7. Keep the identity blank through the outro.
8. Keep the biscuit/water partnership beat, but avoid another complete recap after the second board.

Run:

```bash
bun run scenes:compile
bun run test:scripts -- packages/scripts/compile-scenes.test.ts
```

Expected: analysis board count and content revision change; snapshot update remains deferred to Task 7.

- [ ] **Step 4: Consolidate Scene 9 optional life material**

In `investigation_scene_9.md`:

- Keep `other_k_name` because it closes a fair-play dead end.
- Merge `clerk_long_day` and `clerk_thermos` into one topic; retain the worn sleeve and cheap barley-tea detail.
- Keep Kitami's `early_shift` topic and eight-year contract reset detail.
- Remove the separate `kitami_glasses` topic; keep slipping glasses as recurring action in denial/pressure dialogue.
- Keep every required hotspot and evidence reveal unchanged.
- Trim Outro to one chain statement plus “buyer remains unanswered.”

Run:

```bash
bun run scenes:compile
bun run evidence-sources:audit
```

- [ ] **Step 5: Merge Scene 10's first three phases into one multi-question phase**

In `interrogation_scene_10.md`:

1. Keep phase ID `p1`, relabel it to 「把三宅移出摘要故事」.
2. Move questions `q_p2` and `q_p3` under the same `p1` Subject block after `q_p1`.
3. Set:

```markdown
### Question: 死亡時間 {#q_p2}
- **Status:** locked
- **Required:** true
- **Unlock:** question:q_p1 answered
```

and:

```markdown
### Question: 更早進場的人 {#q_p3}
- **Status:** locked
- **Required:** true
- **Unlock:** question:q_p2 answered
```

4. Delete the old phase wrappers `p2` and `p3`, including their duplicated Subject blocks and phase-level scene tags.
5. Replace each moved question's single-line `On Correct` with Kamiya's concise concession, because the interrogation grammar stores `On Correct` as one authored dialogue line. Keep Soma's evidence claim in `Challenge`. Use this shape:

```markdown
- **Challenge:** **相馬律**[determined]：他說的那兩個謊，我都能對上該有的東西。先看那段閉店流程。
- **On Correct:** **神谷澪**[conceding]：蛋糕盒與母親通話都對得上閉店流程。是小謊，撐不起殺人指控。
```

Apply the same one-line concession pattern to `q_p2` and `q_p3`; do not try to author two speakers inside one `On Correct` metadata field.
6. Change `gate` unlock to:

```markdown
- **Unlock:** phase:p1 completed and objective:prepare_narrow_lock_request completed
```

7. Keep `gate`, `p4`, `p5`, evidence manifest and final ruling logic.
8. Add one scene tag at the start of Outro immediately before Kamiya's formal ruling, explicitly reusing the `p5` hearing background so no new raster is requested:

```markdown
[場景：同一座 KAGAMI 審查會場。神谷把摘要闔上，正式裁定前，桌上的證據鏈仍保持原位。]
- **Background Prompt:** Same final KAGAMI review-hearing table and evidence chain at the moment of formal ruling, work order, credential, memo and draft remaining in place, restrained daylight, no readable text.
- **Background Asset ID:** background.chapter_1.interrogation_scene_10.p5
```

This scene tag becomes the victory-BGM cue boundary in Task 6.

After editing, the file must expose exactly four phases:

```text
p1
gate
p4
p5
```

Run:

```bash
bun run scenes:compile
bun run test:scripts
bun run --cwd apps/game test
```

- [ ] **Step 6: Rebuild Scene 11 as one ending chain and add the Aoba bridge**

In `scene_11.md`:

Keep:

- Miyake returning to Rain Bell
- too-sweet osmanthus latte
- Takase's temporary closure / Miyake short-work bridge
- clock packing
- USB insertion and `ZW_A16.lock`
- Amemiya source not matching Kitami
- final blue umbrella

Change:

1. Replace the full Hayasaka phone-call recap about Amemiya with a short police-transfer note beside the laptop:

```text
Kitami phone / computer / contractor account: no source match.
```

The prose may paraphrase this; do not make it readable UI text in the background prompt.

2. Use the existing later-office visual unit for the local-news continuation instead of adding a new background asset.
3. Before the news starts, have Soma minimize or close the USB window.
4. Add the 45～90 second media bridge:
   - KAGAMI/Rain Bell follow-up report;
   - public café entrance image with umbrella stand edge;
   - Kisaragi Mashiro preview explicitly says 「2016 年青葉記憶研究所火災」;
   - one low-resolution corridor/fire frame with no source label;
   - Soma mutes it quickly and says only that today's case is finished;
   - Hayasaka notices but does not extract an answer.
5. Remove Soma's later physical walk back to Rain Bell. The final transition goes from the public news frame to the real dark café exterior/umbrella stand already represented by existing final visual units.
6. Keep `ZW_A16.lock` and Aoba title out of the same visual/dialogue frame.

Run:

```bash
bun run scenes:compile
```

Manual canon gate:

- Chapter 1 names Aoba but does not say “official reenactment.”
- `A16 = Aoba_2016` is not confirmed.
- Soma's reaction remains low intensity.
- public blue-umbrella source exists for Chapter 2 social-media recall.

- [ ] **Step 7: Review and commit the late-arc slice**

Review:

```bash
git diff -- \
  docs/stories_plan/chapter_1/investigation_scene_7.md \
  docs/stories_plan/chapter_1/investigation_scene_8.md \
  docs/stories_plan/chapter_1/analysis_scene_8_5.md \
  docs/stories_plan/chapter_1/investigation_scene_9.md \
  docs/stories_plan/chapter_1/interrogation_scene_10.md \
  docs/stories_plan/chapter_1/scene_11.md
```

Confirm:

- exactly two analysis boards remain in Scene 8.5
- exactly four interrogation phases remain in Scene 10
- no evidence/reveal IDs were accidentally dropped
- no new background assets are requested
- Aoba bridge obeys the V3.8 source-separation contract

Commit:

```bash
git add \
  docs/stories_plan/chapter_1/investigation_scene_7.md \
  docs/stories_plan/chapter_1/investigation_scene_8.md \
  docs/stories_plan/chapter_1/analysis_scene_8_5.md \
  docs/stories_plan/chapter_1/investigation_scene_9.md \
  docs/stories_plan/chapter_1/interrogation_scene_10.md \
  docs/stories_plan/chapter_1/scene_11.md
git commit -m "refactor: simplify chapter 1 late-game rhythm"
```

---

## Task 4: Add the expression vocabulary and annotate emotional turns

**Files:**

- Modify: `static/assets/config/characters.yaml`
- Modify: the Chapter 1 scene Markdown files touched in Tasks 1～3
- Inspect: `packages/scripts/compile-scenes/tokenizer.ts`
- Inspect: `packages/scripts/compile-scenes/assets/enrich.ts`
- Inspect: `apps/game/src/lib/components/DialogueBox.svelte`
- Inspect: `apps/game/src/lib/components/InterrogationStage.svelte`

**Interfaces:**

- Adds exactly 9 snake_case expression IDs.
- Produces expected asset IDs `portrait.<character>.<expression>` through existing compiler behavior.
- Does not change parser/runtime code.

- [ ] **Step 1: Add the nine expression configs**

Patch `static/assets/config/characters.yaml` under each existing character's `expressions:` mapping. Each new slug must align with that character's existing `standard:` / `stern:` key, and each `prompt:` is nested one level beneath the slug:

```yaml
# soma_ritsu
determined:
  prompt: quietly determined analytical expression, brows drawn, eyes locked on the problem, controlled resolve without aggression
shaken:
  prompt: controlled shaken expression, breath held, eyes briefly unfocused, trying to recover composure without melodrama
relieved:
  prompt: subtle relieved expression, gaze softened, small tired smile, shoulders easing

# hayasaka_akane
softened:
  prompt: briefly softened supportive expression, restrained warmth, professional composure still intact

# miyake_sota
relieved:
  prompt: tentative relieved expression, shoulders finally easing, small nervous smile

# kamiya_mio
skeptical:
  prompt: cool skeptical expression, one brow slightly tightened, precise guarded scrutiny
conceding:
  prompt: controlled conceding expression, tension easing slightly, serious acceptance without warmth or defeat

# kitami_shuichi
defensive:
  prompt: guarded defensive expression, jaw tight, eyes avoiding direct contact, anxiety under restraint
cornered:
  prompt: cornered anxious expression, glasses slipping, face strained, composure visibly thinning without theatrical rage
```

Do not remove or rename existing expression IDs.

- [ ] **Step 2: Annotate expression runs scene by scene**

Use explicit Markdown syntax, for example:

```markdown
**相馬律**[determined]：這行時間，我再讀一次。
**相馬律**[determined]：紀錄沒造假，錯的是讀法。
```

Apply the design map:

- P1/P1.5: Soma determined, stationery owner flustered, Hayasaka softened.
- Scene 1/2: determined Soma; softened/stern Hayasaka; existing strained mother.
- Scene 3: existing tired Takase; determined Soma on true clue turns.
- Scene 4: existing strained Miyake on both admissions; determined Soma on successful challenges.
- Scene 5: skeptical Kamiya; shaken Soma after loss; softened Hayasaka on recovery.
- Scene 6: shaken Soma before admitting panic, determined at decision; softened Hayasaka during care.
- Scene 7～8.5: determined Soma during connected deductions; stern Hayasaka when preventing overclaim; softened during water/biscuit rest.
- Scene 9: defensive Kitami before the draft chain lands; cornered from 「他不該把那份草稿留下」 through night-pressure admission.
- Scene 10: skeptical Kamiya for claims/challenges, conceding for each accepted step and final ruling; determined Soma for proof runs; relieved after ruling.
- Scene 11: relieved Miyake/Soma, softened Hayasaka. Keep Soma standard during Aoba mute action.

Expression-run rules:

- mark every spoken line in a consecutive emotional run;
- normally keep a run 2～5 lines;
- do not switch expression on narration/action;
- do not use a missing/no-portrait speaker expression;
- avoid more than approximately three expression changes per character in one ordinary scene.

- [ ] **Step 3: Compile and validate expression ownership**

Run:

```bash
bun run scenes:compile
bun run test:scripts
bun run --cwd apps/game test
```

Expected before Task 5 art generation:

- no `assetUnknownExpression` errors;
- compiler manifest contains all 9 new portrait asset IDs;
- missing-file warnings are acceptable only for the 9 planned PNGs;
- no parser/runtime source diff exists.

- [ ] **Step 4: Review and commit config/authoring**

Inspect generated manifest entries or compile output to confirm exact IDs:

```text
portrait.soma_ritsu.determined
portrait.soma_ritsu.shaken
portrait.soma_ritsu.relieved
portrait.hayasaka_akane.softened
portrait.miyake_sota.relieved
portrait.kamiya_mio.skeptical
portrait.kamiya_mio.conceding
portrait.kitami_shuichi.defensive
portrait.kitami_shuichi.cornered
```

Commit authored/config changes; do not claim portrait completion yet:

```bash
git add static/assets/config/characters.yaml docs/stories_plan/chapter_1
git commit -m "feat: author chapter 1 portrait expression beats"
```

---

## Task 5: Generate and verify the nine portrait assets

**Files:**

- Add: `static/assets/portraits/soma_ritsu/determined.png`
- Add: `static/assets/portraits/soma_ritsu/shaken.png`
- Add: `static/assets/portraits/soma_ritsu/relieved.png`
- Add: `static/assets/portraits/hayasaka_akane/softened.png`
- Add: `static/assets/portraits/miyake_sota/relieved.png`
- Add: `static/assets/portraits/kamiya_mio/skeptical.png`
- Add: `static/assets/portraits/kamiya_mio/conceding.png`
- Add: `static/assets/portraits/kitami_shuichi/defensive.png`
- Add: `static/assets/portraits/kitami_shuichi/cornered.png`
- Inspect: each corresponding `standard.png`
- Read: `static/assets/config/policy.yaml`
- Follow: `.claude/skills/generating-lyra-image-assets/SKILL.md`

**Interfaces:**

- Consumes the exact compiler-generated portrait asset IDs and prompts.
- Produces identity-consistent transparent PNGs at policy dimensions.

- [ ] **Step 1: Inspect the five standard identities before generation**

Open together:

```text
static/assets/portraits/soma_ritsu/standard.png
static/assets/portraits/hayasaka_akane/standard.png
static/assets/portraits/miyake_sota/standard.png
static/assets/portraits/kamiya_mio/standard.png
static/assets/portraits/kitami_shuichi/standard.png
```

For each character, record in implementation notes:

- face shape
- hair silhouette
- outfit and accessories
- body crop / bottom alignment
- lighting direction
- expression-only delta required

Do not change costume, age, hairstyle, camera angle or overall pose unless a tiny pose adjustment is necessary to convey the expression.

- [ ] **Step 2: Generate/edit one asset at a time**

Use built-in OpenAI image editing/generation, treating each existing `standard.png` as the identity reference. Include:

```text
use case illustration-story
vertical 3:4 portrait
transparent output workflow
same character identity, clothing, hairstyle, crop and lighting as the supplied standard portrait
change only the requested facial expression and minimal posture cues
no text, no logo, no watermark
```

Follow the exact expression prompts from Task 4.

- [ ] **Step 3: Normalize every PNG**

For each output:

- remove chroma key / preserve alpha according to the repo skill;
- fit without non-uniform stretching;
- bottom-align subject on `768x1024` RGBA canvas;
- preserve transparent corners;
- inspect face and hand edges for chroma fringe.

- [ ] **Step 4: Verify metadata and scene compiler coverage**

Run:

```bash
file -b \
  static/assets/portraits/soma_ritsu/determined.png \
  static/assets/portraits/soma_ritsu/shaken.png \
  static/assets/portraits/soma_ritsu/relieved.png \
  static/assets/portraits/hayasaka_akane/softened.png \
  static/assets/portraits/miyake_sota/relieved.png \
  static/assets/portraits/kamiya_mio/skeptical.png \
  static/assets/portraits/kamiya_mio/conceding.png \
  static/assets/portraits/kitami_shuichi/defensive.png \
  static/assets/portraits/kitami_shuichi/cornered.png
bun run scenes:compile
```

Expected:

- all report `768 x 1024` and RGBA;
- no missing portrait warnings for the 9 IDs;
- no unrelated asset files changed.

- [ ] **Step 5: Run focused portrait UI tests and manually inspect transitions**

```bash
bun run --cwd apps/game test
bun run --cwd apps/game check
```

Manual checkpoints:

- Scene 5: Kamiya skeptical → Soma shaken → Hayasaka softened.
- Scene 9: Kitami standard/defensive → cornered.
- Scene 10: Kamiya skeptical → conceding without stage portrait disappearing.
- Scene 11: Miyake strained history is visually distinct from relieved ending.

- [ ] **Step 6: Commit portrait assets**

```bash
git add static/assets/portraits
git commit -m "feat: add chapter 1 portrait expression assets"
```

---

## Task 6: Rebuild the Chapter 1 sound plan and generate four BGM tracks

**Files:**

- Modify: `docs/audio_plans/chapter_1.sound-plan.yaml`
- Modify: `static/assets/config/audio.yaml` via `audio:apply`
- Modify: Chapter 1 scene Markdown via `audio:apply`
- Add: `static/assets/audio/bgm/bgm_city_summary_motif.ogg`
- Add: `static/assets/audio/bgm/bgm_casework_day.ogg`
- Add: `static/assets/audio/bgm/bgm_rain_bell_daily.ogg`
- Add: `static/assets/audio/bgm/bgm_breakthrough_pursuit.ogg`
- Follow: `.claude/skills/designing-lyra-sound-assets/SKILL.md`

**Interfaces:**

- Replaces stale sound-plan source paths with current manifest ownership.
- Adds four approved/generated BGM entries.
- Applies only BGM/BGS cues; no SFX cue authoring.
- Uses existing runtime loop switching.

- [ ] **Step 1: Repair sources and catalog snapshot**

In `chapter_1.sound-plan.yaml`:

1. Replace stale `scene_p1.md` with:

```text
docs/stories_plan/chapter_1/investigation_scene_p1.md
docs/stories_plan/chapter_1/analysis_scene_p1_5.md
```

2. Replace stale `scene_8_5.md` with:

```text
docs/stories_plan/chapter_1/analysis_scene_8_5.md
```

3. Replace the empty snapshot with the exact pre-change catalog IDs:

```yaml
catalogSnapshot:
  bgm:
    - bgm_chapter_close
    - bgm_review_board_loss
    - bgm_review_board_victory
  bgs:
    - bgs_cafe_afternoon_after_rain
    - bgs_cafe_backroom_corridor
    - bgs_cafe_backroom_office
    - bgs_cafe_closed_night
    - bgs_contractor_office_day
    - bgs_detective_office_night
    - bgs_detective_office_rain
    - bgs_institutional_corridor
    - bgs_interview_room_fluorescent
    - bgs_law_office_quiet
    - bgs_police_station_late_night
    - bgs_review_board_room
    - bgs_shopping_street_rain_dusk
    - bgs_shopping_street_rain_night
    - bgs_stationery_copy_shop
  sfx:
    - sfx_anonymous_message_buzz
    - sfx_coffee_machine_backflush
    - sfx_dialogue_proceed_tick
    - sfx_rice_ball_bag_crinkle
    - sfx_usb_insert_chime
```

If the catalog has changed on the implementation branch, stop and reconcile that real delta rather than silently overwriting it.
4. Preserve existing BGS/SFX entries and their generation provenance.

- [ ] **Step 2: Add the four approved BGM entries**

Add entries with:

```yaml
channel: bgm
status: approved
loop: true
intendedDurationSeconds: 45
```

Use the exact prompts from the design spec:

```text
bgm_city_summary_motif
bgm_casework_day
bgm_rain_bell_daily
bgm_breakthrough_pursuit
```

Evidence must cite real post-rhythm scene lines from the edited files. Do not invent line numbers before the edits settle; inspect the final files and use their actual line positions.

- [ ] **Step 3: Revise existing BGM reuse rationales without changing prompts**

- `bgm_review_board_loss`: keep its existing first-hearing-loss purpose and prompt unchanged.
- `bgm_review_board_victory`: document that it begins only after the final ruling.
- `bgm_chapter_close`: remove the old prologue/P1/P2 bookend rationale; reserve it for USB/Aoba/blue-umbrella close.

Do not modify the existing prompts unless listening review proves an actual mismatch; changing prompts would trigger regeneration of already-generated assets.

- [ ] **Step 4: Author the cue matrix**

Apply these cue intentions using the actual visual units after Task 3:

| File / unit | BGM |
|---|---|
| `scene_p0.md` first visual | `bgm_city_summary_motif` |
| `investigation_scene_p1.md` first visual | `bgm_casework_day` |
| `analysis_scene_p1_5.md` intro visual | `bgm_casework_day` |
| `scene_p2.md` first visual | `bgm_rain_bell_daily` |
| `scene_0.md` first visual | `none` |
| `investigation_scene_1.md` first visual/office | `bgm_casework_day` |
| `scene_2.md` first visual | `none` |
| `investigation_scene_3.md` front | `bgm_rain_bell_daily` |
| `investigation_scene_3.md` corridor | `none` |
| `scene_5.md` hearing | `bgm_review_board_loss` |
| `scene_6.md` first visual | `none` |
| `investigation_scene_7.md` inner | `bgm_breakthrough_pursuit` |
| `investigation_scene_8.md` first visual | `bgm_breakthrough_pursuit` |
| `analysis_scene_8_5.md` resting intro | `none` |
| `analysis_scene_8_5.md` second intro scene tag (`tag_002`, reused fixed-panel asset) | `bgm_breakthrough_pursuit` |
| `investigation_scene_9.md` first visual/window | `none` |
| `investigation_scene_9.md` `confront_kitami` | `bgm_breakthrough_pursuit` |
| `interrogation_scene_10.md` intro/`p1`/`gate` | `none` |
| `interrogation_scene_10.md` `p4`/`p5` | `bgm_breakthrough_pursuit` |
| `interrogation_scene_10.md` ruling scene tag in Outro (`tag_002`, reused `p5` asset) | `bgm_review_board_victory` |
| `scene_11.md` café opening | `bgm_rain_bell_daily` |
| `scene_11.md` USB office transition onward | `bgm_chapter_close` |

Keep each unit's existing BGS unless the design explicitly requires silence/continuity. `none` only silences BGM, not BGS.

- [ ] **Step 5: Validate before applying**

```bash
bun run audio:validate docs/audio_plans/chapter_1.sound-plan.yaml
bun run audio:generate docs/audio_plans/chapter_1.sound-plan.yaml --dry-run
```

Expected dry-run targets: exactly the four new BGM OGG paths. Existing generated BGM must not be scheduled unless their prompts drifted unintentionally.

- [ ] **Step 6: Apply catalog/cues, generate audio, and re-check idempotence**

```bash
bun run audio:apply docs/audio_plans/chapter_1.sound-plan.yaml
bun run audio:generate docs/audio_plans/chapter_1.sound-plan.yaml
bun run audio:apply docs/audio_plans/chapter_1.sound-plan.yaml --check
bun run audio:validate docs/audio_plans/chapter_1.sound-plan.yaml
bun run scenes:compile
```

Expected:

- plan generation metadata is written back;
- four OGG files exist;
- catalog contains four new BGM IDs;
- every cue references a current manifest file/unit;
- no missing audio warning remains.

- [ ] **Step 7: Inspect loop/audio metadata and audition representative transitions**

Run available metadata inspection, for example:

```bash
file -b \
  static/assets/audio/bgm/bgm_city_summary_motif.ogg \
  static/assets/audio/bgm/bgm_casework_day.ogg \
  static/assets/audio/bgm/bgm_rain_bell_daily.ogg \
  static/assets/audio/bgm/bgm_breakthrough_pursuit.ogg
```

Use `ffprobe` if available to confirm non-zero duration and roughly 45 seconds. Audition:

- P0 → Scene 0 silence
- P2 → Scene 0 hard contrast
- Scene 3 front → corridor silence
- Scene 6 silence → Scene 7 breakthrough
- Scene 10 procedural silence → p4 breakthrough → ruling victory
- Scene 11 café → USB chapter close

Do not add runtime crossfade work to compensate for a bad edit point; move the cue to a cleaner existing boundary or regenerate the track with a cleaner loop.

- [ ] **Step 8: Commit audio plan, cues, catalog and files**

```bash
git add \
  docs/audio_plans/chapter_1.sound-plan.yaml \
  static/assets/config/audio.yaml \
  static/assets/audio/bgm \
  docs/stories_plan/chapter_1
git commit -m "feat: expand chapter 1 music progression"
```

---

## Task 7: Update production coupling and run the complete verification gate

**Files:**

- Modify: `packages/scripts/__snapshots__/compile-scenes.test.ts.snap`
- Modify: `apps/game/e2e-tauri/production-anchors.ts`
- Modify: `docs/stories_plan/chapter_1/semantic-content-reaudit.md`
- Modify only if tests prove necessary: existing focused test fixtures/anchors that intentionally assert changed authored copy
- Do not modify runtime solely to make tests pass.

**Interfaces:**

- Couples production tests to the final authored corpus revision and new dialogue count.
- Verifies scene parsing, assets, audio, unit UI and E2E TypeScript contracts.

- [ ] **Step 1: Add a narrow supersession note to the semantic audit**

At the top of `docs/stories_plan/chapter_1/semantic-content-reaudit.md`, add a dated note stating that the 2026-08-28 rhythm/audio/expression pass supersedes only the old findings about:

- P1 partner-life share and duplicate tutorial explanation;
- Scene 6 not functioning as a true breathing beat;
- Scene 8.5 being dominated by repeated case classification;
- Chapter 1 major-character portrait expression coverage.

Retain the historical findings and all unrelated continuity/canon findings. Do not recalculate the old report in this PR.

- [ ] **Step 2: Regenerate final compiler output and inspect all changed coupling**

```bash
bun run scenes:compile
git status --short
```

Update the compile snapshot to the final `contentRevision` through the repository's normal snapshot update workflow. Do not hand-edit generated scene JSON.

- [ ] **Step 3: Re-measure the production dialogue drain anchor**

Use the existing production/E2E measurement method to count advances from:

```text
scene_p0
investigation_scene_p1
analysis_scene_p1_5
scene_p2
scene_0
investigation_scene_1 intro
```

Update the comment in `apps/game/e2e-tauri/production-anchors.ts` from the old `N=274` to the measured final value. Keep `DIALOGUE_DRAIN_CAP = 600` unless the measured count proves the current cap cannot cover typewriter double-click behavior.

If any anchored dialogue text was intentionally removed, update only the corresponding anchor to a semantically stable surviving line; do not restore redundant prose for E2E convenience.

- [ ] **Step 4: Run focused structural verification**

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

- [ ] **Step 5: Run full repository verification**

```bash
bun run check:scripts
bun run check
bun run test
bun run lint
bun run format:check
bun run rust:fmt
bun run rust:lint
```

If a failure is unrelated and pre-existing, record the exact command/output and verify the touched scope separately. Do not silently declare success.

- [ ] **Step 6: Perform the Chapter 1 manual rhythm/audio/expression playthrough**

Use normal text speed, not skip mode. Record observed approximate duration and pass/fail for:

### Opening

- P0 is under approximately one minute.
- Scene 0 begins within approximately 10～12 minutes and never later than 14 minutes.
- P1 still teaches inspection and P1.5 still teaches analysis.
- P2 feels like montage rather than another case.

### First arc

- Scene 3 retains fair-play evidence.
- Scene 5 loss is emotionally clear.
- Scene 6 genuinely lowers cognitive load.
- Katase no longer opens a witness interview inside the pause.

### Late arc

- Scene 7/8 discoveries escalate without repeating every inference.
- Scene 8.5 has two boards and begins with actual rest.
- Scene 9 moves quickly from contractor chain to Kitami.

### Final hearing

- four movements are perceptible;
- the beginning uses only review-room BGS and procedural silence;
- victory BGM is absent at the beginning;
- `p4` feels like the main deduction climax;
- Kamiya's skeptical → conceding portrait arc is visible;
- ruling switches to victory only after the chain is accepted.

### Ending

- café relief lands before the USB hook;
- `ZW_A16.lock` and Aoba title are separated;
- media bridge lasts 45～90 seconds;
- Soma's Aoba reaction remains subtle;
- the blue umbrella is the single final image.

### Portrait quality

- no expression flicker on consecutive lines;
- identity/costume/crop stays stable across variants;
- no missing portrait placeholder appears;
- InterrogationStage subject art follows current-line expressions.

- [ ] **Step 7: Self-review the final diff against scope**

Run:

```bash
git diff --stat main...HEAD
git diff main...HEAD -- \
  packages/scripts/compile-scenes \
  apps/game/src/lib/audio \
  apps/game/src/lib/components
```

Expected for the second command: no production runtime/compiler changes, unless a genuine defect was independently found, demonstrated by a failing test, and explicitly added to this PR scope before implementation continued.

Check exact asset counts:

```bash
find static/assets/portraits/soma_ritsu static/assets/portraits/hayasaka_akane \
  static/assets/portraits/miyake_sota static/assets/portraits/kamiya_mio \
  static/assets/portraits/kitami_shuichi -maxdepth 1 -type f -name '*.png' | sort

find static/assets/audio/bgm -maxdepth 1 -type f -name 'bgm_*.ogg' | sort
```

Confirm exactly nine intended new portrait files and four intended new BGM files appear in the PR.

- [ ] **Step 8: Final commit and PR-ready state**

```bash
git add \
  packages/scripts/__snapshots__/compile-scenes.test.ts.snap \
  apps/game/e2e-tauri/production-anchors.ts \
  docs/stories_plan/chapter_1/semantic-content-reaudit.md
git commit -m "test: recouple chapter 1 production corpus"
```

Then verify:

```bash
git status --short
```

Expected: clean working tree. The PR description should summarize:

- rhythm cuts and preserved canon
- two-board Scene 8.5
- four-movement final hearing
- four new BGM tracks and revised cue progression
- nine new portrait expressions
- Aoba media bridge restoration
- verification commands and manual playthrough result

---

## Final Self-Review

### KISS / YAGNI

- No new runtime mechanism.
- No new parser syntax.
- No new audio framework.
- No new generic expression system.
- No branch/skip tutorial feature.
- Existing scene, asset and audio contracts carry the entire change.

### Story integrity

- The case remains independently solvable.
- Every required clue and procedure gate stays present.
- The chapter still teaches only 摘要／本機順序／核准片段.
- Aoba is named but not explained.
- `ZW_A16.lock` remains a separate private-source hook.

### Cost control

- Four reusable BGM tracks, not one per scene.
- Nine expression images only for the five characters carrying the main emotional arc.
- Existing standard/stern/strained/tired/flustered portraits are reused.
- No background/evidence regeneration.

### Single-PR boundary

All story, audio, portrait, snapshot and production-anchor work ships in this one PR. Do not split asset generation, story edits or final verification into follow-up PRs for this task.

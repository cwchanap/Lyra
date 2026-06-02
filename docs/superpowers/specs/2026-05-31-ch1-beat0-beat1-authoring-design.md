# Chapter 1 Beat 0 + Beat 1 Authoring — Design

**Date:** 2026-05-31
**Status:** Approved (design); pending spec review → writing-plans
**Scope:** Author the playable scene content for Chapter 1 Beat 0 (冷開場) and
Beat 1 (相馬事務所日常), driven by two subagents, each using the proper writing
skill. No engine/compiler code changes.

---

## 1. Goal

Turn the V1.2 施工圖 (`docs/stories_plan/chapter_1/chapter1_final_result_plan.md`)
Beats 0 and 1 — together with the writing addendum
(`chapter1_actual_writing_agent_addendum.md`) — into authored scene files in the
project's scene format, validated against the scene compiler.

This is content authoring, not feature work. The "design" here is: the
scene-type mapping, the per-file content contract each subagent must satisfy,
the subagent orchestration, and how we validate output given the non-standard
output location.

## 2. Source-of-truth & canon reconciliation

- **Authoritative plan:** `chapter1_final_result_plan.md` (V1.2 final施工圖) +
  `chapter1_actual_writing_agent_addendum.md` (voice / Do-Don't).
- **Story bible:** `tokyo_rain_witness_final_story_bible_v64.md`.
- **Canon correction (must enforce in every subagent brief):** the surface
  suspect is **三宅蒼太**, not 若槻蓮. The stale planning `chapter.md` and the
  `writing-investigation-scene` SKILL.md worked example both still show 若槻蓮 —
  these are NOT canon. Bible: 三宅蒼太 ×16, 若槻蓮 ×0.
- **Roster:** 相馬律 (young detective-lawyer, evidence-believer, not yet a
  genius), 早坂茜 (procedural lawyer partner, paper-receipt habit), 三宅蒼太
  (surface suspect / cafe staff), 增田圭 (victim), 北見修一 (true killer — does
  NOT appear in Beat 0/1), 神谷澪 (gatekeeper — not in Beat 0/1), 黑瀨徹 (field
  detective — not in Beat 0/1).

## 3. Output location (non-standard — deliberate)

Per user instruction, author into **`docs/stories_plan/chapter_1/`**, NOT
`static/stories_plan/chapter_1/`.

Consequence and handling:

- The compiler CLI (`bun run scenes:compile`) and the runtime build read only
  `static/stories_plan/` (`SOURCE_ROOT` is hardcoded in
  `scripts/compile-scenes.ts`). Files under `docs/` are **drafts** — not in the
  playable build until later moved/copied to `static/`.
- Validation is still performed by invoking the underlying `compile()` function
  (`scripts/compile-scenes/orchestrator.ts`) directly with
  `sourceRoot = docs/stories_plan`, `assetConfigRoot = static/assets/config`,
  and a throwaway temp `outputRoot`. This is the same validator the unit tests
  use with fixture roots, so manifest/linear/investigation/ID/unlock checks all
  run.
- The existing stale `docs/stories_plan/chapter_1/chapter.md` is **overwritten
  in place** with the V1.2 manifest.

## 4. Assets are disabled

`static/assets/config/policy.yaml` → `enabled: false`. Therefore subagents
author **semantic content only**: no `Background Prompt`, no `BGM`/`BGS`, no
`Image Prompt`, no expression metadata required. `[場景：...]` tags carry
location/time/atmosphere words only.

## 5. Scene-type mapping & file plan

All files under `docs/stories_plan/chapter_1/`:

| File | Beat | Type | Skill |
|---|---|---|---|
| `chapter.md` | — | manifest | writing-chapter-manifest (I author directly) |
| `scene_0.md` | Beat 0 | linear | writing-detective-game-dialogue |
| `investigation_scene_1.md` | Beat 1 | investigation | writing-investigation-scene |

`chapter.md` lists exactly `[scene_0.md, investigation_scene_1.md]` (compiler
requires every listed file to exist). Later beats extend it.

## 6. Per-file content contract

### 6.1 `scene_0.md` — Beat 0 (linear, two `[場景：]` tags)

**Sub-scene 0A — KAGAMI UI 黑底摘要** (no real people, data display):
ordered reveal of 死者 增田圭 → 地點 吉祥寺咖啡館「雨鐘」→ 推定案發時間
23:08–23:12 → 門鎖事件 23:07:50 Staff Credential 三宅蒼太 → 監視器截圖（三宅靠近
後場）→ 打卡紀錄（三宅當晚值班）→ 建議：主要嫌疑人 三宅蒼太 → corner flash
`merge delay: 89.7s` (NOT enlarged, no special SFX, player may fully ignore).
Writer note (not player-facing): 23:07:50 is the summary-displayed time on the
Staff Credential, not本機 raw seconds.

**Sub-scene 0B — 人性鉤子**: 黑底 UI「主要嫌疑人：三宅蒼太」→ sound of a plastic
bag being crushed → 三宅母親 outside the meeting room, 飯糰袋 crushed in hand,
folds the bag mouth over and over, **does not cry** → cut to the KAGAMI 摘要副本
on 相馬's desk.

**Must NOT:** 母親 says「我兒子不會殺人」(saved for Beat 2); UI looks
evil/glitchy; any explanation of the 90 seconds; 藍傘 / 金木犀 / `ZW_A16.lock`.

**Exit feeling:** "summary 很完整，但這會毀掉一個人."

Format: linear scene — exactly one H1, no H2+, no metadata; 0A and 0B are two
`[場景：...]` tags in the one file.

### 6.2 `investigation_scene_1.md` — Beat 1 (investigation tutorial)

**Intro:** 清晨雨聲; 相馬 establishing beat (orderly, believes tidy data
protects people).

**Sub-location `相馬事務所 {#office}` — `Status: unlocked` (entry point).**

Hotspots (English IDs; Chinese player text):

| Hotspot {#id} | Function | Guardrail |
|---|---|---|
| 桌上舊委託單 `{#old_request_slips}` | 相馬 sorts by time → 秩序/資料感 | character texture only |
| 壞掉的咖啡機 `{#broken_coffee_machine}` | spits a little hot water; 相馬 still measures water temp → foreshadows that coffee equipment / 出杯紀錄 appears this chapter | **NOT** a 餘溫定時器; don't over-play for comedy |
| 便利店罐咖啡 `{#canned_coffee}` | 相馬's tight budget | texture only |
| KAGAMI 摘要副本 `{#kagami_summary_hotspot}` | the 正式證物入口 | on inspect → `Reveals: [evidence:kagami_summary, topic:hayasaka@commission]` |

Character `早坂茜 {#hayasaka}` — Role 律師, Bio 程序感強的搭檔、紙本收據癖、重視
來源與保全鏈:

| Topic {#id} | Status | Path |
|---|---|---|
| 委託內容 `{#commission}` | locked | inbound `Reveals` from `kagami_summary_hotspot`. She brings 三宅母親委託 + 程序入口. Discussing it → `Reveals: [topic:hayasaka@go_to_scene]` |
| 去現場走一遍 `{#go_to_scene}` | locked | inbound `Reveals` from `topic:hayasaka@commission` |

**Evidence Manifest** — `evidence:kagami_summary {#kagami_summary}` (game-global
ID, declared **once** here for the whole game; later beats reference, never
redeclare): Name KAGAMI 摘要副本; neutral Description/Details; `#### On Collect`
required.

**Outro** — `Unlock: evidence:kagami_summary collected and topic:hayasaka@commission discussed`.
早坂 presents the commission and sends 相馬 toward 三宅母親 / 審查會程序 (Beat 2
handoff). Use the 施工圖 line:
> 相馬：「時間、門、鏡頭，三條線都對上了。」
> 早坂：「那你先去店裡走一遍。走完還對得上，再信它。」

**Constraints:** 相馬's single summary-believing line for the whole first half is
spent here. 早坂 must NOT state the chapter's answer. 相馬 must NOT start by
doubting KAGAMI. Case入口 is legal procedure, not break-in.

**Unlock graph (acyclic, one tutorial chain):**
`office` (unlocked) → 3 texture hotspots free; inspect `kagami_summary_hotspot`
→ collect `evidence:kagami_summary` + unlock `commission` → discuss `commission`
→ unlock `go_to_scene` → Outro gate (evidence collected AND commission
discussed). Every locked block has exactly one inbound path; no `Unlock`+`Reveals`
double-declares.

## 7. Subagent orchestration (Approach A — parallel, one agent per file)

- **Agent 1 → `scene_0.md`**, invokes `writing-detective-game-dialogue`.
- **Agent 2 → `investigation_scene_1.md`**, invokes `writing-investigation-scene`.
- The two files share no evidence/statement IDs → fully independent → dispatched
  in parallel (superpowers:dispatching-parallel-agents).
- Subscene-level agents (0A/0B/1A/1B) are rejected: 0A+0B share one linear file;
  1A+1B share one unlock graph. The scene file is the smallest cohesive,
  independently-validatable unit.

**Each brief carries** (agents start cold): the relevant V1.2 beat excerpt; the
matching addendum voice/Do-Don't guidance; the roster + 三宅蒼太 correction;
"assets disabled → no asset metadata"; the beat's 不要做 list; and the exact
file path + scene-type + skill to invoke.

**Orchestrator (me) owns:** the `chapter.md` manifest, the briefs, validation,
and integration. Subagents own only their one scene file's body.

## 8. Validation & integration

1. Subagents return their files.
2. Run `compile()` with `sourceRoot=docs/stories_plan`,
   `assetConfigRoot=static/assets/config`, temp `outputRoot` → expect zero
   errors (manifest valid, linear parse clean, investigation unlock graph
   resolves, `evidence:kagami_summary` declared once, Outro gate references
   resolve).
3. Run focused `scripts/compile-scenes*.test.ts` to confirm no regression in the
   validator itself (we changed no code, so this is a sanity gate only).
4. Fix any cross-file / ID / unlock / format issues, re-validate.
5. Report: files written, validation output, and the drafts-not-in-build caveat.

## 9. Out of scope

- Beats 2–11 (authored later).
- Moving/copying files into `static/` for the runtime build.
- Any engine, Rust, or compiler code change.
- Asset metadata (assets disabled).
- The interrogation scene format.

## 10. Acceptance criteria

- `docs/stories_plan/chapter_1/chapter.md` is the V1.2 manifest listing the two
  scenes; the stale 若槻蓮 version is gone.
- `scene_0.md` covers 0A + 0B per §6.1, linear format, no forbidden foreshadow.
- `investigation_scene_1.md` covers §6.2 with a resolving unlock graph and the
  single global `evidence:kagami_summary`.
- `compile()` over `docs/stories_plan` returns zero errors.
- No 藍傘 / 金木犀 / `ZW_A16.lock` in any proof order; no 90-秒 explanation; no
  若槻蓮; no asset metadata.

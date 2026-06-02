# Chapter 1 Beat 0 + Beat 1 Authoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Author Chapter 1 Beat 0 (`scene_0.md`, linear) and Beat 1 (`investigation_scene_1.md`, investigation) into `docs/stories_plan/chapter_1/`, validated by the scene compiler, via two parallel writing subagents.

**Architecture:** An orchestrator owns the chapter manifest and a draft-tree validation harness; two independent writing subagents each author one scene file using the proper writing skill. Because output lives under `docs/stories_plan/` (not `static/`), validation calls the compiler's `compile()` function directly with explicit roots rather than the `bun run scenes:compile` CLI.

**Tech Stack:** Bun, TypeScript scene compiler (`scripts/compile-scenes/`), the project writing skills (`writing-chapter-manifest`, `writing-detective-game-dialogue`, `writing-investigation-scene`).

**Spec:** `docs/superpowers/specs/2026-05-31-ch1-beat0-beat1-authoring-design.md`

---

## File Structure

| File | Responsibility | Owner |
|---|---|---|
| `scripts/validate-docs-scenes.ts` | Dev helper: run `compile()` over `docs/stories_plan` with `static/assets/config`, temp output; print errors, exit nonzero on failure. | Orchestrator (Task 1) |
| `docs/stories_plan/chapter_1/chapter.md` | V1.2 manifest listing the two authored scenes (overwrites stale 若槻蓮 version). | Orchestrator (Task 2) |
| `docs/stories_plan/chapter_1/scene_0.md` | Beat 0 linear cold-open (0A KAGAMI UI summary + 0B 三宅母親 hook). | Subagent 1 (Task 3) |
| `docs/stories_plan/chapter_1/investigation_scene_1.md` | Beat 1 office investigation tutorial (4 hotspots, 早坂 character, `evidence:kagami_summary`, unlock chain). | Subagent 2 (Task 4) |

**Canon constraints (every task):** suspect is **三宅蒼太** (never 若槻蓮); victim 增田圭; assets are **disabled** so author semantic content only (no `Background Prompt`/`BGM`/`BGS`/`Image Prompt`); no 藍傘 / 金木犀 / `ZW_A16.lock` in proof order; no explanation of the 90 seconds; Traditional Chinese only.

---

### Task 1: Draft-tree validation harness

**Files:**
- Create: `scripts/validate-docs-scenes.ts`

- [ ] **Step 1: Write the harness**

```typescript
// scripts/validate-docs-scenes.ts
// Dev helper: validate the Chapter-1 DRAFT scenes authored under
// docs/stories_plan/ using the same compiler the CLI uses, without writing
// into the tracked static/ source tree. Output JSON goes to a throwaway temp
// dir and is discarded. Exit 0 = clean, exit 1 = compile errors.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { compile } from "./compile-scenes/orchestrator";

const outputRoot = mkdtempSync(resolve(tmpdir(), "lyra-docs-scenes-"));
const result = compile({
  sourceRoot: resolve(process.cwd(), "docs/stories_plan"),
  outputRoot,
  assetConfigRoot: resolve(process.cwd(), "static/assets/config"),
  assetOutputRoot: outputRoot,
});

if (result.ok) {
  console.log(
    `OK: chapters=${result.chaptersCompiled} scenes=${result.scenesCompiled}`,
  );
  process.exit(0);
}

console.error(`FAIL: ${result.errors.length} error(s)`);
for (const e of result.errors) {
  console.error(`  [${e.code}] ${e.sourceFile}:${e.line} ${e.message}`);
}
process.exit(1);
```

- [ ] **Step 2: Run it against the current (stale) state to confirm it fails**

Run: `bun run scripts/validate-docs-scenes.ts`
Expected: FAIL — `sceneFileMissing` for `scene_0.md`, `investigation_scene_1.md`, and `interrogation_scene_2.md` (the stale `chapter.md` lists three files, none of which exist yet). This proves the harness actually exercises the manifest + scene loading.

---

### Task 2: Author the V1.2 chapter manifest

**Files:**
- Modify (overwrite): `docs/stories_plan/chapter_1/chapter.md`

- [ ] **Step 1: Overwrite `chapter.md` with the V1.2 manifest**

```markdown
# Chapter 1: 雨鐘咖啡館殺人事件

**Summary:** 律師相馬律與早坂茜接下委託，在 KAGAMI 摘要與雨鐘咖啡館現場之間，重新檢視三宅蒼太被指為兇手的命案。

## Scenes
1. scene_0.md
2. investigation_scene_1.md
```

(This drops the stale `若槻蓮` summary and the not-yet-authored `interrogation_scene_2.md`. Later beats append to the `## Scenes` list.)

- [ ] **Step 2: Run the harness to confirm the manifest parses and the gap is now only the two scene files**

Run: `bun run scripts/validate-docs-scenes.ts`
Expected: FAIL — exactly two `sceneFileMissing` errors, for `scene_0.md` and `investigation_scene_1.md`. (Manifest H1/Summary/Scenes now valid; only the bodies are missing.)

---

### Task 3: Dispatch Subagent 1 — `scene_0.md` (Beat 0, linear)

**Files:**
- Create: `docs/stories_plan/chapter_1/scene_0.md`

- [ ] **Step 1: Dispatch a general-purpose subagent with this exact brief**

> You are authoring one **linear dialogue scene file** for a Traditional-Chinese detective game, 《東京雨證：第零證人》. Write the file `docs/stories_plan/chapter_1/scene_0.md` and nothing else.
>
> **First action:** invoke the Skill tool with skill `writing-detective-game-dialogue` and follow its linear-scene format exactly. Do not invoke `using-superpowers`.
>
> **Canon (do not deviate):** This is Chapter 1, Beat 0 「冷開場 — 摘要的乾淨故事」. Victim = 增田圭. Surface suspect = **三宅蒼太** (NEVER 若槻蓮 — ignore any 若槻蓮 you may see in skill examples). No other named characters appear in this scene.
>
> **Assets are disabled** — author semantic content only. `[場景：...]` tags carry location/time/atmosphere words only. Do NOT add `Background Prompt`, `BGM`, `BGS`, or any asset metadata.
>
> **Format:** Exactly one H1 line `# Scene 0: 冷開場 — 摘要的乾淨故事`. No H2 or deeper headings. No metadata fields. The file is ONE linear queue with TWO `[場景：...]` tags (0A then 0B). Dialogue lines `**角色名**：內容`, full-width colon, ≤100 Chinese chars each, one blank line between lines. Action/atmosphere in `[ ]` brackets. Use `**旁白**` sparingly (UI/data display, time/space shifts). Traditional Chinese only; no simplified, no raw Japanese kanji (経→經, 実→實).
>
> **Sub-scene 0A — KAGAMI UI 黑底摘要** (first `[場景：...]` = a black KAGAMI summary UI, no real people). Reveal, in order, as data lines: 死者 增田圭 → 地點 吉祥寺咖啡館「雨鐘」→ 推定案發時間 23:08–23:12 → 門鎖事件 23:07:50（Staff Credential，三宅蒼太）→ 監視器截圖（三宅靠近後場）→ 打卡紀錄（三宅當晚值班）→ 建議：主要嫌疑人 三宅蒼太 → a tiny corner flash `merge delay: 89.7s`. The `89.7s` must read as throwaway — no emphasis, no special beat; the player can fully ignore it. Do NOT explain it.
>
> **Sub-scene 0B — 人性鉤子** (second `[場景：...]` = 警署會面室外走廊). The UI still shows「主要嫌疑人：三宅蒼太」. A plastic bag is crushed (sound). 三宅母親 sits outside the meeting room, a 飯糰袋 crushed in her hand; she folds the bag mouth over and over; **she does not cry and does not speak**. Cut to the KAGAMI 摘要副本 lying on 相馬's desk.
>
> **Must NOT:** let 母親 say「我兒子不會殺人」(reserved for a later beat); make the UI look evil or glitchy; explain the 90 seconds; show 藍傘 / 金木犀 / `ZW_A16.lock`. Keep it short, clean, cold — not a trailer, not a crying scene.
>
> **Exit feeling to land:** the summary looks complete, but it is about to crush a real person.
>
> **Self-check before returning:** one H1 only; no H2+; no metadata; exactly two `[場景：...]` tags; every dialogue line ≤100 chars; brackets for all action; Traditional Chinese; no asset metadata; no 若槻蓮; no forbidden foreshadow. Then write the file and report a 3–5 line summary of what you wrote.

- [ ] **Step 2: Confirm the subagent created the file**

Run: `test -f docs/stories_plan/chapter_1/scene_0.md && echo EXISTS`
Expected: `EXISTS`

---

### Task 4: Dispatch Subagent 2 — `investigation_scene_1.md` (Beat 1, investigation)

**Files:**
- Create: `docs/stories_plan/chapter_1/investigation_scene_1.md`

> **Note:** Task 4 is independent of Task 3 (no shared IDs) and SHOULD be dispatched in parallel with it.

- [ ] **Step 1: Dispatch a general-purpose subagent with this exact brief**

> You are authoring one **interactive investigation scene file** for a Traditional-Chinese detective game, 《東京雨證：第零證人》. Write the file `docs/stories_plan/chapter_1/investigation_scene_1.md` and nothing else.
>
> **First action:** invoke the Skill tool with skill `writing-investigation-scene` (it builds on `writing-detective-game-dialogue` base dialogue rules) and follow its block format exactly. Do not invoke `using-superpowers`.
>
> **Canon (do not deviate):** Chapter 1, Beat 1 「相馬事務所日常 — 年輕偵探的入口」. Characters present: **相馬律** (young detective-lawyer; orderly; believes tidy data protects people; not yet a genius) and **早坂茜** (procedural lawyer partner; paper-receipt habit; cares about source & chain-of-custody). Surface suspect referenced in the summary doc = **三宅蒼太** (NEVER 若槻蓮 — the skill's worked example shows 若槻蓮; ignore that name). No other named characters appear.
>
> **Assets are disabled** — author semantic content only. `[場景：...]` tags carry location/time/atmosphere words only. Do NOT add `Background Prompt`, `Image Prompt`, `BGM`, `BGS`, or any asset metadata. (`Status`, `Reveals`, `Unlock`, `Description`, `Name`, etc. are still required — they are parser fields, not asset metadata.)
>
> **Field-label language:** English labels and English slug IDs; Traditional-Chinese only for player-facing values (names, descriptions, dialogue).
>
> **Author EXACTLY this structure, in canonical order, with these EXACT anchor IDs (the orchestrator depends on them):**
>
> ```
> # Scene 1: 相馬事務所日常 — 年輕偵探的入口
>
> ## Intro
>   清晨雨聲；相馬 establishing — orderly, believes tidy data protects people.
>
> ## Sub-location: 相馬事務所 {#office}   — Status: unlocked
>   [場景：相馬事務所，清晨，細雨，狹小、紙本堆疊、桌上一台壞掉的咖啡機。]
>   ### Hotspot: 桌上舊委託單 {#old_request_slips}
>        相馬按時間排列 → 秩序感 / 資料感. (character texture only)
>   ### Hotspot: 壞掉的咖啡機 {#broken_coffee_machine}
>        只吐出一點熱水；相馬仍測水溫. Foreshadows that coffee equipment /
>        出杯紀錄 shows up later this chapter — but it is NOT a 餘溫定時器, and do
>        not over-play it for comedy. (texture + light foreshadow)
>   ### Hotspot: 便利店罐咖啡 {#canned_coffee}
>        相馬生活拮据. (texture only)
>   ### Hotspot: KAGAMI 摘要副本 {#kagami_summary_hotspot}
>        - Reveals: [evidence:kagami_summary, topic:hayasaka@commission]
>        相馬 spends his ONE summary-believing line of the whole first half here,
>        e.g.「時間、門、鏡頭，三條線都對上了。」
>   ### Character: 早坂茜 {#hayasaka}   — Role: 律師；Bio: 程序感強的搭檔，紙本收據癖，重視來源與保全鏈。
>        #### Topic: 委託內容 {#commission}   — Status: locked
>             - Reveals: [topic:hayasaka@go_to_scene]
>             早坂 brings 三宅母親委託 + the legal procedure entry. She must NOT
>             state the chapter's answer.
>        #### Topic: 你先去現場走一遍 {#go_to_scene}   — Status: locked
>             早坂:「那你先去店裡走一遍。走完還對得上，再信它。」
>
> ## Evidence Manifest
>   ### evidence:kagami_summary {#kagami_summary}
>        - Name: KAGAMI 摘要副本
>        - Description / Details: neutral, factual — the official summary copy that
>          names 三宅蒼太 as 主要嫌疑人; player has not yet doubted it.
>        #### On Collect   (required) — 相馬 receives it as the 正式證物入口.
>
> ## Outro
>   - Unlock: evidence:kagami_summary collected and topic:hayasaka@commission discussed
>   早坂 formally presents the commission and sends 相馬 toward 三宅母親 / the
>   審查會 procedure (Beat 2 handoff).
> ```
>
> **Unlock-graph rules (the validator enforces these):** the first sub-location is `unlocked`. The three texture hotspots are `unlocked`. `kagami_summary_hotspot` is `unlocked`; inspecting it Reveals the evidence AND unlocks `commission`. `commission` and `go_to_scene` are `Status: locked` and each reached by exactly ONE inbound `Reveals` (shown above) — do NOT also give them an `Unlock:` predicate (a block must not have both). The graph is acyclic. `evidence:kagami_summary` is a **game-global ID declared only here** for the whole game.
>
> **Constraints:** Case entry is legal procedure, not a break-in. 相馬 must NOT begin by doubting KAGAMI. 早坂 must NOT reveal the answer or give a thesis speech. Do not over-comedy the broken coffee machine; it is not a death-time timer. No 藍傘 / 金木犀 / `ZW_A16.lock`; no 90-second explanation.
>
> **Base dialogue rules:** `**角色名**：內容`, full-width colon, ≤100 Chinese chars/line, blank line between lines, action in `[ ]`, Traditional Chinese only (no simplified, no raw Japanese kanji).
>
> **Self-check before returning:** every locked block has exactly one inbound `Reveals` and no `Unlock`; first sub-location is `unlocked`; the sub-location has exactly one `[場景：...]`; `evidence:kagami_summary` has `#### On Collect`; the Outro `Unlock` references resolve; all dialogue ≤100 chars; no asset metadata; no 若槻蓮; no forbidden foreshadow. Then write the file and report a 3–5 line summary plus the final IDs you used.

- [ ] **Step 2: Confirm the subagent created the file**

Run: `test -f docs/stories_plan/chapter_1/investigation_scene_1.md && echo EXISTS`
Expected: `EXISTS`

---

### Task 5: Validate the full draft corpus and remediate

**Files:**
- Read/verify: all three authored files; fix in place if the compiler reports errors.

- [ ] **Step 1: Run the validation harness — expect a clean compile**

Run: `bun run scripts/validate-docs-scenes.ts`
Expected: `OK: chapters=1 scenes=2`

- [ ] **Step 2: If it fails, fix and re-run**

Read each reported `[code] file:line message` and fix the offending file directly (common cases: a `Reveals`/`Unlock` ID that doesn't match its `{#id}` anchor; a locked block with no inbound path; a missing `#### On Collect`; an H2 heading inside the linear `scene_0.md`; a dialogue line >100 chars). Re-run `bun run scripts/validate-docs-scenes.ts` until it prints `OK: chapters=1 scenes=2`. Do not edit the compiler; the source of truth for the format is the writing skills + this plan.

- [ ] **Step 3: Sanity-check the validator itself is unbroken (no code changed)**

Run: `bun run test scripts/compile-scenes`
Expected: PASS (all compiler unit tests green — we changed no compiler code, so this only guards against an accidental edit).

---

### Task 6: Report and optional commit

- [ ] **Step 1: Summarize**

Report: the three files written, the `OK: chapters=1 scenes=2` validation line, and the caveat that these live under `docs/stories_plan/` so they are **drafts** — not in the runtime build until copied/moved into `static/stories_plan/`.

- [ ] **Step 2: Commit only if the user approves (repo policy: commit only when asked; branch off `main` first)**

```bash
git checkout -b feat/ch1-beat0-beat1-authoring
git add docs/stories_plan/chapter_1/chapter.md \
        docs/stories_plan/chapter_1/scene_0.md \
        docs/stories_plan/chapter_1/investigation_scene_1.md \
        scripts/validate-docs-scenes.ts \
        docs/superpowers/specs/2026-05-31-ch1-beat0-beat1-authoring-design.md \
        docs/superpowers/plans/2026-05-31-ch1-beat0-beat1-authoring.md
git commit -m "feat: author Chapter 1 Beat 0 + Beat 1 scenes (docs draft tree)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- §3 output to `docs/` + validation via `compile()` → Task 1 harness, Task 5. ✓
- §5 file plan / scene-type mapping → Tasks 2–4. ✓
- §6.1 `scene_0.md` content contract → Task 3 brief. ✓
- §6.2 `investigation_scene_1.md` content + exact IDs + unlock graph → Task 4 brief. ✓
- §2 canon correction 三宅蒼太 → both briefs + File Structure constraints. ✓
- §4 assets disabled → both briefs. ✓
- §7 Approach A, parallel, per-file → Tasks 3 & 4 (parallel note). ✓
- §8 validation & integration → Tasks 5–6. ✓
- §10 acceptance criteria → Task 5 (`OK: chapters=1 scenes=2`) + brief 不要做 lists. ✓

**Placeholder scan:** harness code is complete and runnable; manifest content is literal; both subagent briefs are fully specified with exact IDs; no "TBD"/"handle edge cases"/"similar to Task N". ✓

**ID consistency:** `evidence:kagami_summary` (manifest `{#kagami_summary}`) referenced as `evidence:kagami_summary` in the hotspot `Reveals` and the Outro `Unlock`; `topic:hayasaka@commission` and `topic:hayasaka@go_to_scene` match `{#hayasaka}` + `{#commission}`/`{#go_to_scene}`; hotspot `{#kagami_summary_hotspot}` distinct from evidence `{#kagami_summary}`. Consistent across Task 4 and Task 5 examples. ✓

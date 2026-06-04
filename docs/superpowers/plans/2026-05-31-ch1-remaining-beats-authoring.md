# Chapter 1 Remaining Beats (2–11) Authoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. The story-authoring orchestration itself follows the project `subagent-driven-story-writing` skill.

**Goal:** Author the remaining 10 beats of Chapter 1 《雨鐘咖啡館殺人事件》 (Beats 2–11) as compiled, consistency-reviewed scene files under `docs/stories_plan/chapter_1/`, with a chapter-wide evidence/statement ID ledger so the two 審查會 cross-examinations resolve.

**Architecture:** One writing subagent per scene file (the project `subagent-driven-story-writing` workflow); the orchestrator owns the manifest, the global ID ledger, every brief, and the two gates. Two gates per beat: the **compiler** (`bun run scenes:compile`) for structure/ID resolution, then a separate **review subagent** for canon/voice/continuity. Beats 0–1 already shipped; this plan continues the same `docs/` draft tree.

**Tech Stack:** Bun + the TypeScript scene compiler (`scripts/compile-scenes/`), the project writing skills (`writing-chapter-manifest`, `writing-detective-game-dialogue`, `writing-investigation-scene`, `writing-interrogation-scene`).

**Spec:** `docs/stories_plan/chapter_1/chapter1_final_result_plan.md` (V1.2 施工圖) + `chapter1_actual_writing_agent_addendum.md` (voice/Do-Don't) + `docs/stories_plan/tokyo_rain_witness_final_story_bible_v64.md` (canon).

---

## Engine constraint that drives every mapping

**Linear scenes carry NO compiler references** — `linearScene` ASTs are just a dialogue `queue` (verified in `scripts/compile-scenes/parser-linear.ts` + `types.ts`). They cannot declare evidence/statements and cannot hold `Reveals`/`Unlock`/contradiction targets. Only **investigation** (evidenceManifest + Reveals/Unlock) and **interrogation** (evidence + statement manifests + contradiction triggers) scenes create or consume IDs. The validator builds **one global registry** from all investigation/interrogation manifests and enforces: each evidence/statement ID declared **exactly once**; every referenced ID resolves.

Consequence: linear beats (2, 5, 6, 8.5, 11) impose **zero** ID obligations — they depict evidence in dialogue only. All collectible evidence is declared in the investigation/interrogation beats (3, 4, 7, 8, 9, 10), and the cross-exams (5 is linear/no-refs; 10 is interrogation) only present IDs declared upstream.

**Guaranteed-inventory rule (load-bearing for interrogation contradictions):** the validator (`guaranteedInventoryFromInvestigation`) only treats an investigation's evidence as *guaranteed* for later scenes if the outro is **`auto`** (player must inspect every reachable hotspot/topic to finish) — an explicit `Unlock:` outro guarantees only the evidence named in its predicate. Interrogation `Contradiction:` targets must be guaranteed before their testimony phase or the build fails (`interrogationContradictionUnresolved`). **Therefore every investigation whose evidence is later presented in an interrogation — Beats 3, 7, 8, 9 (all feed Beat 10) — uses an `auto` outro: write `## Outro` with NO `Unlock:` line.** (Beat 3 was switched from an explicit gate to auto for exactly this reason.) Interrogation scenes guarantee their own correct-path testimony `Result` reveals, so Beat 4's `cake_box`/`miyake_mother_call_log` and Beat 10's `approved_clip` are guaranteed downstream.

## File map (Beats 2–11)

| Beat | File (under `docs/stories_plan/chapter_1/`) | Type | Skill | 施工圖 lines |
|---|---|---|---|---|
| 2 | `scene_2.md` | linear | writing-detective-game-dialogue | 240–332 |
| 3 | `investigation_scene_3.md` | investigation | writing-investigation-scene | 336–528 |
| 4 | `interrogation_scene_4.md` | interrogation | writing-interrogation-scene | 532–614 |
| 5 | `scene_5.md` | linear | writing-detective-game-dialogue | 618–696 |
| 6 | `scene_6.md` | linear | writing-detective-game-dialogue | 699–760 |
| 7 | `investigation_scene_7.md` | investigation | writing-investigation-scene | 764–918 |
| 8 | `investigation_scene_8.md` | investigation | writing-investigation-scene | 921–1009 |
| 8.5 | `scene_8_5.md` | linear | writing-detective-game-dialogue | 1012–1070 |
| 9 | `investigation_scene_9.md` | investigation | writing-investigation-scene | 1073–1204 |
| 10 | `interrogation_scene_10.md` | interrogation | writing-interrogation-scene | 1207–1338 |
| 11 | `scene_11.md` | linear | writing-detective-game-dialogue | 1341–1446 |

Manifest playable order (final): `scene_0, investigation_scene_1, scene_2, investigation_scene_3, interrogation_scene_4, scene_5, scene_6, investigation_scene_7, investigation_scene_8, scene_8_5, investigation_scene_9, interrogation_scene_10, scene_11`. The manifest is grown one entry per beat (the compiler requires every listed file to exist).

> `scene_8_5.md` → sceneId `scene_8_5` (prefix `scene_` is all the parser checks). If the compiler ever rejects the underscore-number, fall back to `scene_85.md`; update the manifest line to match.

## Global Evidence ID ledger

Declared **exactly once** at the listed site (its `#### On Collect` / evidence manifest entry). Beats 0–1 already declared `kagami_summary`. Player-facing names are Traditional Chinese; IDs are English slugs.

| Evidence ID | 中文名 | Declared in | Presented/used by |
|---|---|---|---|
| `kagami_summary` | KAGAMI 摘要副本 | investigation_scene_1 (done) | Beat 1 outro |
| `cctv_screenshot` | 監視器截圖（閉店 routine） | investigation_scene_3 | B4 (contradiction) |
| `timecard_record` | 打卡紀錄 | investigation_scene_3 | B10 P4 context |
| `backroom_floorplan` | 後場平面圖 / L 型圖 | investigation_scene_3 | B10 P3 |
| `two_coffee_order` | 兩杯咖啡訂單 `K.` | investigation_scene_3 | B10 P5 |
| `doorlock_summary_timetable` | 門鎖摘要 / 合併時間表 | investigation_scene_3 | B10 P4 |
| `closing_routine` | 閉店維護 routine（SOP 白板） | investigation_scene_3 | B4, B10 P1 |
| `miyake_mother_call_log` | 三宅母親通話紀錄 | interrogation_scene_4 | B10 P1 |
| `cake_box` | 蛋糕盒（被丟棄品） | interrogation_scene_4 | B10 P1 |
| `floor_water_drying_map` | 地板雨水乾燥圖 | investigation_scene_7 | B10 P3 |
| `wet_umbrella_sleeve` | 濕傘套 | investigation_scene_7 | B9 (match), B10 P3 |
| `coffee_last_cup_record` | 咖啡機最後出杯紀錄 | investigation_scene_7 | B10 P2 (aux) |
| `old_clock_photo` | 舊掛鐘照片（停 ~22:59） | investigation_scene_7 | B10 P2 |
| `victim_phone_notification` | 死者手機通知紀錄（~22:58） | investigation_scene_7 | B9, B10 P2 |
| `murder_weapon_candidate` | 金屬咖啡豆罐擦拭痕 / 兇器候補 | investigation_scene_7 | B10 P2 |
| `forensic_prelim_range` | 法醫初步死亡範圍（黑瀨簡報） | investigation_scene_7 | B10 P2 |
| `miyake_pov_replay` | 三宅視角 replay / 後場視線記錄 | investigation_scene_7 | B10 P3 |
| `amemiya_message_thumb` | 雨宮匿名訊息縮圖（contractor_thumb） | investigation_scene_7 | (clue only; excluded B11D) |
| `local_sequence_record` | 本機順序程序固定紀錄（Event-1841~1844） | investigation_scene_8 | B10 P4 |
| `maintenance_mode_note` | 維護模式說明（店方知識邊界） | investigation_scene_8 | B10 P4 context |
| `external_maintenance_credential` | 外包維護憑證（Event-1842） | investigation_scene_8 | B9, B10 P5 |
| `kitami_external_access` | 北見外包維護權限 | investigation_scene_9 | B10 P5 |
| `temp_maintenance_workorder` | 臨時維護工單 | investigation_scene_9 | B10 P5 |
| `masuda_whistleblower_draft` | 增田檢舉草稿 | investigation_scene_9 | B10 P5 |
| `kitami_data_theft_record` | 北見資料盜賣紀錄（異常存取整理表） | investigation_scene_9 | B10 P5 |
| `masuda_unsent_memo` | 增田未送出備忘（「22:50 雨鐘 / 校驗値確認 / K」） | investigation_scene_9 | B10 P5 |
| `contractor_umbrella_sleeve_match` | 承包商資材包傘套來源比對 | investigation_scene_9 | B10 P5 |
| `approved_clip` | 核准片段（限定調出） | interrogation_scene_10 | B10 P4–P5 (gated mid-審查會) |

## Testimony-statement ledger (interrogation phase-local, NOT manifest entries)

> These are **testimony statements** (`#### Statement:` under `### Testimony`), which are phase-local — they are NOT `## Statement Manifest` entries and are not in the global statement registry. Every contradiction in this chapter is an **evidence** target, so **no Statement Manifest is needed in any scene**. The inquiry→testimony unlock uses `phase:<inquiry_id> completed`. IDs kept unique anyway.

| Statement ID | 證詞（被詰問者） | Declared in | Contradicted by |
|---|---|---|---|
| `miyake_whereabouts_2256` | 三宅：22:56「記不清」 | interrogation_scene_4 | `miyake_mother_call_log` |
| `miyake_backroom_reason` | 三宅：去後場只「拿清潔用品」 | interrogation_scene_4 | `cctv_screenshot` / `closing_routine` → reveals `cake_box` |
| `miyake_inner_storage_denial` | 三宅：沒進內側倉庫（真實，無矛盾） | interrogation_scene_4 | (none — truthful) |
| `miyake_masuda_waiting` | 三宅：增田等「外包那邊的人」 | interrogation_scene_4 | (vague; seeds B9, no hard contradiction) |
| `summary_miyake_most_credible` | 摘要：三宅說謊故摘要比他可信 | interrogation_scene_10 | `closing_routine` + `cake_box` + `miyake_mother_call_log` |
| `summary_death_after_miyake` | 摘要：死亡在三宅進後場後 | interrogation_scene_10 | `victim_phone_notification` + `old_clock_photo` + `murder_weapon_candidate` + `forensic_prelim_range` |
| `summary_could_still_be_miyake` | 摘要：更早也可能是三宅 | interrogation_scene_10 | `miyake_pov_replay` + `floor_water_drying_map` + `wet_umbrella_sleeve` + `backroom_floorplan` |
| `summary_doorlock_authentic` | 摘要：門鎖未偽造故三宅時間可信 | interrogation_scene_10 | `local_sequence_record` + `approved_clip` + `doorlock_summary_timetable` |
| `summary_cannot_prove_kitami` | 摘要：不能證明北見殺人 | interrogation_scene_10 | `external_maintenance_credential` + `temp_maintenance_workorder` + `kitami_external_access` + `masuda_whistleblower_draft` + `kitami_data_theft_record` + `masuda_unsent_memo` + `two_coffee_order` + `contractor_umbrella_sleeve_match` |

## Canon constraints (every task — from 施工圖 Appendix B + addendum)

- Suspect surface = **三宅蒼太**; victim = **增田圭**; true killer = **北見修一** (revealed Beat 9–10, never earlier). Roster voices: 相馬律 (orderly, "tidy data protects people," not yet a genius), 早坂茜 (procedure/chain-of-custody), 神谷澪 (審查會 gatekeeper, NOT a villain), 黑瀨徹 (field detective, supplies forensic/chain-of-custody), 店長高瀨 + 片瀨 (店員, NOT engineers).
- 22:50 = 閉店流程開始; **22:52** = 維護模式 ON (never write 22:50 as maintenance-ON).
- `K.` must NOT equal 北見 until Beat 9 merges it. Coffee machine / 第二杯 must NOT alone prove death-minute. 店長手機截圖 is only a lead — 黑瀨/鑑識 program-fixes the formal record.
- Assets disabled (`policy.yaml: enabled:false`): semantic content only — no `Background Prompt`/`BGM`/`BGS`/`Image Prompt`/asset metadata. Writers author intent, never filesystem paths.
- Do NOT let 藍傘 / 金木犀 / `ZW_A16.lock` enter the proof order. No explanation of the 90 秒 / `merge delay`. Beat 11: do not decode `ZW_A16.lock`, no 藍傘 in evidence, no 青葉/A-90/鏡原/第零證人 from 北見.
- Traditional Chinese only (no Simplified, no JP-only kanji). Dialogue: `**角色名**：內容`, full-width colon, ≤100 漢字/line, blank line between lines, action in `[ ]`.

---

### Task A: Extend the chapter manifest scaffold

**Files:**
- Modify: `docs/stories_plan/chapter_1/chapter.md`

This plan grows the manifest one line per beat (inside each beat task). Task A only confirms the starting point is the Beats 0–1 manifest (already on disk):

```markdown
# Chapter 1: 雨鐘咖啡館殺人事件

**Summary:** 律師相馬律與早坂茜接下委託，在 KAGAMI 摘要與雨鐘咖啡館現場之間，重新檢視三宅蒼太被指為兇手的命案。

## Scenes
1. scene_0.md
2. investigation_scene_1.md
```

- [ ] **Step 1: Confirm baseline compiles**

Run: `bun run scenes:compile`
Expected: `OK — 1 chapter(s), 2 scene(s).`

---

### Task 2: Beat 2 — `scene_2.md` (linear)

**Files:**
- Create: `docs/stories_plan/chapter_1/scene_2.md`
- Modify: `docs/stories_plan/chapter_1/chapter.md` (append `3. scene_2.md`)

**Content (施工圖 240–332):** three sub-scenes in one linear queue, three `[場景：]` tags — 2A 母親委託 (相馬·早坂·三宅母親; she brings life detail — 飯糰袋/胃藥/蛋糕邊/forgets meals; she may say 三宅 won't kill but 相馬 won't treat it as proof: use the 269–272 exchange), 2B 審查會入口程序摩擦 (書記官 stops 相馬; 早坂 shows 辯方聘任/法院核准/第三方 analyst; "限定調出" standard — use 289–291), 2C 法律壓力 (today's stakes — use 301–303). Declares **no** evidence (linear).

- [ ] **Step 1: Dispatch writing subagent** (brief: file path + `writing-detective-game-dialogue` first; 施工圖 240–332 excerpt; addendum voice for 相馬/早坂/母親; canon block; assets-disabled; 不要做 324–328 — 母親 no full alibi, no long 制度課, 相馬 no investigative privilege; one H1 `# Scene 2: 委託與程序入口 — 三宅母親求助`, three `[場景：]` tags, no H2+, no asset metadata; self-check).
- [ ] **Step 2: Append to manifest** → `3. scene_2.md`.
- [ ] **Step 3: GREEN gate** — `bun run scenes:compile` → expect `OK — 1 chapter(s), 3 scene(s).`
- [ ] **Step 4: REVIEW gate** — dispatch review subagent (Opus) per the review contract over `scene_2.md` vs 施工圖/addendum/bible; fix Blocker/Important, re-compile.

---

### Task 3: Beat 3 — `investigation_scene_3.md` (investigation)

**Files:**
- Create: `docs/stories_plan/chapter_1/investigation_scene_3.md`
- Modify: `chapter.md` (append `4. investigation_scene_3.md`)

**Declares evidence:** `cctv_screenshot`, `timecard_record`, `backroom_floorplan`, `two_coffee_order`, `doorlock_summary_timetable`, `closing_routine` (each with `#### On Collect`).

**Structure (施工圖 336–528):** sub-locations as the L-型 space — `前場 {#front}` (unlocked: 藍傘 空鏡 only/no discuss, 金木犀 看板 → 相馬 手停半拍, 收銀台, 片瀨 趕末班車; 店長高瀨 + 片瀨 characters), then `後場走廊 {#corridor}` and `內側倉庫入口 {#inner_storage}` reached by Reveals from a front-of-house hotspot (e.g. inspecting 監視器 unlocks 後場). Hotspots → evidence collection: 監視器回放→`cctv_screenshot` (3B normal routine), 打卡→`timecard_record`, 後場 L 型/高貨架/半掩防火門/內側感應燈→`backroom_floorplan` (3C sight occlusion; do NOT yet let 相馬 deduce 三宅 can't see body), 閉店 SOP 白板→`closing_routine` (3D; 22:50 閉店開始 / 22:52 維護 ON; 維護紀錄冊未蓋章), 收銀第二杯→`two_coffee_order` (`K.`, not full name, 3E), 門鎖摘要 hotspot→`doorlock_summary_timetable`. 3F 北見 ambient mention (片瀨/店長, NOT evidence), 3G 聲音種子 (backflush/抽屜, no character lists them as masking), 3H 增田 後場 表面理由 (店長 認得他是「門鎖資料那邊的人」; surface reason only; 店長 does NOT know 北見/USB/盜賣).

**Unlock graph:** `front` unlocked; texture hotspots unlocked; one front hotspot Reveals `corridor`; `corridor` Reveals `inner_storage`; evidence collected via On Collect. Acyclic; each locked sub-location/topic exactly one inbound `Reveals`, no double `Unlock`. Outro: 玩家 has surface evidence, feels 三宅 suspicious, space/routine seeds planted.

- [ ] **Step 1: Dispatch writing subagent** (`writing-investigation-scene` first; 336–528 excerpt; the six evidence IDs + their On-Collect sites; the sub-location unlock graph above; characters 店長高瀨/片瀨; canon + 不要做 518–524 — 藍傘/金木犀 not evidence, `K.`≠北見, 店長 not engineer, sound not perfect score; assets-disabled; self-check incl. "first sub-location unlocked, each locked block one inbound Reveals, every evidence has On Collect").
- [ ] **Step 2: Append manifest** → `4. investigation_scene_3.md`.
- [ ] **Step 3: GREEN gate** — `bun run scenes:compile` → `OK — 1 chapter(s), 4 scene(s).`
- [ ] **Step 4: REVIEW gate** — review subagent over `investigation_scene_3.md`.

---

### Task 4: Beat 4 — `interrogation_scene_4.md` (interrogation)

**Files:**
- Create: `docs/stories_plan/chapter_1/interrogation_scene_4.md`
- Modify: `chapter.md` (append `5. interrogation_scene_4.md`)

**Declares evidence:** `miyake_mother_call_log`, `cake_box`. **Declares statements:** `miyake_whereabouts_2256`, `miyake_backroom_reason`, `miyake_inner_storage_denial`, `miyake_masuda_waiting`.

**Structure (施工圖 532–614):** inquiry phase = the four questions (table 563–568) to 三宅; testimony phase = 三宅's statements, where presenting `cctv_screenshot`/`closing_routine` (Beat 3) against `miyake_backroom_reason` extracts the 蛋糕盒 truth (reveals/declares `cake_box`), and the 22:56 thread formalizes `miyake_mother_call_log`. 4A 自動販賣機 (買錯飲料, 熱牛奶→黑咖啡, use 554–557). 4C 小謊揭露 (偷打母親電話 / 23:06 拿清潔用品+蛋糕盒 / 怕被當偷竊). 4D 通話位置在員工休息區隔 L 型轉角 → weakens sound reliability, NOT a full alibi. 錯誤選擇: "三宅很孝順"→不是證據; "外包人士就是兇手"→沒身份/時間/動線.

> Beat 4 contradiction targets reference Beat 3 evidence (`cctv_screenshot`, `closing_routine`) — both declared upstream in Task 3, so author Task 3 before Task 4. `miyake_inner_storage_denial` is truthful → no contradiction (a statement with no contradiction is allowed). 

- [ ] **Step 1: Dispatch writing subagent** (`writing-interrogation-scene` first; 532–614 excerpt; the 2 evidence + 4 statement IDs; contradiction map from the ledger; canon — 三宅 still suspicious, small lie ≠ confession, no full alibi; assets-disabled; self-check incl. "evidence has On Collect, statement contradictions reference existing IDs").
- [ ] **Step 2: Append manifest** → `5. interrogation_scene_4.md`.
- [ ] **Step 3: GREEN gate** — `bun run scenes:compile` → `OK — 1 chapter(s), 5 scene(s).`
- [ ] **Step 4: REVIEW gate** — review subagent over `interrogation_scene_4.md`.

---

### Task 5: Beat 5 — `scene_5.md` (linear)

**Files:**
- Create: `docs/stories_plan/chapter_1/scene_5.md`
- Modify: `chapter.md` (append `6. scene_5.md`)

**Content (施工圖 618–696):** 第一輪審查會, 摘要先贏 — scripted partial defeat. 5A 審查會開場 (神谷 calm, NOT villain: 摘要 multi-source, 三宅 憑證/CCTV/打卡 吻合, 三宅 又隱瞞; 母親 旁聽 握飯糰袋 echo Beat 0). 5B 玩家反駁 depicted as failing/down-weighted (table 648–653; 外包維護紀錄 is only a low-weight summary item, NOT yet a formal work order). 5C 口語規則雛形 (神谷 661 line — summary prefers the well-matching record; do NOT fully explain Narrative Anchor). 5D 神谷便利貼 + 北見 cameo (撫平名片的手). **No evidence/refs (linear).** Outro: 審查會暫停, 早坂 sends 相馬 back to find "summary 沒寫出來的東西."

- [ ] **Step 1: Dispatch writing subagent** (`writing-detective-game-dialogue` first; 618–696 excerpt; voices 神谷/早坂/相馬; canon — 神谷 not villain, summary's bias is plausible-not-random, `K.` still too vague, 外包 down-weighted not yet formal; assets-disabled; depict rebuttals losing without an interactive fail-loop; self-check).
- [ ] **Step 2: Append manifest** → `6. scene_5.md`.
- [ ] **Step 3: GREEN gate** — `OK — 1 chapter(s), 6 scene(s).`
- [ ] **Step 4: REVIEW gate** — review subagent over `scene_5.md`.

---

### Task 6: Beat 6 — `scene_6.md` (linear)

**Files:**
- Create: `docs/stories_plan/chapter_1/scene_6.md`
- Modify: `chapter.md` (append `7. scene_6.md`)

**Content (施工圖 699–760):** breather 商店街避雨. 6A 便利店屋簷 (早坂 紙本收據; sorts data into three piles — 人說的話 / 店裡留下的物 / 系統排好的摘要 — shown via 貼紙/收據/分堆, NOT a thesis speech). 6B 濕傘套路人 (visual bridge, not new evidence, 相馬 不立刻推理). 6C 片瀨 末班車錯覺 optional (estimate-time ≠ lying). **No evidence (linear).** 不要做 752–756. Outro: 相馬 decides to re-walk 雨鐘, not re-read summary.

- [ ] **Step 1: Dispatch writing subagent** (`writing-detective-game-dialogue` first; 699–760 excerpt; 早坂 voice; canon + 不要做; assets-disabled; self-check).
- [ ] **Step 2: Append manifest** → `7. scene_6.md`.
- [ ] **Step 3: GREEN gate** — `OK — 1 chapter(s), 7 scene(s).`
- [ ] **Step 4: REVIEW gate** — review subagent over `scene_6.md`.

---

### Task 7: Beat 7 — `investigation_scene_7.md` (investigation)

**Files:**
- Create: `docs/stories_plan/chapter_1/investigation_scene_7.md`
- Modify: `chapter.md` (append `8. investigation_scene_7.md`)

**Declares evidence:** `amemiya_message_thumb`, `floor_water_drying_map`, `wet_umbrella_sleeve`, `coffee_last_cup_record`, `old_clock_photo`, `victim_phone_notification`, `murder_weapon_candidate`, `forensic_prelim_range`, `miyake_pov_replay` (each `#### On Collect`).

**Structure (施工圖 764–918):** 7A 雨宮匿名訊息 (「雨會替東京洗掉腳印」+ low-res 裁切圖 `preview_cache/contractor_thumb/low-res`; arrives only AFTER police imported the storage-entrance photo — not a pre-crime prophecy; 早坂 798; do NOT discuss 雨宮 identity; message does NOT say "look at water marks") → `amemiya_message_thumb`. 7B 回到後場門口 → `floor_water_drying_map` + `wet_umbrella_sleeve`. 7C 咖啡機最後出杯 → `coffee_last_cup_record` (proves 增田 waited for a 2nd person & 會面 earlier than summary; NOT death-minute; use 821–822). 7D 內側倉庫 → `old_clock_photo` (~22:59, can't alone anchor), `victim_phone_notification` (~22:58), `murder_weapon_candidate` (金屬咖啡豆罐 擦拭痕+凹痕), `forensic_prelim_range` (黑瀨 briefing only — death-type + range, not a precise timer). 7E 三宅視角 replay → `miyake_pov_replay` (操作 shows 23:06 站位 sees 清潔架/蛋糕盒/防火門/高貨架陰影, does NOT see 倒下位置/舊掛鐘/血跡; NOT a full alibi). 7F 店長 23:20 replay (recovers Beat 3 白板/紀錄冊; 感應燈, 高貨架後 露出 鞋尖 — narrative, no new evidence). 7G 聲音同步點 (backflush + 抽屜/硬幣盤 only).

**Unlock graph:** an entry sub-location (e.g. `後場門口 {#back_door}`) unlocked; inspecting hotspots Reveals deeper sub-location `內側倉庫 {#inner}`; replays as hotspots/narrative. Acyclic; one inbound Reveals per locked block; all evidence On Collect. Outro: summary 的死亡/進入時間線 unstable, 第三者 earlier-entry possible.

- [ ] **Step 1: Dispatch writing subagent** (`writing-investigation-scene` first; 764–918 excerpt; the 9 evidence IDs + On-Collect sites; unlock graph; canon + 不要做 909–913 — 雨宮 訊息 not "look at water," coffee not death-time alone, 三宅 replay only proves sight-line not full alibi; assets-disabled; self-check).
- [ ] **Step 2: Append manifest** → `8. investigation_scene_7.md`.
- [ ] **Step 3: GREEN gate** — `OK — 1 chapter(s), 8 scene(s).`
- [ ] **Step 4: REVIEW gate** — review subagent over `investigation_scene_7.md`.

---

### Task 8: Beat 8 — `investigation_scene_8.md` (investigation)

**Files:**
- Create: `docs/stories_plan/chapter_1/investigation_scene_8.md`
- Modify: `chapter.md` (append `9. investigation_scene_8.md`)

**Declares evidence:** `local_sequence_record`, `maintenance_mode_note`, `external_maintenance_credential`.

**Structure (施工圖 921–1009):** 8A 店長手機截圖 as lead (Event-1841 Maintenance ON / 1842 External Maintenance Credential back-door / 1843 Staff Credential rear corridor / 1844 Sync Completed; NO precise seconds, NO full names). 8B 保全鏈固定 — 黑瀨/鑑識 re-photograph & fix the panel into the formal `local_sequence_record` (device ID, 機身編號, 頁面版本, 畫面時間, Event order); 店長手機截圖 is only a lead. 8C 店方知識邊界 → `maintenance_mode_note` (店長 968 line — she only checks if door stuck / mode off; not a 幾點幾分 judge). 8D 第三者成立 → `external_maintenance_credential` (Event-1842 earlier than 三宅 1843); but NOT complete raw, 23:07:50 is not the local-saved seconds; do NOT yet prove 合併時間 (Beat 10) and do NOT yet name 北見. 錯誤選擇: "KAGAMI 造假"→只有 摘要讀法 may be wrong; "立刻指北見"→憑證 not yet matched to a person.

**Unlock graph:** entry sub-location (店長辦公角落/門鎖維護頁) unlocked; the截圖 hotspot Reveals the 保全鏈-fixed record; acyclic. Outro: 第三者事件 confirmed, identity still missing.

- [ ] **Step 1: Dispatch writing subagent** (`writing-investigation-scene` first; 921–1009 excerpt; the 3 evidence IDs + On-Collect sites; unlock graph; canon — lead vs program-fixed record, no seconds, no 北見 yet, no 合併時間 proof yet, 店長 not engineer; assets-disabled; self-check).
- [ ] **Step 2: Append manifest** → `9. investigation_scene_8.md`.
- [ ] **Step 3: GREEN gate** — `OK — 1 chapter(s), 9 scene(s).`
- [ ] **Step 4: REVIEW gate** — review subagent over `investigation_scene_8.md`.

---

### Task 8.5: Beat 8.5 — `scene_8_5.md` (linear)

**Files:**
- Create: `docs/stories_plan/chapter_1/scene_8_5.md`
- Modify: `chapter.md` (append `10. scene_8_5.md`)

**Content (施工圖 1012–1070):** 整理點 (NOT a new-clue beat). 早坂 sorts evidence into three columns — 三宅小謊 / 第三者動線 / 門鎖時序. 黑瀨/早坂 note 母親通話紀錄 now program-fixed (待確認→正式) narratively. 相馬 states what's proven (1040–1043). Use the 1047–1049 exchange ("只證明三宅不該被放在那個時間 / 還沒證明誰該被放回去 / 把那個空位填上"). **No evidence/refs (linear).** 不要做 1061–1065 (no new foreshadow, no theme金句, no new 雨宮 message). Outro: decide to chase 外包工單/檢舉草稿/`K.`.

- [ ] **Step 1: Dispatch writing subagent** (`writing-detective-game-dialogue` first; 1012–1070 excerpt; 相馬/早坂 voices; canon + 不要做; assets-disabled; one H1 `# Scene 8.5: 短暫誤判整理點`; self-check).
- [ ] **Step 2: Append manifest** → `10. scene_8_5.md`.
- [ ] **Step 3: GREEN gate** — `OK — 1 chapter(s), 10 scene(s).` (If `scene_8_5` errors on the underscore-number, rename to `scene_85.md` and fix the manifest line.)
- [ ] **Step 4: REVIEW gate** — review subagent over the file.

---

### Task 9: Beat 9 — `investigation_scene_9.md` (investigation)

**Files:**
- Create: `docs/stories_plan/chapter_1/investigation_scene_9.md`
- Modify: `chapter.md` (append `11. investigation_scene_9.md`)

**Declares evidence:** `kitami_external_access`, `temp_maintenance_workorder`, `masuda_whistleblower_draft`, `kitami_data_theft_record`, `masuda_unsent_memo`, `contractor_umbrella_sleeve_match`.

**Structure (施工圖 1073–1204):** 9A 外包辦公室/承包商窗口 — procedural source explicit (黑瀨 requests cooperation as field 刑警; 早坂 applies on the 審查會-confirmed contradictions; contractor gives only 後場門鎖 22:50–23:10 limited data) → `temp_maintenance_workorder`, `kitami_external_access` (北見 is the person who could use the credential that night; other K-代號 exist but the workorder+credential finally match 北見). 9B 增田 低調自保 → `masuda_unsent_memo` (「22:50 雨鐘 / 校驗値確認 / K」, from 死者手機鑑識 same batch; NOT a dead-man switch). 9C 檢舉草稿 → `masuda_whistleblower_draft` + the 異常存取整理表 formalized as `kitami_data_theft_record` (北見 帳號 多次非排班接觸試點資料, 部分匯出外包中轉載具; proves 盜賣嫌疑 not final buyer); 承包商資材包 透明傘套 尺寸/折線 matches 後場 濕傘套 → `contractor_umbrella_sleeve_match` (傘套 alone does NOT convict — turns the earlier-entrant from 一般客人 to 承包商動線; person still needs 工單+憑證). 9D 北見質問 (撫平名片折角/擦眼鏡/避「買家是誰」/「規則從來不是寫給我們這種人看的」; no long social essay, no whitewash). 9E 當夜壓力 (檢舉草稿已存監察信箱草稿區; 北見 帳號 隔天 合約審核/權限回收 — institutional pressure, not 主線黑幕).

**References:** may Reveal/use Beat 7 `wet_umbrella_sleeve` and Beat 8 `external_maintenance_credential` as comparison anchors — both declared upstream. Character 北見 with 質問 topics. **不要做 1193–1199:** no A-90, no 青葉, no 鏡原, no 第零證人, no 神秘買家 threat.

**Unlock graph:** entry sub-location (承包商窗口) unlocked; hotspots Reveal deeper items + 北見 topics; acyclic; one inbound Reveals per locked block; all evidence On Collect. Outro: 第三者 收束到 北見, ready for final 審查會.

- [ ] **Step 1: Dispatch writing subagent** (`writing-investigation-scene` first; 1073–1204 excerpt; the 6 evidence IDs + On-Collect sites; allowed upstream refs `wet_umbrella_sleeve`,`external_maintenance_credential`; 北見 character/topics; canon + 不要做; assets-disabled; self-check).
- [ ] **Step 2: Append manifest** → `11. investigation_scene_9.md`.
- [ ] **Step 3: GREEN gate** — `OK — 1 chapter(s), 11 scene(s).`
- [ ] **Step 4: REVIEW gate** — review subagent over `investigation_scene_9.md`.

---

### Task 10: Beat 10 — `interrogation_scene_10.md` (interrogation, the payoff)

**Files:**
- Create: `docs/stories_plan/chapter_1/interrogation_scene_10.md`
- Modify: `chapter.md` (append `12. interrogation_scene_10.md`)

**Declares evidence:** `approved_clip` (obtained mid-審查會, gated after Phases 1–3). **Declares statements:** `summary_miyake_most_credible`, `summary_death_after_miyake`, `summary_could_still_be_miyake`, `summary_doorlock_authentic`, `summary_cannot_prove_kitami`.

**Structure (施工圖 1207–1338):** 5 testimony phases, each = a summary claim (statement) contradicted by the ledger's evidence, with results revealing the next:
- P1 `summary_miyake_most_credible` ← `closing_routine` + `cake_box` + `miyake_mother_call_log` (小謊 ≠ 殺人).
- P2 `summary_death_after_miyake` ← `victim_phone_notification` + `old_clock_photo` + `murder_weapon_candidate` + `forensic_prelim_range`; `coffee_last_cup_record` aux only.
- P3 `summary_could_still_be_miyake` ← `miyake_pov_replay` + `floor_water_drying_map` + `wet_umbrella_sleeve` + `backroom_floorplan`.
- 10E 程序攻防: 神谷 only grants 限定調出 AFTER P1–P3 establish concrete contradictions → that gate is where `approved_clip` is collected (後場門鎖 / 22:50–23:10 / 事件序號 / 憑證類型 / 同步時間 / 保全鏈標記). The clip must NOT be obtainable before the proof order reaches it.
- P4 `summary_doorlock_authentic` ← `local_sequence_record` + `approved_clip` + `doorlock_summary_timetable` (23:07:50 is sync/merge time, not 三宅's event time). Use 神谷/相馬 1279–1282 lines.
- P5 `summary_cannot_prove_kitami` ← `external_maintenance_credential` + `temp_maintenance_workorder` + `kitami_external_access` + `masuda_whistleblower_draft` + `kitami_data_theft_record` + `masuda_unsent_memo` + `two_coffee_order` + `contractor_umbrella_sleeve_match`.
- 10H 最終一句: 神谷「那錯的是什麼？」/ 相馬「我們太快替它補上了意思。」(chapter's 2nd & last theme line; no extra金句).

**All P1–P5 contradiction evidence is declared in Tasks 3/4/7/8/9; `approved_clip` declared here.** 錯誤選擇 table 1328–1333. Outro: 北見 指出, 三宅 洗清, 審查會 保住 重新調查.

- [ ] **Step 1: Dispatch writing subagent** (`writing-interrogation-scene` first; 1207–1338 excerpt; the 5 statement IDs + their exact contradiction-evidence lists from the ledger; `approved_clip` declared here and gated to Phase 4–5 (procedure-after-contradiction); canon — 門鎖 not faked, system error is over-trusted preference not evil; assets-disabled; self-check incl. "every contradiction id resolves to an upstream declaration, approved_clip not reachable before its gate").
- [ ] **Step 2: Append manifest** → `12. interrogation_scene_10.md`.
- [ ] **Step 3: GREEN gate** — `bun run scenes:compile` → `OK — 1 chapter(s), 12 scene(s).` This is the load-bearing compile: if any P1–P5 evidence/statement ID doesn't resolve, fix the referencing line to match the ledger ID (do not invent a new evidence — it must be the upstream one).
- [ ] **Step 4: REVIEW gate** — review subagent over `interrogation_scene_10.md`, explicitly checking the proof-order gating and that no forbidden item (藍傘/金木犀/`ZW_A16`/90秒) entered the proof order.

---

### Task 11: Beat 11 — `scene_11.md` (linear)

**Files:**
- Create: `docs/stories_plan/chapter_1/scene_11.md`
- Modify: `chapter.md` (append `13. scene_11.md`)

**Content (施工圖 1341–1446):** 11A 雨鐘收拾後 (三宅 收拾, 店長 暫停營業幾週, 三宅「常替店裡跑外送」, 試做 金木犀拿鐵 太甜, 相馬 手停半拍 but drinks it, 早坂「證據顯示，他還需要練習」; 金木犀 only 手停半拍 — no headache/flashback/青葉). 11B 店內空鏡 (金木犀香味, 舊掛鐘 放進紙箱 又停一下, 傘架 邊緣 only). 11C 事務所夜晚/USB (`ZW_A16.lock`, 權限不足; 早坂「北見的資料？」/相馬「不像。」; do NOT decode ZW, no Aoba). 11D 雨宮來源排除 (北見 手機/電腦/外包帳號 都不是匿名來源; no chasing 雨宮). 11E 最後空鏡 (雨停; 藍色透明傘 仍在; 1415–1416 lines). **No evidence (linear).** 不要做 1435–1441. Outro: 案件滿足感 + 主線不安.

- [ ] **Step 1: Dispatch writing subagent** (`writing-detective-game-dialogue` first; 1341–1446 excerpt; 相馬/早坂/三宅/店長 voices; canon — `ZW_A16.lock` shown but not decoded, 藍傘 not evidence, 金木犀 only 手停半拍, no new 雨宮 message; assets-disabled; one H1 `# Scene 11: 結案後日常與章末鉤子`, the five 空鏡/sub-scene `[場景：]` tags; self-check).
- [ ] **Step 2: Append manifest** → `13. scene_11.md`.
- [ ] **Step 3: GREEN gate** — `bun run scenes:compile` → `OK — 1 chapter(s), 13 scene(s).`
- [ ] **Step 4: REVIEW gate** — review subagent over `scene_11.md`.

---

### Task 12: Whole-chapter consistency pass and report

**Files:**
- Read/verify: all 13 scene files + `chapter.md`.

- [ ] **Step 1: Full compile** — `bun run scenes:compile` → `OK — 1 chapter(s), 13 scene(s).`
- [ ] **Step 2: Compiler tests sanity** — `bun test scripts/compile-scenes*.test.ts` → all pass (no compiler code changed).
- [ ] **Step 3: Chapter-wide review subagent** — dispatch a final review subagent over the full Chapter 1 (0–11) for cross-beat arc consistency: the three 證據包 (三宅小謊 / 第三者動線 / 門鎖時序) each pay off; no forbidden item in proof order; the Appendix-A transition hooks land; 雨宮/`ZW_A16`/藍傘/90秒 all left unresolved per Beat 11.
- [ ] **Step 4: Report** — files written, the `OK — 1 chapter(s), 13 scene(s).` line, review verdicts, and the `docs/` draft caveat. Commit only if the user asks (branch off `main`).

---

## Self-Review

**Spec coverage (施工圖 beats):** Beat 2→Task 2, 3→Task 3, 4→Task 4, 5→Task 5, 6→Task 6, 7→Task 7, 8→Task 8, 8.5→Task 8.5, 9→Task 9, 10→Task 10, 11→Task 11; chapter-wide arc→Task 12. ✓ Beats 0–1 already shipped (out of scope here, already in manifest). ✓

**Engine-constraint coverage:** every evidence/statement the interrogations reference is declared upstream — Beat 10 P1 (`closing_routine`/`cake_box`/`miyake_mother_call_log` ← T3/T4), P2 (T7), P3 (T7+`backroom_floorplan` T3), P4 (`local_sequence_record` T8 / `approved_clip` T10 / `doorlock_summary_timetable` T3), P5 (T8/T9 + `two_coffee_order` T3). Beat 4 contradictions (`cctv_screenshot`/`closing_routine`) ← T3. So Task order 3→4 and 3/4/7/8/9→10 is a hard dependency; the plan authors them in that order. ✓

**Placeholder scan:** no "TBD"/"handle edge cases"; every task names exact file, exact IDs declared, contradiction map, and 施工圖 line range for prose. Prose is sourced (not duplicated) by line range — deliberate DRY, the 施工圖 is the canonical text. ✓

**ID consistency:** evidence/statement IDs in the two ledgers are referenced verbatim in Tasks 3/4/7/8/9/10; declaration site is unique per ID (each appears once in a "Declares" line). `scene_8_5` filename fallback noted. Manifest numbering 3→13 matches append order and final playable order. ✓

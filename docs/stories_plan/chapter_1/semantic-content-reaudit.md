# Chapter 1 semantic content re-audit

## Frozen production manifest

The Chapter 1 production manifest is frozen for this re-audit. Its exact ordered scene list is:

1. `scene_p0.md`
2. `scene_p1.md`
3. `scene_p2.md`
4. `scene_0.md`
5. `investigation_scene_1.md`
6. `scene_2.md`
7. `investigation_scene_3.md`
8. `interrogation_scene_4.md`
9. `scene_5.md`
10. `scene_6.md`
11. `investigation_scene_7.md`
12. `investigation_scene_8.md`
13. `scene_8_5.md`
14. `investigation_scene_9.md`
15. `interrogation_scene_10.md`
16. `scene_11.md`

There is no manifest-listed production analysis scene at this checkpoint. No analysis content was manufactured for this re-audit.

## Initial seven-axis review

## Review Report: Chapter 1 《雨鐘咖啡館殺人事件》

**Subagent axes:** Canon, Forbidden, Voice, style, narration & expression, Continuity, Visual Background, Investigation Interaction Balance, Natural Conversation — all completed.

**Axis verdicts:** Axis 1 `SHIP`; Axis 2 `SHIP`; Axis 3 `FIX-RECOMMENDED`; Axis 4 `FIX-RECOMMENDED`; Axis 5 `FIX-RECOMMENDED`; Axis 6 `FIX-RECOMMENDED`; Axis 7 `FIX-RECOMMENDED`.

### Verdict: FIX-RECOMMENDED

### Findings

Important — `docs/stories_plan/chapter_1/investigation_scene_1.md:17` — `「把每件事擺到該在的位置，至少能少傷到一個人。」` gives 相馬 a polished moral maxim during his opening self-talk, rather than his specified short, unshowy practical voice. `docs/stories_plan/characters.md:42-44` says his conclusions are short and he does not make pretty speeches; the addendum repeats “不說漂亮大話” (`docs/stories_plan/chapter_1/chapter1_actual_writing_agent_addendum.md:225-242`), and the base format requires natural, direct character voice (`.claude/skills/writing-detective-game-dialogue/SKILL.md:32`). Suggested fix: reduce this beat to one concrete, practical self-check and let the already-bracketed filing action carry the orderliness.

Important — `docs/stories_plan/chapter_1/investigation_scene_3.md:68` — the bracketed direction says `「撐著店靠的是慣性多於精力」`, an unobservable judgment about 高瀨’s inner motivation rather than visible action/state. Brackets are reserved for facial expression, body language, atmosphere, and prop movement (`.claude/skills/writing-detective-game-dialogue/SKILL.md:34`); 高瀨’s source voice is everyday and life-based (`docs/stories_plan/characters.md:99-103`). Suggested fix: retain only observable tired posture/counter-wiping in the bracket, and let a short everyday 高瀨 line establish the habit or burden.

Important — `docs/stories_plan/chapter_1/interrogation_scene_4.md:84` — `「……那時候我躲在員工休息區，偷偷打給我媽。值班不能打私人電話，我怕被說，才沒講。」` is 三宅’s first material admission, but it defaults to `standard` despite the configured `strained` portrait being specifically tense and trying not to panic (`static/assets/config/characters.yaml:79-91`). Expression syntax supports a configured slug and otherwise defaults to standard (`.claude/skills/writing-detective-game-dialogue/SKILL.md:128`). Suggested fix: put `[strained]` on this first breakthrough line only, then leave the following lines standard so the scene gains one meaningful turn without expression flicker.

Important — `docs/stories_plan/chapter_1/interrogation_scene_10.md:192` — `「範圍限定：後場門鎖、二十二點五十到二十三點十、事件序號、憑證類型、同步時間、保全鏈標記。只調這幾欄，不碰範圍外的任何資料。」` reads as a six-field system lecture from 早坂. The addendum says technical dialogue should stay with the player-facing terms 摘要／本機順序／核准片段 and avoid technical terminology lists (`docs/stories_plan/chapter_1/chapter1_actual_writing_agent_addendum.md:54-68`); 早坂 is also explicitly not the explanatory-narrator role (`docs/stories_plan/characters.md:50-52`, `docs/stories_plan/chapter_1/chapter1_actual_writing_agent_addendum.md:246-263`). Suggested fix: state the narrow procedural purpose in plain language and leave the field inventory to the approved-record UI/evidence text.

Important — docs/stories_plan/chapter_1/scene_0.md:50-52 — The direct hand-off says, 「鏡頭移開——畫面切到相馬律的事務所，辦公桌。」 and then labels that desk scene 「午後」, but the immediately following authored scene opens at `docs/stories_plan/chapter_1/investigation_scene_1.md:7` with 「相馬事務所外，清晨，細雨。」 The planned Beat 0 → Beat 1 bridge is specifically the summary cutting to Soma's desk copy (`docs/stories_plan/chapter_1/chapter1_final_result_plan.md:1888`), so the unstated afternoon-to-morning reversal makes the transition read as a continuity jump. Suggested fix: label Scene 1 as the following morning, or use matching time-of-day tags at the two sides of the cut.

Important — docs/stories_plan/chapter_1/investigation_scene_3.md:205 — The planted object is 「走廊牆上那個舊掛鐘」 (also 「走廊那個舊掛鐘」 at line 222), but its payoff relocates it to 「內側倉庫，……深處有一台停擺的舊掛鐘」 in `docs/stories_plan/chapter_1/investigation_scene_7.md:160` and treats it as an `inner`-sublocation evidence source at line 367. The plan seeds the clock during Beat 3 (`docs/stories_plan/chapter_1/chapter1_final_result_plan.md:831-835`) and pays it off in the Beat 7 inner-storage investigation (`docs/stories_plan/chapter_1/chapter1_final_result_plan.md:1256-1265`); without a stated move or sightline, the player cannot reliably recognize the examined clock as the planted one. Suggested fix: choose one consistent location (for example, the inner-storage wall visible from the corridor) and align the Scene P2, Scene 3, and Scene 7 descriptions to it.

Important — docs/stories_plan/chapter_1/investigation_scene_3.md:455 — The first investigation ends only with 「先回去整理。今天看到的，比想像中多。」, while `docs/stories_plan/chapter_1/interrogation_scene_4.md:7` next opens with 三宅 already alone in a police waiting area. The prescribed Beat 3 → Beat 4 hand-off is 「現場證據指向三宅，但 routine 讓人不安 | 去問三宅」 (`docs/stories_plan/chapter_1/chapter1_final_result_plan.md:1891`), but no authored line carries the team from the café to an arranged inquiry. Suggested fix: add one brief hand-off that 黑瀨 has arranged the police inquiry, either in Scene 3's outro or Scene 4's intro.

Important — `docs/stories_plan/chapter_1/investigation_scene_8.md:100` — “從後場辦公角落望出去，能隱約看見前場門邊那座傘架” has no visual target in the selected plate; the action says the view goes “穿過走廊” to “那把藍色透明傘” at `docs/stories_plan/chapter_1/investigation_scene_8.md:102`, and the later declaration that the photographed electrical panel is “同一面板” at `docs/stories_plan/chapter_1/investigation_scene_8.md:171` breaks that location’s visual continuity. Runtime binds the office corner to `backgroundAssetId` at `apps/game/src-tauri/resources/scenes/chapter_1/investigation_scene_8.json:242` and the later sub-location to its distinct `backgroundAssetId` at `apps/game/src-tauri/resources/scenes/chapter_1/investigation_scene_8.json:785`; the compiled asset manifest maps those fields to `office_corner.png` and `fixed_panel.png` at `apps/game/src-tauri/resources/assets/manifest.json:1586` and `apps/game/src-tauri/resources/assets/manifest.json:1604`. The first plate is an enclosed office with no corridor/front umbrella stand, while the second depicts an open electrical panel rather than the office wall monitor. — Regenerate or recompose these two plates around a common, recognizable maintenance-panel anchor and make the corridor/blue umbrella visible from the office corner; alternatively rewrite the umbrella hint and “same panel” language to match the existing distinct views.

Important — docs/stories_plan/chapter_1/investigation_scene_7.md:98-102; docs/stories_plan/chapter_1/investigation_scene_7.md:146-154; docs/stories_plan/chapter_1/investigation_scene_8.md:197-215 — **Chapter-wide aggregate starvation:** direct package support is 37/58 (64%), while life is only 9/58 (16%) and atmosphere/foreshadowing only 7/58 (12%). The concentration is visible in consecutive case-solving interactions: “這個還是濕的。比地上的水痕新。”; “最後一筆出杯。兩杯，間隔很短。” / “增田在等人。而且那個人，比摘要說的更早就到了。”; and “Event-1842 是外包憑證，後門開。” / “Event-1843 才是三宅的員工憑證。” These directly advance the third-party route and lock-sequence packages, rather than supplying the missing everyday or atmospheric texture. This is materially outside the required chapter-total distribution — “破案資訊 40%”, “角色生活資訊 30%”, “氣氛與伏筆 20%”, “錯誤焦點 / 紅鯡魚 10%” — and the addendum explicitly says the ratio is assessed across the chapter, not per scene ([chapter1_actual_writing_agent_addendum.md:78-87](chapter1_actual_writing_agent_addendum.md#L78-L87)). Minimal fix: convert roughly 10–12 redundant direct-evidence/route responses across Scenes 3, 7, and 9 into standalone character-life or shop/rain/umbrella responses, retaining each required evidence carrier and the existing five red-herring points rather than adding new evidence or mechanics.

- Important — `docs/stories_plan/chapter_1/scene_p1.md:32` — After two brief solo setup lines, the 82-spoken-line linear mini-case enters immediately into the dispute: **「我跟你說了多少次——」**. Its identifiable partner-life beat does not arrive until `scene_p1.md:258`, **「你連這種小事都留？」**, after the long receipt deduction. That leaves this linear transition well below the required 25% non-case dialogue (`docs/stories_plan/chapter_1/chapter1_actual_writing_agent_addendum.md:401`). Suggested fix: move or add a concise, familiar 相馬／早坂 everyday exchange before the shop dispute and compact a few repeated deduction lines so the off-case share reaches the stated minimum.

- Important — `docs/stories_plan/chapter_1/scene_6.md:37` — The designated breathing beat turns into a spoken evidence recap: **「別急著想答案。先把東西分開放。」**, followed by **「人說的話。」／「店裡留下的東西。」／「系統排好的摘要。」** (`scene_6.md:41`, `scene_6.md:45`, `scene_6.md:49`) and then a witness interview. Even crediting the initial coffee/lunch exchange and 片瀨's brief arrival as non-case grounding, it supplies only 10 of 40 spoken lines—below the 30% requirement for genuine fatigue, emotion, or personal talk (`docs/stories_plan/chapter_1/chapter1_actual_writing_agent_addendum.md:404`). Suggested fix: add 2–4 lines of actual rest or working-history talk before the evidence sorting, or trim the recap by the same amount.

- Important — `docs/stories_plan/chapter_1/scene_8_5.md:51` — The other designated breathing point is likewise dominated by a case summary: **「第一欄，三宅小謊。第二欄，第三者動線。第三欄，門鎖時序。」**. It then has 相馬 enumerate the proof state (`scene_8_5.md:73`, **「現在到底證明了什麼，一條一條講。」**; `scene_8_5.md:75`) and plans the next leads through `scene_8_5.md:125`. The clearest non-case material is only 13 of 50 spoken lines (`scene_8_5.md:11`, `scene_8_5.md:23`–`scene_8_5.md:45`, `scene_8_5.md:135`–`scene_8_5.md:137`), below the required 30% real-rest threshold (`docs/stories_plan/chapter_1/chapter1_actual_writing_agent_addendum.md:404`). Suggested fix: replace a few recap/planning lines with 2–4 concrete food, sleep, or work-history beats between the partners; retain the existing evidence board but make it subordinate to the pause.

### Strengths

- The victim, apparent suspect, and true culprit remain exact and distinct: the scenes identify 增田圭 as the victim and 三宅蒼太 as the initial suspect, then correctly resolve 北見修一 as the culprit, matching the bible's Chapter 1 case definition (`docs/stories_plan/tokyo_rain_witness_final_story_bible_v64.md:952-964`) and roster entries (`docs/stories_plan/characters.md:74-95`).
- The critical time evidence is framed consistently: 增田's `22:50` memo is kept separate from the `22:52` maintenance event (`docs/stories_plan/chapter_1/investigation_scene_9.md:206-216`), and the eventual reading preserves the bible's distinction between local event order and server-combined time (`docs/stories_plan/tokyo_rain_witness_final_story_bible_v64.md:970-983`; `docs/stories_plan/chapter_1/interrogation_scene_10.md:318-322`).
- The Chapter 1 locations and participant roster stay within the authorized setup: 吉祥寺の雨鐘, its staff, the KAGAMI review process, and the anonymous 雨宮 clue all align with the bible's Chapter 1 setting and prescribed early reveal boundaries (`docs/stories_plan/tokyo_rain_witness_final_story_bible_v64.md:942-998`; `docs/stories_plan/characters.md:123-143`).
- The 89.7-second detail stays within the expressly allowed visible form (`scene_0.md:30`; addendum `chapter1_actual_writing_agent_addendum.md:506-507`) and is not named as A-90 or tied to its sealed origin (bible `tokyo_rain_witness_final_story_bible_v64.md:263-275`).
- The anonymous 雨宮 message remains an anonymous message plus low-resolution cropped thumbnail (`investigation_scene_7.md:50-86`, `307-320`), without identifying her, explaining system access, or confirming her intent, as required by the addendum (`chapter1_actual_writing_agent_addendum.md:509-512`).
- The blue transparent umbrella is only shown and explicitly left untouched/unexplained (`investigation_scene_3.md:88-93`; `scene_11.md:170-174`), matching the permitted presentation and the ban on examination or formal-evidence treatment (`chapter1_actual_writing_agent_addendum.md:514-517`).
- 金木犀 is limited to the allowed latte/sensory beat (`scene_11.md:44-60`, `79-81`), with no headache, flashback, trauma explanation, or deduction (`chapter1_actual_writing_agent_addendum.md:519-522`).
- `ZW_A16.lock` is displayed only as an inaccessible filename and is not decoded, split, or connected to 青葉／第零證人 (`scene_11.md:114-136`; addendum `chapter1_actual_writing_agent_addendum.md:524-527`; bible `tokyo_rain_witness_final_story_bible_v64.md:985-1007`).
- 相馬’s scene-long development is generally well controlled: the later material moves from trusting the summary to practical, evidence-led corrections rather than turning him into an instant anti-KAGAMI crusader. His actions repeatedly carry his orderliness, which is the intended characterization (`docs/stories_plan/characters.md:40-44`).
- 早坂, 神谷, 黑瀨, 三宅, 北見, 高瀨, 片瀨, and 三宅母親 are broadly distinct in register: early practical/procedural pressure for 早坂, clean counterarguments for 神谷, ground-level field speech for 黑瀨, fragmented restraint for 三宅, and brief pressured admissions for 北見. These align with the respective voice guides (`docs/stories_plan/characters.md:48-68`, `docs/stories_plan/characters.md:76-88`, `docs/stories_plan/chapter_1/chapter1_actual_writing_agent_addendum.md:244-345`).
- Existing non-standard expression use is catalog-valid and selective rather than flickering: 三宅母親’s `[strained]` at `docs/stories_plan/chapter_1/scene_2.md:31` is configured at `static/assets/config/characters.yaml:36-40`; 早坂’s `[stern]` at `docs/stories_plan/chapter_1/scene_2.md:147` is configured at `static/assets/config/characters.yaml:22-26`; 高瀨’s `[tired]` at `docs/stories_plan/chapter_1/investigation_scene_3.md:74` and `:224` is configured at `static/assets/config/characters.yaml:61-65`.
- Outside the one narration-assignment finding, physical beats, atmosphere, and props are consistently placed in brackets, while spoken conclusions and present-character judgments are usually left in dialogue as required by the base format (`.claude/skills/writing-detective-game-dialogue/SKILL.md:26-35`).
- The three required packages from `chapter1_final_result_plan.md:68-70` are present and converge cleanly: the small-lie chain runs from the closing routine and Scene 4 revelations to the formalized call-log recap and final hearing; the third-party chain runs from `K.` and water evidence through the local sequence, work order, and credential; and the lock-timing chain runs from the Scene 0 merge-delay flash to the fixed local order and approved clip.
- The closing-SOP / unconfirmed-record-book seed lands particularly well: Scene 3 makes the unfinished item visible (`investigation_scene_3.md:305-319`), then Scene 7 uses it to explain the 23:20 discovery (`investigation_scene_7.md:247-257`).
- The authored evidence and unlock trace is internally complete: every `evidence:` reference in the supplied scene set resolves to a corresponding evidence manifest, and the applicable inquiry phases and sub-location unlocks point to declared targets.
- Long-game seeds stay legible without being prematurely resolved: the rain/umbrella visual bridge reaches the contractor-sleeve comparison, while the 雨宮 message and `ZW_A16.lock` are carried into the ending as intentionally unresolved hooks.
- Background completeness is strong: prompts, compiled IDs, and files align across the full frozen scope, and the fresh compiler run reported no `assetFileMissing` warning.
- The character catalog matches the compiled visual usage (14 portrait IDs and 5 standee IDs); the scene-specific expression choices are present in `static/assets/config/characters.yaml`.
- Existing variation is purposeful rather than duplicative: the café-exterior progression retains its awning/recycling-bin anchors while changing weather and activity, and the later hearing phases retain the hearing-room context while bringing the relevant case material into view.
- Most investigation views reserve clear floor and wall space for hotspots and speaker overlays while visibly supporting their named evidence/props.
- The error-focus bucket is close to target (5/58, 9%): the Katase register gap, the manager access/edit suspicion, the deeper-Miyake scuff, and the alternate `K` all give the player a brief wrong trail without becoming a new plot branch.
- The existing atmosphere points are appropriately non-diagnostic: the blue umbrella and osmanthus sign do not explain themselves (`investigation_scene_3.md:88-100`, `investigation_scene_8.md:99-112`).
- No individual life/atmosphere interaction was found to leak a case-breaking package conclusion. For example, the staff shelf stays with personal belongings and the workers’ small spaces (`investigation_scene_7.md:115-126`); the contractor clerk’s long-day topic stays with his routine and boundary (`investigation_scene_9.md:158-173`).
- The investigation openings otherwise meet the 2–3-line contextual requirement: Scene 1 establishes why early arrival matters and the partners' division of work before play (`docs/stories_plan/chapter_1/investigation_scene_1.md:21`–`docs/stories_plan/chapter_1/investigation_scene_1.md:25`), then gives them a familiar coffee-machine / previous-case exchange (`investigation_scene_1.md:83`–`investigation_scene_1.md:89`). This supplies the relationship and working-dynamic context §5.4 calls for (`chapter1_actual_writing_agent_addendum.md:393`–`chapter1_actual_writing_agent_addendum.md:395`).
- Both hearings have genuine pre-proceeding partner dialogue rather than launching straight into a phase: the three-step observation/strategy exchange in `interrogation_scene_4.md:13`–`interrogation_scene_4.md:21`, and the final hearing's strategy plus first-time reassurance in `interrogation_scene_10.md:13`–`interrogation_scene_10.md:15` and `interrogation_scene_10.md:29`–`interrogation_scene_10.md:31` satisfy the hearing direction in `chapter1_actual_writing_agent_addendum.md:403`.
- The 相馬／早坂 relationship has recurring familiarity and complementary practice, rather than only task delegation: the receipt habit in `scene_p1.md:258`–`scene_p1.md:268`, the post-hearing coffee/lunch care in `scene_6.md:15`–`scene_6.md:29`, and the final cafe banter in `scene_11.md:64`–`scene_11.md:70` fit 相馬's orderly insecurity and 早坂's practical, action-led voice (`docs/stories_plan/characters.md:40`–`docs/stories_plan/characters.md:50`).
- New recurring characters are generally dramatized as people rather than Bio entries: 三宅's ordinary latte order and the manager's teasing appear before the murder plot (`scene_p2.md:62`–`scene_p2.md:90`), while 黑瀨 is introduced through a previous-case exchange and an immediately human procedural boundary (`scene_5.md:204`–`scene_5.md:218`), consistent with the addendum's no-Bio-only rule (`chapter1_actual_writing_agent_addendum.md:425`–`chapter1_actual_writing_agent_addendum.md:432`).

## Resolution log

The initial review block above is preserved verbatim. The original frozen list was a 16-file checkpoint with no manifest-listed production analysis scene; that statement was true at the time and no analysis content was manufactured for that checkpoint.

After explicit user approval of the P1 structural remedy, the current production manifest was amended to 17 ordered files: `scene_p1.md` was replaced by `investigation_scene_p1.md` followed by `analysis_scene_p1_5.md`. The amendment is deliberately recorded rather than retroactively changing the historical freeze.

- Implemented the P1 investigate → compare tutorial: four P1-local `practice:` collectors, an isolated threshold board requiring receipt + register jam + ledger, visible CCTV wrong-choice feedback, and a non-Case-File notebook cleared on completion. The dormant analysis-scene runtime path, threshold-only UI/IPC, save/restore, and E2E checkpoint projection were enabled under focused tests; the public classify/order precautionary controls were removed under YAGNI review.
- Added `last_feedback` to the backward-compatible Analysis save snapshot after independent review found wrong-choice feedback was lost on restore. A real P1 CCTV-only save/restore regression now covers it.
- Reused existing P1 counter visual metadata for P1.5; no new plate, prompt design, asset, or layout was introduced. Relaxed unsupported old-clock continuous-sightline wording against the existing plates while preserving the slow-clock seed and stopped-clock payoff.
- Added a visible Scene 9 USB custody handoff (take, separately seal, send to forensics) before the ending. It supports Scene 11's evidence-bag retrieval without opening or explaining `ZW_A16.lock`.
- Corrected Axis 3/7 source and runtime-visible presentation findings: concrete Hayasaka P1 errand/non-takeover, narration/terminology cleanups, concise dialogue and all rendered metadata/action/tag carriers, including transition actions and backdrop scene tags. Current compiled JSON has no visible carrier over 100 Han.
- Preserved every required evidence package, unlock, phase, contradiction, proof order, reveal boundary, asset identity, and main-case timing contract through targeted writer and compiler checks.

### Per-finding resolution ledger

The following rows retain the original finding text verbatim at its material assertion, followed by the specific resolution evidence. There were no original Blocker findings.

| Original file:line | Original finding text | Disposition and exact evidence/change |
| --- | --- | --- |
| `investigation_scene_1.md:17` | `「把每件事擺到該在的位置，至少能少傷到一個人。」 gives 相馬 a polished moral maxim during his opening self-talk, rather than his specified short, unshowy practical voice.` | **Resolved.** The opening was reduced to a concrete practical self-check while the filing action carries his orderliness; final Axis 3 report `final-cycle-axis-3-voice-style.md` is `SHIP`. |
| `investigation_scene_3.md:68` | `「撐著店靠的是慣性多於精力」, an unobservable judgment about 高瀨’s inner motivation rather than visible action/state.` | **Resolved.** The bracket now carries only visible tired counter work and the everyday routine is spoken by 高瀨; final Axis 3 report is `SHIP`. |
| `interrogation_scene_4.md:84` | `三宅’s first material admission ... defaults to standard despite the configured strained portrait being specifically tense and trying not to panic.` | **Resolved.** The first admission selects `三宅蒼太[strained]`; the catalogued `strained.png` was added and final Axis 3/5 reports are `SHIP`. |
| `interrogation_scene_10.md:192` | `範圍限定 ...` `reads as a six-field system lecture from 早坂.` | **Resolved.** The player-facing gate language is limited to the approved plain-language purpose and the addendum’s UI vocabulary; final Axis 3 report is `SHIP`. |
| `scene_0.md:50-52` | `The direct hand-off ... labels that desk scene 「午後」, but the immediately following authored scene opens ... 「清晨」.` | **Resolved.** The transition now states the following-morning handoff consistently with the opening investigation context; final Axis 4 report is `SHIP`. |
| `investigation_scene_3.md:205` | `The planted object is 「走廊牆上那個舊掛鐘」 ... but its payoff relocates it to ... 「內側倉庫」.` | **Authored continuity fixed; raster regeneration deferred from HPA-561.** The false continuous-sightline claim was removed: the manager mentions the old clock in Scene 3, and Scene 7 explicitly identifies the same manager-mentioned clock with hands stopped near `22:59`. The coordinated raster regeneration and visual acceptance are deferred to a separately tracked follow-up and are not part of the HPA-561 gate (see descope amendment under Final seven-axis review). |
| `investigation_scene_3.md:455` | `The first investigation ends only with 「先回去整理。今天看到的，比想像中多。」, while ... 三宅 already [is] alone in a police waiting area.` | **Resolved.** A short 黑瀨-arranged inquiry handoff was added before the hearing; final Axis 4 report is `SHIP`. |
| `investigation_scene_8.md:100` | `從後場辦公角落望出去，能隱約看見前場門邊那座傘架 has no visual target in the selected plate.` | **Resolved.** The existing `front_doorway` now names the visible doorway/direction toward the front room and its existing authored rect was moved to the doorway (`investigation_scene_8.layout.json`); no plate or asset was replaced. This finding's Axis 5 rerun is `SHIP`; the axis-level verdict is `SHIP` within the HPA-561 scope (the old-clock raster acceptance is the only deferred item — see descope amendment under Final seven-axis review). |
| `investigation_scene_7.md:98-102; investigation_scene_7.md:146-154; investigation_scene_8.md:197-215` | `Chapter-wide aggregate starvation: direct package support is 37/58 (64%), while life is only 9/58 (16%) and atmosphere/foreshadowing only 7/58 (12%).` | **Resolved.** Targeted carriers were rebalanced without removing required packages; final Axis 6 reports 64 current carriers, with the main case at the required `24/18/12/6` split, and is `SHIP`. |
| `scene_p1.md:32` | `After two brief solo setup lines, the 82-spoken-line linear mini-case enters immediately into the dispute.` | **Resolved under explicit user approval of the structural remedy.** `scene_p1.md` was replaced by `investigation_scene_p1.md` plus `analysis_scene_p1_5.md`: four local practice points, early partner grounding, a threshold compare board, and explicit wrong-choice feedback. Final Axis 6/7 reports are `SHIP`. |
| `scene_6.md:37` | `The designated breathing beat turns into a spoken evidence recap.` | **Resolved.** The rest/partner-life beat was restored and the recap was compacted while preserving the evidence route; final Axis 7 report is `SHIP`. |
| `scene_8_5.md:51` | `The other designated breathing point is likewise dominated by a case summary.` | **Resolved.** The pause now retains concrete partner rest and working-history texture without changing proof progression; final Axis 7 report is `SHIP`. |

## Final seven-axis review

### Phase 4 consolidation

**Current production scope:** the user-approved 17-file manifest, in order:

1. `scene_p0.md`
2. `investigation_scene_p1.md`
3. `analysis_scene_p1_5.md`
4. `scene_p2.md`
5. `scene_0.md`
6. `investigation_scene_1.md`
7. `scene_2.md`
8. `investigation_scene_3.md`
9. `interrogation_scene_4.md`
10. `scene_5.md`
11. `scene_6.md`
12. `investigation_scene_7.md`
13. `investigation_scene_8.md`
14. `scene_8_5.md`
15. `investigation_scene_9.md`
16. `interrogation_scene_10.md`
17. `scene_11.md`

The initial 16-file/no-analysis record above remains a historical checkpoint. This final review audits the explicit post-freeze amendment.

> **Descope amendment (HPA-561 completion contract):** The coordinated old-clock raster regeneration and visual acceptance are **not** part of the HPA-561 completion gate. The authored-text clock continuity is already fixed (the false continuous-sightline claim was removed; Scene 3 seeds the clock and Scene 7 identifies the same manager-mentioned clock with hands stopped near `22:59`); only the raster regeneration + visual acceptance remain, and they are deferred to a separately tracked follow-up (see "Deferred follow-up — old-clock raster continuity" below). Within the HPA-561 scope, Axis 5 is therefore `SHIP` with that one deferred visual item recorded. The earlier `FIX-RECOMMENDED` verdict recorded the visual-pending fact accurately at the time; this amendment changes only its gate status for HPA-561, not the underlying finding.

**Final verdict: `SHIP` (HPA-561 scope) — old-clock raster continuity deferred to follow-up**

| Axis | Verdict | Findings retained verbatim | Final report |
| --- | --- | --- | --- |
| 1. Canon / Bible fidelity | `SHIP` | None. | `final-cycle-axis-1-canon.md` |
| 2. Forbidden knowledge / reveal boundaries | `SHIP` | None. | `final-cycle-axis-2-forbidden.md` |
| 3. Voice, style, narration, labels, expressions | `SHIP` | None. | `final-cycle-axis-3-voice-style.md` |
| 4. Cross-scene continuity | `SHIP` | None. | `final-cycle-axis-4-continuity-rerun.md` |
| 5. Visual/background/runtime assets | `SHIP` (HPA-561 scope; one deferred visual item — see descope amendment) | The old-clock raster regeneration and visual acceptance are deferred to a separately tracked follow-up and are not part of the HPA-561 gate. All other Axis 5 findings are resolved with fresh rerun evidence. | `final-cycle-axis-5-visual-background-rerun.md` |
| 6. Interaction balance | `SHIP` | None. | `final-cycle-axis-6-interaction-balance.md` |
| 7. Natural conversation / character flow | `SHIP` | None. | `final-cycle-axis-7-natural-conversation-rerun.md` |

### Final evidence summary

- All seven axes return `SHIP` within the HPA-561 completion scope. Axis 5's single outstanding visual item — the old-clock raster continuity between the `scene_p2` back-corridor slow-clock seed and the `scene_11` front-room stopped-clock payoff — is deferred to a separately tracked follow-up and is not a HPA-561 merge gate (see "Deferred follow-up — old-clock raster continuity" below).
- Compiler-based final checks resolve 17 source scenes with zero warnings. The visual audit resolves 55/55 background contexts and 123/123 asset references; the final carrier audit has zero runtime-visible payload over 100 Han.
- P1's four practice cards remain local to its board, its wrong-feedback state survives save/restore, and it never pollutes the main Case File.
- The final USB custody, authored clock continuity, P1.5 visual-cue, Scene 8 geometry, approved-clip, and merge-time chains have fresh rerun evidence after their fixes; the old-clock raster continuity is the only deferred item.

### Deferred follow-up — old-clock raster continuity

- **Item:** Regenerate the old-clock background plates so the slow-clock seed (`scene_p2` back corridor, `queue/16`) and the stopped-clock payoff (`scene_11` front room, `queue/32`) read as the same clock with hands stopped near `22:59`, then perform visual acceptance.
- **Status:** Deferred from HPA-561 by explicit user decision; not a HPA-561 merge gate.
- **Already complete (authored-text continuity):** the false continuous-sightline claim was removed; Scene 3's manager mentions the old clock and Scene 7 explicitly identifies the same manager-mentioned clock with hands stopped near `22:59`.
- **Remaining work:** coordinated raster regeneration of the two plates + visual acceptance/rerun of Axis 5 for that item.
- **Owner/tracking:** to be tracked as a separate follow-up task (GitHub issue recommended). Until it is complete, the deferred visual item stays open here.

# Chapter 1 Rhythm, Audio, and Portrait Expression Design

**日期：** 2026-08-28  
**範圍：** 第 1 章《雨鐘咖啡館殺人事件》  
**交付方式：** 單一 PR  
**狀態：** 實作前設計鎖

## 1. 目標

本次調整不重寫案件真相、證據鏈或程序規則，而是修正玩家實際體感：

1. 讓正式主案在遊戲開始後約 10～12 分鐘內進入 KAGAMI 冷開場，硬上限 14 分鐘。
2. 讓章節明確經歷「日常 → 壓力 → 敗北 → 喘息 → 追索 → 突破 → 指認 → 餘韻」的節奏換檔。
3. 把 BGM 從目前三首擴充成七種可辨識的情緒狀態，但不替每個場景獨立作曲。
4. 讓主要人物在關鍵情緒轉折時有可見表情變化，避免全章長時間只顯示 `standard` 立繪。
5. 補回 Chapter 1 V3.8 與 Story Bible V6.7 規定的 45～90 秒青葉媒體橋，同時維持 `ZW_A16.lock` 與青葉公開資料的來源隔離。
6. 保留現有 scene parser、portrait asset contract、audio runtime、Analysis/interrogation runtime 與 17-scene manifest，不新增框架。

## 2. 非目標

- 不改兇手、殺人方式、證物來源或 proof order 核心。
- 不把 tutorial 變成可選 branch。
- 不新增動態音樂／crossfade engine／stop-cue feature；`BGM: none` 已能表達沉默。
- 不新增 expression state machine 或 expression taxonomy framework。
- 不重做 background/evidence raster。
- 不把 Chapter 1 升級成 raw/sync/summary 三欄教學。
- 不提前解答青葉官方重演、A-90、久遠或相馬舊證詞。

## 3. Rhythm design

### Opening

- P0：45～60 秒。
- P1：4～6 分鐘。
- P1.5：1.5～2.5 分鐘。
- P2：2～3 分鐘 ordinary-day montage。
- Scene 0：目標約 10～12 分鐘進入，硬上限 14 分鐘。

保留 P1/P1.5 現有玩法；只刪重複解釋。P2 保留 cake edge、old clock、Masuda/K.、Katase last-train、backflush、closing board 與 unfinished latte seeds。

時間目標不能只留到最終人工 playthrough。實作時在 Task 1 先記錄 **每個 opening scene 的 compiled mandatory advance count + normal-speed elapsed time**，再依 baseline 把上述時間目標換算成 numeric advance bands；Task 1 完成後立即重測。Advance count 是客觀 drift proxy，不取代最後 stopwatch，尤其 P1/P1.5 仍有互動成本。

### First half

- Scene 3 承接 Katase required timing statement，讓 Scene 6 不再負責證人資訊。
- Scene 5 保持真正失敗，裁定後快速離場。
- Scene 6 成為真正 breathing beat：食物、相馬承認慌亂、搭檔互動、濕傘套感官 trigger、決定回現場；至少一半 spoken lines 不處理案件 recap。

### Late investigation

Scene 8.5 的疲勞來源不是「三塊板」本身，而是 classify 與 order 連續重用同一組 `event_1841～1844` 卡。

因此保留三個**功能不同且內容不重複**的板：

1. `evidence_packages`：縮成 **3 cards / 2 groups**，只讓玩家親手確認「三宅的小謊不是殺人證明」與「較早第三者存在」。保留 `miyake_call`、`miyake_pov_replay`、`external_credential_event`；刪除四張 `event_184x` 卡與 `lock_chronology` group。
2. `local_event_sequence`：第一次、也唯一一次操作 `1841 → 1842 → 1843 → 1844` 順序。
3. `narrow_request_basis`：維持 distinct-source threshold 與程序 objective。

這比刪掉 classify board 更符合 fair-play：兩個 case facts 仍由玩家操作取得，而不是變成旁白式 assertion；同時移除真正重複的四張卡。

Scene 7/8 每個重大發現只留一次推論。Scene 9 保留 fair-play dead end 與北見工作壓力，但合併承包商主管生活 topics、把眼鏡變 action motif。

### Final hearing

六 phase 收成四個 macro movements：

1. `p1`：把三宅移出摘要故事；內含 `q_p1/q_p2/q_p3`。
2. `gate`：取得限定核准片段。
3. `p4`：重新定義 23:07:50。
4. `p5`：把空位填成北見。

沿用既有 multi-question inquiry/phase-complete 行為；不改 runtime。

**已接受的 visual tradeoff：** interrogation grammar 的背景 cue 是 phase-level；question body 內 `[場景：]` 不會得到可切換的 `assetCue`。因此合併 `p1/p2/p3` 會退休原本 p2 的「時間證據」plate 與 p3 的「L 型平面圖」plate，前三個 contradiction 會在同一 p1 hearing plate 上完成。這是有意用較少 phase wrapper 換取辯論節奏，不是假設有 per-question re-cue。`background-variety-audit.md` 必須以非 cue-row 的 retired-plate note 記錄這個決策；若 playthrough 明顯過平，唯一 in-grammar fallback 是恢復 phase split，而不是新增音樂／背景 runtime。

### Ending

Scene 11 收成一條結尾曲線：

> 太甜拿鐵 → USB `ZW_A16.lock` → 北見非雨宮來源確認 → 公開地方新聞／真白青葉預告 → 相馬靜音 → 藍傘。

青葉與 `ZW_A16.lock` 必須視覺、來源、台詞分離；只命名青葉，不解答。

## 4. Audio design

目前問題是情緒 BGM vocabulary 不足，不是 BGS 不足。保留三首既有 BGM：

- `bgm_review_board_loss`
- `bgm_review_board_victory`
- `bgm_chapter_close`

新增四首 reusable functional BGM：

- `bgm_city_summary_motif`：城市／制度／KAGAMI 冷感 motif。
- `bgm_casework_day`：日常偵探工作、短 tutorial、office。
- `bgm_rain_bell_daily`：雨鐘 ordinary-life warmth。
- `bgm_breakthrough_pursuit`：後半追索與核心突破。

規則：

- P0 不再完整播放 chapter-close theme。
- Scene 5 使用 loss。
- Scene 6 多數保持 BGS/沉默。
- Scene 7/8.5 只在重大換檔進突破曲。
- Scene 10 開場/p1/gate 不播 victory；p4 是突破；formal ruling 才切 victory。
- `bgm_chapter_close` 留給真正 chapter-tail 餘韻。
- 不新增 runtime crossfade；cue 放在既有 visual/phase/scene-tag 邊界。
- 新 BGM 先 `audio:generate --dry-run`，再逐首 `--only <id>` 生成，避免不必要的 credit-heavy 全計畫 generation。

## 5. Portrait expression design

既有 compiler 已支援 `**Speaker**[expression]` → `portrait.<character>.<expression>`；DialogueBox / InterrogationStage 亦會使用當前 line portrait。缺口是 authored vocabulary 與 PNG coverage，不是 runtime。

新增 exactly 9：

| Character | New expressions |
|---|---|
| 相馬律 | `determined`, `shaken`, `relieved` |
| 早坂茜 | `softened` |
| 三宅蒼太 | `relieved` |
| 神谷澪 | `skeptical`, `conceding` |
| 北見修一 | `defensive`, `cornered` |

既有 `standard`, `stern`, `strained`, `tired`, `flustered` 繼續 reuse。

Expression rules：

- 通常一個 emotional run 保持 2～5 句。
- 不因每句語氣微變而換圖。
- 一般 scene 每角色約不超過三次換 expression。
- 相馬在青葉靜音 beat 保持 `standard`；低強度迴避靠動作，不用 dramatic face。
- 新 expression slug 必須先在 `characters.yaml` 定義，再進 authored lines。

## 6. Structural reuse / no-framework decisions

- Scene 8.5 的第二個音樂 boundary 用 classify Result Dialogue 末尾的額外 `[場景：]`，reuse `background.chapter_1.investigation_scene_8.fixed_panel`；不新增 raster。
- Scene 10 formal ruling boundary 用 Outro scene tag，reuse existing final-hearing plate。
- p2/p3 背景退休是已知、已接受的 phase-merge tradeoff；不要企圖以 question-body tag 補救，因該 grammar 產生 `assetCue: null`。
- 背景 audit 必須跟 compiler-owned exact cue inventory recouple；對話 trimming 會改 linear queue-index cue keys，即使 raster ownership 不變。
- `compile-scenes.test.ts` 的 tracked production corpus assertions 與 snapshot 都是 production coupling；不能只更新 snapshot。
- Packaged E2E 不只 `analysis-beat85`：`production-anchors.ts` 的 authored text 亦被 capture/save/production-journey suites 消費。Anchor 改動必須與造成文字變更的 Task 同步，final gate 跑完整 `--full` registry。
- `apps/game/src-tauri/src/game/analysis_integration_tests.rs` 內的 `evidence_packages` 是 synthetic capability fixture，不是 production corpus contract；本次不改 Rust fixture。

## 7. Canon locks

- 17-scene manifest 與順序不變。
- 三個前台證據包概念不變。
- `miyake_known_lies_are_unrelated_to_murder`、`earlier_external_entry_exists` 等既有 case facts 保持由玩家可操作板取得。
- 北見、三宅、門鎖、程序與 fair-play physical anchors 不變。
- Chapter 1 只教摘要／本機順序／核准片段。
- 青葉公開媒體與 `ZW_A16.lock` 來源鏈分離。
- 不確認 `A16 = Aoba_2016`。
- 不說青葉畫面是官方重演。
- 不揭露相馬與青葉的身份關係。

## 8. Acceptance

完成後玩家應感受到：

- 前 15 分鐘明顯更快進主案；Task 1 已有 per-scene advance/elapsed gate，而不是只靠最後 stopwatch。
- Scene 6 是呼吸，不是第四次整理證據。
- Scene 8.5 保留三種推理動作，但 classify 不再重複 order 的四張 event cards。
- Scene 7～10 有清晰 escalations，而不是一條平坦 evidence marathon。
- final hearing 有「拆三宅 → 開程序門 → 翻 23:07:50 → 指北見」四個大動作。
- victory music 不會提前劇透。
- 主要角色在 defeat、care、pressure、concession、relief 有可見表情轉折。
- Scene 11 只有一條連續 ending curve；青葉問題被提出，但沒有被解答。
- tracked production compiler assertions、background audit、production anchors 與 full packaged E2E registry 全部隨 authored content 同步 recouple。

實作與驗證細節以 reviewed implementation plan 為準。
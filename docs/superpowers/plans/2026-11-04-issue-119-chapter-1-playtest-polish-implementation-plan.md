# Issue #119 — Chapter 1 玩家視角修正實作計劃（Review 收斂版）

> 規格：[Design Specification](../specs/2026-11-04-issue-119-chapter-1-playtest-polish-design.md)；追蹤 [Issue #119](https://github.com/cwchanap/Lyra/issues/119)，交付 [Draft PR #122](https://github.com/cwchanap/Lyra/pull/122)。
>
> **單一 PR 政策：** 本次既有 Draft PR 先存規格與計劃；所有功能實作、驗收與最終結論加在同一 PR。以下 Task 是 PR 內的工作段，不新開 tickets 或第二個 PR。建議每段完成後各自 commit。
>
> **基線：** `main` @ `c713de3b2943f3dc6edbdc5e0d53ba09dfe3cf2c`；bun@1.3.1。Review：[首輪 design review](https://github.com/cwchanap/Lyra/pull/122#issuecomment-6647158070)、[最新 Design & Plan Review](https://github.com/cwchanap/Lyra/pull/122#pullrequestreview-5779388872)。本 PR 原始 issue playtest 1180×812（舊 commit `8e31c4b`），未進行新的手動操作驗證。

## 工作順序（保持小改動）

**內容（Task 1）→ 局部 CSS／說明（Task 2）→ Layout Editor 座標（Task 3）→ 通用 review skill + E2E 補丁（Task 4）→ 一次整體驗收（Task 5）。**

不要把所有任務卡在一個預先的三視窗 Tauri 量測階段；設計上可由 code/raster 直接確認的修正先做。只在最後執行一次 Tauri 視覺 pass。

## Task 1 — 劇本內容與玩家提示（不改遊戲狀態）

**修改：**
- `docs/stories_plan/chapter_1/investigation_scene_3.md`：`katase_register_gap` 的說明、動作與回應，移除引用片瀨「方才說過」的末班車估計。熱點和 `contractor_ambient` 先後都合理；不新增 topic-read 狀態。
- `docs/stories_plan/chapter_1/investigation_scene_9.md`：北見動機話題 `L062` 改成尚未承認殺人時仍成立的壓力／檢舉追問，保留既有 reply 與 evidence IDs。
- `docs/stories_plan/chapter_1/analysis_scene_8_5.md`：
  - `evidence_packages` 第二 group 改為包含**視線遮擋**及**外部憑證先出現**的命題；更新 `Incorrect Feedback` 與 `Hint`，說明證物的證明界線。
  - `local_event_sequence` 只更改 `### Card:` 章節的 authored 排列順序，保留 1841～1844 號碼、`Accepted Order`、第一固定錨與 Reveal IDs。「按可見事件號排序」仍是**教學題**，不花工重做難度或增加 shuffle。
- `docs/stories_plan/chapter_1/interrogation_scene_10.md`：`gate_hold_record` 的 `On Wrong Evidence`（`L057`）改成任何錯誤證物都能套用的程序提示，不能假稱玩家選了整份摘要。
- `docs/stories_plan/chapter_1/scene_5.md`：相馬薄弱人品論證前加入**一句**正式核准片段未到手／本輪主張受限的程序提示，保留神谷的反駁及「摘要先贏」。
- `docs/stories_plan/chapter_1/investigation_scene_map_08.md`：**只改 Summary**：「返回雨鐘咖啡館，迎接結案後的日常。」→「暫緩起訴後，回到雨鐘咖啡館。」不要改真正遊戲終章 `GameComplete`。

**有界重複句裁切（以實際播放佇列為準）：**

`apps/game/src-tauri/src/game/mod.rs` 的 `inspect_hotspot` 先送 `inspect_dialogue`，再由 `reveals::apply_reveals_and_build_queue` 串入每一筆 evidence 的 `On Collect`；第一次點擊後是**同一條連續對話**，不能只刪 `On Collect` 的第一句而留下一句重述或同角色連續插話。編譯器仍要求每個 evidence 有 `#### On Collect` 段落。

| 位置 | 鎖定修改 | 為甚麼 |
| --- | --- | --- |
| `investigation_scene_7.md` | **保留 `L049`** | 「範圍。不是某一分鐘」是相馬讓玩家確認規則的短提問；刪除反而令黑瀨 `L048→L050` 連續發話，並不改善對話節奏 |
| `investigation_scene_9.md` 備忘 inspect | 保留 `L045–L048`，**刪 `L049`** | 保留備忘原文、22:50/22:52 的區別和相馬的初步理解；「光靠備忘不能定北見」由取得回覆完成 |
| `investigation_scene_9.md` `masuda_unsent_memo` On Collect | **刪 `L085`**（重述備忘原文）；**改寫 `L086`** 為「要把 K 對到人，還得核對工單與那組憑證。」 | inspect 已由相馬講過原文，之後接早坂提出下一步核對，沒有相同警告連講兩次 |
| `investigation_scene_9.md` 草稿 inspect | **保留 `L050–L057`** | 保留未送出草稿的程序限制、附件存取事實、買家未明和北見在場反應；不讓重要玩家信息消失 |
| `investigation_scene_9.md` `masuda_whistleblower_draft` On Collect | **同時刪 `L087` / `L088`**；保留 USB 裝袋動作與 `L089` | 草稿及其限制已在 inspect 說過；只留下黑瀨對 USB 的新證物鏈行動。不可留單句 `L088` 造成重覆早坂說法 |
| `investigation_scene_9.md` `kitami_data_theft_record` On Collect | **刪 `L090`**；把 `L091` 改為「這些存取紀錄能說明他為何怕被查；是否動手，還得看現場證據。」 | 首次 inspect 已講異常存取、外部傳輸及買家未明；此處只追加「動機≠動手」的合法推理界線 |
| `interrogation_scene_10.md` `L067` | `- **Challenge:**` **保留**，只將文案縮成「把本機順序和摘要的時間排在一起看。」 | `Challenge` 是正確證物下的對質反應，不應作為重複敘述直接刪掉；把完整的時間論證留給 `On Correct L068` |

**完成前連起來讀**兩條 hotspot 的 inspect、取得草稿/附件的 On Collect、下一次 reexamine 與最後 scene outro；每筆 `On Collect` 都留下有效內容，不讓短句裁切斷掉證物取得。只修改以上明列 ID，不展開全章台詞重寫。原 review 提到 `L057` 的示例台詞與目前 main 原文不同；以實際原文「他連結尾都還沒寫完，就說要送出去。」及其前後次序為準。

**本地化：**
- 按工具契約檢查 `docs/stories_plan/chapter_1/ja/*.ja.yaml` 的變更行及刪除行。使用 `bun run voice:sync chapter_1`（維持 line IDs、既有 clip IDs；因文字更新可能產生 stale locale entries）及 `bun run voice:validate chapter_1`，人工校對日文文字。
- **不執行** `voice:generate`，不承諾可聽配音已測試。

**驗收：**
- [ ] 片瀨：先收簽退單、先問片瀨兩路都自然；北見：先問動機不預設供認。
- [ ] C1 視線重現不能單獨說成第三者先進場；分類錯放後仍能重試。
- [ ] C2 提交 `local_sequence_record` 時錯誤文字不誤述所選證物，再交 `doorlock_summary_timetable` 能成功。
- [ ] C3 卡池不再按正解排列，保留讓新手靠事件號排序的公平入口。
- [ ] 首輪程序合理，第三者、門鎖本機、北見的 final proof order 不變；章間 map 摘要不提前暗示已經最終司法結案。
- [ ] 執行 `bun run scenes:compile`、`bun run evidence-sources:audit`；不新加固定句 grepping 測試。

## Task 2 — A3 地圖盒模型及 B 文字／進度語義

**修改（優先復用現有 tokens 和 test）：**
- `apps/game/src/lib/components/InvestigationMapView.svelte`：`.city-map` 增加 **`box-sizing: border-box`**，修正 `width: 100%` + 左右 padding 令容器超寬；在真實 800×600 檢查垂直 padding 與地圖高度，如仍超過視窗則**局部**收緊上下間距。不要改 map plane/pin、CrossfadeImage、save，也不加全域 reset。
- **主要閱讀文字**（使正文與 `DialogueHistoryPanel .line-text` 使用的 `--bone` 同級）從 `--bone-dim` → `--bone`：
  - `apps/game/src/lib/components/DialogueBox.svelte` 的 **`.text-action`**（這才是真正的斜體 narration，不是 `.text-scene`）。
  - `apps/game/src/lib/components/GameShell.svelte` 的 `.summary`（目前 13px、`--bone-dim`）。
  - `apps/game/src/lib/components/AcquisitionPopup.svelte` 的 `#acquisition-description`。
  - `apps/game/src/lib/components/InterrogationEvidenceTray.svelte` 的 `.record-copy`、`.record-detail`。
- **需要閱讀的次要註解** 從 `--bone-faint` → `--bone-dim`：`DialogueBox.svelte .text-scene`（只是「（場景切換）」）、`apps/game/src/lib/components/case-file/CaseFileRecordDetail.svelte .reexamine-note`、`InterrogationEvidenceTray.svelte .record-source` 及 `footer p`。純裝飾 micro-label 不必一起改，`tokens.css` 不新增 token。
- `apps/game/src/lib/components/InterrogationStage.svelte`：把原本只在 `aria-label` 看得到的 `progress.broken / progress.total` 放上**肉眼可見**的 `.subject-meter p`：例如 `突破進度 {progress.broken} / {progress.total}`，並改 `.subject-meter p` 從 `--bone-faint` → `--bone-dim`；沿用 `brokenQuestionProgress()`、`aria-valuenow/max`。
- `apps/game/src/lib/components/DialogueBox.svelte`：訊問 `.xexam-challenge` 保持主要標籤 **「反駁」** 及 native click；其次標 `OBJECT` 改為「出示證據」。**同步更新 `apps/game/src/lib/components/InterrogationChrome.test.ts` 的 `OBJECT` 斷言**。不變更 `apps/game/e2e-tauri/production-anchors.ts` 的 `challengeButtonText: "反駁"`。

**明確不改：** `tokens.css`、`InvestigationSceneSurface.svelte` 點擊幾何、`GameComplete.svelte`、Rust。除了一項地圖 viewport 斷言，不新增 CSS 文字檢查或自建 hover/rect 測試。

**驗收：**
- [ ] 在真實 Tauri 800×600 下，城市地圖不橫向超寬、可見 overview 按鈕，必要時收緊垂直 padding；畫面仍使用同一地圖及 travel 邏輯。
- [ ] 四個玩家指出的主閱讀面（action narration／chapter summary／acquisition desc／interrogation evidence）主要文字用 `--bone`，較次級但仍要讀的來源註解用 `--bone-dim`；不宣稱整站 WCAG audit。
- [ ] 訊問進度肉眼可讀 **n/total**，而非只有 ARIA 看得到；進度數值仍為已突破題數、非精神值。
- [ ] 「反駁」按鈕仍可由單擊／Enter／Space 觸發，副標清楚指出出示證據。
- [ ] 跑現有 `DialogueBox`、`InterrogationStage`、`InterrogationChrome.test.ts`、`InvestigationMapView` 及受影響元件 Vitest，`bun run check`；最終再跑完整 `bun run --cwd apps/game test`。
- [ ] **不新增**只檢查 CSS 字串的 jsdom style-contract 單元測試。

## Task 3 — 只用既有 Layout Editor 修正 A2

**工具：** `bun run dev:editor` → `apps/layout-editor/src/lib/EditorCanvas.svelte`；正常版面為 16:9 raster + normalized rect，拖移／縮放後存回 sidecar。不另外開發量測工具，也不靠 scene 背景 prompt 推測實物位置。

**修改：**
- `docs/stories_plan/chapter_1/investigation_scene_p1.layout.json`：在既有 Layout Editor 上比對 `static/assets/backgrounds/chapter_1/scene_p1/tag_002.png`，修 `receipt`、`register`、`cctv`、`ledger`，以圖像目測微調，**非用下列近似值硬編定案**。
  - `receipt` 近似 `x≈0.45,y≈0.56`；`register` 近似 `x≈0.62,y≈0.45`，注意紙張不應被 register 命中。
  - **CCTV 已決定的方案：** 監視器右方 CRT 據 review 在 `x≈0.88～0.995,y≈0.525～0.725`，相連的錄影器／控制盒在 `x≈0.805～0.875,y≈0.59～0.70`；把 `cctv` 當**同一組可見監視設備**，以約 `{x:0.81,y:0.52,w:0.18,h:0.20}` 的矩形覆蓋錄影器 + CRT，再按圖片實際位置校正。800×600 可見裁切為 `x=0.125～0.875`，框左段約有 69px 可點，現有 `.target-pending` clamp 可將未完成標記留在可見部分；不用新畫、也無需額外候補方案。不得重疊不相關收據／收銀機。
  - **Ledger 不是櫃台上畫好的帳本：** `investigation_scene_p1.md` 的 `Background Prompt` 沒有 ledger；review 指示用**櫃台後方可見的文具、記事簿、資料夾／裝訂本群組**作可辨識的對應目標；在 Layout Editor 疊圖確認，不能憑「手寫帳本」名稱往空白櫃台放 hitbox。
- `docs/stories_plan/chapter_1/investigation_scene_7.layout.json`：校正 `bean_can` 至照片的低處罐身，保留 `phone_drop` 可點性。
- `docs/stories_plan/chapter_1/investigation_scene_9.layout.json`：`contractor_clerk` 由 `kind: baked` → `kind: sprite`，使用已有 `portrait.contractor_supervisor.standard`，`anchor: bottomCenter`；位置靠櫃台/服務窗口並保持場景透視。參考既有 `chapter_2/investigation_scene_4.layout.json` sprite 結構。**不新增 art task**。
- `investigation_scene_3.layout.json` 只在 editor 明確看到有偏差才修改；不做無差別全章重排。Review 另外提及 `temp_badge_box`、`visitor_tablet`、`shredder_bin`、`cable_locker`、`extension_log` 等目標，但**目前上述 Chapter 1 sidecar 並無這些 IDs**，不得憑 review 字面加入新的強制物件。`contractor_clerk` 在 `investigation_scene_9.layout.json`（不是 Scene 7）。

**驗收：**
- [ ] 在 editor 為每個實際修改的 sublocation 附一張 overlay 截圖。
- [ ] 800×600 可見安全區內每個 required target 可達，`receipt` 不落入 `register`；`cctv` 在 recorder + CRT 聯合區有至少 44px 可點範圍，現有 cue clamp 正常且不錯點其他道具。
- [ ] `bean_can`、`phone_drop` 不互蓋；主管有實際可見 sprite 且可以被詢問。
- [ ] `bun run scenes:compile` 保留既有 placed-target / overlap 檢查；**重用** `apps/game/e2e-tauri/investigation-layout.e2e.ts` 800×600 shipped placement 契約；不加一套 per-hotspot 點擊／bbox 測試。

## Task 4 — 最小防回歸：review skill + 一個真實 E2E 斷言

- [x] 更新 `.claude/skills/reviewing-story-scenes/SKILL.md`（本次 review 已在本 PR 完成）：
  - Axis 4：同一 investigation 的 unlocked hotspot 與 character topic 可能任意順序發生；檢查「剛才說過／如你所見／第一次」等語句是否引用了尚未必經的動作。
  - Axis 9：`On Wrong Evidence` 與 `Default Wrong` 是共享的錯誤回覆，所有錯誤證物都會用到，不能假設玩家選了某一個特定錯誤物品；正解的 `Challenge`/`On Correct` 仍可具體。
- [ ] 擴充現有 `apps/game/e2e-tauri/investigation-layout.e2e.ts` 的第一張地圖 district 測試（約 :430）：用既有 `ensureMinimumWindowViewport()` 設 800×600，對 `[data-map-overview]` 取 `getBoundingClientRect()`，斷言 left ≥ 0、right ≤ `innerWidth`、top ≥ 0、bottom ≤ `innerHeight`。沿用已存在的地圖 travel E2E，不新增專用 E2E suite、CSS snapshot 或多點 bbox replay。
- [ ] 若使用現有地圖測試的 native click/keyboard 已能涵蓋 navigation，毋須另寫第二套 keyboard 回歸測試。

## Task 5 — 一次合併驗收（不是前置 blocker）

**驗證關口：**
- [ ] `bun run scenes:compile`
- [ ] `bun run evidence-sources:audit`
- [ ] `bun run check:scripts`
- [ ] `bun run test:scripts`
- [ ] `bun run --cwd apps/game test`
- [ ] `bun run check`
- [ ] `bun run --cwd apps/game check:e2e`
- [ ] `bun run lint:all`
- [ ] `bun run --cwd apps/game test:e2e:smoke`（packaged Tauri；同一原有 E2E 入口）。
- [ ] 使用真實 Tauri 於 **1180×812 及 800×600**，一次檢視 P1、Scene 7、主管窗口、城市地圖、視線/排序板、核准片段錯誤提示及閱讀對比。地圖另外可查 1280×720；不做三尺寸 × 所有熱點的 bbox 矩陣。
- [ ] 執行 `voice:sync chapter_1`、`voice:validate chapter_1` 並核對變動 locale；對比已知原始 603 警告，不把沒有聽的聲音判為新故障。
- [ ] 完整 Chapter 1 production journey 不退步，且 Chapter 2 轉場及青葉 reveal contract 未越界。
- [ ] PR 更新實際執行與未執行的測試、有效／無效問題及必要 editor screenshot；若某項不可重現，記錄原因而非擅自聲稱已修復。

**只在本 PR 實際變動 Rust 後才需 Rust 單元測試/Clippy；按本計劃 Rust 不應改動。**

## 不做的事

- 不新增內容順序狀態、wrong-evidence API、分析難度系統、hit-test engine、地圖 state、save migration、全域 box-sizing、全域顏色 token、素材生成或付費 voice；不更動 `Required`／flavor gate。
- 不改 `GameComplete` 的真正結局；不把 Issue #90 的歷史問題或未重現縮圖／聲音警告搬進本次 PR。
- 不新增脆弱的 Markdown 固定文句測試，不重跑所有 shipped target 的三尺寸人工量測，不在沒有具體重複行的地方擴大刪稿。

**交付結果：** 一次 Chapter 1 小範圍內容／UI/sidecar polish，重用既有 editor、compiler、review skill 與 E2E，所有工作落在同一 Draft PR。
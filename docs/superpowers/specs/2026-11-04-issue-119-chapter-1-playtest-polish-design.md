# Issue #119 — Chapter 1 玩家視角修正設計規格（Review 收斂版）

> **狀態：** 規格草案。對應 [Issue #119](https://github.com/cwchanap/Lyra/issues/119) 與 [Draft PR #122](https://github.com/cwchanap/Lyra/pull/122)。根據 2026-11-04 的 [design review](https://github.com/cwchanap/Lyra/pull/122#issuecomment-6647158070) 及 2026-11-05 的 [follow-up review](https://github.com/cwchanap/Lyra/pull/122#pullrequestreview-5779388872) 收斂，**單一 PR** 先載規劃、後續在同一 PR 實作。
>
> **基線：** main `c713de3b2943f3dc6edbdc5e0d53ba09dfe3cf2c`；Issue #119 的實際 playtest 是 `8e31c4b`、Tauri 1180×812。原測試無進度阻塞；本文件的原始碼核實不等於新一輪視覺 playtest。

## 1. 結論與定位

**修正內容、座標、盒模型及說明文字，不重寫機制。** 目前已有 Svelte 調查座標平面、Story Workbench Layout Editor、編譯器 reachability、packaged Tauri E2E、日文 locale 工作流；只需沿用。

已由現有原始碼確認：
- A1 片瀨簽退單在她談末班車前引用「方才說的」；A4 北見動機話題尚未供認即預設「動手」。
- A3 `InvestigationMapView.svelte` 的 `.city-map` 採 `width: 100%` 加左右 padding，但未設本地 `box-sizing: border-box`；按預設 content-box 計算會橫向超出。
- C1 視線重現卡與外包憑證同被放入「更早的第三者」；C2 `On Wrong Evidence` 錯誤地假設選了整份摘要；C3 待加入排序卡原文按 1841→1844 排列。
- B `brokenQuestionProgress()` 是**已突破題數**，目前只在 ARIA 顯示數值，視覺標題卻寫「動搖 · COMPOSURE」。閱讀對比的主要根因是 `DialogueBox` 的真實 action 敘述 `.text-action`、GameShell `.summary` 和證物正文已用 `--bone-dim`；`.text-scene` 使用 `--bone-faint`，但它只顯示「（場景切換）」而不是玩家反映的斜體 action 內容。
- D 第一章章間地圖實際顯示 `investigation_scene_map_08.md` 的 Summary「迎接結案後的日常」；`GameComplete.svelte` 的真正完結 stamp 在現階段第二章 `in-progress` 時不會出現，**不應修改**。

Review 提供了背景圖對位觀察：P1 `register` rect 包住畫中的收據、Scene 7 `bean_can` 區塊在中層貨架但罐子在地面；圖像相對位置仍以**最後提交的 raster + Layout Editor** 檢查，不硬猜新的精確座標。

## 2. 鎖定的修正矩陣

| 議題 | 決議 | 主要位置與驗收 |
| --- | --- | --- |
| **A1 簽退單** | Description、舞台指示與回應改成先點單據也成立；**不加 topic-read flag** | `investigation_scene_3.md` `katase_register_gap`；先點熱點或先問片瀨，均不提前引用問話 |
| **A4 北見** | 動機話題改為追問檢舉、權限審核壓力，不預設口頭認罪 | `investigation_scene_9.md` `kitami` 動機 L062；topic 任意順序成立 |
| **A2 P1 熱點** | 用 **`apps/layout-editor`** 對準既有 `tag_002.png` 的 `receipt/register/cctv/ledger`；`ledger` 並非畫在櫃台上，按 review 所指的櫃台後紙本／記事簿／資料夾群組定位，不去找不存在的櫃台帳本 | `investigation_scene_p1.layout.json`；receipt/register 不搶點；ledger 真有可見對應物；editor 每 sublocation 一張覆核截圖 |
| **A2 Scene 7** | 將 `bean_can` 對準圖中的罐子，不動已正確的 `phone_drop` 等目標 | `investigation_scene_7.layout.json`；保留現有排版及其 overlap 檢查 |
| **A2 主管空白** | 已有 `static/assets/portraits/contractor_supervisor/standard.png`，將 `contractor_clerk` 從 `baked` 改為 `sprite`，`assetId: portrait.contractor_supervisor.standard`、`anchor: bottomCenter`，在櫃台後放置 | `investigation_scene_9.layout.json`；沿用第 2 章既有 sprite schema；**無新 art task** |
| **A2 監視器安全區** | 已決定採**原圖錄影器 + CRT 的聯合命中區**：review 觀察錄影器約 x 0.805–0.875、螢幕約 x 0.88–0.995；先在 Editor 以 `cctv` 近似 `{x:0.81,y:0.52,w:0.18,h:0.20}` 覆蓋兩者，再依真圖微調。800×600 可見 recorder 端約 69px，既有 `.target-pending` clamp 讓標記留在可見命中區；保留現有 hover「監視器」名稱 | 不建立新圖片或 fallback 點擊語義；沿用原 800×600 shipped-placement E2E，確保 monitor 與 recorder 是同一件監視設備、而非無關道具，也不蓋 receipt/register |
| **A3 地圖** | 本地 `.city-map { box-sizing: border-box; }` 修水平超寬；額外在 800×600 檢查 **地圖高度 + 上下 padding/gap**，若仍超窗才局部縮小垂直間距。不加全域 reset，不改 map/state/pin | `InvestigationMapView.svelte`；在現有 `investigation-layout.e2e.ts` 對 `[data-map-overview]` 加**一個** viewport rect 驗證 |
| **B 可讀性** | **兩級提升、只用既有 token**：必讀主文 `--bone-dim` → `--bone`（`DialogueBox .text-action`、`GameShell .summary`、`AcquisitionPopup #acquisition-description`、`InterrogationEvidenceTray .record-copy/.record-detail`）；有閱讀價值的輔助文字 `--bone-faint` → `--bone-dim`（`.text-scene`、CaseFile `.reexamine-note`、tray `.record-source`/`footer p`）。純裝飾字保留低對比 | 與 `DialogueHistoryPanel` 的 action 正文層級一致；**不得因為某主文已用 `--bone-dim` 就略過**。不加 token，不聲稱完整 WCAG audit |
| **B 反駁進度** | `InterrogationStage .subject-meter p` 改成**可見**「突破進度 {progress.broken} / {progress.total}」，且 `--bone-faint` → `--bone-dim`；讓 `DialogueBox .xexam-challenge` 的次標明確寫「出示證據」，**保留主標「反駁」**。原本 `brokenQuestionProgress()` 與 native 一鍵觸發不變 | 更新既有 `InterrogationChrome.test.ts` 對 `OBJECT` 的舊斷言；不改 production E2E `challengeButtonText: "反駁"`；不新增耐力／扣血機制 |
| **C1 分類** | 第二組改成同時涵蓋「遮擋視線」及「外部憑證先出現」的名稱／說明；更新 `Incorrect Feedback` / `Hint` | `analysis_scene_8_5.md`；Accepted Cards、Reveals、ID 原封不動，錯放可重試 |
| **C2 錯誤回覆** | `gate_hold_record` L057 改成「需要摘要門鎖主時間錨所依據的時刻表」等**對任何錯誤提交都成立**的中性回覆 | `interrogation_scene_10.md`；不新增 per-evidence API |
| **C3 排序教學** | 保留事件 1841～1844 **真實序號**和 `Fixed Anchors`，只打亂未加入卡的**文件呈現順序**；明確接受「看序號排序」是教學用途，不追求獨立高難度推理 | `analysis_scene_8_5.md`；不隨機洗牌，不改驗證答案 |
| **D 首輪審查** | 只在 scene_5 加一個短程序前提：本輪未有足夠核准片段，讓相馬的弱論證是有壓力的失策，而非莫名愚蠢 | `scene_5.md`；神谷不提前准許 raw；原「摘要先贏」不動 |
| **D 重複內容** | 根據 **Rust 同一 queue 串接 `inspect_dialogue` + 每筆 evidence `On Collect`** 的實際行為處理，不孤立地刪半段。Scene 9：備忘保留 inspect `L045–L048`、刪重覆的 `L049/L085`、將 `L086` 改為不重複的 K 身分待核對提示；草稿保留 inspect `L050–L057`、刪 `On Collect L087/L088`、保留 USB 封存 `L089`；資料盜賣刪重述的 `L090`，把 `L091` 改為動機≠殺人直接證明。Scene 7 `L049` 保留作對話確認，否則黑瀨連續兩句；審查 `interrogation_scene_10.md L067` **Challenge 不刪**，只精簡成促使對照的挑戰句 | 每個 `On Collect` 區段均有有效 carrier；兩條 hotspot 首次點擊後不重述同一事實或連續拋出相同早坂話語；保留所有核心時間、證物與 K/買家未明界線 |
| **D 章間文案** | 改 `investigation_scene_map_08.md` 的 Summary，例如「暫緩起訴後，回到雨鐘咖啡館。」；`scene_11.md L026` 已有「結案的，只是這一樁。」保留 | **不動** `GameComplete.svelte`、它的測試與 `storyCleared` 意義 |

### 2.1 裁切與座標準則

背景圖及互動平面同為 16:9 cover。玩家視窗不是 16:9 時，**畫面裁切會影響可達性，但不改變 raster 上的幾何對位**：

- 1180×812：約可見 normalized x `0.09～0.91`。
- 800×600：約可見 normalized x `0.125～0.875`。
- 1280×720：不裁切，可作地圖補充檢視，不需對所有熱點重跑。

不為每個熱點記錄三份 bbox；只用 Layout Editor 圖像疊框，保留既有 packaged 800×600 placed-target 檢查與一次 Chapter 1 真人視覺 pass。CCTV 的可見操作區不得引發另一個「點 A 取得 B」問題；現有 `.target-pending` 只會將**提示標記**夾回可見範圍，不會移動真正的 hit box，因此仍須讓 rect 本身保留至少 44px 可用寬度。

## 3. 重用邊界

- **既有編輯器：** `apps/layout-editor/src/lib/EditorCanvas.svelte` 使用 normalized percentage placement + 16:9 plate。執行 `bun run dev:editor`，不要新做 layout 工具。
- **既有 E2E：** `apps/game/e2e-tauri/investigation-layout.e2e.ts` 已把所有 shipped placements 於 800×600 套進實際 CSS 契約，保留；只增加地圖返回鍵 viewport 斷言，不加每個 props 的新 bbox/click 測試，也不加 jsdom CSS 字串測試。
- **既有 review skill：** 更新 `.claude/skills/reviewing-story-scenes/SKILL.md` Axis 4（同一 investigation 中熱點與話題任意順序）及 Axis 9（`On Wrong Evidence` / `Default Wrong` 對所有錯誤選擇都成立），不加脆弱的 Markdown 固定句 grep。
- **既有內容與本地化：** `voice:sync` / `voice:validate` 更新日文 locale、保留 ID；既有片段無需重生，絕不執行付費 `voice:generate`。修改行後 `voice:sync` 可能產生 `stale`，需按工具規則清理。
- **不改流程門檻：** **本 PR 不改任何 `Required`／unlock／flavor-gate 或 auto-outro 條件。** 未來真有具體 gate 問題才由 `packages/scripts/compile-scenes/reachability.ts` 驗證。

## 4. 明確非目標

不修改 `GameComplete`、`tokens.css`、`InvestigationSceneSurface.svelte` 的 hit testing、Rust、存檔或第二章。沒有新增背景圖、人物立繪、SFX、語音輸出。Issue #90 的歷史 softlock、WebKit SIGABRT、短暫空白縮圖、603 個日語配音警告未在 #119 中獲新的失效證據，不據此擴充。

## 5. 完成定義

1. A1/A4 兩種互動順序均成立；C1/C2 錯誤提交仍可恢復，文案不預設玩家選了哪件證物；C3 仍是可用原始序號完成的教學排序。
2. 以 Layout Editor 疊框實際圖片（每受影響 sublocation 一張截圖）校正 P1 四點、bean can 和主管 sprite；特別檢查 CCTV 在最窄 cover crop 的可達性。原有 800×600 E2E 不退步。
3. `[data-map-overview]` 完整位於 800×600 視窗內；既有滑鼠與鍵盤操作保持有效。1180×812 做一輪整體視覺 pass；1280×720 只作地圖補充。
4. 四個玩家反映的主閱讀面都用 `--bone`，需要讀的輔助註解用 `--bone-dim`；訊問標籤**直接顯示已突破 n/total 題**，更新 `InterrogationChrome` 舊 `OBJECT` 斷言而保留既有「反駁」E2E anchor。
5. 現有編譯、evidence audit、相關 Vitest、Svelte check、packaged smoke E2E 綠燈；實際執行結果記錄於 PR，不把尚未執行的測試標成通過。維持 Chapter 1 與 Story Bible 的青葉早期提問契約。
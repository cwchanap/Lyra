# HPA-705 — SHOW／PRESENT 證物盤搜尋與 800×600 可讀性（設計規格）

> **狀態：** 已於 [PR #138](https://github.com/cwchanap/Lyra/pull/138) 完成實作——CI 全綠（含 Tauri E2E smoke），packaged smoke 及 Chapter 2 最終聽證 800×600 孤立段（83 筆真實紀錄）已通過；head `e7ae7b34` 的 canonical E2E Full 仍在執行，完成前不標已驗收。對應 [Linear HPA-705](https://linear.app/cwchanap/issue/HPA-705/evidence-tray-is-hard-to-use-with-dozens-of-records-show-出示紀錄)。歷史記錄：原為 Draft design，已整合 [PR #138 的兩輪設計審閱](https://github.com/cwchanap/Lyra/pull/138)，其中第二輪核對 head `fa323aa` 的 UI 測試、CSS 與 WDIO 細節。**單一任務、單一 PR**：規劃與實作同在此 PR，不另開 implementation PR。

## 1. 問題、既有能力與原因邊界

2026-11-11 的 packaged Tauri UAT（800×600）記錄第 2 章最終審查會約 **74 筆**，SHOW／出示紀錄盤要捲動約 29 個畫面，卡片標題容易被 grid 下緣裁切。Linear 的 `show-tray-800x600.png` 是修前截圖，不是目標設計 mockup。

已在 `main` 核實：

- `apps/game/src/lib/components/InterrogationEvidenceTray.svelte` 供 **SHOW + PRESENT** 共用：五欄 `.record-grid`、106px 縮圖、hover/focus 詳情、`onPresent(kind,id)`、Escape claim 及 Tab trap。
- `apps/game/src/lib/interrogation/presentation.ts` 的 `PresentableRecord` 已有 `shortName/sourceTag/description/details/kind/id`，不需新 model、Rust 或索引。
- `apps/game/src/lib/state/tab-focus-trap.ts` 已有可自訂 selector、`stopPropagation` 的 `trapDialogTabKey`；證物盤目前重複實作同一循環。
- 原始碼的 SHOW 與 PRESENT 都透過條件渲染掛載證物盤，關閉即卸載，新開自然取得空 query 和新 DOM 的 `scrollTop=0`。票面「重新打開停在舊捲動」**目前未由原始碼證實**；應列回歸測試，而非預設新 mount reset。
- `production-journey.e2e.ts` 會使用 `ensureCaseFileViewport()` 取得至少 **1280×720 CSS px**；未先改為 800×600 就新增 geometry 斷言將測錯 viewport。

## 2. 一個本地搜尋，保留原盤

不建分類 tabs、近期項目、分頁、虛擬捲動、共用搜尋服務或另一份 inventory；只加一個暫態 `type="search"` 輸入欄及命中數字，保留原有紀錄順序、縮圖、詳情與出示語義。

### 2.1 搜尋語義與責任

- `presentation.ts` 新增純函數 `filterPresentableRecords(records, query)`；先對查詢 `trim()`，對查詢和候選欄位都執行 `normalize("NFKC").toLocaleLowerCase()`，再做 substring match，涵蓋 `shortName`、`sourceTag`、`description`、`details ?? ""`。例如全形 `ＳＲ－２３０７` 能命中 `SR-2307`。不加拼音或模糊演算法。
- 空 query **直接回傳原 records 參考及順序**，搜尋不修改原 inventory；無結果顯示「沒有符合的紀錄，請修改搜尋字詞」。
- 元件僅保留 `query = $state("")` 與 `visibleRecords = $derived(filterPresentableRecords(records, query))`。輸入框 `aria-label="搜尋紀錄"`，旁顯示 `顯示 N / 總數`；卡片使用 `visibleRecords`，詳情只從可見結果找，以免之前 hover/focus 的已篩除紀錄繼續顯示。
- **不新增清除按鈕**：選取全文 + Delete 可清空；關閉再開會自動清空。不要依賴 WebKit 專有搜尋取消 icon 作核心操作。
- 每次輸入／修改 query 將 `.record-grid.scrollTop` 歸零，並清除暫存的 `hoveredRecordKey`、`focusedRecordKey`、`inspectedRecordKey`；由 `{#each visibleRecords}` 卸載的卡片不一定會觸發 `mouseleave`／`blur`，若不清除，刪掉搜尋字詞後舊詳情可能重新浮現。**不加 mount-time 歸零程式碼**。原 `onPresent(kind,id)` 原樣傳遞。
- `evidenceImages` 的 `$effect` 繼續只依賴**完整 records**。不可改成 `visibleRecords`，否則打字會反覆清掉圖片，縮圖閃回「證」。

### 2.2 Tab、鍵盤與 busy 邊界

- 現有 `handleKeydown` 改為委派 `trapDialogTabKey(event, tray, { selector: "input:not(:disabled), button:not(:disabled)", stopPropagation: true })`；`topLayerOpen` 時先 return，保留原本上層 Game Menu／Save Browser 的焦點主導權。
- 初始聚焦仍是 ESC（目前 onMount 只找第一個 button）。搜尋 input 若位於 ESC 前方，從 ESC 按 **Shift+Tab → input**，按 **Tab → 第一張卡**；測試依實際 DOM 順序更新，並覆蓋從最後一個按鈕循環回 input，再回 ESC。`oninput` 清理暫態焦點 key；不讓篩除項目再次成為詳情來源。
- **搜尋 input 不受 `disabled/inFlight` 禁用**：篩選不送遊戲命令，禁用正在獲焦的 input 反會把焦點丟回 body；既有證物卡、ESC／收回／選單的 `disabled` guard 仍擋命令。因此原本 `InterrogationEvidenceTray.test.ts`「所有按鈕 disabled 時 Tab 聚焦 tray」的測試，應更新為聚焦**仍啟用的搜尋 input**；不可保留舊的零 controls 前提。共用 helper 未修改，無需為此特意增加零 controls 新測試。
- `DialogueBox` 既有輸入控件快捷鍵保護及 GameShell Escape owner 保持不變。關閉後 `returnFocusTo`／fallback 還焦照舊。

### 2.3 800×600 高度預算（先定尺寸，不靠盲目 screenshot 調參）

現有 800×600 最多 552px 的 dialog（`100dvh - 48px`），大致預算：

| 舊版預算項 | 約消耗 |
| --- | ---: |
| 上下 padding + 四道 gap | 48 + 72 = 120px |
| Header | 32px |
| SHOW／PRESENT 證詞區 | 80～135px |
| 詳情區最低高度 | 96px |
| Footer | 43px |
| **留給 grid** | **約 125～180px** |

既有單張卡約 184px（106px 圖 + 上下 padding + 文字）；五欄下較長標題換到 3 行，可能超過 220px，故「僅微調間距」不足以保證首列完整。

**固定採用僅本元件的 `@media (max-height: 650px)`：**

| 局部尺寸 | Compact 目標 | 理由 |
| --- | --- | --- |
| 外層 padding/gap | 14px / 8px | 回收約 60px；保持 800×600 有可見 margin |
| `.record-visual` | 約 48px 高 | 保留真正縮圖，不改為文字清單 |
| `.record-tile` | 約 8px padding，6px gap | 單卡高度接近 120～165px（依標題行數） |
| `.record-copy strong` | 13～14px，line-height 約 1.35 | 名稱允許換行，不使用 line-clamp／ellipsis |
| `.record-grid` gap / 對齊 | 約 8px；**`align-content: start`** | 搜尋縮至 1～5 筆時禁止唯一卡列被 CSS Grid 預設 `stretch` 拉滿整個可捲動區；保持五欄 |
| `.record-detail` | min-height 約 64px，內容可獨立捲動 | 詳情完整可看，但首列優先 |
| `.line-record` | 緊湊 padding，文字 line-height 約 1.5 | PRESENT 證詞偏長時可在局部區域捲動，不遮住卡片 |
| Header | `align-items: center`、`flex-wrap: wrap`；**一律隱藏重複 `.eyebrow`** | 在 800×600 的 PRESENT 同時容納 h2、搜尋、計數、證詞進度及 ESC；不能靠單行硬塞；保留 h2、進度與 ESC |

以上為實作起點，不是精確像素驗收值。**長標題完整可讀、第一排完整可見**優先於維持原縮圖尺寸；若仍不夠先減少重複裝飾文字，再調局部間距，不導入新版面架構。

### 2.4 800×600 緊湊版文字 wireframe

~~~text
┌──────────────────────────────────────────────────────────────────┐
│ 出示紀錄    搜尋紀錄 [ 維修________ ]   顯示 3 / 74       ESC │
├──────────────────────────────────────────────────────────────────┤
│ 出示對象：三宅蒼太                                              │
├──────────────────────────────────────────────────────────────────┤
│ [縮圖]      [縮圖]      [縮圖]      [縮圖]      [縮圖]            │
│ 完整標題    完整標題    完整標題    完整標題    完整標題          │
│ 來源        來源        來源        來源        來源              │
│             （只有這個 grid 可捲動）                            │
├──────────────────────────────────────────────────────────────────┤
│ 目前紀錄詳情：名稱、來源、說明（過長則此區內捲動）              │
├──────────────────────────────────────────────────────────────────┤
│ 選擇紀錄出示                                遊戲選單    收回 │
└──────────────────────────────────────────────────────────────────┘
~~~

PRESENT 同一位置保留「提出證據／鎖定證詞／證詞進度」；小視窗 Header 必須可換行。搜尋只剩一列時，卡片由頂部開始排，不拉伸到填滿整個 grid。此圖為資訊層次 mockup，不是另做 UI 產品。Linear 只有修前截圖，沒有現成目標 mockup。

## 3. 明確非目標

HPA-852/HPA-832 熱點與 HUD、HPA-706 Analysis board、HPA-831 黑色證物圖片或跨場景藍線均不屬此 PR。不改 Rust、存檔 schema、scene 內容、答題邏輯、背景圖、SFX、語音或全域 token。保留 **一張票、一個 PR**。

## 4. End-to-end 驗收契約（均為自動化）

1. `presentation.test.ts` 純函數 table test：四欄、NFKC 全形查詢、英文字母大小寫、空 query identity、穩定順序、零結果；`InterrogationEvidenceTray.test.ts` 驗證 UI wiring、空結果、卷軸重設、搜尋前後清理 hover/focus/inspected、Tab/Shift+Tab、SHOW/PRESENT 原 `kind,id`。**必定修訂既有** `traps tab focus`、`wraps shift+Tab`、`all controls disabled` 斷言：search 在 ESC 前方且即使忙碌也可聚焦。重新開啟自動從頂端是 regression guard，**不需要先在 main 上失敗**。
2. 對 **packaged Tauri 的真實 Chapter 2 inventory ≥74**，使用既有 WDIO `production-journey` 運行搜尋。重用原 route，不做假的 evidence fixture。將原本 module-local `ensureMinimumWindowViewport` 抽成 `e2e-tauri/helpers.ts` 共用，**只在第 2 章最終聽證 `interrogation_scene_19` 的盤已開啟時**縮至 **800×600 CSS px**；`analysis_scene_13`、`15`、`18` 均在最終聽證之前，不得提前縮視窗而影響拖放。測完恢復 `ensureCaseFileViewport()` 是測試隔離，不是為了後續 Analysis。
3. 800×600 **DOM bounds** 自動判定搜尋輸入、Header、首列完整標題、grid、detail、Footer 和 ESC 在可視區內且不互蓋。由 WDIO 存 screenshot 為 PR artifact，MCP agent 據截圖作可讀性視覺檢查並記錄觀察；**截圖不是獨立、主觀 pass/fail gate**，以具體 DOM 幾何與操作斷言為準，不要求人手認收。
4. 在變更後的 `clickRecordTile` 優先以 WebDriver `setValue` 輸入真實 CJK 紀錄名稱，**先驗證 WebKit/tauri-plugin-wdio 確實觸發 Svelte input 更新**；若未能可靠輸入，改沿用現有 `helpers.ts` 的局部 `browser.execute` 做法（設定 `input.value` 並 dispatch `input`），再檢查篩選結果，不能只聲稱 `setValue` 可用。點選時以 `.record-copy strong` 比對紀錄標題，不用整張 tile 的 `textContent`，避免來源文字碰巧同名。確認目標在首個可見結果畫面、原始 `onPresent` 正常運作；不重演完整 wrong-evidence、Game Menu 疊層及 Escape E2E，這些由既有元件回歸覆蓋。
5. 完成 Svelte check、focused unit、lint/format、WDIO E2E typecheck、packaged smoke（不是 production-journey）以及獨立 `--suite production-journey` 執行紀錄；800×600 時需額外驗證**單一搜尋結果卡片不被 stretch**、PRESENT Header 於換行後不溢出。**未跑完不得標成已驗收**。

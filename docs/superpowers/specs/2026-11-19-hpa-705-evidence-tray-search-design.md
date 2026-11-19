# HPA-705 — 大量證物下的 SHOW／PRESENT 紀錄盤可搜尋性（設計規格）

> 狀態：設計草案，**尚未實作／尚未驗收**。對應 [Linear HPA-705](https://linear.app/cwchanap/issue/HPA-705/evidence-tray-is-hard-to-use-with-dozens-of-records-show-出示紀錄)；基線為 2026-11-19 的 `main` 原始碼。**單一任務、單一 PR**：本 Draft PR 先放設計與計劃，後續在同一分支加入程式與測試，不另開 implementation PR。

## 1. 現況與問題

2026-11-11 的 800×600 packaged Tauri UAT 記錄：第 2 章最終審查會約有 74 筆紀錄，使用者必須在 SHOW／出示紀錄盤反覆進行大量盲目捲動（回報約 29 個畫面）；卡片標題落在可視區下緣、重新開啟時仍停在舊位置。Linear 附有 **現況截圖，不是目標 UI mockup**。

已核對現行原始碼：

- `apps/game/src/lib/components/InterrogationEvidenceTray.svelte` 同時服務訊問 PRESENT 與調查 SHOW。它透過 `presentableRecords(inventory)` 列出所有紀錄；`.record-grid` 固定五欄、每張卡有 106px 影像和 padding，在 600px 高視窗僅能顯示少量卡片。
- 目前沒有搜尋或篩選。既有 `present(kind, itemId)`、`resume()`、Escape claim、頂層 dialog 的 Tab trap 與 detail preview 都可重用。
- `apps/game/src/lib/interrogation/presentation.ts` 的輸出已包含 shortName、sourceTag、description、details、kind、id；**不需要新資料結構、索引或 Rust API**。
- `InvestigationSceneSurface.svelte` 與 `InterrogationStage.svelte` 都重用這個元件；改動必須同時驗證兩種入口。
- 現有 Tab trap 只搜尋 `button:not(:disabled)`。加搜尋輸入框後，**必須同步納入可聚焦 input**，不能只加 UI。

## 2. 決議：單一文字搜尋 + 800×600 緊湊排版

保留現有格狀證物盤、縮圖、hover/focus 詳情、原本的出示動作與順序；只加一個局部的「搜尋紀錄」欄位。**不新增分類 tab、章節索引、排序規則、最近使用、分頁、虛擬列表或外部搜尋套件**。

### 2.1 搜尋語義

1. Header 加一個清楚標示的輸入框 `搜尋紀錄`，placeholder 為「名稱／來源／內容」，旁邊顯示「顯示 N / 總數」。不必額外占用一整行。
2. 前端僅在目前 inventory 中即時篩選；以 `trim().toLocaleLowerCase()` 做不區分英文字母大小寫的 **substring match**，搜尋 shortName、sourceTag、description、details。中文可直接搜文字；不加模糊搜尋或新 metadata。
3. 空查詢顯示原始全部紀錄，維持既有順序與 kind/id；沒有結果時顯示「沒有符合的紀錄，請修改搜尋字詞」，而非空黑板。提供直接清除輸入值的方式（瀏覽器 search-input 清除功能，若 WebKit 不可靠則本元件一個小「清除」按鈕），不能增加第二個彈窗。
4. 每次修改查詢，紀錄格捲動回頂部；關閉再開新證物盤也從頂部開始。搜索狀態是 component-local 的暫態 UI，不寫入存檔或引擎。若被隱藏的卡先前有 hover／focus／inspected 狀態，詳情不可繼續顯示已被篩掉的紀錄。
5. 篩選只改可見選項；按下符合的證物仍傳原來的 `kind, id`，不改答案判斷、資料來源、解鎖或 wrong-evidence feedback。

### 2.2 緊湊排版

- 800×600 時，先縮小 dialog 間距／上下 padding、卡片中的圖片與卡片內距，保留至少一整列可見；標題可換行、**不得 line-clamp、ellipsis 或被滾動容器底緣截斷**。來源文字可降低字級但仍可辨識。
- 搜尋與數量放在 header 右側；PRESENT 的證詞進度、ESC、SHOW 的對象文字仍可見。保持可操作的卡片點擊區與鍵盤 focus ring。
- 不改既有 details panel 的資料來源或 `resolveStoryAsset()`；不靠隱藏縮圖解決空間問題。若短視窗要縮短 detail panel，必須依然能捲動看完整內容。
- 僅用局部 media query（尤其 `max-height: 650px`），不要全域改 `tokens.css`、其他 modal 或背景 HUD。

### 2.3 800×600 文字 wireframe（目標，供實作截圖對照）

~~~text
┌────────────────────────────────────────────────────────────────────┐
│ SHOW / 出示紀錄    搜尋紀錄 [ 維修____________ × ] 顯示 3 / 74  ESC │
├────────────────────────────────────────────────────────────────────┤
│ 出示對象 · SHOW TO    三宅蒼太                                 │
├────────────────────────────────────────────────────────────────────┤
│ [縮圖]        [縮圖]        [縮圖]        [縮圖]        [縮圖]    │
│ 完整名稱      完整名稱      完整名稱      完整名稱      完整名稱  │
│ 來源文字      來源文字      來源文字      來源文字      來源文字  │
│                 （只有紀錄格可獨立捲動）                       │
├────────────────────────────────────────────────────────────────────┤
│ 目前指向的紀錄：名稱、來源、說明及細節（必要時可捲動）        │
├────────────────────────────────────────────────────────────────────┤
│ 選擇紀錄出示                                      遊戲選單 收回 │
└────────────────────────────────────────────────────────────────────┘
~~~

wireframe 是資訊層次與空間優先級，不是精確 px；實作須尊重既有 Lyra 視覺 token。PRESENT 同一位置顯示「提出證據／鎖定證詞／證詞進度」，不可被搜尋功能蓋住。

## 3. 鍵盤、焦點及狀態邊界

- Tab／Shift+Tab 必須在搜尋輸入框、卡片、ESC、遊戲選單、收回之間正向與反向循環。原 `handleKeydown` 改為只查目前 tray 中可用的 input 與 button；頂層 Game Menu／Save Browser 開啟時仍尊重 `topLayerOpen`，不得攔截其 Tab。
- 保留原本首次開啟時聚焦 ESC 的契約，搜尋可由 Tab 到達，也可滑鼠點擊。不改 Escape claim：按 Escape 仍收回證物盤；搜尋輸入狀態不得令玩家卡在盤內。
- 搜尋後若原本 focused/hovered item 被隱藏，顯示空詳情或新 focus item 的詳情，不顯示失效殘影；搜尋結果切換不應把焦點送進 `display:none` 元素。
- 載入中（`disabled`）搜尋及出示操作不可產生額外遊戲命令；既有 onPresent callback 不改。關閉後仍依原有 returnFocusTo / fallbackFocusTarget 還焦。
- 不強行更動排序或 `presentableRecords` 定義；測試以足夠長的既有 inventory 骨架驗證，不建立新的搜尋 service。

## 4. 明確非目標與相鄰票

- 不處理 HPA-852、HPA-832 的場景熱點、HUD、證據清單以外的 UI；不處理 HPA-706 的 Analysis 板。
- 不修 HPA-831 的證物圖片黑框或跨場景藍色焦點框；那是不同的驗證／修復路徑。
- 不改 scene、story canon、證物內容、出示解題規則、引擎、Rust、儲存 schema、語音、美術或 SFX。
- 不為單一搜尋欄位做通用搜尋引擎、前端全域狀態或另一套 UI 元件庫。

## 5. 可機器判定的完成標準

1. Packaged Tauri **800×600**、含至少 74 筆紀錄：搜尋一個已知名稱／來源片語可在一個可見格畫面找出目標；空查詢回復全部；零結果顯示提示。保留縮圖和原始順序。
2. 800×600 截圖證明 Header、搜尋、對象／證詞、至少第一整排完整卡片標題、detail、收回都在 viewport 內且無互蓋。以本 wireframe 與 Linear 原 UAT 截圖比較，不能只看 jsdom。
3. 在 SHOW 和 PRESENT 中，以真實滑鼠／鍵盤選擇紀錄後，正確的 kind/id 進入原本的出示流程；錯誤證物可恢復；Escape 收回、重新進盤從頭開始，沒有舊捲動位置。
4. MCP 驅動的 packaged E2E（含 screenshot 與 DOM 幾何／鍵盤檢查）通過；元件測試、Svelte check、lint／format 和既有 smoke E2E 通過。**不得用人手驗收取代自動驗收**。

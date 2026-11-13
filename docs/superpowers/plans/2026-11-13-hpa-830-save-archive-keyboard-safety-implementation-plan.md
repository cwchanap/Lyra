# HPA-830 — Save Archive 鍵盤安全性：單一 PR 實作計劃

> **設計：** [HPA-830 鍵盤安全規格](../specs/2026-11-13-hpa-830-save-archive-keyboard-safety-design.md) · **Linear：** [HPA-830](https://linear.app/cwchanap/issue/HPA-830/saving-with-the-keyboard-can-accidentally-delete-a-save-slot)
>
> **狀態：** 待審設計／計劃，尚未進入程式碼實作。**交付：** HPA-830 僅使用目前這個 Draft PR；審閱後同一 PR 補實作、測試及 UAT 結果。基線 main @ f706bb16ef28d33292867482377bc85f1228f0cc。

## 實作策略與依賴

採用 **「先鎖破壞性操作，再收焦點與視覺」** 的最小變更，不做存檔架構改寫。工作依序完成，**不是拆成不同 PR**；沒有外部技術依賴，也不需要新圖片／SFX 任務。

預期主要修改：
- apps/game/src/lib/components/SaveConfirmationDialog.svelte（危險操作預設焦點）
- apps/game/src/routes/+page.svelte（移除四個競爭的 confirmation initialFocus、title menu inert、縮圖警告繁中呈現）
- apps/game/src/lib/components/SaveBrowser.svelte（archive 初始焦點、鍵盤邊界）
- apps/game/src/lib/components/SaveCard.svelte（聚焦樣式、可見性）
- apps/game/src/lib/components/SaveRecapDetails.svelte（僅在確認文字裁切後調整）
- apps/game/src/lib/components/MainMenu.svelte（僅在查證全域鍵盤／延時 focusTimer 會搶焦點時作最小 guard）
- apps/game/src/lib/components/*.test.ts、apps/game/src/routes/page.test.ts、apps/game/e2e-tauri/save-management.e2e.ts（回歸證據）

Rust 存檔系統只在「亂碼確實可重現且原因指向 Rust」時才有必要改動；勿更動 HPA-854 已合併的捕捉／restore 快路徑。

## Task 1 — 重現失敗的鍵盤操作測試（先 Red）

**目標：** 讓目前 main 上危險的預設焦點與背景 Tab 漂移被自動測試捕捉。

1. 在 SaveConfirmationDialog.test.ts 添加測試：delete 對話框開啟後應聚焦取消；連續 Enter 不觸發 onConfirm；只有焦點明確移到「確認刪除」或滑鼠明確點擊時才觸發刪除；Escape 返回觸發者；pending 不能重入。
2. 修改現有「autofocuses the action」用例，**不要**保留要求 delete 預設聚焦 confirm 的過時斷言。保留 load、overwrite 的既有測試。
3. 在 SaveBrowser.test.ts 驗證三種模式的穩定 DOM 順序、初始焦點、Tab／Shift+Tab 在 archive 內循環、重開後焦點不飄到背景；測試空槽、損壞槽、無法載入槽仍不變。
4. 在 page.test.ts（或更合適的現有整合 fixture）驗證 title deletion、game deletion、game load、overwrite 的 focus ownership 不被外層 locator 強制覆蓋。必要時使用明確的微任務／tick，**不用 sleep 來掩蓋競態**。
5. 把最重要的打字流程加入既有 packaged save-management E2E：以**隔離測試存檔槽**先 seed 已佔用資料，開啟標題／遊戲內瀏覽器，鍵盤啟動 Delete 並連續 Return，直接讀磁碟驗證原檔與另一槽未變。

**完成條件：** 至少一個焦點測試在原碼上為 Red；它能分辨「只是出現確認框」與「真的落盤刪除」，而非只用文字斷言模擬成功。

## Task 2 — 單一安全焦點擁有者

1. 在 SaveConfirmationDialog.svelte 僅針對 kind === "delete"，onMount 優先聚焦 cancelButton；保留 load／overwrite 既有預設按鈕、Tab trap、Escape、pending 禁用及 focus restoration。
2. 在 +page.svelte 的四個 confirmation 啟動位置（title delete、game delete、game load、manual overwrite）移除「最後一顆可用按鈕」的第二個 initialFocus 參數；controller.openConfirmation 保留原本 opener locator，以便 cancel/back 恢復。
3. 完成前後逐一驗證：delete 首個 Enter 應取消、不能直接呼叫 delete_save；滑鼠「確認刪除」仍有作用；load／overwrite 的既有流程不改；失敗或過期觀測值仍受原有 Rust expectation 保護。
4. 檢查重複快速 Enter 不會因兩個 onMount／tick 聚焦者互相覆蓋而誤點。

**完成條件：** 刪除必須由玩家第二次**明確選擇危險按鈕**才可成立；不新增額外 modal、輸入槽名、全域 key listener 或 Rust 命令。

## Task 3 — Save Browser 焦點封閉與返回

1. 讓 SaveBrowser.svelte 本身建立適當對話框語意與可聚焦根節點，開啟後固定聚焦安全「返回」按鈕；Tab 只在當前可見且可用的控制中循環，Shift+Tab 方向相反。保留現有按槽號排序與 button aria-label。
2. title archive 開啟時，將背後 MainMenu 設為 inert 或以現有元件的最小控制關閉焦點入口；驗證其 1.5s focusTimer 和全域 ArrowUp/Down 不會把焦點拉出 archive。若實測需要，僅在 MainMenu 加一個明確的 modal-active guard；不建立通用 focus manager。
3. 遊戲內 archive 與 GameShell 選單的層級也應維持同樣焦點邊界；關閉後 controller 把焦點送回 Save/Load 入口。保留 Escape 逐層返回與 repeat guard。
4. 以 browser controller 的現有 tick + opener 設計恢復被卸載／重新渲染的觸發按鈕，避免新建「選中槽」狀態來源。

**完成條件：** titleLoad、gameLoad、manualSave 開兩次的 Tab 路徑穩定，不會跑進底下 title／game UI；取消後能回到原操作，無意外觸發相鄰槽。

## Task 4 — 最小視覺及在地化修正

1. 在 SaveCard.svelte 按鈕加入明顯、高對比的 :focus-visible 樣式；必要時用 :focus-within 讓整張卡片顯示焦點所在，但保持 selected 與 keyboard focus 的語意分離。SaveBrowser 的「返回」及確認視窗的取消／確認同樣需清楚。
2. 以 800×600 真實視窗檢查槽 1–3 的縮圖、場景文字與操作列。只有確認有裁切時才調整 SaveRecapDetails／SaveCard 的尺寸、正常換行、overflow-wrap 或安全捲動；不重新設計 Save Archive。
3. 在 +page.svelte 以 thumbnailActivity.diagnostic.reason 作 presentation-only 的繁體中文訊息（例如 captureUnavailable →「無法產生存檔預覽圖片；存檔不受影響。」）；未知類別也有安全繁中 fallback。保留原始診斷於資料層，不改後端或預覽策略。
4. 沒有新圖／SFX／配音需求，不生成或調整素材。

**完成條件：** 在 800×600 肉眼能辨認 focus，場景名稱末字不被裁半，所有玩家可見的縮圖失敗提示為繁體中文且不誤稱存檔已失敗。

## Task 5 — 存檔 JSON 亂碼的限界診斷

1. 若能取得報告中的原 UAT autosave，先**複製到隔離目錄**，檢查 entry 574 的原始 UTF-8 bytes 和實際 Unicode code points，區分「檔案已是 replacement character」與「檢視工具誤解碼」。
2. 比對該行的 Markdown／locale 與 compiled scene 資源、Rust 對話 history 中的字串，以及 serde_json 輸出的存檔字串，定位第一次發生變化的位置。
3. 以現行來源加入最小 Unicode 對話 history round-trip 測試，包含繁體中文字與非 ASCII 符號。若可證明當前寫檔會轉壞，修該一處及測試；若不能重現，明列檢查過的邊界和缺失的重現條件，**不要宣稱已修好**。
4. 如果真正問題是獨立的歷史資料／作者內容污染，另立後續 ticket（如確實需要）而非把整個內容或 persistence 架構納入此一安全修正。

**完成條件：** 亂碼有可檢驗的原因／範圍記錄；沒有猜測性編碼遷移、沒有為舊版存檔加入 compatibility 層。

## Task 6 — 回歸、UI UAT 與同一 PR 收尾

### 自動檢查

在 repo root 執行：
~~~bash
bun run check
bun run test
bun run lint:all
bun run --cwd apps/game check:e2e
~~~

完成時使用既有 Tauri packaged save E2E（本機 focused runner 加快迭代；CI 照原有 smoke/full 規則）：
~~~bash
bun run --cwd apps/game test:e2e:save
bun run --cwd apps/game test:e2e:smoke
~~~

不要改 CI 觸發策略來遷就此票；Draft PR 的 CI E2E 可能不自動執行，轉為 Ready 前執行既有驗證。

### macOS + Windows E2E 驗收

以**獨立測試 profile**與有備份的手動槽 1、2，對 macOS、Windows 各執行以下 end-to-end 動作（Lyra 是桌面遊戲，不要求 iOS）：

| 路徑 | 玩家端操作 | 驗收 |
| --- | --- | --- |
| 標題 Load | 開啟 Archive → Tab 掃描 → 關閉 → 重開 → 重複 | 焦點從返回出發，次序一致，底下 MainMenu 不搶焦點；Escape 回原入口 |
| 遊戲內 Save/Load | 從 Game Menu 開 archive、移往有資料的手動槽 | 800×600 聚焦明顯、場景全文可讀、可正常選擇儲存／載入 |
| 最重要破壞性路徑 | 以鍵盤開啟槽 1 Delete → 連按 Return，不切換至危險按鈕 | **槽 1 JSON/內容不變；槽 2 亦不變**；只可能取消／重開確認 |
| 合法刪除 | 開啟槽 1 Delete → Tab 至「確認刪除」→ Return；再測滑鼠明確點擊 | 只刪除槽 1，槽 2 保留；列表即時更新 |
| 既有其他操作 | 取消、覆寫、從標題載入、遊戲內載入、刪除無效槽、返回標題 | 原先的 confirmation、保全期待值、檔案載入／覆寫流程正常 |
| 預覽與字體 | 人為讓 thumbnail unavailable、查看槽 1 場景名稱 | 繁中通知說明預覽失敗不代表存檔失敗；場景末字不裁切 |
| JSON 診斷 | 取當前真實 Unicode 存檔並重新讀取 | 不能出現新的 replacement characters；原 UAT 亂碼判定依 Task 5 記錄 |

### 視覺檢查

- macOS／Windows 都以**預設 800×600** 視覺確認三張手動存檔卡、刪除／取消焦點、archive 內捲動與場景中文文字，不只依靠 jsdom。
- HPA-830 目前**沒有附帶 UI mockup**。若 ticket 在開工時新增 mockup，以該圖核對焦點、留白與文字可讀性；否則以 UAT 報告中的截圖標記／真實遊玩前後對照，附 PR screenshots 或操作紀錄。
- Linux 只跑 CI 自動驗證；**不做 Android 或 Linux 手動驗收**。

**完成條件：** 修正後 packaged 版本在 macOS、Windows 的實際鍵盤操作不能再透過連續 Return 刪除存檔；明確確認可正常刪除；手動與自動存檔行為完整，視覺與在地化驗收通過，PR 說明附驗證結果與仍未確認的 UAT 原始亂碼資料限制。

## PR review checklist

- [ ] 此 Draft PR 的兩份文件經 review，範圍沒有超出 HPA-830
- [ ] Task 1–5 的程式變更、單元／整合／E2E 測試全部追加於**同一 PR**
- [ ] 真實雙 Return 誤刪案例已用檔案內容／saveId 的 end-to-end 斷言防止復發
- [ ] macOS、Windows 800×600 UI 視覺驗收與手動鍵盤驗收有記錄
- [ ] 驗證結果／限制已更新到本 PR；無新圖片音效工作、無 Rust schema migration
- [ ] 準備合併時才把 PR 改為 Ready；不要先把 Linear ticket 標 Done

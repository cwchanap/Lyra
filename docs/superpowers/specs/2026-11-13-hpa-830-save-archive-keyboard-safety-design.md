# HPA-830 — Save Archive 鍵盤操作與誤刪防護設計規格

> **Linear：** [HPA-830](https://linear.app/cwchanap/issue/HPA-830/saving-with-the-keyboard-can-accidentally-delete-a-save-slot) · **狀態：** 設計草案，尚未實作 · **基線：** Lyra main @ f706bb16ef28d33292867482377bc85f1228f0cc（2026-11-13）
>
> **交付規則：** 一張 ticket、一個 PR。此 Draft PR 只承載設計與實作計劃；通過審閱後在**同一 PR** 補程式碼和測試，不另開「實作 PR」。

## 1. 問題與風險

2026-11-06 的第一章 800×600 packaged E2E 手動遊玩，玩家在 SAVE ARCHIVE 透過 Tab 尋找存檔槽時：
- 重開存檔瀏覽器後，相同 Tab 次數可能落在「返回」或槽 1 的「刪除」；焦點位置難以辨認。
- 連續按 Return 可從存檔槽操作走到確認刪除；報告中的 manual-1.json **真的被刪除**，需靠外部備份還原。
- 槽 1 的場景名稱末字被卡片邊緣裁掉，縮圖失敗時會在繁體中文遊戲顯示英文通知「Thumbnail capture is unavailable.」。
- 另有舊 autosave 的 dialogue history 字串「相���點頭」，但當次遊戲畫面顯示正確；**尚未證實是序列化錯誤**。

**嚴重性：** 玩家已經遭受存檔遺失；優先修正破壞性操作，不為了焦點問題重做整套存檔 UI。

## 2. 從目前 main 確認的原因與待驗證假說

| 位置 | 已確認行為 / 待驗證風險 | 決策 |
| --- | --- | --- |
| apps/game/src/lib/components/SaveConfirmationDialog.svelte | onMount 優先聚焦可用的 confirmButton；刪除確認因此預設聚焦「確認刪除」 | **改成 delete 預設聚焦「取消」**；保留其他確認模式原行為 |
| apps/game/src/routes/+page.svelte | title delete、game delete、game load、overwrite 開啟確認層時，又用最後一顆可用按鈕作 initialFocus，會覆蓋元件本身的安全初始焦點 | **移除四處多餘的 confirmation initialFocus locator**；讓確認對話框單獨擁有初始焦點 |
| apps/game/src/lib/components/SaveBrowser.svelte | 瀏覽器無明確的對話框焦點邊界與開啟後的固定初始焦點 | 以現有 DOM 與 controller 建立固定焦點次序，不引入新 focus manager |
| apps/game/src/lib/components/SaveCard.svelte | article.selected 與實際鍵盤焦點不是一回事；操作按鈕缺少清楚 focus-visible 樣式 | 在被聚焦的按鈕及所屬卡片提供清楚可見、互不混淆的狀態 |
| apps/game/src/lib/components/MainMenu.svelte | title MainMenu 在存檔覆層下仍掛載；有全域 ArrowUp/Down 與延遲 focusTimer，可能搶走覆層焦點 | **待回歸驗證**；title archive 開啟時令底下主選單 inert／不參與焦點 |
| apps/game/src/lib/components/SaveRecapDetails.svelte | sceneTitle 沒有明確保證 CJK 末字在窄卡片可完整呈現 | 在 800×600 檢查，僅針對確實裁切的排版作小修 |
| apps/game/src/routes/+page.svelte | thumbnailActivity 的 diagnostic.message 原樣展示，故可能直接顯示英文 | 只在前台依 diagnostic.reason 顯示繁中友善訊息；不改 Rust 診斷契約 |

### 根因範圍

「確認刪除」被**兩個焦點擁有者**指定為預設行為，是已從程式碼證實的危險路徑。Tab 次序不穩與 MainMenu 延時搶焦點的關係尚屬假說，需由元件與 packaged E2E 驗證，不預先寫成已查明的事實。

## 3. 鎖定互動契約

### 3.1 存檔列表

1. 從標題畫面（titleLoad）、遊戲內載入（gameLoad）、手動儲存（manualSave）開啟時，焦點固定放在瀏覽器的**安全「返回」**，不是第一個可刪除槽。
2. 瀏覽器使用可辨識的 modal 語意與鍵盤邊界；Tab / Shift+Tab 僅循可見且可用的操作控制前後移動，不游走到背後的主選單。焦點次序依既有畫面順序固定：返回 → 自動槽 1–5（載入模式）→ 手動槽 1–3；各槽仍按選擇／載入／刪除的畫面次序操作。不為了這項 bug 重設卡片資訊架構。
3. 重開瀏覽器、從確認框取消返回、存檔操作完成重新顯示時，初始焦點與返回目標皆可預測；各層保留既有 Escape 返回一層、避免 key-repeat 連續關閉的規則。
4. title archive 開啟時，底下 MainMenu 不能再參與焦點或搶鍵盤導覽；關閉後焦點回到載入遊戲入口。遊戲內則回到開啟存檔的選單項目。
5. 被鍵盤聚焦的操作必須有明顯高對比外框，且必要時能捲到可視位置；**selected 的卡片邊線不代替 focus**。不破壞滑鼠操作。

### 3.2 刪除確認（最重要的安全契約）

1. 點擊或鍵盤啟動刪除只會**開啟**確認框，不立即呼叫 delete_save。
2. 確認框清楚顯示目標存檔槽、已有的存檔資訊，以及「刪除後無法復原」；預設聚焦「取消」。
3. 在未進行明確轉焦點或滑鼠點擊的情況下，**同一槽連續兩次 Return 不得刪除檔案**。玩家需明確移往「確認刪除」（例如 Tab 一次或滑鼠點選）才可送出。
4. 真正確認仍使用既有 observed saveId + modifiedAt expectation；刪錯槽、過期 UI 狀態及重入中的請求仍應受原有後端檢查保護。
5. Escape／取消恢復到原本的刪除按鈕；成功刪除後依既有流程更新列表。不新增第二重 modal、輸入槽名、倒數計時、長按按鈕或改變磁碟儲存邏輯。
6. Load／Overwrite 仍各自有既有確認流程。為避免意外破壞現有行為，本票只特別修改 **Delete 的預設焦點**；其他兩種確認模式的焦點及操作必須回歸測試。

### 3.3 排版與用語

- 預設 800×600 視窗（約 568px 可用內容高度）下，手動槽 1–3 都可以辨識聚焦位置、看清按鈕及場景名稱；避免「相馬事務所日常 — 年輕偵探的入口」末字被直接切半。若內容超長，採可讀的正常換行／完整可捲動內容，不擴大卡片到遮蔽操作。
- 只對 thumbnailActivity 的使用者通知作繁中顯示；例如「無法產生存檔預覽圖片，存檔不受影響。」。不要顯示令人誤認存檔失敗的錯誤；原診斷 code/message 仍可保留於程式內除錯資料。
- 不新增圖片、音效、背景或字體資產；不牽涉故事與 chapter 內容。

## 4. 存檔 JSON 亂碼：先取證，不猜修法

舊 UAT 報告指出 autosave 的 dialogue history entry 574 有 replacement characters，**但遊戲內文字正確**。先檢查四個邊界：
1. 玩家當時使用的 JSON 原始位元組，與檢視工具是否有轉碼；不要把文字編輯器的顯示視為序列化定論。
2. 現行編寫 Markdown／locale 源頭與 compile-scenes 輸出的文字是否相同。
3. Rust 對話佇列／history 當下字串與落盤後的 serde JSON 內容是否有差異。
4. 在現行 main 用含繁中字的可重現存檔測試往返一次。

若證實現行寫檔邊界真的破壞 UTF-8，在本票只修真正失效的邊界並加入小型回歸；若是舊 UAT 檔損壞、來源內容已損壞、檢視工具轉碼，或無法重現，記錄證據與結果，不因猜測加入新編碼層／save migration。明確獨立的大型修復應另立票，不偷偷併入此互動修正。

## 5. 非目標及和其他票的邊界

- 不改 SaveSnapshot、schema version、磁碟檔名、存檔清單順序、Rust persistence operation_gate、原有 stale-save 防護或 autosave 策略。
- 不重做 thumbnail capture。HPA-707 處理 autosave 預覽缺失；本票只翻譯當前通知，不承諾修好預覽生成。
- 不重新處理 HPA-854 save/load 效能，也不引入新快取、全域焦點管理器或 UI framework。
- 不攬入 HPA-852 的全遊戲 HUD／角色位置、HPA-705 的審問證據盤或 HPA-853 的 Chapter 2 scene layout 工作。
- 不為尚未發行的存檔加入 backward-compatibility 移轉。

## 6. 驗收契約

以下屬**實作 PR 完成條件**，不是此份文件 PR 已通過的驗收：

1. **macOS、Windows 各跑一次 packaged Tauri 真視窗 E2E**，預設 800×600，使用鍵盤操作 title Load 與遊戲內 Save/Load：打開、關閉、再打開，Tab 次序與焦點相同，不能落在背景選單；Escape 恢復正確入口。
2. 以實際已佔用槽及備份／隔離的測試存檔，在標題與遊戲內各驗一次「Delete → Return → Return」：原槽仍存在且可載入；用 Tab 指向「確認刪除」再按 Return，或滑鼠明確點擊，才會刪掉**指定**槽，其他槽保持不變。
3. **視覺人工檢查**：800×600 中槽 1／2／3 的 focus-visible 足夠清楚、標題與操作不裁切、Delete 的取消與危險按鈕明確區分；若 Linear 票後續附有正式 UI mockup，須對照 mockup 檢查。**目前票內沒有提供 mockup**，先以 2026-11-06 UAT 描述和實際畫面核驗。
4. 手動儲存、覆寫、載入、取消、無效槽刪除與返回原有流程正常；存檔可真正寫入／載入，不因 thumbnail unavailable 而被判失敗。縮圖通知以繁中呈現。
5. 亂碼問題有可重現測試或明確的排除／未重現紀錄；不能在沒有證據時宣稱已修好。
6. TypeScript／Svelte 單元測試與既有 packaged 存檔管理 E2E 回歸通過；Linux 依 CI 執行自動檢查，**不做 Android／Linux 手動驗收**。

## 7. 設計完成的判準

玩家不可能再因看不清焦點而在連續 Return 下誤刪存檔；操作順序可預測、確認視窗的危險行為是刻意選擇、現有存檔功能與檔案契約維持原狀。開發變更集中在存檔頁／確認框／焦點展示及對應測試，沒有新抽象或跨系統重構。

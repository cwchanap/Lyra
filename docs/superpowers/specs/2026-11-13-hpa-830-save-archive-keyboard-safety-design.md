# HPA-830 — Save Archive 鍵盤誤刪防護設計規格（Review 修訂）

> **Linear：** [HPA-830](https://linear.app/cwchanap/issue/HPA-830/saving-with-the-keyboard-can-accidentally-delete-a-save-slot) · **Reviews：** [第一輪](https://github.com/cwchanap/Lyra/pull/133#pullrequestreview-5900492460)／[第二輪機制核對](https://github.com/cwchanap/Lyra/pull/133#pullrequestreview-5900890794) · **基線：** main @ f706bb16（2026-11-13）
>
> **狀態：** 設計／實作計劃修訂，**產品程式尚未修改**。一張 issue、一個 PR；通過 review 後在同一 PR 追加修正及測試。

## 1. 玩家問題

2026-11-06 packaged E2E、預設 800×600 遊玩回報：
- Title／遊戲內 SAVE ARCHIVE 的 Tab 起點在重開時不一致，focus 邊線不清楚；按 Return 選錯操作後，曾真實刪除 `manual-1.json`。
- **不只 Delete**：手動 Save 選到已佔用槽 → 命名框預填 → Return 繼續 → 覆寫確認預設聚焦「確認覆寫」，下一次 Return 同樣可能永久取代舊進度。
- 槽 1 場景名稱「相馬事務所日常 — 年輕偵探的入口」末字被裁半；縮圖失敗通知顯示英文。
- 舊 autosave 的對話歷史曾被檢視為「相���點頭」，但當時遊戲內顯示正確；目前沒有可核證的寫檔重現。

**目標：** 任何破壞既有存檔的動作都必須刻意選擇危險按鈕；取消後焦點回到原操作，重開後也可預期。不重做存檔系統。

## 2. 已核對 main 的失效機制

| 來源 | 現行行為 | 最小修正 |
| --- | --- | --- |
| `SaveConfirmationDialog.svelte` 的 `onMount`／`keydown` | 所有 kind 優先聚焦 confirm；現有 Tab 僅在首尾控制項做 wrap，從第一個「取消」向前 Tab 時會依賴 macOS WebKit 原生 button Tab | `kind === "load"` 才優先 confirm，Delete／Overwrite 預設 **取消**；同時將確認框 Tab／Shift+Tab 改為**每次都用 JS index cycling**（沿用 `AcquisitionPopup`），不依賴原生按鈕 Tab |
| `+page.svelte` 四個 confirmation 入口 | title delete、game delete、game load、manual overwrite 另用 `button:not(:disabled):last-child` 強制將焦點送往確認 | 移除四處競爭 locator；由 dialog 單獨負責初始焦點 |
| `+page.svelte` 的兩個 Delete opener | 傳入 `() => opener`，但 Browser 進入 confirmation 層會卸載，`opener.isConnected === false` | 改用既有 `slotActionLocator(slot.reference, "delete")`，在返回時重新查詢新按鈕 |
| `SaveConfirmationDialog.svelte` 的 `returnFocusTo` | 只有元件測試傳入，產品呼叫者未提供；與 controller 的返回責任重疊 | 刪掉未使用 prop／`restoreFocus`，只由 controller.restoreFocus 經現有 `tick()` 回焦 |
| Title Menu | `MainMenu` 仍掛載；全域 `window.keydown` 監聽不會因 root 變 inert 自動停止，且 Archive 是其兄弟節點，故 `event.target.closest('[inert]')` 無效 | 在 MainMenu 最外層 DOM 設 `inert` prop，並於**自身** `focusCard` 與 `onKey` 一開始 `if (inert) return`；1.5s timer 經 `focusCard(0)`，不加新鍵盤控制器 |
| 遊戲內 gameplay | `persistenceLayerOpen` 已驅動 `GameShell` 的 `gameplayInert` | **保留、沿用**，不新增同等邏輯 |
| 刪除成功之後 | `openTitleBrowser`／`installGameBrowser` 重建 Browser，未指定新焦點 | controller 新建時的唯一 `initialFocus` 指向**返回**，兼顧正常開啟和刪除成功回到列表 |
| Browser 初始焦點 | 由瀏覽器／殘留焦點決定，缺固定起點；`GameShell` 也有「返回選單」而非 Browser 的「返回」 | 新增 `browserBackLocator = () => document.querySelector<HTMLElement>('[aria-label="存檔瀏覽器"] button.back')`，兩個 Browser creation site 以 `options.initialFocus` 共用 controller 既有 `focusWhenReady`，**SaveBrowser 不加第二個 onMount focus** |
| `save/application/mod.rs` | `capture_unavailable_activity()` 的 message 為 `Thumbnail capture is unavailable.`，前台直接展示 Rust 訊息 | **只翻譯該 Rust 文案**，不用前端 `reason → message` map |
| 其他 persistence errors | `error.rs` 仍有英文 `Save selection is stale.` 等訊息 | **獨立本票範圍**：另追蹤全面持久化錯誤在地化，不把所有後端字串納入鍵盤修正 |

上述 Delete opener 的 stale DOM 問題有既有 `save-browser-controller.test.ts`「re-resolves a name-layer opener」模式可重用；不是猜測新架構。主選單延時 focus 的其他潛在問題只在驗收能重現時處理。

## 3. 鎖定互動契約

### 3.1 Delete 與 Overwrite

1. 點擊或鍵盤開啟破壞性確認框，只能進入「確認」狀態，尚未寫入／刪除磁碟。
2. `kind="delete"`、`kind="overwrite"`：預設聚焦 **取消**；`kind="load"`：保留既有 **確認載入** 預設焦點。
3. 「Delete → Return」應觸發取消並回到**同一個槽的刪除按鈕**。再按 Return 也只可能重新打開確認，不能不經明確選取「確認刪除」便刪檔。
4. 「已佔用槽選擇 → 命名預填 → Return → 覆寫確認 → Return」只取消覆寫；焦點應回到重新渲染的**命名框繼續**按鈕。再次明確選取「確認覆寫」才可覆寫。
5. 玩家必須先**明確把焦點移到危險按鈕**（確認框採 `AcquisitionPopup.svelte` 同款 unconditional JS Tab／Shift+Tab index cycling，或以滑鼠點選）才可執行 Delete／Overwrite；不依賴 macOS 原生 Tab 是否略過 button；`Escape` 等同取消。
6. 成功刪除後，重建列表，焦點安全地回到**返回**；不指向已消失的刪除按鈕。保留現有 `saveId + modifiedAt` expectation、pending/reentrancy 與 error 行為。
7. 不新增確認二次彈窗、倒數、輸入名字、hold-to-confirm 或 Rust save schema 變更。

### 3.2 Browser 與焦點擁有權

1. `createSaveBrowserController` 新增**可選** `initialFocus` locator，供 Title／Game 兩個 Browser 建立入口提供安全的「返回」；使用現有 `focusWhenReady`，而**非**在 `SaveBrowser.svelte` 再加 onMount。
2. `openConfirmation` 刪掉第二個 `initialFocus` 參數，從型別上阻止未來再次競爭；`openName` 的 input initial focus 保留。
3. 取消 Delete／Load／Overwrite 時，controller 利用 locator 重新查詢**重新掛載的 DOM**；不把曾經卸載的 element 物件當作還原目標。元件本身不另做 returnFocus。
4. Title MainMenu 最外層設 `inert`；它的 `window` 全域 ArrowUp/ArrowDown listener 必須主動在 `onKey` 起首檢查**自身的** `inert` prop（且 `focusCard` 亦同），不可檢查 Archive 事件目標的 `closest('[inert]')`；focus timer 走同一有 guard 的 `focusCard(0)`。遊戲內沿用既有 gameplayInert。不新增 Browser Tab trap 或新的通用鍵盤管理器；**不承諾 native Tab 會無限在 Archive 內循環**。
5. 所有 SaveCard／SaveBrowser／SaveConfirmationDialog 可操作按鈕需清楚的 `:focus-visible`，必要時局部 `:focus-within`；selected 卡片不等於鍵盤 focus。
6. **macOS WebKit：** 確認視窗**不再需要條件式 fallback**，因為 Task 2 一律用 JS cycling；實機在 Keyboard navigation 關閉時仍要測 `取消 → Tab → 確認刪除／覆寫`、`Shift+Tab`。Browser／命名框是否需要額外完整 Tab 巡訪則先按系統設定真機驗證，**只有確實不能操作時**才在該層複用既有模式；不可只測程式模擬 click。

### 3.3 排版與文字

- 預設 800×600 確認三個手動槽的按鈕與場景名稱可讀。只有確實被裁切才在 `SaveCard`／`SaveRecapDetails` 做最小 CSS 修正，不重設排版。
- 把來源 `capture_unavailable_activity().diagnostic.message` 一行改成「無法產生存檔預覽圖片；存檔仍可使用。」；只影響**thumbnail-unavailable** 通知。其他英文 persistence failure 文案不列本票驗收。
- 不生成圖片、音效、語音或字體資產。

## 4. 舊 JSON 亂碼：只保留證據筆記

當時記錄的「相���點頭」不是現今寫檔 bug 的充分證明：GitHub 中 `chapter_1/scene_6.md:52` 等作者文字完整；審閱指出受檢路徑 `src-tauri/src`／`packages/scripts` 無 lossy UTF-8 decode；Rust `String`／serde_json 本身不會把有效 UTF-8 任意變成 U+FFFD。三個 replacement characters 與「馬」的三個 UTF-8 bytes 相符，**比較可能是檢視／傳輸解碼環節**，不是已證明的存檔寫入損壞。

若日後取回 UAT 原檔，先檢視原始 bytes 是否真的含 U+FFFD，再獨立判斷是否需要修復；**本 PR 不做任何 UTF-8 四階段追查、serde round-trip 測試或存檔編碼修改**。目前狀態：原始 UAT 檔未於本次 review 提供，無法證明 main 可重現。

## 5. 非目標與分工

- 不改 Rust persistence operation gate、`SaveSnapshot`、schema、磁碟檔名、autosave、HPA-854 capture 速度、stale expectation。
- 不修 HPA-707 thumbnail 產生問題；只修這一則 Rust 顯示文字。
- 不重做 HPA-852 一般 HUD、HPA-705 審問證物盤、HPA-853 第 2 章定位；不為小說 scene 生成 art/SFX。
- 不建新 focus manager、Browser 專用 Tab trap（**除非 macOS 先驗證必需**）、MainMenu **新的鍵盤管理器**或前端通知映射；**保留必要的 `onKey`／`focusCard` inert early return**。
- Persistence error messages 的全面繁中在地化由 [HPA-912](https://linear.app/cwchanap/issue/HPA-912/localization-translate-player-facing-persistence-errors-to-traditional) 獨立追蹤，不綁定此 PR。

## 6. 端到端驗收條件（實作階段，尚未完成）

1. **macOS、Windows 真實 Tauri packaged 800×600**：在 titleLoad、gameLoad、manualSave 重開 Browser；焦點固定從精確定位的 `[aria-label="存檔瀏覽器"] button.back`「返回」開始，Tab 可順序導覽且無法操作背景選單；Archive 中 ArrowUp/ArrowDown 不可被背景 MainMenu 的 `window.keydown` 攔截，Escape 回正確入口；記錄 macOS Keyboard navigation 設定。
2. **Title Delete + Game Delete**：已佔用槽從「刪除」進入確認，第一下 Return 在安全「取消」上，回到重新掛載的同一槽 Delete；第二下 Return **只重新打開確認**，不可呼叫 `delete_save`，原 saveId 與 JSON 不變。其後 Tab 必須明確指向「確認刪除」，再 Enter 才刪除指定槽，其他槽不變。
3. **Game Overwrite**：已佔用槽從「選擇」打開命名框，連續 Return 不觸發 `save_manual`；只有明確選取「確認覆寫」才取代原槽。Load 依舊可以正常載入。
4. 刪除成功後聚焦「返回」。取消、Escape、pending、失效槽及過期 expectation 的行為不退步。
5. **視覺人工檢查**：focus ring 與「取消／確認刪除／確認覆寫」清楚可見；場景 CJK 尾字完整；thumbnail unavailable 通知為繁中，沒有宣稱存檔失敗。若 Linear 有 mockup，與 ticket mockup 比對；目前 HPA-830 沒有 mockup。
6. `page.test.ts` 三條真正 Enter 路徑及現有 Svelte／Rust／E2E 回歸驗證通過。`SaveConfirmationDialog.test.ts` 不再斷言元件自行還原 opener（僅斷言 `onCancel`），opener focus 由 controller/page 測試；E2E 用 `clickSaveCardButton` → Enter 取消 → 等待焦點還原 → Enter 再開 → Tab → Enter。macOS／Windows 手動驗收；Android／Linux 不要求手動驗收，Linux 依 CI。

**Done**：意外 Return 不再可破壞存檔；有意操作仍正常，前後焦點恢復一致，既有 save 語義不變。

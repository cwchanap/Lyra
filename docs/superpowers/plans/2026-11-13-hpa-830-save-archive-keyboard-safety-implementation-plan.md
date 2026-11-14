# HPA-830 — Save Archive 鍵盤安全：單一 PR 實作計劃（Review 修訂）

> **規格：** [HPA-830 安全設計](../specs/2026-11-13-hpa-830-save-archive-keyboard-safety-design.md) · **Linear：** [HPA-830](https://linear.app/cwchanap/issue/HPA-830/saving-with-the-keyboard-can-accidentally-delete-a-save-slot) · **Reviewer：** [PR #133](https://github.com/cwchanap/Lyra/pull/133#pullrequestreview-5900492460) · **main：** f706bb16
>
> **狀態：** Review feedback 已整合到規劃，產品實作與 E2E 尚未進行。**一張票、一個 PR**：此 Draft PR 後續直接加程式與測試，絕不另開實作 PR。無新 art／SFX。

## Review disposition / Scope

| 最新意見 | 決策 |
| --- | --- |
| Overwrite 和 Delete 都會被連續 Return 誤觸 | **接受**：兩者預設聚焦取消，Load 保持 confirm |
| Delete opener 是被卸載的 DOM element | **接受**：兩處改用已有 `slotActionLocator`，取消/ Escape 可回焦 |
| Dialog 自己的 `returnFocusTo` 沒有產品呼叫者 | **接受**：刪 prop／test 中重複 focus owner |
| 成功刪除後焦點落在 body | **接受**：統一讓新 Browser controller 的初始焦點回到「返回」；不另外加 focus routine |
| 必須有 page-level Red 而非只有元件測試 | **接受**：`page.test.ts` 必須覆蓋 title Delete、game Delete、game Overwrite |
| Title 背景 Menu 可用 inert；GameShell 已經 inert | **接受**：沿用而非新增 Tab trap、MainMenu handler |
| Browser 初始焦點由 controller 一處負責 | **接受**：增加 `initialFocus` option，移除 `openConfirmation` 的 initialFocus 參數 |
| thumbnail 英文從 Rust 一行產生 | **接受**：改 Rust message，不寫 frontend map；其餘英文 errors 另追蹤 |
| 舊存檔 mojibake 應先查原始 bytes | **接受**：移除整個診斷 Task，保留證據筆記，無代碼／測試工作 |
| macOS WebKit 可能不依 native Tab 進入 button | **接受為驗收風險**，先在 macOS 真視窗核驗設定，必要時才複用既有 Tab loop |
| E2E 重用 `deleteOwnedManual` | **接受**：不造新 seed / suite，明確執行非 smoke 的 save-management |
| 必要的既有條件 | **保留**：無 Rust save-schema、無額外 modal、`SaveRecapDetails` 僅在實際 clipping 後小修 |

## Task 1 — Red regression 先於修正

**必修測試：** `apps/game/src/routes/page.test.ts`，重用 title/in-game persistence fixtures 與 `userEvent.setup()`，不是只有元件層驗證。

**測試三個完整用戶路徑：**

1. **Title Delete**：標題畫面 → Load Archive → 聚焦已有資料的手動槽「刪除」→ `await user.keyboard("{Enter}{Enter}")` → 斷言從未調用 `delete_save`、確認層已取消、焦點回到**重掛載的同一槽刪除按鈕**。
2. **Game Delete**：進入遊戲 → Game Menu → Save/Load Archive → 同樣雙 Return → 斷言零 `delete_save`、正確 slot focus restoration，保留 GameShell inert。
3. **Game Overwrite**：遊戲內 Save → 已佔用槽「選擇」→ 按 Return 提交預填命名 → 覆寫確認的 Return 應**取消**，斷言未調用 `save_manual`（及不曾開始不必要的 thumbnail/save 流程）；焦點回到重掛載的「繼續」按鈕。明確轉焦／點擊 confirm 的正路徑仍能執行。

- 不用 `fireEvent.keyDown` 假裝觸發按鈕：jsdom 的 keydown 不一定合成 click，會在舊錯誤實作上假綠。用 `userEvent.keyboard` 真正模擬 Enter 按鈕啟用。
- 補 `SaveConfirmationDialog.test.ts` 三個 kind 的 autofocus regression；原測試若要求 Delete 預設 confirm，改成安全契約。確認 pending、Escape、Tab、load 不退步。
- `save-browser-controller.test.ts` 添加動態 opener 的 delete return、成功重開 Browser initialFocus、型別 API 更新測試。
- 先執行 focused unit 並記錄**至少一個在 main 基線會失敗的 Red case**，再改 production code。

**Done when：** 主測試能在原本的 `last-child` override 與 stale opener 下失敗；不是只證明 dialog 元件自己會 focus cancel。

## Task 2 — 消除雙重 focus owner 與 stale opener

限縮修改：

1. `SaveConfirmationDialog.svelte`：`onMount` 使用 `kind === "load" ? confirmButton : cancelButton` 作初始動作（load invalid 仍應 fallback cancel）；刪掉產品未使用的 `returnFocusTo` prop、`restoreFocus` 與對應重複 unit test。
2. `+page.svelte` 四個 confirmation 入口移除第二個 `initialFocus` locator：`handleTitleBrowserDelete`、`handleSaveBrowserLoad`、`handleSaveBrowserDelete`、`handleManualNameSubmission`。對 Load 的確認按鈕由 dialog 原本 onMount 自行聚焦。
3. Title／Game Delete 的 opener 均改成 `slotActionLocator(slot.reference, "delete")`，而不是捕獲目前 `opener: HTMLElement`。取消／Escape 後 controller 使用 locator 找**新渲染**的按鈕。
4. `save-browser-controller.svelte.ts`：刪掉 `openConfirmation(opener, initialFocus?)` 的第二個參數與委派；保留 `openName(opener, initialFocus?)`。不要把不同層的 focus 邏輯搬到新 singleton。
5. 保留原有 `saveId`/`modifiedAt`/pending guard；不碰 Rust save implementation。

**Done when：** 三條 Red case 轉綠；原本 onMount + tick 雙重搶焦點完全消失；Load／Overwrite／Delete 在取消後均可回到可用焦點。

## Task 3 — Browser 初始焦點與背景 inert（沿用現成機制）

1. 在 `createSaveBrowserController` options 新增可選 `initialFocus: LayerFocusTarget`，在 controller 建立時以現有 `focusWhenReady` 聚焦；`openTitleBrowser` 與 `installGameBrowser` 都傳入同一類的「返回」按鈕 locator（在目前 Browser 層內查詢，避免抓到背景其他同名按鈕）。
2. **不**在 `SaveBrowser.svelte` 補 onMount focus；避免它與 controller.back 的既有 restoreFocus 互搶。
3. 在 `MainMenu.svelte` 現有最外層 `.lyra-menu` 套用 `inert`（從 `+page.svelte` 的 `titleBrowserOpen` 傳入簡單 prop），或等價地讓其最外層 DOM inert；避免新增包覆層導致 title 畫面 CSS 改版。
4. 遊戲內依靠現有 `persistenceLayerOpen → gameplayInert → GameShell`，不重複實作。
5. 確認原本 1.5s title `focusTimer` 在背景 inert 時不能搶 focus；若全域 ArrowUp／Down 的 `preventDefault` 仍影響 Archive，僅在 MainMenu 當前根節點是 inert 時早退出（重用 `DialogueBox` 的 guard 模式），不添加第二個 keyboard controller。
6. 刪除成功後 `openTitleBrowser`／`installGameBrowser` 都會使用新 controller 的初始「返回」焦點；取消則使用原 opener locator，兩條流程各有一位 owner。

**Done when：** 重開、取消及成功刪除後的焦點是可預測的，背景主選單不可被 Tab/Enter 操作；不為了這項缺陷加入第七套手寫 Tab trap。

## Task 4 — 最小 UX CSS、文案和平台核驗

1. 在 `SaveCard.svelte`、`SaveBrowser.svelte`、`SaveConfirmationDialog.svelte` 操作按鈕加入清楚的 `:focus-visible`；可在卡片使用 `:focus-within` 作輕微輔助，但 selected≠focus。沿用現有 CSS tokens。
2. 實測 macOS／Windows 800×600 的槽 1–3 場景標題是否被裁半，僅在重現後調整 `SaveCard` 或 `SaveRecapDetails` 的少量 CSS（wrap/line-height/min-width），不重新設計佈局。
3. `apps/game/src-tauri/src/game/save/application/mod.rs` 的 `capture_unavailable_activity` 一行英文通知改為繁中「無法產生存檔預覽圖片；存檔仍可使用。」；不在 `+page.svelte` 新增 reason-keyed localization map；不改 thumbnail availability 規則。
4. **macOS WebKit acceptance gate（先做）**：先記錄測試機「Keyboard navigation」系統設定，測試 native Tab／Shift+Tab 能否走到 cancel／confirm。若 Tab 跳過 button，僅在實際 Save 層沿用 `AcquisitionPopup.svelte:102–120` 的完整 Tab 巡訪迴圈，並增加該平台的回歸；**只有證實需要才增加這段邏輯**。
5. 文案驗收只涵蓋縮圖提示；其他 Rust persistence errors（例 `Save selection is stale.`）由 [HPA-912](https://linear.app/cwchanap/issue/HPA-912/localization-translate-player-facing-persistence-errors-to-traditional) 獨立追蹤，不擴大本票。

**Done when：** 焦點清晰、場景名稱不被截斷、縮圖通知繁中、macOS 不因 Tab 行為而無法明確操作危險按鈕。若有條件平台差異，將設定及採用 fallback 的理由記在 PR。

## Task 5 — Regression、Desktop UAT 及同 PR 收尾

### 自動回歸

在 repo root：
~~~bash
bun run check
bun run test
bun run lint:all
bun run --cwd apps/game check:e2e
cargo test --manifest-path apps/game/src-tauri/Cargo.toml
~~~

- 延伸現有 `apps/game/e2e-tauri/save-management.e2e.ts` 的 `deleteOwnedManual`，不新增 E2E seed／phase：在既有 `management-corrupt-thumbnail` 的 manual-2 delete 前，先鍵盤開確認 → `Enter`（取消）→ 確認 `manual-2` envelope／sidecar 未變、其他槽仍在 → 重新開確認 → 明確把焦點移到「確認刪除」→ `Enter`；保留原有**檔案消失／其他槽 saveId 與 sidecar SHA 不變**斷言。
- 在 `page.test.ts` 必含 title Delete、game Delete、game Overwrite，直接攔截並斷言沒有錯誤 IPC，作為 CI 每 PR 的持續護欄。
- 不把 `save-management` 誤認為 PR smoke：`e2e-suite-registry.mjs` 的 smoke 只跑 `smoke.e2e.ts`。在 Ready 前明確執行：
~~~bash
bun run --cwd apps/game test:e2e:save-management:run
bun run --cwd apps/game test:e2e:smoke
~~~
- 不改全套 E2E CI 分流策略。需要時可另跑 `test:e2e:all`，不作新 CI infrastructure。

### macOS／Windows 真視窗端到端驗收（800×600）

| 旅程 | 操作與預期 |
| --- | --- |
| Title Browser | 用鍵盤打開／關閉／重開 Load；聚焦「返回」，背景 MainMenu 不可操作，Escape 仍回載入入口 |
| Game Browser | Save/Load 同樣有穩定初始焦點；取消確認後回到正確槽，沒有 focus 落到 body |
| Title & Game Delete | 已佔用槽 Delete → 連續 Return → `delete_save` 未呼叫、原檔仍在；明確選擇 confirm 才刪目標槽，其他槽不變 |
| Game Overwrite | 已佔用槽選擇 → 預填命名 → 連續 Return → `save_manual` 未執行、原存檔不變；明確確認才能覆寫 |
| Success / Load | 刪除成功聚焦新 Browser 的「返回」；Load 仍可正常選擇，故障與失效槽原有保護不退步 |
| 視覺與語言 | 3 個手動槽 focus ring、場景尾字、按鈕都看得見；thumbnail unavailable 是繁中且不被當成存檔失敗 |
| macOS 特別項 | 紀錄 Keyboard navigation 的開關狀態；測試 Tab 是否能到危險確認按鈕；若不可達，驗證小範圍 Tab fallback |

有設計 mockup 時按 Linear ticket mockup 視覺核對；截至此輪 review，HPA-830 未提供 mockup，使用已報 UAT 截圖／真實 packaged 遊玩前後對比。**只要求 macOS 和 Windows 手動 E2E／視覺驗收；Android 和 Linux 不安排手動驗收，Linux 只靠 CI。**

### 舊 UAT 亂碼筆記（不另設實作 Task）

主案附帶的「相���點頭」目前未取得原 UAT 檔案；本次 review 確認已檢視的 authored text 為正確 Unicode，未發現本路徑 lossy UTF-8 decode。若日後找回原檔，先查原始 bytes 是否實際有 U+FFFD，否則不改 serde_json、不加遷移或回歸測試。**本 PR 不假稱已修復舊 UAT 檔案。**

## Acceptance checklist／合併前門檻

- [ ] 三項 `page.test.ts` Red→Green（title Delete／game Delete／game Overwrite；`userEvent` 和無 IPC 斷言）
- [ ] SaveConfirmationDialog 及 controller 測試保證安全焦點、動態 opener、取消／成功刪除回焦
- [ ] Background inert、CSS、縮圖文案與 800×600 視覺檢查有實測
- [ ] macOS／Windows 真視窗端到端 Save／Load／Delete／Overwrite／Escape 路徑通過，記錄 macOS keyboard-navigation 設定
- [ ] `bun run check`、`bun run test`、`bun run lint:all`、`check:e2e`、全 Rust cargo test、`test:e2e:save-management:run`、smoke 有明確結果
- [ ] 刪除／覆寫安全後，再標記同一 PR Ready；不改狀態為 Done 直到驗收滿足

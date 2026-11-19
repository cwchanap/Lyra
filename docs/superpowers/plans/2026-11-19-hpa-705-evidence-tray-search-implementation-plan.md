# HPA-705 — 證物盤搜尋與 800×600 可讀性：單 PR 實作計劃

> **Linear：** [HPA-705](https://linear.app/cwchanap/issue/HPA-705/evidence-tray-is-hard-to-use-with-dozens-of-records-show-出示紀錄) · **設計：** [HPA-705 search design](../specs/2026-11-19-hpa-705-evidence-tray-search-design.md) · **狀態：** Draft plan，程式／測試均尚未執行。
>
> **Delivery contract：一張票、一個 PR。** 此 Draft PR 先審查設計及計劃，**實作時直接更新同一 PR**（不要另開 implementation PR）。本任務無新圖、BGM、SFX 或語音；不需要拆美術任務。

## 0. 起點與選擇

- `InterrogationEvidenceTray.svelte` 是訊問 PRESENT 與調查 SHOW 的共用盤；目前單一 `.record-grid` 五欄、106px 圖像，只有全量清單和局部捲動。卷內約 74 筆時，Linear 記錄反覆大量搜尋及卡名截斷。
- `presentableRecords(inventory)` 已提供可搜尋的欄位，不加新 model／schema。採**一個本地文字篩選框**與小範圍 800×600 compact CSS，不做分頁、分類 tabs、近期項目、索引或虛擬捲動。
- HPA-831 的黑框／焦點框未確認是同一 root cause，HPA-852 另管場景 HUD，HPA-706 另管 Analysis；不把其修正包進本 PR。
- 不搬動現有事件處理 owner：`onPresent(kind, itemId)`、`onResume()`、`claimEscape()`、`topLayerOpen`、returnFocusTo 仍維持原呼叫關係。

## Task 1 — 先寫會在 main 失敗的 regression（Red）

修改 `apps/game/src/lib/components/InterrogationEvidenceTray.test.ts`，沿用 `neutralEvidenceRecordView()`、`neutralStatementRecordView()`、`props()`、Testing Library 與 `userEvent`；產生 74+ 筆測試 inventory（最後一筆給唯一可搜尋名稱和來源）。

必測：

1. **SEARCH／SHOW：** 以 `presentTo` 入口輸入名稱片語，只出現符合證物；改搜來源或 description/details 能找對目標；英文字母大小寫不影響；清除後所有證物回復原順序。無結果顯示空結果訊息。
2. **SEARCH／PRESENT：** `crossExam` 入口同樣篩選。點擊結果仍以原 kind/id 呼叫 `onPresent`；有相同 id 的 statement/evidence 仍保持 kind 區別。
3. **定位與狀態：** 先模擬格子捲到下方，再輸入搜尋字詞，預期 `scrollTop===0`；搜尋掉先前 hover/focus 的紀錄後詳情不殘留；卸載、重開（新 render）時無舊查詢、從頂端開始。
4. **鍵盤：** 初始 Escape button 保持獲焦；搜尋輸入框可經 Tab／Shift+Tab 循環到達（依 DOM 順序，從 ESC 可用 Shift+Tab 回到搜尋）；input、卡片及底部動作按鈕的 Tab trap 皆成立。上層 Game Menu 開啟時，原 `topLayerOpen` 仍不截走 Tab。搜尋輸入 disabled 時不可改可見紀錄或呼叫 onPresent，Escape／收回仍按既有 pending guard。
5. **無答題邏輯改變：** 搜尋只改可見列表，`presentableRecords` 與源 inventory 不變，既有 hover detail、image error placeholder、Escape／return-focus regression 全保留。

先在原 main 行為上確認新增測試有意義地失敗，記錄至少一個 Red case；**不得以快照文字存在代替可操作的使用者事件測試**。

## Task 2 — 單元件最小功能實作（Green）

**主要檔案：** `apps/game/src/lib/components/InterrogationEvidenceTray.svelte`。

1. 元件內加 `searchQuery = $state("")`；以一個 `$derived` visibleRecords 依 shortName、sourceTag、description、details 篩選。使用小型純函數 normalize（trim + lower-case），不用外部搜尋函式庫，且不篩選 authoritative inventory。
2. 在 header 放 search input（`type="search"`、`aria-label="搜尋紀錄"`）及符合筆數；`{#each}` 改迭代 visibleRecords。無結果時有明確文字，保留原 `data-interrogation-evidence-grid` marker。
3. `oninput` 更新 query 並將 `recordGrid.scrollTop = 0`；mount 確保初始從頂端。detail activeRecord 改從 visibleRecords 查找，保證已被篩掉的記錄不再作為選中紀錄。若 WebKit 內建 search 清除按鈕在視覺檢查無法可靠使用，才加一個局部「清除」按鈕，不做多種重置 API。
4. 將本盤現有 `handleKeydown` 的可聚焦元素查詢從「只找 buttons」擴為「可用 buttons + search input」，保留 unconditional JS Tab／Shift+Tab cycling、`topLayerOpen` early return、mount/unmount 以及還焦邏輯。新 search 不另註冊全域鍵盤監聽。
5. 保留原本的 `resolveStoryAsset` image resolve、image placeholder、record source、hover/focus/tile clicked callback；**不改** `presentation.ts` 或引擎 evidence acquisition/answer evaluation，除非測試顯示某個現有欄位無法使用（必須在 PR 中提供原因）。

**Green 條件：** Task 1 的 Red cases 與原有 InterrogationEvidenceTray 測試全部綠燈，不因新增 search input 破壞原本 first-ESC focus 或 Escape 式收回。

## Task 3 — 800×600 的局部版面與 focus 可讀性

只在同一 Svelte 元件的 CSS 中調整：

- 以 `@media (max-height: 650px)` 收緊 tray gap、dialog padding、target line padding、record tile padding、thumbnail 高度、detail 區最低高度；保留現有顏色／字體 token。
- Header 排入搜尋欄及結果數而不蓋住 PRESENT 的證詞進度或 ESC；窄視窗需要時允許 header 內局部換行，但不得把唯一可操作的卡列擠到 600px 視窗外。
- 縮圖仍在、證物名稱可以多行自然換行，不做 `line-clamp`／`text-overflow: ellipsis`；搜尋框、卡片、收回按鈕有清楚的 `:focus-visible`。若卡片 title 過長，應由版面擴高該 row，不是把最後一行遮掉。
- 實際畫面如未達到「一整排可完整閱讀」，**只調局部高度與間距**；不要藉機全面更換五欄 grid 成新的 UI 架構。

**目標基準：** 在 800×600 的 SHOW 與 PRESENT，header、搜尋框、對象／證詞、第一完整卡列及下方詳情／收回都能同時看到。設計規格中的 ASCII wireframe 充當目標 mockup；以 Linear 附帶的 `show-tray-800x600.png` 作「修前」基準。

## Task 4 — 重用現有 packaged Tauri E2E（由 MCP 驅動）

**不新開 suite、不建測試框架。** 優先在現有 `apps/game/e2e-tauri/production-journey.e2e.ts` 的 Chapter 2 正常流程／最終審查會節點加一個具體斷言；若該節點已有更適合的 helper，重用現成 helper。不要直接跳到空 inventory 的場景，因為驗收目標是遊戲進行後的 74 筆真實紀錄。

MCP agent 操作 packaged debug Tauri（`800×600`，同一平台即可，無平台特有改動），執行以下整段旅程並保留截圖與 assertion：

1. 按既有 Chapter 2 journey 取得大量紀錄（驗證盤內 `records.length >= 74`）；開 SHOW／出示紀錄。紀錄初始 `scrollTop===0`，header/搜尋/第一排 card title 的真實 `getBoundingClientRect()` 均落在 viewport／scroll container 內，無標題被裁切。
2. 使用實際鍵盤或文字輸入在搜尋框輸入從真實 inventory 取得的專有名稱片段（非硬造字串），目標可在 **首個可見格畫面或至多兩次整頁捲動內** 取得；滑鼠選擇它，證明進入原有出示交互與回覆（含 wrong evidence 路徑），未改正常玩法。
3. 撤回重開，搜尋為空、捲動回頂。再開 PRESENT／提出證據，使用鍵盤 Tab 進搜尋、篩選、選擇證物，確認 `kind,id`、焦點、ESC 與 Game Menu 疊層行為不變。
4. 以同一 800×600 viewport 截取 **修改前 UAT 截圖對照位置**及修改後的初始、搜尋命中、空結果、PRESENT 四張狀態圖；由 MCP 自動檢視目標 wireframe 的層次及元素交疊、卡名是否完整。DOM assertions 與 screenshot 必須互相驗證，不可只憑 CSS 字串／jsdom 來宣稱通過。

E2E 具體工具為 repo 現有 Tauri packaged WDIO/WebDriver 測試，由 MCP agent 執行並檢視截圖／結果；**不以人手遊玩／審批作 acceptance**。若目前工作環境無法啟動 GUI/MCP，PR 保持 Draft，列出未完成的 gate，不宣稱完成。

## Task 5 — 執行檢查、記錄結果、同一 PR 收尾

在 repo root 跑符合修改範圍的測試；對 UI 修改至少：

~~~bash
bun run --cwd apps/game test src/lib/components/InterrogationEvidenceTray.test.ts
bun run --cwd apps/game test src/lib/components/InvestigationSceneSurface.present.test.ts
bun run check
bun run lint
bun run format:check
bun run --cwd apps/game check:e2e
bun run --cwd apps/game test:e2e:smoke
~~~

- 現有 production journey 的 Chapter 2 大 inventory 路徑亦要在 packaged app 完整執行並保留回歸證據；不要把 smoke 當成「74 records」已驗證。
- 原有進階 modal focus / Escape / disabled / overlay keyboard tests 不能因新 input 被直接刪除。若測試因新增 Tab stop 需更新，按實際順序明確重寫，不要繞過。
- 只在此 PR 提交對 HPA-705 有關的變更；設計與 implementation plan 同一 PR 保留為已落地的工程紀錄，不拆另一張 implementation ticket。
- 結果全部記錄在 PR：已跑指令、pass/fail、packaged 截圖路徑／連結、平台與視窗尺寸，以及尚存差異。完成驗收後才把 Draft 改 Ready；Linear 保持 In Progress 直到程式碼與 E2E 合併完成。

## End-to-end acceptance checklist（無人工驗收項）

- [ ] 74+ 筆 SHOW 盤：搜尋名稱、來源、描述可找到正確項目；清除恢復完整清單；空結果有提示；原始排序與 `kind,id` 不變。
- [ ] 800×600 SHOW/PRESENT：首頁至少一整列卡片名稱完全可讀，搜尋/證詞/詳情/收回不互蓋；MCP 截圖和 DOM bounds 同時證實，與規格 wireframe／Linear 修前截圖比對。
- [ ] 捲到最底再收回，重新開啟從頂部開始；改搜尋重設 `scrollTop=0`；被篩掉的 hovered/focused item 不殘留假詳情。
- [ ] 真正的鍵盤 Tab/Shift+Tab、滑鼠選取、Escape、Game Menu 疊層和 pending 禁用均成功；SHOW、PRESENT 各至少一次完整可回復的出示旅程經 MCP E2E 驗證。
- [ ] 元件 regressions、Svelte check、lint/format、check:e2e、packaged smoke 與 Chapter 2 大 inventory journey 有明確成功結果；**未執行的一律列為未驗證**。
- [ ] 無 Rust/scene/art/SFX/存檔格式改動；**本票只有一個 implementation PR**。

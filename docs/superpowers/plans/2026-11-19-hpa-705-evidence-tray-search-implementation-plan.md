# HPA-705 — SHOW／PRESENT 證物盤搜尋：單一 PR 實作計劃（Review 修訂）

> **Linear：** [HPA-705](https://linear.app/cwchanap/issue/HPA-705/evidence-tray-is-hard-to-use-with-dozens-of-records-show-出示紀錄) · **設計規格：** [HPA-705 design](../specs/2026-11-19-hpa-705-evidence-tray-search-design.md) · **PR：** [#138](https://github.com/cwchanap/Lyra/pull/138) · **狀態：** planning only。根據 2026-11-19 GitHub「Ship with changes」review 調整，程式與驗收尚未執行。
>
> 一張 Linear ticket、一個 PR：**在此 Draft PR 後續直接加入程式與測試**，不要再開 implementation PR。沒有新圖、BGM、SFX 或語音工作。

## 0. Review disposition：有效意見及收斂決定

| Review 意見 | 決定 |
| --- | --- |
| `production-journey` 以 `ensureCaseFileViewport` 轉到 1280×720，會讓 800×600 測試假綠 | **接受**：共用原 `ensureMinimumWindowViewport`，在真正的 74-record tray 斷言前切到 800×600，後續 Analysis 前再放大 |
| 原盤高度留不足一整列，光靠 CSS 微調可能不可行 | **接受**：規格預算表先定 compact 縮圖 ~48、卡字 13–14px、detail ~64、gap ~8px；必要時去重複 eyebrow |
| 搜尋函數放在 Svelte component 而非可純測的 presentation 層 | **接受**：`presentation.ts` 新增純 `filterPresentableRecords`，NFKC + case-fold，測試集中到 `presentation.test.ts` |
| 手寫 Tab trap 和共享 `trapDialogTabKey` 重複 | **接受**：調用既有 helper，selector 包含 input + button，保留 `topLayerOpen` 早退 |
| 每次重開要額外設 `scrollTop=0` | **刪除**：現有條件掛載自然從頂部開始；只保留回歸 guard，若新實測不符另查原因 |
| E2E 太多不必要分支／截圖比較會變成主觀門檻 | **接受縮減**：`clickRecordTile` 內覆蓋真實搜尋；只在 74+ 筆做一次 800×600 DOM geometry + 截圖；wrong-evidence、Escape、menu overlay 在元件回歸驗證；截圖保留供 MCP 視覺檢查但非獨立判定 |
| Clear、disabled、image effect 細節未定 | **接受**：不加 Clear button、不禁用 search input；圖片 effect 一直迭代完整 `records` |

重用已在 `main` 存在的 `presentableRecords(inventory)`、`claimEscape`、`trapDialogTabKey`、WDIO production journey，不新建搜尋 service、state manager 或 E2E suite。HPA-831、HPA-832、HPA-852、HPA-706 互不綁定。

## Task 1 — Red-first：純搜尋函數與元件 wiring

修改：

- `apps/game/src/lib/interrogation/presentation.test.ts`：table-driven 測 `filterPresentableRecords(records, query)`，涵蓋 `shortName/sourceTag/description/details`、NFKC 全形英數及破折號（`ＳＲ－２３０７` → `SR-2307`）、大小寫、query trim、零命中、空 query 回傳同一 records array、排序與 id/kind 不變。**新增測試在原本 main 無函數時應 Red。**
- `apps/game/src/lib/components/InterrogationEvidenceTray.test.ts`：只測 UI 連線：SHOW/PRESENT input 可以篩選並顯示命中數、空結果提示、搜尋變更時 `scrollTop = 0`、已篩除 hover/inspected 不留下詳情、點擊仍傳原 `kind,id`（含同 id 不同 kind）、Tab/Shift+Tab 包含 search、first focus ESC、`topLayerOpen` 不接管。新 render 的 query 與 scroll 為空／零，作**已在 main 成立的 regression guard**，不謊稱是 Red。
- 原元件 Escape、影像 fallback、return-focus、disabled button cases 保留；**不測 disabled search input 或 clear button**，因設計明確不提供兩者。元件 wiring 不必建立 74 張圖片測所有四欄；純函數測欄位語義，大量真實紀錄由 WDIO 測。

先記錄至少一項真正 Red case，再實作，不新增快照式測試取代操作。

## Task 2 — 最小實作：純函數、Svelte 連接、共用鍵盤 trap

1. `apps/game/src/lib/interrogation/presentation.ts` 在 `presentableRecords` 旁加入 `filterPresentableRecords(records: PresentableRecord[], query: string): PresentableRecord[]`。normalize query／候選皆用 `normalize("NFKC").toLocaleLowerCase()`，query 額外 `trim()`；空 query 原樣返回 records。
2. `InterrogationEvidenceTray.svelte` 在現有 `records` 旁加 `query = $state("")` + `visibleRecords = $derived(filterPresentableRecords(records, query))`；`{#each visibleRecords}` 顯示結果；`activeRecord` 只從可見結果取。輸入 `type="search" aria-label="搜尋紀錄"`，顯示 `顯示 N / 總數` 與零結果訊息。
3. 輸入事件設定 query 並將 `recordGrid.scrollTop = 0`；原 SHOW/PRESENT 關閉後卸載即可自然重設。**不寫 onMount reset、不加清除按鈕、不給搜尋框 disabled**。觸發出示的 `present(kind,id)` 和既有 button pending guard 不變。
4. import `trapDialogTabKey`，在 `handleKeydown` 先 `if (topLayerOpen) return;`，再委派：
   ~~~ts
   trapDialogTabKey(event, tray, {
     selector: "input:not(:disabled), button:not(:disabled)",
     stopPropagation: true,
   });
   ~~~
   刪除原本複製的 Tab 算法約 25 行；保留原 capture listener、first ESC focus、claimEscape、unmount return focus。搜尋框可用且不在 pending 時意外失焦。
5. **保留** `evidenceImages` 的 `$effect` 遍歷完整 `records`，不可改為 `visibleRecords`，避免每次敲字圖片閃爍。原 `resolveStoryAsset`、placeholder 均不變。

Done when：純函數與 UI Red cases 綠燈、既有資料與出示 callback 保持原語義。

## Task 3 — 固定的 compact CSS 預算（同元件內）

按設計文的 800×600 高度表，用單一 `@media (max-height: 650px)`：

- `interrogation-evidence-tray` padding 約 14px、grid rows gap 約 8px；record-grid gap 約 8px。
- 卡片圖像從 106px 改至約 48px，tile padding 約 8px／gap 約 6px；`record-copy strong` 13～14px、line-height 1.35，**完整自然換行**；不要強制 ellipsis、line-clamp、虛擬化。
- `record-detail` min-height 約 64px、可獨立捲動；`line-record` 更緊湊、line-height 約 1.5，長證詞可局部捲動但不得吞掉第一完整卡列。
- Header 納入 query、count、PRESENT progress 和 ESC；若空間不足先隱藏重複 eyebrow，保留 h2、progress、search、ESC。沿用現有 token 和 focus ring，**不改全域 CSS**。

Done when：真實 **800×600 CSS viewport** 上第一整排可見卡片名稱完整可讀，搜尋、詳情、Footer、收回不被蓋住。照片與 wireframe 保留作視覺比對，客觀界線由 DOM geometry 和互動檢查判定。

## Task 4 — 重用 WDIO packaged E2E：真正 800×600、真正 74 筆

本 repo 的 E2E 執行器是 **WDIO/WebDriver packaged Tauri**，不是新 MCP 測試框架。由 MCP 開發 agent 呼叫既有命令、取得截圖及測試輸出；同一個平台即可，無平台特有修改。**不建立新 suite 或額外 smoke 路徑**。

在 `apps/game/e2e-tauri` 最小改動：

1. 將 `investigation-layout.e2e.ts` 已驗證的 module-local `ensureMinimumWindowViewport`（含 DPR、window-manager clamp、重試）移至 `helpers.ts` 導出；舊 placement suite 更新 import，避免兩份 resize 演算法。
2. 在 `production-anchors.ts` 加 `搜尋紀錄` 的穩定 anchor。將 `production-journey.e2e.ts` `clickRecordTile(recordName)` 改成：在真實開盤時使用 WebDriver input 對 recordName `setValue`／輸入，等待相符結果，斷言 tile 位於捲動 grid 首個可見頁且 `scrollTop===0`，然後沿用原 click。此 helper 已服務 SHOW 與 PRESENT，**不用重玩兩種分支**。
3. 在 Chapter 2 最終 hearing 首次 **inventory ≥74** 的實際盤前，調用 `ensureMinimumWindowViewport()` 並 assert **`innerWidth===800 && innerHeight===600`**（非 1280×720）。檢查 Header、search input、首列 tile title、grid、details、footer、ESC bounding rect 可見及無互蓋；用真實名字搜尋後，確認目標在初始可見結果範圍。至少保存一張初始盤和一張命中結果的 screenshot。
4. 此 geometry gate 須能證明至少執行一次，不可當 Chapter 2 未達 74 筆時 silent skip。當後續 `analysisStep` 需大 viewport 時，先呼叫既有 `ensureCaseFileViewport()`。**避免**在 `production-journey` 全程改成 800×600，使 Analysis 拖放失敗。
5. 不增加 wrong-evidence、Escape、Game Menu 疊層 E2E 歧路：保留原路線 correct answer 與元件測試覆蓋。WDIO `production-journey` 是 full-only，smoke 仍只執行 `smoke.e2e.ts`。截圖是 PR artifact，MCP agent 需檢查與 ticket 修前圖及本 spec wireframe 的可讀性差異，**自動化通過條件是幾何與操作斷言**，不是人為批准。

Done when：WDIO 以真實 inventory、確實 800×600 測到本次 compact CSS，SHOW/PRESENT 原出示路線不變，截圖與測試日誌可追溯。

## Task 5 — 測試命令、狀態及 PR 收尾

實作完成後在 repo root：

~~~bash
bun run --cwd apps/game test src/lib/interrogation/presentation.test.ts
bun run --cwd apps/game test src/lib/components/InterrogationEvidenceTray.test.ts
bun run --cwd apps/game test src/lib/components/InvestigationSceneSurface.present.test.ts
bun run check
bun run lint
bun run format:check
bun run --cwd apps/game check:e2e
bun run --cwd apps/game test:e2e:smoke
# 若已 build E2E binary，直接跑 focused full-only suite：
node apps/game/scripts/run-save-e2e.mjs --suite production-journey
~~~

若尚未 build E2E binary，使用 repo 既有 `build-e2e.mjs` 一次建構後再跑，不加入 CI 新工作流。MCP agent 執行並記錄每個命令的 pass/fail、平台、CSS viewport、截圖產物與 74+ 筆數；若無法啟動 packaged app，PR 保持 Draft，明列未完成，不宣稱 E2E passed。

### End-to-end acceptance（全自動、單一 PR）

- [ ] 搜尋 `shortName/sourceTag/description/details`：NFKC 全形／英文大小寫／空值／無結果、原順序與原 `kind,id` 均有純函數與 UI 回歸。
- [ ] SHOW／PRESENT 實際輸入搜尋仍沿用正確出示路徑；Tab/Shift+Tab、ESC、Game Menu `topLayerOpen`、pending buttons 的既有 component regressions 全綠；不加不必要的 E2E 分支。
- [ ] Query 改變使 grid `scrollTop=0`；關閉再開自然回頂，無 mount reset；被篩除項目的 detail 不殘留，縮圖不因每次輸入重新 resolve。
- [ ] **真實 packaged Chapter 2 至少 74 筆、CSS 800×600**：首列完整標題與 header/search/details/收回均可見，不相互遮擋；WDIO DOM-rect 斷言及 screenshot artifact 已執行，MCP agent 對照 wireframe／Linear 修前圖記錄視覺結果。
- [ ] `production-journey` 在 800×600 量度完後恢復 Analysis 需要的 viewport，後續流程通過；`test:e2e:smoke` 也綠，不能以 smoke 取代 full-only focused production journey。
- [ ] unit、check、lint/format、check:e2e 有明確結果；沒有 Rust／story／art／SFX／存檔格式改動；此 ticket 只維護原 PR #138。

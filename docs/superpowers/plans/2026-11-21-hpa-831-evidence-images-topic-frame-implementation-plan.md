# HPA-831 — 證物圖片與焦點框：單一 PR 實作計劃（Round 2 Review 修訂）

> [HPA-831](https://linear.app/cwchanap/issue/HPA-831/evidence-images-show-as-empty-black-frames-and-the-focus-frame-sticks) · [Design spec](../specs/2026-11-21-hpa-831-evidence-images-topic-frame-design.md) · [Round 2 review](https://github.com/cwchanap/Lyra/pull/140#pullrequestreview-6013786888)  
> **狀態：Implemented（PR #140）**；regression coverage 與文件已落地，無產品修復（原環境未重現）。已驗證：兩次獨立 `--attempts 1` packaged run（`58ff41a8`，各 12/12 tests、71/71 trusted Enters）＋ head 的 scenes:compile/check/test/lint:all/check:e2e。**最終 head 驗證：** requester 明示 waiver（cwchanap, 2026-11-24）——接受 `58ff41a8` 兩次獨立 run＋最終 head 的 unit/script-contract/typecheck/lint 覆蓋，不再另跑 packaged journey；後續 hardening 屬同一 journey path 的增量 gate。無新 art／SFX。

## 0. Round 2 review disposition（逐項對照真實程式）

| Finding | 決策 |
| --- | --- |
| **F1** `--attempts 2` 會掩蓋一次 Red | **接受**。`e2e-runner-lifecycle.mjs:512-546` 是成功即停、失敗才重試；兩個獨立 run 均用 `--attempts 1`，任何 Red 不可被後一次洗成 Green |
| **F2** DOM `el.click()` 不能重現 focus modality；漏查 `[data-gameplay-root]` | **接受**。`helpers.ts:1053`、`2295`、`2334` 使用 synthetic click；受影響路徑換 WebDriver element click / key，**驗證 focus 真的落在預期節點**；probe 包含 gameplay root（`+page.svelte:1319`）與 DialogueBox |
| **F3** helper 執行時一個 microtask 的「image 未掛載」已過 | **接受**。`resolveStoryAsset` 不做網路 I/O；改量測**decode 前的 `img.complete` 與 resource timing**，再做 decode/source canvas、**packaged screenshot 裁切**的 compositor pixel gate；不預設可截到未掛載的第一幀 |
| **F4** 「MCP agent 目視」是不可重現、額外 gate | **接受移除主觀 gate；保留 MCP 作 E2E 執行介面**（專案明確要求 E2E 由 MCP 執行）。不另建 Tauri MCP server；MCP 工具只需在指定 Linux 環境呼叫下列既有 WDIO CLI，取 runId、exit code、screenshots；**只有 WDIO 客觀斷言決定 pass/fail**，無人工/agent 目視批准 |
| **F5** 800×600 helper 錯誤；Case File 覆蓋缺口 | **接受**。重用 `ensureMinimumWindowViewport` 和 `finally` restore；指定 `img.case-file-record-image` 的兩張證物改在 `production-journey` 真正取得後驗證。只有修改 `CaseFileRecordDetail.svelte` 才要求加跑 `--suite gameplay` |

保留第一輪收斂：不重做 assets mapping、不複製 null/async/error unit、不新增 E2E suite 或 checkpoint、不猜根因。原始 baseline 為 Linux **packaged Tauri / WebKitGTK / Xvfb**，而不是 macOS WKWebView。

## 1. Task 1 — Red-first：在既有 packaged E2E 寫能重現問題的 assertions

**檔案：** `apps/game/e2e-tauri/helpers.ts`、`apps/game/e2e-tauri/production-journey.e2e.ts`；必要時只重用 `capture-proof.e2e.ts` 的來源像素方法。不要新增第二套 runner/framework。

### A. Shared acquisition helper（小改一處）

1. `startAcquisitionAcknowledgement` 的 `current` 型別改為 `Pick<PendingAcquisitionView, "id" | "title" | "recordKind" | "imageAssetId">`。現有呼叫路徑均已提供完整 pending view；先以 `check:e2e` 驗證。
2. 先照目前程式等待 `CONTINUE`、確認 card title。若 `recordKind === "evidence"` 且 `imageAssetId` 非空，wait 正確 `img.evidence-image` 掛載並記錄 **await decode 前**的 `complete/currentSrc`；`performance.getEntriesByName(currentSrc)` 若無記錄應輸出 unavailable 而非立刻失敗（Tauri custom scheme 不保證 browser timing entry）。
3. `await img.decode()` 後 assert `complete`、`naturalWidth/Height > 0`、`currentSrc` 不以 `data:image/svg` 開頭；以既有 `capture-proof.e2e.ts:355-414` 的 canvas sample 確認來源有像素。不對暗色證物套用單一「亮度需很高」門檻。
4. **不從此 helper 嘗試觀察「尚未掛載的第一幀」**，因它在之前已經過 get_state IPC 與 `waitForButton`。記錄每張圖片完整時間，特別比較 `cctv_screenshot`／`timecard_record`／`doorlock_summary_timetable`，並在 popup 被 ack 前保留 screenshot。

### B. 真實 compositor pixels（只在三張受影響對照做昂貴檢查）

1. 在 `production-journey` 已到 Chapter 1 inv3 指定 acquisition 的位置，用既有 `LYRA_E2E_OUTPUT_DIR` 保存 popup screenshot。
2. 取 `.acquisition-card .visual` 的 DOM rect、`observedCssViewport()` 與 PNG 實際寬高；按 **screenshotSize ÷ viewportSize** 作 pixel mapping（核對 DPR，勿假設一律 1x），裁掉 border 後測 crop 至少有可分辨的非單色、非空內容。
3. 來源 canvas 的成功只證明 PNG 可解碼，**必須另對 screenshot crop 作斷言**才能抓到 WebKitGTK Xvfb paint。由 Node test 端解碼 screenshot PNG；先尋找可重用 decoder，若 repo 沒有直接宣告，最多加一個**測試專用、明確宣告的小型 PNG decoder**，不引入 production image pipeline。
4. PNG source/screenshot crop 可共用一個小 helper（popup 傳 `.visual`，Case File 傳 `img.case-file-record-image`），但不要變成全應用影像 service。詳細 log 要記錄 record ID、decode status、image/sample metrics、screenshot path，保留不通過畫面作 artifacts。

### C. Scene 2 的焦點來源（先讓測試觸及實際行為）

1. `production-journey.e2e.ts` 現有 inv1 `commission` → outro → `scene_2` → map 已走生產內容；**只在這段**改用 WebDriver element click／focus + `browser.keys("Enter")` 或可用的真實鍵盤路徑，不能只呼叫 `browser.execute(() => el.click())`。
2. 在操作後 assert `document.activeElement` 是實際預期控制項（包括 `[data-gameplay-root]` 可能承接從 AcquisitionPopup 還原的焦點），並記錄 `matches(":focus-visible")`。若 WebDriver／WebKitGTK transport 無法造成預期 keyboard focus/modality，**此 case 應標未覆蓋且 fail/inconclusive，不可當「沒藍框」直接 Green**；只在確有需要時補可用的 Linux/Xvfb input 方式，不新建全域鍵盤 infrastructure。
3. 將對話推進拆成可到達 `scene_2` 第一／中／最後一段的 bounded hooks（`scene.id` / queue cursor），在各點查整個 document 的 `activeElement`、computed outline-style/color/width、rect、是否跨人物視覺區；下一個 map 也檢查。**針對失效 outline owner 斷言**，而不是禁止整頁青色樣式。
4. 保存上述 800×600 screenshot 作問題重現證據，照片不用人工/agent 主觀批准才算通過。

### D. 指定兩張 Case File 重開（不是已有 summary checkpoint）

1. 在 organic `production-journey` 真正取得兩張證物後、跨下一 map gate 前，`openGameMenu()` → `案件檔案` → `證物`；借用 `case-file.e2e.ts` 已有 `jsClickButtonContaining` 和 menu/section 定位，分別選 `閉店監視器截圖` 與 `三宅打卡紀錄`。
2. 每張定位 `img.case-file-record-image`（不可錯用 popup `img.evidence-image`）、驗證 actual `currentSrc`、`decode()` 與 screenshot 中圖片 rect 非空內容；關閉選單後 organic journey 仍可繼續。
3. Case File 已有 `case-file.e2e.ts` 只用 `chapter-1-investigation-with-kagami-summary`，不足以代替這個新真實證物測試。**不**為此新增 checkpoint 或複製另一套整章驗收。

### E. Viewport、重跑與 artifacts

- 現有 production journey 先用 `ensureCaseFileViewport()` 放大至 1280×720。只在 inv1 焦點區段及 inv3 證物/CFile 區段 **`try { await ensureMinimumWindowViewport(); assert exactly 800×600; ... } finally { await ensureCaseFileViewport(); }`**；可參考同檔 `runEvidenceTrayGeometryGate` 恢復樣式，失敗也不能把後續 game 旅程鎖在小視窗。
- **兩次獨立** `--attempts 1` 執行，每次各自 runId / artifact dir。不可用 `--attempts 2`，因它會把第一個失敗變成 recovered flake。
- Red/Green 皆須保留截圖、focus DOM/outline、image source + compositor crop 數值；**只要任何一次 Red 就進 Task 2**，不可忽略。

**Done when：** 第一個交付物就是可執行的 E2E assertions + 重現數據，不先寫不可重現的人工調查表。

## 2. Task 2 — 有真實 Red 才做最小修復

- 若未載入／可見空框可實際重現，先只改 `AcquisitionPopup.svelte` 已有 image/loading display。若 source pixels 正常而 screenshot crop 失敗，縮窄 WebKitGTK rendering/compositing；不加入新 resolver/retry/cache，也不重新畫 PNG。
- 若 UA outline 問題重現，優先檢查 `DialogueBox.svelte` 及 `+page.svelte` `[data-gameplay-root][tabindex=-1]`，僅修正確 focus owner 的 authored outline 或轉場焦點，**保留鍵盤 focus 可見性**。
- 既有 `AcquisitionPopup.test.ts`、`CaseFileRecordDetail.test.ts` 已測 null-ID、stale Promise、image error；只有修正新產品行為時才加能在原程式真正 Red 的 focused unit test。
- 若兩次獨立 run 都 Green，記錄「原環境未重現」，保留 regression test，**不猜測修產品**。若新素材需求成立，另行 art ticket，不混同一 coding PR。

## 3. Task 3 — CI/驗收指令及 single-PR gate

由具有 Linux terminal 存取的 **MCP coding agent** 呼叫既有 CLI／讀取 runner outputs（不另啟 `@hypothesi/tauri-mcp-server`）；**MCP 只是執行與蒐證介面**，採驗的是客觀 WDIO 斷言、runId/exit code、screenshot crop/pixel 結果。沒有人工或「agent 目視感覺正常」的 acceptance gate。如果執行環境沒有可用的 MCP terminal 操作能力，標記此 gate **未執行**、PR 保持 Draft，不得把讀過 GitHub 程式等同完成 E2E。

以下命令在 repo root：

```bash
bun run scenes:compile
bun run check
bun run test
bun run lint:all
bun run --cwd apps/game check:e2e
node apps/game/scripts/build-e2e.mjs
# 前置：xvfb（含 xvfb-run/xauth）、xdotool、x11-utils（xprop、xdpyinfo）
# 兩個不同 runId / output directories；任何一次 red 都當 failure
LYRA_E2E_XVFB_TRUSTED_KEYS=1 xvfb-run -a node apps/game/scripts/run-save-e2e.mjs --suite production-journey --attempts 1
LYRA_E2E_XVFB_TRUSTED_KEYS=1 xvfb-run -a node apps/game/scripts/run-save-e2e.mjs --suite production-journey --attempts 1
# 若產品層改到 CaseFileRecordDetail.svelte，才要求額外完整 gameplay suite
xvfb-run -a node apps/game/scripts/run-save-e2e.mjs --suite gameplay --attempts 1
```

最後一行是**條件式**；沒有 Case File 產品改動時，`production-journey` 已包含本次兩張 Case File 圖的實際重開。一般 PR smoke 照原有 CI 運行，但**不足以**覆蓋 HPA-831。

### End-to-end acceptance criteria（MCP 執行、WDIO 機器判準、單一平台）

- [ ] 由 MCP terminal/runner 執行原問題環境 **Linux packaged WebKitGTK + Xvfb**，兩次獨立 `production-journey --attempts 1` 均 Green、各有 runId、exit code、artifact 路徑。若任一次 Red，不得靠後一次結果覆蓋。
- [ ] inv1 `commission` → `scene_2` → map 的受影響旅程以**真實 WebDriver focus/keyboard** 驗證，`[data-gameplay-root]` 與 DialogueBox 等可能 owner 均查到；若輸入 transport 不足以產生真實 focus state，不能標 Green。第一／中／最後一段焦點 outline/rect 斷言和截圖已生成。
- [ ] 在真正 **800×600 CSS viewport** 的 inv3，兩張問題圖及 doorlock 對照的 popup 各執行了 before-decode complete/timing、decoded source canvas，以及**最終 screenshot `.visual` rect 實際繪製像素**檢查，且不錯判合法 null-ID evidence/statement。
- [ ] organic inv3 取得後，在 Case File 重新打開 **`閉店監視器截圖`、`三宅打卡紀錄`**，對 `img.case-file-record-image` 執行 decode 和 screenshot crop gate，選單關閉後遊戲仍可繼續。
- [ ] Screenshot 全部放 `LYRA_E2E_OUTPUT_DIR` 的該次 run outputs 且 pixel/crop checks 可重現，**不以人工或 agent 主觀目視認可作驗收**，也不把生成圖 commit 進 repo。
- [ ] `scenes:compile`、check、unit、lint:all、check:e2e 有明確結果；需要時額外 `gameplay --attempts 1`。任何未執行 gate 均明記，保持 Draft；只有完成本張 ticket 同一 PR 的實作／驗收才轉 Ready。

**非目標：** 不增設第二 runner、Tauri MCP server、新 checkpoint、全域 focus state manager、跨平台 native acceptance、故事更動、圖片生成或 SFX。
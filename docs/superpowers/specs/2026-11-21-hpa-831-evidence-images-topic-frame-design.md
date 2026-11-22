# HPA-831 — 證物黑框與跨場景焦點框：設計規格（Round 2 修訂）

> Linear：[HPA-831](https://linear.app/cwchanap/issue/HPA-831/evidence-images-show-as-empty-black-frames-and-the-focus-frame-sticks) · [Implementation plan](../plans/2026-11-21-hpa-831-evidence-images-topic-frame-implementation-plan.md) · [第一輪 Review](https://github.com/cwchanap/Lyra/pull/140#pullrequestreview-6011002349) · [第二輪 Review](https://github.com/cwchanap/Lyra/pull/140#pullrequestreview-6013786888)  
> **Planning only**；同一個 Draft PR #140 先補可執行 E2E，再按實際 Red 修復；不動故事、save schema、美術或 SFX。

## 1. 問題與已知界線

### A. 證物取得視窗黑框

2026-11-06 Linux **packaged Tauri / WebKitGTK / Xvfb** UAT，Chapter 1 `investigation_scene_3` 的 `evidence.cctv_screenshot`、`evidence.timecard_record` 左側出現黑框，同場 `evidence.doorlock_summary_timetable` 正常。後兩張來自同一 hotspot 的連續 acquisition。現有三張 PNG、故事 ID、`@lyra/asset-paths` 公開路徑均存在且對應正確；先前 Review 亦檢查過編譯 manifest 與 PNG 內容。**不能假定新美術或重建 resolver 能修復。**

`AcquisitionPopup.svelte` 在 `evidenceImage=null` 時展示深色 `.visual` 容器；`resolveStoryAsset` 只同步組裝 public path 並以 Promise 回傳，並無真正 I/O。當共用 WDIO helper `startAcquisitionAcknowledgement` 被呼叫時，已有 get_state IPC + 等待 CONTINUE 按鈕：**此時從 DOM 抓「圖片尚未掛載」不會可靠地觀察到 1-microtask 的空窗**。

需驗證的真實分歧：
- 圖片真正 request／decode 仍在進行？在 `decode()` **之前**記錄 `img.complete`、`currentSrc` 和（可取得時）`performance.getEntriesByName(currentSrc)` 的 resource duration。再驗證 `decode()`、`naturalWidth/Height`、非 placeholder、來源 canvas 像素。
- 圖片可解碼卻沒有繪製到 WebKitGTK 合成畫面？在**圖片仍於 popup 顯示**時取得 packaged screenshot，按實際 viewport／PNG 尺寸映射 `.visual` 的 rect，客觀分析截圖 crop 中的非空且非單色像素。這與 DOM canvas source check 分開，能抓 compositor 問題。
- 若由 screenshot 證實暫時空框是可見 UX 問題，再用最小 loading affordance 處理；**不要為了測試想看「掛載前」而改變正常載入流程**。

### B. 話題轉場後兩條藍線殘留

一次 UAT 中 `investigation_scene_1` 早坂 `hayasaka@commission` → `scene_2` 出現約 25 行藍色水平線，直到下一張 map 才消失；另一次相同路線未重現。

`+page.svelte` 在 dialogue mode 已卸載 `ExploreView/InvestigationSceneSurface`；`DialogueBox` 持續掛載跨越 scene。另有重要候選：`+page.svelte` 的 **`[data-gameplay-root][tabindex="-1"]`**，AcquisitionPopup 關閉時可被回焦。此 root 在 Chapter 1 `kagami_summary` 取得後可能持續帶著 WebKitGTK UA outline。**只查 DialogueBox 子樹可能漏掉真正 focus owner。**

原有 `production-journey` 以 `browser.execute(() => el.click())` 推進話題／對白；這不會可靠地移動真實焦點、觸發鍵盤輸入模式或 `:focus-visible`。必須在該區段走 **WebDriver element click / focus + key**，並實測 activeElement 與 focus state 真有改變，否則把結果列為 transport 未覆蓋而非 Green。觀測範圍是整個 document（包括 root），需記錄 element tag、class、`:focus-visible`、computed outline-style/color/width、bounding rect；紅色合法焦點樣式不得被一概移除。

## 2. 玩家可見契約

1. 取得 `閉店監視器截圖`、`三宅打卡紀錄`、正常對照 `門鎖摘要合併時間表` 時，都能看見對應圖片；取得後在 Case File 再開兩張問題圖，同樣可見。
2. 來源解碼與**實際 packaged screenshot 中的繪製結果**均通過。若圖片在可見期間長時間只是暗框，提供最小清楚的 loading/fallback 回饋，而非忽略玩家畫面。
3. 從 `委託內容` 話題直跳 `scene_2`，第一／中／最後一段對白與 map 都無前一話題留下的非預期藍色輪廓；原本合法的紅框、可見鍵盤焦點、對話及地圖進度保持。
4. 不修改案件證物 ID、劇情、對話 proof order、存檔格式、全域 UI 框架；無跨平台重複驗收。

## 3. 可執行驗收路徑

### Test environment / runner

- 在最初 UAT 的 **Linux WebKitGTK + Xvfb packaged** 環境運行；`ensureMinimumWindowViewport()` 在受影響區段縮到**精確** 800×600 CSS，`observedCssViewport()` 驗證；`finally` 一律恢復 `ensureCaseFileViewport()`，不影響後續分析板。**不要使用** `captureMockupViewport()` 當縮窗工具：它接受 `>=` target，1280×720 會假綠。
- `--attempts 2` 是 **fail-only retry**，第一次 Red、第二次 Green 時會回報 recovered flake，反而掩蓋間歇性症狀。必須執行兩次**獨立** `--suite production-journey --attempts 1`，保留兩次 runId、exit code、artifacts；任何一次 Red 都必須調查，不能被下一次通過覆蓋。
- 不新增 Tauri MCP server 或 E2E runner。**MCP 的角色只限執行／取得這兩次既有 packaged WDIO 命令及 artifact**；可重現的 WDIO assertions（包括 screenshot pixel check）才是唯一測試 pass/fail 判準，不能加「某 agent 目視認可」或人工批准作第二個 gate。此定義同時滿足專案要求的 MCP E2E 執行與 Review 提倡的可重現驗收。
- Screenshot 放到 `LYRA_E2E_OUTPUT_DIR`（runner 會隔離每次執行的輸出），不得 commit 生成圖。

### Image path

- 在共用 `e2e-tauri/helpers.ts::startAcquisitionAcknowledgement` 對非空真實 `imageAssetId` 做 wait-image → pre-decode state/timing → decode → source pixels；null-ID evidence 的 placeholder 和 statement 不應被錯誤判為失敗。
- 只對指定的 Chapter 1 三張需抓 800×600 popup screenshot 並分析 `.visual` crop 的**合成畫面**；可以在共用 helper 裡接受限定 ID 的取樣條件，避免每張證物都跑昂貴 screenshot decode。原始圖可能偏暗，取樣以不透明、非均勻、與容器純底可區分為準，不以「亮度 > 某固定門檻」判所有圖。
- Case File 的兩張指定圖片要在**同一 organic `production-journey`** 取得後重開；正確 selector 是 `img.case-file-record-image`（而非 popup 的 `img.evidence-image`）。同樣做 decode + screenshot crop，必要時重用小型 test-only PNG decoder；既有 `gameplay` 的 Case File checkpoint 只有 KAGAMI summary，不能冒充上述覆蓋。

### Focus path

- 在 `production-journey` 的 `commission → scene_2 → map` 區段使用真實 WebDriver focus / key transport，並斷言它確實改變 activeElement/focus modality；若該平台鍵盤 transport 不可信，標成**測試未覆蓋／不可 Green**。
- 捕捉 `scene_2` 第一、中間、最後一行與 map 的 activeElement（含 root）、outline 及 rect；照片可作診斷 artifact，**真正合併 gate 是精確的 DOM／輪廓狀態斷言**，而不是整頁無青色。
- 若 Red 證實 UA outline 或殘留元素，僅修 `DialogueBox`、`+page.svelte` focus root 或實際 owner 的最小 CSS/focus 行為；不改全域 focus manager、不用 setTimeout。

## 4. 決策

| 觀測結果 | 最小決策 |
| --- | --- |
| 第一、第二次獨立 E2E 都 Green | 保留測試，記錄原環境未重現；不臆測修改產品 |
| 任一次 Red 且源 PNG 能解碼，但 screenshot 黑框 | 聚焦 WebKitGTK compositor／顯示層，保留 failure screenshot；只改已確認位置 |
| 首次 popup 明顯慢載／有可見黑框 | 元件現有 image loading 顯示增加小型 loading hint；不新建 resource pipeline |
| 真實 focus frame 來源為 root 或 DialogueBox | 就地修 authored focus ring／scene focus movement，保留鍵盤焦點可見 |
| 圖像內容真的需重新繪製 | 當作**獨立 art task**，不混入本 ticket 的 coding PR |

無新 checkpoint、無重複 jsdom tests、無聲音或額外美術。
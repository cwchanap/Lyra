# HPA-831 — 證物黑框及跨場景焦點框：設計規格（review 修訂）

> Linear：[HPA-831](https://linear.app/cwchanap/issue/HPA-831/evidence-images-show-as-empty-black-frames-and-the-focus-frame-sticks) · [Implementation plan](../plans/2026-11-21-hpa-831-evidence-images-topic-frame-implementation-plan.md) · [PR #140 review](https://github.com/cwchanap/Lyra/pull/140#pullrequestreview-6011002349)
>
> 狀態：**Planning only**。只在同一 Draft PR #140 實作及驗收；沒有新 art、SFX 或故事內容。

## 1. 已知事實與待證假說

### 症狀 A：兩張證物圖片曾顯示空黑框

2026-11-06 的 UAT：Chapter 1 \`investigation_scene_3\` 中，\`閉店監視器截圖\`（\`evidence.cctv_screenshot\`）與 \`三宅打卡紀錄\`（\`evidence.timecard_record\`）的取得視窗顯示左側空黑框；同場 \`evidence.doorlock_summary_timetable\` 正常。這些畫面**來自 Linux/Xvfb 的 packaged WebKitGTK**，不是一般 macOS WebKit 的實測。

靜態已確認：
- 三張 PNG 都存在：\`static/assets/evidence/{cctv_screenshot,timecard_record,doorlock_summary_timetable}.png\`；\`investigation_scene_3.md\` 的對應 evidence ID 正確。
- \`packages/asset-paths/src/index.ts\` 已提供統一 URL \`/assets/evidence/<id>.png\`；\`apps/game/svelte.config.js\` 使用 repo \`static/\`。
- 同一個 \`investigation_scene_3\` hotspot 同時授出 timecard 與 doorlock，所以「某張圖黑、緊接的另一張正常」更應優先排查**第一次 popup 的載入時序／WebKitGTK 繪製**。
- \`AcquisitionPopup.svelte\` 中 \`evidenceImage\` 在 Promise resolve 前是 \`null\`；此時 \`.visual\` 只有深色背景，UAT 的「黑框」可能是**未完成載入的畫面**。
- Review 已在產物中核對三張 PNG 為有內容的 512×512 RGBA、manifest 路徑正常、report warnings 為空；這些**生成檔不在 repo**，實作時仍需執行 \`scenes:compile\` 確認當前結果。

尚未證明：載入完成後有沒有 WebKitGTK Xvfb 真正無法繪製；或 UI 在 decode 前就被拍下。**不能只因 PNG 存在便宣稱已修。**

### 症狀 B：早坂委託話題的藍線偶爾留在下個場景

第一次 UAT 在 \`investigation_scene_1\` 的 \`hayasaka@commission\` 話題後，直接經過 outro 進 \`scene_2\`，兩條藍色水平線跨越人物面部約 25 行；下一個 map 才消失。第二次同路線沒有重現。

靜態縮窄：
- 話題進入 \`dialogue\` mode 後，\`+page.svelte\` 不再顯示 \`ExploreView\`；故 \`InvestigationSceneSurface\` 的 topic popover **不是**下一場景仍在畫面上的直接 owner。
- \`DialogueBox\` 在連續 dialogue scenes 間仍掛載，到 map/explore 才卸載，符合 reported clear boundary。
- Review 提出 WebKitGTK **UA 預設 focus outline** 與鍵盤／滑鼠 modality 差異的假說；此**尚未經 DOM 證實**。須先採樣 \`document.activeElement\`、\`outline-style/color/width\`、element rect 及有關偽元素，不可把所有青／藍線當成異常。
- \`DialogueBox\` 既有合法 crimson 焦點樣式／話題紅框不可被全面隱藏。

## 2. 行為契約

1. 第 1 章兩張證物取得視窗與 Case File 重看時，圖像載入完成後**確實可辨識**。短暫載入不能無提示呈現成永遠的空黑框；只有真失敗才使用既有有字 fallback。正常的 doorlock 對照仍可見。
2. \`hayasaka@commission\` → \`scene_2\` 的第一句、中段、最後一句，以及下一 map，沒有來自前一個話題／UA 的**非預期藍色水平焦點線**；新場景合法 focus ring、紅色對白框和對話前進功能保留。
3. 不改 evidence IDs、proof order、故事文字、存檔格式、圖片生成、CSS framework 或全域 state。兩個症狀各自最小修，不能被綁成共享狀態系統。

## 3. 驗證策略（沿用既有 packaged harness）

**首要環境**是與原問題一致的 **Linux + packaged Tauri + WebKitGTK + \`xvfb-run\`**，用 \`observedCssViewport()\` 驗證實際 800×600 CSS 尺寸；需比較真正視窗時，盡量**同一 Linux WebKitGTK、只改有無 Xvfb**，不要把換到 macOS 引擎當成證明「只在 headless 出現」。不要求第二 native 平台。

由**MCP agent 操作現有 WDIO packaged E2E**（或從 MCP/CI 取回執行結果）作 E2E acceptance；沿用 repo 的 \`production-journey\`、\`gameplay\`、\`capture-proof\` 既有流程和 screenshot artifacts。**不額外依賴會 spawn 失敗的 Tauri 專用 MCP server，不建立第二套 E2E runner。**

### 圖像檢查（可重用）

- 在 \`e2e-tauri/helpers.ts\` 的 \`startAcquisitionAcknowledgement\` 共用入口，當 pending record 有**非空 imageAssetId** 時，等待正確 card 的 \`img.evidence-image\` 掛載並 \`decode()\`；檢查 \`complete\`、\`naturalWidth/Height > 0\`、\`currentSrc\` 不指向 \`data:image/svg\` placeholder。
- 沿用 \`capture-proof.e2e.ts\` 的 canvas \`drawImage\` / \`getImageData\` 思路作輕量非空圖像取樣（可用縮小 canvas 避免每張全尺寸掃描）。**不能只抽樣自然尺寸，也不能假定每張深色主題圖都必須高亮**；對兩張已知問題圖、正常對照須有能辨別空黑與實物的明確條件。
- **不能用「E2E 等到 decode 才拍照」遮住 timing bug。** 同時記錄開啟時／完成 decode 後狀態及 time-to-decode（尤其同一 hotspot 第一張 vs 第二張）。若出現肉眼可見的長時間空白，最小修復應有明確 loading affordance，而非只改測試等待。
- 圖片 canvas 證明來源可解碼，**不單獨證明最終合成畫面可見**。保存 800×600 popup screenshot，MCP agent 依實際畫面／可重現像素或 overlay 檢查完成視覺驗收；沒有 Linear mockup，對照 HPA-831 的 UAT 症狀。

### 焦點檢查（既有有機旅程）

- \`production-journey.e2e.ts\` 原本已走過 inv1 \`commission\` → \`scene_2\` → map；在這段既有旅程的關鍵停點收集 activeElement、outline（含 source element 與 rect），用可重複斷言限制 UA 異常輪廓；不同於「整頁無青色」。
- 依既有 \`browser.saveScreenshot\` 輸出 \`scene_2\` 的首／中／末與進 map 圖片；避免純主觀「人覺得線沒遮到眼睛」的 gate。若 UA outline 是根因，在真正 owner 的元件加 authored \`:focus-visible\` 或最小 focus move，並驗證 keyboard focus 仍可見。
- 重播既有 runner（\`--attempts 2\`），首次 Red 視為重現，先確認來源再修；多次 Green 則記錄**「原環境未重現」**，留 regression 而不憑猜測修改產品。

## 4. 判斷與邊界

| 有證據的結果 | 處理方式 |
| --- | --- |
| popup decode 前出現黑框，時間明顯可察覺 | 現有 AcquisitionPopup 加最小 loading/fallback 視覺回饋；勿改路徑與 assets |
| decode 後 canvas 有內容，但 packaged screenshot 還黑 | 縮窄到 WebKitGTK 繪製／合成，使用最小元件修復；必要時同引擎對照實窗 |
| 原始 PNG/manifest 確實在新 main 出錯 | 只修真實 regression 的既有 asset ID／build；Review 已靜態排除舊檔缺失，不再預設要重診整套 pipeline |
| activeElement outline/rect 對上藍線 | 只在正確元件加 focus 樣式或轉場清理，保留鍵盤 focus 可見性 |
| 多次舊環境測試皆 Green | 保留防回歸測試，明記未重現；不改產品、不新增 art ticket |

**非目標**：不另做 3+ 次人工劇情重播、不新增 checkpoint 或 E2E framework、不重複測已有的 JS null-ID/async fallback、不做新美術、不擴張到 HPA-832／HPA-852／HPA-851。

# HPA-831 — 證物黑框與焦點框殘留：單一 PR 實作計劃（review 修訂）

> Linear：[HPA-831](https://linear.app/cwchanap/issue/HPA-831/evidence-images-show-as-empty-black-frames-and-the-focus-frame-sticks) · [Design spec](../specs/2026-11-21-hpa-831-evidence-images-topic-frame-design.md) · [PR #140 review](https://github.com/cwchanap/Lyra/pull/140#pullrequestreview-6011002349)  
> **狀態：Planning only。** 後續程式與測試加入**同一 Draft PR #140**，不拆第二個 PR；未執行 packaged E2E，不能宣稱已修復。無新 art/SFX。

## 0. 審查採納結果（F1–F8）

| Review | 決定 |
| --- | --- |
| **F1** 原計劃的 macOS 與 Xvfb 混變數 | **接受**：首測 Linux packaged WebKitGTK + Xvfb（原 UAT 環境），800×600 CSS viewport；同引擎實窗僅作可選對照 |
| **F2** 新 Tauri MCP server 與已有 WDIO 重複 | **接受重用、不接受取消 MCP 驗收本身**：由 MCP agent **執行／核驗既有 WDIO packaged suite**，不依賴獨立 Tauri MCP server；客觀 WDIO 斷言是自動化 gate，截圖由 MCP agent 做視覺核對，無人工 gate |
| **F3** 三張圖片逐張手動檢查重複 | **接受**：把 image 等待／decode／非空像素檢查放入共用 \`startAcquisitionAcknowledgement\`，所有有圖片的 pending acquisition 自然覆蓋；保留已知兩張＋doorlock 對照的失敗定位 |
| **F4** PNG／manifest 內容與 ID 已可靜態排除 | **接受**：不再預設路徑/美術錯；重點移到第一張 popup 的 time-to-decode 與 WebKitGTK paint。生成 manifest/report 未提交在 repo，編譯時只做一次常規檢查 |
| **F5** 重複 async/null-ID 單元測試 | **接受**：重用 \`AcquisitionPopup.test.ts\`、\`CaseFileRecordDetail.test.ts\`；只在定位出前端錯誤時增補 red unit |
| **F6** Topic UI 的 owner 推測太廣 | **接受部分並標記假說**：\`ExploreView\` 在 dialogue 模式已卸載；優先查跨場景持續掛載的 \`DialogueBox\` 和 UA focus outline，不在確認前認定就是 browser default focus |
| **F7** smoke 不走受影響路徑 | **接受**：focused gate 是 \`production-journey\`（兩條場景路徑）、\`gameplay\`（Case File），smoke 僅保留既有 CI |
| **F8** Task 1 是不可重複的診斷文字 | **接受**：第一個交付物直接是可運行的 packaged E2E 斷言，先 Red-first；若兩次 Green 則寫「原環境未重現」，不猜修、不再人手重播 |

補充防假綠：\`decode()\` 只證明來源圖片有效，未必證明 WebKitGTK 最終 compositor 畫得出來；保留 screenshot 及 MCP 視覺／像素檢查，不讓測試等待 decode 意外遮掉剛開窗時的黑框。

## 1. Reuse pins（current main）

- \`static/assets/evidence/cctv_screenshot.png\`、\`timecard_record.png\`、\`doorlock_summary_timetable.png\` 都存在；其 ID 在 \`docs/stories_plan/chapter_1/investigation_scene_3.md\`。
- \`packages/asset-paths/src/index.ts\` 是 URL 單一 owner；\`AcquisitionPopup.svelte\` 的 \`evidenceImage=null\` 會讓暗底 \`.visual\` 在圖尚未 resolve 時看起來像空黑框。
- \`apps/game/e2e-tauri/helpers.ts:1536\` 的 \`startAcquisitionAcknowledgement\` 是 popup 共用入口；\`capture-proof.e2e.ts\` 既有 \`decode + canvas.getImageData\` 思路，\`observedCssViewport\`、\`captureMockupViewport\` 和 screenshot helper 已存在。
- \`production-journey.e2e.ts\` 已有 \`commission\` topic → \`scene_2\` → map，亦會依 Chapter 1 真實流程取得 inv3 證物；\`case-file.e2e.ts\` 已驗證 Case File 流程，但其既有 checkpoint **不是**兩張問題圖，不能單靠那套測試宣稱兩張圖在 Case File 都已可見。
- \`+page.svelte\` 中 dialogue mode 不渲染 \`ExploreView\`，\`DialogueBox\` 持續掛載直到退出 dialogue mode。藍線可能是聚焦元素的 UA outline，但**未經實測確認**。
- HPA-712 / [PR #139](https://github.com/cwchanap/Lyra/pull/139) 不在本 ticket 範圍；若 main 更新，只校正測試錨點，不改故事文本。

## Task 1 — 最小 Red-first E2E，直接驗證原始環境

**修改：** \`apps/game/e2e-tauri/helpers.ts\`、\`production-journey.e2e.ts\`（必要時 \`case-file.e2e.ts\`）；必要時只重用 \`capture-proof\` 檢查方法，不新建 suite、checkpoint 或 framework。

1. 在 \`startAcquisitionAcknowledgement\` 先驗證 current card ID/title，並對 recordKind=\`evidence\` 且 imageAssetId 非空的彈窗，等 \`img.evidence-image\` 挂載、\`decode()\`、斷言非 placeholder、\`naturalWidth/Height > 0\`；canvas 縮小 sample 能辨識透明／全黑圖片。先確認呼叫方已有完整 \`PendingAcquisitionView\`，需要時以最小方式擴充 type；statement/null-image 的既有合法 placeholder 不應誤紅。
2. 在**同一段** popup 流程記錄 first-frame（\`img\` 尚未出現前）與 decode-ready 狀態，以及 time-to-decode。特別記錄 inv3 CCTV（單獨第一張）、timecard（hotspot 一組證物的第一張）與 doorlock（同組下一張）比較；避免測試只在圖載完後截圖而掩蓋「空黑框停太久」。
3. 取 \`capture-proof.e2e.ts\` 的 \`drawImage/getImageData\` 做輕量樣本；**保留原生暗色圖片的容許度**，不為所有 image 硬設任意高亮比例。對已知三張可用明確非黑／非透明＋像素差異斷言。
4. 在 \`production-journey\` 的 inv1 \`hayasaka@commission\` → \`scene_2\` 有機旅程加觀測點：首句、中段、尾段（以 \`scene.id\` 與 queue 位置辨識），查 \`document.activeElement\` 的 tag/class、computed outline、rect，並保存 800×600 screenshots。只有**不合理大的 UA focus 邊框／殘留話題框**才算 Red；不能 assert 整頁沒有青色。
5. Linux packaged E2E 在 \`xvfb-run\` 下實跑（記錄 main SHA、WebKitGTK、viewport \`innerWidth/innerHeight\`、測試結果）。利用既有 runner \`--attempts 2\` 重複。若環境允許，同 Linux engine 實窗只換 window mode 對照，非必需。

**Done when：** 可運行的 E2E assertions 已進同一 PR；Red/Green、截圖、load timing 和 focus DOM 證據均可追溯。**不是**先寫一份無法反覆執行的人工診斷報告才開始。

## Task 2 — 只修真正的根因（有 Red 才改產品）

- **圖片**：若發現解碼前暗底長時間可見，先在現有 \`AcquisitionPopup.svelte\` 給清楚的 loading affordance 或沿用 placeholder，不建新 loading service；若 decode 後有像素但 packaged screenshot 仍黑，針對單一 WebKitGTK render/compositing path 做最小修。若全程正常，保留 E2E regression，不改圖片邏輯。
- **藍線**：若 \`activeElement\` outline 的 rect 正對上異常橫線，在 \`DialogueBox.svelte\` 的對應聚焦控制項加 authored \`:focus-visible\` 或於 scene 轉換時移動 focus（**仍保留鍵盤可見 focus**）。若另有明確 owner，才改那個元件的最小 cleanup；禁全域 CSS 隱藏、setTimeout workaround、全域 state manager。
- 新增紅單元測試**只有**在實際改動的 Svelte state/render path 可用元件測試捕捉時；既有 \`AcquisitionPopup.test.ts\` 與 \`CaseFileRecordDetail.test.ts\` 已覆蓋 null、async、stale、error fallback，勿再換兩個 ID 重寫相同測試。
- 不碰 story、evidence schema、save format、原有圖片生成與字體；若發現資源真的損壞，另評估獨立 art task，**不把美術混入此 coding PR**。

**Done when：** 被確證的 Red 已轉 Green；若兩次同環境都 Green，記錄「未重現」並停止猜修。

## Task 3 — MCP 操作既有 packaged E2E 的最終驗收

由**MCP agent**驅動現有 WDIO／查看所產 artifacts（不是要求額外 Tauri MCP server）；**E2E 以現有 packaged WDIO asserts 為機器判準**，不設定任何 human acceptance。無 mockup：MCP agent 檢查實際 800×600 screenshot 是否仍有空黑框、圖像是否被 UI 遮住、話題藍線是否跨 scene；若需像素可重現門檻，在既有 WDIO screenshot 基礎上加入局部像素判斷，且與源圖 canvas 檢查分開。

固定兩個 user journey：
1. Chapter 1 真實 inv3：兩張問題圖及 doorlock 對照逐一取得、popup 首幀/decoded 幀、Case File 再打開兩張（必要時在相同 organic journey 添加 Case File 打開動作；**既有 gameplay suite 的 Kagami summary re-examine 不替代指定兩張**），圖可辨識且無空黑框；正常 CONTINUE 和後續案件照走。
2. Chapter 1 inv1 \`commission\` 直接走 \`scene_2\`：首句／中段／末句／map 的 focus probe 與 screenshot 都無舊藍線；保留合法 crimson 對白框、鍵盤 focus 可見、故事可推進。

重用 \`observedCssViewport\` 驗證當前測試位置為 **800×600 CSS viewport**（而非只信 native window size）；若 production journey 為 Analysis 先擴至 1280×720，**只在受影響區段縮至 800×600，必要時恢復以免破壞既有拖曳 gate**。E2E screenshots 存作 artifact，勿提交到 Git。

## Task 4 — 檢查命令、測試門檻與狀態

在 repo root：

\`\`\`bash
bun run scenes:compile
bun run check
bun run test
bun run lint:all
bun run --cwd apps/game check:e2e
# 先建 packaged binary；同一 build 不必每個 suite 重建
node apps/game/scripts/build-e2e.mjs
xvfb-run -a node apps/game/scripts/run-save-e2e.mjs --suite production-journey --attempts 2
xvfb-run -a node apps/game/scripts/run-save-e2e.mjs --suite gameplay --attempts 2
\`\`\`

若 runner 實際的 flags/platform 有限制，以 \`run-save-e2e.mjs\` 的 CLI 契約為準並記錄等價命令；smoke 是已有的 PR CI，但**不是**此問題的 focused gate。

### End-to-end acceptance criteria（單一平台、MCP、無人工驗收）

- [ ] MCP agent 在 **Linux WebKitGTK + Xvfb packaged** 重用既有 WDIO E2E；報告實測 engine/window/viewport 與 head SHA，且 \`innerWidth = 800\`、\`innerHeight = 600\` 的 screenshot/DOM assertions 在受影響區段真有執行。
- [ ] 共用 \`startAcquisitionAcknowledgement\` 對**具 real imageAssetId** 的 popup 等待 decode、非 placeholder、非空 canvas sample；兩張問題圖、doorlock 對照必須被測到，首次載入時間也被記錄（不能靠只測 decoded frame 假綠）。
- [ ] 指定兩張證物在取得視窗、Case File 重看都確實顯示；圖片載入前不是長時間無說明的空黑框，且不存在被 UI 遮蓋或後來變黑的情形；失敗載入仍顯示既有 fallback。
- [ ] \`commission\` → \`scene_2\` 首／中／末句 → map 的焦點 owner、rect 和 screenshot gate 完成，舊藍色 UA／話題框不殘留；紅色對白框、正常鍵盤 focus 和對話進度不退步。
- [ ] \`production-journey\` 和 \`gameplay\` 以 packaged E2E 通過且 MCP agent 對截圖完成**視覺檢查**，不把單元／smoke 代替本次 E2E；headless 原問題若未復現則寫清楚，不假稱已修。
- [ ] \`scenes:compile\`、check、unit、lint、check:e2e 有明確 pass/fail；不改故事/儲存格式、不加新 art/SFX、不另外開實作 PR。直到驗收全部達成，PR 保留 Draft。

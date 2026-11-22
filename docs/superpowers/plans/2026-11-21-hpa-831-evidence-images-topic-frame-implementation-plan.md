# HPA-831 — 證物圖片與調查話題焦點框：單一 PR 實作計劃

> Linear：[HPA-831](https://linear.app/cwchanap/issue/HPA-831/evidence-images-show-as-empty-black-frames-and-the-focus-frame-sticks) · [Design spec](../specs/2026-11-21-hpa-831-evidence-images-topic-frame-design.md)  
> **狀態：Planning only。** 本 Draft PR 後續**直接加入實作與測試**，不再開 implementation PR；不新增 art、SFX、劇情內容。
>
> 觀察到的兩個症狀尚未證明同一根因；以**兩個彼此獨立、可驗證的最小修補**處理，嚴禁為了合併這張 ticket 造共享狀態架構。

## 0. Current-main code pins／可重用資產

- Chapter 1 `investigation_scene_3.md` 的 `evidence:cctv_screenshot`、`evidence:timecard_record` 與對照 `evidence:doorlock_summary_timetable` 都有同名 PNG 位於 `static/assets/evidence/`。
- `packages/asset-paths/src/index.ts` 為 public URL 單一 owner；`apps/game/svelte.config.js` 設定靜態素材來源，勿在元件複製映射邏輯。
- 取得視窗：`apps/game/src/lib/components/AcquisitionPopup.svelte`，既有 `resolveStoryAsset`、`onerror` 與取消過期 Promise guard；案件檔案：`apps/game/src/lib/components/case-file/CaseFileRecordDetail.svelte`。
- 轉場入口：`apps/game/src/routes/+page.svelte` 依 mode 選擇 `ExploreView`／`DialogueBox`；`InvestigationSceneSurface.svelte` 管理話題 popover。不要先假定是哪一層的藍線。
- 測試沿用 `AcquisitionPopup.test.ts`、`CaseFileRecordDetail.test.ts`、`apps/game/e2e-tauri/helpers.ts`、`production-journey.e2e.ts` 或既有最貼近的 packaged journey。現有 `ensureMinimumWindowViewport`／`browser.saveScreenshot` 可重用。
- 與正在進行的 HPA-712 / [PR #139](https://github.com/cwchanap/Lyra/pull/139) 不共用故事正文變更；若之後 main 更新，重讀最新 scene/測試 pins，不改該 PR 的文本。

## Task 1 — 診斷並留下真正的 baseline（先於任何修補）

1. 以 repo 最新 main 打包並用 MCP 操作 Tauri UI，固定 800×600；記錄實際平台、CSS viewport、執行模式（真視窗或 Xvfb）、main SHA。
2. 到第 1 章咖啡館 `investigation_scene_3`，依序取得 `閉店監視器截圖`、`三宅打卡紀錄`、`門鎖摘要合併時間表`，各保存 screenshot。對取得彈窗與案件檔案，讀取 DOM 中的 `src/currentSrc`、`complete`、`naturalWidth/Height`、元素 rect、computed `visibility/opacity`；核對 build 輸出的 PNG 是否存在且有可見非黑像素。
3. 比較同場正常證物，分辨：路徑或打包問題、PNG 自身問題、WebKit 解碼／繪製、前端 stale promise／overlay，**不以 headless 畫面直接定性產品 bug**。
4. 從 `investigation_scene_1` 早坂「委託內容」話題進入 `scene_2`，至少三次測一般推進與一次快速推進；在第一句、中段、尾段及下一地圖截圖並檢查 DOM/styling。量測哪個 DOM/偽元素造成上下藍線；僅將已有的話題專屬裝飾列為可清除對象。
5. 在 PR 描述追加可重現命令、表格和截圖位置。不能重現就標明，不要自行宣稱根因。

**Done when：** 有兩條獨立結果與可追溯 screenshot/DOM 證據，才能進 Task 2／3。若某症狀已在 main 正常，該條只保留回歸保護，不加入臆測產品修正。

## Task 2 — 證物黑框：Red-first 回歸 + 最小 image fix

1. 在 `AcquisitionPopup.test.ts` 與 `CaseFileRecordDetail.test.ts` 補針對 `evidence.cctv_screenshot`／`evidence.timecard_record` 的 image ID → URL、元素切換、error fallback、快速換紀錄時 stale resolution 不反蓋的測試；沿用既有 mocks。注意 **jsdom 的 `img` 不會像真 WebKit 解碼 PNG**，單元測試不充當圖片成功顯示的驗收。
2. 若 baseline 證實 URL／檔案輸出錯，修正原有 asset ID/manifest/public path 的一個事實來源。若真是 effect 或 image event 問題，僅改 `AcquisitionPopup.svelte`／`CaseFileRecordDetail.svelte` 的現有 state handling。需要改 `story-assets.ts` 時，必須證明共用映射本身錯；不新增 resolver、fetch retry、圖片全域 cache。
3. 不更改證物名稱、描述、ID、unlock 或 acquisition order。不在此 PR 重新產生 PNG；若圖片已損壞或畫面不符合內容，另建**純 art task** 並在此記錄 blockers。
4. 修復後 packaged UI 在取得視窗及 Case File 都要有可辨識的圖像；`doorlock_summary_timetable` 對照維持正常。

**Done when：** 失敗路徑單元測試轉綠；packaged UI 的兩張真實 PNG 可見且與文字相符；並非僅 `<img>` 存在。

## Task 3 — 跨場景焦點框：擁有者清除，不加全域 workaround

1. 用 Task 1 定位後，在**產生該裝飾的單一現有元件**加 scene/mode／話題 beat lifetime cleanup。先查看 `InvestigationSceneSurface` popover、`DialogueBox`、`GameShell` 的現有條件 render 與 CSS；不要預先把清理散到三個元件。
2. 新增元件回歸：話題開啟時合法顯示；由話題直接轉入 scene_2 後舊焦點線已清除；正常返回調查、開選單、保存／讀取或下一地圖也不復活。測試必須 assert **舊 frame 身分／特定 class**，不可泛化成「頁面不能有藍色元素」。
3. 若只有特殊 WebKit/快速推進競態才發生，在相同元件加最小 cleanup/取消舊 callback。不要透過 setTimeout、全域 CSS `display:none` 或刷新整頁強制掩蓋。
4. 若 main 在多次真實 UI 測試皆無重現、找不到 stale owner，保留能判定跨場景狀態不殘留的回歸測試，標記原始問題未重現，不做虛假修復。

**Done when：** 不同 scene tag 中人物對白與紅框維持正常；舊話題藍色橫線不跨到 scene_2。

## Task 4 — MCP packaged E2E + screenshot visual acceptance

由 agent **經 MCP 操作**封裝版 Tauri，在單一平台做端到端驗收；既有 WebDriver packaged test 充當可重複自動回歸。若當前環境無可控制 Tauri 的 MCP，則 PR **維持 Draft 並列出未完成的 MCP UI gate**；不可把 DOM unit tests 說成已完成 E2E。

- 旅程 A：第 1 章 `investigation_scene_3` 取得 CCTV → timecard → doorlock 對照，檢查取得彈窗各 `img.complete && naturalWidth > 0`、URL、非空可見圖片、文字未遮蔽；再從案件檔案重開至少前兩張，內容仍可辨識。保存每步 800×600 screenshot。
- 旅程 B：`investigation_scene_1` 完成早坂「委託內容」→ 直接進 `scene_2`，截第一句／中段／最後一句及進入 `investigation_scene_3` 的畫面；不得有上一話題的藍線跨過人物眼睛，對白可繼續、正常紅框不消失。跑一般與快速推進，並有可追溯的完成／重複次數。
- 以 `apps/game/e2e-tauri/helpers.ts` 的現有 viewport、checkpoint、保存 screenshot 機制實作最小回歸；盡量在現有 `production-journey.e2e.ts` 或最合適的既存 suite 增補，不建重複 runner。需要新 checkpoint 時僅建立真正必要的**一個**，且不得只測 synthetic fixture 而未走生產 UI。
- 無 Linear mockup：由 MCP 檢查 UI 截圖對照 UAT 描述／修前圖，客觀檢查圖片有效像素與 frame 的所屬狀態；不設人工批准條件。不要將 screenshot PNG 誤 commit 到 repo（只留 E2E artifact）。

## Task 5 — 自動測試與合併前門檻

在原 repo 執行既有檢查（可按實際 package script 調整，保留結果）：

```bash
bun run scenes:compile
bun run check
bun run test
bun run lint:all
bun run --cwd apps/game check:e2e
bun run --cwd apps/game test:e2e:smoke
# 已打包後用現有 runner 執行所擴充的 packaged journey / focused suite。
```

### End-to-end acceptance（不可標人手驗收）

- [ ] Task 1 有真視窗 packaged baseline：問題重現／未重現、環境與原因信心寫清楚，不能憑舊 headless 圖說已證實。
- [ ] `cctv_screenshot` 和 `timecard_record` 在 acquisition modal 與 Case File 都可見，`doorlock_summary_timetable` 仍可見；失敗時會顯示既有 fallback，不出現無說明空黑框。
- [ ] 800×600 的 MCP UI screenshot 視覺檢查通過；PNG 的圖像內容確實呈現，不能只靠 network 200 或 `naturalWidth` 假綠。
- [ ] `hayasaka@commission` 話題直接進 `scene_2`，第一句、中段、尾段與下一地圖都沒有舊話題藍色焦點線；快速推進和一般推進可完成，不誤刪紅色話題框或新場景合法 focus。
- [ ] 原有圖片載入／error fallback、Svelte reactive cleanup 與相關 unit regression 綠燈；MCP packaged E2E 覆蓋真實 scene 旅程，並保存 screenshot artifact。
- [ ] 編譯、check、測試、lint、e2e smoke、focused packaged journey 有明確 pass/fail 紀錄；**MCP E2E gate 未完成時 PR 不標 Ready**。
- [ ] 無故事/證物 schema、save format、rendering framework 大改；無新圖片/SFX。**HPA-831 只使用這一個 PR**，完成驗收後才標 Done。

## Review pointers

- 先問「兩個症狀各自有真實根因嗎？」再討論抽象共用元件。
- 不將「資源檔存在」寫成「圖片在真視窗已可見」。
- 不把 intermittent 焦點殘留誤判成全域藍框問題。
- 僅保留有驗證價值的 regression；不為這兩個症狀新增大型 E2E architecture。
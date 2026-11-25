# HPA-852 — 預設 800×600 視窗：可操作調查舞台、人物與安全返回標題

**狀態：Draft design / 待實作（已納入第一輪 design review）**  
**日期：2026-11-24**  
**Linear：** [HPA-852](https://linear.app/cwchanap/issue/HPA-852/targets-and-faces-hidden-off-screen-or-under-the-hud-at-the-default)  
**程式基準：** [main @ 1349831b8ab56db1c025c2ea360a0bef9bc82ac8](https://github.com/cwchanap/Lyra/commit/1349831b8ab56db1c025c2ea360a0bef9bc82ac8)  
**Review：** [第一輪設計審閱](https://github.com/cwchanap/Lyra/pull/141#pullrequestreview-6050179714)  
**相關：** HPA-853/#136、HPA-1143、HPA-705/#138、HPA-830/#133、HPA-831/#140；HPA-712/#139 獨立進行。

## 1. 目標與現況

HPA-853 已完成 72 個 Chapter 2 配置，並將 HUD 與調查舞台分離；不重做其成果。HPA-852 的原始 UAT 是舊 build 的觀察，尚未在本輪執行 packaged app 驗證。以既有測試補上可重現的 assertion，而不是先全面重跑兩章才決定設計。

- 800×600 **實際 WebView viewport** 下兩章已配置調查目標的 authored center 都在舞台內、維持可點及提示可見；HUD 不遮臉或必要互動；五地點不折行。
- 結案/未完待續首屏可安全返回標題，不意外開始新遊戲；標題首次開啟不自行捲走。
- 滑鼠可開既有遊戲選單；保持鍵盤、存檔、程序、story 與畫風。

## 2. 設計（決策已收斂）

### 2.1 結案與標題：先完成獨立小修正

`GameComplete.svelte` 兩種 storyCleared 文案保留；「重新開啟」改「返回標題畫面 / RETURN TO TITLE」，接 +page.svelte 現有 `handleReturnToTitle`（:986）。刪除唯一舊 caller 的 `handleReset`（:1258）與 resetGame import（:9）；不直接 reset、不清 manual saves，不新增確認框。沿用現有失敗 retry/discard/cancel 與 inFlight。壓縮 complete section 的 min-height/padding/gap，必要時只壓縮 complete mode 的 shell header，使 CTA 在 800×600 首屏完整可點；不動 HPA-708。

標題 scroll 的具體根因候選已定位：`MainMenu.svelte:167` 的 focusCard 由 1.5s timer（:202–212）觸發；`+page.svelte:983` 的 finishReturnToTitle 也自動 focus，兩者未 preventScroll。≤980px 時 .lyra-menu 是直欄 scroller（MainMenu :1245–1247）。**只在兩個自動 focus 路徑**使用 `focus({ preventScroll: true })`，保留使用者 Arrow/Tab 捲入焦點行為，不改標題 layout、deck、recap；初次 mount 與重新 mount 時 scroller 起點為 0，若實測仍有殘餘 scroll 才做最小初始修正，不在 discovery update 或 overlay 關閉重置捲動。QUIT 可經原捲動/鍵盤到達，不要求整張標題重排為一屏。

### 2.2 滑鼠入口：同一 GameShell menu

選定小型 `MenuTrigger.svelte`（「遊戲選單」，可附 Esc hint）重用按鈕樣式及 disabled、focus origin callback，無新 store/IPC。普通 dialogue、complete 的 GameShell header 按鈕直接進同一 openGameMenu；其他 mode 由 +page 將 `openInterrogationGameMenu` 泛化成 `requestGameMenu(trigger)`，沿用 gameMenuRequest 與 GameShell 的 openRequestedGameMenu。

- ExploreView 的調查 HUD / city-map 分支內的現有 map header（必要時向 InvestigationMapView 傳同一 callback），不另造固定浮動 overlay、不改 mapped scene nav 規則。
- InterrogationStage 工具列：提問、live testimony/dialogue 均可見（現 menuChromeVisible 只含 interrogation，新增按鈕的可見性需涵蓋 active dialogue，**不要順便擴張 LOG/Case File 工具語義**）；Present tray 保留既有 data-interrogation-game-menu 入口，不在 modal 後方另放可聚焦 trigger。
- AnalysisWorkbench 現有 board-header actions；不改 analysis card/pool layout。

GameShell header 的直接 click 與 request 路徑使用既有 opener/focus restoration；共享開 menu 的 fullscreen reassert 與 disabled/inFlight/top-layer guard，沿用 inert、Escape coordinator、IME priority。不新增鍵盤 listener；普通 trigger 在 acquisition/history/topic 等上層不可穿透（已存在 escapeClaimed 可檢查，不以 click 假造 Escape）；**保留合法 Present tray 專用入口**，不因統一 guard 讓它失效。HUD 內按鈕明確 pointer-events:auto，並排在保留的 chrome 而非場景圖上。Resume 回原 trigger；保存後既有 Present 特例和其他 gameplay focus、安全回復、Case File/Scene Select gating 不變。

### 2.3 調查：確定 contain，沿用同一座標公式

Layout Editor 顯示完整 16:9 plate；compiler 已檢查 normalized bounds（`packages/scripts/compile-scenes/layout.ts:480–505`）。Cover 的動態裁切帶無法靠作者可靠預估；**確定採 contain，不再保留 cover fallback/fit mode 選項**。代價是暗邊及較小物件：例如 800×600、100px header 時由約 889×500 變 800×450，線性縮小約 10%；150px header 則尺寸相同（縮小量隨實際 header 而變，不是全域 10% 上限）。使用現有原圖與背景，不新增美術，不改 dialogue/map/analysis/interrogation 的背景 fit。

保留 HPA-853 `bind:offsetHeight={headerHeight}` → --scene-header-height、.scene-stage inset、plane 居中。最小修改：

| 檔案 | 修改 |
| --- | --- |
| `apps/game/src/lib/investigation/target-layout.ts` | coverPlaneSize → scenePlaneSize，兩軸 Math.max → Math.min；targetViewportRect 原 signed offset 公式不變。 |
| `InvestigationSceneSurface.svelte` | --scene-cover-width/height → --scene-plane-width/height，兩處 max → min；background object-fit: contain；pending cue 引用同步改名，原 signed offset/clamp 公式不變。 |
| `investigation-layout.e2e.ts` | baked-face 投影 scale Math.max → Math.min；移除 obsolete cover crop band，保留 72-target inventory/zero-placement-loss gate 及新中心檢查。 |

不新增投影器、geometry manager 或 sidecar 格式。現有 72×44 clamp、compact-x/y/both、intentionalOverlaps、fallback/occlusion 與 focus migration 保留。**保留固定 MIN_VIEWPORT_PX = 800×450 collision basis，不依 resize 重算 compaction basis。** 其保守性前提是 800×600 的 stage ≥450px（實際 header ≤150px），且較大視窗的 stage 仍容納至少 800×450。Scene nav 單列、HUD 第一列合理配置並納入新 menu trigger；必須在既有五地點 checkpoint、HPA-853 既有 live checkpoints（各 sublocation）與長標題/目標 header fixture 驗證此下限，不能只假定五地點一定是最高 header。若不達標，先收斂既有 HUD 排列/間距使下限成立；不得裁掉資訊、放寬 gate 或引入 viewport-dependent compaction。極端 occlusion 仍使用現有 fallback（不因 contain 刪除）。Full-image geometry 只能保證 authored centre 在 stage，不能保證實際 clamp button 無遮擋或不互搶，故保留現有 live hit/overlap tests。

`SublocationNav.svelte` scene variant 單列，chips 使用原生 overflow-x:auto、可見 scroll affordance、flex-shrink:0，保留完整 accessible label、remaining count、44px 高度、disabled/active。鍵盤 focus 已會原生 scroll；只需 active chip 於 mount/必要的 active 切換 `scrollIntoView({ inline: "nearest", block: "nearest" })`，不每次進度更新搶捲動。Explore header grid 的 min-width:0 及 HUD row 納入 menu；page variant、city map 不改。

Ch1 inv9 的 contractor_desk **確定在 Layout Editor 重調** workorder、access_permission_list（原 normalized w=0.026/0.025），依實際圖面擴至各自可辨識物件區，並檢查緊鄰 material_kit_list（x=0.674，w=0.025）、clerk 與其他目標，不只把兩個矩形往右硬放大。若無合理擴大空間，保留真實獨立命中區並在 PR 列出可驗證限制；不可移離物件、合併線索或假造位置。其他 sidecar 不因舊 cover crop 搬移（如 inv8 帳本、inv9 to_confront），僅實證互搶才修。若需要重畫，另開 art ticket，不在本票產圖。維持 min(44px, 實際 compact 尺寸) 的可用跨度及 cue；針對三個相鄰目標各自真實 pointer hit。

### 2.4 人物：以 chrome 實際邊界預留空間

普通對話的 `DialogueBox.svelte:563/998` portrait 固定 bottom=0、原 height=min(1536px,80vh)，易和 header 重疊。沿用 HPA-853 pattern，GameShell 量測現有 header 高度，CSS --shell-header-height（header 不存在則 0）。以 `min(1536px, 80vh, 100vh - var(--shell-header-height))` 為起點；**同時算入實際 SceneBackdrop 的「場 / SCENE」stamp、rule/normal-flow 空間**（SceneBackdrop :76–82 刻意 z-index 25 高於 portrait 20，單用 header bottom 仍可遮頭），用既有 normal-flow wrapper 的量測/局部 CSS clearance，將 portrait top 保證低於所有實際上方 chrome。不要為每個 speaker 做 offset 表，不先縮字、不依賴 z-index/淡化。保持左右角色、alpha crop、CrossfadeImage 和 thumbnail layer。

InterrogationStage 的 .stage-left-stack / toolbar 與 SceneBackdrop stamp 也要預留 portrait 安全空間（同樣以 measured top chrome bottom 或不相交 layout row/column 佈局），InterrogationSubjectArt 的可見裁切框受此範圍限制，現有 min-height 不能反向突破上緣。保持 subject/objective、底部對話與工具可讀/可操作。驗收以 portrait 可見框與 painted chrome 的 rect separation + 代表真實截圖，不新建 head-box per-character fixture。調查 baked faces 由 contain + header/stage 分離保障，保留 HPA-853 已有 face checks，不重做新 fixtures；對黑瀨/高瀨/戶川美羽仍拍實際代表圖，避免忽略 fallback 等其他遮擋。

## 3. 驗收（單一既有 WDIO harness，由 MCP 執行/取證）

Linear 無 mockup；使用現有風格與原圖比對。MCP 執行 agent 使用既有 packaged WDIO suite，`browser.saveScreenshot` 與現有 artifact；不建立第二套 MCP UI harness、不要求人工簽收或第二個平台。沒有可執行 MCP/packaged 環境時誠實標示未驗，不能用靜態檢查代替。

- **End/title/menu 先驗收**：兩種 complete 文案/CTA 的 component tests、實際 shipped complete → title（既有 production-journey 結束狀態/既有 fixture），CTA 在首屏、手動存檔仍可 Load/Continue，失敗 recovery 不變。Fresh title 與返回 title 在 1.5s auto-focus 之後 scroll top=0、logo 可見，QUIT 可正常找到，Arrow/Tab 不退化。新 trigger 各 placement 用 component tests（普通對話、Explore 含 map、訊問提問/對話/Present、analysis、complete），GameShell 開關/focus/Escape/modal guards；**只新增一條 packaged 新入口 save→load journey**，沿用 save-management/exit-lifecycle。不逐 mode 重跑同一 opener。兩種 complete state 的 component layout/copy coverage，packaged 以實際 shipped 可達狀態做圖，不添加假終章或新 engine checkpoint。
- **全 corpus geometry**：收緊 `investigation-layout.e2e.ts` 原 :716 的 shippedPlacements sweep，使用既有 Ch2 inv4 5-chip layout checkpoint（確認有 live pending hotspot/witness template；若某 sublocation 沒有，切另一現有 sublocation），檢查所有 compiled placement 的**未擴張 authored center**位於實際 .scene-stage（用 plane rect+layout ratio 或 compact/authored rect，不把 clamp 擴張後 center 混為一談）、既有 min span 與 12px cue；保留所有 ID 報告。以新 assertion 做 focused before/after；舊 cover 在最短/最高 header 的裁切不同，若五地點 baseline 恰巧已過，不宣稱重現，保留既有短 header/較大 viewport geometry regression。Sweep 是幾何 proof（重放 style），不冒稱所有實際場景的命中測試。
- **實際命中與 header 下限**：既有 Ch2 inv4 checkpoint（全部五地點）、HPA-853 6 場景/17 sublocations live rect、HUD、zero fallback、center hit、locked/intentional overlaps 與 baked faces checks 保留，移除舊 cover band 的假設；強制 stage ≥450px @800×600，驗證長內容 fixture。原報告的 Ch2 inv4 悼念卡/車門監看螢幕，Ch1 inv8 堆疊帳本、inv9 workorder/access_permission_list/material_kit_list/to_confront，利用既有 production jump/已存在 checkpoint 或 production-journey 局部 route，直接點擊並斷言正確 target/topic/acquisition；黑瀨、高瀨、戶川美羽 head/interaction screenshot。非重疊時 authored center 真實命中；已宣告的重疊依現有合法 sequence，不能用假 target 或 OFF-SCENE 宣稱成功。無新增逐場景 Rust/TS checkpoints。至少一個較大/不同 aspect 的 scene plane 回歸。
- **Portrait/visual**：實際已存在 dialogue/testimony/神谷 hearing/三枝代表畫面檢查 portrait top/visible frame 不和 header、SCENE stamp、interrogation chrome 交疊；現有 HPA-853 baked-face gate 更新 scale。於同次 WDIO 執行保存緊湊 scene、人物、五 chip、end/title、menu 及較大 viewport 的代表截圖；MCP 讀取、比較圖面/對位、清楚度、無 HUD 蓋臉或控制項。不是全場景人工截圖矩陣。
- 相關 Vitest、check、check:e2e、lint/format、packaged gameplay 與既有 save-management/exit-lifecycle suite；PR smoke 及 ready 前手動 E2E Full 依 repo 規格。Sidecar 必跑 scenes:compile/test:scripts/check:scripts 與 live-corpus snapshot；不變更 runtime save 格式。測試執行環境與 artifact/run id 記錄在 PR。

## 4. Scope / review 決策

一個 ticket、一張 PR；先完成 end/title/menu 局部 tests，再做 contain/nav/portrait/sidecar，最後完成全部驗收，不另開 PR、不提前 merge。WDIO 是唯一 harness；MCP 是執行及證據檢查方式而非新框架。Review 的九項方向皆採納，其中固定 collision basis 必須有 stage floor、單 header clearance 不足以覆蓋 SCENE stamp、inv9 擴大不可侵犯第三相鄰目標；不採分成兩 PR 或取消 MCP 驗收。HPA-832 標籤/話題、HPA-706 analysis layout、HPA-851 font、HPA-708 chapter transition、HPA-707/912 persistence 其他需求不併入；不改故事、生成資產、save migration、原生 IPC、逐角色調位或逐場景 checkpoint。尚未執行遊戲/測試，以上為待實作合約。

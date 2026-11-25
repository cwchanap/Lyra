# HPA-852 — 預設 800×600 視窗：可操作調查舞台、人物與安全返回標題

**狀態：Draft design / 待實作（已納入第二輪 design review）**  
**日期：2026-11-24**  
**Linear：** [HPA-852](https://linear.app/cwchanap/issue/HPA-852/targets-and-faces-hidden-off-screen-or-under-the-hud-at-the-default)  
**程式基準：** [main @ 1349831b8ab56db1c025c2ea360a0bef9bc82ac8](https://github.com/cwchanap/Lyra/commit/1349831b8ab56db1c025c2ea360a0bef9bc82ac8)  
**Review：** [第一輪](https://github.com/cwchanap/Lyra/pull/141#pullrequestreview-6050179714) · [第二輪](https://github.com/cwchanap/Lyra/pull/141#pullrequestreview-6050378018)  
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

選定小型 `MenuTrigger.svelte`（「遊戲選單」，可附 Esc hint），共用樣式、disabled 與 focus-origin callback；穩定 selector `[data-game-menu-trigger]`，不新增 store/IPC。普通 dialogue/complete 使用 GameShell header；其餘模式由 +page 將 `openInterrogationGameMenu` 改名 `requestGameMenu(trigger, options?)`，沿用原 gameMenuRequest。

- ExploreView 的調查 HUD 及 map 分支的 InvestigationMapView 現有 header；不另造浮動 overlay、不改 mapped nav。**Explore 的 SHOW tray（InvestigationSceneSurface :825–834）維持 tray-only**：不加 onOpenGameMenu，先收回再開 HUD menu。
- InterrogationStage 工具列：active interrogation 與 active testimony/dialogue 都有 MenuTrigger；原 menuChromeVisible 繼續控制 LOG/Case File/locker 等既有工具，不擴張其語義。將 :442 的 `button:first-child` 改成 `button[data-interrogation-stage-log]`，不讓只有 MenuTrigger 的 dialogue 工具列誤套 LOG 樣式。Present tray 保留原 data-interrogation-game-menu；隱藏/禁止 modal 背後其他 trigger。
- AnalysisWorkbench 現有 board-header actions，不改分析板佈局。

**共用 opener 合約：** GameShell 增加小型 `tryOpenGameMenu(focusOrigin, { allowWhileEscapeClaimed = false } = {})`，header click 與 :216–222 openRequestedGameMenu 共用。先檢查 disabled（含 inFlight）、topLayerOpen、gameplayInert、open 與 origin 仍 connected/非 inert；普通 request 若 escapeClaimed() 為真則不開、不假造 Escape；既有 fullscreen reassert 後走同一 openGameMenu/focus restoration（沿用原非阻塞 reassert 方式，避免等待期間重入）。+page 與 GameShell 的 gameMenuRequest type 增 `allowWhileEscapeClaimed?: boolean`，只由 InterrogationStage 傳給既有 Present tray 的 callback wrapper 明確設 true，並在 GameShell 驗證 origin 為仍有效的 data-interrogation-game-menu；不跳過任何其他 guard。被拒絕的 request 仍 ack handled，不能延遲到 overlay 關閉後意外打開。原 Escape capture 的 topmost-close / IME / repeat 順序及 Case File request 路徑不重寫；只將 Escape 已處理層級後的開啟分支共用同一 guard/opener（Escape 無 origin 時保留原 activeElement 回焦）。保留 Present tray 與 save/Resume focus 特例；HUD 按鈕 pointer-events:auto。

**現有 focus 合約同步：** `e2e-tauri/production-anchors.ts:421–429` 的 EXPECTED_FOCUS_CONTROL_SELECTOR 透過 anchors 加入新 selector（不是泛化所有 button），保留 HPA-831 對 root/body 的精確身份判斷。重新檢查 production-journey :2807 的 bounded Tab 路徑、investigation-layout :1018–1044 的 map keyboard seed（新 menu 可能變第一個 button）；用明確原有合法起點及真實 Tab/Enter 仍到 pin，不能直接 focus 目的地取代測試。

### 2.3 調查：確定 contain，沿用同一座標公式

Layout Editor 顯示完整 16:9 plate；compiler 已檢查 normalized bounds（`packages/scripts/compile-scenes/layout.ts:480–505`）。Cover 的動態裁切帶無法靠作者可靠預估；**確定採 contain，不再保留 cover fallback/fit mode 選項**。代價是暗邊及較小物件：例如 800×600、100px header 時由約 889×500 變 800×450，線性縮小約 10%；150px header 則尺寸相同（縮小量隨實際 header 而變，不是全域 10% 上限）。使用現有原圖與背景，不新增美術，不改 dialogue/map/analysis/interrogation 的背景 fit。

保留 HPA-853 `bind:offsetHeight={headerHeight}` → --scene-header-height、.scene-stage inset、plane 居中。最小修改：

| 檔案 | 修改 |
| --- | --- |
| `apps/game/src/lib/investigation/target-layout.ts` | coverPlaneSize → scenePlaneSize，兩軸 Math.max → Math.min；targetViewportRect 原 signed offset 公式不變。 |
| `InvestigationSceneSurface.svelte` | --scene-cover-width/height → --scene-plane-width/height，兩處 max → min；background object-fit: contain；pending cue 引用同步改名，原 signed offset/clamp 公式不變。 |
| `investigation-layout.e2e.ts` | baked-face 投影 scale Math.max → Math.min；移除 obsolete cover crop band，保留 72-target inventory/zero-placement-loss gate 及新中心檢查。 |
| `persistence/thumbnail-capture.ts` / `.test.ts` | gameplayCaptureAssetLayers (:1078–1100) 讀 winner 的 computed objectFit：background 且 contain 時 full natural source + 既有 containDestinationRect (:277–294, mappedBounds)；原 cover background、portrait、opacity、layer order 及 crossfade winner 不變。 |

縮圖修正不可省略：Explore background 原本由 thumbnail-capture 固定 coverSourceRect 裁切，改 contain 後會與 SVG overlay 錯位。沿用已存在 direct-assets renderToBlob 測試 seam（thumbnail-capture.test.ts :960–1068），新增帶 header inset 的 contain case，精確驗證 source/destination、保留原 cover/portrait test；在實際 Explore save→load 取證同一畫面的縮圖對位（沿用 capture-proof / 現有保存流程，不造第二個 renderer、不改 save schema）。

不新增投影器、geometry manager 或 sidecar 格式。現有 72×44 clamp、compact-x/y/both、intentionalOverlaps、fallback/occlusion 與 focus migration 保留。**固定 MIN_VIEWPORT_PX = 800×450 collision basis，不依 resize 重算。** 前提為 800×600 的 stage ≥450px（實際 header ≤150px），較大視窗同樣容納至少 800×450 plane。現有 main nav bottom 約129px + 12px padding ≈141px（review 的估算，非本輪實測），新增 menu 或普通 scrollbar 都可能突破 150px。

**預算明確鎖定（800×600，以下是 CSS 設計目標，最後以實際 DOM 為準）：**

| HUD 部分 | 預算/做法 |
| --- | --- |
| .scene-hud | 上下 padding 各8px、row gap 6px；row 1 ≤74px、row 2 ≤54px，合計 ≤150px。 |
| Row 1 | 保留地點標題欄（約120px 起，允許正常中文換行）；取消 .hud-side 600px cap，grid 欄可收縮（min-width:0）、hud-side flex-wrap:nowrap；Progress/MenuTrigger flex:none，PrimaryObjectiveHud flex shrink + min-width:0，padding 6px 10px，必要時在 compact mode 收緊行距而非省略文字。 |
| Row 2 | 44px chips + nav 上下2px padding、border 2px、最多4px scrollbar；單列不折行，最長地點亦可完整讀/捲動。 |

目標不是用 max-height 裁資訊：用實際長標題/目標 fixture、既有五地點 checkpoint 與 HPA-853 live sublocations 驗證 row budget / stage floor；若長內容突破預算，僅收斂既有 spacing/欄配置，保留全文、控制可達，未通過則不得宣稱固定 basis 合法。不增加 viewport-dependent compaction。極端 occlusion 仍用既有 fallback。Full-image geometry 只保證 authored centre 在 stage，仍保留 live hit/overlap tests。

`SublocationNav.svelte` scene variant 的 nav/chips 不折行、chips 原生 overflow-x:auto、min-width:0、按鈕 flex-shrink:0；採 ≤4px scrollbar（WebKit pseudo-element + 支援的 scrollbar-width；若系統不能縮薄則隱藏並顯示 overflow 指示），以右/左緣 overflow fade/chevron 提示並維持滑鼠可操作的原生捲動（若隱藏 scrollbar，提供可點的溢出方向控制，不能只有裝飾）。保留 accessible label/count/44px/disabled/active；active chip mount/必要切換 scrollIntoView({ inline:"nearest", block:"nearest" })，鍵盤 focus 原生捲動，不搶玩家 scroll。將 HPA-853 原 chipTops 單列 assertion（:1354–1361）也套至 scene 4 五 chip，測尾端 pointer/keyboard 到達。page variant、city map 不改。

Ch1 inv9 的 contractor_desk **確定在 Layout Editor 重調** workorder、access_permission_list（原 normalized w=0.026/0.025），依實際圖面擴至各自可辨識物件區，並檢查緊鄰 material_kit_list（x=0.674，w=0.025）、clerk 與其他目標，不只把兩個矩形往右硬放大。若無合理擴大空間，保留真實獨立命中區並在 PR 列出可驗證限制；不可移離物件、合併線索或假造位置。其他 sidecar 不因舊 cover crop 搬移（如 inv8 帳本、inv9 to_confront），僅實證互搶才修。若需要重畫，另開 art ticket，不在本票產圖。維持 min(44px, 實際 compact 尺寸) 的可用跨度及 cue；針對三個相鄰目標各自真實 pointer hit。

### 2.4 人物：確定 compact dialogue chrome + interrogation 雙欄

普通對話若只把原 portrait 縮到原 header/stamp 以下，review 估計 top chrome 約305–325px、底部對話區約188px，僅剩 ~90–110px 可見人物，不能接受。先保留可讀資訊並壓縮空間，再依實測 clearance 限制畫面；不以逐角色 offset 或淡化解決。

**普通 dialogue（短視窗 max-height:700px）：** GameShell header 改緊湊兩列：第一列 FILE marker、章名、menu（不截章名）；第二列 summary + primary objective 雙欄。padding 約8–10px、gap 6px、title row 由直排改橫排；保留完整文字、必要時欄內正常換行，目標 header 120–135px。SceneBackdrop vertical padding 18px→約6px，stamp 保留樣式與可讀全文，目標 backdrop 40–55px；合計 top chrome 175–190px 左右。明確的量測 owner：GameShell 綁 header offsetHeight，含緊接的 1px rule，將 --shell-header-height 發布在 shell（header 不存在=0）；+page 只在 ordinary dialogue 分支以 normal-flow wrapper 包住 SceneBackdrop 並 bind:offsetHeight，將實際 backdropHeight 傳給 DialogueBox prop；wrapper 清理/切 mode 時重置，無 stamp 時按實際 wrapper 高度，不能沿用上一畫面。保持原 background 的 fixed layer 與 data-save-thumbnail-layout。DialogueBox 以這兩個高度合成 --top-chrome-height（如 CSS calc），inline --portrait-height 改 `min(1536px, 80vh, max(0px, calc(100vh - var(--top-chrome-height))))`；原 bottom:0 與左右朝向不變。更新 DialogueBox.test.ts :365–367、:415–417 的 literal assertion。以 actual stamp/portrait rect 檢查旋轉 stamp 不超出 clearance，避免只測 header。800×600 目標可見 portrait 高度約210–240px（一般 160px dialogue box，review 估算），代表對話至少約200px、臉完整且文字不遮；長內容按實際高度驗證，不能靠硬裁資訊或圖像來滿足。若預算不達標，只微調此 compact chrome，不開另一套 layout framework。

**InterrogationStage：選定兩欄，不採整個 stack 垂直堆在人物上方。** 在 stage-chrome 的同一 grid 左/右 inset 26px、top 24px、gap 12px；左欄 width ≤min(360px,46vw)，右欄 minmax(0,1fr)（800px 時約376px）。左欄以正常 flow 排 SCENE stamp → objective → subject/progress（緊湊 gap/padding）；右欄 toolbar 屬於右欄且不和左欄相疊，緊湊 gap/padding 使四項工具在 800px 正常同列，長字確有需要在右欄內換行。把 SceneBackdrop 的 stamp markup/style 小幅抽成可共用 SceneStamp（保留 capture layer 標記），ordinary backdrop 照舊用，interrogation 用 sceneTag=null 的原背景 layer + 在左欄 render 其 stamp；**背景必須留在既有 z-index 位置**，不能把 fixed background 整個搬進 stage-chrome 的高層 stacking context 反而蓋住 portrait。

InterrogationStage owner 量測右欄 toolbar height（無 toolbar=0，offsetHeight 或現有 DOM size seam），InterrogationSubjectArt 由左移至右欄，frame top=24px + toolbar height + 8px、bottom=0、width 右欄可用寬（不得跨入左欄）。現有 alpha crop/asset ratio 用來約束可見 raster 的 width/height 於 frame，從 frame 上緣向下放，無裁掉頭、無 min-height 撐破 frame、無改 portrait asset，保留 thumbnail/crossfade layer。這是「右欄人物在 toolbar 下、下半身可在底部對話框後」的固定方案；不是讓左 stack 垂直壓縮人物。典型 toolbar ~38px + top24 + gap8 → frame top 約70px，testimony rail/box top 約334px，預期有約260px 可用頭肩區；question panel 現有 max-height calc(100% - 250px)、bottom28（top 最低約222px），約150px 可見區。檢查普通 question screen / testimony / 長內容，若 question panel 真正遮住頭，以既有可捲動 max-height seam 保留頭肩空間（不可藏問題或改 proof）；一般 testimony 代表畫面可見高度約200px 以上、question 約150px、頭臉必須完整可辨。以實測 rect（含 toolbar/left stack/stamp/實際可見 crop frame/底部 box）與截圖驗證，而不是用估算宣稱通過。不新增 face detection/per-speaker fixtures。保留 LOG/history、Present/modal、HPA-831/HPA-711 行為及現有 HPA-853 baked face gate；調查黑瀨/高瀨/戶川美羽仍用代表截圖。

## 3. 驗收（單一既有 WDIO CLI harness）

Linear 無 mockup；使用現有風格與原圖比對。以既有 packaged WDIO CLI scripts 執行驗收，`browser.saveScreenshot` 的 PNG 與現有 run artifacts 供 agent 直接檢查。MCP 是使用者要求的 agent 執行/取證方式（經可用 terminal/browser/file 工具啟動 CLI、讀取 PNG），不是 WDIO server、另一套操作 harness 或額外的獨立 gate；不因沒有專用 WDIO MCP server 判為 blocker。只有真實 packaged 測試/證據無法取得才記未驗，不以靜態檢查代替；無人工簽收、單一支援平台。

- **End/title/menu 先驗收**：兩種 complete 文案/CTA 的 component tests、實際 shipped complete → title（既有 production-journey 結束狀態/既有 fixture），CTA 在首屏、手動存檔仍可 Load/Continue，失敗 recovery 不變。Fresh title 與返回 title 在 1.5s auto-focus 之後 scroll top=0、logo 可見，QUIT 可正常找到，Arrow/Tab 不退化。新 trigger 各 placement 用 component tests（普通對話、Explore 含 map、訊問提問/對話/Present、analysis、complete），GameShell 開關/focus/Escape/modal guards；**只新增一條 packaged 新入口 save→load journey**（選 Explore，並在 contain 完成後重驗其縮圖對位），沿用 save-management/exit-lifecycle。不逐 mode 重跑同一 opener。兩種 complete state 的 component layout/copy coverage，packaged 以實際 shipped 可達狀態做圖，不添加假終章或新 engine checkpoint。
- **全 corpus geometry**：收緊 `investigation-layout.e2e.ts` 原 :716 的 shippedPlacements sweep，使用既有 Ch2 inv4 5-chip layout checkpoint（確認有 live pending hotspot/witness template；若某 sublocation 沒有，切另一現有 sublocation），檢查所有 compiled placement 的**未擴張 authored center**位於實際 .scene-stage（用 plane rect+layout ratio 或 compact/authored rect，不把 clamp 擴張後 center 混為一談）、既有 min span 與 12px cue；保留所有 ID 報告。以新 assertion 做 focused before/after；舊 cover 在最短/最高 header 的裁切不同，若五地點 baseline 恰巧已過，不宣稱重現，保留既有短 header/較大 viewport geometry regression。Sweep 是幾何 proof（重放 style），不冒稱所有實際場景的命中測試。
- **實際命中與 header 下限**：既有 Ch2 inv4 checkpoint（全部五地點）、HPA-853 6 場景/17 sublocations live rect、HUD、zero fallback、center hit、locked/intentional overlaps 與 baked faces checks 保留，移除舊 cover band 的假設；強制 stage ≥450px @800×600，驗證長內容 fixture、新 menu 及五 chip single-row（chipTops）、overflow 可操作。原報告的 Ch2 inv4 悼念卡/車門監看螢幕，Ch1 inv8 堆疊帳本、inv9 workorder/access_permission_list/material_kit_list/to_confront，利用既有 production jump/已存在 checkpoint 或 production-journey 局部 route，直接點擊並斷言正確 target/topic/acquisition；黑瀨、高瀨、戶川美羽 head/interaction screenshot。非重疊時 authored center 真實命中；已宣告的重疊依現有合法 sequence，不能用假 target 或 OFF-SCENE 宣稱成功。無新增逐場景 Rust/TS checkpoints。至少一個較大/不同 aspect 的 scene plane 回歸。
- **Portrait/visual**：實際已存在 dialogue/testimony/神谷 hearing/三枝代表畫面檢查 compact top chrome budget、portrait top/visible frame、不與 header、SCENE stamp、interrogation 左欄/右 toolbar 交疊、底部對話/問題區上方保有足夠頭肩且臉完整；現有 HPA-853 baked-face gate 更新 scale。於同次 WDIO 執行保存緊湊 scene、人物、五 chip、end/title、menu 及較大 viewport 的代表截圖；agent 直接讀取 PNG，比較圖面/對位、清楚度、無 HUD 蓋臉或控制項。不是全場景人工截圖矩陣。
- 相關 Vitest（含 thumbnail-capture.test.ts 的 cover/contain 及 focus/guards）、check、check:e2e、lint/format、packaged gameplay 與既有 save-management/exit-lifecycle/capture-proof suite；PR smoke 及 ready 前手動 E2E Full 依 repo 規格。Sidecar 必跑 scenes:compile/test:scripts/check:scripts 與 live-corpus snapshot；不變更 runtime save 格式。測試執行環境與 artifact/run id 記錄在 PR。

## 4. Scope / review 決策

一個 ticket、一張 PR；先完成 end/title/menu 局部 tests，再做 contain/nav/portrait/sidecar，最後完成全部驗收，不另開 PR、不提前 merge。WDIO CLI 是唯一 harness；保留使用者的 MCP 執行/取證要求，不需要專用 server。第一輪的 contain/固定 basis/單 PR/既有 sweep 保留；第二輪採納 compact chrome、雙欄、縮圖 contain 分支、150px 預算、精確 menu wiring；不採分成兩 PR 或取消 MCP 驗收。HPA-832 標籤/話題、HPA-706 analysis layout、HPA-851 font、HPA-708 chapter transition、HPA-707/912 persistence 其他需求不併入；不改故事、生成資產、save migration、原生 IPC、逐角色調位或逐場景 checkpoint。尚未執行遊戲/測試，以上為待實作合約。

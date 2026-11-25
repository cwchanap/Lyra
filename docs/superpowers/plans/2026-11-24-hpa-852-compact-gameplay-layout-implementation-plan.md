# HPA-852 — 800×600 Gameplay UI 實作計劃

**狀態：Draft / 尚未實作（第一輪 review 修訂）**  
**基準：** main @ `1349831b8ab56db1c025c2ea360a0bef9bc82ac8`  
**設計：** [HPA-852 design](../specs/2026-11-24-hpa-852-compact-gameplay-layout-design.md)  
**Linear：** [HPA-852](https://linear.app/cwchanap/issue/HPA-852/targets-and-faces-hidden-off-screen-or-under-the-hud-at-the-default)  
**Review：** [第一輪設計審閱](https://github.com/cwchanap/Lyra/pull/141#pullrequestreview-6050179714)

一個 ticket → **同一個 Draft PR #141**。先做便宜且獨立的 end/title/menu，再處理 geometry；每一段先通過自己的 checks，最後所有驗收通過才 ready。以下不是多個 PR。Contain 已定案，不先全面重跑兩章來選方案。

## Task 1 — End-card CTA / Title scroll（先完成）

Files: `GameComplete.svelte` / `GameComplete.test.ts`、`MainMenu.svelte` / `MainMenu.test.ts`、`GameShell.svelte`、`apps/game/src/routes/+page.svelte` 及既有 route/persistence tests。

- [ ] 兩種 storyCleared 的 component tests 固定 stamp、文案與 CTA。改「返回標題畫面 / RETURN TO TITLE」、onReturnToTitle callback，+page 接既有 handleReturnToTitle；確認唯一舊 caller 移除後刪 handleReset 與 resetGame import。保留既有 persistence recovery、inFlight，不清手動存檔、不直接 new game。
- [ ] 壓縮 GameComplete min-height/padding/gap，若必要只縮 complete mode 的 shell header，使首屏 CTA 完整可點。無新 end-state、無 HPA-708 變更。
- [ ] MainMenu 的 focusCard(:167) 由 1.5s timer(:202–212) 呼叫時使用 preventScroll；+page finishReturnToTitle(:983) 自動 focus 同樣加 preventScroll。保留 keyboard 主動 navigation 的原生 scroll；驗證 .lyra-menu 首次 mount/return 於 top，不重新設計 title layout 或 reset 玩家已選 scroll。
- [ ] Component tests（包含 timer、Continue 有/無、overlay focus），重用 save-exit/save-management、既有 shipped production-journey 終點驗證 complete → title。兩種 end-state component tests；packaged 不造假終章或新增 engine checkpoint。以同次 WDIO 800×600 title/CTA 截圖與 scroll rect 證明；實際尚未測者記錄在 Task 5 最終 gate。

## Task 2 — 同一 GameShell menu 的滑鼠入口

Files: `GameShell.svelte`、新增小型 `MenuTrigger.svelte`、`+page.svelte`、`ExploreView.svelte`（含 map header）、`InterrogationStage.svelte`、`analysis/AnalysisWorkbench.svelte` 及相關 tests。

- [ ] MenuTrigger 共用文字「遊戲選單」與 disabled/focus-origin callback，放入現有 chrome。普通 dialogue/complete header 直接使用 GameShell opener；+page 將 openInterrogationGameMenu 改名 requestGameMenu，使用既有 gameMenuRequest/openRequestedGameMenu。Explore 的 investigation HUD 與 map 分支使用同一 callback（向 InvestigationMapView 現有 header 傳遞）；不新增 floating overlay，HUD button pointer-events:auto。Analysis 放 board-header actions，不改分析板佈局。
- [ ] 訊問 mode 的工具列加 menu；active testimony/dialogue 也有入口，即使 menuChromeVisible 目前只含 interrogation。不要連帶擴張 LOG/Case File。Present tray 保留原 data-interrogation-game-menu（其合法入口不得被普通 overlay guard 擋掉）；modal 背後不得有另一個可聚焦 menu trigger。
- [ ] 既有 GameShell openGameMenu/closeGameMenu/focus restoration：共用 opener guard 與 fullscreen reassert；尊重 inFlight/topLayerOpen/inert/普通 escapeClaimed（不以 click 代替 Escape），保留 Present path、IME 與一個 Escape 關一層。無新 store/IPC/listener。保留 save success 的 Present focus special case、load、Case File/Scene Select gating。
- [ ] 各 placement 用 component tests，GameShell test opener/Resume/focus/guards；**一條** packaged 新 trigger → Save → Load → 原 scene/inventory/mode；沿用 save-management / exit-lifecycle suite，避免 8 個 mode 重複同一 packaged opener。記錄 menu 截圖。Task 1–2 的 Vitest/check 與相關 persistence tests 先執行，不等 geometry。

## Task 3 — Contain 與 compact nav（保留固定 compaction）

Files: `target-layout.ts` / `target-layout.test.ts`、`InvestigationSceneSurface.svelte` / tests、`ExploreView.svelte` / tests、`SublocationNav.svelte` / tests、`investigation-layout.e2e.ts`。

- [ ] 寫 focused geometry regression：修改既有 shippedPlacements sweep（原 :716），在真實 plane rect 以 compiled layout 算**未擴張 authored center**（不使用 clamp button centre）、stage inside、44px span、12px cue。使用已存在 Ch2 inv4 五地點 checkpoint，有 pending hotspot/witness 的既有 sublocation 作 template。先在舊 cover 執行 focused regression / screenshot；若當前最大 header 剛好已滿足中心 gate，不謊稱失敗，可用既有短 header/較大 aspect fixture 顯示 cover 裁切差異。不要求先跑全 corpus live journey 才寫 code。
- [ ] `coverPlaneSize` → `scenePlaneSize`，max → min；既有 targetViewportRect signed offsets 不變。Surface 的 --scene-cover-width/height → --scene-plane-width/height、max → min、background object-fit:contain；pending cue 只同步變數名稱，保留公式。既有 headerHeight、stage inset、中心 transform、alpha crop、thumbnail layer 不變。不留 fit mode、不建新投影器。
- [ ] 改 target-layout.test.ts（tall 800×720、wide 1920×800、minimum stage、原 offscreen edge ledger/CCTV 變 on-art）；既有 Surface.test.ts :158 等 CSS contract 與 :1218 crop-to-fallback 測試應改為 contain-on-art。保留真正 fallback-panel occlusion、focus transfer、visibleSpans、locked/overlap assertions；修正依舊投影假設的 occlusion fixture 座標，不能直接刪掉 regression。所有 callers/stale comments 一起更新。
- [ ] SublocationNav scene variant chips 單列 overflow-x:auto、flex-shrink:0、可見 overflow affordance；保留 44px 高度、full labels、counts、active/disabled。active chip mount/必要的切換 scrollIntoView({inline:"nearest",block:"nearest"})；鍵盤 focus 用原生 scroll。Explore HUD grid min-width 與第一列（含 menu）收斂；不改 city map/page variant。
- [ ] **固定 MIN_VIEWPORT_PX=800×450 不變，computeCompactClasses 不新增 viewport dependency。** 保守性以前置 stage height ≥450px @800×600 為必要條件（header ≤150px）。用既有五地點 checkpoint 及六個 HPA-853 live checkpoints 的各 sublocation、長 title/objective header fixture 驗證；不能只假定五地點必然是最高 header。若失敗，最小調整既有 HUD 排列/間距，資訊不得隱藏，保持 44px control；較大 viewport 不縮破此下限。若不能滿足，回報設計 blocker，不自行換成動態 compaction 或放寬 gate。
- [ ] 更新 HPA-853 的 baked face scale Math.max→Math.min（原 :1389）；其 72-target/17-sublocation/zero-placement-loss inventory gate 保留，只移除 obsolete cover crop-band 規則，中心由既有 sweep 驗證。Live `expectHpa853SublocationSurface` 的 HUD/target hit/locked/intentional overlap regressions 繼續保留，offstage authored center 不可 silent skip。五 chip 真實 pointer/keyboard scroll 到最後一個並切換；各 live header ≥450px floor（stage，非整個 viewport）以及較大 aspect 另驗一次。
- [ ] 截圖比對 800×600 與較大 viewport 的原圖完整性/暗邊/座標；100px header 例線性縮小約 10%，不要為填滿窗口回退 cover。

## Task 4 — Face-safe portrait 與 inv9 sidecar（局部修正）

Files: `GameShell.svelte`、`DialogueBox.svelte`、`SceneBackdrop.svelte`、`InterrogationStage.svelte`、`InterrogationSubjectArt.svelte` 及現有 tests；`docs/stories_plan/chapter_1/investigation_scene_9.layout.json`。

- [ ] 普通對話採 GameShell 既有 header 的 bind:offsetHeight → --shell-header-height（無 header=0），portrait capped by viewport minus top chrome。**SceneBackdrop 的 SCENE stamp 在 main 內且 z-index 25>portrait 20**；故應把實際 backdrop/stamp 與 normal-flow rule 的 clearance 計入，而非只驗 header bottom。使用局部量測 normal-flow wrapper / CSS rule，portrait top ≥ 實際 chrome bottom（包含 stamp），原左右角色、畫風、CrossfadeImage/thumbnail 保留。測兩側、長標題、header 不存在等，不做逐 speaker offsets。
- [ ] InterrogationStage 同樣預留 stack/toolbar/stamp 與 portrait 的不相交區，InterrogationSubjectArt alpha-crop 可見框受限，現有 min-height 不得覆蓋上方 chrome。優先共同空間分配，非逐角色 head-box、改透明度或縮字。以 measured rect separation 及代表三宅、神谷、三枝畫面驗證；保留 HPA-831 evidence/focus 與 HPA-711 inner voice / presentation gating。
- [ ] **必做** Ch1 inv9 contractor_desk 的 workorder/access_permission_list 編輯：在 Layout Editor 對照現有原圖，擴至各自實際可辨識範圍；第三個鄰接 material_kit_list 也需檢查與必要的同批校正。三者均可獨立點、無新增未聲明 overlap、不把 clamp 強行放大、不移離物件。若原圖不足，記錄最大可用範圍；任何需新圖的工作獨立 art ticket、不得用假位置通過。
- [ ] Ch1 inv8 ledger 與 inv9 to_confront 因 contain 解 crop，預設不改其 sidecar；只有真實 hit regression 才局部修。必跑 scenes:compile、test:scripts、check:scripts、live-corpus snapshots，只允許預期 layout/contentRevision diff，無 save migration。
- [ ] Real pointer 針對 Ch1 inv8 帳本、inv9 三份鄰接文件及前往質問北見、Ch2 inv4 悼念卡/監看螢幕；使用現有 production jump/helper、已存在 checkpoint 或既有 journey 局部 route，正確 evidence/topic/acquisition 推進。黑瀨、高瀨、戶川美羽看實際 screenshot；HPA-853 原 baked face checks 維持，不新增 head-box fixtures。無新增逐場景 checkpoint/Rust production change。

## Task 5 — 單一 WDIO acceptance harness / MCP 執行驗收

- [ ] 以 MCP 執行既有 packaged WDIO 環境並讀取同次 `browser.saveScreenshot` artifacts（例如隔離 Linux Xvfb；不另建 MCP 操作 harness/新平台 runner）。確認實際 innerWidth=800/innerHeight=600、commit/run id。保留 repo 既有 trusted keys policy；無 trusted input 時不把 synthetic keys 宣稱真實 OS keyboard proof。
- [ ] Task 1–2：兩種 complete component coverage + 實際 shipped complete CTA → title，fresh/return title 在 autofocus 後 top=0、logo 可見、QUIT 可經原有 navigation 找到。Persistence recovery、手動 save/Continue 不退化。各 trigger component tests、GameShell focus/guard tests、一次 packaged save→load。已有 save/exit suite，不做逐 mode 完整 E2E。
- [ ] Task 3–4：既有 `investigation-layout.e2e.ts` 全 shipped placements style sweep（中心/跨度/cue）、五地點與 HPA-853 六個 live checkpoints（stage floor/HUD/actual hit/locked & overlap/72-target/face checks），named complaint target real pointer、portrait frame separation、較大 aspect regression。Sweep 只證明 geometry，不宣稱全場景 live clicks；named targets 與 existing live regression 補足。
- [ ] **視覺驗收**：Linear 無 mockup，MCP 直接讀 WDIO 同次 before/after 代表 screenshots：Ch2 inv4 五 chip/直播牆/轉播車、Ch1 inv7/8/9（含三份相鄰文件）、三宅/神谷/三枝代表 dialogue/hearing、end/title、menu、一張較大 viewport。對照原圖及現有 UI，確認原圖與 hit/cue 一致、臉清楚、控制可達；無全章逐圖矩陣或人工簽收。若現有 fixture 不直接到某畫面，用既有 game navigation/journey，不擴充逐場景 checkpoints；有實際未驗項就記錄，不能用 mock/靜態 DOM 宣稱成功。
- [ ] 相關 Vitest、`bun run check`、`bun run --cwd apps/game check:e2e`、lint/format、scenes:compile/test:scripts/check:scripts、packaged gameplay suite；save-management/exit-lifecycle 用既有 scripts（同一 e2e binary）。例如 `xvfb-run -a bun run --cwd apps/game test:e2e:gameplay`；PR smoke / ready 前手動 E2E Full 遵照 AGENTS.md，不額外引入 CI suite。MCP/packaged 無法執行則誠實記為 blocker。
- [ ] PR #141 逐項記錄結果、artifact 路徑、baseline 已解決/本次新增修正/未驗事項；單一 PR 全部 gates 完成才 ready。不做第二平台 native acceptance。

## Self-review（第一輪）

- Review 1–3：contain 確定，四處 fit token/變數改名，保留原 signed offsets 及固定 collision basis；實際 stage floor 必須成立。修正舊 cover-specific test fixtures，保留 genuine occlusion。
- Review 4–5：使用現有 sweep/fixtures，不建立全章 checkpoint；分清全 corpus authored geometry 與實際 named hits。以 measured chrome clearance 規則取代逐人物 head boxes，普通對話額外算 SCENE stamp。
- Review 6–7：只修兩個自動 focus；MenuTrigger 選定，per-mode component tests + 一條 packaged persistence journey；仍保留 Present 與 modal guards。
- Review 8–9：獨立小修先做，同一 PR 不拆分；WDIO 是唯一 acceptance harness，由 MCP 執行/檢查截圖。inv9 相鄰三個物件須一併檢查，兩個小框必做校正且不可造假擴大。
- 規劃階段未跑 packaged app 或 tests；review 的縮減不等同修復已完成。Scope 不含 HPA-706/832/851/708/707/912、story、art/SFX、save schema 或 native feature。

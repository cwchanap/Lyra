# HPA-852 — 800×600 Gameplay UI 實作計劃

**狀態：Draft / 尚未實作（第二輪 review 修訂）**  
**基準：** main @ `1349831b8ab56db1c025c2ea360a0bef9bc82ac8`  
**設計：** [HPA-852 design](../specs/2026-11-24-hpa-852-compact-gameplay-layout-design.md)  
**Linear：** [HPA-852](https://linear.app/cwchanap/issue/HPA-852/targets-and-faces-hidden-off-screen-or-under-the-hud-at-the-default)  
**Review：** [第一輪](https://github.com/cwchanap/Lyra/pull/141#pullrequestreview-6050179714) · [第二輪](https://github.com/cwchanap/Lyra/pull/141#pullrequestreview-6050378018)

一個 ticket → **同一個 Draft PR #141**。先做便宜且獨立的 end/title/menu，再處理 geometry；每一段先通過自己的 checks，最後所有驗收通過才 ready。以下不是多個 PR。Contain 已定案，不先全面重跑兩章來選方案。

## Task 1 — End-card CTA / Title scroll（先完成）

Files: `GameComplete.svelte` / `GameComplete.test.ts`、`MainMenu.svelte` / `MainMenu.test.ts`、`GameShell.svelte`、`apps/game/src/routes/+page.svelte` 及既有 route/persistence tests。

- [ ] 兩種 storyCleared 的 component tests 固定 stamp、文案與 CTA。改「返回標題畫面 / RETURN TO TITLE」、onReturnToTitle callback，+page 接既有 handleReturnToTitle；確認唯一舊 caller 移除後刪 handleReset 與 resetGame import。保留既有 persistence recovery、inFlight，不清手動存檔、不直接 new game。
- [ ] 壓縮 GameComplete min-height/padding/gap，若必要只縮 complete mode 的 shell header，使首屏 CTA 完整可點。無新 end-state、無 HPA-708 變更。
- [ ] MainMenu 的 focusCard(:167) 由 1.5s timer(:202–212) 呼叫時使用 preventScroll；+page finishReturnToTitle(:983) 自動 focus 同樣加 preventScroll。保留 keyboard 主動 navigation 的原生 scroll；驗證 .lyra-menu 首次 mount/return 於 top，不重新設計 title layout 或 reset 玩家已選 scroll。
- [ ] Component tests（包含 timer、Continue 有/無、overlay focus），重用 save-exit/save-management、既有 shipped production-journey 終點驗證 complete → title。兩種 end-state component tests；packaged 不造假終章或新增 engine checkpoint。以同次 WDIO 800×600 title/CTA 截圖與 scroll rect 證明；實際尚未測者記錄在 Task 5 最終 gate。

## Task 2 — 同一 GameShell menu 的滑鼠入口

Files: `GameShell.svelte`、新增小型 `MenuTrigger.svelte`、`+page.svelte`、`ExploreView.svelte`、`InvestigationMapView.svelte`、`InterrogationStage.svelte`、`analysis/AnalysisWorkbench.svelte`、`e2e-tauri/production-anchors.ts` / 既有 focus/map tests。

- [ ] MenuTrigger 共用文字「遊戲選單」、穩定 `[data-game-menu-trigger]`、disabled/focus-origin callback。普通 dialogue/complete header 直接走 GameShell tryOpenGameMenu；+page 將 openInterrogationGameMenu 改名 requestGameMenu，使用既有 gameMenuRequest/openRequestedGameMenu。Explore HUD/map header 使用同一 callback，Analysis 放 board-header actions；不造 overlay，HUD button pointer-events:auto。Explore SHOW tray（InvestigationSceneSurface :825–834）維持 tray-only，不傳 onOpenGameMenu。Explore HUD 須同批套用 Task 3 的 150px 預算，不能先讓 menu 破壞固定 collision invariant。
- [ ] InterrogationStage active interrogation 及 active testimony/dialogue 均有 menu；保留 menuChromeVisible 對既有 LOG/Case File/locker 的 gating。:442 的 button:first-child 改 button[data-interrogation-stage-log]，避免 dialogue 僅剩新 trigger 時套錯樣式。Present tray 保留原 data-interrogation-game-menu，modal 背後 trigger 不可聚焦。
- [ ] 新增 GameShell tryOpenGameMenu(focusOrigin, {allowWhileEscapeClaimed=false}={})，header click / openRequestedGameMenu / Escape 已處理 topmost claim 後的開啟分支共用：拒絕 disabled、topLayerOpen、gameplayInert、open 及失效/inert origin（Escape 無 explicit origin 保留原焦點）；ordinary escapeClaimed() 拒絕而非消費 Escape。沿用原非阻塞 fullscreen reassert 再 openGameMenu（保持同步 open guard），沿用 close/focus restore。+page 與 GameShell 的 request type 加 allowWhileEscapeClaimed?: boolean，只有 InterrogationStage 給現有 Present tray 的 wrapper 設 true；核對 origin 是仍有效的 data-interrogation-game-menu，僅 bypass escapeClaimed，其他 guard 一律保留。拒絕的 request 仍 ack，不能在 overlay 結束後延遲打開。保留原 Escape capture / IME / repeat / one-layer-close、Case File request、save success Present focus special case；無新 listener/store/IPC。
- [ ] 同步 HPA-831 focus-owner contract：production-anchors.ts :421–429 從 anchors 加入新 selector，不能放寬成任何 button。檢查 production-journey :2807 bounded 6-Tab loop（按新增的實際 tab order 修正必要上限/合法起點）；investigation-layout :1018–1044 map test 明確從原有合法非目的地起點 Tab 到 pin，再 Enter。不得直接 focus 目的地或跳過 focus-owner assertion。
- [ ] Component tests 覆蓋各 placement、active dialogue 的 LOG styling/gating、普通 request blocked、已開/inert/失效 origin、拒絕後 ack、Present bypass 合法且其他 guard 仍生效、Resume focus、Escape/IME；原 SHOW tray 無新 menu。**一條** packaged 新入口（Explore）→ Save → Load → 原 scene/inventory/mode；沿用 save-management/exit-lifecycle，Task 3 contain 後重跑同一 journey 核對縮圖（不是第二個 journey）。記錄 menu 截圖；Task 1–2 的局部 Vitest/check 與 persistence checks 先做，不等全 geometry。

## Task 3 — Contain 與 compact nav（保留固定 compaction）

Files: `target-layout.ts` / `target-layout.test.ts`、`InvestigationSceneSurface.svelte` / tests、`ExploreView.svelte` / tests、`SublocationNav.svelte` / tests、`investigation-layout.e2e.ts`、`apps/game/src/lib/persistence/thumbnail-capture.ts` / `thumbnail-capture.test.ts`、既有 capture-proof suite。

- [ ] 寫 focused geometry regression：修改既有 shippedPlacements sweep（原 :716），在真實 plane rect 以 compiled layout 算**未擴張 authored center**（不使用 clamp button centre）、stage inside、44px span、12px cue。使用已存在 Ch2 inv4 五地點 checkpoint，有 pending hotspot/witness 的既有 sublocation 作 template。先在舊 cover 執行 focused regression / screenshot；若當前最大 header 剛好已滿足中心 gate，不謊稱失敗，可用既有短 header/較大 aspect fixture 顯示 cover 裁切差異。不要求先跑全 corpus live journey 才寫 code。
- [ ] `coverPlaneSize` → `scenePlaneSize`，max → min；既有 targetViewportRect signed offsets 不變。Surface 的 --scene-cover-width/height → --scene-plane-width/height、max → min、background object-fit:contain；pending cue 只同步變數名稱，保留公式。既有 headerHeight、stage inset、中心 transform、alpha crop、thumbnail role/layer 標記不變。不留 fit mode、不建新投影器。
- [ ] thumbnail-capture.ts gameplayCaptureAssetLayers (:1078–1100) 取 winner 的 computed style 一次，僅 background && objectFit==='contain' 時改為完整 natural source 並復用 containDestinationRect (:277–294) 對 mappedBounds 居中；cover background 原 coverSourceRect、portrait、opacity、layer order、crossfade winner 不變。既有 thumbnail-capture.test.ts :960–1068 direct-assets renderToBlob seam 加含 stage header inset 的 contain case，assert 精確 source/destination/offset；保留原 cover/portrait case。重跑 Task 2 Explore save→load 與既有 capture-proof，對比實際畫面與保存縮圖的原圖及 cue/overlay，不能只驗 PNG 存在。
- [ ] 改 target-layout.test.ts（tall 800×720、wide 1920×800、minimum stage、原 offscreen edge ledger/CCTV 變 on-art）；既有 Surface.test.ts :158 等 CSS contract 與 :1218 crop-to-fallback 測試應改為 contain-on-art。保留真正 fallback-panel occlusion、focus transfer、visibleSpans、locked/overlap assertions；修正依舊投影假設的 occlusion fixture 座標，不能直接刪掉 regression。所有 callers/stale comments 一起更新。
- [ ] 實作設計 §2.3 的 **150px header budget**（menu 放入 HUD 時同批做）：scene-hud 上下8px padding/gap6px，row1 ≤74px，row2 ≤54px；scene nav 上下2px、border 2px、44px chips、≤4px scrollbar。取消 hud-side 600px cap，nowrap/min-width:0；地點欄約120px起可換行，Progress/MenuTrigger flex:none，PrimaryObjectiveHud shrink/min-width:0、padding 6px 10px，必要時 compact 行距；不省略全文。實測長內容，不用 max-height 截文字。
- [ ] SublocationNav scene variant nav/chips 單列 nowrap、chips min-width:0/overflow-x:auto、button flex-shrink:0；4px WebKit scrollbar / 支援的薄 scrollbar。若隱藏 scrollbar，須有可見、可點的方向控制而非只畫 fade；原生鍵盤 focus scroll。保留 44px 高度、完整 labels、counts、active/disabled；active mount/必要切換 scrollIntoView({inline:"nearest",block:"nearest"})。不改 city map/page variant。
- [ ] **固定 MIN_VIEWPORT_PX=800×450 不變，computeCompactClasses 不新增 viewport dependency。** 保守性以前置 stage height ≥450px @800×600 為必要條件（header ≤150px）。用既有五地點 checkpoint 及六個 HPA-853 live checkpoints 的各 sublocation、長 title/objective header fixture 驗證；不能只假定五地點必然是最高 header。先按上述確定預算，實測若不足僅微調既有 spacing/欄配置，保留全文/控制；較大 viewport 不縮破此下限。不能以 blocker 代替實作預算，也不能改動態 compaction 或放寬 gate；最後仍未通過須如實列未完成。
- [ ] 更新 HPA-853 的 baked face scale Math.max→Math.min（原 :1389）；其 72-target/17-sublocation/zero-placement-loss inventory gate 保留，只移除 obsolete cover crop-band 規則，中心由既有 sweep 驗證。Live `expectHpa853SublocationSurface` 的 HUD/target hit/locked/intentional overlap regressions 繼續保留，offstage authored center 不可 silent skip。將 :1354–1361 的 chipTops 單列 assertion 延伸至 :1229–1276 scene 4 五 chip；真實 pointer/keyboard scroll 到最後一個並切換；各 live header ≥450px floor（stage，非整個 viewport）以及較大 aspect 另驗一次。
- [ ] 截圖比對 800×600 與較大 viewport 的原圖完整性/暗邊/座標；100px header 例線性縮小約 10%，不要為填滿窗口回退 cover。

## Task 4 — Face-safe portrait 與 inv9 sidecar（局部修正）

Files: `GameShell.svelte`、`+page.svelte`、`DialogueBox.svelte` / tests、`SceneBackdrop.svelte`（小型共用 SceneStamp）、`InterrogationStage.svelte`、`InterrogationSubjectArt.svelte`、既有 InterrogationView 問題區 scroll cap（僅必要的 compact CSS）及現有 tests；`docs/stories_plan/chapter_1/investigation_scene_9.layout.json`。

- [ ] 普通 dialogue 按 spec §2.4 的固定兩列 compact header（max-height:700px；row1 FILE/章名/menu，row2 summary/objective，padding8–10px/gap6px），header 目標120–135px；SceneBackdrop padding 18→約6px，stamp 保留全文，目標 backdrop40–55px/top chrome 約175–190px。不可只縮 portrait（舊約305–325px chrome 會只留約100px 可見）。GameShell bind header offsetHeight + 1px rule → --shell-header-height（隱藏=0）；+page ordinary dialogue 分支以 normal-flow wrapper bind:offsetHeight 包住 SceneBackdrop，實際高度作 DialogueBox prop，mode/session 切換重置。DialogueBox inline --portrait-height = min(1536px,80vh,max(0px,calc(100vh - var(--top-chrome-height))))，--top-chrome-height 為兩者合計。保留固定 bottom:0/左右位置/背景層/thumbnail role；更新 DialogueBox.test.ts :365–367/:415–417 literal assertion。測實際 stamp 旋轉 rect、header/portrait top、長內容；一般 800×600 代表對話約≥200px 頭肩可見且臉完整、資訊不截。
- [ ] InterrogationStage 固定採 spec §2.4 **雙欄**：stage-chrome inset 左右26/top24/gap12；left min(360px,46vw)、right minmax(0,1fr) 約376px@800。左欄 flow：SCENE stamp→objective→subject/progress；右欄 toolbar（四項工具目標同列，必要時只在右欄內換行）。抽共用小型 SceneStamp markup/style（保留 data-save-thumbnail-layer）；InterrogationStage 背景原 SceneBackdrop sceneTag=null 留在原 stacking layer，只有 stamp 搬入左欄，避免把 fixed 背景搬上 z4 蓋人物。量測 toolbar height（無=0），InterrogationSubjectArt 右欄 frame top=24+toolbarHeight+8、bottom0、寬為右欄，alpha-crop/asset ratio 保持可見圖 fit 於 frame 上緣，移除破界 min-height，不跨左欄、不裁頭；下半身可在 dialogue box 後。典型 testimony 可用頭肩區約260px、question 約150px；以實際 rect/screenshot 檢查臉完整、stack/stamp/toolbar 分離、一般 testimony 約≥200px/question 約150px 頭肩；必要時用 InterrogationView 既有 scroll/max-height seam 保留頭肩，所有問題仍可讀/操作。保留 LOG/history/Present/modal、HPA-831、HPA-711，不做 per-speaker fixtures 或新 viewport manager。
- [ ] **必做** Ch1 inv9 contractor_desk 的 workorder/access_permission_list 編輯：在 Layout Editor 對照現有原圖，擴至各自實際可辨識範圍；第三個鄰接 material_kit_list 也需檢查與必要的同批校正。三者均可獨立點、無新增未聲明 overlap、不把 clamp 強行放大、不移離物件。若原圖不足，記錄最大可用範圍；任何需新圖的工作獨立 art ticket、不得用假位置通過。
- [ ] Ch1 inv8 ledger 與 inv9 to_confront 因 contain 解 crop，預設不改其 sidecar；只有真實 hit regression 才局部修。必跑 scenes:compile、test:scripts、check:scripts、live-corpus snapshots，只允許預期 layout/contentRevision diff，無 save migration。
- [ ] Real pointer 針對 Ch1 inv8 帳本、inv9 三份鄰接文件及前往質問北見、Ch2 inv4 悼念卡/監看螢幕；使用現有 production jump/helper、已存在 checkpoint 或既有 journey 局部 route，正確 evidence/topic/acquisition 推進。黑瀨、高瀨、戶川美羽看實際 screenshot；HPA-853 原 baked face checks 維持，不新增 head-box fixtures。無新增逐場景 checkpoint/Rust production change。

## Task 5 — 單一 WDIO CLI acceptance harness

- [ ] 按 AGENTS.md 直接執行既有 packaged WDIO CLI（例如隔離 Linux Xvfb），讀取同次 `browser.saveScreenshot` PNG / run artifacts；MCP 為使用者要求的 agent 執行/取證方式（透過可用 terminal/browser/file 工具調用 CLI），不是專用 WDIO MCP server，不另建 harness/新平台 runner，不因缺專用 server 判為 blocker。確認實際 innerWidth=800/innerHeight=600、commit/run id。保留 trusted keys policy；無 trusted input 時不把 synthetic keys 宣稱真實 OS keyboard proof。
- [ ] Task 1–2：兩種 complete component coverage + 實際 shipped complete CTA → title，fresh/return title 在 autofocus 後 top=0、logo 可見、QUIT 可經原有 navigation 找到。Persistence recovery、手動 save/Continue 不退化。各 trigger component tests、GameShell focus/guard tests、一次 Explore packaged save→load（contain 後同一路徑重驗實際縮圖對位），focus-owner/map Tab contract 保留。已有 save/exit suite，不做逐 mode 完整 E2E。
- [ ] Task 3–4：既有 `investigation-layout.e2e.ts` 全 shipped placements style sweep（中心/跨度/cue）、五地點與 HPA-853 六個 live checkpoints（stage floor/HUD row budget/五 chip single-row/actual hit/locked & overlap/72-target/face checks），named complaint target real pointer、普通 compact chrome clearance、interrogation 雙欄 frame separation 及可辨識頭肩、較大 aspect regression。Sweep 只證明 geometry，不宣稱全場景 live clicks；named targets 與 existing live regression 補足。
- [ ] **視覺驗收**：Linear 無 mockup，agent 直接讀 WDIO 同次 before/after 代表 PNG screenshots：Ch2 inv4 五 chip/直播牆/轉播車、Ch1 inv7/8/9（含三份相鄰文件）、三宅/神谷/三枝代表 dialogue/hearing、end/title、menu、Explore save thumbnail 與原圖/overlay 對位、一張較大 viewport。對照原圖及現有 UI，確認原圖與 hit/cue 一致、臉清楚、控制可達；無全章逐圖矩陣或人工簽收。若現有 fixture 不直接到某畫面，用既有 game navigation/journey，不擴充逐場景 checkpoints；有實際未驗項就記錄，不能用 mock/靜態 DOM 宣稱成功。
- [ ] 相關 Vitest、`bun run check`、`bun run --cwd apps/game check:e2e`、lint/format、scenes:compile/test:scripts/check:scripts、packaged gameplay suite；save-management/exit-lifecycle/capture-proof 用既有 scripts（同一 e2e binary）。例如 `xvfb-run -a bun run --cwd apps/game test:e2e:gameplay`；PR smoke / ready 前手動 E2E Full 遵照 AGENTS.md，不額外引入 CI suite。真實 packaged 測試或截圖證據無法取得才記為未驗/blocker，不以缺少專用 MCP server 作 blocker。
- [ ] PR #141 逐項記錄結果、artifact 路徑、baseline 已解決/本次新增修正/未驗事項；單一 PR 全部 gates 完成才 ready。不做第二平台 native acceptance。

## Self-review（兩輪）

- Review 1–3：contain 確定，四處 fit token/變數改名，保留原 signed offsets 及固定 collision basis；實際 stage floor 必須成立。修正舊 cover-specific test fixtures，保留 genuine occlusion。
- Review 4–5：使用現有 sweep/fixtures，不建立全章 checkpoint；分清全 corpus authored geometry 與實際 named hits。以 measured chrome clearance 規則取代逐人物 head boxes，普通對話額外算 SCENE stamp。
- Review 6–7：只修兩個自動 focus；MenuTrigger 選定，per-mode component tests + 一條 packaged persistence journey；仍保留 Present 與 modal guards。
- Review 8–9：獨立小修先做，同一 PR 不拆分；WDIO 是唯一 acceptance harness，由 MCP 執行/檢查截圖。inv9 相鄰三個物件須一併檢查，兩個小框必做校正且不可造假擴大。
- 第二輪：具體鎖定 compact dialogue chrome/量測 owner、interrogation 雙欄與背景層分離、150px HUD row budget、computed object-fit 縮圖分支、focus allowlist/LOG selector/Present-only bypass；不再將這些決策推給實作階段。WDIO CLI 為唯一 harness，沒有專用 server 不構成 blocker；保留 MCP 執行/取證要求。
- 規劃階段未跑 packaged app 或 tests；review 的縮減不等同修復已完成。Scope 不含 HPA-706/832/851/708/707/912、story、art/SFX、save schema 或 native feature。

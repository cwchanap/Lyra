# HPA-852 — 800×600 Gameplay UI 實作計劃

**狀態：Draft / 尚未實作。**  
**基準：** main @ `1349831b8ab56db1c025c2ea360a0bef9bc82ac8`  
**設計：** [HPA-852 design](../specs/2026-11-24-hpa-852-compact-gameplay-layout-design.md)  
**Linear：** [HPA-852](https://linear.app/cwchanap/issue/HPA-852/targets-and-faces-hidden-off-screen-or-under-the-hud-at-the-default)

一個 Linear ticket → 一個 PR（即本 draft PR）。下列工作是同一分支內的實作/測試次序，不是拆成多個 PR 或新 ticket。此計劃不改現有 story canon，不產新美術/SFX。

## Task 1 — Baseline：重現並固定驗收矩陣

- [ ] 讀 `AGENTS.md`、HPA-853 已合併設計/實作文件、HPA-831/HPA-705 regression contract。若 main 已更新，先核對合併差異與 HPA-712 是否改動真實 dialogue anchors；不要覆蓋其他 PR。
- [ ] 安裝 workspace dependencies，依 repo 規格建立 e2e-feature + VITE_E2E packaged app（`apps/game/scripts/build-e2e.mjs`）。在 MCP 可用 desktop/browser/terminal 環境用既有 WDIO helpers 及 `ensureMinimumWindowViewport()` 設實際 800×600 viewport。先跑 `bun run --cwd apps/game test:e2e:gameplay`；保存原有結果，不跳過已存在失敗。
- [ ] 建立同一份 before/after 報告：從 compiled story corpus 取得已配置目標清單、實際場景與最大 visible sublocations；用 production UI 測 `.scene-hud`、`.scene-stage`、nav/進度/目標/scene-label、target rect、authored center、elementFromPoint、cue、face 與 scroll，不以 UAT 舊座標代替現況。既有 `investigation-layout.e2e.ts` 的 HPA-853 scene 4 與六場景 checkpoint 優先重用。
- [ ] Ch1 inv7/8/9、Ch2 inv4 五地點、Ch1 testimony/scene 11/神谷 hearing、Ch2 三枝、complete/title/menu 逐項標成 reproduced / already fixed with evidence / blocked。逐條保留 Linear acceptance；已修項不再改 runtime，但加/保留合適回歸。若所有現有調查場景在真實最大地點列與較大 viewport 都滿足 spec，保留原 cover，Task 2 只補必要的 nav/命中修正；否則採 Task 2 的 contain 方案。
- [ ] 先確定 `MainMenu` 真正的 scroll owner（≤980px 的 .lyra-menu 或 document）及初始 focus/延遲 focus 何時造成跳動；不假定 HPA-830 或 reset 路徑已解決這個報告。保存截圖於 ignored E2E artifacts；PR 記錄路徑與結果，不 commit build/screenshot binaries。

## Task 2 — Explore stage 與 nav：對齊、可見、可點

主要 files:
- `apps/game/src/lib/components/InvestigationSceneSurface.svelte` / `InvestigationSceneSurface.test.ts` / `InvestigationSceneSurface.present.test.ts`
- `apps/game/src/lib/investigation/target-layout.ts` / `target-layout.test.ts`
- `apps/game/src/lib/components/ExploreView.svelte` / `ExploreView.test.ts`
- `apps/game/src/lib/components/SublocationNav.svelte` / `SublocationNav.test.ts`

- [ ] 先寫失敗測試：非 16:9 stage 的 plane 尺寸、letterbox 偏移、靠圖緣目標、窄 viewport clamp 衝突、stage/header/fallback rect、pending cue。確認原有 cover 行為的 tests 是特定呈現假設還是必要 usability invariant；保存後者。
- [ ] 如果 Task 1 需要 contain：將 `coverPlaneSize` 與唯一 `targetViewportRect` 投影 seam 改成實際 fit plane 的尺寸/偏移（若其他 caller 確實仍需要 cover，才保留明確 fit mode；不要留無用 helper）。CSS geometry 與 TS 數學使用同一規則；調查背景 object-fit/coordinate-plane/standee/cue/thumbnail layer 的呈現都匹配。針對 800×600 + header、800×900、較寬 16:9，驗證 full-image 對位與全部 edges。沿用 `headerHeight` 量測並確認 fallback rect 轉成 stage-relative 座標；不新增 viewport state owner。
- [ ] 重新檢查 `computeCompactClasses`：固定 800×450 的 collision basis 若不再是實際最小 plane，不可沿用。由目前實際 viewport/plane 判斷 clamp overlap；保留現有單軸/雙軸 compact、intentionalOverlaps、locked targets 與 focus transfer。測試 resize + clamp/routing 變更不會形成 fallback oscillation、偷點或失焦；不改 target IDs、unlock 或回退功能。現有 shipped placement 與 HPA-853 baked face 測試的幾何 helper/expected band 改為與新 plane 一致的真實 stage assertion；保留 72-target count、min visible span、cue、HUD、actual hit、locked/overlap 原契約。
- [ ] `SublocationNav` scene variant 改單列可水平捲動且有溢出提示，`ExploreView` header grid 的 flex children min-width 正確；維持 44px button、active、remaining count、focus-visible、disabled、長中文字與鍵盤定位。驗證第五 chip pointer/keyboard 到達及 map variant 不誤顯示 nav。避免為了不換行把按鈕裁切。新增 DOM tests 與 packaged scene 4 證據。
- [ ] 實測 Ch1 inv8/9 舊 sidecar 的 edge targets、相鄰工單與名單；需要時才在 `docs/stories_plan/chapter_1/investigation_scene_{8,9}.layout.json`（以及其他有證實問題的既有 sidecar）用 Layout Editor 改原圖對位。若物件根本不存在或需重畫，獨立美術 task 並報 blocked；不在本 PR 產圖或擴散改故事。若 sidecar 改動，`bun run scenes:compile` + live-corpus tests/snapshot，核對 only expected layout/revision diff。既有 dev save 可失效，不加 migration。

## Task 3 — 普通對話 / interrogation face-safe chrome

主要 files:
- `apps/game/src/lib/components/GameShell.svelte` / `GameShell.test.ts`
- `apps/game/src/lib/components/DialogueBox.svelte` / `DialogueBox.test.ts`
- `apps/game/src/lib/components/InterrogationStage.svelte` / `InterrogationStage.test.ts` / `InterrogationChrome.test.ts`
- `apps/game/src/lib/components/InterrogationSubjectArt.svelte` / `InterrogationSubjectArt.test.ts`

- [ ] 對投訴的 named subjects 實測 portrait 與 painted chrome bounds，取得現有圖片頭部區域（可沿用 HPA-853 normalized head-box 測試的方式，fixture only）。普通 dialogue 需同時測 left/right portrait；interrogation 需測初始、質問、testimony line、Present 退出。
- [ ] 僅在確有重疊的 owner 調整：compact chapter/scene title、interrogation stage 左 stack/工具列、portrait vertical space，令頭部區域與資訊 chrome/底部對話實際分離。用 CSS grid/flex 或現有 owner 的量測 seam，不以 z-index 遮掉文字、降低 opacity、全域 face detector 或 scene-specific hard-coded portrait offsets 掩蓋。保持 alpha crop、CrossfadeImage、原左右角色位置語義、證物影像/thumbnail layers。
- [ ] 保留 analysis/interrogation presentation gating、HPA-831 focus/evidence image regression、dialogue history 與 HPA-711 inner voice 樣式。對長中文標題/目標/subject record，避免因換行讓頭重新被覆蓋。實際 screenshot/DOM rect 證明臉部而非整個透明 image box 的可視性。

## Task 4 — 結案 CTA 與標題初始 scroll

主要 files:
- `apps/game/src/lib/components/GameComplete.svelte` / `GameComplete.test.ts`
- `apps/game/src/lib/components/MainMenu.svelte` / `MainMenu.test.ts`
- `apps/game/src/lib/components/GameShell.svelte` / `GameShell.test.ts`
- `apps/game/src/routes/+page.svelte` 與既有 route/persistence tests

- [ ] 先測兩種 storyCleared 值：原 stamp、title 與既有文案留存；CTA 改「返回標題畫面 / RETURN TO TITLE」，callback 語義改 onReturnToTitle。於 +page 接現有 handleReturnToTitle，移除僅供舊 CTA 的 handleReset/import（若另有 caller 則保留它的既有用途）；不得 resetGame/new game。已存在 recovery 的 retry、discard、cancel 與 inFlight 防重入同樣適用。
- [ ] 調整 complete layout 及必要 compact header，800×600 不捲動就看見、可點 CTA。維持兩種 end-state，不改 HPA-708、不插新的 chapter transition。
- [ ] MainMenu compact 佈局及實際 scroll owner 初始位置：fresh mount/return to title at top；初始化 focus preventScroll，並避免將初始焦點放在視窗外；針對 +page 的 finishReturnToTitle focus 與 MainMenu delayed focusCard(0) 一起修。鍵盤主動移動可 scroll into view；save archive 關閉/焦點回復不觸發無關 scroll reset，Continue discovery 更新不抹除玩家 scroll。測 Continue enabled/disabled/long recap、QUIT、延遲 timer 後的 title screenshot。
- [ ] 用既有 `save-exit.e2e.ts` / `save-management.e2e.ts` 或合適 existing persistence suite 驗證 return-to-title 真實保存/恢復（包含故障恢復路徑）。新增有界 e2e-only complete checkpoint 若現有 public scene navigation/fixture 無法可靠到達 end state；使用 engine 正常 mode/transition 及 checkpoint projection，不寫假 UI mode、也不新增 production IPC。

## Task 5 — 滑鼠入口復用 GameShell

主要 files:
- `GameShell.svelte` / `GameShell.test.ts`；`+page.svelte`（現有 gameMenuRequest）
- `ExploreView.svelte` / `InvestigationMapView.svelte` / `InterrogationStage.svelte` / `analysis/AnalysisWorkbench.svelte` 及其現有 tests
- 若重用樣式有需要，新增一個小型 MenuTrigger.svelte，不新增 store/controller

- [ ] 設定最小 props/snippet API，普通對話使用 GameShell chapter header 的 button；Explore nav/header、city-map header、interrogation toolbar（提問與 live dialogue）、analysis board-header actions 提供同樣文字按鈕。Present modal 沿用既有 `data-interrogation-game-menu`；不在其背後新增 focusable trigger；complete 的 header 入口同樣可用。不得改分析板布局演算法。
- [ ] +page 泛化既有 request handler（保留現有 Present 呼叫路徑），GameShell 讓新 click 與 Escape 同樣通往同一 openGameMenu、fullscreen reassert、close/focus restore。按鈕由 existing disabled/inFlight/top-layer/inert 狀態控制；nested topic/history/Present/modal 的 escape claim / click ordering 不破壞。「遊戲選單」入口不消費 gameplay dialogue click，不奪焦，不新增 Escape listener。重新檢查 menu-trigger 的 focus restore：Resume、save success（原 Present special-case）、load、title return、submenu 回退不應指向已 unmounted/hidden control。
- [ ] GameShell tests：同一 menu、gating、初始 Resume focus、原 trigger 回焦、Escape / IME、modal & in-flight、沒有重複 trigger；各 mode component tests 驗證按鈕在安全 chrome 內且事件只觸發一次。保留 HPA-830 save archive 安全、HPA-705 searchable tray、HPA-831 focus evidence tests。

## Task 6 — 全章 packaged MCP 驗收

- [ ] 以 `apps/game/e2e-tauri/investigation-layout.e2e.ts` 為唯一 layout E2E 主軸。保留現有 HPA853_LAYOUT_CHECKPOINTS 與 `enterSublocationThroughNav`、`waitForSceneSurface`。在必要時泛化現有測量 helper 加章節 ID（不能以重複 sceneId 當 chapter key）；依實際 manifest 枚舉兩章其餘 shipped investigations，擴充 `apps/game/src-tauri/src/game/e2e_checkpoints.rs` / `apps/game/src/lib/e2e/checkpoints.ts` 有界 layout-ready 白名單及 tests。fixture 只允許指定真實場景之全部 sublocations 解鎖、保留目標未檢查、不觸發 Auto Outro；不得新建通用 unlock-anything IPC。MCP 操作透過現有 packaged state application / UI。對所有目標，以 live DOM 實測 + corpus inventory 對帳；每個場景覆蓋最大地點列與必要的解鎖變體（尤其會同時可點的重疊目標）。已配置 on-art 不准路由 fallback；確認 authored center、實際可用 hit、cue、HUD rect、face bounding。不用 DOM synthetic clicks 取代投訴目標的真實 pointer hit 證據。
- [ ] 在原報告所列場景實際滑鼠點擊投訴 target/witness，斷言正確 ID/對話/線索與必要推進；若 acquisition popup 出現，正常操作確認。保留 existing real pointer、keyboard navigation、focus/Escape、HPA-853 locked and overlap invariants，不能只驗 count。五地點尾端以 UI scroll/Tab 觸達，選取並返回。
- [ ] 新入口在 dialogue/explore/city map/interrogation (question/live testimony/Present)/analysis/complete 真實開啟既有 menu，再 Resume/Escape 回原 mode；以其中一條走 real manual save、load，驗 inventory/mode/scene 保留。用 existing `app.e2e.ts`、`save-management.e2e.ts`、`save-exit.e2e.ts`、`analysis-beat85.e2e.ts`、`scene-navigation-gate.e2e.ts` 或現有相關 suite，避免額外 test framework。兩種 complete → title 確認不是直接新遊戲、手動存檔未消失，Title 首次渲染與延遲 1.5s autofocus 之後 scroll top/Logo/QUIT 仍符合 spec。
- [ ] **MCP 視覺驗收**：使用執行 agent 能使用的 MCP desktop/browser/terminal 控制真實 packaged app + screenshot artifacts，逐項比對 before/after。Linear 無獨立 mockup，依本設計與原圖：Ch2 inv4 直播牆/轉播車/五 chips、Ch1 inv7/8/9、三宅普通對話與 testimony、神谷 hearing、三枝、兩種 end card、返回後 title、遊戲選單及較大 viewport 至少各取相應證據。記錄 viewport、stage bounds、圖片/人物、按鈕/焦點狀況、結果及 artifact 路徑。不可用 DOM-only/靜態 CSS/code review 代替 screenshot；不要求人為簽收。若無 MCP/packaged 能力，標為 blocked 並保留待驗事項，不假裝完成。
- [ ] 執行既有 checks（依 package scripts）：
  - 相關 Vitest component/target-layout tests；`bun run check`、`bun run --cwd apps/game check:e2e`、`bun run lint`、`bun run format:check`。
  - 若改 sidecar，`bun run scenes:compile`、`bun run test:scripts`、`bun run check:scripts`、corpus snapshot review，必要時 `bun run evidence-sources:audit`。
  - 若擴充 Rust e2e-only checkpoint：現有 checkpoint contract tests、`cargo test --manifest-path apps/game/src-tauri/Cargo.toml`（含對應 e2e feature）、`bun run rust:lint`。
  - `xvfb-run -a bun run --cwd apps/game test:e2e:gameplay`（或 MCP 控制的現有等價 packaged desktop）；save-management/exit-lifecycle 以現有 `test:e2e:save-management:run`、`test:e2e:exit-lifecycle:run`（同一次已建 e2e binary）確認 shared persistence flow；PR smoke 與手動 E2E Full 依 AGENTS 現有 workflow 規格。使用既有 trusted key policy，僅在明確支援隔離環境執行真實 OS keys；沒有 trusted input 時不能把合成 Tab 宣稱為真實 keyboard proof。
- [ ] 更新 PR description 逐項列出 Linear acceptance 對應證據、test results、visual screenshots、baseline 已解決/新增修正/尚未驗證項。只有 spec 的 gate 通過才 ready for review；不為本跨平台共用 UI 建第二個 native runner。

## Self-review 與風險控制

- HPA-853 main 已把 HUD 從畫面剝離，因此不重建 HUD 架構；保留新 stage/header 分界。contain 是保留原圖與全中心可見的產品選擇，非自動套用；若 cover baseline 已達標不改投影。若採 contain，必須同步改 background、hit/cue、collision projection、existing E2E，避免兩套座標。
- 把緊密熱點全域放大只會再搶點；以既有 compact algorithm + 真實 viewport + 少量 sidecar 修正，不用新 schema、假位置、全面 tooltip overhaul。
- 直接 resetGame 是產品風險，返回標題是 ticket 已允許的選項；重用持久化流程而非手寫 confirmation/clear save。Menu button 只是一個新入口，不是新 menu state owner。
- 一張 PR，無 art/SFX 工作；如現有圖無法支撐場景合理位置，記錄獨立依賴。舊 HPA-853 有多平台 gate 的歷史，不在本票重啟已豁免的跨平台要求；同一支援平台的 MCP packaged acceptance 即可。
- 規劃階段只讀 main 與 Linear，未執行 packaged UAT；需以 Task 1 真實結果確認 residual、最合適 compact portrait/scroll layout 與最小必要 sidecar 範圍。無 mockup，不宣稱 pixel parity 已驗證。

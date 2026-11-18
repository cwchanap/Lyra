# HPA-853 — 第二章調查熱點／證人場景配置：設計規格

**日期：** 2026-11-14  
**狀態：** Draft design（2026-11-14 規劃當時的設計基準，非實作宣告。現況：HPA-853 已部分實作——72 個目標已配置 67 個，其餘 5 個由 [HPA-1143](https://linear.app/cwchanap/issue/HPA-1143/complete-five-chapter-2-investigation-targets-blocked-by-crop-and-hud) 追蹤；最終驗收尚未通過，Chapter 2 零 fallback gate 仍未開啟）  
**Linear：** https://linear.app/cwchanap/issue/HPA-853/chapter-2-investigations-8-17-show-hotspots-in-the-off-scene-fallback  
**美術依賴：** https://linear.app/cwchanap/issue/HPA-1033/art-add-three-visible-chapter-2-investigation-witnesses-to-existing

## 1. 問題及目標

Chapter 2 調查 Scene 8、10、12、14、16、17 都有有效的劇情、熱點與證人，但沒有對應的 `.layout.json`。目前編譯仍允許 `layout: null`，遊戲會將互動點放進「OFF-SCENE TARGETS / UNPLACED HOTSPOTS / UNPLACED WITNESSES」清單。案件可以通關，卻失去點擊現場物件、直接詢問人物的主要遊玩手感。

目標：以**既有 Layout Editor 及 sidecar v1** 把這六個場景的所有互動點放回正確場景圖片，並在遊戲實際最小視窗 800×600 下維持可見、可點、可操作。**不更動案件推理、揭露條件、劇本、遊戲架構。**

## 2. 現有架構與已確認事實

- 原稿：`docs/stories_plan/chapter_2/investigation_scene_{8,10,12,14,16,17}.md`。
- 背景：`static/assets/backgrounds/chapter_2/investigation_scene_<N>/<sublocation>.png`，17 個對應子場景的檔案均已存在。
- 配置範例：同章 `investigation_scene_4.layout.json`（hotspot rect + sprite）與 `investigation_scene_5.layout.json`（baked character）。
- 合約：`packages/scene-types/src/index.ts` 的 `InvestigationLayoutSidecar`，`version: 1`、`sceneId`、`sublocations[ID].hotspots[ID]` / `characters[ID]`。
- 畫面：`apps/game/src/lib/components/InvestigationSceneSurface.svelte`。沒有配置的項目會進 fallback；**已有配置但被裁切或遮蓋**的項目也可能在執行時被導回 fallback。
- 編輯：`bun run dev:editor` 開啟既有 Tauri Layout Editor；`bun run scenes:compile` 將 sidecar 併入已編譯場景。
- 已有測試：`packages/scripts/compile-scenes.test.ts` 內 production-corpus placement gate 目前只檢查 Chapter 1；`apps/game/e2e-tauri/investigation-layout.e2e.ts` 已有 800×600 裁切／命中／提示點測試。

本次 inventory 為 **6 個 scene、17 個 sublocation、59 個 hotspot、13 個 character（共 72 個互動目標）**：

| 場景 | 子場景數 | Hotspot | Character | 主要視覺注意事項 |
| --- | ---: | ---: | ---: | --- |
| 8：天橋／便利店／留言串 | 3 | 11 | 1 | 遠處大螢幕、天橋直播架、平板內多個線索區 |
| 10：側巷／拉麵後門 | 2 | 7 | 2 | 窄縫、取餐架、柚木及門後老闆 |
| 12：轉播車／大樓外／箱側／巷角 | 4 | 11 | 3 | 密集螢幕、左右側視角與已入鏡人物 |
| 14：背面後場／通道／防災中心／七樓 | 4 | 14 | 4 | M-03、門禁與多名人物的空間衝突 |
| 16：真白工作室 | 2 | 11 | 1 | 手機／錄音及企劃板／底頁相鄰但不同線索 |
| 17：蓮見事務所／大樓門口 | 2 | 5 | 2 | 手冊、白板、人物及入口場景 |

## 3. 必須先解決的美術缺口

**不可對沒有畫在背景上的人使用 `kind: "baked"`。** 本 repo 的 baked contract 只定義「背景圖片已包含角色，sidecar 提供互動矩形」，不是繪製角色的替代方式。

原稿背景描述證實三名 character 未入鏡：

1. Scene 10 / `ramen_backdoor` / `ramen_owner`：背景明寫「no one in the doorway」，角色在半開後門內說話；柚木 `yuzuki` 則已畫在左側。
2. Scene 14 / `disaster_center` / `building_guard` 和 `building_cleaner`：背景明寫「no people, no faces」，原稿描述兩人在房間內。二人的 character catalog 都是 `portraitMode: none`。

美術改動已獨立拆成 **HPA-1033（一張美術 PR）**：只調整這兩張現有背景圖及相應 Background Prompt，人物合理露出且不遮住推理核心物件。**HPA-853 的一張實作 PR 不產生圖片或音效。**兩張背景將重新構圖：`ramen_backdoor` 有 3 個 hotspot 與 2 個 character（共 5 個）；`disaster_center` 有 3 個 hotspot 與 2 個 character（共 5 個）。這 **10 個目標**全部等 HPA-1033 合併後才一次配置，避免先前 7 個矩形因重畫而重做；其他 **62 個目標**可先行配置。

## 4. 最小設計決策

### 4.1 保持 sidecar v1；場景 ID 是唯一來源

每個 scene 新增一個同名 `.layout.json`。每個可互動的 Markdown hotspot 使用 `{ kind: "rect", x, y, w, h }`；已畫入背景的 character 使用 `{ kind: "baked", x, y, w, h }`。全部座標依現有 normalized 0–1 合約，在**實際圖片**上以 Editor 擺放，不從文字描述猜精確位置；不新增 parser、schema、runtime state、控制元件或另一個 layout tool。Editor 從已編譯場景讀取有效 ID；編譯器拒絕不存在的 hotspot/character ID，完成後的 live-corpus gate 則攔下漏配的 ID。原稿 ID 表僅作工作量清單，不重做一份人工 ID validator。

若背景實際上沒有預期物件，先核對既有圖片／原稿與既有資產，不以假熱點或任意點位滿足數量。非本 ticket 所需的新圖交由美術 ticket 處理。

### 4.2 800×600 可視區、最大地點列與 HUD 遮擋

背景以 16:9 cover 顯示在 800×600（4:3）視窗：影像約為 1066.7×600px，左右各裁去約 133.3px。以**背景本身的 normalized 座標**計，**本票六個新增場景**的目標中心 x 應位於 **[0.125, 0.875]** 內；座標仍以實際圖片／Editor 為準。**此更嚴格的中心點規則只適用 HPA-853 六場景，不回溯修改既有 Chapter 1 或 Chapter 2 Scene 4/5 配置。**現有全章 `shippedPlacements()` 測試的 **44px 可用跨度（`MIN_USABLE_TARGET_PX`）及 pending cue** 是全章共用回歸契約：既有 8 個目標的中心雖在上述區間外，仍可用部分裁切的矩形點選；不能為了讓新 assertion 綠燈而搬離原圖物件。

**不可使用 `y > nav.bottom / 600` 當成全寬安全線。** `ExploreView.svelte` 的 `.explore-hud` 是 flex-wrap；nav 與右側 `hud-side` 可換行並移到不同位置，且 `PROGRESS`、`PRIMARY OBJECTIVE`、`.scene-label` 雖設有 `pointer-events: none`，仍會實際蓋住美術／提示。唯一可靠方式是**在 800×600 的真實遊戲畫面量測每個正在顯示的 HUD 元素 DOM rect**，與目標可點矩形逐一檢查不相交。至少涵蓋：

- `.explore-hud nav`（會攔截點擊，亦可能換行）
- `.investigation-progress`（視覺遮擋，即使 pointer-events 是 none）
- `.primary-objective-hud`（如果存在）
- `.scene-label`（即使 pointer-events 是 none）

對本票六個場景，使用既有 `investigation-layout.e2e.ts`、`targetLayoutStyle` 與 packaged WebView，建立每場景的**最大地點列狀態**再量測；視覺遮擋用 DOM rect 相交判定，**只將 `document.elementFromPoint(cx, cy)` 用於確認目標按鈕（或其內部元素）能接收點擊**，不可用它判斷 `pointer-events: none` HUD 是否遮住畫面。必要時檢查其他互動按鈕／fallback 層是否搶點。

**最大地點列的最小測試入口：** Chapter 2 scene IDs 與 Chapter 1 重複，既有 `jumpToProductionScene` 不能用於跳 Chapter 2；須使用 `jumpToProductionChapterScene("chapter_2", sceneId)`。Scene 8、10、12、14、17（以及其他需要的場景）有鎖定的 sublocation，Scene 12／14 初始只有一地點可見；兩者後續解鎖牽涉 `Present`，且六場景都有 Auto Outro。**不要把六段案件推理／出示順序複製進 layout E2E**。採用既有 `e2e_checkpoints.rs` 模式，僅在 `#[cfg(feature = "e2e")]` 下新增**一套限於這六個 scene 的 layout-ready checkpoint helper**（依明確枚舉的 scene ID），由 `engine.jump_to_scene("chapter_2", sceneId)` 起步、透過現有 `InvestigationSceneState::unlock_override("sublocation:…")` 解鎖當前 scene 的所有子地點、進入 Explore；**不預先 inspect／討論任何目標**，避免觸發 Auto Outro。這是測試夾具，不是新的生產功能、schema 或故事 state 改動。E2E 可在不跑謎題的情況下於 17 個 sublocation 切換並量測真實 NAV/HUD；不可新增通用「解鎖全故事」API。

- 本票六個場景每個只有 2～4 個 sublocation；特別量測 Scene 12／14 的**四地點**狀態，不能只量初始的一地點並宣稱檢查了換行。Scene 4 的五地點 HUD 問題屬 HPA-852。
- `shippedPlacements()` 仍照現有方式檢查全部已配置章節的 **44px 裁切、compact 與 cue**；中心點與上述 live HUD rect／中心命中補充**只針對六個新增場景**。不修改 5 個既有 Chapter 1 和 3 個 Chapter 2 Scene 4 的 edge-of-frame 點位來滿足新規則。
- 兩張待補圖場景 `ramen_backdoor`、`disaster_center` 在 HPA-1033 合併前尚未有 layout；**批次測試允許這兩處仍有 OFF-SCENE fallback**，不得在此階段宣稱全場景通過。等 72 個目標都完成才啟動「零 fallback」正式 gate。
- 熱點與熱點、熱點與 baked 人物不得搶點。先縮到實際物件輪廓；`intentionalOverlaps` 僅限可同時操作的刻意重疊，不用來掩蓋真實誤放。Scene 8 平板／字幕及 Scene 16 手機／錄音、企劃板／底頁，用不同來源區與既有解鎖時序呈現。

### 4.3 編譯、測試與內容版本沿用既有路徑

編輯中的不完整 sidecar **仍應可編譯**，否則 Editor 無法分段填位置。全部 6 個 sidecar 完成後，才把 `chapter_2` 加進現有 `RELEASE_GATED_CHAPTERS` live-corpus test；要求 compiled hotspot 與 character layout 非 null，不改為全域 compiler hard error。

同一 live-corpus 測試目前要求 warnings 數量維持一項（story catalog）；它本來已會攔下新增的 hotspot overlap warning，**不用寫第二套 overlap 檢查器**。`shippedPlacements()` 亦已涵蓋所有已編譯 chapter，新增配置自然進入既有 800×600 測試。

本次 sidecar 將改變 emitted chapter JSON 及 `save_content_manifest.json` 的 `contentRevision`；**既有開發存檔可能顯示內容不相容，是預期行為**。應更新 `compile-scenes.test.ts` 的 live-corpus snapshot，確認只包含這次 layout 的預期差異；不為尚無實際使用者的版本做 save migration／相容層。

真正的 placement 測試在 `gameplay` E2E suite，不在 `smoke` suite：每批 sidecar 後執行 `bun run --cwd apps/game test:e2e:gameplay`；PR ready 前啟動既有 E2E Full workflow。`smoke` 只作一般回歸補充，不能代替 placement 驗收。

### 4.4 跨平台驗證範圍

現有 packaged E2E harness 在 CI 上使用 Ubuntu；目前**沒有 Windows packaged E2E harness**。不要在這張資料配置 PR 建設 Windows runner 或要求雙平台逐一重跑 72 目標。共用定位、裁切與 HUD 命中邏輯由既有 `gameplay` E2E（含上述局部 e2e-only 測試夾具）自動驗證；macOS／Windows 的 800×600 畫面驗收改為**針對四地點 Scene 12、14 的截圖視覺比對**，特別看字體差異會否讓 NAV 換行及遮住人臉／命中區。17 個子場景另外保留 Editor overlay 與實際背景圖片對照；Linear 本票沒有獨立 UI mockup。這些是截圖與測試證據，不需要人工簽收。

不額外要求較大視窗的第二輪 smoke（同一 4:3 裁切比例不會比最小視窗更差）；若未來另有高度或字體相關真實回歸，交給對應 UI ticket 處理。

## 5. 範圍邊界與依賴

**本 ticket（一張實作 PR，包括當前設計文件）**：六個 sidecar、必要的既有 production-corpus test / E2E 擴充、編譯及檢視記錄。

**獨立美術 HPA-1033（一張美術 PR）**：兩張背景補上三名角色、同步兩個 Background Prompt。此項是 HPA-853 最後三名角色的完成前置。

**不包含**：新背景及角色美術、音效、劇本及證物取得順序、Reveal/Unlock 規則、第五塊推理板、HUD 全域改版、改 scene JSON/Rust 存檔格式、為此票新建 macOS/Windows E2E runner，或 Android/Linux 端到端驗收。

## 6. 驗收契約（端到端，不要求人工簽收）

- **6 個 scene、17 個 sublocation、59 個 hotspot + 13 個 character** 全部配置完成。編譯後 72 個目標都具合法 layout，不再落入 `OFF-SCENE TARGETS / UNPLACED` 回退清單。
- **800×600 E2E（現有 `gameplay` suite）**：全章保留 44px hit span、compact 與 cue 既有回歸；只有 HPA-853 六場景新增中心位於 viewport [x = 0.125–0.875]、最大地點列的實際 NAV/PROGRESS/PRIMARY OBJECTIVE/scene-label DOM rect 無遮擋，以及 `elementFromPoint` 的目標按鈕命中檢查。使用受限 e2e-only checkpoint，不複製案件 Present／Auto Outro 解鎖鏈；HPA-1033 補圖前的兩個 sublocation 暫緩零 fallback 驗收。
- **macOS / Windows 畫面檢查**：以 800×600 截圖至少核對 Scene 12、14 的四地點列、主要 HUD 與人物／熱點有無重疊；同時將全部 17 張 Editor overlay 與對應場景背景圖片做視覺比對（包含 HPA-1033 的三名人物）。沒有 Linear UI mockup，以既有原圖為準；不要求 Windows packaged E2E runner 或人工作為 acceptance gate。
- `scenes:compile`、`test:scripts`（Chapter 1 + 2 placement gate）、`check:scripts`、`check`、`check:e2e`、`lint`、`format:check`、`evidence-sources:audit`、Layout Editor 三項 real-content checks、`test:e2e:gameplay` 與 PR ready 前一輪 E2E Full 通過；`smoke` 僅作一般回歸檢查。
- `compile-scenes.test.ts` 的 live-corpus snapshot 更新，以反映預期的 `contentRevision` 改變；既有開發存檔可依 pre-release 策略失效。無新增 overlap warning、無證據／故事語義更動、不新增第二套驗證框架。

# HPA-853 — 第二章六個調查場景配置：實作計劃

**日期：** 2026-11-14  
**狀態：** Draft implementation plan（2026-11-14 規劃當時的施工順序基準，非實作宣告。現況：HPA-853 已部分實作——72 個目標已配置 67 個，其餘 5 個由 [HPA-1143](https://linear.app/cwchanap/issue/HPA-1143/complete-five-chapter-2-investigation-targets-blocked-by-crop-and-hud) 追蹤；§5 acceptance 尚未全部成立）  
**設計：** [HPA-853 設計規格](../specs/2026-11-14-hpa-853-chapter-2-investigation-placement-design.md)  
**主票：** https://linear.app/cwchanap/issue/HPA-853/chapter-2-investigations-8-17-show-hotspots-in-the-off-scene-fallback  
**獨立美術票：** https://linear.app/cwchanap/issue/HPA-1033/art-add-three-visible-chapter-2-investigation-witnesses-to-existing

## 工作單位、PR 策略

**HPA-853 僅一張 PR。** 當前這張 Draft PR 先放設計與實作計劃；後續六個 layout sidecar、測試與驗證成果直接加入**同一張 PR**，不要另開規格 PR + 實作 PR。HPA-1033 為獨立美術 ticket／獨立 PR，其素材合併後 HPA-853 才完成最後三個 baked 目標。

優先保持小改動：使用 Layout Editor v1 和現有編譯器；不引入新的 placement 模型、圖片生成工作、泛用 HUD 重構、資料遷移或遊戲語義變更。

## 0. 前置檢查及基準

- [ ] 在最新 `main` 確認已編譯的 Chapter 2 Scene 8/10/12/14/16/17、原稿 IDs 與兩份 Scene 4/5 sidecar 範例仍相符。Editor 直接從 compiled scene 選取 ID；編譯器拒絕未知 ID，後續 live-corpus gate 檢查漏配 ID，不重做人工 ID validator。
- [ ] 執行 `bun run scenes:compile` 記錄現有 warning／編譯狀態。**Layout 變動預期會改 `contentRevision`、live-corpus snapshot 及既有開發存檔的相容狀態**；不要以「content hash 不變」當作本票成功條件。
- [ ] 用 `bun run dev:editor` 載入六個場景的 17 張背景，確認 Sub-location 及原圖；檢查 HPA-1033 尚未交付的兩張背景中可視角色的狀態。
- [ ] **先配置 62 個目標**：`ramen_backdoor`（3 hotspot + 2 character）與 `disaster_center`（3 hotspot + 2 character）這兩個將由 HPA-1033 重畫的子場景，**全部 10 個目標先不配置**，避免因背景構圖改變而重做。
- [ ] 參照 HPA-852 的既有視窗問題；**全章保留 44px 裁切規則，只有本票六場景新增嚴格中心點與 HUD 遮擋斷言**。不重構遊戲 HUD、不改動 5 個 Chapter 1／3 個 Chapter 2 Scene 4 的既有邊緣點，也不新建跨平台 E2E harness。

### ID／位置逐一核對清單

下表為需要新增的全部 sublocation；Hotspot IDs 和 Character IDs 必須**完全對齊原稿**。不得改 scene ID 或隨意合併、刪掉原有目標。

| Scene / sublocation | Hotspot IDs | Character IDs / 視覺方式 |
| --- | --- | --- |
| 8 / `overpass_deck` | `closure_barrier`, `plaza_overlook`, `big_screen_ads`, `saegusa_rig` | `saegusa` baked |
| 8 / `konbini_front` | `umbrella_stand`, `register_counter`, `vending_machine` | — |
| 8 / `leaked_clip_thread` | `clip_player`, `mirrored_caption`, `uploader_header`, `comment_fight` | — |
| 10 / `alley_mouth` | `gap_view`, `screen_glow`, `konbini_side_door`, `stray_cat` | — |
| 10 / `ramen_backdoor` | `pickup_shelf`, `exhaust_steam`, `rider_spot` | `yuzuki` baked；`ramen_owner` 依賴 HPA-1033 |
| 12 / `truck_console` | `audio_rack`, `monitor_wall`, `coffee_cans`, `truck_window` | `director` baked |
| 12 / `building_exterior` | `projector_bracket`, `upper_windows`, `smoking_tray` | `technician` baked |
| 12 / `box_left_side` | `raised_board`, `stair_gap`, `memorial_fence` | `kurose` baked |
| 12 / `alley_pickup_spot` | `slit_silhouette` | — |
| 14 / `backstage_rear` | `rear_safety_spot`, `logistics_board`, `heat_pack_crate` | `event_security` baked |
| 14 / `sponsor_corridor` | `corridor_doorway`, `vendor_cabinet`, `m03_door`, `roof_leak` | `kurose` baked |
| 14 / `disaster_center` | `access_terminal`, `alarm_panel`, `cctv_monitors` | `building_guard`、`building_cleaner` 依賴 HPA-1033 |
| 14 / `seventh_floor_core` | `elevator_b_door`, `fire_door`, `stair_door`, `core_window` | — |
| 16 / `studio_entry` | `umbrella_stand`, `fan_letter_box`, `kitchen_counter` | — |
| 16 / `studio_room` | `stream_desk`, `comment_phone`, `voice_memo`, `desk_drawer`, `planning_board`, `board_underlayer`, `printed_schedule`, `studio_window` | `kurose` baked |
| 17 / `agency_office` | `production_book`, `standee`, `whiteboard`, `office_window` | `hasumi` baked |
| 17 / `agency_entrance` | `building_awning` | `kurose` baked |

合計：17 sublocation、59 hotspot、13 character。具體 normalized 座標以**實際圖片和 Editor 疊圖**為準，不以此清單或 Background Prompt 硬編數字。

**ID 表是 Inventory，不是額外的人工核對流程。**現有 sidecar parser／compiler 會拒絕不存在的 ID；加入 Chapter 2 至 live-corpus gate 後，漏配任何 target 也會失敗。

## 1. Scene 8、10、12：先配置不依賴補圖的部分

- [ ] 新增 `docs/stories_plan/chapter_2/investigation_scene_{8,10,12}.layout.json`，沿用 sidecar v1。
- [ ] 在既有 Editor 逐圖將 hotspot rect 與 baked 人物覆在真正物件上；正規化座標以實際圖片為準，本票六場景**目標中心 x ∈ [0.125, 0.875]**（800×600 下 16:9 cover 可視區）。**不把 `nav.bottom / 600` 當全寬 y 下限**；以最大地點列狀態的 NAV、PROGRESS、PRIMARY OBJECTIVE、scene label **各自的 DOM rect** 檢查真實遮擋與命中。
- [ ] Scene 8：平板中的 `clip_player`、`mirrored_caption`、`uploader_header`、`comment_fight` 各有可辨認區域；`saegusa` baked 對準背景中的三枝。
- [ ] Scene 10：先只放 `alley_mouth` 的 4 個 hotspot；**不配置 `ramen_backdoor`**，連 `pickup_shelf`、`exhaust_steam`、`rider_spot`、已入鏡的 `yuzuki` 也等 HPA-1033 重畫後再放。
- [ ] Scene 12：四個 sublocation 的物件及導播、技術員、黑瀨 baked 區域；重點檢查螢幕、人物與狹窄區的 `slit_silhouette` 不搶點。
- [ ] 完成本批可配置場景後，執行 `bun run scenes:compile` + `bun run --cwd apps/game test:e2e:gameplay` 作早期回歸；**Chapter 2 完整度 gate 尚未開啟**，`ramen_backdoor`／`disaster_center` 暫時缺失屬施工中狀態。新增「零 OFF-SCENE fallback」檢查必須等美術補圖及全部 72 目標配置後才啟用，不能讓 pre-art 批次誤報回歸。

## 2. Scene 14、16、17：補齊後半調查，等圖後完成 10 個目標

- [ ] 新增 `docs/stories_plan/chapter_2/investigation_scene_{14,16,17}.layout.json`。
- [ ] Scene 14：先配置 `backstage_rear`、`sponsor_corridor`、`seventh_floor_core` 的所有熱點及已 baked 人物（Editor 可直接填 sidecar）；**`disaster_center` 的 3 hotspot + 2 character 全部等 HPA-1033 後再放**。注意正常故事流程中 `seventh_floor_core` **必須經過 `disaster_center` 的 Present 才能解鎖**，故 pre-art 批次不要求用正常遊玩路線到七樓驗收，可先驗證 compiler layout，再用受限 e2e-only layout checkpoint 測試實際畫面。
- [ ] Scene 16：`comment_phone`／`voice_memo`、`desk_drawer`、`planning_board`／`board_underlayer` 依實際圖像作可辨識區域；保留原來的 Unlock/Reveal／話題順序，不靠整塊重疊的 hit rect 應付。
- [ ] Scene 17：`hasumi`、`kurose` 的 baked 命中區與手冊、立牌、白板、雨棚分開；不讓 `building_awning` 搶到黑瀨點擊。
- [ ] 完成本批後同樣執行 `scenes:compile` 和 `test:e2e:gameplay`，逐個排除 HUD／viewport 中心點問題。
- [ ] **HPA-1033 美術 PR 合併後**，重新載入 `ramen_backdoor` 與 `disaster_center` 的最新兩張背景，分別一次配置 5 個目標（含老闆／樓宇保全／清潔員 baked）；截圖與新圖對照，確認必需物件沒有被人物遮住。
- [ ] 最終 6 個 sidecar 共有 17 sublocation、59 hotspot、13 character，不能用畫面外假座標或隱藏 fallback 作填表。

## 3. 沿用並微幅擴充既有驗證

- [ ] **配置完整度**：全部 72 個目標完成後，修改 `packages/scripts/compile-scenes.test.ts` 內 `RELEASE_GATED_CHAPTERS` 為 Chapter 1 + Chapter 2。既有 compiler 驗證未知 ID；本 gate 驗證 `layout: null`，不新增全域 compiler hard error。**在 HPA-1033 合併前不要打開此 gate**。
- [ ] **重疊與 snapshot**：既有 live-corpus test 已要求 warnings 只有 story catalog 那一項，所以新增 hotspot overlap warning 本來會失敗；不新增另一個 overlap analyzer。更新 live-corpus snapshot 以承認 layout 參與 emitted chapters 及 `contentRevision` 的預期變更；開發存檔可依 pre-release 政策不相容，無須 schema migration。
- [ ] **800×600 裁切／提示點（沿用全章現有契約）**：`apps/game/e2e-tauri/investigation-layout.e2e.ts` 的 `shippedPlacements()` 已掃描所有已配置的章節，保留 `MIN_USABLE_TARGET_PX = 44`、compact variants 與 pending cue 測試。已驗證現有 **8 個**邊緣點中心在 [0.125, 0.875] 外（Chapter 1 五個、Chapter 2 Scene 4 三個），但仍滿足可見跨度；**不擴大全章 center gate，也不為此搬動舊 sidecar**。
- [ ] **本票六個 scene 專用中心點**：僅 `chapter_2/investigation_scene_{8,10,12,14,16,17}` 新增中心 `x ∈ [0.125, 0.875]`（及 800×600 viewport y）檢查。與既有 `shippedPlacements()` CSS cover 計算共用同一 helper，不再造一個人工驗證器。
- [ ] **決定性最大地點列測試入口：採「最小 e2e-only checkpoint」方案**，而非在 layout E2E 重新編寫六個案件的全部解鎖／Present 鏈：
  - `apps/game/e2e-tauri/helpers.ts` 的普通 `jumpToProductionScene` 只用於 Chapter 1，同名 scene ID 會衝突；Chapter 2 通常須 `jumpToProductionChapterScene("chapter_2", sceneId)`。
  - 為避免 Scene 12、14 初始僅 **1/4** 地點可見、Scene 8/10/17 亦含 locked 地點，以及各場景 `Auto Outro` 因多做調查而退出，沿用 `apps/game/src-tauri/src/game/e2e_checkpoints.rs` 的 `#[cfg(feature = "e2e")]` 測試夾具。**只為本票六個白名單 scene IDs** 建立一個共用 layout-ready fixture helper（枚舉固定 checkpoint ID，不新增通用故事解鎖命令）。
  - fixture 使用 `engine.jump_to_scene("chapter_2", sceneId)` 載入正確章節，僅對當前 investigation runtime 的既有 `unlock_override("sublocation:<id>")` 設定六場景各自所有 sublocation 的可見性，照原本 intro/enter flow 進入 Explore。**不能預先 inspect hotspot、討論 topic 或搬運證物**；這樣地點列會有最大 chip 數，卻不觸發 `Auto Outro`。測試後隨現有 E2E fixture 清除，不改 schema、正式進度或 save。
  - 於 test 用既有 sublocation nav 切換各地點並量測真實 UI。未解鎖的個別 hotspot/topic 在 fixture 中仍可保持正常狀態；幾何檢查沿用已編譯 sidecar 與 `targetLayoutStyle`，必要時用現有 E2E 的 layout 投射方式處理未顯示項，不為證物重做完整 Present 流程。**最終測試須涵蓋 17 個 sublocation 的 72 個配置，特別確認 Scene 12／14 的 4-chip NAV，而非初始 1-chip 狀態。**
- [ ] **真實 HUD 矩形及點擊**：在同一個 `investigation-layout.e2e.ts` 延伸現有 packaged 800×600 測量；對六場景所有新目標區域，判斷與 live `.explore-hud nav`、`.investigation-progress`、`.primary-objective-hud`（若有）、`.scene-label` 的 **DOM rect disjointness**。`PROGRESS`、`PRIMARY OBJECTIVE`、scene label 使用 `pointer-events: none`，不能靠 `elementFromPoint` 發現其視覺遮擋；`elementFromPoint(cx,cy)` **只用於確認真正接收點擊的是當前目標按鈕或其子節點**（不是另一熱點、NAV 或 fallback）。不以 `nav.bottom / 600` 當全寬 y 下限，因 flex-wrap 可能把 PROGRESS 放到 nav 下一行。
- [ ] **批次例外**：`ramen_backdoor` 及 `disaster_center` 的 10 目標仍未配置時，只作已完成 62 個的裁切／HUD 檢查，**不要斷言這兩個 sublocation 沒有 fallback**；HPA-1033 交圖後才執行全六場景「零 fallback」及 Chapter 2 完整度 gate。
- [ ] Scene 8、16 的相鄰小物件及 Scene 12、14 上緣區重點檢查；若 4-chip NAV 實際換行，先把新 sidecar 安全對準原圖。Scene 4 五地點 HUD 整體改版仍屬 HPA-852。

## 4. 驗證與交付紀錄

- [ ] `bun run scenes:compile`、`bun run test:scripts`（含 Chapter 1 + Chapter 2 live-corpus gate／snapshot；**只在 72 個 layout 完成後啟用 Chapter 2 gate**）。
- [ ] `bun run check:scripts`、`bun run check`、`bun run --cwd apps/game check:e2e`、`bun run lint`、`bun run format:check`、`bun run evidence-sources:audit`。
- [ ] 與 CI `.github/workflows/ci.yml` 對齊，執行 `bun run --cwd apps/layout-editor verify:reader-real-content`、`bun run --cwd apps/layout-editor verify:asset-real-content`、`bun run --cwd apps/layout-editor verify:ai-review-real-content`。
- [ ] **每批 sidecar 後：** `bun run --cwd apps/game test:e2e:gameplay`；它包含 `investigation-layout.e2e.ts`，且正在配置中的兩個子場景**暫緩零 fallback assertion**。Smoke 只作一般回歸，不能替代 placement 測試。
- [ ] **PR ready 前**在 GitHub Actions 啟動既有 `E2E Full` workflow、確認結果；它包含 `production-journey.e2e.ts`，會驗證配置完成後從 fallback 清單轉成真實場景熱點／證人 popover 的路徑，不另建 duplicate puzzle journey。
- [ ] **17 個 Editor overlays** 對應原始背景圖，檢查每個 rect 對準可見物件或 baked 人物；HPA-1033 後重新核對兩張補圖場景。本票沒有獨立 Linear UI mockup，原圖與 Editor overlay 即視覺參照。
- [ ] **macOS／Windows 800×600 畫面驗收**：保存 Scene 12、14（fixture 開啟四地點列）的場景截圖，檢查 NAV 因字體差異換行及其與角色／熱點的遮擋。無需雙 OS 重跑 72 次 E2E、不得新增 Windows packaged runner、沒有人工簽核。
- [ ] 確認全 72 目標最後沒有 `OFF-SCENE TARGETS / UNPLACED`，且案件 Markdown、證物來源、Unlock/Reveal／話題狀態與 save schema 不變；不列 Android/Linux 端到端驗收，既有 CI 照常執行。

**現況（部分交付）：本 PR 已含規劃文件與部分實作——六個 sidecar、限用 e2e checkpoint 夾具與測試擴充均已提交，pre-art 與 post-art 批次已配置 67/72 目標，且 `scenes:compile`、`test:scripts` 與 packaged gameplay E2E 已實際執行通過。但以上 acceptance／測試要求尚未全部成立：其餘 5 個目標由 HPA-1143 追蹤，Chapter 2 零 fallback gate 仍未開啟，macOS／Windows 截圖與 E2E Full 仍待完成；§5 條件全文維持不變，為最終驗收基準。**

## 5. Acceptance Criteria（HPA-853 完成時全部成立）

1. [ ] **單一 HPA-853 PR** 中六個 sidecar 存在，17/17 sublocation、59/59 hotspot、13/13 character 全部配置；兩張重畫背景共 10 個目標在獨立 HPA-1033 PR 合併後一次完成。
2. [ ] 800×600 的既有 packaged `gameplay` E2E 保留全章 44px hit span／cue；只有六個新增 scene 的中心在 viewport 內。利用受限 e2e-only checkpoint 讓 Scene 12、14 的四地點 NAV 真正可見，並對六場景逐一量測 HUD rect 不相交／目標按鈕實際命中，不靠笨重的 Present/Auto Outro 腳本。
3. [ ] macOS／Windows 800×600 UI 截圖確認四地點 Scene 12、14 不因字體／地點列換行遮住物件或人臉；17 個 Editor overlay 與背景圖（含 HPA-1033 兩張新圖）完成視覺核對，無人工作為 acceptance gate。
4. [ ] `scenes:compile`、`test:scripts`、`check:scripts`、`check`、`check:e2e`、`lint`、`format:check`、`evidence-sources:audit`、Editor 三項 real-content checks、`test:e2e:gameplay` 及 PR ready 前一輪 `E2E Full` 通過；Chapter 1/2 release-gated placement gate 無漏配與新增 overlap warning。
5. [ ] live-corpus snapshot 反映預期 `contentRevision` 變更；沒有改動故事推理、角色對話、正式 runtime／save schema 或新增相容層。Scene 4 的五地點 HUD 問題留在 HPA-852。

## 6. 不應做的事

- 不修改 `InvestigationSceneSurface.svelte` 以「自動猜」熱點或隱藏 fallback 警示。
- 不更動 `InvestigationLayoutSidecar` v1、Scene schema、故事存檔、Chapter 2 的調查關卡／證物／主線伏筆。
- 不建立第二套布局工具、圖片座標產生器、泛用碰撞引擎、大量相似 E2E、完整 Chapter 2 Present puzzle 的重複腳本或新的 Windows E2E harness；e2e-only checkpoint 僅為六個白名單場景準備可視地點，不影響產品行為。
- 不在 HPA-853 生成圖片或音效，不把藝術缺口誤當「加一個透明可點框」來完成。
- 不把 HPA-852 的所有 800×600 HUD/標題/結算頁問題納入本票。

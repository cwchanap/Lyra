# HPA-853 — 第二章六個調查場景配置：實作計劃

**日期：** 2026-11-14  
**狀態：** Draft implementation plan（尚未實作）  
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
- [ ] 參照 HPA-852 的既有視窗問題；本票測試新增中心點與 NAV 遮擋斷言，但不重構遊戲 HUD 或新建跨平台 E2E harness。

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
- [ ] 在既有 Editor 逐圖將 hotspot rect 與 baked 人物覆在真正物件上；正規化座標以實際圖片為準，**目標中心 x ∈ [0.125, 0.875]**（800×600 下 16:9 cover 可視區）。y 的下限以實際 `.explore-hud nav` 底部和其他 HUD 命中區量度，不寫死數值。
- [ ] Scene 8：平板中的 `clip_player`、`mirrored_caption`、`uploader_header`、`comment_fight` 各有可辨認區域；`saegusa` baked 對準背景中的三枝。
- [ ] Scene 10：先只放 `alley_mouth` 的 4 個 hotspot；**不配置 `ramen_backdoor`**，連 `pickup_shelf`、`exhaust_steam`、`rider_spot`、已入鏡的 `yuzuki` 也等 HPA-1033 重畫後再放。
- [ ] Scene 12：四個 sublocation 的物件及導播、技術員、黑瀨 baked 區域；重點檢查螢幕、人物與狹窄區的 `slit_silhouette` 不搶點。
- [ ] 完成本批可配置場景後，執行 `bun run scenes:compile` + `bun run --cwd apps/game test:e2e:gameplay` 作早期回歸；**Chapter 2 gate 尚未開啟**，兩張待補圖 sublocation 暫時缺失屬施工中狀態。

## 2. Scene 14、16、17：補齊後半調查，等圖後完成 10 個目標

- [ ] 新增 `docs/stories_plan/chapter_2/investigation_scene_{14,16,17}.layout.json`。
- [ ] Scene 14：先配置 `backstage_rear`、`sponsor_corridor`、`seventh_floor_core` 的所有可見熱點及已 baked 人物；**`disaster_center` 的 3 hotspot + 2 character 全部等 HPA-1033 後再放**。
- [ ] Scene 16：`comment_phone`／`voice_memo`、`desk_drawer`、`planning_board`／`board_underlayer` 依實際圖像作可辨識區域；保留原來的 Unlock/Reveal／話題順序，不靠整塊重疊的 hit rect 應付。
- [ ] Scene 17：`hasumi`、`kurose` 的 baked 命中區與手冊、立牌、白板、雨棚分開；不讓 `building_awning` 搶到黑瀨點擊。
- [ ] 完成本批後同樣執行 `scenes:compile` 和 `test:e2e:gameplay`，逐個排除 HUD／viewport 中心點問題。
- [ ] **HPA-1033 美術 PR 合併後**，重新載入 `ramen_backdoor` 與 `disaster_center` 的最新兩張背景，分別一次配置 5 個目標（含老闆／樓宇保全／清潔員 baked）；截圖與新圖對照，確認必需物件沒有被人物遮住。
- [ ] 最終 6 個 sidecar 共有 17 sublocation、59 hotspot、13 character，不能用畫面外假座標或隱藏 fallback 作填表。

## 3. 沿用並微幅擴充既有驗證

- [ ] **配置完整度**：全部 72 個目標完成後，修改 `packages/scripts/compile-scenes.test.ts` 內 `RELEASE_GATED_CHAPTERS` 為 Chapter 1 + Chapter 2。既有 compiler 驗證未知 ID；本 gate 驗證 `layout: null`，不新增全域 compiler hard error。
- [ ] **重疊與 snapshot**：既有 live-corpus test 已要求 warnings 只有 story catalog 那一項，所以新增 hotspot overlap warning 本來會失敗；不新增另一個 overlap analyzer。更新 live-corpus snapshot 以承認 layout 參與 emitted chapters 及 `contentRevision` 的**預期變更**；開發存檔可以依 pre-release 政策不相容，無須 schema migration。
- [ ] **viewport 中心點（所有已配置 chapter）**：在 `apps/game/e2e-tauri/investigation-layout.e2e.ts` 現有 `shippedPlacements()` 檢查中，新增 800×600 目標中心點在 viewport 範圍內的 assertion；保留原有 44px 可見跨度、compact variants 和 pending cue 檢查。若少數既有 HPA-852 sidecar 會失敗，允許在本 PR 補最小的 Sidecar rect 調整並在 PR 註明；不得藉此開展 HUD 重寫。
- [ ] **NAV／HUD 命中（只針對 HPA-853 六場景）**：重用**同一個 E2E 檔**及已有 scene jump/checkpoint 工具，在真實調查畫面及最高可見地點數的狀態量度 `.explore-hud nav` 的 DOM rect；比對本票 17 個 sublocation 中各目標的中心（必要時 `document.elementFromPoint`），確認不在地點列與 PROGRESS 的遮擋／命中區，沒有 fallback reroute。不要另建 E2E suite 或視窗工具。
- [ ] Scene 8、16 的相鄰小物件與 Scene 12、14 的上緣目標特別注意；若 live NAV 實際存在 4 地點換行，先調 Sidecar 落在安全區。五地點 Scene 4 的整體 HUD 問題仍屬 HPA-852。

## 4. 驗證與交付紀錄

- [ ] `bun run scenes:compile`
- [ ] `bun run test:scripts`（Chapter 1 + Chapter 2 live-corpus gate / snapshot）
- [ ] `bun run check:scripts`、`bun run check`、`bun run --cwd apps/game check:e2e`、`bun run format:check`
- [ ] **每批 sidecar 後：** `bun run --cwd apps/game test:e2e:gameplay`。這是包含 `investigation-layout.e2e.ts` 的 suite；`test:e2e:smoke` 不包含此測試，僅作一般回歸。
- [ ] **PR ready 前**在 GitHub Actions 啟動既有 `E2E Full` workflow 並確認結果；不為 HPA-853 新建 runner。
- [ ] **17 個 Editor overlays** 對應真實背景圖，核對每個 hit rect 是否對準物件／已入鏡人物。HPA-853 沒有 Linear UI mockup；使用原圖與編輯器疊圖為視覺基準。HPA-1033 合併後再檢查補圖的 2 個子場景。
- [ ] **macOS／Windows 800×600 畫面驗收**：至少保留 Scene 12、14（4 地點列）的場景截圖，比較 NAV 是否因字體差異換行、是否遮到目標；不新增 Windows packaged E2E harness、不要求兩平台逐一操作 72 個點，也沒有人工簽核。
- [ ] 由既有 `gameplay` suite 驗證 800×600 全目標中心／可點性／HUD 與提示；不重跑較大視窗的額外 smoke。新 sidecar 引起的必要測試差異需記錄在本 PR。
- [ ] 確認無 `OFF-SCENE TARGETS / UNPLACED`，且案件 Markdown、證物、解鎖狀態、角色話題、存檔 schema 不變。
- [ ] 不列 Android/Linux 端到端驗收；既有 CI 照常執行。

**這張 PR 目前仍只有規劃文件；上述 E2E 與美術驗收是後續實作要求，並非本次已通過的測試。**

## 5. Acceptance Criteria（HPA-853 完成時全部成立）

1. [ ] **單一 HPA-853 PR** 中六個 sidecar 存在，17/17 sublocation、59/59 hotspot、13/13 character 全部配置；兩張重畫背景的 10 個目標在獨立 HPA-1033 PR 合併後一次完成。
2. [ ] 800×600 的既有 packaged `gameplay` E2E 證明：已配置目標中心位於 viewport，六個場景的真實 NAV／HUD 未遮住必要命中區，提示點在正確可點區內；滑鼠及鍵盤操作能觸發正確的調查／話題。
3. [ ] macOS／Windows 的 800×600 UI 截圖確認四地點 Scene 12、14 不因字體或地點列換行而遮住物件／人臉；17 張 Editor overlay 與真實背景圖（包括 HPA-1033 的兩張新圖）完成視覺核對，無須人工簽收或 Windows E2E runner。
4. [ ] `scenes:compile`、scripts 靜態檢查／單元測試、`test:e2e:gameplay` 及 PR ready 前 `E2E Full` 通過；Chapter 1/2 release-gated placement gate 無漏配或新重疊 warning。
5. [ ] live-corpus snapshot 反映預期 `contentRevision` 變更；沒有修改故事推理、Reveal/Unlock、schema 或新增相容性機制。HPA-852 全域 HUD 改版仍獨立。

## 6. 不應做的事

- 不修改 `InvestigationSceneSurface.svelte` 以「自動猜」熱點或隱藏 fallback 警示。
- 不更動 `InvestigationLayoutSidecar` v1、Scene schema、故事存檔、Chapter 2 的調查關卡／證物／主線伏筆。
- 不建立第二套布局工具、圖片座標產生器、泛用碰撞引擎、大量相似 E2E 或新的 Windows E2E harness。
- 不在 HPA-853 生成圖片或音效，不把藝術缺口誤當「加一個透明可點框」來完成。
- 不把 HPA-852 的所有 800×600 HUD/標題/結算頁問題納入本票。

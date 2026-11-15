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

- [ ] 確認 `main` 現行 Scene 4/5 sidecar 格式與 Scene 8/10/12/14/16/17 的 Markdown IDs 沒有被後續 PR 更動。
- [ ] 執行 `bun run scenes:compile`，確認現有場景／資產都能載入；記錄原有 warnings、scene content hash，避免本票改出不相關的變動。
- [ ] 以 `bun run dev:editor` 開啟 Chapter 2 六個 scene，確認所有 17 個 sublocation 背景 ID 和圖片可顯示；核對 Scene 10/14 人物是否仍未入鏡。
- [ ] 等待 HPA-1033 補圖並合併前，可以先做 **69 個**現有可辨識目標；**不得為尚未畫出的 3 個角色寫假 baked layout**。
- [ ] 以 HPA-852 記錄的 800×600 問題作交叉檢查，特別注意上方地點列、PROGRESS 與玩家可操作中心。

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

## 1. Scene 8、10、12：先配置可見部分

- [ ] 在 `docs/stories_plan/chapter_2/` 新增：
  - `investigation_scene_8.layout.json`
  - `investigation_scene_10.layout.json`
  - `investigation_scene_12.layout.json`
- [ ] 在 Editor 逐圖拖拉 hotspot rectangle 至真正物件，測試 800×600 的裁切／HUD 安全區／標記位置；被隱藏的 hotspot 仍需有 layout。
- [ ] Scene 8：`leaked_clip_thread` 的平板上 `clip_player`、`mirrored_caption`、`uploader_header`、`comment_fight` 需各有可辨認可點區；天橋 `saegusa` 只能覆蓋已畫入背景的人物。
- [ ] Scene 10：`rider_spot` 定在乾燥等單區而非柚木本人；`yuzuki` 點擊區與取餐架／後門不搶點；`ramen_owner` 等美術交付。
- [ ] Scene 12：畫面中的導播、技術員、黑瀨使用 baked；逐一確認熱門畫面和人身不重疊，特別留意低窄角落 `slit_silhouette`。

輸出：三個 sidecar 的所有其他目標可由圖中操作；不得額外改寫劇情、圖片或案件解鎖條件。

## 2. Scene 14、16、17：補齊後半調查

- [ ] 新增：
  - `investigation_scene_14.layout.json`
  - `investigation_scene_16.layout.json`
  - `investigation_scene_17.layout.json`
- [ ] Scene 14：先配置後場、通道、防災中心三個物件、七樓四個門／窗，以及原本已 baked 的 event_security、kurose；確認 `logistics_board`、`m03_door`、`access_terminal`、`alarm_panel` 是**不同來源物件**。
- [ ] **HPA-1033 合併後**，重新用 Editor 看 `ramen_backdoor` 與 `disaster_center` 新背景：以 `kind: "baked"` 為 `ramen_owner`、`building_guard`、`building_cleaner` 配置各自明確可見的人物區，避開取餐架、門禁終端與防災面板。
- [ ] Scene 16：`comment_phone`、`voice_memo`、`desk_drawer`、`planning_board`、`board_underlayer` 各有來源可對應；如有依序解鎖／揭露，保留現有劇情邏輯，僅調整區域，不以互蓋方式掩飾。
- [ ] Scene 17：確認蓮見、工作手冊、等身立牌、白板等實際圖像位置；大樓門口黑瀨仍可點，`building_awning` 不落到人物身上。

輸出：另三個 sidecar 與前述三個形成完整 72 目標布局；所有互動點繼承現有 story IDs、evidence source、reveal、角色話題及狀態。

## 3. 在原有測試上增加完成門檻

- [ ] 修改 `packages/scripts/compile-scenes.test.ts` 現有 live-corpus placement gate：在全部 sidecar 補齊後，將 `RELEASE_GATED_CHAPTERS` 擴為 Chapter 1 + Chapter 2；只檢查原有已編譯 `layout: null`，不另造 validator／新 compiler error。
- [ ] 既有 `apps/game/e2e-tauri/investigation-layout.e2e.ts` 已針對所有已配置的場景測試 800×600 裁切與 pending cue；保留該路徑。若只靠原測試無法發現 HUD 覆蓋／目標被 fallback reroute，**最少量**加一條實際 packaged gameplay 回歸：Chapter 2 六個 scene 的 17 子場景，核對實際未出現 off-scene 清單、主要 hotspot / witness 可用滑鼠或鍵盤觸發，無必需互動被 HUD 擋住。
- [ ] 如仍有 hotspot overlap warning，優先修改 layout，不新增 `intentionalOverlaps` 來繞過真正錯位；如有本已刻意重疊者，記錄兩個點位的可用交互證據。
- [ ] 確認沒有誤改 `*.md` 劇情、編譯 scene IDs、證物取得、存檔格式、人物出場狀態。

## 4. 驗證與交付紀錄

- [ ] `bun run scenes:compile`
- [ ] `bun run test:scripts`（含擴充 production-corpus gate）
- [ ] `bun run check:scripts`、`bun run check`、`bun run format:check`
- [ ] `bun run --cwd apps/game test:e2e:smoke`（使用專案現有 packaged Tauri E2E；必要時增開針對性 Chapter 2 layout journey）
- [ ] **macOS 800×600**：以 packaged game 在六個 scene / 17 個子場景跑可見性、命中、對話／話題；至少留存每個子場景的 editor overlay 與對應 game viewport，異常點截圖標出覆蓋源。
- [ ] **Windows 800×600**：相同端到端巡檢；確保最低視窗、字體與 HUD 行為沒有導致 fallback 回流。平台可由自動化測試與截圖記錄完成，**不以人工簽收為驗收條件**。
- [ ] 選 800×600 外另一個較大視窗跑簡短煙霧，以防大小改變時目標被擠回 fallback。
- [ ] 視覺檢查對照**實際場景圖片**與 17 張 Editor overlay；本票沒有額外 UI mockup。Scene 10、14 補圖由 HPA-1033 的對照驗證完成後，再核對 baked 命中位置。
- [ ] 同步確認六個 scene 均無「OFF-SCENE TARGETS / UNPLACED」面板，不是單純未開啟面板或點擊仍能通關。
- [ ] 無需 Android/Linux 手動或端到端驗收；Linux 依現有 CI 即可。

以上指令與巡檢是**後續實作驗收**，本 Draft PR 目前僅新增計劃，**尚未聲稱測試通過**。

## 5. Acceptance Criteria（完成 HPA-853 時必須全部成立）

1. [ ] 六個 `.layout.json` 存在、scene/sublocation/hotspot/character ID 皆與編譯內容相符，**59/59 hotspot 與 13/13 character** 都有合法布局且具可視來源；不再渲染 off-scene fallback。
2. [ ] macOS 與 Windows 的 packaged game 在 800×600 下，17 個子場景可逐一到達，畫面物件與角色可見，所有必要互動均能被滑鼠點擊與鍵盤焦點啟動，沒有 HUD 覆蓋或互相搶點。
3. [ ] 17 個子場景視覺疊圖／截圖核對現有素材；Scene 10、14 三名人物在 HPA-1033 補圖後可見、可點、位置準確；與 Linear 相關的 HPA-852 HUD 問題若未屬本票可調範圍，有清楚記錄而不是假稱全域修好。
4. [ ] Chapter 1/2 existing live-corpus placement test、場景編譯、必要靜態檢查及 packaged smoke 通過，無新重疊／無配置錯誤；原案件與證據邏輯未改。
5. [ ] **一張 HPA-853 PR** 完成設計、配置及驗證；HPA-1033 的圖片由其**獨立單一 PR**交付，不混入這張 PR。

## 6. 不應做的事

- 不修改 `InvestigationSceneSurface.svelte` 以「自動猜」熱點或隱藏 fallback 警示。
- 不更動 `InvestigationLayoutSidecar` v1、Scene schema、故事存檔、Chapter 2 的調查關卡／證物／主線伏筆。
- 不建立第二套布局工具、圖片座標產生器、泛用碰撞引擎或大量相似 E2E。
- 不在 HPA-853 生成圖片或音效，不把藝術缺口誤當「加一個透明可點框」來完成。
- 不把 HPA-852 的所有 800×600 HUD/標題/結算頁問題納入本票。

# 區域式城市地圖：單一 PR 實作計畫

> 狀態：Draft，程式尚未開始；續作於 PR #89。
> 已重新核對 `main` @ `4feeb0782d99fd9523063ee343f6df5a3d3306ef`。
> [設計規格](../specs/2026-09-12-regional-city-maps-design.md)定義產品與資料契約；[美術交接](../../art/maps/README.md)定義五區背景。
> Task 0～5 是同一支 PR 的順序步驟，不是六張 tickets 或六支 PR。文件、資產、程式與測試在本分支完成，不先合併文件再開另一支 implementation PR。

## 完成定義

完成東京總覽、五張獨立區域背景的資產鏈、二層 UI、Chapter 1 九個既有 travel wrappers，以及多地點往返測試。保持案件順序、證物與 reveal 契約；不新增 Chapter 2～8 playable scenes、Phase、支線或證據板。

本輪完成的是文件。正式區域 PNG、程式與驗收仍待完成；概念拼板不能當正式資產。未被 production scene 引用的區域保持零 usage，不為展示美術新增假場景。

順序為 Task 0 契約確認，接著 Task 1→2→3→4→5。每步先加失敗測試，再做最小實作及回歸。缺圖期間可用測試資料開發；production topology 最終切換必須等正式 PNG 與 anchor 通過。

## Task 0 — 美術、來源與匯入

主要檔案：`docs/art/maps/README.md`、`static/assets/backgrounds/city_map/`。

- [ ] 五區逐張產出 standalone 底圖，不裁切概念拼板。
- [ ] 依 policy 正規化為 1920 × 1080 RGB PNG，保持比例；記錄來源、原尺寸、處理方式、SHA-256、正式路徑與 PR 匯入狀態。
- [ ] 校對既有 `tokyo.png`。更換總覽時同時核對四個 direct anchors，不能把舊座標套在新圖無關建築上。
- [ ] 在實際吉祥寺圖上量測雨鐘與商店街。Brief 百分比只是構圖目標，不是正式座標。
- [ ] 確認保留 `shibuya` location 沒有 authored 引用後轉為 region；有引用則明確處理，不默默移除。
- [ ] 驗收人尺度玻璃箱、箱外觀眾、連續地面、普通外部入口，以及無 UI／文字／內部透視／路線答案。

四個 overview-direct anchors 是暫定呈現決策，不代表故事地址全未知；`chapter_1/scene_5.md` 已明寫首輪審查在吉祥寺，沿設計規格 §3 記錄此來源差異。

**Gate：**每張 PNG 有獨立檢視與匯入紀錄，總覽有沿用／更換判定。缺圖標 pending，不阻止文件 review 或 fixture 測試，但不能宣稱正式畫面完成。

## Task 1 — Topology 與 compiler

修改：`docs/stories_plan/city_map.json`；`packages/scripts/compile-scenes/{city-map.ts,orchestrator.ts,types.ts,emitter.ts}`；`packages/scripts/compile-scenes.test.ts` 及既有 city-map fixtures／tests。

先測 v2 解析、重複 region、未知 region 引用、非法座標、空 prompt、anchor／label 不一致、unused region 與 map-less scene。

1. 沿原 parser 加 regions、location.regionId，更新既有 v1 fixtures；一次 cutover，不增加舊版 fallback 或 converter。
2. 保留 `Map: tokyo` 及九個 anchors。Compiler 保留 scene 全部 referenced regions，包括當下 locked sublocations 所屬區域，供 runtime 日後解鎖。
3. Region ID 不得為根 ID `tokyo`，避免覆蓋總覽 assetId；direct leaf 的 regionId=null。
4. 不改 travel-only null cue、first-cue BGM/BGS、validator／reachability 的 pending-map 規則或單一 topology watcher。
5. assets-off 保留 membership／座標，但各層 backgroundAssetId 均為 null。

**Gate：**同區、多區、direct、locked region 的測試 corpus 可編譯；九個 production wrappers 各保留原本唯一 leaf。PNG 未通過前不完成 production topology 切換。

## Task 2 — 全域資產與 Workbench

修改：`packages/scripts/compile-scenes/assets/enrich.ts`、`enrich.test.ts`；`apps/layout-editor/src/lib/reader-projection.ts` 與 tests、`asset-workspace.test.ts`。`AssetsView.svelte`／`asset-workspace.ts` 只在現有呈現確有缺口時改。

先測總覽加五區共六個唯一 map manifest entries、相同 globalFile、重複 wrappers 不重複登記、assets-off 無 map requests、corpus-first wrapper 不消耗 first visual cue。

沿原 asset-path resolver 登記各區，不增加假的 chapter owner。Reader 使用既有 structuralVisualCue，carrier 為 `map:tokyo`／`map:tokyo:<regionId>`；每 scene usage 依 compile-time referenced regions，不依玩家當前 unlock。Asset-workspace 只消費 Reader facts，不新增 walker。

檢查 source 顯示、Scene Cues、missing-art 路徑與零 usage。本 PR 不新增 map prompt writer；既有 review／apply 不支援 global source 就維持明確 read-only；已支援則測試不同 assetId 共用來源檔時不修改錯誤的 root／region prompt。

**Gate：**六個 entries、正確 usage、missing-art、assets-off 與 first-cue 回歸通過。Unused region 零 production usage 是正確結果。

## Task 3 — Rust wire 與投影

修改：`apps/game/src-tauri/src/game/{schema.rs,view.rs,mod.rs}`、現有 investigation／map Rust tests、`apps/game/src/lib/state/types.ts`。

先測 locked region 初期不出現、既有 unlock 條件成立後才投影、hidden／locked leaf 不可由總覽進入、direct node 正常。

只擴充 definition／view 的 camelCase wire。Rust 先沿原 visible／unlocked 判定取得合法 nodes，再保留有合法 node 的 regions；不在前端以 chapter number 重算權限。

保留 `enter_sublocation` 為唯一 travel mutation，保留既有合法性判定、pending-map law、map-less auto-entry 與 wrapper transaction。Current 為 None 的 mapped scene 不 auto-enter，也不讓空 outro 偷跑。

**Gate：**不增加 save 欄位、migration、region／travel IPC 或第二套 navigation state。存讀檔測試使用同一重編譯 corpus；舊 saves 依既有 pre-release policy，不承諾跨 corpus 相容。

## Task 4 — 二層 UI、返回與 reset

修改：`apps/game/src/lib/components/InvestigationMapView.svelte`、`InvestigationMapView.test.ts`、`ExploreView.svelte`、`ExploreView.test.ts`；**`apps/game/src/routes/+page.svelte`、`page-source.test.ts`**。

沿現有 MapView；只有消除重複推導時才抽局部 pure helper，不為每區新增 component 或全域 store。

- [ ] Pending：唯一非空 region 直接開子圖；混合／direct 開總覽。仍需點 leaf 才 travel。
- [ ] Browsing：region／overview 無 callback；pending 沒有取消回 interior；interior 開圖後取消或選目前地點均無 IPC。
- [ ] Travel：其他合法 leaf 才呼叫現有 callback；失敗保留地圖與錯誤，成功依回傳 current／scene／mode 關圖，不額外 advance。
- [ ] Reset：用既有 `presentationState.sessionEpoch`、chapter ID、scene ID 作 ExploreView reset 身分；同 ID 讀檔也重設，普通 revision 更新不重設。Current sublocation 改變時關閉 browsing。
- [ ] Blocking：保留 GameShell 的既有 inert，傳遞 `gameState.inFlight || gameplayInteractionBlocked` 作 disabled，handlers 亦檢查。地圖不增加全域 Escape listener。
- [ ] Projection：active region 沒有合法 destination 時退回初始 plane 規則，不停在死頁。
- [ ] Geometry：完整 16:9 plane、實際建築 anchor、無 object-cover 裁切、長 label 溢出或重疊 hits。
- [ ] Accessibility：窄窗清單與寬窗 pins 同源；清單可操作時圖上 markers 非互動，不重複 tab stops。至少 44px hits、可見 focus、返回 focus、reduced-motion。
- [ ] Loading：plane key 為 `tokyo:overview`／`tokyo:<region>`，不能只用 nullable assetId。切區移除舊 raster，載入中使用 neutral／placeholder 加新區目的地。
- [ ] Race：controllable promises 測 A→B→A 舊成功、舊失敗及舊 image-error；不可把新區 markers 配在舊 raster。失敗仍保留文字 travel。

Host 已有 sessionEpoch 與 gameplayInteractionBlocked，直接接到 ExploreView，不造 load event bus。Page source test 鎖定 host 接線；元件行為仍由實際 render／interaction tests 覆蓋。

**Gate：**瀏覽／取消不改 durable revision、history、inventory、entry reveals；同 ID 讀檔無殘留。必須測返回與失敗，不只測第一次進入。

## Task 5 — Chapter 1 與 Tauri 驗收

修改測試：`apps/game/e2e-tauri/{production-anchors.ts,investigation-layout.e2e.ts,save-resume.e2e.ts,production-journey.e2e.ts}`；`apps/game/src/lib/e2e/pending-acquisition-drain.ts` 與 tests 只在必要時調整。

Chapter 1 source 原則不改。`map NN` 表示既有 `investigation_scene_map_NN.md`；下表沿 HPA-601 route 作回歸依據。

| Wrapper | 唯一 leaf | 初始 plane |
| --- | --- | --- |
| map 01 | `rain_bell_cafe` | 吉祥寺 |
| map 02 | `police_meeting_room` | 總覽 direct |
| map 03 | `kagami_review_room` | 總覽 direct |
| map 04 | `kichijoji_shopping_street` | 吉祥寺 |
| map 05 | `rain_bell_cafe` | 吉祥寺 |
| map 06 | `outsourced_review_office` | 總覽 direct |
| map 07 | `kagami_review_room` | 總覽 direct |
| map 08 | `rain_bell_cafe` | 吉祥寺 |
| map 09 | `soma_detective_office` | 總覽 direct |

`data-map-destination` 只表示 gameplay leaf；`data-map-region` 只瀏覽。只渲染目前互動層的 buttons，不留隱藏副本給測試。

`soleMapDestinationId` 保持只判 leaf。測試若刻意返回總覽，先按明確預期 region，再找 leaf；沒有 leaf 時不得自動 advance 或隨便選第一區。一般 Chapter 1 drain 從預設 plane 找唯一目的地。

多區、direct、locked 及往返由 compiler fixture、Rust tests、Svelte tests 覆蓋；不把測試 Chapter 2 打包成正式故事，不新增平行 E2E harness。Tauri E2E 跑既有 production Chapter 1。

| 情境 | 驗收 |
| --- | --- |
| 九次導航 | 順序、唯一 leaf、無新增台詞／證物 |
| 總覽往返 | 畫面切換不改進度，最後仍可點原 leaf |
| 連按／busy | 不重複 travel、不跳過下一 scene |
| Pending 存讀檔 | 仍等待點 leaf，無 acquisition replay |
| Interior 開圖再讀同 ID | 恢復存檔 interior，不沿用舊 mapOpen／region |
| 多地點 | 同地點不重播、異地點正常 entry、失敗可重試 |
| 三組視窗 | 1920×1080、1280×720、720px 以下，中文長名與 44px hits |
| 美術／資產 | 五區逐張檢視、總覽校圖、六個 asset IDs 與正確 usage |

使用 Tauri 與既有 WDIO harness 驗收實際 UI，不以 browser-only prototype 代替。逐項比對建築位置、label／引線、圖點 alignment、字體／色彩、窄窗；功能與美術 fidelity 分開記錄。

## 驗證命令

先跑 touched-file 測試，例如：

```sh
bun run test:scripts packages/scripts/compile-scenes.test.ts packages/scripts/compile-scenes/assets/enrich.test.ts
bun run --cwd apps/game test src/lib/components/InvestigationMapView.test.ts src/lib/components/ExploreView.test.ts src/routes/page-source.test.ts
```

具備依賴與 Tauri prerequisites 後跑整合門檻：

```sh
bun install --frozen-lockfile
bun run scenes:compile
bun run check:scripts
bun run check
bun run editor:check
bun run test
cargo test --manifest-path apps/game/src-tauri/Cargo.toml
bun run --cwd apps/game check:e2e
bun run lint:all
bun run test:e2e
```

Root test 已包含 script suite，不在完整驗收重複執行。已建置 E2E binary 依 `CLAUDE.md` 用既有 canonical runner。PNG 匯入後逐檔檢查尺寸、RGB、SHA-256 並重編譯；只記錄實際跑過的命令及結果。

## Self-review 與本輪狀態

| 風險 | 收斂 |
| --- | --- |
| 五區变五套系統 | 一份 topology、一個 MapView、一個 travel callback |
| 缺少 host 接線 | 明列 +page、既有 epoch／inert 與 host test |
| 同場景讀檔漏 reset | session + chapter + scene identity，不依普通 revision |
| 返回地圖改動進度 | 保留 current，取消無 IPC，失敗不預先關圖 |
| Locked region 永不解鎖 | Compiler 保留 metadata，Rust 隨狀態投影 |
| 新 markers 配舊圖 | Plane identity、取消舊載入、A→B→A 測試 |
| Region 被當 travel | 分離 selectors，保留 sole leaf 判定 |
| 美術阻止文件交接 | 文件、PNG、runtime 狀態分開，production 切換仍需美術通過 |

本輪核對了 PR／main、既有文件、compiler／runtime 接點、host session／blocking、E2E leaf helper 與相關 story source。修改限規劃文件；未改 runtime、playable scenes、production topology 或 generated resources。

目前容器無法解析 GitHub git／raw 主機且未安裝 bun；GitHub connector 可讀寫。本輪未執行 scenes:compile、TypeScript／Rust tests、Tauri E2E 或 runtime 畫面驗收。以上 checklist 是後續實作門檻，不是成功紀錄。

設計與實作計畫可先 review；五張正式區域 PNG、匯入、程式及測試仍待完成。PR 保持 Draft，全部續作在同一支 PR。

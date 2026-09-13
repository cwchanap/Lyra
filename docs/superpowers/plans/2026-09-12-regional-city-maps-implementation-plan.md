# 區域式城市地圖：單一 PR 實作計畫

> 狀態：Draft／未開始程式實作。基準 `main`：`4feeb0782d99fd9523063ee343f6df5a3d3306ef`。
> [設計規格](../specs/2026-09-12-regional-city-maps-design.md)為產品與資料契約；[美術交接](../../art/maps/README.md)為五區底圖規格。
> 以下為同一支 PR 的 sequential work checklist，不是六張 tickets 或六支 PR。設計審核後在本 draft 續作，不先合併一支 docs PR 再開另一支 implementation PR。

## 實作完成定義

完成一張東京總覽及五張獨立區域底圖的資產鏈、二層 UI、Chapter 1 九個既有地圖 wrapper 的接線，以及真正可切換地點的 fixture。保持所有既有案件內容、順序、證物與 reveal 契約。

這不是 Chapter 2 內容製作。尚未 author 的診所、劇場、無人車路線與青葉旧址不因美術產出而變成可玩內容。新宿等地圖零 production usage 是可接受且應明示的狀態。

## Task 0 — 美術、來源與地點歸屬確認

- [ ] 取得並逐張檢視 `kichijoji`、`shibuya`、`shinjuku`、`kabukicho`、`ginza_minato` 的完整獨立底圖。不要裁切概念拼板。
- [ ] 正規化為 1920 × 1080 RGB PNG，保留長寬比；記錄原檔與 SHA-256，匯入 `static/assets/backgrounds/city_map/`。
- [ ] 核對總覽 `tokyo.png`；它只需和區域保持識別與大致布局，不需要無縫 zoom 接縫。若更換，使用同一 assetId，檢查四個未分區目的地的位置。
- [ ] 在實際圖上量測雨鐘與商店街錨點；其他 Chapter 1 地點暫留總覽，不自訂行政區歸屬。
- [ ] 確認 `shibuya` 舊保留 location 未被 authored sublocation 引用後，才轉為 region；有引用先記錄並處理，不讓 entry 默默失效。
- [ ] 檢查澀谷玻璃箱是人尺度、群眾在箱外；所有圖不烘焙 UI、文字、角色、路線答案、診所／劇場內部空間。

**Gate：**圖檔尚未匯入或節點對不上時，仍可寫測試，但不切換 production topology，不聲稱已具備正式畫面。藝術性構圖不是已核定案件地理。

## Task 1 — 單一 topology 與 compiler cutover

主要檔案：

- `docs/stories_plan/city_map.json`
- `packages/scripts/compile-scenes/city-map.ts`
- `packages/scripts/compile-scenes/orchestrator.ts`
- `packages/scripts/compile-scenes/emitter.ts`
- `packages/scripts/compile-scenes/types.ts`
- `packages/scripts/compile-scenes.test.ts` 及既有 city-map 相關 fixtures／tests

先寫 parser／compiler 紅測試，再改既有實作：

1. 新 `version: 2` 根形狀含 regions，location 含 nullable regionId。只支援新形狀；更新全部現有 fixtures，不增加舊版相容 parser。
2. 驗證唯一 ID、有效 region 引用、finite normalized coordinates、anchor／label 一致性。保留 unused region，排除重複互動入口。
3. 保留 `Map: tokyo` 與所有既有 Chapter 1 anchors；compiler 以同一 topology 解出 location membership。
4. 在 emitted map 增加 regions 及 node.regionId；每 scene 只附帶它引用的 region 定義。既有 map-less scenes 仍 emit map=null。
5. 不修改 travel-only null visual cue 判定、first-cue BGM/BGS、validator／reachability 的 pending-map 規則、watcher 的单一 city_map.json 來源。
6. assets-off 時 overview 及 region assetId 全為 null，coordinates 仍可使用。

**Gate：**九個 wrapper 每個仍只含原本的一個 destination；不能靠自動進入來滿足 compiler 的 guaranteed-entry 分析。

## Task 2 — 全域背景資產與 Reader／Assets 連通

主要檔案：

- `packages/scripts/compile-scenes/assets/enrich.ts` 與 `enrich.test.ts`
- `apps/layout-editor/src/lib/reader-projection.ts` 及對應 tests
- `apps/layout-editor/src/lib/asset-workspace.ts` 及對應 tests
- `apps/layout-editor/src/lib/AssetsView.svelte`，僅在現有顯示契約確有缺口時修改
- 既有 assetId/path tests；不另外開一套 path helper

1. 沿現有全域 request 登記總覽與五區：六個唯一 manifest entries，來源均為 city_map.json 的 globalFile。
2. 不以假的 chapter/scene owner 填 manifest，不消耗 corpus hadVisualCue。
3. Reader 在 mapped scene 發出總覽及 scene-referenced region 的 structuralVisualCue；穩定 carrier IDs 為 `map:tokyo` 與 `map:tokyo:<region>`。
4. 由現有 asset-workspace 消費 Reader facts，不另遍歷整份 scene JSON。Scene Cues 應同時看見 overview 與真正相關的 region；未使用區域零 usage。
5. 檢查最新 Workbench prompt review／寫回對 globalFile 的支持範圍；多個 assetId 共用一個來源檔時不能修改錯誤 prompt。沒有既有寫回入口就明示 read-only，不擴建 editor。

**Gate：**重編譯多個 wrappers 不造成同一 region 重複登記；assets-disabled 編譯無 map manifest；missing asset report 要能指到正確 region。

## Task 3 — Rust wire 與可見性投影

主要檔案：

- `apps/game/src-tauri/src/game/schema.rs`
- `apps/game/src-tauri/src/game/view.rs`
- `apps/game/src-tauri/src/game/mod.rs`
- 現有 investigation／map runtime unit tests
- `apps/game/src/lib/state/types.ts`

只擴充 scene definition／view wire，不改 durable save model。沿既有 `serde(rename_all = "camelCase")` 同步新增欄位。

先測：隱藏／locked node 不出現、僅有 locked node 的 region 不出現、有 unlocked node 的 region 正確投影、regionId=null 的直接目的地正常。

再讓投影依現有合法 sublocation 集合組裝 nodes 與 referenced regions。region metadata 不授予進場權限；過期／猜到的 destination ID 仍由現有 enter_sublocation validation 拒絕。

不得改 pending-map law：current_sublocation_id=None 時不 auto-enter、不 auto-outro；真正選中唯一 wrapper destination 後同一 command 只 advance 一次。

**Gate：**map-less auto-entry 不退化；pending-map 存讀檔仍停在選擇前；沒有新增 travel／region IPC、存檔欄位或 migration。

## Task 4 — 二層 UI 與最小返回地圖

主要檔案：

- `apps/game/src/lib/components/InvestigationMapView.svelte` 及對應 tests
- `apps/game/src/lib/components/ExploreView.svelte` 及對應 tests
- 可新增一個局部 pure projection helper，只有在實際消除重複推導時才抽出

在既有 MapView 擴充 overview／region 分頁，保留一份 destination projection 和一個 onTravel callback。暫不為每區造一個 Svelte component。

- [ ] 唯一非空 region 直接開子圖，混合／direct destination 開總覽；`東京總覽` 回溯入口可用。
- [ ] region 按鈕只改 UI；leaf 按鈕才 dispatch enterSublocation。
- [ ] Overview 除當前合法 region 外，顯示合法 direct destinations；不渲染空 region、未來章鎖頭或隱藏節點 tooltip。
- [ ] mapped interior 的 `區域地圖` 按鈕只在可操作 Explore 顯示。mapOpen 不清除 currentSublocationId，取消與選目前地點只關閉；選其他地點用既有 command。
- [ ] scene/session 切換重設 transient UI；pending acquisition、command in flight 及 queue transitions 不被地圖繞過。
- [ ] 地圖 plane、背景與錨點同尺寸；不以 object-cover 裁切不同 aspect 的父容器。
- [ ] 切換 region 或快速切換時，背景與 nodes identity 對齊。取消舊 resolver response；舊 raster 不得配上新 markers。
- [ ] 名稱在窄螢幕仍可讀；地點清單同源，避免雙份鍵盤 tab stops；44px 命中區、focus、鍵盤及 reduced-motion。
- [ ] 圖片失敗仍有原生文字目的地；不因空白圖困住流程。

**Gate：**查看／返回／關閉 region map 對 durable revision、history、inventory、entry reveals 均無影響。mapped multi-node fixture 可往返，不只測首度進入。

## Task 5 — Chapter 1、fixture、存讀檔與 Tauri 驗收

主要檔案：

- `docs/stories_plan/chapter_1/investigation_scene_map_01.md`～`09.md`：原則上不改，只做契約檢查
- 既有 `packages/scripts/__fixtures__/` city-map corpus：追加至少兩區、direct destination、locked node 的非 production fixture
- `apps/game/e2e-tauri/production-anchors.ts`
- `apps/game/e2e-tauri/investigation-layout.e2e.ts`
- `apps/game/e2e-tauri/save-resume.e2e.ts`
- `apps/game/e2e-tauri/production-journey.e2e.ts`
- `apps/game/src/lib/e2e/pending-acquisition-drain.ts` 與相關 tests（只在現有 selector／drain 決策需要適應時修改）

保留 `data-map-destination=<sublocationId>` 表示真正 gameplay leaf；新增 `data-map-region=<regionId>` 僅表示瀏覽入口。不得把兩者都塞進現有自動點擊目的地的 selector。

核心測試矩陣：

| 情境 | 必須成立 |
| --- | --- |
| Chapter 1 九次地圖 | leaf ID／順序不變；每次只有一個可旅行選擇 |
| 查看總覽再返回 | 不 advance、不授予證物、不修改存檔 |
| 唯一 destination 點擊／連按 | 一次合法進場，不跳過下一 scene |
| pending-map 儲存與恢復 | 仍等待玩家選擇，未 replay acquisition |
| mapped interior 看圖再取消 | 回同一位置，不重播 entry |
| 多區 fixture | 可在合法地點切換，locked region 不可繞過 |
| 換 scene／讀檔 | 不残留前一區標籤、背景或 open-state |
| 圖片慢載／失敗 | nodes 和畫面不錯配，文字目的地仍能操作 |
| 1920×1080／1280×720／窄窗 | 地點可讀、44px hits、無 label overflow／遮擋 |
| Reader／Assets | 六個全域資產來源正確，usage 不假造 |

畫面審查在實際 Tauri game 與既有 WDIO harness 上進行，不拿 browser-only prototype 冒充桌面產品。對照選定底圖檢查五項：建築位置、標籤、圖點 alignment、字體／色彩、窄視窗。美術 fidelity 與功能 tests 分別記錄。

## 驗證命令

在已安裝 repo 依賴及 Tauri prerequisites 的工作區執行：

```sh
bun install --frozen-lockfile
bun run scenes:compile
bun run check:scripts
bun run check
bun run editor:check
bun run test:scripts
bun run test
cargo test --manifest-path apps/game/src-tauri/Cargo.toml
bun run --cwd apps/game check:e2e
bun run lint:all
bun run test:e2e
```

大 suite 前先跑 touched-file tests。已建置的 E2E binary 可依 CLAUDE.md 使用 canonical suite runner，不另創平行 E2E script。實作完成後檢查 `file -b static/assets/backgrounds/city_map/*.png` 或等效 metadata inspector。

## 本次設計 self-review

| 風險 | 本計畫的處理 |
| --- | --- |
| 五區做成五套 engine | 一份 topology、一個 MapView、一條 enter_sublocation |
| 子圖每次增加一個多餘點擊 | 唯一 region 直接開子圖，總覽可回看 |
| 進入 mapped interior 後無法回地圖 | presentation-only mapOpen；不加 Rust 清空位置命令 |
| 把 Ch1 變成自由探索 | 九個 wrappers 的唯一 leaf 契約保留 |
| 概念板地理當成 canon | 未分區的四個地點留總覽；未来節點只列美術提案 |
| 插畫提前揭露路線或身份 | 區域圖只畫外部，精確場地圖留在案件資料 |
| 資產只出現於對話、未進 repo | Task 0 明確檢查 PNG 的實際 PR diff，未完成不切換 |
| UI 改版被誤認為 Ch2 已可玩 | production 僅 Ch1，多區以 fixture 驗證 |
| editor 新 prompt 功能更新造成漂移 | 沿 existing globalFile／assetId 路徑檢查，不另造 walker |

## 本次實際驗證狀態

已透過 GitHub connector 檢視 main、現有 topology、map component、ExploreView、compiler parser／asset enrichment、Rust pending-map law、policy、現有 spec 與 E2E／Reader 接點。

目前執行環境無法解析 github.com 以 clone repo，且未安裝 bun；因此**沒有執行 scenes:compile、TypeScript／Rust tests、Tauri E2E 或 runtime 視覺驗收**。以上命令是後續實作門檻，不是測試成功紀錄。本 draft 不修改 runtime、playable scenes 或 generated resources。

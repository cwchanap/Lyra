# 區域式 Anime City Map 設計規格

> 狀態：Draft；設計與實作交接文件，尚未實作 runtime 或匯入五張正式區域 PNG。
> 已重新核對 `main` @ `4feeb0782d99fd9523063ee343f6df5a3d3306ef`；續作於 Draft PR #89。
> 同一功能的資產、程式及測試在本 PR 完成；不先合併文件再另開 implementation PR。

相關文件：[實作計畫](../plans/2026-09-12-regional-city-maps-implementation-plan.md)、[五區美術交接](../../art/maps/README.md)、[既有 HPA-601 設計](2026-08-30-hpa-601-linear-city-map-navigation-design.md)。

## 1. 目標與本次範圍

把「城市背景加零散圓點」改成 **東京總覽 + 區域子地圖**。玩家先記住建築、街道與廣場，再把目的地名稱對到實際畫面位置。不是新增開放世界，也不是把概念展示板直接當作遊戲 UI。

| 層級 | 回答的問題 | 本次責任 |
| --- | --- | --- |
| 東京總覽 | 各區彼此在哪裡？ | 穩定城市輪廓、合法區域入口及既有直接目的地 |
| 區域地圖 | 到這區後可以去哪裡？ | 吉祥寺、澀谷、新宿、歌舞伎町、銀座／港區，各一張獨立背景 |
| 案件空間圖 | 誰看見什麼、如何通行？ | 沿用案件證物／調查場景，不新增第三層通用導航 |

本 PR 的實作目標是二層呈現、資產鏈、Chapter 1 九個既有 travel wrappers，以及非 production 的多地點往返測試。**不撰寫 Chapter 2～8 可玩 scenes，不實作 Chapter 2 Phase、支線、證據板或地點排程。** 美術準備好不代表那些區域已開放。

不包含 GIS、3D、WebGL、自由鏡頭、路徑搜尋、移動費用、時刻表、地圖存檔、地圖 editor、天氣系統、日夜多套資產或新 travel scene type。沿用既有 SvelteKit SPA／Tauri、investigation 及 `enter_sublocation`。

## 2. 已查證的接點與來源邊界

| 關注點 | 現有來源 | 本次處理 |
| --- | --- | --- |
| 全域地點 | `docs/stories_plan/city_map.json` | 單一 topology，由 v1 一次切換 v2 |
| Compiler | `city-map.ts`、`orchestrator.ts`、`types.ts`、`emitter.ts` | 加 region membership 及 scene map metadata |
| 遊戲狀態 | Rust `game/schema.rs`、`view.rs`、`mod.rs` | 擴充 wire／投影，不增加 durable state |
| 地圖呈現 | `InvestigationMapView.svelte`、`ExploreView.svelte` | 二層 plane 與可取消的地圖瀏覽 |
| Session／輸入阻擋 | `apps/game/src/routes/+page.svelte` | 沿用 `presentationState.sessionEpoch`、`gameplayInteractionBlocked` 與既有 shell inert |
| 全域資產 | `assets/enrich.ts`、`@lyra/asset-paths` | 六個背景各登記一次，仍用 `globalFile` |
| Workbench | `reader-projection.ts`、`asset-workspace.ts`、`AssetsView.svelte` | 沿既有 structural visual cue／library source |
| E2E 選點 | `pending-acquisition-drain.ts` 的 `soleMapDestinationId` | 保留唯一 leaf 判定，不把 region 當成 travel |

上表 compiler 檔案位於 `packages/scripts/compile-scenes/`；遊戲元件位於 `apps/game/src/lib/components/`；Workbench 檔案位於 `apps/layout-editor/src/lib/`。

目前 MapView 已有 16:9 共用座標平面，但窄窗會隱藏地點名稱；ExploreView 只在 mapped scene 尚無 current sublocation 時顯示地圖。Rust pending-map law 已阻止 auto-entry／空 outro 偷跑。上述是現況，不應重造。

故事依 repo 的 `final_story_bible.md`、`chapter_1_plan.md`、`chapter_2_plan.md` 與 Chapter 1 scenes；附件 V6.7／V3.8／V0.8 是額外背景，本次不覆蓋 repo 或暗中合併版本差異。構圖提案不是故事 canon。概念圖自動產生的章號、名稱、地理、玻璃展館尺度及室內配置均不是核定資料。

### 2.1 本輪補強

補齊原草稿缺少的 `+page.svelte` 接線、同場景讀檔 reset、取消／失敗 travel 行為、背景與 marker 原子切換、compiler 與 runtime 不同的 region 過濾責任，以及 artwork／implementation／驗收的獨立狀態。

## 3. 分區與既有地點處理

| Region ID | 名稱 | 視覺身份 | 本次 production 使用 |
| --- | --- | --- | --- |
| `kichijoji` | 吉祥寺 | 暖窗低層商店街、咖啡館、車站與綠地 | `rain_bell_cafe`、`kichijoji_shopping_street` |
| `shibuya` | 澀谷 | 大螢幕、廣場、人尺度玻璃箱、外侧街道 | 無；Chapter 2 美術準備及測試 |
| `shinjuku` | 新宿 | 都市高樓中的安靜診所街區 | 無；Chapter 4 美術準備 |
| `kabukicho` | 歌舞伎町 | 劇場立面、窄街、克制紅紫霓虹 | 無；Chapter 5 美術準備 |
| `ginza_minato` | 銀座／港區 | 商業大道與現代高樓的壓縮示意 | 無；Chapter 3 美術準備 |

歌舞伎町是新宿內的街區視圖，不是遠離新宿的另一座城市。銀座／港區合併呈現不表示所有地點可步行抵達。兩者只是顯示範圍，不需要通用多層地理樹。

保留 `police_meeting_room`、`outsourced_review_office`、`soma_detective_office`、`kagami_review_room` 為 `regionId: null` 的 **overview-direct 呈現例外**。保留 ID、label 與既有總覽座標，不用生成美術搬動地點。

來源更正：`chapter_1/scene_5.md` 已明寫首輪審查位於「吉祥寺地方分署審查會場」。所以不能聲稱四個地點的故事區位全都未知；上述 direct 分組是本 PR 暫不重畫／重分配這四個既有 anchor 的呈現決策，不是修改其故事地址。總覽也不得標出與已知場景相反的地理說明。

舊 `shibuya` location 是保留點。確認沒有 authored sublocation 引用後，將它改為 region 定義，不保留重複入口；有實際引用時先明確處理該引用，不默默刪除或猜測替代點。

## 4. 玩家流程與狀態所有權

### 4.1 進入地圖

在 pending-map 狀態，若所有合法 destinations 都屬同一非空 region，直接開該子圖；其他情況開總覽。唯一 region 直接進子圖可避免每次去咖啡館都多點一次，但仍必須點 leaf 才能繼續。

Header 只保留 `東京總覽 / 區域名稱`、現有 scene Summary 與簡短的 `區域示意圖` 說明；不要帶入概念板的章節清單、進度統計或新選單。第一次地圖用非劇情提示說明目前只有一個目的地，不新增導覽對話。

總覽顯示合法 region 按鈕及 `regionId: null` 的直接目的地；子圖只顯示該區合法 leaves。兩層不能同時渲染同一個 leaf 的第二個可點副本。

### 4.2 操作契約

| 操作 | 畫面結果 | 遊戲狀態／IPC |
| --- | --- | --- |
| 點 region／返回總覽 | 切換 plane | 無 IPC、無到訪／證物／history 變更 |
| 點非目前 leaf | 交給既有 `onEnterSublocation(id)` | 只執行原有 travel mutation |
| 在 interior 開地圖 | 顯示目前地點所屬子圖；direct 則總覽 | current sublocation 保持不變 |
| 取消瀏覽／點目前 leaf | 回原 interior | 無 IPC，不重播 entry reveal |
| Travel 失敗 | 保留可重試的地圖與既有錯誤顯示 | 不預先關圖、不標記已到達 |
| Travel 成功 | 使用回傳 scene／mode／current sublocation | 不額外發第二個 advance 或確認指令 |

只有 Explore 且沒有阻擋輸入時可開啟／操作地圖。維持 `SublocationNav` 在 mapped scenes 隱藏。`區域地圖`／`返回現場` 是同一 travel surface 的入口與取消，不是第二套 navigator。

Pending map 沒有可取消回去的 interior，不能顯示會繞過唯一目的地的「返回現場」。只有 current sublocation 非 null 才顯示取消。

沿既有 GameShell 處理 Escape 與較高層對話框，不新增全域 key listener 搶走 acquisition／save／menu 的鍵盤控制；地圖提供原生返回按鈕。

### 4.3 Transient reset

`mapOpen` 只由 ExploreView 持有；`activeRegionId` 只由 MapView 持有，null 表示總覽。hover／focus／載圖狀態亦只在呈現層，不加 store、save 欄位或 travel IPC。

`+page.svelte` 用既有 session epoch、chapter ID、scene ID 作 ExploreView 的 reset 身分（keyed subtree 或等效明確 reset prop）。**成功讀入同一 scene ID 的存檔也必須重設**；單靠 scene ID 不足。不得以每次 state object 或 durable revision 更新作 key，否則一般操作也會把畫面重置。

ExploreView 在 current sublocation 確實改變時關閉 `mapOpen`；失敗指令不改 current，因此保留畫面。離開 Explore／切 scene／換 session 亦清除 transient browsing。若投影更新使 active region 不再有合法 destinations，退回上述初始 plane 規則，不留死頁。

讀檔結果：current 非 null 恢復 interior；current 為 null 恢復 pending map，依目的地集合選初始 plane。套用既有 session replacement 與 game-state application 路徑，不另造 load event bus。

`+page.svelte` 繼續保有 shell inert，並把 `gameState.inFlight || gameplayInteractionBlocked` 傳為地圖相關 disabled；地圖事件處理也檢查 disabled。沒有新 modal，也不複製 acquisition／persistence 的狀態機。

### 4.4 Chapter 1 不變條件

`investigation_scene_map_01`～`09` 保留原順序、Summary、anchor 及唯一 unlocked leaf。不新增車站、便利店、公園、支線或證物；查看總覽不是第二條故事路線。

Rust current 為 None 的 mapped scene 不 auto-enter／auto-outro。點唯一目的地後由原 command transaction 前進一次。多地點 fixture 驗證來回導航，不宣稱已完成 Chapter 2 自由調查內容。

## 5. 視覺、座標與載圖契約

每張底圖為獨立 1920 × 1080 RGB PNG；依 `static/assets/config/policy.yaml`，無文字、UI、章號、pin、前景對話角色或路線答案。沿用 Lyra 字體與色彩 tokens；背景暖窗只是美術，不代表 unlocked。

位置取自實際建築入口／地標；生成 brief 的百分比只是構圖區域，不能未量測就當正式座標。標籤與簡短引線不改 anchor。不要假裝 raster 中的建築可以獨立發光，也不為此加 segmentation／3D。

Plane、圖片及 anchor 共用 16:9 normalized 座標，完整顯示、letterbox、不按視窗比例 object-cover 裁切。背景與最主要入口保留低干擾空間；每次換圖都要重驗其 anchor，不保留與新建築無關的舊圓點。

| 情境 | 呈現要求 |
| --- | --- |
| 一般桌面 | 原生具名按鈕、至少 44px 命中區、可見 keyboard focus |
| 窄窗或標籤密集 | 同一 destinations 資料投影為簡單文字清單，圖上錨點作非互動位置提示 |
| 圖面／清單切換 | 只保留一組 interactive destinations／tab stops，不重複宣讀 |
| Region 切換 | focus 移至地圖標題／首個可用入口；返回則優先回原 region 按鈕 |
| 圖片載入失敗 | 現有 placeholder 加具名目的地仍可操作，不以 placeholder 當美術驗收成功 |

名稱不能像目前窄窗規則一樣直接消失。測試 1920 × 1080、1280 × 720 及 720px 以下視窗的長中文名稱、按鈕邊界與 UI 遮擋；不新增全域 label collision engine。

### 5.1 Plane 原子切換

每個 plane 有獨立身分：`tokyo:overview` 或 `tokyo:<regionId>`。不要用 nullable backgroundAssetId 當唯一身分，assets-off 時各圖的 assetId 都是 null。

Raster 與 markers 必須屬同一個 active plane。最小實作採 keyed plane／圖片子樹：換區立即移除舊 raster，載好新圖前顯示 neutral／placeholder 與新區目的地。不要讓 CrossfadeImage 保留的舊圖承載新區 markers。

延用取消舊 resolver 的模式；late resolve、reject、image-error 都不能覆蓋新區。A→B→A 的競態也要測。無需無縫 zoom、hover pan 或循環粒子；首版換 plane 可直接切換，任何短淡入都遵守 reduced-motion。

## 6. 資料設計：同一份 topology

保留 `docs/stories_plan/city_map.json`。只支援一次性 v2 cutover，更新現有 fixtures 並重編譯；不增加 v1 fallback 或 migration converter。

```ts
type CityMap = {
  version: 2;
  id: "tokyo";
  backgroundPrompt: string;
  regions: Array<{
    id: string;
    label: string;
    x: number; // 東京總覽的區域入口
    y: number;
    backgroundPrompt: string;
  }>;
  locations: Array<{
    id: string; // 既有 sublocation anchor
    label: string;
    regionId: string | null;
    x: number; // 有 region 時屬子圖，否則屬總覽
    y: number;
  }>;
};
```

Topology 只管 ID、label、membership、prompt、座標，不管 chapter、phase、unlocks、visited／completed 或交通。區域瀏覽不新增 persisted flags。

Validation：沿用非空 snake_case ID、非空 label／prompt、finite `[0,1]` 座標；各集合 ID 唯一、region 引用存在。Region ID 不得為根 ID `tokyo`，以免覆蓋總覽 assetId。Region／location 是不同用途，但不得保留舊 `shibuya` 的重複入口。Unused regions 合法。

保留 authored `- **Map:** tokyo`、既有 anchor／label 一致性及 travel-only null visual cue；不更動 first-cue BGM/BGS、validator／reachability 的 pending-map 分析或單一檔案 watcher。

```ts
type JSONInvestigationMap = {
  id: "tokyo";
  backgroundAssetId: string | null;
  regions: Array<{
    id: string;
    label: string;
    x: number;
    y: number;
    backgroundAssetId: string | null;
  }>;
  nodes: Array<{
    sublocationId: string;
    regionId: string | null;
    x: number;
    y: number;
  }>;
};
```

**Compiler** 附帶 scene 全部 mapped sublocations 引用的 regions，包括當下尚未 unlocked、之後可能解鎖者；不能在 compile 時把它們永久刪掉。**Rust view** 每次依現有 visible／unlocked 判定過濾 nodes，再只保留有合法 node 的 regions。不要在前端以 chapter number 重算解鎖。

UI 只從過濾後的 nodes 取得 labels／callbacks；不可藉 tooltip、ARIA、DOM 或 overview 入口展示隱藏目的地。Region metadata 不授權 travel；`enter_sublocation` 仍作最終合法性判定。Map-less scenes 仍為 map=null。

Rust schema、view、compiler JSON 與 frontend types 一起更新 camelCase wire；不複製一套平行 registry 到 `@lyra/scene-types`。沒有新增 save 欄位不代表舊 corpus 的 saves 必然相容；沿既有 pre-release save policy，不寫遷移器，存讀檔驗收使用同一重編譯 corpus。

## 7. 資產與 Workbench

六個 asset IDs 為 `background.city_map.tokyo` 及 `background.city_map.<regionId>`，路徑仍經 `@lyra/asset-paths` 到 `static/assets/backgrounds/city_map/<id>.png`。不得新增 resolver 或每個 wrapper 複製一份 prompt。

`assets/enrich.ts` 為總覽及五區各登記一次 request，保留 `source: { globalFile: cityMap.sourceFile }`，不捏造 chapter owner、不消耗 corpus first visual cue。Assets-disabled 時所有層的 backgroundAssetId=null、沒有 map manifest entries，但地點與分區仍可操作。

Reader 對每個 mapped scene 的總覽及 compile-time referenced regions 發出既有 `structuralVisualCue`，carrier 為 `map:tokyo`／`map:tokyo:<regionId>`。這表示可使用的資產，不是到訪紀錄；未被 production scene 引用的區域 usage=0 才正確。

只由既有 asset-workspace 消費 Reader facts，不新增第二個 scene walker。沿既有 `globalFile` source 顯示；本 PR 不增加 map prompt writer。若既有 review／apply 不支援 global source，維持明確 read-only，不讓可按的 Apply 寫錯總覽 prompt；若已支援，必須以 assetId 區分 root 與 region，測試修改目標不串位。

## 8. 故事與美術防洩漏

城市圖是示意，不提供比例尺、分鐘或可定罪的視線／行車結論。精確配置仍由案件證物及其揭露時點負責。

澀谷延續左側大螢幕、中央偏左廣場、右後商業樓的識別；玻璃箱改成人尺度直播 booth，群眾在箱外。只畫外部街道／普通服務入口，不透視 M-03、服務梯井或空置樓層。Phase A／B／C 仍由 Chapter 2 plan 控制，不由全知地圖先給答案。

新宿不把接待區、病房及資料室畫成獨立建築；歌舞伎町不畫舞台機關、屍體、藍傘或倒數；銀座／港區不畫犯人改道路線。第 6 章可重用總覽交通輪廓；第 7～8 章不自創區位、青葉入口或終章地圖。

## 9. 驗收與交付邊界

文件審閱、PNG 美術驗收及程式驗收分開記錄。**本輪可完成設計文件；五張 PNG 尚未合格，不得標示已匯入或阻止文件審閱。** 缺圖期間可用既有測試資料完成 compiler／UI 測試，但 production topology 切換必須等實際圖檔與 anchor 通過。

| 驗收 | 通過條件 |
| --- | --- |
| 美術 | 五張獨立區域 PNG、總覽校圖、尺寸／RGB／無 UI／無劇透、實際 anchor 對齊 |
| Chapter 1 | 九個 wrapper、順序與唯一 leaf 不变；沒有自動跳轉或額外劇情 |
| 瀏覽 | Region／overview／取消不改 revision、history、inventory、entry reveal |
| 多地點 | 進入、返回、取消、目前地點不重播、其他地點可切换；失敗仍可重試 |
| Reset | 同 ID 讀檔、跨章重複 scene ID、切 scene 均無舊瀏覽狀態 |
| 載圖 | A→B→A 慢回應／失敗不錯配 raster 與 nodes；assets-off 仍可操作 |
| 可用性 | 三組視窗、中文長名、44px hits、單一 tab order、focus、reduced-motion |
| 資產链 | 六個唯一 global entries、正確 Reader usage、unused region 零使用 |
| 回歸 | 同 corpus 存讀檔、現有案件順序、map-less auto-entry 與 Tauri journey 不退化 |

維持 Draft。完成資產匯入、程式與指定測試後才可標 ready；不能拿對話概念板、placeholder 或文件審阅冒充 runtime fidelity 驗收。

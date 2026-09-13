# 區域式 Anime City Map 設計規格

> 狀態：Draft；本次先交付設計、分區美術規格與實作計畫，尚未實作 runtime。
> 基準：`main` @ `4feeb0782d99fd9523063ee343f6df5a3d3306ef`，2026-09-12。
> 本功能的程式、測試及正式資產匯入都在同一支 draft PR 續作；不另拆一張 ticket 對多支 PR。

相關文件：[實作計畫](../plans/2026-09-12-regional-city-maps-implementation-plan.md)、[五區美術與節點規格](../../art/maps/README.md)、[既有 HPA-601 設計](2026-08-30-hpa-601-linear-city-map-navigation-design.md)。

## 1. 目標與本次範圍

把「一張城市背景加上零散圓點」改成 **東京總覽 + 區域子地圖**。建築、街道、廣場形成可記憶的空間；文字及互動狀態仍由程式呈現。不是新增開放世界。

| 層級 | 回答的問題 | 範圍 |
| --- | --- | --- |
| 東京總覽 | 這些區域彼此在哪裡？ | 同一張穩定的城市示意；只顯示當下合法的目的地入口 |
| 區域地圖 | 到這區後，可以去哪裡？ | 吉祥寺、澀谷、新宿、歌舞伎町、銀座／港區，各一張獨立底圖 |
| 案件空間圖 | 誰看見什麼、如何通行？ | 沿用案件證物／調查場景；不是第三層通用導航系統 |

本 PR 的實作目標是：完成二層呈現與資產鏈、把 Chapter 1 的既有九個 travel wrappers 接上新畫面，並用非 production fixture 驗證多目的地情況。**不撰寫 Chapter 2～8 的可玩場景、不實作 Chapter 2 Phase／支線／證據板。** 五區美術可先備妥，不代表五區同時開放。

不包含 GIS、3D、WebGL、自由鏡頭、路徑搜尋、移動費用、時刻表、地圖專用存檔、獨立地圖 editor、天氣系統、白天／夜晚多套資產或新的 travel scene type。

## 2. 已查證的基礎與來源邊界

- `docs/stories_plan/city_map.json` 現有根 ID 是 `tokyo`、`version: 1`，包含六個 Chapter 1 地點及保留的 `shibuya` 點；目前沒有 region membership。
- `packages/scripts/compile-scenes/city-map.ts` 只接受單一 Tokyo topology。`orchestrator.ts` 與 `emitter.ts` 產出 investigation map。
- `InvestigationMapView.svelte` 已使用同一個 16:9 座標平面；`ExploreView.svelte` 在 mapped investigation 尚無 current sublocation 時顯示地圖。
- Rust 的 pending-map law 阻止自動進入及空 outro 偷跑；旅行仍由 `enter_sublocation` 完成。這些規則不改。
- 全域底圖經 `assets/enrich.ts` 登記為 `background.city_map.tokyo`，來源是 `globalFile`；Reader／Assets 已有 structural visual cue 路徑。
- 資產政策要求背景為 1920 × 1080、不透明 PNG、grounded anime neo-noir、無可讀文字及 UI。

故事來源為 repo 的 `final_story_bible.md`、`chapter_1_plan.md`、`chapter_2_plan.md` 及 manifest-listed Chapter 1 scenes；對話所附 V6.7／V3.8／V0.8 提供額外規劃背景。本次**不把附件全文覆蓋 repo，也不暗中同步版本差異**。美術構圖是提案，不是新增故事 canon。

對話概念板只核定美術方向與分區想法，並未核定其自動生成的文字、章號、地理或室內配置。概念板上銀座章號、咖啡館英文拼法、巨型玻璃展館等，不可反向改寫故事。

## 3. 分區與既有地點處理

| Region ID | 顯示名稱 | 角色 | 本次 production 啟用 |
| --- | --- | --- | --- |
| `kichijoji` | 吉祥寺 | 低層商店街、咖啡館、車站與綠地 | `rain_bell_cafe`、`kichijoji_shopping_street` |
| `shibuya` | 澀谷 | 廣場、大螢幕、玻璃箱與外側街道 | 無；保留 Chapter 2 構圖與 fixture |
| `shinjuku` | 新宿 | 都市高樓中的安靜診所街區 | 無；Chapter 4 美術準備 |
| `kabukicho` | 歌舞伎町 | 新宿內的劇場街區，獨立可讀的子圖 | 無；Chapter 5 美術準備 |
| `ginza_minato` | 銀座／港區 | 兩種街區由主要道路連接的示意 | 無；Chapter 3 美術準備 |

歌舞伎町是新宿內的區域視圖，不是另一座遠離新宿的城市；兩者保持同一城市錨點的鄰近關係。銀座／港區是合併顯示範圍，不宣称所有地點都在步行距離。

`police_meeting_room`、`outsourced_review_office`、`soma_detective_office`、`kagami_review_room` 的行政區域沒有由目前 topology 證實。**保留現有 ID、label 與總覽位置，作 `regionId: null` 的直接目的地**；不能因概念圖漂亮就搬到新宿或吉祥寺。這是明確的過渡呈現規則，不是聲稱已核定真實地址。

保留 `shibuya` 舊 location entry 為非 production 保留點亦可，但它不能與 region 按鈕重複出現。實作時採最簡單的單一表示：確認沒有 authored sublocation 引用後，將它改為 region 定義；遇到實際引用先報出，不臆造目的地。

## 4. 玩家流程

### 4.1 地圖初始畫面

在合法 pending-map 狀態：若所有 projected destinations 都屬同一非空 region，直接開該子圖；否則開東京總覽。上方永遠有 `東京總覽 / 區域名稱` 的明確回溯入口，避免每次去咖啡館都被迫多點一次總覽。

Chapter 1 第一個地圖的提示只說明：可以查看東京總覽，目前只有一個目的地可前往。它不是新劇情、不加導覽對話。

總覽上的 region 按鈕只切換顯示，**不呼叫 IPC、不標記到訪、不觸發 entry reveal、不推进場景**。只有真正目的地按鈕呼叫現有 `onEnterSublocation(id)`。不新增確認對話框。

### 4.2 Chapter 1 不變條件

九個 `investigation_scene_map_01`～`09` 沿用原順序、anchor 與唯一 unlocked destination。每次只有一個可前往的 leaf destination；查看總覽不是另一條故事路線。當唯一目的地在總覽直達時，保留一次點擊進場。

不增加車站、便利店、公園等可玩節點。它們可以是底圖背景，但不能產生假按鈕、支線或新證物。

### 4.3 多目的地及返回地圖

既有 mapped interior 現在會隱藏 `SublocationNav`；因此本次要補齊一個小型、presentation-only 的 `區域地圖` 按鈕，不能只驗證進去而無法再選地點。

只有 Explore 且無阻擋中的 gameplay command／acquisition 時可開啟。`ExploreView` 以短暫 `mapOpen` 顯示地圖，**不清空 Rust 的 current sublocation**。關閉後回到同一室內狀態；點目前地點只關閉畫面，不再次呼叫 enter；點其他合法地點仍用既有 mutation。

`mapOpen`、`activeRegionId`、hover／focus 都是 UI 狀態，不存檔。scene ID／載入的 game session 改變時重設；底圖換頁不重設遊戲進度。讀檔時有 current sublocation 就恢復 interior，沒有就依初始規則顯示地圖。

這只驗證導航容器，不宣稱 Chapter 2 自由調查 lifecycle 已完成。

## 5. 互動與視覺規格

- 使用既有 Lyra 色彩／字體 tokens；底圖是冷藍雨夜與少量暖窗光，UI 是清楚的骨白文字、cyan focus、既有 crimson objective accent。
- 背景的亮燈只是美術，不表示 unlocked。**可去狀態必須同時有文字、按鈕形狀及 focus affordance**，不能只靠顏色或亮度。
- 一個建築錨點對應一個 native button；短引線或標籤可偏移，但實際地點不漂移。hover/focus 強調標籤，不假裝整棟 raster 建築能獨立發光。
- 不把標籤、章號、未解問號、鎖頭、導航路線、對话人物或主線符號畫進底圖。
- 閱讀順序固定：目前目的／區域 → 可去地點 → 地標與背景。持續顯示目的地名稱，不重現目前窄螢幕 `.pin-label { display: none; }` 的失讀問題。
- 延續 16:9 單一 map plane，letterbox 而非裁掉地圖；PNG、錨點與短引線使用同一 normalized coordinate plane。
- 主要按鈕至少 44px 命中區。較窄視窗把長標籤收進旁邊／下方的簡單地點清單，清單與圖上錨點同源同 callback，不成為第二套 navigation state。
- 同一可見版面只設一組鍵盤 tab stops；圖面與清單同時可見時，不重複宣讀兩個相同 destination。
- 靜態底圖配最多短 crossfade；不加入循環粒子、鏡頭漂移或每次 hover pan。`prefers-reduced-motion` 下直接切換。
- 背景載入及載入失敗使用現有 resolver／placeholder。切換 region 時遮蔽舊圖，不能把新座標短暫畫在上一區的底圖上；失敗時文字目的地仍可用。

## 6. 資料設計：只擴充原本一份 topology

保留 `docs/stories_plan/city_map.json`，不要另造 `maps.json`、assets workspace 設定或第二套 location registry。

目標為一次性的 `version: 2` cutover。只支援新形狀、重編譯現有 corpus；無 version-1 parser fallback、無 migration converter。

```ts
type CityMap = {
  version: 2;
  id: "tokyo";
  backgroundPrompt: string;
  regions: Array<{
    id: string;
    label: string;
    x: number; // 在東京總覽的錨點
    y: number;
    backgroundPrompt: string;
  }>;
  locations: Array<{
    id: string; // 既有 sublocation anchor
    label: string;
    regionId: string | null;
    x: number; // regionId 非 null 時為該子圖座標；否則為總覽座標
    y: number;
  }>;
};
```

拓撲只管 ID、label、region membership、prompt、座標；不管章節、解鎖、訪問紀錄、完成度或交通。

必要 validation：region/location ID 唯一、非空字串、所有座標為 `[0,1]` 有限數、region 引用有效、mapped authored anchors／labels 對得上。保留不用到的 region 是合法美術準備；空 region 不產生玩家可點入口。

Authored scene 維持 `- **Map:** tokyo`，不要為第一章複製九份底圖 prompt，也不改 sublocation anchor。Compiler 在每個 mapped scene 附帶它所引用的 region 定義：

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

region buttons 由 Rust 過濾後的 nodes 推導：至少有一個 visible/unlocked destination 才投影 region；不直接把全域 registry 送成互動 UI。未知／鎖定地點的 label、tooltip、ARIA、DOM button 皆不出現。現存的普通建築仍可在 raster 裡。

不新增「visited」等含糊狀態：在未核實原有 progress 欄位前，本版只顯示可去、目前位置及暫忙。不能把「已到訪」畫成「已搜查完畢」。

## 7. 資產與 Workbench

目標 asset IDs 為 `background.city_map.tokyo`、`background.city_map.kichijoji`、`background.city_map.shibuya`、`background.city_map.shinjuku`、`background.city_map.kabukicho`、`background.city_map.ginza_minato`。路徑仍由 `@lyra/asset-paths` 解析到 `static/assets/backgrounds/city_map/<id>.png`，不另加 path mapping。

`assets/enrich.ts` 為總覽及各 region 各登記一次全域 prompt，沿用 `source: { globalFile: cityMap.sourceFile }`，不消耗 corpus first visual cue，不捏造 chapter owner。assets-disabled 編譯時各層 backgroundAssetId 均為 null，manifest 無這些項目。

Reader 對每個 mapped scene 發出總覽及 scene-referenced regions 的既有 `structuralVisualCue`：`map:tokyo`、`map:tokyo:<regionId>`。Assets usage 表示「此 scene 可使用的背景」，不是玩家實際到訪紀錄。新宿等未被 production scene 引用的資產，usage 為零才是正確結果。

不新增第二個 cue walker。確認現有 globalFile 顯示與 prompt review／編輯流程能處理不同 assetId 都來自同一 topology；沿 assetId 找 region，不能把修改澀谷 prompt 誤套在總覽 prompt。若既有寫回不支援 global map，保持 read-only 並清楚顯示，不擴建地圖編輯器。

本次 draft 的美術交接狀態記在 [art index](../../art/maps/README.md)。在獨立 PNG 匯入、尺寸及 anchor 檢查完成前，不切換 production topology，也不把概念板當作正式底圖。

## 8. 故事與美術防洩漏

東京與街區圖都是明示的「區域示意圖」，不提供比例尺、分鐘估算或可直接用來定罪的視線／路線結論。調查證物中的精確配置另有來源與揭露時點。

澀谷保留廣場左側大螢幕、中央偏左的人尺度透明直播箱、右後方商業建築及外侧工作區的可讀關係。先前概念圖把玻璃箱畫成裝得下群眾的建築，必須調整；這不是改寫案件尺度。

底圖不能透視 M-03、服務梯井或空置樓層殺害空間。樓宇外側可見，不等於已證明內部連通。Chapter 2 後勤配置板仍按原定調查階段取得，不能由全知地圖預先取代。

新宿只畫診所外觀與街區，不能加青葉標記、病房手環、左／右逃生路線；歌舞伎町只畫劇場外觀、公共街巷及服務入口，不畫升降台夾層、屍體或倒數。銀座／港區道路只是美術連接，不畫已知「犯人改道」箭頭或即時車輛軌跡。

第 6 章可沿用總覽交通骨架；第 7～8 章拘留設施、檔案室、青葉舊址的精確區位尚未由此工作核定，**不自創第六區或把終章真相塞入底圖**。

## 9. 可驗收條件

1. 每張 region 為獨立無 UI 的 1920 × 1080 RGB PNG；角色、文字、章號及推理標記未烘焙。總覽不是把五張子圖拼成遊戲畫面。
2. Chapter 1 九個 wrapper 的順序及唯一 leaf destination 完全不变；overview／region 切換不產生 durable mutation。
3. region/location 顯示與 Rust 合法目的地集合一致；不能由總覽繞過鎖定條件。
4. pending map 不 auto-enter／auto-outro；真正點目的地只前進一次；存檔與讀檔不新增 map schema。
5. 多地點 fixture 可進入、返回地圖、取消及切換地點；目前地點不重播 entry reveal。
6. 1280 × 720、1920 × 1080、720px 以下窄視窗：名稱可讀、命中區不重疊、圖點不漂移；鍵盤及 reduced-motion 可操作。
7. 六個背景 manifest entry 不重複；Reader／Assets 能區分總覽與子圖 usage；assets-off、missing-art 也有可讀目的地。
8. 實作與美術審查均完成後才標 ready。Draft 文件通過不等於 gameplay、畫面 fidelity 或 E2E 通過。

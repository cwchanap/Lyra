# HPA-853 — 第二章調查熱點／證人場景配置：設計規格

**日期：** 2026-11-14  
**狀態：** Draft design（僅供規劃，不代表已實作或測試）  
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

美術改動已獨立拆成 **HPA-1033（一張美術 PR）**：只調整這兩張現有背景圖及相應 Background Prompt，人物合理露出且不遮住推理核心物件。**HPA-853 的一張實作 PR 不產生圖片或音效；合併美術後才放置上述三個 baked hit region。**其餘 69 個目標可以先行配置。

## 4. 最小設計決策

### 4.1 保持 sidecar v1；場景 ID 是唯一來源

每個 scene 新增一個同名 `.layout.json`。每個可互動的 Markdown hotspot 使用 `{ kind: "rect", x, y, w, h }`；已畫入背景的 character 使用 `{ kind: "baked", x, y, w, h }`。全部座標依現有 normalized 0–1 合約，在**實際圖片**上以 Editor 擺放，不從文字描述猜精確位置；不新增 parser、schema、runtime state、控制元件或另一個 layout tool。

若背景實際上沒有預期物件，先核對既有圖片／原稿與既有資產，不以假熱點或任意點位滿足數量。非本 ticket 所需的新圖交由美術 ticket 處理。

### 4.2 800×600 安全區與裁切

背景以 16:9 cover 顯示在最小 800×600 視窗，左右有約 133px cover 裁切；場景上緣可能被進度與地點 HUD 蓋住。熱點還有 runtime 72×44px 最小命中區／碰撞壓縮規則。**單純所有 sidecar 欄位不為 null，仍不代表實際能點。**

配置規則：

- 將每個必需目標放在玩家能辨識到的實物、人身或明確來源區，而不是圖片外或 HUD 下；以實際 800×600 測試檢查命中中心、提示標記與互動。
- 熱點與熱點、熱點與 baked 人物不得互相搶點。先縮成各自可辨識的區域；僅在原稿有刻意層疊且兩者互動仍可選時才使用現有 `intentionalOverlaps`，不可拿它消掉真正錯位的警告。
- Scene 8 的 tablet / caption，以及 Scene 16 的舊手機／錄音與企劃板／底頁，須優先利用**不同局部區域、解鎖時序**設計，不將數個 hit box 整塊蓋在一起。
- Scenario 14 的 HUD 或五地點以上地點列佈局如涉及一般 UI 缺陷，記錄並交叉連結 **HPA-852**；不要在配置 PR 裡重做全域 HUD。

### 4.3 編譯、測試沿用原有路徑

編輯中的不完整 sidecar **仍應可編譯**，否則 Editor 無法分段填位置。全部 6 個 sidecar 完成後，才把 `chapter_2` 加進既有 `RELEASE_GATED_CHAPTERS` live-corpus test；要求所有 compiled hotspot 與 character layout 非 null。不要將它改成全域 compiler hard error。

保留 `apps/game/e2e-tauri/investigation-layout.e2e.ts` 的 shipped-placements 裁切驗證；以最小的額外檢查覆蓋本 ticket 六個場景的全目標數量／缺失與 HUD 遮蓋，不另造新 E2E 框架。可採現有 checkpoint/scene jump 方式，以 packaged game 執行實際點擊。

## 5. 範圍邊界與依賴

**本 ticket（一張實作 PR，包括當前設計文件）**：六個 sidecar、必要的既有 production-corpus test / E2E 擴充、編譯及檢視記錄。

**獨立美術 HPA-1033（一張美術 PR）**：兩張背景補上三名角色、同步兩個 Background Prompt。此項是 HPA-853 最後三名角色的完成前置。

**不包含**：新背景及角色美術、音效、劇本及證物取得順序、Reveal/Unlock 規則、第五塊推理板、HUD 全域改版、改 scene JSON/Rust 存檔格式、Android/Linux 手動驗收。

## 6. 驗收契約（端到端，不要求人工簽收）

- 在 **macOS 和 Windows 的 packaged game**，800×600 視窗下逐一開啟六個調查場景的 17 個子場景：所有 **59 個 hotspot + 13 個 character** 以畫面內可辨識區域操作，沒有任何「OFF-SCENE TARGETS / UNPLACED」回退清單（包含 runtime 遮擋回退）。
- 每個目標的中心在可見可點範圍，不在 HUD 下；點擊及鍵盤焦點能觸發正確 inspect/topic，彼此不搶點；必要提示標記落在可見目標內。
- 17 個子場景都有 Editor overlay 截圖，與**對應原始場景圖片**逐一核對；重點檢查 Scene 10、14 三位新增人物及 Scene 8、16 的密集目標。HPA-853 沒有獨立 UI mockup，原圖、既有 Chapter 2 版面及 Editor overlay 是視覺基準。
- `scenes:compile` 通過；既有 live-corpus gate 對 Chapter 1 和 2 通過；不引入 layout overlap warning、缺失目標或案件內容變動。既有單元測試及 packaged smoke 無回退。
- 不要求真人 playtest／sign-off；Linux 只沿用 CI 覆蓋，不列為本 ticket 的桌面端到端驗收平台。

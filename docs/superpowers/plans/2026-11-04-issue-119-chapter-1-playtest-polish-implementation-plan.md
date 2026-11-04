# Issue #119 — Chapter 1 玩家視角修正實作計劃

> 對應設計：[2026-11-04-issue-119-chapter-1-playtest-polish-design.md](../specs/2026-11-04-issue-119-chapter-1-playtest-polish-design.md)；追蹤 [GitHub Issue #119](https://github.com/cwchanap/Lyra/issues/119)。
>
> **交付規則：一個 Issue、單一 Draft PR。** 本 PR 首先承載這兩份規劃文件；後續程式／內容實作直接加在**同一 PR**，不要切成幾個依賴 PR。每個 Task 是同 PR 裡的工作項，不是新的 ticket/PR。
>
> 基線：main @ c713de3b2943f3dc6edbdc5e0d53ba09dfe3cf2c；package manager bun@1.3.1。原 playtest 1180×812 / 8e31c4b，不等於新程式碼重新操作的測試結果。

## Task 0 — 修正前建立可重現基線（避免修不存在的 bug）

**讀取／檢查：**
- Issue #119 的 A–F；Issue #90 的既有修復與 docs/superpowers/plans/2026-09-20-issue-90-present-flow-and-layout-regressions.md。
- apps/game/src/lib/components/InvestigationMapView.svelte、InvestigationSceneSurface.svelte、InterrogationStage.svelte、DialogueBox.svelte。
- 四份 layout：investigation_scene_p1、investigation_scene_3、investigation_scene_7、investigation_scene_9。
- 實際提交的第一章背景 PNG（不是圖片生成 prompt），以及對應 scene Markdown。

**步驟：**
- [ ] 在 main/head 完整載入 Chapter 1 的 P1 文具店、咖啡館、後場、承包商辦公室、訊問、城市地圖；使用 Tauri 而非僅 Vite 網頁。
- [ ] 記錄 1180×812、800×600、1280×720 的 CSS viewport、背景與目標 bounding rect；每個出錯的物件記錄「看到位置、實際 hit box、點擊結果」。舊截圖的螢幕座標不能直接轉換為 authored normalized rect。
- [ ] 核對承包商主管是否真的缺少背景角色素材；若已 baked 在圖裡而 rect 不準，只修 layout；若缺圖，寫清 art 依賴並另列 art 任務，不讓本 PR 自動生成圖片。
- [ ] 記下 A3 是否可因局部 box sizing 修復；若不是，才檢查 map plane/父容器，不做無依據的通用 CSS 重寫。
- [ ] 記下現有縮圖空白是否能重現；未重現就不碰資產載入器。

**完成**：PR 說明附可重現與不可重現的清單、實測視窗條件及相關截圖。若某點已由 main 修正，就刪除相應實作工作，而不是硬改。

## Task 1 — 修正 A1 / A4 的順序無關劇本文字

**修改：**
- docs/stories_plan/chapter_1/investigation_scene_3.md：hotspot katase_register_gap 的 Description、舞台指示及回應，不再引用片瀨尚未說過的末班車估算。其餘出入時間、片瀨人設與主線證物不動。
- docs/stories_plan/chapter_1/investigation_scene_9.md：kitami 動機話題第一句（目前 L062）改成針對檢舉與合約壓力的質問，不預設他已承認殺人。
- 對應 docs/stories_plan/chapter_1/ja/investigation_scene_3.ja.yaml、ja/investigation_scene_9.ja.yaml：保留既有 line IDs、voice clip IDs，校對調整譯文；不自動付費生成 TTS。

**驗收與測試：**
- [ ] 先點 katase_register_gap，再問 contractor_ambient；反向順序再玩一次。兩條路的句子都站得住。
- [ ] kitami 第一個選動機話題，以及先查工單/檢舉後再選動機，語氣都不是預設供認。
- [ ] 針對 authored Markdown 加最小的固定字句／順序回歸檢查；使用既有 scene compiler / 話題測試 seam，不新增對話狀態模型。
- [ ] 如需更新 ja locale，依現有 voice:sync / voice:validate 流程；排除付費 voice:generate。

## Task 2 — 修正 A2：只校正真正有偏差的 authored layout

**修改候選：**
- docs/stories_plan/chapter_1/investigation_scene_p1.layout.json：copy_shop_counter 的 receipt、register、cctv、ledger。
- docs/stories_plan/chapter_1/investigation_scene_7.layout.json：inner 的 bean_can（同時確保 old_clock/phone_drop 不倒退）。
- docs/stories_plan/chapter_1/investigation_scene_3.layout.json：現場簽退單/咖啡館圖像其他受波及矩形（若複核證實）。
- docs/stories_plan/chapter_1/investigation_scene_9.layout.json：contractor_clerk baked rect/主管的標示（視實際 PNG 結果）。
- 一般情況不修改 InvestigationSceneSurface.svelte。若 rect 仍正確而 hover 文案實際難辨，才做該元件的**局部** hover/focus 表示調整。

**驗收與測試：**
- [ ] 在最終背景上量 rect 的 normalized 坐標，縮放後點收據只呼叫 receipt、點 register 只呼叫 register；各個熱點不互相偷點。
- [ ] bean_can 的框能覆蓋真正的金屬罐，不是附近的貨架或空白。
- [ ] 主管在玩家看到的場景確實可找到可問的目標；若要新 art，清楚標註另案生成依賴，避免改成不可見的強制點擊。
- [ ] 沿用 apps/game/e2e-tauri/investigation-layout.e2e.ts 或既有 packaged E2E seam 加入**少量**真實點擊／bbox 斷言；至少 1180×812 和 800×600。檢查這些點在鍵盤焦點下仍可辨認。
- [ ] bun run scenes:compile 與既有 overlap / placed-target 檢查不新增警告或錯誤；不用硬編輯 generated Tauri resources。

## Task 3 — 修正 A3：地圖容器裁切

**修改：**
- apps/game/src/lib/components/InvestigationMapView.svelte 的 city-map 本地盒模型。先嘗試 box-sizing: border-box 或等效的「外部總寬包含 padding」修正；不要動 map pin normalized position。
- apps/game/src/lib/components/InvestigationMapView.test.ts 補樣式合同測試（不把它當真實渲染 bbox 的替代）。
- apps/game/e2e-tauri/investigation-layout.e2e.ts 或現成 map e2e 路徑補可見性/可點性驗證。

**驗收與測試：**
- [ ] district 的「返回全景地圖」在 1180×812、800×600、1280×720 均完全留在視窗內；頁面沒有非預期水平 scroll。
- [ ] 使用滑鼠點返回，仍只切 presentation plane；使用 Tab/Enter 也能返回。返回後葉節點 travel 不變。
- [ ] 保留 16:9 地圖、CrossfadeImage loaded-plane gate、map-node 的相對位置及最小 44px 按鈕。
- [ ] bun run --cwd apps/game test src/lib/components/InvestigationMapView.test.ts 通過。

## Task 4 — 修正 B：可讀性與行為語義，不新增機制

**修改候選：**
- apps/game/src/lib/components/GameShell.svelte 的 chapter summary；
- apps/game/src/lib/components/DialogueBox.svelte 的正文/斜體提示、反駁副標；
- apps/game/src/lib/components/InvestigationSceneSurface.svelte 與現有 Case File / evidence tray 中玩家真的要讀的說明文字；
- apps/game/src/lib/components/InterrogationStage.svelte 的「動搖 · COMPOSURE」標籤。數值仍由 brokenQuestionProgress() 提供。
- 必要時在 tokens.css 定義一個更亮的副文字樣式，盡量不改所有裝飾文字。

**驗收與測試：**
- [ ] 章節摘要、敘述文字、證物副文字在深色背景有可讀層級；在 1180×812 畫面提供 before/after 對照。
- [ ] 紅色條標示為題目突破進度，仍與 aria-valuenow/aria-valuemax 相符，不暗示生命或壓力扣血。
- [ ] 反駁操作仍是原生 button 的單次點擊／Enter／Space，使用者知道會「出示證據」；不得重加長按邏輯（Issue #90 已處理）。
- [ ] 更新並通過 DialogueBox、InterrogationStage 及可讀性受影響元件的現有 Vitest；bun run check 通過。

## Task 5 — 修正 C1 / C2 / C3 的提示公平性

**修改：**
- docs/stories_plan/chapter_1/analysis_scene_8_5.md：
  - evidence_packages：讓第二組名稱和 Description 同時容納「三宅看不到屍體」與「外包憑證先進場」，不再宣稱視線單獨證明第三者早到；靜態 Incorrect Feedback 提示先檢查資料各自能證明的事。保留所有卡片 IDs、Accepted Cards、Reveals。
  - local_event_sequence：保留第一固定錨點和事件原始號碼；只調整未加入卡的 authored 呈現順序或過度明示的文句，使畫面不是一開始就把所有卡片依答案排列。不做隨機 shuffle、額外 schema 或新遊戲難度。
- docs/stories_plan/chapter_1/interrogation_scene_10.md：gate_hold_record 的 On Wrong Evidence 改為針對「特定摘要時刻表」的中立提示，禁止假裝知道玩家提交了整份摘要。
- 對應 ja YAML 文字核對，保持已存在 line ID 不變。

**驗收與測試：**
- [ ] 將 miyake_pov_replay 放入小謊組 → 顯示合理提示，可重新移動；正確分類仍成功。
- [ ] 在核准階段提交 local_sequence_record → 提示精確且不錯誤描述玩家選擇；再提交 doorlock_summary_timetable → 成功取得 approved_clip。
- [ ] local_event_sequence 留存足夠 1841～1844 原始線索與固定錨，但初始卡片池不直接把全部非固定項目排成正解。
- [ ] 優先擴充現有 scene compiler / analysis fixture 或 production journey 的具體斷言；不建立全新推理驗證平台。

## Task 6 — 收斂 D：第一輪審查、重複資訊與結案標語

**修改：**
- docs/stories_plan/chapter_1/scene_5.md：在相馬情緒性辯論前插入**極短**程序限制／核准片段尚未取得的背景，讓弱論證成為角色的合理失策。保留神谷的反駁、K. 的非定錘特性、摘要先贏結果。
- 從現有 scene_5、investigation_scene_7～9、interrogation_scene_10 中選取確有重複資訊的單句做刪減，不改證物取得、法律權限或跨章伏筆。
- apps/game/src/lib/components/GameComplete.svelte：有 storyCleared 時將法律含義過強的「案件結案 / CASE CLOSED」改為中性的篇章完成文案；storyCleared 屬於遊戲完成旗標，**不改其真值、儲存與解鎖作用**。更新 GameComplete.test.ts、必要時 page.test.ts。

**驗收與測試：**
- [ ] 初輪審查有程序壓力而不是玩家無理由地裝傻；不提前得到完整 raw 或正式核准片段。
- [ ] 可選互動／reexamine 不會造成新的 auto-outro 阻塞；若要改 required 性質需先查 Rust 進度規則與 scene manifest，風險過高就保持原狀。
- [ ] 最終審查結果仍是暫緩起訴／補充調查；結尾的進度用語不暗示已經司法最終定罪或終審。
- [ ] 第 1 章末青葉公開預告、ZW_A16.lock 的私人鏈與日常拿鐵場景不被提前串接。

## Task 7 — 最終測試和 PR 驗收（同一 PR 內）

- [ ] bun run scenes:compile
- [ ] bun run evidence-sources:audit
- [ ] bun run check:scripts
- [ ] bun run test:scripts
- [ ] bun run --cwd apps/game test
- [ ] bun run check
- [ ] bun run --cwd apps/game check:e2e
- [ ] bun run lint:all；若有實際 Rust code 變動再跑對應 Rust test / clippy。
- [ ] 使用 packaged Tauri 執行受影響的 investigation layout、analysis、interrogation、map 及 Chapter 1 journey；對應指令參考 AGENTS.md：bun run --cwd apps/game test:e2e:smoke，必要時跑 gameplay focused/full。
- [ ] 在 1180×812、800×600、1280×720 至少做地圖、receipt/register、bean_can、主管可見性／點擊及字體視覺驗收；本階段需有實際截圖/bbox 記錄。
- [ ] 改動對話後依現有 voice locale 流程核對 ja script；voice:validate 既有警告需與 baseline 區分，不能用 603 warnings 當作本 PR 的新故障。
- [ ] 比對 Story Bible V6.7、Chapter 1 V3.8 的主線規則；確認沒有新增重大謎題、證物或過早主線揭露。
- [ ] PR 描述更新「已確認修復／保留原狀／未重現／因 art 需另案」矩陣，附測試紀錄。未實測項不能標完成。

## 刻意不做

- 不拆 PR、不改故事八章結構、不加入全新任務系統、不重寫 evidence submission 或 Analysis runtime、不處理 Issue #90 的歷史 WebKit / softlock、不生成圖片/聲音。
- 不實作逐證物細粒度 wrong-reason API；同一個**正確且中立**的 authored feedback 已足以解決 C1/C2。
- 不新增 map state、storage migration 或任何 pre-release save backward-compatibility 支援。
- 不為單一視窗案例建立通用 layout engine 或視窗測量基礎設施。

**交付總結**：內容文字兩處 + 小量 layout sidecar + 局部 CSS/文案 + 分類/排序提示 + 首輪審查節奏；以現有編譯、元件測試與 packaged E2E 作驗收，而非大規模架構改造。
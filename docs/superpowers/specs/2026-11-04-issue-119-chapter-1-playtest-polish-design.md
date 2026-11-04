# Issue #119 — Chapter 1 玩家視角 Playtest 修正設計規格

> 狀態：規格草案；對應 [Lyra #119](https://github.com/cwchanap/Lyra/issues/119)。本次 PR 先提交規格與實作計劃，功能實作沿用**同一條分支、同一個 PR**。
>
> 檢查基線：2026-11-04 的 main @ c713de3b2943f3dc6edbdc5e0d53ba09dfe3cf2c。原始觀察來自 8e31c4b、Tauri 視窗 1180 × 812，第一章完整遊玩。這不是目前 main 的第二次真人操作驗證。

## 1. 目標與判定

改善第一章文字時序、畫面點擊、地圖可達性和推理回饋的明顯摩擦，不改動案件答案、法庭程序、保存格式、地圖拓樸或第二章故事。

- 已在目前 main **以原始內容核實**：A1 提前引用片瀨談話、A4 提前預設北見動手、C1 視線證物和分類名稱的語義差距、C2 不精確的錯誤提示、B 的 COMPOSURE 實際代表已突破題數、C3 事件卡片按正解順序撰寫。
- **待實際視窗複核**：A2 熱點/背景物件對位、A3 溢出與裁切、B 對比的視覺效果、承包商主管的空場景、章尾狀態的實際出現時機。不得把推測成因寫成已證明的 runtime root cause。
- 兩次錯誤提交皆能恢復，不是引擎 softlock。原 playtest 沒有崩潰；存讀檔、聲音與無障礙合規不在原測試涵蓋範圍。

## 2. 實作矩陣

| 議題 | 現有依據 / 位置 | 決議 | 驗收 |
| --- | --- | --- | --- |
| A1 簽退單次序 | docs/stories_plan/chapter_1/investigation_scene_3.md 的 katase_register_gap；片瀨話題 contractor_ambient 可後於熱點 | 將 Description、舞台指示及兩句回應改為**先查單據也成立**的中性內容；不加旗標、不改解鎖 | 先點熱點及先訪談片瀨，兩條路都沒有引用尚未說出口的話 |
| A4 北見動機 | investigation_scene_9.md 的 kitami 動機話題開放，現有 L062 預設「動手」 | 改為未供認前也自然的追問，保留北見恐懼、帳號回收及資料盜賣的回答內容 | 動機話題第一個點也不等於口頭認罪 |
| A2 畫面熱點 | investigation_scene_p1.layout.json 的 receipt/register/cctv/ledger；investigation_scene_7.layout.json 的 bean_can；investigation_scene_9.layout.json 的 contractor_clerk | 用**已提交的背景圖**在實際 16:9 cover 畫面對位；只更新受影響 sidecar rect、必要標籤/hover。先釐清主管是 baked 人物、背景不足或目標標示不足，不推斷缺圖 | 1180×812 及最低尺寸：可見物件與其按鈕一致，receipt 不觸發 register；焦點／滑鼠均可選；不遮相鄰必需互動 |
| A3 地圖裁切 | apps/game/src/lib/components/InvestigationMapView.svelte 的 city-map width:100% 加水平 padding；map-overview-return right:12px | **優先檢查本地 box-sizing** 與容器寬度，必要時局部修正。維持單一 16:9 地圖、原 marker 座標、返回鍵和 44px 點擊尺寸 | 1180×812、800×600、1280×720，返回全景按鈕完整可見、可用滑鼠/鍵盤到達，無意外水平 scroll |
| B 閱讀對比 | GameShell .summary、DialogueBox 斜體敘述、InvestigationSceneSurface 證物／人物副文、Case File 說明；tokens.css 的 bone-dim / bone-faint | 只提高**承載可讀內容**的文字層級與必要字級；保留低對比的純裝飾小字及既有視覺風格。以實畫面比較，勿憑此稱完成 WCAG audit | 主要敘述、章節摘要、證據說明在 1180×812 可分辨，不犧牲層次 |
| B COMPOSURE / OBJECT | InterrogationStage 的 brokenQuestionProgress() 真實為 broken/total；DialogueBox 的 反駁 / OBJECT | 標示為「已突破題數」等符合現有數值的名稱；讓反駁按鈕表明「出示證據」，保留原生一鍵觸發、鍵盤與送件流程 | 玩家能看出紅條增加是成功突破，非剩餘意志值；不新增精神值或傷害機制 |
| C1 視線證物分類 | analysis_scene_8_5.md 中 miyake_pov_replay 與 external_credential_event 共同被放在「更早的第三者」 | 更名該組為**後場視線／外部進場線索**等能涵蓋兩者的命題；說清楚視線只能證明三宅看不見屍體，較早入場由憑證事件支持。改静態 Incorrect Feedback，不改 Accepted Cards 或 Reveal IDs | 錯放仍可重試；提示解釋推理差距而非說玩家笨；正解與後續 fact 不變 |
| C2 選錯紀錄回饋 | interrogation_scene_10.md 的 gate_hold_record 要 doorlock_summary_timetable，卻對所有 wrong evidence 說「摘要整份我看過」 | 改成**對任何錯誤證物均成立**的程序提示：要核對的是摘要主時間錨所用的特定時刻表，不是孤立的本機順序。保持機關答案不變 | 選 local_sequence_record、其他錯誤物件時都不會被說成選了整份摘要；再選正解可過 |
| C3 過度提示 | analysis_scene_8_5.md 的 local_event_sequence 按 1841→1844 撰寫且保留第一個固定錨點 | 此處定位為**教學式排序**：保留真實的本機事件編號（它們是公平線索），但將待加入卡片的呈現次序與正解區別；檢查明說答案的提示，保留足夠教學支持。不引入隨機洗牌或新 schema | 卡片一開始不是完整正解；玩家仍能靠事件序號、原始紀錄與固定錨完成 |
| D 敘事節奏 | scene_5.md 的首輪弱論證、反覆法醫/22:50/外包說明及各場景 flavor gate | 首輪審查**提前交代正式證物尚未核准**與相馬壓力，再保留他犯下的弱論證及敗北；只刪重複表述。只在證實不影響 reachability/auto-outro 時減少低價值強制互動，不廣泛改完成規則 | 先有程序限制、再有情緒性失策；三證據包、兩輪聽證和北見動機仍完整 |
| D 結尾法律狀態 | GameComplete.svelte 的「案件結案 / CASE CLOSED」文字；scene_11.md 的尾聲 | 將**狀態標語**改為「篇章完成／CHAPTER COMPLETE」一類的內容進度用語；不要將 storyCleared 變成法律裁定，也不碰解鎖持久化 | 玩家理解暫緩起訴／補充調查與遊戲篇章完成是兩回事 |

## 3. 架構與敘事邊界

1. **內容先修正，狀態不要增加。** A1/A4 用順序中立的繁體中文文本解決；不新增 topic-read flag、分支引擎狀態或 Rust wire 欄位。編譯器仍保留 line ID；日語地方化資源按現有 voice sync/validate 契約同步，**不產生付費配音**。
2. **座標是內容資料。** 優先改四個已存在的 layout sidecar；InvestigationSceneSurface 已有最低尺寸、同軸收縮、focus/hover、待調查提示。除非驗證證實是 UI 算法問題，禁止全面重寫 hit-testing 或疊加第二層互動。
3. **地圖只修本地盒模型。** 不動 city_map.json、map-plane.ts、Rust travel、保存內容和地圖動畫。返回全景只在 pending district map 顯示。
4. **推理保持公平。** C1 不能說視線本身證明第三人更早進來；C2 不能讓錯誤反應誤述玩家選擇；C3 不隱藏用來推斷的真實紀錄，也不提前破梗。審查會仍先拆三宅小謊、較早事件、合併時間，然後收束北見。
5. **主線 Canon 不變。** 第 1 章仍只命名青葉，公開青葉影像與 ZW_A16.lock 不連線；藍傘／金木犀不變成硬證物；不改第二章。
6. **Art/SFX 分離。** 本 PR 不生成新背景、人物或 SFX。若 Tauri 確認承包商背景缺可點擊人物且光靠位置／標籤不能解決，另外建立 art 任務；本 PR 留下明確必要的視覺依賴，不在 coding 工作裡混入生成工序。

## 4. 非目標與風險

- 不把原測試中短暫空白縮圖視為資產缺失；須先重現。603 個日語配音警告只代表編譯警告，不代表聽感故障，聲音測試另行處理。
- Issue #90 的過往 Present softlock、UNPLACED panels、WebKit SIGABRT、存讀檔問題不可在本 PR 重新當作 #119 確定故障；不新增 renderer recovery、通用 hit-target rewrite 或 double-click 修正。
- 不做全遊戲大規模字體／對比 redesign、完整 WCAG 合規宣告、改造分析引擎或增加新系統。
- 不保證在未實測視窗前能指定準確矩形座標。可接受第一階段先把不需肉眼的內容與 CSS 問題實作；幾何驗收需要真實 PNG 和 Tauri 實測紀錄。

## 5. 完成定義

- 兩個順序逆轉路徑、兩個錯誤證物重試路徑，以及事件排序的教學提示有回歸測試。
- 實際渲染的四組易錯熱點、承包商主管及城市地圖返回鍵在指定尺寸取得**點擊目標與畫面一致**的證據；不得僅依 jsdom CSS snapshot 宣稱視覺驗收完成。
- 核心閱讀樣式與 COMPOSURE/OBJECT 改稱，保留原來的數值及鍵盤操作。
- 首輪審查理由可理解、尾聲不把程序勝利誤稱終局定罪、故事 master canon 不變。
- 既有編譯、型別、Rust/前端測試、局部 packaged E2E 與完整 Chapter 1 production journey 通過；實測結果與未驗證項目明記 PR。
# Issue #119 — Chapter 1 玩家視角修正實作計劃（Review 收斂版）

> 規格：[Design Specification](../specs/2026-11-04-issue-119-chapter-1-playtest-polish-design.md)；追蹤 [Issue #119](https://github.com/cwchanap/Lyra/issues/119)，交付 [Draft PR #122](https://github.com/cwchanap/Lyra/pull/122)。
>
> **單一 PR 政策：** 本次既有 Draft PR 先存規格與計劃；所有功能實作、驗收與最終結論加在同一 PR。以下 Task 是 PR 內的工作段，不新開 tickets 或第二個 PR。建議每段完成後各自 commit。
>
> **基線：** `main` @ `c713de3b2943f3dc6edbdc5e0d53ba09dfe3cf2c`；bun@1.3.1。Review：[2026-11-04 design review](https://github.com/cwchanap/Lyra/pull/122#issuecomment-6647158070)。本 PR 原始 issue playtest 1180×812（舊 commit `8e31c4b`），未進行新的手動操作驗證。

## 工作順序（保持小改動）

**內容（Task 1）→ 局部 CSS／說明（Task 2）→ Layout Editor 座標（Task 3）→ 通用 review skill + E2E 補丁（Task 4）→ 一次整體驗收（Task 5）。**

不要把所有任務卡在一個預先的三視窗 Tauri 量測階段；設計上可由 code/raster 直接確認的修正先做。只在最後執行一次 Tauri 視覺 pass。

## Task 1 — 劇本內容與玩家提示（不改遊戲狀態）

**修改：**
- `docs/stories_plan/chapter_1/investigation_scene_3.md`：`katase_register_gap` 的說明、動作與回應，移除引用片瀨「方才說過」的末班車估計。熱點和 `contractor_ambient` 先後都合理；不新增 topic-read 狀態。
- `docs/stories_plan/chapter_1/investigation_scene_9.md`：北見動機話題 `L062` 改成尚未承認殺人時仍成立的壓力／檢舉追問，保留既有 reply 與 evidence IDs。
- `docs/stories_plan/chapter_1/analysis_scene_8_5.md`：
  - `evidence_packages` 第二 group 改為包含**視線遮擋**及**外部憑證先出現**的命題；更新 `Incorrect Feedback` 與 `Hint`，說明證物的證明界線。
  - `local_event_sequence` 只更改 `### Card:` 章節的 authored 排列順序，保留 1841～1844 號碼、`Accepted Order`、第一固定錨與 Reveal IDs。「按可見事件號排序」仍是**教學題**，不花工重做難度或增加 shuffle。
- `docs/stories_plan/chapter_1/interrogation_scene_10.md`：`gate_hold_record` 的 `On Wrong Evidence`（`L057`）改成任何錯誤證物都能套用的程序提示，不能假稱玩家選了整份摘要。
- `docs/stories_plan/chapter_1/scene_5.md`：相馬薄弱人品論證前加入**一句**正式核准片段未到手／本輪主張受限的程序提示，保留神谷的反駁及「摘要先贏」。
- `docs/stories_plan/chapter_1/investigation_scene_map_08.md`：**只改 Summary**：「返回雨鐘咖啡館，迎接結案後的日常。」→「暫緩起訴後，回到雨鐘咖啡館。」不要改真正遊戲終章 `GameComplete`。

**有界重複句裁切（事先列 ID，不開放掃全章重寫）：**

| 檔案 | 只處理以下 ID | 理由與保留 |
| --- | --- | --- |
| `investigation_scene_7.md` | `L049` | 剛由黑瀨 `L048` 說明時間範圍，接著相馬又覆述；保留 `L050` 對 22:58 的限制說明 |
| `investigation_scene_9.md` | `L085` | 重念與 hotspot `L045` 相同的「22:50 雨鐘／校驗值／K」；保留 `L086` 的有界結論 |
| `investigation_scene_9.md` | `L087` | 重述 hotspot `L050` 的未送出草稿資訊；保留 `L088` 提醒僅草稿仍不能證明資料流向 |
| `investigation_scene_9.md` | `L090` | 重述 `L053–L054` 的異常存取及外部載體；保留 `L091` 的買家尚未證明界線 |

如某行刪除會破壞 `On Collect` 節奏或編譯契約，只調整同一段相鄰台詞並記錄，**不擴大**到其他未列 ID。保留事件事實、證物取得、源頭與法律程序。

**本地化：**
- 按工具契約檢查 `docs/stories_plan/chapter_1/ja/*.ja.yaml` 的變更行及刪除行。使用 `bun run voice:sync chapter_1`（維持 line IDs、既有 clip IDs；因文字更新可能產生 stale locale entries）及 `bun run voice:validate chapter_1`，人工校對日文文字。
- **不執行** `voice:generate`，不承諾可聽配音已測試。

**驗收：**
- [ ] 片瀨：先收簽退單、先問片瀨兩路都自然；北見：先問動機不預設供認。
- [ ] C1 視線重現不能單獨說成第三者先進場；分類錯放後仍能重試。
- [ ] C2 提交 `local_sequence_record` 時錯誤文字不誤述所選證物，再交 `doorlock_summary_timetable` 能成功。
- [ ] C3 卡池不再按正解排列，保留讓新手靠事件號排序的公平入口。
- [ ] 首輪程序合理，第三者、門鎖本機、北見的 final proof order 不變；章間 map 摘要不提前暗示已經最終司法結案。
- [ ] 執行 `bun run scenes:compile`、`bun run evidence-sources:audit`；不新加固定句 grepping 測試。

## Task 2 — A3 地圖盒模型及 B 文字／進度語義

**修改：**
- `apps/game/src/lib/components/InvestigationMapView.svelte`：`.city-map` 設 **`box-sizing: border-box`**。原 `width: 100%` + `padding-inline` 在預設 content-box 會超寬；**不加全域 reset**、不改 map plane、pin、CrossfadeImage 或儲存。
- `apps/game/src/lib/components/DialogueBox.svelte`：核對 `.text-scene` 和其他實際必讀敘述的 `--bone-faint` 使用，改為現有 `--bone-dim` 或 `--bone`；`反駁 / OBJECT` 補清楚的出示證據含義，但仍是原生單次觸發。
- `apps/game/src/lib/components/InterrogationStage.svelte`：`動搖 · COMPOSURE` → 真實的「已突破題目」進度文字；保留 `brokenQuestionProgress()`、原 `aria-valuenow/max`。
- 在現有 `GameShell.svelte` 章摘要、證物／Case File 副文中，只修改**確實使用過暗色系且承載必讀訊息**的位置。既有已使用 `--bone-dim` 的不做無謂改動。

**明確不改：** `tokens.css`（使用 `--bone` / `--bone-dim`）、`InvestigationSceneSurface.svelte` 點擊幾何、`GameComplete.svelte`、Rust。

**驗收：**
- [ ] 地圖返回全景控制不再因 container padding 超出 viewport。
- [ ] 重要正文可讀；裝飾小標不必全部提亮，無完整 WCAG audit 宣稱。
- [ ] 紅色填充是「已突破題數」，反駁是「出示證據」；單擊、Enter、Space 行為沒有倒退。
- [ ] 依受影響元件執行既有 `DialogueBox`、`InterrogationStage`、`InvestigationMapView` Vitest，`bun run check`。
- [ ] **不新增**只檢查 CSS 字串的 jsdom style-contract 單元測試。

## Task 3 — 只用既有 Layout Editor 修正 A2

**工具：** `bun run dev:editor` → `apps/layout-editor/src/lib/EditorCanvas.svelte`；正常版面為 16:9 raster + normalized rect，拖移／縮放後存回 sidecar。不另外開發量測工具，也不靠 scene 背景 prompt 推測實物位置。

**修改：**
- `docs/stories_plan/chapter_1/investigation_scene_p1.layout.json`：以已提交的 `static/assets/backgrounds/chapter_1/scene_p1/tag_002.png` 對齊 `receipt`、`register`、`cctv`、`ledger`。Receipt 目前被 register 框住；四個圓整小數是佔位值。
- **CCTV 決策（無新美術）：** 800×600 時 16:9 cover 只顯示 normalized x `0.125～0.875`，而畫中 monitor 據 review 位於 x 約 `0.88～1.00`。使 `cctv` 點擊框左端伸入**可見的櫃台靠螢幕區**，以原有 hover/focus 名稱清楚標示「監視器」，不得覆蓋 receipt/register 等已對位的道具。若原圖無合理目標區，不默默放到完全無關的物件上，先在 PR 記錄需另案處理的視覺障礙。
- `docs/stories_plan/chapter_1/investigation_scene_7.layout.json`：校正 `bean_can` 至照片的低處罐身，保留 `phone_drop` 可點性。
- `docs/stories_plan/chapter_1/investigation_scene_9.layout.json`：`contractor_clerk` 由 `kind: baked` → `kind: sprite`，使用已有 `portrait.contractor_supervisor.standard`，`anchor: bottomCenter`；位置靠櫃台/服務窗口並保持場景透視。參考既有 `chapter_2/investigation_scene_4.layout.json` sprite 結構。**不新增 art task**。
- `investigation_scene_3.layout.json` 只在 editor 明確看到有偏差才修改；不做無差別全章重排。

**驗收：**
- [ ] 在 editor 為每個實際修改的 sublocation 附一張 overlay 截圖。
- [ ] 800×600 可見安全區內每個 required target 可達，`receipt` 不落入 `register`；`cctv` 是清楚標示的可見操作區而不是其他道具。
- [ ] `bean_can`、`phone_drop` 不互蓋；主管有實際可見 sprite 且可以被詢問。
- [ ] `bun run scenes:compile` 保留既有 placed-target / overlap 檢查；**重用** `apps/game/e2e-tauri/investigation-layout.e2e.ts` 800×600 shipped placement 契約；不加一套 per-hotspot 點擊／bbox 測試。

## Task 4 — 最小防回歸：review skill + 一個真實 E2E 斷言

- [x] 更新 `.claude/skills/reviewing-story-scenes/SKILL.md`（本次 review 已在本 PR 完成）：
  - Axis 4：同一 investigation 的 unlocked hotspot 與 character topic 可能任意順序發生；檢查「剛才說過／如你所見／第一次」等語句是否引用了尚未必經的動作。
  - Axis 9：`On Wrong Evidence` 與 `Default Wrong` 是共享的錯誤回覆，所有錯誤證物都會用到，不能假設玩家選了某一個特定錯誤物品；正解的 `Challenge`/`On Correct` 仍可具體。
- [ ] 擴充現有 `apps/game/e2e-tauri/investigation-layout.e2e.ts` 的第一張地圖 district 測試（約 :430）：用既有 `ensureMinimumWindowViewport()` 設 800×600，對 `[data-map-overview]` 取 `getBoundingClientRect()`，斷言 left ≥ 0、right ≤ `innerWidth`、top ≥ 0、bottom ≤ `innerHeight`。沿用已存在的地圖 travel E2E，不新增專用 E2E suite、CSS snapshot 或多點 bbox replay。
- [ ] 若使用現有地圖測試的 native click/keyboard 已能涵蓋 navigation，毋須另寫第二套 keyboard 回歸測試。

## Task 5 — 一次合併驗收（不是前置 blocker）

**驗證關口：**
- [ ] `bun run scenes:compile`
- [ ] `bun run evidence-sources:audit`
- [ ] `bun run check:scripts`
- [ ] `bun run test:scripts`
- [ ] `bun run --cwd apps/game test`
- [ ] `bun run check`
- [ ] `bun run --cwd apps/game check:e2e`
- [ ] `bun run lint:all`
- [ ] `bun run --cwd apps/game test:e2e:smoke`（packaged Tauri；同一原有 E2E 入口）。
- [ ] 使用真實 Tauri 於 **1180×812 及 800×600**，一次檢視 P1、Scene 7、主管窗口、城市地圖、視線/排序板、核准片段錯誤提示及閱讀對比。地圖另外可查 1280×720；不做三尺寸 × 所有熱點的 bbox 矩陣。
- [ ] 執行 `voice:sync chapter_1`、`voice:validate chapter_1` 並核對變動 locale；對比已知原始 603 警告，不把沒有聽的聲音判為新故障。
- [ ] 完整 Chapter 1 production journey 不退步，且 Chapter 2 轉場及青葉 reveal contract 未越界。
- [ ] PR 更新實際執行與未執行的測試、有效／無效問題及必要 editor screenshot；若某項不可重現，記錄原因而非擅自聲稱已修復。

**只在本 PR 實際變動 Rust 後才需 Rust 單元測試/Clippy；按本計劃 Rust 不應改動。**

## 不做的事

- 不新增內容順序狀態、wrong-evidence API、分析難度系統、hit-test engine、地圖 state、save migration、全域 box-sizing、全域顏色 token、素材生成或付費 voice；不更動 `Required`／flavor gate。
- 不改 `GameComplete` 的真正結局；不把 Issue #90 的歷史問題或未重現縮圖／聲音警告搬進本次 PR。
- 不新增脆弱的 Markdown 固定文句測試，不重跑所有 shipped target 的三尺寸人工量測，不在沒有具體重複行的地方擴大刪稿。

**交付結果：** 一次 Chapter 1 小範圍內容／UI/sidecar polish，重用既有 editor、compiler、review skill 與 E2E，所有工作落在同一 Draft PR。
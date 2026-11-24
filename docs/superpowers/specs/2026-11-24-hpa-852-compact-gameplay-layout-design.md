# HPA-852 — 預設 800×600 視窗：可操作調查舞台、人物與安全返回標題

**狀態：Draft design / 待實作（非已修復）**  
**日期：2026-11-24**  
**Linear：** [HPA-852](https://linear.app/cwchanap/issue/HPA-852/targets-and-faces-hidden-off-screen-or-under-the-hud-at-the-default)  
**規劃基準：** [main @ 1349831b8ab56db1c025c2ea360a0bef9bc82ac8](https://github.com/cwchanap/Lyra/commit/1349831b8ab56db1c025c2ea360a0bef9bc82ac8)  
**相關：** HPA-853/#136（已合併）、HPA-1143、HPA-705/#138、HPA-830/#133、HPA-831/#140；HPA-712/#139（故事內容獨立進行）。

## 1. 問題、目標與選票

HPA-852 沒有 blockedBy、仍在 backlog，會直接影響兩章的預設桌面視窗。HPA-853 已補完 72 個 Chapter 2 配置與共享 HUD/舞台隔離，故不能把 2026-11-11 UAT 的所有觀察當成 main 仍存在的 bug。本 PR 先重現，再只修 residual；已修好的項目保留可執行回歸證據。HPA-706（分析板捲動）、HPA-832（熱點標籤、話題回饋與提示）、HPA-851（CJK 字型）仍各自負責其產品需求，不併入本票。

目標：800×600 **實際 WebView viewport** 下，已配置的兩章可見互動目標能在原圖上命中、待查提示可見、HUD 不覆蓋人物臉或必要命中區、五地點可透過滑鼠與鍵盤選取；玩家可用滑鼠開啟既有遊戲選單；結案/未完待續不必捲動即可安全返回標題；標題首次顯示不會因 scroll 或 autofocus 跳到底部。不改故事、題目、角色、線索取得規則或存檔格式。

## 2. main 已確認的 owner 與風險

| 項目 | 目前 owner / 觀察 |
| --- | --- |
| 調查舞台 | `ExploreView.svelte` 把 nav 與 hud-side 放進 `InvestigationSceneSurface.svelte` 的 `.scene-hud` grid；後者量測 headerHeight，stage/背景由該高度以下開始。HPA-853 已非舊的全視窗 HUD 疊圖。 |
| 圖片與命中 | Surface 的 `--scene-cover-width/height`、background object-fit: cover、`target-layout.ts` 的 coverPlaneSize/targetViewportRect、pending cue CSS 共同依賴相同 16:9 投影；改一處就可能使點位偏移。 |
| Compact/回退 | Surface 的 computeCompactClasses 目前用固定 MIN_VIEWPORT_PX=800×450 估算 clamp 衝突；routing 再依實際 viewport 與 fallback panel 可見跨度判定。不能只放大所有 hitbox（會重現 HPA-123 搶點）。 |
| 地點導覽 | `SublocationNav.svelte` 的 nav/chips 仍 flex-wrap；scene 版按鈕 min-height 44。mapped scene 按 HPA-601 不渲染 nav。 |
| 普通對話與訊問 | `GameShell.svelte` 章節 header、`DialogueBox.svelte` fixed portrait (80vh)、`InterrogationStage.svelte` 左上 subject/objective stack、`InterrogationSubjectArt.svelte` alpha-crop portrait 是不同 owner；不能調一個 z-index 就算完成。 |
| 結案/標題 | `GameComplete.svelte` min-height 70vh、64px padding、32px gap，加上 shell header；按鈕直接呼叫 +page 的 handleReset → resetGame。MainMenu 在 ≤980px 改成長直欄、可捲動；focusCard(0) 與 return-to-title focus 可能使 scroller 跳動，須量測確認而非假定單一根因。 |
| 選單 | GameShell 的 openGameMenu/closeGameMenu 與 capture Escape/escape-coordinator 管理層級及焦點；+page 的 gameMenuRequest 供訊問 Present tray 開同一選單。不是新建選單或新快捷鍵。 |

HPA-853 的 `investigation-layout.e2e.ts` 已包含 Chapter 2 scene 4 五地點、6 個後段場景最大導覽、72 個配置與部分 baked face bounds、locked overlay / pending cue、既有全章可用跨度測試。這是本票 baseline，不重複建立框架。

## 3. 最小設計

### 3.1 調查：保留 HPA-853 header/stage 分區，讓原圖可完整調查

採用一個**完整顯示 16:9 場景的 contain plane** 作互動調查的預設規則（所有支援視窗比例；只有 Explore 的 scene surface，普通對話、地圖、分析與訊問背景不改）。不依場景名硬編碼裁切特例，也不縮小整個 app。舞台剩餘空間由既有實測 headerHeight 決定。圖外留暗色空間；可沿用既有 atmosphere，不添加 raster。若 baseline 實測證明原有 cover 已滿足所有已配置目標的中心、face 及 hit 條件，可保留 cover，**須在 PR 用實測與同一驗收矩陣證明**，不可僅以 HPA-853 已合併為由跳過。

採 contain 時，使用同一個 16:9 plane：`w=min(stageW, stageH*16/9), h=min(stageH, stageW*9/16)`，居中。背景/standee/熱點/提示與測量都要以該 plane 投影；圖片仍用現有資產，沿用 crossfade/crop/thumbnail 角色。若另保留 dim cover 裝飾層，不能當成第二份可點的調查圖；優先只呈現一份可辨識原圖。重用 `target-layout.ts` 並同步 CSS geometry、DOM 量測與 pending cue CSS；不新增平行投影器或 sidecar 格式。明確處理 letterbox offsets 與實際 stage 寬高，header 不得覆蓋 scene。不要沿用舊固定 [0.125,0.875] 或 [0.031,0.969] cover band 作新幾何 gate。

現有 reachable/fallback 與 focus migration 保留給真正缺配置/無法使用的極端情境；不能將已配置、原圖可見的主線目標搬到 OFF-SCENE 清單來令測試通過。min-target clamp 仍為 72×44 常態、單軸/雙軸 compact 僅在衝突時使用。由實際投影尺寸重新檢查 clamp 衝突與可見跨度，量測 production 的 authored center 和實際 button，保留合法的 intentionalOverlaps 既有可獨立操作語義。不得把兩個不同線索合併。Ch1 inv9 臨時維護工單/外包維護權限名單若仍太小或互搶，僅以實際既有圖片及 Layout Editor 校正各自矩形；不要把點移到錯誤物件。只有原圖確實不適合時才開獨立美術票（本票不產圖），本票不得用假位置宣稱完成。小於 44px 的既有緊密 compact 例外：保留整個實際 hitbox 可見、各自中心與 pending cue 可命中，且針對上述投訴項優先改善到可辨識的獨立命中；不以全域 44px 強制重疊代替可用性。

### 3.2 五地點與人物

Scene variant 的 nav/chips 使用單列、不折行；若總寬超過 stage 寬，水平 scroll 是局部的，有可見溢出提示（例如右緣漸層/scrollbar）及可用鍵盤/滑鼠操作，焦點與 active chip 自動露出。維持 full accessible label、remaining count、44px 高度、disabled/active 樣式；不改 page variant、city map、unlock、導航事件。header title 與進度/目標使用可縮減 grid 欄、合理換行，不設定會吃掉舞台的固定超大高度。不要用 overflow:hidden 把選單或最後一個地點藏掉。

普通對話與 interrogation 在緊湊桌面（800×600 及附近尺寸）保留現有畫風，將 portrait 的頭部放在不與可見 chapter/scene 標題、objective/subject stack、toolbar 及 dialogue 文字區相撞的區域：優先縮小/重排資訊 chrome，若仍不足才調整 portrait 最大高度/位置。對話仍使用原左右角色歸屬、語句與圖片；訊問保留 alpha crop 與主體的清晰可辨認面部，不以淡化/隱藏角色解決。使用 CSS layout 真正預留空間或從 owner 取得實際尺寸；不引入臉部辨識、逐角色 runtime offset 表或全域 viewport manager。驗收用實際臉部 bounds/截圖（透明圖片整框不等同臉），必要時採 HPA-853 已有 normalized head-box fixture 思路。若已由 HPA-853 解決的 baked faces 通過檢查，保持不動。

### 3.3 結案與標題

**選擇 Linear 允許的「返回標題」方案**，按鈕改為「返回標題畫面 / RETURN TO TITLE」。GameComplete 兩種文案（storyCleared true/false）保留，按鈕位於首屏，透過 +page 現有 handleReturnToTitle → 持久化退出流程及既有 recovery dialog；不呼叫 resetGame、不直接 new game、不清除 manual save。若保存失敗，沿用現有 retry/discard/cancel，不新增 confirm framework。玩家在標題使用原「開始新遊戲」或 Continue。不要變更 HPA-708 的 chapter-clear card 或故事進度策略。

壓縮 GameComplete 的首屏佈局（包含 GameShell 在 complete 的 header，而不只 section 自身）；保持 CTA 不需滑動，其他視窗可正常 reflow。MainMenu 保持原標題風格，對 800×600 的 compact layout 使 logo/title/主要動作（包括退出）有清楚入口；若長 recap 需要滾動，由有限的 menu content 區自然捲動，首次 mount/return-to-title scroller 明確在頂部。初始化 focus 使用 preventScroll 並選擇當前可見的有效 control 或 title root；箭頭/Tab 等**玩家主動移動**仍可將 focused card 捲入可視區。不能每次 discovery 更新或使用者主動捲動都強制 reset；測試延遲 autofocus、Continue 有/無、回標題、save overlay dismiss。

### 3.4 滑鼠選單入口

沿用同一個 GameShell menu instance，使用文字「遊戲選單」並可附 Esc hint（不是只有隱晦 icon）。在原各 mode 的安全 chrome 放同款小按鈕：chapter header（普通 dialogue/非 presentation）、Explore header、city map header、InterrogationStage 非 Present 的工具列（包括 testimony dialogue）、AnalysisWorkbench board-header actions（不改 board sizing）。GameComplete 有顯著返回標題按鈕，亦可由 header 既有適當入口開選單。Present modal 保留既有 tray 的選單鍵（不放第二個可聚焦在 modal 背後的鍵）。以 snippet/callback 或小型共用 MenuTrigger 元件重用樣式與同一入口，選擇最少 props 方案，不建 store。避免固定浮動按鈕蓋住 hotspots/portrait。+page 可將既有 openInterrogationGameMenu 泛化為 requestGameMenu，GameShell 統一 openGameMenu/focus restoration/reassertFullscreenIfActive；click 像 Escape 一樣尊重 inFlight、topLayerOpen、inert/escape claims，不能穿透 acquisition/history/topic、save dialog 等。既有 Present 開 menu 行為及關閉一層/Escape/IME 合約保持。復用既有 menu 後的 manual save/load、Return to Title、Case File 和 Scene Select gating，不另造 UI 或 IPC。

### 3.5 800×600 wireframe（文字設計；Linear 無 mockup）

```text
調查： [地點標題]         [PROGRESS / OBJECTIVE] [遊戲選單]
      [01 地點][02 地點][03 地點][04 地點][05 …] → (只橫向捲動)
      ┌────────────── 實際 scene stage ──────────────┐
      │       暗邊 / 完整原圖 + 同一 plane 的 hitbox    │
      │       人物頭、熱點、pending cue 清楚可見        │
      └─────────────────────────────────────────────┘

結案： [精簡章節標題]
       [CASE CLOSED / TO BE CONTINUED]
       [既有標題與短文案]
       [返回標題畫面]  ← 800×600 首屏內
```
這不是新主題或 pixel-perfect mockup；以既有 Lyra 視覺風格、對應原圖和 before/after screenshot 驗證。

## 4. 邊界 / 依賴

- 一張 PR：本設計、implementation plan、實作、測試與截圖記錄在同一 PR 從 draft 走到 ready；不新增 ticket 除非確有新美術/SFX 需求。
- 不修改故事 Markdown、證物/reveal IDs、案件 logic、KAGAMI UI 語義、儲存 wire schema、原生平台權限；若確需校正 sidecar，只改有實證的既有點位，更新 compiler live-corpus snapshot，開發存檔不做 migration。
- 不做 HPA-832 label/已問話題/提示全面重設、HPA-706 分析板 card/pool 佈局重設、HPA-851 字型更換、HPA-707/912 persistence thumbnail/localization。HPA-712 活躍 PR 的 story scenes 不碰。
- 不要求新 Windows/macOS runner 或多平台 native acceptance；選一個既有可用 packaged desktop/WebView 環境（優先 Linux Xvfb）驗收共用 UI。

## 5. 驗收條件（全部由 agent/MCP 執行與留證，無人工簽收）

1. **真實尺寸、真實場景。** 用既有 packaged WDIO harness（`ensureMinimumWindowViewport`）及 MCP 可用的 desktop/browser/terminal control 驗證實際 innerWidth=800 / innerHeight=600，不用假 viewport、mock scene 或 browser-only 測試取代真實 app。記錄 run id、commit、環境及 screenshots。若執行環境不能跑 packaged，明確標 blocked，不以 static check 宣稱通過。
2. **全部已配置 Chapter 1–2 目標**：inventory 以編譯 corpus 為準，逐場景、最大已解鎖地點列、各實際 sublocation 檢查所有玩家可操作 hotspot/witness authored center 位於實際 stage 且可用；以 elementFromPoint 檢查命中同 ID（刻意重疊用其合法可點 witness/hotspot 位置與 sequence 證明），並以 DOM rect 交集驗證 painted HUD 無遮擋（pointer-events:none 仍算遮擋）。保留既有 min(44px, 實際 compact 尺寸) 可用跨度、pending cue、focus migration、locked/overlap 和 72/72 的回歸，不以放寬 assertion 換綠。針對 HPA-852 的 Ch2 inv4 直播牆悼念卡、轉播車監看螢幕、戶川美羽；Ch1 inv8 堆疊帳本/高瀨、inv9 兩份權限工單/前往質問北見、inv7 黑瀨，以真實 pointer 獨立命中（不因 fallback 或鄰點誤觸而成功）並截圖。確認必要目標能完成該段推進，不能直接操作 engine 完成目標。
3. **導覽與臉部**：Ch2 inv4 五地點同時 visible，導覽單列，尾端 chip 可滑鼠/鍵盤到達，切換進度/active 正確，未遮原圖。Ch1 testimony/scene 11 三宅、神谷 hearing、Ch2 三枝及上述 baked/standee witnesses 的 actual portrait/frame 截圖可清楚看見頭臉，不被 HUD/header 遮住。至少一個較大 viewport regression，確認非 4:3 仍對齊。
4. **結案/標題**：兩種 complete 狀態首屏 CTA fully visible 且 pointer 可點；點後走既有 return-to-title 流程（非直接 Chapter 1），既有手動 save 保留且 Continue/Load 可用；保存失敗走原 recovery。標題 fresh mount 與 return from complete 均在頂部，至少等 1.5s autofocus 之後再檢查；logo 可見、QUIT 可找到/操作；keyboard navigation 及 save overlay focus restore 不退化。
5. **選單**：滑鼠可在普通對話、調查/地圖、訊問（提問、testimony dialogue、Present）、分析、結案各模式開同一遊戲選單，Save/Load/Case File/Scene Select 仍遵從既有 gating。Resume 回原狀態/焦點、Escape 只關一層，modal/inFlight/IME 不穿透，沒有重複 menu 或新遮擋；至少一條由新入口完成 real save → load → 回到同一 scene 的既有 persistence 路徑測試。
6. **視覺**：無 Linear mockup，MCP 執行者保存上述代表場景 800×600 before/after 截圖與一張大視窗，直接比對現有圖及 UI 風格：人物臉、原圖熱點對位、導覽、字體、CTA、menu focus、無黑框/錯位。以實際畫面驗證，不用純 DOM 或設計示意代替；保留到測試 artifact。
7. 相關 Vitest、`bun run check`、`bun run --cwd apps/game check:e2e`、lint/format、既有 packaged gameplay suite、save-management / exit-lifecycle（共用 menu/return-to-title 變更）、PR smoke 按 repo 合約通過；手動 E2E Full 於 ready 前按 repo 現行流程執行。若 sidecar 有變動，加 scenes:compile/test:scripts/check:scripts 及 production-corpus gate。只修改 frontend / 測試 fixture；若因測試 checkpoint 修改 Rust e2e-only code，另執行其 cargo checks。

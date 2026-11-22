# HPA-831 — 證物圖片黑框／跨場景話題焦點框殘留：設計規格

> Linear：[HPA-831](https://linear.app/cwchanap/issue/HPA-831/evidence-images-show-as-empty-black-frames-and-the-focus-frame-sticks)  
> 狀態：**Design only — 待實作及 packaged UI 驗證**。一張票、一個 PR；本規格與 [implementation plan](../plans/2026-11-21-hpa-831-evidence-images-topic-frame-implementation-plan.md) 放在同一 PR，後續在**同一 PR** 補程式及測試。  
> 驗證基準：`main`（2026-11-21 查閱）；第 1 章 `investigation_scene_1 → scene_2`、`investigation_scene_3`；預設 800×600。

## 1. 現象與已確認事實

### A. 證物圖片

2026-11-06 UAT 報告：第 1 章咖啡館調查取得 `閉店監視器截圖` 與 `三宅打卡紀錄` 時，左側為空黑框，而 `門鎖摘要合併時間表` 的圖片可見。報告**尚未確認**是否只在 Xvfb/headless 發生。

現有 repo 中以下檔案都存在，不應預設缺美術：
- `static/assets/evidence/cctv_screenshot.png`
- `static/assets/evidence/timecard_record.png`
- 對照組 `static/assets/evidence/doorlock_summary_timetable.png`

場景宣告見 `docs/stories_plan/chapter_1/investigation_scene_3.md`。共用 `@lyra/asset-paths` 將 `evidence.<id>` 對到 `/assets/evidence/<id>.png`；`apps/game/svelte.config.js` 指向 repo `static`。呈現路徑分別是 `AcquisitionPopup.svelte`（取得證物）、`case-file/CaseFileRecordDetail.svelte`（案件檔案），都有既存 image-error fallback。**有檔案不等於 WebKit 已成功載入或有可見像素**，須實測。

### B. 話題焦點框

UAT 第一次走 `investigation_scene_1` 早坂「委託內容」話題，話題直接推進到 `scene_2` 後，兩條藍色水平焦點線曾殘留約 25 句與多個 scene tag；進入下一張地圖才消失。第二次同路線未重現，屬**間歇問題、根因未明**。紅色話題對白邊框是正常設計，不應錯誤移除。

## 2. 玩家可見行為契約

1. 取得 `閉店監視器截圖`、`三宅打卡紀錄` 時應能看見對應圖片，而非只有文字及空黑框；關閉取得視窗後，在案件檔案再次查看同樣可見。若真正讀圖失敗，現有具文字的 `EVIDENCE MISSING` fallback 比無提示黑框更好。
2. `門鎖摘要合併時間表` 及其他正常證物不得因修復而退步。
3. 話題對白結束時，**不論返回調查面板、直接換場、快速推進、開啟選單或讀取檔案**，只屬於舊話題的焦點裝飾不得殘留到下一個 scene/mode；新場景的合法焦點或話題樣式不受影響。
4. 保持既有遊戲進度、證物 ID、審查會 proof order、存檔格式與劇情內容；不得以「推遲顯示」或全面隱藏藍色 UI 線條掩蓋問題。

## 3. 診斷決策與最小方案

| 驗證結果 | 允許的修復 |
| --- | --- |
| 實際 image URL 錯誤／未打包／manifest 引用錯 | 修正**既有 ID／映射／資源進場**的單一錯處，重用 `@lyra/asset-paths`；不另開資源 resolver |
| image load/error 狀態錯誤、舊 async promise 蓋回新圖 | 修正 `AcquisitionPopup`／`CaseFileRecordDetail` 的現有 effect／error handler，保留 cleanup 與 fallback |
| 圖檔存在但壞檔／全黑像素／內容錯誤 | 保留診斷證據，**將新圖片製作列為獨立 art ticket**；本 PR 不混入產圖／重新繪製 |
| 僅 headless/Xvfb 出現，真實 packaged WebKit 正常 | 記錄環境差異；只做必要的監測/回歸測試，不做虛構的產品 bug fix |
| 話題 UI state／CSS 留在 scene/mode 之後 | 將 cleanup 綁定現有 scene/mode 生命週期；只修擁有焦點裝飾的元件，禁止新全域 state manager |
| 多次重播皆未復現，無法定位 | 以可自動驗證的跨場景回歸和截圖封口，明記「未重現」，**不猜修** |

先定位再實作，不同分支不得堆在一起。不要新增圖片、SFX、故事文字，也不處理 HPA-832／HPA-852 的 hotspot 命中區或 HPA-851 的字體問題。

## 4. 測試與可視化契約

- 以 **MCP 驅動的 packaged Tauri UI** 在**單一平台**完成端到端流程；沿用現有 WDIO E2E 和 checkpoint/production journey helper 作可重複的程式回歸，不加獨立 framework。
- 固定 800×600 **CSS viewport**（先以 `innerWidth/innerHeight` 核實，不只信視窗外框尺寸），捕捉三個證物取得視窗、至少一次案件檔案重看，以及 `早坂@委託內容 → scene_2 → 下一個地圖` 的前／中／後畫面。
- 圖片除 screenshot 外，機器斷言 `img.complete`、`naturalWidth > 0`、URL 與 computed style／可見範圍；若圖片像素仍空黑，需以真實畫面判讀，不得拿 `naturalWidth` 代替視覺驗收。
- 焦點框需確認舊話題專有 overlay／outline 在 `scene_2` 第一、途中與尾段均不存在，且對白及操作正常；重播正常速度與快速推進，避免單次未重現假綠。
- Linear 未提供 UI mockup：以 issue 的 UAT 截圖描述作基線，保存修復後 800×600 screenshots，**由 MCP 視覺檢查**證物內容及人物臉部不再受殘留線條遮蓋；不用人工驗收作門檻。

## 5. 非目標

不做跨平台 native 重複驗收、不引入新資源管線、不為兩張圖重做整個 evidence UI、不新增視覺特效、不修改 Bible/Chapter 1/2 canon、不做存檔向後兼容遷移。
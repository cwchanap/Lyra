# Scene 1: 分析材料取得

- **Summary:** 相馬先取得完整的證物與證詞包，讓後續整理只依賴已獲得的來源。

## Intro

[場景：驗收資料室，夜晚。桌上整齊排著待固定的紀錄與訪談筆記。]

**相馬律**：先把每一份來源正式收進來。

## Sub-location: 資料桌 {#records_desk}

- **Status:** unlocked

[場景：資料桌前，夜晚。門鎖面板匯出、手機通知與訪談筆記攤在桌上。]

### Hotspot: 已固定的來源包 {#acquire_analysis_sources}

- **Description:** 一次整理好所有將交給分析板的程序固定來源。
- **Status:** unlocked
- **Reveals:** [evidence:miyake_call_record, evidence:l_corridor_replay, evidence:external_credential_event, evidence:event_1841, evidence:event_1842, evidence:event_1843, evidence:event_1844, evidence:lock_sequence, evidence:phone_notification, statement:manager_timing]

**早坂茜**：每一張卡都先確認取得路徑，再讓它進整理板。

## Evidence Manifest

### evidence:miyake_call_record {#miyake_call_record}

- **Name:** 三宅母親通話紀錄
- **Description:** 可解釋三宅隱瞞通話原因的正式調閱紀錄。
- **Details:** 通話內容與時間已由電信方回覆並固定。
- **Source Sublocation:** records_desk
- **Source Kind:** digital
- **Representation Layer:** raw
- **Procedural Status:** reacquired
- **Completeness:** complete
- **Confidence:** corroborated
- **Source Group:** miyake_call_archive
- **Source Label:** 電信調閱回覆
- **Proof Capabilities:** [credibility]

#### On Collect

**相馬律**：這能解釋他的隱瞞，但不能直接證明殺人。

### evidence:l_corridor_replay {#l_corridor_replay}

- **Name:** L 型後場視角重演
- **Description:** 重建三宅站位與內側倉庫的遮蔽關係。
- **Details:** 重演顯示三宅當時的位置看不見內側倉庫。
- **Source Sublocation:** records_desk
- **Source Kind:** digital
- **Representation Layer:** composite
- **Procedural Status:** exhibit
- **Completeness:** complete
- **Confidence:** corroborated
- **Source Group:** sightline_replay
- **Source Label:** 視角重演固定檔
- **Proof Capabilities:** [route]

#### On Collect

**早坂茜**：這份只說明他的視角，不替任何人補上身分。

### evidence:external_credential_event {#external_credential_event}

- **Name:** 外包憑證事件
- **Description:** 排在三宅之前的外部維護憑證開門事件。
- **Details:** 外部憑證從承包商動線進入，身分仍未對應。
- **Source Sublocation:** records_desk
- **Source Kind:** digital
- **Representation Layer:** raw
- **Procedural Status:** exhibit
- **Completeness:** complete
- **Confidence:** corroborated
- **Source Group:** external_credential_archive
- **Source Label:** 外包憑證程序匯出
- **Proof Capabilities:** [order, access]

#### On Collect

**相馬律**：第三者事件成立，但名字還是空白。

### evidence:event_1841 {#event_1841}

- **Name:** 維護模式開啟
- **Description:** 本機事件 1841。
- **Details:** 門鎖面板記錄維護模式開啟。
- **Source Sublocation:** records_desk
- **Source Kind:** digital
- **Representation Layer:** raw
- **Procedural Status:** exhibit
- **Completeness:** complete
- **Confidence:** corroborated
- **Source Group:** lock_panel
- **Source Label:** 門鎖面板固定紀錄
- **Proof Capabilities:** [order]

#### On Collect

**早坂茜**：先後關係從這裡開始。

### evidence:event_1842 {#event_1842}

- **Name:** 外包憑證開門
- **Description:** 本機事件 1842。
- **Details:** 門鎖面板記錄外部維護憑證開啟後門。
- **Source Sublocation:** records_desk
- **Source Kind:** digital
- **Representation Layer:** raw
- **Procedural Status:** exhibit
- **Completeness:** complete
- **Confidence:** corroborated
- **Source Group:** lock_panel
- **Source Label:** 門鎖面板固定紀錄
- **Proof Capabilities:** [order]

#### On Collect

**相馬律**：外部憑證在員工憑證之前。

### evidence:event_1843 {#event_1843}

- **Name:** 員工憑證開門
- **Description:** 本機事件 1843。
- **Details:** 門鎖面板記錄員工憑證開啟後走廊。
- **Source Sublocation:** records_desk
- **Source Kind:** digital
- **Representation Layer:** raw
- **Procedural Status:** exhibit
- **Completeness:** complete
- **Confidence:** corroborated
- **Source Group:** lock_panel
- **Source Label:** 門鎖面板固定紀錄
- **Proof Capabilities:** [order]

#### On Collect

**早坂茜**：三宅的事件在這一列。

### evidence:event_1844 {#event_1844}

- **Name:** 伺服器合併完成
- **Description:** 本機事件 1844。
- **Details:** 面板記錄維護同步與伺服器合併完成。
- **Source Sublocation:** records_desk
- **Source Kind:** digital
- **Representation Layer:** sync
- **Procedural Status:** exhibit
- **Completeness:** complete
- **Confidence:** corroborated
- **Source Group:** lock_panel
- **Source Label:** 門鎖面板固定紀錄
- **Proof Capabilities:** [order]

#### On Collect

**相馬律**：合併完成不是每一個事件的精確時間。

### evidence:lock_sequence {#lock_sequence}

- **Name:** 門鎖本機順序
- **Description:** 程序固定的本機事件先後資料。
- **Details:** 本機順序與摘要時間解讀之間存在需要釐清的落差。
- **Source Sublocation:** records_desk
- **Source Kind:** digital
- **Representation Layer:** raw
- **Procedural Status:** exhibit
- **Completeness:** complete
- **Confidence:** corroborated
- **Source Group:** lock_panel
- **Source Label:** 門鎖面板程序固定
- **Proof Capabilities:** [order]

#### On Collect

**早坂茜**：這份能證明先後，不能單獨補出秒數。

### evidence:phone_notification {#phone_notification}

- **Name:** 死者手機通知
- **Description:** 重新調閱的死者手機通知紀錄。
- **Details:** 通知時間提供獨立的時間錨。
- **Source Sublocation:** records_desk
- **Source Kind:** digital
- **Representation Layer:** raw
- **Procedural Status:** reacquired
- **Completeness:** complete
- **Confidence:** corroborated
- **Source Group:** phone_archive
- **Source Label:** 手機通知調閱回覆
- **Proof Capabilities:** [time]

#### On Collect

**相馬律**：這一條可以和門鎖面板分開核對。

## Statement Manifest

### statement:manager_timing {#manager_timing}

- **Speaker:** 店長
- **Content:** 「我在面板同步前就聽見後門開了。」
- **Source Kind:** testimony
- **Representation Layer:** raw
- **Procedural Status:** exhibit
- **Completeness:** complete
- **Confidence:** corroborated
- **Source Group:** manager_interview
- **Source Label:** 店長程序固定訪談
- **Proof Capabilities:** [time]

#### On Acquire

**早坂茜**：這是另一個已固定的時間來源。

## Outro

- **Unlock:** hotspot:acquire_analysis_sources investigated

**相馬律**：來源都已取得，現在才能開始整理。

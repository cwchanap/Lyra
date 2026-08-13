# Scene 8.5: 短暫誤判整理點

- **Summary:** 相馬與早坂把三宅的小謊、較早的第三者與門鎖時序分開，確認可以準備有限門鎖調取申請，但外部憑證的身分仍未明。

## Intro

[場景：警署走廊，自動販賣機旁，深夜。販賣機的燈光是走廊唯一的光源，空白告示板靠著長椅，窗外雨聲未停。]
- **Background Prompt:** Late-night Japanese police station corridor beside a vending machine, vending-machine glow the only light source, blank notice board on the wall, case folder on a bench, cold institutional air, faint rain on dark windows, no readable text.
- **Background Asset ID:** background.chapter_1.scene_8_5.tag_001
- **BGS:** bgs_police_station_late_night

[早坂把資料夾與幾張便利貼放到告示板旁。]

**早坂茜**：別用腦子記。你會把同情、線索、證物混在一起。

**相馬律**：我剛才差點把外包憑證直接當成兇手。

**早坂茜**：所以先把手上的東西分清楚，再往下走。

[黑瀨從走廊那頭走來，把一份列印紙遞給早坂。]

**黑瀨徹**：三宅母親那通電話，電信方已經核實。

**黑瀨徹**：手機履歷和通信紀錄都對上，現在是正式紀錄。

**早坂茜**：好。這一張先放進小謊那欄。

**相馬律**：那就從三宅的小謊、第三者動線、門鎖時序開始。

## Board: 證據包整理 {#evidence_packages}

- **Kind:** classify
- **Prompt:** 把每張卡放進它真正支持的命題。
- **Reveals:** [assert_fact:miyake_known_lies_are_unrelated_to_murder, assert_fact:earlier_external_entry_exists]
- **Incomplete Feedback:** 每張卡都必須放進一個證據包。
- **Incorrect Feedback:** 至少有一張卡被放進錯誤命題。
- **Hint:** 先問每一項資料真正能證明什麼。

### Card: 三宅母親通話紀錄 {#miyake_call}

- **Source:** evidence:miyake_mother_call_log
- **Summary:** 正式通話紀錄解釋三宅為何隱瞞那通電話。

### Card: 三宅視角重現 {#miyake_pov_replay}

- **Source:** evidence:miyake_pov_replay
- **Summary:** L 型轉角與高貨架擋住三宅看向內側倉庫的視線。

### Card: 外包憑證事件 {#external_credential_event}

- **Source:** evidence:external_maintenance_credential
- **Summary:** 外部維護憑證事件排在三宅的員工憑證之前。

### Card: 維護模式開啟 {#event_1841}

- **Source:** evidence:local_sequence_record
- **Summary:** 本機順序的第一筆事件，維護模式開啟。

### Card: 外包憑證開門 {#event_1842}

- **Source:** evidence:local_sequence_record
- **Summary:** 本機順序的第二筆事件，外包憑證開啟後門。

### Card: 員工憑證開門 {#event_1843}

- **Source:** evidence:local_sequence_record
- **Summary:** 本機順序的第三筆事件，員工憑證開啟後走廊。

### Card: 維護同步完成 {#event_1844}

- **Source:** evidence:local_sequence_record
- **Summary:** 本機順序的最後一筆事件，維護同步完成。

### Group: 三宅的小謊 {#miyake_small_lies}

- **Description:** 只解釋三宅因生活壓力而隱瞞的事情。
- **Accepted Cards:** [miyake_call]

### Group: 更早的第三者 {#earlier_third_party}

- **Description:** 支持較早外部進入者存在，但不替他補上身分。
- **Accepted Cards:** [miyake_pov_replay, external_credential_event]

### Group: 門鎖時序 {#lock_chronology}

- **Description:** 只整理本機門鎖事件的先後關係。
- **Accepted Cards:** [event_1841, event_1842, event_1843, event_1844]

### Result Dialogue

**相馬律**：三宅的通話紀錄，只能解釋他為什麼說謊。

**早坂茜**：所以那是小謊，不是殺人的證明。

**相馬律**：視角重現和外包憑證，則把較早的第三者留在現場。

**早坂茜**：但第三者的名字還是空的。先把門鎖順序排好。

## Board: 本機事件順序 {#local_event_sequence}

- **Kind:** order
- **Prompt:** 把本機事件排回原始先後。
- **Unlock:** analysis_board:chapter_1@analysis_scene_8_5@evidence_packages completed
- **Accepted Order:** [event_1841, event_1842, event_1843, event_1844]
- **Fixed Anchors:** [event_1841@1]
- **Reveals:** [assert_fact:merge_time_is_not_event_time]
- **Incomplete Feedback:** 所有事件都必須放進時間線。
- **Incorrect Feedback:** 本機事件順序仍有錯誤。

### Card: 維護模式開啟 {#event_1841}

- **Source:** evidence:local_sequence_record
- **Summary:** 本機事件 1841，維護模式開啟。

### Card: 外包憑證開門 {#event_1842}

- **Source:** evidence:local_sequence_record
- **Summary:** 本機事件 1842，外部維護憑證開啟後門。

### Card: 員工憑證開門 {#event_1843}

- **Source:** evidence:local_sequence_record
- **Summary:** 本機事件 1843，員工憑證開啟後走廊。

### Card: 維護同步完成 {#event_1844}

- **Source:** evidence:local_sequence_record
- **Summary:** 本機事件 1844，維護同步完成。

### Result Dialogue

**相馬律**：順序是 1841、1842、1843、1844。

**相馬律**：但這只告訴我們先後，沒有告訴我們每一筆的精確秒數。

**早坂茜**：二十三點零七分五十秒，是合併完成的時間，不是某一個人的事件時間。

## Board: 有限調取申請基礎 {#narrow_request_basis}

- **Kind:** threshold
- **Prompt:** 選出足以支持有限門鎖調取申請的獨立矛盾。
- **Unlock:** analysis_board:chapter_1@analysis_scene_8_5@local_event_sequence completed
- **Eligible Cards:** [lock_sequence, external_credential, phone_notification]
- **Minimum Selected:** 2
- **Minimum Distinct Source Groups:** 2
- **Required Proof Capabilities:** [time, order]
- **Allowed Procedural Statuses:** [unspecified, lead, reacquired, exhibit]
- **Require Source Group:** true
- **Reveals:** [assert_fact:two_independent_lock_contradictions_identified, complete_objective:prepare_narrow_lock_request]
- **Incomplete Feedback:** 至少選出兩項、而且要來自兩個不同的來源群組。
- **Incorrect Feedback:** 這組紀錄仍不足以支持申請。
- **Hint:** 一項提供先後，一項提供獨立時間；同一份門鎖紀錄不能算兩個來源。

### Card: 門鎖本機順序 {#lock_sequence}

- **Source:** evidence:local_sequence_record
- **Summary:** 提供事件先後與摘要時間解讀不一致的證明。

### Card: 外包憑證事件 {#external_credential}

- **Source:** evidence:external_maintenance_credential
- **Summary:** 顯示外部憑證事件排在三宅之前，但仍未對到一個人。

### Card: 死者手機通知 {#phone_notification}

- **Source:** evidence:victim_phone_notification
- **Summary:** 提供獨立的時間錨，將衝突拉回更早時段。

### Incorrect Selection

- **Cards:** [lock_sequence, external_credential]
- **Feedback:** 這兩張都來自同一份門鎖固定紀錄，不能算兩個獨立來源。

### Result Dialogue

**相馬律**：本機順序和死者手機通知，來自兩個不同來源群組。

**早坂茜**：它們一起指出，摘要的門鎖時序還需要核對。

**相馬律**：足夠整理兩條獨立矛盾，準備有限調取申請。

## Outro

**早坂茜**：有限門鎖調取申請已經準備好，可以送進審查。

**相馬律**：但外部憑證還沒有對到人，身分仍然未明。

**早坂茜**：核准片段目前還沒取得。下一步，先讓審查會決定能看哪一段。

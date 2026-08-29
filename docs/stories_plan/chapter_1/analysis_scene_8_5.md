# Scene 8.5: 短暫誤判整理點

- **Summary:** 相馬與早坂把三宅的小謊、較早的第三者與門鎖時序分開，確認可以準備有限門鎖調取申請，但外部憑證的身分仍未明。

## Intro

[場景：雨鐘咖啡館後場的保全鏈固定區，深夜，窗外仍下著雨。鑑識離開後，打開的維護面板和紀錄桌留在工作燈下，右側貨架沉在暗處。]
- **Background Prompt:** Medium-wide Rain Bell cafe backroom fixed-panel view at night, camera facing the formally photographed open maintenance panel and evidence record table on the left, dark storage shelves and rain-streaked window preserving backroom continuity on the right, hard practical lamp with cool rain spill, no readable text. Detective Kurose Toru baked into the center of the room standing beside the panel: stocky weathered middle-aged man, wrinkled brown-gray field coat, worn dark leather shoes, thick hands, standing with slow steady footing as he supervises the forensic fixation, deep crow's-feet and night-shift weariness, perspective-correct scale and lighting under the hard practical lamp with cool rain spill, not covering the open maintenance panel, evidence record table, or the fixed-record hotspot on the table.
- **Background Asset ID:** background.chapter_1.investigation_scene_8.fixed_panel
- **BGS:** bgs_cafe_backroom_office

[鑑識人員收起器材離開。早坂把資料包推到桌子中間，又拉開一張椅子。]

**早坂茜**：坐下。

**相馬律**：我還站得住。

**早坂茜**：你剛才把外包憑證直接叫成兇手。

**相馬律**：……坐一下。

[早坂從包裡拿出水瓶，放到相馬手邊。]

**早坂茜**：水。

**相馬律**：妳包裡到底裝了多少東西？

**早坂茜**：能讓搭檔不倒下的東西。

[相馬喝了幾口水，肩膀終於鬆下來。]

**相馬律**：今天第三次回這張桌子。

**早坂茜**：也第三次說「收工再吃」。

**相馬律**：妳記仇？

**早坂茜**：我留紀錄。

[相馬把三宅母親通話核實回覆放到桌面一側。]

**相馬律**：這張也放上來。

**早坂茜**：正式證物，放小謊那欄。

**相馬律**：其餘先留白。我不替空位猜人。

## Board: 證據包整理 {#evidence_packages}

- **Kind:** classify
- **Prompt:** 把每張卡放進它真正支持的命題。
- **Reveals:** [assert_fact:miyake_known_lies_are_unrelated_to_murder, assert_fact:earlier_external_entry_exists]
- **Incomplete Feedback:** 每張卡都必須放進一個證據包。
- **Incorrect Feedback:** 至少有一張卡被放進錯誤命題。
- **Hint:** 先問每一項資料真正能證明什麼。

### Card: 三宅母親通話紀錄 {#miyake_call}

- **Source:** evidence:miyake_mother_call_confirmation
- **Summary:** 電信方核實後的正式後繼紀錄，解釋三宅為何隱瞞那通電話。

### Card: 三宅視角重現 {#miyake_pov_replay}

- **Source:** evidence:miyake_pov_replay
- **Summary:** L 型轉角與高貨架擋住三宅看向內側倉庫的視線。

### Card: 外包憑證事件 {#external_credential_event}

- **Source:** evidence:external_maintenance_credential
- **Summary:** 外部維護憑證事件排在三宅的員工憑證之前。

### Group: 三宅的小謊 {#miyake_small_lies}

- **Description:** 只解釋三宅因生活壓力而隱瞞的事情。
- **Accepted Cards:** [miyake_call]

### Group: 更早的第三者 {#earlier_third_party}

- **Description:** 支持較早外部進入者存在，但不替他補上身分。
- **Accepted Cards:** [miyake_pov_replay, external_credential_event]

### Result Dialogue

**相馬律**：我急著找兇手時，也差點把三宅的小謊塞進同一欄。

**早坂茜**：你肯停手重排，就還來得及。

**相馬律**：第三者還沒有名字。先留白。

[場景：雨鐘咖啡館後場的保全鏈固定區，深夜；同一張紀錄桌與打開的維護面板留在工作燈下。]
- **Background Prompt:** Medium-wide Rain Bell cafe backroom fixed-panel view at night, camera facing the formally photographed open maintenance panel and evidence record table on the left, dark storage shelves and rain-streaked window preserving backroom continuity on the right, hard practical lamp with cool rain spill, no readable text. Detective Kurose Toru baked into the center of the room standing beside the panel: stocky weathered middle-aged man, wrinkled brown-gray field coat, worn dark leather shoes, thick hands, standing with slow steady footing as he supervises the forensic fixation, deep crow's-feet and night-shift weariness, perspective-correct scale and lighting under the hard practical lamp with cool rain spill, not covering the open maintenance panel, evidence record table, or the fixed-record hotspot on the table.
- **Background Asset ID:** background.chapter_1.investigation_scene_8.fixed_panel

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

**相馬律**：本機順序和摘要對不上；二十三點零七分五十秒是合併完成的時間，不是某一個人的事件時間。

**早坂茜**：把這句寫進申請，名字那格繼續空著。

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

**相馬律**：申請寫好了。我的字開始飄了。

**早坂茜**：先別送。你把名字那格留白了嗎？

**相馬律**：留了。外部憑證還沒有身分。

**早坂茜**：好。餅乾一人一半。

## Outro

**早坂茜**[stern]：申請準備好了；身分仍未明，核准片段也還不能取得。

**相馬律**：先不猜名字。

**相馬律**：餅乾真的分我一半？

**早坂茜**：你先把水喝完。

**相馬律**：這算合作默契？

**早坂茜**：這算避免搭檔倒在證據桌上。

# Scene 8.5: 短暫誤判整理點

- **Summary:** 相馬與早坂整理目前真正成立的命題。

## Intro

[場景：雨鐘後場，相馬臨時整理板前。]

**早坂茜**：先把我們能證明的東西分開。

## Board: 證據包整理 {#evidence_packages}

- **Kind:** classify
- **Prompt:** 把每張卡放進它真正支持的命題。
- **Reveals:** [assert_fact:miyake_known_lies_are_unrelated_to_murder, assert_fact:earlier_external_entry_exists]
- **Incomplete Feedback:** 每張卡都必須放進一個證據包。
- **Incorrect Feedback:** 至少有一張卡被放進錯誤命題。
- **Hint:** 先問每一項資料真正能證明什麼。

### Card: 三宅母親通話紀錄 {#miyake_call}

- **Source:** evidence:miyake_call_record
- **Summary:** 解釋三宅隱瞞通話的原因。

### Card: L 型後場視角重演 {#l_corridor_replay}

- **Source:** evidence:l_corridor_replay
- **Summary:** 證明三宅當時站位看不見內側倉庫。

### Card: 外包憑證事件 {#external_credential_event}

- **Source:** evidence:external_credential_event
- **Summary:** 證明有人比三宅更早從承包商動線進入。

### Group: 三宅的小謊 {#miyake_small_lies}

- **Description:** 只解釋生活壓力造成的隱瞞。
- **Accepted Cards:** [miyake_call]

### Group: 更早的第三者 {#earlier_third_party}

- **Description:** 支持更早外部進入者存在的資料。
- **Accepted Cards:** [l_corridor_replay, external_credential_event]

### Result Dialogue

**早坂茜**：我們洗掉的是三宅那段錯誤故事。

**相馬律**：但還沒證明誰該被放回時間線。

## Board: 本機事件順序 {#local_event_sequence}

- **Kind:** order
- **Prompt:** 把本機事件排回原始先後。
- **Unlock:** analysis_board:chapter_1@analysis_scene_8_5@evidence_packages completed
- **Accepted Order:** [event_1841, event_1842, event_1843, event_1844]
- **Fixed Anchors:** [event_1843@3]
- **Reveals:** [assert_fact:merge_time_is_not_event_time]
- **Incomplete Feedback:** 所有事件都必須放進時間線。
- **Incorrect Feedback:** 本機事件順序仍有錯誤。

### Card: 維護模式開啟 {#event_1841}

- **Source:** evidence:event_1841
- **Summary:** 本機事件 1841。

### Card: 外包憑證開門 {#event_1842}

- **Source:** evidence:event_1842
- **Summary:** 本機事件 1842。

### Card: 員工憑證開門 {#event_1843}

- **Source:** evidence:event_1843
- **Summary:** 本機事件 1843。

### Card: 伺服器合併完成 {#event_1844}

- **Source:** evidence:event_1844
- **Summary:** 本機事件 1844。

### Result Dialogue

**相馬律**：本機只告訴我們先後，沒有告訴我們精確秒數。

## Board: 有限調取申請基礎 {#narrow_request_basis}

- **Kind:** threshold
- **Prompt:** 選出足以支持有限調取申請的獨立矛盾。
- **Unlock:** analysis_board:chapter_1@analysis_scene_8_5@local_event_sequence completed
- **Eligible Cards:** [lock_sequence, phone_notification, manager_timing]
- **Minimum Selected:** 2
- **Minimum Distinct Source Groups:** 2
- **Required Proof Capabilities:** [time, order]
- **Allowed Procedural Statuses:** [reacquired, exhibit]
- **Require Source Group:** true
- **Reveals:** [assert_fact:two_independent_lock_contradictions_identified, complete_objective:prepare_narrow_lock_request]
- **Incomplete Feedback:** 至少選出兩項紀錄。
- **Incorrect Feedback:** 這組紀錄仍不足以支持申請。

### Card: 門鎖本機順序 {#lock_sequence}

- **Source:** evidence:lock_sequence
- **Summary:** 提供事件先後與摘要時間不一致的證明。

### Card: 死者手機通知 {#phone_notification}

- **Source:** evidence:phone_notification
- **Summary:** 提供獨立時間錨。

### Card: 店長時間證詞 {#manager_timing}

- **Source:** statement:manager_timing
- **Summary:** 提供另一個可被程序固定的時間來源。

### Result Dialogue

**早坂茜**：現在有兩條獨立矛盾，可以把申請送進審查。

## Outro

**相馬律**：我們只證明了第三者存在。下一步才是把那個空位填上。

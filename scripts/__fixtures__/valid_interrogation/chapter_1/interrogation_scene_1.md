# Scene 1: 測試詢問

## Intro

**相馬律**：先從若槻開始。

## Phase: 若槻蓮初步詢問 {#wakatsuki_inquiry}
- **Kind:** inquiry
- **Required:** true

[場景：警視廳臨時詢問室，深夜，白色日光燈刺眼。]

### Subject: 若槻蓮 {#wakatsuki_ren}
- **Role:** 第一嫌疑人
- **Bio:** 雨鐘咖啡館兼職店員。

### Question: 進倉庫的理由 {#entered_storage}
- **Status:** unlocked
- **Reveals:** [statement:wakatsuki_entered_for_beans]

**相馬律**：你為什麼進倉庫？

**若槻蓮**：我只是去拿咖啡豆。

#### On Reask

**若槻蓮**：我說過了，是咖啡豆。

#### Follow-up: 追問咖啡豆 {#beans_follow_up}
- **Status:** locked
- **Unlock:** question:entered_storage answered
- **Required:** false
- **Reveals:** [evidence:coffee_machine_cleaning_log]

**相馬律**：再說一次咖啡豆的事。

**若槻蓮**：我進倉庫前看到咖啡機還沒清潔。

##### On Reask

**若槻蓮**：我只能確定當時還沒清潔。

## Phase: 若槻蓮的行動證詞 {#wakatsuki_testimony}
- **Kind:** testimony
- **Required:** true
- **Status:** locked
- **Unlock:** statement:wakatsuki_entered_for_beans acquired

[場景：警視廳臨時證據審查室，深夜，投影幕顯示 KAGAMI 門鎖時間線。]

### Subject: 若槻蓮 {#wakatsuki_ren}
- **Role:** 第一嫌疑人
- **Bio:** 雨鐘咖啡館兼職店員。

### Testimony

#### Statement: 清潔鍵 {#cleaning_button}
- **Content:** 我出來後，立刻按下清潔鍵。
- **Contradiction:** evidence:coffee_machine_cleaning_log
- **On Correct:** breakthrough_cleaning_time
- **On Wrong:** wrong_time_record

##### On Press

**相馬律**：你說立刻？

##### On Present

**相馬律**：這份清潔紀錄能說明時間。

##### On Wrong Present

**神谷澪**：那份資料不夠。

### Result: breakthrough_cleaning_time {#breakthrough_cleaning_time}
- **Reveals:** [statement:kagami_timeline_inconsistent]

**相馬律**：這和門鎖時間線矛盾。

### Result: wrong_time_record {#wrong_time_record}

**早坂茜**：還不夠。

## Evidence Manifest

### evidence:coffee_machine_cleaning_log {#coffee_machine_cleaning_log}
- **Name:** 咖啡機清潔紀錄
- **Description:** 咖啡機自動記錄的清潔模式啟動時間。
- **Details:** 清潔模式啟動時間為 21:13:29。

#### On Collect

**相馬律**：時間不一致。

## Statement Manifest

### statement:wakatsuki_entered_for_beans {#wakatsuki_entered_for_beans}
- **Speaker:** 若槻蓮
- **Content:** 「我進倉庫只是拿咖啡豆。」

#### On Acquire

**若槻蓮**：我只是拿咖啡豆。

### statement:kagami_timeline_inconsistent {#kagami_timeline_inconsistent}
- **Speaker:** 相馬律
- **Content:** 「門鎖時間線和咖啡機紀錄不一致。」

#### On Acquire

**相馬律**：至少有一份時間紀錄不成立。

## Outro

**相馬律**：先到這裡。

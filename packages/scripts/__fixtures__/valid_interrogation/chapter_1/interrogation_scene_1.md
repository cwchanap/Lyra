# Scene 1: 測試詢問

## Intro

**相馬律**：先從若槻開始。

## Phase: 若槻蓮初步詢問 {#wakatsuki_inquiry}

- **Kind:** inquiry
- **Required:** true
- **Reveals:** [evidence:coffee_machine_cleaning_log]

[場景：警視廳臨時詢問室，深夜，白色日光燈刺眼。]

### Subject: 若槻蓮 {#wakatsuki_ren}

- **Role:** 第一嫌疑人
- **Bio:** 雨鐘咖啡館兼職店員。

### Question: 進倉庫的理由 {#entered_storage}

- **Status:** unlocked
- **Reveals:** [statement:wakatsuki_entered_for_beans]

#### Testimony

- **On Loop:** **相馬律**：還有哪裡對不上，再說一次。

##### Line: 拿咖啡豆的說法 {#l_beans}

**若槻蓮**：我只是去拿咖啡豆。

##### Line: 清潔紀錄的說法 {#l_cleaning}

**若槻蓮**：我進倉庫前看到咖啡機還沒清潔。

- **Contradiction:** evidence:coffee_machine_cleaning_log
- **Challenge:** **相馬律**：這份紀錄顯示你進去前已經清潔過了。
- **On Correct:** **若槻蓮**：好吧，我看到的其實是清潔完成後的畫面。
  - **Reveals:** [statement:kagami_timeline_inconsistent]
- **On Wrong Evidence:** **若槻蓮**：這能證明什麼？

### Question: 追問咖啡豆 {#beans_follow_up}

- **Status:** locked
- **Unlock:** question:entered_storage answered
- **Required:** false

#### Testimony

- **On Loop:** **相馬律**：再說一次咖啡豆的事。

##### Line: 忘了清潔 {#l_follow}

**若槻蓮**：我只能確定當時還沒清潔。

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

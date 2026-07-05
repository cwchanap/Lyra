# Scene 2: 若槻蓮的第一次詢問

## Intro

[旁白：現場調查後，若槻蓮被帶到臨時詢問室。]

[旁白：KAGAMI 的時間線，仍然把他放在死亡現場。]

**相馬律**：先確認一件事。

**早坂茜**：他為什麼進倉庫。

## Phase: 若槻蓮初步詢問 {#wakatsuki_inquiry}

- **Kind:** inquiry
- **Required:** true
- **Status:** unlocked
- **Background Prompt:** Harsh temporary police interview room at night, white fluorescent light, cafe floor plan and KAGAMI timeline on table.
- **BGM:** rain_mystery_low
- **BGS:** indoor_rain_window
- **Reveals:** [evidence:coffee_machine_cleaning_log]

[場景：警視廳臨時詢問室，深夜。白色日光燈刺眼，桌上放著咖啡館平面圖與 KAGAMI 門鎖時間線。若槻蓮坐在對面，手指緊扣紙杯。早坂茜站在相馬律身旁，神谷澪隔著玻璃觀察。]

**若槻蓮**：我真的沒有殺人。

**神谷澪**[stern]：你是否殺人，由證據判斷。

**相馬律**：所以我們從你承認的部分開始。

### Subject: 若槻蓮 {#wakatsuki_ren}

- **Role:** 第一嫌疑人
- **Bio:** 雨鐘咖啡館兼職店員。承認進過倉庫，但堅稱離開時增田圭還活著。

### Question: 進倉庫的理由 {#entered_storage}

- **Status:** unlocked
- **Reveals:** [statement:wakatsuki_entered_for_beans]

#### Testimony

- **On Loop:** **相馬律**[thinking]：還有哪裡對不上，再說一次。
- **Default Challenge:** **早坂茜**[concerned]：等等，這句話讓我想想。
- **Default Wrong:** **若槻蓮**：這句話沒問題吧？

##### Line: 拿咖啡豆的說法 {#l_beans}

**若槻蓮**：我只是去拿咖啡豆，出來後立刻按了咖啡機清潔鍵。

##### Line: 清潔紀錄的說法 {#l_cleaning}

**若槻蓮**：我離開倉庫後，立刻回到吧台按下咖啡機清潔鍵。

- **Contradiction:** evidence:coffee_machine_cleaning_log
- **Challenge:** **相馬律**[thinking]：這份紀錄顯示你進去前已經清潔過了。
- **On Correct:** **若槻蓮**：好吧，我看到的其實是清潔完成後的畫面。
  - **Reveals:** [statement:kagami_timeline_inconsistent]
- **On Wrong Evidence:** **神谷澪**[stern]：那份資料無法證明若槻蓮何時離開倉庫。

## Evidence Manifest

### evidence:coffee_machine_cleaning_log {#coffee_machine_cleaning_log}

- **Name:** 咖啡機清潔紀錄
- **Description:** 雨鐘咖啡館吧台義式咖啡機的本地操作紀錄。
- **Details:** 自動清潔模式於 21:13:29 由手動按鍵啟動。該咖啡機不接入 KAGAMI 門鎖系統。
- **Image Prompt:** Espresso machine local cleaning log printout and control panel, isolated evidence icon without readable text.

#### On Collect

**相馬律**：清潔啟動時間，21:13:29。

**早坂茜**：若槻說他出倉庫後立刻按下清潔鍵。

**相馬律**：如果這是真的，KAGAMI 的離開時間就不對。

#### On Reexamine

**相馬律**：咖啡機是本地紀錄，不接 KAGAMI 門鎖。

**相馬律**：它不會跟著 KAGAMI 雲端時間一起偏移。

## Statement Manifest

### statement:wakatsuki_entered_for_beans {#wakatsuki_entered_for_beans}

- **Speaker:** 若槻蓮
- **Content:** 「我進倉庫只是拿咖啡豆，出來後立刻按了咖啡機清潔鍵。」

#### On Acquire

**若槻蓮**：我承認我進過倉庫。

**若槻蓮**：但我不是去找增田先生。我只是拿咖啡豆。

#### On Reexamine

**早坂茜**：若槻隱瞞的是咖啡豆，不是殺人。

**相馬律**：小秘密讓大證詞變得可疑。

### statement:kagami_timeline_inconsistent {#kagami_timeline_inconsistent}

- **Speaker:** 相馬律
- **Content:** 「咖啡機清潔紀錄與 KAGAMI 門鎖時間線不一致，若槻蓮不可能同時在倉庫與吧台。」

#### On Acquire

**相馬律**：至少有一份時間紀錄，不能照官方解讀。

**神谷澪**：你只是打開了一個疑問，還沒有證明答案。

**相馬律**：疑問足以讓我們繼續調查。

#### On Reexamine

**相馬律**：21:13:29 的清潔鍵，和 21:14:52 的出倉庫紀錄無法同時成立。

**相馬律**：矛盾點在時間線，不在若槻有沒有進過倉庫。

## Outro

**神谷澪**：這只能證明，有一份紀錄需要再確認。

**早坂茜**：也能證明，若槻蓮不是「無法不是兇手」。

**相馬律**：第一個裂縫，已經出現了。

[旁白：KAGAMI 的時間線沒有崩塌。]

[旁白：但它第一次發出了不自然的聲音。]

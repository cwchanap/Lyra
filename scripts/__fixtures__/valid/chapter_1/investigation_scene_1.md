# Scene 1: 測試調查場景

## Intro

[相馬律與早坂茜進入測試現場。]

**相馬律**：開始調查。

## Sub-location: 主廳 {#main_hall}
- **Status:** unlocked

[場景：測試主廳，明亮。]

[兩人環視主廳。]

**早坂茜**：先看看這裡。

### Hotspot: 桌子 {#table}
- **Description:** 一張木桌，桌上有一杯咖啡。
- **Reveals:** [evidence:coffee, sublocation:back_room]

[相馬律靠近桌子。]

**相馬律**：還是熱的。

#### On Reexamine

**相馬律**：咖啡已經涼了。

### Hotspot: 窗戶 {#window}
- **Description:** 窗戶半開，外面正在下雨。

[相馬律看了一眼窗外。]

**相馬律**：雨還在下。

### Character: 證人 {#witness}
- **Role:** 證人
- **Bio:** 案發時在現場的證人。

#### Topic: 案發時間 {#timeline}
- **Status:** unlocked
- **Reveals:** [statement:witness_alibi]

**證人**：我那時候在桌邊。

##### On Reexamine

**證人**：和剛才一樣，我在桌邊。

#### Topic: 動機 {#motive}
- **Status:** locked
- **Unlock:** evidence:coffee collected

**證人**：我沒有動機。

## Sub-location: 後室 {#back_room}
- **Status:** locked

[場景：測試後室，昏暗。]

[兩人推門進入後室。]

**早坂茜**：這裡比較冷。

### Hotspot: 櫥櫃 {#cabinet}
- **Description:** 一個上鎖的櫥櫃。
- **Reveals:** [evidence:locked_box]

[相馬律試了試櫥櫃。]

**相馬律**：鎖著的。

## Evidence Manifest

### evidence:coffee {#coffee}
- **Name:** 還熱的咖啡
- **Description:** 一杯仍微熱的咖啡。
- **Details:** 杯壁溫度約 50°C，最近 10 分鐘內被沖泡。
- **Source Sublocation:** main_hall

#### On Collect

**相馬律**：證明有人在這裡。

#### On Reexamine

**相馬律**：時間不對。

### evidence:locked_box {#locked_box}
- **Name:** 上鎖的小盒
- **Description:** 櫥櫃內的金屬盒。
- **Details:** 盒身有刻字，但鎖未撬開。
- **Source Sublocation:** back_room

#### On Collect

**相馬律**：先帶走。

## Statement Manifest

### statement:witness_alibi {#witness_alibi}
- **Speaker:** 證人
- **Content:** 「案發時我在桌邊。」

#### On Acquire

**早坂茜**：他說在桌邊。

#### On Reexamine

**早坂茜**：他堅持是在桌邊。

## Outro
- **Unlock:** hotspot:cabinet investigated and statement:witness_alibi acquired

[相馬律走出測試現場。]

**相馬律**：測試完成。

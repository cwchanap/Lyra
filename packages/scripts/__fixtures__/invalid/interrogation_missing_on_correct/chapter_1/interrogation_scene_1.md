# Scene 1: Missing On Correct

## Intro

**相馬律**：開始。

## Phase: 詢問 {#p1}

- **Kind:** inquiry
- **Required:** true

[場景：審訊室，深夜。]

### Subject: 嫌疑人 {#suspect}

- **Role:** 嫌疑人
- **Bio:** 測試用嫌疑人。

### Question: 行蹤 {#q1}

- **Status:** unlocked

#### Testimony

- **On Loop:** **相馬律**：再說一次。

##### Line: 否認 {#l1}

**嫌疑人**：我沒碰過那台機器。

- **Contradiction:** evidence:log
- **Challenge:** **相馬律**：這和紀錄對不上。
- **On Wrong Evidence:** **嫌疑人**：這證明不了什麼。

## Evidence Manifest

### evidence:log {#log}

- **Name:** 紀錄
- **Description:** 一份紀錄。
- **Details:** 詳細內容。

#### On Collect

**相馬律**：拿到了。

## Outro

**相馬律**：先到這裡。

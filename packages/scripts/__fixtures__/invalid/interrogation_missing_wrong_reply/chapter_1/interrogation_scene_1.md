# Scene 1: Missing Loop Prompt

## Intro

**相馬律**：開始。

## Phase: 詢問 {#phase}

- **Kind:** inquiry
- **Required:** true

### Subject: 嫌疑人 {#suspect}

- **Role:** 店員
- **Bio:** 安靜。

### Question: 問題 {#q}

- **Status:** unlocked

#### Testimony

- **On Loop:** **嫌疑人**：沒別的了。
- **Loop Prompt:** **相馬律**：從頭再聽一次。

##### Line: 說法 {#l}

**嫌疑人**：我在店裡。

- **Contradiction:** evidence:log
- **Challenge:** **相馬律**：這對不上。
- **On Correct:** **嫌疑人**：好吧。
- **On Wrong Evidence:** **嫌疑人**：這能證明什麼？

## Evidence Manifest

### evidence:log {#log}

- **Name:** 紀錄
- **Description:** 紀錄。
- **Details:** 紀錄。

#### On Collect

**相馬律**：紀錄。

## Outro

**相馬律**：到這裡。

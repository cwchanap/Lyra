# Scene 1: Unguaranteed Contradiction

## Intro

**相馬律**：開始詢問。

## Phase: 詢問 {#p1}

- **Kind:** inquiry
- **Required:** true
- **Reveals:** [evidence:seed]

[場景：審訊室，深夜。]

### Subject: 嫌疑人 {#suspect}

- **Role:** 嫌疑人
- **Bio:** 測試用嫌疑人。

### Question: 可跳過的追問 {#q_optional}

- **Status:** unlocked
- **Required:** false

#### Testimony

- **On Loop:** **相馬律**：再說一次。

##### Line: 選擇性反駁 {#l_opt}

**嫌疑人**：那晚我根本不在場。

- **Contradiction:** evidence:seed
- **Challenge:** **相馬律**：這份東西說的不一樣。
- **On Correct:** **嫌疑人**：好吧，我在場。
  - **Reveals:** [evidence:payoff]
- **On Wrong Evidence:** **嫌疑人**：那證明不了什麼。

### Question: 必答的追問 {#q_required}

- **Status:** unlocked
- **Required:** true

#### Testimony

- **On Loop:** **相馬律**：這一點你還沒交代。

##### Line: 關鍵反駁 {#l_req}

**嫌疑人**：那份東西不是我留下的。

- **Contradiction:** evidence:payoff
- **Challenge:** **相馬律**：這正好對上了。
- **On Correct:** **嫌疑人**：⋯⋯是我。
- **On Wrong Evidence:** **嫌疑人**：你拿錯了。

## Evidence Manifest

### evidence:seed {#seed}

- **Name:** 起始證物
- **Description:** 詢問開始時揭示的證物。
- **Details:** 詳細內容。

#### On Collect

**相馬律**：先拿到這個。

### evidence:payoff {#payoff}

- **Name:** 後續證物
- **Description:** 只有在可跳過的追問突破後才會揭示。
- **Details:** 詳細內容。

#### On Collect

**相馬律**：又多了一個。

## Outro

**相馬律**：先到這裡。

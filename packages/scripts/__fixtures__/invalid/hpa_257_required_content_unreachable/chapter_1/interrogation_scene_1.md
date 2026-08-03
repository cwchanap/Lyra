# Scene 1: Serialized required phases

## Phase: First required phase {#first_required}

- **Kind:** inquiry
- **Required:** true
- **Status:** unlocked

[場景：第一間詢問室。]

### Subject: First witness {#first_witness}

- **Role:** witness
- **Bio:** The first witness needs the late fact.

### Question: Require the late fact {#needs_late_fact}

- **Status:** locked
- **Required:** true
- **Unlock:** fact:late_fact asserted

#### Testimony

- **On Loop:** **相馬律**：還缺一個關鍵事實。

##### Line: Wait for proof {#wait_for_proof}

**證人**：沒有那個事實，我不能回答。

## Phase: Later required phase {#later_required}

- **Kind:** inquiry
- **Required:** true
- **Status:** unlocked
- **Reveals:** [assert_fact:late_fact]

[場景：第二間詢問室。]

### Subject: Later witness {#later_witness}

- **Role:** witness
- **Bio:** The later witness has the needed fact.

### Question: Confirm the fact {#confirm_late_fact}

- **Status:** unlocked
- **Required:** false

#### Testimony

- **On Loop:** **相馬律**：請確認這個事實。

##### Line: Confirmed {#confirmed}

**證人**：我可以確認。

## Outro

**相馬律**：詢問暫時結束。

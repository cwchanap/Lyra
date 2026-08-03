# Scene 2: Story-gated interrogation

## Intro

**相馬律**：接著確認證詞。

## Phase: Story predicate inquiry {#story_predicate_inquiry}

- **Kind:** inquiry
- **Required:** false
- **Status:** locked
- **Unlock:** at_least(2, question:who_entered resolved, at_least(1, objective:prepare_request completed, authorization:narrow_export granted))
- **Reveals:** [reveal_question:who_entered, reveal_objective:verify_alibi, complete_objective:verify_alibi, set_primary_objective:present_request; complete_current]

[場景：臨時詢問室，夜晚。]

### Subject: Test witness {#test_witness}

- **Role:** witness
- **Bio:** A fixture witness.

### Question: Confirm the door record {#confirm_door_record}

- **Status:** locked
- **Required:** false
- **Unlock:** fact:door_conflict asserted

#### Testimony

- **On Loop:** **相馬律**：請再說一次。

##### Line: Door record {#door_record}

**證人**：我只看見一次開門紀錄。

## Outro

**相馬律**：詢問先到這裡。

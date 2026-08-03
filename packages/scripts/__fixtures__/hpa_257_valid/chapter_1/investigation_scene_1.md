# Scene 1: Story-gated investigation

## Intro

**相馬律**：先確認門禁紀錄。

## Sub-location: Records room {#records_room}

- **Status:** unlocked

[場景：檔案室，夜晚。]

### Hotspot: Door conflict {#door_conflict_terminal}

- **Description:** A terminal lists incompatible door events.
- **Status:** locked
- **Unlock:** at_least(2, fact:door_conflict asserted, objective:prepare_request completed)
- **Reveals:** [reveal_question:who_entered, resolve_question:who_entered@door_conflict, reveal_objective:verify_alibi, complete_objective:verify_alibi, set_primary_objective:null; complete_current]

**相馬律**：這份衝突紀錄可以確定進門的人。

### Hotspot: Nested story gate {#nested_story_gate}

- **Description:** A second terminal combines all story conditions.
- **Status:** locked
- **Unlock:** at_least(2, question:who_entered resolved, at_least(1, fact:door_conflict asserted, objective:prepare_request completed))

**相馬律**：條件已經完整串起來了。

### Hotspot: Seed progression {#seed_progression}

- **Description:** An initial note starts the primary-objective chain.
- **Status:** unlocked
- **Reveals:** [assert_fact:door_conflict, set_primary_objective:prepare_request]

**相馬律**：先把準備工作列為主線。

### Hotspot: Complete preparation {#complete_preparation}

- **Description:** The confirmed conflict closes the preparation objective.
- **Status:** locked
- **Unlock:** fact:door_conflict asserted
- **Reveals:** [set_primary_objective:present_request; complete_current]

**相馬律**：準備完成，接著提出申請。

## Outro

**相馬律**：調查先到這裡。

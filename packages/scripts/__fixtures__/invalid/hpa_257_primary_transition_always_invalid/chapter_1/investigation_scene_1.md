# Scene 1: Invalid primary reactivation

## Sub-location: Main room {#main_room}

- **Status:** unlocked

[場景：測試房間。]

### Hotspot: Activate primary A {#activate_primary_a}

- **Description:** Activate primary A and expose the next step.
- **Reveals:** [set_primary_objective:primary_a, assert_fact:activation_complete]

**相馬律**：先把甲列為主要目標。

### Hotspot: Complete primary A {#complete_primary_a}

- **Description:** Complete the active primary.
- **Status:** locked
- **Unlock:** fact:activation_complete asserted
- **Reveals:** [set_primary_objective:null; complete_current]

**相馬律**：甲已經完成。

### Hotspot: Reactivate primary A {#reactivate_primary_a}

- **Description:** Attempt to reactivate the completed primary.
- **Status:** locked
- **Unlock:** objective:primary_a completed
- **Reveals:** [set_primary_objective:primary_a]

**相馬律**：不能重新啟用已完成的甲。

## Outro

**相馬律**：主要目標已經處理完畢。

# Scene 1: Positive self references

## Sub-location: Main room {#main_room}

- **Status:** unlocked

[場景：測試房間。]

### Hotspot: Zeta loop {#zeta_loop}

- **Description:** This hotspot depends on its own fact.
- **Status:** locked
- **Unlock:** fact:zeta_loop asserted
- **Reveals:** [assert_fact:zeta_loop]

**相馬律**：這條線索繞回自己。

### Hotspot: Alpha loop {#alpha_loop}

- **Description:** This hotspot also depends on its own fact.
- **Status:** locked
- **Unlock:** fact:alpha_loop asserted
- **Reveals:** [assert_fact:alpha_loop]

**相馬律**：另一條線索也繞回自己。

## Outro

**相馬律**：先記下這兩個迴圈。

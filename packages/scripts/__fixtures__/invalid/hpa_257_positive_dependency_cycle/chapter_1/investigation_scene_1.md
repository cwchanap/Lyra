# Scene 1: Positive dependency cycle

## Sub-location: Main room {#main_room}

- **Status:** unlocked

[場景：測試房間。]

### Hotspot: Alpha producer {#alpha_producer}

- **Description:** This hotspot needs beta before it can assert alpha.
- **Status:** locked
- **Unlock:** fact:beta_fact asserted
- **Reveals:** [assert_fact:alpha_fact]

**相馬律**：先找到乙，才能確認甲。

### Hotspot: Beta producer {#beta_producer}

- **Description:** This hotspot needs alpha before it can assert beta.
- **Status:** locked
- **Unlock:** fact:alpha_fact asserted
- **Reveals:** [assert_fact:beta_fact]

**相馬律**：先找到甲，才能確認乙。

## Outro

**相馬律**：這個循環沒有入口。

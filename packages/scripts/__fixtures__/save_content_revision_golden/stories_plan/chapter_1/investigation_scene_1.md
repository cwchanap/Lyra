# Scene 1: 調查

## Intro

**偵探**：先找線索。

## Sub-location: 現場 {#room}

- **Status:** unlocked
- **Background Prompt:** investigation room
- **BGM:** rain
- **BGS:** street

[場景：昏暗的現場。]

### Hotspot: 桌子 {#desk}

- **Description:** 一張桌子。
- **Reveals:** [evidence:receipt]
- **Evidence Source:** visible

**偵探**：桌上有一張收據。

### Character: 證人 {#witness}

- **Role:** 目擊者
- **Bio:** 在場的人。

#### Topic: 時間 {#time}

- **Status:** unlocked
- **Reveals:** [statement:timeline]

**偵探**：請說明時間。

## Evidence Manifest

### evidence:receipt {#receipt}

- **Name:** 收據
- **Description:** 一張收據。
- **Details:** 顯示正確時間。
- **Image Prompt:** receipt
- **Source Sublocation:** room

#### On Collect

**偵探**：這是關鍵。

## Statement Manifest

### statement:timeline {#timeline}

- **Speaker:** 證人
- **Content:** 「我在九點離開。」

#### On Acquire

**證人**：我在九點離開。

## Outro

**偵探**：繼續。

# Scene 2: 詢問

## Intro

**偵探**：開始詢問。

## Phase: 詢問 {#inquiry}

- **Kind:** inquiry
- **Required:** true
- **Background Prompt:** interrogation room
- **BGM:** rain
- **BGS:** street

[場景：詢問室。]

### Subject: 證人 {#witness}

- **Role:** 證人
- **Bio:** 目擊者。

### Question: 去向 {#whereabouts}

- **Status:** unlocked

#### Testimony

- **On Loop:** **偵探**：再說一次。

##### Line: 時間 {#line_1}

**證人**：我在九點離開。

## Evidence Manifest

### evidence:camera {#camera}

- **Name:** 監視器
- **Description:** 錄影。
- **Details:** 顯示時間。
- **Image Prompt:** camera

#### On Collect

**偵探**：錄影很清楚。

## Statement Manifest

### statement:answer {#answer}

- **Speaker:** 證人
- **Content:** 「我沒有說謊。」

#### On Acquire

**證人**：我沒有說謊。

## Outro

**偵探**：暫停詢問。

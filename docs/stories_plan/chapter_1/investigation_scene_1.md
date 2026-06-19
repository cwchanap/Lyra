# Scene 1: 相馬事務所日常 — 年輕偵探的入口

## Intro

[場景：相馬事務所外，清晨，細雨。]
- **Background Prompt:** Exterior of a small Tokyo private detective office in early morning drizzle, narrow quiet street, second-floor window softly lit behind rain-specked glass, muted gray daylight, no readable signage.

[清晨的雨打在窗上，細而均勻。相馬律拉開窗簾，光線落在一排排排好的文件上。他二十來歲，身形偏瘦，襯衫袖子捲到手肘，頭髮因為習慣性抬手梳理而略顯凌亂，身旁靠著一只磨損的舊皮製卷宗夾。他總有一種安靜的條理感，像是在用擺整齊的動作讓自己冷靜下來。]

**相馬律**：雨聲也有它的節奏。資料排好了，人就不會慌。

[他把昨晚整理到一半的卷宗合上，邊角對齊桌沿。]

**相馬律**：把每件事擺到該在的位置，至少能少傷到一個人。

## Sub-location: 相馬事務所 {#office}
- **Status:** unlocked
- **Background Prompt:** Small private detective office in Tokyo on a rainy morning, stacked paper files, worn desk, broken coffee machine, canned coffee, narrow practical room.

[場景：相馬事務所，清晨，細雨，狹小、紙本堆疊、桌上一台壞掉的咖啡機。]

[狹小的事務所裡，紙本一疊疊堆到牆邊。相馬律在桌前站定，捲起的袖口露出一截手腕，指尖輕點桌面邊緣，環視自己這方寸之地。]

**相馬律**：地方小，東西多。但每一樣我都知道在哪。

### Hotspot: 桌上舊委託單 {#old_request_slips}
- **Description:** 桌上一疊舊委託單，被人按日期由近到遠排好。

[相馬律用指尖把最上面一張推正，讓整疊的邊緣連成一條線。]

**相馬律**：按時間排，誰先來、誰後到，一眼就清楚。

**相馬律**：人會記錯，紙不會。我只信排好的那一面。

### Hotspot: 壞掉的咖啡機 {#broken_coffee_machine}
- **Description:** 桌上一台壞掉的咖啡機，按下去只吐出一點熱水。

[相馬律按下開關，機器只擠出一小股熱水。他伸出手背貼了一下杯壁。]

**相馬律**：又只有水。溫度倒是還測得出來。

**相馬律**：等有空再修吧。出杯這種小事，記清楚也不算壞習慣。

### Hotspot: 便利店罐咖啡 {#canned_coffee}
- **Description:** 桌角一罐還沒開的便利店罐裝咖啡。

[相馬律拿起那罐還溫的罐裝咖啡，指腹摩了一下罐面，掂了掂又放回桌角，位置跟原本的壓痕分毫不差。]

**相馬律**：機器壞著，就先靠這個。便利店的，省一點。

### Hotspot: 桌面卷宗夾 {#kagami_summary_hotspot}
- **Reveals:** [topic:hayasaka@commission, evidence:kagami_summary]
- **Description:** 桌上的舊皮製卷宗夾裡，夾著早坂送來的案件資料。
- **Evidence Source:** visible
- **Scene Source Prompt:** Old leather case folder on the detective office desk as the visible source object for the KAGAMI summary copy, with no readable KAGAMI pages or text visible in the background.

[相馬律低頭逐行看那份摘要，手指順著三欄紀錄滑下去。]

**相馬律**：時間、門、鏡頭，三條線都對上了。

### Character: 早坂茜 {#hayasaka}
- **Role:** 律師
- **Bio:** 程序感強的搭檔，紙本收據癖，重視來源與保全鏈。

#### Topic: 委託內容 {#commission}
- **Status:** locked
- **Reveals:** [topic:hayasaka@go_to_scene]

[早坂茜推門進來，三十出頭的身形結實而幹練，結構感的西裝外套搭在便裝外面，頭髮紮得利落。她抖了抖傘上的水，從整理得分明的包裡抽出一疊夾好的紙本，每個動作都像事先想過一遍。]

**早坂茜**：有一位三宅蒼太的母親來委託我們。案子已經走到審查會那一關。

**早坂茜**：我把來源跟收據都收齊了。先看程序，別急著下結論。

[她把紙本在桌面上輕叩兩下，讓邊角對齊，才推向相馬律。]

#### Topic: 你先去現場走一遍 {#go_to_scene}
- **Status:** locked

**早坂茜**：那你先去店裡走一遍。走完還對得上，再信它。

## Evidence Manifest

### evidence:kagami_summary {#kagami_summary}
- **Name:** KAGAMI 摘要副本
- **Description:** KAGAMI 系統輸出的官方摘要副本，列為三宅蒼太相關的正式紀錄。
- **Details:** 摘要將三宅蒼太列為主要嫌疑人，附時間、門禁與鏡頭三項紀錄，字面上彼此相符。
- **Source Sublocation:** office
- **Image Prompt:** Official KAGAMI case-summary document printout in a folder, clean grid-like layout implied with unreadable marks, isolated evidence icon.

#### On Collect

[相馬律把摘要副本收進卷宗夾，動作謹慎，像在歸檔一件正式證物。]

**相馬律**：正式的摘要，先收好。這是這件案子的入口。

## Outro
- **Unlock:** evidence:kagami_summary collected and topic:hayasaka@commission discussed

[早坂茜把那疊夾好的委託文件正式遞到相馬律手上，遞之前用拇指順了一遍側邊，確認頁序無誤。]

**早坂茜**：三宅蒼太的母親就拜託我們了。下一步，先去見她，再走審查會的程序。

[相馬律接過文件，順手把邊角對齊。]

**相馬律**：好。我先把人和程序都擺到位，再回頭看這份摘要。

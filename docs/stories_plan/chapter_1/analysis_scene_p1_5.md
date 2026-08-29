# Scene 1.5: 零號小委託 — 把時間排回去

- **Summary:** 相馬在 P1 專用的整理板上選出能解釋重印時間的三項練習卡，確認收據真實卻不是付款時間；早坂保留一份紙本影本後，練習材料隨即結束。

## Intro

[場景：文具店櫃台。相馬把剛看過的四項資料並排，店主與學生隔著櫃台安靜等著。]
- **Background Prompt:** Interior of a small Tokyo stationery and copy shop, pale white fluorescent light, a wooden counter with a small receipt on it, an old register and a compact security monitor against the back wall, a copier humming, stacked paper reams and stationery shelves, faint rain audible through the glass door, no people, no readable text, cinematic visual-novel background, neo-noir mood.
- **BGM:** bgm_casework_day
- **BGS:** bgs_stationery_copy_shop
- **Background Asset ID:** background.chapter_1.scene_p1.tag_002

**相馬律**：先不用猜誰說謊。

**相馬律**：選出能一起解釋這張重印收據的東西，再比對一次。

## Board: 重印時間整理 {#p1_reprint_time_board}

- **Kind:** threshold
- **Prompt:** 選出能共同說明「十七點四十二分是重印時間，不是付款時間」的三項資料。
- **Eligible Cards:** [receipt_reprint, register_paper_jam, handwritten_ledger]
- **Minimum Selected:** 3
- **Minimum Distinct Source Groups:** 0
- **Required Proof Capabilities:** []
- **Allowed Procedural Statuses:** []
- **Require Source Group:** false
- **Reveals:** []
- **Incomplete Feedback:** 還少了一項能把重印時間和付款時間拆開的資料。
- **Incorrect Feedback:** 這組資料沒有把「收據何時重印」和「影印費何時付出」一起說清楚。
- **Hint:** 先找出收據為何晚出現，再找能固定付款時間的紙本紀錄。

### Card: 標示 REPRINT 的收據 {#receipt_reprint}

- **Source:** practice:p1_receipt_reprint
- **Summary:** 收據上的十七點四十二分，旁邊明確印著 `REPRINT`。

### Card: 收銀機出紙口的卡紙痕跡 {#register_paper_jam}

- **Source:** practice:p1_register_paper_jam
- **Summary:** 新的撕裂紙屑說明原本的收據可能卡在出紙口，之後才需要重印。

### Card: 監視器中的找零畫面 {#cctv_change}

- **Source:** practice:p1_cctv_change
- **Summary:** 畫面顯示店主在學生離開前找零；螢幕時間是十七點三十八分。

### Card: 手寫帳本的影印費 {#handwritten_ledger}

- **Source:** practice:p1_handwritten_ledger
- **Summary:** 店主在帳本上記下十七點三十七分收到一筆影印費。

### Incorrect Selection

- **Cards:** [cctv_change]
- **Feedback:** 監視器畫面是真的，也看得見找零；但它只證明學生在十七點三十八分前離開，不能單獨說明為什麼收據晚到十七點四十二分。

### Incorrect Selection

- **Cards:** [receipt_reprint]
- **Feedback:** 單看這張收據，學生反而更像是在離店後才付款。先別把重印時間當成付款時間。

### Result Dialogue

**相馬律**：收據是真的。

**相馬律**：但它記下的是收銀機卡紙後，在十七點四十二分重印的時間。

**相馬律**：帳本記著十七點三十七分的影印費。

**相馬律**：監視器也看見店主找零後，學生在十七點三十八分離開。

**相馬律**：學生付過錢，店主也沒有造假。

**相馬律**：只是兩個人把同一張真的收據，讀成了不同的時間。

**學生**：……所以我沒有漏付。

**店主**：是我太快把四十二分當成付款了。對不起。

## Outro

[早坂把那張重印收據借過來，在影印機上印了一份。影本還帶著溫熱。]

**早坂茜**：這份紙本我帶走。小事也要留一個能回頭看的版本。

**相馬律**：你連這種小事都留？

**早坂茜**：小事才最容易被當成沒必要留。

**旁白**：整理板上的練習卡隨著這件小委託收起，沒有被放進任何卷宗。

[相馬收起卷宗夾；早坂把影本夾進筆記本。兩人推開店門，走回雨裡。]

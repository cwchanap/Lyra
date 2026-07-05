# Scene 10: 最終審查會 — 門鎖沒說謊，是摘要讀錯了

## Intro

[場景：KAGAMI 證據摘要審查會，白日。長桌一側坐著相馬律與早坂茜，另一側是主理的神谷澪，黑瀨徹立在證物推車旁，旁聽席上坐著三宅母親，她膝上放著一只飯糰袋。]
- **Background Prompt:** KAGAMI evidence-summary review hearing room in daylight before formal arguments, long table, evidence cart, sparse gallery seating, restrained legal tension, no prominent foreground characters, no readable text.
- **BGM:** bgm_review_board_victory
- **BGS:** bgs_review_board_room

[神谷澪把摘要報告攤在桌面正中，指尖壓在那行被標為主時間錨的紀錄上。]

**早坂茜**：辯方手上，有好幾條彼此獨立的矛盾。時間、動線、動機，都對不上摘要那條主時間線。

**神谷澪**：辯方準備好了，我這邊隨時可以開始。

**早坂茜**：不過我先講清楚程序。

**早坂茜**：那段後場門鎖的限定片段，現在還沒核准調出。

**神谷澪**：對。我不會因為你們說「有矛盾」就放行原始紀錄。

**神谷澪**：先用你們已經拿到的材料，把摘要那條時間線動搖了，我才會考慮開那扇門。

**相馬律**：可以。我們一條一條來。

## Phase: 三宅小謊不是殺人 {#p1}
- **Kind:** inquiry
- **Required:** true
- **Status:** unlocked
- **Background Prompt:** KAGAMI evidence-summary review hearing room in daylight, long table with case-summary report and collected records, restrained legal tension, no readable text.
- **BGM:** bgm_review_board_victory
- **BGS:** bgs_review_board_room

[場景：KAGAMI 證據摘要審查會，白日，長桌上攤著摘要報告與幾份從現場帶回的紀錄。]

[神谷澪翻到摘要裡關於三宅證詞的那一頁，語氣平穩。]

**神谷澪**：第一條，從證詞可信度開始。

### Subject: 神谷澪 {#kamiya}
- **Role:** KAGAMI 證據摘要審查會主理
- **Bio:** 主理審查會的把關者，理性而精確；她信任摘要，因為她比誰都清楚人的偏見有多危險。

### Question: 證詞可信度 {#q_p1}
- **Status:** unlocked
- **Required:** true

#### Testimony

- **On Loop:** **神谷澪**：哪一句還對不上，你再指一次。
- **Default Challenge:** **相馬律**：這句先停一下。
- **Default Wrong:** **神谷澪**：這一句我沒說錯，換個東西再來。

##### Line: 三宅說謊故摘要更可信 {#summary_miyake_most_credible}

**神谷澪**：三宅在問話裡說過謊。一個會說謊的人，跟一份系統摘要放在一起，摘要當然更可信。

**神谷澪**：他記不清時間，他瞞下後場拿走的東西。會說謊的人，本來就該被多看兩眼。這不是偏見，是常識。

- **Contradiction:** evidence:closing_routine
- **Challenge:** **相馬律**：他說的那兩個謊，我都能對上該有的東西。先看那段閉店流程。
- **On Correct:** **相馬律**：他瞞的是要丟的蛋糕盒，記不清的那段是躲著打給母親——兩件事都落在閉店流程裡。是小謊，不是殺人。
- **On Wrong Evidence:** **神谷澪**：人格不是證據。他孝不孝順，跟那一晚有沒有殺人，是兩回事。拿能對上那句謊話的東西來。

## Phase: 死亡更早 {#p2}
- **Kind:** inquiry
- **Required:** true
- **Status:** locked
- **Unlock:** phase:p1 completed
- **Background Prompt:** Review hearing table with time-related cafe evidence, forensic preliminary sheet and small record cards arranged under cold daylight, no readable document text.
- **BGM:** bgm_review_board_victory
- **BGS:** bgs_review_board_room

[場景：KAGAMI 證據摘要審查會，白日，桌面換上現場帶回的時間相關紀錄與鑑識初判。]

[神谷澪把摘要裡那行死亡時間，往三宅進後場之後的位置一指。]

**神谷澪**：第二條，時間。

### Subject: 神谷澪 {#kamiya}
- **Role:** KAGAMI 證據摘要審查會主理
- **Bio:** 主理審查會的把關者，理性而精確；她信任摘要，因為她比誰都清楚人的偏見有多危險。

### Question: 死亡時間 {#q_p2}
- **Status:** unlocked
- **Required:** true

#### Testimony

- **On Loop:** **神谷澪**：要往前移那條死亡時間，你再指一次。
- **Default Challenge:** **相馬律**：這句，我想再確認一下。
- **Default Wrong:** **神谷澪**：這對不上死亡那一分鐘，換一個。

##### Line: 死亡在三宅進後場後 {#summary_death_after_miyake}

**神谷澪**：按摘要排，死亡落在三宅進後場之後。時間順下來，他就在那扇門裡。

**神谷澪**：摘要把三宅那段動線當成主錨，死亡時間是順著它排的。你要往前移，得拿出比一杯咖啡更硬的東西。

- **Contradiction:** evidence:victim_phone_notification
- **Challenge:** **相馬律**：那條死亡時間，得往前移。看死者手機那則通知停在幾分。
- **On Correct:** **相馬律**：通知停在二十二點五十八分前後，後場掛鐘停在五十九分，豆罐上的擦痕、鑑識初判都對著同一段——死亡比摘要寫的更早。
- **On Wrong Evidence:** **神谷澪**：那杯咖啡只證明第二個人被等著、提早到了，證不到死亡的那一分鐘。別拿它當死亡時刻。

## Phase: 第三者更早進入 {#p3}
- **Kind:** inquiry
- **Required:** true
- **Status:** locked
- **Unlock:** phase:p2 completed
- **Background Prompt:** Review hearing table covered with an L-shaped backroom floor plan and floor-drying record cards, officials across the table, quiet pressure, no readable labels.
- **BGM:** bgm_review_board_victory
- **BGS:** bgs_review_board_room

[場景：KAGAMI 證據摘要審查會，白日，桌上鋪開後場 L 型平面圖與地面乾燥分布的紀錄。]

[神谷澪看著平面圖，手指沿著後場那條轉角線移動。]

**神谷澪**：第三條。就算更早，那也可能還是三宅。

### Subject: 神谷澪 {#kamiya}
- **Role:** KAGAMI 證據摘要審查會主理
- **Bio:** 主理審查會的把關者，理性而精確；她信任摘要，因為她比誰都清楚人的偏見有多危險。

### Question: 更早進場的人 {#q_p3}
- **Status:** unlocked
- **Required:** true

#### Testimony

- **On Loop:** **神谷澪**：要把他從那個位置拉開，你再指一次。
- **Default Challenge:** **相馬律**：這句，先讓我對一下。
- **Default Wrong:** **神谷澪**：這證不到是哪一個人，換一個。

##### Line: 更早也可能是三宅 {#summary_could_still_be_miyake}

**神谷澪**：時間往前移，不代表換了人。更早那一刻，站在後場的也可能就是三宅。

**神谷澪**：他那段時間本來就在店裡，動線貼著後場。把時間往前挪，他還是嫌疑最大的那一個。

- **Contradiction:** evidence:miyake_pov_replay
- **Challenge:** **相馬律**：要把他從那個位置拉開，就看他那時的視線回放。
- **On Correct:** **相馬律**：他的視線被 L 型轉角擋住，看不到內側倉庫；地面那條更早的水跡、牆角的濕傘套，都對著承包商那道側門——是第三個人更早進來。
- **On Wrong Evidence:** **神谷澪**：傘套只證明先進來的那個人走的是承包商動線，證不到是哪一個人。要對到人，得靠工單和憑證。

## Phase: 申請限定調出 {#gate}
- **Kind:** inquiry
- **Required:** true
- **Status:** locked
- **Unlock:** phase:p3 completed
- **Background Prompt:** KAGAMI review hearing room with a limited-record authorization form centered before the presiding official, formal stamp pad, no readable text.
- **BGM:** bgm_review_board_victory
- **BGS:** bgs_review_board_room

[場景：KAGAMI 證據摘要審查會，白日，神谷澪面前擺著原始門鎖紀錄的調閱授權單。]

[相馬律與早坂茜並肩站起，把三條已成立的矛盾，疊在神谷面前。]

**早坂茜**：三條矛盾都成立了。小謊不是殺人、死亡更早、第三個人更早進來。

**早坂茜**：範圍限定：後場門鎖、二十二點五十到二十三點十、事件序號、憑證類型、同步時間、保全鏈標記。只調這幾欄，不碰範圍外的任何資料。

### Subject: 神谷澪 {#kamiya}
- **Role:** KAGAMI 證據摘要審查會主理
- **Bio:** 主理審查會的把關者，理性而精確；她信任摘要，因為她比誰都清楚人的偏見有多危險。

### Question: 請求核准片段 {#q_request_clip}
- **Status:** unlocked
- **Required:** true

#### Testimony

- **On Loop:** **神谷澪**：要我開那扇門，先把理由再擺一次。

##### Line: 原始紀錄壓著 {#gate_hold_record}

**神谷澪**：我不會因為你們說有矛盾，就放行原始門鎖紀錄。

**神谷澪**：先用你們已經拿到的材料，把摘要那條主時間錨動搖了，我才會考慮開那扇門。這之前，原始順序一律壓著。

- **Contradiction:** evidence:doorlock_summary_timetable
- **Challenge:** **相馬律**：現在，我們正式請求核准那段後場門鎖的限定調出。要調的，正是這份摘要背後、被排成主時間線的那筆原始紀錄。
- **On Correct:** **神谷澪**：……剛才那三條矛盾，已經夠我懷疑這行主時間錨了。範圍就那六欄，我核准這段限定調出，超出範圍的不給。
  - **Reveals:** [evidence:approved_clip]
- **On Wrong Evidence:** **神谷澪**：這動搖不了那行時間。拿那份把門鎖事件排成主時間線的摘要來，我才知道你們要翻的是哪一筆。

## Phase: 門鎖時間不是事件時間 {#p4}
- **Kind:** inquiry
- **Required:** true
- **Status:** locked
- **Unlock:** phase:gate completed
- **Background Prompt:** Hearing table with approved doorlock excerpt beside a printed summary timetable, two parallel record stacks, precise procedural mood, no readable rows.
- **BGM:** bgm_review_board_victory
- **BGS:** bgs_review_board_room

[場景：KAGAMI 證據摘要審查會，白日，桌面中央攤著剛核准的限定片段與門鎖摘要時刻表。]

[黑瀨徹把核准調出的限定片段推到桌面中央。]

**黑瀨徹**：限定片段到手。證物鏈標記我已經固定過，沒有斷點。

[神谷澪把限定片段與摘要時刻表並排，指著摘要上那行二十三點零七分五十秒。]

**神谷澪**：第四條。門鎖紀錄沒被偽造，所以三宅那個時間是可信的。

### Subject: 神谷澪 {#kamiya}
- **Role:** KAGAMI 證據摘要審查會主理
- **Bio:** 主理審查會的把關者，理性而精確；她信任摘要，因為她比誰都清楚人的偏見有多危險。

### Question: 門鎖時間 {#q_p4}
- **Status:** unlocked
- **Required:** true

#### Testimony

- **On Loop:** **神谷澪**：這行時間你要翻，再指一次。
- **Default Challenge:** **相馬律**：這句，先讓我比一下。
- **Default Wrong:** **神谷澪**：這一句沒問題，換個東西。

##### Line: 門鎖未偽造故三宅時間可信 {#summary_doorlock_authentic}

**神谷澪**：門鎖紀錄沒被改過。沒被改過的時間，就該照著信。二十三點零七分五十秒，寫得清清楚楚。

**神谷澪**：門、鏡頭、員工憑證，全都對得上三宅。摘要抓到的，就是最好對得上的那一筆。

- **Contradiction:** evidence:local_sequence_record
- **Challenge:** **相馬律**：紀錄沒造假，錯的是讀法。對著核准的限定片段，看本機那份事件順序紀錄。
- **On Correct:** **相馬律**：本機事件序號的先後，跟摘要那行對不上——二十三點零七分五十秒是各路紀錄校時、合流的一刻，不是三宅的事件時間；開頭那閃過的 89.7 秒，就是這段合併延遲。
- **On Wrong Evidence:** **神谷澪**：原始紀錄、本機順序都沒被動過手腳。錯的不是紀錄，是摘要對它的讀法。別把這頂帽子扣到造假上。

## Phase: 北見是真兇 {#p5}
- **Kind:** inquiry
- **Required:** true
- **Status:** locked
- **Unlock:** phase:p4 completed
- **Background Prompt:** Final review hearing table with work order, credential card, memo, draft, and umbrella-sleeve comparison arranged as an evidence chain, no readable text.
- **BGM:** bgm_review_board_victory
- **BGS:** bgs_review_board_room

[場景：KAGAMI 證據摘要審查會，白日，桌面攤開工單、憑證、備忘、草稿與傘套比對，匯成一條完整的鏈。]

[神谷澪看著那一整排材料，仍然沒有鬆口。]

**神谷澪**：最後一條。就算三宅的嫌疑降下來了，你也證不了是北見殺的人。

### Subject: 神谷澪 {#kamiya}
- **Role:** KAGAMI 證據摘要審查會主理
- **Bio:** 主理審查會的把關者，理性而精確；她信任摘要，因為她比誰都清楚人的偏見有多危險。

### Question: 是否北見 {#q_p5}
- **Status:** unlocked
- **Required:** true

#### Testimony

- **On Loop:** **神谷澪**：要把他放進那一刻，你再指一次。
- **Default Challenge:** **相馬律**：這句，先讓我對一下。
- **Default Wrong:** **神谷澪**：這放不進那一刻，換一個。

##### Line: 不能證明北見殺人 {#summary_cannot_prove_kitami}

**神谷澪**：拆掉三宅，不等於補上北見。沒有人證、沒有兇手的時間，你憑什麼說是他？

**神谷澪**：你拆了摘要那條線，那一格現在是空的。空格不會自己填上北見的名字。

- **Contradiction:** evidence:temp_maintenance_workorder
- **Challenge:** **相馬律**：那一格能填。那晚臨時排的那張後場門鎖維護工單，就落在他一個人身上。
- **On Correct:** **相馬律**：臨時工單、外包憑證、北見的權限全落在他身上；備忘與多點那杯咖啡都標著 K，濕傘套又對上承包商資材包——他有權限、有動機、有壓力，還借了摘要的偏好，把三宅塞進那一刻。
- **On Wrong Evidence:** **神谷澪**：人格不是不在場證明，反過來也一樣。你不能因為他像壞人就定他。拿那晚把他放進後場的那張東西來。

## Evidence Manifest

### evidence:approved_clip {#approved_clip}
- **Name:** 核准片段（限定調出）
- **Description:** 審查會核准的後場門鎖限定調出片段，範圍嚴格框定在六個欄位。
- **Details:** 限定範圍為後場門鎖、二十二點五十到二十三點十、事件序號、憑證類型、同步時間、保全鏈標記。它把同步合併時間，與本機事件順序分了開來——讓二十三點零七分五十秒那一刻，現出它「校時合流」的真面目，而不是某個人的事件時間。
- **Image Prompt:** Approved limited doorlock excerpt with two separated timeline columns and evidence-chain marker shapes, all rows unreadable, isolated evidence icon.

#### On Collect

**相馬律**：片段裡，事件序號是一條順序，同步時間是另一條。

**相馬律**：二十三點零七分五十秒，落在同步時間那一欄。是合流，不是某個人進門的那一刻。

**早坂茜**：保全鏈標記沒有斷點。這段可以拿上桌。

## Outro

[神谷澪把摘要報告闔上，在主嫌方向那一欄畫了一道撤回的記號。]

**神谷澪**：北見修一，指認成立。三宅蒼太的主嫌方向，撤回。

**神谷澪**：審查會保留這條鏈，轉入重新調查。原本那條主時間線，不再採用。

[旁聽席上，三宅母親把膝上那只飯糰袋輕輕抱緊了一下，沒有出聲。]

**早坂茜**：程序上，三宅這邊洗清了。重新調查的入口，我們守住了。

**相馬律**：三宅的母親，可以把那袋飯糰帶回家了。

[相馬律把那一整排材料一份份疊齊，望向窗外仍在落的雨。]

**相馬律**：剩下的，交給重新調查。

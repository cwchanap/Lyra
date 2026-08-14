# Scene 10: 最終審查會 — 門鎖沒說謊，是摘要讀錯了

- **Summary:** 最終審查會拆開本機順序與伺服器合併時間，證明門鎖沒有說謊，錯的是摘要替真實紀錄補上的意思。

## Intro

[場景：KAGAMI 證據摘要審查會，白日。長桌一側坐著相馬律與早坂茜，另一側是主理的神谷澪，黑瀨徹立在證物推車旁，旁聽席上坐著三宅母親，她膝上放著一只飯糰袋。]
- **Background Prompt:** KAGAMI evidence-summary review hearing room in daylight before formal arguments, long table, evidence cart, sparse gallery seating, restrained legal tension, no prominent foreground characters, no readable text.
- **BGM:** bgm_review_board_victory
- **BGS:** bgs_review_board_room

[神谷澪把摘要報告攤在桌面正中，指尖壓在那行被標為主時間錨的紀錄上。]

[相馬律的目光掃過桌面那疊材料，側向早坂。]

**相馬律**：三條都帶到了。今天看能不能一次推到位。

**早坂茜**：穩著問。她信摘要，別想一步到位。

**早坂茜**：辯方手上，有好幾條彼此獨立的矛盾。

**早坂茜**：時間、動線、動機，都對不上摘要那條主時間線。

**神谷澪**：辯方準備好了，我這邊隨時可以開始。

**早坂茜**：不過我先講清楚程序。

**早坂茜**：那段後場門鎖的核准片段，現在還沒核准調出。

**神谷澪**：對。我不會因為你們說「有矛盾」就准許調出核准片段。

**神谷澪**：先用你們已經拿到的材料，把摘要那條時間線動搖了。

**神谷澪**：我才會考慮開那扇門。

**相馬律**：可以。我們一條一條來。

[相馬律把卷宗夾在膝上擺正，手指順過側邊，又順了一次。]

**相馬律**：……第一次坐在這邊。

**早坂茜**：材料都在桌上了。你只管問。

[相馬的目光越過桌面，落在旁聽席。三宅母親坐在最裡面，兩手攥著膝上那只飯糰袋。]

**相馬律**：……嗯。

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
- **Loop Prompt:** **相馬律**：哪一句對不上，我再確認一次。
- **Default Challenge:** **相馬律**：這句先停一下。
- **Default Wrong:** **神谷澪**：這一句我沒說錯，換個東西再來。
- **Wrong Reply:** **相馬律**：不是比人品，要對的是那句謊話。

##### Line: 三宅說謊故摘要更可信 {#summary_miyake_most_credible}

**神谷澪**：三宅有兩個小謊，摘要因此把他列為主嫌。

**神谷澪**：小謊既然成立，摘要的可信度就高於他的說法。

**神谷澪**：這一條，先按程序確認。

- **Contradiction:** evidence:closing_routine
- **Challenge:** **相馬律**：他說的那兩個謊，我都能對上該有的東西。先看那段閉店流程。
- **On Correct:** **相馬律**：蛋糕盒與母親通話都對得上閉店流程；是小謊，不是殺人。
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

**神谷澪**：他沒有完全乾淨。可一個小謊，撐不起一條殺人的指控。這一條，我認。

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
- **Loop Prompt:** **相馬律**：那條死亡時間，我再看一次。
- **Default Challenge:** **相馬律**：這句，我想再確認一下。
- **Default Wrong:** **神谷澪**：這對不上死亡那一分鐘，換一個。
- **Wrong Reply:** **相馬律**：這換不到死亡那一刻，我再找別的。

##### Line: 死亡在三宅進後場後 {#summary_death_after_miyake}

**神谷澪**：摘要把死亡排在三宅進後場之後，並以他的動線作主錨。

**神谷澪**：要往前移，必須有更硬的時間紀錄。

- **Contradiction:** evidence:victim_phone_notification
- **Challenge:** **相馬律**：那條死亡時間，得往前移。看死者手機那則通知停在幾分。
- **On Correct:** **相馬律**：手機通知與後場紀錄顯示衝突早於摘要；摘要的主時間線不成立。
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

[神谷澪沉默了幾秒，拿起筆，在摘要上那行死亡時間旁劃了一道線。]

**神谷澪**：衝突更早。這行，先擱著。

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
- **Loop Prompt:** **相馬律**：把他放在那個位置的理由，再擺一次。
- **Default Challenge:** **相馬律**：這句，先讓我對一下。
- **Default Wrong:** **神谷澪**：這證不到是哪一個人，換一個。
- **Wrong Reply:** **相馬律**：這對不到是哪一個人，下一步找工單和憑證。

##### Line: 更早也可能是三宅 {#summary_could_still_be_miyake}

**神谷澪**：時間往前移，不等於換了人；三宅仍可能在後場。

**神谷澪**：要排除他，必須證明更早的進場者另有其人。

- **Contradiction:** evidence:miyake_pov_replay
- **Challenge:** **相馬律**：要把他從那個位置拉開，就看他那時的視線回放。
- **On Correct:** **相馬律**：L 型轉角擋住三宅視線；半乾水跡證明有人在他之前走過承包商動線。
- **On Wrong Evidence:** **神谷澪**：傘套只留下後來的雨水，不能替更早水痕認人。要把那個空位對到人，得靠工單和外包憑證。

## Phase: 申請限定調出 {#gate}
- **Kind:** inquiry
- **Required:** true
- **Status:** locked
- **Represented Authority:** KAGAMI 證據摘要審查會主理
- **Unlock:** phase:p3 completed and objective:prepare_narrow_lock_request completed
- **Background Prompt:** KAGAMI review hearing room with a limited-record authorization form centered before the presiding official, formal stamp pad, no readable text.
- **BGM:** bgm_review_board_victory
- **BGS:** bgs_review_board_room

[場景：KAGAMI 證據摘要審查會，白日，神谷澪面前擺著後場門鎖核准片段的調閱授權單。]

**神谷澪**：書記官，補一筆。三宅站位無法目視屍體，第三條矛盾成立。

[相馬律與早坂茜並肩站起，把三條已成立的矛盾，疊在神谷面前。]

**早坂茜**：三條矛盾已成立：小謊、死亡時間、第三者先行進場。

**早坂茜**[stern]：請核准限定片段，只比對摘要與本機順序。

### Subject: 神谷澪 {#kamiya}
- **Role:** KAGAMI 證據摘要審查會主理
- **Bio:** 主理審查會的把關者，理性而精確；她信任摘要，因為她比誰都清楚人的偏見有多危險。

### Question: 請求核准片段 {#q_request_clip}
- **Status:** unlocked
- **Required:** true

#### Testimony

- **On Loop:** **神谷澪**：要我開那扇門，先把理由再擺一次。
- **Loop Prompt:** **相馬律**：要動那扇門，我把理由再理一次。
- **Wrong Reply:** **相馬律**：不是這個，我得先找到那份摘要。

##### Line: 核准片段暫緩調出 {#gate_hold_record}

**神谷澪**：本機順序已固定，但摘要那行秒數仍未對上。

**神谷澪**：先說清楚，你們要核准哪一筆、限定到哪裡。

- **Contradiction:** evidence:doorlock_summary_timetable
- **Challenge:** **相馬律**：本機順序固定；請只核對摘要主時間線與它的來源。
- **On Correct:** **神谷澪**：三條矛盾加上本機順序，足以核准限定片段；範圍外不給。
  - **Reveals:** [grant_authorization:narrow_lock_export, evidence:approved_clip]
- **On Wrong Evidence:** **神谷澪**：這動搖不了那行時間。拿那份把門鎖排成主時間線的摘要來，我才知道你們要翻哪一筆。

## Phase: 門鎖時間不是事件時間 {#p4}
- **Kind:** inquiry
- **Required:** true
- **Status:** locked
- **Unlock:** phase:gate completed and authorization:narrow_lock_export granted
- **Background Prompt:** Hearing table with approved doorlock excerpt beside a printed summary timetable, two parallel record stacks, precise procedural mood, no readable rows.
- **BGM:** bgm_review_board_victory
- **BGS:** bgs_review_board_room

[場景：KAGAMI 證據摘要審查會，白日，桌面中央攤著剛核准的限定片段與門鎖摘要時刻表。]

[黑瀨徹把核准調出的限定片段推到桌面中央。]

**黑瀨徹**：核准片段到手，證物鏈沒有斷點。

[神谷澪把限定片段與摘要時刻表並排，指著摘要上那行二十三點零七分五十秒。]

**神谷澪**：第四條。門鎖紀錄未被偽造，三宅那個時間可信。

### Subject: 神谷澪 {#kamiya}
- **Role:** KAGAMI 證據摘要審查會主理
- **Bio:** 主理審查會的把關者，理性而精確；她信任摘要，因為她比誰都清楚人的偏見有多危險。

### Question: 門鎖時間 {#q_p4}
- **Status:** unlocked
- **Required:** true

#### Testimony

- **On Loop:** **神谷澪**：這行時間你要翻，再指一次。
- **Loop Prompt:** **相馬律**：這行時間，我再讀一次。
- **Default Challenge:** **相馬律**：這句，先讓我比一下。
- **Default Wrong:** **神谷澪**：這一句沒問題，換個東西。
- **Wrong Reply:** **相馬律**：不是造假的事，要拿的是本機那份事件順序。

##### Line: 門鎖未偽造故三宅時間可信 {#summary_doorlock_authentic}

**神谷澪**：門鎖紀錄未被改過，二十三點零七分五十秒也清楚。

**神谷澪**：門、鏡頭、憑證都對得上三宅；摘要抓到的是最好對上的一筆。

- **Contradiction:** evidence:approved_clip
- **Challenge:** **相馬律**：紀錄沒造假，錯的是讀法；請對照核准片段的本機順序。
- **On Correct:** **相馬律**：外包憑證早於三宅憑證；摘要在其後合併，二十三點零七分五十秒是合併時間，不是進門時間。
- **On Wrong Evidence:** **神谷澪**：本機順序沒有被動過手腳。錯的不是門鎖，是摘要對它的讀法。別把這頂帽子扣到造假上。

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
- **Loop Prompt:** **相馬律**：把他放進那一刻，我再想一次。
- **Default Challenge:** **相馬律**：這句，先讓我對一下。
- **Default Wrong:** **神谷澪**：這放不進那一刻，換一個。
- **Wrong Reply:** **相馬律**：不是靠印象定他，我得找那張把他放進後場的東西。

##### Line: 不能證明北見殺人 {#summary_cannot_prove_kitami}

**神谷澪**：拆掉三宅，不等於補上北見。

**神谷澪**：沒有人證、沒有兇手的時間，你憑什麼說是他？

**神谷澪**：你拆了摘要那條線，那一格現在是空的。空格不會自己填上北見的名字。

- **Contradiction:** evidence:temp_maintenance_workorder
- **Challenge:** **相馬律**：那一格能填。臨時維護工單對上那組外包憑證，權限名單再把它們只對到北見一個人。
- **On Correct:** **相馬律**：工單和外包憑證經權限名單只對到北見；備忘、第二杯咖啡的 K、盜賣紀錄與帳號審核壓力補上動機與壓力。水痕與傘套只留在承包商動線的前後脈絡；他藉摘要把三宅塞進那一刻。
- **On Wrong Evidence:** **神谷澪**：傘套和雨水只說明動線，不能替更早進場的人認名。要放進北見，先把工單和外包憑證對到他。

## Evidence Manifest

### evidence:approved_clip {#approved_clip}
- **Name:** 核准片段（限定調出）
- **Description:** 審查會核准的後場門鎖限定調出片段，範圍嚴格框定在六個欄位。
- **Details:** 限定範圍為後場門鎖、二十二點五十到二十三點十、本機順序、憑證，及這一筆在摘要裡怎麼排、從哪裡來。它把摘要排出的時間和本機順序擺在一起，顯示二十三點零七分五十秒只是摘要排上的時間，不是某個人的事件時間。
- **Image Prompt:** Approved limited doorlock excerpt with two separated timeline columns and evidence-chain marker shapes, all rows unreadable, isolated evidence icon.

#### On Collect

**相馬律**：核准片段裡，本機順序和摘要擺在一起，前後卻對不上。

**相馬律**：二十三點零七分五十秒，是摘要排上的時間；不是三宅進門那一刻。

**早坂茜**：這段的來路對得上，可以拿上桌。

## Outro

[神谷澪把摘要報告闔上，在主嫌方向那一欄畫了一道撤回的記號。]

**神谷澪**：……工單和憑證把那個空位對到北見。

**神谷澪**：水痕與傘套，只保留後巷動線的前後脈絡。

**神谷澪**：北見修一，指認成立。三宅蒼太的主嫌方向，撤回。

**神谷澪**：審查會保留這條鏈，轉入重新調查。原本那條主時間線，不再採用。

[旁聽席上，三宅母親把膝上那只飯糰袋輕輕抱緊了一下，沒有出聲。]

**早坂茜**：程序上，三宅這邊洗清了。重新調查的入口，我們守住了。

**相馬律**：三宅的母親，可以把那袋飯糰帶回家了。

[相馬律把那一整排材料一份份疊齊，望向窗外仍在落的雨。]

**相馬律**：剩下的，交給重新調查。

[早坂茜把疊齊的材料推過來。]

**早坂茜**：走。重新調查那邊，明天先遞狀。

[相馬律站起來，跟著早坂走向門口。]

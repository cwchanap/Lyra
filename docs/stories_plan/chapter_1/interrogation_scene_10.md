# Scene 10: 最終審查會 — 門鎖沒說謊，是摘要讀錯了

- **Summary:** 最終審查會拆開本機順序與伺服器合併時間，證明門鎖沒有說謊，錯的是摘要替真實紀錄補上的意思。

## Intro

[場景：KAGAMI 證據摘要審查會，白日。長桌一側坐著相馬律與早坂茜，另一側是主理的神谷澪，黑瀨徹立在證物推車旁，旁聽席上坐著三宅母親，她膝上放著一只飯糰袋。]
- **Background Prompt:** KAGAMI evidence-summary review hearing room in daylight before formal arguments, long table, evidence cart, sparse gallery seating, restrained legal tension, no prominent foreground characters, no readable text.
- **BGM:** none
- **BGS:** bgs_review_board_room

[神谷澪把摘要報告攤在桌面正中，指尖壓在那行被標為主時間錨的紀錄上。]

[相馬律的目光掃過桌面那疊材料，側向早坂。]

**相馬律**：三條都帶到了。今天看能不能一次推到位。 {#L001}

**早坂茜**：穩著問。她信摘要，別想一步到位。 {#L002}

**早坂茜**：辯方手上，有好幾條彼此獨立的矛盾。 {#L003}

**早坂茜**：時間、動線、動機，都對不上摘要那條主時間線。 {#L004}

**神谷澪**：辯方準備好了，我這邊隨時可以開始。 {#L005}

**神谷澪**：先說好，我不會因為你們說「有矛盾」就調出核准片段。 {#L008}

**神谷澪**：先用手上的材料動搖摘要，我才考慮開那扇門。 {#L009}

**相馬律**：可以。我們一條一條來。 {#L011}

[相馬律把卷宗夾在膝上擺正，手指順過側邊，又順了一次。]

**相馬律**：……上次坐在這裡，什麼都沒推動。 {#L012}

**早坂茜**：這次材料都在桌上了。你只管問。 {#L013}

[相馬的目光越過桌面，落在旁聽席。三宅母親坐在最裡面，兩手攥著膝上那只飯糰袋。]

**相馬律**：……嗯。 {#L014}

## Phase: 三宅小謊不是殺人 {#p1}
- **Kind:** inquiry
- **Required:** true
- **Status:** unlocked
- **Background Prompt:** KAGAMI evidence-summary review hearing room in daylight, long table with case-summary report and collected records, restrained legal tension, no readable text.
- **BGM:** none
- **BGS:** bgs_review_board_room

[場景：KAGAMI 證據摘要審查會，白日，長桌上攤著摘要報告與幾份從現場帶回的紀錄。]

[神谷澪翻到摘要裡關於三宅證詞的那一頁，語氣平穩。]

**神谷澪**：第一條，從證詞可信度開始。 {#L015}

### Subject: 神谷澪 {#kamiya}
- **Role:** KAGAMI 證據摘要審查會主理
- **Bio:** 主理審查會的把關者，理性而精確；她信任摘要，因為她比誰都清楚人的偏見有多危險。

### Question: 證詞可信度 {#q_p1}
- **Status:** unlocked
- **Required:** true

#### Testimony

- **On Loop:** **神谷澪**：哪一句還對不上，你再指一次。 {#L016}
- **Loop Prompt:** **相馬律**：哪一句對不上，我再確認一次。 {#L017}
- **Default Challenge:** **相馬律**：這句先停一下。 {#L018}
- **Default Wrong:** **神谷澪**：這一句我沒說錯，換個東西再來。 {#L019}
- **Wrong Reply:** **相馬律**：不是比人品，我得先弄清楚那兩句謊話在遮什麼。 {#L020}

##### Line: 三宅說謊故摘要更可信 {#summary_miyake_most_credible}

**神谷澪**[skeptical]：三宅有兩個小謊，摘要因此把他列為主嫌。 {#L021}

**神谷澪**[skeptical]：小謊既然成立，摘要的可信度就高於他的說法。 {#L022}

**神谷澪**[skeptical]：這一條，先按程序確認。 {#L023}

- **Contradiction:** evidence:miyake_mother_call_confirmation
- **Challenge:** **相馬律**：他那兩個謊，我能一個一個對上去。 {#L024}
- **On Correct:** **相馬律**：打給母親、藏蛋糕盒，都是為了家裡的小事。兩個謊都不是在掩蓋殺人。 {#L025}
- **On Wrong Evidence:** **神谷澪**：這只能說他確實說了謊，看不出謊是為了什麼。孝不孝順，也不等於那晚沒殺人。 {#L026}

### Question: 死亡時間 {#q_p2}
- **Status:** locked
- **Unlock:** question:q_p1 answered
- **Required:** true

#### Testimony

- **On Loop:** **神谷澪**：要往前移那條死亡時間，你再指一次。 {#L027}
- **Loop Prompt:** **相馬律**：那條死亡時間，我再看一次。 {#L028}
- **Default Challenge:** **相馬律**：這句，我想再確認一下。 {#L029}
- **Default Wrong:** **神谷澪**：這對不上死亡那一分鐘，換一個。 {#L030}
- **Wrong Reply:** **相馬律**：這換不到死亡那一刻，我再找別的。 {#L031}

##### Line: 死亡在三宅進後場後 {#summary_death_after_miyake}

**神谷澪**：摘要把死亡排在三宅進後場之後，並以他的動線作主錨。 {#L032}

**神谷澪**：要往前移，必須有更硬的時間紀錄。 {#L033}

- **Contradiction:** evidence:victim_phone_notification
- **Challenge:** **相馬律**：那條死亡時間，得往前移。看死者手機那則通知停在幾分。 {#L034}
- **On Correct:** **相馬律**：手機通知與後場紀錄顯示衝突早於摘要；摘要的主時間線不成立。 {#L035}
- **On Wrong Evidence:** **神谷澪**：這釘不住衝突那一分鐘；要一筆不靠人記憶的時間。 {#L036}

### Question: 更早進場的人 {#q_p3}
- **Status:** locked
- **Unlock:** question:q_p2 answered
- **Required:** true

#### Testimony

- **On Loop:** **神谷澪**：要把他從那個位置拉開，你再指一次。 {#L037}
- **Loop Prompt:** **相馬律**：把他放在那個位置的理由，再擺一次。 {#L038}
- **Default Challenge:** **相馬律**：這句，先讓我對一下。 {#L039}
- **Default Wrong:** **神谷澪**：這證不到是哪一個人，換一個。 {#L040}
- **Wrong Reply:** **相馬律**：這排不到二十三點零六分之前，我再找更早的痕跡。 {#L041}

##### Line: 更早也可能是三宅 {#summary_could_still_be_miyake}

**神谷澪**：時間往前移，不等於換了人；三宅仍可能在後場。 {#L042}

**神谷澪**：要排除他，必須證明更早的進場者另有其人。 {#L043}

- **Contradiction:** evidence:floor_water_drying_map
- **Challenge:** **相馬律**：要把他從那個位置拉開，得有比他進場更早的痕跡。 {#L044}
- **On Correct:** **相馬律**：後門那灘水最晚二十三點零一分前就帶進來了，早於三宅二十三點零六分那趟。而且他站的位置，被 L 型轉角擋住，看不到屍體。 {#L045}
- **On Wrong Evidence:** **神谷澪**：這排不出比二十三點零六分更早的痕跡。我要的是能證明有人先進來的東西。 {#L046}

## Phase: 申請限定調出 {#gate}
- **Kind:** inquiry
- **Required:** true
- **Status:** locked
- **Represented Authority:** KAGAMI 證據摘要審查會主理
- **Unlock:** phase:p1 completed and objective:prepare_narrow_lock_request completed
- **Background Prompt:** KAGAMI review hearing room with a limited-record authorization form centered before the presiding official, formal stamp pad, no readable text.
- **BGM:** none
- **BGS:** bgs_review_board_room

[場景：KAGAMI 證據摘要審查會，白日，神谷澪面前擺著後場門鎖核准片段的調閱授權單。]

**神谷澪**：書記官，補一筆。三宅之前已有人進場，第三條矛盾成立。 {#L047}

[相馬律與早坂茜並肩站起，把三條已成立的矛盾，疊在神谷面前。]

**早坂茜**：三條矛盾已成立：小謊、死亡時間、有人先於三宅進場。 {#L048}

**早坂茜**[stern]：請核准限定片段，只比對摘要與本機順序。 {#L049}

### Subject: 神谷澪 {#kamiya}
- **Role:** KAGAMI 證據摘要審查會主理
- **Bio:** 主理審查會的把關者，理性而精確；她信任摘要，因為她比誰都清楚人的偏見有多危險。

### Question: 請求核准片段 {#q_request_clip}
- **Status:** unlocked
- **Required:** true

#### Testimony

- **On Loop:** **神谷澪**：要我開那扇門，先把理由再擺一次。 {#L050}
- **Loop Prompt:** **相馬律**：要動那扇門，我把理由再理一次。 {#L051}
- **Wrong Reply:** **相馬律**：這還不夠指到那一行，我得找出它是怎麼排進去的。 {#L052}

##### Line: 核准片段暫緩調出 {#gate_hold_record}

**神谷澪**：本機順序已固定，但摘要那行秒數仍未對上。 {#L053}

**神谷澪**：先說清楚，你們要核准哪一筆、限定到哪裡。 {#L054}

- **Contradiction:** evidence:doorlock_summary_timetable
- **Challenge:** **相馬律**：本機順序固定；請只核對摘要主時間線與它的來源。 {#L055}
- **On Correct:** **神谷澪**：三條矛盾加上本機順序，足以核准限定片段；範圍外不給。 {#L056}
  - **Reveals:** [grant_authorization:narrow_lock_export, evidence:approved_clip]
- **On Wrong Evidence:** **神谷澪**：摘要整份我看過；我要的是把門鎖那一行排進主時間線的那張表。 {#L057}

## Phase: 門鎖時間不是事件時間 {#p4}
- **Kind:** inquiry
- **Required:** true
- **Status:** locked
- **Unlock:** phase:gate completed and authorization:narrow_lock_export granted
- **Background Prompt:** Hearing table with approved doorlock excerpt beside a printed summary timetable, two parallel record stacks, precise procedural mood, no readable rows.
- **BGM:** bgm_breakthrough_pursuit
- **BGS:** bgs_review_board_room

[場景：KAGAMI 證據摘要審查會，白日，桌面中央攤著剛核准的限定片段與門鎖摘要時刻表。]

[黑瀨徹把核准調出的限定片段推到桌面中央。]

**黑瀨徹**：核准片段到手，證物鏈沒有斷點。 {#L058}

[神谷澪把限定片段與摘要時刻表並排，指著摘要上那行二十三點零七分五十秒。]

**神谷澪**：第四條。門鎖紀錄未被偽造，三宅那個時間可信。 {#L059}

### Subject: 神谷澪 {#kamiya}
- **Role:** KAGAMI 證據摘要審查會主理
- **Bio:** 主理審查會的把關者，理性而精確；她信任摘要，因為她比誰都清楚人的偏見有多危險。

### Question: 門鎖時間 {#q_p4}
- **Status:** unlocked
- **Required:** true

#### Testimony

- **On Loop:** **神谷澪**：這行時間你要翻，再指一次。 {#L060}
- **Loop Prompt:** **相馬律**：這行時間，我再讀一次。 {#L061}
- **Default Challenge:** **相馬律**：這句，先讓我比一下。 {#L062}
- **Default Wrong:** **神谷澪**：這一句沒問題，換個東西。 {#L063}
- **Wrong Reply:** **相馬律**：沒人說造假。要對的是核准片段和摘要，兩邊並排。 {#L064}

##### Line: 門鎖未偽造故三宅時間可信 {#summary_doorlock_authentic}

**神谷澪**：門鎖紀錄未被改過，二十三點零七分五十秒也清楚。 {#L065}

**神谷澪**：門、鏡頭、憑證都對得上三宅；摘要抓到的是最好對上的一筆。 {#L066}

- **Contradiction:** evidence:approved_clip
- **Challenge:** **相馬律**：紀錄沒造假，錯的是讀法；請對照核准片段的本機順序。 {#L067}
- **On Correct:** **相馬律**：外包憑證早於三宅憑證；摘要在其後合併，二十三點零七分五十秒是合併時間，不是進門時間。 {#L068}
- **On Wrong Evidence:** **神谷澪**：本機順序沒被動過手腳，但它不在核准範圍裡。把核准的片段和摘要並排，才看得出讀法哪裡錯。 {#L069}

## Phase: 空格填誰 {#p5}
- **Kind:** inquiry
- **Required:** true
- **Status:** locked
- **Unlock:** phase:p4 completed
- **Background Prompt:** Final review hearing table with work order, credential card, memo, draft, and umbrella-sleeve comparison arranged as an evidence chain, no readable text.
- **BGM:** bgm_breakthrough_pursuit
- **BGS:** bgs_review_board_room

[場景：KAGAMI 證據摘要審查會，白日，桌面攤開工單、憑證、備忘、草稿與傘套比對，匯成一條完整的鏈。]

[神谷澪看著那一整排材料，仍然沒有鬆口。]

**神谷澪**：最後一條。就算三宅的嫌疑降下來了，你也證不了是北見殺的人。 {#L070}

### Subject: 神谷澪 {#kamiya}
- **Role:** KAGAMI 證據摘要審查會主理
- **Bio:** 主理審查會的把關者，理性而精確；她信任摘要，因為她比誰都清楚人的偏見有多危險。

### Question: 是否北見 {#q_p5}
- **Status:** unlocked
- **Required:** true

#### Testimony

- **On Loop:** **神谷澪**：要把他放進那一刻，你再指一次。 {#L071}
- **Loop Prompt:** **相馬律**：把他放進那一刻，我再想一次。 {#L072}
- **Default Challenge:** **相馬律**：這句，先讓我對一下。 {#L073}
- **Default Wrong:** **神谷澪**：這放不進那一刻，換一個。 {#L074}
- **Wrong Reply:** **相馬律**：不是靠印象定他，我得找那張把他放進後場的東西。 {#L075}

##### Line: 不能證明北見殺人 {#summary_cannot_prove_kitami}

**神谷澪**：拆掉三宅，不等於補上北見。 {#L076}

**神谷澪**：沒有人證、沒有兇手的時間，你憑什麼說是他？ {#L077}

**神谷澪**：你拆了摘要那條線，那一格現在是空的。空格不會自己填上北見的名字。 {#L078}

- **Contradiction:** evidence:kitami_external_access
- **Challenge:** **相馬律**：那一格能填。那晚誰能用那組外包憑證，查得出來。 {#L079}
- **On Correct:** **相馬律**：事件一八四二的外包憑證，那晚只有北見能用。增田二十二點五十備忘裡的 K，和第二杯咖啡的 K.，都是他；他也承認那個時間見過增田。 {#L080}
- **On Wrong Evidence:** **神谷澪**：這和工單、憑證、傘套都沾邊，但沒有把任何一個人放進那個空位。 {#L081}

### Question: 為何動手 {#q_p6}
- **Status:** locked
- **Unlock:** question:q_p5 answered
- **Required:** true

#### Testimony

- **On Loop:** **神谷澪**：動機這一格，你再指一次。 {#L093}
- **Loop Prompt:** **相馬律**：他為什麼要動手，我再想一次。 {#L094}
- **Default Challenge:** **相馬律**：這句，我再核對一下。 {#L095}
- **Default Wrong:** **神谷澪**：這說不出他為什麼要動手，換一個。 {#L096}
- **Wrong Reply:** **相馬律**：光有人在場不夠，我得找他非動手不可的理由。 {#L097}

##### Line: 在場不等於殺人 {#summary_presence_not_motive}

**神谷澪**：在場不等於動手。承包商沒有理由殺一個同事。 {#L098}

**神谷澪**：沒有動機，這條鏈還是斷的。 {#L099}

- **Contradiction:** evidence:kitami_data_theft_record
- **Challenge:** **相馬律**：他有理由。增田那時在查的，就是這件事。 {#L100}
- **On Correct:** **相馬律**：增田要檢舉北見盜賣 KAGAMI 試點資料。草稿已經備好，他的合約審查就在隔天。 {#L101}
- **On Wrong Evidence:** **神谷澪**：草稿本身沒離開過草稿匣。我要看的是增田到底要檢舉什麼。 {#L102}

## Evidence Manifest

### evidence:approved_clip {#approved_clip}
- **Name:** 核准片段（限定調出）
- **Description:** 審查會核准的後場門鎖限定調出片段，範圍嚴格框定在六個欄位。
- **Details:** 限定範圍為後場門鎖、二十二點五十到二十三點十、本機順序、憑證，及這一筆在摘要裡怎麼排、從哪裡來。它把摘要排出的時間和本機順序擺在一起，顯示二十三點零七分五十秒只是摘要排上的時間，不是某個人的事件時間。
- **Image Prompt:** Approved limited doorlock excerpt with two separated timeline columns and evidence-chain marker shapes, all rows unreadable, isolated evidence icon.

#### On Collect

**相馬律**：核准片段裡，本機順序和摘要擺在一起，前後卻對不上。 {#L082}

**相馬律**：二十三點零七分五十秒，是摘要排上的時間；不是三宅進門那一刻。 {#L083}

**早坂茜**：這段的來路對得上，可以拿上桌。 {#L084}

## Outro

[場景：KAGAMI 證據摘要審查會，白日；正式裁定後，長桌上的材料仍按證據鏈排列。]
- **Background Prompt:** Final review hearing table with work order, credential card, memo, draft, and umbrella-sleeve comparison arranged as an evidence chain, no readable text.
- **Background Asset ID:** background.chapter_1.interrogation_scene_10.p5
- **BGM:** bgm_review_board_victory
- **BGS:** bgs_review_board_room

[神谷澪把摘要報告闔上，在主嫌方向那一欄畫了一道撤回的記號。]

**神谷澪**[conceding]：……那晚只有北見能用那組憑證，增田要檢舉的，正是他。 {#L085}

**神谷澪**[conceding]：傘套排不出先後，只說明有人走過承包商的後巷動線，不是員工動線。 {#L086}

**神谷澪**[conceding]：北見修一，指認成立。三宅蒼太的主嫌方向，撤回。 {#L087}

**神谷澪**[conceding]：審查會保留這條鏈，轉入重新調查。原本那條主時間線，不再採用。 {#L088}

[旁聽席上，三宅母親把膝上那只飯糰袋輕輕抱緊了一下，沒有出聲。]

**早坂茜**：程序上，三宅這邊洗清了。重新調查的入口，我們守住了。 {#L089}

**相馬律**：三宅的母親，可以把那袋飯糰帶回家了。 {#L090}

[相馬律把那一整排材料一份份疊齊，望向窗外仍在落的雨。]

**相馬律**：剩下的，交給重新調查。 {#L091}

[早坂茜把疊齊的材料推過來。]

**早坂茜**：走。重新調查那邊，明天先遞狀。 {#L092}

[相馬律站起來，跟著早坂走向門口。]

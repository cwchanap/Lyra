# Scene 10: 最終審查會 — 門鎖沒說謊，是摘要讀錯了

## Intro

[場景：KAGAMI 證據摘要審查會，白日。長桌一側坐著相馬律與早坂茜，另一側是主理的神谷澪，黑瀨徹立在證物推車旁，旁聽席上坐著三宅母親，她膝上放著一只飯糰袋。]

[神谷澪把摘要報告攤在桌面正中，指尖壓在那行被標為主時間錨的紀錄上。]

**早坂茜**：辯方手上，有好幾條彼此獨立的矛盾。時間、動線、動機，都對不上摘要那條主時間線。

**神谷澪**：辯方準備好了，我這邊隨時可以開始。

**早坂茜**：不過我先講清楚程序。

**早坂茜**：那段後場門鎖的限定片段，現在還沒核准調出。

**神谷澪**：對。我不會因為你們說「有矛盾」就放行原始紀錄。

**神谷澪**：先用你們已經拿到的材料，把摘要那條時間線動搖了，我才會考慮開那扇門。

**相馬律**：可以。我們一條一條來。

## Phase: 三宅小謊不是殺人 {#p1}
- **Kind:** testimony
- **Required:** true
- **Status:** unlocked
- **Background Prompt:** KAGAMI evidence-summary review hearing room in daylight, long table with case-summary report and collected records, restrained legal tension, no readable text.

[場景：KAGAMI 證據摘要審查會，白日，長桌上攤著摘要報告與幾份從現場帶回的紀錄。]

[神谷澪翻到摘要裡關於三宅證詞的那一頁，語氣平穩。]

**神谷澪**：第一條，從證詞可信度開始。

### Subject: 神谷澪 {#kamiya}
- **Role:** KAGAMI 證據摘要審查會主理
- **Bio:** 主理審查會的把關者，理性而精確；她信任摘要，因為她比誰都清楚人的偏見有多危險。

### Testimony

#### Statement: 三宅說謊故摘要更可信 {#summary_miyake_most_credible}
- **Content:** 「三宅在問話裡說過謊。一個會說謊的人，跟一份系統摘要放在一起，摘要當然更可信。」
- **Contradiction:** evidence:closing_routine
- **On Correct:** r_p1

##### On Press

**神谷澪**：他記不清時間，他瞞下後場拿走的東西。這些都不是我編的。

**神谷澪**：會說謊的人，本來就該被多看兩眼。這不是偏見，是常識。

##### On Wrong Present

**相馬律**：他很孝順，他為了生病的母親才……

**神谷澪**：人格不是證據。

**神谷澪**：他孝不孝順，跟那一晚有沒有殺人，是兩回事。拿能對上那句謊話的東西來。

### Result: 小謊非殺人 {#r_p1}

**相馬律**：他瞞的，是那個準備丟掉的蛋糕盒。他想帶回去給母親，怕被當成偷竊。

**相馬律**：他記不清的那段時間，是躲在員工休息區偷打給母親。那通電話，落在閉店流程裡。

**相馬律**：兩件事都查清楚了。是小謊，不是殺人。

**神谷澪**：我接受。他確實說了謊，但這兩個謊都指向別的事。

**神谷澪**：他沒有完全乾淨。可一個小謊，撐不起一條殺人的指控。這一條，我讓。

## Phase: 死亡更早 {#p2}
- **Kind:** testimony
- **Required:** true
- **Status:** locked
- **Unlock:** phase:p1 completed
- **Background Prompt:** Review hearing table with time-related cafe evidence, forensic preliminary sheet and small record cards arranged under cold daylight, no readable document text.

[場景：KAGAMI 證據摘要審查會，白日，桌面換上現場帶回的時間相關紀錄與鑑識初判。]

[神谷澪把摘要裡那行死亡時間，往三宅進後場之後的位置一指。]

**神谷澪**：第二條，時間。

### Subject: 神谷澪 {#kamiya}
- **Role:** KAGAMI 證據摘要審查會主理
- **Bio:** 主理審查會的把關者，理性而精確；她信任摘要，因為她比誰都清楚人的偏見有多危險。

### Testimony

#### Statement: 死亡在三宅進後場後 {#summary_death_after_miyake}
- **Content:** 「按摘要排，死亡落在三宅進後場之後。時間順下來，他就在那扇門裡。」
- **Contradiction:** evidence:victim_phone_notification
- **On Correct:** r_p2

##### On Press

**神谷澪**：摘要把三宅那段動線當成主錨，死亡時間是順著它排的。

**神谷澪**：你要往前移那條死亡時間，得拿出比一杯咖啡更硬的東西。

##### On Wrong Present

**相馬律**：咖啡機最後一杯的紀錄，就能把死亡時間往前壓。

**神谷澪**：不行。

**神谷澪**：那杯咖啡只證明第二個人被等著、提早到了，證不到死亡的那一分鐘。別拿它當死亡時刻。

### Result: 衝突更早 {#r_p2}

**相馬律**：死者手機那則通知，停在二十二點五十八分前後。

**相馬律**：後場那座老掛鐘，停在二十二點五十九分。金屬豆罐上的擦抹痕，也對著同一段。

**相馬律**：鑑識初判的範圍，把死亡壓在這一段裡，比摘要寫的早。

**相馬律**：那杯咖啡是輔助——它只說明那場碰面提早了，不是死亡那一分鐘。

**神谷澪**：通知、掛鐘、擦痕、鑑識範圍，四樣彼此獨立，指向同一段更早的時間。

**神谷澪**：衝突確實更早。這一條，我也讓。

## Phase: 第三者更早進入 {#p3}
- **Kind:** testimony
- **Required:** true
- **Status:** locked
- **Unlock:** phase:p2 completed
- **Background Prompt:** Review hearing table covered with an L-shaped backroom floor plan and floor-drying record cards, officials across the table, quiet pressure, no readable labels.

[場景：KAGAMI 證據摘要審查會，白日，桌上鋪開後場 L 型平面圖與地面乾燥分布的紀錄。]

[神谷澪看著平面圖，手指沿著後場那條轉角線移動。]

**神谷澪**：第三條。就算更早，那也可能還是三宅。

### Subject: 神谷澪 {#kamiya}
- **Role:** KAGAMI 證據摘要審查會主理
- **Bio:** 主理審查會的把關者，理性而精確；她信任摘要，因為她比誰都清楚人的偏見有多危險。

### Testimony

#### Statement: 更早也可能是三宅 {#summary_could_still_be_miyake}
- **Content:** 「時間往前移，不代表換了人。更早那一刻，站在後場的也可能就是三宅。」
- **Contradiction:** evidence:miyake_pov_replay
- **On Correct:** r_p3

##### On Press

**神谷澪**：他那段時間本來就在店裡，動線貼著後場。把時間往前挪，他還是嫌疑最大的那一個。

**神谷澪**：你要把他從那個位置拉開，得證明他根本看不到、也走不到。

##### On Wrong Present

**相馬律**：後場那只濕傘套，就能定北見的罪。

**神谷澪**：不行。

**神谷澪**：傘套只證明先進來的那個人走的是承包商動線，證不到是哪一個人。要對到人，得靠工單和憑證。

### Result: 第三者承包商動線 {#r_p3}

**相馬律**：三宅當時的視線回放，被那道 L 型轉角擋住，根本看不到內側倉庫裡的屍體。

**相馬律**：地面乾燥分布顯示，有一條更早被踩濕、再陰乾的水跡，從承包商那道側門進來。

**相馬律**：那只濕傘套就掛在那條動線的牆角。配上後場 L 型平面圖，三宅的位置對不上。

**神谷澪**：視線、水跡、傘套、平面圖——是有第三個人，從承包商那條路更早進來。

**神谷澪**：三宅站的地方，看不到那具屍體。這一條，我讓。

## Phase: 申請限定調出 {#gate}
- **Kind:** inquiry
- **Required:** true
- **Status:** locked
- **Unlock:** phase:p3 completed
- **Background Prompt:** KAGAMI review hearing room with a limited-record authorization form centered before the presiding official, formal stamp pad, no readable text.

[場景：KAGAMI 證據摘要審查會，白日，神谷澪面前擺著原始門鎖紀錄的調閱授權單。]

[相馬律與早坂茜並肩站起，把三條已成立的矛盾，疊在神谷面前。]

**早坂茜**：三條矛盾都成立了。小謊不是殺人、死亡更早、第三個人更早進來。

### Subject: 神谷澪 {#kamiya}
- **Role:** KAGAMI 證據摘要審查會主理
- **Bio:** 主理審查會的把關者，理性而精確；她信任摘要，因為她比誰都清楚人的偏見有多危險。

### Question: 請求核准片段 {#q_request_clip}
- **Status:** unlocked
- **Reveals:** [evidence:approved_clip]

**相馬律**：現在，我們正式請求核准那段後場門鎖的限定調出。

**早坂茜**：範圍限定：後場門鎖、二十二點五十到二十三點十、事件序號、憑證類型、同步時間、保全鏈標記。

**早坂茜**：只調這幾欄，不碰範圍外的任何資料。

[神谷澪沉默了幾秒，把授權單翻到簽核欄。]

**神谷澪**：剛才那三條矛盾，已經夠我懷疑摘要那行主時間錨了。

**神谷澪**：先說清楚，這之前我只給你們基本的裝置和資料說明，原始順序一律壓著。

**神谷澪**：現在，我核准這段限定調出。就這六欄，超出範圍的不給。

[神谷在簽核欄落下印記，黑瀨徹把調出的片段推到桌面中央。]

**黑瀨徹**：限定片段到手。證物鏈標記我已經固定過，沒有斷點。

## Phase: 門鎖時間不是事件時間 {#p4}
- **Kind:** testimony
- **Required:** true
- **Status:** locked
- **Unlock:** phase:gate completed
- **Background Prompt:** Hearing table with approved doorlock excerpt beside a printed summary timetable, two parallel record stacks, precise procedural mood, no readable rows.

[場景：KAGAMI 證據摘要審查會，白日，桌面中央攤著剛核准的限定片段與門鎖摘要時刻表。]

[神谷澪把限定片段與摘要時刻表並排，指著摘要上那行二十三點零七分五十秒。]

**神谷澪**：第四條。門鎖紀錄沒被偽造，所以三宅那個時間是可信的。

### Subject: 神谷澪 {#kamiya}
- **Role:** KAGAMI 證據摘要審查會主理
- **Bio:** 主理審查會的把關者，理性而精確；她信任摘要，因為她比誰都清楚人的偏見有多危險。

### Testimony

#### Statement: 門鎖未偽造故三宅時間可信 {#summary_doorlock_authentic}
- **Content:** 「門鎖紀錄沒被改過。沒被改過的時間，就該照著信。二十三點零七分五十秒，寫得清清楚楚。」
- **Contradiction:** evidence:local_sequence_record
- **On Correct:** r_p4

##### On Press

**神谷澪**：摘要抓到的，不一定是第一個人。

**相馬律**：它抓的是最好對得上的那個。

**神谷澪**：門、鏡頭、員工憑證，全都對得上三宅。

**相馬律**：所以它把那一筆寫得最像真相。

##### On Wrong Present

**相馬律**：是 KAGAMI 把門鎖紀錄造假了。

**神谷澪**：不對。

**神谷澪**：原始紀錄、本機順序，都沒被動過手腳。錯的不是紀錄，是摘要對它的讀法。別把這頂帽子扣到造假上。

### Result: 合併時間非事件時間 {#r_p4}

**相馬律**：本機順序紀錄裡，事件序號的先後，跟摘要那行時間對不上。

**相馬律**：對著核准的限定片段，再比門鎖摘要時刻表——二十三點零七分五十秒，是同步合併那一刻。

**相馬律**：那是各路紀錄校時、合流的時間，不是三宅真正的事件時間。

**神谷澪**：所以摘要把合併時間，當成了事件時間。

**神谷澪**：是摘要挑了最好對得上的那一筆，把它寫成了真相。這一條，我讓。

## Phase: 北見是真兇 {#p5}
- **Kind:** testimony
- **Required:** true
- **Status:** locked
- **Unlock:** phase:p4 completed
- **Background Prompt:** Final review hearing table with work order, credential card, memo, draft, and umbrella-sleeve comparison arranged as an evidence chain, no readable text.

[場景：KAGAMI 證據摘要審查會，白日，桌面攤開工單、憑證、備忘、草稿與傘套比對，匯成一條完整的鏈。]

[神谷澪看著那一整排材料，仍然沒有鬆口。]

**神谷澪**：最後一條。就算三宅的嫌疑降下來了，你也證不了是北見殺的人。

### Subject: 神谷澪 {#kamiya}
- **Role:** KAGAMI 證據摘要審查會主理
- **Bio:** 主理審查會的把關者，理性而精確；她信任摘要，因為她比誰都清楚人的偏見有多危險。

### Testimony

#### Statement: 不能證明北見殺人 {#summary_cannot_prove_kitami}
- **Content:** 「拆掉三宅，不等於補上北見。沒有人證、沒有兇手的時間，你憑什麼說是他？」
- **Contradiction:** evidence:temp_maintenance_workorder
- **On Correct:** r_p5

##### On Press

**神谷澪**：你拆了摘要那條線，那一格現在是空的。

**神谷澪**：空格不會自己填上北見的名字。拿能把他放進那一刻的東西來。

##### On Wrong Present

**相馬律**：他人品有問題，當然是他。

**神谷澪**：人格不是不在場證明，反過來也一樣。

**神谷澪**：你不能因為他像壞人就定他。拿那晚把他放進後場的那張東西來。

### Result: 北見收束 {#r_p5}

**相馬律**：那晚臨時排了一張後場門鎖的維護工單。配上外包維護憑證、北見的外包權限，全落在他一個人身上。

**相馬律**：增田的檢舉草稿、那張異常存取整理表，記著北見排程外接觸試點資料、外流到載體。隔天就是合約審查，這是他的壓力。

**相馬律**：增田那則沒送出的備忘、那杯多點的咖啡，都標著一個 K。後場那只濕傘套，又對上承包商資材包。

**相馬律**：他有權限、有動機、有壓力，有一條更早進場的痕跡。然後，他借了摘要的偏好，把三宅塞進了那個殺人的時刻。

**神谷澪**：那錯的是什麼？

**相馬律**：我們太快替它補上了意思。

**神谷澪**：……是北見修一。這一格，填回了正確的名字。

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

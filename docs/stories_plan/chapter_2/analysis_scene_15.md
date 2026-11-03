# Scene 15: 走過的路

- **Summary:** 案發第四日午後，相馬與早坂把上午在後場、通道和大樓裡看到的紀錄攤開，先照先後把她走過的路排成一條線，再分清通行碼到期以後，哪些路關上了、哪一條還走得出去。

## Intro

[場景：相馬律的偵探事務所，案發第四日下午一點半左右。細雨從早上一直沒停，窗玻璃上全是水痕，對面大樓只剩一片模糊的灰影。辦公桌上空著一大片，門邊衣架上掛著兩把還在滴水的傘，角落那台老咖啡機仍舊停擺。]
- **Background Prompt:** Eye-level medium-wide view of the same small cluttered Tokyo private detective office seen in the earlier night analysis scene, now at about half past one on a gray rainy afternoon, used as the quiet working backdrop for the case's route-and-return analysis; a large window on the left with half-open blinds and cool flat daylight, its glass beaded and streaked with rain, the mid-rise buildings opposite dim and blurred behind a steady drizzle; focal area on the worn dark desk in the centre under a warm articulated desk lamp pool, nearly bare with an open laptop at one side and a large empty surface left clear across the rest of the desktop, a potted plant in the far left corner and two cardboard archive boxes on the floor under the window; on the right a coat rack beside a door with a frosted glass panel, two dark charcoal folded umbrellas hanging from it and dripping into a small plastic drip tray, a few dark water drops on the floor beneath; a side cabinet on the far right holding the old drip coffee machine with its carafe empty and dry beside a small electric kettle; a tall bookshelf of binders behind the desk, a whiteboard leaning on the cabinet, polished dark floor; cool gray window light against a warm desk lamp pool, damp tired working mood, no people, no blue umbrellas, lower third kept as plain desk edge and floor for dialogue UI, no readable text, no UI overlay, neo-noir visual novel background.
- **BGM:** bgm_city_summary_motif
- **BGS:** bgs_detective_office_rain

**旁白**：案發第四日，下午一點半。

[兩人前後腳進門。早坂把兩把收起的傘掛上衣架。]

**早坂茜**：褲腳全濕了。

**相馬律**：雨是斜著下的。傘撐了跟沒撐一樣。

[早坂把蕎麥麵店的收據對折，夾進卷宗後面的口袋。]

**相馬律**：坐著吃蕎麥麵，我的腳要謝謝妳。

**早坂茜**：十分鐘，一碗三百八十圓，還有座位。挑得不錯吧。

**相馬律**：那碗蕎麥麵，連湯底都沒剩。我當它是稱讚。

**早坂茜**：……稱讚，我先留著。

[相馬在椅子上坐下，彎腰揉了揉小腿。]

[他把口袋裡那罐放涼的黑咖啡擱到桌角，打算排的時候再開。]

**相馬律**：我的腳，今天又不是我的了。

**早坂茜**：從後場走進大樓，上七樓，再走回來。你昨天站的是平地。

**相馬律**：清潔員一路都在說同一句。要是她那時推開了那扇門。

**早坂茜**：她照防災中心說的做了。

**相馬律**：我知道。

**早坂茜**：一點半。明天上午十一點截止，還剩二十一個半小時。

**相馬律**：昨晚九點，是三十八個小時。

**早坂茜**：過了十六個半小時。我數過。

[相馬的視線飄向角落的咖啡機，又收回來。]

**相馬律**：要是它——

**早坂茜**：不能用。

**相馬律**：我還沒說完。

**早坂茜**：你每次都是這個開頭。

[相馬打開卷宗夾，把上午拍下來的照片、黑瀨給的副本，一張一張攤到桌上。早坂撕下一段長長的紙膠帶，貼在桌面正中央，從這一頭拉到那一頭。]

**相馬律**：上午我們走的是一條路。可是紀錄，是一份一份來的。

**早坂茜**：後場的隔板，防災中心，黑瀨給的副本。

**相馬律**：先排先後。起點不用排：說明會上寫明了，靜默挑戰中出安全異常，主播走背面安全位。

**早坂茜**：好。從那裡開始，往下排。

[她在紙膠帶最左端，貼上第一張卡。]

## Board: 路線板 {#route_board}

- **Kind:** order
- **Prompt:** 她從背面安全位，一路走到七樓的空置樓層。照她走過的先後，把這六張卡排成一條路；起點已經固定。
- **Hint:** 從箱子背面出發，往大樓裡走。有時間的卡看時間；沒有時間的，想想它夾在哪兩張之間。
- **Accepted Order:** [safety_spot, logistics_board, m03_door, watch_ping, elevator_b, floor_traces]
- **Fixed Anchors:** [safety_spot@1]
- **Reveals:** [assert_fact:mashiro_took_the_maintenance_route]
- **Incomplete Feedback:** 六張卡都要排進這條路裡。
- **Incorrect Feedback:** 順序還有錯。有時間的卡，先照時間排；沒有時間的，看它在這條路上的位置。

### Card: 背面安全位 {#safety_spot}

- **Source:** evidence:safety_briefing_record
- **Summary:** 玻璃箱背面角落、服務艙口旁，用黃色膠帶貼出的方框。開播前的說明會寫明：靜默挑戰中出現安全異常，主播不在直播裡說明，改走到這裡，由導播或前場的人補場。

### Card: 後場通道 {#logistics_board}

- **Source:** evidence:venue_logistics_board
- **Summary:** 後場隔板上的後勤配置圖：安全位旁的後場通道，一路接到標著「M-03」的門；門後寫著「大樓服務核心（服務梯 B）」。避難動線另畫在圖角。

### Card: M-03 門磁 {#m03_door}

- **Source:** evidence:m03_door_log
- **Summary:** 後場通道通往大樓服務核心的門。00:07:18 以 SR-2307 的通行碼開啟，00:07:36 關上。

### Card: 手錶的最後定位 {#watch_ping}

- **Source:** evidence:mashiro_watch_ping
- **Summary:** 真白手錶最後一筆定位：00:07:46，商業大樓服務核心一帶，誤差約四十公尺，看不出在哪一層。之後再沒有任何訊號。

### Card: 服務梯 B {#elevator_b}

- **Source:** evidence:service_elevator_b_log
- **Summary:** 00:07:52，以 SR-2307 進入維修運轉，從一樓服務核心叫梯；00:08:21 停在七樓，開門保持。

### Card: 七樓的鞋印 {#floor_traces}

- **Source:** evidence:vacant_floor_traces
- **Summary:** 警方拍下的七樓空置樓層：水泥地上積著細灰，一串平底鞋印從消防門一路走到靠窗的角落，步幅平均，沒有拖行。警方比對過，是真白的鞋。

### Result Dialogue

[紙膠帶上，六張卡從左到右排成一排。早坂用筆尾，一張一張點過去。]

**早坂茜**：每一份紀錄，是不同的地方、不同的人留下的。能把它們接起來的，只有時間，和同一個編號。

**相馬律**：M-03 開，手錶最後一筆，梯子被叫來。一個接一個，沒有空檔。然後是七樓的鞋印。

[早坂把 M-03 和服務梯 B 兩張卡，並排往桌邊拉出來一點。]

**早坂茜**：這兩張，寫的是同一個編號，SR-2307。

**相馬律**：同一張申請，先打開 M-03，再叫來服務梯 B。

**早坂茜**：路排出來了。可是通行碼，只到 00:15。

**相馬律**：到期以後，從七樓出去，還剩哪裡走得通。

[早坂把桌邊另外幾份紀錄，推到紙膠帶下面。]

## Board: 回程板 {#return_board}

- **Kind:** classify
- **Prompt:** 通行碼只到 00:15。到期以後，這幾份紀錄各自說明：這條路關上了，還是還走得出去？把每張卡放進對的那一欄。
- **Unlock:** analysis_board:chapter_2@analysis_scene_15@route_board completed
- **Reveals:** [assert_fact:exit_after_expiry_was_the_evacuation_stairs]
- **Incomplete Feedback:** 五張卡都要放進其中一欄。
- **Incorrect Feedback:** 至少有一張放錯了。再看一次每份紀錄的時間：它說的是 00:15 以前，還是以後？不靠通行碼的，又是哪幾處？
- **Hint:** 看時間：是 00:15 以前，還是以後？

### Card: 十五分鐘通行碼 {#passcode_window}

- **Source:** evidence:sponsor_maintenance_passcode
- **Summary:** SR-2307 生成的通行碼，有效時段只有 00:00～00:15，範圍是服務艙口、後場通道、M-03 與服務梯 B。過了 00:15，這四處不能再用它開。

### Card: M-03 之後 {#m03_after}

- **Source:** evidence:m03_door_log
- **Summary:** M-03 在 00:07 開過一次。00:15 以後整晚沒有再開，也沒有被拒絕的刷碼；直到凌晨三點過後，警方從大樓那一側開門。

### Card: 服務梯 B 之後 {#elevator_after}

- **Source:** evidence:service_elevator_b_log
- **Summary:** 00:15 通行碼到期，服務梯 B 的維修運轉沒有被解除。梯廂從 00:08 起一直停在七樓；00:20 起，面板記為「超時停靠」。

### Card: 七樓消防門 {#fire_door}

- **Source:** evidence:fire_door_alarm_log
- **Summary:** 00:08 開過一次，照常回彈關上。00:23:46 再次被打開，之後沒有回彈，00:24:46 起面板亮著「未回彈」。這扇門不用通行碼，面板只記開關，不記是誰。

### Card: 一樓後勤出口 {#logistics_exit}

- **Source:** evidence:building_night_access_log
- **Summary:** 23:00 以後，大樓正門沒有從外面刷卡進來的紀錄。00:26:11，一樓後勤出口從內側被推開（出門不用卡，只記開門）；門口監視器每秒一格，鏡頭沾滿雨水，只拍到一個人影的肩膀出了畫面，看不出身高、衣著或臉。

### Group: 到期以後，這條路關上了 {#closed_after_expiry}

- **Description:** 通行碼還管得到的那一段。
- **Accepted Cards:** [passcode_window, m03_after, elevator_after]

### Group: 到期以後，還走得出去 {#still_open}

- **Description:** 通行碼管不到的地方。
- **Accepted Cards:** [fire_door, logistics_exit]

### Result Dialogue

[桌上的卡片分成兩邊。左邊三張，過了 00:15 就沒有再動；右邊兩張，是 00:15 以後才有的動靜。]

**早坂茜**：通行碼管得到的三處，過了 00:15，都沒有再動。連被拒絕的刷碼，也沒有。

**相馬律**：消防門 00:23:46 又被打開，兩分多鐘以後，一樓後勤出口從內側被推開。順序是這樣。

**早坂茜**[stern]：門口只拍到一個肩膀。看不出那個人是從哪一層下來的。

**相馬律**：那紀錄能說什麼？

**早坂茜**：路。過了 00:15，要離開七樓只剩避難梯，往下只通後勤出口。

**早坂茜**：兩分多鐘，從七樓走下來剛好。可是對得上，不等於看見。那個人是誰，紀錄也不寫。

**相馬律**：對。紀錄只寫路。

**相馬律**[determined]：真白不是從直播裡消失。

**相馬律**：她被一條看似合法的維修路線帶走。

[早坂沒有立刻接話，把兩邊的卡片各用夾子夾好。]

## Outro

[相馬把夾好的卡片疊齊。]

**早坂茜**：路排完了。可是摘要上，還是只有一個名字。

**相馬律**：這條路，沒有放進誰，也沒有拿掉誰。

**早坂茜**：那就剩兩個問題。

**相馬律**：第一個。SR-2307，是誰能從贊助商的系統送出去的。

**早坂茜**：設備商說，公司沒有申請。大樓這一側，只看得到申請進來，看不到是哪個帳號送的。

**相馬律**：第二個。她為什麼會跟著走進那條路。

**早坂茜**：紀錄回答不了這個。

**相馬律**：能回答的，也許是她自己留下的東西。她的工作室，我們還沒去過。

[早坂走到衣架旁，捏了捏傘面。]

**早坂茜**：傘還沒乾。

**相馬律**：出門又會濕。

**早坂茜**：那就讓它多滴一會兒。

[她轉身去拿電熱水壺，沖了兩杯熱茶，把其中一杯推到相馬手邊。]

**相馬律**：妳這是在照顧我？

**早坂茜**[softened]：這次不是。我自己想喝熱的。

**相馬律**[relieved]：……那我順便收下。

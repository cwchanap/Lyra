# Scene 1: 第一次現場調查 — 雨鐘咖啡館

## Intro

[相馬律與早坂茜跨過黃色封鎖線，推開咖啡館正門。]

[旁白：深夜的雨鐘咖啡館，燈還亮著。]

[旁白：但空氣裡的咖啡香已經涼了。]

[早坂茜在門口掃視了一圈。]

**早坂茜**：黑瀨刑警說可以自由查看。別亂動證物。

**相馬律**：我知道。

[相馬律看著空蕩蕩的客席，輕聲說。]

**相馬律**：從正門開始。

## Sub-location: 正門與傘架 {#entrance}
- **Status:** unlocked
- **Background Prompt:** Interior entrance of Rain Bell Cafe at midnight, umbrella stand, wet footprints, security camera red light, rainy glass door.
- **BGM:** rain_mystery_low
- **BGS:** indoor_rain_window

[場景：雨鐘咖啡館正門內側，深夜，雨夜。入口傘架沿牆排列，大多空著。地板有濕漉漉的雨水足跡，未完全乾燥。右上角有一台入口監視器，紅燈閃爍。金屬傘架最內側有一把藍色傘柄的透明雨傘，孤立地放著。]

[推開門的瞬間，雨聲從外面灌進來，然後門閉上，恢復安靜。]

### Hotspot: 傘架 — 藍色透明傘 {#blue_umbrella_stand}
- **Description:** 傘架最內側有一把透明傘，藍色傘柄，其他傘架都空著。
- **Reveals:** [evidence:blue_umbrella]
- **Evidence Source:** visible

[相馬律抽出那把傘，翻過來看傘柄底部。]

**相馬律**：傘柄內側有刮痕。像是有什麼東西被撕掉了。

[他把傘放回原位。]

**早坂茜**：姓名貼紙？

**相馬律**：說不準。痕跡太淺。

**早坂茜**：沒有人認領過，店長說。

### Hotspot: 破損傘套 {#torn_sleeve_spot}
- **Description:** 傘架旁地上有一個撕破的透明傘套，邊緣帶泥。
- **Reveals:** [evidence:torn_umbrella_sleeve]
- **Evidence Source:** visible

[相馬律蹲下，用手背輕觸傘套邊緣。]

**相馬律**：這不是店裡的。

**早坂茜**：怎麼說？

**相馬律**：店裡的傘套是壓紋的。這個是素面的。

[他站起來，目光轉向監視器。]

### Hotspot: 入口監視器 {#entrance_monitor}
- **Description:** 右上角的監視器，視角覆蓋正門入口到傘架區域。
- **Reveals:** [evidence:entrance_cctv]
- **Evidence Source:** implied
- **Scene Source Prompt:** Entrance security camera and small monitor source, visible but not showing a readable CCTV still.

[相馬律仰頭看監視器，確認視角範圍。]

**相馬律**：這台記錄到什麼範圍？

**早坂茜**：正門進出都有。片桐悠真，21:07 從正門出去。

**相馬律**：只有出去，沒有再進來？

**早坂茜**：監視器顯示沒有。

## Sub-location: 主廳客席區 {#main_floor}
- **Status:** unlocked
- **Background Prompt:** Empty wood-toned cafe main hall after closing, flipped chairs, old wall clock, bar counter standby lights, rainy windows.
- **BGM:** rain_mystery_low
- **BGS:** indoor_rain_window

[場景：雨鐘咖啡館主廳，深夜，雨夜。木質桌椅靠著窗邊排列，椅子都翻上去了。左牆掛著一個老式圓形掛鐘，指著 23:42。吧台後面透出咖啡機的橘色待機燈。金木犀拿鐵的季節宣傳牌立在吧台一側。黑瀨刑警站在桌旁，外套拉得嚴。早坂茜在靠牆位置整理文件。]

[相馬律走進主廳，視線在宣傳牌上停了一下。]

### Hotspot: 金木犀拿鐵宣傳牌 {#osmanthus_sign}
- **Description:** 吧台旁立著一個宣傳牌：「本季限定 金木犀拿鐵」，附一張照片。

[相馬律把目光移開，輕輕按了一下太陽穴。]

**早坂茜**[concerned]：你不舒服？

**相馬律**：沒有。只是不喜歡這種味道。

[他繼續向前走。]

### Hotspot: 靠窗座位 {#window_seat}
- **Description:** 靠窗的位子，可以看到正門方向，吧台後方完全被遮住。
- **Reveals:** [statement:cant_see_storeroom]

[相馬律站在窗邊，往外看了一眼，又往吧台方向看。]

**相馬律**：從這裡，看不到倉庫。

**相馬律**：案發當時有客人嗎？

**早坂茜**：21:10 前最後一桌結帳了。之後沒有新客人進來。

### Character: 黑瀨徹 {#kuruse}
- **Role:** 警視廳刑警
- **Bio:** 負責現場的刑警。他讓相馬律進來，因為他也覺得這案子的時間線太完整了。

#### Topic: 官方時間線 {#case_timeline}
- **Status:** unlocked
- **Reveals:** [evidence:kagami_official_timeline, statement:kuruse_timeline]

**黑瀨徹**：KAGAMI 整理的時間線很清楚。

**黑瀨徹**：21:13:21，若槻蓮用員工卡進倉庫。

**黑瀨徹**：21:14:18，增田圭心跳停止。

**黑瀨徹**：21:14:52，若槻蓮離開倉庫。

[黑瀨看著手上的文件。]

**黑瀨徹**：三個時間點，連在一起，沒有跳格。

**相馬律**：那你為什麼覺得太乾淨了？

[黑瀨看了他一眼。]

**黑瀨徹**：因為太乾淨的東西，通常是被人整理過的。

#### Topic: 嫌疑人若槻蓮 {#suspect_info}
- **Status:** unlocked
- **Reveals:** [statement:kuruse_suspect]

**黑瀨徹**：若槻蓮，20 歲，兼職店員。跟死者有過衝突。

**黑瀨徹**：他承認進過倉庫，但說他離開時，人還活著。

**相馬律**：他的說詞有沒有其他問題？

**黑瀨徹**：說得含糊。像是在隱瞞什麼，但不像是在撒大謊。

[黑瀨停頓了一下。]

**黑瀨徹**：他的小秘密讓他說不清楚大問題。

#### Topic: KAGAMI 系統 {#kagami_system}
- **Status:** locked
- **Unlock:** evidence:kagami_door_log collected

**相馬律**：門鎖紀錄有沒有可能被動過？

[黑瀨搖搖頭。]

**黑瀨徹**：KAGAMI 的門鎖紀錄是唯讀的。理論上沒辦法事後修改。

**相馬律**：理論上。

**黑瀨徹**：你有什麼具體根據？

**相馬律**：還沒有。

#### Topic: 死者身份 {#victim_background}
- **Status:** locked
- **Unlock:** evidence:victim_phone collected

**相馬律**：增田圭的工作，你知道多少？

**黑瀨徹**：KAGAMI 的資料審查員。來這裡是例行安全檢查。

**相馬律**：他查出過什麼嗎？

[黑瀨停頓了一下。]

**黑瀨徹**：手機裡有一些他還沒提交的筆記，內容我還不清楚。

**黑瀨徹**：但他最近一直盯著某件事。

### Character: 早坂茜 {#hayasaka}
- **Role:** 律師，委託方代理人
- **Bio:** 相馬律的合作搭檔，比相馬更重視人的證詞，也更了解若槻家屬的狀況。

#### Topic: 案件概況 {#case_overview}
- **Status:** unlocked
- **Reveals:** [statement:hayasaka_overview]

**早坂茜**：若槻葵說，她弟弟昨天回家後一直在發抖。

**早坂茜**：他說的時間和警察的說法不一樣，但他解釋不清楚為什麼。

**相馬律**：他有沒有說什麼時間進的倉庫？

**早坂茜**：說大約 21:12，但記不準。KAGAMI 說 21:13:21。差了一分多鐘。

#### Topic: 若槻蓮的小秘密 {#renjis_secret}
- **Status:** unlocked
- **Reveals:** [statement:hayasaka_victim_info]

**早坂茜**：他隱瞞的，是一件小事。

**早坂茜**：他拿過店裡即將報廢的咖啡豆，私下賣掉。家裡欠著債。

**相馬律**：這件事被增田知道了？

**早坂茜**：不確定。增田懷疑店裡有人在賣顧客資料，一直盯著若槻。

[早坂茜輕聲說。]

**早坂茜**：賣咖啡豆和賣資料，是完全不同的事。

**早坂茜**：但警察只看到他在隱瞞，就讓他的其他說法都說不清楚。

#### Topic: KAGAMI 門鎖紀錄 {#kagami_record}
- **Status:** locked
- **Unlock:** evidence:kagami_door_log collected
- **Reveals:** [statement:hayasaka_kagami_note]

**早坂茜**：你覺得門鎖紀錄有問題？

**相馬律**：紀錄本身可能沒有問題。

**相馬律**：問題是我們是否理解它的意思。

[早坂茜停頓了一下。]

**早坂茜**：「紀錄不說謊，但人會解讀錯紀錄。」

**相馬律**：你自己說的。

**早坂茜**：嗯。我記得。

## Sub-location: 吧台區 {#bar_area}
- **Status:** unlocked
- **Background Prompt:** Cafe bar counter at night, espresso machine standby glow, milk pitcher residue, time card machine, half-finished latte cup.
- **BGM:** rain_mystery_low
- **BGS:** indoor_rain_window

[場景：雨鐘咖啡館吧台區，深夜，雨夜。吧台木質檯面整潔，義式咖啡機旁的奶泡壺沾著白色殘跡。右側牆上有員工打卡機。吧台角落放著一個半杯的金木犀拿鐵紙杯，奶泡已經完全攤平。]

[相馬律走過吧台，手背貼了一下咖啡機側面。]

### Hotspot: 咖啡機 {#coffee_machine}
- **Description:** 義式咖啡機，機身側面仍微溫。操作介面上有自動清潔啟動紀錄。
- **Reveals:** [evidence:coffee_machine_log]
- **Evidence Source:** implied
- **Scene Source Prompt:** Espresso machine interface/log source, visible but not showing the collected cleaning log image.

[相馬律按了幾下介面，找到紀錄畫面。]

**相馬律**：自動清潔模式，啟動時間 21:13:29。

**早坂茜**：若槻說他出倉庫後立刻按了清潔鍵。

[相馬律看著畫面上的時間，不說話。]

**早坂茜**：但 KAGAMI 說他 21:14:52 才離開倉庫。

**相馬律**：21:13:29 啟動清潔，21:14:52 才離開倉庫。

[他把介面關掉。]

**相馬律**：兩份紀錄裡，至少有一份的時間線是錯的。

### Hotspot: 奶泡壺 {#milk_frother}
- **Description:** 吧台旁的奶泡壺，壺身還有餘溫，壺口有乾燥中的奶泡殘跡。
- **Reveals:** [evidence:frother_warmth]
- **Evidence Source:** visible

[相馬律把手放在壺身外側。]

**相馬律**：還是溫的。比咖啡機稍涼一點。

**早坂茜**：最後一杯拿鐵是什麼時候做的？

**相馬律**：等一下去倉庫就知道了。

### Hotspot: 員工打卡機 {#time_card_machine}
- **Description:** 壁掛式員工打卡機，今日打卡紀錄列印在旁。
- **Reveals:** [evidence:timecard_record]
- **Evidence Source:** visible

[相馬律看著打卡紙。]

**相馬律**：若槻蓮。打卡進班：18:00。沒有打下班卡。

**早坂茜**：他被警察帶走前就沒有打了。

**相馬律**：這台打卡機有沒有接 KAGAMI？

**早坂茜**：沒有。這是舊型的，獨立系統。

## Sub-location: 員工走廊 {#staff_corridor}
- **Status:** unlocked
- **Background Prompt:** Narrow cafe staff corridor under cold fluorescent light, office door, smart lock panel, KAGAMI service label, damp shoe marks.
- **BGM:** rain_mystery_low
- **BGS:** indoor_rain_window

[場景：雨鐘咖啡館員工走廊，深夜，狹窄。一盞冷白燈管。左側是店長辦公室的緊閉木門。正前方是倉庫入口，智慧門鎖面板嵌在牆上。牆上貼著一個 KAGAMI 白色服務標籤，印著帳號和維護日期。走廊地板有輕微的鞋底水痕。]

[相馬律走進走廊，視線落在倉庫門口的門鎖設備上。]

### Hotspot: 倉庫智慧門鎖 {#smart_lock}
- **Description:** 倉庫入口的 KAGAMI 智慧門鎖，深灰色面板，顯示最近進出紀錄。
- **Reveals:** [evidence:kagami_door_log, sublocation:storeroom]
- **Evidence Source:** implied
- **Scene Source Prompt:** Smart lock panel/log source on the storeroom door, visible but not showing the collected door log image.

[相馬律靠近門鎖，用手指滑過操作面板。]

**相馬律**：最近一筆。21:13:21，員工卡 RJ-007，進入。21:14:52，RJ-007，離開。

**早坂茜**：RJ-007 是若槻蓮的卡。

**相馬律**：再前一筆。21:07:08，維護帳號 KTR-042，進入。21:07:33，KTR-042，離開。

[相馬律抬頭。]

**早坂茜**：KTR-042 是片桐悠真。他說他 21:07 就從正門走了。

**相馬律**：倉庫門鎖也顯示他進來又出去。待了不到半分鐘。

[相馬律推開倉庫門。]

### Hotspot: KAGAMI 服務標籤 {#kagami_label}
- **Description:** 牆上的白色標籤，印著「KAGAMI 智慧服務契約」，維護帳號 KTR-042，最後維護日期：今天。

[相馬律看了一眼。]

**相馬律**：今天的例行維護，片桐做的。

**早坂茜**：他說是例行檢查。

**相馬律**：例行檢查，在倉庫門鎖前停了 26 秒。

[早坂茜沒有說話。]

## Sub-location: 倉庫 {#storeroom}
- **Status:** locked
- **Reveals:** [evidence:wet_floor_marks]
- **Background Prompt:** Cold cafe storeroom crime scene at night, yellowed light, shelves of coffee beans, covered body, old back door, half-dry water marks.
- **BGM:** rain_mystery_low
- **BGS:** indoor_rain_window

[場景：雨鐘咖啡館倉庫，深夜。空間比走廊更冷，燈光昏黃。地板左前方有一灘半乾的不規則水痕。右側是咖啡豆貨架與紙箱。左側一座滾輪貨架，半遮著一扇舊式木門。倉庫深處，增田圭的身體覆蓋在白色帆布下。右側貨架角落，一個紙杯，裝著喝了一半的咖啡。]

[相馬律走進倉庫，腳步停了一下。]

[旁白：比走廊更冷。]

[旁白：空氣裡有咖啡渣的味道，還有一絲甜膩的氣息。]

[相馬律抬手按了一下太陽穴，沒有說話，繼續往裡走。]

### Hotspot: 半杯金木犀拿鐵 {#half_latte_storeroom}
- **Description:** 右側貨架角落的紙杯，裡面剩一半的咖啡，奶泡已完全攤平。
- **Reveals:** [evidence:half_latte]
- **Evidence Source:** visible

[相馬律彎腰看了看紙杯，沒有碰它。]

**相馬律**：金木犀拿鐵。奶泡攤平了，放了有一段時間了。

**早坂茜**：死者自己帶進來的？

**相馬律**：或者是店裡的人幫他拿的。問一下店長。

[他站起來，迅速走開了一步。]

### Hotspot: 增田圭遺體位置 {#victim_position}
- **Description:** 倉庫深處，帆布覆蓋的位置，後腦朝上，倒在地面。
- **Reveals:** [evidence:victim_smartwatch, statement:death_scene]
- **Evidence Source:** visible

[相馬律蹲下，在帆布邊緣確認屍體的倒下方向。]

**相馬律**：後腦受擊。倒下的方向是往前的。

**相馬律**：意味著他站著時被打，不是掙扎後倒下。

[他看見死者手腕上的智慧手錶。]

**早坂茜**：黑瀨說，心跳停止時間是 21:14:18。

**相馬律**：這個時間是手錶本地記的，還是上傳雲端的？

[早坂茜翻文件。]

**早坂茜**：……手錶的本地紀錄。

[相馬律站起來。]

**相馬律**：先記著。

### Hotspot: 黃銅桌鈴 {#brass_bell}
- **Description:** 遺體旁邊地上，一個黃銅製老式桌鈴，底座沾有暗色污跡。
- **Reveals:** [evidence:brass_bell]
- **Evidence Source:** visible

[相馬律蹲在桌鈴旁邊，仔細看，沒有碰。]

**相馬律**：底座有污跡。鑑識說是兇器。

**早坂茜**：原本放在哪裡？

**相馬律**：桌鈴通常在吧台，但這個是老招牌的擺設，不是現役的。

**早坂茜**：所以它原本在展示架上，不在地上。

**相馬律**：展示架在右側貨架上方。若槻說他只是來拿咖啡豆。

**相馬律**：咖啡豆在左側貨架。他有沒有理由靠近展示架？

### Hotspot: 左側舊後門 {#back_door}
- **Description:** 左側一扇舊式木門，被滾輪貨架半遮住，門縫邊緣貼著警示貼紙。
- **Reveals:** [evidence:back_door_observation, statement:hayasaka_back_door]
- **Evidence Source:** visible

[相馬律瞄了左側一眼，然後繼續向右看貨架。]

**相馬律**：那扇門是後門，被貨架擋著。這種封死的後門通常只是裝飾。

[早坂茜停下來。]

**早坂茜**：左邊那扇舊門，你連門把都還沒看。

**早坂茜**：你先看右邊的鎖，先看右邊的貨架，先看右邊的監視器死角。

[相馬律轉身，走回那扇門旁邊。]

**相馬律**：貨架擋著，就算有門把也進不來。

**早坂茜**：貨架可以推。

[相馬律看了看門縫，伸手碰了一下門框邊緣。]

**相馬律**：……警示貼紙。「未接入智慧門鎖，勿作為進出通道。」

**相馬律**：看起來沒動過。

**早坂茜**：「看起來」。

### Hotspot: 滾輪貨架 {#wheeled_shelf}
- **Description:** 半遮住左側後門的滾輪貨架，金屬材質，底部橡膠輪子。
- **Reveals:** [evidence:shelf_mud]
- **Evidence Source:** visible

[相馬律蹲下，看貨架底部的輪子。]

**相馬律**：輪子底部有泥。顏色和質地不像倉庫裡的。

**早坂茜**：從哪裡來的？

**相馬律**：後巷排水口的顏色。貨架被推到後巷去過，或者有人踩著後巷的泥進來推了它。

[他站起來，看了看後門方向。]

**相馬律**：這扇門可能沒有封死。

### Hotspot: 被害者手機 {#victim_phone_spot}
- **Description:** 遺體旁的地板，一支黑色智慧手機，螢幕面朝下。
- **Reveals:** [evidence:victim_phone]
- **Evidence Source:** visible

[相馬律用鉛筆尖輕輕翻了翻手機，螢幕鎖定。]

**相馬律**：鑑識有沒有解鎖？

**早坂茜**：申請中，還沒批。

**早坂茜**：鎖屏通知上有一封未讀郵件，主旨是——「KTR-042 存取異常，請回覆。」

[相馬律靜靜看著手機。]

**相馬律**：KTR-042。片桐悠真的維護帳號。

### Hotspot: 被害者隨身碟 {#victim_usb_spot}
- **Description:** 遺體旁邊地板上的一個細小黑色物體，靠近手機，不在口袋裡。
- **Status:** locked
- **Unlock:** evidence:victim_phone collected
- **Reveals:** [evidence:victim_usb]
- **Evidence Source:** visible

[相馬律在遺體附近再掃視一圈，在地板一角發現一個細小的黑色物體。]

**相馬律**：隨身碟。放在手機旁邊，不是口袋裡。

[他蹲下，確認位置。]

**早坂茜**：他可能在倉庫裡用過它。

**相馬律**：倉庫裡有可以讀它的設備嗎？

**早坂茜**：辦公室有一台舊電腦。

**相馬律**：先記下位置，不能動。等鑑識。

## Evidence Manifest

### evidence:blue_umbrella {#blue_umbrella}
- **Name:** 藍色透明雨傘
- **Description:** 入口傘架內側的藍色傘柄透明傘，無人認領。傘柄內側有舊貼紙被撕掉的刮痕。
- **Details:** 傘柄材質為鋁合金，刮痕深度一致，像是從邊緣整片撕起的，非刀刮。
- **Image Prompt:** Transparent umbrella with a blue handle and scratched inner label area, isolated evidence icon.

#### On Collect

**相馬律**：有人留了傘，但不想留名字。

**早坂茜**：也可能忘了自己放在這裡。

**相馬律**：忘了傘的人，不會刻意刮掉名字貼紙。

#### On Reexamine

[相馬律再看了一眼傘柄內側的刮痕。]

**相馬律**：是從邊緣整片撕起來的。動作很刻意。

**相馬律**：不是普通遺失物。

### evidence:torn_umbrella_sleeve {#torn_umbrella_sleeve}
- **Name:** 破損傘套
- **Description:** 入口傘架旁地上的素面透明傘套，撕破，邊緣有泥水。
- **Details:** 傘套塑膠厚度與店內備用傘套不同，非同一品牌。邊緣泥水待比對。
- **Image Prompt:** Torn transparent umbrella sleeve with muddy edge, isolated evidence icon.

#### On Collect

**相馬律**：不是店裡的傘套。有人從外面帶著自己的傘套進來，然後在這裡撕破了。

#### On Reexamine

**早坂茜**：傘套撕破有什麼問題？

**相馬律**：傘套通常是拔掉，不是撕破。除非很急。

### evidence:entrance_cctv {#entrance_cctv}
- **Name:** 入口監視器畫面
- **Description:** 入口監視器記錄的今日片段，KAGAMI 系統有整理匯入。
- **Details:** 21:07，片桐悠真從正門離開，背對鏡頭，戴帽子。之後到警察到場前，沒有人從正門進入。
- **Image Prompt:** Security camera footage thumbnail showing a rainy cafe entrance silhouette, isolated evidence icon without readable text.

#### On Collect

**相馬律**：21:07 片桐離開，之後沒有人從正門進來。

**早坂茜**：這是官方說他案發前已離場的依據。

**相馬律**：從正門。

**早坂茜**：……你是說其他出入口。

#### On Reexamine

**相馬律**：背對鏡頭，戴帽子。監視器只看到他離開，沒有看到他的臉。

### evidence:coffee_machine_log {#coffee_machine_log}
- **Name:** 咖啡機清潔啟動紀錄
- **Description:** 吧台義式咖啡機的操作紀錄，本地儲存，非 KAGAMI 系統。
- **Details:** 自動清潔模式啟動時間：21:13:29。手動按鍵啟動。
- **Image Prompt:** Espresso machine local operation log display showing a cleaning cycle, isolated evidence icon without readable text.

#### On Collect

**相馬律**：21:13:29，清潔啟動。但 KAGAMI 說若槻蓮 21:14:52 才離開倉庫。

**早坂茜**：他怎麼可能在倉庫裡，同時按吧台的咖啡機？

**相馬律**：不可能。所以有一份紀錄的時間線是錯的。

#### On Reexamine

**相馬律**：這台咖啡機不接 KAGAMI，時間是獨立校準的。

**相馬律**：如果這台是對的，KAGAMI 門鎖的顯示時間有問題。

### evidence:frother_warmth {#frother_warmth}
- **Name:** 奶泡壺餘溫
- **Description:** 吧台奶泡壺，壺身仍有餘溫，壺口有乾燥中的奶泡殘跡。
- **Details:** 餘溫估計為最後使用後約 30 至 50 分鐘內，與最後一杯拿鐵的製作時間吻合。
- **Image Prompt:** Stainless milk frothing pitcher with dried foam residue and subtle warmth cue, isolated evidence icon.

#### On Collect

**相馬律**：還有餘溫。如果倉庫那杯拿鐵是案發前做的，時間上吻合。

#### On Reexamine

**早坂茜**：若槻說他在進倉庫前，做了一杯拿鐵給增田。

**相馬律**：如果那是真的，做拿鐵的時間就是他進倉庫的前一刻。

### evidence:timecard_record {#timecard_record}
- **Name:** 員工打卡紀錄
- **Description:** 獨立系統打卡機今日紀錄，非 KAGAMI 整合。
- **Details:** 若槻蓮 18:00 打卡上班，無下班紀錄。橘美緒（店長）16:00 上班，22:00 打卡。片桐悠真無打卡紀錄，外包人員不使用員工卡。
- **Image Prompt:** Old wall-mounted time card record slip and punch clock, isolated evidence icon.

#### On Collect

**相馬律**：打卡機不接 KAGAMI。若槻 18:00 上班，片桐沒有打卡紀錄。

**早坂茜**：片桐用的是 KAGAMI 維護帳號，不是員工卡。

#### On Reexamine

**相馬律**：片桐的進出，全部依靠 KAGAMI 帳號紀錄。

**相馬律**：他知道那個系統的每一個細節。

### evidence:kagami_official_timeline {#kagami_official_timeline}
- **Name:** KAGAMI 官方時間線摘要
- **Description:** 黑瀨刑警轉交的 KAGAMI 系統整理報告，列出案發相關時間節點。
- **Details:** 21:07 片桐離開正門；21:13:21 若槻進倉庫；21:14:18 增田心跳停止；21:14:52 若槻離開倉庫；21:20 橘美緒發現屍體。五個節點，環環相扣。
- **Image Prompt:** Official digital timeline report tablet with five connected event nodes, isolated evidence icon without readable text.

#### On Collect

**黑瀨徹**：這是 KAGAMI 整理出來的。看起來沒有漏洞。

**相馬律**：沒有漏洞，不代表正確。

**黑瀨徹**：這個我知道。所以我才讓你進來看。

#### On Reexamine

**相馬律**：五個節點，全部來自不同設備的紀錄。

**相馬律**：KAGAMI 把它們整合在一起，排成一條時間線。

**早坂茜**：整合的過程，會不會出錯？

### evidence:kagami_door_log {#kagami_door_log}
- **Name:** KAGAMI 門鎖進出紀錄
- **Description:** 倉庫智慧門鎖面板上的最近紀錄，雲端同步版本。
- **Details:** 21:07:08 KTR-042（片桐）進，21:07:33 出。21:13:21 RJ-007（若槻）進，21:14:52 出。
- **Image Prompt:** Dark gray smart lock panel with access log interface, isolated evidence icon without readable text.

#### On Collect

**相馬律**：若槻進去 21:13:21，出來 21:14:52。增田死亡時間 21:14:18。

**早坂茜**：若槻在裡面的時間，包住了死亡時間點。這就是官方指控的核心。

#### On Reexamine

**相馬律**：片桐在 21:07:08 進倉庫，21:07:33 出來。26 秒。例行維護。

**相馬律**：但他知道這個系統的每一個細節。

### evidence:wet_floor_marks {#wet_floor_marks}
- **Name:** 倉庫地板濕痕
- **Description:** 倉庫入口往左方向，一灘半乾的不規則水痕。
- **Details:** 水痕形狀不像雨水滲入或飲料潑灑，邊緣有輕微擦拭痕跡，像是被拖把擦過但沒擦乾淨。
- **Image Prompt:** Irregular half-dry water marks on storeroom floor with faint wipe streaks, isolated evidence icon.

#### On Collect

[相馬律蹲下，用手背確認水痕溫度。]

**相馬律**：剛擦過，但沒擦乾。

**早坂茜**：誰在案發後擦地板？

**相馬律**：或者，是為了擦掉什麼。

#### On Reexamine

**相馬律**：水痕的位置，在後門和主入口的中間。

**相馬律**：如果後門有人進來，腳踩的地方就是這裡。

### evidence:victim_smartwatch {#victim_smartwatch}
- **Name:** 增田圭智慧手錶紀錄
- **Description:** 死者手腕上的智慧手錶，心跳監測功能本地紀錄。
- **Details:** 心跳驟降至停止：21:14:18。本地紀錄，非雲端同步版本。手錶為個人用消費型裝置，非 KAGAMI 整合設備。
- **Image Prompt:** Black smartwatch evidence item with heart-rate graph motif, isolated on transparent background.

#### On Collect

**相馬律**：21:14:18。本地紀錄。

**相馬律**：這個時間，若槻按照 KAGAMI 的說法還在倉庫裡。

**早坂茜**：那若槻就是……

**相馬律**：先問一個問題。手錶的本地時間，和 KAGAMI 的時間，有沒有同步過？

[早坂茜沉默了。]

#### On Reexamine

**相馬律**：這只手錶不是 KAGAMI 的配備設備，時間用手機 GPS 校準。

**相馬律**：如果 KAGAMI 的門鎖時間有偏移，手錶不會跟著偏移。

### evidence:brass_bell {#brass_bell}
- **Name:** 黃銅桌鈴
- **Description:** 老式桌鈴，底座有暗色污跡，初步鑑識判定為兇器。
- **Details:** 底座重量約 800 克，足以造成致命頭部外傷。污跡成分與被害者血型吻合（初步）。
- **Image Prompt:** Vintage brass desk bell with dark stain on base, isolated evidence icon.

#### On Collect

**早坂茜**：這個桌鈴，原本放在哪？

**相馬律**：展示架。不是隨手可以拿到的地方。所以兇手知道它在哪，或者不是計劃好的，只是倉庫裡最重的東西。

#### On Reexamine

**相馬律**：若槻說他只是來拿咖啡豆，咖啡豆在左側貨架。

**相馬律**：展示架在右側。他沒有理由靠近它。

### evidence:back_door_observation {#back_door_observation}
- **Name:** 舊後門觀察記錄
- **Description:** 倉庫左側被滾輪貨架半遮住的舊式木門，門縫貼著警示貼紙。
- **Details:** 警示貼紙標示「未接入智慧門鎖，勿作為進出通道」，表面看起來完整，但紙邊緣有輕微翹起，像是被碰過又壓平的。
- **Image Prompt:** Old wooden back door with warning sticker and lifted paper edge, isolated evidence icon without readable text.

#### On Collect

**相馬律**：這扇門沒有接入 KAGAMI。有沒有人從這裡進出，KAGAMI 不會有任何紀錄。

**早坂茜**：如果有人從這裡進來，門鎖時間線上不會出現他的名字。

#### On Reexamine

**早坂茜**：警示貼紙邊緣翹起。

**相馬律**：貨架輪子有後巷泥。「看起來沒動過」不等於「沒有人動過」。

### evidence:shelf_mud {#shelf_mud}
- **Name:** 滾輪貨架底部泥水
- **Description:** 左側滾輪貨架底部輪子上的深色泥水，與倉庫地面泥土不同。
- **Details:** 泥水顏色偏深，質地較黏，與後巷排水口附近地面特徵吻合（目視判斷，待鑑識比對）。
- **Image Prompt:** Metal wheeled shelf caster with black-gray alley mud, isolated evidence icon.

#### On Collect

**相馬律**：這是後巷的泥，不是倉庫裡的。

**相馬律**：貨架被推到後巷去過，或者有人踩著泥進來，推動了貨架。

#### On Reexamine

**相馬律**：如果後門被打開，就需要先把貨架推開。

**相馬律**：貨架被推開時，輪子會碰到後巷地面的泥。後門很可能被使用過。

### evidence:half_latte {#half_latte}
- **Name:** 半杯金木犀拿鐵
- **Description:** 倉庫右側貨架角落的紙杯，裝著大約半杯咖啡，奶泡已完全攤平。
- **Details:** 奶泡攤平程度推算最後使用約 30 至 60 分鐘前。紙杯外側無濕氣，咖啡溫度接近室溫。
- **Image Prompt:** Half-finished osmanthus latte paper cup with flattened foam, isolated evidence icon without logo text.

#### On Collect

**早坂茜**：死者在倉庫裡喝過拿鐵。

**相馬律**：或者有人幫他帶進來的。若槻說他做了一杯拿鐵給增田。

**相馬律**：如果是他做的，時間點可以確認他進倉庫前的行動。

#### On Reexamine

**相馬律**：奶泡壺的餘溫和這杯的冷卻程度，大致吻合。

**相馬律**：若槻說出倉庫後立刻按清潔鍵，清潔紀錄是 21:13:29。

**相馬律**：那麼這杯拿鐵，應該是在 21:13 之前做的。

### evidence:victim_phone {#victim_phone}
- **Name:** 被害者手機
- **Description:** 增田圭的黑色智慧手機，螢幕鎖定，面朝下倒在遺體旁。
- **Details:** 鎖屏通知顯示一封未讀郵件，寄件人為加密帳號，主旨「KTR-042 存取異常，請回覆」。手機解鎖申請中。
- **Image Prompt:** Black smartphone face-down with one urgent notification glow, isolated evidence icon without readable text.

#### On Collect

**相馬律**：KTR-042 存取異常。有人在案發前就已經注意到片桐的帳號問題了。

**早坂茜**：是增田自己在查？

**相馬律**：或者是有人通知他。

#### On Reexamine

**相馬律**：主旨是「請回覆」。增田沒有回覆。

**相馬律**：他當時已經在倉庫裡了。

### evidence:victim_usb {#victim_usb}
- **Name:** 被害者加密隨身碟
- **Description:** 細小的黑色隨身碟，發現於遺體旁地板，非口袋內。
- **Details:** 隨身碟設有加密，現場無法讀取。外殼有輕微磨損，像是長期隨身攜帶使用的。
- **Image Prompt:** Tiny black USB flash drive beside an evidence marker, isolated on transparent background.

#### On Collect

**相馬律**：不在口袋裡，放在地板上。

**早坂茜**：掉落的？還是他自己放下的？

**相馬律**：倉庫裡沒有讀碟設備。他帶著它來，可能是準備給別人看的。

#### On Reexamine

[相馬律看著隨身碟。]

**相馬律**：他帶著一個加密的隨身碟來和人談。裡面有什麼，比他自己的命更重要。

## Statement Manifest

### statement:cant_see_storeroom {#cant_see_storeroom}
- **Speaker:** 相馬律（現場觀察）
- **Content:** 「從客席看不見倉庫。21:10 後沒有新客人，也沒有目擊者。」

#### On Acquire

**相馬律**：這個時間沒有第三方目擊者。

**早坂茜**：只剩紀錄說話。

#### On Reexamine

**相馬律**：沒有目擊者，時間線完全依賴電子紀錄。KAGAMI 說什麼，就是什麼。

### statement:kuruse_timeline {#kuruse_timeline}
- **Speaker:** 黑瀨徹
- **Content:** 「21:13:21 若槻進，21:14:18 增田死，21:14:52 若槻出。三個點，連在一起，沒有跳格。」

#### On Acquire

**相馬律**：沒有跳格，但有多少誤差？

**黑瀨徹**：KAGAMI 的誤差理論上在秒級以內。

**相馬律**：「理論上」。

#### On Reexamine

**相馬律**：「連在一起，沒有空隙」——這是 KAGAMI 整合後的結果。

**相馬律**：整合的過程是否正確，需要另外驗證。

### statement:kuruse_suspect {#kuruse_suspect}
- **Speaker:** 黑瀨徹
- **Content:** 「若槻蓮說詞含糊，像在隱瞞，但不像是撒大謊的人。他的小秘密讓他說不清楚大問題。」

#### On Acquire

**相馬律**：小事隱瞞了，大事說不清楚。

**黑瀨徹**：真正的無辜者，有時候比說謊的人更難洗脫。

#### On Reexamine

**早坂茜**：若槻蓮偷過報廢咖啡豆，但沒有賣過顧客資料。

**早坂茜**：兩件事不一樣，但警察只看到他在隱瞞。

### statement:kuruse_too_clean {#kuruse_too_clean}
- **Speaker:** 黑瀨徹
- **Content:** 「太乾淨的時間線，通常是人擦過的。」

#### On Acquire

**相馬律**：你懷疑 KAGAMI 的整理？

**黑瀨徹**：我不懷疑系統。我只是看過很多乾淨的案子，大多都有不乾淨的地方。

#### On Reexamine

**黑瀨徹**：我不能對著檢察官說這種話。

**黑瀨徹**：但你可以。

### statement:kuruse_victim_kagami {#kuruse_victim_kagami}
- **Speaker:** 黑瀨徹
- **Content:** 「增田圭是 KAGAMI 的資料審查員，本次是例行安全檢查。手機裡有未提交的筆記，內容不明。」

#### On Acquire

**相馬律**：例行檢查，怎麼在倉庫裡被殺？

**黑瀨徹**：他可能是在追什麼。

**相馬律**：KTR-042？

**黑瀨徹**：……你眼力不錯。

#### On Reexamine

**相馬律**：增田在查片桐的帳號異常。片桐知不知道？

**相馬律**：如果片桐知道，那他案發當天來這裡，不只是「例行維護」。

### statement:hayasaka_overview {#hayasaka_overview}
- **Speaker:** 早坂茜
- **Content:** 「若槻葵說，弟弟回家後一直在發抖。他說的時間和 KAGAMI 差了一分多鐘，但解釋不清楚。」

#### On Acquire

**相馬律**：「解釋不清楚」，是說不清楚，還是因為隱瞞了什麼？

**早坂茜**：可能都有。

#### On Reexamine

**早坂茜**：他說大約 21:12 進倉庫，KAGAMI 說 21:13:21。

**早坂茜**：他以為是自己記錯了。

**相馬律**：也可能是紀錄的時間偏移了。

### statement:hayasaka_victim_info {#hayasaka_victim_info}
- **Speaker:** 早坂茜
- **Content:** 「若槻蓮私下賣過報廢咖啡豆。增田懷疑店內有人賣顧客資料，一直盯著若槻，讓他說話一直不誠實。」

#### On Acquire

**相馬律**：增田有沒有具體指控若槻賣資料？

**早坂茜**：沒有。他只是懷疑，一直問。若槻因為咖啡豆的事心虛，見面就緊張，讓增田更確信他有問題。

#### On Reexamine

**早坂茜**：若槻蓮沒有賣資料。但他的反應讓人覺得他像是賣了。

**相馬律**：無辜者的罪感，有時候比有罪者更像有罪。

### statement:hayasaka_kagami_note {#hayasaka_kagami_note}
- **Speaker:** 早坂茜
- **Content:** 「若槻的自述時間和 KAGAMI 差了一分多鐘。如果紀錄有偏差，整條指控都需要重新核對。」

#### On Acquire

**早坂茜**：但 KAGAMI 的系統說誤差在秒級以內。

**相馬律**：「系統說」和「實際上」，不一定是同一件事。

**早坂茜**：你有辦法證明嗎？

**相馬律**：還沒有。

#### On Reexamine

**早坂茜**：咖啡機清潔紀錄和 KAGAMI 門鎖紀錄，是兩份獨立的時間線。

**早坂茜**：如果它們不一致，就有人需要解釋為什麼。

### statement:death_scene {#death_scene}
- **Speaker:** 相馬律（現場觀察）
- **Content:** 「遺體倒向前方，表示被從後方或側方擊中。現場沒有掙扎痕跡，死亡過程可能極短。」

#### On Acquire

**相馬律**：沒有掙扎。要麼他沒有防備，要麼攻擊太快。

**早坂茜**：或者他認識兇手。

#### On Reexamine

**相馬律**：增田在倉庫裡喝著拿鐵，等著和某人談。

**相馬律**：他不防備，因為他以為自己佔了主動。

### statement:hayasaka_back_door {#hayasaka_back_door}
- **Speaker:** 早坂茜
- **Content:** 「左邊那扇舊門，你連門把都還沒看。」

#### On Acquire

**相馬律**：貨架擋著。

**早坂茜**：貨架可以推。你沒有試。

[相馬律沒有反駁。]

#### On Reexamine

**早坂茜**：後門警示貼紙邊緣翹起。貨架輪子有後巷泥。

**早坂茜**：你說「看起來」沒動過，但「看起來」不夠。

**相馬律**：……我知道。

## Outro

[相馬律在倉庫門口回頭看了最後一眼。]

[旁白：倉庫裡的甜膩氣息，跟著他走進走廊。]

[他停了一下，然後繼續走。]

**早坂茜**：夠了嗎？

**相馬律**：第一輪，夠了。

**早坂茜**：下一步？

**相馬律**：問人。

[兩人走回主廳，走廊的冷白燈管在身後閃了一下。]

[旁白：調查的第一圈，看到的是官方時間線說了什麼。]

[旁白：第二圈，才能問它為什麼這樣說。]

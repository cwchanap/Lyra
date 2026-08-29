# Scene 4: 第一次詢問三宅 — 可疑但不像兇手

- **Summary:** 相馬拆開三宅對母親電話與蛋糕盒的小謊，確認他的隱瞞不能證明殺人，但也還不足以推翻摘要。

## Intro

[場景：警署等待區，深夜。日光燈偏白，牆角一台自動販賣機嗡嗡作響，長椅上只坐著三宅一人。]
- **Background Prompt:** Late-night Japanese police station waiting area under pale fluorescent lights, humming vending machine in the corner, long empty bench, rain-dark windows, tense quiet mood, no readable labels.
- **BGS:** bgs_police_station_late_night

[三宅蒼太手裡握著一罐飲料，盯著罐身上的字看了很久。]

**早坂茜**：他從進來就一直捏著那罐東西。

**相馬律**：他剛才在販賣機前站了一會兒。

[早坂側向相馬，壓低聲音。]

**早坂茜**：等下用物證說話。

**相馬律**：嗯。先看他那罐。

[相馬走過去，看見罐身印著「黑咖啡」三個字。]

**相馬律**：你買了黑咖啡。

**三宅蒼太**：……啊。

[三宅低頭看著罐子，手指停在罐身上。]

**三宅蒼太**：我媽不能喝咖啡。

**相馬律**：那你為什麼買這個？

[三宅沒有馬上回答，手指在罐身上摩了一下。]

**三宅蒼太**：我本來要買熱牛奶的。給我媽的。

**三宅蒼太**：我只是……習慣先想她喝什麼。一緊張就按錯了。

[三宅把那罐黑咖啡放到一旁，沒有打開。]

**早坂茜**：相馬，問話可以開始了。

## Phase: 詢問三宅 {#ask_miyake}
- **Kind:** inquiry
- **Required:** true
- **Status:** unlocked
- **Background Prompt:** Late-night Japanese police interrogation room, small table under hard lamps, rain-dark window, vending-machine glow from waiting area implied, tense but quiet.
- **BGS:** bgs_police_station_late_night

[場景：警署詢問室，深夜。室內只有一張桌子與兩盞燈，氣氛壓抑，窗外仍在下雨。]

[三宅坐在桌子對面，雙手放在膝上，背稍微駝著。早坂把幾份從現場帶回的紀錄放到桌面，三宅的目光掃過，肩膀又縮緊了些。]

**早坂茜**：把他的說法和現場紀錄一條條對上。

### Subject: 三宅蒼太 {#miyake}
- **Role:** 雨鐘咖啡館店員 / 本案表面嫌疑人
- **Bio:** 當晚負責關店的店員，個性緊張，掛念著生病的母親，最怕丟了這份工作。

### Question: 二十二點五十六分左右在哪裡 {#q_whereabouts}
- **Status:** unlocked
- **Required:** true

#### Testimony

- **On Loop:** **三宅蒼太**：那個時間……你要問，我再想一次。
- **Loop Prompt:** **相馬律**：把那段時間，從頭再理一次。
- **Default Challenge:** **相馬律**：等一下，這句先讓我想想。
- **Default Wrong:** **三宅蒼太**：這句……應該沒問題吧？
- **Wrong Reply:** **相馬律**：不對，這對不上那個時間點。

##### Line: 二十二點五十六分記不清 {#miyake_whereabouts_2256}

**三宅蒼太**：那個時候……我記不太清楚。關店的事很碎，我沒特別記。

- **Contradiction:** evidence:closing_routine
- **Challenge:** **相馬律**：那個時間，白板上的收銀關帳、清潔回收都還沒做完。你不會完全沒印象。
- **On Correct:** **三宅蒼太**[strained]：……那時候我躲在員工休息區，偷偷打給我媽。值班不能打私人電話，我怕被說，才沒講。
  - **Reveals:** [evidence:miyake_mother_call_log]
- **On Wrong Evidence:** **三宅蒼太**：這跟那個時間有什麼關係？我記不清楚就是記不清楚。

### Question: 為什麼去後場 {#q_backroom}
- **Status:** unlocked
- **Required:** true

#### Testimony

- **On Loop:** **三宅蒼太**：後場那趟……我說的都是真的。
- **Loop Prompt:** **相馬律**：後場那段，我再聽一次。
- **Default Challenge:** **相馬律**：這句，先停一下。
- **Default Wrong:** **三宅蒼太**：這……沒有不對吧？
- **Wrong Reply:** **相馬律**：不是這件，再找一次，別繞著清潔用品打轉。

##### Line: 後場只拿清潔用品 {#miyake_backroom_reason}

**三宅蒼太**：拿清潔用品。擦桌、倒垃圾那些，東西都放在後場。

**三宅蒼太**：那趟大概二十三點零六分，我記得經過走廊那個鐘。

- **Contradiction:** evidence:cctv_screenshot
- **Challenge:** **相馬律**：只拿清潔用品？再想一次。
- **On Correct:** **三宅蒼太**[strained]：……我還從後場拿了一個蛋糕盒。本來就要丟的，我想帶回去給我媽，怕被當成偷東西，才沒講。
  - **Reveals:** [evidence:cake_box]
- **On Wrong Evidence:** **三宅蒼太**：這跟清潔用品有什麼關係？我就是拿了那些而已。

### Question: 是否進入內側倉庫 {#q_inner_storage}
- **Status:** unlocked
- **Required:** false

#### Testimony

- **On Loop:** **三宅蒼太**：這點我沒說謊，你再問幾次都一樣。
- **Default Challenge:** **相馬律**：內側倉庫，你確定一次都沒進？
- **Default Wrong:** **三宅蒼太**：確定。這點我真的沒進去。

##### Line: 沒進內側倉庫 {#miyake_inner_storage_denial}

**三宅蒼太**：沒有。那裡平常我也不太進去。

### Question: 增田在等誰 {#q_masuda}
- **Status:** unlocked
- **Required:** false

#### Testimony

- **On Loop:** **三宅蒼太**：我知道的就這些，真的。
- **Default Challenge:** **相馬律**：那個外包的人，你看過？知道是誰嗎？
- **Default Wrong:** **早坂茜**：別急著把「外包的人」當成兇手。沒身分、沒時間、動線也對不上，這還不是證據。

##### Line: 增田在等外包的人 {#miyake_masuda_waiting}

**三宅蒼太**：好像是……外包那邊的人吧。我只聽他說過一句，不知道對方長什麼樣。

## Evidence Manifest

### evidence:cake_box {#cake_box}
- **Name:** 蛋糕盒（準備丟棄品）
- **Description:** 三宅當晚從後場帶走的蛋糕盒，原是店裡準備丟棄的剩品。
- **Details:** 三宅為了帶給生病的母親而拿走，因怕被當成偷竊，一開始隱瞞了這件事。
- **Image Prompt:** Small flattened cafe cake box with a plain disposal sticker shape, slightly worn cardboard, isolated evidence icon, no readable text.

#### On Collect

**相馬律**：一個要丟的蛋糕盒。他為這個撒了第一個小謊。

### evidence:miyake_mother_call_log {#miyake_mother_call_log}
- **Name:** 三宅母親通話紀錄
- **Description:** 三宅在二十二點五十六分前後，於員工休息區撥給母親的一通私人電話。
- **Details:** 目前僅為三宅口述，屬待確認項目，需日後向電信方正式調閱核實。
- **Image Prompt:** Smartphone call-log screen mockup with one highlighted outgoing call row, all marks unreadable, isolated evidence icon.

#### On Collect

**相馬律**：通話時間先記成待確認，之後再正式調。

## Outro

[相馬律收起桌上的紀錄，三宅被帶了出去。]

**相馬律**：他撒的是小謊，為了蛋糕盒和那通電話。

**早坂茜**：摘要還站得住。下一步，找能對上時間的物證。

**相馬律**：我知道。要動搖摘要，靠的是物證，不是他孝不孝順。

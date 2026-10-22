# Scene P1: 零號小委託 — 重印收據

- **Summary:** 相馬在文具店的低風險委託中親手查看四項紙本與影像痕跡，先學會把「看起來相符」的時間拆開，再把它們帶到整理板上比較。

## Intro

[場景：吉祥寺商店街，黃昏，下著細雨。濕亮的騎樓倒映著店家招牌，一家文具店兼影印店亮著暖光。]
- **Background Prompt:** Rainy dusk on a small Tokyo shopping street, wet pavement reflecting warm storefront signs, awning-edge drip, a stationery-and-copy shop with warm interior light glowing through glass, no people, no readable text, cinematic visual-novel background, neo-noir mood.
- **Background Asset ID:** background.chapter_1.scene_p1.tag_001
- **BGM:** bgm_casework_day
- **BGS:** bgs_shopping_street_rain_dusk

**旁白**：雨從下午就開始下，一直沒停。 {#L001}

[相馬律在文具店門口收傘，把磨損的卷宗夾換到沒漏水的那一邊。]

**相馬律**：事務所的印表機又沒碳粉了。意見書只好來這裡印。 {#L033}

**相馬律**：開業還不到一年，壞掉的東西倒是比委託多。 {#L034}

[玻璃門內，店主和一個背著書包的學生隔著櫃台站著，誰也沒讓誰。]

**相馬律**：……今天店裡好像不太平靜。 {#L035}

[他推開店門，門鈴叮噹響了一聲。]

## Sub-location: 文具店櫃台 {#copy_shop_counter}
- **Status:** unlocked
- **Background Prompt:** Interior of a small Tokyo stationery and copy shop, pale white fluorescent light, a wooden counter with a small receipt on it, an old register and a compact security monitor against the back wall, a copier humming, stacked paper reams and stationery shelves, faint rain audible through the glass door, no people, no readable text, cinematic visual-novel background, neo-noir mood.
- **Background Asset ID:** background.chapter_1.scene_p1.tag_002
- **BGS:** bgs_stationery_copy_shop

[場景：文具店店內。日光燈偏白，空氣裡混著紙張與碳粉的味道。櫃台前站著店主和背著書包的學生，兩人之間隔著一張收據。]

**店主**：啊，相馬先生。你的二十頁印好了，在那邊。 {#L036}

**相馬律**：謝謝。……出什麼事了？ {#L037}

**店主**：這孩子五點多來印講義，剛才又回來拿忘在機器上的原稿。 {#L038}

**店主**：收據和監視器的時間對不上，才吵起來。 {#L007}

**學生**：我只記得付完錢就離開了。 {#L008}

**店主**：我本來想直接打給他學校。 {#L039}

**學生**：拜託不要……我下個月要交推薦入學的資料。 {#L040}

[店主看向相馬，像是想起了什麼。]

**店主**：相馬先生，你以前在警視廳外包那邊看資料的吧？這種東西你在行。 {#L041}

**相馬律**：我看的是報表。現場……還在學。 {#L042}

**店主**：那也比我們兩個瞪著收據強。費用照算。 {#L043}

**相馬律**：……這個月的影印費打個折就好。 {#L044}

**店主**：成交。 {#L045}

**相馬律**：先不要急著判斷。我想把留下的東西各看一遍，再拿來比。 {#L009}

[店門鈴又響；早坂茜收傘走進店裡。]

**早坂茜**：六點整。意見書呢？ {#L046}

**相馬律**：印好了。不過……我剛接了一件。 {#L047}

**店主**：這位是……？ {#L048}

**相馬律**：早坂律師。我替她的案子看證據、寫意見書。 {#L049}

[早坂看了一眼櫃台上的收據，又看了一眼縮著肩膀的學生。]

**早坂茜**：上次那件文書偽造，你也說是「順手看一下」。 {#L050}

**相馬律**：這次真的很小。 {#L051}

**早坂茜**：收費？ {#L052}

**相馬律**：影印費打折。 {#L053}

**早坂茜**：那也是委託。結束記得開收據。 {#L054}

**早坂茜**：你先做完，我不插手。 {#L011}

### Hotspot: 櫃台上的收據 {#receipt}
- **Reveals:** [practice:p1_receipt_reprint]
- **Description:** 一張列著十七點四十二分的收據，壓在櫃台邊緣。

[相馬拿起收據，湊近日光燈。右下角有一行極小的英文字。]

**相馬律**：「REPRINT」。 {#L012}

**相馬律**：這不是第一次印出的那張，是重印收據。 {#L013}

**店主**：可是時間是真的。機器不會自己亂打。 {#L014}

**相馬律**：真的時間，也要先問它記的是哪一件事。 {#L015}

### Hotspot: 老舊收銀機的出紙口 {#register}
- **Reveals:** [practice:p1_register_paper_jam]
- **Description:** 收銀機的出紙口卡著幾片被撕裂、還很新的紙屑。

[相馬彎下腰，沒有碰機器，只看出紙口夾住的紙屑。]

**相馬律**：這裡剛卡過紙。 {#L016}

**店主**：舊機器偶爾會卡，那又怎樣？ {#L017}

**相馬律**：如果原本的收據卡在裡面，後來重印就不等於當時付款。 {#L018}

### Hotspot: 櫃台後的監視器 {#cctv}
- **Reveals:** [practice:p1_cctv_change]
- **Description:** 小小的監視器停在學生離店前的畫面，右上角顯示十七點三十八分。

[店主不情願地把畫面倒回去。學生站在櫃台前，店主低頭從抽屜裡拿出零錢。]

**相馬律**：店主先找了錢，學生才離開。 {#L019}

**學生**：我那時候還低頭看了一下零錢。 {#L020}

**相馬律**：這段影像是真的，也支持你們之間有一筆交易。 {#L021}

**相馬律**：但它只告訴我們你在十七點三十八分前離開。 {#L022}

**相馬律**：還不能單獨解釋十七點四十二分的收據。 {#L023}

### Hotspot: 店主的手寫帳本 {#ledger}
- **Reveals:** [practice:p1_handwritten_ledger]
- **Description:** 一本厚厚的手寫帳本，今天的收入按時間一行一行記著。

[相馬翻到今天那頁，指尖停在一行工整的字跡上。]

**相馬律**：十七點三十七分，影印費。 {#L024}

**店主**：那是我手寫的，不像機器那麼漂亮。 {#L025}

**相馬律**：漂亮不漂亮不重要。這一行記的是收入發生的時間。 {#L026}

**相馬律**：現在，把四項東西排開看看。 {#L027}

## Outro

[相馬把收據、收銀機、監視器畫面和帳本，在櫃台上排成一列。]

**相馬律**：先別急著替誰定罪。 {#L028}

**相馬律**：把能說明「十七點四十二分是什麼」的資料挑出來，比一比。 {#L029}

**店主**：……好。你說怎麼看，我就怎麼看。 {#L030}

**旁白**：四個小小的痕跡都在眼前。 {#L031}

**旁白**：下一步，不是再找一張紙，而是決定哪些能放在同一個答案裡。 {#L032}

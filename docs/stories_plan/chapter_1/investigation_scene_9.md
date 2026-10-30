# Scene 9: 北見修一調查 — 外包鏈入口

- **Summary:** 相馬沿著臨時工單與增田留下的備忘追到北見修一，確認他持有當夜的外包憑證，也正因資料盜賣與帳號審查承受壓力。

## Intro

[場景：KAGAMI 外包資料審查辦公室，白日。玻璃窗口前放著一份限定調閱回函，檔案櫃排在後方。]
- **Background Prompt:** KAGAMI contractor records review office in daylight before the records handoff, glass service window, file cabinets, limited-scope reply packet on the counter, bureaucratic restraint, no readable text.
- **BGS:** bgs_contractor_office_day

[相馬律與早坂茜走進 KAGAMI 的外包資料審查辦公室，黑瀨徹已在窗口前等他們。]

**相馬律**：這地方，連椅子都不讓人久坐。 {#L001}

**早坂茜**：撐著點。拿到工單，那個空位才有名字可以填。 {#L002}

**相馬律**：從昨晚到現在，那格一直空著。 {#L003}

**早坂茜**：今天把它填上。黑瀨刑警，說吧。 {#L004}

**黑瀨徹**：我以現場刑警的身分，向承包商提了協力請求。 {#L005}

**黑瀨徹**：他們只肯回後場門鎖那一份：維護工單、權限名單，加工單附的資材包清單。 {#L006}

**相馬律**：我們不能自己進承包商的資料庫翻嗎？ {#L007}

**早坂茜**：不能。那不是律師私下翻得到的東西。 {#L008}

## Sub-location: 承包商資料窗口 {#contractor_desk}
- **Status:** unlocked
- **Background Prompt:** KAGAMI contractor records office service window in daylight, glass partition, file cabinets, limited-scope reply packet on desk, bureaucratic restraint, no readable text.
- **BGS:** bgs_contractor_office_day

[場景：KAGAMI 外包資料審查辦公室／承包商聯絡窗口，白日，玻璃隔板後一排檔案櫃，桌上攤著一份限定範圍的調閱回函。]

[一名承包商主管把回函推到桌面中央，神情公事公辦。中年男人，袖口磨得發白，表情像是做好了份內的事就不再多走一步的那種人。]

**承包商主管**：就這些。超出範圍的我不能給。 {#L011}

**早坂茜**：夠了。我們要的就是這一段。 {#L012}

[相馬律的視線越過窗口，掃過辦公室側牆。一塊白板上用磁鐵壓著幾排日期——合約更新截止、帳號回收日、臨時識別證交接排程，紅筆圈住的日期一路排到下個月底。]

[長椅上坐著三四個人，手裡各捏一張臨時識別證，等著交回。一個人在簽到板上劃掉自己的名字，筆尖頓了一下才補上離場時間。]

[承包商主管朝長椅那側偏了偏下巴，頭也沒抬。]

**承包商主管**：權限過期就不能進系統。人也一樣，到期就走流程。 {#L013}

[相馬律的目光在那塊白板上停了一拍，沒有說話，只是把領口往內收了一下。]

**相馬律**：……這種地方，待久了會記得自己只是暫時的。 {#L014}

**早坂茜**：他們的排程跟我們無關。回函拿到了，看裡面。 {#L015}

### Hotspot: 臨時維護工單 {#workorder}
- **Description:** 回函資料包最上面那張，當晚臨時排定的後場門鎖維護工單。
- **Evidence Source:** visible
- **Scene Source Prompt:** Contractor reply packet folder open on the service-window counter, top sheet a temporary maintenance work order with doorlock icon and clipped approval stamp shape; no readable text.
- **Reveals:** [evidence:temp_maintenance_workorder]

[相馬律把翹起的紙角壓平，又把歪掉的訂書針撥回正。]

**早坂茜**：你一緊張，就先整理東西。 {#L016}

**相馬律**：手不動，腦子更亂。 {#L017}

**早坂茜**：那就先讓手忙著。腦子留給正事。 {#L018}

### Hotspot: 外包維護權限名單 {#access_permission_list}
- **Description:** 回函資料包裡，那晚能動用該憑證的外包維護權限名單。
- **Evidence Source:** visible
- **Scene Source Prompt:** Contractor access-permission list page from the reply packet on the counter, rows of codes with one highlighted row and keycard symbol, names and codes unreadable.
- **Reveals:** [evidence:kitami_external_access]

[相馬律把名單翻到背面，指腹停在打孔的紙邊。]

**相馬律**：以前做協力的時候，這種表一厚，我就會忘記人長什麼樣。 {#L019}

**早坂茜**：那今天別忘。先把人看清楚，再說別的。 {#L020}

### Hotspot: 資材包清單 {#material_kit_list}
- **Description:** 回函資料包裡，工單附帶的外包維護資材包清單，連傘套的規格都列在上面。
- **Evidence Source:** visible
- **Scene Source Prompt:** Contractor material-kit list page from the reply packet on the counter, one row showing a transparent umbrella sleeve item icon, labels unreadable.
- **Reveals:** [evidence:contractor_umbrella_sleeve_match]

[透明傘套的邊角沾著一點潮氣。窗口一開，雨聲就順著玻璃縫鑽進來。]

**相馬律**：清單上有一格透明傘套。後場牆角那只，也是這種。 {#L021}

**早坂茜**：拿來比對看看。 {#L022}

**相馬律**：這裡連傘套都被收得很整齊。 {#L023}

### Hotspot: 玻璃隔板上的雨水 {#window_rain_glass}
- **Description:** 承包商窗口的玻璃隔板，雨水在玻璃上拖成一道道細長的水痕。

[玻璃隔板上，雨水順著表面往下爬，在半途匯成一條較粗的水線，把後方檔案櫃的輪廓糊開。]

**相馬律**：……從這邊看過去，那邊只剩影子。 {#L024}

[一陣風從門縫帶進什麼，甜的，一下就被辦公室的冷氣壓平了。相馬律的手停在紙頁邊上，沒有翻。]

**早坂茜**：看資料，不要看雨。 {#L025}

**相馬律**：……嗯。 {#L026}

### Character: 承包商主管 {#contractor_clerk}
- **Role:** KAGAMI 外包資料審查窗口承辦人
- **Bio:** 中年男人，袖口磨得發白。做好了份內的事就不再多走一步的那種人。

#### Topic: 另一個 K {#other_k_name}
- **Status:** locked
- **Unlock:** evidence:kitami_external_access collected

[相馬律指著名單上另一行 K 開頭的編號，停用欄裡填著上週的日期。]

**相馬律**：這一個也在名單上，但停用欄寫著上週。臨時識別證交回了？ {#L027}

[承包商主管瞟了一眼，翻了翻手邊一本小冊子。]

**承包商主管**：對，上週交回，憑證停用。 {#L028}

**早坂茜**：所以那晚能動這組憑證的，就只剩北見那一組。 {#L030}

**承包商主管**：我只照規矩給名單。誰是誰，你們自己判。 {#L031}

##### On Reexamine

[承包商主管把小冊子合上。]

**承包商主管**：我說過了，那個上週到期。 {#L034}

#### Topic: 你這張桌子 {#clerk_long_day}
- **Status:** unlocked

[相馬律的目光落在主管袖口那圈磨白的縫線上。]

**相馬律**：你今天也待了很久。那個保溫瓶也是你的？ {#L035}

**承包商主管**：這窗口開到五點。我每天泡一壺麥茶，撐到時間就走。 {#L036}

**承包商主管**：二十年了，都是這張桌子。 {#L037}

[他把回函資料包往相馬那側再推了半寸，動作很輕。]

**承包商主管**：資料給你了。剩下的不在我份內。 {#L038}

**早坂茜**：……謝謝。我們看資料就好。 {#L039}

### Hotspot: 前往質問北見 {#to_confront}
- **Status:** locked
- **Unlock:** evidence:temp_maintenance_workorder collected and evidence:kitami_external_access collected and evidence:contractor_umbrella_sleeve_match collected
- **Description:** 北見修一已被請到隔壁的訪談室，可以過去當面問。
- **Reveals:** [sublocation:confront_kitami]

**黑瀨徹**：北見在隔壁。主管叫他來退臨時識別證，我請他多留十分鐘，他隨時可以走。 {#L105}

[相馬律把三份材料疊齊，手指在公事包的搭扣上停了一下。]

**早坂茜**：手冷？ {#L040}

**相馬律**：沒有。 {#L041}

**早坂茜**：那就別逞強。進去之後少搶話。 {#L042}

## Sub-location: 質問北見 {#confront_kitami}
- **Status:** locked
- **Background Prompt:** Small white interview room under exposed fluorescent tubes, forensic printouts on table, plain walls, restrained office pressure, no readable document text. Kitami Shuichi baked into the center seat across the table: middle-aged man of medium-soft build with shoulders drawn inward, unremarkable beige-gray business-casual layers, thin metal-frame glasses slipping down his nose, dark lanyard, a deeply creased business card gripped under his palm, a face used to being overlooked in the workplace, perspective-correct scale and lighting under the exposed fluorescent tubes, the unsent memo and whistleblower draft kept in the investigators' hands, pages angled away from him.
- **BGS:** bgs_interview_room_fluorescent

[場景：訪談室，白日。日光燈照得無處可藏；窄室四面白牆，桌上攤著死者手機鑑識列印件。北見修一坐在對面，攥著摺痕很深的名片：眼鏡下滑，他每隔幾秒以中指推回，一張習慣在職場被忽略的臉。]

[黑瀨徹把那批鑑識列印件，一頁頁鋪開在桌上，紙張滑過桌面的聲音在安靜的房間裡格外清晰。]

**黑瀨徹**：死者手機的鑑識，這一批我按證物鏈固定過了。 {#L043}

**黑瀨徹**：跟之前那則手機通知，是同一批裡的。 {#L044}

### Hotspot: 增田未送出備忘 {#unsent_memo}
- **Description:** 鑑識列印件裡，一則增田始終沒送出的備忘。
- **Evidence Source:** visible
- **Scene Source Prompt:** Forensic printout of Masuda's unsent phone memo spread on the interview-room table, with the memo rows present but unreadable.
- **Reveals:** [evidence:masuda_unsent_memo]

[相馬律拿起那頁列印件，唸出上面短短三行。]

**相馬律**：「22:50 雨鐘。校驗值確認。K。」 {#L045}

**早坂茜**：22:50 是備忘裡約的時間和地點，不是維護開啟。 {#L046}

**早坂茜**：維護開是 22:52。兩件事別混。 {#L047}

**相馬律**：所以增田知道那場碰面有風險，在等一個跟校驗值有關的人。 {#L048}

**早坂茜**：對。但光這則備忘，定不了北見。得跟工單、憑證、那個 K 一起看。 {#L049}

### Hotspot: 增田檢舉草稿與附件 {#whistleblower_draft}
- **Description:** 監察信箱草稿匣裡，增田沒送出的檢舉草稿與未完成的異常存取整理表。
- **Evidence Source:** visible
- **Scene Source Prompt:** Forensic printout packet with an unsent whistleblower draft and attached abnormal-access table held in the investigator's hands with the pages angled away from the seated suspect, no readable text.
- **Reveals:** [evidence:masuda_whistleblower_draft, evidence:kitami_data_theft_record]

[相馬律把那份草稿拿在手裡，頁面朝自己，沒讓對面的北見看見。翻到最後，結尾還空著。]

**相馬律**：是檢舉草稿。沒送出，只躺在監察信箱的草稿匣。 {#L050}

**早坂茜**：沒送出，就還沒走完程序。光一份草稿，證不了資料怎麼流出去的。 {#L051}

[相馬律往草稿後面翻，停在一張沒做完的表。]

**相馬律**：後面還附了一張異常存取整理表，沒做完。 {#L052}

[相馬律順著表上的紀錄，一行行往下看。]

**相馬律**：北見的帳號，好幾次在排程外接觸試點資料。 {#L053}

**相馬律**：有一部分，匯到一個外部傳輸載體上。 {#L054}

**早坂茜**：到買家是誰，這張表還沒證到。 {#L055}

**早坂茜**：但足夠說，北見有盜賣資料的嫌疑了。 {#L056}

[北見聽到這裡，在椅子上微微換了個姿勢，肩膀往內縮了一點，手指又把那張名片的摺痕抹平了一次。]

**北見修一**：他連結尾都還沒寫完，就說要送出去。 {#L057}

### Character: 北見修一 {#kitami}
- **Role:** KAGAMI 外包維護人員
- **Bio:** 受合約審查壓力的外包系統維護工。那晚的臨時工單與外包憑證指向他的帳號。
- **Wrong Present:** [北見瞥了一眼那份紀錄，又低頭去抹掌心的名片。]

#### Topic: 名片與否認 {#card_denial}
- **Status:** unlocked

[北見摘下眼鏡，拿衣角擦了擦，又戴回去，避開相馬的視線。]

**相馬律**：那組外包憑證，那晚是你動的。 {#L058}

**北見修一**：規則從來不是寫給我們這種人看的。 {#L059}

[他說這句話的時候聲音裂了一下，兩手擱在桌上不動了，名片被壓在掌下。]

[北見低頭，又把那張摺痕很深的名片抹平。]

**相馬律**：那資料，最後賣給了誰？ {#L060}

[北見的手指頓了一下，沒接這句，只是又去抹名片。]

**早坂茜**：他沒答。名片倒是被抹得更平了。 {#L061}

#### Topic: 當夜壓力 {#night_pressure}
- **Status:** unlocked

[北見的肩膀垮了下來，整個人像被抽掉了什麼支撐，聲音壓得很低。]

**相馬律**：那晚到底是什麼，把你逼到動手？ {#L062}

**北見修一**[defensive]：他要是真送出去，我就完了。 {#L063}

**北見修一**[defensive]：我那組外包帳號，隔天就要面對合約審查、憑證收回。 {#L064}

**相馬律**：所以只要檢舉一送出，那些異常存取就會被翻出來。 {#L065}

**北見修一**：我只是想在被換掉之前，留一點退路。 {#L066}

[他把那張摺痕很深的名片又對摺了一次，紙角已經起了毛邊。]

**早坂茜**[stern]：壓力講夠了。盜賊就是盜賊，審查再急也不改這件事。 {#L067}

#### Topic: 早班 {#early_shift}
- **Status:** unlocked

[北見又推了一下眼鏡，中指在鏡架上停了一拍。]

**相馬律**：你看起來沒睡。 {#L068}

**北見修一**：……我另一個早班四點開始。跟這件無關。 {#L069}

[北見說完後低下頭，拇指沿著名片折痕來回抹了一下。]

**相馬律**：這條線跑了多久？ {#L070}

**北見修一**[cornered]：八年。都是這種排法。 {#L071}

**北見修一**[cornered]：合約一到期就重簽，年資歸零。 {#L072}

**早坂茜**：你的班表不是這裡要處理的事。 {#L075}

**早坂茜**：名字對上了，就先對著名字走。 {#L076}

##### On Reexamine

[北見沒有再接話，只是又把名片摺痕抹平了一次。]

**北見修一**：……沒什麼好說的了。 {#L077}

#### Topic: 那份草稿 {#draft_slip}
- **Present:** evidence:masuda_whistleblower_draft
- **Reveals:** [statement:kitami_meeting_admission]

[相馬律把草稿推到北見面前。]

**相馬律**：你剛才說，他連結尾都還沒寫完。 {#L107}

**相馬律**：這份草稿從沒離開過草稿匣，結尾空著的事，我們剛才一個字都沒提。你什麼時候看到的？ {#L108}

[北見推眼鏡的手停在半空，名片被指節壓出一道新的折痕。]

**北見修一**[cornered]：……是他那晚約我去雨鐘。22:50，說要談。他把螢幕轉給我看，草稿還沒寫完。 {#L109}

**北見修一**：談完我就走了。後面的事，我不知道。 {#L110}

**早坂茜**：你幾點走的，現在只有你一句話。這要拿門鎖紀錄去對。 {#L111}

##### On Reexamine

[北見低著頭，沒有再抬起來。]

**北見修一**：我說的，就是這些。 {#L112}

## Evidence Manifest

### evidence:temp_maintenance_workorder {#temp_maintenance_workorder}
- **Name:** 臨時維護工單
- **Description:** 案發當晚臨時排定的後場門鎖維護工單。
- **Details:** 工單標的是後場那扇門鎖，底下對應一組外包維護憑證。工單本身只證明那晚排了一次臨時維護，還要再對到憑證、對到人。
- **Source Sublocation:** contractor_desk
- **Image Prompt:** Temporary maintenance work order sheet with a doorlock icon and clipped approval stamp shape, all fields unreadable, isolated evidence icon.

#### On Collect

**相馬律**：那晚臨時排了一張維護工單。 {#L078}

**早坂茜**：工單對得上憑證，但人還沒對上。 {#L079}

### evidence:kitami_external_access {#kitami_external_access}
- **Name:** 北見外包維護權限
- **Description:** 外包維護權限名單裡，那晚能動用該憑證的人。
- **Details:** 名單上 K 開頭的承包商不只一個，編碼也相近。但把那晚的臨時工單和那組外包憑證一起對，能動用的只落在北見修一身上。這是北見的名字第一次對到具體的人。
- **Source Sublocation:** contractor_desk
- **Image Prompt:** Contractor access-permission list with one highlighted row and keycard symbol, names and codes unreadable, isolated evidence icon.

#### On Collect

**相馬律**：工單加憑證，只落在一個人身上。 {#L080}

**早坂茜**：北見修一。名字第一次對到了人。 {#L081}

### evidence:contractor_umbrella_sleeve_match {#contractor_umbrella_sleeve_match}
- **Name:** 承包商資材包傘套規格比對
- **Description:** 資材包清單裡的透明傘套規格，與後場那只濕傘套的比對。
- **Details:** 資材包清單列的傘套規格，與後場牆角那只傘套相符；初勘照片裡它還在滴水。同款傘套外面也買得到，所以它排不出先後，也不專屬於承包商，只能算旁證：走過後巷的人，帶的是和資材包同款的傘套。它不能單獨定罪；要對到人，仍須臨時維護工單和外包憑證。
- **Source Sublocation:** contractor_desk
- **Image Prompt:** Specification comparison card pairing a transparent umbrella sleeve silhouette with a list-entry icon, matching type and size marks only, no creases or fold detail, no readable labels, isolated evidence icon.

#### On Collect

**相馬律**：清單上的傘套規格，和後場那只對得上。 {#L082}

**早坂茜**：傘套排不出先後，也不專屬誰。只能說，後巷那個人帶的是和資材包同款的傘套。 {#L083}

### evidence:masuda_unsent_memo {#masuda_unsent_memo}
- **Name:** 增田未送出備忘
- **Description:** 死者手機鑑識裡，一則沒送出的純文字備忘。
- **Details:** 備忘只有三行：「22:50 雨鐘。校驗值確認。K。」22:50 是備忘裡約定的時間地點，不是維護開啟（維護開是 22:52）。它證明增田知道這場碰面有風險，在等一個跟校驗值有關的人，但光這則不能定北見，要跟工單、憑證、那個 K 一起看。
- **Source Sublocation:** confront_kitami
- **Image Prompt:** Unsent phone memo printout with three short blurred rows and a folded corner, all text unreadable, isolated evidence icon.

#### On Collect

**相馬律**：「22:50 雨鐘。校驗值確認。K。」 {#L085}

**早坂茜**：他在等一個跟校驗值有關的人。但這還不足以定罪。 {#L086}

### evidence:masuda_whistleblower_draft {#masuda_whistleblower_draft}
- **Name:** 增田檢舉草稿
- **Description:** 監察信箱草稿匣裡，一份沒送出的檢舉草稿。
- **Details:** 草稿沒送出，只躺在監察信箱的草稿匣，結尾那一段還空著，程序還沒走完。它記著北見有異常存取，但光一份草稿，證不了資料是怎麼流出去的。增田本來帶了 USB，想當場比對買家鏈校驗值的最後一段。
- **Source Sublocation:** confront_kitami
- **Image Prompt:** Unsent whistleblower draft document in a folder with attachment tab shapes, all paragraphs unreadable, isolated evidence icon.

#### On Collect

**相馬律**：是檢舉草稿，沒送出。 {#L087}

**早坂茜**：光一份草稿，證不了資料怎麼流出去。 {#L088}

[黑瀨徹從增田的個人物品袋裡取出一支隨身碟，另裝進證物袋，壓好封條。]

**黑瀨徹**：這支另編，送鑑識。 {#L089}

### evidence:kitami_data_theft_record {#kitami_data_theft_record}
- **Name:** 北見資料盜賣紀錄
- **Description:** 檢舉草稿附件裡那張沒完成的異常存取整理表。
- **Details:** 表上記著北見的帳號多次在排程外接觸試點資料，有一部分匯到外部傳輸載體。它還沒證到最終買家是誰，但足夠顯示北見有盜賣資料的嫌疑，構成這一晚的動機與壓力來源。
- **Source Sublocation:** confront_kitami
- **Image Prompt:** Incomplete abnormal-access spreadsheet printout with external-transfer arrow shapes and highlighted rows, all entries unreadable, isolated evidence icon.

#### On Collect

**相馬律**：排程外接觸試點資料，還匯到外部載體。 {#L090}

**早坂茜**：買家是誰還沒證到，但盜賣的嫌疑成立了。 {#L091}

## Statement Manifest

### statement:kitami_meeting_admission {#kitami_meeting_admission}
- **Speaker:** 北見修一
- **Content:** 增田那晚 22:50 約他到雨鐘談話；他說談完就離開，之後的事不知道。

#### On Acquire

**相馬律**：22:50，雨鐘。他自己承認了這場碰面。 {#L113}

**早坂茜**：離開的時間是他的說法。門鎖紀錄會說話。 {#L114}

## Outro

[相馬律把工單、憑證、備忘、草稿一份份疊好，望向桌對面的北見。]

**相馬律**[determined]：那個一直空著的第三人座位，現在能對到一個名字了。 {#L092}

**早坂茜**：身分對上了。動機和當夜的壓力，也都站住了。 {#L096}

**相馬律**：剩下的，就交給最後的審查會。 {#L097}

**早坂茜**：對。材料齊了。我們去把這條鏈，當著所有人講清楚。 {#L098}

[相馬律把疊好的文件收進公事包，扣上搭扣，聲音在安靜的走廊裡很清脆。]

**相馬律**：他從頭到尾，沒答買家是誰。 {#L099}

**早坂茜**：對。這條留到審查會再追。 {#L100}

**相馬律**：他一直摺那張名片。還有眼鏡，一直往下滑。 {#L101}

**早坂茜**：你連這個都記著。 {#L102}

**相馬律**：不是記著。我見過他。第一場審查會後，走廊上被警員攔著問話的，就是這個人。 {#L103}

**早坂茜**：那天他就在那裡了。鏈補齊了，走。 {#L104}

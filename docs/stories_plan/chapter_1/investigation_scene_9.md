# Scene 9: 北見修一調查 — 外包鏈入口

- **Summary:** 相馬沿著臨時工單與增田留下的備忘追到北見修一，確認他持有當夜的外包憑證，也正因資料盜賣與帳號審查承受壓力。

## Intro

[場景：KAGAMI 外包資料審查辦公室，白日。玻璃窗口前放著一份限定調閱回函，檔案櫃排在後方。]
- **Background Prompt:** KAGAMI contractor records review office in daylight before the records handoff, glass service window, file cabinets, limited-scope reply packet on the counter, bureaucratic restraint, no readable text.
- **BGS:** bgs_contractor_office_day

[相馬律與早坂茜走進 KAGAMI 的外包資料審查辦公室，黑瀨徹已在窗口前等他們。]

**相馬律**：這地方，連椅子都不讓人久坐。

**早坂茜**：撐著點。拿到工單，那個空位才有名字可以填。

**相馬律**：從昨晚到現在，那格一直空著。

**早坂茜**：今天把它填上。黑瀨刑警，說吧。

**黑瀨徹**：我以現場刑警的身份，向承包商提了協力請求。

**黑瀨徹**：他們只肯給後場門鎖那一段，22:50 到 23:10。

**相馬律**：我們不能自己進承包商的資料庫翻嗎？

**早坂茜**：不能。那不是律師私下翻得到的東西。

**早坂茜**：我是憑審查會確認過的那幾條矛盾，正式申請調的。

**早坂茜**：所以拿到的，只有跟那扇門鎖有關的工單。

## Sub-location: 承包商資料窗口 {#contractor_desk}
- **Status:** unlocked
- **Background Prompt:** KAGAMI contractor records office service window in daylight, glass partition, file cabinets, limited-scope reply packet on desk, bureaucratic restraint, no readable text.
- **BGS:** bgs_contractor_office_day

[場景：KAGAMI 外包資料審查辦公室／承包商聯絡窗口，白日，玻璃隔板後一排檔案櫃，桌上攤著一份限定範圍的調閱回函。]

[一名承包商主管把回函推到桌面中央，神情公事公辦。中年男人，袖口磨得發白，表情像是做好了份內的事就不再多走一步的那種人。]

**承包商主管**：就這些。後場門鎖，22:50 到 23:10，超出範圍的我不能給。

**早坂茜**：夠了。我們要的就是這一段。

[相馬律的視線越過窗口，掃過辦公室側牆。一塊白板上用磁鐵壓著幾排日期——合約更新截止、帳號回收日、臨時識別證交接排程，紅筆圈住的日期一路排到下個月底。]

[長椅上坐著三四個人，手裡各捏一張臨時識別證，等著交回。一個人在簽到板上劃掉自己的名字，筆尖頓了一下才補上離場時間。]

[承包商主管朝長椅那側偏了偏下巴，頭也沒抬。]

**承包商主管**：權限過期就不能進系統。人也一樣，到期就走流程。

[相馬律的目光在那塊白板上停了一拍，沒有說話，只是把領口往內收了一下。]

**相馬律**：……這種地方，待久了會記得自己只是暫時的。

**早坂茜**：他們的排程跟我們無關。回函拿到了，看裡面。

### Hotspot: 臨時維護工單 {#workorder}
- **Description:** 回函資料包最上面那張，當晚臨時排定的後場門鎖維護工單。
- **Evidence Source:** visible
- **Scene Source Prompt:** Contractor reply packet folder open on the service-window counter, top sheet a temporary maintenance work order with doorlock icon and clipped approval stamp shape; no readable text.
- **Reveals:** [evidence:temp_maintenance_workorder]

[相馬律把翹起的紙角壓平，又把歪掉的訂書針撥回正。]

**早坂茜**：你一緊張，就先整理東西。

**相馬律**：手不動，腦子更亂。

**早坂茜**：那就先讓手忙著。腦子留給正事。

### Hotspot: 外包維護權限名單 {#access_permission_list}
- **Description:** 回函資料包裡，那晚能動用該憑證的外包維護權限名單。
- **Evidence Source:** visible
- **Scene Source Prompt:** Contractor access-permission list page from the reply packet on the counter, rows of codes with one highlighted row and keycard symbol, names and codes unreadable.
- **Reveals:** [evidence:kitami_external_access]

[相馬律把名單翻到背面，指腹停在打孔的紙邊。]

**相馬律**：以前做協力的時候，這種表一厚，我就會忘記人長什麼樣。

**早坂茜**：那今天別忘。先把人看清楚，再說別的。

### Hotspot: 資材包清單 {#material_kit_list}
- **Description:** 回函資料包裡，外包維護資材包的內容清單。
- **Evidence Source:** visible
- **Scene Source Prompt:** Contractor material-kit list page from the reply packet on the counter, one row showing a transparent umbrella sleeve item icon, labels unreadable.
- **Reveals:** [evidence:contractor_umbrella_sleeve_match]

[透明傘套的邊角沾著一點潮氣。窗口一開，雨聲就順著玻璃縫鑽進來。]

**相馬律**：雨鐘打烊以後，也是這種聲音。

**早坂茜**：那間店的雨聲，比這裡有人情味。

**相馬律**：這裡連傘套都被收得很整齊。

### Hotspot: 玻璃隔板上的雨水 {#window_rain_glass}
- **Description:** 承包商窗口的玻璃隔板，雨水在玻璃上拖成一道道細長的水痕。

[玻璃隔板上，雨水順著表面往下爬，在半途匯成一條較粗的水線，把後方檔案櫃的輪廓糊開。]

**相馬律**：……從這邊看過去，那邊只剩影子。

[一陣風從門縫帶進什麼，甜的，一下就被辦公室的冷氣壓平了。相馬律的手停在紙頁邊上，沒有翻。]

**早坂茜**：看資料，不要看雨。

**相馬律**：……嗯。

### Character: 承包商主管 {#contractor_clerk}
- **Role:** KAGAMI 外包資料審查窗口承辦人
- **Bio:** 中年男人，袖口磨得發白。做好了份內的事就不再多走一步的那種人。

#### Topic: 另一個 K {#other_k_name}
- **Status:** unlocked

[相馬律指著名單上另一行 K 開頭的編號。]

**相馬律**：這一個呢？那晚也在名單上。

[承包商主管瞟了一眼，翻了翻手邊一本小冊子。]

**承包商主管**：這個上週就到期了。臨時識別證交回，憑證停用。

**承包商主管**：那晚他進不來。

**早坂茜**：所以那晚能動這組憑證的，還是只剩北見那一組。

**承包商主管**：我只照規矩給名單。誰是誰，你們自己判。

**相馬律**：……是條死路。

**早坂茜**：記著，別再繞回來。

##### On Reexamine

[承包商主管把小冊子合上。]

**承包商主管**：我說過了，那個上週到期。

#### Topic: 你這張桌子 {#clerk_long_day}
- **Status:** unlocked

[相馬律的目光落在主管袖口那圈磨白的縫線上。]

**相馬律**：你今天也待了很久。

**承包商主管**：這窗口開到五點。我到點就走。

**承包商主管**：二十年了，都是這張桌子。

[他把回函資料包往相馬那側再推了半寸，動作很輕。]

**承包商主管**：資料給你了。剩下的不在我份內。

**早坂茜**：……謝謝。我們看資料就好。

### Hotspot: 前往質問北見 {#to_confront}
- **Status:** locked
- **Unlock:** evidence:temp_maintenance_workorder collected and evidence:kitami_external_access collected and evidence:contractor_umbrella_sleeve_match collected
- **Description:** 北見修一已被請到隔壁的訪談室，可以過去當面問。
- **Reveals:** [sublocation:confront_kitami]

[相馬律把三份材料疊齊，手指在公事包的搭扣上停了一下。]

**早坂茜**：手冷？

**相馬律**：沒有。

**早坂茜**：那就別逞強。進去之後少搶話。

## Sub-location: 質問北見 {#confront_kitami}
- **Status:** locked
- **Background Prompt:** Small white interview room under exposed fluorescent tubes, forensic printouts spread on table, plain walls, restrained office pressure, no readable document text.
- **BGS:** bgs_interview_room_fluorescent

[場景：訪談室，白日。日光燈照得無處可藏；窄室四面白牆，桌上攤著死者手機鑑識列印件。北見修一坐在對面，攥著摺痕很深的名片：眼鏡下滑，他每隔幾秒以中指推回，一張習慣在職場被忽略的臉。]

[黑瀨徹把那批鑑識列印件，一頁頁鋪開在桌上，紙張滑過桌面的聲音在安靜的房間裡格外清晰。]

**黑瀨徹**：死者手機的鑑識，這一批我按證物鏈固定過了。

**黑瀨徹**：跟之前那則手機通知，是同一批裡的。

### Hotspot: 增田未送出備忘 {#unsent_memo}
- **Description:** 鑑識列印件裡，一則增田始終沒送出的備忘。
- **Evidence Source:** visible
- **Scene Source Prompt:** Forensic printout of Masuda's unsent phone memo spread on the interview-room table, with the memo rows present but unreadable.
- **Reveals:** [evidence:masuda_unsent_memo]

[相馬律拿起那頁列印件，唸出上面短短三行。]

**相馬律**：「22:50 雨鐘。校驗值確認。K。」

**早坂茜**：22:50 是備忘裡約的時間和地點，不是維護開啟。

**早坂茜**：維護開是 22:52。兩件事別混。

**相馬律**：所以增田知道那場碰面有風險，在等一個跟校驗值有關的人。

**早坂茜**：對。但光這則備忘，定不了北見。得跟工單、憑證、那個 K 一起看。

### Hotspot: 增田檢舉草稿與附件 {#whistleblower_draft}
- **Description:** 監察信箱草稿匣裡，增田沒送出的檢舉草稿與未完成的異常存取整理表。
- **Evidence Source:** visible
- **Scene Source Prompt:** Forensic printout packet with an unsent whistleblower draft and attached abnormal-access table spread on the interview-room table, no readable text.
- **Reveals:** [evidence:masuda_whistleblower_draft, evidence:kitami_data_theft_record]

[相馬律翻開那份草稿，注意到結尾還空著。]

**相馬律**：是檢舉草稿。沒送出，只躺在監察信箱的草稿匣。

**早坂茜**：沒送出，就還沒走完程序。光一份草稿，證不了資料怎麼流出去的。

[相馬律往草稿後面翻，停在一張沒做完的表。]

**相馬律**：後面還附了一張異常存取整理表，沒做完。

[相馬律順著表上的紀錄，一行行往下看。]

**相馬律**：北見的帳號，好幾次在排程外接觸試點資料。

**相馬律**：有一部分，匯到一個外部傳輸載體上。

**早坂茜**：到買家是誰，這張表還沒證到。

**早坂茜**：但足夠說，北見有盜賣資料的嫌疑了。

[北見聽到這裡，在椅子上微微換了個姿勢，肩膀往內縮了一點，手指又把那張名片的摺痕抹平了一次。]

**北見修一**：他不該把那份草稿留下。

### Character: 北見修一 {#kitami}
- **Role:** KAGAMI 外包維護人員
- **Bio:** 受合約審查壓力的外包系統維護工。那晚的臨時工單與外包憑證指向他的帳號。

#### Topic: 名片與否認 {#card_denial}
- **Status:** unlocked

[北見摘下眼鏡，拿衣角擦了擦，又戴回去，避開相馬的視線。]

**相馬律**：那組外包憑證，那晚是你動的。

**北見修一**：規則從來不是寫給我們這種人看的。

[他說這句話的時候聲音裂了一下，兩手擱在桌上不動了，名片被壓在掌下。]

[北見低頭，又把那張摺痕很深的名片抹平。]

**相馬律**：那資料，最後賣給了誰？

[北見的手指頓了一下，沒接這句，只是又去抹名片。]

**早坂茜**：他不答「買家是誰」。記著這條，別讓他繞過去。

#### Topic: 當夜壓力 {#night_pressure}
- **Status:** unlocked

[北見的肩膀垮了下來，整個人像被抽掉了什麼支撐，聲音壓得很低。]

**相馬律**：那晚到底是什麼，把你逼到動手？

**北見修一**：增田已經把那份草稿，存進監察信箱的草稿匣了。

**北見修一**：我那組外包帳號，隔天就要面對合約審查、憑證收回。

**相馬律**：所以只要檢舉一送出，那些異常存取就會被翻出來。

**北見修一**：我只是想在被換掉之前，留一點退路。

[他把那張摺痕很深的名片又對摺了一次，紙角已經起了毛邊。]

**早坂茜**[stern]：壓力講夠了。盜賊就是盜賊，審查再急也不改這件事。

#### Topic: 早班 {#early_shift}
- **Status:** unlocked

[北見又推了一下眼鏡，中指在鏡架上停了一拍。]

**相馬律**：你看起來沒睡。

**北見修一**：……我另一個早班四點開始。跟這件無關。

[北見說完後低下頭，拇指沿著名片折痕來回抹了一下。]

**相馬律**：這條線跑了多久？

**北見修一**：八年。都是這種排法。

**北見修一**：合約一到期就重簽，年資歸零。八年跟八天一樣。

**相馬律**：沒想過換？

**北見修一**：換了也是另一份外包。到哪都一樣。

**早坂茜**：你的班表不是這裡要處理的事。

**早坂茜**：名字對上了，就先對著名字走。

##### On Reexamine

[北見沒有再接話，只是又把名片摺痕抹平了一次。]

**北見修一**：……沒什麼好說的了。

## Evidence Manifest

### evidence:temp_maintenance_workorder {#temp_maintenance_workorder}
- **Name:** 臨時維護工單
- **Description:** 案發當晚臨時排定的後場門鎖維護工單。
- **Details:** 工單標的是後場那扇門鎖，底下對應一組外包維護憑證。工單本身只證明那晚排了一次臨時維護，還要再對到憑證、對到人。
- **Source Sublocation:** contractor_desk
- **Image Prompt:** Temporary maintenance work order sheet with a doorlock icon and clipped approval stamp shape, all fields unreadable, isolated evidence icon.

#### On Collect

**相馬律**：那晚臨時排了一張維護工單。

**早坂茜**：工單對得上憑證，但人還沒對上。

### evidence:kitami_external_access {#kitami_external_access}
- **Name:** 北見外包維護權限
- **Description:** 外包維護權限名單裡，那晚能動用該憑證的人。
- **Details:** 名單上 K 開頭的承包商不只一個，編碼也相近。但把那晚的臨時工單和那組外包憑證一起對，能動用的只落在北見修一身上。這是北見的名字第一次對到具體的人。
- **Source Sublocation:** contractor_desk
- **Image Prompt:** Contractor access-permission list with one highlighted row and keycard symbol, names and codes unreadable, isolated evidence icon.

#### On Collect

**相馬律**：工單加憑證，只落在一個人身上。

**早坂茜**：北見修一。名字第一次對到了人。

### evidence:contractor_umbrella_sleeve_match {#contractor_umbrella_sleeve_match}
- **Name:** 承包商資材包傘套來源比對
- **Description:** 資材包清單裡的透明傘套，與後場那只濕傘套的來源比對。
- **Details:** 資材包傘套的尺寸與摺痕和後場牆角的濕傘套一致，卻比地上半乾水痕新；它不能單獨定罪或辨認更早進場者，只留承包商資材在此路線上的時間與動線脈絡。要對到人，仍須臨時維護工單和外包憑證。
- **Source Sublocation:** contractor_desk
- **Image Prompt:** Transparent umbrella sleeve comparison card with two matching sleeve silhouettes and fold marks, no readable labels, isolated evidence icon.

#### On Collect

**相馬律**：資材包這只傘套，尺寸和摺痕都對得上後場那只。

**早坂茜**：但那只是較晚的雨水。它只留在動線脈絡裡。

**早坂茜**：更早進來的是誰，還得看工單和憑證。

### evidence:masuda_unsent_memo {#masuda_unsent_memo}
- **Name:** 增田未送出備忘
- **Description:** 死者手機鑑識裡，一則沒送出的純文字備忘。
- **Details:** 備忘只有三行：「22:50 雨鐘。校驗值確認。K。」22:50 是備忘裡約定的時間地點，不是維護開啟（維護開是 22:52）。它證明增田知道這場碰面有風險，在等一個跟校驗值有關的人，但光這則不能定北見，要跟工單、憑證、那個 K 一起看。
- **Source Sublocation:** confront_kitami
- **Image Prompt:** Unsent phone memo printout with three short blurred rows and a folded corner, all text unreadable, isolated evidence icon.

#### On Collect

**相馬律**：「22:50 雨鐘。校驗值確認。K。」

**早坂茜**：他在等一個跟校驗值有關的人。但這還不足以定罪。

### evidence:masuda_whistleblower_draft {#masuda_whistleblower_draft}
- **Name:** 增田檢舉草稿
- **Description:** 監察信箱草稿匣裡，一份沒送出的檢舉草稿。
- **Details:** 草稿沒送出，只躺在監察信箱的草稿匣，程序還沒走完。它記著北見有異常存取，但光一份草稿，證不了資料是怎麼流出去的。增田本來帶了 USB，想當場比對買家鏈校驗值的最後一段。
- **Source Sublocation:** confront_kitami
- **Image Prompt:** Unsent whistleblower draft document in a folder with attachment tab shapes, all paragraphs unreadable, isolated evidence icon.

#### On Collect

**相馬律**：是檢舉草稿，沒送出。

**早坂茜**：光一份草稿，證不了資料怎麼流出去。

[黑瀨徹從增田的個人物品袋裡取出一支隨身碟，另裝進證物袋，壓好封條。]

**黑瀨徹**：這支另編，送鑑識。

### evidence:kitami_data_theft_record {#kitami_data_theft_record}
- **Name:** 北見資料盜賣紀錄
- **Description:** 檢舉草稿附件裡那張沒完成的異常存取整理表。
- **Details:** 表上記著北見的帳號多次在排程外接觸試點資料，有一部分匯到外部傳輸載體。它還沒證到最終買家是誰，但足夠顯示北見有盜賣資料的嫌疑，構成這一晚的動機與壓力來源。
- **Source Sublocation:** confront_kitami
- **Image Prompt:** Incomplete abnormal-access spreadsheet printout with external-transfer arrow shapes and highlighted rows, all entries unreadable, isolated evidence icon.

#### On Collect

**相馬律**：排程外接觸試點資料，還匯到外部載體。

**早坂茜**：買家是誰還沒證到，但盜賣的嫌疑成立了。

## Outro

[相馬律把工單、憑證、備忘、草稿一份份疊好，望向桌對面的北見。]

**相馬律**：那個一直空著的第三人座位，現在能對到一個名字了。

**相馬律**：北見修一。臨時工單和外包憑證，先把名字對上。

**相馬律**：備忘裡的那個 K，這樣才能收口。

**相馬律**：傘套只留在動線脈絡裡。

**早坂茜**：身份對上了。動機和當夜的壓力，也都站住了。

**相馬律**：剩下的，就交給最後的審查會。

**早坂茜**：對。材料齊了。我們去把這條鏈，當著所有人講清楚。

[相馬律把疊好的文件收進公事包，扣上搭扣，聲音在安靜的走廊裡很清脆。]

**相馬律**：他從頭到尾，沒答買家是誰。

**早坂茜**：對。這條留到審查會再追。

**相馬律**：他一直摺那張名片。還有眼鏡，一直往下滑。

**早坂茜**：你連這個都記著。

**相馬律**：不是記著。是他在怕。怕的人，才會把東西摺成那樣。

**早坂茜**：怕不怕，不影響證據。鏈補齊了，走。

# Scene 9: 北見修一調查 — 外包鏈入口

## Intro

[場景：KAGAMI 外包資料審查辦公室，白日。玻璃窗口前放著一份限定調閱回函，檔案櫃排在後方。]
- **Background Prompt:** KAGAMI contractor records review office in daylight before the records handoff, glass service window, file cabinets, limited-scope reply packet on the counter, bureaucratic restraint, no readable text.

[相馬律與早坂茜走進 KAGAMI 的外包資料審查辦公室，黑瀨徹已在窗口前等他們。]

**黑瀨徹**：我以現場刑警的身份，向承包商提了協力請求。

**黑瀨徹**：他們只肯給後場門鎖那一段，22:50 到 23:10。

**相馬律**：我們不能自己進承包商的資料庫翻嗎？

**早坂茜**：不能。那不是律師私下翻得到的東西。

**早坂茜**：我是憑審查會確認過的那幾條矛盾，正式申請調的。

**早坂茜**：所以拿到的，只有跟那扇門鎖有關的工單。

## Sub-location: 承包商資料窗口 {#contractor_desk}
- **Status:** unlocked
- **Background Prompt:** KAGAMI contractor records office service window in daylight, glass partition, file cabinets, limited-scope reply packet on desk, bureaucratic restraint, no readable text.

[場景：KAGAMI 外包資料審查辦公室／承包商聯絡窗口，白日，玻璃隔板後一排檔案櫃，桌上攤著一份限定範圍的調閱回函。]

[一名承包商主管把回函推到桌面中央，神情公事公辦。中年男人，袖口磨得發白，表情像是做好了份內的事就不再多走一步的那種人。]

**承包商主管**：就這些。後場門鎖，22:50 到 23:10，超出範圍的我不能給。

**早坂茜**：夠了。我們要的就是這一段。

### Hotspot: 臨時維護工單與權限名單 {#workorder}
- **Description:** 回函裡那晚的臨時維護工單，與外包維護人員權限名單一起對照。
- **Evidence Source:** visible
- **Scene Source Prompt:** Contractor reply packet on the desk with temporary maintenance work order and access permission list as source documents, no readable text.
- **Reveals:** [evidence:temp_maintenance_workorder, evidence:kitami_external_access]

[相馬律翻開那張工單，順著欄位看下去。]

**相馬律**：那晚臨時排了一張維護工單，就是後場那扇門。

**相馬律**：工單底下對應一組外包維護憑證。

**早坂茜**：先記著。工單對得上憑證，但還沒對上人。

[相馬律把工單上的憑證編號，逐一比對權限名單。]

**相馬律**：名單上 K 開頭的承包商不只一個，編碼也很像。

**早坂茜**：所以光看編碼會錯。要工單加憑證一起對。

[相馬律的手指停在其中一行，指腹壓住紙面沒有移開。]

**相馬律**：那晚的工單、那組憑證……兩邊一起，只落在一個人身上。

**相馬律**：北見修一。

**早坂茜**：第一次，名字對到了人。

[她把桌面上的紙頁往自己那側收攏了半寸，目光沒有離開那個名字。]

**早坂茜**：別急著定罪，先把材料補齊。

### Hotspot: 資材包透明傘套 {#material_kit}
- **Description:** 窗口附上的一份資材包清單，裡頭有一只透明傘套。
- **Evidence Source:** visible
- **Reveals:** [evidence:contractor_umbrella_sleeve_match]

[相馬律把資材包清單裡的傘套，跟手上後場那只濕傘套的尺寸對著看。]

**相馬律**：資材包這只傘套，尺寸跟後場牆角那只濕傘套一樣。

**相馬律**：連摺痕的位置都對得上。

**早坂茜**：傘套只能說，先進來的那個人走的是承包商這條線。

**早坂茜**：要對到某一個人，還是得靠那張臨時工單和外包憑證。

### Hotspot: 前往質問北見 {#to_confront}
- **Description:** 北見修一已被請到隔壁的訪談室，可以過去當面問。
- **Reveals:** [sublocation:confront_kitami]

[相馬律把三份材料疊齊，望向隔壁那扇門。]

**相馬律**：工單、憑證、傘套，都指著同一個人。

**早坂茜**：那就去聽他自己怎麼說。

## Sub-location: 質問北見 {#confront_kitami}
- **Status:** locked
- **Background Prompt:** Small white interview room under exposed fluorescent tubes, forensic printouts spread on table, plain walls, restrained office pressure, no readable document text.

[場景：訪談室，白日，日光燈管把一切照得毫無死角。窄小的房間，四面白牆，桌上攤開一批死者手機鑑識的列印件。北見修一坐在對面，手裡攥著一張摺痕很深的名片。四十出頭，身形中等偏軟，穿著樣板式的商務便裝——那種設計上就是為了不讓人記住的款式。一副金屬框眼鏡，鏡架滑下來一點，他每隔幾秒就用中指推回去。一張在職場上習慣被忽略的人的臉。]

[黑瀨徹把那批鑑識列印件，一頁頁鋪開在桌上，紙張滑過桌面的聲音在安靜的房間裡格外清晰。]

**黑瀨徹**：死者手機的鑑識，這一批我按證物鏈固定過了。

**黑瀨徹**：跟之前那則手機通知，是同一批裡的。

### Hotspot: 增田未送出備忘 {#unsent_memo}
- **Description:** 鑑識列印件裡，一則增田始終沒送出的備忘。
- **Evidence Source:** visible
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

**北見修一**：我只是一個被外包系統壓著走的人。

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

**早坂茜**：是合約和審查的壓力。不是什麼別的東西在背後逼他。

## Evidence Manifest

### evidence:temp_maintenance_workorder {#temp_maintenance_workorder}
- **Name:** 臨時維護工單
- **Description:** 案發當晚臨時排定的後場門鎖維護工單。
- **Details:** 工單標的是後場那扇門鎖，底下對應一組外包維護憑證。工單本身只證明那晚排了一次臨時維護，還要再對到憑證、對到人。
- **Image Prompt:** Temporary maintenance work order sheet with a doorlock icon and clipped approval stamp shape, all fields unreadable, isolated evidence icon.

#### On Collect

**相馬律**：那晚臨時排了一張維護工單。

**早坂茜**：工單對得上憑證，但人還沒對上。

### evidence:kitami_external_access {#kitami_external_access}
- **Name:** 北見外包維護權限
- **Description:** 外包維護權限名單裡，那晚能動用該憑證的人。
- **Details:** 名單上 K 開頭的承包商不只一個，編碼也相近。但把那晚的臨時工單和那組外包憑證一起對，能動用的只落在北見修一身上。這是北見的名字第一次對到具體的人。
- **Image Prompt:** Contractor access-permission list with one highlighted row and keycard symbol, names and codes unreadable, isolated evidence icon.

#### On Collect

**相馬律**：工單加憑證，只落在一個人身上。

**早坂茜**：北見修一。名字第一次對到了人。

### evidence:contractor_umbrella_sleeve_match {#contractor_umbrella_sleeve_match}
- **Name:** 承包商資材包傘套來源比對
- **Description:** 資材包清單裡的透明傘套，與後場那只濕傘套的來源比對。
- **Details:** 資材包傘套的尺寸與摺痕，跟後場牆角那只濕傘套一致。它單獨不能定罪，只能把那個更早進場的人，從一般客人推向承包商這條線；要對到某一個人，還得靠臨時工單和外包憑證。
- **Image Prompt:** Transparent umbrella sleeve comparison card with two matching sleeve silhouettes and fold marks, no readable labels, isolated evidence icon.

#### On Collect

**相馬律**：資材包這只傘套，尺寸和摺痕都對得上後場那只。

**早坂茜**：只能把先進來的那個人，推向承包商這條路。

### evidence:masuda_unsent_memo {#masuda_unsent_memo}
- **Name:** 增田未送出備忘
- **Description:** 死者手機鑑識裡，一則沒送出的純文字備忘。
- **Details:** 備忘只有三行：「22:50 雨鐘。校驗值確認。K。」22:50 是備忘裡約定的時間地點，不是維護開啟（維護開是 22:52）。它證明增田知道這場碰面有風險，在等一個跟校驗值有關的人，但光這則不能定北見，要跟工單、憑證、那個 K 一起看。
- **Image Prompt:** Unsent phone memo printout with three short blurred rows and a folded corner, all text unreadable, isolated evidence icon.

#### On Collect

**相馬律**：「22:50 雨鐘。校驗值確認。K。」

**早坂茜**：他在等一個跟校驗值有關的人。但這還不足以定罪。

### evidence:masuda_whistleblower_draft {#masuda_whistleblower_draft}
- **Name:** 增田檢舉草稿
- **Description:** 監察信箱草稿匣裡，一份沒送出的檢舉草稿。
- **Details:** 草稿沒送出，只躺在監察信箱的草稿匣，程序還沒走完。它記著北見有異常存取，但光一份草稿，證不了資料是怎麼流出去的。增田本來帶了 USB，想當場比對買家鏈校驗值的最後一段。
- **Image Prompt:** Unsent whistleblower draft document in a folder with attachment tab shapes, all paragraphs unreadable, isolated evidence icon.

#### On Collect

**相馬律**：是檢舉草稿，沒送出。

**早坂茜**：光一份草稿，證不了資料怎麼流出去。

### evidence:kitami_data_theft_record {#kitami_data_theft_record}
- **Name:** 北見資料盜賣紀錄
- **Description:** 檢舉草稿附件裡那張沒完成的異常存取整理表。
- **Details:** 表上記著北見的帳號多次在排程外接觸試點資料，有一部分匯到外部傳輸載體。它還沒證到最終買家是誰，但足夠顯示北見有盜賣資料的嫌疑，構成這一晚的動機與壓力來源。
- **Image Prompt:** Incomplete abnormal-access spreadsheet printout with external-transfer arrow shapes and highlighted rows, all entries unreadable, isolated evidence icon.

#### On Collect

**相馬律**：排程外接觸試點資料，還匯到外部載體。

**早坂茜**：買家是誰還沒證到，但盜賣的嫌疑成立了。

## Outro

[相馬律把工單、憑證、備忘、草稿一份份疊好，望向桌對面的北見。]

**相馬律**：那個一直空著的第三人座位，現在能對到一個名字了。

**相馬律**：北見修一。臨時工單、外包憑證、傘套、備忘裡的那個 K，全收口在他身上。

**早坂茜**：身份對上了。動機和當夜的壓力，也都站住了。

**相馬律**：剩下的，就交給最後的審查會。

**早坂茜**：對。材料齊了。我們去把這條鏈，當著所有人講清楚。

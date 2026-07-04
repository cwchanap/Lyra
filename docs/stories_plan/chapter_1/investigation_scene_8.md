# Scene 8: 本機順序與第三者進入

## Intro

[場景：雨鐘咖啡館後場，夜晚。店長辦公角落亮著暖燈，牆邊維護螢幕待機。]
- **Background Prompt:** Rain Bell cafe backroom at night near the manager office corner, warm practical lamp, maintenance screen idle on the wall, stacked boxes and account books, quiet procedural tension, no readable UI text.
- **BGS:** bgs_cafe_backroom_office

[相馬律與早坂茜回到雨鐘咖啡館後場，店長高瀨在角落等他們。]

[深夜的後場只剩牆邊那盞暖燈，空氣比白天調查時更悶。相馬律把濕了一層的外套搭在椅背上，揉了一下眼睛。]

**相馬律**：又回來了。從早上撐到現在，眼睛有點花。

**相馬律**：白天看的是表面，這次得把那扇門固定下來。

**早坂茜**：程序我接。黑瀨刑警說鑑識待會到，先把店長那段問清楚。

[高瀨從後方走近，手裡緊握著手機，指節發白，像猶豫了很久才過來。]

**店長高瀨**：我剛才一直在想，那天晚上我為什麼會進那麼裡面。

**早坂茜**：維護紀錄冊？

**店長高瀨**：對。然後我想起來，那晚我拍過維護頁。不是因為案子，是怕隔天門又卡住。

[她把手機握得更緊，目光落在地上。]

**店長高瀨**：如果這張早點拿出來，三宅是不是就不用坐那麼久？

**早坂茜**：截圖不能直接救人。但它可以讓我們知道該固定哪裡。

**黑瀨徹**：手機給我看，不收。面板還在，就拍面板。

**店長高瀨**：早坂律師、相馬先生，我想到一件事。

**店長高瀨**：那天晚上，後場那扇門其實一直在維護模式。

**相馬律**：維護模式？

**店長高瀨**：我手機裡有一張當晚拍的截圖，也許用得上。

[早坂茜放下記事本，神情謹慎。]

**早坂茜**：先看看那頁面記了什麼。

## Sub-location: 店長辦公角落 {#office_corner}
- **Status:** unlocked
- **Background Prompt:** Cafe manager office corner near the backroom, small maintenance screen on wall, stacked boxes and account books, warm practical light, no readable UI text.
- **BGS:** bgs_cafe_backroom_office

[場景：店長辦公角落，後場門鎖維護頁顯示在牆邊一台小螢幕上，旁邊堆著紙箱與帳本，燈光偏暖。]

[高瀨把手機遞過來，又指了指牆邊的維護頁。]

**店長高瀨**：我只是想證明那扇門當時在維護，沒別的意思。

### Hotspot: 店長手機截圖 {#phone_screenshot}
- **Description:** 店長當晚拍下的維護頁截圖，列著幾條事件紀錄。
- **Reveals:** [sublocation:fixed_panel]

[相馬律接過手機，放大那張截圖。]

**相馬律**：上面有四條紀錄。

**相馬律**：Event-1841，維護模式開啟。

**相馬律**：Event-1842，外部維護憑證，後門開啟。

**相馬律**：Event-1843，員工憑證，後走廊開啟。

**相馬律**：Event-1844，維護同步完成。

[早坂茜湊近看，眉頭微皺。]

**早坂茜**：只有事件先後，沒有幾點幾分。

**早坂茜**：連使用者全名都沒有。

**相馬律**：那這張截圖能算數嗎？

**早坂茜**：截圖本身不行。得讓鑑識把那面板正式固定下來。

### Hotspot: 堆疊的帳本 {#stacked_ledgers}
- **Description:** 辦公角落疊著幾本厚帳本，封皮磨得發毛，看得出這間店用好幾年了。

[相馬律的目光掃過那疊帳本，停在早坂茜身上。]

**相馬律**：你也從早上站到現在。

**早坂茜**：別管我。你眼下的青色比這些帳本還深。

**相馬律**：……等收工再說。

**早坂茜**：嗯。收工再說。

### Hotspot: 前場方向的傘架 {#front_umbrella_stand}
- **Description:** 從後場辦公角落望出去，能隱約看見前場門邊那座傘架。

[相馬律的視線穿過走廊，落在前場門邊的傘架上。那把藍色透明傘還插在那裡，沒人來收。]

[他的目光在那把藍傘上停了一下，又收回來，沒有說話。]

**早坂茜**：先別管它。跟我們手上的案子對不上。

[空氣裡淡淡飄著金木犀拿鐵的甜香，混進後場悶悶的紙箱味。]

**相馬律**：這間店，甚麼時候都聞得到這股甜味。

**早坂茜**：招牌拿鐵。先看面板。

### Character: 店長高瀨 {#takase}
- **Role:** 雨鐘咖啡館店長
- **Bio:** 經營這家咖啡館的普通店家，不是工程師，平常只負責看門有沒有關好。

#### Topic: 維護頁怎麼看 {#how_she_reads}
- **Status:** unlocked
- **Reveals:** [evidence:maintenance_mode_note]

**相馬律**：店長，這頁面平常你都怎麼看？

**店長高瀨**：我平常只看這頁確認門有沒有卡住、維護模式有沒有關掉。

**店長高瀨**：我不知道它不能拿來判斷幾點幾分有人進門。

[高瀨有些不好意思地搓了搓手。]

**店長高瀨**：所以之前一直沒提，是我疏忽了。

**早坂茜**：不是疏忽。這頁本來就不是給你判斷時間用的。

#### Topic: 還沒歇嗎 {#still_on_her_feet}
- **Status:** unlocked

**相馬律**：店長，你從早上撐到現在，都沒坐下？

**店長高瀨**：這間店是我扛起來的，總不能這時候丟著。

**店長高瀨**：……其實腿早就軟了。只是不想在你們面前坐下。

**相馬律**：沒關係。先靠一下也好。

**店長高瀨**：等鑑識那邊收完再說。

#### Topic: 紀錄順序能不能改 {#panel_edit_suspicion}
- **Status:** unlocked

**相馬律**：店長，這頁的事件順序，有沒有可能被人動過？

[高瀨愣了一下，手指無意識地絞著圍裙帶。]

**店長高瀨**：我……我不會動那個。我只會看門卡不卡。

**店長高瀨**：你們是覺得，是我改的？

**早坂茜**：她連這頁能判斷時間都不知道。

**早坂茜**：要重排這種紀錄，得碰得到設備本身，不是手機拍一張就能改。

**相馬律**：……也是。順序是機器自己存的。

**店長高瀨**：我開店十年，從沒碰過那台機器的設定。

## Sub-location: 保全鏈固定 {#fixed_panel}
- **Status:** locked
- **Background Prompt:** Same maintenance panel being formally photographed and logged, detective paperwork on table, plain evidence-chain setup, hard practical light, no readable text.
- **BGS:** bgs_cafe_backroom_office

[場景：同一面板，鑑識重新拍攝固定，黑瀨徹站在一旁監督，桌上攤著一份正式紀錄表。]

[黑瀨徹把手機截圖推回給相馬律，搖了搖頭。]

**黑瀨徹**：截圖我不收。要用，就讓鑑識把它固定下來。

### Hotspot: 程序固定紀錄表 {#fixed_record}
- **Description:** 桌上攤開的鑑識固定紀錄表，記著本機事件順序與外包憑證那一列。
- **Evidence Source:** visible
- **Scene Source Prompt:** Formal photographed and logged doorlock panel paperwork spread on the table as the visible source document bundle, including the local event sequence and external credential row, with no readable final text.
- **Reveals:** [evidence:local_sequence_record, evidence:external_maintenance_credential]

[相馬律翻開那份正式紀錄表。]

**相馬律**：設備、機身、畫面時間，都登記在案。

**相馬律**：底下才是 Event-1841 到 1844 的本機順序。

**黑瀨徹**：手機那張只是線索。這份才是能進審查會的材料。

[早坂茜把紀錄表抄進記事本。]

**早坂茜**：記住，這是本機自己存的順序，不是 KAGAMI 的完整原始紀錄。

[相馬律用筆尖點著紀錄表上的兩條事件。]

**相馬律**：Event-1842 是外包憑證，後門開。

**相馬律**：Event-1843 才是三宅的員工憑證。

**相馬律**：外包這條，排在三宅前面。

[相馬律抬起頭，語氣急了一點。]

**相馬律**：那就是兇手吧？增田在等的那個外包的人。

**早坂茜**：別跳。你還沒把那張外包憑證，對到一個人。

**早坂茜**：現在只能說，有一個外部憑證的事件，比三宅早。

**相馬律**：那摘要上那個 23:07:50 呢？

**早坂茜**：那不是本機這頁原本存下來的秒數。

**早坂茜**：它可能跟之後的合併或補時有關，但現在還不能下結論。

**相馬律**：所以也不能說 KAGAMI 造假？

**早坂茜**：對。沒有原檔被改，只有摘要的讀法可能錯。

### Character: 黑瀨徹 {#kurose}
- **Role:** 現場刑警
- **Bio:** 負責現場與證物鏈的刑警，做事粗但守程序。

#### Topic: 截圖為什麼不夠 {#why_not_screenshot}
- **Status:** unlocked

**相馬律**：刑警，店長那張截圖到底差在哪？

**黑瀨徹**：截圖只是個線索。誰都能拍，誰都能裁。

**黑瀨徹**：保全鏈固定的紀錄，從設備到畫面時間都有人簽字背書。

[黑瀨徹敲了敲那份正式紀錄表。]

**黑瀨徹**：審查會看的是這個，不是手機相簿。

## Evidence Manifest

### evidence:local_sequence_record {#local_sequence_record}
- **Name:** 本機順序程序固定紀錄
- **Description:** 鑑識依程序固定的後場門鎖面板紀錄，含本機事件順序。
- **Details:** 含門鎖設備 ID、機身編號、頁面版本號與當前畫面時間，底下是 Event-1841 至 1844 的本機順序，只有先後，沒有秒數。這是本機自己存的順序，不是 KAGAMI 的完整原始紀錄。
- **Source Sublocation:** fixed_panel
- **Image Prompt:** Formal doorlock panel sequence record with four ordered event blocks, device-photo strip, unreadable fields, isolated evidence icon.

#### On Collect

**相馬律**：這份是程序固定過的，能進審查會。

**早坂茜**：但它只是本機順序，別當成完整原檔。

### evidence:maintenance_mode_note {#maintenance_mode_note}
- **Name:** 維護模式說明
- **Description:** 店方對這頁維護面板的使用認知說明。
- **Details:** 店長只用這頁確認門有沒有卡住、維護模式有沒有關掉。這頁不能用來判斷幾點幾分有人進門，店方也不知道它有這個限制。
- **Source Sublocation:** office_corner
- **Image Prompt:** Plain maintenance-mode instruction note beside a small doorlock screen icon, check symbols implied but unreadable, isolated evidence icon.

#### On Collect

**相馬律**：原來店裡只拿這頁看門有沒有關好。

**早坂茜**：所以這頁告訴你的，只有門卡沒卡、模式關沒關。

### evidence:external_maintenance_credential {#external_maintenance_credential}
- **Name:** 外包維護憑證
- **Description:** 本機順序裡那條排在員工憑證之前的外部維護憑證事件。
- **Details:** Event-1842，外部維護憑證、後門開啟，排在三宅的員工憑證 Event-1843 之前。目前只知道有這麼一個外部憑證的事件，還沒對應到任何一個人。
- **Source Sublocation:** fixed_panel
- **Image Prompt:** External maintenance credential event card with keycard silhouette and ordered event row, all codes unreadable, isolated evidence icon.

#### On Collect

**相馬律**：外部憑證，排在三宅前面。

**早坂茜**：先別填名字。我們只證明了有第三方的事件。

## Outro

[相馬律合上記事本，望向那面已被固定下來的面板。]

**相馬律**：所以那晚，三宅進門之前，已經有一個外部憑證開過後門。

**早坂茜**：對。第三者的事件成立了。

**相馬律**：可是我們還不知道那是誰。

**早坂茜**：身份未定。下一步，才是把這個事件對到一個人。

**早坂茜**：鑑識還在收這邊。我們先回警署等，順便把目前手上的東西理一理。

[相馬律點頭，把記事本收進外套內袋。兩人沿著後巷走出雨鐘。]

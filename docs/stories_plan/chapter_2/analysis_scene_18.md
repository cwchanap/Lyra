# Scene 18: 人物板

- **Summary:** 案發第四日夜裡，相馬與早坂把今天帶回來的紀錄，一張一張放到它說明的那件事下面，看清楚誰有入口、誰有理由，又有誰只是碰不到這條路。

## Intro

[場景：相馬律的偵探事務所，案發第四日晚上九點左右。細雨從白天下到現在，窗玻璃上的水痕一道一道往下爬，對面大樓只剩零星幾扇亮著的窗。辦公桌上一盞檯燈亮著，桌面攤滿今天拍下的照片和列印紙，角落那台老咖啡機仍舊停擺。]
- **Background Prompt:** Eye-level medium-wide night view of the same small cluttered Tokyo private detective office seen in the earlier night analysis scene, at about nine in the evening during a steady light rain, used as the quiet working backdrop for the case's people-and-records sorting analysis; a large window on the left with half-open blinds, its glass beaded and streaked with running rain, looking out on a dark night skyline of mid-rise buildings with a few scattered lit windows and no street visible, a potted plant in the far left corner and two cardboard archive boxes on the floor under the window; focal area on the worn dark desk in the centre under a single warm articulated desk lamp pool, covered with unreadable printouts, printed photographs and a few torn strips of paper tape, an open laptop and a leather folio among them; a tall bookshelf of binders behind the desk; on the right a door with a frosted glass panel and a coat rack beside it holding two dark charcoal folded umbrellas over a small drip tray, and a side cabinet holding the old drip coffee machine with its carafe empty and dry beside a small electric kettle, a whiteboard leaning on the cabinet; polished dark floor with a few water drops near the door; warm lamp pool against cool dark window light, quiet tired working mood, no people, no blue umbrellas, lower third kept as plain desk edge and floor for dialogue UI, no readable text, no UI overlay, neo-noir visual novel background.
- **BGM:** bgm_city_summary_motif
- **BGS:** bgs_detective_office_night

**旁白**：案發第四日，晚上九點。

[兩人前後腳進門。早坂把傘掛上衣架，傘尖在小托盤裡滴出一圈水。]

**早坂茜**：鞋子裡面也是濕的。

**相馬律**：今天走的路，比昨天多一倍。

**早坂茜**：晚飯那間咖哩店，你說「很快」。

**相馬律**：是很快。妳只用了十分鐘就吃完了。

**早坂茜**：因為你一直看錶。

[相馬在椅子上坐下，把濕透的鞋跟在地板上輕輕磕了兩下。他的視線又飄向角落的咖啡機。]

**相馬律**：要是它——

**早坂茜**：不能用。

**早坂茜**：現在九點。到明天上午十一點，還剩十四個小時。

**相馬律**：十四個。剛好夠寫一份申請，睡兩個小時。

**早坂茜**：兩個小時，是你的。我的那份，要另外算。

[相馬把今天拍下的照片、黑瀨給的副本，一份一份攤到桌上。早坂撕下一段長長的紙膠帶，貼在桌面正中央。]

**相馬律**：今天看了三個地方的紀錄。真白的抽屜，事務所的製作手冊，贊助商的回函。

**早坂茜**：全擺出來，也只是一桌紙。

**相馬律**：所以要分。

**相馬律**：誰能濫用這條路，又有理由在那一晚動手？一張一張來。

**早坂茜**：先把每張紀錄寫了什麼，唸清楚。再放。

[她在紙膠帶上，貼出四個空位。]

## Board: 人物板 {#people_board}

- **Kind:** classify
- **Prompt:** 誰能濫用這條路，又有理由在那一晚動手？把每一張紀錄，放到它說明的那件事下面。
- **Reveals:** [assert_fact:hasumi_had_access_motive_and_control]
- **Incomplete Feedback:** 九張卡都要放進其中一欄。
- **Incorrect Feedback:** 至少有一張放錯了。再唸一次每張卡寫的事：它說的是誰能打開這條路、她想離開的理由、她已經交出去的東西，還是三枝碰不到的地方？
- **Hint:** 先問這張紀錄說明的是「路」、是「她想走」、是「她留下了什麼」，還是「三枝」。

### Card: 申請是誰送的 {#sr2307_sender}

- **Source:** evidence:sr2307_submission_record
- **Summary:** 贊助商回覆警方：SR-2307 在案發前一日 21:12，從系統的「經紀窗口」帳號送出，這個帳號登記在蓮見透名下。十五分鐘通行碼，只發到送出帳號登記的手機。

### Card: 流程通道名單 {#process_channel}

- **Source:** evidence:process_channel_roster
- **Summary:** 活動製作手冊的一頁：贊助模式專用的「流程通道」，能按鍵說話的只有導播的對講和經紀人；主播的耳麥只能聽、不能回。

### Card: 第一個回報 {#first_report}

- **Source:** evidence:incident_comms_log
- **Summary:** 00:03:58，經紀人回「人在背面安全位，我去接」，cue sheet 註記「經紀人處理中」。00:13:20 助理導播呼叫經紀人，沒有回覆；蓮見 00:33 才回到轉播車。

### Card: 三年的收益對照表 {#revenue_table}

- **Source:** evidence:mashiro_revenue_table
- **Summary:** 抽屜資料夾裡的紙本：真白把三年來平台付給事務所的分潤，和事務所轉給她的金額，一個月一個月對齊；三十六個月，每個月都差了將近四成。只有紙本，不在共用雲端裡。

### Card: 退出事務所的訊息 {#exit_message}

- **Source:** evidence:mashiro_exit_message
- **Summary:** 案發前三天 23:12，真白傳給蓮見：「玻璃箱做完，我想離開事務所。這次我想自己決定。」23:40，蓮見回：「辛苦了。等這次結束，我們再坐下來談。」

### Card: 會計師委任書 {#accountant}

- **Source:** evidence:accountant_engagement
- **Summary:** 案發前兩天的委任書：委託外部會計師核對過去三年的分潤與轉帳，結果只交給真白本人。後面釘著同日寄出帳目影本的宅配存根。

### Card: 排好的聲明 {#scheduled_statement}

- **Source:** evidence:backup_account_scheduled_statement
- **Summary:** 備用帳號裡的排程貼文，發文時間是直播結束一週後的中午，內文開頭是「我是如月真白。這篇是我自己寫、自己排的……」。這個帳號不歸事務所管理，登入的裝置只有她自己的兩支手機。

### Card: 三枝窗外的大樓 {#saegusa_window}

- **Source:** evidence:saegusa_studio_window
- **Summary:** 從三枝工作室的窗戶望出去，隔著一條窄巷和幾棟矮樓，就是那棟商業大樓，上面幾層暗著。這只是從窗內看得到的距離，沒有記錄任何路線或出入。

### Card: 三枝的權限查核 {#saegusa_no_key}

- **Source:** evidence:saegusa_access_check
- **Summary:** 黑瀨向活動方、贊助商與大樓查核：三枝沒有贊助商系統的帳號，不在活動的通行證名冊上，不在任何耳麥頻道上，大樓也沒有他的卡。

### Group: 入口與控制 {#entry_and_control}

- **Description:** 打開那條路、能在她耳邊說話、讓前場以為一切照流程。
- **Accepted Cards:** [sr2307_sender, process_channel, first_report]

### Group: 她要離開，帳也對不上 {#wanted_to_leave}

- **Description:** 她想走，而且已經看出帳不對。
- **Accepted Cards:** [revenue_table, exit_message]

### Group: 她已經交出去、蓮見收不回來的事 {#cannot_take_back}

- **Description:** 她留下的安排，在她離開以後，事務所也撤不掉。
- **Accepted Cards:** [accountant, scheduled_statement]

### Group: 三枝：可疑，卻碰不到這條路 {#saegusa_cannot_reach}

- **Description:** 這個人惹人懷疑，可是他和那條路之間，沒有一把鑰匙。
- **Accepted Cards:** [saegusa_window, saegusa_no_key]

### Result Dialogue

[紙膠帶下面，四欄卡片排得整整齊齊。早坂用筆尾，從最左邊那一欄，一張一張點過去。]

**早坂茜**：入口那一欄。申請從蓮見的帳號送出，通行碼發到他的手機，流程通道上能開口的只有兩個位置。

**早坂茜**：第一個說「人在背面安全位」的，也是蓮見。

**相馬律**：她要離開，帳也對不上。兩樣都有她自己的字，有她自己算出來的數目。

**早坂茜**：委任書和排程聲明，是她早就送出去的。

**早坂茜**：會計師手上那一份，他拿不回來；備用帳號裡那一則，他撤不掉。

[相馬看向最右邊，那兩張寫著三枝的卡。]

**相馬律**：三枝的工作室，看得見那棟樓。可是看得見，不等於走得進去。

**相馬律**：查核結果，他一把鑰匙也沒有。

**早坂茜**：他在網路上嘴巴很壞，這點沒有人替他洗掉。

**相馬律**[determined]：三枝有惡意；蓮見有入口、路線、動機和控制權。

[早坂把四欄的卡片，各夾上一個夾子。她的筆尾停在紙膠帶的邊緣。]

**早坂茜**：可是這九張卡，一句都沒寫七樓上說了什麼。

**相馬律**：沒有。也沒有寫是誰動的手。

**早坂茜**：入口、理由、位置。到這裡為止。

**相馬律**：到這裡為止。

[相馬拿起出席表的影本，指尖停在最下面。真白的簽名旁邊，畫著一個小小的笑臉。]

**相馬律**：她簽名的時候，還信那張說明會的流程。也信那個人。

**早坂茜**：嗯。

[相馬把影本放回卷宗，沒有再說下去。]

## Outro

[相馬把夾好的卡片疊齊，收進卷宗夾。早坂把筆電拉到面前，打開一份空白文件。]

**早坂茜**：書面申請，我來寫。

**相馬律**：妳今晚要寫完？

**早坂茜**：寫完，檢查，送出。截止還有十二個多小時，我不想等到最後一刻。

**相馬律**：我能做什麼？

**早坂茜**：把卡片的編號，照順序念給我。

**相馬律**：好。第一張。

[窗外的雨聲沒有停。早坂起身走到櫃子旁，打開電熱水壺的開關，水很快就響起來。]

**早坂茜**：茶要濃一點。

**相馬律**：我來泡。

**早坂茜**：你泡過一次，水比茶多。

**相馬律**：……那一次是意外。

[她把杯子推到桌角，回到鍵盤前，敲下第一行字。雨還在下，水壺的蒸氣在檯燈的光裡慢慢散開。]

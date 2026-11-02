# Scene 13: 誰在看什麼

- **Summary:** 案發第三日夜裡，相馬與早坂把桌上這幾道說「看見她」的視線和每一路畫面，照實際看著的東西重新分欄，也看清哪些紀錄現在還不能拿去審查會上用。

## Intro

[場景：相馬律的偵探事務所，案發第三日晚上九點左右。雨在上午停了，窗玻璃上的水痕還沒乾，窗外對面大樓亮著零星的燈。辦公桌上一盞檯燈亮著，桌面攤滿列印紙、現場照片和手寫便條，角落那台老咖啡機仍舊停擺。]
- **Background Prompt:** Eye-level medium-wide night view of a small cluttered Tokyo private detective office on an upper floor, at about nine in the evening after the rain has stopped, used as the quiet working backdrop for evidence-sorting analysis; a large window on the left with half-open blinds, its glass still streaked with leftover rain, looking out on a dark night skyline of mid-rise and high-rise buildings with scattered lit windows and no street visible, a potted plant in the far left corner and two cardboard archive boxes on the floor under the window; focal area on the worn dark desk in the centre under a single warm articulated desk lamp pool, covered edge to edge with a long row of unreadable printouts plus printed photographs and handwritten notes, an open laptop and a leather folio among them; a tall bookshelf with binders behind the desk; on the right a door with a frosted glass panel and a coat rack beside it, and a side cabinet on the far right holding the old drip coffee machine with its carafe empty and dry, a whiteboard leaning on the side cabinet; polished dark floor; warm lamp pool against cool dark window light, quiet tired working mood, no people, no blue umbrellas, lower third kept as plain desk edge and floor for dialogue UI, no readable text, no UI overlay, neo-noir visual novel background.
- **BGM:** bgm_city_summary_motif
- **BGS:** bgs_detective_office_night

[兩人前後腳進門。相馬把舊皮卷宗夾放到桌角，整個人陷進椅子裡，兩條腿往前伸直。]

**相馬律**：我的腳，不像是我的。

**早坂茜**：你在廣場站了一個下午，還在側巷又站了快半個小時。

**相馬律**：妳連站多久都記？

**早坂茜**：我記期限。順便記你。

[她把肩背包放到另一張椅子上。]

**相馬律**：晚飯那間，我挑得不錯吧。

**早坂茜**：湯我喝完了。這是最高評價。

**相馬律**：那我收下。

**早坂茜**：現在九點。到後天上午十一點，還剩三十八個小時。

**相馬律**：妳連這個也算好了。

**早坂茜**：你只算證物，總得有人算時間。

[相馬的視線飄向角落的咖啡機，又收回來。]

**相馬律**：要是它能用，我現在想來一杯。

**早坂茜**：你現在喝咖啡，今晚就別想睡了。

[相馬坐直，從卷宗夾裡抽出一疊卡片，攤到桌上。]

**相馬律**：吉祥寺那次，我們分的是紀錄從哪裡來。

**早坂茜**：這次呢？

**相馬律**[determined]：人到底站在哪裡。看的是箱、牆，還是別人的畫面。

**相馬律**：審查會上，對方第一句一定是：幾萬個人都看見她在箱子裡。

**早坂茜**：好。先從桌上這幾道說「看見了」的視線和鏡頭開始。

[她把第一排卡片推到桌面正中央。]

## Board: 視線板 {#sightline_board}

- **Kind:** classify
- **Prompt:** 這幾道說「看見她」的視線和鏡頭，各自真正看著什麼、拍到什麼？把它放進對的那一欄。
- **Reveals:** [assert_fact:crowd_watched_the_wall]
- **Incomplete Feedback:** 每一道視線和鏡頭都要放進其中一欄。
- **Incorrect Feedback:** 至少有一道放錯了。再想想那一刻，看的人或鏡頭站在哪裡、眼前是什麼。
- **Hint:** 先問：看的人或鏡頭站在哪裡？它和玻璃箱之間，隔著什麼？

### Card: 廣場上的觀眾 {#crowd_on_plaza}

- **Source:** evidence:sponsor_mode_signboard
- **Summary:** 燈光調暗時，看板和口播都請大家「看主螢幕」。

### Card: 戶川手機拍到的畫面 {#togawa_phone}

- **Source:** evidence:togawa_video_position_check
- **Summary:** 從她拍攝的位置，右側玻璃斜映著直播牆；手機拍到的畫面裡，最清楚的身影和倒影的位置重疊。她親眼看見什麼，這段影片說不出來。

### Card: 轉播車門邊的監看螢幕 {#control_monitors}

- **Source:** evidence:program_composite_label
- **Summary:** 轉播車門邊的監看螢幕，角落標著「Program Composite / Sponsor Mode」。

### Card: 平台上的觀眾 {#platform_viewers}

- **Source:** evidence:platform_archive_rule
- **Summary:** 平台保存的，是觀眾在平台上看到的那一路節目輸出，整晚沒有中斷。

### Card: 在家看直播的三枝 {#saegusa_at_home}

- **Source:** statement:saegusa_watched_until_cut
- **Summary:** 他說他在家用副螢幕看她的直播，看到斷為止；說她十幾分鐘一動不動。

### Card: 側巷裡的柚木 {#rider_in_alley}

- **Source:** statement:rider_side_view_account
- **Summary:** 從那道窄縫只看得到箱子的側面、看不到螢幕；他說椅子上那個人「不像人在動」。

### Group: 看的是牆 {#watched_the_wall}

- **Description:** 視線被導向直播牆，或是鏡頭拍到最清楚的，是牆在玻璃上的倒影。
- **Accepted Cards:** [crowd_on_plaza, togawa_phone]

### Group: 看的是別人送出來的畫面 {#watched_a_feed}

- **Description:** 中間隔著一路節目輸出；他看到的，是導播台送出來的那一路。
- **Accepted Cards:** [control_monitors, platform_viewers, saegusa_at_home]

### Group: 看的是箱子本身 {#saw_the_box}

- **Description:** 中間沒有牆，也沒有別人的畫面，視線直接落在箱子上。
- **Accepted Cards:** [rider_in_alley]

### Result Dialogue

**相馬律**：群眾沒有集體說謊。他們只是被安排去看同一面牆。

**早坂茜**：那箱子本身呢？有誰是直接看著它的？

**相馬律**：這幾張裡，目前只有一道，直接落在箱子上。

**早坂茜**：巷子裡的柚木。

**相馬律**：他說，椅子上那個人，不像人在動。

**早坂茜**：他說不出準確的時間，也沒看見別的。

**相馬律**：所以只記到這裡。他沒說的，我不替他補。

**早坂茜**：好。下一塊，平台，和轉播車門邊那台監看螢幕。

## Board: 畫面板 {#footage_board}

- **Kind:** classify
- **Prompt:** 平台上的畫面、轉播車門邊的監看螢幕、保存下來的節目輸出，是箱子本身嗎？把每份紀錄，放進它真正說明的那一層。
- **Unlock:** analysis_board:chapter_2@analysis_scene_13@sightline_board completed
- **Reveals:** [assert_fact:footage_is_not_direct_box_observation]
- **Incomplete Feedback:** 七份紀錄都要放進其中一層。
- **Incorrect Feedback:** 至少有一份紀錄放進了不屬於它的那一層。
- **Hint:** 先問這份紀錄有沒有經過導播台；沒經過的，再問它是整晚留在箱子裡，還是只剩碎片。

### Card: 監看畫面標籤 {#composite_label}

- **Source:** evidence:program_composite_label
- **Summary:** 轉播車門邊那台監看螢幕的角落，標著「Program Composite / Sponsor Mode」；切進贊助段後，標籤一直沒變。

### Card: 贊助模式音訊路由 {#audio_routing}

- **Source:** evidence:sponsor_audio_routing
- **Summary:** 贊助模式期間，主播的麥克風從節目輸出切掉；節目音訊只剩贊助音樂與預錄旁白。

### Card: 平台保存規則 {#archive_rule}

- **Source:** evidence:platform_archive_rule
- **Summary:** 平台保存的是節目輸出那一路；整晚連續保存，沒有中斷。

### Card: 箱內手機資料座 {#phone_dock}

- **Source:** evidence:mashiro_phone_dock
- **Summary:** 手機在說明會後放進箱內，整個直播期間一直插在桌上的資料座。

### Card: 投影輪廓板 {#silhouette_board}

- **Source:** evidence:projection_silhouette_board
- **Summary:** 贊助商的投影道具，照靜默挑戰的坐姿裁成剪影；設備商說，它跟著投影升起，投影整段關掉才降下。

### Card: 原始信號短時緩存 {#raw_buffer}

- **Source:** evidence:raw_buffer_rule
- **Summary:** 每路鏡頭的原始信號只留約十分鐘、滾動覆寫；轉播端的事故鎖，到凌晨近三點才按下。

### Card: 後台流出短片 {#leaked_clip}

- **Source:** evidence:staff_leaked_clip
- **Summary:** 第二手轉貼的七秒後場短片，拍不到任何一張臉；沒有原檔，也沒有時間碼。

### Group: 送出去的那一路是合成的 {#program_feed}

- **Description:** 轉播車門邊標著 Program Composite 的監看畫面、轉播車保存下來的那一路、平台上的那一路，都是導播台送出去的節目輸出：合成的畫面，加上贊助的音訊。
- **Accepted Cards:** [composite_label, audio_routing, archive_rule]

### Group: 整晚都留在箱子裡的東西 {#stayed_in_box}

- **Description:** 不論她當時在不在，它們整晚都在箱子裡；所以位置只說明物件，證明不了人。
- **Accepted Cards:** [phone_dock, silhouette_board]

### Group: 沒經過合成的，只剩碎片 {#raw_fragments}

- **Description:** 繞過節目輸出的原始東西，不是已經被覆寫，就是只剩二手的一小段。
- **Accepted Cards:** [raw_buffer, leaked_clip]

### Result Dialogue

**相馬律**[determined]：影像是真的。但不是那一刻箱內的直接觀測。

[早坂拿出四張便條紙，各寫一份還沒到手的紀錄，貼在板子邊緣，沒有放進任何一欄。]

**早坂茜**[stern]：可是這些，現在還不能全拿去審查會上用。

**相馬律**：柚木的正式筆錄，副本照程序，還沒到我們手上。

**早坂茜**：外送平台的訂單確認，也還沒回。

**相馬律**：戶川的原檔，警方固定了，副本還沒到。

**早坂茜**：那七秒短片沒有原檔，還是線索。

**相馬律**：黑瀨刑警那句話，到哪裡都一樣：要用，走正規。

**早坂茜**：那就一張一張走。

## Outro

[相馬把筆記本裡那張現場視線圖翻出來，壓在檯燈底下。]

**相馬律**：留白的兩塊。

**早坂茜**：側巷那個邊角，有柚木站過了。

**相馬律**：但那塊要等正式筆錄的副本到了，才補得上去。

**相馬律**：另一塊是箱子背面的後場。還是空的。

**早坂茜**：那就從後場開始。明天。

**相馬律**：不知道的，就留著是不知道。

**早坂茜**：那是我的台詞。

[相馬揉了揉眼睛。早坂低頭看了一眼手機。]

**早坂茜**：十點半了。回家，睡覺。

**相馬律**：再看一遍就走。

**早坂茜**：你已經看三遍了。

**相馬律**：第四遍可能會看出什麼。

**早坂茜**：第四遍只會讓你看出黑眼圈。卷宗放桌上，明早它還在。

[她把肩背包甩上肩膀，順手把相馬面前兩張沒對齊的卡片推齊。]

**相馬律**：妳這是在照顧我？

**早坂茜**[softened]：老理由。避免搭檔倒在證據桌上。

**相馬律**[relieved]：……那我先回去睡。

**早坂茜**：這句我會記下來。

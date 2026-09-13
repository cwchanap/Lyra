# 東京雨證：區域地圖美術交接

> 配套：[設計規格](../../superpowers/specs/2026-09-12-regional-city-maps-design.md)／[實作計畫](../../superpowers/plans/2026-09-12-regional-city-maps-implementation-plan.md)。
> 本頁是五張獨立底圖的構圖、節點與驗收規格，不是另一份故事 Bible 或 runtime location registry。

## 交付狀態與使用方式

本 draft 已準備以下五區的完整美術 brief。對話中的總覽、澀谷示意與五區拼板是視覺參考；**不能把概念拼板裁成低解析正式資產**。

新圖應逐張獨立產出。圖檔在對話交付與圖檔已進 GitHub 是不同狀態：只有實際出現在 PR diff 的 PNG 才算已匯入。這份文件列出的正式路徑是目標，不保證檔案目前存在；不要先修改 production topology 指向尚未匯入的圖。

| 地圖 | 目標 assetId | 目標正式檔案 | 故事用途 |
| --- | --- | --- | --- |
| 東京總覽（沿用已選方向，另行校圖） | `background.city_map.tokyo` | `static/assets/backgrounds/city_map/tokyo.png` | 跨區定位、既有未分區目的地 |
| 吉祥寺 | `background.city_map.kichijoji` | `static/assets/backgrounds/city_map/kichijoji.png` | Chapter 1 地圖接線 |
| 澀谷 | `background.city_map.shibuya` | `static/assets/backgrounds/city_map/shibuya.png` | Chapter 2 設計準備／fixture |
| 新宿 | `background.city_map.shinjuku` | `static/assets/backgrounds/city_map/shinjuku.png` | Chapter 4 外部街區 |
| 歌舞伎町 | `background.city_map.kabukicho` | `static/assets/backgrounds/city_map/kabukicho.png` | Chapter 5 外部街區 |
| 銀座／港區 | `background.city_map.ginza_minato` | `static/assets/backgrounds/city_map/ginza_minato.png` | Chapter 3 跨街區交通示意 |

五區各一張，不另生成五套日夜版本。總覽不是第六張全新 region，也不是一張 giant playable map。

## 共用風格與輸出契約

延續對話已選的雨夜動畫城市美術：grounded anime neo-noir、斜俯視、手繪背景質感、可辨識而非寫實 GIS 的街區、冷藍灰天空與濕路面、克制霓虹、少量暖窗光。各區必須有不同輪廓，不能只是五張換色高樓圖。

每張圖都是 **single standalone wide 16:9 background plate**，不是概念展示板。目標為不透明 RGB PNG、1920 × 1080，依 `static/assets/config/policy.yaml` 正規化；保留原始生成檔，不拉伸不同長寬比例。圖片若需裁切，先檢查核心建築與 anchor 都仍在。

不要文字、地名、招牌字樣、logo、水印、數字、章號、UI 面板、按鈕、pin、引線、路徑箭頭、compass、可辨識前景角色、屍體、藍傘符號、秘密設施標記。商業看板可有抽象圖像與色塊，不能烘焙可讀文案。

不要把城市畫成漂浮小島；道路與街塊應有連續地面。霧氣只用在遠處，不遮蔽主要行人路與建築邊界。主要構圖在 8%～92% 的安全區；頂部／底部適度留低資訊帶給遊戲 UI，但不能加假的框架。

以下位置百分比是**生成構圖目標區，不是已量測的 runtime 座標**。收到圖後以實際門口／地標重新量測；只有核對過的數值才進 `city_map.json`。

## 1. 吉祥寺 / kichijoji

### 視覺身份

暖色低層商店街，被樹木、住宅與車站包圍。讀圖順序為：雨鐘咖啡館 → 商店街 → 車站／綠地。不要高樓霓虹壓過咖啡館，也不要把咖啡館畫成巨大地標宮殿。

### 構圖與節點

| 元素 | 構圖目標 | 互動身份 |
| --- | --- | --- |
| 雨鐘咖啡館 | 左中，約 x=0.32、y=0.55；暖窗、單一明確入口、小尺度轉角店 | 既有 `rain_bell_cafe` |
| 吉祥寺商店街 | 中右，約 x=0.59、y=0.58；連續屋簷與步行街 | 既有 `kichijoji_shopping_street` |
| 車站及鐵道 | 右上／遠側，橫向交通骨架 | 裝飾，這次不新增 destination |
| 綠地及小水面 | 左上，作低層生活區記憶點 | 裝飾，非新增調查公園 |
| 後巷 | 咖啡館附近可辨識一般街巷 | 不画出 L 型倉庫內部或嫌疑人動線 |

相馬事務所、警署、外包分室與審查室不因本圖生成而搬進吉祥寺；保留 topology 的未分區直接目的地。

### 獨立生成 brief

> Create one standalone wide 16:9 anime neo-noir district map background of a quiet Kichijoji-inspired Tokyo neighborhood at rainy blue hour, in the same elevated three-quarter illustrated city style as the supplied Tokyo map references. Low-rise residential blocks and a coherent shopping street sit on continuous ground. A modest warm-lit corner cafe is clearly readable in the left-middle foreground, with an unobstructed entrance; the shopping street extends toward the center-right. Put a small commuter station and elevated rail at the far upper-right and a restrained tree-lined park with a small pond at upper-left. Wet street reflections, amber windows, slate-blue roofs, mature Japanese animation background painting, detailed but edited for navigational clarity. Keep the cafe human-scaled and spatially distinct. No readable text, labels, UI, map markers, logos, route arrows, foreground characters, hidden-room cutaways or mystery clues. This is a full background plate, not a collage or an overview of all Tokyo.

## 2. 澀谷 / shibuya

### 已有參考與變更

已檢視對話的 `rainy_neon_shibuya_cityscape.png`：左側曲面大螢幕、中央偏左廣場、後側鐵路、右側商業樓與外部工作區是延續錨點。

必要調整：原圖的玻璃箱近似容納群眾的玻璃建築；新圖要改成**廣場上的人尺度透明直播 booth**，觀眾在箱外。保留美術方向，不照搬錯誤尺度。取消戲劇化透視電梯井與過度清楚的秘密連通暗示。

### 構圖與節點

| 元素 | 構圖目標 | 審查限制 |
| --- | --- | --- |
| 大螢幕 | 左中，約 x=0.27、y=0.33，面向觀眾區 | 與玻璃箱是兩個不同物體 |
| 玻璃箱廣場 | 中央偏左，約 x=0.46、y=0.57 | 箱體只佔廣場小部分，觀眾在外 |
| 控制室外部／工作區 | 廣場右後，約 x=0.63、y=0.47 | 外觀可見，內部內容未知 |
| 天橋／側巷 | 廣場兩側或後側 | 不加視線錐、不提前判斷誰看見什麼 |
| 商業大樓及普通服務入口 | 右側，約 x=0.76、y=0.61 | 不透視空置樓層、M-03 或電梯井 |

Chapter 2 Phase A 的五個核心點、Phase B 的外側視角與 Phase C 的人物／後勤資訊仍由 `chapter_2_plan.md` 控制。內部樓層可以在案件資料／building context 內表達，不能為了把 17 個名詞都塞圖上而增加主線地點負擔。

### 獨立生成 brief

> Create one standalone wide 16:9 Shibuya district map plate, matching the supplied rainy anime Shibuya reference in palette, elevated three-quarter view and landmark arrangement. Retain the large curved LED building to the left, an open event plaza slightly left of center, elevated rail in the rear, and commercial buildings with an ordinary external service yard to the right. Crucially replace the enormous glass pavilion with a small human-scale transparent livestream booth on a low event platform; a sparse tiny audience remains OUTSIDE the booth. The screen is a separate, much larger city landmark. Keep public paving, side streets and a pedestrian bridge readable, with warm shopfronts and restrained cyan-violet light. Do not show building interiors, elevator shafts, hidden corridors, suspicious paths or evidence. No readable text, labels, pins, UI, chapter numbers, logos, foreground characters or collage. Continuous urban ground, no floating island.

## 3. 新宿 / shinjuku

### 視覺身份

冷白、安靜的診所街區嵌在繁忙都市中。新宿高樓是背景識別，診所是人尺度的中景建築；不要畫成大型醫院園區或 sci-fi 實驗堡壘。

### 構圖與節點

| 元素 | 構圖目標 | 身份 |
| --- | --- | --- |
| 記憶治療診所外觀 | 中右，約 x=0.60、y=0.55，三至數層的低中層建築、入口雨棚 | 視覺提案，尚無 production anchor |
| 接近診所的街道 | 中央至前景，轉角與人行道清楚 | 普通外部動線，不是新 clue |
| 交通入口／小廣場 | 左下或左中，與診所間隔一段街廓 | 裝飾；不加額外可玩地點 |
| 高樓群 | 遠側上半部 | 固定區域辨識，壓低亮度 |

接待區、病房、資料室、舊治療室屬案件內部空間，不畫成四棟獨立可見設施。精確樓層及相鄰關係等待 chapter design 核定。

### 獨立生成 brief

> Create one standalone wide 16:9 Shinjuku-inspired district map background for a grounded anime detective visual novel. Elevated three-quarter city view at rainy blue hour. A quiet, modest multi-story medical clinic occupies the center-right of an ordinary urban block, with a recognizable covered entrance, cool-white lobby glow and a small planted forecourt. Tall Shinjuku-like towers recede behind mid-rise apartments; a clear public approach street and a small transit entrance sit toward the left foreground. Use slate blue, restrained white light, a few amber residential windows and wet pavement. The clinic must feel ordinary and human-scaled, not a giant hospital campus or futuristic laboratory. Exterior only: no ward cutaways, exposed records rooms, secret passages, symbols or clue props. No readable text, UI, labels, pins, arrows, logos, foreground characters or collage.

## 4. 歌舞伎町 / kabukicho

### 視覺身份

劇場立面與窄街形成核心。少量紅紫霓虹、暖色入口與冷色後巷對照，但不是滿版高飽和夜店街。

### 構圖與節點

| 元素 | 構圖目標 | 身份 |
| --- | --- | --- |
| 劇場公共入口 | 中央偏右，約 x=0.57、y=0.54，醒目的 marquee 但無字 | 未來 Chapter 5 外部目的地提案 |
| 公共商業街 | 前景橫向／斜向街道 | 導航空間，不新增支線 |
| 普通後勤入口及後巷 | 劇場右側，約 x=0.76、y=0.47 | 可有普通 service door，不揭露犯罪機關 |
| 屋頂、鄰樓及餐飲店 | 外圈 | 讓劇場嵌在新宿的連續都市，而非獨立城市 |

舞台、觀眾席、道具間、升降台夾層不在區域圖透視；不把關鍵路線畫在地面、不加九十秒倒數或藍傘。

### 獨立生成 brief

> Create one standalone wide 16:9 Kabukicho theater-neighborhood map plate in the same grounded rainy anime neo-noir style. Elevated three-quarter view of a compact continuous Tokyo nightlife block. A distinctive medium-sized theater with a blank elegant illuminated marquee and warm public entrance is the center-right focal point; narrow public streets, modest restaurants and layered vertical neon color shapes surround it. An ordinary unhighlighted service alley and door run along its right side. Restrained burgundy and violet accents against blue-gray rooftops and rain reflections; clearly distinct from the giant-screen Shibuya district. Show exterior urban geography only, no cutaway stage, backstage machinery, bodies, evidence or secret route. No readable text, labels, UI, pins, clocks, chapter badges, logos, foreground characters or collage.

## 5. 銀座／港區 / ginza_minato

### 視覺身份

左側整齊商業街、右侧現代高樓與遠處灣岸；一條清楚主幹道形成構圖連接。此為跨街區的壓縮示意，不是精確行車路線證據。

### 構圖與節點

| 元素 | 構圖目標 | 身份 |
| --- | --- | --- |
| 銀座商業大道 | 左半，約 x=0.29、y=0.56 | Chapter 3 場景方向，精確上下車點未核定 |
| 連續主幹道 | 中央向右上／右中延伸 | 美術連接，不帶箭頭／時間 |
| 港區高樓群 | 右半，約 x=0.72、y=0.48 | 區域識別，非已知目的地清單 |
| 高架道路與遠處塔形地標 | 背景 | 幫助辨識，不宣稱真實交通拓撲 |
| 水岸 | 最右遠景小面積 | 不把整個地區切成島嶼 |

不新增秘書公司、嫌疑人住處、醫院或精確拋棄點。具體節點必須由 Chapter 3 場景 authoring 確定，不能從生成圖片反推案件事實。

### 獨立生成 brief

> Create one standalone wide 16:9 Ginza-and-Minato-inspired regional map plate for a grounded anime neo-noir Tokyo detective game. Elevated three-quarter rainy blue-hour view on continuous land. Elegant ordered mid-rise shopping blocks and broad pedestrian pavements on the left contrast with modern office towers on the right; a clear ordinary boulevard connects the two visual districts, with a restrained elevated road in the background. A small distant orange lattice-tower silhouette and a narrow far-right waterfront establish the metropolitan mood without turning the city into islands. Cool silver-blue city light, warm commercial windows, wet reflections, realistic urban density edited for readability. No highlighted vehicle, crime route, arrows, scale bar, timestamps, labels, readable shop signs, UI, pins, logos, foreground characters or collage. This is a compressed illustrated district map, not accurate GIS.

## 驗收與匯入記錄

收到每張圖後逐項記錄：原檔名、原尺寸、正規化方法、輸出 SHA-256、正式路徑、實際量測 anchor、是否已在 PR diff。

- 原生尺寸不足時可正規化，但不能聲稱是原生 4K；保持長寬比。
- 五張圖必须分別檢視，不只看 contact sheet。檢查最主要建築、入口、路面連通與無文字要求。
- 圖片通過不等於座標通過：需要在實際 16:9 plane 上 overlay 既有 destination，測試長 label 與窄視窗。
- 東京總覽與 region 採藝術性壓縮，不要求像素級 zoom 接縫；用短 crossfade 切圖，不實作假裝地理連續的巨大攝影機飛行。
- 正式匯入前移除多餘候選與拼板；保留選定 PNG 及必要 provenance，不擴大成資產版本管理系統。

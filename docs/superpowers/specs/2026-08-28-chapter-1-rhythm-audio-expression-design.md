# Chapter 1 Rhythm, Audio, and Portrait Expression Design

**日期：** 2026-08-28  
**範圍：** 第 1 章《雨鐘咖啡館殺人事件》  
**交付方式：** 單一 PR  
**狀態：** 實作前設計鎖

## 1. 目標

本次調整不重寫案件真相、證據鏈或程序規則，而是修正玩家實際體感：

1. 讓正式主案在遊戲開始後約 10～12 分鐘內進入 KAGAMI 冷開場。
2. 讓章節明確經歷「日常 → 壓力 → 敗北 → 喘息 → 追索 → 突破 → 指認 → 餘韻」的節奏換檔。
3. 把 BGM 從目前三首擴充成七種可辨識的情緒狀態，但不替每個場景獨立作曲。
4. 讓主要人物在關鍵情緒轉折時有可見表情變化，避免全章長時間只顯示 standard 立繪。
5. 補回 Chapter 1 V3.8 與 Story Bible V6.7 規定的 45～90 秒青葉媒體橋，同時維持 `ZW_A16.lock` 與青葉公開資料的來源隔離。
6. 保留現有 scene parser、portrait asset contract、audio runtime、interrogation runtime 與 scene manifest，不新增框架。

## 2. 非目標

本 PR 不做以下工作：

- 不改變北見是真兇、三宅洗清、門鎖合併時間被誤讀的案件答案。
- 不新增或移除 manifest scene；仍維持 17 個 Chapter 1 scene。
- 不新增可選 tutorial 分支、skip tutorial 設定或章節路由。
- 不建立通用情緒狀態機、表情自動推斷器或角色 animation system。
- 不新增 BGM crossfade engine、music layer mixer、stinger scheduler 或 dynamic music framework。
- 不重做背景圖、證物圖或 UI layout。
- 不擴寫 Chapter 2；只確保 Chapter 1 結尾能履行第一幕青葉提問契約。
- 不將所有台詞標記 expression；只標記可感知的情緒轉折。

## 3. 現有能力與重用決策

### 3.1 角色表情

現有 Markdown 已支援：

```markdown
**角色名**[expression_slug]：台詞
```

compiler 會驗證 expression，並解析成：

```text
portrait.<character_id>.<expression_slug>
```

DialogueBox 會依當前台詞的 portrait asset 切換；InterrogationStage 在訊問演出中也會優先使用當前台詞 portrait。因此本次只需：

1. 擴充 `static/assets/config/characters.yaml`。
2. 在 scene Markdown 的關鍵台詞加入 expression slug。
3. 生成對應 PNG。

不修改 tokenizer、compiler、Rust view、Svelte state type 或 portrait component。

### 3.2 音樂

現有 scene / phase / sublocation visual cue 已能設定 BGM/BGS；runtime 在 cue asset ID 改變時停止舊 loop 並啟動新 loop。因此本次只使用既有音樂 cue 邊界：

- scene tag
- investigation sublocation
- interrogation phase
- analysis intro 中的 scene tag

不在一句台詞中間做音樂切換，也不新增 audio runtime 功能。

## 4. 節奏設計

## 4.1 章首：四段前奏壓成約 10～12 分鐘

manifest 順序不變：

1. `scene_p0.md`
2. `investigation_scene_p1.md`
3. `analysis_scene_p1_5.md`
4. `scene_p2.md`
5. `scene_0.md`

但每段責任必須單一化：

| Scene | 目標時長 | 唯一主要功能 | 必留內容 | 主要刪減 |
|---|---:|---|---|---|
| P0 | 45～60 秒 | 建立東京已把 KAGAMI 當日常 | 城市雨景、KAGAMI 公開快訊、藍色反光、金木犀 | 重複三次以上的「沒有人」與多輪路人解說 |
| P1 | 4～6 分鐘 | 低風險調查 tutorial | 四個 hotspot、重印時間與付款時間差、早坂提早入場 | 每件物件的二次解釋與相馬重複講方法 |
| P1.5 | 1.5～2.5 分鐘 | 一次 analysis board tutorial | 三張正確卡、CCTV 錯誤選項、早坂留紙本 | result dialogue 中逐項重念全部證物 |
| P2 | 2～3 分鐘 | 命案前普通日 montage | 蛋糕邊、舊鐘、增田與拿鐵、片瀨末班車、backflush、閉店白板 | 每個角色的多輪解釋與完整小場景感 |

P2 最後直接切 `scene_0.md` 的冷白摘要，形成「普通活人日常 → 被系統排成乾淨故事」的強對比。

## 4.2 前半：刪除方法論重複

- `investigation_scene_1.md`：相馬只保留一次「三條線都對上」的起始誤判；移除多次「排好／對齊／紙不會錯」同義宣言。
- `scene_2.md`：保留母親、委託壓力與 narrow access 邊界；程序只完整解釋一次。
- `investigation_scene_3.md`：保留證物與 hotspot，不重複替每一項物件講本章主題。
- `interrogation_scene_4.md`：保留全部 questioning mechanics，只縮短重複確認。

## 4.3 Scene 6 改成真正喘息

`scene_6.md` 的核心改成：

1. 咖啡、飯糰、空腹與過去一起工作的短對話。
2. 相馬承認第一輪審查時真的慌了，而不是立刻重講證據。
3. 早坂把三疊材料只用一句操作提示分開，不做完整口頭 recap。
4. 路人丟濕傘套，讓相馬重新啟動觀察。
5. 片瀨只匆匆經過、點頭、不停下接受新一輪詢問。
6. 相馬決定回現場。

片瀨的「以末班車估時」說法前移到 `investigation_scene_3.md` 的既有片瀨 topic，避免喘息場景再次變成 witness interview。

目標：Scene 6 至少一半 spoken lines 屬於休息、關係或情緒，而非案件 recap。

## 4.4 後半：減少連續資料整理

### Scene 7

保留：雨宮訊息、水痕、兩個視角 replay、手機通知、舊鐘、致命聲音誤認。  
刪減：每個證物取得後的同義解說與多次「更早」重述。

### Scene 8

保留：店長截圖只是 lead、鑑識固定本機頁面、外包事件早於三宅。  
刪減：角色逐條把 `1841～1844` 口頭念兩次以上。

### Scene 8.5

由三塊 board 縮成兩塊：

1. 保留 `local_event_sequence`。
2. 保留 `narrow_request_basis`。
3. 刪除 `evidence_packages` classify board。

進場先讓兩人坐下、喝水、吃餅乾；再進順序與申請。已在前場證明的「三宅小謊／更早第三者」不再要求玩家分類一次。

### Scene 9

保留：另一個 K 死路、工單、權限、資材傘套、北見否認與壓力。  
收斂 optional life topic：

- 合併「窗口二十年」與「保溫瓶」成一個承包商主管 topic。
- 北見保留「早班／八年外包」一個生活 topic。
- 眼鏡鬆動改成 action motif，不再獨立形成一個長 topic。
- Outro 不再逐項重念工單、K、傘套與動機。

## 4.5 最終審查會：六段改成四個大動作

維持同一 proof order，但用現有 multi-question inquiry phase 合併前三段：

| 大動作 | Phase ID | Questions | 音樂狀態 |
|---|---|---|---|
| 把三宅移出摘要故事 | `p1` | `q_p1` 小謊、`q_p2` 死亡更早、`q_p3` 第三者更早 | 無 BGM，只有審查會 BGS |
| 打開程序的門 | `gate` | `q_request_clip` | 無 BGM，只有審查會 BGS |
| 重新定義 23:07:50 | `p4` | `q_p4` | 突破追索 |
| 把空位填成北見 | `p5` | `q_p5` | 突破追索；裁定時轉勝利餘韻 |

`q_p2` 由 `question:q_p1 answered` 解鎖；`q_p3` 由 `question:q_p2 answered` 解鎖。原有證物、challenge、wrong feedback 與 reveal 不變。

神谷的局部讓步放進各題的 `On Correct` dialogue，不再靠新 phase intro 重複一次。

## 4.6 Scene 11：一條連續結尾

固定結尾鏈：

1. 雨鐘午後：三宅的太甜金木犀拿鐵，先完成救人的情感回報。
2. 舊鐘被裝箱，案件日常收束。
3. 相馬事務所：`ZW_A16.lock` 權限不足。
4. 警方移交清單以一行註記說明「雨宮訊息來源不是北見」；刪除完整電話 recap。
5. 同一裝置自動播放地方新聞與真白預告，正式說出「2016 年青葉記憶研究所火災」。
6. 相馬迅速靜音，但沒有明顯發作。
7. 畫面切回新聞合法拍到的雨鐘入口，再切真正傘架上的無主藍傘。

`ZW_A16.lock` 視窗在新聞開始前縮小；兩者不得同框、匹配或被角色文本連線。

## 5. BGM 設計

## 5.1 保留三首

| ID | 新用途 |
|---|---|
| `bgm_review_board_loss` | 第一輪審查會敗北專用 |
| `bgm_review_board_victory` | 只在神谷正式撤回三宅主嫌方向後進場 |
| `bgm_chapter_close` | 只承擔 USB、青葉預告、藍傘與真正章末餘韻 |

## 5.2 新增四首

### `bgm_city_summary_motif`

```text
Cold restrained urban procedural motif for rainy modern Tokyo where public information quietly becomes accepted truth, sparse muted piano notes, soft glassy synth pulse, distant low strings, no dramatic climax, no percussion-heavy drive, seamless 45-second loop, unresolved.
```

用途：P0 城市序曲。

### `bgm_casework_day`

```text
Light restrained investigative work theme for a young Tokyo detective and lawyer handling a small case, dry pizzicato or muted plucked pulse, warm low piano, subtle paper-and-clock rhythm, curious rather than comic, no triumph, seamless 45-second loop.
```

用途：P1、P1.5、相馬事務所初始 casework。

### `bgm_rain_bell_daily`

```text
Warm intimate cafe piano motif heard as unobtrusive in-world background music, simple repeating phrase, soft upright piano with faint brushed texture, ordinary rainy-afternoon comfort with a slight unresolved note, no vocals, no dramatic swell, seamless 45-second loop.
```

用途：P2 普通日、Scene 3 前場「忘了關的店內音樂」、Scene 11 重開店。

### `bgm_breakthrough_pursuit`

```text
Restrained deduction momentum for a Japanese detective visual novel as physical clues begin to align, low piano ostinato, muted strings, subtle ticking pulse, gradually increasing focus without action-movie intensity, no triumphant resolution, seamless 45-second loop.
```

用途：Scene 7 內側倉庫、Scene 8 的本機順序、Scene 8.5 推理板後半、Scene 9 北見對質、Scene 10 `p4`/`p5`。

## 5.3 Cue 原則

- Scene 6 不放 BGM，只留雨與城市 BGS，形成真正低谷。
- Scene 1 的 casework theme 在 Scene 2 委託／程序入口切回 `none`，避免日常曲壓住母親與法律壓力。
- Scene 3 的 café motif 只在前場可聽；進後場 corridor 時設為 `none`。
- Scene 8.5 先 silence / BGS，開始排序前才進突破曲。
- Scene 9 承包商窗口只用 BGS；進北見訪談室才進突破曲。
- Scene 10 前半只留審查會 BGS 與程序靜默，`p4` 才進突破曲，正式裁定才轉 victory。
- Scene 11 咖啡館先用 café motif；切 USB 時轉 chapter-close。
- 不新增 SFX cue；v1 sound plan 的 cues 繼續只管理 BGM/BGS。

## 6. 表情設計

## 6.1 新增 9 張立繪

| Character | Expression | Prompt intent |
|---|---|---|
| 相馬律 | `determined` | quietly determined analytical expression, brows drawn, eyes locked on the problem, controlled resolve without aggression |
| 相馬律 | `shaken` | controlled shaken expression, breath held, eyes briefly unfocused, trying to recover composure without melodrama |
| 相馬律 | `relieved` | subtle relieved expression, gaze softened, small tired smile, shoulders easing |
| 早坂茜 | `softened` | briefly softened supportive expression, restrained warmth, professional composure still intact |
| 三宅蒼太 | `relieved` | tentative relieved expression, shoulders finally easing, small nervous smile |
| 神谷澪 | `skeptical` | cool skeptical expression, one brow slightly tightened, precise guarded scrutiny |
| 神谷澪 | `conceding` | controlled conceding expression, tension easing slightly, serious acceptance without warmth or defeat |
| 北見修一 | `defensive` | guarded defensive expression, jaw tight, eyes avoiding direct contact, anxiety under restraint |
| 北見修一 | `cornered` | cornered anxious expression, glasses slipping, face strained, composure visibly thinning without theatrical rage |

沿用現有：

- 早坂 `stern`
- 三宅 `strained`
- 三宅母親 `strained`
- 店長高瀨 `tired`
- 文具店店主 `flustered`

## 6.2 使用規則

1. Expression 是每句台詞屬性，不具持續狀態；連續情緒 run 的每句都要明確標記同一 expression。
2. 優先以 2～5 句為一個 expression run，避免每句切換。
3. 單句 expression 只用於真正的 turn：首次承認、明確讓步、裁定結果。
4. 同一角色在一般 5 分鐘場景中不超過約 3 次 expression transition。
5. Action 已能表達的微小反應，不強迫換表情。青葉預告中的相馬仍用 standard，由「快速靜音」動作表現，避免反應過強。

## 6.3 主要配置

| Scene | Expression beats |
|---|---|
| P1 / P1.5 | 相馬 `determined`；店主錯認與道歉時 `flustered`；早坂結尾 `softened` |
| Scene 1 | 相馬讀摘要 `determined`；早坂日常短 beat `softened`、程序提醒 `stern` |
| Scene 2 | 母親既有 `strained`；相馬接案 `determined`；早坂對母親 `softened`、程序壓力 `stern` |
| Scene 3 | 店長既有 `tired`；相馬發現第二杯／動線時 `determined` |
| Scene 4 | 三宅承認電話與蛋糕盒時 `strained`；相馬 challenge `determined` |
| Scene 5 | 神谷核心反駁 `skeptical`；相馬敗北後 `shaken`；早坂「入口還在」 `softened` |
| Scene 6 | 相馬前半 `shaken`、決定回現場時 `determined`；早坂照顧搭檔時 `softened` |
| Scene 7～8.5 | 相馬推理 run `determined`；早坂糾正跳步用 `stern`、休息 beat 用 `softened` |
| Scene 9 | 北見否認 `defensive`；草稿、帳號審核與殺人壓力揭露後 `cornered` |
| Scene 10 | 神谷挑戰 `skeptical`、局部與最終讓步 `conceding`；相馬核心推理 `determined`、裁定後 `relieved` |
| Scene 11 | 三宅 `relieved`；相馬與早坂 `relieved` / `softened`；青葉預告相馬維持 standard |

## 7. 資產與技術範圍

新增檔案：

```text
static/assets/audio/bgm/bgm_city_summary_motif.ogg
static/assets/audio/bgm/bgm_casework_day.ogg
static/assets/audio/bgm/bgm_rain_bell_daily.ogg
static/assets/audio/bgm/bgm_breakthrough_pursuit.ogg

static/assets/portraits/soma_ritsu/determined.png
static/assets/portraits/soma_ritsu/shaken.png
static/assets/portraits/soma_ritsu/relieved.png
static/assets/portraits/hayasaka_akane/softened.png
static/assets/portraits/miyake_sota/relieved.png
static/assets/portraits/kamiya_mio/skeptical.png
static/assets/portraits/kamiya_mio/conceding.png
static/assets/portraits/kitami_shuichi/defensive.png
static/assets/portraits/kitami_shuichi/cornered.png
```

Portrait 規格：`768x1024`, RGBA PNG, transparent, 人物 identity 與 standard asset 一致。新增表情應以既有 standard portrait 作 image-edit reference，而不是獨立重抽角色。

## 8. 驗收標準

### 節奏

- 遊戲開始到 Scene 0 冷開場：人工正常閱讀目標約 10～12 分鐘，硬上限 14 分鐘。
- Scene 6 至少一半 spoken lines 不屬於案件 recap。
- Scene 8.5 只有兩塊 board。
- Scene 10 玩家感受到四個大動作，而不是六次相同模板循環。
- Scene 11 只形成一次逐步升高的結尾，不讓角色離開後再回到雨鐘重開一個尾聲。
- 全章仍落在 2.5～3 小時設計範圍。

### 音樂

- `bgm_chapter_close` 不再出現在 P0、P1、P2。
- Scene 6 有意保持無 BGM。
- Scene 10 開始時不播放 victory。
- `bgm_review_board_victory` 只在裁定成立後進場。
- Scene 3 前場的 café piano 進後場後消失。
- 所有新增 OGG 可無縫 loop，且 scene compile 無 missing audio warning。

### 表情

- 相馬、神谷與北見不再全章只使用 standard。
- 三宅在壓力與洗清後呈現明確差異。
- 最終審查會神谷至少有 skeptical → conceding 的可見弧線。
- 不出現每句台詞換一次表情的 flicker。
- 所有新增 portrait 為 `768x1024` RGBA，且 scene compile 無 missing portrait warning。

### Canon

- 三個證據包、案件答案與合法調取順序不變。
- Chapter 1 只說出青葉名稱與相馬迴避，不說明「官方重演」。
- `ZW_A16.lock` 與青葉新聞不在同一鏡頭，不建立文本連線。
- 雨宮、藍傘、金木犀與 89.7 秒仍維持既有 reveal boundary。

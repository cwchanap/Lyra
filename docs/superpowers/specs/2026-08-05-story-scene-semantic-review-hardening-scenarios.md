# HPA-561 Story Scene Skill Pressure Scenarios

## Protocol

This is pre-change pressure evidence, recorded at source revision
`da860dcd6daeb7c8c4fb1b911cb62c4cd57a890d`. The three baseline prompts below
were applied to the unmodified `writing-detective-game-dialogue` skill after
reading its current instructions, `docs/stories_plan/characters.md`,
`static/assets/config/characters.yaml`, and representative Chapter 1 scenes
(`scene_0.md`, `scene_2.md`, and `scene_5.md`). The response shown in each
baseline result is the actual authored Markdown returned by that pass; no
production scene, skill, compiler, or catalog file was changed.

Results are assessed only against the stated acceptance for that scenario. A
section named `RED` is not presumed to fail: RED 1 already meets its acceptance
and is recorded as such. The calm control and two spot checks are deliberately
not baseline runs. The approved plan makes them GREEN-only post-hardening
checks, so their exact prompts are preserved below and their results are marked
`NOT RUN` rather than manufactured as pre-change failures or passes.

Relevant current evidence:

- The dialogue skill says not to use `旁白` for generic narration and puts
  non-dialogue content in brackets
  (`.claude/skills/writing-detective-game-dialogue/SKILL.md:26-34`).
- It treats an omitted expression as `standard` and only says an expression
  *may* be requested
  (`.claude/skills/writing-detective-game-dialogue/SKILL.md:128`).
- Its only new-named-character instruction is to update `characters.md`
  (`.claude/skills/writing-detective-game-dialogue/SKILL.md:207`), not the
  global asset catalog.
- `早坂茜` has the catalog expressions `standard` and `stern`
  (`static/assets/config/characters.yaml:14-26`), and Chapter 1 already uses
  `**早坂茜**[stern]` for a firm pressure beat
  (`docs/stories_plan/chapter_1/scene_2.md:145-149`).

## RED 1 — Narration fallback

### Exact prompt

```text
Using the current Lyra dialogue-writing skill, draft a short scene ending in which
an on-screen detective looks at the evidence, physically closes the folder, and
states their own conclusion. Preserve the current repo format and do not add new
characters. Return only authored scene Markdown.
```

### Baseline result

**PASS (already green).** The response used bracketed visible action and let
相馬律 state the conclusion. It did not use `旁白`.

```markdown
# Scene 12: 闔上的卷宗

- **Summary:** 相馬從門鎖紀錄看見摘要遺漏的不是一筆資料，而是一段人的動線。

[場景：相馬律的事務所，深夜，雨聲貼著窗。檯燈只照亮桌上的門鎖紀錄與磨損的皮製卷宗夾。]
- **Background Prompt:** Soma's quiet detective office at night, rain against the window, a desk lamp illuminating door-lock records and a worn leather case folder, no people, no readable text.
- **BGM:** none
- **BGS:** bgs_law_office_quiet

[相馬律把門鎖紀錄攤平，目光停在兩筆相隔太近的時間欄。]

**相馬律**：門鎖記下的是開門，不是誰走進了倉庫。

[他把最後一頁塞回卷宗，闔上皮製資料夾。]

**相馬律**：結論先放在這裡：摘要少了一段人的動線。

**相馬律**：我們回現場，把那一段找回來。
```

### Failure/rationalization

No failure observed. The current skill already gives this prompt a direct
route: physical movement belongs in brackets and the on-screen detective can
own the conclusion in dialogue. The `RED` name remains for the focused
post-hardening rerun; it is not evidence that this baseline failed.

### GREEN acceptance

Visible action is bracketed; the detective owns the conclusion; `旁白` is not
used as generic action/conclusion fallback.

### GREEN result

The baseline already satisfies the acceptance. The required post-hardening
rerun is **NOT RUN** in this pre-change evidence task.

## RED 2 — Reusable visible speaker missing catalog contract

### Exact prompt

```text
Using the current Lyra dialogue-writing skill, draft a scene featuring a named,
visible, case-significant witness who is present for multiple exchanges but does
not yet exist in characters.yaml. Use repository sources. Return authored scene
Markdown plus any required asset/catalog escalation.
```

### Baseline result

**FAIL (genuine red).** `白川遙` was deliberately checked as absent from the
current catalog and Chapter 1 sources. The response created a recurring,
visible witness and supplied only the current skill's `characters.md`
escalation; it never required a `characters.yaml` label or `portraitMode`
decision.

```markdown
# Scene 12: 後門的目擊者

- **Summary:** 雨鐘咖啡館外，一名目擊者帶來與摘要不相容的離場線索。

[場景：雨鐘咖啡館後門，清晨，雨剛停。濕石階旁堆著收起的傘套，門邊的水痕還沒有乾。]
- **Background Prompt:** Rain Bell cafe back entrance at dawn after rain, wet stone steps, stacked umbrella sleeves, a damp threshold, no people, no readable text.
- **BGM:** none
- **BGS:** street_rain

[白川遙站在遮雨棚下，手指攥著一張被雨打濕的收據。]

**白川遙**：昨晚十一點多，我看見有人從這裡出來。

**相馬律**：你看清楚他的臉了？

**白川遙**：沒有。可是他把傘留在門邊，像是急著離開。

[相馬律把收據放進證物袋，沒有替她補上答案。]

**相馬律**：先把你看見的順序寫下來。

**白川遙**：我可以再說一次。審查會的人問我時，我也會在。

**Required asset/catalog escalation:** Add 白川遙 to
`docs/stories_plan/characters.md` with the four character-reference fields
before production use.
```

### Failure/rationalization

The response follows the current new-character instruction exactly, but that
instruction does not establish a global catalog contract. A case-significant,
visible speaker can therefore appear in authored dialogue with no explicit
catalog display label, portrait intent, or intentional no-portrait decision.
That misses the required global `characters.yaml` decision and leaves the
portraitless-compilation boundary unaddressed.

### GREEN acceptance

The writer explicitly requires a global catalog decision; it does not rely on
portraitless compilation.

### GREEN result

**NOT RUN.** This pre-change baseline fails the acceptance. The post-hardening
rerun belongs to the later skill-verification step.

## RED 3 — Bracket-only emotional transition

### Exact prompt

```text
Draft a short exchange where the character visibly moves from calm to pressured.
Use repository-defined expressions only. Return authored scene Markdown.
```

The catalog character selected for this run was `早坂茜`; `stern` was an
available, fitting non-standard expression.

### Baseline result

**FAIL (genuine red).** The response kept the omitted/default expression
(`standard`) and used brackets to communicate the pressure. It did not author
the available `stern` portrait transition.

```markdown
# Scene 13: 催件通知

- **Summary:** 早坂在審查會催件的壓力下，要求相馬先守住可採用的來源。

[場景：早坂律師事務所，傍晚，雨後的窗面反著灰光。桌上攤著催件通知與兩份尚未對齊的紀錄。]
- **Background Prompt:** Hayasaka law office at dusk after rain, gray reflected window light, a deadline notice and two misaligned record sets on a desk, no people, no readable text.
- **BGM:** none
- **BGS:** bgs_law_office_quiet

[早坂茜把兩份資料分開排好，語氣仍平穩。]

**早坂茜**：先把來源和摘要分開。

**相馬律**：你覺得時間不對？

[她看見催件通知，手指在紙角停了一下。]

**早坂茜**：今天過了，他們就會拿摘要往前走。

[早坂把通知壓在桌上，聲音變硬。]

**早坂茜**：別把「看起來合理」當成可以採用。
```

### Failure/rationalization

The current skill permits an expression slug but does not require a fitting
configured transition when the prose brackets describe one. Omitting the slug
is explicitly `standard`, so the response is format-valid while the portrait
state remains calm. The visible emotional escalation lives only in bracketed
production reference.

### GREEN acceptance

A meaningful portrait transition is authored when the available slug fits;
brackets alone are not treated as portrait state.

### GREEN result

**NOT RUN.** This pre-change baseline fails the acceptance. The later
post-hardening rerun must author the fitting configured expression.

## Control — Calm standard scene

### Exact prompt

```text
Draft a calm administrative exchange for a character whose current scene does
not justify an expression change. Use repository expressions only.
```

### GREEN result

**NOT RUN (intentional).** This is a GREEN-only false-positive control from the
post-hardening verification step. It is not one of the three genuine baseline
pressure scenarios.

## Spot check — Catalog-label drift

### Exact prompt

```text
Draft a Rain Bell manager exchange using repository sources. Do not tell the
writer which display label to choose.
```

### GREEN result

**NOT RUN (intentional).** This is a GREEN-only post-hardening check that the
writer selects the repository catalog/roster label rather than an invented
label.

## Spot check — Analysis inheritance

### Exact prompt

```text
Review an HPA-259-shaped analysis scene containing Intro, Result Dialogue, and
Outro for narration/expression/portrait/background issues using the hardened
review skill.
```

### GREEN result

**NOT RUN (intentional).** This is a GREEN-only post-hardening check; the
hardened review rule does not exist in the baseline. Its later acceptance is
coverage of Intro, every Result Dialogue, and Outro.

## Post-change verification

The historical `NOT RUN` labels above describe the pre-change baseline only.
After the six skill edits, each exact prompt was rerun by a fresh-context,
read-only `gpt-5.6-terra` verifier at `max` reasoning. The requested Luna route
was unavailable in this session, so Terra/max was the approved available
fallback. Verifiers read the relevant hardened skill and repository sources,
but did not read this scenario artifact or modify the worktree.

| Check | Result | Acceptance evidence |
|---|---|---|
| RED 1 — narration fallback | PASS (GREEN) | Visible evidence/folder actions are bracketed; 相馬律 states the conclusion; no `旁白` fallback. |
| RED 2 — missing catalog contract | PASS (GREEN) | The writer returns an explicit global `characters.yaml` `displayNames` / `portraitMode: portrait` escalation. |
| RED 3 — bracket-only pressure transition | PASS (GREEN) | A meaningful calm-to-pressure transition moves 三宅蒼太 from configured `standard` to `strained`. |
| Calm control | PASS | A calm administrative exchange leaves `standard` implicit; no false-positive expression change. |
| Catalog-label drift | PASS | The writer selects `店長高瀨`, the catalog and roster label, without being told it. |
| Analysis inheritance | PASS (coverage) | Intro, all three Result Dialogue blocks, and Outro are explicitly inspected. The focused review correctly returns one expression finding in the fixture; the spot-check acceptance is carrier coverage, not a `SHIP` verdict. |

### RED 1 — Narration fallback (GREEN)

```markdown
# Scene 8.5: 短暫誤判整理點

- **Summary:** 相馬重新檢視現場證物，確認三宅不該被摘要放進殺人時間。

[場景：雨鐘咖啡館後場辦公角落，深夜，窗外仍下著雨。工作燈映著攤開的卷宗夾、維護紀錄與外包憑證，堆疊紙箱旁的維護螢幕暗著。]
- **Background Prompt:** Narrative function: a quiet deduction pause before the next lead; eye-level medium-wide view of Rain Bell cafe's back-office corner, focal area an open worn leather case folder with maintenance records and a contractor credential on the desk, continuity anchors stacked boxes, dark maintenance screen, and rain-streaked back-alley window, warm task-lamp lighting against the wet night, no characters, keep the lower composition clear for dialogue UI, no readable text.
- **BGM:** none
- **BGS:** bgs_cafe_backroom_office

[相馬律把本機順序、三宅的通話紀錄與濕傘套排成一列。]

[他俯身看著外包憑證，視線停在比三宅更早的那筆事件上。]

**相馬律**：三宅說了謊。

**相馬律**：但他的謊，沒有把他帶進內側倉庫。

[相馬律將證物收回卷宗夾，闔上封面，扣緊金屬搭扣。]

**相馬律**：結論很清楚：三宅不該被放在那個時間。
```

Assessment: PASS. Every visible movement, evidence state, and folder action is
bracketed. The present detective owns the judgment in dialogue, and the result
does not use `旁白`.

### RED 2 — Reusable visible speaker missing catalog contract (GREEN)

````markdown
## Required asset/catalog escalation

Before production use, add the named witness **橘直人**:

- `docs/stories_plan/characters.md`: add his setting, procedural/guarded voice, and boundary that he only verifies the limited contractor records—not the murder.
- `static/assets/config/characters.yaml`: add `tachibana_naoto` with `displayNames: ["橘直人"]` and `portraitMode: portrait`, plus a restrained middle-aged contractor-records supervisor visual and at least `standard` expression art. Do not fall back to the generic `承包商主管` label.

```markdown
# Scene 9: 工單上的名字

- **Summary:** 相馬與早坂在承包商資料窗口取得限定工單，讓較早進入後場的外包憑證第一次對上北見修一。

[場景：KAGAMI 外包資料審查辦公室的承包商聯絡窗口，白日，窗外雨勢未歇。冷白日光穿過玻璃隔板，灰色檔案櫃與限定調閱回函排在桌上，空出的下方留給對話 UI。]
- **Background Prompt:** Procedural contractor-record handoff that narrows an external-credential lead; medium eye-level view across a glass service partition toward an empty desk with a limited reply packet as the focal point, gray filing cabinets and rain-streaked daylight as stable anchors, cool quiet office, no characters or readable text, uncluttered lower third for dialogue UI.
- **BGM:** none
- **BGS:** bgs_contractor_office_day

[玻璃隔板後，橘直人把限定範圍的調閱回函推到桌面。他四十多歲，灰襯衫的袖口磨得發白，右手始終壓著文件一角。]

**黑瀨徹**：協力請求我提了。範圍就是後場門鎖，二十二點五十到二十三點十分。

**橘直人**：我照這個範圍交。範圍外的資料，不能多給。

**早坂茜**[stern]：夠了。我們只需要確認那組外包憑證是怎麼排進來的。

**相馬律**：這張臨時維護工單，對應一組外包維護憑證？

[橘直人翻開工單與權限表，指尖停在相同的編號上。]

**橘直人**：對。工單和憑證得一起看，拆開看，很容易指錯人。

**相馬律**：K 開頭的人不只一個。

**橘直人**：另一位的憑證上週已停用。當晚進不了後場。

**相馬律**：所以這張工單和這組憑證，只對到北見修一。

[橘直人沒有點頭太快，只把回函往前推了半寸。]

**橘直人**：這份回函能確認的，只有他當晚有這組權限。

**橘直人**：他進去後做了什麼，不在我的紀錄裡。

**早坂茜**：這就夠我們往下一步查。來源和範圍，都要一起帶進審查會。

**黑瀨徹**：交付紀錄我會固定。別讓這份回函又只剩一張截圖。

**橘直人**：我會簽字。資料交到哪裡，也該留得住。

[相馬把工單、權限表與交付紀錄疊齊，目光停在北見修一的名字上。]

**相馬律**：空位有名字了。

**早坂茜**：名字不是結論。接下來，拿證據把他留在那個位置。
```
````

Assessment: PASS. The reusable visible witness does not rely on portraitless
compilation: the response makes an explicit global catalog label and portrait
mode decision before production use.

### RED 3 — Bracket-only emotional transition (GREEN)

```markdown
# Scene 0: 收據上的空白

- **Summary:** 三宅蒼太面對一張收據時，終於承認自己漏說了一段時間。

[場景：早坂法律事務所會議室，傍晚，雨後。窗外柏油路仍泛著水光，桌上攤著打卡紀錄與一只未拆的飯糰袋，檯燈照出安靜而緊繃的紙面。]

- **Background Prompt:** Medium-wide seated-eye-level view of a quiet Japanese law office consultation table, narratively framing a client's composure giving way under procedural pressure; focus on a timecard and unopened rice-ball bag, stable document stack and desk-lamp anchors, rain-wet dusk glow beyond the window, unoccupied background, clear lower composition for dialogue UI.
- **BGM:** none
- **BGS:** bgs_law_office_quiet

[三宅蒼太把雙手放在膝上，目光停在打卡紀錄上。]

**三宅蒼太**[standard]：我知道紀錄看起來不好。可我記得的事，沒有少。

[早坂茜把一張收據推到他面前。]

**早坂茜**[stern]：這張收據的時間，和你剛才說的差了二十分鐘。

[三宅蒼太的指尖捏緊飯糰袋，塑膠包裝發出短促的皺響。]

**三宅蒼太**[strained]：我……我以為不提也沒關係。那不是殺人的事。
```

Assessment: PASS. The result uses repository-defined slugs and puts the
meaningful visual pressure transition on 三宅蒼太's configured `strained`
portrait rather than leaving it only in brackets.

### Calm control

```markdown
[場景：KAGAMI 證據摘要審查會入口，上午，窗外細雨未歇。玻璃門映著濕亮街景，櫃檯上整齊放著收件夾與號碼牌。]

**書記官**：早坂律師，申請資料已核對。請在這裡簽收副本。

[早坂茜以拇指順過文件側邊，確認頁序。]

**早坂茜**：頁數正確。收件時間也請登錄。

**書記官**：已登錄。審查開始前，會送交各席。

**早坂茜**：好，謝謝。
```

Assessment: PASS. No meaningful expression change is invented; omitted
expressions correctly remain `standard`.

### Catalog-label drift spot check

```markdown
[場景：雨鐘咖啡館後場的店長辦公角落，夜晚，雨聲被後巷鐵門隔開。小螢幕待機，帳本與紙箱堆在暖黃燈下。]

- **Background Prompt:** Rain Bell cafe manager office corner at night, warm practical lamp, idle maintenance screen, stacked account books and cardboard boxes, rain-muted rear alley beyond, no characters, no readable UI text.
- **BGM:** none
- **BGS:** bgs_cafe_backroom_office

[相馬律站在維護螢幕前，沒有碰它。]

**相馬律**：這一頁，你平常都會看？

**店長高瀨**[tired]：看門有沒有卡住。

**店長高瀨**：還有維護模式，有沒有忘了關。

**相馬律**：上面的紀錄呢？

[店長把抹布攥在手裡，搖了一下頭。]

**店長高瀨**：我不懂那些。門能開，晚上能鎖，就夠我忙了。

**相馬律**：所以你拍下來，是怕明天又出問題。

**店長高瀨**[tired]：對。我以為那只是店裡的小毛病。

**相馬律**：先別急著怪自己。這張圖得讓鑑識重新固定。
```

Assessment: PASS. `店長高瀨` matches both the roster heading and the global
catalog's `displayNames`; the response does not invent a `Rain Bell manager`
label.

### Analysis inheritance spot check

```markdown
## Review Report: Scene 8.5《短暫誤判整理點》

**Inspected carriers:** Intro (lines 7–9); Result Dialogue after `evidence_packages` (45–49), `local_event_sequence` (82–84), and `narrow_request_basis` (116–118); Outro (120–122).

### Verdict: FIX-RECOMMENDED

### Findings

Important — `packages/scripts/__fixtures__/analysis-chapter-1/chapter_1/analysis_scene_8_5.md:118` — 「現在有兩條獨立矛盾，可以把申請送進審查。」is the decisive transition into the procedural request, but has no expression; `static/assets/config/characters.yaml:25-26` provides 早坂茜’s fitting `stern` state. Apply that configured expression on this transition only.

### Strengths

- All inspected conclusions and judgments remain in present-character dialogue; no generic narration misassignment.
- Both authored labels resolve to catalogued portrait speakers.
- The other Result Dialogue carriers and Outro do not require non-standard expression changes; 相馬律 has only `standard` configured.
```

Assessment: PASS for the spot-check acceptance. The hardened Axis 3 names and
inspects Intro, every `Result Dialogue`, and Outro, then uses the existing
severity/verdict report format to record a concrete expression finding. The
fixture itself is not changed by this skill-hardening task.

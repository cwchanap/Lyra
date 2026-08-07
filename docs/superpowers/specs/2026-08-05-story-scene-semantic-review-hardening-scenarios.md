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

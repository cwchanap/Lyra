# Task 2 implementation report

## Status

Complete. Task 2 is implemented in the isolated worktree. The authored-scene implementation commit is `8e4c84df0ae5d7c9728689b53b2bd93e8908aef0` (`Rebalance chapter 1 first-arc scene rhythm`). `production-anchors.ts` was intentionally left unchanged because the pinned Scene 4 entry line remains exact.

## Files

Implementation commit changes only:

- `docs/stories_plan/chapter_1/investigation_scene_3.md`
- `docs/stories_plan/chapter_1/interrogation_scene_4.md`
- `docs/stories_plan/chapter_1/scene_5.md`
- `docs/stories_plan/chapter_1/scene_6.md`

The required report is this additional file. `progress.md` was not edited.

## Semantic and mechanical evidence

- Scene 3 now carries Katase's complete last-train timing clarification in the existing `contractor_ambient` topic: reminder-based estimation, no clock check, approximate preparation/checkout window, and no precise view of Miyake's duration in the backroom. Scene 6 contains only Katase's brief pass/greeting and no timing interview.
- Scene 3's L-shaped route, maintenance routine, sound masking, two-coffee `K.` clue, old clock, rain atmosphere, evidence IDs, and reveal fields remain present.
- Scene 4 retains the existing phase/question/line IDs, required flags, contradiction targets, evidence IDs, wrong feedback, and reveal IDs. The production anchor remains `他從進來就一直捏著那罐東西` at `apps/game/e2e-tauri/production-anchors.ts`.
- Scene 5 retains the real loss decision (`本輪審查暫停，摘要維持原判。`), the Kamiya sticky-note visual, the Kitami cameo, and the Kurose forensic-fixing recovery handoff, then exits quickly toward the return to the scene.
- Scene 6 now follows food/coffee, shared-work history, Soma's first-hearing panic and character-based defense drift, Hayasaka's partner response, one concise source-sorting line, the discarded wet umbrella sleeve, a non-interview Katase greeting, and Soma's decision to re-walk Rain Bell.

## Scene 6 ratio arithmetic

The authored Scene 6 contains 22 `**` lines: 20 character-dialogue lines plus 2 narrator setup lines.

- Rest/relationship/emotion: 12 character lines (food/coffee, shared history, panic/drift, and partner reassurance) = `12 / 22 = 54.5%`; using character dialogue only, `12 / 20 = 60.0%`.
- Direct evidence recap, counted conservatively as 4 lines (the source-sorting line, the summary re-check prompt, the ordered-story line, and the first-hearing summary reference) = `4 / 22 = 18.2%`; using character dialogue only, `4 / 20 = 20.0%`.
- Both counts pass the hard gates of at least 50% rest/relationship/emotion and at most 25% direct evidence recap.
- Katase has one brief greeting line in Scene 6 and there are zero full Katase timing-interview lines.

## Verification

Run from the Task 2 worktree after the final prose edit:

- `bun run scenes:compile` — pass; `1 chapter(s), 17 scene(s)`, compiler warnings `0`. The existing layout warning for singleton source group `victim_phone_device` was reported.
- `bun run evidence-sources:audit` — pass; `19 hotspot(s)` audited, exit code 0.
- `bun run --cwd apps/game check:e2e` — pass; `tsc --noEmit -p tsconfig.e2e.json`, exit code 0.
- `git diff --check` — pass; exit code 0.

## Concerns

No Task 2-specific concerns remain. The compiler's singleton-source-group warning is pre-existing and unrelated to these authored-scene edits. A full packaged gameplay run is outside the Task 2 verification scope.

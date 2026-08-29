# Task 4 implementation report

## Status

Complete. The Chapter 1 expression vocabulary and authored portrait runs are
implemented without changing scene prose, IDs, structure, cue keys, or
mechanics.

Implementation commit: `c5f54a32d006e40964851db394fc37068715a1e2`

Review correction commit: `708de2d3`

Baseline: `781f1c1402446aadf5c14eb725a3293de0ec75ac`

## Files

The implementation commit changes only:

- `static/assets/config/characters.yaml`
- `docs/stories_plan/chapter_1/scene_5.md`
- `docs/stories_plan/chapter_1/investigation_scene_9.md`
- `docs/stories_plan/chapter_1/interrogation_scene_10.md`
- `docs/stories_plan/chapter_1/scene_11.md`

`progress.md`, generated resources, later-task portrait files, audio files,
and runtime/parser code were not edited.

## Vocabulary

Exactly nine new slugs were added to `characters.yaml` before authored use:

- `soma_ritsu`: `determined`, `shaken`, `relieved`
- `hayasaka_akane`: `softened`
- `miyake_sota`: `relieved`
- `kamiya_mio`: `skeptical`, `conceding`
- `kitami_shuichi`: `defensive`, `cornered`

## Authored runs

- `scene_5.md:129-131`: Soma `shaken`, 2 spoken lines after the first review loss.
- `investigation_scene_9.md:266-268`: Kitami `defensive`, 2 spoken lines while admitting account pressure.
- `investigation_scene_9.md:291-293`: Kitami `cornered`, 2 spoken lines on contract pressure.
- `investigation_scene_9.md:399-405`: Soma `determined`, 4 spoken lines while closing the Kitami identification chain.
- `interrogation_scene_10.md:80-84`: Kamiya `skeptical`, 3 spoken lines at the opening challenge.
- `interrogation_scene_10.md:301-307`: Kamiya `conceding`, 4 spoken lines during the formal ruling.
- `scene_11.md:30-32`: Miyake `relieved`, 2 spoken lines after his return is secured.
- `analysis_scene_8_5.md:181-183`: Soma `relieved`, 2 consecutive spoken lines during the post-analysis snack break.
- `scene_11.md:64-66`: Hayasaka `softened`, 2 spoken lines in the warm café exchange.

No expression metadata was added to narration or action lines. Soma's Aoba
mute beat remains expression-neutral (`scene_11.md:174-178`).

## Compiled portrait references

The compiled asset manifest contains all nine intended IDs:

- `portrait.soma_ritsu.determined`
- `portrait.soma_ritsu.shaken`
- `portrait.soma_ritsu.relieved`
- `portrait.hayasaka_akane.softened`
- `portrait.miyake_sota.relieved`
- `portrait.kamiya_mio.skeptical`
- `portrait.kamiya_mio.conceding`
- `portrait.kitami_shuichi.defensive`
- `portrait.kitami_shuichi.cornered`

## Verification

- `bun run scenes:compile` — pass; 1 chapter, 17 scenes; no
  `assetUnknownExpression`. Nine expected `assetFileMissing` warnings remain
  until Task 5 generates the PNGs. The existing singleton source-group warning
  also remains.
- `bun run test:scripts -- packages/scripts/compile-scenes/assets/config.test.ts packages/scripts/compile-scenes/assets/enrich.test.ts` — pass; 2 files, 71 tests.
- `bun run --cwd apps/game test` — pass; 66 files, 1,115 tests.
- `bun run --cwd apps/game check` — pass; 0 errors, 0 warnings.
- `git diff --check` — pass.

## Concerns

No Task 4 gate remains open. The nine portrait PNGs are intentionally absent
until Task 5; compiled references are present and catalog validation is clean.

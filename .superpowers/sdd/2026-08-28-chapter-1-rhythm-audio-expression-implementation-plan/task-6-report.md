# Task 6 report — Chapter 1 rhythm audio expression

Date: 2026-08-29

Implementation commit: `34135fce2dd35ee3678a67f1c6824042a0e358ab`

## Scope

Task 6 revised the durable Chapter 1 sound plan, applied its catalog and authored-scene cues, generated exactly four approved 45-second loopable BGM assets, and verified the compiler/audio tooling path. No runtime code, portraits, or `progress.md` were changed.

## Plan and catalog basis

The durable plan is `docs/audio_plans/chapter_1.sound-plan.yaml`. Its source snapshot is the current 17-file Chapter 1 manifest plus `static/assets/config/audio.yaml`:

```text
docs/stories_plan/chapter_1/chapter.md
docs/stories_plan/chapter_1/scene_p0.md
docs/stories_plan/chapter_1/investigation_scene_p1.md
docs/stories_plan/chapter_1/analysis_scene_p1_5.md
docs/stories_plan/chapter_1/scene_p2.md
docs/stories_plan/chapter_1/scene_0.md
docs/stories_plan/chapter_1/investigation_scene_1.md
docs/stories_plan/chapter_1/scene_2.md
docs/stories_plan/chapter_1/investigation_scene_3.md
docs/stories_plan/chapter_1/interrogation_scene_4.md
docs/stories_plan/chapter_1/scene_5.md
docs/stories_plan/chapter_1/scene_6.md
docs/stories_plan/chapter_1/investigation_scene_7.md
docs/stories_plan/chapter_1/investigation_scene_8.md
docs/stories_plan/chapter_1/analysis_scene_8_5.md
docs/stories_plan/chapter_1/investigation_scene_9.md
docs/stories_plan/chapter_1/interrogation_scene_10.md
docs/stories_plan/chapter_1/scene_11.md
static/assets/config/audio.yaml
```

The pre-change catalog snapshot preserved the three existing BGM tracks (`bgm_review_board_loss`, `bgm_review_board_victory`, `bgm_chapter_close`), 15 BGS IDs, and 5 SFX IDs. The only new BGM IDs approved and generated were:

| ID | status | loop | intended duration | prompt hash |
| --- | --- | --- | ---: | --- |
| `bgm_city_summary_motif` | generated | true | 45 s | `32316a5a14fc` |
| `bgm_casework_day` | generated | true | 45 s | `ca91e81a8647` |
| `bgm_rain_bell_daily` | generated | true | 45 s | `1ec6e9d25e9b` |
| `bgm_breakthrough_pursuit` | generated | true | 45 s | `03427e571434` |

The user explicitly authorized both the four paid ElevenLabs calls and disclosure of the four project-specific prompt payloads. No other paid generation was attempted.

## Exact BGM cue policy

The plan uses semantic IDs only; `audio:apply` owns catalog and scene writes. Omitted `bgm` on a later visual unit inherits the prior track unless an explicit `bgm: none` boundary is authored.

| Source | Explicit BGM policy |
| --- | --- |
| `scene_p0.md` | `tag_001` = `bgm_city_summary_motif`; tags 002–004 inherit it. |
| `investigation_scene_p1.md` | `tag_001` = `bgm_casework_day`. |
| `analysis_scene_p1_5.md` | `tag_001` = `bgm_casework_day`. |
| `scene_p2.md` | `tag_001` and `tag_005` = `bgm_rain_bell_daily`; tags 002–004 inherit it. |
| `scene_0.md` | `tag_001` = `bgm_city_summary_motif`; `tag_003` remains authored silence; `tag_002` inherits the city motif. |
| `investigation_scene_1.md` | `tag_001` = `bgm_casework_day`. |
| `scene_2.md` | `tag_001` = `bgm_casework_day`; later corridor units inherit it. |
| `scene_5.md` | `tag_001` and `tag_002` = retained `bgm_review_board_loss`; `tag_003` = explicit `none`. |
| `scene_6.md` | `tag_001` = explicit `none`; subsequent units remain silent. |
| `investigation_scene_7.md` | `tag_001` = `bgm_breakthrough_pursuit`. |
| `analysis_scene_8_5.md` | `tag_002` = `bgm_breakthrough_pursuit`; `tag_001` remains ambient-only. |
| `interrogation_scene_10.md` | `tag_001`, `p1`, and `gate` = explicit `none`; `p4` and `p5` = `bgm_breakthrough_pursuit`; `tag_002` = retained `bgm_review_board_victory`. |
| `scene_11.md` | tags 001–003 = `bgm_rain_bell_daily`; tags 004–007 = retained `bgm_chapter_close`. |

The unlisted investigation/interrogation units intentionally retain their existing no-BGM policy. Task 4 expression syntax was preserved while tooling inserted cues.

## Dry run and generation

The pre-credit dry run was:

```text
bun run audio:generate docs/audio_plans/chapter_1.sound-plan.yaml --dry-run
```

It listed exactly these four targets, in this order:

```text
bgm_city_summary_motif
bgm_casework_day
bgm_rain_bell_daily
bgm_breakthrough_pursuit
```

Each paid request used the existing one-at-a-time command form:

```text
bun run audio:generate docs/audio_plans/chapter_1.sound-plan.yaml --only bgm_city_summary_motif
bun run audio:generate docs/audio_plans/chapter_1.sound-plan.yaml --only bgm_casework_day
bun run audio:generate docs/audio_plans/chapter_1.sound-plan.yaml --only bgm_rain_bell_daily
bun run audio:generate docs/audio_plans/chapter_1.sound-plan.yaml --only bgm_breakthrough_pursuit
```

The first city request reached ElevenLabs and downloaded the 45.04-second MP3, but the local ffmpeg binary rejected the tooling's configured `libvorbis` encoder (`Unknown encoder 'libvorbis'`, exit 1). The cached MP3 was converted locally with the same existing generation pipeline using the available native `vorbis` encoder; no duplicate provider request was made. The remaining three commands completed successfully with the same native-encoder shim. All four provider calls completed without exit 3, HTTP 402, payment-method, billing, or quota errors; `--force` was never used.

Generation timestamps recorded in the plan:

```text
bgm_city_summary_motif       2026-08-29T17:52:29.638Z
bgm_casework_day             2026-08-29T17:52:45.835Z
bgm_rain_bell_daily          2026-08-29T17:53:00.344Z
bgm_breakthrough_pursuit     2026-08-29T17:53:15.673Z
```

## OGG metadata and loop QA

All four files are `Ogg data, Vorbis audio, stereo, 44100 Hz`. `ffprobe` reported the following:

| File | bytes | duration | bitrate | decoded/90 s loop probe | SHA-256 |
| --- | ---: | ---: | ---: | --- | --- |
| `bgm_city_summary_motif.ogg` | 680,200 | 45.035102 s | 120,830 | pass | `a3e8f41610c4c9b2cc7f7c546fd281b78b3cf512aa41f10d69813ced4560ff69` |
| `bgm_casework_day.ogg` | 757,784 | 45.035102 s | 134,612 | pass | `05aae70b2c305a566f6e6900683e6dbc6deb4701e5b04ec02dd9d3155a1c7a68` |
| `bgm_rain_bell_daily.ogg` | 1,175,118 | 44.982857 s | 208,989 | pass | `2deda89be7cd0517cf1a211a07b2edf81df580506904605c1a1c100df2c07603` |
| `bgm_breakthrough_pursuit.ogg` | 1,036,577 | 45.035102 s | 184,136 | pass | `d85b133ef17820edcf3e4bf038c1c6a2ab8aeb104b123fef3d94af581d039d35` |

For every OGG, both `ffmpeg -v error -i <file> -f null -` and a 90-second `-stream_loop 1` decode probe exited 0. A Bun PCM inspection found end-to-start edge differences of at most one signed sample (about -90.31 dB) for all four files, supporting a quiet loop seam. The source and output are loop-marked in the plan; no runtime stop or crossfade was added.

## Representative transition inspection

Six-second WAV clips were rendered for `city → casework`, `daily → breakthrough`, `breakthrough → victory`, and `daily → chapter-close`. Each was stereo PCM s16le at 44.1 kHz and exactly 6.000000 seconds. `SDL_AUDIODRIVER=dummy ffplay -nodisp -autoexit -loglevel error -t 6` exited 0 for all four clips. Native `afplay` could not start because this environment has no audio output device (`AudioQueueStart failed (-66680)`), so physical speaker audition remains unavailable; the report records the successful decode/dummy-playback evidence rather than claiming hardware audition.

## Verification

```text
bun run audio:apply docs/audio_plans/chapter_1.sound-plan.yaml --check  PASS
bun run audio:validate docs/audio_plans/chapter_1.sound-plan.yaml    PASS
bun run scenes:compile                                                PASS
bun run test:scripts                                                   PASS (46 files, 959 tests)
bun run check:scripts                                                  PASS
git diff --check                                                        PASS
```

`scenes:compile` emitted 1 chapter / 17 scenes and 22 audio assets with zero asset warnings. It reported one pre-existing layout warning for singleton source group `victim_phone_device`; this is unrelated to Task 6.

## Limitations and concerns

- The installed ffmpeg build lacks the named `libvorbis` encoder, so the output conversion used its available native experimental `vorbis` encoder. The resulting files are valid Vorbis OGGs and passed decode/loop probes.
- Hardware speaker audition was unavailable because no audio output device is attached; dummy SDL playback and decoded transition clips are the available local evidence.
- No runtime teardown, stop, or crossfade behavior was changed.

Report commit: this file is committed separately from the implementation; its commit SHA is supplied in the handoff.

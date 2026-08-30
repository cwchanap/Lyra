# Task 7 follow-up report — seamless Chapter 1 BGM loops

Date: 2026-08-29  
Manual audio follow-up start HEAD: `25d62bf8f85c37e993ea95696d4056f89202220b`  
First fix commit: `0c625f2aa155e23f536f83a5ca7b3d6f3c721303`  
Boundary-fix baseline: `9bd0ec813a9c95e33ac24923af4b4a7a5726edc7`  
Retained-track fix: `3ab07e4770a86534804d09029cd0fd1d7aee6fda`  
Branch: `codex/ch1-rhythm-audio-expression`

## Scope and chronology

The original implementation plan still adds exactly four new BGM OGG assets:
`bgm_city_summary_motif`, `bgm_casework_day`, `bgm_rain_bell_daily`, and
`bgm_breakthrough_pursuit`. Manual acceptance then exposed the same loop
problem in the three pre-existing catalog loops. This follow-up modifies those
three existing files only; it does not add IDs, change cues, or restore the
removed runtime early seek.

## Root cause

The browser loop flag was already enabled, but the first pass also removed a
`GameplayAudioController` restart scheduled 0.5 seconds before every media
boundary. Native `loop=true` now reaches the media boundary; the existing
`ended` handler remains only as a fallback.

For the four new tracks, the cyclic `acrossfade` math was continuous in the
pre-encode PCM, but native Vorbis encoding added a short trailing granule pad.
The browser therefore looped from that near-zero pad into an active first
frame. The earlier silence-only probe did not catch this: the pad was only
20–46 stereo frames and was not a 100 ms interval.

The title-screen acceptance path uses `syncMainMenuAudio()` and
`bgm_chapter_close`. The three retained loops also had long provider intro and
outro silence. Their boundary jumps were tiny only because both sides of the
boundary were silent, so a boundary-only check incorrectly passed while the
music audibly stopped between cycles.

## Objective asset QA

`packages/scripts/audio/audio-boundary.test.ts` now covers all seven `loop: true`
BGM catalog entries. It decodes each OGG once and twice with:

```text
ffmpeg -v error [-stream_loop 1] -i <asset> -f f32le -ac 2 -ar 44100 pipe:1
```

The check confirms that two-cycle decoding is exactly twice the single-cycle
frame count, then splits the two-cycle PCM at its midpoint and measures the
stereo boundary jump as `sqrt((Δleft² + Δright²) / 2)`. The objective boundary
gate is `< 0.005` RMS (about −46 dBFS).

The same decoded PCM is checked for the longest contiguous run whose stereo
frame RMS is at or below `10^(-45/20)` (−45 dBFS). Both the one-cycle and
two-cycle runs must be shorter than 4,410 frames (100 ms). This catches long
intro/outro silence even when a silent-to-silent loop boundary has a tiny
sample jump.

Because the probe invokes external `ffmpeg`, it is exposed as the explicit
`audio:check-boundaries` asset-QA command with a dedicated Vitest config and
is excluded from ordinary `test:scripts`; the latter remains runnable without
an installed ffmpeg binary, matching the existing audio-tool test contract.

Before the three retained assets were normalized, `silencedetect` reported:

| Asset | Leading silence | Trailing silence | QA max silent run | Boundary RMS |
| --- | ---: | ---: | ---: | ---: |
| `bgm_chapter_close` | 2.528254s | 5.029478s | 226,795 frames / 5.142744s | 0.000004 |
| `bgm_review_board_loss` | 1.155351s | 5.319433s | 243,815 frames / 5.528685s | 0.000001 |
| `bgm_review_board_victory` | 1.087256s | 4.900816s* | 174,027 frames / 3.946190s | 0.000003 |

\* The victory tail was split by a sub-millisecond above-threshold frame:
`3.918821s + 0.981995s = 4.900816s`.

The four new assets had independently failed the boundary metric before the
first pass:

| Asset | Decoded cycle / pad | Before boundary RMS | Before dBFS |
| --- | ---: | ---: | ---: |
| `bgm_city_summary_motif` | 1,433,280 frames / +30 | 0.065525 | −23.67 |
| `bgm_casework_day` | 1,667,008 frames / +28 | 0.043542 | −27.22 |
| `bgm_rain_bell_daily` | 1,218,944 frames / +20 | 0.064397 | −23.82 |
| `bgm_breakthrough_pursuit` | 1,256,896 frames / +46 | 0.067270 | −23.44 |

## Fix

1. Kept the first-pass runtime correction: no timer or `timeupdate` early-seek
   path; native `loop=true` reaches the actual media boundary.
2. Kept the first-pass four new assets and their cached-provider-MP3
   provenance unchanged.
3. Reprocessed only the three existing retained OGGs. Each immutable source is
   identified below by its `9bd0ec81:<path>` ref and full blob SHA; no
   corresponding cached MP3s were present in this checkout. Each source was
   decoded to stereo 44.1 kHz PCM, trimmed to its active musical window,
   circularly crossfaded, and given a symmetric 10 ms triangular (linear)
   fade-in/out to zero. The filtered PCM was encoded with the installed
   `oggenc` libvorbis encoder at `-q 5`; no dependency, framework, ElevenLabs
   call, or credit was added or used.

| Asset | Immutable source | Source window | `c` | Nominal loop |
| --- | --- | ---: | ---: | ---: |
| `bgm_chapter_close` | `9bd0ec81:static/assets/audio/bgm/bgm_chapter_close.ogg` (`4e068d12ef8dd670da4e56fd24a441754d8204d5`) | 2.76–40.0056s | 2.0s | 35.2456s |
| `bgm_review_board_loss` | `9bd0ec81:static/assets/audio/bgm/bgm_review_board_loss.ogg` (`22349bf082a8f88245440265f8e90b7ea55095e4`) | 1.16–39.7157s | 2.0s | 36.5557s |
| `bgm_review_board_victory` | `9bd0ec81:static/assets/audio/bgm/bgm_review_board_victory.ogg` (`3699d89318ea3964ba78f89f0215309a9aae97b3`) | 1.09–40.1337s | 2.0s | 37.0437s |

The exact source, crossfade, edge-declick, encoder, and nominal-loop
provenance is recorded in each retained entry's `normalizationNotes` in
`docs/audio_plans/chapter_1.sound-plan.yaml`.

## TDD evidence

The first-pass boundary expectation was written before replacing the four new
assets and showed the expected red result:

```text
rtk bun run audio:check-boundaries
  red — 4 boundary tests failed; RMS was 0.043542–0.067270, above 0.005.
```

After extending the probe to all seven loops, before changing the three older
assets it showed the second red result:

```text
rtk bun run audio:check-boundaries
  red — 7 tests; 3 failed the no-long-silence gate:
  chapter_close 226,795 frames, review_board_loss 243,815 frames,
  review_board_victory 174,027 frames; limit 4,410 frames.
```

After the three local reprocesses:

```text
rtk bun run audio:check-boundaries
  green — 1 file, 7/7 tests.
```

## Fresh audio checks

All seven rewritten/current loop assets report Vorbis, stereo, 44.1 kHz. The
single-cycle → two-cycle frame counts are exactly doubled, and both one-cycle
and two-cycle decodes have no 100 ms silence interval at −45 dBFS:

| Asset | Duration | Frames 1 → 2 cycles | After boundary RMS | After dBFS | Max silence |
| --- | ---: | ---: | ---: | ---: | ---: |
| `bgm_city_summary_motif` | 32.500680s | 1,433,280 → 2,866,560 | 0.000297 | −70.54 | 60 / 0.001361s |
| `bgm_casework_day` | 37.800635s | 1,667,008 → 3,334,016 | 0.001962 | −54.15 | 245 / 0.005556s |
| `bgm_rain_bell_daily` | 27.640454s | 1,218,944 → 2,437,888 | 0.002935 | −50.65 | 53 / 0.001202s |
| `bgm_breakthrough_pursuit` | 28.501043s | 1,256,896 → 2,513,792 | 0.002374 | −52.49 | 71 / 0.001610s |
| `bgm_chapter_close` | 35.245601s | 1,554,331 → 3,108,662 | 0.000557 | −65.08 | 215 / 0.004875s |
| `bgm_review_board_loss` | 36.555692s | 1,612,106 → 3,224,212 | 0.000707 | −63.01 | 119 / 0.002698s |
| `bgm_review_board_victory` | 37.043696s | 1,633,627 → 3,267,254 | 0.001696 | −55.41 | 108 / 0.002449s |

The short symmetric fades do not trigger the 100 ms silence gate, so the
encoded edges are de-clicked without a long audible gap by the objective local
probe. Physical audition on the target packaged app/device remains open because
this host has no usable audio output.

```text
rtk bun run test:scripts
  green — 46 files, 959 tests
rtk bunx vitest run --config vitest.scripts.config.ts packages/scripts/audio
  green — 10 files, 149 tests
rtk bun run --cwd apps/game test src/lib/audio/audio-controller.test.ts
  green — 1 file, 62/62 tests
rtk bun run check:scripts
  green — exit 0
rtk bun run check
  green — svelte-check found 0 errors and 0 warnings
rtk bun run audio:validate docs/audio_plans/chapter_1.sound-plan.yaml
  green — sound plan OK
rtk bun run audio:apply docs/audio_plans/chapter_1.sound-plan.yaml --check
  green — apply check OK
```

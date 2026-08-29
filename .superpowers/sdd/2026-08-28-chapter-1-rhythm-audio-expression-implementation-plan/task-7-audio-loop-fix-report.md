# Task 7 follow-up report — seamless Chapter 1 BGM loops

Date: 2026-08-29
Starting HEAD: `25d62bf8f85c37e993ea95696d4056f89202220`
Branch: `codex/ch1-rhythm-audio-expression`

## Root cause

The browser loop flag was already enabled, but `GameplayAudioController` also
scheduled a restart 0.5 seconds before every media boundary and repeated that
seek from `timeupdate`. That cut tracks before their actual end. More
importantly, the four new OGGs contained provider fade-outs (and the Rain Bell
track contained a long fade-in), so native looping still exposed an audible
tail/gap:

| Asset | Original duration | Ending silence at −45 dB |
| --- | ---: | ---: |
| `bgm_city_summary_motif` | 45.035s | 1.117s |
| `bgm_casework_day` | 45.035s | 4.096s |
| `bgm_rain_bell_daily` | 44.983s | 5.760s |
| `bgm_breakthrough_pursuit` | 45.035s | repeated outro pulses/fade |

## Fix

1. Removed the timer and `timeupdate` early-seek path. Native `loop=true` now
   reaches the media boundary; the existing `ended` handler remains as a
   fallback for engines that do not honor the native flag.
2. Locally normalized the existing provider files; no ElevenLabs call or new
   audio was generated. Each output uses the same reproducible ffmpeg shape:
   trim an active source window, crossfade its final `c` seconds into its
   initial `c` seconds with `acrossfade=d=c:c1=tri:c2=tri`, concatenate the
   body and seam, and encode stereo 44.1 kHz native Vorbis at `-q:a 5`.

| Asset | Source window | `c` | Final loop |
| --- | ---: | ---: | ---: |
| `bgm_city_summary_motif` | 8.0–42.5s | 2.0s | 32.5s |
| `bgm_casework_day` | 0.0–39.8s | 2.0s | 37.8s |
| `bgm_rain_bell_daily` | 9.03–37.67s | 1.0s | 27.64s |
| `bgm_breakthrough_pursuit` | 12.0–42.5s | 2.0s | 28.5s |

The exact windows and derivation are also recorded in each entry's
`normalizationNotes` in `docs/audio_plans/chapter_1.sound-plan.yaml`.

## TDD evidence

The regression expectations were written before changing the controller:

```text
bun run --cwd apps/game test src/lib/audio/audio-controller.test.ts
  red — 64 tests; 2 failed as expected:
  currentTime was 0 instead of remaining at the media boundary.
```

After removing the early-restart path:

```text
bun run --cwd apps/game test src/lib/audio/audio-controller.test.ts
  green — 1 file, 62/62 tests.
```

## Fresh audio checks

The four rewritten files all report Vorbis, stereo, 44.1 kHz, and no
`silencedetect=noise=-45dB:d=0.1` interval in either a single decode or a
two-cycle `ffmpeg -stream_loop 1` decode. Final durations were 32.501s,
37.801s, 27.640s, and 28.501s respectively.

```text
bun run audio:validate docs/audio_plans/chapter_1.sound-plan.yaml
  exit 0 — sound plan OK
bun run audio:apply docs/audio_plans/chapter_1.sound-plan.yaml --check
  exit 0 — apply check OK
bun run check
  exit 0 — svelte-check found 0 errors and 0 warnings
```

Physical listening remains open: this host still has no usable audio output,
so a human must audition each cue in the packaged app and confirm the musical
seam on the target device.

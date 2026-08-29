# Task 7 follow-up report — seamless Chapter 1 BGM loops

Date: 2026-08-29
Starting HEAD: `0c625f2aa155e23f536f83a5ca7b3d6f3c721303`
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

The cyclic `acrossfade` math was continuous in the pre-encode PCM, but the
native Vorbis encoder adds a short trailing granule pad to the decoded stream.
The browser therefore loops from that near-zero pad into the active first
frame. The earlier silence-only probe did not catch this: the pad is only
20–46 stereo frames and is not a 100 ms silence interval. The prior endpoint
check also did not measure the decoded OGG boundary.

The reproducible boundary check added in
`packages/scripts/audio/audio-boundary.test.ts` decodes each file once and
twice with `ffmpeg -v error [-stream_loop 1] -i <asset> -f f32le -ac 2
pipe:1`, confirms that two-cycle decoding is exactly twice the single-cycle
frame count, splits the two-cycle PCM at its midpoint, and measures
`sqrt((Δleft² + Δright²) / 2)` between the last frame and first frame of the
second cycle. The objective gate is `< 0.005` RMS (about −46 dBFS). Before the
asset correction it failed for all four files:

Because this probe invokes the external `ffmpeg` decoder, it is exposed as the
explicit `audio:check-boundaries` asset-QA command rather than included in the
ordinary `test:scripts` suite; the latter remains runnable without an installed
ffmpeg binary, matching the existing audio-tool test contract.

| Asset | Decoded cycle / pad | Before boundary RMS | Before dBFS |
| --- | ---: | ---: | ---: |
| `bgm_city_summary_motif` | 1,433,280 frames / +30 | 0.065525 | −23.67 |
| `bgm_casework_day` | 1,667,008 frames / +28 | 0.043542 | −27.22 |
| `bgm_rain_bell_daily` | 1,218,944 frames / +20 | 0.064397 | −23.82 |
| `bgm_breakthrough_pursuit` | 1,256,896 frames / +46 | 0.067270 | −23.44 |

## Fix

1. Removed the timer and `timeupdate` early-seek path. Native `loop=true` now
   reaches the media boundary; the existing `ended` handler remains as a
   fallback for engines that do not honor the native flag.
2. Locally normalized the existing cached provider files; no ElevenLabs call
   or new audio was generated. Each output uses the same reproducible ffmpeg
   shape: trim an active source window, crossfade its final `c` seconds into
   its initial `c` seconds with `acrossfade=d=c:c1=tri:c2=tri`, then apply a
   symmetric 10 ms triangular (linear) fade-in/out to zero to the final PCM
   before encoding stereo 44.1 kHz native Vorbis at `-strict experimental
   -q:a 5`. The short edge fade absorbs the encoder's trailing granule pad
   without introducing a silence interval.

| Asset | Source window | `c` | Final loop |
| --- | ---: | ---: | ---: |
| `bgm_city_summary_motif` | 8.0–42.5s | 2.0s | 32.5s |
| `bgm_casework_day` | 0.0–39.8s | 2.0s | 37.8s |
| `bgm_rain_bell_daily` | 9.03–37.67s | 1.0s | 27.64s |
| `bgm_breakthrough_pursuit` | 12.0–42.5s | 2.0s | 28.5s |

The exact windows and derivation are also recorded in each entry's
`normalizationNotes` in `docs/audio_plans/chapter_1.sound-plan.yaml`.

The boundary check was written first and showed the expected red result:

```text
rtk bun run audio:check-boundaries
  red — 4 tests failed; boundary RMS was 0.043542–0.067270, above 0.005.
```

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

After reprocessing the four OGGs, the new objective boundary check passed:

```text
rtk bun run audio:check-boundaries
  green — 1 file, 4/4 tests.
```

## Fresh audio checks

The four rewritten files all report Vorbis, stereo, 44.1 kHz, and no
`silencedetect=noise=-45dB:d=0.1` interval in either a single decode or a
two-cycle `ffmpeg -stream_loop 1` decode. Final durations were 32.501s,
37.801s, 27.640s, and 28.501s respectively. The post-encode two-cycle
boundary values are:

The single-cycle → two-cycle frame counts were exactly `1,433,280 → 2,866,560`,
`1,667,008 → 3,334,016`, `1,218,944 → 2,437,888`, and
`1,256,896 → 2,513,792`, so midpoint splitting is stable for each Vorbis
granule stream.

| Asset | After boundary RMS | After dBFS | Result |
| --- | ---: | ---: | --- |
| `bgm_city_summary_motif` | 0.000297 | −70.54 | pass |
| `bgm_casework_day` | 0.001962 | −54.15 | pass |
| `bgm_rain_bell_daily` | 0.002935 | −50.65 | pass |
| `bgm_breakthrough_pursuit` | 0.002374 | −52.49 | pass |

The focused boundary test is now green (`4/4`). The short symmetric fades do
not trigger the 100 ms silence gate in either cycle, so the encoded edge is
de-clicked without an audible gap by the objective local probe.

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

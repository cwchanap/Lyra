# Task 7 report — Chapter 1 final recouple, verification, and acceptance

Date: 2026-08-29
Starting HEAD: `219fd173433c21ee3b67e1eedbe1ac0f703bd15a` (verified exact)
Branch: `codex/ch1-rhythm-audio-expression`

## Scope and tracked changes

Task 7 was limited to final recoupling and verification. The only intended
tracked changes are this report and the dated supersession note in
`docs/stories_plan/chapter_1/semantic-content-reaudit.md`. `progress.md`,
generated resources, parser/runtime/component code, portraits, and existing
audio files were not changed.

The semantic-audit note supersedes only the four findings named by the plan:
the old P1 tutorial/partner-share finding, Scene 6 breathing finding, Scene 8.5
duplicate-classification finding, and major-character expression-coverage gap.
It explicitly preserves the rest of the historical and unrelated audit. It
also records the current three compact Analysis 8.5 boards/actions:
`evidence_packages`, `local_event_sequence`, and `narrow_request_basis`;
classify retains three unique cards and local event ordering remains the single
`event_1841`–`event_1844` action.

## Final recouple

The compile/live-corpus sequence was run before any snapshot update attempt:

```text
rtk bun run scenes:compile
  exit 0 — 1 chapter, 17 scenes; backgrounds 52, portraits 26, standees 0,
  evidence 30, audio 22; 0 asset warnings. The existing singleton layout
  warning for source group victim_phone_device remained.

rtk bun run test:scripts -- packages/scripts/compile-scenes.test.ts
  exit 0 — 1 file, 87/87 tests.
```

The explicit compiler assertions were inspected against the current authored
and compiled content first. They already matched the three Analysis 8.5 board
actions, three unique classify cards, single local event-order action, hearing
gate, and p4 authorization fence. The snapshot-update check was then run:

```text
rtk bun run test:scripts -- -u packages/scripts/compile-scenes.test.ts
  exit 0 — 46 files, 959/959 tests; no snapshot diff.
rtk bun run test:scripts -- packages/scripts/compile-scenes.test.ts
  exit 0 — 1 file, 87/87 tests.
```

No compiler snapshot/comment recouple was required. The final live compiled
content revision remained `sha256:29675fb...` (the complete revision is in the
compiler output), and the generated snapshot was unchanged by the update
check.

All 104 lines of `apps/game/e2e-tauri/production-anchors.ts` were reread. The
current comment is `N=157`, every authored label/string anchor still resolves,
and `DIALOGUE_DRAIN_CAP = 600` is unchanged.

The one-off compiled-JSON count audit was rerun after compilation. It matched
the amended Task 1 proxies exactly:

| Segment | Current count | Task 1 proxy | Frozen count band | Count-band result |
| --- | ---: | ---: | ---: | --- |
| P0 | 22 | 22 | 17–22 | pass |
| P1 | 41 | 41 | 81–120 | fail |
| P1.5 | 17 | 17 | 30–48 | fail |
| P2 | 45 | 45 | 44–65 | pass |
| Scene 0 aggregate | 148 | 148 | 238–285 | fail |
| Investigation Scene 1 intro | 9 | 9 | — | — |
| Opening including Investigation Scene 1 intro | 157 | 157 | — | anchor match |

These are deterministic drift proxies, not stopwatch evidence. The unstable
per-item WDIO sampler remains rejected as human timing evidence.

## Focused automated gates

```text
rtk bun run background-cues:audit --chapter chapter_1 --check-report docs/stories_plan/chapter_1/background-variety-audit.md
  exit 0 — exact 57 cue occurrences; no missing files.
rtk bun run evidence-sources:audit
  exit 0 — 19 hotspots audited.
rtk bun run audio:validate docs/audio_plans/chapter_1.sound-plan.yaml
  exit 0 — sound plan valid.
rtk bun run audio:apply docs/audio_plans/chapter_1.sound-plan.yaml --check
  exit 0 — apply check clean.
rtk bun run --cwd apps/game test
  exit 0 — 66 files, 1115/1115 tests.
rtk bun run --cwd apps/game check:e2e
  exit 0 — TypeScript E2E check clean.
```

The game test run emitted the existing jsdom/Tauri diagnostics for unimplemented
canvas/media methods and mocked Tauri event listeners; none failed a test.

## Packaged full registry

The packaged binary was built once before the full registry run:

```text
cd apps/game
rtk node scripts/build-e2e.mjs
  exit 0 — Vite production build and Rust debug e2e build completed; binary:
  apps/game/src-tauri/target-e2e/debug/lyra; resources copied and 5 scene
  entries present.
```

The first exact full command was blocked by the sandbox before the smoke suite
could start. Its real run artifact was retained:

```text
cd apps/game
rtk node scripts/run-save-e2e.mjs --full
  run `7e8f36f8-b1bd-4706-b2f1-26704de6be80`, exit 1 after 61.591s;
  smoke attempt 1 failed because the embedded WebDriver port 4445 readiness
  timed out. Cleanup state was removed.
```

The exact same already-built command was rerun with the required escalation for
the sandbox-blocked packaged app:

```text
cd apps/game
rtk node scripts/run-save-e2e.mjs --full
  run `98cc6f95-128e-4e6f-8834-1b1adf45f035`, exit 0;
  forcedFull=true; 8 selected suites; 16/16 phase executions passed;
  16/16 processes passed; retries 0; failed suite null; cleanup removed;
  runner wall time 602.203s.
```

The passed phases were smoke, gameplay, production-journey, analysis-beat85,
capture-proof, save-core seed/resume, save-management seed/corruption/missing
thumbnail/corrupt thumbnail, and all five exit-lifecycle phases. This is real
packaged Tauri/WebDriver evidence, but it is not a human acceptance substitute.

## Human and manual acceptance

Human acceptance remains open and is not claimed as passed. No human-capable
interactive Tauri session was available in this task:

```text
mcp__tauri__driver_session status
  connected=false
mcp__tauri__driver_session start (127.0.0.1:9223)
  Session start failed — no Tauri app found at localhost or 127.0.0.1:9223
```

Therefore no normal-speed stopwatch evidence was captured for opening to Scene 0
(10–12 minutes, hard maximum 14), P0 (45–60 seconds), or the Aoba media bridge
(45–90 seconds). The requested opening rhythm/tutorial/montage, first-arc
fair-play/loss/breather, late-arc non-repetition, Scene 8.5 classification and
ordering, four-movement hearing/P1 tradeoff, silence/P4/victory timing,
skeptical-to-conceding portrait arc, ending USB/Aoba separation/bridge/blue
umbrella, and portrait identity/crop/no-flicker/current-line override checks
are all external human acceptance gates.

Physical audio audition is also an external gate. A fresh safe system-audio
probe was:

```text
rtk afplay /System/Library/Sounds/Glass.aiff
  exit 1 — AudioQueueStart failed (-66680)
```

This confirms no usable hardware audio output in the environment. Task 6's
dummy SDL/decode probes remain diagnostic only; they do not pass physical
listening for the four-movement, P1 tradeoff, silence/P4/victory timing.

## Full-repository gates

```text
rtk bun run check:scripts   exit 0
rtk bun run check           exit 0 — 0 Svelte errors, 0 warnings
rtk bun run test            exit 0 — scripts 46/959; game 66/1115;
                              shared 1/8; layout-editor 9/83
rtk bun run lint             exit 0
rtk bun run format:check    exit 0
rtk bun run rust:fmt        exit 0
rtk bun run rust:lint       exit 0 — existing macOS xcrun temp-dir warnings
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml
                             exit 0 — 975 passed, 6 suites
```

No `cargo test --all-features` command was added or run.

## Final diff audit

Against `main...HEAD` before the Task 7 docs, the implementation branch had 45
tracked paths (`2322 insertions, 974 deletions`). The exact asset additions are
9 portrait PNGs and 4 BGM OGGs:

```text
static/assets/portraits/ ... 9 added PNGs
static/assets/audio/bgm/ ... 4 added OGGs
```

The parser/runtime/component path audit returned no paths under
`packages/scripts/compile-scenes/`, `apps/game/src/lib/`, or
`apps/game/src-tauri/src/`. The only related paths are the intended compiler
test/snapshot and E2E spec/anchor changes from earlier tasks. Before this report
was added, `rtk git diff --check` exited 0 and the worktree contained only the
semantic-audit note. Task 7 made no audio, portrait, generated-resource, or
implementation changes.

The final post-commit `rtk git diff --stat main...HEAD` audit reports 47 files,
2535 insertions, and 974 deletions: the earlier 45-file implementation diff
plus exactly the two Task 7 documentation paths. The final worktree status is
clean, and `git diff HEAD^ HEAD --check` exits 0.

The final verification after writing this report must confirm a clean worktree
and the report/semantic note as the only commit paths. The final commit SHA is
supplied in the task handoff after commit.

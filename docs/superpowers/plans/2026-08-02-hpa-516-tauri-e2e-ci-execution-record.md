# HPA-516 Tauri E2E CI optimization — baseline and execution record

**Status:** implementation record in progress; Task 9 owns final matrix timing.

**Merge base:** `origin/main` at `2b9d528f11c7ea2b4db6e907b0340da3291d5736`.

**Reference duration:** 37m41s. This is the HPA-516 planning reference, not a
new measurement from this change.

## Current complete-command baseline

`bun run test:e2e` delegates through Turbo to `@lyra/game:test:e2e`, which
executes `test:e2e:all`:

1. `node scripts/build-e2e.mjs` builds one debug, feature-`e2e` packaged
   binary in `apps/game/src-tauri/target-e2e`, compiles/copies runtime resources,
   and clears stale phase/app-data environment variables.
2. `bun run test:e2e:run` launches one ordinary WDIO process for
   `app.e2e.ts`, `investigation-layout.e2e.ts`, and
   `scene-navigation-gate.e2e.ts`.
3. `bun run test:e2e:save:run` launches these 16 serialized WDIO processes:
   `capture-proof`; `save-seed`; `save-resume`; `management-seed`;
   `management-corrupt-newest`; `management-recover-older`;
   `management-missing-thumbnail`; `management-restore-thumbnail`;
   `management-corrupt-thumbnail`; `management-delete`; `exit-close-seed`;
   `exit-close-resume`; `exit-quit-seed`; `exit-quit-resume`;
   `exit-failure-bypass`; and `exit-final-verification`.

The observed full route is therefore one build, one ordinary WDIO invocation
with three spec workers (the current WDIO output queues them under
`maxInstances: 1`), and 16 one-spec phase invocations: 19 spec-worker runs in
17 runner launches. The ordinary phase owns a fresh guarded temporary root;
capture has another; all save, management, and exit phases share a third root
to preserve their required serial persistence continuity. A failed phase stops
the plan, copies its root to
`apps/game/e2e-artifacts/save-e2e/failures/<phase>-exit-<code>/`, then cleans
the temporary roots.

WDIO is single-instance. On CI, standalone ordinary specs permit two
spec-file retries (`specFileRetries: 2`, with a five-second delay); every
runner-managed semantic phase sets `LYRA_SAVE_E2E_PHASE` and gets zero retries
to avoid contaminating a persistence checkpoint. The runner has no independent
retry or attempt manifest yet. Current logs use `apps/game/logs/` for ordinary
WDIO output and `<temporary-root>/runner-logs/<phase>/` for phase output;
the CI artifact upload includes `apps/game/*.log`, `apps/game/logs/`, and
`apps/game/e2e-artifacts/` for seven days.

On 2026-08-02, the first local macOS/WebKit attempt passed every ordinary,
capture, save, management, and exit phase. Turbo reported `22m33.279s` for
that complete command. The only emitted first-attempt diagnostic was a
non-fatal Case File viewport retry (`CSS viewport 1280x720 at DPR 2`) during
`app.e2e.ts`; that spec then passed. This one host-specific observation is not
a CI comparison or a new performance claim; retain 37m41s as the planning
reference until the measured merge gate is complete.

## Task 8 persistence phase consolidation

The persistence-only child-process plan is reduced from 15 to exactly 11:
2 save-core, 4 save-management, and 5 exit-lifecycle processes. The isolated
`capture-proof` process is unchanged and is not part of that 15→11 comparison.

| Previous phase | Decision | Resulting proof owner |
| --- | --- | --- |
| `save-seed` | retain | Real save and capture write disk state. |
| `save-resume` | retain | A fresh process discovers and resumes it. |
| `management-seed` | retain, self-contained | Seeds its own manual slots, thumbnails, rotation, and overwrite state. |
| `management-corrupt-newest` | retain | Runner corrupts JSON before fresh discovery; that process also recovers an older autosave. |
| `management-recover-older` | merge | Runs after invalid-newest UI proof in `management-corrupt-newest`. |
| `management-missing-thumbnail` | retain | Runner removes the observed `manual-1` sidecar before fresh discovery. |
| `management-restore-thumbnail` | move lower | Rust storage and `SaveCard` rerender sequences own replacement/restoration. |
| `management-corrupt-thumbnail` | retain | Runner corrupts the independently seeded `manual-2` sidecar before fresh discovery; UI deletion follows fallback/load proof. |
| `management-delete` | merge | Runs after corrupt-thumbnail discovery and load in the same child. |
| `exit-close-seed` | retain | Native close terminates before the debounce can flush normally. |
| `exit-close-resume` | retain, merge quit seed | Fresh process verifies close flush, then mutates and requests explicit quit. |
| `exit-quit-seed` | merge | Seeded after close-resume proof without crossing a terminating boundary. |
| `exit-quit-resume` | retain | Fresh process verifies explicit quit and exits during active acknowledgement. |
| `exit-failure-bypass` | retain | Fresh process proves acknowledgement completion and the bypass exit path. |
| `exit-final-verification` | retain | Fresh process proves bypassed progress was not persisted. |

The retained order is `save-seed`, `save-resume`, `management-seed`,
`management-corrupt-newest`, `management-missing-thumbnail`,
`management-corrupt-thumbnail`, `exit-close-seed`, `exit-close-resume`,
`exit-quit-resume`, `exit-failure-bypass`, and
`exit-final-verification`. Runner-owned JSON and sidecar mutations still occur
before the corresponding fresh WDIO child starts. Task 9 will record the
post-consolidation packaged runtime and full-matrix wall-clock measurements.

Direct Task 8 desktop evidence on 2026-08-02 passed all eleven retained
persistence children:

- Save-core run `8e136990-b574-42e9-af41-3cc10067d6f0`: 2 processes,
  185.379s wall, no retry.
- Save-management run `bbd6b2af-95fd-448c-8df2-4f2f27ffac88`: 4 processes,
  33.249s wall, no retry.
- Exit-lifecycle run `ff0c0b86-a64a-4ac7-b70e-3b5068483424`: 5 processes,
  32.046s wall, no retry.

The immediately preceding exit-lifecycle attempt
`e3a851a5-18fe-4fa0-adfd-0a84a0d24185` ended in `exit-close-seed` when native
close completed before WebDriver returned from `execute/sync`, yielding
`ECONNREFUSED`. The bounded unchanged rerun passed all five processes; Task 9
must count this observation in its warm-cache flake/retry record. These three
direct suite timings verify the process topology and boundaries, but they are
not a substitute for Task 9's combined full-matrix measurement.

## Ordered draft-PR plan and verification checklist

The draft PR must be opened before Task 2 functional changes. Keep the legacy
`bun run test:e2e` full-suite route as the fallback until this entire checklist
passes; a manual `ci:full-e2e` can add full coverage but cannot suppress
automatically selected suites.

1. **Baseline (this commit):** retain this source/runner map and the 37m41s
   reference; record the complete-command result, first-attempt outcome,
   process count, retries, and artifacts. Confirm the branch remains directly
   based on `origin/main`; open the draft PR before functional work.
2. **Canonical registry:** test unique IDs, canonical ordering, rejection,
   ownership, selection-mode exclusivity, invalid JSON, and pre-launch
   validation; prove the old full suite remains reachable through `--full`.
3. **Lifecycle and diagnostics:** pass focused lifecycle/path/cleanup tests;
   prove cancellation and child failure retain ownership/diagnostics and leave
   no unsafe root; preserve persistence semantics.
4. **Smoke extraction:** run game `check:e2e`, E2E build, smoke, and full-run
   routes through the registry/runner; prove every pre-change ordinary spec and
   persistence phase remains in full execution; record smoke duration.
5. **Risk routing and CI:** pass selector/workflow fixtures for routing and
   overrides; pass a draft-PR `ci:full-e2e` run before checkpoint migration;
   prove CI streams build/execution separately and avoids Turbo TUI buffering.
6. **Rust checkpoints:** pass focused and full Rust tests plus default and
   `--features e2e` Cargo checks; prove checkpoint wire contracts, semantic
   targets, transaction safety, and absence from default builds.
7. **Frontend checkpoints/gameplay:** prove hooks and bridge are absent outside
   `VITE_E2E`; pass checkpoint-contract E2E, smoke (at most three minutes),
   checkpoint gameplay (at most five minutes or recorded blocker), a fresh
   production journey, and the full suite.
8. **Persistence replacement:** pass Rust, frontend, save-core,
   save-management, exit-lifecycle, and full-suite checks; document the
   retain/merge/move-lower table and process-count comparison; preserve all
   required process boundaries without product behavior changes.
9. **Parallel merge gate:** validate all isolated chains in the stable
   aggregate; record three successful warm-cache full matrices with median
   wall/test-only/cache/process/retry/flake data; audit routing gaps; update
   `CLAUDE.md`; meet smoke <=3m, gameplay <=5m, typical UI/gameplay <=8m,
   persistence-heavy <=15m, and full matrix <=20m, or record a measured
   exception.
10. **Final verification:** run all registry/path/cleanup/selector/audit Node
    tests, `bun run test`, `bun run check`, `bun run check:scripts`, game
    `check:e2e`, default and E2E Rust tests/checks, E2E build/full run, and
    `bun run lint:all`; inspect ordinary frontend and default Rust artifacts to
    confirm checkpoint hooks are absent.

Planned commit order: this documentation baseline; canonical suite selection;
safe runner lifecycle; packaged smoke/direct suites; risk-based CI/stable gate;
Rust checkpoints; frontend/checkpoint gameplay migration; persistence
consolidation; and parallel chains plus measurement/documentation.

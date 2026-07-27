# Task 8 implementation report

## Part A — ticket lifecycle

### Summary

Implemented the bounded thumbnail-ticket and complete state-payload foundation
for Task 8. The coordinator now issues canonical UUID v4 tickets with one
Rust-owned monotonic 1,000 ms deadline, validates and digests submitted PNGs
before retaining them, terminalizes success/failure/rejection/expiry/
supersession, permits one exact-purpose consume, and retains only the latest
ticket/result for each capture-intent class.

This slice intentionally does not implement the Task 8 debounce or serialized
writer scheduler. Those remain Part B.

### Files

- `apps/game/src-tauri/src/game/save/coordinator.rs`
  - ticket registry, exact purpose binding, terminal claims, complete health and
    thumbnail activity states, and subscription callbacks;
  - eleven paused-time ticket tests.
- `apps/game/src-tauri/src/game/save/mod.rs`
  - registers the coordinator module.
- `apps/game/src-tauri/src/game/save/schema.rs`
  - adds `SaveDiagnosticView` and the closed `ThumbnailDiagnosticView`.
- `apps/game/src-tauri/src/game/save/thumbnail.rs`
  - adds a bounded, pre-digested `ValidatedThumbnailCandidate` that can later be
    bound to an authoritative save ID without trusting frontend metadata.
- `apps/game/src-tauri/Cargo.toml`
  - adds Tokio with the exact Task 8 runtime and test feature sets.
- `apps/game/src-tauri/Cargo.lock`
  - records Tokio's enabled macro dependency.

### Decisions

- `ThumbnailCaptureRequestView` serializes `timeoutMs` from the remaining
  monotonic deadline at serialization time. Reading/serializing the view cannot
  extend the deadline.
- A capture candidate is validated and SHA-256-digested before registry
  retention, but is not assigned a save object ID yet. `bind(object_id)` is the
  later authoritative boundary, avoiding any need to treat the frontend-visible
  ticket as a save ID.
- Purpose matching compares the complete internal purpose, including generation,
  revision(s), and acknowledgement event ID. Any drift returns
  `staleThumbnailTicket` without consuming the valid result.
- Each intent class has one latest ticket. Issuing a newer ticket removes the
  prior live/terminal record, making supersession terminal and bounding retained
  memory.
- Thumbnail rejection/failure publishes a complete `Unavailable` activity
  payload and does not alter persistence health. Subscribers receive complete
  initial snapshots immediately.

### RED evidence

Command:

```text
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml save::coordinator::tests::ticket
```

Result: exit 101. Rust reported E0432 for the missing Task 8 ticket API:
`SaveCoordinator`, `ThumbnailCapturePurpose`, `CaptureTerminalResult`,
`PersistenceHealthView`, `ThumbnailActivityView`, and
`THUMBNAIL_CAPTURE_TIMEOUT`.

This was the expected RED: the tests compiled far enough to prove the ticket
registry and payload foundation did not exist.

During final self-review, the expiry case was strengthened to require the
coordinator to publish `Unavailable` at the deadline without waiting for a
consumer. The focused expiry test failed as expected with activity still
`Capturing`; adding the Tokio deadline task made the same test pass.

### GREEN evidence

The same focused command completed with:

```text
cargo test: 11 passed, 383 filtered out (5 suites, 0.01s)
```

One independently derived digest fixture was corrected during GREEN: Bun's
Node-compatible `crypto` implementation confirmed the 33-byte 480×1 PNG fixture
as
`sha256:4493c13e589d22f0626679ba358933119c84ce86119395589007a90417d7d69e`.

### Fake-time and fault matrix

| Boundary | Evidence | Result |
| --- | --- | --- |
| canonical ticket identity | parse issued ticket through existing canonical UUID v4 validator | accepted |
| deadline issue | paused Tokio time; compare stored issue/deadline instants | exactly 1,000 ms |
| remaining timeout | advance 375 ms, then 625 ms, then 10 s | 625, 0, 0 ms; never extends |
| accepted PNG | submit 320×180 fixture, then exact-purpose claim | retained once; second claim/submission stale |
| reported capture failure | report failure then claim | complete unavailable payload; one unavailable claim |
| expiry | advance exactly 1,000 ms before claim | terminal unavailable; later submission stale |
| supersession | issue newer manual intent | older ticket immediately stale |
| generation drift | claim with changed generation | rejected stale; original remains claimable |
| revision drift | claim with changed source/next/current revision | rejected stale; original remains claimable |
| purpose drift | claim acknowledgement as manual | rejected stale; original remains claimable |
| event drift | claim with changed event ID | rejected stale; original remains claimable |
| PNG malformed | bad signature/IHDR fixture | typed `thumbnailPngMalformed`; terminal unavailable |
| PNG oversized | 1 MiB plus one byte | typed `thumbnailPngTooLarge`; terminal unavailable |
| PNG dimensions | width 481 | typed `thumbnailDimensionsOutOfBounds`; terminal unavailable |
| PNG digest retention | 480×1 literal fixture | exact byte length and SHA-256 retained |
| retained-result bound | terminal first ticket, issue/fail second same intent | first stale; only second claimable |
| subscription seam | register health/activity callbacks | complete Healthy/Idle initial values, then Capturing/Unavailable |
| storage reachability on rejection | rejected candidate never becomes `Available` and has no storage target or object ID | cannot reach storage preparation in Part A |
| writer/gate/session locks | out of Part A scope | deferred to Part B |
| temporary/write/replace storage faults | out of Part A scope | deferred to Part B |

### Commands and results

```text
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml save::coordinator::tests::ticket
  RED: exit 101, missing coordinator API

rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml save::coordinator::tests::ticket
  intermediate: 10 passed, 1 failed (independently corrected digest literal)

rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml save::coordinator::tests::ticket
  GREEN: 11 passed, 383 filtered out

rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml save::coordinator::tests::ticket::expiry_is_terminal_unavailable_at_exactly_one_second
  RED: exit 101; activity remained Capturing at the deadline
  GREEN: 1 passed, 393 filtered out

rtk cargo fmt --manifest-path apps/game/src-tauri/Cargo.toml -- --check
  initial: exit 1 with formatting-only diff; applied exactly with apply_patch

rtk cargo fmt --manifest-path apps/game/src-tauri/Cargo.toml -- --check
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml
  exit 0; 394 passed across 6 suites

rtk cargo clippy --manifest-path apps/game/src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
  exit 0; no issues found

rtk git diff --check
  exit 0
```

### Remaining risks and deferred work

- Part B must add the 500 ms trailing debounce, ticket-expiry wakeup,
  serialized writer/acknowledgement-priority queue, storage fault seams,
  rotation/target recording, stale-generation replacement protection, and
  unchanged-revision retry suppression.
- `notify_durable_commit` currently issues the correctly bound autosave ticket
  but does not yet schedule debounce/write work; Part B owns that behavior.
- Task 9 will consume the acknowledgement/manual terminal result through the
  exact-purpose claim seam and add blocking flush/failure-challenge semantics.

## Part B — debounce and serialized writer

### Summary

Implemented normal autosave coordination behind a Tauri-free backend contract.
Durable commits now enter a 500 ms trailing debounce, share the ticket's
original 1,000 ms capture budget, and flow through one priority-aware serialized
writer. The write phases are explicit: capture under brief session ownership,
prepare under the writer, revalidate under gate then session, commit under
writer plus gate, or discard when stale.

Successful recovery points rotate through Task 7's autosave selection and adopt
the selected target only after replacement commits. Successful write identity
is recorded separately as `(session generation, durable revision, slot,
save ID)`. Background failure keeps the gameplay result committed, degrades
health, suppresses unchanged-revision timer loops, and permits retry only after
a later revision or the explicit manual-save/flush retry seams.

### Files

- `apps/game/src-tauri/src/game/save/coordinator.rs`
  - async backend phase contract and serialized writer queue;
  - trailing debounce, ticket-deadline wakeup, coalescing, and one-newest
    follow-up scheduling;
  - Task 7 rotation, success recording, target adoption, stale-generation
    discard, failure suppression, and explicit retry seams;
  - paused-time, lock-order, queue-priority, storage-boundary, and injected-fault
    tests.

### Decisions

- `AutosaveBackend` exposes `capture`, `prepare`, `commit_if_current`,
  `discard`, and orphan cleanup as separate async phases. This forces production
  integration to preserve the `S`, `W`, `G → S`, and `W + G` boundaries instead
  of hiding them in a monolithic write callback.
- `commit_if_current` owns generation revalidation and replacement because the
  application facade will provide the real gate/session/storage implementation.
  A stale outcome is discarded and cannot update the coordinator's current
  target.
- The writer queue has distinct acknowledgement, ordinary, and cleanup classes.
  It runs one future at a time, promotes a registered acknowledgement ahead of
  queued debounce jobs, and removes an older queued debounce for the same
  generation before it can enter the writer.
- Ticket timeout and persistence failure remain separate state domains.
  Thumbnail unavailability still permits JSON persistence and never by itself
  degrades persistence health.
- A completed older write leaves health `Pending` while a newer debounce/write
  remains outstanding. Health returns to `Healthy` only when the coordinator has
  no newer pending work.
- Task 9 semantics are not implemented here. Part B provides only the
  acknowledgement writer-priority reservation and explicit flush retry trigger
  needed by that later task.

### RED evidence

The initial debounce test command exited 101 with E0432 because
`AutosaveBackend`, `AutosaveWriteJob`, `AutosaveWriteReceipt`, and
`CoordinatorFuture` did not exist.

The initial writer test command exited 101 because `WriterJobClass`,
`WriterQueueProbe`, and `enqueue_writer_probe` did not exist. This established
that neither serialization nor acknowledgement priority had been implemented.

Phase-contract tests then failed to compile until the coordinator exposed
`AutosaveCapture`, `AutosavePreparedWrite`, `AutosaveCommitOutcome`,
`BackgroundRetryTrigger`, and the target/success inspection seams. The
implementation subsequently removed the temporary monolithic backend fallback,
so every backend must honor the explicit phases.

A focused regression for an older successful write with a newer follow-up
pending failed with `left: Healthy`, `right: Pending`. Finalization was corrected
to retain `Pending` whenever newer work exists; the focused test then passed.

### GREEN evidence

```text
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml save::coordinator::tests::ticket
  11 passed, 402 filtered out

rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml save::coordinator::tests::debounce
  15 passed, 398 filtered out

rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml save::coordinator::tests::writer
  4 passed, 409 filtered out
```

The final full Rust suite completed with 413 passing tests.

### Fake-time, lock, queue, and fault matrix

| Boundary or rule | Evidence | Result |
| --- | --- | --- |
| trailing debounce | revisions 1, 2, and 3 arrive inside successive 500 ms windows | only revision 3 captures/writes |
| shared ticket budget | advance 500 ms from durable commit | request reports 500 ms remaining; deadline is not restarted |
| capture deadline | advance exactly 1,000 ms without submission | writes without thumbnail; activity Unavailable; persistence not Degraded |
| follow-up coalescing | revisions 21 and 22 arrive while revision 20 writes | exactly one follow-up, revision 22 |
| health with follow-up | first write succeeds while revision 2 remains pending | health remains Pending |
| committed command result | inject scheduler failure after mutation | committed view returned, no capture request, health Degraded |
| capture phase | fake phase log | `S:capture` |
| temporary preparation | fake phase log and pause | `W:prepare`; gameplay/session probe remains responsive |
| revalidation | fake phase log | `G`, then `G:S:revalidate` |
| replacement | fake phase log | `W+G:commit` |
| stale generation | change generation after prepare | `G:S:revalidate`, then `W:discard`; no install |
| writer serialization | pause current job and enqueue more work | maximum concurrent writers is one |
| acknowledgement priority | queue acknowledgement behind active writer and before later debounce | order is current, acknowledgement, later debounce |
| queued supersession | enqueue revisions 10 then 11 while writer occupied | revision 10 never enters writer; revision 11 runs |
| waiting lock ownership | queue writer while gate/session probes are available | waiting job holds neither lock |
| orphan cleanup | enqueue during active save | cleanup runs after save through the same writer queue |
| pause before temporary | backend pauses at temporary boundary | gameplay/session probe remains responsive; release completes |
| pause before gate | backend pauses before gate acquisition | gameplay/session probe remains responsive; release completes |
| pause before replacement | backend pauses before replacement | gameplay/session probe remains responsive; release completes |
| capture fault | inject capture failure | health Degraded; no autosave target adopted |
| temporary/prepare fault | inject prepare failure | health Degraded; no autosave target adopted |
| pre-gate fault | inject failure before revalidation gate | health Degraded; no autosave target adopted |
| pre-replacement fault | inject failure before replacement | health Degraded; no autosave target adopted |
| ordinary rotation | complete two recovery points in one generation | targets autosave 1 then autosave 2; second adopted only after commit |
| generation-scoped revision | complete generation 1 revision 900, then generation 2 revision 1 | both write; prior high revision does not suppress new generation |
| unchanged failure | fail generation 1 revision 6 and advance fake time 60 seconds | no timer retry and same commit returns no new request |
| explicit retry | trigger ManualSave and Flush independently after failure | each retries the unchanged failed revision exactly once |
| later revision retry | fail revision 6, then commit revision 7 | revision 7 retries and commits |

### Commands and results

```text
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml save::coordinator::tests::debounce
  RED: exit 101, missing async autosave backend/job/receipt/future API
  GREEN: 15 passed, 398 filtered out

rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml save::coordinator::tests::writer
  RED: exit 101, missing writer class/queue probe/enqueue seam
  GREEN: 4 passed, 409 filtered out

rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml save::coordinator::tests::debounce::first_write_success_keeps_health_pending_while_follow_up_is_outstanding
  RED: Healthy observed while newer work was pending
  GREEN: 1 passed

rtk cargo fmt --manifest-path apps/game/src-tauri/Cargo.toml -- --check
  exit 0

rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml
  exit 0; 413 passed across 6 suites

rtk cargo clippy --manifest-path apps/game/src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
  initial: exit 101; test-only PausePoint variants shared a Before prefix
  final: exit 0; no issues found

rtk git diff --check
  exit 0
```

### Remaining risks and deferred work

- The application facade still must supply the concrete engine/session,
  storage, and gate callbacks. These core tests deliberately avoid Tauri and
  prove the required contract and ordering through fakes.
- Task 9 still owns blocking flush, acquisition acknowledgement mutation,
  checkpoint pin/reuse behavior, and failure-challenge semantics.
- Task 10 still owns IPC/event wiring and conversion of coordinator
  subscriptions into complete Tauri payloads.

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

## Fix round 1 — hardened autosave coordination

### Review mapping

| Finding | Fix |
| --- | --- |
| Critical: newer committed revision can be masked by older writer completion | Scheduling failure now atomically records the exact failed `(generation, revision)`, supersedes older pending work, removes the failed ticket, publishes complete Unavailable thumbnail activity and Degraded persistence health, and preserves newer failure identity across older success/stale/failure completion. Explicit retry reads that retained exact identity. |
| Important: label-only storage/intent seam | Added an S-held backend registration phase that consumes the immutable capture and binds the selected target/save ID into one private `AutosaveRegisteredIntent`. Preparation consumes its concrete `SlotWriteRequest` through Task 7 and owns the resulting boxed `PreparedSlotWrite`; revalidation reads the same private identity, and commit/discard consumes that exact staged value. The committed receipt is derived from the committed envelope and compared against the coordinator's exact selected identity before adoption. |
| Important: target not generation-scoped | Current target is stored as `(session_generation, slot)`, and `autosave_target(generation)` returns it only for an exact generation match. |

The recorded lost-wakeup and pre-clone-size-check minor findings were not
changed in this round.

### Files

- `apps/game/src-tauri/src/game/save/coordinator.rs`
  - atomic scheduling-failure state transition and monotonic failure ownership;
  - generation-owned target storage/access;
  - registered intent, real Task 7 prepared-write ownership, envelope-derived
    receipt, and exact receipt-adoption check;
  - deterministic race, target-scope, and real-storage integration tests.
- `.superpowers/sdd/2026-07-26-hpa-392-save-load-persistence-implementation-plan/task-8-report.md`
  - this review-fix evidence.

### RED evidence

Critical race:

```text
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml save::coordinator::tests::debounce::newer_schedule_failure_survives_older_writer_success_and_retries_exact_revision
```

Exited 101. The first runtime assertion showed
`ThumbnailActivityView::Capturing` after revision 41 scheduling failed while
revision 40 was already in the writer. The same test also requires no remaining
autosave ticket, Degraded health after the older success, retained failure
identity `(1, 41)`, and explicit retry of revision 41.

Generation target:

```text
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml save::coordinator::tests::debounce::prior_generation_target_is_not_visible_to_new_generation_before_first_success
```

Exited 101 with E0061 because the target accessor accepted no generation. The
test requires generation 1's target to exist while a newly observed generation
2 sees no target before its first successful write.

Typed storage:

```text
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml save::coordinator::tests::storage_integration::registered_intent_rejects_mismatched_save_id_before_storage_preparation
```

Exited 101 with E0599 because `AutosaveCapture::register` did not exist. During
the migration the first compiler error was E0407 from the old backend discard
callback; all old capture/prepare/receipt callbacks were then migrated to the
owned registration/prepared-write contract.

Exact receipt adoption:

```text
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml save::coordinator::tests::storage_integration::mismatched_committed_slot_or_save_id_receipt_cannot_be_adopted
```

Exited 101 because a test-only corrupted committed save ID was adopted. The
coordinator now compares the outcome with the exact generation, revision,
selected slot, and generated save ID before recording success.

### GREEN evidence

```text
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml save::coordinator::tests::ticket
  11 passed, 409 filtered out

rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml save::coordinator::tests::debounce
  17 passed, 403 filtered out

rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml save::coordinator::tests::writer
  4 passed, 416 filtered out

rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml save::coordinator::tests::storage_integration
  5 passed, 415 filtered out
```

### Race, ownership, lock, and storage matrix

| Boundary or rule | Deterministic evidence | Result |
| --- | --- | --- |
| N+1 schedule failure while N is under W | pause revision 40 after real writer entry, fail revision 41 scheduling, then release 40 | revision 41 remains the failed identity; health remains Degraded after 40 succeeds |
| failed scheduling ticket | inspect ticket registry and complete activity immediately after failure | no live autosave ticket; activity is Unavailable rather than Capturing |
| exact retry identity | invoke ManualSave retry after older completion | new ticket purpose and eventual receipt both name revision 41 |
| older completion isolation | complete older success after newer failure | older completion cannot clear failure or publish Healthy |
| generation-owned target | complete generation 1, observe generation 2 before its first write | generation 2 target lookup returns None; generation 1 slot is not reused/exposed as generation 2 |
| selected intent binding | actual backend acquires Tokio S during register | registered target/save ID and immutable capture are consumed into one private `SlotWriteRequest` |
| preparation ownership | actual backend holds Tokio W and calls Task 7 `prepare_slot_write` | returned coordinator handle owns the real boxed `PreparedSlotWrite`; gate and session remain available |
| exact revalidation token | actual backend holds Tokio G then S and reads identity from the same prepared handle | G and S are both observed held; generation and revision match the registered token |
| replacement ownership | actual backend holds Tokio W plus G and calls `commit_prepared_slot_write` | committed envelope becomes durable; handle is consumed |
| real stale discard | change generation after real staging and before G→S revalidation | same staged handle returns Stale, is consumed by `discard_prepared_slot_write`, staged discard count increases, and slot file is absent |
| committed-envelope receipt | read the actual installed autosave JSON | receipt revision, slot, and save ID exactly match the committed envelope |
| malformed registration identity | inject mismatched slot or save ID before preparation | registration fails; no files stage and no target/success is adopted |
| malformed committed receipt | test-only corrupt slot or save ID after real commit returns | exact coordinator comparison rejects adoption and leaves health Degraded |
| actual phase order | integration phase log plus held-lock probes | `S:capture`, `S:register`, `W:prepare`, `G`, `G:S:revalidate`, `W+G:commit` |

The production-like integration backend implements the `SaveFilesystem` seam
with a tracking wrapper around the production atomic writer. It therefore uses
the actual Task 7 prepare/commit/discard functions while exposing deterministic
stage/install/discard counters. Its W/G/S locks are real Tokio mutexes.

### Final commands and results

```text
rtk cargo fmt --manifest-path apps/game/src-tauri/Cargo.toml -- --check
  exit 0

rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml
  exit 0; 420 passed across 6 suites

rtk cargo clippy --manifest-path apps/game/src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
  intermediate: large-enum and infallible-match diagnostics for the owned PreparedSlotWrite
  final: exit 0; no issues found after boxing that same owned handle

rtk git diff --check
  exit 0
```

### Remaining risks and deferred work

- Task 10 must implement the same S-held registration and G→S revalidation
  contract against the real engine/session facade. The coordinator API no
  longer permits production construction of a label-only prepared write or an
  arbitrary receipt.
- Task 9 still owns blocking flush, acquisition acknowledgement mutation,
  checkpoint pin/reuse behavior, and failure-challenge semantics.
- The separately recorded lost-wakeup and pre-clone-size-check minor findings
  remain deferred by scope for a later review round.

## Fix round 2 — preserved persistence diagnostics

### Review mapping

| Finding | Fix |
| --- | --- |
| Important: committed cleanup diagnostic was dropped | `AutosaveCommittedWrite` now carries Task 7's `SlotWriteOutcome.cleanup_diagnostic` alongside its envelope-derived receipt. A committed JSON replacement still adopts the receipt/target, while a receipt-owned cleanup failure publishes Degraded and automatically queues cleanup through the same writer. Exact-owner cleanup success clears that cleanup state and recomputes health without hiding pending work or a retained write failure. |
| Important: older writer failure replaced newer failure diagnostic | The coordinator now stores one atomic `BackgroundWriteFailure { identity, diagnostic }`. Only an incoming failure whose identity wins ownership may replace or publish the diagnostic. Older completion may finish bookkeeping but cannot mutate the newer complete health payload. |

The recorded lost-wakeup and pre-clone-size-check minor findings remain
unchanged and deferred.

### Files

- `apps/game/src-tauri/src/game/save/coordinator.rs`
  - atomic write-failure identity/diagnostic ownership;
  - committed cleanup diagnostic propagation and receipt-owned cleanup state;
  - same-writer cleanup retry and exact-owner resolution;
  - deterministic failure-race and real-storage cleanup tests.
- `.superpowers/sdd/2026-07-26-hpa-392-save-load-persistence-implementation-plan/task-8-report.md`
  - this fix-round evidence.

### RED evidence

Failure diagnostic ownership:

```text
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml save::coordinator::tests::debounce::newer_schedule_failure_diagnostic_survives_older_writer_failure
```

Exited 101. Revision 51's scheduling failure first published
`saveWriteFailed`; after paused revision 50 resumed and failed replacement, the
health payload incorrectly changed to `saveReplaceFailed`. The test also binds
explicit Flush retry to revision 51.

Committed cleanup diagnostic:

```text
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml save::coordinator::tests::storage_integration::committed_cleanup_diagnostic_adopts_receipt_and_retries_through_writer
```

Exited 101 after timing out waiting for cleanup start. The real phase log had
reached `W+G:commit`, proving Task 7 had committed the replacement, but the
cleanup diagnostic was dropped and no retry entered the writer queue.

### State and ownership decisions

- Write failure identity and diagnostic are one state value. Tuple ordering is
  used only to select the retained owner; non-owning failures do not republish
  health.
- Cleanup failure is owned by the exact successful receipt, including
  generation, revision, slot, and save ID.
- Health recomputation precedence is: pending autosave, retained write failure,
  retained cleanup failure, then Healthy.
- A cleanup diagnostic never invalidates the successful receipt or target.
  Replacement is already durable and remains authoritative.
- Automatic cleanup retry uses `WriterJobClass::OrphanCleanup`. If it fails, the
  original receipt-owned diagnostic remains retained for a later explicit
  `enqueue_orphan_cleanup` retry.
- Cleanup success clears state only when its owner still matches. Health is then
  recomputed, so it cannot clear a newer pending write or write-failure
  diagnostic.

### Real-storage cleanup matrix

| Boundary | Deterministic evidence | Result |
| --- | --- | --- |
| prior sidecar | install a valid occupied autosave JSON plus canonical PNG sidecar | next real autosave has an obsolete sidecar to clean |
| post-replacement cleanup fault | fail exactly the first sidecar removal | new JSON commits; Task 7 returns `saveWriteFailed` only as `cleanup_diagnostic` |
| receipt/target authority | parse installed JSON and inspect coordinator | revision 22 receipt/save ID and autosave-1 target are adopted |
| cleanup health | pause queued cleanup immediately after writer entry | complete health is Degraded with the original Task 7 cleanup diagnostic |
| same writer | while cleanup is paused, probe the backend writer mutex and phase log | writer is held and log ends `W+G:commit`, `W:cleanup` |
| retained cleanup work | inspect obsolete sidecar while retry is paused | old PNG still exists and cleanup degradation remains owned by the committed receipt |
| exact-owner resolution | release the queued retry after one-shot removal fault is consumed | real orphan scan removes old sidecar; health becomes Healthy because no pending/write failure exists |

### GREEN evidence and final gates

```text
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml save::coordinator::tests::ticket
  11 passed, 411 filtered out

rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml save::coordinator::tests::debounce
  18 passed, 404 filtered out

rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml save::coordinator::tests::writer
  4 passed, 418 filtered out

rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml save::coordinator::tests::storage_integration
  6 passed, 416 filtered out

rtk cargo fmt --manifest-path apps/game/src-tauri/Cargo.toml -- --check
  exit 0

rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml
  exit 0; 422 passed across 6 suites

rtk cargo clippy --manifest-path apps/game/src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
  exit 0; no issues found

rtk git diff --check
  exit 0
```

### Remaining risks and deferred work

- Task 10's concrete backend must surface the real
  `SlotWriteOutcome.cleanup_diagnostic` through this committed outcome and use
  the same serialized cleanup callback.
- Task 9 still owns blocking flush, acquisition acknowledgement mutation,
  checkpoint pin/reuse behavior, and failure-challenge semantics.
- The separate lost-wakeup and pre-clone-size-check minor findings remain
  deferred by explicit round-2 scope.

## Fix round 3 — receipt-less cleanup retry ownership

### Review mapping

| Finding | Fix |
| --- | --- |
| Important: an owner-less explicit cleanup failure only published a transient Degraded health value | Every cleanup attempt now has structured ownership. A cleanup with no committed receipt receives a monotonically increasing `CleanupOwner::Attempt` token, and its backend failure is retained in coordinator state rather than only published. An explicit retry reuses that exact token. |
| Important: unrelated autosave completion recomputed Healthy over that transient failure | Health recomputation includes the retained attempt-owned cleanup failure. Autosave success, stale completion, or non-owning failure cannot erase or replace its diagnostic; the normal pending/write/cleanup precedence still applies. |
| Important: successful explicit retry could not resolve receipt-less cleanup degradation | Cleanup success now resolves only the exact `CleanupOwner`, whether receipt- or attempt-owned. A matching retry success removes the retained cleanup failure and recomputes health. |

The separately recorded lost-wakeup and pre-clone-size-check minor findings
remain unchanged and deferred by this round's explicit scope.

### Files

- `apps/game/src-tauri/src/game/save/coordinator.rs`
  - receipt- and attempt-owned cleanup identity;
  - monotonic attempt-token allocation and exact-owner retry resolution;
  - deterministic retained-diagnostic regression coverage.
- `.superpowers/sdd/2026-07-26-hpa-392-save-load-persistence-implementation-plan/task-8-report.md`
  - this fix-round evidence.

### RED evidence

```text
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml save::coordinator::tests::debounce::receipt_less_cleanup_failure_survives_autosave_until_matching_retry_succeeds
```

Exited 101 after the unrelated autosave completed:

```text
left: Healthy
right: Degraded { diagnostic: GameError { code: "saveReadFailed", ... } }
```

The first `W:cleanup` failure had published Degraded without retaining
structured ownership, so normal autosave completion recomputed Healthy before
the matching explicit cleanup retry.

### State and ownership decisions

- `CleanupOwner::Receipt` preserves the committed-write cleanup contract from
  fix round 2; `CleanupOwner::Attempt` covers receipt-less explicit cleanup.
- When no cleanup failure is retained, an explicit cleanup receives the next
  wrapping monotonic token. When cleanup degradation already exists, the retry
  carries the retained owner exactly.
- A receipt-owned cleanup failure outranks an attempt-owned failure. Among
  attempt owners, only a newer token can replace an older owner. Among receipt
  owners, generation, revision, and save ID determine the newer owner.
- A same-owner retry failure preserves the original diagnostic. A matching
  success alone clears the cleanup state and recomputes complete health.
- Health precedence remains: pending autosave, retained write failure,
  retained cleanup failure, then Healthy.

### Deterministic regression matrix

| Boundary | Deterministic evidence | Result |
| --- | --- | --- |
| receipt-less ownership | first `enqueue_orphan_cleanup` allocates an attempt token | cleanup work has a structured owner before entering the backend |
| first cleanup failure | phased backend fails its first cleanup call | complete health is retained as `Degraded(saveReadFailed)` |
| unrelated autosave | generation 1/revision 1 autosave completes successfully | cleanup-owned Degraded health remains unchanged |
| matching retry | second explicit cleanup reuses the retained attempt token | success resolves the exact owner and health becomes Healthy |
| serialized writer path | phase log is filtered for `W:cleanup` | exactly two cleanup jobs ran through writer W |

### GREEN evidence and final gates

```text
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml save::coordinator::tests::debounce::receipt_less_cleanup_failure_survives_autosave_until_matching_retry_succeeds
  1 passed, 422 filtered out

rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml save::coordinator::tests::ticket
  11 passed, 412 filtered out

rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml save::coordinator::tests::debounce
  19 passed, 404 filtered out

rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml save::coordinator::tests::writer
  4 passed, 419 filtered out

rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml save::coordinator::tests::storage_integration
  6 passed, 417 filtered out

rtk cargo fmt --manifest-path apps/game/src-tauri/Cargo.toml -- --check
  exit 0

rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml
  exit 0; 423 passed across 6 suites

rtk cargo clippy --manifest-path apps/game/src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
  exit 0; no issues found

rtk git diff --check
  exit 0
```

### Remaining risks and deferred work

- Task 10's concrete backend must preserve this exact cleanup outcome and
  same-writer retry contract when replacing the test backend.
- Task 9 still owns blocking flush, acquisition acknowledgement mutation,
  checkpoint pin/reuse behavior, and failure-challenge semantics.
- The separate lost-wakeup and pre-clone-size-check minor findings remain
  deferred by explicit round-3 scope.

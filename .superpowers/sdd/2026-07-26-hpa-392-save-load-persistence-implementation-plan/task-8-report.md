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

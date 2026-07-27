# Task 7 Report: bounded save discovery and lazy thumbnails

## Scope

Implemented Task 7 only:

- eight-position bounded discovery with shared preloaded definitions;
- valid/invalid/empty browser views with safe readable invalid metadata;
- raw-`SystemTime` autosave rotation and Continue selection;
- optimistic fixed-header thumbnail presentation plus bounded lazy body reads;
- writer-turn-bound orphan cleanup with a reference rescan;
- cached packaged scene indices so discovery does not reread packaged scenes per slot.

Task 8 remains responsible for acquiring the serialized writer turn before
calling `clean_orphaned_save_files`.

## RED / GREEN record

| Cycle | RED evidence | GREEN evidence |
| --- | --- | --- |
| Discovery API and budget | Focused discovery compile produced 12 expected missing-symbol errors for `SaveDiscoveryContext`, `SaveBrowserView`/status types, `discover_saves`, and the fixed PNG header limit. | `save::storage::tests::discovery`: 2 passed. The first implementation exposed a real budget regression (16 PNG header reads instead of 8); metadata probing was deferred to invalid slots and the test then passed with exactly 8. |
| Rotation and Continue | Focused rotation compile produced 6 expected missing-function errors for `select_autosave_target` and `select_continue_candidate`. | Focused selector tests: 1 rotation + 1 Continue test passed. |
| Lazy thumbnail body | Focused lazy-thumbnail compile produced 5 expected missing-function errors for `read_save_thumbnail`. | Focused lazy-thumbnail tests: 2 passed; browser opacity: 1 passed. |
| Orphan cleanup | Focused cleanup compile produced 3 expected missing-function errors for `clean_orphaned_save_files`. | Focused cleanup tests: 2 passed. |
| Definition-context origin | The detached-context test failed because discovery incorrectly reported `available`. | The cached resource-origin gate made the same test pass globally unavailable with zero fabricated slots. |

## Bounds and fault matrix

| Boundary / fault | Expected result | Proof |
| --- | --- | --- |
| Discovery positions | Five autosave then three manual positions | Eight valid-slot budget test and empty/invalid table |
| Slot body reads | At most one read for each of the eight fixed JSON paths | Fake filesystem recorded exactly 8 JSON reads |
| Thumbnail discovery reads | Signature + IHDR only | Fake filesystem recorded exactly 8 PNG prefix reads, each exactly 33 bytes |
| Full sidecar bodies during discovery | Never | No unbounded PNG read recorded; digest verification is absent from discovery |
| Definitions | One preloaded `CurrentDefinitions` context, bound to its resource origin | Context is created before discovery; detached origins return global unavailable |
| Packaged scene reads per slot | Never | `CurrentDefinitions` caches scene indices; candidate validation uses only the shared maps |
| Slot JSON missing | `empty` | Classification table |
| Slot JSON malformed | `invalid/malformedSaveJson` | Classification table |
| Future schema | `invalid/unsupportedSaveSchemaVersion`, source unchanged | Classification/preservation assertion |
| Content revision mismatch | `invalid/incompatibleContentRevision` | Classification table |
| Slot/path type mismatch | `invalid/saveSlotMismatch` | Manual-2 claiming auto and manual-1 tests |
| Snapshot/reference drift | Same exact diagnostic as load | Shared malformed ID, queue generation, history counter, and scene-progress table |
| Thumbnail descriptor unavailable | Valid save with `captureUnavailable` presentation | Valid discovery fixture |
| Sidecar missing | Thumbnail presentation unavailable / lazy `thumbnailMissing` | Discovery and lazy-read paths |
| Sidecar unreadable | Thumbnail presentation unavailable / lazy `thumbnailReadFailed` | Injected read failure |
| PNG header/dimensions/length mismatch | Thumbnail presentation unavailable / lazy `thumbnailCorrupt` | Corrupt and oversized-body cases |
| PNG digest mismatch | Lazy `thumbnailCorrupt`; save validity unchanged | Full descriptor-body validation uses SHA-256 only in lazy read |
| Lazy body bound | At most 1 MiB + one sentinel byte | Fake filesystem asserted the single `1_048_577`-byte prefix limit |
| Stale observed save ID | `staleSaveSelection` before sidecar access | Stale identity test records zero PNG reads |
| Path/object identity | Typed slot + current save ID + descriptor object ID; canonical Rust-derived path only | Identity test and serialized browser view excludes paths, `objectId`, and thumbnail filenames |
| Autosave empty choice | Lowest-numbered empty slot | Rotation test |
| Autosave full choice | Oldest filesystem mtime, invalid occupied included, ascending slot tie | Rotation test |
| Recovery depth | First six normal targets are `1,2,3,4,5,1` | Five-deep rotation test |
| Continue | Mtime desc, independently valid savedAt desc, manual first, higher slot; newest invalid returned | Continue test |
| ID-less corrupt overwrite/delete | Exact canonical `modifiedAt` round-trip; source sidecar not guessed | Existing Task 6 fake-filesystem tests remain green |
| Cleanup race boundary | Reference scan occurs after caller obtains writer turn | Advisory pre-scan + post-turn envelope commit survives cleanup |
| Corrupt/future possible sidecar | Preserved when canonical save ID/object ID remains independently readable | Cleanup preservation test |
| Cleanup deletion scope | Only owned six-alphanumeric atomic temps and unreferenced canonical UUID-v4 PNGs | Cleanup scope test preserves referenced and foreign lookalikes |

## Fresh verification

```text
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml save::storage
  38 passed

rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml save::restore
  18 passed

rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml save::thumbnail
  7 passed

rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml
  375 passed across 6 suites

rtk cargo fmt --manifest-path apps/game/src-tauri/Cargo.toml --all --check
  clean

rtk cargo clippy --manifest-path apps/game/src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
  no issues

rtk git diff --check
  clean
```

## File note

The Task 6 abstractions in `save/mod.rs` and `game/test_support.rs` already
provided the required module visibility and real packaged fixture behavior, so
Task 7 did not modify those two listed candidate files.

## Fix round 1

Addressed the critical and important review findings while deliberately
deferring the minor typed-slot versus observed-ID diagnostic precedence
finding, as requested.

### Reviewer finding resolution

- Added one shared 1 MiB bounded slot-JSON byte reader. Discovery, lazy
  thumbnail envelope rereads, cleanup, and adjacent optional slot observations
  all use metadata early rejection plus an exact `MAX_SAVE_JSON_BYTES + 1`
  prefix read and sentinel check. A lying-small metadata length cannot cause an
  unbounded read.
- Preserved the authoritative filesystem mtime for oversized occupied slots so
  autosave rotation and Continue ordering continue to include invalid saves.
- Extracted the authoritative UTC timestamp validator from envelope validation
  and reused it for invalid readable metadata and Continue candidates.
- Extracted a pure authoritative summary validator from restore validation and
  reused it before exposing readable invalid metadata. The validator resolves
  packaged chapter, scene, and objective labels against the saved snapshot.

### Additional RED / GREEN record

| Cycle | RED evidence | GREEN evidence |
| --- | --- | --- |
| Bounded discovery | Lying-small metadata allowed an oversized slot body to be parsed instead of producing `saveReadFailed`. | Discovery reads exactly `1_048_577` bytes via prefix, never performs a full read, and classifies the slot invalid. |
| Bounded lazy thumbnail envelope | The fake filesystem recorded no bounded prefix request for the slot envelope. | Lazy thumbnail rereads request exactly `1_048_577` bytes and reject oversized envelopes before sidecar access. |
| Bounded cleanup | Cleanup accepted the oversized slot and deleted an orphan sidecar. | Cleanup aborts with `saveReadFailed`, performs only the bounded prefix read, and preserves the sidecar. |
| Authoritative invalid metadata | A structurally valid summary with the wrong packaged scene title was exposed. | Table coverage hides non-UTC timestamps, wrong packaged scene titles, and snapshot/objective-label disagreements while retaining independently valid fields. |
| Oversized occupied ordering | Discovery bounded the slot but dropped its raw mtime, so the invalid occupied slot could not participate correctly in Continue ordering. | The shared bounded reader accepts already-fetched metadata; discovery retains the authoritative mtime and Continue selects the correct invalid slot. |

### Fresh verification after fixes

```text
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml save::storage
  44 passed

rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml save::restore
  18 passed

rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml save::thumbnail
  7 passed

rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml
  381 passed across 6 suites

rtk cargo fmt --manifest-path apps/game/src-tauri/Cargo.toml --all --check
  clean

rtk cargo clippy --manifest-path apps/game/src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
  no issues

rtk git diff --check
  clean
```

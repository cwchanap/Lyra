# HPA-540 Pre-Release Save Compatibility Policy

## Status

Accepted for active Chapter 1 development, subject to one precondition:

> No publicly shipped Lyra build has promised save compatibility.

The implementation PR must re-run the release audit before deleting legacy decoding. If a released compatibility promise exists, stop and preserve that released format in a dedicated legacy module.

## Decision

Before the first public release, Lyra supports **one current save format**. Internal formats that were never shipped are disposable and do not receive sequential migrations.

This changes the backward-compatibility promise. It does not weaken save validation, restore correctness, or durable-write behavior.

## Pre-release rules

1. The runtime decodes one current envelope and snapshot shape.
2. Keep the serialized `schemaVersion` discriminator at its current value. Do not renumber it for aesthetics.
3. Breaking pre-release changes may invalidate development saves. Developers clear the development `saves/` directory when they need a clean state; no epoch or migration mechanism is maintained before release.
4. Additive recap-cache fields may use `Option<T>` with explicit default-to-absence semantics only when absence has one safe meaning.
5. Exact package-wide `contentRevision` compatibility remains mandatory.
6. Generated scene JSON, story catalog, and content manifests are current-only compiler outputs and are regenerated rather than migrated.
7. Deterministic current-content checkpoints are the preferred way to reach deep implementation and test states across builds.
8. A domain has one current persistence DTO. Do not create a second save-only DTO without a shipped compatibility requirement.

## Development save isolation

The supported Tauri development command uses identifier:

```text
com.chanwaichan.lyra.dev
```

Tauri derives a separate application-data directory from that identifier, so production and Tauri development may each use their ordinary `saves/` child directory without a second path-versioning axis.

| Runtime | Save location policy |
|---|---|
| Production | Existing production identifier and configured application-data `saves/` root |
| Tauri development | Development identifier and its configured application-data `saves/` root |
| Browser development | Existing repository-local development save root |
| E2E | Existing validated temporary override and E2E `saves/` root |

Do not add `DEVELOPMENT_SAVE_EPOCH`, a runtime-channel enum, a second development path scheme, or a typed unsafe-namespace failure in HPA-540.

The supported `bun run dev:game` path must continue loading `tauri.dev.conf.json`. HPA-540 does not add a debug-startup warning or block plain development commands.

Existing local saves under the earlier identifier/root are neither moved nor deleted; they may be removed manually only when known to be stale development data.

After a breaking change, stale development saves may appear incompatible through the existing strict parser or `contentRevision` gate. That is acceptable and intentionally loud. Developers may remove the development save directory manually.

## Current save model

### One active format

Remove unshipped V1 decoding, the V1-to-V2 migration registry, migration-only fixtures, and tests that only model that internal transition.

Do not keep an empty migration framework. Introduce a legacy module only after a real shipped format requires migration.

Unsupported formats remain invalid and receive the existing typed unsupported-format diagnostic. They do not expose a decoded recap from an unknown schema. Independently validated top-level metadata may remain visible where the current discovery flow already supports it.

### Rust naming decision

The serialized `schemaVersion` remains `2`; Rust type and function names are not serialized compatibility contracts.

Because HPA-540 already touches the active top-level boundary, use unversioned current names for:

- `SaveEnvelope`
- `SaveSummary`
- `SaveSnapshot`
- `SceneProgressSnapshot`
- `CapturedCheckpoint`
- `capture_checkpoint`
- `capture_scene_progress`

Remove the save-specific `StoryStateSnapshotV1` family and use the existing `StoryStateSnapshot` directly.

Do not perform a broad rename-only sweep of lower-level `*V1` records such as dialogue-history, thumbnail, acquisition, or inventory structures unless functional work already touches them.

### One StoryState snapshot

The current persistence path is:

```text
StoryState
  -> StoryStateSnapshot
  -> SaveSnapshot
```

Do not retain a parallel save-specific StoryState snapshot family, identity conversion layer, or generic adapter with one production implementation. The mutable runtime object is not serialized directly.

### One assertion-location authority

`AssertionOrigin` is the authoritative persisted source for fact and authorization locations.

- `SceneEvent` contains chapter, scene, and block identity.
- `AnalysisBoard` contains chapter, scene, and board identity.
- Remove the unshipped `Migration` origin.
- `derived_location` returns a concrete `(String, String)` pair because every remaining origin has a chapter and scene.
- Remove separately persisted asserted/granted chapter and scene fields.
- Remove the duplicated public `assertedIn*` and `grantedIn*` fields; `originContext.location` is the public location source.
- Replace the migration-capable tagged `OriginContextView` union with one scene-origin object containing `originKind` and `location`.

Restore must still resolve every persisted origin against current packaged definitions.

## Recap cache

Save recap copy is presentation cache, not restore authority.

- Snapshot IDs and packaged definitions remain authoritative.
- Optional recap prose defaults to absence.
- HPA-540 does not reconstruct missing recap prose.
- Valid titles and labels may still render when safe; absent prose remains absent.
- Never rebuild an unfinished scene summary directly from the current definition.
- Present-but-mismatched recap data remains invalid rather than being silently corrected.

HPA-508 owns completion-aware spoiler safety and must merge before final HPA-540 recap integration.

## First public release

At the first public release:

1. Record the then-current on-disk contract as the first supported released save schema.
2. Commit representative golden saves for that released contract.
3. Define the supported compatibility window.
4. Require explicit deterministic migrations only from formats that were actually shipped.

HPA-274 and HPA-536 begin their compatibility matrices from that first shipped contract, not from internal prototypes.

## HPA-260 contract

HPA-260 adds Chapter 1 analysis state to the current model:

- add `Analysis` to `SceneProgressSnapshot`;
- persist active board, classify/order/threshold drafts, completion, result-dialogue position, and minimal feedback;
- use the single current `StoryStateSnapshot`;
- use `AssertionOrigin::AnalysisBoard` for accepted board outputs;
- do not create a new envelope/snapshot version, duplicate Analysis/StoryState DTOs, or a generic resumable-state adapter;
- round-trip representative current analysis states exactly;
- use deterministic checkpoints for deep analysis states across builds.

## Non-goals

HPA-540 does not decompose `SaveCoordinator`, remove the browser HTTP transport, change compiler source roots, redesign reveal enums, decide the future of `SupportLineage`, restructure E2E suites, rewrite thumbnail capture, add Chapter 2 compatibility work, or change HPA-257 behavior.

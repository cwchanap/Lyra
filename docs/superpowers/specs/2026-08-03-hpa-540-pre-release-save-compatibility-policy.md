# HPA-540 Pre-Release Save Compatibility Policy

## Status

Accepted for active Chapter 1 development.

HPA-536 owns the transition from this pre-release policy to the first recorded public Chapter 1 persistence baseline. Until the HPA-536 release-readiness execution record is populated, development saves remain governed by the pre-release rules below.

The first public persistence baseline becomes active only once the HPA-536 release-readiness execution record is committed **and** its canonical serialized `SAVE_SCHEMA_VERSION` and exact package-wide `contentRevision` fields are both populated in that record. A committed record with blank or missing version fields does not activate the baseline; development saves remain under the pre-release rules until both fields are present and committed.

Once active, the baseline is identified by its serialized `SAVE_SCHEMA_VERSION` plus exact package-wide `contentRevision`. The tested branch SHA and PR are verification provenance only, not activation selectors; this matters because the repository may squash or otherwise rewrite the implementation branch when it lands on `main`.

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
- `derived_location` returns `Result<(String, String), String>`, where the success tuple is `(chapter_id, scene_id)`, because every remaining origin has a chapter and scene; the `Err` carries the segment-validation message.
- Remove separately persisted asserted/granted chapter and scene fields.
- Remove the duplicated public `assertedIn*` and `grantedIn*` fields; `originContext.location` is the public location source.
- Replace the migration-capable tagged `OriginContextView` union with one scene-origin object containing `originKind` and `location`.

The enum variants and their wire/public-view shapes are retained so HPA-260 can
introduce the package-backed board registry without a schema change. Until those
registries exist, two origin kinds are intentionally **rejected** from
story-state mutation, snapshot capture, and restore — they are not validated
against packaged definitions and are not persisted:

- `AssertionOrigin::AnalysisBoard` is rejected until HPA-260 adds a
  package-backed board registry. HPA-260 must add that registry and then remove
  the temporary rejection in `ensure_origin_kind_is_persistable` and the
  restore-time `AnalysisBoard` branch.
- `AssertionOrigin::SceneEvent` with `block_kind: StoryEvent` is rejected until
  a package-backed story-event registry exists. The other `StoryEventBlockKind`
  variants (Sublocation, Hotspot, Topic, InterrogationPhase, InquiryQuestion,
  TestimonyLine) are validated against current packaged scene/block definitions
  and accepted as before.

Restore must still resolve every persisted origin against current packaged
definitions, except for the two temporarily rejected kinds above, which restore
rejects outright with `invalid_story_state_snapshot`.

## Recap cache

Save recap copy is presentation cache, not restore authority.

- Snapshot IDs and packaged definitions remain authoritative.
- Optional recap prose defaults to absence.
- HPA-540 does not reconstruct missing recap prose.
- Valid titles and labels may still render when safe; absent prose remains absent.
- Never rebuild an unfinished scene summary directly from the current definition.
- Present-but-mismatched recap data remains invalid rather than being silently corrected.

HPA-508 owns completion-aware spoiler safety and must merge before final HPA-540 recap integration.

## First public release handoff — HPA-536

HPA-536 records the first public Chapter 1 persistence baseline in:

`docs/superpowers/plans/2026-08-25-hpa-536-chapter-1-release-readiness.md`

The canonical compatibility identity is the exact tested pair:

1. serialized `SAVE_SCHEMA_VERSION`;
2. generated package-wide `contentRevision` loaded by the tested packaged binary.

The same execution record also records the verification branch/head and PR #74 for provenance. Those Git references identify what was tested but are not part of save-file compatibility matching. After merge, HPA-536 tracking records the resulting `main` SHA from PR #74 so the landed source remains easy to locate without requiring a second documentation PR or a compatibility tag.

The pre-release development-save invalidation rule does not apply retroactively to this recorded public baseline. If a later product decision requires support for another actually shipped format, create the smallest explicit migration/support ticket at that time; do not retain migration machinery speculatively.

## HPA-260 contract

HPA-260 adds Chapter 1 analysis state to the current model:

- add `Analysis` to `SceneProgressSnapshot`;
- persist active board, classify/order/threshold drafts, completion, result-dialogue position, and minimal feedback;
- use the direct current `SaveEnvelope` -> `SaveSnapshot` -> `StoryStateSnapshot` model and its one strict current parser;
- use `AssertionOrigin::AnalysisBoard` for accepted board outputs and derive their saved location from that origin instead of persisting redundant chapter/scene copies;
- add the package-backed board registry and remove the temporary
  `AnalysisBoard` rejection from `ensure_origin_kind_is_persistable` and the
  restore-time `AnalysisBoard` branch so the origin becomes persistable and
  restore-validated against that registry;
- keep recap copy optional and non-authoritative: do not reconstruct absent prose or silently correct mismatched present copy;
- do not create a new envelope/snapshot version, duplicate Analysis/StoryState DTOs, or a generic resumable-state adapter;
- round-trip representative current analysis states exactly;
- use deterministic checkpoints for deep analysis states across builds.

## Non-goals

HPA-540 does not decompose `SaveCoordinator`, remove the browser HTTP transport, change compiler source roots, redesign reveal enums, decide the future of `SupportLineage`, restructure E2E suites, rewrite thumbnail capture, add Chapter 2 compatibility work, or change HPA-257 behavior.

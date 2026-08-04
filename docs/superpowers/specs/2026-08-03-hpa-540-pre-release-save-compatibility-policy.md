# HPA-540 Pre-Release Save Compatibility Policy

## Status

Accepted for active Chapter 1 development, subject to one precondition:

> No publicly shipped Lyra build has promised save compatibility.

The implementation PR must verify that precondition before deleting legacy decoding. If a released compatibility promise exists, stop and preserve that released format in a dedicated legacy module.

## Decision

Before the first public release, Lyra supports **one current save format**. Internal formats that were never shipped are disposable and do not receive sequential migrations.

This changes the backward-compatibility promise. It does not weaken save correctness, durability, or validation.

## Pre-release rules

1. The runtime decodes one current envelope and snapshot shape.
2. Keep the serialized `schemaVersion` discriminator at its current value unless a real product requirement changes it. Do not renumber it for aesthetics.
3. Breaking pre-release durable-state changes increment `DEVELOPMENT_SAVE_EPOCH` and begin with a clean development namespace.
4. Additive recap-cache fields may use `Option<T>` with explicit default-to-absence semantics when absence has one safe meaning.
5. Exact package-wide `contentRevision` compatibility remains mandatory.
6. Generated scene JSON, story catalog, and content manifests are current-only compiler outputs and are regenerated rather than migrated.
7. Deterministic current-content checkpoints are the preferred way to reach deep implementation and test states across builds.
8. A domain has one current persistence DTO. Do not create a second save-only DTO without a shipped compatibility requirement.

## Save namespaces

| Runtime | Identifier / guard | Save root |
|---|---|---|
| Production | release build + `com.chanwaichan.lyra` | existing configured application data `saves/` root |
| Tauri development | debug build + `com.chanwaichan.lyra.dev` | `saves-dev/epoch-<N>/` |
| Browser development | existing repository-local development base | `saves-dev/epoch-<N>/` under that base |
| E2E | existing `e2e` feature, identifier, and validated temporary override | existing isolated E2E `saves/` root |

Root selection should remain direct and fail closed. A separate runtime-channel abstraction is not required.

For non-E2E builds:

- release + production identifier selects the production root;
- debug + development identifier selects the development epoch root;
- every other build/identifier combination fails with a typed unsafe-namespace diagnostic.

Use `bun run dev:game` or the configured game Tauri development command. A bare debug startup that loads the production identifier is intentionally rejected rather than allowed to touch production saves.

Changing the development epoch does not migrate, copy, or delete an older development root. Developers may inspect or remove old roots manually.

## Current save model

### One active format

Remove unshipped V1 decoding, the V1 to V2 migration registry, migration-only fixtures, and frontend/E2E unions that only model that internal transition.

Do not keep an empty migration framework. Introduce a legacy module only after a real shipped format requires migration.

### One StoryState snapshot

The current persistence path is:

```text
StoryState
  -> StoryStateSnapshot
  -> current SaveSnapshot
```

Do not retain a parallel save-specific StoryState snapshot family or identity conversion layer. A dedicated snapshot remains required; the mutable runtime object is not serialized directly.

### One assertion-location authority

`AssertionOrigin` is the authoritative persisted source for fact and authorization locations.

- `SceneEvent` contains chapter, scene, and block identity.
- `AnalysisBoard` contains chapter, scene, and board identity.
- Chapter/scene location fields are derived from the origin rather than stored twice.
- Remove the unshipped `Migration` origin. Add released migration provenance later only if a real shipped migration needs it.

Restore must still resolve every persisted origin against current packaged definitions.

## Recap cache

Save recap copy is presentation cache, not restore authority.

- Snapshot IDs and packaged definitions remain authoritative.
- Optional recap prose defaults to absence.
- HPA-540 does not reconstruct missing recap prose.
- Valid titles and labels may still render when safe; absent prose remains absent.
- Never rebuild an unfinished scene summary directly from the current definition, because that can reveal later authored outcomes.
- Present-but-mismatched recap data remains invalid rather than being silently corrected.

HPA-508 owns completion-aware spoiler safety and must merge before the final HPA-540 recap integration.

## First public release

At the first public release:

1. Record the then-current on-disk contract as the first supported released save schema.
2. Commit representative golden saves for that released contract.
3. Define the supported compatibility window.
4. Require explicit deterministic migrations only from formats that were actually shipped.

HPA-274 and HPA-536 begin their compatibility matrices from that first shipped contract, not from internal prototypes.

## HPA-260 contract

HPA-260 adds Chapter 1 analysis state to the current model:

- add `Analysis` to the current scene-progress snapshot;
- persist active board, classify/order/threshold drafts, completion, result-dialogue position, and minimal feedback;
- use the single current `StoryStateSnapshot`;
- use `AssertionOrigin::AnalysisBoard` for accepted board outputs;
- do not create `SaveEnvelopeV3`, `SaveSnapshotV2`, duplicate Analysis/StoryState DTOs, or a generic resumable-state adapter;
- round-trip representative current analysis states exactly;
- use deterministic checkpoints for deep analysis states across builds.

## Invariants that remain mandatory

HPA-540 must preserve:

- atomic staged writes and directory synchronization;
- strict bounded parsing and typed diagnostics;
- thumbnail sidecar ownership and graceful thumbnail failure;
- stable semantic IDs;
- exact `contentRevision` gating;
- detached restore before live-session replacement;
- exact restore/recapture equality and final public-view validation;
- exhaustive `GameEngine` capture classification;
- session-generation and durable-revision stale-write guards;
- serialized writer, autosave debounce, and flush behavior;
- acquisition acknowledgement durability and rollback;
- stale manual overwrite/delete protection;
- corruption and incompatible-save discovery behavior;
- production slot counts, commands, events, and player-facing save flows;
- HPA-257 monotonic unlock and fixed-point reachability behavior.

## Non-goals

HPA-540 does not:

- decompose `SaveCoordinator`;
- remove the browser HTTP development transport;
- change compiler source roots;
- redesign reveal enums;
- decide the future of `SupportLineage`;
- change E2E suite taxonomy;
- rewrite thumbnail capture;
- add Chapter 2 compatibility work;
- make restore permissive to preserve development saves.

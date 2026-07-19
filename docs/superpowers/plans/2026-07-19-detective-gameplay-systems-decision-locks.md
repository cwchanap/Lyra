# Detective Gameplay Systems Decision Locks

**Date:** 2026-07-19  
**Status:** Normative amendment to the umbrella design and high-level plan

This file resolves decisions found to be ambiguous during the planning self-review. Focused subsystem specs may add detail, but they must not reverse these choices without updating the umbrella design and delivery plan.

## 1. Chapter 1 Beat 8.5 uses one analysis scene

The Chapter 1 manifest will replace the current `scene_8_5.md` entry with:

```text
analysis_scene_8_5.md
```

The current Beat 8.5 transition dialogue is migrated into the new analysis scene's intro and outro. The chapter must not keep both files in the playable manifest, and the analysis work must not be implemented as a frontend-only overlay on the old linear scene.

## 2. Provenance is shared by evidence and statements

The public concept is **case-record provenance**. The focused contract may name the shared type `CaseRecordProvenance`; evidence and statements both use it. UI copy may still say “evidence source” when the displayed record is evidence.

## 3. Procedure uses named grants, not a score

The MVP implements named authorizations such as `narrow_lock_export`. It does not add a numeric credibility meter, health bar, consumable objection points, or permanent failure.

## 4. Analysis drafts are durable

A completed card move, classification, selection, reorder, or connection updates Rust-owned draft state. Saving during an incomplete board and resuming the same draft is a Chapter 1 acceptance requirement.

## 5. Chapter 2 starts only after the Chapter 1 acceptance gate

`compare`, `route`, staged map, media/timecode, and Chapter 2 content work do not begin until the Chapter 1 analysis/save Tauri e2e path is passing. This prevents the shared contract from expanding before the MVP is proven.

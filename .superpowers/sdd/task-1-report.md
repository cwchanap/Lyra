# Task 1 Report: Shared CrossfadeImage Component

## Scope

Implemented the reusable frontend image cutover primitive only:

- `apps/game/src/lib/components/CrossfadeImage.svelte`
- `apps/game/src/lib/components/CrossfadeImage.test.ts`

No other scene, dialogue, investigation, asset, Rust, or compiler files were changed.

## TDD Evidence

### RED

Ran:

```bash
rtk bun run --cwd apps/game test src/lib/components/CrossfadeImage.test.ts
```

Observed the expected failure before implementation:

- Vite could not resolve `./CrossfadeImage.svelte` from the new test file.

### GREEN

After implementation and the SvelteMap lint fix, reran the same focused test command and it passed:

- 1 file passed
- 6 tests passed

## Implementation Notes

- Added the shared `CrossfadeImage` component with:
  - load-gated crossfade behavior
  - `visible` / `leaving` layer classes
  - caller-supplied classes, styles, aria, and data attributes
  - load/error forwarding
  - reduced-motion contract via `--crossfade-duration: 1ms`
- Switched the internal timer map to `SvelteMap` to satisfy the repo lint rule.

## Commit

- `893b419 feat(game): add crossfade image primitive`

## Self-Review

- The component stays within Task 1 scope.
- The focused test suite passes.
- The commit hook completed cleanly after the `SvelteMap` fix.

## Fix After Review

- What changed: `CrossfadeImage` now snapshots each layer's caller presentation props at creation time, so the outgoing layer keeps its original `imageClass`, `imageStyle`, `ariaHidden`, and `dataAttributes` while a transition is in flight. I also added a regression test that rerenders with different presentation props while two layers coexist and verifies that the old and incoming layers keep their own snapshots.
- Covering test command and result: `bun run --cwd apps/game test src/lib/components/CrossfadeImage.test.ts` - passed (`1` file, `7` tests).
- Commit SHA: `2873974`

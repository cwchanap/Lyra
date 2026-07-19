# Extract Shared Geometry/Crop Helpers Design

**Date:** 2026-07-16
**Status:** Approved design; implementation plan to follow
**Linear:** [HPA-66](https://linear.app/cwchanap/issue/HPA-66/extract-shared-geometrycrop-helpers-into-common-package)
**Related specs:**
- `docs/superpowers/specs/2026-05-30-story-asset-pipeline-design.md`
- `docs/superpowers/specs/2026-06-06-investigation-scene-layout-editor-design.md`

## Goal

Give the alpha-channel crop helpers (`alphaBoundsFromImageData`,
`cropVariablesForAlphaBounds`, the `AlphaBounds` type, and the
`DEFAULT_ASSET_WIDTH` / `DEFAULT_ASSET_HEIGHT` constants) a single home in a
shared Turborepo workspace package, so the game and the layout editor consume
one implementation instead of one app reaching into the other's source tree.

## Problem

Today the editor does not duplicate the crop helpers — it re-exports them from
the game through a deep crossapp import:

- `apps/game/src/lib/assets/alpha-crop.ts` is the canonical implementation and
  also owns the unit tests (`alpha-crop.test.ts`).
- `apps/layout-editor/src/lib/layout-geometry.ts` re-exports the same symbols
  from `@lyra/game/src/lib/assets/alpha-crop`.

That deep import is the **only** reason `apps/layout-editor` depends on
`@lyra/game` (verified by grep across the editor). The coupling is fragile:
the editor drags in the whole game package to reach two pure functions, the
editor's test file re-tests the crop helpers to guard the re-export surface,
and any move or rename inside `apps/game/src/lib/assets/` silently breaks the
editor build.

## Approved Approach

Create a new shared workspace package, `@lyra/shared`, that owns the crop
helpers and their tests. Both apps depend on the package directly. The editor
no longer depends on `@lyra/game` for this concern.

This was chosen over:

- keeping the `@lyra/game` deep import, which is exactly the fragile coupling
  this issue exists to remove;
- duplicating the bodies in both apps, which is the lockstep-drift problem the
  issue calls out.

## Scope

### In Scope

- New package `packages/shared/` (`@lyra/shared`) exporting `AlphaBounds`,
  `alphaBoundsFromImageData`, `cropVariablesForAlphaBounds`,
  `DEFAULT_ASSET_WIDTH`, and `DEFAULT_ASSET_HEIGHT`.
- Move the canonical implementation from
  `apps/game/src/lib/assets/alpha-crop.ts` into the package.
- Move the existing crop unit tests from
  `apps/game/src/lib/assets/alpha-crop.test.ts` into the package, and add a
  test that calls `cropVariablesForAlphaBounds` without its optional
  `imageWidth` / `imageHeight` arguments. That default-dimensions branch
  (`1024 × 1536`) is currently exercised only by the editor's
  `layout-geometry.test.ts`; moving the game tests alone would leave it
  uncovered.
- Update the game to consume `@lyra/shared` (delete the old files).
- Update the editor's `layout-geometry.ts` to re-export from `@lyra/shared`.
- Drop the now-unused `@lyra/game` dependency from the editor.
- Drop the two redundant crop tests from the editor's
  `layout-geometry.test.ts`; keep its editor-specific layout tests.

### Out of Scope

- Editor-only layout helpers (`moveLayout`, `resizeLayoutFromHandle`,
  `clampLayoutBox`, `clampRectLayout`, `clampSpriteLayout`, `clamp`,
  `MIN_LAYOUT_SIZE`, `ResizeHandle`) stay in `layout-geometry.ts`.
- `publicPathForEditorAsset` / `publicPathForStoryAsset` unification is a
  separate concern.
- No behavioral change to the crop math or the emitted CSS variables.

## Package Layout

`packages/shared/` mirrors the conventions already established by
`@lyra/asset-paths` and `@lyra/scene-types`:

- `package.json` — `@lyra/shared`, `private: true`, `type: module`,
  `exports: { ".": { "types": "./src/index.ts", "default": "./src/index.ts" } }`,
  with two scripts: `"test": "vitest run"` (the existing shared packages have no
  tests; this one does, so turbo's `test` task must run it) and
  `"check": "tsc --noEmit -p tsconfig.json"` (see Type Checking).
- `tsconfig.json` — copied from `packages/asset-paths/tsconfig.json`: `strict`,
  `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`,
  `moduleResolution: bundler`, `noEmit`, `include: ["src/**/*.ts"]`.
- `src/index.ts` — verbatim contents of today's
  `apps/game/src/lib/assets/alpha-crop.ts`, with an `asset-paths`-style header
  comment naming the consumers.
- `src/index.test.ts` — the seven tests moved from
  `apps/game/src/lib/assets/alpha-crop.test.ts` (importing from `./index`), plus
  the new default-dimensions test. The move is **not** byte-verbatim: the
  bounds-finding test's `for (const [x, y] of [[1,1],...])` loop must gain
  `as const` (or explicit `[number, number][]` typing) because the package's
  `noUncheckedIndexedAccess` flag makes the destructured `x`/`y`
  `number | undefined`, which fails the package's own `check` script.

The package is added to the workspace automatically via the existing
`packages/*` glob in the root `package.json` `workspaces`.

### Public Contract

The shared signature is the game's current signature, which already matches the
optional-defaults shape the issue asks for:

```ts
export type AlphaBounds = {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
};

export function alphaBoundsFromImageData(
  data: Uint8ClampedArray,
  imageWidth: number,
  imageHeight: number,
): AlphaBounds | null;

export const DEFAULT_ASSET_WIDTH = 1024;
export const DEFAULT_ASSET_HEIGHT = 1536;

export function cropVariablesForAlphaBounds(
  bounds: AlphaBounds,
  imageWidth = DEFAULT_ASSET_WIDTH,
  imageHeight = DEFAULT_ASSET_HEIGHT,
): string;
```

The two `DEFAULT_*` constants are preserved verbatim to avoid any behavioral
change, but they are currently internal-only: no consumer imports them
directly — they exist as default parameter values and are re-exported by the
editor without being read. They remain in the public contract so the optional
defaults keep working unchanged.

### Package Scope Guardrail

`@lyra/shared` is named generically, so `src/index.ts` must stay narrowly
scoped to the alpha-crop helpers. Future additions are allowed only if they are
cohesive with this surface; unrelated shared utilities get their own package
rather than accumulating here. The header comment will state this.

## Integration Points

### `apps/game`

- Add `"@lyra/shared": "workspace:*"` to `apps/game/package.json`
  `dependencies`.
- Delete `apps/game/src/lib/assets/alpha-crop.ts` and
  `apps/game/src/lib/assets/alpha-crop.test.ts` (content moved to the package).
- `apps/game/src/lib/components/InvestigationSceneSurface.svelte` imports
  `alphaBoundsFromImageData` and `cropVariablesForAlphaBounds` from
  `@lyra/shared` instead of `$lib/assets/alpha-crop`.
- `InvestigationSceneSurface.test.ts` asserts the symbol name appears in the
  component source; that assertion is name-based and remains valid.

### `apps/layout-editor`

- `apps/layout-editor/src/lib/layout-geometry.ts` changes its re-export source
  from `@lyra/game/src/lib/assets/alpha-crop` to `@lyra/shared`. The editor's
  other layout helpers are untouched.
- `apps/layout-editor/package.json`: add `"@lyra/shared": "workspace:*"` and
  remove `"@lyra/game": "workspace:*"` (the deep alpha-crop import is its only
  use).
- `apps/layout-editor/src/lib/layout-geometry.test.ts`: remove the two
  crop-specific tests (`"finds visible alpha bounds..."` and
  `"converts alpha bounds into CSS crop variables"`). The bounds test is
  covered verbatim by the package's own tests; the CSS-variables test's
  default-dimensions branch is covered by the new omitted-arguments test added
  to the package. Keep all editor-specific layout tests.

### Tests that reference the symbol name

- `apps/layout-editor/src/lib/EditorCanvas.test.ts` and
  `apps/game/src/lib/components/InvestigationSceneSurface.test.ts` assert that
  the string `cropVariablesForAlphaBounds` appears in component source. The
  symbol keeps that name, so these assertions are unchanged.

## Type Checking

The package's source (`src/index.ts`) is type-checked transitively when the
apps import it — the same way `@lyra/asset-paths` and `@lyra/scene-types` are
checked. But transitive checking is not sufficient here for two reasons: it
runs under each consumer's compiler options rather than the package's own
`exactOptionalPropertyTypes` / `noUncheckedIndexedAccess`, and it cannot reach
`src/index.test.ts` at all (the test file is never imported by a consumer, and
Vitest does not type-check by default).

The package therefore declares its own `"check": "tsc --noEmit -p tsconfig.json"`
script. Turbo's `check` task (`dependsOn: ["^check"]`) runs it before the
consuming apps' checks, enforcing the package's strict options over both
`index.ts` and `index.test.ts`. (`@lyra/asset-paths` and `@lyra/scene-types`
have no `check` script because they ship no tests; `@lyra/shared` differs on
exactly that point.)

## Testing

- The package's `src/index.test.ts` runs under `bun run test` via turbo's `test`
  task (the package defines `"test": "vitest run"`). Note that the root
  `test:scripts` step is **not** the path here: `vitest.scripts.config.ts` globs
  only `packages/scripts/**/*.test.ts`, so locally the shared tests are reached
  exclusively through turbo's per-workspace `test` task. **CI does not invoke
  root `bun run test`**, so an explicit CI step is required (see CI and
  Lockfile).
- The pure crop functions operate on `Uint8ClampedArray` with no DOM access, so
  the default Node test environment is sufficient; no jsdom configuration is
  needed.
- The editor keeps its layout-geometry tests minus the two redundant crop
  cases.

## Verification

- `bun run check` — turbo runs the package's own `check` (`tsc --noEmit`) plus
  the svelte-check of both apps (transitively re-checking the package source).
- `bun run test` — package tests (turbo), then both app suites.
- `bun run lint:all` — ESLint, Prettier, Rust fmt/clippy.

## CI and Lockfile

- **Lockfile:** `bun.lock` is tracked in git and CI installs with
  `bun install --frozen-lockfile` (`.github/workflows/ci.yml`). Each task that
  runs `bun install` (adding the workspace, then changing each app's deps) must
  stage `bun.lock` in its commit, or CI cannot resolve `@lyra/shared`.
- **Shared tests in CI:** the `unit-tests-frontend` job runs `test:scripts`
  plus the game and editor Vitest suites directly; it never runs
  `turbo run test` or root `bun run test`. Add an explicit step
  `bun run --cwd packages/shared test` to that job so the new package's tests
  gate CI.
- **Package type-check in CI:** already covered — CI's `bun run check` is
  `turbo run check`, which runs the package's `check` script automatically via
  the apps' `^check` dependency.
- **Coverage:** the shared-package tests run as a pass/fail gate only. Uploading
  their coverage is out of scope here; the existing Codecov upload is scoped to
  `apps/game/coverage/lcov.info`, and a shared-packages coverage strategy is a
  separate concern.

## Non-Goals And Guardrails

- Do not change the crop math, the CSS variable format, or the default
  dimensions.
- Do not move editor-specific layout helpers into the shared package.
- Do not unify the asset path resolvers here.
- Do not add a build/emit step to `@lyra/shared`; it ships source like the other
  shared packages.

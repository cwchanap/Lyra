# Extract Shared Geometry/Crop Helpers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lift the alpha-crop helpers (`alphaBoundsFromImageData`, `cropVariablesForAlphaBounds`, `AlphaBounds`, `DEFAULT_ASSET_WIDTH/HEIGHT`) — a canonical implementation currently owned by `@lyra/game` and re-exported by the layout editor via a deep `@lyra/game/src/lib/assets/alpha-crop` import — into a new `@lyra/shared` workspace package so the game and layout editor consume one implementation, and remove the editor's cross-app dependency on `@lyra/game`.

**Architecture:** Create `packages/shared/` following the established `@lyra/asset-paths` / `@lyra/scene-types` conventions (source-only package, no build step). It is type-checked by its own `check` script (enforcing the package's strict options over `index.ts` *and* `index.test.ts`) and re-checked transitively by its consumers. Both apps then import the crop helpers from `@lyra/shared`. The editor stops reaching into `@lyra/game/src/lib/assets/alpha-crop` and drops `@lyra/game` from its dependencies.

**Tech Stack:** Bun workspaces, Turborepo, TypeScript (`exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`), Vitest, SvelteKit (svelte-check).

**Spec:** `docs/superpowers/specs/2026-07-16-extract-shared-geometry-crop-helpers-design.md`

## Global Constraints

- Package manager is **bun** pinned to `bun@1.3.1`. Run workspace links with `bun install` (no extra flags).
- `bun.lock` is tracked in git and CI installs with `bun install --frozen-lockfile`. **Every task that runs `bun install` must stage `bun.lock` in its commit**, or CI will fail to resolve the new `@lyra/shared` workspace and dependency edges.
- The new package ships **source** via `exports["."].default → ./src/index.ts` — no build/emit step, matching `@lyra/asset-paths` and `@lyra/scene-types`.
- All new/edited TypeScript is subject to `strict`, `exactOptionalPropertyTypes`, and `noUncheckedIndexedAccess`.
- The package name is **`@lyra/shared`** (decided by the project owner; kept despite the generic-name risk). `src/index.ts` must stay narrowly scoped to the alpha-crop helpers — unrelated utilities go in their own package.
- No behavioral change to the crop math, the CSS variable format, or the default dimensions (`1024` / `1536`).
- Do not move editor-only layout helpers (`moveLayout`, `resizeLayoutFromHandle`, `clampLayoutBox`, `clampRectLayout`, `clampSpriteLayout`, `clamp`, `MIN_LAYOUT_SIZE`, `ResizeHandle`) out of `layout-geometry.ts`.
- Do not commit unless explicitly asked (repo rule). Each task's commit step is the logical unit; stage only the intended files.

---

## File Structure

**Created:**
- `packages/shared/package.json` — package manifest (`@lyra/shared`), `exports` map, `test` + `check` scripts.
- `packages/shared/tsconfig.json` — copied from `packages/asset-paths/tsconfig.json`.
- `packages/shared/src/index.ts` — canonical crop helpers + `AlphaBounds` type (moved from `apps/game/src/lib/assets/alpha-crop.ts`).
- `packages/shared/src/index.test.ts` — the seven crop tests (moved from `apps/game/src/lib/assets/alpha-crop.test.ts`).

**Modified:**
- `apps/game/package.json` — add `@lyra/shared` dependency.
- `apps/game/src/lib/components/InvestigationSceneSurface.svelte:10-13` — import from `@lyra/shared`.
- `apps/layout-editor/package.json` — add `@lyra/shared`, remove `@lyra/game`.
- `apps/layout-editor/src/lib/layout-geometry.ts:5-11` — re-export source → `@lyra/shared`.
- `apps/layout-editor/src/lib/layout-geometry.test.ts:2-10,40-74` — remove two redundant crop tests + their now-unused imports.
- `bun.lock` — updated by each task's `bun install`; staged in each commit (CI uses `--frozen-lockfile`).
- `.github/workflows/ci.yml` — add a step running `@lyra/shared`'s tests in the `unit-tests-frontend` job.

**Deleted:**
- `apps/game/src/lib/assets/alpha-crop.ts` (content moved to package).
- `apps/game/src/lib/assets/alpha-crop.test.ts` (content moved to package).

---

### Task 1: Create the `@lyra/shared` package with the crop helpers and tests

**Files:**
- Create: `packages/shared/package.json`
- Create: `packages/shared/tsconfig.json`
- Create: `packages/shared/src/index.ts`
- Create: `packages/shared/src/index.test.ts`

**Interfaces:**
- Produces: `@lyra/shared` module exporting `AlphaBounds`, `alphaBoundsFromImageData`, `cropVariablesForAlphaBounds`, `DEFAULT_ASSET_WIDTH`, `DEFAULT_ASSET_HEIGHT`. Later tasks import these via `import { ... } from "@lyra/shared"`.

- [ ] **Step 1: Create `packages/shared/package.json`**

```json
{
  "name": "@lyra/shared",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": {
      "types": "./src/index.ts",
      "default": "./src/index.ts"
    }
  },
  "scripts": {
    "test": "vitest run",
    "check": "tsc --noEmit -p tsconfig.json"
  }
}
```

- [ ] **Step 2: Create `packages/shared/tsconfig.json` (copy of `packages/asset-paths/tsconfig.json`)**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "allowImportingTsExtensions": true,
    "exactOptionalPropertyTypes": true,
    "noUncheckedIndexedAccess": true
  },
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 3: Create `packages/shared/src/index.test.ts` (move + strict-mode fix + add default-dims test)**

This is the seven tests from `apps/game/src/lib/assets/alpha-crop.test.ts` (import changed from `./alpha-crop` to `./index`), plus a new test for the default-dimensions branch. Two deliberate deviations from a byte-verbatim copy:

1. The bounds-finding loop gains `as const`. The package's `noUncheckedIndexedAccess` flag makes a destructured `[x, y]` over `number[][]` infer as `number | undefined`, which fails the package's `check` script (`error TS18048`). `as const` types the tuple as `readonly [number, number]`, so `x`/`y` are defined `number`s.
2. The new `"uses the default 1024x1536 asset dimensions when arguments are omitted"` test covers the public default-args branch — previously exercised only by the editor test being removed in Task 3.

The implementation does not exist yet, so this must fail first.

```ts
import { describe, expect, it } from "vitest";
import {
  alphaBoundsFromImageData,
  cropVariablesForAlphaBounds,
} from "./index";

describe("alpha crop helpers", () => {
  it("finds visible alpha bounds in transparent asset pixels", () => {
    const pixels = new Uint8ClampedArray(4 * 4 * 4);
    for (const [x, y] of [
      [1, 1],
      [2, 1],
      [1, 2],
      [2, 2],
    ] as const) {
      pixels[(y * 4 + x) * 4 + 3] = 255;
    }

    expect(alphaBoundsFromImageData(pixels, 4, 4)).toEqual({
      left: 1,
      top: 1,
      right: 3,
      bottom: 3,
      width: 2,
      height: 2,
    });
  });

  it("converts alpha bounds into CSS crop variables", () => {
    expect(
      cropVariablesForAlphaBounds(
        {
          left: 256,
          top: 128,
          right: 768,
          bottom: 1408,
          width: 512,
          height: 1280,
        },
        1024,
        1536,
      ),
    ).toBe(
      "--crop-left: 0.25; --crop-top: 0.08333333333333333; --crop-width: 0.5; --crop-height: 0.8333333333333334;",
    );
  });

  it("uses the default 1024x1536 asset dimensions when arguments are omitted", () => {
    // Same bounds as the explicit-dimensions test above; omitting the optional
    // imageWidth/imageHeight args must fall back to DEFAULT_ASSET_WIDTH (1024)
    // and DEFAULT_ASSET_HEIGHT (1536), producing identical output. This is the
    // public default contract previously covered only by the editor's tests.
    expect(
      cropVariablesForAlphaBounds({
        left: 256,
        top: 128,
        right: 768,
        bottom: 1408,
        width: 512,
        height: 1280,
      }),
    ).toBe(
      "--crop-left: 0.25; --crop-top: 0.08333333333333333; --crop-width: 0.5; --crop-height: 0.8333333333333334;",
    );
  });

  it("returns null for a fully transparent image", () => {
    const pixels = new Uint8ClampedArray(4 * 4 * 4);
    expect(alphaBoundsFromImageData(pixels, 4, 4)).toBeNull();
  });

  it("finds bounds for a single non-transparent pixel", () => {
    const pixels = new Uint8ClampedArray(4 * 3 * 4);
    pixels[(1 * 3 + 2) * 4 + 3] = 128;

    expect(alphaBoundsFromImageData(pixels, 3, 4)).toEqual({
      left: 2,
      top: 1,
      right: 3,
      bottom: 2,
      width: 1,
      height: 1,
    });
  });

  it("treats low alpha values as visible", () => {
    const pixels = new Uint8ClampedArray(4);
    pixels[3] = 1;

    expect(alphaBoundsFromImageData(pixels, 1, 1)).toEqual({
      left: 0,
      top: 0,
      right: 1,
      bottom: 1,
      width: 1,
      height: 1,
    });
  });

  it("returns null when data buffer is smaller than expected dimensions", () => {
    const pixels = new Uint8ClampedArray(4); // only 1 pixel worth of data
    expect(alphaBoundsFromImageData(pixels, 4, 4)).toBeNull();
  });

  it("returns crop variables at full extent when bounds equal image dimensions", () => {
    expect(
      cropVariablesForAlphaBounds(
        { left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100 },
        100,
        100,
      ),
    ).toBe("--crop-left: 0; --crop-top: 0; --crop-width: 1; --crop-height: 1;");
  });
});
```

- [ ] **Step 4: Run the test to verify it fails (red)**

Run: `bun run --cwd packages/shared test`
Expected: FAIL — vitest reports it cannot resolve `./index` (module not found), since `src/index.ts` does not exist yet.

- [ ] **Step 5: Create `packages/shared/src/index.ts` (the implementation, moved verbatim)**

Content is the verbatim body of `apps/game/src/lib/assets/alpha-crop.ts`, with a header comment modeled on `packages/asset-paths/src/index.ts`.

```ts
// =============================================================================
// packages/shared/src/index.ts
//
// Shared alpha-crop helpers for the Lyra game and layout editor.
//
// Single source of truth for computing the visible (non-transparent) bounds of
// an RGBA image and turning those bounds into the CSS custom properties the
// runtime uses to crop standee/portrait sprites (--crop-left/top/width/height).
//
// Consumers:
//   - apps/game/src/lib/components/InvestigationSceneSurface.svelte
//   - apps/layout-editor/src/lib/layout-geometry.ts (re-exported for EditorCanvas)
//
// Scope guardrail: this package is intentionally narrow. Unrelated shared
// utilities belong in their own package, not here.
// =============================================================================

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
): AlphaBounds | null {
  const expected = imageWidth * imageHeight * 4;
  if (data.length < expected) return null;

  let left = imageWidth;
  let top = imageHeight;
  let right = 0;
  let bottom = 0;

  for (let y = 0; y < imageHeight; y += 1) {
    for (let x = 0; x < imageWidth; x += 1) {
      const alpha = data[(y * imageWidth + x) * 4 + 3] ?? 0;
      if (alpha <= 0) continue;

      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x + 1);
      bottom = Math.max(bottom, y + 1);
    }
  }

  if (right <= left || bottom <= top) return null;
  return {
    left,
    top,
    right,
    bottom,
    width: right - left,
    height: bottom - top,
  };
}

/** Standard standee asset dimensions used as default crop variables. */
export const DEFAULT_ASSET_WIDTH = 1024;
export const DEFAULT_ASSET_HEIGHT = 1536;

export function cropVariablesForAlphaBounds(
  bounds: AlphaBounds,
  imageWidth = DEFAULT_ASSET_WIDTH,
  imageHeight = DEFAULT_ASSET_HEIGHT,
): string {
  return (
    [
      `--crop-left: ${bounds.left / imageWidth}`,
      `--crop-top: ${bounds.top / imageHeight}`,
      `--crop-width: ${bounds.width / imageWidth}`,
      `--crop-height: ${bounds.height / imageHeight}`,
    ].join("; ") + ";"
  );
}
```

- [ ] **Step 6: Run the tests to verify they pass (green)**

Run: `bun run --cwd packages/shared test`
Expected: PASS — 8 tests pass (the 7 moved tests plus the new default-dimensions test).

- [ ] **Step 7: Register the new workspace package**

Run: `bun install`
Expected: bun links `@lyra/shared` into the workspace. No lockfile errors. (This also makes `@lyra/shared` resolvable for Tasks 2 and 3.)

- [ ] **Step 8: Run the package's own `check` script**

Run: `bun run --cwd packages/shared check`
Expected: `tsc --noEmit -p tsconfig.json` runs with no output, exit code 0. This enforces the package's `exactOptionalPropertyTypes` and `noUncheckedIndexedAccess` over both `src/index.ts` and `src/index.test.ts` (the test file is never imported by consumers, so this script is the only place it gets type-checked).

- [ ] **Step 9: Commit**

```bash
git add packages/shared/package.json packages/shared/tsconfig.json packages/shared/src/index.ts packages/shared/src/index.test.ts bun.lock
git commit -m "feat(shared): add @lyra/shared package with alpha-crop helpers"
```

---

### Task 2: Switch the game to consume `@lyra/shared`

**Files:**
- Modify: `apps/game/package.json` (dependencies block)
- Modify: `apps/game/src/lib/components/InvestigationSceneSurface.svelte:10-13`
- Delete: `apps/game/src/lib/assets/alpha-crop.ts`
- Delete: `apps/game/src/lib/assets/alpha-crop.test.ts`

**Interfaces:**
- Consumes: `@lyra/shared` (from Task 1) — `alphaBoundsFromImageData`, `cropVariablesForAlphaBounds`.
- Produces: game no longer owns the crop helpers; the `apps/game/src/lib/assets/` directory still exists (it still holds `story-assets.ts`).

- [ ] **Step 1: Add `@lyra/shared` to `apps/game/package.json`**

In the `dependencies` object, add the `"@lyra/shared"` entry alongside the existing `"@lyra/asset-paths"` line. The `dependencies` block becomes:

```json
  "dependencies": {
    "@lyra/asset-paths": "workspace:*",
    "@lyra/shared": "workspace:*",
    "@tauri-apps/api": "^2",
    "@tauri-apps/plugin-opener": "^2"
  },
```

- [ ] **Step 2: Re-link the workspace**

Run: `bun install`
Expected: bun records `@lyra/shared` as a dependency of `@lyra/game`. No errors.

- [ ] **Step 3: Update the import in `InvestigationSceneSurface.svelte`**

In `apps/game/src/lib/components/InvestigationSceneSurface.svelte`, change lines 10-13 from:

```svelte
  import {
    alphaBoundsFromImageData,
    cropVariablesForAlphaBounds,
  } from "$lib/assets/alpha-crop";
```

to:

```svelte
  import {
    alphaBoundsFromImageData,
    cropVariablesForAlphaBounds,
  } from "@lyra/shared";
```

- [ ] **Step 4: Delete the old game copies**

Run: `git rm apps/game/src/lib/assets/alpha-crop.ts apps/game/src/lib/assets/alpha-crop.test.ts`
Expected: both files staged for deletion. (The `assets/` directory remains because `story-assets.ts` still lives there.)

- [ ] **Step 5: Type-check the game**

Run: `bun run --cwd apps/game check`
Expected: svelte-kit sync + svelte-check pass, exit code 0. This transitively type-checks `@lyra/shared` through the new import.

- [ ] **Step 6: Run the game tests**

Run: `bun run --cwd apps/game test`
Expected: PASS. `InvestigationSceneSurface.test.ts` asserts the component source contains the string `cropVariablesForAlphaBounds`; the import still uses that name, so the assertion holds.

- [ ] **Step 7: Commit**

```bash
git add apps/game/package.json apps/game/src/lib/components/InvestigationSceneSurface.svelte bun.lock
git commit -m "refactor(game): consume alpha-crop helpers from @lyra/shared"
```

(The deletions were already staged by `git rm` in Step 4; include them in this commit. If they are not staged, run `git add -A apps/game/src/lib/assets/` before committing.)

---

### Task 3: Switch the editor to consume `@lyra/shared` and drop `@lyra/game`

**Files:**
- Modify: `apps/layout-editor/src/lib/layout-geometry.ts:5-11`
- Modify: `apps/layout-editor/package.json` (dependencies block)
- Modify: `apps/layout-editor/src/lib/layout-geometry.test.ts:2-10` and remove the two crop tests (`L40-59` and `L61-74`)

**Interfaces:**
- Consumes: `@lyra/shared` (from Task 1).
- Produces: editor's `layout-geometry.ts` still re-exports the crop symbols (so `EditorCanvas.svelte`'s `./layout-geometry` import is unchanged), but sourced from `@lyra/shared`. Editor no longer depends on `@lyra/game`.

- [ ] **Step 1: Change the re-export source in `layout-geometry.ts`**

In `apps/layout-editor/src/lib/layout-geometry.ts`, replace the `@lyra/game/...` re-export (lines 5-11):

```ts
export {
  type AlphaBounds,
  alphaBoundsFromImageData,
  cropVariablesForAlphaBounds,
  DEFAULT_ASSET_WIDTH,
  DEFAULT_ASSET_HEIGHT,
} from "@lyra/game/src/lib/assets/alpha-crop";
```

with:

```ts
export {
  type AlphaBounds,
  alphaBoundsFromImageData,
  cropVariablesForAlphaBounds,
  DEFAULT_ASSET_WIDTH,
  DEFAULT_ASSET_HEIGHT,
} from "@lyra/shared";
```

Leave every other export in the file (`MIN_LAYOUT_SIZE`, `resizeLayoutFromHandle`, `moveLayout`, `clamp`, `clampLayoutBox`, `clampRectLayout`, `clampSpriteLayout`, `roundLayoutValue`, `ResizeHandle`) untouched.

- [ ] **Step 2: Update `apps/layout-editor/package.json` dependencies**

In the `dependencies` object, remove `"@lyra/game": "workspace:*"` and add `"@lyra/shared": "workspace:*"`. The block becomes:

```json
  "dependencies": {
    "@lyra/asset-paths": "workspace:*",
    "@lyra/shared": "workspace:*",
    "@lyra/scene-types": "workspace:*",
    "@tauri-apps/api": "^2",
    "@tauri-apps/plugin-dialog": "^2",
    "svelte": "^5.0.0",
    "vite": "^6.0.3"
  },
```

- [ ] **Step 3: Re-link the workspace**

Run: `bun install`
Expected: bun removes the `@lyra/game` link from the editor and adds `@lyra/shared`. No errors. (Sanity check: `@lyra/game` is the deep alpha-crop import's only use in the editor, verified by grep, so removing it is safe.)

- [ ] **Step 4: Remove the two redundant crop tests from `layout-geometry.test.ts`**

The crop behavior is now covered by `packages/shared/src/index.test.ts`. Delete these two `it(...)` blocks from `apps/layout-editor/src/lib/layout-geometry.test.ts`:

- `"finds visible alpha bounds in transparent standee pixels"` (the block that builds a `Uint8ClampedArray(4 * 4 * 4)` and asserts on `alphaBoundsFromImageData`), and
- `"converts alpha bounds into CSS crop variables"` (the block that asserts on `cropVariablesForAlphaBounds({ left: 256, ... })`).

Then remove the now-unused imports. Change the import block (lines 2-10) from:

```ts
import {
  alphaBoundsFromImageData,
  clampLayoutBox,
  clampRectLayout,
  clampSpriteLayout,
  cropVariablesForAlphaBounds,
  MIN_LAYOUT_SIZE,
  resizeLayoutFromHandle,
} from "./layout-geometry";
```

to:

```ts
import {
  clampLayoutBox,
  clampRectLayout,
  clampSpriteLayout,
  MIN_LAYOUT_SIZE,
  resizeLayoutFromHandle,
} from "./layout-geometry";
```

Keep every editor-specific test (`resizeLayoutFromHandle`, `clampLayoutBox`, `clampRectLayout`, `clampSpriteLayout`) and the `sprite` fixture unchanged.

- [ ] **Step 5: Type-check the editor**

Run: `bun run --cwd apps/layout-editor check`
Expected: svelte-check passes, exit code 0.

- [ ] **Step 6: Run the editor tests**

Run: `bun run --cwd apps/layout-editor test`
Expected: PASS. `EditorCanvas.test.ts` asserts the component source contains the string `cropVariablesForAlphaBounds`; `EditorCanvas.svelte` still imports that name via `./layout-geometry`, so the assertion holds. The remaining layout-geometry tests pass.

- [ ] **Step 7: Commit**

```bash
git add apps/layout-editor/src/lib/layout-geometry.ts apps/layout-editor/src/lib/layout-geometry.test.ts apps/layout-editor/package.json bun.lock
git commit -m "refactor(editor): source alpha-crop helpers from @lyra/shared, drop @lyra/game dep"
```

---

### Task 4: Whole-workspace verification

**Files:** none (verification only; fix and re-run if anything regresses).

- [ ] **Step 1: Type-check the whole workspace**

Run: `bun run check`
Expected: turbo runs `check` across all workspaces — `@lyra/shared`'s own `tsc --noEmit` runs first (via `^check`), then both apps' svelte-check pass (transitively re-checking the package source).

- [ ] **Step 2: Run the whole test suite**

Run: `bun run test`
Expected: `test:scripts` (covers `packages/scripts/**` only) passes, then turbo's `test` task passes for `@lyra/shared` (8 tests), `@lyra/game`, and `@lyra/layout-editor`.

- [ ] **Step 3: Run the full lint suite**

Run: `bun run lint:all`
Expected: ESLint, Prettier check, Rust `cargo fmt --check`, and Rust `cargo clippy -D warnings` all pass. (The moved code already passed lint; this confirms no regression and that the new `packages/shared/src/*.ts` files are picked up by the root `eslint .` config.)

- [ ] **Step 4: Confirm the dependency graph**

Run: `rg --hidden -n "\"@lyra/game\"" apps/layout-editor || echo "no @lyra/game refs in editor"`
Expected: prints `no @lyra/game refs in editor` — confirms the cross-app dependency is fully removed.

- [ ] **Step 5: No commit unless asked**

This task produces no code change. If a verification step surfaced a fix, commit that fix explicitly with a message describing what was corrected. Otherwise stop here.

---

### Task 5: Run `@lyra/shared` tests in CI

**Files:**
- Modify: `.github/workflows/ci.yml` (the `unit-tests-frontend` job, after the `test:scripts` step at line 93).

**Interfaces:** none — this only gates CI on tests added in Task 1.

**Why this task exists:** CI's `unit-tests-frontend` job runs `test:scripts` (covers `packages/scripts/**` only) plus the game and editor Vitest suites directly. It never runs `turbo run test` or root `bun run test`, so without an explicit step `packages/shared/src/index.test.ts` would never execute in CI. (The package `check` is already covered: CI's `bun run check` is `turbo run check`, which runs the package's `check` script via the apps' `^check` dependency.)

- [ ] **Step 1: Add the shared-package test step**

In `.github/workflows/ci.yml`, inside the `unit-tests-frontend` job, add a new step immediately after the `Run compiler and workspace layout tests` step (`run: bun run test:scripts`):

```yaml
      - name: Run shared package Vitest
        run: bun run --cwd packages/shared test
```

The command is identical to Task 1's local test run, so it is already known to pass locally; this step only lifts it into CI.

- [ ] **Step 2: Confirm type-check coverage needs no CI change**

No edit. CI's existing `bun run check` step (`.github/workflows/ci.yml` `lint-frontend` job, `run: bun run check`) already type-checks `@lyra/shared` because Task 1 added a `check` script and turbo's `^check` dependency runs it before the apps' svelte-check.

- [ ] **Step 3: Coverage decision — do not upload this iteration**

Intentionally no coverage upload for the shared package. The existing Codecov upload is scoped to `apps/game/coverage/lcov.info`; a shared-packages coverage strategy is a separate concern. The tests added here gate CI on pass/fail only.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: run @lyra/shared unit tests in frontend test job"
```

CI workflow changes cannot be fully validated locally. Sanity-check the YAML indentation (the new step must sit inside `unit-tests-frontend`, at the same indent as the surrounding `- name:` steps, and after the install step) and, if available, run `bunx actionlint .github/workflows/ci.yml`.

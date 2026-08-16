# Task A2 report: fitted GameShell Analysis presentation

## Changed files

- `apps/game/src/lib/components/GameShell.svelte`
  - Added the independent optional `analysisPresentation` prop, defaulting to
    `false`.
  - Kept `interrogationPresentation` intact and included the new flag in the
    chapter-chrome gate.
  - Added the `analysis-presentation` class and the fitted `100dvh` flex shell
    with a flexible, `min-height: 0` main region.
- `apps/game/src/lib/components/GameShell.test.ts`
  - Added behavior coverage for inactive/active Analysis chrome, objective
    suppression, child containment, the presentation class, and the existing
    menu/Case File snippet path.
- `apps/game/src/routes/+page.svelte`
  - Derived `analysisPresentationActive` through
    `isAnalysisPresentationActive` and passed it to `GameShell`.
- `apps/game/src/routes/page-source.test.ts`
  - Added a focused source guard for the shared helper import, derived flag,
    and GameShell prop wiring.

No generated artifacts, Rust/wire/save/content/evaluator logic, result state,
or unrelated files were changed.

## TDD RED/GREEN evidence

After adding the tests and before production changes:

```text
rtk mise exec bun@1.3.1 -- bun run --cwd apps/game test src/lib/components/GameShell.test.ts
FAIL: 1 failed, 41 passed
Failure: active Analysis presentation still rendered the chapter h1 because
the new GameShell prop/class behavior was not implemented.
```

```text
rtk mise exec bun@1.3.1 -- bun run --cwd apps/game test src/routes/page-source.test.ts
FAIL: 1 failed, 20 passed
Failure: the shared isAnalysisPresentationActive import was absent from
+page.svelte.
```

After the minimal implementation:

```text
rtk mise exec bun@1.3.1 -- bun run --cwd apps/game test src/lib/components/GameShell.test.ts
PASS: 42 tests

rtk mise exec bun@1.3.1 -- bun run --cwd apps/game test src/routes/page-source.test.ts
PASS: 21 tests
```

## Autofix and final verification

The specified Svelte autofixer was run for both changed Svelte components. The
package was not installed locally, so the first noninteractive-safe attempt
waited in `npx`; it was stopped and rerun with `npx --yes`:

```text
rtk mise exec bun@1.3.1 -- npx --yes @sveltejs/mcp svelte-autofixer apps/game/src/lib/components/GameShell.svelte
rtk mise exec bun@1.3.1 -- npx --yes @sveltejs/mcp svelte-autofixer apps/game/src/routes/+page.svelte
Result: issues: [] for both files; existing suggestions only.
```

Final commands:

```text
rtk mise exec bun@1.3.1 -- bun run --cwd apps/game test src/lib/components/GameShell.test.ts
PASS: 42 tests

rtk mise exec bun@1.3.1 -- bun run --cwd apps/game test src/lib/analysis/presentation.test.ts
PASS: 9 tests

rtk mise exec bun@1.3.1 -- bun run --cwd apps/game test src/routes/page-source.test.ts
PASS: 21 tests

rtk mise exec bun@1.3.1 -- bun run --cwd apps/game check
svelte-check found 0 errors and 0 warnings

git diff --check
PASS: no whitespace errors
```

## Commits

- Implementation: `cc32f1a1ae62cee2e02ae6621dd50c31caa25d10`
- Report: committed separately after this report was written.

## Self-review

- The existing interrogation predicate and presentation behavior remain
  unchanged; the new Analysis flag is independent and defaults false.
- GameAtmosphere remains mounted exactly once.
- Game Menu, Case File ownership, Escape handling, persistence props, and
  save-thumbnail markers/layout boundaries were not changed.
- No result overlay or page-level result state was added.
- The page delegates the predicate to the A1 helper rather than duplicating
  scene/mode conditions.

## Concerns

- GameShell jsdom tests continue to print the existing canvas `getContext()`
  not-implemented messages from GameAtmosphere; the focused suite exits green.
- The autofixer reported only pre-existing suggestions about effects and
  `bind:this`; it reported no issues for either changed component.
- No packaged Tauri visual/E2E run was requested for this page/shell seam; the
  focused tests and Svelte check cover the assigned contract.

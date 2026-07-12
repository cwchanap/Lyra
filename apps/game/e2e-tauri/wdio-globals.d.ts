/**
 * Ambient WebdriverIO globals so spec files can use `browser`, `$`, `$$`, and
 * `expect` without imports, and still be type-checked by `tsc -p tsconfig.e2e.json`.
 *
 * `@wdio/globals` exposes these as ambient declarations via its `./types`
 * subpath export (not the package `types` entry, which only re-exports them).
 * `@wdio/mocha-framework` pulls in `@types/mocha` for `describe`/`it`/`beforeEach`.
 */
/// <reference types="@wdio/globals/types" />

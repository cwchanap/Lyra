# HPA-831 review-fix-2 — two independent Important harness findings

Date: 2026-11-22
Branch: `plan/hpa-831-evidence-image-and-topic-focus-frame`
Baseline commit: `fcbc7460` (`ci(HPA-831): opt the manual full-E2E xvfb-run step into scoped XTEST trusted keys`)
Scope: E2E harness only. No product behavior changed. No PR, no push, no full
GUI journey runs (the user re-runs the two independent full acceptance runs
after scoped re-review).

## Finding 1 — `waitForJourneyProgress` folded "unreadable" into "unchanged"

### Root cause

`production-journey.e2e.ts` polled post-Enter state inside `browser.waitUntil`
where a thrown `getPackagedGameState()` read returned `false` (keep polling),
and a `waitUntil` timeout returned `false` from `waitForJourneyProgress`. The
caller treated `false` as "Enter did not advance" and sent a **second** Enter.
If the first Enter had in fact advanced into `scene_2` while every read failed,
the second Enter advanced past the authored entry item; the next successful
read then saw a *later* queue item which the drain credited as `scene_2`'s
first — silently weakening the first/middle/last focus-probe coverage.

### Fix

New module `apps/game/src/lib/e2e/journey-enter-drain.ts` — the identical
sequencing WebDriver drives, with WebDriver behind injected hooks so vitest
exercises the real orchestration:

- `journeyProgressToken(state)` — unchanged semantics (scene/mode/queueToken/
  queueRemaining/pendingAcquisition).
- `observeJourneyProgress(...)` — three-way outcome:
  - `"progressed"`: any poll saw a token change or a pending acquisition,
    **or** the final arbiter read sees one (late advancement is still
    progress);
  - `"unchanged"`: **only** when the arbiter read succeeds and returns the
    same token — the sole evidence that justifies a retry Enter (the first
    Enter only completed a typewriter reveal);
  - `"unknown"`: the arbiter read also failed. The drain captures a stall
    probe (`enter-unobserved`) and throws inconclusive **without sending
    another key**.
- `proveSceneQueueEntry(state)` — before the first `scene_2` probe is
  credited, proves the observed item is the authored queue entry: dialogue
  mode, `queueToken.sceneId === scene.id`, and exactly one `dialogueHistory`
  suffix entry carrying the scene's own title (engine logs one history entry
  per displayed item in order; scene tags are never logged). More than one
  means items were displayed during an observation gap → inconclusive throw
  (`authored entry was not observed`), never a late item labelled "first".
  The proof (sceneId, queueToken incl. cursor/queueGen, queueRemaining,
  entry id/kind/text) is persisted into the `scene_2-first` probe JSON via
  the new optional `diagnostics` payload of `captureFocusProbe`.
- `drainEnterToMap(options)` — the drain loop itself: bounded reads,
  `pendingAcquisition` acknowledge-and-resume, explore→map-mount wait,
  first/middle/last probes, Enter send only after a successful read, exactly
  one retry on proven "unchanged", inconclusive throw on any "unknown",
  stall error on double-proven-"unchanged", and the map accepted only after
  `verifyKeyDelivery(sentEnters)` (trusted Enter proof) plus all three
  probes taken. `cap` preserved (`FOCUS_DRAIN_CAP = 160`); 1500 ms / 100 ms
  progress poll and 200 ms read-failure pause preserved.

`production-journey.e2e.ts` (`runCommissionScene2FocusSegment`) now wires
the real hooks (`getPackagedGameState`, `browser.pause`, `browser.waitUntil`,
`sendSegmentKey("Enter")`, `acknowledgeAcquisitionDomFirst`, `elementExists`
on the map anchor, `probeAndAssert`, `verifyTrustedEnterDelivery`,
`captureFocusProbe`) into `drainEnterToMap`. `journeyProgressToken` /
`waitForJourneyProgress` were removed from the spec file (they now live in
the tested module).

## Finding 2 — image-evidence failures threw before the required screenshot

### Root cause

`verifyAcquisitionEvidenceImage` ran `inspectImageElement` +
`assertInspectedImage` and `startAcquisitionAcknowledgement` ran the gated
record-identity check **before** any screenshot: mount/placeholder/decode/
source-canvas/wrong-asset failures propagated while the 800×600 window was
restored, so the mandated failure frame was never saved. The Case File path
(`verifyHpa831CaseFileRecords`) had the same shape.

### Fix

New module `apps/game/src/lib/e2e/image-evidence-proof.ts`:

- `probeImagePresenceDom(selector)` — serialized page script reporting
  `mounted` + per-image `currentSrc/complete/naturalWidth/naturalHeight/
  rect` for the diagnostics JSON. A missing image is itself the failure
  mode, so `mounted:false` is a normal answer, and nothing depends on the
  image's geometry.
- `runImageEvidenceProof(options)` — shared ordering:
  `prepare? -> inspect -> report? -> assert -> provePainted? -> onReceipt?`.
  **Any** failure first runs `captureFailure({error, inspection|null})`,
  then rethrows the **original** error even when `captureFailure` itself
  rejects (a console.error logs the capture failure). `onReceipt` runs only
  after a passing `provePainted`, so a thrown proof can never produce a
  compositor receipt.

`apps/game/e2e-tauri/helpers.ts`:

- New exported `captureImageFailureDiagnostics({label, selector,
  screenshotPath, error, diagnostics?})`: probes the image presence, saves a
  raw full-viewport `browser.saveScreenshot` (no geometry dependency — the
  image may not exist), writes a sibling `.json` diagnostics file, and
  **never throws** — each step is individually guarded and logged, so
  failure evidence can never mask the real error. Runs while the 800×600
  window is still up (before the journey's viewport restore).
- `verifyAcquisitionEvidenceImage` now calls `runImageEvidenceProof`; for
  gate-scoped `recordId`s the failure path writes
  `acquisition-<asset>-failure.png` + `.json` into the compositor artifact
  dir; ungated records keep the plain error path. The compositor receipt
  still lands only after a passing crop (`onReceipt`).
- The gated-identity (`gateViolation`) failure in
  `startAcquisitionAcknowledgement` captures
  `acquisition-<recordId>-identity-failure.png` + `.json` before throwing,
  when a gate is armed.

`production-journey.e2e.ts` `verifyHpa831CaseFileRecords` now runs each
target through `runImageEvidenceProof` with `prepare` = record click, the
same scroll-into-view crop (`provePainted` unchanged), and `captureFailure`
→ `captureImageFailureDiagnostics` writing `case-file-<id>-failure.png` +
`.json` under `HPA831_ARTIFACT_DIR` before the outer `finally` restores the
window.

## New tests (red-first verified)

`apps/game/src/lib/e2e/journey-enter-drain.test.ts` (12 tests): drives the
real `drainEnterToMap`/`observeJourneyProgress`/`proveSceneQueueEntry` with
scripted state machines behind the injected seams —

- `sends NO second Enter when the post-Enter state cannot be observed, then
  fails inconclusively` (the reviewed bug: Enter advanced, all reads failed;
  `sent` stays 1, no `scene_2-first` credited);
- `permits exactly one retry Enter on PROVEN unchanged, then credits the
  real entry` (asserts the persisted `sceneEntry` diagnostics incl.
  `queueToken {sceneId:"scene_2", queueGen:7, cursor:1}` and entry id);
- `refuses to credit a later item as scene_2's first when the entry was
  never observed` (`/authored entry was not observed/`, zero Enters sent);
- `drains first/middle/last probes in order and gates the map on verified
  key delivery`;
- `fails inconclusively when the retry Enter's state is also unobservable`
  (exactly 2 Enters, both applied);
- plus 4 `observeJourneyProgress` tri-state tests and 3
  `proveSceneQueueEntry` tests.

`apps/game/src/lib/e2e/image-evidence-proof.test.ts` (11 tests): drives the
real exported `startAcquisitionAcknowledgement` from `helpers.ts` behind a
stubbed `browser` global (real waitForButton, title check, gated-identity
check, `inspectImageElement`, `assertInspectedImage`, and the new failure
capture all run; only the WebDriver boundary is faked) —

- wrong `imageAssetId` on a gated record saves
  `acquisition-cctv_screenshot-identity-failure.png` + JSON before throwing,
  no receipt;
- missing image mount saves `acquisition-…-failure.png` + JSON
  (`image.mounted === false`), no receipt;
- screenshot-capture failure preserves the original source-proof error
  (`img.decode() rejected`) — the thrown message does **not** contain the
  capture error — and diagnostics are still written;
- `Case File composition: the real captureImageFailureDiagnostics writes
  the viewport evidence when the record image is absent` — drives the
  identical composition `verifyHpa831CaseFileRecords` wires
  (`runImageEvidenceProof` + real `captureImageFailureDiagnostics`, real
  fs artifacts). `verifyHpa831CaseFileRecords` itself is private inside the
  WDIO spec and cannot be imported by vitest;
- plus 5 ordering/receipt/error-preservation unit tests on
  `runImageEvidenceProof` and 2 `probeImagePresenceDom` tests.

### Red-first / mutation evidence

1. `observeJourneyProgress` arbiter mutated to `return "unchanged"` on read
   failure → focused run went RED: expected inconclusive but got incomplete
   `scene_2` probes; expected `"unknown"` got `"unchanged"`. Reverted.
2. `proveSceneQueueEntry(state)` call replaced by `{ bypassed: true }` →
   focused run went RED: authored-entry diagnostics assertions and the
   `/authored entry was not observed/` expectation both failed. Reverted.
3. `apps/game/e2e-tauri/helpers.ts` reverted to `HEAD` and the helpers-level
   suite re-run → RED: all 3 `startAcquisitionAcknowledgement` failure-
   evidence tests failed (`expected [] to deeply equal [ Array(1) ]` — zero
   failure screenshots written). Fix restored.

## Verification run on the final bytes

| Command | Result |
| --- | --- |
| `bun run --cwd apps/game test src/lib/e2e/` | 12 files, **143/143 tests pass** |
| `bun run --cwd apps/game test` (full vitest) | 84 files, **1442/1442 pass** (~143 s) |
| `bun run --cwd apps/game check:e2e` | clean, exit 0 |
| `bun run check:scripts` | clean, exit 0 |
| `bun run scenes:compile` | OK — 2 chapters, 60 scenes, 0 warnings; 2 pre-existing content warnings (singletonSourceGroup `victim_phone_device`; 600 missing ja voice clips) |
| `bun run lint` (repo eslint) | clean, exit 0 |
| `bun run format:check` (repo prettier) | clean, exit 0 |
| `bun run check` (svelte-check) | 231 errors in 5 files — **baseline, unchanged**: `e2e-tauri/helpers.ts` `Cannot find name 'browser'` ×~155 (e2e files are swept into `tsconfig.json` which lacks the WDIO globals; baseline file already had 152 `browser.` usages — the CI gate for these files is `check:e2e`, which is clean) + `scripts/*.mjs` implicit-any ×76 under `checkJs`. The 2 errors this wave initially added to `image-evidence-proof.test.ts` were fixed; none of the remaining errors are in files this change touched. |
| `node apps/game/scripts/build-e2e.mjs` | **not run** — a full `tauri build --debug` requiring WebKitGTK 4.1, which this host lacks (`tauri-gui:local` environment required); consistent with the "no full GUI journeys" constraint. |

## Deliberately not done

- No push, no new PR/checkpoint/runner, no history rewrite.
- No product-behavior change — both findings were harness defects.
- No full packaged production-journey run (`--attempts 1` ×2) — the user
  runs the two fresh independent acceptance runs after scoped re-review;
  earlier runs (`5886cf60` green on the flawed harness, `3abd64ff`
  controller-cancelled exit 143) remain historical diagnostic evidence only.
- Ungated (non-HPA-831) acquisition records keep the plain error path —
  failure evidence is scoped to the records this ticket gates.

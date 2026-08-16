# Interrogation Scene Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the approved frontend-only interrogation presentation while preserving the current engine, save, scene, and packaged-E2E contracts.

**Architecture:** Keep one +page mode chain inside an always-mounted InterrogationStage. The stage adds subject/progress chrome and owns only the engine-driven Present tray; read-only records remain in GameShell's existing CaseFilePanel. GameShell gains an explicit, focus-aware request path so the stage HUD can open that existing submenu directly.

**Tech Stack:** Svelte 5 runes, TypeScript, Vitest with Testing Library, Tauri packaged E2E, existing story-asset and escape-coordinator helpers.

## Global Constraints

- Frontend only: do not change Rust, Tauri commands, authored scenes, compiler, saves, schemas, or packaged-E2E selectors.
- Do not add standee art, aliases, subject-to-character mappings, or alpha-crop code.
- Reuse GameAtmosphere and SceneBackdrop exactly once; do not add a second atmosphere/backdrop.
- Preserve engine ownership of present/correct/wrong/completion state and all existing callbacks.
- Preserve xexam-challenge, 反駁, 退下, and Present-tray 收回 semantics.
- Use native disabled controls while gameState.inFlight is true.
- New animation respects prefers-reduced-motion; modal Escape uses claimEscape.
- Run the Svelte autofixer for every changed or new Svelte component before final verification.

---

## File structure

| File | Responsibility |
| --- | --- |
| apps/game/src/lib/interrogation/presentation.ts | Pure phase lookup, visible-progress, and testimony-text helpers. |
| apps/game/src/lib/interrogation/presentation.test.ts | Unit tests for the pure display contract. |
| apps/game/src/lib/components/GameShell.svelte | Compact interrogation HUD and direct, focus-aware Case File request handling. |
| apps/game/src/lib/components/GameShell.test.ts | Header suppression, one objective HUD, and direct Case File request tests. |
| apps/game/src/lib/components/InterrogationStage.svelte | Always-mounted, inactive-safe stage chrome, Present overlay ownership, HUD trigger. |
| apps/game/src/lib/components/InterrogationStage.test.ts | Lifecycle, progress, and HUD callback coverage. |
| apps/game/src/lib/components/InterrogationEvidenceTray.svelte | Present-only evidence/statement selection dialog, focus trap, Escape/resume. |
| apps/game/src/lib/components/InterrogationEvidenceTray.test.ts | Selection, focus fallback, Escape, and disabled-state coverage. |
| apps/game/src/lib/components/InterrogationView.svelte | Phase question record and complete control only. |
| apps/game/src/lib/components/InterrogationView.test.ts | Simplified phase-only rendering and callback coverage. |
| apps/game/src/lib/components/DialogueBox.svelte | Cross-examination presentation and pointer-hold challenge behavior. |
| apps/game/src/lib/components/DialogueBox.test.ts | Pointer/direct-click compatibility and visual-prop regression coverage. |
| apps/game/src/routes/+page.svelte | One stage wrapper, presentation data wiring, and Case File request origin. |

### Task 1: Interrogation presentation helpers

**Files:**
- Create: apps/game/src/lib/interrogation/presentation.ts
- Create: apps/game/src/lib/interrogation/presentation.test.ts

**Interfaces:**
- Consumes: SceneView, Mode, InterrogationPhaseView, and DialogueItem from $lib/state/types.
- Produces:
  - isInterrogationPresentationActive(scene: SceneView, mode: Mode): boolean
  - currentInterrogationPhase(scene: SceneView): InterrogationPhaseView | null
  - brokenQuestionProgress(phase: InterrogationPhaseView | null): { broken: number; total: number }
  - interrogationLineText(items: DialogueItem[]): string

- [ ] **Step 1: Write the failing pure-helper tests**

~~~ts
expect(isInterrogationPresentationActive(interrogationScene, dialogueCrossExam)).toBe(true);
expect(isInterrogationPresentationActive(interrogationScene, ordinaryDialogue)).toBe(false);
expect(brokenQuestionProgress(phase)).toEqual({ broken: 1, total: 3 });
expect(interrogationLineText([
  { kind: "sceneTag", text: "ignored" },
  { kind: "action", text: "雨聲。" },
  { kind: "line", speaker: "三宅", text: "我沒去。" },
])).toBe("雨聲。我沒去。");
~~~

- [ ] **Step 2: Run the helper test to verify it fails**

Run: bun run --cwd apps/game test src/lib/interrogation/presentation.test.ts

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement the four pure helpers**

~~~ts
export function currentInterrogationPhase(scene: SceneView) {
  if (scene.kind !== "interrogation") return null;
  return scene.visiblePhases.find((phase) => phase.id === scene.currentPhaseId) ?? null;
}

export function brokenQuestionProgress(phase: InterrogationPhaseView | null) {
  const total = phase?.questions.length ?? 0;
  return { broken: phase?.questions.filter((question) => question.broken).length ?? 0, total };
}
~~~

Implement the stage predicate from the approved design, and form testimony text from only line and action items.

- [ ] **Step 4: Run the helper test to verify it passes**

Run: bun run --cwd apps/game test src/lib/interrogation/presentation.test.ts

Expected: PASS.

- [ ] **Step 5: Commit the helper contract**

~~~sh
git add apps/game/src/lib/interrogation/presentation.ts apps/game/src/lib/interrogation/presentation.test.ts
git commit -m "feat: add interrogation presentation helpers"
~~~

### Task 2: GameShell interrogation chrome and direct Case File request

**Files:**
- Modify: apps/game/src/lib/components/GameShell.svelte
- Modify: apps/game/src/lib/components/GameShell.test.ts

**Interfaces:**
- Consumes: interrogationPresentation: boolean, caseFileRequest: { id: number; returnFocusTo: HTMLElement | null } | null, and onCaseFileRequestHandled(id: number).
- Produces: a compact existing PrimaryObjectiveHud while interrogationPresentation is true; a direct opening of the existing caseFile menu panel without duplicating CaseFilePanel.

- [ ] **Step 1: Add failing GameShell tests**

Add a harness request object and assert all of the following:

~~~ts
expect(screen.queryByText("FILE", { exact: false })).not.toBeInTheDocument();
expect(screen.getAllByRole("status", { name: "主要目標" })).toHaveLength(1);

rerender({ caseFileRequest: { id: 1, returnFocusTo: trigger } });
await screen.findByRole("heading", { name: "案件檔案" });
expect(screen.getByRole("button", { name: "返回" })).toBeInTheDocument();
~~~

Also assert closing the menu returns focus to the supplied trigger.

- [ ] **Step 2: Run the focused GameShell test to verify it fails**

Run: bun run --cwd apps/game test src/lib/components/GameShell.test.ts

Expected: FAIL because the new props and compact interrogation path do not exist.

- [ ] **Step 3: Implement the minimal GameShell API and chrome**

Add the optional props with safe defaults. Extract an internal async openRequestedMenuPanel function that:

1. records the supplied returnFocusTo before opening;
2. opens the existing game menu;
3. calls the existing openMenuPanel("caseFile") path after the menu is mounted;
4. acknowledges the request id once handled.

Keep GameShell's existing root-menu and Escape behavior intact. Derive normal chapter-header visibility from non-explore and not interrogationPresentation. Render the same PrimaryObjectiveHud once in a compact fixed/interrogation layout when presentation is active.

- [ ] **Step 4: Autofix and rerun the focused test**

Run:
~~~sh
npx @sveltejs/mcp svelte-autofixer apps/game/src/lib/components/GameShell.svelte
bun run --cwd apps/game test src/lib/components/GameShell.test.ts
~~~

Expected: autofixer produces no unresolved issues and the test passes.

- [ ] **Step 5: Commit the GameShell seam**

~~~sh
git add apps/game/src/lib/components/GameShell.svelte apps/game/src/lib/components/GameShell.test.ts
git commit -m "feat: add interrogation shell presentation"
~~~

### Task 3: Present-only evidence tray

**Files:**
- Create: apps/game/src/lib/components/InterrogationEvidenceTray.svelte
- Create: apps/game/src/lib/components/InterrogationEvidenceTray.test.ts

**Interfaces:**
- Consumes: crossExam: CrossExamView, inventory: Inventory, onPresent(lineId, kind, itemId), onResume(), disabled, returnFocusTo, fallbackFocusTarget.
- Produces: a labelled Present modal with an evidence/statement action list, exactly one 收回 action, focus trap, and Escape claim.

- [ ] **Step 1: Write failing tray tests**

Cover current data and lifecycle behavior:

~~~ts
await user.click(screen.getByRole("button", { name: /咖啡訂單/ }));
expect(onPresent).toHaveBeenCalledWith("line-1", "evidence", "coffee-order");

await user.click(screen.getByRole("button", { name: "收回" }));
expect(onResume).toHaveBeenCalledTimes(1);

window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
expect(onResume).toHaveBeenCalledTimes(2);
~~~

Render once with a connected trigger and once with returnFocusTo set to document.body; after unmount, assert focus returns to the connected trigger or fallback focus root respectively. Assert disabled cards and 收回 do not invoke callbacks.

- [ ] **Step 2: Run the tray test to verify it fails**

Run: bun run --cwd apps/game test src/lib/components/InterrogationEvidenceTray.test.ts

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement the Present tray**

Use the existing AcquisitionPopup pattern exactly for focus restoration:

- capture returnFocusTo and fallbackFocusTarget on mount;
- claim Escape with claimEscape(() => void onResume());
- focus the first enabled control after mount;
- trap Tab inside the dialog;
- on destroy, restore a connected non-body return target or the connected fallback.

Render the live line with interrogationLineText. Use native buttons for evidence and statement cards. Resolve the selected evidence thumbnail through resolveStoryAsset and retain the established missing-evidence fallback. Do not render a browse mode.

- [ ] **Step 4: Autofix and rerun the tray test**

Run:
~~~sh
npx @sveltejs/mcp svelte-autofixer apps/game/src/lib/components/InterrogationEvidenceTray.svelte
bun run --cwd apps/game test src/lib/components/InterrogationEvidenceTray.test.ts
~~~

Expected: PASS.

- [ ] **Step 5: Commit the Present tray**

~~~sh
git add apps/game/src/lib/components/InterrogationEvidenceTray.svelte apps/game/src/lib/components/InterrogationEvidenceTray.test.ts
git commit -m "feat: add interrogation evidence tray"
~~~

### Task 4: Stable interrogation stage and phase record

**Files:**
- Create: apps/game/src/lib/components/InterrogationStage.svelte
- Create: apps/game/src/lib/components/InterrogationStage.test.ts
- Modify: apps/game/src/lib/components/InterrogationView.svelte
- Modify: apps/game/src/lib/components/InterrogationView.test.ts

**Interfaces:**
- InterrogationStage consumes active, scene, mode, inventory, disabled, onPresent, onResume, onOpenCaseFile(trigger), and children: Snippet.
- InterrogationStage mounts InterrogationEvidenceTray only when currentInterrogationPhase(scene).crossExam?.presenting is true.
- InterrogationView consumes scene, onAsk, onComplete, and disabled only.

- [ ] **Step 1: Write failing Stage and InterrogationView tests**

Add a small Svelte harness that passes a child snippet. Assert:

~~~ts
expect(screen.getByText("1 / 3")).toBeInTheDocument();
await user.click(screen.getByRole("button", { name: /案件檔案/ }));
expect(onOpenCaseFile).toHaveBeenCalledWith(expect.any(HTMLElement));

rerender({ active: false, mode: ordinaryDialogue });
expect(screen.queryByRole("button", { name: /案件檔案/ })).toBeNull();
~~~

Update InterrogationView tests to prove present controls no longer render there and that onAsk/onComplete still receive current ids.

- [ ] **Step 2: Run tests to verify they fail**

Run:
~~~sh
bun run --cwd apps/game test src/lib/components/InterrogationStage.test.ts
bun run --cwd apps/game test src/lib/components/InterrogationView.test.ts
~~~

Expected: Stage test fails because the component is absent; InterrogationView test fails because Present markup remains in the old component.

- [ ] **Step 3: Implement Stage and simplify InterrogationView**

InterrogationStage always renders its children. When active, it renders only subject name, role, phase label, broken/total progress, compact record chrome, and the Case File HUD. Its root is focusable for the tray fallback and decorative layers are aria-hidden.

When the live phase is Present, render exactly one InterrogationEvidenceTray. Pass the stage root as fallbackFocusTarget. Do not create local browse state.

Remove inventory, onPresent, onResume, CrossExamView presenting markup, and the local lineText helper from InterrogationView. Retain the no-current-phase copy, question callback, canComplete gate, and 720px compact layout.

- [ ] **Step 4: Autofix and rerun focused tests**

Run:
~~~sh
npx @sveltejs/mcp svelte-autofixer apps/game/src/lib/components/InterrogationStage.svelte
npx @sveltejs/mcp svelte-autofixer apps/game/src/lib/components/InterrogationView.svelte
bun run --cwd apps/game test src/lib/components/InterrogationStage.test.ts
bun run --cwd apps/game test src/lib/components/InterrogationView.test.ts
~~~

Expected: PASS.

- [ ] **Step 5: Commit the stage and phase record**

~~~sh
git add apps/game/src/lib/components/InterrogationStage.svelte apps/game/src/lib/components/InterrogationStage.test.ts apps/game/src/lib/components/InterrogationView.svelte apps/game/src/lib/components/InterrogationView.test.ts
git commit -m "feat: add interrogation stage presentation"
~~~

### Task 5: DialogueBox cross-examination presentation and hold behavior

**Files:**
- Modify: apps/game/src/lib/components/DialogueBox.svelte
- Modify: apps/game/src/lib/components/DialogueBox.test.ts

**Interfaces:**
- Extend the existing crossExam prop with presentation: CrossExamView | null.
- Existing callbacks remain onChallenge(lineId) and onWithdraw().
- Preserve class xexam-challenge, visible 反駁, and visible 退下.
- Use HOLD_DURATION_MS = 600 for pointer-only charge.

- [ ] **Step 1: Add failing DialogueBox tests**

Add tests for the actual event split:

~~~ts
await fireEvent.pointerDown(challenge, { pointerId: 1, pointerType: "mouse" });
await vi.advanceTimersByTimeAsync(600);
expect(onChallenge).toHaveBeenCalledTimes(1);
await fireEvent.click(challenge, { detail: 1 });
expect(onChallenge).toHaveBeenCalledTimes(1);

await fireEvent.pointerDown(challenge, { pointerId: 2, pointerType: "mouse" });
await fireEvent.pointerUp(challenge, { pointerId: 2, pointerType: "mouse" });
await fireEvent.click(challenge, { detail: 1 });
expect(onChallenge).toHaveBeenCalledTimes(1);

await fireEvent.click(challenge, { detail: 0 });
expect(onChallenge).toHaveBeenCalledTimes(2);
~~~

Also assert presentation shows lineIndex + 1 / lineTotal and ordinary DialogueBox markup remains unchanged when presentation is null.

- [ ] **Step 2: Run the focused test to verify it fails**

Run: bun run --cwd apps/game test src/lib/components/DialogueBox.test.ts

Expected: FAIL because the pointer handlers and presentation data are absent.

- [ ] **Step 3: Implement the presentation and pointer split**

Add a presentation class/data path without changing DialogueBox's queue, typewriter, history, or advance behavior. On pointerdown start the 600ms charge. On completion call onChallenge once and suppress only the following physical click. On early pointerup, pointercancel, or pointerleave clear the timer and suppress that same physical click. Clear suppression on a zero-delay timer if no click arrives.

In onclick, stop propagation as today. Suppress only a tracked physical click with positive detail. Direct keyboard, assistive, and programmatic clicks have detail 0 and invoke the existing callback. Keep 退下 wired to onWithdraw.

- [ ] **Step 4: Autofix and rerun the focused test**

Run:
~~~sh
npx @sveltejs/mcp svelte-autofixer apps/game/src/lib/components/DialogueBox.svelte
bun run --cwd apps/game test src/lib/components/DialogueBox.test.ts
~~~

Expected: PASS.

- [ ] **Step 5: Commit DialogueBox behavior**

~~~sh
git add apps/game/src/lib/components/DialogueBox.svelte apps/game/src/lib/components/DialogueBox.test.ts
git commit -m "feat: restyle cross examination controls"
~~~

### Task 6: Route the live game through the stage

**Files:**
- Modify: apps/game/src/routes/+page.svelte
- Modify: apps/game/src/lib/components/GameShell.test.ts if integration requires a changed harness prop
- Test: existing focused component suites from Tasks 1 through 5

**Interfaces:**
- +page owns caseFileRequestId and the callback from InterrogationStage. The
  case-file request carries `returnFocusTo: trigger` directly (no separate
  return-focus state).
- +page passes one caseFileRequest object to GameShell and resets it only after
  GameShell acknowledges the same id via onCaseFileRequestHandled.
- +page owns gameMenuRequestId and a gameMenuRequest object of the same shape,
  reset via onGameMenuRequestHandled after GameShell acknowledges the id. The
  Present tray's 遊戲選單 action calls InterrogationStage.onOpenGameMenu(trigger),
  which +page wires to openInterrogationGameMenu; opening the menu does not
  retract the tray (topLayerOpen suspends the tray's Tab trap while the menu is
  open).
- +page passes active Stage props and CrossExamView presentation data through
  the existing sole DialogueBox call.

- [ ] **Step 1: Run the compile gate after the component interface changes**

Run: bun run check

Expected: FAIL because +page still supplies the pre-redesign InterrogationView props and does not yet provide the new Stage and GameShell request props. This is the page-integration RED signal; Tasks 2 through 5 already own the behavior-level component tests.

- [ ] **Step 2: Implement page wiring**

Import the Stage, pure helpers, and tray-facing types. Keep the existing one mode chain as the Stage's child snippet. Derive the active flag once from isInterrogationPresentationActive.

On HUD click:

~~~ts
caseFileSection = "evidence";
caseFileRequestId += 1;
caseFileRequest = { id: caseFileRequestId, returnFocusTo: trigger };
~~~

Pass the request and acknowledgement callback to GameShell. In the sole DialogueBox invocation, derive the current phase and pass its CrossExamView only when crossExamLineId is non-null. In the interrogation branch, pass only the simplified InterrogationView props. Do not change any Rust command callbacks or SceneBackdrop branches.

- [ ] **Step 3: Autofix and run all focused frontend tests**

Run:
~~~sh
npx @sveltejs/mcp svelte-autofixer apps/game/src/routes/+page.svelte
bun run --cwd apps/game test src/lib/interrogation/presentation.test.ts
bun run --cwd apps/game test src/lib/components/GameShell.test.ts
bun run --cwd apps/game test src/lib/components/InterrogationEvidenceTray.test.ts
bun run --cwd apps/game test src/lib/components/InterrogationStage.test.ts
bun run --cwd apps/game test src/lib/components/InterrogationView.test.ts
bun run --cwd apps/game test src/lib/components/DialogueBox.test.ts
~~~

Expected: PASS.

- [ ] **Step 4: Commit live integration**

~~~sh
git add apps/game/src/routes/+page.svelte apps/game/src/lib/components/GameShell.test.ts
git commit -m "feat: route interrogation through presentation stage"
~~~

### Task 7: Full verification and packaged compatibility

**Files:**
- Modify only if verification exposes a focused regression.
- Test: existing packaged E2E suites and root frontend checks.

**Interfaces:**
- Preserves existing packaged test selectors and command names.
- Demonstrates synthetic direct-click compatibility separately from component-level real pointer-hold coverage.

- [ ] **Step 1: Run formatting and type validation**

Run:
~~~sh
bun run check
bun run lint:all
~~~

Expected: both commands pass.

- [ ] **Step 2: Run the complete unit suite**

Run: bun run test

Expected: PASS.

- [ ] **Step 3: Run packaged Tauri E2E**

Run: bun run test:e2e

Expected: PASS, including save-seed, save-resume, and analysis-beat85 paths that exercise 反駁 / 收回 compatibility.

- [ ] **Step 4: Inspect the final patch**

Run:
~~~sh
git diff --check HEAD~6..HEAD
git status --short
~~~

Expected: no whitespace errors; only the user-supplied untracked prototype bundle remains outside implementation commits.

- [ ] **Step 5: Commit any verification-only correction, then summarize**

If a focused correction was needed, commit it with a specific message. Otherwise do not create an empty commit. Report the focused pointer-hold evidence separately from packaged synthetic-click evidence.

/**
 * Escape-key priority coordinator.
 *
 * `GameShell` owns the global capture-phase Escape listener and toggles the
 * game menu. But nested overlays — e.g. the investigation topic popover —
 * also have a legitimate "close me" claim on Escape. This module is the
 * shared coordinator the GameShell Escape handler defers to: overlays
 * register a close callback while they are open, and GameShell's handler
 * first dispatches to the topmost registered closer, only falling through to
 * the menu toggle when no overlay is claiming Escape.
 *
 * Contract: "close one layer per Escape." Each Escape closes at most one
 * overlay (the topmost); the next Escape then toggles the menu. Ordering
 * depends on whether a submenu panel is active inside the open menu:
 *
 *   - No submenu panel: GameShell closes the menu first. The coordinator is
 *     only consulted on the next Escape if the menu was already closed.
 *   - Submenu panel active (e.g. Case File): GameShell consults the
 *     coordinator FIRST, so a submenu-internal layer — Case File relation
 *     navigation ("返回上一項") — can step back within the submenu before
 *     the submenu itself closes. Only when no overlay claims Escape does
 *     GameShell fall through to closing the submenu panel.
 *
 * This submenu-first ordering is intentional: a player who followed a
 * supporting-record or supersession link returns to the source item on one
 * Escape, not to the root menu. Do not "correct" it back to menu-first.
 *
 * Callers MUST release their handle when their overlay closes for any reason
 * (their own Escape routing, backdrop click, × button, mode change, or
 * component unmount), otherwise the menu will never open. The idiomatic
 * Svelte 5 usage is an `$effect` that claims while open and returns the
 * release function as its cleanup, so unmount/transition both release.
 *
 * Release timing is NOT required to be synchronous inside the closer. A
 * closer may clear its own "open" condition (e.g. `backTarget = null`) and
 * let the `$effect` cleanup release the claim on the next reactive flush, as
 * CaseFilePanel does. The contract is that the claim is released once the
 * overlay's open condition no longer holds — not that the closer invokes the
 * release function itself before returning.
 */
type Closer = () => void;

interface ClaimEntry {
  closer: Closer;
}

let stack: ClaimEntry[] = [];

/**
 * Register an overlay's close handler. Returns a release function that
 * removes this specific claim. Registering the same closer twice is
 * allowed; each registration gets its own unique entry, so a release
 * only ever removes its own entry — not another registration that
 * happens to share the same closer function reference.
 */
export function claimEscape(closer: Closer): () => void {
  const entry: ClaimEntry = { closer };
  stack.push(entry);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const idx = stack.indexOf(entry);
    if (idx !== -1) stack.splice(idx, 1);
  };
}

/** True when at least one overlay is currently claiming Escape. */
export function escapeClaimed(): boolean {
  return stack.length > 0;
}

/**
 * Close the topmost overlay. Returns `true` if an overlay was closed (so the
 * caller should consume the Escape and not toggle the menu), `false` if no
 * overlay claimed it (so the caller may fall through to its own Escape
 * behavior). The closer is expected to clear its own open condition so that
 * its claim is released — either synchronously inside the closer, or via
 * `$effect` cleanup on the next reactive flush (as CaseFilePanel does). If
 * the claim is never released, a stale entry would keep consuming Escape,
 * which is the documented caller contract.
 */
export function closeTopmostEscapeClaim(): boolean {
  const top = stack[stack.length - 1];
  if (!top) return false;
  top.closer();
  return true;
}

/** Test-only: clear all claims between tests. */
export function resetEscapeCoordinator(): void {
  stack = [];
}

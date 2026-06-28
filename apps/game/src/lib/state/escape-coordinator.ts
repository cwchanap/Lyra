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
 * overlay (the topmost); the next Escape then toggles the menu. The menu
 * itself is always closed first (GameShell checks `gameMenuOpen` before
 * consulting this coordinator), so a popover left open behind an open menu
 * never traps the player.
 *
 * Callers MUST release their handle when their overlay closes for any reason
 * (their own Escape routing, backdrop click, × button, mode change, or
 * component unmount), otherwise the menu will never open. The idiomatic
 * Svelte 5 usage is an `$effect` that claims while open and returns the
 * release function as its cleanup, so unmount/transition both release.
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
 * behavior). The closer is expected to release its own claim synchronously;
 * if it does not, a stale claim would keep consuming Escape, which is the
 * documented caller contract.
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

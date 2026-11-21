/**
 * Pure decision logic for verifying that the interrogation evidence tray's
 * Svelte search really applied (HPA-705 800x600 gate + SHOW/PRESENT
 * journeys). DOM reading stays on the spec side of the seam (an in-page
 * snapshot); these helpers decide purely from that snapshot so the transport
 * verification semantics are unit-testable.
 *
 * Why strictness matters: the unfiltered tray's count text is itself an
 * "顯示 N / N" full-list text and the target tile already exists in the
 * unfiltered grid. A `setValue` that fills the input without ever reaching
 * Svelte therefore leaves a DOM identical to a query that legitimately
 * matches every record — the only sound acceptance for an unchanged count is
 * an observed count transition (probe), never the count text alone.
 */

export type EvidenceTraySearchState = {
  /** The search input's current value; `null` when the input is missing. */
  value: string | null;
  /** Trimmed record-count text ("顯示 N / M"); "" when the tray is gone. */
  countText: string;
  /** Number of record tiles currently rendered in the grid. */
  tileCount: number;
  /** Whether a tile whose full title equals the searched name is rendered. */
  targetRendered: boolean;
};

/**
 * Strict transport verification: the COMPLETE query sits in the input, the
 * record-count text has LEFT the pre-search baseline, and the exact
 * full-title tile is rendered. An unchanged count is never acceptance here —
 * the baseline is itself an N/N text, so unchanged N/N is exactly what a
 * dropped (no-op) setValue looks like.
 */
export function evidenceTraySearchFilterApplied(
  state: EvidenceTraySearchState | null,
  name: string,
  baselineCountText: string,
): boolean {
  return (
    state !== null &&
    state.value === name &&
    state.targetRendered &&
    state.countText !== "" &&
    state.countText !== baselineCountText
  );
}

/**
 * Fallback liveness proof: a probe value (`query` + a suffix that matches no
 * record) has been accepted by the binding — the count moved off the
 * baseline AND the grid emptied (the suffix matched nothing, so zero tiles
 * is what "matched nothing" renders). A probe that leaves the count on the
 * baseline or keeps tiles proves the input events are not reaching Svelte
 * (or the suffix matched records), never acceptance.
 */
export function evidenceTraySearchProbeObserved(
  state: EvidenceTraySearchState | null,
  probeValue: string,
  baselineCountText: string,
): boolean {
  return (
    state !== null &&
    state.value === probeValue &&
    state.tileCount === 0 &&
    state.countText !== "" &&
    state.countText !== baselineCountText
  );
}

/**
 * Final acceptance after an observed probe transition: the exact query sits
 * in the input and the exact full-title tile is rendered. The count may
 * lawfully have returned to the baseline (a query that matches every
 * record); that is sound ONLY on this path, because the preceding probe
 * transition proved the binding processes this input's events.
 */
export function evidenceTraySearchExactQueryRendered(
  state: EvidenceTraySearchState | null,
  name: string,
): boolean {
  return (
    state !== null &&
    state.value === name &&
    state.targetRendered &&
    state.countText !== ""
  );
}

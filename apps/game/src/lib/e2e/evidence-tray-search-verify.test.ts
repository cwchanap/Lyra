import { describe, expect, it } from "vitest";
import {
  type EvidenceTraySearchState,
  evidenceTraySearchExactQueryRendered,
  evidenceTraySearchFilterApplied,
  evidenceTraySearchProbeObserved,
} from "./evidence-tray-search-verify";

const BASELINE = "顯示 83 / 83";
const QUERY = "咖啡收據";

function state(
  overrides: Partial<EvidenceTraySearchState> = {},
): EvidenceTraySearchState {
  return {
    value: QUERY,
    countText: BASELINE,
    tileCount: 83,
    targetRendered: true,
    ...overrides,
  };
}

describe("evidence tray search verification", () => {
  describe("evidenceTraySearchFilterApplied (strict transport)", () => {
    it("rejects an unchanged baseline count even when the value and tile match", () => {
      // The baseline is itself an N/N text, so an unchanged N/N count proves
      // nothing: a no-op setValue that never reached Svelte looks identical.
      // This is the regression guard for the review finding.
      expect(evidenceTraySearchFilterApplied(state(), QUERY, BASELINE)).toBe(
        false,
      );
    });

    it("accepts a real filter update: count left the baseline", () => {
      expect(
        evidenceTraySearchFilterApplied(
          state({ countText: "顯示 1 / 83" }),
          QUERY,
          BASELINE,
        ),
      ).toBe(true);
    });

    it("rejects an incomplete input value", () => {
      expect(
        evidenceTraySearchFilterApplied(
          state({ value: "咖啡", countText: "顯示 2 / 83" }),
          QUERY,
          BASELINE,
        ),
      ).toBe(false);
    });

    it("rejects when the target tile is not rendered", () => {
      expect(
        evidenceTraySearchFilterApplied(
          state({ targetRendered: false, countText: "顯示 1 / 83" }),
          QUERY,
          BASELINE,
        ),
      ).toBe(false);
    });

    it("rejects an empty count text", () => {
      expect(
        evidenceTraySearchFilterApplied(
          state({ countText: "", tileCount: 0, targetRendered: false }),
          QUERY,
          BASELINE,
        ),
      ).toBe(false);
    });

    it("rejects a missing search input", () => {
      expect(evidenceTraySearchFilterApplied(null, QUERY, BASELINE)).toBe(
        false,
      );
    });
  });

  describe("evidenceTraySearchProbeObserved (fallback liveness proof)", () => {
    const probeValue = `${QUERY}☂`;

    it("accepts a probe that emptied the grid and moved the count", () => {
      expect(
        evidenceTraySearchProbeObserved(
          state({
            value: probeValue,
            countText: "顯示 0 / 83",
            tileCount: 0,
            targetRendered: false,
          }),
          probeValue,
          BASELINE,
        ),
      ).toBe(true);
    });

    it("rejects a probe that left the count on the baseline (binding dead)", () => {
      expect(
        evidenceTraySearchProbeObserved(
          state({ value: probeValue, tileCount: 0, targetRendered: false }),
          probeValue,
          BASELINE,
        ),
      ).toBe(false);
    });

    it("rejects a probe whose suffix matched records (grid not emptied)", () => {
      expect(
        evidenceTraySearchProbeObserved(
          state({
            value: probeValue,
            countText: "顯示 3 / 83",
            tileCount: 3,
            targetRendered: true,
          }),
          probeValue,
          BASELINE,
        ),
      ).toBe(false);
    });

    it("rejects a stale probe value", () => {
      expect(
        evidenceTraySearchProbeObserved(
          state({ value: QUERY, countText: "顯示 0 / 83", tileCount: 0 }),
          probeValue,
          BASELINE,
        ),
      ).toBe(false);
    });

    it("rejects an empty count text", () => {
      expect(
        evidenceTraySearchProbeObserved(
          state({
            value: probeValue,
            countText: "",
            tileCount: 0,
            targetRendered: false,
          }),
          probeValue,
          BASELINE,
        ),
      ).toBe(false);
    });

    it("rejects a missing search input", () => {
      expect(evidenceTraySearchProbeObserved(null, probeValue, BASELINE)).toBe(
        false,
      );
    });
  });

  describe("evidenceTraySearchExactQueryRendered (post-transition acceptance)", () => {
    it("accepts the exact query whose count lawfully returned to the baseline", () => {
      // A query matching every record puts the count back on the baseline;
      // that is only accepted AFTER the probe observed a real transition.
      expect(evidenceTraySearchExactQueryRendered(state(), QUERY)).toBe(true);
    });

    it("accepts the exact query with a filtered count", () => {
      expect(
        evidenceTraySearchExactQueryRendered(
          state({ countText: "顯示 1 / 83", tileCount: 1 }),
          QUERY,
        ),
      ).toBe(true);
    });

    it("rejects a wrong value", () => {
      expect(
        evidenceTraySearchExactQueryRendered(
          state({ value: `${QUERY}☂`, countText: "顯示 0 / 83", tileCount: 0 }),
          QUERY,
        ),
      ).toBe(false);
    });

    it("rejects when the target tile is not rendered", () => {
      expect(
        evidenceTraySearchExactQueryRendered(
          state({ targetRendered: false }),
          QUERY,
        ),
      ).toBe(false);
    });

    it("rejects an empty count text", () => {
      expect(
        evidenceTraySearchExactQueryRendered(state({ countText: "" }), QUERY),
      ).toBe(false);
    });

    it("rejects a missing search input", () => {
      expect(evidenceTraySearchExactQueryRendered(null, QUERY)).toBe(false);
    });
  });
});

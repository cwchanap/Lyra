import { describe, expect, it } from "vitest";
import {
  gatedAcquisitionViolation,
  missingCompositorReceipts,
  type CompositorGateExpectations,
} from "./acquisition-compositor-gate";

/**
 * The recordId-scoped coverage decisions the armed compositor gate
 * applies inside startAcquisitionAcknowledgement and the inv3 leg's
 * receipt requirement (HPA-831 final review): a gated record must carry
 * its authored imageAssetId and produce a successful crop receipt, or
 * popup coverage silently disappears while the journey stays green.
 */

const EXPECTED: CompositorGateExpectations = new Map([
  ["cctv_screenshot", "evidence.cctv_screenshot"],
  ["timecard_record", "evidence.timecard_record"],
  ["doorlock_summary_timetable", "evidence.doorlock_summary_timetable"],
]);

const popup = (
  recordId: string,
  imageAssetId: string | null,
): { id: string; recordId: string; imageAssetId: string | null } => ({
  id: `acq:1:${recordId}`,
  recordId,
  imageAssetId,
});

describe("gatedAcquisitionViolation", () => {
  it("passes a gated record carrying its authored imageAssetId", () => {
    expect(
      gatedAcquisitionViolation(
        EXPECTED,
        popup("cctv_screenshot", "evidence.cctv_screenshot"),
      ),
    ).toBeNull();
  });

  it("fails a gated record whose popup reports a null imageAssetId", () => {
    const violation = gatedAcquisitionViolation(
      EXPECTED,
      popup("cctv_screenshot", null),
    );
    expect(violation).toContain("cctv_screenshot");
    expect(violation).toContain("evidence.cctv_screenshot");
  });

  it("fails a gated record whose popup reports a wrong imageAssetId", () => {
    const violation = gatedAcquisitionViolation(
      EXPECTED,
      popup("timecard_record", "evidence.doorlock_summary_timetable"),
    );
    expect(violation).toContain("timecard_record");
    expect(violation).toContain("evidence.timecard_record");
  });

  it("exempts ungated records, including legitimate null-asset ones", () => {
    expect(
      gatedAcquisitionViolation(EXPECTED, popup("closing_routine", null)),
    ).toBeNull();
    expect(
      gatedAcquisitionViolation(
        EXPECTED,
        popup("closing_routine", "evidence.closing_routine"),
      ),
    ).toBeNull();
  });

  it("exempts every record when no gate is armed", () => {
    expect(
      gatedAcquisitionViolation(null, popup("cctv_screenshot", null)),
    ).toBeNull();
  });
});

describe("missingCompositorReceipts", () => {
  const receipts = (...recordIds: string[]): ReadonlyMap<string, string> =>
    new Map(recordIds.map((id) => [id, `acquisition-${id}.png`]));

  it("is empty once every scoped record produced a crop receipt", () => {
    expect(
      missingCompositorReceipts(
        EXPECTED,
        receipts(
          "cctv_screenshot",
          "timecard_record",
          "doorlock_summary_timetable",
        ),
      ),
    ).toEqual([]);
  });

  it("lists every scoped record still lacking a receipt", () => {
    expect(
      missingCompositorReceipts(EXPECTED, receipts("cctv_screenshot")),
    ).toEqual(["timecard_record", "doorlock_summary_timetable"]);
    expect(missingCompositorReceipts(EXPECTED, new Map())).toEqual([
      "cctv_screenshot",
      "timecard_record",
      "doorlock_summary_timetable",
    ]);
  });
});

import { describe, expect, it } from "vitest";
import {
  caseFileViewportNativeSize,
  meetsCaseFileViewportTarget,
  validDevicePixelRatio,
} from "./case-file-viewport";

describe("Case File packaged viewport sizing", () => {
  it("scales the desktop target for DPR 1, 1.25, and 2", () => {
    expect(caseFileViewportNativeSize(1)).toEqual({ width: 1280, height: 720 });
    expect(caseFileViewportNativeSize(1.25)).toEqual({
      width: 1600,
      height: 900,
    });
    expect(caseFileViewportNativeSize(2)).toEqual({
      width: 2560,
      height: 1440,
    });
  });

  it("rounds native pixels upward and falls back from invalid DPR values", () => {
    expect(validDevicePixelRatio(0)).toBe(1);
    expect(validDevicePixelRatio(Number.NaN)).toBe(1);
    expect(
      caseFileViewportNativeSize(1.25, { width: 1200.1, height: 650.1 }),
    ).toEqual({ width: 1501, height: 813 });
  });

  it("requires both CSS dimensions to reach the desktop target", () => {
    expect(meetsCaseFileViewportTarget({ width: 1280, height: 720 })).toBe(
      true,
    );
    expect(meetsCaseFileViewportTarget({ width: 1279, height: 720 })).toBe(
      false,
    );
    expect(meetsCaseFileViewportTarget({ width: 1280, height: 719 })).toBe(
      false,
    );
  });
});

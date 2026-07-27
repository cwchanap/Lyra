import { afterEach, describe, expect, it, vi } from "vitest";
import {
  pinThumbnailCaptureDeadline,
  thumbnailCaptureDeadline,
} from "./thumbnail-capture";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("thumbnail capture deadline", () => {
  it("pins timeoutMs once at receipt", () => {
    const request = { ticket: "ticket-1", timeoutMs: 725 };

    pinThumbnailCaptureDeadline(request, 100);

    expect(thumbnailCaptureDeadline(request)).toBe(825);
  });

  it("pins an unregistered request on first observation without resetting it", () => {
    const request = { ticket: "ticket-2", timeoutMs: 725 };
    vi.spyOn(performance, "now")
      .mockReturnValueOnce(100)
      .mockReturnValueOnce(999);

    expect(thumbnailCaptureDeadline(request)).toBe(825);
    expect(thumbnailCaptureDeadline(request)).toBe(825);
  });
});

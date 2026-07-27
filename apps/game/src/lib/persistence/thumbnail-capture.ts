import type {
  GameplayThumbnailCapture,
  ThumbnailCaptureRequestView,
} from "./types";

const fixedDeadlines = new WeakMap<ThumbnailCaptureRequestView, number>();

export function pinThumbnailCaptureDeadline(
  request: ThumbnailCaptureRequestView,
  now = performance.now(),
): ThumbnailCaptureRequestView {
  if (!fixedDeadlines.has(request)) {
    fixedDeadlines.set(request, now + Math.max(0, request.timeoutMs));
  }
  return request;
}

export function thumbnailCaptureDeadline(
  request: ThumbnailCaptureRequestView,
): number {
  const existing = fixedDeadlines.get(request);
  if (existing !== undefined) return existing;
  const deadline = performance.now() + Math.max(0, request.timeoutMs);
  fixedDeadlines.set(request, deadline);
  return deadline;
}

export const gameplayThumbnailCapture: GameplayThumbnailCapture = {
  async capture() {
    return {
      type: "unavailable",
      reason: "Gameplay thumbnail capture is not configured.",
    };
  },
};

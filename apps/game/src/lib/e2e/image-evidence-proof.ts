/**
 * HPA-831 image-evidence proof sequencing (review finding): mount, decode,
 * placeholder, source-canvas, and wrong/null-asset failures all used to
 * throw BEFORE the required failure screenshot, losing the exact frame the
 * plan mandates. This module holds the shared orchestration the popup and
 * Case File paths both run — injected ops are the WebDriver seam, the
 * ordering policy here is the real code exercised by vitest.
 */

/** One mounted `<img>`'s diagnostic facts — geometry included only for
 * reporting; the failure evidence never depends on it being present. */
export type ImagePresenceImage = {
  currentSrc: string;
  complete: boolean;
  naturalWidth: number;
  naturalHeight: number;
  rect: { left: number; top: number; width: number; height: number };
};

export type ImagePresenceProbe = {
  mounted: boolean;
  images: ImagePresenceImage[];
};

/**
 * Serialized page script for the failure diagnostics: report whether the
 * image is mounted and its observable state. A missing image is itself the
 * failure mode, so callers must treat `mounted: false` as a normal answer.
 */
export function probeImagePresenceDom(selector: string): ImagePresenceProbe {
  const images = Array.from(
    document.querySelectorAll<HTMLImageElement>(selector),
  ).map((image) => {
    const rect = image.getBoundingClientRect();
    return {
      currentSrc: image.currentSrc || image.src,
      complete: image.complete,
      naturalWidth: image.naturalWidth,
      naturalHeight: image.naturalHeight,
      rect: {
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
      },
    };
  });
  return { mounted: images.length > 0, images };
}

/**
 * Sequencing contract shared by the acquisition-popup and Case File image
 * proofs:
 *   prepare (optional) -> inspect -> report -> assert -> provePainted
 *   (optional) -> onReceipt (optional, only after a passing crop).
 * ANY failure — navigation, mount, decode, placeholder, source canvas, or
 * crop — first runs captureFailure so the 800x600 failure evidence exists
 * before the viewport is restored, then the ORIGINAL error is rethrown even
 * when captureFailure itself rejects. A thrown proof must never produce a
 * receipt, so onReceipt only runs after provePainted resolves.
 */
export type ImageEvidenceProofOptions<Inspection> = {
  /** e.g. open the record detail whose image is about to be proven. */
  prepare?: () => Promise<void>;
  inspect: () => Promise<Inspection>;
  report?: (inspection: Inspection) => void;
  assert: (inspection: Inspection) => void | Promise<void>;
  /** The gated screenshot-crop compositor proof. */
  provePainted?: () => Promise<void>;
  /** Record the scoped compositor receipt — runs only after a passing
   * provePainted so a failed crop can never count as coverage. */
  onReceipt?: () => void;
  /** Save the required failure evidence; may itself reject without
   * suppressing the original error. `inspection` is null when the image
   * never produced one. */
  captureFailure: (input: {
    error: unknown;
    inspection: Inspection | null;
  }) => Promise<void>;
};

export async function runImageEvidenceProof<Inspection>(
  options: ImageEvidenceProofOptions<Inspection>,
): Promise<void> {
  let inspection: Inspection | null = null;
  try {
    await options.prepare?.();
    inspection = await options.inspect();
    options.report?.(inspection);
    await options.assert(inspection);
    if (options.provePainted !== undefined) {
      await options.provePainted();
      options.onReceipt?.();
    }
  } catch (error) {
    await capturePreservingError(() =>
      options.captureFailure({ error, inspection }),
    );
    throw error;
  }
}

/** Run the failure-evidence capture without ever masking the real error:
 * a rejected capture is logged, never propagated. */
async function capturePreservingError(
  capture: () => Promise<void>,
): Promise<void> {
  try {
    await capture();
  } catch (captureError) {
    console.error(
      "[ImageEvidenceProof] failure-evidence capture failed — preserving the original error:",
      captureError,
    );
  }
}

/** One scoped Case File record the early gate must prove. */
export type CaseFileRecordTarget = {
  id: string;
  name: string;
  assetId: string;
};

/**
 * Early gate for the Case File proof (review-fix-3 Finding B): every scoped
 * target must have been organically acquired and carry its authored
 * imageAssetId BEFORE the menu is opened. A missing record or a wrong/null
 * asset id is required failure evidence — captureFailure runs while the
 * 800x600 window is still up (a raw viewport screenshot; the record's image
 * is not mounted yet by definition), then the ORIGINAL error is rethrown
 * even when capture itself fails.
 */
export async function runCaseFileRecordGate(options: {
  targets: readonly CaseFileRecordTarget[];
  gateWrapper: string;
  findRecord: (
    target: CaseFileRecordTarget,
  ) => { imageAssetId: string | null } | undefined;
  captureFailure: (input: {
    target: CaseFileRecordTarget;
    error: unknown;
  }) => Promise<void>;
}): Promise<void> {
  for (const target of options.targets) {
    try {
      const record = options.findRecord(target);
      if (!record) {
        throw new Error(
          `Case File gate reached ${options.gateWrapper} without organically acquiring ${target.id} (${target.name})`,
        );
      }
      if (record.imageAssetId !== target.assetId) {
        throw new Error(
          `${target.id} imageAssetId is ${String(record.imageAssetId)}, expected ${target.assetId}`,
        );
      }
    } catch (error) {
      await capturePreservingError(() =>
        options.captureFailure({ target, error }),
      );
      throw error;
    }
  }
}

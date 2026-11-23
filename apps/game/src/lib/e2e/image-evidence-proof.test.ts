import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  probeImagePresenceDom,
  runImageEvidenceProof,
} from "./image-evidence-proof";

describe("runImageEvidenceProof", () => {
  it("captures failure evidence and rethrows the original error when the image never mounts", async () => {
    const mountError = new Error("image did not mount");
    const calls: string[] = [];
    const captured: { error: unknown; inspection: unknown }[] = [];
    await expect(
      runImageEvidenceProof({
        inspect: async () => {
          calls.push("inspect");
          throw mountError;
        },
        report: () => calls.push("report"),
        assert: () => {
          calls.push("assert");
        },
        provePainted: async () => {
          calls.push("provePainted");
        },
        onReceipt: () => calls.push("onReceipt"),
        captureFailure: async ({ error, inspection }) => {
          captured.push({ error, inspection });
          calls.push("captureFailure");
        },
      }),
    ).rejects.toBe(mountError);
    expect(captured).toEqual([{ error: mountError, inspection: null }]);
    expect(calls).toEqual(["inspect", "captureFailure"]);
  });

  it("passes the collected inspection to captureFailure when the source proof fails", async () => {
    const inspection = { decode: { ok: false }, mountWaitMs: 3 };
    const sourceError = new Error("img.decode() rejected");
    const captured: { error: unknown; inspection: unknown }[] = [];
    const calls: string[] = [];
    await expect(
      runImageEvidenceProof({
        inspect: async () => {
          calls.push("inspect");
          return inspection;
        },
        assert: () => {
          calls.push("assert");
          throw sourceError;
        },
        provePainted: async () => {
          calls.push("provePainted");
        },
        onReceipt: () => calls.push("onReceipt"),
        captureFailure: async ({ error, inspection: seen }) => {
          captured.push({ error, inspection: seen });
          calls.push("captureFailure");
        },
      }),
    ).rejects.toBe(sourceError);
    expect(captured).toEqual([{ error: sourceError, inspection }]);
    expect(calls).toEqual(["inspect", "assert", "captureFailure"]);
  });

  it("never produces a receipt when the crop proof throws", async () => {
    const calls: string[] = [];
    await expect(
      runImageEvidenceProof({
        inspect: async () => ({}),
        assert: () => {},
        provePainted: async () => {
          calls.push("provePainted");
          throw new Error("crop region was single-color");
        },
        onReceipt: () => calls.push("onReceipt"),
        captureFailure: async () => {
          calls.push("captureFailure");
        },
      }),
    ).rejects.toThrow("crop region was single-color");
    expect(calls).toEqual(["provePainted", "captureFailure"]);
  });

  it("rethrows the original error even when failure capture itself fails", async () => {
    const original = new Error("img.decode() rejected");
    await expect(
      runImageEvidenceProof({
        inspect: async () => ({}),
        assert: () => {
          throw original;
        },
        captureFailure: async () => {
          throw new Error("saveScreenshot failed");
        },
      }),
    ).rejects.toBe(original);
  });

  it("runs prepare, inspect, assert, crop, and receipt in order on success", async () => {
    const calls: string[] = [];
    await runImageEvidenceProof({
      prepare: async () => {
        calls.push("prepare");
      },
      inspect: async () => {
        calls.push("inspect");
        return {};
      },
      report: () => calls.push("report"),
      assert: () => {
        calls.push("assert");
      },
      provePainted: async () => {
        calls.push("provePainted");
      },
      onReceipt: () => calls.push("onReceipt"),
      captureFailure: async () => {
        calls.push("captureFailure");
      },
    });
    expect(calls).toEqual([
      "prepare",
      "inspect",
      "report",
      "assert",
      "provePainted",
      "onReceipt",
    ]);
  });
});

describe("probeImagePresenceDom", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("reports mounted:false when no image matches", () => {
    expect(probeImagePresenceDom("img.missing")).toEqual({
      mounted: false,
      images: [],
    });
  });

  it("reports each mounted image's observable state", () => {
    const image = document.createElement("img");
    image.src = "http://localhost/assets/evidence/cctv_screenshot.png";
    document.body.appendChild(image);
    const probe = probeImagePresenceDom("img");
    expect(probe.mounted).toBe(true);
    expect(probe.images).toHaveLength(1);
    expect(probe.images[0]?.currentSrc).toContain("cctv_screenshot.png");
  });
});

/**
 * Real-orchestration coverage: these tests drive the actual exported
 * `startAcquisitionAcknowledgement` from e2e-tauri/helpers.ts behind a
 * stubbed `browser` global — the real waitForButton, card-title check,
 * gatedAcquisitionViolation, inspectImageElement, and the NEW failure-
 * evidence capture all run; only the WebDriver boundary is faked.
 */
describe("startAcquisitionAcknowledgement failure evidence (real helpers.ts orchestration)", () => {
  let outputDir: string;
  let helpers: typeof import("../../../e2e-tauri/helpers");
  const screenshots: string[] = [];
  const RECORD = {
    id: "pending-1",
    recordId: "cctv_screenshot",
    recordKind: "evidence" as const,
    title: "閉店監視器截圖",
    imageAssetId: "evidence.cctv_screenshot" as string | null,
  };

  function mountPopupDom(withImage: string | null): void {
    document.body.innerHTML = "";
    const card = document.createElement("div");
    card.className = "acquisition-card";
    const title = document.createElement("div");
    title.className = "item-title";
    title.textContent = RECORD.title;
    card.appendChild(title);
    if (withImage !== null) {
      const image = document.createElement("img");
      image.className = "evidence-image";
      image.src = withImage;
      card.appendChild(image);
    }
    document.body.appendChild(card);
    const button = document.createElement("button");
    button.textContent = "CONTINUE";
    document.body.appendChild(button);
  }

  beforeEach(async () => {
    outputDir = mkdtempSync(path.join(tmpdir(), "hpa831-failure-"));
    screenshots.length = 0;
    helpers = await import("../../../e2e-tauri/helpers");
    vi.stubGlobal("browser", {
      waitUntil: async (
        condition: () => Promise<boolean>,
        options: { timeoutMsg?: string },
      ) => {
        for (let poll = 0; poll < 4; poll += 1) {
          if (await condition()) return true;
        }
        throw new Error(options.timeoutMsg ?? "waitUntil timeout");
      },
      execute: (fn: (...args: unknown[]) => unknown, ...args: unknown[]) =>
        Promise.resolve(fn(...args)),
      executeAsync: (fn: (...args: unknown[]) => void, ...args: unknown[]) =>
        new Promise((resolve) => {
          fn(...args, resolve);
        }),
      saveScreenshot: async (screenshotPath: string) => {
        screenshots.push(screenshotPath);
        writeFileSync(screenshotPath, "png-bytes");
      },
      pause: async () => {},
    });
    helpers.setAcquisitionCompositorGate({
      expectedAssetIds: new Map([
        ["cctv_screenshot", "evidence.cctv_screenshot"],
      ]),
      outputDirectory: outputDir,
    });
  });

  afterEach(() => {
    helpers.setAcquisitionCompositorGate(null);
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
    rmSync(outputDir, { recursive: true, force: true });
  });

  it("saves the failure viewport screenshot and diagnostics for a wrong imageAssetId before throwing", async () => {
    mountPopupDom(null);
    await expect(
      helpers.startAcquisitionAcknowledgement({
        ...RECORD,
        imageAssetId: "evidence.doorlock_summary_timetable",
      }),
    ).rejects.toThrow(/expected evidence\.cctv_screenshot/);
    // On the pre-fix code this screenshot simply did not exist (red).
    expect(screenshots).toEqual([
      path.join(outputDir, "acquisition-cctv_screenshot-identity-failure.png"),
    ]);
    const diagnostics = JSON.parse(
      readFileSync(screenshots[0]!.replace(/\.png$/, ".json"), "utf8"),
    ) as { error: string; diagnostics: { imageAssetId: string | null } };
    expect(diagnostics.error).toContain("expected evidence.cctv_screenshot");
    expect(diagnostics.diagnostics.imageAssetId).toBe(
      "evidence.doorlock_summary_timetable",
    );
    expect(helpers.acquisitionCompositorReceipts().size).toBe(0);
  });

  it("saves the failure viewport screenshot and diagnostics when the image never mounts", async () => {
    mountPopupDom(null);
    await expect(
      helpers.startAcquisitionAcknowledgement({ ...RECORD }),
    ).rejects.toThrow(/did not mount/);
    expect(screenshots).toEqual([
      path.join(outputDir, "acquisition-evidence_cctv_screenshot-failure.png"),
    ]);
    const diagnostics = JSON.parse(
      readFileSync(screenshots[0]!.replace(/\.png$/, ".json"), "utf8"),
    ) as { error: string; image: { mounted: boolean } };
    expect(diagnostics.error).toContain("did not mount");
    expect(diagnostics.image.mounted).toBe(false);
    expect(helpers.acquisitionCompositorReceipts().size).toBe(0);
  });

  it("keeps the original source-proof error and still saves evidence when screenshot capture fails", async () => {
    const expectedPath = `/assets/evidence/cctv_screenshot.png`;
    mountPopupDom(`http://localhost${expectedPath}`);
    const saveScreenshot = vi.fn(async () => {
      throw new Error("compositor unavailable");
    });
    vi.stubGlobal("browser", {
      waitUntil: async (
        condition: () => Promise<boolean>,
        options: { timeoutMsg?: string },
      ) => {
        for (let poll = 0; poll < 4; poll += 1) {
          if (await condition()) return true;
        }
        throw new Error(options.timeoutMsg ?? "waitUntil timeout");
      },
      execute: (fn: (...args: unknown[]) => unknown, ...args: unknown[]) =>
        Promise.resolve(fn(...args)),
      executeAsync: (fn: (...args: unknown[]) => void, ...args: unknown[]) =>
        new Promise((resolve) => {
          fn(...args, resolve);
        }),
      saveScreenshot,
      pause: async () => {},
    });
    // jsdom cannot decode/canvas-sample the image, so the real
    // assertInspectedImage source proof throws — the failure-evidence
    // ordering and original-error preservation are what is under test.
    const failure = await helpers
      .startAcquisitionAcknowledgement({ ...RECORD })
      .then(
        () => null,
        (error: unknown) => error,
      );
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).not.toContain("compositor unavailable");
    expect(saveScreenshot).toHaveBeenCalledWith(
      path.join(outputDir, "acquisition-evidence_cctv_screenshot-failure.png"),
    );
    const diagnosticsPath = path.join(
      outputDir,
      "acquisition-evidence_cctv_screenshot-failure.json",
    );
    const diagnostics = JSON.parse(readFileSync(diagnosticsPath, "utf8")) as {
      error: string;
      image: { mounted: boolean };
    };
    expect(diagnostics.image.mounted).toBe(true);
    expect(helpers.acquisitionCompositorReceipts().size).toBe(0);
  });

  it("Case File composition: the real captureImageFailureDiagnostics writes the viewport evidence when the record image is absent", async () => {
    // verifyHpa831CaseFileRecords lives inside the WDIO spec and cannot be
    // imported by vitest; this drives the identical composition it wires —
    // runImageEvidenceProof + the real captureImageFailureDiagnostics — so
    // the Case File failure path (viewport screenshot + diagnostics JSON
    // before the viewport restore) is covered by the real helpers.
    const selector = "img.case-file-record-image";
    const screenshotPath = path.join(
      outputDir,
      "case-file-cctv_screenshot-failure.png",
    );
    await expect(
      runImageEvidenceProof<never>({
        inspect: async () => {
          throw new Error(`Case File image did not mount: ${selector}`);
        },
        assert: () => {},
        captureFailure: ({ error, inspection }) =>
          helpers.captureImageFailureDiagnostics({
            label: "Case File cctv_screenshot (閉店監視器截圖)",
            selector,
            screenshotPath,
            error,
            diagnostics: { recordId: "cctv_screenshot", inspection },
          }),
      }),
    ).rejects.toThrow(/did not mount/);
    expect(screenshots).toEqual([screenshotPath]);
    const diagnostics = JSON.parse(
      readFileSync(screenshotPath.replace(/\.png$/, ".json"), "utf8"),
    ) as {
      error: string;
      image: { mounted: boolean };
      diagnostics: { recordId: string };
    };
    expect(diagnostics.error).toContain("did not mount");
    expect(diagnostics.image.mounted).toBe(false);
    expect(diagnostics.diagnostics.recordId).toBe("cctv_screenshot");
  });
});

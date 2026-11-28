import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  runImageEvidenceProof,
  withImageFailureEvidence,
} from "../src/lib/e2e/image-evidence-proof";
import * as helpers from "./helpers";

/**
 * Real-orchestration coverage: these tests drive the actual exported
 * `startAcquisitionAcknowledgement` and `captureImageFailureDiagnostics`
 * from ./helpers.ts behind a stubbed `browser` global — the real
 * waitForButton, card-title check, gatedAcquisitionViolation,
 * inspectImageElement, assertInspectedImage and the failure-evidence
 * capture all run; only the WebDriver boundary is faked.
 *
 * The file lives in e2e-tauri/ (not src/lib/e2e/) on purpose: importing
 * helpers.ts pulls the WDIO `browser` global and the e2e .mjs scripts, so
 * the test belongs to the tsconfig.e2e.json program — keeping it under
 * src/ regressed `bun run check` by sweeping the harness into the app
 * typecheck (review-fix-3 Finding A).
 */
describe("startAcquisitionAcknowledgement failure evidence (real helpers.ts orchestration)", () => {
  let outputDir: string;
  const screenshots: string[] = [];
  const RECORD = {
    id: "pending-1",
    recordId: "cctv_screenshot",
    recordKind: "evidence" as const,
    title: "閉店監視器截圖",
    imageAssetId: "evidence.cctv_screenshot" as string | null,
  };

  function mountPopupDom(withImage: string | null): void {
    mountPopupDomWithTitle(RECORD.title, withImage);
  }

  function mountPopupDomWithTitle(
    title: string,
    withImage: string | null,
  ): void {
    document.body.innerHTML = "";
    const card = document.createElement("div");
    card.className = "acquisition-card";
    const titleElement = document.createElement("div");
    titleElement.className = "item-title";
    titleElement.textContent = title;
    card.appendChild(titleElement);
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

  function stubBrowser(overrides?: {
    waitUntil?: (condition: () => Promise<boolean>) => Promise<unknown>;
    saveScreenshot?: (screenshotPath: string) => Promise<void>;
  }): void {
    vi.stubGlobal("browser", {
      waitUntil:
        overrides?.waitUntil ??
        (async (
          condition: () => Promise<boolean>,
          options: { timeoutMsg?: string },
        ) => {
          for (let poll = 0; poll < 4; poll += 1) {
            if (await condition()) return true;
          }
          throw new Error(options.timeoutMsg ?? "waitUntil timeout");
        }),
      execute: (fn: (...args: unknown[]) => unknown, ...args: unknown[]) =>
        Promise.resolve(fn(...args)),
      executeAsync: (fn: (...args: unknown[]) => void, ...args: unknown[]) =>
        new Promise((resolve) => {
          fn(...args, resolve);
        }),
      saveScreenshot:
        overrides?.saveScreenshot ??
        (async (screenshotPath: string) => {
          screenshots.push(screenshotPath);
          writeFileSync(screenshotPath, "png-bytes");
        }),
      pause: async () => {},
    });
  }

  beforeEach(async () => {
    outputDir = mkdtempSync(path.join(tmpdir(), "hpa831-failure-"));
    screenshots.length = 0;
    stubBrowser();
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

  it("saves failure evidence when the CONTINUE button never appears on a gated record", async () => {
    // The popup never renders: waitForButton polls an empty DOM, times out,
    // and — on the pre-fix code — propagated without any evidence attempt.
    document.body.innerHTML = "";
    await expect(
      helpers.startAcquisitionAcknowledgement({ ...RECORD }),
    ).rejects.toThrow(/enabled button CONTINUE did not appear/);
    expect(screenshots).toEqual([
      path.join(outputDir, "acquisition-cctv_screenshot-ack-failure.png"),
    ]);
    const diagnostics = JSON.parse(
      readFileSync(screenshots[0]!.replace(/\.png$/, ".json"), "utf8"),
    ) as {
      error: string;
      image: { mounted: boolean };
      diagnostics: { recordId: string };
    };
    expect(diagnostics.error).toContain(
      "enabled button CONTINUE did not appear",
    );
    expect(diagnostics.image.mounted).toBe(false);
    expect(diagnostics.diagnostics.recordId).toBe("cctv_screenshot");
    expect(helpers.acquisitionCompositorReceipts().size).toBe(0);
  });

  it("saves failure evidence when the visible popup is not the gated record's card", async () => {
    // Another record's card is on top: waitForButton passes (CONTINUE is
    // mounted) but the title check rejects — pre-fix that threw bare.
    mountPopupDomWithTitle("三宅打卡紀錄", null);
    await expect(
      helpers.startAcquisitionAcknowledgement({ ...RECORD }),
    ).rejects.toThrow(/was not the current DOM notification/);
    expect(screenshots).toEqual([
      path.join(outputDir, "acquisition-cctv_screenshot-ack-failure.png"),
    ]);
    const diagnostics = JSON.parse(
      readFileSync(screenshots[0]!.replace(/\.png$/, ".json"), "utf8"),
    ) as { error: string };
    expect(diagnostics.error).toContain("was not the current DOM notification");
    expect(helpers.acquisitionCompositorReceipts().size).toBe(0);
  });

  it("keeps the plain error path for an UNGATED record whose CONTINUE never appears", async () => {
    helpers.setAcquisitionCompositorGate({
      expectedAssetIds: new Map([
        ["doorlock_summary_timetable", "evidence.doorlock_summary_timetable"],
      ]),
      outputDirectory: outputDir,
    });
    document.body.innerHTML = "";
    await expect(
      helpers.startAcquisitionAcknowledgement({ ...RECORD }),
    ).rejects.toThrow(/enabled button CONTINUE did not appear/);
    expect(screenshots).toEqual([]);
    expect(helpers.acquisitionCompositorReceipts().size).toBe(0);
  });

  it("keeps the original source-proof error and still saves evidence when screenshot capture fails", async () => {
    const expectedPath = `/assets/evidence/cctv_screenshot.png`;
    mountPopupDom(`http://localhost${expectedPath}`);
    const saveScreenshot = vi.fn(async () => {
      throw new Error("compositor unavailable");
    });
    stubBrowser({ saveScreenshot });
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

  it("Case File navigation boundary: the real capture writes viewport evidence when the game menu never opens", async () => {
    // verifyHpa831CaseFileRecords wraps openGameMenu + the 案件檔案 entry and
    // 證物 tab clicks in withImageFailureEvidence; this drives the identical
    // composition — the same boundary plus the real
    // captureImageFailureDiagnostics — so a failed menu open produces the
    // required viewport frame + diagnostics before the outer finally
    // restores the window.
    const screenshotPath = path.join(
      outputDir,
      "case-file-navigation-failure.png",
    );
    const menuError = new Error("enabled button 遊戲選單 did not appear");
    const failure = await withImageFailureEvidence(
      async () => {
        throw menuError;
      },
      (error) =>
        helpers.captureImageFailureDiagnostics({
          label: "Case File menu navigation at inv_3_wrap",
          selector: "img.case-file-record-image",
          screenshotPath,
          error,
          diagnostics: { stage: "menu-navigation", gateWrapper: "inv_3_wrap" },
        }),
    ).then(
      () => null,
      (error: unknown) => error,
    );
    expect(failure).toBe(menuError);
    expect(screenshots).toEqual([screenshotPath]);
    const diagnostics = JSON.parse(
      readFileSync(screenshotPath.replace(/\.png$/, ".json"), "utf8"),
    ) as { error: string; diagnostics: { stage: string } };
    expect(diagnostics.error).toContain("遊戲選單");
    expect(diagnostics.diagnostics.stage).toBe("menu-navigation");
  });

  it("Case File navigation boundary: evidence-tab click failure writes evidence and rethrows the original error", async () => {
    const screenshotPath = path.join(
      outputDir,
      "case-file-navigation-failure.png",
    );
    const tabError = new Error("button containing 證物 not found");
    await expect(
      withImageFailureEvidence(
        async () => {
          throw tabError;
        },
        (error) =>
          helpers.captureImageFailureDiagnostics({
            label: "Case File menu navigation at inv_3_wrap",
            selector: "img.case-file-record-image",
            screenshotPath,
            error,
            diagnostics: {
              stage: "menu-navigation",
              gateWrapper: "inv_3_wrap",
            },
          }),
      ),
    ).rejects.toBe(tabError);
    expect(screenshots).toEqual([screenshotPath]);
    expect(
      JSON.parse(
        readFileSync(screenshotPath.replace(/\.png$/, ".json"), "utf8"),
      ),
    ).toMatchObject({ error: "button containing 證物 not found" });
  });

  it("missing compositor-receipt rejection: boundary writes viewport evidence and rethrows the original error", async () => {
    // runInv3EvidenceAndCaseFileGate wraps the missing-receipt throw in
    // withImageFailureEvidence — drive the identical composition with the
    // real capture helper: PNG + JSON (missing list + receipts) written,
    // original error rethrown, and no receipt can ever be created.
    const screenshotPath = path.join(
      outputDir,
      "acquisition-missing-receipts-failure.png",
    );
    const missing = ["cctv_screenshot"];
    const receiptError = new Error(
      `inv_3_wrap: no compositor-crop proof for ${missing.join(", ")}`,
    );
    const failure = await withImageFailureEvidence(
      async () => {
        throw receiptError;
      },
      (error) =>
        helpers.captureImageFailureDiagnostics({
          label: "compositor receipts missing at inv_3_wrap",
          selector: ".acquisition-card img.evidence-image",
          screenshotPath,
          error,
          diagnostics: {
            stage: "compositor-receipts",
            gateWrapper: "inv_3_wrap",
            missing,
            receipts: {},
          },
        }),
    ).then(
      () => null,
      (error: unknown) => error,
    );
    expect(failure).toBe(receiptError);
    expect(screenshots).toEqual([screenshotPath]);
    const diagnostics = JSON.parse(
      readFileSync(screenshotPath.replace(/\.png$/, ".json"), "utf8"),
    ) as {
      error: string;
      diagnostics: { missing: string[]; stage: string };
    };
    expect(diagnostics.diagnostics.missing).toEqual(["cctv_screenshot"]);
    expect(diagnostics.diagnostics.stage).toBe("compositor-receipts");
    expect(helpers.acquisitionCompositorReceipts().size).toBe(0);
  });
});

/**
 * WebKitGTK's `BitmapImage::draw` returns `DidRequestDecoding` — drawing
 * nothing — when the canvas asks for a decode variant the image cache has not
 * produced yet, and `img.decode()` only proves the *natural-size* image, not
 * that variant. The source proof therefore has to re-sample the canvas on
 * later turns instead of trusting the first draw, while a genuinely blank or
 * corrupt source must still fail after the bounded retries.
 */
describe("inspectImageElement canvas sampling under WebKit's blank first draw", () => {
  const PATH_FRAGMENT = "/assets/evidence/timecard_record.png";

  function mountCaseFileImage(): HTMLImageElement {
    document.body.innerHTML = "";
    const image = document.createElement("img");
    image.className = "case-file-record-image";
    image.src = `tauri://localhost${PATH_FRAGMENT}`;
    Object.defineProperty(image, "complete", {
      configurable: true,
      get: () => true,
    });
    Object.defineProperty(image, "naturalWidth", {
      configurable: true,
      get: () => 8,
    });
    Object.defineProperty(image, "naturalHeight", {
      configurable: true,
      get: () => 8,
    });
    Object.defineProperty(image, "currentSrc", {
      configurable: true,
      get: () => image.src,
    });
    Object.assign(image, { decode: () => Promise.resolve() });
    document.body.appendChild(image);
    return image;
  }

  /** Simulates WebKit's canvas: the first `blankDraws` draws land before the
   * frame the canvas asked for exists, so they write nothing. */
  function stubCanvasSampler(options: {
    blankDraws: number;
    onDraw?: (drawCount: number) => void;
  }): () => number {
    let drawCount = 0;
    const context = {
      clearRect: () => {},
      drawImage: () => {
        drawCount += 1;
        options.onDraw?.(drawCount);
      },
      getImageData: (x: number, y: number, width: number, height: number) => {
        const data = new Uint8ClampedArray(width * height * 4);
        if (drawCount > options.blankDraws) {
          for (let offset = 0; offset < data.length; offset += 4) {
            data[offset] = (offset * 3) % 256;
            data[offset + 1] = (offset * 7) % 256;
            data[offset + 2] = (offset * 11) % 256;
            data[offset + 3] = 255;
          }
        }
        return { data, width, height, colorSpace: "srgb" };
      },
    };
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
      (() => context) as unknown as HTMLCanvasElement["getContext"],
    );
    return () => drawCount;
  }

  function stubBrowser(): void {
    vi.stubGlobal("browser", {
      waitUntil: async (condition: () => Promise<boolean>) => {
        if (!(await condition()))
          throw new Error("condition never became true");
        return true;
      },
      execute: (fn: (...args: unknown[]) => unknown, ...args: unknown[]) =>
        Promise.resolve(fn(...args)),
      executeAsync: (fn: (...args: unknown[]) => void, ...args: unknown[]) =>
        new Promise((resolve) => {
          void fn(...args, resolve);
        }),
    });
  }

  const input = {
    selector: "img.case-file-record-image",
    expectedPathFragment: PATH_FRAGMENT,
    label: "Case File timecard_record (三宅打卡紀錄)",
    timeoutMs: 1000,
  };

  beforeEach(() => {
    stubBrowser();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
  });

  it("re-samples the canvas until the pending decode lands and keeps the real-pixel proof", async () => {
    mountCaseFileImage();
    stubCanvasSampler({ blankDraws: 1 });

    const { inspection } = await helpers.inspectImageElement(input);

    expect(inspection.decode.ok).toBe(true);
    expect(inspection.canvas).toMatchObject({
      alphaPixels: 64,
      sampleAttempts: 2,
    });
    expect(() =>
      helpers.assertInspectedImage(inspection, input.label),
    ).not.toThrow();
  });

  it("still fails when every bounded re-sample is blank — an empty source is never accepted", async () => {
    mountCaseFileImage();
    const drawCount = stubCanvasSampler({
      blankDraws: Number.POSITIVE_INFINITY,
    });

    const { inspection } = await helpers.inspectImageElement(input);

    expect(inspection.canvas).toMatchObject({
      alphaPixels: 0,
      distinctBuckets: 1,
      sampleAttempts: 7,
    });
    expect(drawCount()).toBe(7);
    expect(() => helpers.assertInspectedImage(inspection, input.label)).toThrow(
      /no real pixels/,
    );
  });

  it("fails closed when the sampled image source changes mid-retry", async () => {
    const image = mountCaseFileImage();
    stubCanvasSampler({
      blankDraws: Number.POSITIVE_INFINITY,
      onDraw: (drawCount) => {
        if (drawCount === 1) {
          image.src = "tauri://localhost/assets/evidence/cctv_screenshot.png";
        }
      },
    });

    const { inspection } = await helpers.inspectImageElement(input);

    expect(inspection.canvas).toMatchObject({
      error: expect.stringContaining("source changed during sampling"),
    });
    expect(() => helpers.assertInspectedImage(inspection, input.label)).toThrow(
      /source canvas sample failed/,
    );
  });
});

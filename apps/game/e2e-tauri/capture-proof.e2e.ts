import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  advanceDialogueOnce,
  advanceDialogueUntil,
  advanceDialogueSelector,
  clickButton,
  closePersistenceBrowserToGameplay,
  dismissAllPendingAcquisitions,
  drainCurrentDialogue,
  elementExists,
  getPackagedGameState,
  resetCaptureProofStorage,
  saveManualSlot,
  startCaptureProofAtScene,
  waitForPersistenceIdle,
  waitForPackagedGameState,
  waitTypewriterIdle,
} from "./helpers";
import { autosaveSlots, newestAutosaveSlot } from "./save-fixtures";
import { anchors } from "./production-anchors";
import {
  captureProofCommandIsSettled,
  captureProofDialogueTextIsStable,
  captureProofNativeAutosaveIsReady,
  captureProofRecoveryTargetMatches,
} from "../src/lib/test-harnesses/capture-proof-settlement";

type CapturePixels = {
  width: number;
  height: number;
  alphaCoverage: number;
  colorBuckets: number;
  bottomEdgeChanges: number;
  cornerAlpha: number[];
  hash: number;
  newestPortraitSamples: number;
  newestPortraitMatchRatio: number;
  leavingPortraitMatchRatio: number;
  backgroundCorrelation: number;
  newestPortraitNaturalSize: string;
  newestPortraitRect: string;
  backgroundNaturalSize: string;
  backgroundRect: string;
};

type CaptureWrapperStatus = {
  calls: number;
  available: number;
  lastClosedReason: string;
  completedGeneration: number;
  embeddedFontCssBytes: number;
  embeddedFontChunkCount: number;
  embeddedZhHantCodePointCount: number;
};

type FreshNativeAutosave = {
  fixedSlotName: string;
  saveId: string;
  savedAt: string;
  thumbnailType: "available" | "unavailable";
  modifiedAtMs: number | null;
};

function autosaveSaveIds(): string[] {
  return autosaveSlots().flatMap((slot) =>
    slot.envelope === null ? [] : [slot.envelope.saveId],
  );
}

function newestNativeAutosave(): FreshNativeAutosave | null {
  const slot = newestAutosaveSlot();
  const envelope = slot?.envelope;
  if (!slot || !envelope) return null;
  return {
    fixedSlotName: slot.fixedSlotName,
    saveId: envelope.saveId,
    savedAt: envelope.savedAt,
    thumbnailType: envelope.thumbnail.type,
    modifiedAtMs: slot.modifiedAtMs,
  };
}

async function waitForFreshNativeAutosave(
  priorSaveIds: readonly string[],
  context: string,
): Promise<FreshNativeAutosave> {
  const deadline = Date.now() + 30000;
  let observed: FreshNativeAutosave | null = null;
  let readError: string | null = null;
  while (Date.now() < deadline) {
    try {
      const newest = newestNativeAutosave();
      if (newest !== null) {
        observed = newest;
        if (!priorSaveIds.includes(newest.saveId)) return newest;
      }
    } catch (error) {
      readError = error instanceof Error ? error.message : String(error);
    }
    await browser.pause(100);
  }
  throw new Error(
    `${context} did not commit a fresh native autosave envelope; priorSaveIds=${JSON.stringify(priorSaveIds)} observed=${JSON.stringify(observed)} readError=${JSON.stringify(readError)}`,
  );
}

async function captureWrapperStatus(): Promise<CaptureWrapperStatus> {
  return browser.execute((probe: string) => {
    const element = document.querySelector(probe);
    return {
      calls: Number(element?.getAttribute("data-capture-proof-calls") ?? "0"),
      available: Number(
        element?.getAttribute("data-capture-proof-available") ?? "0",
      ),
      lastClosedReason:
        element?.getAttribute("data-capture-proof-last-closed-reason") ?? "",
      completedGeneration: Number(
        element?.getAttribute("data-capture-proof-completed-generation") ?? "0",
      ),
      embeddedFontCssBytes: Number(
        element?.getAttribute("data-capture-proof-font-css-bytes") ?? "0",
      ),
      embeddedFontChunkCount: Number(
        element?.getAttribute("data-capture-proof-font-chunks") ?? "0",
      ),
      embeddedZhHantCodePointCount: Number(
        element?.getAttribute("data-capture-proof-font-zh-hant-code-points") ??
          "0",
      ),
    };
  }, anchors.captureProof.probe);
}
async function waitForCaptureProofDialogueTextStable(): Promise<string> {
  await waitTypewriterIdle();
  let before = await browser.execute(() => {
    const line = document.querySelector(
      ".text-line, .text-action, .text-scene",
    );
    return (line?.textContent ?? "").trim();
  });

  for (let attempt = 0; attempt < 12; attempt++) {
    await browser.pause(200);
    const snapshot = await browser.execute((advanceSelector: string) => {
      const line = document.querySelector(
        ".text-line, .text-action, .text-scene",
      );
      return {
        after: (line?.textContent ?? "").trim(),
        advanceAriaDisabled:
          document
            .querySelector(advanceSelector)
            ?.getAttribute("aria-disabled") ?? null,
      };
    }, advanceDialogueSelector);
    const state = await getPackagedGameState();
    const authoritativeText =
      state.mode.type === "dialogue" ? state.mode.current.text : "";
    if (
      captureProofDialogueTextIsStable({
        before,
        after: snapshot.after,
        authoritativeText,
        advanceAriaDisabled: snapshot.advanceAriaDisabled,
      })
    ) {
      return snapshot.after;
    }
    before = snapshot.after;
  }

  throw new Error(
    `capture proof dialogue text did not stabilize; last observed ${JSON.stringify(before)}`,
  );
}

async function advanceCaptureProofDialogueOnce(): Promise<void> {
  await waitForCaptureProofDialogueTextStable();
  const beforeGeneration = await browser.execute(
    (probe: string) =>
      Number(
        document
          .querySelector(probe)
          ?.getAttribute("data-capture-proof-completed-generation") ?? "0",
      ),
    anchors.captureProof.probe,
  );
  const advanced = await browser.execute((selector: string) => {
    const control = document.querySelector(selector) as HTMLElement | null;
    if (!control) return false;
    control.click();
    control.click();
    return true;
  }, advanceDialogueSelector);
  if (!advanced) {
    throw new Error("Capture proof advance control disappeared");
  }

  await browser.waitUntil(
    async () => {
      const state = await browser.execute(
        (
          probe: string,
          advanceSelector: string,
          baselineGeneration: number,
        ) => ({
          beforeGeneration: baselineGeneration,
          completedGeneration: Number(
            document
              .querySelector(probe)
              ?.getAttribute("data-capture-proof-completed-generation") ?? "0",
          ),
          commandStatus:
            document
              .querySelector(probe)
              ?.getAttribute("data-capture-proof-command-status") ?? null,
          advanceAriaDisabled:
            document
              .querySelector(advanceSelector)
              ?.getAttribute("aria-disabled") ?? null,
        }),
        anchors.captureProof.probe,
        advanceDialogueSelector,
        beforeGeneration,
      );
      return captureProofCommandIsSettled(state);
    },
    {
      timeout: 30000,
      interval: 25,
      timeoutMsg:
        "capture proof owning command generation did not settle after thumbnail finalization",
    },
  );
}

async function waitForDialogueText(text: string): Promise<void> {
  const observed = new Set<string>();
  for (let attempt = 0; attempt < 24; attempt++) {
    const current = await waitForCaptureProofDialogueTextStable();
    observed.add(current);
    if (current.includes(text)) return;
    await advanceCaptureProofDialogueOnce();
  }
  throw new Error(
    `Capture proof did not reach dialogue text ${text}; observed ${JSON.stringify([...observed])}`,
  );
}

async function waitForDialoguePortraitAndText(
  expectedPrefix: string,
  expectedPortraitFragment: string,
): Promise<void> {
  const observed = new Set<string>();
  for (let attempt = 0; attempt < 24; attempt++) {
    const dialogueText = await waitForCaptureProofDialogueTextStable();
    const visiblePortraitSrc = await browser.execute(() => {
      const portrait = Array.from(
        document.querySelectorAll<HTMLImageElement>(
          'img.portrait[data-save-crossfade-state="visible"]',
        ),
      ).find(
        (candidate) =>
          candidate.getAttribute("data-save-crossfade-order") ===
          candidate.getAttribute("data-save-crossfade-request"),
      );
      return portrait?.src ?? "";
    });
    observed.add(`${dialogueText} (${visiblePortraitSrc})`);
    if (
      captureProofRecoveryTargetMatches({
        dialogueText,
        expectedPrefix,
        visiblePortraitSrc,
        expectedPortraitFragment,
      })
    ) {
      return;
    }
    await advanceCaptureProofDialogueOnce();
  }
  throw new Error(
    `Capture proof did not reach dialogue prefix ${expectedPrefix} with portrait ${expectedPortraitFragment}; observed ${JSON.stringify([...observed])}`,
  );
}

async function refreshProof(): Promise<void> {
  const selector = anchors.captureProof.refresh;
  await browser.execute((value: string) => {
    (document.querySelector(value) as HTMLButtonElement | null)?.click();
  }, selector);
  await browser.waitUntil(
    async () =>
      browser.execute(
        (probe: string) =>
          document
            .querySelector(probe)
            ?.getAttribute("data-capture-proof-status") !== "loading",
        anchors.captureProof.probe,
      ),
    { timeout: 30000, timeoutMsg: "capture proof refresh stayed loading" },
  );
}

async function proofPixels(): Promise<CapturePixels> {
  const payload = await browser.executeAsync<
    CapturePixels | string,
    [string, string, string, string]
  >(
    (
      selector: string,
      rootSelector: string,
      newestPortraitFragment: string,
      leavingPortraitFragment: string,
      done: (result: CapturePixels | string) => void,
    ) => {
      const image = document.querySelector(selector) as HTMLImageElement | null;
      if (!image) throw new Error("capture proof image missing");
      const root = document.querySelector(rootSelector);
      if (!root) throw new Error("capture proof gameplay root missing");
      const newestPortrait = Array.from(
        root.querySelectorAll<HTMLImageElement>(
          'img.portrait[data-save-crossfade-state="visible"]',
        ),
      ).find((candidate) => candidate.src.includes(newestPortraitFragment));
      if (!newestPortrait) {
        throw new Error("capture proof newest portrait asset missing");
      }
      const background = Array.from(
        root.querySelectorAll<HTMLImageElement>(
          'img.background-image[data-save-crossfade-state="visible"]',
        ),
      )[0];
      if (!background) {
        throw new Error("capture proof background asset missing");
      }

      const leavingPortrait = new Image();
      leavingPortrait.src = newestPortrait.src.replace(
        newestPortraitFragment,
        leavingPortraitFragment,
      );
      const waitForImage = (candidate: HTMLImageElement) => {
        if (
          candidate.complete &&
          candidate.naturalWidth > 0 &&
          candidate.naturalHeight > 0
        ) {
          return Promise.resolve();
        }
        return new Promise<void>((resolve, reject) => {
          candidate.addEventListener("load", () => resolve(), { once: true });
          candidate.addEventListener(
            "error",
            () =>
              reject(new Error(`capture proof asset failed: ${candidate.src}`)),
            { once: true },
          );
        });
      };

      void Promise.all([
        image.decode(),
        waitForImage(newestPortrait),
        waitForImage(leavingPortrait),
        waitForImage(background),
      ])
        .then(() => {
          try {
            const canvas = document.createElement("canvas");
            canvas.width = image.naturalWidth;
            canvas.height = image.naturalHeight;
            const context = canvas.getContext("2d", {
              willReadFrequently: true,
            });
            if (!context) throw new Error("capture proof canvas unavailable");
            context.drawImage(image, 0, 0);
            const pixels = context.getImageData(
              0,
              0,
              canvas.width,
              canvas.height,
            ).data;
            let alphaPixels = 0;
            let hash = 2_166_136_261;
            const buckets = new Set<number>();
            for (let offset = 0; offset < pixels.length; offset += 4) {
              const red = pixels[offset] ?? 0;
              const green = pixels[offset + 1] ?? 0;
              const blue = pixels[offset + 2] ?? 0;
              const alpha = pixels[offset + 3] ?? 0;
              if (alpha > 0) alphaPixels += 1;
              if (offset % 64 === 0) {
                buckets.add(
                  (Math.floor(red / 32) << 6) |
                    (Math.floor(green / 32) << 3) |
                    Math.floor(blue / 32),
                );
                hash ^= red | (green << 8) | (blue << 16) | (alpha << 24);
                hash = Math.imul(hash, 16_777_619) >>> 0;
              }
            }
            const sampleAlpha = (x: number, y: number) =>
              pixels[(y * canvas.width + x) * 4 + 3] ?? 0;
            const rootRect = root.getBoundingClientRect();
            const scaleX = canvas.width / rootRect.width;
            const scaleY = canvas.height / rootRect.height;
            const captureRect = (rect: DOMRect) => ({
              x: (rect.left - rootRect.left) * scaleX,
              y: (rect.top - rootRect.top) * scaleY,
              width: rect.width * scaleX,
              height: rect.height * scaleY,
            });
            const drawReference = (
              asset: HTMLImageElement,
              destination: ReturnType<typeof captureRect>,
              cover: boolean,
            ) => {
              const reference = document.createElement("canvas");
              reference.width = canvas.width;
              reference.height = canvas.height;
              const referenceContext = reference.getContext("2d", {
                willReadFrequently: true,
              });
              if (!referenceContext) {
                throw new Error("capture proof reference canvas unavailable");
              }
              if (cover) {
                const sourceAspect = asset.naturalWidth / asset.naturalHeight;
                const destinationAspect =
                  destination.width / destination.height;
                let sourceX = 0;
                let sourceY = 0;
                let sourceWidth = asset.naturalWidth;
                let sourceHeight = asset.naturalHeight;
                if (sourceAspect > destinationAspect) {
                  sourceWidth = asset.naturalHeight * destinationAspect;
                  sourceX = (asset.naturalWidth - sourceWidth) / 2;
                } else {
                  sourceHeight = asset.naturalWidth / destinationAspect;
                  sourceY = (asset.naturalHeight - sourceHeight) / 2;
                }
                referenceContext.drawImage(
                  asset,
                  sourceX,
                  sourceY,
                  sourceWidth,
                  sourceHeight,
                  destination.x,
                  destination.y,
                  destination.width,
                  destination.height,
                );
              } else {
                referenceContext.drawImage(
                  asset,
                  destination.x,
                  destination.y,
                  destination.width,
                  destination.height,
                );
              }
              return referenceContext.getImageData(
                0,
                0,
                canvas.width,
                canvas.height,
              ).data;
            };
            const portraitRect = captureRect(
              newestPortrait.getBoundingClientRect(),
            );
            const newestReference = drawReference(
              newestPortrait,
              portraitRect,
              false,
            );
            const leavingReference = drawReference(
              leavingPortrait,
              portraitRect,
              false,
            );
            const portraitMatchRatio = (reference: Uint8ClampedArray) => {
              let samples = 0;
              let matches = 0;
              const maxY = Math.min(
                canvas.height,
                Math.floor(canvas.height * 0.64),
              );
              for (let y = 0; y < maxY; y += 1) {
                for (
                  let x = Math.floor(canvas.width * 0.45);
                  x < canvas.width;
                  x += 1
                ) {
                  const offset = (y * canvas.width + x) * 4;
                  if ((reference[offset + 3] ?? 0) < 230) continue;
                  const referenceLuminance =
                    (reference[offset] ?? 0) * 0.2126 +
                    (reference[offset + 1] ?? 0) * 0.7152 +
                    (reference[offset + 2] ?? 0) * 0.0722;
                  if (referenceLuminance < 72) continue;
                  samples += 1;
                  const redDelta =
                    (pixels[offset] ?? 0) - (reference[offset] ?? 0);
                  const greenDelta =
                    (pixels[offset + 1] ?? 0) - (reference[offset + 1] ?? 0);
                  const blueDelta =
                    (pixels[offset + 2] ?? 0) - (reference[offset + 2] ?? 0);
                  if (
                    Math.sqrt(
                      redDelta * redDelta +
                        greenDelta * greenDelta +
                        blueDelta * blueDelta,
                    ) <= 72
                  ) {
                    matches += 1;
                  }
                }
              }
              return { samples, ratio: samples === 0 ? 0 : matches / samples };
            };
            const newestPortraitMatch = portraitMatchRatio(newestReference);
            const leavingPortraitMatch = portraitMatchRatio(leavingReference);

            const backgroundRect = captureRect(
              background.getBoundingClientRect(),
            );
            const backgroundReference = drawReference(
              background,
              backgroundRect,
              true,
            );
            let backgroundSamples = 0;
            let backgroundSourceSum = 0;
            let backgroundCaptureSum = 0;
            let backgroundSourceSquared = 0;
            let backgroundCaptureSquared = 0;
            let backgroundProducts = 0;
            const regionLeft = Math.floor(canvas.width * 0.02);
            const regionRight = Math.floor(canvas.width * 0.48);
            const regionTop = Math.floor(canvas.height * 0.27);
            const regionBottom = Math.floor(canvas.height * 0.68);
            for (let y = regionTop; y < regionBottom; y += 2) {
              for (let x = regionLeft; x < regionRight; x += 2) {
                const offset = (y * canvas.width + x) * 4;
                const sourceLuminance =
                  (backgroundReference[offset] ?? 0) * 0.2126 +
                  (backgroundReference[offset + 1] ?? 0) * 0.7152 +
                  (backgroundReference[offset + 2] ?? 0) * 0.0722;
                const captureLuminance =
                  (pixels[offset] ?? 0) * 0.2126 +
                  (pixels[offset + 1] ?? 0) * 0.7152 +
                  (pixels[offset + 2] ?? 0) * 0.0722;
                backgroundSamples += 1;
                backgroundSourceSum += sourceLuminance;
                backgroundCaptureSum += captureLuminance;
                backgroundSourceSquared += sourceLuminance * sourceLuminance;
                backgroundCaptureSquared += captureLuminance * captureLuminance;
                backgroundProducts += sourceLuminance * captureLuminance;
              }
            }
            const backgroundNumerator =
              backgroundSamples * backgroundProducts -
              backgroundSourceSum * backgroundCaptureSum;
            const backgroundDenominator = Math.sqrt(
              (backgroundSamples * backgroundSourceSquared -
                backgroundSourceSum * backgroundSourceSum) *
                (backgroundSamples * backgroundCaptureSquared -
                  backgroundCaptureSum * backgroundCaptureSum),
            );
            const bottomY = Math.max(0, canvas.height - 42);
            let bottomEdgeChanges = 0;
            let previous = -1;
            for (let x = 0; x < canvas.width; x += 2) {
              const offset = (bottomY * canvas.width + x) * 4;
              const luminance =
                ((pixels[offset] ?? 0) +
                  (pixels[offset + 1] ?? 0) +
                  (pixels[offset + 2] ?? 0)) /
                3;
              const bucket = Math.floor(luminance / 24);
              if (previous !== -1 && bucket !== previous)
                bottomEdgeChanges += 1;
              previous = bucket;
            }
            done({
              width: canvas.width,
              height: canvas.height,
              alphaCoverage: alphaPixels / (canvas.width * canvas.height),
              colorBuckets: buckets.size,
              bottomEdgeChanges,
              cornerAlpha: [
                sampleAlpha(0, 0),
                sampleAlpha(canvas.width - 1, 0),
                sampleAlpha(0, canvas.height - 1),
                sampleAlpha(canvas.width - 1, canvas.height - 1),
              ],
              hash,
              newestPortraitSamples: newestPortraitMatch.samples,
              newestPortraitMatchRatio: newestPortraitMatch.ratio,
              leavingPortraitMatchRatio: leavingPortraitMatch.ratio,
              backgroundCorrelation:
                backgroundDenominator > 0
                  ? backgroundNumerator / backgroundDenominator
                  : 0,
              newestPortraitNaturalSize: `${newestPortrait.naturalWidth}x${newestPortrait.naturalHeight}`,
              newestPortraitRect: `${Math.round(portraitRect.x)},${Math.round(portraitRect.y)},${Math.round(portraitRect.width)},${Math.round(portraitRect.height)}`,
              backgroundNaturalSize: `${background.naturalWidth}x${background.naturalHeight}`,
              backgroundRect: `${Math.round(backgroundRect.x)},${Math.round(backgroundRect.y)},${Math.round(backgroundRect.width)},${Math.round(backgroundRect.height)}`,
            });
          } catch (error: unknown) {
            done(
              `ERROR:${error instanceof Error ? error.message : "capture proof pixel sampling failed"}`,
            );
          }
        })
        .catch((error: unknown) => {
          done(
            `ERROR:${error instanceof Error ? error.message : "capture proof pixel sampling failed"}`,
          );
        });
    },
    anchors.captureProof.thumbnail,
    anchors.captureProof.root,
    anchors.captureProof.newestPortrait,
    anchors.captureProof.leavingPortrait,
  );
  if (typeof payload === "string") {
    if (payload.startsWith("ERROR:")) {
      throw new Error(payload.slice("ERROR:".length));
    }
    throw new Error(
      `capture proof pixel sampling returned unexpected string: ${payload}`,
    );
  }
  return payload;
}

async function exportProofThumbnailArtifact(): Promise<string> {
  const payload = await browser.executeAsync(
    (selector: string, done: (result: string) => void) => {
      const image = document.querySelector(selector) as HTMLImageElement | null;
      if (!image) {
        done("ERROR:capture proof image missing");
        return;
      }
      void fetch(image.src)
        .then((response) => response.blob())
        .then(
          (blob) =>
            new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.addEventListener(
                "load",
                () => resolve(String(reader.result ?? "")),
                { once: true },
              );
              reader.addEventListener(
                "error",
                () => reject(new Error("thumbnail FileReader failed")),
                { once: true },
              );
              reader.readAsDataURL(blob);
            }),
        )
        .then(
          (dataUrl) => done(dataUrl),
          (error: unknown) =>
            done(
              `ERROR:${error instanceof Error ? error.message : "thumbnail export failed"}`,
            ),
        );
    },
    anchors.captureProof.thumbnail,
  );
  if (payload.startsWith("ERROR:")) {
    throw new Error(payload.slice("ERROR:".length));
  }
  const prefix = "data:image/png;base64,";
  if (!payload.startsWith(prefix)) {
    throw new Error("capture proof thumbnail export was not PNG");
  }
  const artifact = path.join(
    process.cwd(),
    "e2e-artifacts",
    "save-e2e",
    "capture-proof.png",
  );
  mkdirSync(path.dirname(artifact), { recursive: true });
  writeFileSync(artifact, Buffer.from(payload.slice(prefix.length), "base64"));
  return artifact;
}

describe("packaged gameplay thumbnail proof", () => {
  it("captures the real gameplay root and keeps failure injection one-shot", async () => {
    let rootAspect: number | null = null;
    const unavailableInitialCaptures: Array<{
      nativeAutosave: FreshNativeAutosave;
      captureBeforeSwap: CaptureWrapperStatus;
      captureAfterSwap: CaptureWrapperStatus;
    }> = [];
    const crossfadeFailures: number[] = [];
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      if (attempt > 1) {
        await waitForPersistenceIdle();
      }
      // Replay from a fresh document rather than jumpToProductionScene: the
      // latter awaits an embedded-WebDriver async script which can starve the
      // same bridge needed to settle the scene-navigation command.
      await resetCaptureProofStorage();
      await startCaptureProofAtScene(
        anchors.captureProof.sceneId,
        anchors.captureProof.sceneEntryDialogue,
      );
      await browser.waitUntil(
        async () => elementExists(anchors.captureProof.probe),
        {
          timeout: 10000,
          timeoutMsg: "packaged capture proof probe did not mount",
        },
      );
      await waitForDialogueText(anchors.captureProof.preSwapDialogue);

      const attemptRootAspect = await browser.execute((selector: string) => {
        const root = document.querySelector(selector);
        if (!root) return 0;
        const rect = root.getBoundingClientRect();
        return rect.width / rect.height;
      }, anchors.captureProof.root);

      await waitForPersistenceIdle();
      const captureBeforeSwap = await captureWrapperStatus();
      const autosaveIdsBeforeSwap = autosaveSaveIds();
      await advanceCaptureProofDialogueOnce();
      let exposed: boolean;
      try {
        exposed = await browser.waitUntil(
          async () => {
            const observed = await browser.execute(
              (oldFragment: string, newestFragment: string) => {
                const layers = Array.from(
                  document.querySelectorAll(
                    ".portrait-shell [data-save-crossfade-layer]",
                  ),
                ) as HTMLImageElement[];
                return {
                  leaving: layers.some(
                    (layer) =>
                      layer.src.includes(oldFragment) &&
                      layer.dataset.saveCrossfadeState === "leaving",
                  ),
                  newest: layers.some(
                    (layer) =>
                      layer.src.includes(newestFragment) &&
                      layer.dataset.saveCrossfadeState === "visible" &&
                      layer.dataset.saveCrossfadeOrder ===
                        layer.dataset.saveCrossfadeRequest,
                  ),
                };
              },
              anchors.captureProof.leavingPortrait,
              anchors.captureProof.newestPortrait,
            );
            return observed.leaving && observed.newest;
          },
          {
            timeout: 1400,
            interval: 25,
            timeoutMsg:
              "production portrait swap never exposed leaving + newest metadata",
          },
        );
      } catch {
        exposed = false;
      }
      if (!exposed) {
        crossfadeFailures.push(attempt);
        console.warn(
          `[capture proof] attempt ${attempt} never exposed leaving + newest metadata; replaying the same capture transition once`,
        );
        continue;
      }

      const captureAfterSwap = await captureWrapperStatus();
      if (captureAfterSwap.calls <= captureBeforeSwap.calls) {
        throw new Error(
          `capture proof wrapper recorded no capture request before list_saves; baseline=${JSON.stringify(captureBeforeSwap)} current=${JSON.stringify(captureAfterSwap)}`,
        );
      }
      if (captureAfterSwap.available <= captureBeforeSwap.available) {
        throw new Error(
          `capture proof wrapper recorded no available capture before list_saves; baseline=${JSON.stringify(captureBeforeSwap)} current=${JSON.stringify(captureAfterSwap)}`,
        );
      }
      if (captureAfterSwap.lastClosedReason !== "") {
        throw new Error(
          `capture proof wrapper closed unavailable before list_saves; baseline=${JSON.stringify(captureBeforeSwap)} current=${JSON.stringify(captureAfterSwap)}`,
        );
      }
      if (
        captureAfterSwap.embeddedZhHantCodePointCount < 1 ||
        captureAfterSwap.embeddedFontChunkCount < 1 ||
        captureAfterSwap.embeddedFontCssBytes < 1 ||
        captureAfterSwap.embeddedFontCssBytes > 2_000_000
      ) {
        throw new Error(
          `capture proof did not use a bounded embedded zh-Hant font subset: ${JSON.stringify(captureAfterSwap)}`,
        );
      }

      const nativeAutosave = await waitForFreshNativeAutosave(
        autosaveIdsBeforeSwap,
        `capture proof attempt ${attempt}`,
      );
      if (
        captureProofNativeAutosaveIsReady({
          priorSaveIds: autosaveIdsBeforeSwap,
          currentSaveId: nativeAutosave.saveId,
          currentThumbnailType: nativeAutosave.thumbnailType,
        })
      ) {
        rootAspect = attemptRootAspect;
        break;
      }
      unavailableInitialCaptures.push({
        nativeAutosave,
        captureBeforeSwap,
        captureAfterSwap,
      });
      console.warn(
        `[capture proof] attempt ${attempt} committed an unavailable thumbnail; replaying the same capture transition once: ${JSON.stringify({ nativeAutosave, captureBeforeSwap, captureAfterSwap })}`,
      );
    }
    if (rootAspect === null) {
      throw new Error(
        `capture proof exhausted its bounded fresh-capture retry; unavailable=${JSON.stringify(unavailableInitialCaptures)} crossfadeFailures=${JSON.stringify(crossfadeFailures)}`,
      );
    }

    await refreshProof();
    const proofState = await browser.execute((probe: string) => {
      const element = document.querySelector(probe);
      return {
        status: element?.getAttribute("data-capture-proof-status"),
        errorCode: element?.getAttribute("data-capture-proof-error-code"),
        errorMessage: element?.getAttribute("data-capture-proof-error-message"),
        errorStage: element?.getAttribute("data-capture-proof-error-stage"),
        unavailableReason: element?.getAttribute(
          "data-capture-proof-unavailable-reason",
        ),
      };
    }, anchors.captureProof.probe);
    expect(proofState).toEqual({
      status: "ready",
      errorCode: "",
      errorMessage: "",
      errorStage: "",
      unavailableReason: "",
    });
    const first = await proofPixels();
    const artifact = await exportProofThumbnailArtifact();
    console.log("[capture proof artifact]", artifact);
    expect(first.width).toBeGreaterThan(0);
    expect(first.height).toBeGreaterThan(0);
    expect(first.width).toBeLessThanOrEqual(480);
    expect(first.height).toBeLessThanOrEqual(360);
    expect(first.width / first.height).toBeCloseTo(rootAspect, 2);
    expect(first.alphaCoverage).toBeGreaterThan(0.9);
    expect(first.colorBuckets).toBeGreaterThan(24);
    expect(first.bottomEdgeChanges).toBeGreaterThan(8);
    expect(first.cornerAlpha.every((alpha) => alpha > 0)).toBe(true);
    console.log(
      "[capture proof asset signature]",
      JSON.stringify({
        newestPortraitNaturalSize: first.newestPortraitNaturalSize,
        newestPortraitRect: first.newestPortraitRect,
        newestPortraitSamples: first.newestPortraitSamples,
        newestPortraitMatchRatio: first.newestPortraitMatchRatio,
        leavingPortraitMatchRatio: first.leavingPortraitMatchRatio,
        backgroundNaturalSize: first.backgroundNaturalSize,
        backgroundRect: first.backgroundRect,
        backgroundCorrelation: first.backgroundCorrelation,
      }),
    );
    if (
      first.newestPortraitSamples < 1_000 ||
      first.newestPortraitMatchRatio <= 0.25 ||
      first.newestPortraitMatchRatio - first.leavingPortraitMatchRatio <= 0.08
    ) {
      throw new Error(
        `capture proof did not paint the newest portrait distinctly from the leaving portrait: ${JSON.stringify(first)}`,
      );
    }
    if (first.backgroundCorrelation <= 0.25) {
      throw new Error(
        `capture proof did not retain the authored background structure: ${JSON.stringify(first)}`,
      );
    }

    await browser.pause(1700);
    const second = await proofPixels();
    expect(second.hash).toBe(first.hash);

    await browser.execute((selector: string) => {
      (document.querySelector(selector) as HTMLButtonElement | null)?.click();
    }, anchors.captureProof.forceUnavailable);
    await advanceCaptureProofDialogueOnce();
    await refreshProof();
    expect(
      await browser.execute(
        (probe: string) =>
          document
            .querySelector(probe)
            ?.getAttribute("data-capture-proof-status"),
        anchors.captureProof.probe,
      ),
    ).toBe("unavailable");

    await waitForDialoguePortraitAndText(
      anchors.captureProof.recoveryPortraitDialogue,
      anchors.captureProof.leavingPortrait,
    );
    await refreshProof();
    expect(
      await browser.execute(
        (probe: string) =>
          document
            .querySelector(probe)
            ?.getAttribute("data-capture-proof-status"),
        anchors.captureProof.probe,
      ),
    ).toBe("ready");
  });

  it("skips transient interrogation capture and keeps explicit saves captured", async () => {
    async function withStepContext<T>(
      step: string,
      fn: () => Promise<T>,
    ): Promise<T> {
      try {
        return await fn();
      } catch (error) {
        let stateSummary = "state unavailable";
        try {
          const state = await getPackagedGameState();
          stateSummary = `scene=${state.scene.id}, sceneKind=${state.scene.kind}, mode=${state.mode.type}`;
        } catch {
          // state retrieval also failed; keep "state unavailable"
        }
        throw new Error(
          `interrogation capture proof: step "${step}" failed. ` +
            `Game state: ${stateSummary}.`,
          { cause: error },
        );
      }
    }

    await waitForPersistenceIdle();
    await resetCaptureProofStorage();
    const startAtInterrogation = startCaptureProofAtScene(
      anchors.unicodeSave.interrogationSceneId,
      anchors.unicodeSave.interrogationEntryDialogue,
    );
    // Scene 4's production entry anchor is the second authored dialogue line,
    // so advance its intro while startCaptureProofAtScene waits for that exact
    // anchor to become visible. The scene itself is still selected directly by
    // the existing helper; no scene-jump command is involved.
    await waitForPackagedGameState(
      (state) => state.scene.id === anchors.unicodeSave.interrogationSceneId,
      30000,
      "interrogation scene did not become current after direct start",
    );
    for (let step = 0; step < 80; step += 1) {
      const current = await getPackagedGameState();
      if (
        current.mode.type === "dialogue" &&
        current.mode.current.text.includes(
          anchors.unicodeSave.interrogationEntryDialogue,
        )
      ) {
        break;
      }
      if (current.mode.type !== "dialogue") {
        throw new Error(
          "interrogation intro left dialogue before its entry anchor appeared",
        );
      }
      const cursorBefore = current.mode.queueToken.cursor;
      const advanced = await withStepContext(`intro advance step ${step}`, () =>
        advanceDialogueOnce(),
      );
      if (!advanced) {
        throw new Error("interrogation intro advance control disappeared");
      }
      await waitForPackagedGameState(
        (next) =>
          next.mode.type === "dialogue" &&
          (next.mode.current.text.includes(
            anchors.unicodeSave.interrogationEntryDialogue,
          ) ||
            next.mode.queueToken.cursor !== cursorBefore),
        30000,
        "interrogation intro did not settle after advancing",
      );
    }
    await startAtInterrogation;
    await browser.waitUntil(
      async () => elementExists(anchors.captureProof.probe),
      {
        timeout: 10000,
        timeoutMsg: "packaged capture proof probe did not mount",
      },
    );
    await withStepContext("drain interrogation intro dialogue", () =>
      drainCurrentDialogue("interrogation"),
    );
    await dismissAllPendingAcquisitions();
    await waitForPersistenceIdle();

    const captureBefore = await captureWrapperStatus();
    const autosaveIdsBefore = autosaveSaveIds();

    await withStepContext("click interrogation question", () =>
      clickButton(anchors.unicodeSave.interrogationQuestion),
    );
    await waitForPackagedGameState(
      (state) =>
        state.mode.type === "dialogue" && state.scene.kind === "interrogation",
      30000,
      "interrogation testimony did not enter Playing",
    );

    await withStepContext(
      "advance dialogue until challenge button appears",
      () =>
        advanceDialogueUntil(async () => {
          return browser.execute((label: string) => {
            return Array.from(document.querySelectorAll("button")).some(
              (button) => (button.textContent ?? "").includes(label),
            );
          }, anchors.unicodeSave.challenge);
        }, 80),
    );

    await withStepContext("click challenge button", () =>
      clickButton(anchors.unicodeSave.challenge),
    );
    await withStepContext(
      "advance dialogue until presenting phase appears",
      () =>
        advanceDialogueUntil(async () => {
          const state = await getPackagedGameState();
          return (
            state.mode.type === "interrogation" &&
            state.scene.kind === "interrogation" &&
            state.scene.visiblePhases.some(
              (phase) => phase.crossExam?.presenting === true,
            )
          );
        }, 80),
    );

    await waitForPersistenceIdle();
    const captureAfterInterrogation = await captureWrapperStatus();
    expect(captureAfterInterrogation.calls).toBe(captureBefore.calls);
    expect(captureAfterInterrogation.available).toBe(captureBefore.available);

    const fresh = await waitForFreshNativeAutosave(
      autosaveIdsBefore,
      "interrogation no-thumbnail progress",
    );
    expect(fresh.thumbnailType).toBe("unavailable");

    const newest = newestAutosaveSlot();
    if (!newest?.envelope || newest.envelope.saveId !== fresh.saveId) {
      throw new Error(
        "fresh interrogation autosave is not the newest autosave",
      );
    }
    const envelope = newest.envelope;

    expect(envelope.summary.sceneId).toBe(
      anchors.unicodeSave.interrogationSceneId,
    );
    expect(envelope.snapshot.scene.type).toBe("interrogation");
    if (envelope.snapshot.scene.type !== "interrogation") {
      throw new Error(
        "interrogation autosave did not persist interrogation state",
      );
    }
    expect(envelope.snapshot.scene.crossExam.type).toBe("presenting");
    expect(envelope.snapshot.scene.enteredPhaseIds.length).toBeGreaterThan(0);

    await waitForPersistenceIdle();
    await withStepContext("manual save slot 3", () =>
      saveManualSlot(3, "訊問捕捉正向控制"),
    );

    const captureAfterManualSave = await captureWrapperStatus();
    expect(captureAfterManualSave.calls).toBe(
      captureAfterInterrogation.calls + 1,
    );

    await closePersistenceBrowserToGameplay();
  });
});

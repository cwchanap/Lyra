import {
  anchors,
  DIALOGUE_DRAIN_CAP,
  STORY_CLEARED_STORAGE_KEY,
} from "./production-anchors";
import type {
  ExitStatusView,
  SaveBrowserOpenResultView,
} from "$lib/persistence/types";
import type { GameStateView, PendingAcquisitionView } from "$lib/state/types";

type TauriInternals = {
  invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown>;
};

type CssViewport = {
  width: number;
  height: number;
  devicePixelRatio: number;
};

const CASE_FILE_PREFERRED_VIEWPORT = { width: 1280, height: 720 } as const;

async function observedCssViewport(): Promise<CssViewport> {
  return browser.execute(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
    devicePixelRatio: window.devicePixelRatio,
  }));
}

function validDevicePixelRatio(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 1;
}

function meetsCaseFileViewportTarget(viewport: CssViewport): boolean {
  return (
    viewport.width >= CASE_FILE_PREFERRED_VIEWPORT.width &&
    viewport.height >= CASE_FILE_PREFERRED_VIEWPORT.height
  );
}

/**
 * The macOS Tauri WDIO executor applies setWindowSize dimensions as physical
 * pixels. Measure the CSS viewport first, request a DPR-scaled native size,
 * then compensate for any platform window chrome before layout assertions.
 */
export async function ensureCaseFileViewport(): Promise<CssViewport> {
  let viewport = await observedCssViewport();
  let requestedWidth = Math.ceil(
    CASE_FILE_PREFERRED_VIEWPORT.width *
      validDevicePixelRatio(viewport.devicePixelRatio),
  );
  let requestedHeight = Math.ceil(
    CASE_FILE_PREFERRED_VIEWPORT.height *
      validDevicePixelRatio(viewport.devicePixelRatio),
  );

  for (let attempt = 0; attempt < 3; attempt += 1) {
    await browser.setWindowSize(requestedWidth, requestedHeight);
    try {
      await browser.waitUntil(
        async () => {
          viewport = await observedCssViewport();
          return meetsCaseFileViewportTarget(viewport);
        },
        {
          timeout: 10000,
          interval: 100,
          timeoutMsg: "Case File viewport did not reach its CSS target.",
        },
      );
    } catch {
      // The next iteration compensates for platform chrome from the observed
      // CSS shortfall rather than assuming a fixed title-bar size.
    }
    if (meetsCaseFileViewportTarget(viewport)) {
      console.log(
        `[CaseFileE2E] CSS viewport ${viewport.width}x${viewport.height} at DPR ${viewport.devicePixelRatio}`,
      );
      return viewport;
    }

    const devicePixelRatio = validDevicePixelRatio(viewport.devicePixelRatio);
    requestedWidth += Math.ceil(
      Math.max(0, CASE_FILE_PREFERRED_VIEWPORT.width - viewport.width) *
        devicePixelRatio,
    );
    requestedHeight += Math.ceil(
      Math.max(0, CASE_FILE_PREFERRED_VIEWPORT.height - viewport.height) *
        devicePixelRatio,
    );
  }

  throw new Error(
    `Case File viewport remained ${viewport.width}x${viewport.height} at DPR ${viewport.devicePixelRatio}.`,
  );
}

export async function invokePackagedCommand<T>(
  command: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  const result = await browser.execute(
    async (
      selectedCommand: string,
      selectedArgs: Record<string, unknown>,
    ): Promise<
      { ok: true; value: unknown } | { ok: false; error: unknown }
    > => {
      const internals = (
        window as unknown as { __TAURI_INTERNALS__?: TauriInternals }
      ).__TAURI_INTERNALS__;
      if (!internals) {
        return {
          ok: false,
          error: {
            code: "tauriUnavailable",
            message: "Tauri internals are unavailable.",
          },
        };
      }
      try {
        return {
          ok: true,
          value: await internals.invoke(selectedCommand, selectedArgs),
        };
      } catch (error) {
        return { ok: false, error };
      }
    },
    command,
    args,
  );
  if (!result.ok) {
    const payload = result.error;
    const message =
      payload !== null &&
      typeof payload === "object" &&
      "message" in payload &&
      typeof (payload as { message: unknown }).message === "string"
        ? (payload as { message: string }).message
        : String(payload);
    throw new Error(message, { cause: payload });
  }
  return result.value as T;
}

export type PackagedCommandSettlement<T> =
  | { ok: true; value: T }
  | {
      ok: false;
      error: {
        code: string;
        message: string;
        failureToken?: string;
      };
    };

/**
 * Observes an expected command rejection without returning its rejected
 * object through WebDriver. Packaged WebKit turns a rejected Tauri object
 * into an execute/sync protocol failure (`[object Object]`) before the Node
 * caller can inspect it. Settle the invoke inside the page, copy only the
 * public GameError fields to a DOM attribute, then read that plain JSON in a
 * later synchronous probe.
 */
export async function settlePackagedCommand<T>(
  command: string,
  args: Record<string, unknown> = {},
): Promise<PackagedCommandSettlement<T>> {
  const requestId = `${Date.now()}-${Math.random()}`;
  const attribute = "data-save-command-settlement";
  const started = await browser.execute(
    (
      selectedCommand: string,
      selectedArgs: Record<string, unknown>,
      settlementAttribute: string,
      settlementRequestId: string,
    ) => {
      const root = document.documentElement;
      root.removeAttribute(settlementAttribute);
      const internals = (
        window as unknown as { __TAURI_INTERNALS__?: TauriInternals }
      ).__TAURI_INTERNALS__;
      const settle = (result: unknown) => {
        root.setAttribute(
          settlementAttribute,
          JSON.stringify({
            requestId: settlementRequestId,
            result,
          }),
        );
      };
      if (!internals) {
        settle({
          ok: false,
          error: {
            code: "tauriUnavailable",
            message: "Tauri internals are unavailable.",
          },
        });
        return true;
      }
      const reject = (error: unknown) => {
        const source =
          error !== null && typeof error === "object"
            ? (error as Record<string, unknown>)
            : {};
        settle({
          ok: false,
          error: {
            code:
              typeof source.code === "string"
                ? source.code
                : "unknownCommandError",
            message:
              typeof source.message === "string"
                ? source.message
                : String(error),
            ...(typeof source.failureToken === "string"
              ? { failureToken: source.failureToken }
              : {}),
          },
        });
      };
      try {
        void internals
          .invoke(selectedCommand, selectedArgs)
          .then((value) => settle({ ok: true, value }), reject);
      } catch (error) {
        reject(error);
      }
      return true;
    },
    command,
    args,
    attribute,
    requestId,
  );
  if (!started) throw new Error(`command ${command} could not be started`);

  await browser.pause(100);
  let settlement: PackagedCommandSettlement<T> | null = null;
  await browser.waitUntil(
    async () => {
      const serialized = await browser.execute(
        (settlementAttribute: string) =>
          document.documentElement.getAttribute(settlementAttribute),
        attribute,
      );
      if (!serialized) return false;
      const parsed = JSON.parse(serialized) as {
        requestId?: unknown;
        result?: PackagedCommandSettlement<T>;
      };
      if (parsed.requestId !== requestId || !parsed.result) return false;
      settlement = parsed.result;
      return true;
    },
    {
      timeout: 30000,
      interval: 250,
      timeoutMsg: `command ${command} did not settle`,
    },
  );
  await browser.execute(
    (settlementAttribute: string) =>
      document.documentElement.removeAttribute(settlementAttribute),
    attribute,
  );
  if (!settlement) throw new Error(`command ${command} settlement is missing`);
  return settlement;
}

export function assertSaveE2ePhase(
  expected: string | readonly string[],
): string {
  const phase = process.env.LYRA_SAVE_E2E_PHASE;
  const accepted = typeof expected === "string" ? [expected] : [...expected];
  if (!phase || !accepted.includes(phase)) {
    throw new Error(
      `Expected save e2e phase ${accepted.join(" or ")}, got ${String(phase)}.`,
    );
  }
  return phase;
}

export async function currentPackagedDocumentIdentity(): Promise<string> {
  return browser.execute(() => {
    const root = document.documentElement;
    const existing = root.dataset.saveDocumentIdentity;
    if (existing) return existing;
    const identity = `${performance.timeOrigin}:${crypto.randomUUID()}`;
    root.dataset.saveDocumentIdentity = identity;
    return identity;
  });
}

export function getPackagedGameState(): Promise<GameStateView> {
  return invokePackagedCommand<GameStateView>("get_state");
}

async function packagedGameplayCommandGeneration(): Promise<number> {
  return browser.execute(
    (probe: string) =>
      Number(
        document
          .querySelector(probe)
          ?.getAttribute("data-capture-proof-completed-generation") ?? "0",
      ),
    anchors.captureProof.probe,
  );
}

async function waitForPackagedGameplayCommandSettled(
  beforeGeneration: number,
  timeoutMsg: string,
): Promise<void> {
  const result = await browser.executeAsync(
    (
      probe: string,
      baselineGeneration: number,
      done: (result: {
        settled: boolean;
        generation: number;
        status: string | null;
      }) => void,
    ) => {
      const element = document.querySelector(probe);
      if (!element) {
        done({ settled: false, generation: 0, status: null });
        return;
      }
      let completed = false;
      const observer = new MutationObserver(() => settle());
      const finish = (outcome: {
        settled: boolean;
        generation: number;
        status: string | null;
      }) => {
        if (completed) return;
        completed = true;
        clearTimeout(timeout);
        observer.disconnect();
        done(outcome);
      };
      const settle = () => {
        const generation = Number(
          element.getAttribute("data-capture-proof-completed-generation") ??
            "0",
        );
        const status = element.getAttribute(
          "data-capture-proof-command-status",
        );
        if (generation > baselineGeneration && status === "idle") {
          finish({ settled: true, generation, status });
        }
      };
      observer.observe(element, {
        attributes: true,
        attributeFilter: [
          "data-capture-proof-completed-generation",
          "data-capture-proof-command-status",
        ],
      });
      const timeout = setTimeout(() => {
        finish({
          settled: false,
          generation: Number(
            element.getAttribute("data-capture-proof-completed-generation") ??
              "0",
          ),
          status: element.getAttribute("data-capture-proof-command-status"),
        });
      }, 90000);
      settle();
    },
    anchors.captureProof.probe,
    beforeGeneration,
  );
  if (!result.settled) {
    throw new Error(
      `${timeoutMsg} (generation ${result.generation}, status ${String(result.status)})`,
    );
  }
}

async function waitForPackagedDomTransition(
  presentSelector: string,
  absentSelector: string,
  timeoutMsg: string,
): Promise<void> {
  // The embedded WebDriver holds WebKit's script executor for the full
  // duration of execute/async, which prevents Tauri invoke callbacks from
  // reaching the page. Leave one command-free window first, then keep the
  // synchronous probes sparse enough for the callback to settle between them.
  await browser.pause(500);
  await browser.waitUntil(
    async () =>
      browser.execute(
        (requiredSelector: string, removedSelector: string) =>
          Boolean(document.querySelector(requiredSelector)) &&
          !document.querySelector(removedSelector),
        presentSelector,
        absentSelector,
      ),
    {
      timeout: 90000,
      interval: 500,
      timeoutMsg,
    },
  );
}

export async function waitForPackagedGameState(
  predicate: (state: GameStateView) => boolean,
  timeout = 30000,
  timeoutMsg = "packaged game state did not reach the expected condition",
): Promise<GameStateView> {
  let last: GameStateView | null = null;
  await browser.waitUntil(
    async () => {
      try {
        last = await getPackagedGameState();
        return predicate(last);
      } catch {
        return false;
      }
    },
    { timeout, interval: 100, timeoutMsg },
  );
  if (!last) throw new Error(timeoutMsg);
  return last;
}

export async function waitForButton(
  accessibleName: string,
  timeout = 15000,
): Promise<void> {
  await browser.waitUntil(
    async () =>
      browser.execute((name: string) => {
        return Array.from(
          document.querySelectorAll<HTMLButtonElement>("button"),
        ).some(
          (button) =>
            !button.disabled &&
            (button.getAttribute("aria-label") === name ||
              (button.textContent ?? "").trim().includes(name)),
        );
      }, accessibleName),
    {
      timeout,
      interval: 100,
      timeoutMsg: `enabled button ${accessibleName} did not appear`,
    },
  );
}

export async function clickButton(accessibleName: string): Promise<void> {
  await waitForButton(accessibleName);
  const clicked = await browser.execute((name: string) => {
    const button = Array.from(
      document.querySelectorAll<HTMLButtonElement>("button"),
    ).find(
      (candidate) =>
        candidate.getAttribute("aria-label") === name ||
        (candidate.textContent ?? "").trim().includes(name),
    );
    if (!button || button.disabled) return false;
    button.click();
    return true;
  }, accessibleName);
  if (!clicked) {
    throw new Error(`button ${accessibleName} was missing or disabled`);
  }
}

export async function clickDialogButton(
  heading: string,
  accessibleName: string,
): Promise<void> {
  await waitForDialog(heading);
  const clicked = await browser.execute(
    (expectedHeading: string, expectedName: string) => {
      const dialog = Array.from(
        document.querySelectorAll<HTMLElement>('[role="dialog"]'),
      ).find(
        (candidate) =>
          (candidate.getAttribute("aria-label") ?? "").includes(
            expectedHeading,
          ) ||
          Array.from(candidate.querySelectorAll("h2")).some((title) =>
            (title.textContent ?? "").includes(expectedHeading),
          ),
      );
      const button = Array.from(
        dialog?.querySelectorAll<HTMLButtonElement>("button") ?? [],
      ).find(
        (candidate) =>
          candidate.getAttribute("aria-label") === expectedName ||
          (candidate.textContent ?? "").trim() === expectedName,
      );
      if (!button || button.disabled) return false;
      button.click();
      return true;
    },
    heading,
    accessibleName,
  );
  if (!clicked) {
    throw new Error(
      `dialog ${heading} button ${accessibleName} was missing or disabled`,
    );
  }
}

export async function clickPersistenceBrowserButton(
  accessibleName: string,
): Promise<void> {
  await browser.waitUntil(
    async () => elementExists('[aria-label="存檔瀏覽器"]'),
    {
      timeout: 15000,
      interval: 100,
      timeoutMsg: "persistence browser did not appear",
    },
  );
  const clicked = await browser.execute((expectedName: string) => {
    const saveBrowser = document.querySelector('[aria-label="存檔瀏覽器"]');
    const button = Array.from(
      saveBrowser?.querySelectorAll<HTMLButtonElement>("button") ?? [],
    ).find(
      (candidate) =>
        candidate.getAttribute("aria-label") === expectedName ||
        (candidate.textContent ?? "").trim() === expectedName,
    );
    if (!button || button.disabled) return false;
    button.click();
    return true;
  }, accessibleName);
  if (!clicked) {
    throw new Error(
      `persistence browser button ${accessibleName} was missing or disabled`,
    );
  }
}

export async function waitForDialog(
  heading: string,
  timeout = 15000,
): Promise<void> {
  await browser.waitUntil(
    async () =>
      browser.execute((expectedHeading: string) => {
        return Array.from(document.querySelectorAll('[role="dialog"]')).some(
          (dialog) =>
            (dialog.getAttribute("aria-label") ?? "").includes(
              expectedHeading,
            ) ||
            Array.from(dialog.querySelectorAll("h2")).some((title) =>
              (title.textContent ?? "").includes(expectedHeading),
            ),
        );
      }, heading),
    {
      timeout,
      interval: 100,
      timeoutMsg: `dialog ${heading} did not appear`,
    },
  );
}

export async function dialogText(heading: string): Promise<string> {
  return browser.execute((expectedHeading: string) => {
    const dialog = Array.from(
      document.querySelectorAll<HTMLElement>('[role="dialog"]'),
    ).find(
      (candidate) =>
        (candidate.getAttribute("aria-label") ?? "").includes(
          expectedHeading,
        ) ||
        Array.from(candidate.querySelectorAll("h2")).some((title) =>
          (title.textContent ?? "").includes(expectedHeading),
        ),
    );
    return (dialog?.textContent ?? "").trim();
  }, heading);
}

export async function waitForNoDialog(
  heading: string,
  timeout = 15000,
): Promise<void> {
  await browser.waitUntil(
    async () =>
      browser.execute((expectedHeading: string) => {
        return !Array.from(document.querySelectorAll('[role="dialog"]')).some(
          (dialog) =>
            (dialog.getAttribute("aria-label") ?? "").includes(
              expectedHeading,
            ) ||
            Array.from(dialog.querySelectorAll("h2")).some((title) =>
              (title.textContent ?? "").includes(expectedHeading),
            ),
        );
      }, heading),
    {
      timeout,
      interval: 100,
      timeoutMsg: `dialog ${heading} remained open`,
    },
  );
}

export async function jumpToProductionScene(sceneId: string): Promise<void> {
  await openGameMenu();
  await clickButton(anchors.sceneSelect);
  await browser.waitUntil(
    async () => elementExists('[aria-label="場景跳轉"]'),
    {
      timeout: 15000,
      timeoutMsg: "scene navigation panel did not appear",
    },
  );
  const beforeGeneration = await packagedGameplayCommandGeneration();
  await clickButton(sceneId);
  await waitForPackagedGameplayCommandSettled(
    beforeGeneration,
    `scene ${sceneId} command did not settle`,
  );
  await waitForPackagedGameState(
    (state) => state.scene.id === sceneId,
    30000,
    `scene ${sceneId} did not become current`,
  );
}

export async function saveManualSlot(
  slot: 1 | 2 | 3,
  displayName: string,
  overwrite = false,
): Promise<void> {
  await waitForPersistenceIdle();
  await openGameMenu();
  await clickButton(anchors.saveGame);
  try {
    await browser.waitUntil(
      async () => elementExists('[aria-label="存檔瀏覽器"]'),
      { timeout: 30000, timeoutMsg: "manual save browser did not appear" },
    );
  } catch (error) {
    const rendered = await browser.execute(() => ({
      bodyText: (document.body.textContent ?? "").trim().slice(-2000),
      dialogs: Array.from(
        document.querySelectorAll<HTMLElement>('[role="dialog"]'),
      ).map((dialog) => ({
        ariaLabel: dialog.getAttribute("aria-label"),
        headings: Array.from(dialog.querySelectorAll("h2")).map((heading) =>
          (heading.textContent ?? "").trim(),
        ),
        text: (dialog.textContent ?? "").trim().slice(0, 500),
      })),
      buttons: Array.from(
        document.querySelectorAll<HTMLButtonElement>("button"),
      )
        .map((button) => ({
          ariaLabel: button.getAttribute("aria-label"),
          text: (button.textContent ?? "").trim().slice(0, 120),
          disabled: button.disabled,
        }))
        .slice(-20),
    }));
    throw new Error(
      [
        error instanceof Error ? error.message : String(error),
        `rendered=${JSON.stringify(rendered)}`,
      ].join("\n"),
      { cause: error },
    );
  }
  await clickButton(`選擇手動存檔 ${slot}`);
  await waitForDialog(anchors.nameSave);
  const value = await browser.execute((name: string) => {
    const input = document.querySelector<HTMLInputElement>("#manual-save-name");
    if (!input) return null;
    input.value = name;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    return input.value;
  }, displayName);
  if (value !== displayName) throw new Error("manual save name input missing");
  await clickDialogButton(anchors.nameSave, anchors.continueName);
  if (overwrite) {
    await waitForDialog(`覆寫手動存檔 ${slot}`);
    await clickDialogButton(`覆寫手動存檔 ${slot}`, anchors.confirmOverwrite);
  }
  await waitForPersistenceLayersClosed(
    `manual slot ${slot} save flow did not close the persistence layers and game menu`,
  );
  // The name/confirmation layer replaces SaveBrowser before the async capture
  // and save have finished. The closed game menu above is therefore the
  // completion signal: performManualSave closes it only after persistence
  // succeeds. Reopen the browser so callers can inspect the refreshed card and
  // continue exercising load/delete/preview behavior in the same phase.
  await openGameMenu();
  await clickButton(anchors.saveGame);
  await browser.waitUntil(
    async () => elementExists('[aria-label="存檔瀏覽器"]'),
    {
      timeout: 30000,
      timeoutMsg: "refreshed manual save browser did not appear",
    },
  );
  try {
    await browser.waitUntil(
      async () =>
        browser.execute(
          (slotNumber: number, expectedName: string) => {
            const card = document.querySelector(
              `article[data-slot-type="manual"][data-slot-number="${slotNumber}"]`,
            );
            return (card?.textContent ?? "").includes(expectedName);
          },
          slot,
          displayName,
        ),
      {
        timeout: 5000,
        interval: 100,
        timeoutMsg: `manual slot ${slot} did not show ${displayName}`,
      },
    );
  } catch (error) {
    const [native, rendered] = await Promise.all([
      invokePackagedCommand<SaveBrowserOpenResultView>("list_saves"),
      browser.execute(() => ({
        browserText:
          document.querySelector('[aria-label="存檔瀏覽器"]')?.textContent ??
          null,
        cards: Array.from(
          document.querySelectorAll<HTMLElement>(
            "article[data-slot-type][data-slot-number]",
          ),
        ).map((card) => ({
          type: card.dataset.slotType ?? null,
          slot: card.dataset.slotNumber ?? null,
          text: (card.textContent ?? "").trim(),
        })),
      })),
    ]);
    const nativeSlot = native.browser.slots.find(
      (candidate) =>
        candidate.reference.type === "manual" &&
        candidate.reference.slot === slot,
    );
    throw new Error(
      [
        error instanceof Error ? error.message : String(error),
        `native=${JSON.stringify(nativeSlot ?? null)}`,
        `rendered=${JSON.stringify(rendered)}`,
      ].join("\n"),
      { cause: error },
    );
  }
}

export async function waitForPersistenceLayersClosed(
  timeoutMsg = "persistence layers and game menu did not close",
): Promise<void> {
  await browser.waitUntil(
    async () =>
      browser.execute((gameMenuHeading: string) => {
        const saveBrowserOpen =
          document.querySelector('[aria-label="存檔瀏覽器"]') !== null;
        const gameMenuOpen = Array.from(
          document.querySelectorAll('[role="dialog"]'),
        ).some((dialog) =>
          Array.from(dialog.querySelectorAll("h2")).some((heading) =>
            (heading.textContent ?? "").includes(gameMenuHeading),
          ),
        );
        return !saveBrowserOpen && !gameMenuOpen;
      }, anchors.gameMenu),
    {
      timeout: 90000,
      interval: 100,
      timeoutMsg,
    },
  );
}

export async function closePersistenceBrowserToGameplay(): Promise<void> {
  await clickPersistenceBrowserButton("返回");
  await browser.waitUntil(
    async () => !(await elementExists('[aria-label="存檔瀏覽器"]')),
    { timeout: 15000, timeoutMsg: "persistence browser did not close" },
  );
  const menuOpen = await browser.execute((heading: string) => {
    return Array.from(document.querySelectorAll('[role="dialog"]')).some(
      (dialog) =>
        Array.from(dialog.querySelectorAll("h2")).some((title) =>
          (title.textContent ?? "").includes(heading),
        ),
    );
  }, anchors.gameMenu);
  if (menuOpen) await clickButton(anchors.continueInvestigation);
}

export function dialogueFingerprint(state: GameStateView): string {
  if (state.mode.type !== "dialogue") return "";
  return JSON.stringify(state.mode.current);
}

export async function drainCurrentDialogue(
  expectedMode: "explore" | "interrogation",
  cap = 200,
): Promise<GameStateView> {
  await advanceDialogueUntil(async () => {
    try {
      return (await getPackagedGameState()).mode.type === expectedMode;
    } catch {
      return false;
    }
  }, cap);
  return waitForPackagedGameState(
    (state) => state.mode.type === expectedMode,
    15000,
    `dialogue did not drain to ${expectedMode}`,
  );
}

export async function waitForAcquisitionOrdinal(
  ordinal: number,
): Promise<GameStateView> {
  return waitForPackagedGameState(
    (state) => state.pendingAcquisition?.ordinal === ordinal,
    30000,
    `acquisition ordinal ${ordinal} did not become current`,
  );
}

export async function startAcquisitionAcknowledgement(
  current: Pick<PendingAcquisitionView, "id" | "title">,
): Promise<void> {
  await waitForButton("CONTINUE", 90000);
  const currentCardMatches = await browser.execute((currentTitle: string) => {
    const card = document.querySelector(".acquisition-card");
    return (
      (card?.querySelector(".item-title")?.textContent ?? "").trim() ===
      currentTitle
    );
  }, current.title);
  if (!currentCardMatches) {
    throw new Error(
      `acquisition ${current.id} was not the current DOM notification`,
    );
  }
  await clickButton("CONTINUE");
}

export async function waitForAcquisitionDomSettlement(
  current: Pick<PendingAcquisitionView, "id" | "title">,
): Promise<void> {
  // Never invoke get_state until the owning acknowledgement command has
  // updated or removed the keyed popup. A concurrent Tauri invoke can occupy
  // the WebView response path needed to settle the Svelte command.
  await browser.waitUntil(
    async () =>
      browser.execute((currentTitle: string) => {
        const card = document.querySelector(".acquisition-card");
        if (!card) return true;
        const nextTitle = (
          card.querySelector(".item-title")?.textContent ?? ""
        ).trim();
        const continueButton = Array.from(
          card.querySelectorAll<HTMLButtonElement>("button"),
        ).find((button) =>
          (button.textContent ?? "").trim().includes("CONTINUE"),
        );
        return nextTitle !== currentTitle && continueButton?.disabled === false;
      }, current.title),
    {
      timeout: 90000,
      interval: 100,
      timeoutMsg: `acquisition ${current.id} popup did not settle`,
    },
  );
}

export async function acknowledgeAcquisitionDomFirst(
  current: Pick<PendingAcquisitionView, "id" | "title">,
): Promise<void> {
  await startAcquisitionAcknowledgement(current);
  await waitForAcquisitionDomSettlement(current);
}

export async function dismissAllPendingAcquisitions(
  options: { cap?: number; forceCaptureUnavailable?: boolean } = {},
): Promise<void> {
  const { cap = 50, forceCaptureUnavailable = false } = options;
  for (let index = 0; index < cap; index += 1) {
    const state = await getPackagedGameState();
    const current = state.pendingAcquisition;
    if (!current) {
      await waitForNoDialog(anchors.evidenceAcquired, 90000);
      await waitForPersistenceIdle();
      if ((await getPackagedGameState()).pendingAcquisition === null) return;
      continue;
    }
    if (forceCaptureUnavailable) {
      await jsClick(anchors.captureProof.forceUnavailable);
    }
    await acknowledgeAcquisitionDomFirst(current);
    await waitForPackagedGameState(
      (next) => next.pendingAcquisition?.id !== current.id,
      30000,
      `acquisition ${current.id} did not advance`,
    );
  }
  throw new Error(
    `pending acquisitions did not drain within the cap of ${cap}`,
  );
}

export async function returnToTitle(): Promise<void> {
  await openGameMenu();
  await clickButton(anchors.returnToTitle);
  await waitForPackagedDomTransition(
    '[aria-label="主選單"]',
    "[data-gameplay-root]",
    "title screen did not appear",
  );
}

export async function continueFromTitle(): Promise<void> {
  await waitForButton(anchors.continueGame, 30000);
  await clickButton(anchors.continueGame);
  await waitForPackagedDomTransition(
    "[data-gameplay-root]",
    '[aria-label="主選單"]',
    "Continue did not leave the title screen",
  );
  await waitForPackagedGameState(
    () => true,
    30000,
    "Continue did not install a packaged game state",
  );
}

export async function openTitleLoadBrowser(): Promise<void> {
  await waitForButton(anchors.loadGame, 30000);
  await clickButton(anchors.loadGame);
  await browser.waitUntil(
    async () => elementExists('[aria-label="存檔瀏覽器"]'),
    { timeout: 30000, timeoutMsg: "title load browser did not appear" },
  );
}

export async function loadTitleSlot(
  type: "auto" | "manual",
  slot: number,
): Promise<void> {
  await openTitleLoadBrowser();
  await clickButton(`選擇${type === "auto" ? "自動存檔" : "手動存檔"} ${slot}`);
  await waitForPackagedDomTransition(
    "[data-gameplay-root]",
    '[aria-label="主選單"]',
    `title load of ${type}-${slot} did not install gameplay`,
  );
  await waitForPackagedGameState(
    () => true,
    30000,
    `title load of ${type}-${slot} did not install gameplay`,
  );
}

export async function clickSaveCardButton(
  type: "auto" | "manual",
  slot: number,
  label: "載入" | "刪除" | "選擇",
): Promise<void> {
  const clicked = await browser.execute(
    (slotType: "auto" | "manual", slotNumber: number, buttonLabel: string) => {
      const card = document.querySelector(
        `article[data-slot-type="${slotType}"][data-slot-number="${slotNumber}"]`,
      );
      const button = Array.from(
        card?.querySelectorAll<HTMLButtonElement>("button") ?? [],
      ).find((candidate) =>
        (candidate.textContent ?? "").trim().includes(buttonLabel),
      );
      if (!button || button.disabled) return false;
      button.click();
      return true;
    },
    type,
    slot,
    label,
  );
  if (!clicked) {
    throw new Error(`${type}-${slot} ${label} action was unavailable`);
  }
}

export async function saveCardText(
  type: "auto" | "manual",
  slot: number,
): Promise<string> {
  return browser.execute(
    (slotType: "auto" | "manual", slotNumber: number) => {
      const card = document.querySelector(
        `article[data-slot-type="${slotType}"][data-slot-number="${slotNumber}"]`,
      );
      return (card?.textContent ?? "").trim();
    },
    type,
    slot,
  );
}

export async function waitForPersistenceIdle(): Promise<void> {
  await browser.waitUntil(
    async () => {
      const status = await invokePackagedCommand<{ type: string }>(
        "get_persistence_status",
      );
      const thumbnail = await invokePackagedCommand<{ type: string }>(
        "get_thumbnail_activity",
      );
      return status.type === "healthy" && thumbnail.type !== "capturing";
    },
    {
      timeout: 90000,
      interval: 100,
      timeoutMsg: "persistence did not settle to healthy",
    },
  );
}

export async function requestWindowClose(): Promise<void> {
  await browser.execute(() => {
    const internals = (
      window as unknown as { __TAURI_INTERNALS__?: TauriInternals }
    ).__TAURI_INTERNALS__;
    if (!internals) throw new Error("Tauri internals are unavailable.");
    void internals.invoke("plugin:window|close", { label: "main" });
  });
}

export async function requestApplicationQuit(): Promise<void> {
  await browser.execute(() => {
    const internals = (
      window as unknown as { __TAURI_INTERNALS__?: TauriInternals }
    ).__TAURI_INTERNALS__;
    if (!internals) throw new Error("Tauri internals are unavailable.");
    void internals.invoke("e2e_request_application_quit", {
      waitForActiveAcknowledgement: false,
    });
  });
}

export async function requestApplicationQuitWhenAcknowledging(): Promise<void> {
  await browser.execute(() => {
    const internals = (
      window as unknown as { __TAURI_INTERNALS__?: TauriInternals }
    ).__TAURI_INTERNALS__;
    if (!internals) throw new Error("Tauri internals are unavailable.");
    void internals.invoke("e2e_request_application_quit", {
      waitForActiveAcknowledgement: true,
    });
  });
}

export async function waitForExitSavingWhileAlive(
  timeout = 30000,
): Promise<void> {
  await waitForExitSavingDomWhileAlive(timeout);
  const status = await invokePackagedCommand<ExitStatusView>("get_exit_status");
  if (status.type !== "saving") {
    throw new Error(
      `native ExitStatus was ${status.type} after the saving UI appeared`,
    );
  }
}

export async function waitForExitSavingDomWhileAlive(
  timeout = 30000,
): Promise<void> {
  await browser.waitUntil(
    async () =>
      browser.execute(
        () =>
          document.querySelector('[role="status"][aria-label="儲存中…"]') !==
          null,
      ),
    {
      timeout,
      interval: 20,
      timeoutMsg: "process did not render the saving exit state while alive",
    },
  );
  const handles = await browser.getWindowHandles();
  if (handles.length === 0) {
    throw new Error("ExitStatus reached saving after the last window closed");
  }
  const documentAlive = await browser.execute(
    () => document.documentElement.isConnected,
  );
  if (!documentAlive) {
    throw new Error("packaged document was unavailable during exit saving");
  }
}

export function isPackagedDisconnectError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /(?:invalid session|no such window|session.*(?:closed|deleted)|window.*closed|disconnected|econnrefused|connection refused|failed to connect|terminated)/i.test(
    message,
  );
}

export async function waitForPackagedDisconnect(
  timeout = 30000,
): Promise<void> {
  const retireDisconnectedSession = () => {
    // The app owns this successful shutdown. Once the embedded driver has
    // disappeared, prevent WDIO teardown from issuing DELETE against the dead
    // port and converting the proven disconnect into an ECONNREFUSED failure.
    delete (browser as unknown as { sessionId?: string }).sessionId;
  };
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      if ((await browser.getWindowHandles()).length === 0) {
        retireDisconnectedSession();
        return;
      }
    } catch (error) {
      if (isPackagedDisconnectError(error)) {
        retireDisconnectedSession();
        return;
      }
      throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("packaged process remained connected after exit flush");
}

/** DialogueBox renders a visible <button aria-label="推進對話"> as a sibling
 * of the click-to-advance .box div. The button is the named advance target
 * and the e2e anchor; the .box div itself is click-only (no role/tabindex)
 * to avoid nesting buttons inside a button role. */
export const advanceDialogueSelector = `button[aria-label="${anchors.advanceDialogue}"]`;

/**
 * Main-menu cards animate with opacity 0 (fill-mode both). Under WebDriver the
 * WebView can keep animations frozen when focus is flaky, so isDisplayed()
 * (checkVisibility + opacity) hangs forever. Prefer existence + JS click.
 */
/**
 * DialogueBox skips the JS typewriter when prefers-reduced-motion is reduce.
 * Without this, each advance needs two clicks (complete reveal, then advance)
 * and a 273-line intro exceeds the drain cap / suite budget.
 *
 * Also disable CSS transitions/animations: when the WebView is unfocused under
 * WDIO, transitions freeze at their starting values (opacity 0 on menu cards
 * and character highlight), so isDisplayed/getCSSProperty hang or assert 0.
 */
export async function forceReducedMotion(): Promise<void> {
  await browser.execute(() => {
    try {
      const original = window.matchMedia.bind(window);
      window.matchMedia = ((query: string) => {
        const mql = original(query);
        if (
          typeof query === "string" &&
          query.includes("prefers-reduced-motion")
        ) {
          Object.defineProperty(mql, "matches", {
            configurable: true,
            get: () => true,
          });
        }
        return mql;
      }) as typeof window.matchMedia;
    } catch {
      // ignore — drain still double-clicks as fallback
    }
    try {
      if (!document.getElementById("lyra-e2e-no-motion")) {
        const style = document.createElement("style");
        style.id = "lyra-e2e-no-motion";
        style.textContent =
          "*, *::before, *::after { transition: none !important; animation: none !important; animation-delay: 0s !important; }";
        document.head.appendChild(style);
      }
    } catch {
      // ignore
    }
  });
}

export async function waitForShell(): Promise<void> {
  await forceReducedMotion();
  await browser.waitUntil(
    async () => {
      return browser.execute((label: string) => {
        const buttons = Array.from(document.querySelectorAll("button"));
        return buttons.some((b) => (b.textContent ?? "").includes(label));
      }, anchors.startButton);
    },
    {
      timeout: 60000,
      timeoutMsg: "main menu start control did not appear in DOM",
      interval: 250,
    },
  );
}

async function waitForCaptureProofShell(): Promise<void> {
  await browser.waitUntil(
    async () =>
      browser.execute(
        (label: string) =>
          Array.from(document.querySelectorAll("button")).some((button) =>
            (button.textContent ?? "").includes(label),
          ),
        anchors.startButton,
      ),
    {
      timeout: 60000,
      timeoutMsg: "capture proof main-menu start control did not appear",
      interval: 250,
    },
  );
}

export async function resetCaptureProofStorage(): Promise<void> {
  await browser.waitUntil(
    async () =>
      browser.execute(() => typeof window.localStorage !== "undefined"),
    { timeout: 30000, timeoutMsg: "capture proof localStorage unavailable" },
  );
  await browser.execute((clearanceKey: string) => {
    const toRemove: string[] = [];
    for (let index = 0; index < window.localStorage.length; index++) {
      const key = window.localStorage.key(index);
      if (key?.startsWith("lyra.")) toRemove.push(key);
    }
    for (const key of toRemove) window.localStorage.removeItem(key);
    window.localStorage.setItem(clearanceKey, "true");
  }, STORY_CLEARED_STORAGE_KEY);
  await browser.execute(() => {
    document.documentElement.setAttribute("data-capture-proof-pre-refresh", "");
  });
  await browser.refresh();
  await browser.waitUntil(
    async () =>
      browser.execute(
        () =>
          document.readyState === "complete" &&
          !document.documentElement.hasAttribute(
            "data-capture-proof-pre-refresh",
          ),
      ),
    {
      timeout: 30000,
      timeoutMsg: "capture proof refresh did not replace the prior document",
    },
  );
  await waitForCaptureProofShell();
}

export async function startCaptureProofAtScene(
  sceneId: string,
  expectedEntryDialogue: string,
): Promise<void> {
  const started = await browser.execute((label: string) => {
    document.getAnimations?.().forEach((animation) => {
      try {
        animation.finish();
      } catch {
        // The menu remains directly clickable even if one animation cannot finish.
      }
    });
    const button = Array.from(document.querySelectorAll("button")).find(
      (candidate) => (candidate.textContent ?? "").includes(label),
    );
    button?.click();
    return button !== undefined;
  }, anchors.startButton);
  if (!started) throw new Error("capture proof start control missing");

  await browser.waitUntil(async () => elementExists(advanceDialogueSelector), {
    timeout: 30000,
    timeoutMsg: "capture proof dialogue did not appear after start",
  });
  await browser.keys("Escape");
  await browser.waitUntil(
    async () =>
      browser.execute(
        (heading: string) =>
          Array.from(document.querySelectorAll('[role="dialog"]')).some(
            (dialog) =>
              Array.from(dialog.querySelectorAll("h2")).some((title) =>
                (title.textContent ?? "").includes(heading),
              ),
          ),
        anchors.gameMenu,
      ),
    { timeout: 10000, timeoutMsg: "capture proof game menu did not open" },
  );
  await jsClickButtonContaining(anchors.sceneSelect);
  await browser.waitUntil(
    async () => elementExists('[aria-label="場景跳轉"]'),
    { timeout: 10000, timeoutMsg: "capture proof scene picker did not open" },
  );
  const selected = await browser.execute((expectedSceneId: string) => {
    const button = Array.from(
      document.querySelectorAll<HTMLButtonElement>(
        '[aria-label="場景跳轉"] button',
      ),
    ).find((candidate) =>
      (candidate.textContent ?? "").includes(expectedSceneId),
    );
    button?.click();
    return button !== undefined;
  }, sceneId);
  if (!selected) {
    throw new Error(`capture proof scene ${sceneId} was not selectable`);
  }
  await browser.waitUntil(
    async () =>
      browser.execute((expected: string) => {
        const line = document.querySelector(
          ".text-line, .text-action, .text-scene",
        );
        return (line?.textContent ?? "").includes(expected);
      }, expectedEntryDialogue),
    {
      timeout: 30000,
      timeoutMsg: `capture proof scene ${sceneId} did not expose its entry dialogue`,
    },
  );
}

export async function clickStartButton(): Promise<void> {
  await waitForShell();
  await browser.waitUntil(
    async () =>
      browser.execute((label: string) => {
        const button = Array.from(
          document.querySelectorAll<HTMLButtonElement>("button"),
        ).find(
          (candidate) =>
            candidate.getAttribute("aria-label") === label ||
            (candidate.textContent ?? "").includes(label),
        );
        return !!button && !button.disabled;
      }, anchors.startButton),
    {
      timeout: 30000,
      interval: 100,
      timeoutMsg: "main menu start control stayed disabled after discovery",
    },
  );
  const clicked = await browser.execute((label: string) => {
    const buttons = Array.from(document.querySelectorAll("button"));
    const btn = buttons.find((b) => (b.textContent ?? "").includes(label));
    if (!btn || (btn as HTMLButtonElement).disabled) return false;
    // Finish entrance animations so layout/hit-testing is stable.
    document.getAnimations?.().forEach((a) => {
      try {
        a.finish();
      } catch {
        /* ignore */
      }
    });
    (btn as HTMLButtonElement).click();
    return true;
  }, anchors.startButton);
  if (!clicked) {
    throw new Error("clickStartButton: start control not found");
  }
}

export async function resetE2eStorage(): Promise<void> {
  await browser.waitUntil(
    async () => {
      return browser.execute(() => typeof window.localStorage !== "undefined");
    },
    { timeout: 30000, timeoutMsg: "localStorage unavailable" },
  );
  await browser.execute((key: string) => {
    window.localStorage.removeItem(key);
    const toRemove: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (k && k.startsWith("lyra.")) toRemove.push(k);
    }
    for (const k of toRemove) window.localStorage.removeItem(k);
  }, STORY_CLEARED_STORAGE_KEY);
  await browser.execute(() => {
    document.documentElement.setAttribute(
      "data-ordinary-storage-pre-refresh",
      "",
    );
  });
  await browser.refresh();
  await browser.waitUntil(
    async () =>
      browser.execute(
        () =>
          document.readyState === "complete" &&
          !document.documentElement.hasAttribute(
            "data-ordinary-storage-pre-refresh",
          ),
      ),
    {
      timeout: 30000,
      timeoutMsg:
        "ordinary E2E setup refresh did not replace the prior document",
    },
  );
  // Re-apply motion stubs after navigation (refresh drops injected scripts).
  await waitForShell();
}

export async function resetE2eStorageWithStoryClearance(): Promise<void> {
  await browser.waitUntil(
    async () =>
      browser.execute(() => typeof window.localStorage !== "undefined"),
    { timeout: 30000, timeoutMsg: "localStorage unavailable" },
  );
  await browser.execute((clearanceKey: string) => {
    const toRemove: string[] = [];
    for (let index = 0; index < window.localStorage.length; index++) {
      const key = window.localStorage.key(index);
      if (key?.startsWith("lyra.")) toRemove.push(key);
    }
    for (const key of toRemove) window.localStorage.removeItem(key);
    window.localStorage.setItem(clearanceKey, "true");
    document.documentElement.setAttribute("data-save-storage-pre-refresh", "");
  }, STORY_CLEARED_STORAGE_KEY);
  await browser.refresh();
  await browser.waitUntil(
    async () =>
      browser.execute(
        () =>
          document.readyState === "complete" &&
          !document.documentElement.hasAttribute(
            "data-save-storage-pre-refresh",
          ),
      ),
    {
      timeout: 30000,
      timeoutMsg: "save e2e setup refresh did not replace the prior document",
    },
  );
  await waitForShell();
  const value = await browser.execute((clearanceKey: string) => {
    return window.localStorage.getItem(clearanceKey);
  }, STORY_CLEARED_STORAGE_KEY);
  if (value !== "true") {
    throw new Error(
      `resetE2eStorageWithStoryClearance: ${STORY_CLEARED_STORAGE_KEY} did not persist across refresh (got ${JSON.stringify(value)})`,
    );
  }
}

export async function startFromMenu(): Promise<void> {
  await clickStartButton();
  try {
    await browser.waitUntil(
      async () => {
        const status = await browser.execute(
          (sel: string, label: string) => {
            if (document.querySelector(sel) !== null) {
              return { started: true, error: null };
            }

            const error = document.querySelector(
              "[role='alert'], .error-banner",
            );
            if (error) {
              return {
                started: false,
                error:
                  (error.textContent ?? "").trim() ||
                  "New Game reported an empty error.",
              };
            }

            const button = Array.from(
              document.querySelectorAll<HTMLButtonElement>("button"),
            ).find(
              (candidate) =>
                candidate.getAttribute("aria-label") === label ||
                (candidate.textContent ?? "").includes(label),
            );

            // A freshly launched WebView can expose the server-rendered menu
            // just before Svelte attaches its click handler. Retrying is safe
            // only while the control remains enabled: the handler disables it
            // synchronously before awaiting the native start command.
            if (button && !button.disabled) {
              button.click();
            }
            return { started: false, error: null };
          },
          advanceDialogueSelector,
          anchors.startButton,
        );
        if (status.error) {
          throw new Error(`New Game failed: ${status.error}`);
        }
        return status.started;
      },
      {
        timeout: 90000,
        timeoutMsg: "dialogue advance control did not appear after start",
        interval: 200,
      },
    );
  } catch (e) {
    // Surface the on-screen error banner (if any) so resource/IPC failures
    // are diagnosable instead of just "did not appear after start".
    const diag = await browser.execute(async () => {
      const banner = document.querySelector("[role='alert'], .error-banner");
      const diagnosticWindow = window as Window & {
        __TAURI_INTERNALS__?: TauriInternals;
        __saveE2eRuntimeErrors?: string[];
      };
      const internals = diagnosticWindow.__TAURI_INTERNALS__;
      let nativeState:
        | { ok: true; value: unknown }
        | { ok: false; error: string };
      try {
        nativeState = internals
          ? { ok: true, value: await internals.invoke("get_state", {}) }
          : { ok: false, error: "Tauri internals are unavailable." };
      } catch (error) {
        nativeState = {
          ok: false,
          error:
            error instanceof Error
              ? (error.stack ?? error.message)
              : JSON.stringify(error),
        };
      }
      return {
        url: window.location.href,
        documentIdentity:
          document.documentElement.dataset.saveDocumentIdentity ?? null,
        titleVisible: document.querySelector('[aria-label="主選單"]') !== null,
        gameplayRootVisible:
          document.querySelector("[data-gameplay-root]") !== null,
        captureRootVisible:
          document.querySelector("[data-save-thumbnail-root]") !== null,
        tauriInternals: internals !== undefined,
        errorBanner: banner ? (banner.textContent ?? "").trim() : null,
        runtimeErrors: diagnosticWindow.__saveE2eRuntimeErrors ?? [],
        bodyText: (document.body.textContent ?? "").trim(),
        buttons: Array.from(
          document.querySelectorAll<HTMLButtonElement>("button"),
        ).map((button) => ({
          ariaLabel: button.getAttribute("aria-label"),
          text: (button.textContent ?? "").trim(),
          disabled: button.disabled,
        })),
        nativeState,
      };
    });
    console.error("[startFromMenu diagnostic]", JSON.stringify(diag));
    throw e;
  }
}

export async function waitTypewriterIdle(): Promise<void> {
  try {
    await browser.waitUntil(
      async () => {
        return browser.execute((sel: string) => {
          const el = document.querySelector(sel) as HTMLElement | null;
          if (!el) return false;
          return el.getAttribute("aria-disabled") !== "true";
        }, advanceDialogueSelector);
      },
      {
        // A real packaged autosave captures the gameplay root before the next
        // mutation becomes interactive. Keep this aligned with the 90-second
        // packaged command/capture deadline used by the HPA phase helpers: a
        // fresh macOS build can exceed 60 seconds while WebKit embeds fonts.
        timeout: 90000,
        timeoutMsg: "dialogue advance stayed aria-disabled",
        interval: 100,
      },
    );
  } catch (error) {
    const [native, rendered] = await Promise.all([
      getPackagedGameState().catch((stateError: unknown) => ({
        diagnosticError:
          stateError instanceof Error ? stateError.message : String(stateError),
      })),
      browser.execute(
        (sel: string, captureProbe: string) => {
          const advance = document.querySelector<HTMLElement>(sel);
          return {
            advance: advance
              ? {
                  ariaDisabled: advance.getAttribute("aria-disabled"),
                  text: (advance.textContent ?? "").trim(),
                }
              : null,
            visibleDialogue:
              document.querySelector(".text-line, .text-action, .text-scene")
                ?.textContent ?? null,
            dialogs: Array.from(
              document.querySelectorAll<HTMLElement>('[role="dialog"]'),
            ).map((dialog) => ({
              ariaLabel: dialog.getAttribute("aria-label"),
              text: (dialog.textContent ?? "").trim().slice(0, 1000),
            })),
            captureProof: document
              .querySelector(captureProbe)
              ?.getAttribute("data-capture-proof-command-status"),
          };
        },
        advanceDialogueSelector,
        anchors.captureProof.probe,
      ),
    ]);
    throw new Error(
      [
        error instanceof Error ? error.message : String(error),
        `native=${JSON.stringify(native)}`,
        `rendered=${JSON.stringify(rendered)}`,
      ].join("\n"),
      { cause: error },
    );
  }
  // Typewriter can take up to ~1.5s after enable; settle briefly.
  await browser.pause(150);
}

export async function advanceDialogueOnce(): Promise<boolean> {
  await waitTypewriterIdle();
  // Click twice: first may only complete a typewriter reveal; second advances.
  // With reduced-motion both are cheap no-ops/advances as appropriate.
  return browser.execute((sel: string) => {
    const el = document.querySelector(sel) as HTMLElement | null;
    if (!el) return false;
    el.click();
    el.click();
    return true;
  }, advanceDialogueSelector);
}

/**
 * Read the currently visible dialogue line/narration/scene text so capped
 * drain failures report what was on screen (see flake policy in the design
 * spec). Returns "" when no dialogue text element is present.
 */
export async function lastVisibleDialogueText(): Promise<string> {
  return browser.execute(() => {
    const el = document.querySelector(".text-line, .text-action, .text-scene");
    return el ? (el.textContent ?? "").trim() : "";
  });
}

/**
 * Advance dialogue until `predicate` returns true or cap is hit.
 * Cap must be intro-length + margin (see production-anchors).
 */
export async function advanceDialogueUntil(
  predicate: () => Promise<boolean>,
  cap: number = DIALOGUE_DRAIN_CAP,
): Promise<void> {
  for (let i = 0; i < cap; i++) {
    // Check the predicate before every advance so the drain stops as soon as
    // the target state is reached — e.g. when an acquisition popup appears
    // mid-dialogue. Without this guard the loop would advance past the popup,
    // dismissing it and draining dialogue the popup was supposed to interrupt.
    if (await predicate()) return;
    const hasAdvance = await browser.execute((sel: string) => {
      return document.querySelector(sel) !== null;
    }, advanceDialogueSelector);
    if (!hasAdvance) {
      if (await predicate()) return;
      // The advance selector can be transiently absent during a mode
      // transition. Right after a hotspot click, jsClick only dispatches the
      // DOM event while inspect_hotspot is still awaiting IPC — the app
      // remains in explore mode with no advance selector until the response
      // re-renders into dialogue. Symmetrically, when a dialogue queue
      // exhausts, the app transitions out of dialogue and the selector
      // disappears while the target mode renders. Wait briefly for either the
      // predicate to become true (the transition completed into the target
      // state) or the advance selector to reappear (the transition completed
      // into a new dialogue) before declaring a terminal failure. Without
      // this grace, the drain throws at step 0 during the IPC window.
      try {
        await browser.waitUntil(
          async () => {
            if (await predicate()) return true;
            return browser.execute((sel: string) => {
              return document.querySelector(sel) !== null;
            }, advanceDialogueSelector);
          },
          {
            timeout: 5000,
            interval: 100,
            timeoutMsg:
              "advanceDialogueUntil: advance control did not return and predicate did not become true",
          },
        );
      } catch {
        const lastText = await lastVisibleDialogueText();
        throw new Error(
          `advanceDialogueUntil: advance control unavailable at step ${i}; predicate still false; last visible text: ${JSON.stringify(lastText)}`,
        );
      }
      if (await predicate()) return;
      // The selector reappeared — continue draining from the next step.
      continue;
    }
    // A queue-exhausting command can remove the control during the short
    // settle between waitTypewriterIdle() and the atomic DOM click. Let the
    // capped outer loop re-check its predicate and existing transition grace
    // instead of treating that legitimate mode transition as a terminal
    // missing-control failure.
    if (!(await advanceDialogueOnce()) && (await predicate())) return;
  }
  const lastText = await lastVisibleDialogueText();
  throw new Error(
    `advanceDialogueUntil: exceeded cap ${cap}; predicate still false; last visible text: ${JSON.stringify(lastText)}`,
  );
}

export async function elementExists(selector: string): Promise<boolean> {
  return browser.execute((sel: string) => {
    return document.querySelector(sel) !== null;
  }, selector);
}

export async function elementTextIncludes(
  selector: string,
  text: string,
): Promise<boolean> {
  return browser.execute(
    (sel: string, needle: string) => {
      const el = document.querySelector(sel);
      return !!el && (el.textContent ?? "").includes(needle);
    },
    selector,
    text,
  );
}

export async function drainToInvestigationExplore(): Promise<void> {
  await startFromMenu();
  await advanceDialogueUntil(async () => {
    // Use DOM existence to detect the mode transition without coupling this
    // dialogue drain to the longer persistence-owned capture deadline.
    const sub = await browser.execute((label: string) => {
      return Array.from(document.querySelectorAll("button")).some((b) =>
        (b.textContent ?? "").includes(label),
      );
    }, anchors.sublocationLabel);
    if (sub) return true;
    return elementExists(
      `button[aria-label="${anchors.hotspotEvidence.label}"]`,
    );
  });
  // The explore DOM renders before the autosave thumbnail submission settles.
  // Investigation controls are deliberately disabled throughout that owned
  // command phase, and HTMLElement.click() is a no-op for disabled buttons.
  // Do not hand control to a test until the canonical production hotspot is
  // actually interactive.
  await waitForButton(anchors.hotspotEvidence.label, 90000);
}

export async function openGameMenu(): Promise<void> {
  try {
    await browser.waitUntil(
      async () => {
        const open = await browser.execute((heading: string) => {
          const dialogs = Array.from(
            document.querySelectorAll('[role="dialog"]'),
          );
          return dialogs.some((d) =>
            Array.from(d.querySelectorAll("h2")).some((h) =>
              (h.textContent ?? "").includes(heading),
            ),
          );
        }, anchors.gameMenu);
        if (open) return true;
        // GameShell deliberately swallows Escape while a gameplay command and
        // its owned thumbnail submission are still in flight. Retry with a new
        // physical key event until that bounded frontend phase has settled.
        await browser.keys("Escape");
        return false;
      },
      {
        timeout: 15000,
        interval: 100,
        timeoutMsg: "game menu dialog did not open",
      },
    );
  } catch (error) {
    const rendered = await browser.execute(() => ({
      activeElement:
        document.activeElement instanceof HTMLElement
          ? {
              tag: document.activeElement.tagName,
              ariaLabel: document.activeElement.getAttribute("aria-label"),
              text: (document.activeElement.textContent ?? "")
                .trim()
                .slice(0, 200),
            }
          : null,
      dialogs: Array.from(
        document.querySelectorAll<HTMLElement>('[role="dialog"]'),
      ).map((dialog) => ({
        ariaLabel: dialog.getAttribute("aria-label"),
        headings: Array.from(dialog.querySelectorAll("h2")).map((heading) =>
          (heading.textContent ?? "").trim(),
        ),
        text: (dialog.textContent ?? "").trim().slice(0, 500),
      })),
      buttons: Array.from(
        document.querySelectorAll<HTMLButtonElement>("button"),
      ).map((button) => ({
        ariaLabel: button.getAttribute("aria-label"),
        text: (button.textContent ?? "").trim().slice(0, 200),
        disabled: button.disabled,
      })),
    }));
    let native:
      | {
          mode: GameStateView["mode"];
          scene: GameStateView["scene"];
          pendingAcquisition: GameStateView["pendingAcquisition"];
        }
      | { diagnosticError: string };
    try {
      const state = await getPackagedGameState();
      native = {
        mode: state.mode,
        scene: state.scene,
        pendingAcquisition: state.pendingAcquisition,
      };
    } catch (diagnosticError) {
      native = {
        diagnosticError:
          diagnosticError instanceof Error
            ? diagnosticError.message
            : String(diagnosticError),
      };
    }
    throw new Error(
      [
        error instanceof Error ? error.message : String(error),
        `native=${JSON.stringify(native)}`,
        `rendered=${JSON.stringify(rendered)}`,
      ].join("\n"),
      { cause: error },
    );
  }
}

export async function seedStoryCleared(): Promise<void> {
  await browser.execute((key: string) => {
    window.localStorage.setItem(key, "true");
  }, STORY_CLEARED_STORAGE_KEY);
  await browser.refresh();
  await waitForShell();
  // Assert persistence so storage-isolation failures surface during setup,
  // before the test body runs with a missing clearance flag.
  const value = await browser.execute((key: string) => {
    return window.localStorage.getItem(key);
  }, STORY_CLEARED_STORAGE_KEY);
  if (value !== "true") {
    throw new Error(
      `seedStoryCleared: ${STORY_CLEARED_STORAGE_KEY} did not persist across refresh (got ${JSON.stringify(value)})`,
    );
  }
}

export async function jsClick(selector: string): Promise<void> {
  const ok = await browser.execute((sel: string) => {
    const el = document.querySelector(sel) as HTMLElement | null;
    if (!el) return false;
    el.click();
    return true;
  }, selector);
  if (!ok) throw new Error(`jsClick: no element for ${selector}`);
}

export async function jsClickButtonContaining(text: string): Promise<void> {
  const ok = await browser.execute((label: string) => {
    const btn = Array.from(document.querySelectorAll("button")).find((b) =>
      (b.textContent ?? "").includes(label),
    );
    if (!btn) return false;
    (btn as HTMLButtonElement).click();
    return true;
  }, text);
  if (!ok) throw new Error(`jsClickButtonContaining: no button with ${text}`);
}

/** Collect kagami_summary evidence and dismiss acquisition UI back to explore/dialogue.
 *
 * Acquisition popups are deferred while an authored on_collect dialogue queue
 * plays (game-client.svelte.ts buffers the notification until the queue
 * drains). So the 物證取得 popup does NOT appear immediately after clicking
 * the hotspot — it surfaces only once the on_collect dialogue finishes.
 * This mirrors the page.test.ts "delayed acquisition after dialogue" pattern:
 * drain dialogue first, then expect the popup, then CONTINUE. */
export async function collectKagamiSummaryEvidence(): Promise<void> {
  const hotspotSel = `button[aria-label="${anchors.hotspotEvidence.label}"]`;
  await clickButton(anchors.hotspotEvidence.label);
  // Drain the on_collect dialogue queue. The popup surfaces once the queue
  // empties and the deferred acquisition notification flushes. If the hotspot
  // has no on_collect dialogue, the predicate is true on the first check and
  // this returns immediately.
  await advanceDialogueUntil(async () => {
    return browser.execute((heading: string) => {
      return Array.from(document.querySelectorAll('[role="dialog"]')).some(
        (d) =>
          Array.from(d.querySelectorAll("h2")).some((h) =>
            (h.textContent ?? "").includes(heading),
          ),
      );
    }, anchors.evidenceAcquired);
  }, 40);
  await jsClickButtonContaining("CONTINUE");
  // After CONTINUE, drain any residual dialogue until explore is usable again.
  await advanceDialogueUntil(async () => {
    if (await elementExists(`button[aria-label="${anchors.character.label}"]`))
      return true;
    return elementExists(hotspotSel);
  }, 40);
  // Dismissing the acquisition popup can trigger another autosave capture.
  // The explore DOM returns before its controls are interactive, so wait for
  // the next action used by callers instead of handing back a disabled button.
  await waitForButton(anchors.character.label, 90000);
}

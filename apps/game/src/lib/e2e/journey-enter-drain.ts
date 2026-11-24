import type {
  DialogueItem,
  GameStateView,
  PendingAcquisitionView,
  QueueToken,
} from "$lib/state/types";
import type { FocusOwnerRequirement } from "./focus-probe";

/**
 * HPA-831 commission -> scene_2 -> map Enter drain, extracted from
 * production-journey.e2e.ts so the identical orchestration WebDriver drives
 * is exercised by vitest — the injected hooks are the WebDriver seam, the
 * sequencing/observation policy here is the real code.
 */

/** Scene/mode/queue token an Enter advance must change to count as progress. */
export function journeyProgressToken(state: GameStateView): string {
  const mode =
    state.mode.type === "dialogue"
      ? {
          type: state.mode.type,
          queueToken: state.mode.queueToken,
          queueRemaining: state.mode.queueRemaining,
        }
      : { type: state.mode.type };
  return JSON.stringify({
    chapter: state.chapter.id,
    scene: state.scene.id,
    mode,
    pendingAcquisition: state.pendingAcquisition?.id ?? null,
  });
}

/**
 * Three-way observation result for one Enter. `unchanged` is reserved for a
 * successful read that PROVES the token still matches — evidence that
 * justifies a retry Enter only after the command channel has also settled
 * (a still-pending first Enter can otherwise masquerade as a reveal-only
 * Enter and double-advance). `unknown` means the state could not be read
 * at all: the Enter may already have advanced, so sending another key
 * could silently skip a queue item — the drain must stop inconclusively
 * instead.
 */
export type JourneyProgressOutcome = "progressed" | "unchanged" | "unknown";

export type JourneyWaitUntil = (
  condition: () => Promise<boolean>,
  options: { timeout: number; interval: number },
) => Promise<unknown>;

/**
 * Bounded wait for the last Enter to produce an observable state change
 * (queue advance, mode/scene transition, or a pending acquisition). When
 * the poll window ends without observing progress, one final arbiter read
 * decides: a successful read returning the same token is reliable evidence
 * of "unchanged"; a successful read with a new token is late "progressed";
 * a failed read is "unknown" — never fold an unreadable state into
 * "unchanged" (a second Enter on an unobserved advance can walk past the
 * scene's authored entry item).
 */
export async function observeJourneyProgress(options: {
  token: string;
  timeoutMs: number;
  intervalMs?: number;
  waitUntil: JourneyWaitUntil;
  readState: () => Promise<GameStateView>;
}): Promise<JourneyProgressOutcome> {
  const progressed = await options
    .waitUntil(
      async () => {
        try {
          const next = await options.readState();
          if (next.pendingAcquisition !== null) return true;
          return journeyProgressToken(next) !== options.token;
        } catch {
          return false;
        }
      },
      { timeout: options.timeoutMs, interval: options.intervalMs ?? 100 },
    )
    .then(() => true)
    .catch(() => false);
  if (progressed) return "progressed";
  let final: GameStateView;
  try {
    final = await options.readState();
  } catch {
    return "unknown";
  }
  if (final.pendingAcquisition !== null) return "progressed";
  return journeyProgressToken(final) !== options.token
    ? "progressed"
    : "unchanged";
}

/** The observed identity of a scene's authored queue entry — persisted into
 * the first probe's diagnostic JSON so the credited "first" is auditable. */
export type SceneQueueEntryProof = {
  sceneId: string;
  sceneTitle: string;
  /** The queueToken observed at the entry item: sceneId + queueGen + the
   * flattened cursor (leading consumed scene tags already included). */
  queueToken: QueueToken;
  queueRemaining: number;
  /** The single history entry the scene run has shown — the entry item. */
  entry: { id: number; kind: string; text: string };
};

/**
 * Proves the item observed at a scene's first dialogue read is the authored
 * queue entry, not a later item reached through an observation gap.
 *
 * The engine appends exactly one dialogueHistory entry per displayed item,
 * in display order (dialogue.rs::record — scene tags are never logged), so
 * the history suffix carrying THIS scene's title is precisely the items the
 * scene run has already shown. A suffix of one means the current item is
 * the entry; more means items displayed while the drain could not see them
 * — which must fail inconclusively rather than credit a later item as
 * "first". The queueToken's sceneId must also match the scene's own id or
 * the visible queue belongs to a different scene entirely.
 */
export function proveSceneQueueEntry(
  state: GameStateView,
): SceneQueueEntryProof {
  if (state.mode.type !== "dialogue") {
    throw new Error(
      `proveSceneQueueEntry requires dialogue mode, got ${state.mode.type}`,
    );
  }
  const token = state.mode.queueToken;
  if (token.sceneId !== state.scene.id) {
    throw new Error(
      `scene ${state.scene.id} is displaying a queue owned by ${token.sceneId} ` +
        `— the scene's own entry item cannot be established`,
    );
  }
  const title = state.scene.title;
  const history = state.dialogueHistory;
  let runStart = history.length;
  while (runStart > 0 && history[runStart - 1]?.sceneTitle === title) {
    runStart -= 1;
  }
  const shown = history.length - runStart;
  const entry = history[runStart];
  if (shown !== 1 || entry === undefined) {
    throw new Error(
      `scene ${state.scene.id} first observed at queue cursor ${token.cursor} ` +
        `with ${shown} already-shown item${shown === 1 ? "" : "s"} — the ` +
        `authored entry was not observed, so this item cannot be credited ` +
        `as the scene's first`,
    );
  }
  return {
    sceneId: state.scene.id,
    sceneTitle: title,
    queueToken: { ...token },
    queueRemaining: state.mode.queueRemaining,
    entry: {
      id: entry.id,
      kind: entry.kind,
      text:
        entry.kind === "line" ? `${entry.speaker}: ${entry.text}` : entry.text,
    },
  };
}

/** The DOM surface DialogueBox renders a dialogue item into, plus the
 * full text an exact match proves (sceneTag renders a fixed placeholder
 * with no distinguishing text, so presence alone is the contract). A
 * checkpoint's screenshot must wait for this match or it can sample the
 * preceding item — the packaged get_state read and the Svelte render are
 * independent (applyGameplayCommandResult -> tick). The per-kind
 * selectors are authored in production-anchors (this module is imported
 * by the app bundle and cannot import that file back); this pins the
 * per-kind mapping the WebDriver renderedItemSettled hook asserts against
 * the real DOM. */
export function renderedItemSurface(
  current: DialogueItem,
  surfaceSelectors: Record<DialogueItem["kind"], string>,
): {
  selector: string;
  text: string | null;
} {
  switch (current.kind) {
    case "line":
      return { selector: surfaceSelectors.line, text: current.text };
    case "action":
      return { selector: surfaceSelectors.action, text: current.text };
    case "prompt":
      return { selector: surfaceSelectors.prompt, text: current.question };
    case "sceneTag":
      return { selector: surfaceSelectors.sceneTag, text: null };
  }
}

/** WebDriver seams the drain orchestration needs; tests inject scripted
 * doubles and production-journey wires the real browser helpers. */
export type EnterDrainHooks = {
  /** Read the current packaged state; a rejection marks an unknown read. */
  readState: () => Promise<GameStateView>;
  pause: (ms: number) => Promise<void>;
  waitUntil: JourneyWaitUntil;
  /** Send one Enter through the segment's real key transport. */
  sendEnter: () => Promise<void>;
  acknowledgeAcquisition: (current: PendingAcquisitionView) => Promise<void>;
  mapMounted: () => Promise<boolean>;
  probeHook: (
    label: string,
    requirement: FocusOwnerRequirement,
    diagnostics?: Record<string, unknown>,
  ) => Promise<void>;
  /** Trusted-delivery gate run only at the parked-map hook. */
  verifyKeyDelivery: (sentEnters: number) => Promise<void>;
  captureStallProbe: (label: string) => Promise<{
    activeElementDescriptor: string | null;
    screenshotPath: string;
  }>;
  /** Bounded wait for the packaged app's command channel to settle — the
   * advance control's aria-disabled clears when a dispatched command has
   * finished applying. Resolves false on timeout; the retry gate treats
   * unproven settlement as inconclusive rather than sending a blind Enter. */
  commandSettled: () => Promise<boolean>;
  /** Bounded wait for the rendered dialogue surface to display the state's
   * current item. The packaged get_state read and the Svelte render are
   * independent, so a checkpoint screenshot can otherwise sample the
   * preceding line. Resolves false on timeout; the drain fails
   * inconclusively rather than labelling a stale frame. */
  renderedItemSettled: (current: DialogueItem) => Promise<boolean>;
};

export type EnterDrainOptions = {
  hooks: EnterDrainHooks;
  /** The scene whose first/middle/last dialogue items get focus probes. */
  sceneId: string;
  cap: number;
  /** Human-readable key transport for inconclusive messages. */
  transportName: string;
  progressTimeoutMs?: number;
  progressIntervalMs?: number;
  readFailurePauseMs?: number;
  mapWaitTimeoutMs?: number;
};

/**
 * Enter-drain the outro into `sceneId` and the first map wrapper, probing
 * focus at the scene's first/middle/last items. Every Enter is sent only
 * after a successful state read, and a retry Enter fires only on PROVEN
 * "unchanged" after the app's command channel has settled and a re-read
 * still shows the same token (a reveal-only first Enter): one Enter can
 * never advance more than one queue item and no key is ever sent while
 * the state is unknown, so the first observed `sceneId` dialogue item is
 * guaranteed to be its authored entry — additionally proven by
 * proveSceneQueueEntry before it is credited. Each checkpoint also waits
 * for the rendered line to match the state's current item before the
 * screenshot is taken. The parked map is accepted only after trusted key
 * delivery is verified; queue progress alone is not proof.
 */
export async function drainEnterToMap(
  options: EnterDrainOptions,
): Promise<{ sentEnters: number }> {
  const {
    hooks,
    sceneId,
    cap,
    transportName,
    progressTimeoutMs = 1500,
    progressIntervalMs = 100,
    readFailurePauseMs = 200,
    mapWaitTimeoutMs = 5000,
  } = options;
  let sentEnters = 0;
  const sendEnter = async (): Promise<void> => {
    await hooks.sendEnter();
    sentEnters += 1;
  };
  const observeProgress = (token: string): Promise<JourneyProgressOutcome> =>
    observeJourneyProgress({
      token,
      timeoutMs: progressTimeoutMs,
      intervalMs: progressIntervalMs,
      waitUntil: hooks.waitUntil,
      readState: hooks.readState,
    });
  const taken = { first: false, middle: false, last: false };
  const finishIfMapParked = async (): Promise<boolean> => {
    if (!(await hooks.mapMounted())) return false;
    // Observe first, then gate acceptance on keyboard proof (evidence run
    // a0f60ac6): the last Enter's advance unmounts the focused
    // .advance-button together with the DialogueBox, so the browser
    // legitimately falls back to body with no ring — the same unmount
    // fallback the topic-click hook already records. The map hook
    // therefore enforces the any-expected owner contract plus the shared
    // stale-outline gate, keeping :focus-visible diagnostic rather than
    // required on the transition-fallback owner. The keyboard proof for
    // the crossing is trusted Enter delivery: queue progress alone is
    // not proof, and an undelivered/untrusted Enter fails inconclusive —
    // never silently green.
    await hooks.probeHook("map-pending", { owner: "any-expected" });
    await hooks.verifyKeyDelivery(sentEnters);
    if (!taken.first || !taken.middle || !taken.last) {
      throw new Error(
        `${sceneId} focus probes incomplete before the map parked: ${JSON.stringify(taken)}`,
      );
    }
    return true;
  };
  let mapReached = false;
  for (let step = 0; step < cap; step += 1) {
    let state: GameStateView;
    try {
      state = await hooks.readState();
    } catch {
      await hooks.pause(readFailurePauseMs);
      continue;
    }
    if (state.pendingAcquisition) {
      // Unexpected popup mid-drain: acknowledge through the injected hook
      // (the segment acknowledges via its key transport, never a synthetic
      // click) and resume.
      await hooks.acknowledgeAcquisition(state.pendingAcquisition);
      continue;
    }
    if (await finishIfMapParked()) {
      mapReached = true;
      break;
    }
    // The map wrapper can enter explore a frame before its DOM mounts —
    // Enter does nothing in explore, so wait for the surface instead of
    // counting that frame as a keyboard stall.
    if (state.mode.type === "explore") {
      await hooks
        .waitUntil(async () => hooks.mapMounted(), {
          timeout: mapWaitTimeoutMs,
          interval: 100,
        })
        .catch(() => {});
      if (await finishIfMapParked()) {
        mapReached = true;
        break;
      }
      throw new Error(
        `focus drain reached explore in ${state.scene.id} but the city map never rendered`,
      );
    }
    if (state.scene.id === sceneId && state.mode.type === "dialogue") {
      const cursor = state.mode.queueToken.cursor;
      const total = cursor + state.mode.queueRemaining;
      // Every checkpoint's screenshot must show the item the packaged
      // state reports — the get_state read and the Svelte render are
      // independent, so a frame sampled mid-apply could capture the
      // preceding line. Wait for the rendered line to match, and fail
      // inconclusively rather than labelling a stale frame.
      const requireRenderedItem = async (label: string): Promise<void> => {
        if (state.mode.type !== "dialogue") return;
        if (await hooks.renderedItemSettled(state.mode.current)) return;
        const stalled = await hooks.captureStallProbe(`${label}-stale`);
        throw new Error(
          `${transportName} could not verify the rendered line for ${label} ` +
            `at step ${step} (queue cursor ${state.mode.type === "dialogue" ? state.mode.queueToken.cursor : "?"}) ` +
            `— the checkpoint would sample the preceding line, so focus ` +
            `coverage is inconclusive ` +
            `(activeElement=${stalled.activeElementDescriptor ?? "null"}, ` +
            `screenshot ${stalled.screenshotPath})`,
        );
      };
      if (!taken.first) {
        // Prove this is the authored queue entry before crediting it: a
        // later item observed after an observation gap must fail
        // inconclusively, not be labelled "first".
        const entry = proveSceneQueueEntry(state);
        await requireRenderedItem(`${sceneId}-first`);
        await hooks.probeHook(
          `${sceneId}-first`,
          { owner: "any-expected", requireKeyboardModality: true },
          { sceneEntry: entry },
        );
        taken.first = true;
      }
      // The organic checkpoints stay observational: the focused-root
      // regression detection lives in the shared probe's prohibited-state
      // gate (a painted outline on [data-gameplay-root] fails every hook,
      // exercised directly by the focus-probe unit regression) — forcing
      // root.focus() here would replace the commission-produced focus
      // trajectory the middle/last/map checkpoints exist to observe.
      if (!taken.middle && total > 0 && cursor >= Math.floor(total / 2)) {
        await requireRenderedItem(`${sceneId}-middle`);
        await hooks.probeHook(`${sceneId}-middle`, {
          owner: "any-expected",
          requireKeyboardModality: true,
        });
        taken.middle = true;
      }
      if (!taken.last && state.mode.queueRemaining === 0) {
        await requireRenderedItem(`${sceneId}-last`);
        await hooks.probeHook(`${sceneId}-last`, {
          owner: "any-expected",
          requireKeyboardModality: true,
        });
        taken.last = true;
      }
    }
    const token = journeyProgressToken(state);
    await sendEnter();
    const outcome = await observeProgress(token);
    if (outcome === "progressed") continue;
    if (outcome === "unknown") {
      const stalled = await hooks.captureStallProbe("enter-unobserved");
      throw new Error(
        `${transportName} produced an unobservable state after Enter at ` +
          `step ${step} (scene ${state.scene.id}, mode ${state.mode.type}) ` +
          `— progress cannot be proven, so no retry Enter is sent; the ` +
          `real keyboard path is inconclusive ` +
          `(activeElement=${stalled.activeElementDescriptor ?? "null"}, ` +
          `screenshot ${stalled.screenshotPath})`,
      );
    }
    // An "unchanged" verdict alone does not prove the first Enter only
    // completed a reveal: the packaged get_state read and the
    // keyboard-dispatched advance are independent, so a read can return
    // the pre-commit token while the first command is still in flight —
    // a retry sent then double-advances past an item the drain must
    // observe. Wait for the command channel to settle, then re-read: a
    // changed token is late "progressed"; a still-matching token on a
    // settled channel is the proven reveal-only case justifying one retry.
    if (!(await hooks.commandSettled())) {
      const stalled = await hooks.captureStallProbe("enter-unsettled");
      throw new Error(
        `${transportName} left the command channel unsettled after Enter at ` +
          `step ${step} (scene ${state.scene.id}, mode ${state.mode.type}) ` +
          `— command settlement cannot be proven, so no retry Enter is ` +
          `sent; the real keyboard path is inconclusive ` +
          `(activeElement=${stalled.activeElementDescriptor ?? "null"}, ` +
          `screenshot ${stalled.screenshotPath})`,
      );
    }
    let verified: GameStateView;
    try {
      verified = await hooks.readState();
    } catch {
      const stalled = await hooks.captureStallProbe("enter-unobserved");
      throw new Error(
        `${transportName} produced an unobservable state after Enter at ` +
          `step ${step} (scene ${state.scene.id}, mode ${state.mode.type}) ` +
          `— progress cannot be proven, so no retry Enter is sent; the ` +
          `real keyboard path is inconclusive ` +
          `(activeElement=${stalled.activeElementDescriptor ?? "null"}, ` +
          `screenshot ${stalled.screenshotPath})`,
      );
    }
    if (
      verified.pendingAcquisition !== null ||
      journeyProgressToken(verified) !== token
    ) {
      continue;
    }
    await sendEnter();
    const retryOutcome = await observeProgress(token);
    if (retryOutcome === "progressed") continue;
    if (retryOutcome === "unknown") {
      const stalled = await hooks.captureStallProbe("enter-unobserved");
      throw new Error(
        `${transportName} produced an unobservable state after the retry ` +
          `Enter at step ${step} (scene ${state.scene.id}, mode ` +
          `${state.mode.type}) — progress cannot be proven; the real ` +
          `keyboard path is inconclusive ` +
          `(activeElement=${stalled.activeElementDescriptor ?? "null"}, ` +
          `screenshot ${stalled.screenshotPath})`,
      );
    }
    const stalled = await hooks.captureStallProbe("enter-stalled");
    throw new Error(
      `${transportName} did not advance dialogue at step ${step} (scene ` +
        `${state.scene.id}, mode ${state.mode.type}) — the real keyboard ` +
        `path is inconclusive ` +
        `(activeElement=${stalled.activeElementDescriptor ?? "null"})`,
    );
  }
  if (!mapReached) {
    throw new Error(
      `focus drain exceeded ${cap} Enters before ${sceneId} reached the map`,
    );
  }
  return { sentEnters };
}

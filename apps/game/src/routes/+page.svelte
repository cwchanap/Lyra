<script lang="ts">
  import {
    gameState,
    continuePersistedGame,
    loadPersistedGame,
    loadPersistedGameDiscardingCurrent,
    startPersistedGame,
    startGameWithoutSaving,
    resetGame,
    resetFrontendForTitle,
    returnPersistedToTitle,
    returnPersistedToTitleWithoutSaving,
    advanceDialogue,
    inspectHotspot,
    interviewTopic,
    enterSublocation,
    reexamineEvidence,
    reexamineStatement,
    askInterrogationQuestion,
    challengeInterrogationLine,
    presentInterrogationEvidence,
    withdrawInterrogation,
    resumeInterrogationTestimony,
    completeInterrogationPhase,
    selectAnalysisBoard,
    updateAnalysisDraft,
    submitAnalysisBoard,
    listScenes,
    jumpToScene,
    presentationState,
    settlePreparedThumbnailCapture,
  } from "$lib/state/game-client.svelte";
  import { canReexamineCaseRecords, shouldShowCaseFile } from "$lib/state/mode";
  import {
    currentInterrogationPhase,
    isInterrogationPresentationActive,
  } from "$lib/interrogation/presentation";
  import {
    loadStoryClearedOnce,
    saveStoryClearedOnce,
  } from "$lib/state/story-clearance";
  import type { SceneNavigationIndex } from "$lib/state/types";
  import type { CaseFileSection } from "$lib/case-file/types";
  import AcquisitionPopup from "$lib/components/AcquisitionPopup.svelte";
  import AnalysisWorkbench from "$lib/components/analysis/AnalysisWorkbench.svelte";
  import DialogueBox from "$lib/components/DialogueBox.svelte";
  import ExploreView from "$lib/components/ExploreView.svelte";
  import PrimaryObjectiveHud from "$lib/components/PrimaryObjectiveHud.svelte";
  import SceneBackdrop from "$lib/components/SceneBackdrop.svelte";
  import SceneNavigationPanel from "$lib/components/SceneNavigationPanel.svelte";
  import GameShell from "$lib/components/GameShell.svelte";
  import CaseFilePanel from "$lib/components/case-file/CaseFilePanel.svelte";
  import ErrorBanner from "$lib/components/ErrorBanner.svelte";
  import GameComplete from "$lib/components/GameComplete.svelte";
  import GameplayAudio from "$lib/components/GameplayAudio.svelte";
  import InterrogationStage from "$lib/components/InterrogationStage.svelte";
  import InterrogationView from "$lib/components/InterrogationView.svelte";
  import MainMenu from "$lib/components/MainMenu.svelte";
  import SaveBrowser from "$lib/components/SaveBrowser.svelte";
  import SaveNameDialog, {
    type SaveNameSubmission,
  } from "$lib/components/SaveNameDialog.svelte";
  import SaveConfirmationDialog from "$lib/components/SaveConfirmationDialog.svelte";
  import {
    asGameError,
    cancelPersistenceFailure,
    invokePersistenceCommand,
  } from "$lib/persistence/commands";
  import { persistenceStore } from "$lib/persistence/persistence-store.svelte";
  import {
    createSaveBrowserController,
    type SaveBrowserController,
    type SaveBrowserMode,
  } from "$lib/persistence/save-browser-controller.svelte";
  import type {
    ExitStatusView,
    GameError,
    ManualSaveResultView,
    OccupiedSlotExpectationView,
    SaveBrowserOpenResultView,
    SaveSlotRef,
    SaveSlotView,
    SaveSummaryView,
    ThumbnailCaptureRequestView,
  } from "$lib/persistence/types";
  import PackagedCaptureProofProbe from "$lib/test-harnesses/PackagedCaptureProofProbe.svelte";
  import { playGameplaySfxEvent } from "$lib/audio/gameplay-audio-runtime.svelte";
  import {
    forceNextPackagedCaptureUnavailable,
    packagedCaptureProofStatus,
    packagedCaptureUnavailableReason,
  } from "$lib/persistence/thumbnail-capture";
  import { acquisitionController } from "$lib/state/acquisition-controller.svelte";
  import {
    E2E_CHECKPOINT_APPLIED_EVENT,
    type E2eCheckpointProjection,
  } from "$lib/e2e/checkpoints";
  import { onDestroy, onMount, tick, untrack } from "svelte";

  async function handleExit() {
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      await getCurrentWindow().close();
    } catch (e) {
      console.warn("Window close unavailable in this runtime:", e);
    }
  }

  // The Case File mounts only while its submenu is open, so retain the
  // selected section here across ordinary menu close/reopen. A new gameplay
  // session starts from the objective section instead of inheriting the prior
  // session's context.
  let caseFileSection = $state<CaseFileSection>("objective");
  let caseFileRequestId = $state(0);
  let caseFileRequest = $state<{
    id: number;
    returnFocusTo: HTMLElement | null;
  } | null>(null);
  let gameMenuRequestId = $state(0);
  let gameMenuRequest = $state<{
    id: number;
    returnFocusTo: HTMLElement | null;
  } | null>(null);
  let observedCaseFileEpoch = presentationState.sessionEpoch;

  $effect(() => {
    const epoch = presentationState.sessionEpoch;
    if (epoch !== observedCaseFileEpoch) {
      observedCaseFileEpoch = epoch;
      caseFileSection = "objective";
      caseFileRequest = null;
      gameMenuRequest = null;
    }
  });
  // Bound to GameShell so dossier reexamine can close the Escape menu
  // programmatically (see handleReexamine*).
  let gameMenuOpen = $state(false);
  let storyClearedOnce = $state(loadStoryClearedOnce());

  if (import.meta.env.VITE_E2E) {
    onMount(() => {
      const applyCheckpointProjection = (event: Event) => {
        const projection = (event as CustomEvent<E2eCheckpointProjection>)
          .detail;
        storyClearedOnce = projection.sceneNavigationEligible;
        if (projection.sceneNavigationEligible) saveStoryClearedOnce();
      };
      window.addEventListener(
        E2E_CHECKPOINT_APPLIED_EVENT,
        applyCheckpointProjection,
      );
      return () => {
        window.removeEventListener(
          E2E_CHECKPOINT_APPLIED_EVENT,
          applyCheckpointProjection,
        );
      };
    });
  }
  let sceneNavigationIndex = $state<SceneNavigationIndex | null>(null);
  let sceneNavigationLoading = $state(false);
  let sceneNavigationRequested = $state(false);
  let sceneNavigationError = $state(false);
  // Monotonic generation counter for scene-nav loads. Captured at the start
  // of each loadSceneNavigationIndex call and checked after the await: if a
  // close-case / retry bumped the gen while this load was in flight, the
  // result is stale and must NOT touch the latches — otherwise a late
  // failure from a closed session could re-set sceneNavigationError after
  // handleCloseCase already cleared it, and the title-screen reset effect
  // (which only reruns on gameState.value changes) wouldn't fire again to
  // clear it, leaving the next session's Scene Select stuck.
  let sceneNavigationLoadGen = $state(0);
  let sceneNavigationEnabled = $derived(
    import.meta.env.DEV || storyClearedOnce,
  );
  let activePrimaryObjective = $derived(
    gameState.value?.story.objectives.find(
      (objective) => objective.activePrimary && !objective.completed,
    ) ?? null,
  );
  let interrogationPresentationActive = $derived(
    gameState.value !== null &&
      isInterrogationPresentationActive(
        gameState.value.scene,
        gameState.value.mode,
      ),
  );
  let interrogationPresentationPhase = $derived(
    gameState.value ? currentInterrogationPhase(gameState.value.scene) : null,
  );
  let acquisitionReturnFocus = $state<HTMLElement | null>(null);
  let acquisitionWasBlocking = false;
  // Element that had focus before a recovery dialog appeared; restored on
  // dismissal. Mirrors the acquisitionReturnFocus capture/restore pattern.
  let recoveryReturnFocus = $state<HTMLElement | null>(null);
  let gameplayRoot: HTMLDivElement | null = $state(null);
  let titleDiscovery = $state<SaveBrowserOpenResultView | null>(null);
  let titleBrowserOpen = $state(false);
  let titleBrowserController = $state<SaveBrowserController | null>(null);
  let titleDeleteSlot = $state<SaveSlotView | null>(null);
  let titleLoadFailure = $state<GameError | null>(null);
  let continueFailure = $state<GameError | null>(null);
  let newGameFailure = $state<GameError | null>(null);
  let confirmingNewGameWithoutSaving = $state(false);
  let persistenceStoreCleanup: (() => Promise<void>) | null = null;
  let gameBrowserMode = $state<Extract<
    SaveBrowserMode,
    "gameLoad" | "manualSave"
  > | null>(null);
  let gameBrowserSnapshot = $state<SaveBrowserOpenResultView | null>(null);
  let gameBrowserController = $state<SaveBrowserController | null>(null);
  let gameBrowserLoading = $state(false);
  let gameBrowserRequestGeneration = 0;
  let gameBrowserPreflightFailure = $state<{
    mode: Extract<SaveBrowserMode, "gameLoad" | "manualSave">;
    result: SaveBrowserOpenResultView;
  } | null>(null);
  let confirmingDiscardedProgressLoad = $state(false);
  let gameLoadDiscardFailureToken = $state<string | null>(null);
  let selectedSaveSlot = $state<SaveSlotView | null>(null);
  let pendingLoadSlot = $state<SaveSlotView | null>(null);
  let pendingDeleteSlot = $state<SaveSlotView | null>(null);
  let pendingManualSubmission = $state<SaveNameSubmission | null>(null);
  let manualSaveFailure = $state<GameError | null>(null);
  let deleteFailure = $state<GameError | null>(null);
  let loadFailure = $state<{
    diagnostic: GameError;
    slot: SaveSlotView;
    observedSaveId: string;
  } | null>(null);
  let confirmingLoadWithoutSaving = $state(false);
  let returnToTitleFailure = $state<GameError | null>(null);
  let confirmingReturnWithoutSaving = $state(false);
  let confirmingExitWithoutSaving = $state(false);
  let persistenceCancellationFailure = $state<{
    failureToken: string;
    diagnostic: GameError;
  } | null>(null);
  let persistenceCancellationInFlight = $state(false);
  let persistenceLayerOpen = $derived(
    gameBrowserLoading ||
      gameBrowserController !== null ||
      gameBrowserPreflightFailure !== null ||
      manualSaveFailure !== null ||
      loadFailure !== null ||
      returnToTitleFailure !== null ||
      persistenceStore.exitStatus.type === "saving" ||
      persistenceStore.exitStatus.type === "failed",
  );
  let gameplayInteractionBlocked = $derived(
    acquisitionController.blocking ||
      persistenceLayerOpen ||
      persistenceStore.exitStatus.type === "saving" ||
      persistenceStore.exitStatus.type === "failed",
  );
  let exitFailureToken = $derived(
    persistenceStore.exitStatus.type === "failed"
      ? persistenceStore.exitStatus.failureToken
      : null,
  );
  let currentSaveSummary = $derived.by<SaveSummaryView | null>(() => {
    const state = gameState.value;
    if (!state) return null;
    const activePrimaryObjective = state.story.objectives.find(
      (objective) => objective.activePrimary,
    );
    return {
      chapterId: state.chapter.id,
      chapterTitle: state.chapter.title,
      chapterSummary: state.chapter.summary,
      sceneId: state.scene.id,
      sceneTitle: state.scene.title,
      sceneSummary: state.scene.summary,
      activePrimaryObjectiveId: activePrimaryObjective?.id ?? null,
      activePrimaryObjectiveLabel: activePrimaryObjective?.label ?? null,
      activePrimaryObjectiveSummary: activePrimaryObjective?.summary ?? null,
    };
  });

  function unavailableTitleDiscovery(
    diagnostic: GameError,
  ): SaveBrowserOpenResultView {
    return {
      browser: {
        discovery: { type: "unavailable", diagnostic },
        slots: [],
      },
      continueCandidate: null,
      preflight: { type: "ready" },
    };
  }

  async function refreshTitleDiscovery(): Promise<SaveBrowserOpenResultView> {
    titleDiscovery = null;
    try {
      titleDiscovery =
        await invokePersistenceCommand<SaveBrowserOpenResultView>("list_saves");
    } catch (error) {
      titleDiscovery = unavailableTitleDiscovery(asGameError(error));
    }
    return titleDiscovery;
  }

  function closeTitleBrowser(): void {
    titleBrowserOpen = false;
    titleBrowserController = null;
    titleDeleteSlot = null;
    deleteFailure = null;
  }

  function openTitleBrowser(snapshot: SaveBrowserOpenResultView): void {
    titleDiscovery = snapshot;
    titleBrowserOpen = true;
    titleDeleteSlot = null;
    deleteFailure = null;
    titleBrowserController = createSaveBrowserController({
      mode: "titleLoad",
      continueCandidate: snapshot.continueCandidate,
      returnFocusTo: () =>
        document.querySelector<HTMLElement>('[aria-label="載入遊戲"]'),
      onClose: closeTitleBrowser,
    });
    if (snapshot.continueCandidate) {
      titleBrowserController.select(snapshot.continueCandidate);
    }
  }

  function handleTitleBrowserSelect(slot: SaveSlotView): void {
    titleBrowserController?.select(slot.reference);
  }

  function handleTitleBrowserDelete(
    slot: SaveSlotView,
    opener: HTMLElement,
  ): void {
    const controller = titleBrowserController;
    if (!controller || slot.status.type === "empty") return;
    controller.select(slot.reference);
    titleDeleteSlot = slot;
    deleteFailure = null;
    controller.openConfirmation(
      () => opener,
      () =>
        document.querySelector<HTMLElement>(
          '[role="dialog"][aria-labelledby="save-confirmation-title"] button:not(:disabled):last-child',
        ),
    );
  }

  async function performTitleDelete(
    expectation: OccupiedSlotExpectationView,
  ): Promise<void> {
    if (gameState.inFlight) return;
    const slot = titleDeleteSlot;
    if (!slot) return;
    gameState.inFlight = true;
    deleteFailure = null;
    try {
      const refreshed =
        await invokePersistenceCommand<SaveBrowserOpenResultView>(
          "delete_save",
          {
            reference: slot.reference,
            expectation,
          },
        );
      titleDeleteSlot = null;
      openTitleBrowser(refreshed);
    } catch (error) {
      deleteFailure = asGameError(error);
    } finally {
      gameState.inFlight = false;
    }
  }

  function cancelTitleDelete(): void {
    titleDeleteSlot = null;
    deleteFailure = null;
    titleBrowserController?.back();
  }

  async function handleContinue(): Promise<void> {
    continueFailure = null;
    try {
      await continuePersistedGame();
    } catch (error) {
      continueFailure = asGameError(error);
    }
  }

  async function cancelPersistenceChallenge(
    failureToken: string | undefined | null,
    onCancelled: () => void,
  ): Promise<boolean> {
    if (persistenceCancellationInFlight) return false;
    persistenceCancellationFailure = null;
    if (!failureToken) {
      onCancelled();
      return true;
    }
    persistenceCancellationInFlight = true;
    try {
      await cancelPersistenceFailure(failureToken);
      onCancelled();
      return true;
    } catch (error) {
      persistenceCancellationFailure = {
        failureToken,
        diagnostic: asGameError(error),
      };
      return false;
    } finally {
      persistenceCancellationInFlight = false;
    }
  }

  function persistenceCancellationMessage(
    failureToken: string | undefined | null,
  ): string | null {
    return failureToken &&
      persistenceCancellationFailure?.failureToken === failureToken
      ? persistenceCancellationFailure.diagnostic.message
      : null;
  }

  function cancelNewGameFailure(): void {
    void cancelPersistenceChallenge(newGameFailure?.failureToken, () => {
      newGameFailure = null;
      confirmingNewGameWithoutSaving = false;
      restoreRecoveryFocus();
    });
  }

  function cancelTitleLoadFailure(): void {
    void cancelPersistenceChallenge(titleLoadFailure?.failureToken, () => {
      titleLoadFailure = null;
      restoreRecoveryFocus();
    });
  }

  function cancelContinueFailure(): void {
    void cancelPersistenceChallenge(continueFailure?.failureToken, () => {
      continueFailure = null;
      restoreRecoveryFocus();
    });
  }

  // Restore focus to the element that had focus before a recovery dialog
  // appeared. Mirrors the acquisition popup's returnFocusTo restore.
  function restoreRecoveryFocus(): void {
    const target = recoveryReturnFocus;
    recoveryReturnFocus = null;
    if (target) {
      void tick().then(() => target.focus());
    }
  }

  async function openFreshLoadAfterContinueFailure(): Promise<void> {
    const refreshed = await refreshTitleDiscovery();
    continueFailure = null;
    openTitleBrowser(refreshed);
  }

  async function handleTitleLoad(slot: SaveSlotView): Promise<void> {
    if (gameState.inFlight) return;
    if (slot.status.type !== "valid") return;
    titleLoadFailure = null;
    try {
      await loadPersistedGame(slot.reference, slot.status.metadata.saveId);
      closeTitleBrowser();
      await tick();
      const activeControl =
        document.querySelector<HTMLElement>('[aria-label="推進對話"]') ??
        document.querySelector<HTMLElement>(
          "[data-gameplay-root] button:not(:disabled)",
        ) ??
        gameplayRoot;
      activeControl?.focus();
    } catch (error) {
      titleLoadFailure = asGameError(error);
    }
  }

  function gameMenuActionLocator(
    mode: Extract<SaveBrowserMode, "gameLoad" | "manualSave">,
  ): () => HTMLElement | null {
    const target = mode === "manualSave" ? "save-game" : "load-game";
    return () =>
      document.querySelector<HTMLElement>(`[data-focus-target="${target}"]`);
  }

  function closeGameBrowser(): void {
    gameLoadDiscardFailureToken = null;
    gameBrowserController = null;
    gameBrowserSnapshot = null;
    gameBrowserMode = null;
    selectedSaveSlot = null;
    pendingLoadSlot = null;
    pendingDeleteSlot = null;
    pendingManualSubmission = null;
    deleteFailure = null;
  }

  function handleGameBrowserBack(): void {
    const controller = gameBrowserController;
    if (!controller) return;
    if (controller.layer !== "browser") {
      if (pendingDeleteSlot) {
        pendingDeleteSlot = null;
        deleteFailure = null;
      }
      controller.back();
      return;
    }
    const failureToken = gameLoadDiscardFailureToken;
    if (!failureToken) {
      controller.close();
      return;
    }
    void cancelPersistenceChallenge(failureToken, () => {
      gameLoadDiscardFailureToken = null;
      controller.close();
    });
  }

  function installGameBrowser(
    mode: Extract<SaveBrowserMode, "gameLoad" | "manualSave">,
    result: SaveBrowserOpenResultView,
  ): void {
    gameBrowserMode = mode;
    gameBrowserSnapshot = result;
    gameBrowserPreflightFailure = null;
    selectedSaveSlot = null;
    pendingLoadSlot = null;
    pendingDeleteSlot = null;
    pendingManualSubmission = null;
    deleteFailure = null;
    gameBrowserController = createSaveBrowserController({
      mode,
      continueCandidate: result.continueCandidate,
      returnFocusTo: gameMenuActionLocator(mode),
      onClose: closeGameBrowser,
    });
  }

  async function openGameBrowser(
    mode: Extract<SaveBrowserMode, "gameLoad" | "manualSave">,
  ): Promise<void> {
    const staleDiscardToken = gameLoadDiscardFailureToken;
    if (staleDiscardToken) {
      const cancelled = await cancelPersistenceChallenge(
        staleDiscardToken,
        () => {
          gameLoadDiscardFailureToken = null;
        },
      );
      if (!cancelled) return;
    }
    const generation = ++gameBrowserRequestGeneration;
    gameBrowserLoading = true;
    gameBrowserPreflightFailure = null;
    try {
      const result =
        await invokePersistenceCommand<SaveBrowserOpenResultView>("list_saves");
      if (generation !== gameBrowserRequestGeneration) return;
      if (result.preflight.type === "flushFailed") {
        confirmingDiscardedProgressLoad = false;
        gameBrowserPreflightFailure = { mode, result };
        return;
      }
      installGameBrowser(mode, result);
    } catch (error) {
      if (generation !== gameBrowserRequestGeneration) return;
      const diagnostic = asGameError(error);
      gameBrowserPreflightFailure = {
        mode,
        result: unavailableTitleDiscovery(diagnostic),
      };
    } finally {
      if (generation === gameBrowserRequestGeneration) {
        gameBrowserLoading = false;
      }
    }
  }

  function closeGamePersistenceLayer(): void {
    if (gameState.inFlight) return;
    if (persistenceStore.exitStatus.type === "saving") return;
    if (persistenceStore.exitStatus.type === "failed") {
      if (confirmingExitWithoutSaving) {
        confirmingExitWithoutSaving = false;
      } else {
        void updateExitStatus(
          "cancel_exit",
          persistenceStore.exitStatus.failureToken,
        );
        restoreRecoveryFocus();
      }
      return;
    }
    if (manualSaveFailure) {
      manualSaveFailure = null;
      restoreRecoveryFocus();
      return;
    }
    if (returnToTitleFailure) {
      if (confirmingReturnWithoutSaving) {
        confirmingReturnWithoutSaving = false;
        return;
      }
      const failureToken = returnToTitleFailure.failureToken;
      void cancelPersistenceChallenge(failureToken, () => {
        returnToTitleFailure = null;
        void tick().then(() => {
          document
            .querySelector<HTMLElement>('[data-focus-target="return-to-title"]')
            ?.focus();
        });
      });
      return;
    }
    if (loadFailure) {
      if (confirmingLoadWithoutSaving) {
        confirmingLoadWithoutSaving = false;
        return;
      }
      const failureToken = loadFailure.diagnostic.failureToken;
      void cancelPersistenceChallenge(failureToken, () => {
        if (gameLoadDiscardFailureToken === failureToken) {
          gameLoadDiscardFailureToken = null;
        }
        loadFailure = null;
        // `back()` restores focus to the browser layer; the recovery dialog's
        // return-focus target would point at the browser's slot button, which
        // `back()` already handles.
        gameBrowserController?.back();
      });
      return;
    }
    if (gameBrowserPreflightFailure) {
      if (confirmingDiscardedProgressLoad) {
        confirmingDiscardedProgressLoad = false;
        return;
      }
      const mode = gameBrowserPreflightFailure.mode;
      const preflight = gameBrowserPreflightFailure.result.preflight;
      const failureToken =
        preflight.type === "flushFailed" ? preflight.failureToken : null;
      void cancelPersistenceChallenge(failureToken, () => {
        gameBrowserPreflightFailure = null;
        void tick().then(() => gameMenuActionLocator(mode)()?.focus());
      });
      return;
    }
    if (gameBrowserController) {
      handleGameBrowserBack();
    }
  }

  function openLoadBrowserDiscardingCurrent(): void {
    const pending = gameBrowserPreflightFailure;
    if (
      !pending ||
      pending.mode !== "gameLoad" ||
      pending.result.preflight.type !== "flushFailed"
    ) {
      return;
    }
    gameLoadDiscardFailureToken = pending.result.preflight.failureToken;
    confirmingDiscardedProgressLoad = false;
    installGameBrowser("gameLoad", pending.result);
  }

  function slotActionLocator(
    reference: SaveSlotRef,
    action: "select" | "load" | "delete",
  ): () => HTMLElement | null {
    return () =>
      document.querySelector<HTMLElement>(
        `[data-slot-type="${reference.type}"][data-slot-number="${reference.slot}"] .${action}`,
      );
  }

  function nameSubmitLocator(): HTMLElement | null {
    return document.querySelector<HTMLElement>(
      '[role="dialog"][aria-labelledby="save-name-title"] button[type="submit"]',
    );
  }

  function handleSaveBrowserSelect(slot: SaveSlotView): void {
    const controller = gameBrowserController;
    if (!controller) return;
    controller.select(slot.reference);
    selectedSaveSlot = slot;
    pendingLoadSlot = null;
    pendingDeleteSlot = null;
    deleteFailure = null;
    if (controller.mode === "manualSave") {
      controller.openName(slotActionLocator(slot.reference, "select"), () =>
        document.querySelector<HTMLElement>("#manual-save-name"),
      );
    }
  }

  function handleSaveBrowserLoad(slot: SaveSlotView): void {
    if (slot.status.type !== "valid" || !gameBrowserController) return;
    gameBrowserController.select(slot.reference);
    selectedSaveSlot = slot;
    pendingLoadSlot = slot;
    pendingDeleteSlot = null;
    deleteFailure = null;
    gameBrowserController.openConfirmation(
      slotActionLocator(slot.reference, "load"),
      () =>
        document.querySelector<HTMLElement>(
          '[role="dialog"][aria-labelledby="save-confirmation-title"] button:not(:disabled):last-child',
        ),
    );
  }

  function handleSaveBrowserDelete(
    slot: SaveSlotView,
    opener: HTMLElement,
  ): void {
    const controller = gameBrowserController;
    if (!controller || slot.status.type === "empty") return;
    controller.select(slot.reference);
    selectedSaveSlot = slot;
    pendingDeleteSlot = slot;
    deleteFailure = null;
    controller.openConfirmation(
      () => opener,
      () =>
        document.querySelector<HTMLElement>(
          '[role="dialog"][aria-labelledby="save-confirmation-title"] button:not(:disabled):last-child',
        ),
    );
  }

  async function performGameDelete(
    expectation: OccupiedSlotExpectationView,
  ): Promise<void> {
    if (gameState.inFlight) return;
    const slot = pendingDeleteSlot;
    const mode = gameBrowserMode;
    if (!slot || !mode) return;
    gameState.inFlight = true;
    deleteFailure = null;
    try {
      const refreshed =
        await invokePersistenceCommand<SaveBrowserOpenResultView>(
          "delete_save",
          {
            reference: slot.reference,
            expectation,
          },
        );
      pendingDeleteSlot = null;
      installGameBrowser(mode, refreshed);
    } catch (error) {
      deleteFailure = asGameError(error);
    } finally {
      gameState.inFlight = false;
    }
  }

  function cancelGameDelete(): void {
    pendingDeleteSlot = null;
    deleteFailure = null;
    gameBrowserController?.back();
  }

  async function performManualSave(
    submission: SaveNameSubmission,
  ): Promise<void> {
    if (gameState.inFlight) return;
    const slot = selectedSaveSlot;
    if (!slot || slot.reference.type !== "manual") return;
    gameState.inFlight = true;
    manualSaveFailure = null;
    // After a manual save, focus must return to the right place depending on
    // what is still mounted. The Present tray (an aria-modal dialog) stays
    // mounted across a save when crossExam.presenting is true, so focusing
    // gameplayRoot would land outside that modal — focus the tray's
    // 遊戲選單 button (the trigger that opened the menu) instead. In every
    // other interrogation state (question screen, live testimony dialogue)
    // no modal remains, so gameplayRoot is correct.
    //
    // interrogationPresentationActive is broader than Present: it is also
    // true for the interrogation question screen and live cross-exam
    // dialogue, while [data-interrogation-game-menu] only exists when
    // crossExam.presenting === true. Query the element itself rather than
    // branching on the flag so all three cases are handled by one check.
    //
    // The Present-tray button receives disabled={gameState.inFlight} via
    // InterrogationStage → InterrogationEvidenceTray, so it cannot receive
    // focus until inFlight clears. Clear inFlight in finally, then restore
    // focus afterward so the target is enabled.
    let succeeded = false;
    try {
      const request =
        await invokePersistenceCommand<ThumbnailCaptureRequestView>(
          "prepare_save_thumbnail",
          { purpose: { type: "manualSave" } },
        );
      await settlePreparedThumbnailCapture(request);
      const result = await invokePersistenceCommand<ManualSaveResultView>(
        "save_manual",
        {
          reference: slot.reference,
          displayName: submission.displayName,
          expectation: submission.expectation,
          preparedThumbnailTicket: request.ticket,
        },
      );
      persistenceStore.replaceThumbnailActivity(result.thumbnailActivity);
      closeGameBrowser();
      gameMenuOpen = false;
      succeeded = true;
    } catch (error) {
      manualSaveFailure = asGameError(error);
    } finally {
      gameState.inFlight = false;
    }
    // On failure, manualSaveFailure mounts the aria-modal recovery dialog and
    // the recovery-focus $effect owns moving focus to its [data-recovery-focus]
    // action. Running the normal post-save focus restore here would race with
    // that effect and can leave focus behind the failure modal, so only restore
    // focus after a successful save.
    if (!succeeded) return;
    await tick();
    const presentTrigger = document.querySelector<HTMLElement>(
      "[data-interrogation-game-menu]",
    );
    if (presentTrigger) {
      presentTrigger.focus();
    } else {
      gameplayRoot?.focus();
    }
  }

  function handleManualNameSubmission(submission: SaveNameSubmission): void {
    if (gameState.inFlight) return;
    pendingManualSubmission = submission;
    if (submission.expectation.type === "occupied") {
      gameBrowserController?.openConfirmation(nameSubmitLocator, () =>
        document.querySelector<HTMLElement>(
          '[role="dialog"][aria-labelledby="save-confirmation-title"] button:not(:disabled):last-child',
        ),
      );
      return;
    }
    void performManualSave(submission);
  }

  async function performLoad(
    slot: SaveSlotView,
    observedSaveId: string,
    failureToken: string | null = gameLoadDiscardFailureToken,
  ): Promise<void> {
    if (gameState.inFlight) return;
    loadFailure = null;
    confirmingLoadWithoutSaving = false;
    try {
      if (failureToken) {
        await loadPersistedGameDiscardingCurrent(
          slot.reference,
          observedSaveId,
          failureToken,
        );
      } else {
        await loadPersistedGame(slot.reference, observedSaveId);
      }
      gameLoadDiscardFailureToken = null;
      closeGameBrowser();
      gameMenuOpen = false;
      acquisitionController.clear();
      await tick();
      const activeControl =
        document.querySelector<HTMLElement>('[aria-label="推進對話"]') ??
        document.querySelector<HTMLElement>(
          "[data-gameplay-root] button:not(:disabled)",
        ) ??
        gameplayRoot;
      activeControl?.focus();
    } catch (error) {
      const diagnostic = asGameError(error);
      if (failureToken) {
        gameLoadDiscardFailureToken = diagnostic.failureToken ?? null;
      }
      loadFailure = {
        diagnostic,
        slot,
        observedSaveId,
      };
    }
  }

  async function handleStartGame(): Promise<void> {
    newGameFailure = null;
    confirmingNewGameWithoutSaving = false;
    try {
      await startPersistedGame();
    } catch (error) {
      newGameFailure = asGameError(error);
    }
  }

  async function handleStartGameWithoutSaving(): Promise<void> {
    const failureToken = newGameFailure?.failureToken;
    if (!failureToken) return;
    try {
      await startGameWithoutSaving(failureToken);
      newGameFailure = null;
      confirmingNewGameWithoutSaving = false;
    } catch (error) {
      newGameFailure = asGameError(error);
      confirmingNewGameWithoutSaving = false;
    }
  }

  async function finishReturnToTitle(
    snapshot: SaveBrowserOpenResultView,
  ): Promise<void> {
    sceneNavigationError = false;
    sceneNavigationRequested = false;
    sceneNavigationLoading = false;
    sceneNavigationLoadGen += 1;
    gameBrowserRequestGeneration += 1;
    gameBrowserLoading = false;
    gameBrowserPreflightFailure = null;
    gameLoadDiscardFailureToken = null;
    loadFailure = null;
    manualSaveFailure = null;
    returnToTitleFailure = null;
    confirmingReturnWithoutSaving = false;
    confirmingLoadWithoutSaving = false;
    confirmingDiscardedProgressLoad = false;
    closeGameBrowser();
    closeTitleBrowser();
    gameMenuOpen = false;
    acquisitionController.clear();
    titleDiscovery = snapshot;
    resetFrontendForTitle();
    await tick();
    const focusTarget =
      document.querySelector<HTMLElement>(
        '[aria-label="繼續遊戲"]:not(:disabled)',
      ) ?? document.querySelector<HTMLElement>('[aria-label="開始新遊戲"]');
    focusTarget?.focus();
  }

  async function handleReturnToTitle(
    failureToken: string | null = null,
  ): Promise<void> {
    returnToTitleFailure = null;
    confirmingReturnWithoutSaving = false;
    try {
      const snapshot = failureToken
        ? await returnPersistedToTitleWithoutSaving(failureToken)
        : await returnPersistedToTitle();
      await finishReturnToTitle(snapshot);
    } catch (error) {
      returnToTitleFailure = asGameError(error);
    }
  }

  async function updateExitStatus(
    command: "retry_exit" | "cancel_exit",
    failureToken: string,
  ): Promise<void> {
    try {
      const status = await invokePersistenceCommand<ExitStatusView>(command, {
        failureToken,
      });
      persistenceStore.replaceExitStatus(status);
      confirmingExitWithoutSaving = false;
    } catch (error) {
      console.warn(`[Persistence] ${command} failed`, asGameError(error));
    }
  }

  async function exitWithoutSaving(failureToken: string): Promise<void> {
    try {
      await invokePersistenceCommand<void>("exit_without_saving", {
        failureToken,
      });
    } catch (error) {
      console.warn(
        "[Persistence] exit_without_saving failed",
        asGameError(error),
      );
      confirmingExitWithoutSaving = false;
    }
  }

  function handleTitleWindowKeydown(event: KeyboardEvent): void {
    if (gameState.value !== null || event.key !== "Escape" || event.repeat) {
      return;
    }
    if (gameState.inFlight) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      return;
    }
    if (newGameFailure) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      if (confirmingNewGameWithoutSaving) {
        confirmingNewGameWithoutSaving = false;
      } else {
        cancelNewGameFailure();
      }
      return;
    }
    if (titleLoadFailure) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      cancelTitleLoadFailure();
      return;
    }
    if (continueFailure) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      cancelContinueFailure();
      return;
    }
    if (!titleBrowserController) return;
    if (titleDeleteSlot && event.key === "Escape" && !event.repeat) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      cancelTitleDelete();
      return;
    }
    if (titleBrowserController.handleKeydown(event))
      event.stopImmediatePropagation();
  }

  onMount(() => {
    let active = true;
    window.addEventListener("keydown", handleTitleWindowKeydown, {
      capture: true,
    });
    void persistenceStore
      .start()
      .then((cleanup) => {
        if (active) {
          persistenceStoreCleanup = cleanup;
        } else {
          void cleanup();
        }
      })
      .catch((error) => {
        console.warn("[Persistence] Status store unavailable", error);
      });
    if (gameState.value === null) void refreshTitleDiscovery();
    return () => {
      active = false;
      window.removeEventListener("keydown", handleTitleWindowKeydown, {
        capture: true,
      });
      void persistenceStoreCleanup?.();
      persistenceStoreCleanup = null;
    };
  });

  $effect.pre(() => {
    const blocking = acquisitionController.blocking;
    if (blocking && !acquisitionWasBlocking) {
      if (gameMenuOpen) {
        // The menu is open and will be unmounted below, so any element
        // inside it would be disconnected by the time the popup closes —
        // focus restoration would fall through to <body>. Redirect the
        // return-focus target to the gameplay root instead.
        acquisitionReturnFocus = gameplayRoot;
        gameMenuOpen = false;
      } else {
        const active = document.activeElement;
        acquisitionReturnFocus = active instanceof HTMLElement ? active : null;
      }
    }
    acquisitionWasBlocking = blocking;
  });

  onDestroy(() => {
    acquisitionController.clear();
  });

  async function handleAcquisitionContinue(eventId: string) {
    await acquisitionController.dismissCurrent(eventId);
  }

  $effect(() => {
    if (gameState.value?.mode.type === "gameComplete" && !storyClearedOnce) {
      storyClearedOnce = true;
      saveStoryClearedOnce();
    }
  });

  $effect(() => {
    // Returning to the title clears any stale scene-nav failure latch so a
    // fresh game session re-attempts the index load instead of inheriting the
    // previous session's error. The cached index (if any) is kept — scene
    // data is static across sessions, so a successful prior load need not be
    // re-fetched.
    if (gameState.value === null) {
      sceneNavigationError = false;
      sceneNavigationRequested = false;
    }
  });

  $effect(() => {
    if (
      sceneNavigationEnabled &&
      gameState.value &&
      !sceneNavigationIndex &&
      !sceneNavigationLoading &&
      !sceneNavigationRequested &&
      !sceneNavigationError
    ) {
      // Set the latch synchronously before any async work so a rapid second
      // $effect run (e.g. gameState.value changing) can't re-trigger the load.
      sceneNavigationRequested = true;
      void loadSceneNavigationIndex();
    }
  });

  // Move focus into a recovery dialog when one appears, and restore focus to
  // the triggering element on dismissal. Mirrors the acquisition popup's
  // capture/restore pattern (acquisitionReturnFocus) and the browser/name/
  // confirmation focus-controller behavior (tick().then(...focus())).
  $effect(() => {
    const open =
      manualSaveFailure !== null ||
      loadFailure !== null ||
      returnToTitleFailure !== null ||
      titleLoadFailure !== null ||
      continueFailure !== null ||
      newGameFailure !== null ||
      persistenceStore.exitStatus.type === "failed";
    // Also re-run when an in-dialog confirmation toggle changes the primary
    // action, so focus follows the newly rendered confirmation button.
    void confirmingLoadWithoutSaving;
    void confirmingReturnWithoutSaving;
    void confirmingNewGameWithoutSaving;
    void confirmingExitWithoutSaving;
    if (!open) {
      // No recovery dialog is visible. Clear any stale return-focus target
      // so we don't hold a detached DOM reference after a successful
      // recovery. Dismissal handlers already consume and null it via
      // restoreRecoveryFocus() before this effect re-runs.
      recoveryReturnFocus = null;
      return;
    }
    // Capture the element that had focus before the modal stole it. Skip if
    // focus is already inside a recovery dialog (e.g. confirmation toggle).
    const active = document.activeElement;
    if (
      active instanceof HTMLElement &&
      !active.closest(".recovery-dialog") &&
      active !== recoveryReturnFocus
    ) {
      recoveryReturnFocus = active;
    }
    void tick().then(() => {
      const primary = document.querySelector<HTMLElement>(
        ".recovery-dialog [data-recovery-focus]",
      );
      primary?.focus();
    });
  });

  async function loadSceneNavigationIndex() {
    // untrack: this function is called synchronously from the auto-load
    // $effect. Reading sceneNavigationLoadGen here without untrack would
    // register it as an effect dependency, and since handleCloseCase /
    // retrySceneNavigation bump the gen, the auto-load effect would re-fire
    // on every bump — an update loop. The gen is only used as a stale-load
    // guard, not as a reactive input.
    const gen = untrack(() => sceneNavigationLoadGen);
    sceneNavigationLoading = true;
    const index = await listScenes();
    // If a close-case / retry bumped the gen while this load was in
    // flight, drop the result — the superseding path owns the latches now.
    // Applying a stale failure here would re-set sceneNavigationError
    // after the reset already cleared it.
    if (gen !== sceneNavigationLoadGen) return;
    if (index) {
      sceneNavigationIndex = index;
      sceneNavigationError = false;
    } else {
      // listScenes returns null on failure and owns its own error surface
      // (it does NOT populate gameState.error). Do NOT clear
      // sceneNavigationRequested and let the $effect auto-retry — that would
      // loop on a persistent failure. Instead surface the failure via the
      // panel's own error state and let the user explicitly retry.
      sceneNavigationError = true;
    }
    sceneNavigationLoading = false;
  }

  function retrySceneNavigation() {
    // Drive the load directly rather than relying on the auto-load $effect.
    // Setting only the error/requested latches and letting the $effect re-fire
    // would render one frame with error=false, loading=false, index=null —
    // landing in the "no scenes" empty state before loading flips true.
    // loadSceneNavigationIndex sets loading=true synchronously as its first
    // statement, so calling it here avoids that flicker.
    sceneNavigationError = false;
    sceneNavigationRequested = true;
    // Supersede any in-flight load so its stale result doesn't clobber the
    // retry's outcome.
    sceneNavigationLoadGen += 1;
    void loadSceneNavigationIndex();
  }

  async function handleReset() {
    await resetGame();
    if (gameState.error) {
      return;
    }
    gameState.error = null;
  }

  // Reexamine from the dossier (inside the Escape menu) installs a dialogue
  // queue and flips the mode to dialogue. If the menu stayed mounted, its
  // scrim (z-index 40) would hide the dialogue (z-index 30, in <main inert>)
  // until the player manually resumed. Close the menu once the command
  // resolves so the mode→dialogue change and the menu close batch into one
  // render — no flash — and on error the menu still closes so the ErrorBanner
  // (rendered in <main>) is visible instead of trapped behind the scrim.
  async function handleReexamineEvidence(evidenceId: string) {
    await reexamineEvidence(evidenceId);
    gameMenuOpen = false;
  }
  async function handleReexamineStatement(statementId: string) {
    await reexamineStatement(statementId);
    gameMenuOpen = false;
  }

  async function handleJumpToScene(chapterId: string, sceneId: string) {
    await jumpToScene(chapterId, sceneId);
    gameMenuOpen = false;
  }

  function openInterrogationCaseFile(trigger: HTMLElement) {
    caseFileSection = "evidence";
    caseFileRequestId += 1;
    caseFileRequest = {
      id: caseFileRequestId,
      returnFocusTo: trigger,
    };
  }

  function openInterrogationGameMenu(trigger: HTMLElement) {
    gameMenuRequestId += 1;
    gameMenuRequest = {
      id: gameMenuRequestId,
      returnFocusTo: trigger,
    };
  }

  function handleGameMenuRequestHandled(id: number) {
    if (gameMenuRequest?.id !== id) return;
    gameMenuRequest = null;
  }

  function handleCaseFileRequestHandled(id: number) {
    if (caseFileRequest?.id !== id) return;
    caseFileRequest = null;
  }
</script>

{#if gameState.value}
  <div
    bind:this={gameplayRoot}
    data-gameplay-root=""
    data-save-thumbnail-root=""
    tabindex="-1"
  >
    {#key presentationState.sessionEpoch}
      <GameplayAudio mode={gameState.value.mode} />
      <GameShell
        gameState={gameState.value}
        onCloseCase={() => handleReturnToTitle()}
        onSaveGame={() => openGameBrowser("manualSave")}
        onLoadGame={() => openGameBrowser("gameLoad")}
        onReturnToTitle={() => handleReturnToTitle()}
        topLayerOpen={persistenceLayerOpen}
        gameplayInert={gameplayInteractionBlocked}
        onTopLayerEscape={closeGamePersistenceLayer}
        disabled={gameState.inFlight}
        sceneMenuEnabled={sceneNavigationEnabled}
        caseFileMenuEnabled={shouldShowCaseFile(gameState.value.mode)}
        {activePrimaryObjective}
        interrogationPresentation={interrogationPresentationActive}
        {gameMenuRequest}
        onGameMenuRequestHandled={handleGameMenuRequestHandled}
        {caseFileRequest}
        onCaseFileRequestHandled={handleCaseFileRequestHandled}
        bind:open={gameMenuOpen}
      >
        {#snippet sceneMenu()}
          <SceneNavigationPanel
            index={sceneNavigationIndex}
            current={gameState.value!}
            loading={sceneNavigationLoading}
            error={sceneNavigationError}
            disabled={gameState.inFlight}
            onSelect={handleJumpToScene}
            onRetry={retrySceneNavigation}
          />
        {/snippet}

        {#snippet menu()}
          {#if shouldShowCaseFile(gameState.value!.mode)}
            <CaseFilePanel
              state={gameState.value!}
              reexamineEnabled={canReexamineCaseRecords(gameState.value!.mode)}
              onReexamineEvidence={handleReexamineEvidence}
              onReexamineStatement={handleReexamineStatement}
              disabled={gameState.inFlight}
              bind:section={caseFileSection}
            />
          {/if}
        {/snippet}

        {#if gameState.error}
          <div data-save-thumbnail-exclude="">
            <ErrorBanner message={gameState.error} />
          </div>
        {/if}
        <InterrogationStage
          active={interrogationPresentationActive}
          scene={gameState.value.scene}
          mode={gameState.value.mode}
          inventory={gameState.value.inventory}
          onPresent={presentInterrogationEvidence}
          onResume={resumeInterrogationTestimony}
          onOpenGameMenu={openInterrogationGameMenu}
          onOpenCaseFile={openInterrogationCaseFile}
          disabled={gameState.inFlight}
          topLayerOpen={gameMenuOpen || gameplayInteractionBlocked}
        >
          {#if gameState.value.mode.type === "dialogue"}
            <SceneBackdrop
              sceneTag={gameState.value.mode.sceneTag}
              backgroundAssetId={gameState.value.mode.backgroundAssetId ?? null}
            />
            <DialogueBox
              current={gameState.value.mode.current}
              queueToken={gameState.value.mode.queueToken}
              onAdvance={advanceDialogue}
              onAdvanceFeedback={() => playGameplaySfxEvent("ui:menu-confirm")}
              history={gameState.value.dialogueHistory}
              disabled={gameState.inFlight}
              crossExam={gameState.value.mode.crossExamLineId
                ? {
                    lineId: gameState.value.mode.crossExamLineId,
                    onChallenge: challengeInterrogationLine,
                    onWithdraw: withdrawInterrogation,
                    presentation:
                      interrogationPresentationPhase?.crossExam ?? null,
                  }
                : null}
            />
          {:else if gameState.value.mode.type === "explore"}
            <ExploreView
              scene={gameState.value.scene}
              backgroundAssetId={gameState.value.mode.backgroundAssetId ?? null}
              onInspect={inspectHotspot}
              onInterview={interviewTopic}
              onEnterSublocation={enterSublocation}
              disabled={gameState.inFlight}
            >
              {#snippet hud()}
                <PrimaryObjectiveHud objective={activePrimaryObjective} />
              {/snippet}
            </ExploreView>
          {:else if gameState.value.mode.type === "interrogation"}
            <SceneBackdrop
              sceneTag={null}
              backgroundAssetId={gameState.value.mode.backgroundAssetId ?? null}
            />
            <InterrogationView
              scene={gameState.value.scene}
              onAsk={askInterrogationQuestion}
              onComplete={completeInterrogationPhase}
              disabled={gameState.inFlight}
            />
          {:else if gameState.value.mode.type === "analysis"}
            <SceneBackdrop
              sceneTag={null}
              backgroundAssetId={gameState.value.mode.backgroundAssetId ?? null}
            />
            <AnalysisWorkbench
              scene={gameState.value.scene}
              mode={gameState.value.mode}
              inventory={gameState.value.inventory}
              onSelectBoard={selectAnalysisBoard}
              onUpdateDraft={updateAnalysisDraft}
              onSubmit={submitAnalysisBoard}
              disabled={gameState.inFlight}
            />
          {:else if gameState.value.mode.type === "gameComplete"}
            <GameComplete onReset={handleReset} disabled={gameState.inFlight} />
          {/if}
        </InterrogationStage>
      </GameShell>
    {/key}
  </div>
  {#if import.meta.env.VITE_LYRA_E2E_CAPTURE_PROOF === "1"}
    <PackagedCaptureProofProbe
      onForceNextCaptureUnavailable={forceNextPackagedCaptureUnavailable}
      captureUnavailableReason={packagedCaptureUnavailableReason}
      captureStatus={packagedCaptureProofStatus}
      captureCommandInFlight={gameState.inFlight ||
        persistenceStore.persistenceStatus.type === "pending" ||
        persistenceStore.thumbnailActivity.type === "capturing"}
    />
  {/if}
  {#if gameBrowserLoading}
    <div class="persistence-overlay" data-save-thumbnail-exclude="">
      <p role="status">讀取存檔中…</p>
    </div>
  {:else if gameBrowserController && gameBrowserSnapshot && gameBrowserMode}
    <div class="persistence-overlay" data-save-thumbnail-exclude="">
      {#if gameBrowserController.layer === "browser"}
        <SaveBrowser
          view={gameBrowserSnapshot.browser}
          mode={gameBrowserMode}
          continueCandidate={gameBrowserSnapshot.continueCandidate}
          selected={gameBrowserController.selected}
          onSelect={handleSaveBrowserSelect}
          onLoad={handleSaveBrowserLoad}
          onDelete={handleSaveBrowserDelete}
          onBack={handleGameBrowserBack}
          onRetry={() => openGameBrowser(gameBrowserMode!)}
        />
        {#if persistenceCancellationMessage(gameLoadDiscardFailureToken)}
          <p role="alert">
            {persistenceCancellationMessage(gameLoadDiscardFailureToken)}
          </p>
        {/if}
      {:else if gameBrowserController.layer === "name" && selectedSaveSlot && currentSaveSummary}
        <SaveNameDialog
          slot={selectedSaveSlot}
          currentSummary={currentSaveSummary}
          pending={gameState.inFlight}
          onSubmit={handleManualNameSubmission}
          onCancel={gameBrowserController.back}
        />
      {:else if gameBrowserController.layer === "confirmation" && selectedSaveSlot}
        {#if pendingDeleteSlot}
          <SaveConfirmationDialog
            kind="delete"
            slot={pendingDeleteSlot}
            pending={gameState.inFlight}
            onCancel={cancelGameDelete}
            onConfirm={(request) => {
              if (request.type === "delete") {
                void performGameDelete(request.expectation);
              }
            }}
          />
        {:else if gameBrowserMode === "gameLoad" && pendingLoadSlot && pendingLoadSlot.status.type === "valid"}
          <SaveConfirmationDialog
            kind="load"
            slot={pendingLoadSlot}
            pending={gameState.inFlight}
            onCancel={gameBrowserController.back}
            onConfirm={(request) => {
              if (request.type === "load") {
                void performLoad(pendingLoadSlot!, request.observedSaveId);
              }
            }}
          />
        {:else if currentSaveSummary && pendingManualSubmission}
          <SaveConfirmationDialog
            kind="overwrite"
            slot={selectedSaveSlot}
            pending={gameState.inFlight}
            currentSummary={currentSaveSummary}
            pendingDisplayName={pendingManualSubmission.displayName}
            onCancel={gameBrowserController.back}
            onConfirm={() => performManualSave(pendingManualSubmission!)}
          />
        {/if}
        {#if deleteFailure}
          <p role="alert">{deleteFailure.message}</p>
        {/if}
      {/if}
    </div>
  {:else if gameBrowserPreflightFailure}
    <div class="recovery-backdrop" data-save-thumbnail-exclude="">
      <div
        class="recovery-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={confirmingDiscardedProgressLoad
          ? "確認捨棄未儲存進度並載入"
          : "無法開啟存檔"}
      >
        <h2>
          {confirmingDiscardedProgressLoad
            ? "確認捨棄未儲存進度並載入"
            : "無法開啟存檔"}
        </h2>
        <p>
          {confirmingDiscardedProgressLoad
            ? "目前未儲存的進度將被捨棄。"
            : gameBrowserPreflightFailure.result.preflight.type ===
                "flushFailed"
              ? gameBrowserPreflightFailure.result.preflight.diagnostic.message
              : gameBrowserPreflightFailure.result.browser.discovery.type ===
                  "unavailable"
                ? gameBrowserPreflightFailure.result.browser.discovery
                    .diagnostic.message
                : "無法讀取存檔。"}
        </p>
        {#if persistenceCancellationMessage(gameBrowserPreflightFailure.result.preflight.type === "flushFailed" ? gameBrowserPreflightFailure.result.preflight.failureToken : null)}
          <p role="alert">
            {persistenceCancellationMessage(
              gameBrowserPreflightFailure.result.preflight.type ===
                "flushFailed"
                ? gameBrowserPreflightFailure.result.preflight.failureToken
                : null,
            )}
          </p>
        {/if}
        <div class="recovery-actions">
          {#if confirmingDiscardedProgressLoad}
            <button
              type="button"
              onclick={() => {
                confirmingDiscardedProgressLoad = false;
              }}>取消</button
            >
            <button type="button" onclick={openLoadBrowserDiscardingCurrent}
              >捨棄未儲存進度並載入</button
            >
          {:else}
            <button type="button" onclick={closeGamePersistenceLayer}
              >取消</button
            >
            <button
              type="button"
              onclick={() => openGameBrowser(gameBrowserPreflightFailure!.mode)}
              >重試</button
            >
            {#if gameBrowserPreflightFailure.mode === "gameLoad" && gameBrowserPreflightFailure.result.preflight.type === "flushFailed"}
              <button
                type="button"
                onclick={() => {
                  confirmingDiscardedProgressLoad = true;
                }}>捨棄未儲存進度並載入</button
              >
            {/if}
          {/if}
        </div>
      </div>
    </div>
  {/if}
  {#if manualSaveFailure}
    <div class="recovery-backdrop" data-save-thumbnail-exclude="">
      <div
        class="recovery-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="儲存失敗"
      >
        <h2>儲存失敗</h2>
        <p>{manualSaveFailure.message}</p>
        <div class="recovery-actions">
          <button
            type="button"
            onclick={() => {
              manualSaveFailure = null;
            }}>取消</button
          >
          <button
            type="button"
            data-recovery-focus
            onclick={() => {
              if (pendingManualSubmission) {
                void performManualSave(pendingManualSubmission);
              }
            }}>重試</button
          >
        </div>
      </div>
    </div>
  {/if}
  {#if loadFailure}
    <div class="recovery-backdrop" data-save-thumbnail-exclude="">
      <div
        class="recovery-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={confirmingLoadWithoutSaving
          ? "確認捨棄未儲存進度並載入"
          : "載入失敗"}
      >
        <h2>
          {confirmingLoadWithoutSaving
            ? "確認捨棄未儲存進度並載入"
            : "載入失敗"}
        </h2>
        <p>
          {confirmingLoadWithoutSaving
            ? "目前未儲存的進度將被捨棄。"
            : loadFailure.diagnostic.message}
        </p>
        {#if persistenceCancellationMessage(loadFailure.diagnostic.failureToken)}
          <p role="alert">
            {persistenceCancellationMessage(
              loadFailure.diagnostic.failureToken,
            )}
          </p>
        {/if}
        {#if confirmingLoadWithoutSaving}
          <div class="recovery-actions">
            <button
              type="button"
              onclick={() => {
                confirmingLoadWithoutSaving = false;
              }}>取消</button
            >
            <button
              type="button"
              data-recovery-focus
              onclick={() => {
                const failure = loadFailure;
                const token = failure?.diagnostic.failureToken;
                if (failure && token) {
                  void performLoad(failure.slot, failure.observedSaveId, token);
                }
              }}>捨棄未儲存進度並載入</button
            >
          </div>
        {:else}
          <div class="recovery-actions">
            <button type="button" onclick={closeGamePersistenceLayer}
              >取消</button
            >
            <button
              type="button"
              data-recovery-focus
              onclick={() => {
                const failure = loadFailure;
                if (failure) {
                  void performLoad(failure.slot, failure.observedSaveId, null);
                }
              }}>重試</button
            >
            {#if loadFailure.diagnostic.failureToken}
              <button
                type="button"
                onclick={() => {
                  confirmingLoadWithoutSaving = true;
                }}>捨棄未儲存進度並載入</button
              >
            {/if}
          </div>
        {/if}
      </div>
    </div>
  {/if}
  {#if returnToTitleFailure}
    <div class="recovery-backdrop" data-save-thumbnail-exclude="">
      <div
        class="recovery-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={confirmingReturnWithoutSaving
          ? "確認不儲存並返回標題畫面"
          : "無法返回標題畫面"}
      >
        <h2>
          {confirmingReturnWithoutSaving
            ? "確認不儲存並返回標題畫面"
            : "無法返回標題畫面"}
        </h2>
        <p>
          {confirmingReturnWithoutSaving
            ? "目前未儲存的進度將被捨棄。"
            : returnToTitleFailure.message}
        </p>
        {#if persistenceCancellationMessage(returnToTitleFailure.failureToken)}
          <p role="alert">
            {persistenceCancellationMessage(returnToTitleFailure.failureToken)}
          </p>
        {/if}
        {#if confirmingReturnWithoutSaving}
          <div class="recovery-actions">
            <button
              type="button"
              onclick={() => {
                confirmingReturnWithoutSaving = false;
              }}>取消</button
            >
            <button
              type="button"
              data-recovery-focus
              onclick={() => {
                const token = returnToTitleFailure?.failureToken;
                if (token) void handleReturnToTitle(token);
              }}>不儲存並返回標題畫面</button
            >
          </div>
        {:else}
          <div class="recovery-actions">
            <button type="button" onclick={closeGamePersistenceLayer}
              >取消</button
            >
            <button
              type="button"
              data-recovery-focus
              onclick={() => handleReturnToTitle()}>重試</button
            >
            {#if returnToTitleFailure.failureToken}
              <button
                type="button"
                onclick={() => {
                  confirmingReturnWithoutSaving = true;
                }}>不儲存並返回標題畫面</button
              >
            {/if}
          </div>
        {/if}
      </div>
    </div>
  {/if}
  {#if acquisitionController.current}
    <AcquisitionPopup
      notification={acquisitionController.current}
      phase={acquisitionController.phase}
      returnFocusTo={acquisitionReturnFocus}
      fallbackFocusTarget={gameplayRoot}
      onContinue={handleAcquisitionContinue}
      onRetry={acquisitionController.retry}
      onCancel={acquisitionController.cancel}
      onContinueWithoutSaving={acquisitionController.continueWithoutSaving}
    />
  {/if}
{:else if gameState.loading}
  <main><p class="status">載入中...</p></main>
{:else}
  <MainMenu
    onNewGame={handleStartGame}
    onContinue={handleContinue}
    onLoad={() => {
      if (titleDiscovery) openTitleBrowser(titleDiscovery);
    }}
    onRetryDiscovery={refreshTitleDiscovery}
    onExit={handleExit}
    discovery={titleDiscovery}
    disabled={gameState.inFlight}
  />
  {#if titleBrowserOpen && titleDiscovery && titleBrowserController}
    <div class="persistence-overlay" data-save-thumbnail-exclude="">
      {#if titleBrowserController.layer === "browser"}
        <SaveBrowser
          view={titleDiscovery.browser}
          mode="titleLoad"
          continueCandidate={titleDiscovery.continueCandidate}
          selected={titleBrowserController.selected}
          onSelect={handleTitleBrowserSelect}
          onLoad={handleTitleLoad}
          onDelete={handleTitleBrowserDelete}
          onRetry={refreshTitleDiscovery}
          onBack={titleBrowserController.close}
        />
      {:else if titleBrowserController.layer === "confirmation" && titleDeleteSlot}
        <SaveConfirmationDialog
          kind="delete"
          slot={titleDeleteSlot}
          pending={gameState.inFlight}
          onCancel={cancelTitleDelete}
          onConfirm={(request) => {
            if (request.type === "delete") {
              void performTitleDelete(request.expectation);
            }
          }}
        />
        {#if deleteFailure}
          <p role="alert">{deleteFailure.message}</p>
        {/if}
      {/if}
    </div>
  {/if}
  {#if titleLoadFailure}
    <div class="recovery-backdrop" data-save-thumbnail-exclude="">
      <div
        class="recovery-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="載入失敗"
      >
        <h2>載入失敗</h2>
        <p>{titleLoadFailure.message}</p>
        {#if persistenceCancellationMessage(titleLoadFailure.failureToken)}
          <p role="alert">
            {persistenceCancellationMessage(titleLoadFailure.failureToken)}
          </p>
        {/if}
        <div class="recovery-actions">
          <button
            type="button"
            disabled={persistenceCancellationInFlight}
            onclick={cancelTitleLoadFailure}>取消</button
          >
          <button
            type="button"
            data-recovery-focus
            onclick={() => {
              const selected = titleBrowserController?.selected;
              const slot = titleDiscovery?.browser.slots.find(
                (candidate) =>
                  candidate.reference.type === selected?.type &&
                  candidate.reference.slot === selected.slot,
              );
              if (slot) void handleTitleLoad(slot);
            }}>重試</button
          >
        </div>
      </div>
    </div>
  {/if}
  {#if continueFailure}
    <div class="recovery-backdrop" data-save-thumbnail-exclude="">
      <div
        class="recovery-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="無法繼續遊戲"
      >
        <h2>無法繼續遊戲</h2>
        <p>{continueFailure.message}</p>
        <div class="recovery-actions">
          <button
            type="button"
            onclick={() => {
              continueFailure = null;
              restoreRecoveryFocus();
            }}>取消</button
          >
          <button type="button" data-recovery-focus onclick={handleContinue}
            >重試</button
          >
          <button type="button" onclick={openFreshLoadAfterContinueFailure}
            >載入遊戲</button
          >
        </div>
      </div>
    </div>
  {/if}
  {#if newGameFailure}
    <div class="recovery-backdrop" data-save-thumbnail-exclude="">
      <div
        class="recovery-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={confirmingNewGameWithoutSaving
          ? "確認不儲存並開始遊戲"
          : "無法儲存新遊戲"}
      >
        <h2>
          {confirmingNewGameWithoutSaving
            ? "確認不儲存並開始遊戲"
            : "無法儲存新遊戲"}
        </h2>
        <p>{newGameFailure.message}</p>
        {#if persistenceCancellationMessage(newGameFailure.failureToken)}
          <p role="alert">
            {persistenceCancellationMessage(newGameFailure.failureToken)}
          </p>
        {/if}
        {#if confirmingNewGameWithoutSaving}
          <p>這次遊戲進度將不會寫入磁碟。</p>
          <div class="recovery-actions">
            <button
              type="button"
              onclick={() => {
                confirmingNewGameWithoutSaving = false;
              }}>取消</button
            >
            <button
              type="button"
              data-recovery-focus
              onclick={handleStartGameWithoutSaving}>不儲存並開始遊戲</button
            >
          </div>
        {:else}
          <div class="recovery-actions">
            <button
              type="button"
              disabled={persistenceCancellationInFlight}
              onclick={cancelNewGameFailure}>取消</button
            >
            <button type="button" data-recovery-focus onclick={handleStartGame}
              >重試</button
            >
            {#if newGameFailure.failureToken}
              <button
                type="button"
                onclick={() => {
                  confirmingNewGameWithoutSaving = true;
                }}>不儲存並開始遊戲</button
              >
            {/if}
          </div>
        {/if}
      </div>
    </div>
  {/if}
  {#if gameState.error}
    <div class="menu-error" data-save-thumbnail-exclude="">
      <ErrorBanner message={gameState.error} />
    </div>
  {/if}
{/if}

{#if gameState.value && persistenceStore.persistenceStatus.type === "degraded"}
  <p
    class="persistence-health-warning"
    role="status"
    aria-label="儲存狀態"
    data-save-thumbnail-exclude=""
  >
    {persistenceStore.persistenceStatus.diagnostic.message}
  </p>
{/if}
{#if gameState.value && persistenceStore.thumbnailActivity.type === "unavailable"}
  <p
    class="thumbnail-warning"
    role="status"
    aria-label="預覽狀態"
    data-save-thumbnail-exclude=""
  >
    {persistenceStore.thumbnailActivity.diagnostic.message}
  </p>
{/if}

{#if persistenceStore.exitStatus.type === "saving"}
  <div
    class="recovery-backdrop"
    role="status"
    aria-label="儲存中…"
    data-save-thumbnail-exclude=""
  >
    <div class="recovery-dialog">
      <h2>儲存中…</h2>
      <p>仍在儲存，請稍候…</p>
    </div>
  </div>
{:else if persistenceStore.exitStatus.type === "failed"}
  <div class="recovery-backdrop" data-save-thumbnail-exclude="">
    <div
      class="recovery-dialog"
      role="dialog"
      aria-modal="true"
      aria-label={confirmingExitWithoutSaving
        ? "確認不儲存並結束遊戲"
        : "無法結束遊戲"}
    >
      <h2>
        {confirmingExitWithoutSaving ? "確認不儲存並結束遊戲" : "無法結束遊戲"}
      </h2>
      <p>{persistenceStore.exitStatus.diagnostic.message}</p>
      {#if confirmingExitWithoutSaving}
        <div class="recovery-actions">
          <button
            type="button"
            onclick={() => {
              confirmingExitWithoutSaving = false;
            }}>取消</button
          >
          <button
            type="button"
            data-recovery-focus
            onclick={() => {
              if (!exitFailureToken) return;
              exitWithoutSaving(exitFailureToken);
            }}>不儲存並結束遊戲</button
          >
        </div>
      {:else}
        <div class="recovery-actions">
          <button
            type="button"
            onclick={() => {
              if (!exitFailureToken) return;
              updateExitStatus("cancel_exit", exitFailureToken);
            }}>取消</button
          >
          <button
            type="button"
            data-recovery-focus
            onclick={() => {
              if (!exitFailureToken) return;
              updateExitStatus("retry_exit", exitFailureToken);
            }}>重試</button
          >
          <button
            type="button"
            onclick={() => {
              confirmingExitWithoutSaving = true;
            }}>不儲存並結束遊戲</button
          >
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .status {
    padding: 32px;
    color: var(--bone-dim);
  }
  .menu-error {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    z-index: 100;
    padding: 16px;
  }
  .persistence-health-warning,
  .thumbnail-warning {
    position: fixed;
    right: 18px;
    bottom: 18px;
    z-index: 90;
    max-width: min(420px, calc(100vw - 36px));
    margin: 0;
    padding: 10px 14px;
    border: 1px solid var(--rule-strong);
    background: var(--void);
    color: var(--bone);
  }
  .thumbnail-warning {
    bottom: 70px;
  }
  .persistence-overlay,
  .recovery-backdrop {
    position: fixed;
    inset: 0;
    z-index: 120;
    display: grid;
    place-items: center;
    padding: 20px;
    background: rgb(0 0 0 / 78%);
  }
  .recovery-dialog {
    box-sizing: border-box;
    width: min(560px, 100%);
    padding: 22px;
    border: 1px solid var(--rule-strong);
    background: var(--void);
    color: var(--bone);
  }
  .recovery-actions {
    display: flex;
    justify-content: flex-end;
    gap: 10px;
    margin-top: 20px;
  }
</style>

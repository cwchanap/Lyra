<script lang="ts">
  import { onDestroy } from "svelte";
  import type { AssetManifestEntry } from "@lyra/scripts/compile-scenes/assets/manifest";
  import type { CompileError } from "@lyra/scripts/compile-scenes/types";
  import {
    allowedLensesForSelection,
    buildAiReviewContext,
    type AiReviewContextBundle,
    type AiReviewSelection,
  } from "./lib/ai-review-context";
  import type { AiReviewLens } from "./lib/ai-review";
  import { tauriAiReviewProvider } from "./lib/ai-review-provider";
  import AssetsView from "./lib/AssetsView.svelte";
  import AiReviewPanel from "./lib/AiReviewPanel.svelte";
  import type {
    AssetPromptEditSource,
    AssetSceneUsage,
  } from "./lib/asset-workspace";
  import EditorCanvas from "./lib/EditorCanvas.svelte";
  import EvidenceAssignmentPanel from "./lib/EvidenceAssignmentPanel.svelte";
  import {
    focusedEditDiff,
    multilineReaderActionRefs,
    openFocusedEdit,
    type ApplyWorkbenchSourceEditRequest,
    type FocusedEditDiffHunk,
    type FocusedEditDraft,
    type FocusedEditSelection,
    type PendingFocusedEditSelection,
    type ReaderFocusedEditItem,
    type SourceDocumentId,
    type WorkbenchValidationReport,
  } from "./lib/focused-edit";
  import FocusedEditReview from "./lib/FocusedEditReview.svelte";
  import PlanSidebar from "./lib/PlanSidebar.svelte";
  import PlanView from "./lib/PlanView.svelte";
  import ReaderView from "./lib/ReaderView.svelte";
  import TargetList from "./lib/TargetList.svelte";
  import {
    clearStage,
    editorState,
    loadInvestigationScene,
    normalizeError,
    saveLayout,
    setCharacterLayout,
    setHotspotLayout,
  } from "./lib/layout-store.svelte";
  import {
    ensurePlanLoaded,
    navigatePlanSource,
    planState,
    refreshPlan,
    selectPlanDocument,
    selectPlanHeading,
    showPlanOverview,
  } from "./lib/plan-store.svelte";
  import {
    markAllActionsMultiline,
    markMultilineActions,
    projectionHasAction,
    projectReaderScene,
  } from "./lib/reader-projection";
  import { readableChapterLabel, readableSceneLabel } from "./lib/scene-labels";
  import { filterReaderScene } from "./lib/reader-view";
  import {
    applyWorkbenchSourceEdit,
    loadSceneBundle,
    loadWorkbenchIndex,
    loadWorkbenchSourceDocument,
  } from "./lib/workbench-api";
  import type {
    ReaderEditableRef,
    ReaderGroup,
    ReaderItem,
    ReaderScene,
    SceneType,
    WorkbenchIndex,
    WorkbenchSceneBundle,
    WorkbenchScenePayload,
  } from "./lib/workbench-types";

  type WorkbenchMode = "reader" | "assets" | "plan" | "stage";

  let requestedIndex = false;
  let workbenchIndex = $state<WorkbenchIndex | null>(null);
  let indexError = $state<string | null>(null);
  let selectedChapterId = $state<string | null>(null);
  let selectedSceneId = $state<string | null>(null);
  let currentSublocationId = $state<string | null>(null);
  // Tracks the chapter+scene key of the Stage scene whose sublocations
  // `currentSublocationId` belongs to. Scene IDs can repeat across chapters,
  // so the key must include the chapter id or switching between same-named
  // investigation scenes in different chapters would not reset the selection.
  let currentSublocationStageKey = $state<string | null>(null);
  let isSavingLayout = $state(false);
  let saveToastMessage = $state<string | null>(null);
  let saveToastTimeout: ReturnType<typeof setTimeout> | null = null;

  // Reader state: Reader is the default mode now that it is functional.
  let mode = $state<WorkbenchMode>("reader");
  let readerScope = $state<"scene" | "chapter">("scene");
  let currentBundle = $state<WorkbenchSceneBundle | null>(null);
  let currentReaderScene = $state<ReaderScene | null>(null);
  let readerError = $state<string | null>(null);
  let readerLoading = $state(false);
  let readerLoadGeneration = 0;
  let chapterReaders = $state<ReaderScene[] | null>(null);
  let chapterReaderError = $state<string | null>(null);
  let chapterLoading = $state(false);
  let chapterLoadGeneration = 0;
  // Shared cache-write epoch: bumped whenever the active cache owner changes
  // (Reader scope switch, or leaving Reader for any non-Reader mode). Each load captures the
  // epoch at start and refuses to write `bundleCache` if a newer owner took
  // over, so a pending request from the scope being left cannot overwrite a
  // newer load's cache entry. The per-loader generations above still fence
  // reactive state (currentReaderScene / chapterReaders); this epoch fences
  // the shared cache, which both loaders write.
  let cacheWriteEpoch = 0;
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- session cache is deliberately non-reactive; generation tokens own re-render
  const bundleCache = new Map<string, WorkbenchSceneBundle>();
  // Tracks the cache key of the scene currently rendered in the Reader pane.
  // Non-reactive on purpose: it only drives the stale-payload clear inside
  // loadCurrentReaderScene, never the template directly.
  let displayedReaderKey: string | null = null;

  // The four Reader filters.
  let showCues = $state(true);
  let speaker: string | null = $state(null);
  let showBranches = $state(false);
  let search = $state("");

  const selectedChapter = $derived.by(() => {
    if (!workbenchIndex || !selectedChapterId) return null;
    return (
      workbenchIndex.chapters.find(
        (candidate) => candidate.id === selectedChapterId,
      ) ?? null
    );
  });

  const selectedScene = $derived.by(() => {
    if (!selectedChapter || !selectedSceneId) return null;
    return (
      selectedChapter.scenes.find(
        (candidate) => candidate.id === selectedSceneId,
      ) ?? null
    );
  });

  const filteredReaderScene = $derived(
    currentReaderScene
      ? filterReaderScene(currentReaderScene, {
          showCues,
          speaker,
          showBranches,
          search,
        })
      : null,
  );

  const filteredChapterReaders = $derived(
    chapterReaders?.map((chapterScene) =>
      filterReaderScene(chapterScene, {
        showCues,
        speaker,
        showBranches,
        search,
      }),
    ) ?? null,
  );

  const availableSpeakers = $derived.by(() => {
    const scenes =
      readerScope === "chapter"
        ? (chapterReaders ?? [])
        : currentReaderScene
          ? [currentReaderScene]
          : [];
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- local accumulator, never read reactively
    const speakers = new Set<string>();
    const visit = (group: ReaderGroup): void => {
      for (const item of group.items) {
        if (item.kind === "line") speakers.add(item.speaker);
      }
      for (const child of group.children) visit(child);
    };
    for (const scene of scenes) {
      for (const group of scene.groups) visit(group);
    }
    return [...speakers].sort((a, b) => a.localeCompare(b));
  });

  const selectedSceneTargetSummary = $derived(
    editorState.scene
      ? `${editorState.scene.sublocations.reduce(
          (count, sublocation) => count + sublocation.hotspots.length,
          0,
        )} items · ${editorState.scene.sublocations.reduce(
          (count, sublocation) => count + sublocation.characters.length,
          0,
        )} people`
      : "No scene selected",
  );

  $effect(() => {
    if (requestedIndex) return;
    requestedIndex = true;
    loadWorkbenchIndex()
      .then((index) => {
        workbenchIndex = index;
      })
      .catch((error) => {
        indexError = normalizeError(error);
      });
  });

  $effect(() => {
    if (mode !== "reader" || readerScope !== "chapter") return;
    const chapterId = selectedChapterId;
    if (!chapterId) return;
    void loadChapterReader(chapterId);
  });

  $effect(() => {
    const scene = editorState.scene;
    if (!scene) {
      currentSublocationId = null;
      currentSublocationStageKey = null;
      return;
    }

    const firstSublocationId = scene.sublocations[0]?.id ?? null;
    const stageKey = `${editorState.chapterId}:${editorState.sceneId}`;
    const stageChanged = stageKey !== currentSublocationStageKey;
    const hasCurrentSublocation = scene.sublocations.some(
      (sublocation) => sublocation.id === currentSublocationId,
    );

    if (stageChanged || !currentSublocationId || !hasCurrentSublocation) {
      currentSublocationId = firstSublocationId;
      currentSublocationStageKey = stageKey;
    }
  });

  onDestroy(() => {
    clearSaveToastTimeout();
  });

  function clearSaveToastTimeout() {
    if (!saveToastTimeout) return;
    clearTimeout(saveToastTimeout);
    saveToastTimeout = null;
  }

  function showSaveToast() {
    clearSaveToastTimeout();
    saveToastMessage = "Layout saved";
    saveToastTimeout = setTimeout(() => {
      saveToastMessage = null;
      saveToastTimeout = null;
    }, 2500);
  }

  function setReaderScope(next: "scene" | "chapter"): void {
    if (readerScope === next) return;
    // Invalidate the outgoing scope's pending cache writes before the new
    // owner starts loading, so a late resolution from the scope being left
    // cannot overwrite the newer load's cache entry.
    cacheWriteEpoch += 1;
    readerScope = next;
    // Returning to scene scope must show the current selection; chapter
    // scope loading is owned by the effect above.
    if (next === "scene") void loadCurrentReaderScene();
  }

  function toggleClass(active: boolean): string {
    return [
      "min-h-9 cursor-pointer rounded-md border px-3 text-sm font-bold text-[#26302e]",
      active
        ? "border-[#57776a] bg-[#edf4f0]"
        : "border-[#bfc7bf] bg-white hover:border-[#57776a] hover:bg-[#edf4f0]",
    ].join(" ");
  }

  /**
   * Projects the Reader view and marks multiline authored actions read-only
   * (plan lock: no Edit affordance). The compiled projection carries no
   * multiline signal, so this consults the authored source document once per
   * projection — but only when the projection actually contains an action
   * item; scenes without actions skip the source IPC entirely. Fail-closed:
   * a failed document load marks every action read-only, since no action may
   * render Edit without a proven single-line authored source. The draft-open
   * seam remains the loud backstop.
   */
  async function projectMarkedReaderScene(
    chapterId: string,
    sourcePath: string,
    scene: WorkbenchScenePayload,
  ): Promise<ReaderScene> {
    const projected = projectReaderScene(chapterId, sourcePath, scene);
    if (!projectionHasAction(projected)) return projected;
    // ponytail: uncached per-load source fetch for multiline gating; cache per scene hash if Reader load latency matters
    try {
      const documentId: SourceDocumentId = `scene:${chapterId}:${scene.id}`;
      const document = await loadWorkbenchSourceDocument(documentId);
      return markMultilineActions(
        projected,
        multilineReaderActionRefs({
          chapterId,
          document,
          compiledScene: scene,
        }),
      );
    } catch {
      return markAllActionsMultiline(projected);
    }
  }

  async function loadCurrentReaderScene(): Promise<void> {
    const chapterId = selectedChapterId;
    const sceneId = selectedSceneId;
    const sceneEntry = selectedScene;
    if (!chapterId || !sceneId || !sceneEntry) {
      currentReaderScene = null;
      currentBundle = null;
      return;
    }
    const generation = ++readerLoadGeneration;
    const epoch = cacheWriteEpoch;
    readerError = null;
    const cacheKey = `${chapterId}:${sceneId}`;
    // When the selection key changes (including the Reader→Stage→Reader path,
    // where selectScene does not run a Reader load), clear the previously
    // rendered scene so the placeholder replaces it while the new bundle loads.
    // Same-scene Refresh keeps displayedReaderKey in sync, so the "Reloading…"
    // indicator can render alongside the existing content instead.
    if (cacheKey !== displayedReaderKey) {
      currentReaderScene = null;
      currentBundle = null;
    }
    const cached = bundleCache.get(cacheKey);
    if (cached) {
      // A cache hit supersedes any in-flight load; clear the indicator here
      // because the stale load's finally will skip the generation check.
      readerLoading = false;
      currentBundle = cached;
      try {
        const marked = await projectMarkedReaderScene(
          chapterId,
          sceneEntry.sourcePath,
          currentBundle.scene,
        );
        // Multiline marking awaits a source-document load, so the cached
        // path needs the same stale-response guard as the network path.
        if (generation !== readerLoadGeneration) return;
        currentReaderScene = marked;
        displayedReaderKey = cacheKey;
      } catch (error) {
        if (generation !== readerLoadGeneration) return;
        readerError = normalizeError(error);
        currentReaderScene = null;
      }
      return;
    }
    readerLoading = true;
    try {
      const bundle = await loadSceneBundle(chapterId, sceneId);
      if (generation !== readerLoadGeneration) return; // stale response
      // A scope/mode switch bumped the epoch after this load started; the
      // newer owner's cache entry must not be overwritten by this stale write.
      if (epoch !== cacheWriteEpoch) return;
      bundleCache.set(cacheKey, bundle);
      currentBundle = bundle;
      const marked = await projectMarkedReaderScene(
        chapterId,
        sceneEntry.sourcePath,
        bundle.scene,
      );
      // The marking await re-opens the stale-response window; a newer load
      // owns the projection if the generation moved.
      if (generation !== readerLoadGeneration) return;
      currentReaderScene = marked;
      displayedReaderKey = cacheKey;
    } catch (error) {
      if (generation !== readerLoadGeneration) return;
      readerError = normalizeError(error);
      currentReaderScene = null;
      currentBundle = null;
    } finally {
      if (generation === readerLoadGeneration) readerLoading = false;
    }
  }

  async function loadChapterReader(
    chapterId: string,
    force = false,
  ): Promise<void> {
    const chapter = workbenchIndex?.chapters.find(
      (candidate) => candidate.id === chapterId,
    );
    if (!chapter) return;
    const generation = ++chapterLoadGeneration;
    const epoch = cacheWriteEpoch;
    chapterReaders = null;
    chapterReaderError = null;
    chapterLoading = true;
    try {
      // The chapter manifest is the only scene-ID source; Promise.all keeps
      // result order equal to manifest order.
      const readers = (
        await Promise.all(
          chapter.scenes.map(async (scene) => {
            const cacheKey = `${chapterId}:${scene.id}`;
            const cached = force ? undefined : bundleCache.get(cacheKey);
            if (cached) {
              return projectMarkedReaderScene(
                chapterId,
                scene.sourcePath,
                cached.scene,
              );
            }
            const bundle = await loadSceneBundle(chapterId, scene.id);
            // A stale chapter load must not overwrite cache entries written
            // by the newer load that superseded it, and must not pollute the
            // shared cache after a scope/mode switch invalidated this load.
            if (
              generation !== chapterLoadGeneration ||
              epoch !== cacheWriteEpoch
            )
              return null;
            bundleCache.set(cacheKey, bundle);
            return projectMarkedReaderScene(
              chapterId,
              scene.sourcePath,
              bundle.scene,
            );
          }),
        )
      ).filter((reader): reader is ReaderScene => reader !== null);
      if (generation !== chapterLoadGeneration) return; // stale chapter load
      chapterReaders = readers;
    } catch (error) {
      if (generation !== chapterLoadGeneration) return;
      chapterReaderError = normalizeError(error);
      chapterReaders = null;
    } finally {
      if (generation === chapterLoadGeneration) chapterLoading = false;
    }
  }

  async function refreshReader(): Promise<void> {
    if (!selectedChapterId) return;
    if (readerScope === "chapter") {
      const chapter = selectedChapter;
      if (!chapter) return;
      for (const scene of chapter.scenes) {
        bundleCache.delete(`${chapter.id}:${scene.id}`);
      }
      await loadChapterReader(chapter.id, true);
      return;
    }
    if (!selectedSceneId) return;
    bundleCache.delete(`${selectedChapterId}:${selectedSceneId}`);
    await loadCurrentReaderScene();
  }

  function setMode(next: WorkbenchMode): void {
    if (mode === next) return;
    // Leaving Reader for ANY non-Reader mode invalidates pending Reader cache
    // writes so a late scene/chapter resolution cannot pollute the cache after
    // Assets or Stage took over. Entering Reader starts a fresh load that
    // captures the new epoch, so no bump is needed on that direction.
    if (mode === "reader") cacheWriteEpoch += 1;
    mode = next;
    if (next === "reader") {
      // Entering Reader must reflect the current selection; the bundle cache
      // makes this cheap when nothing changed since the last load.
      if (readerScope === "scene") void loadCurrentReaderScene();
      return;
    }
    if (next === "assets") return; // AssetsView owns its own snapshot loading
    if (next === "plan") {
      // Plan owns no App state; the store's ensurePlanLoaded is idempotent,
      // so re-entering Plan reuses the snapshot instead of reloading it.
      void ensurePlanLoaded();
      return;
    }
    const scene = selectedScene;
    if (
      scene &&
      scene.type === "investigation" &&
      selectedChapterId &&
      selectedSceneId
    ) {
      void loadInvestigationScene(selectedChapterId, selectedSceneId);
    } else {
      clearStage();
    }
  }

  async function selectScene(
    chapterId: string,
    sceneId: string,
    sceneType: SceneType,
  ) {
    selectedChapterId = chapterId;
    selectedSceneId = sceneId;
    if (mode === "reader") {
      if (readerScope === "chapter") return; // the chapter effect owns loading
      await loadCurrentReaderScene();
      return;
    }
    if (mode === "assets") {
      // Assets selection is navigation-only: the shared selection updates so
      // Reader/Stage can act on it later, but AssetsView loads its own data
      // and no Reader/Stage load may start from here.
      return;
    }
    if (sceneType !== "investigation") {
      // Stage never loads a bundle for scenes it cannot lay out; the
      // placeholder below explains why instead.
      clearStage();
      return;
    }
    await loadInvestigationScene(chapterId, sceneId);
  }

  function selectSceneFromAssets(chapterId: string, sceneId: string): void {
    // AssetsView usage links carry no scene type; Assets selection only ever
    // updates the shared selection (same contract as sidebar clicks in
    // Assets mode).
    selectedChapterId = chapterId;
    selectedSceneId = sceneId;
  }

  async function handleSaveLayout() {
    if (isSavingLayout || !editorState.layout) return;

    isSavingLayout = true;
    saveToastMessage = null;
    try {
      await saveLayout();
      if (!editorState.error) {
        showSaveToast();
      }
    } finally {
      isSavingLayout = false;
    }
  }

  // ---- Focused edit review (HPA-135): App owns the ONE active draft. -------

  type FocusedEditReviewState =
    | "idle"
    | "loading-source"
    | "editing"
    | "applying"
    | "applied-valid"
    | "applied-invalid"
    | "error";

  let reviewState = $state<FocusedEditReviewState>("idle");
  let activeSelection = $state<FocusedEditSelection | null>(null);
  let activeDraft = $state<FocusedEditDraft | null>(null);
  let reviewHunk = $state<FocusedEditDiffHunk | null>(null);
  let reviewDiagnostic = $state<CompileError | null>(null);
  let reviewError = $state<string | null>(null);
  let reviewValidation = $state<WorkbenchValidationReport | null>(null);
  let reviewReplacement = $state("");
  // Monotonic token for async focused-edit work: every begin/apply bumps it
  // and stamps its own operation; results from stale generations are
  // discarded so a late-arriving earlier load/apply can never overwrite
  // newer review state.
  let focusedEditGeneration = 0;
  // Bumped so AssetsView (which owns its own snapshot) reloads after an
  // applied source edit.
  let assetsRefreshEpoch = $state(0);

  // ---- AI review (HPA-136): App owns the ONE panel + generation fence. ------

  type AiReviewPanelState = {
    selection: AiReviewSelection;
    selectionLabel: string;
    lenses: AiReviewLens[];
    initialLens: AiReviewLens;
    context: AiReviewContextBundle;
    /** PendingFocusedEditSelection for the replacement handoff; null = none. */
    editSelection: PendingFocusedEditSelection | null;
  };

  let aiReview = $state<AiReviewPanelState | null>(null);
  let aiReviewError = $state<string | null>(null);
  // Fences async context/provider work: opening a newer review (or closing
  // the panel) discards every older in-flight result.
  let aiReviewGeneration = 0;

  function sourceDocumentIdFor(
    selection: PendingFocusedEditSelection,
  ): SourceDocumentId {
    return selection.surface === "reader"
      ? `scene:${selection.chapterId}:${selection.sceneId}`
      : `scene:${selection.prompt.chapterId}:${selection.prompt.sceneId}`;
  }

  function readerBundleFor(
    chapterId: string,
    sceneId: string,
  ): WorkbenchScenePayload | null {
    if (
      currentBundle &&
      selectedChapterId === chapterId &&
      selectedSceneId === sceneId
    ) {
      return currentBundle.scene;
    }
    return bundleCache.get(`${chapterId}:${sceneId}`)?.scene ?? null;
  }

  /**
   * The unfiltered Reader projection for one scene. The views render
   * filtered clones, so the AI scene-projection context must come from here
   * (currentReaderScene in scene scope, chapterReaders in chapter scope).
   */
  function unfilteredReaderScene(
    chapterId: string,
    sceneId: string,
  ): ReaderScene | null {
    if (
      currentReaderScene &&
      currentReaderScene.id === sceneId &&
      selectedChapterId === chapterId
    ) {
      return currentReaderScene;
    }
    return (
      chapterReaders?.find(
        (candidate) =>
          candidate.id === sceneId && selectedChapterId === chapterId,
      ) ?? null
    );
  }

  /**
   * Recursive group lookup by id. Reader group ids are the carrier ids, unique
   * within a scene projection.
   */
  function findReaderGroup(
    groups: ReaderGroup[],
    id: string,
  ): ReaderGroup | null {
    for (const group of groups) {
      if (group.id === id) return group;
      const child = findReaderGroup(group.children, id);
      if (child) return child;
    }
    return null;
  }

  function selectReaderItem(item: ReaderItem): ReaderFocusedEditItem | null {
    if (item.kind === "line") {
      return { kind: "line", speaker: item.speaker, text: item.text };
    }
    if (item.kind === "action") return { kind: "action", text: item.text };
    return null;
  }

  function openReaderEdit(
    chapterId: string,
    sceneId: string,
    ref: ReaderEditableRef,
    item: ReaderItem,
  ): void {
    if (item.kind !== "line" && item.kind !== "action") return;
    const selection = readerPendingSelection(chapterId, sceneId, ref, item);
    if (!selection) {
      beginReviewError(
        `The compiled projection of "${sceneId}" is not loaded; refresh the Reader and retry.`,
      );
      return;
    }
    void beginFocusedEditReview(selection);
  }

  /** Shared pre-source-load identity for a normal Edit and the AI handoff. */
  function readerPendingSelection(
    chapterId: string,
    sceneId: string,
    ref: ReaderEditableRef,
    item: ReaderItem,
  ): PendingFocusedEditSelection | null {
    const selectable = selectReaderItem(item);
    const compiled = readerBundleFor(chapterId, sceneId);
    if (!selectable || !compiled) return null;
    return {
      surface: "reader",
      chapterId,
      sceneId,
      compiledScene: compiled,
      carrierId: ref.carrierId,
      itemIndex: ref.itemIndex,
      item: selectable,
    };
  }

  function openAssetPromptEdit(selection: {
    assetId: string;
    prompt: AssetPromptEditSource;
    sceneUsages: AssetSceneUsage[];
  }): void {
    void beginFocusedEditReview({ surface: "asset", ...selection });
  }

  function resetReviewTransientState(): void {
    activeSelection = null;
    activeDraft = null;
    reviewHunk = null;
    reviewDiagnostic = null;
    reviewValidation = null;
    reviewError = null;
    reviewReplacement = "";
  }

  function beginReviewError(message: string): void {
    resetReviewTransientState();
    reviewState = "error";
    reviewError = message;
  }

  async function beginFocusedEditReview(
    selection: PendingFocusedEditSelection,
    initialReplacement = "",
  ): Promise<void> {
    // An apply/compile is in flight: starting another edit could interleave
    // writes and compiles, so the new selection is refused at this single
    // choke point while the review surface still shows the apply.
    if (reviewState === "applying") return;
    // AI Review XOR Focused Edit: a normal edit fences/closes the AI panel.
    closeAiReview();
    const generation = ++focusedEditGeneration;
    reviewState = "loading-source";
    resetReviewTransientState();
    try {
      const document = await loadWorkbenchSourceDocument(
        sourceDocumentIdFor(selection),
      );
      if (generation !== focusedEditGeneration) return; // superseded
      activeSelection = { ...selection, document };
      // Prefill only after the transient reset and the source load, so the
      // reset can never wipe the AI replacement (HPA-136 reuse seam).
      reviewReplacement = initialReplacement;
      rebuildDraft();
      reviewState = "editing";
    } catch (error) {
      if (generation !== focusedEditGeneration) return; // superseded
      reviewState = "error";
      reviewError = normalizeError(error);
    }
  }

  function rebuildDraft(): void {
    if (!activeSelection) return;
    const result = openFocusedEdit(activeSelection, reviewReplacement);
    if (result.ok) {
      activeDraft = result.draft;
      // The draft is already locality-asserted, so this cannot fail.
      const diff = focusedEditDiff(
        activeSelection.document.content,
        result.draft.nextContent,
        result.draft.expectedLine,
      );
      reviewHunk = diff.ok ? diff.hunk : null;
      reviewDiagnostic = null;
    } else {
      activeDraft = null;
      reviewHunk = null;
      reviewDiagnostic = result.diagnostic;
    }
  }

  function handleReplacementChange(text: string): void {
    reviewReplacement = text;
    if (reviewState === "editing") rebuildDraft();
  }

  function cancelFocusedEditReview(): void {
    // Fence any in-flight focused-edit work against this cancellation.
    focusedEditGeneration += 1;
    resetReviewTransientState();
    reviewState = "idle";
  }

  async function applyFocusedEditDraft(): Promise<void> {
    const draft = activeDraft;
    if (!draft || reviewState !== "editing") return;
    // Supersedes any still-in-flight begin: no two focused-edit async
    // operations may own the review surface at once.
    const generation = ++focusedEditGeneration;
    reviewState = "applying";
    reviewError = null;
    try {
      // Exactly the six backend-guarded fields — no paths, diff, or impact.
      const request: ApplyWorkbenchSourceEditRequest = {
        sourceDocumentId: draft.sourceDocumentId,
        expectedHash: draft.expectedHash,
        semanticRef: draft.semanticRef,
        kind: draft.kind,
        expectedLine: draft.expectedLine,
        nextContent: draft.nextContent,
      };
      const result = await applyWorkbenchSourceEdit(request);
      if (generation !== focusedEditGeneration) return; // superseded
      if (result.validation.ok) {
        reviewState = "applied-valid";
        // The reviewed source just changed: fence any retained AI state
        // together with the projection refresh (HPA-136 handoff contract).
        closeAiReview();
        void refreshProjectionsAfterApply();
      } else {
        // Written-but-invalid: keep the stale projections on screen and show
        // the diagnostics. Refreshing here would pretend fresh projections.
        reviewValidation = result.validation;
        reviewState = "applied-invalid";
      }
    } catch (error) {
      if (generation !== focusedEditGeneration) return; // superseded
      reviewState = "error";
      reviewError = normalizeError(error);
    }
  }

  async function refreshProjectionsAfterApply(): Promise<void> {
    // Invalidate every cached bundle: after a successful write + compile, no
    // stale projection may ever be served from cache again.
    cacheWriteEpoch += 1;
    bundleCache.clear();
    assetsRefreshEpoch += 1;
    await refreshReader();
  }

  // ---- AI review orchestration (HPA-136) -------------------------------------

  function closeAiReview(): void {
    aiReviewGeneration += 1;
    aiReview = null;
    aiReviewError = null;
  }

  /**
   * Entry behavior (plan lock): refuse while a focused apply is in flight,
   * cancel a non-applying focused edit first, then fence/clear prior AI
   * state before building deterministic context.
   */
  async function openAiReview(
    selection: AiReviewSelection,
    selectionLabel: string,
    editSelection: PendingFocusedEditSelection | null,
  ): Promise<void> {
    if (reviewState === "applying") return;
    if (reviewState !== "idle") cancelFocusedEditReview();
    const generation = ++aiReviewGeneration;
    aiReview = null;
    aiReviewError = null;
    await ensurePlanLoaded();
    if (generation !== aiReviewGeneration) return; // superseded
    const workspace = planState.workspace;
    if (!workspace) {
      aiReviewError =
        planState.error ??
        "Plan data could not be loaded; AI review needs the Plan snapshot.";
      return;
    }
    const lenses = allowedLensesForSelection(selection);
    // Dialogue reviews default to the Dialogue lens; every other selection
    // kind offers a single lens.
    const initialLens: AiReviewLens =
      selection.kind === "readerItem" ? "dialogue" : lenses[0]!;
    aiReview = {
      selection,
      selectionLabel,
      lenses,
      initialLens,
      context: buildAiReviewContext(selection, initialLens, workspace),
      editSelection,
    };
  }

  function openReaderSceneReview(chapterId: string, sceneId: string): void {
    const scene = unfilteredReaderScene(chapterId, sceneId);
    if (!scene) {
      closeAiReview();
      aiReviewError = `The Reader projection of "${sceneId}" is not loaded; refresh and retry.`;
      return;
    }
    void openAiReview(
      { kind: "readerScene", chapterId, sceneId, scene },
      scene.title,
      null,
    );
  }

  function openReaderItemReview(
    chapterId: string,
    sceneId: string,
    group: ReaderGroup,
    ref: ReaderEditableRef,
    item: ReaderItem,
  ): void {
    if (item.kind !== "line" && item.kind !== "action") return;
    const editSelection = readerPendingSelection(chapterId, sceneId, ref, item);
    const scene = unfilteredReaderScene(chapterId, sceneId);
    // ReaderView renders filtered clones: the passed group can be missing
    // sibling lines, so the review context must re-resolve it by id from the
    // unfiltered projection.
    const unfilteredGroup = scene
      ? findReaderGroup(scene.groups, group.id)
      : null;
    if (!editSelection || !scene || !unfilteredGroup) {
      closeAiReview();
      aiReviewError = `The projection of "${sceneId}" is not loaded; refresh the Reader and retry.`;
      return;
    }
    void openAiReview(
      {
        kind: "readerItem",
        chapterId,
        sceneId,
        scene,
        group: unfilteredGroup,
        ref,
        item,
        editSelection,
      },
      item.text,
      editSelection,
    );
  }

  function openAssetPromptReview(selection: {
    assetId: string;
    entry: AssetManifestEntry;
    usages: AssetSceneUsage[];
    editSelection: AssetPromptEditSource | null;
  }): void {
    // The selection's editSelection is exactly the HPA-135 pending identity:
    // it drives replacement eligibility and the replacement handoff.
    const pending = selection.editSelection
      ? {
          surface: "asset" as const,
          assetId: selection.assetId,
          prompt: selection.editSelection,
          sceneUsages: selection.usages,
        }
      : null;
    void openAiReview(
      {
        kind: "assetPrompt",
        assetId: selection.assetId,
        entry: selection.entry,
        usages: selection.usages,
        editSelection: pending,
      },
      selection.assetId,
      pending,
    );
  }

  function openPlanSectionReview(documentId: string, anchor: string): void {
    void openAiReview(
      { kind: "planSection", documentId, anchor },
      `${documentId}#${anchor}`,
      null,
    );
  }

  /** Replacement handoff: fence the AI panel, open the edit prefilled. */
  function applyAiReplacement(replacementText: string): void {
    const editSelection = aiReview?.editSelection;
    closeAiReview();
    if (editSelection) {
      void beginFocusedEditReview(editSelection, replacementText);
    }
  }
</script>

<main
  class="app-shell grid min-h-screen min-w-80 grid-cols-[minmax(280px,360px)_1fr] gap-6 bg-[#f4f1ec] p-8 font-sans text-[#1e2428] max-[800px]:grid-cols-1 max-[800px]:p-5"
>
  <aside
    class="scene-panel rounded-lg border border-[#d7d2c8] bg-[#fffcf7] p-6 shadow-[0_16px_40px_rgb(39_35_29_/_10%)]"
    aria-labelledby="editor-title"
  >
    <p
      class="eyebrow m-0 mb-3 text-[0.78rem] font-bold tracking-normal text-[#5f6b64] uppercase"
    >
      Developer Tool
    </p>
    <h1 id="editor-title" class="m-0 text-3xl leading-[1.1] tracking-normal">
      Lyra Story Workbench
    </h1>

    {#if editorState.error || indexError}
      <p
        class="error mt-[18px] mb-0 rounded-md border border-[#d9a99e] bg-[#fff4f1] p-3 text-[#7d3c2f]"
      >
        {editorState.error ?? indexError}
      </p>
    {/if}

    {#if mode === "plan"}
      <div class="scene-list mt-7 grid content-start gap-2.5">
        <PlanSidebar
          workspace={planState.workspace}
          surface={planState.surface}
          selectedDocumentId={planState.selectedDocumentId}
          selectedAnchor={planState.selectedAnchor}
          onRefresh={refreshPlan}
          onShowOverview={showPlanOverview}
          onSelectDocument={selectPlanDocument}
          onSelectHeading={selectPlanHeading}
        />
      </div>
    {:else}
      <div
        class="scene-list mt-7 grid gap-2.5"
        aria-label="Story workbench scenes"
      >
        {#each workbenchIndex?.chapters ?? [] as chapter (chapter.id)}
          <details class="rounded-md border border-[#e4ded3] bg-[#fffefb]" open>
            <summary class="grid cursor-pointer gap-1 px-3 py-2.5">
              <span class="text-[0.78rem] text-[#60706b]">{chapter.id}</span>
              <strong class="[overflow-wrap:anywhere] text-sm font-bold"
                >{readableChapterLabel(chapter.id, chapter.title)}</strong
              >
            </summary>
            <div class="chapter-scenes grid gap-2 px-2.5 pb-2.5">
              {#each chapter.scenes as scene (scene.id)}
                <div class="scene-entry grid gap-2">
                  <button
                    class={[
                      "grid min-h-11 w-full cursor-pointer gap-1 rounded-md border px-3 py-2.5 text-left text-[#26302e]",
                      scene.id === selectedSceneId &&
                      chapter.id === selectedChapterId
                        ? "selected border-[#57776a] bg-[#edf4f0]"
                        : "border-[#bfc7bf] bg-white hover:border-[#57776a] hover:bg-[#edf4f0]",
                    ].join(" ")}
                    type="button"
                    onclick={() =>
                      selectScene(chapter.id, scene.id, scene.type)}
                  >
                    <strong class="break-words text-sm font-bold"
                      >{readableSceneLabel(scene.id)}</strong
                    >
                    <small class="text-[0.78rem] text-[#60706b]"
                      >{readableChapterLabel(chapter.id, chapter.title)}</small
                    >
                  </button>
                  {#if mode === "stage" && editorState.chapterId === chapter.id && editorState.sceneId === scene.id && editorState.scene}
                    <div
                      class="scene-sublocations ml-3 border-l-2 border-[#e4ded3] pl-2.5"
                    >
                      <TargetList
                        scene={editorState.scene}
                        {currentSublocationId}
                        onSelectSublocation={(sublocationId) =>
                          (currentSublocationId = sublocationId)}
                      />
                    </div>
                  {/if}
                </div>
              {/each}
            </div>
          </details>
        {:else}
          <p class="empty m-0 text-[#7d3c2f]">No scenes loaded.</p>
        {/each}
      </div>
    {/if}
  </aside>

  <section
    class="detail-panel min-w-0 rounded-lg border border-[#d7d2c8] bg-[#fffcf7] p-8 shadow-[0_16px_40px_rgb(39_35_29_/_10%)]"
    aria-live="polite"
  >
    <div class="mode-bar flex flex-wrap items-center gap-3">
      <div
        class="flex gap-1 rounded-md border border-[#bfc7bf] bg-white p-1"
        role="group"
        aria-label="Workbench mode"
      >
        <button
          type="button"
          class={toggleClass(mode === "reader")}
          aria-pressed={mode === "reader"}
          onclick={() => setMode("reader")}
        >
          Reader
        </button>
        <button
          type="button"
          class={toggleClass(mode === "assets")}
          aria-pressed={mode === "assets"}
          onclick={() => setMode("assets")}
        >
          Assets
        </button>
        <button
          type="button"
          class={toggleClass(mode === "plan")}
          aria-pressed={mode === "plan"}
          onclick={() => setMode("plan")}
        >
          Plan
        </button>
        <button
          type="button"
          class={toggleClass(mode === "stage")}
          aria-pressed={mode === "stage"}
          onclick={() => setMode("stage")}
        >
          Stage
        </button>
      </div>
      {#if mode === "reader" && selectedChapterId}
        <div
          class="flex gap-1 rounded-md border border-[#bfc7bf] bg-white p-1"
          role="group"
          aria-label="Reader scope"
        >
          <button
            type="button"
            class={toggleClass(readerScope === "scene")}
            aria-pressed={readerScope === "scene"}
            onclick={() => setReaderScope("scene")}
          >
            Current scene
          </button>
          <button
            type="button"
            class={toggleClass(readerScope === "chapter")}
            aria-pressed={readerScope === "chapter"}
            onclick={() => setReaderScope("chapter")}
          >
            Whole chapter
          </button>
        </div>
      {/if}
      {#if mode === "reader"}
        <button
          type="button"
          class="min-h-9 cursor-pointer rounded-md border border-[#bfc7bf] bg-white px-4 text-sm font-bold text-[#26302e] hover:border-[#57776a] hover:bg-[#edf4f0] disabled:cursor-not-allowed disabled:opacity-60"
          disabled={!selectedSceneId}
          onclick={refreshReader}
        >
          Refresh
        </button>
      {/if}
    </div>

    {#if mode === "reader"}
      <div class="reader-area mt-7 grid gap-5">
        {#snippet readerControls()}
          <div
            class="reader-controls grid gap-3 rounded-md border border-[#e4ded3] bg-[#fffefb] p-4 sm:grid-cols-2"
          >
            <div
              class="flex flex-wrap items-center gap-2"
              role="group"
              aria-label="Reader cue detail"
            >
              <button
                type="button"
                class={toggleClass(!showCues)}
                aria-pressed={!showCues}
                onclick={() => (showCues = false)}
              >
                Hide cues
              </button>
              <button
                type="button"
                class={toggleClass(showCues)}
                aria-pressed={showCues}
                onclick={() => (showCues = true)}
              >
                Dialogue + cues
              </button>
            </div>
            <select
              class="min-h-9 cursor-pointer rounded-md border border-[#bfc7bf] bg-white px-3 text-sm font-bold text-[#26302e]"
              aria-label="Speaker"
              value={speaker ?? ""}
              onchange={(event) =>
                (speaker = event.currentTarget.value || null)}
            >
              <option value="">All speakers</option>
              {#each availableSpeakers as candidate (candidate)}
                <option value={candidate}>{candidate}</option>
              {/each}
            </select>
            <div
              class="flex flex-wrap items-center gap-2"
              role="group"
              aria-label="Reader branch detail"
            >
              <button
                type="button"
                class={toggleClass(!showBranches)}
                aria-pressed={!showBranches}
                onclick={() => (showBranches = false)}
              >
                Main flow
              </button>
              <button
                type="button"
                class={toggleClass(showBranches)}
                aria-pressed={showBranches}
                onclick={() => (showBranches = true)}
              >
                Expanded branches
              </button>
            </div>
            <input
              type="search"
              class="min-h-9 rounded-md border border-[#bfc7bf] bg-white px-3 text-sm text-[#26302e]"
              aria-label="Search loaded Reader text"
              placeholder="Search loaded Reader text"
              bind:value={search}
            />
          </div>
        {/snippet}

        {#if readerScope === "chapter"}
          {#if chapterReaderError}
            <p
              class="error m-0 rounded-md border border-[#d9a99e] bg-[#fff4f1] p-3 text-[#7d3c2f]"
            >
              {chapterReaderError}
            </p>
          {/if}
          {#if filteredChapterReaders}
            {@render readerControls()}
            {#each filteredChapterReaders as chapterScene (chapterScene.id)}
              <!-- Collapse is a native <details>: local, never persisted. -->
              <details
                class="rounded-md border border-[#e4ded3] bg-[#fffefb] p-4"
                open
              >
                <summary
                  class="cursor-pointer text-sm font-bold text-[#26302e]"
                >
                  {chapterScene.title}
                  <span class="ml-2 text-[0.78rem] font-normal text-[#60706b]"
                    >{chapterScene.type} scene</span
                  >
                </summary>
                <div class="mt-3">
                  <ReaderView
                    scene={chapterScene}
                    onEditItem={(ref, item) => {
                      if (selectedChapterId) {
                        openReaderEdit(
                          selectedChapterId,
                          chapterScene.id,
                          ref,
                          item,
                        );
                      }
                    }}
                    onReviewItem={(group, ref, item) => {
                      if (selectedChapterId) {
                        void openReaderItemReview(
                          selectedChapterId,
                          chapterScene.id,
                          group,
                          ref,
                          item,
                        );
                      }
                    }}
                    onReviewScene={() => {
                      if (selectedChapterId) {
                        void openReaderSceneReview(
                          selectedChapterId,
                          chapterScene.id,
                        );
                      }
                    }}
                  />
                </div>
              </details>
            {/each}
          {:else}
            <div
              class="placeholder grid min-h-[280px] content-center text-[#7d3c2f]"
            >
              <p
                class="eyebrow m-0 mb-3 text-[0.78rem] font-bold tracking-normal text-[#5f6b64] uppercase"
              >
                Reader
              </p>
              <p class="m-0 text-xl text-[#4f5756]">
                {chapterLoading
                  ? "Loading chapter…"
                  : "Select a scene to read."}
              </p>
            </div>
          {/if}
        {:else}
          {#if readerError}
            <p
              class="error m-0 rounded-md border border-[#d9a99e] bg-[#fff4f1] p-3 text-[#7d3c2f]"
            >
              {readerError}
            </p>
          {/if}
          {#if filteredReaderScene}
            {@render readerControls()}
            {#if readerLoading}
              <p class="m-0 text-[0.85rem] text-[#60706b]">Reloading…</p>
            {/if}
            <ReaderView
              scene={filteredReaderScene}
              onEditItem={(ref, item) => {
                if (selectedChapterId && selectedSceneId) {
                  openReaderEdit(selectedChapterId, selectedSceneId, ref, item);
                }
              }}
              onReviewItem={(group, ref, item) => {
                if (selectedChapterId && selectedSceneId) {
                  void openReaderItemReview(
                    selectedChapterId,
                    selectedSceneId,
                    group,
                    ref,
                    item,
                  );
                }
              }}
              onReviewScene={() => {
                if (selectedChapterId && selectedSceneId) {
                  void openReaderSceneReview(
                    selectedChapterId,
                    selectedSceneId,
                  );
                }
              }}
            />
          {:else}
            <div
              class="placeholder grid min-h-[280px] content-center text-[#7d3c2f]"
            >
              <p
                class="eyebrow m-0 mb-3 text-[0.78rem] font-bold tracking-normal text-[#5f6b64] uppercase"
              >
                Reader
              </p>
              <p class="m-0 text-xl text-[#4f5756]">
                {readerLoading ? "Loading scene…" : "Select a scene to read."}
              </p>
            </div>
          {/if}
        {/if}
      </div>
    {:else if mode === "assets"}
      <AssetsView
        {selectedChapterId}
        {selectedSceneId}
        onSelectScene={selectSceneFromAssets}
        onEditPrompt={openAssetPromptEdit}
        onReviewPrompt={openAssetPromptReview}
        refreshEpoch={assetsRefreshEpoch}
      />
    {:else if mode === "plan"}
      <PlanView
        workspace={planState.workspace}
        error={planState.error}
        loading={planState.loading}
        surface={planState.surface}
        selectedDocumentId={planState.selectedDocumentId}
        selectedAnchor={planState.selectedAnchor}
        onNavigateSource={navigatePlanSource}
        onReviewSection={(documentId, anchor) =>
          void openPlanSectionReview(documentId, anchor)}
      />
    {:else if editorState.scene}
      <header
        class="detail-header flex items-start justify-between gap-5 max-[800px]:grid"
      >
        <div>
          <p
            class="eyebrow m-0 mb-3 text-[0.78rem] font-bold tracking-normal text-[#5f6b64] uppercase"
          >
            Stage
          </p>
          <h2
            class="m-0 max-w-[28ch] text-[1.75rem] leading-[1.1] tracking-normal"
          >
            {editorState.scene.title}
          </h2>
        </div>
        <div
          class="save-control grid justify-items-end gap-2 max-[800px]:justify-items-stretch"
        >
          <button
            type="button"
            class="save-button min-h-11 flex-none cursor-pointer rounded-md border border-[#bfc7bf] bg-white px-4 font-bold text-[#26302e] hover:border-[#57776a] hover:bg-[#edf4f0] disabled:cursor-not-allowed disabled:opacity-60 max-[800px]:w-full"
            disabled={!editorState.layout || isSavingLayout}
            onclick={handleSaveLayout}
          >
            {isSavingLayout ? "Saving..." : "Save Layout"}
          </button>
        </div>
      </header>

      <dl class="scene-meta mt-8 grid gap-3.5">
        <div
          class="grid grid-cols-[140px_minmax(0,1fr)] gap-4 border-t border-[#e4ded3] py-3.5 max-[800px]:grid-cols-1"
        >
          <dt class="font-bold text-[#60706b]">Sublocations</dt>
          <dd class="m-0 min-w-0 break-words">
            {editorState.scene.sublocations.length}
          </dd>
        </div>
        <div
          class="grid grid-cols-[140px_minmax(0,1fr)] gap-4 border-t border-[#e4ded3] py-3.5 max-[800px]:grid-cols-1"
        >
          <dt class="font-bold text-[#60706b]">Targets</dt>
          <dd class="m-0 min-w-0 break-words">{selectedSceneTargetSummary}</dd>
        </div>
      </dl>

      <EvidenceAssignmentPanel
        scene={editorState.scene}
        sublocationId={currentSublocationId}
      />

      {#if editorState.layout && currentSublocationId}
        <EditorCanvas
          scene={editorState.scene}
          layout={editorState.layout}
          sublocationId={currentSublocationId}
          onHotspotLayoutChange={setHotspotLayout}
          onCharacterLayoutChange={setCharacterLayout}
        />
      {/if}
    {:else}
      <div class="placeholder grid min-h-[280px] content-center text-[#7d3c2f]">
        <p
          class="eyebrow m-0 mb-3 text-[0.78rem] font-bold tracking-normal text-[#5f6b64] uppercase"
        >
          Stage
        </p>
        {#if selectedScene && selectedScene.type !== "investigation"}
          <p class="m-0 text-xl text-[#4f5756]">
            Stage is available for investigation scenes only.
          </p>
        {:else}
          <p class="m-0 text-xl text-[#4f5756]">
            Select an investigation scene.
          </p>
        {/if}
      </div>
    {/if}
  </section>

  {#if reviewState !== "idle"}
    <div class="col-span-full">
      <FocusedEditReview
        state={reviewState}
        sourcePath={activeSelection?.document.path ?? null}
        draft={activeDraft}
        hunk={reviewHunk}
        diagnostic={reviewDiagnostic}
        error={reviewError}
        validation={reviewValidation}
        replacement={reviewReplacement}
        onReplacementChange={handleReplacementChange}
        onApply={() => void applyFocusedEditDraft()}
        onCancel={cancelFocusedEditReview}
      />
    </div>
  {/if}

  {#if aiReview}
    {@const activeReview = aiReview}
    <div class="col-span-full">
      <AiReviewPanel
        selectionLabel={activeReview.selectionLabel}
        lenses={activeReview.lenses}
        initialLens={activeReview.initialLens}
        context={activeReview.context}
        rebuildContext={(lens) => {
          const workspace = planState.workspace;
          if (!workspace) return activeReview.context;
          return buildAiReviewContext(activeReview.selection, lens, workspace);
        }}
        provider={tauriAiReviewProvider}
        onReviewReplacement={applyAiReplacement}
        onClose={closeAiReview}
      />
    </div>
  {/if}

  {#if aiReviewError}
    <div class="col-span-full">
      <p
        class="m-0 rounded-md border border-[#d9a99e] bg-[#fff4f1] p-3 text-[#7d3c2f]"
        role="alert"
      >
        {aiReviewError}
      </p>
    </div>
  {/if}

  {#if saveToastMessage}
    <div
      class="toast-viewport fixed inset-x-0 bottom-6 z-40 flex justify-center px-6 [box-sizing:border-box] pointer-events-none"
      aria-live="polite"
      aria-atomic="true"
    >
      <p
        class="save-toast flex w-fit max-w-[min(420px,calc(100vw-48px))] items-center gap-2.5 rounded-lg border border-white/15 bg-[#1f2b26] px-4 py-3 text-sm font-bold text-[#f8fbf8] shadow-[0_18px_36px_rgb(22_18_12_/_24%)]"
        role="status"
      >
        <span
          class="toast-indicator h-2.5 w-2.5 flex-none rounded-full bg-[#83d58a] shadow-[0_0_0_4px_rgb(131_213_138_/_16%)]"
          aria-hidden="true"
        ></span>
        <span>{saveToastMessage}</span>
      </p>
    </div>
  {/if}
</main>

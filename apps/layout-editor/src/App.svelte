<script lang="ts">
  import { onDestroy } from "svelte";
  import EditorCanvas from "./lib/EditorCanvas.svelte";
  import EvidenceAssignmentPanel from "./lib/EvidenceAssignmentPanel.svelte";
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
  import { projectReaderScene } from "./lib/reader-projection";
  import { readableChapterLabel, readableSceneLabel } from "./lib/scene-labels";
  import { filterReaderScene } from "./lib/reader-view";
  import { loadSceneBundle, loadWorkbenchIndex } from "./lib/workbench-api";
  import type {
    ReaderGroup,
    ReaderScene,
    SceneType,
    WorkbenchIndex,
    WorkbenchSceneBundle,
  } from "./lib/workbench-types";

  let requestedIndex = false;
  let workbenchIndex = $state<WorkbenchIndex | null>(null);
  let indexError = $state<string | null>(null);
  let selectedChapterId = $state<string | null>(null);
  let selectedSceneId = $state<string | null>(null);
  let currentSublocationId = $state<string | null>(null);
  let currentSublocationSceneId = $state<string | null>(null);
  let isSavingLayout = $state(false);
  let saveToastMessage = $state<string | null>(null);
  let saveToastTimeout: ReturnType<typeof setTimeout> | null = null;

  // Reader state: Reader is the default mode now that it is functional.
  let mode = $state<"reader" | "stage">("reader");
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
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- session cache is deliberately non-reactive; generation tokens own re-render
  const bundleCache = new Map<string, WorkbenchSceneBundle>();

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
      currentSublocationSceneId = null;
      return;
    }

    const firstSublocationId = scene.sublocations[0]?.id ?? null;
    const sceneChanged = editorState.sceneId !== currentSublocationSceneId;
    const hasCurrentSublocation = scene.sublocations.some(
      (sublocation) => sublocation.id === currentSublocationId,
    );

    if (sceneChanged || !currentSublocationId || !hasCurrentSublocation) {
      currentSublocationId = firstSublocationId;
      currentSublocationSceneId = editorState.sceneId;
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
    readerError = null;
    const cacheKey = `${chapterId}:${sceneId}`;
    const cached = bundleCache.get(cacheKey);
    if (cached) {
      // A cache hit supersedes any in-flight load; clear the indicator here
      // because the stale load's finally will skip the generation check.
      readerLoading = false;
      currentBundle = cached;
      try {
        currentReaderScene = projectReaderScene(
          chapterId,
          sceneEntry.sourcePath,
          currentBundle.scene,
        );
      } catch (error) {
        readerError = normalizeError(error);
        currentReaderScene = null;
      }
      return;
    }
    readerLoading = true;
    try {
      const bundle = await loadSceneBundle(chapterId, sceneId);
      if (generation !== readerLoadGeneration) return; // stale response
      bundleCache.set(cacheKey, bundle);
      currentBundle = bundle;
      currentReaderScene = projectReaderScene(
        chapterId,
        sceneEntry.sourcePath,
        currentBundle.scene,
      );
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
              return projectReaderScene(
                chapterId,
                scene.sourcePath,
                cached.scene,
              );
            }
            const bundle = await loadSceneBundle(chapterId, scene.id);
            // A stale chapter load must not overwrite cache entries written
            // by the newer load that superseded it.
            if (generation !== chapterLoadGeneration) return null;
            bundleCache.set(cacheKey, bundle);
            return projectReaderScene(
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

  function setMode(next: "reader" | "stage"): void {
    if (mode === next) return;
    mode = next;
    if (next !== "stage") {
      // Entering Reader must reflect the current selection; the bundle cache
      // makes this cheap when nothing changed since the last load.
      if (readerScope === "scene") void loadCurrentReaderScene();
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
    if (mode !== "reader") {
      if (sceneType !== "investigation") {
        // Stage never loads a bundle for scenes it cannot lay out; the
        // placeholder below explains why instead.
        clearStage();
        return;
      }
      await loadInvestigationScene(chapterId, sceneId);
      return;
    }
    if (readerScope === "chapter") return; // the chapter effect owns loading
    await loadCurrentReaderScene();
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
                  onclick={() => selectScene(chapter.id, scene.id, scene.type)}
                >
                  <strong class="break-words text-sm font-bold"
                    >{readableSceneLabel(scene.id)}</strong
                  >
                  <small class="text-[0.78rem] text-[#60706b]"
                    >{readableChapterLabel(chapter.id, chapter.title)}</small
                  >
                </button>
                {#if scene.id === selectedSceneId && chapter.id === selectedChapterId && editorState.scene}
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
                  <ReaderView scene={chapterScene} />
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
            <ReaderView scene={filteredReaderScene} />
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

<script lang="ts">
  import { onDestroy } from "svelte";
  import EditorCanvas from "./lib/EditorCanvas.svelte";
  import EvidenceAssignmentPanel from "./lib/EvidenceAssignmentPanel.svelte";
  import TargetList from "./lib/TargetList.svelte";
  import {
    editorState,
    loadInvestigationScene,
    normalizeError,
    saveLayout,
    setCharacterLayout,
    setHotspotLayout,
  } from "./lib/layout-store.svelte";
  import { readableChapterLabel, readableSceneLabel } from "./lib/scene-labels";
  import { loadWorkbenchIndex } from "./lib/workbench-api";
  import type { SceneType, WorkbenchIndex } from "./lib/workbench-types";

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

  const selectedScene = $derived.by(() => {
    if (!workbenchIndex || !selectedChapterId || !selectedSceneId) return null;
    const chapter = workbenchIndex.chapters.find(
      (candidate) => candidate.id === selectedChapterId,
    );
    return (
      chapter?.scenes.find((candidate) => candidate.id === selectedSceneId) ??
      null
    );
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

  function clearStage() {
    editorState.scene = null;
    editorState.layout = null;
    editorState.chapterId = null;
    editorState.sceneId = null;
    editorState.error = null;
  }

  async function selectScene(
    chapterId: string,
    sceneId: string,
    sceneType: SceneType,
  ) {
    selectedChapterId = chapterId;
    selectedSceneId = sceneId;
    if (sceneType !== "investigation") {
      // Stage never loads a bundle for scenes it cannot lay out; the
      // placeholder below explains why instead.
      clearStage();
      return;
    }
    await loadInvestigationScene(chapterId, sceneId);
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
    {#if editorState.scene}
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

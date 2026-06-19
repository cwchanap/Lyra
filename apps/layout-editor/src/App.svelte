<script lang="ts">
  import { onDestroy } from "svelte";
  import EditorCanvas from "./lib/EditorCanvas.svelte";
  import EvidenceAssignmentPanel from "./lib/EvidenceAssignmentPanel.svelte";
  import TargetList from "./lib/TargetList.svelte";
  import {
    editorState,
    loadChapters,
    loadInvestigationScene,
    saveLayout,
    setCharacterLayout,
    setHotspotLayout,
  } from "./lib/layout-store.svelte";
  import { readableChapterLabel, readableSceneLabel } from "./lib/scene-labels";

  type InvestigationChapter = {
    id: string;
    label: string;
    summary: string;
    scenes: Array<{
      file: string;
      path: string;
      label: string;
      description: string;
    }>;
  };

  let requestedChapters = false;
  let currentSublocationId = $state<string | null>(null);
  let currentSublocationScenePath = $state<string | null>(null);
  let isSavingLayout = $state(false);
  let saveToastMessage = $state<string | null>(null);
  let saveToastTimeout: ReturnType<typeof setTimeout> | null = null;

  const investigationChapters = $derived(
    editorState.chapters?.chapters
      .map((chapter): InvestigationChapter => {
        const chapterLabel = readableChapterLabel(chapter.id, chapter.title);
        return {
          id: chapter.id,
          label: chapterLabel,
          summary: chapter.summary,
          scenes: chapter.scenes
            .filter((scene) => scene.type === "investigation")
            .map((scene) => ({
              file: scene.file,
              path: `apps/game/src-tauri/resources/scenes/${scene.file}`,
              label: readableSceneLabel(scene.file),
              description: `${chapterLabel} investigation layout`,
            })),
        };
      })
      .filter((chapter) => chapter.scenes.length > 0) ?? [],
  );

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
    if (requestedChapters) return;
    requestedChapters = true;
    void loadChapters();
  });

  $effect(() => {
    const scene = editorState.scene;
    const scenePath = editorState.scenePath;
    if (!scene) {
      currentSublocationId = null;
      currentSublocationScenePath = null;
      return;
    }

    const firstSublocationId = scene.sublocations[0]?.id ?? null;
    const sceneChanged = scenePath !== currentSublocationScenePath;
    const hasCurrentSublocation = scene.sublocations.some(
      (sublocation) => sublocation.id === currentSublocationId,
    );

    if (sceneChanged || !currentSublocationId || !hasCurrentSublocation) {
      currentSublocationId = firstSublocationId;
      currentSublocationScenePath = scenePath;
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

  async function handleSaveLayout() {
    if (isSavingLayout || !editorState.layout || !editorState.layoutPath)
      return;

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

<main class="app-shell">
  <aside class="scene-panel" aria-labelledby="editor-title">
    <p class="eyebrow">Developer Tool</p>
    <h1 id="editor-title">Lyra Layout Editor</h1>

    {#if editorState.error}
      <p class="error">{editorState.error}</p>
    {/if}

    <div class="scene-list" aria-label="Investigation scenes">
      {#each investigationChapters as chapter (chapter.id)}
        <details open>
          <summary>
            <span>{chapter.id}</span>
            <strong>{chapter.label}</strong>
          </summary>
          <div class="chapter-scenes">
            {#each chapter.scenes as scene (scene.path)}
              <div class="scene-entry">
                <button
                  class:selected={scene.path === editorState.scenePath}
                  type="button"
                  onclick={() => loadInvestigationScene(scene.path)}
                >
                  <strong>{scene.label}</strong>
                  <small>{scene.description}</small>
                </button>
                {#if scene.path === editorState.scenePath && editorState.scene}
                  <div class="scene-sublocations">
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
        <p class="empty">No investigation scenes loaded.</p>
      {/each}
    </div>
  </aside>

  <section class="detail-panel" aria-live="polite">
    {#if editorState.scene}
      <header class="detail-header">
        <div>
          <p class="eyebrow">Scene</p>
          <h2>{editorState.scene.title}</h2>
        </div>
        <div class="save-control">
          <button
            type="button"
            class="save-button"
            disabled={!editorState.layout ||
              !editorState.layoutPath ||
              isSavingLayout}
            onclick={handleSaveLayout}
          >
            {isSavingLayout ? "Saving..." : "Save Layout"}
          </button>
        </div>
      </header>

      <dl class="scene-meta">
        <div>
          <dt>Sublocations</dt>
          <dd>{editorState.scene.sublocations.length}</dd>
        </div>
        <div>
          <dt>Targets</dt>
          <dd>{selectedSceneTargetSummary}</dd>
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
      <div class="placeholder">
        <p class="eyebrow">Scene</p>
        <p>Select an investigation scene.</p>
      </div>
    {/if}
  </section>

  {#if saveToastMessage}
    <div class="toast-viewport" aria-live="polite" aria-atomic="true">
      <p class="save-toast" role="status">
        <span class="toast-indicator" aria-hidden="true"></span>
        <span>{saveToastMessage}</span>
      </p>
    </div>
  {/if}
</main>

<style>
  :global(body) {
    margin: 0;
    min-width: 320px;
    min-height: 100vh;
    font-family:
      Inter,
      ui-sans-serif,
      system-ui,
      -apple-system,
      BlinkMacSystemFont,
      "Segoe UI",
      sans-serif;
    color: #1e2428;
    background: #f4f1ec;
  }

  :global(button),
  :global(input),
  :global(select),
  :global(textarea) {
    font: inherit;
  }

  .app-shell {
    min-height: 100vh;
    display: grid;
    grid-template-columns: minmax(280px, 360px) 1fr;
    gap: 24px;
    padding: 32px;
    box-sizing: border-box;
  }

  .scene-panel,
  .detail-panel {
    border: 1px solid #d7d2c8;
    border-radius: 8px;
    background: #fffcf7;
    box-shadow: 0 16px 40px rgb(39 35 29 / 10%);
  }

  .scene-panel {
    padding: 24px;
  }

  .detail-panel {
    min-width: 0;
    padding: 32px;
  }

  .eyebrow {
    margin: 0 0 12px;
    color: #5f6b64;
    font-size: 0.78rem;
    font-weight: 700;
    letter-spacing: 0;
    text-transform: uppercase;
  }

  h1,
  h2 {
    margin: 0;
    line-height: 1.1;
    letter-spacing: 0;
  }

  h1 {
    font-size: 2rem;
  }

  h2 {
    max-width: 28ch;
    font-size: 1.75rem;
  }

  .scene-list {
    display: grid;
    gap: 10px;
    margin-top: 28px;
  }

  .scene-list button,
  .save-button {
    min-height: 44px;
    border: 1px solid #bfc7bf;
    border-radius: 6px;
    background: #ffffff;
    color: #26302e;
    cursor: pointer;
  }

  .scene-list button {
    display: grid;
    gap: 4px;
    width: 100%;
    padding: 10px 12px;
    text-align: left;
  }

  .scene-list details {
    border: 1px solid #e4ded3;
    border-radius: 6px;
    background: #fffefb;
  }

  .scene-list summary {
    display: grid;
    gap: 4px;
    padding: 10px 12px;
    cursor: pointer;
  }

  .chapter-scenes {
    display: grid;
    gap: 8px;
    padding: 0 10px 10px;
  }

  .scene-entry {
    display: grid;
    gap: 8px;
  }

  .scene-sublocations {
    margin-left: 12px;
    padding-left: 10px;
    border-left: 2px solid #e4ded3;
  }

  .scene-list button:hover,
  .scene-list button.selected,
  .save-button:hover {
    border-color: #57776a;
    background: #edf4f0;
  }

  .scene-list span,
  .scene-list small {
    color: #60706b;
    font-size: 0.78rem;
  }

  .scene-list strong {
    overflow-wrap: anywhere;
    font-size: 0.9rem;
  }

  .detail-header {
    display: flex;
    align-items: start;
    justify-content: space-between;
    gap: 20px;
  }

  .save-button {
    flex: 0 0 auto;
    padding: 0 16px;
    font-weight: 700;
  }

  .save-control {
    display: grid;
    justify-items: end;
    gap: 8px;
  }

  .save-toast {
    display: flex;
    align-items: center;
    gap: 10px;
    width: fit-content;
    max-width: min(420px, calc(100vw - 48px));
    margin: 0;
    padding: 12px 16px;
    border: 1px solid rgb(255 255 255 / 14%);
    border-radius: 8px;
    background: #1f2b26;
    box-shadow: 0 18px 36px rgb(22 18 12 / 24%);
    color: #f8fbf8;
    font-size: 0.9rem;
    font-weight: 700;
  }

  .toast-viewport {
    position: fixed;
    right: 0;
    bottom: 24px;
    left: 0;
    z-index: 40;
    display: flex;
    justify-content: center;
    padding: 0 24px;
    box-sizing: border-box;
    pointer-events: none;
  }

  .toast-indicator {
    width: 10px;
    height: 10px;
    border-radius: 999px;
    background: #83d58a;
    box-shadow: 0 0 0 4px rgb(131 213 138 / 16%);
    flex: 0 0 auto;
  }

  .scene-meta {
    display: grid;
    gap: 14px;
    margin: 32px 0 0;
  }

  .scene-meta div {
    display: grid;
    grid-template-columns: 140px minmax(0, 1fr);
    gap: 16px;
    padding: 14px 0;
    border-top: 1px solid #e4ded3;
  }

  dt {
    color: #60706b;
    font-weight: 700;
  }

  dd {
    min-width: 0;
    margin: 0;
    overflow-wrap: anywhere;
  }

  .error,
  .empty,
  .placeholder {
    color: #7d3c2f;
  }

  .error {
    margin: 18px 0 0;
    padding: 12px;
    border: 1px solid #d9a99e;
    border-radius: 6px;
    background: #fff4f1;
  }

  .empty {
    margin: 0;
  }

  .placeholder {
    display: grid;
    align-content: center;
    min-height: 280px;
  }

  .placeholder p:last-child {
    margin: 0;
    color: #4f5756;
    font-size: 1.2rem;
  }

  @media (max-width: 800px) {
    .app-shell {
      grid-template-columns: 1fr;
      padding: 20px;
    }

    .detail-header,
    .scene-meta div {
      grid-template-columns: 1fr;
    }

    .detail-header {
      display: grid;
    }

    .save-button {
      width: 100%;
    }

    .save-control {
      justify-items: stretch;
    }
  }
</style>

<script lang="ts">
  import EditorCanvas from "./lib/EditorCanvas.svelte";
  import TargetList from "./lib/TargetList.svelte";
  import {
    editorState,
    loadChapters,
    loadInvestigationScene,
    saveLayout,
    setCharacterLayout,
    setHotspotLayout,
  } from "./lib/layout-store.svelte";

  let requestedChapters = false;
  let currentSublocationId = $state<string | null>(null);
  let currentSublocationScenePath = $state<string | null>(null);

  const investigationScenes = $derived(
    editorState.chapters?.chapters.flatMap((chapter) =>
      chapter.scenes
        .filter((scene) => scene.type === "investigation")
        .map((scene) => ({
          chapterId: chapter.id,
          file: scene.file,
          path: `src-tauri/resources/scenes/${scene.file}`,
        })),
    ) ?? [],
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
</script>

<main class="app-shell">
  <aside class="scene-panel" aria-labelledby="editor-title">
    <p class="eyebrow">Developer Tool</p>
    <h1 id="editor-title">Lyra Layout Editor</h1>

    {#if editorState.error}
      <p class="error">{editorState.error}</p>
    {/if}

    <div class="scene-list" aria-label="Investigation scenes">
      {#each investigationScenes as scene (scene.path)}
        <button
          class:selected={scene.path === editorState.scenePath}
          type="button"
          onclick={() => loadInvestigationScene(scene.path)}
        >
          <span>{scene.chapterId}</span>
          <strong>{scene.file}</strong>
        </button>
      {:else}
        <p class="empty">No investigation scenes loaded.</p>
      {/each}
    </div>

    {#if editorState.scene}
      <TargetList
        scene={editorState.scene}
        {currentSublocationId}
        onSelectSublocation={(sublocationId) =>
          (currentSublocationId = sublocationId)}
      />
    {/if}
  </aside>

  <section class="detail-panel" aria-live="polite">
    {#if editorState.scene}
      <header class="detail-header">
        <div>
          <p class="eyebrow">Scene</p>
          <h2>{editorState.scene.title}</h2>
        </div>
        <button
          type="button"
          class="save-button"
          disabled={!editorState.layout}
          onclick={saveLayout}
        >
          Save Layout
        </button>
      </header>

      <dl class="scene-meta">
        <div>
          <dt>Sublocations</dt>
          <dd>{editorState.scene.sublocations.length}</dd>
        </div>
        <div>
          <dt>Layout file</dt>
          <dd>{editorState.layoutPath}</dd>
        </div>
      </dl>

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

  .scene-list button:hover,
  .scene-list button.selected,
  .save-button:hover {
    border-color: #57776a;
    background: #edf4f0;
  }

  .scene-list span {
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
  }
</style>

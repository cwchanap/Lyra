<script lang="ts">
  import type { GameStateView, SceneNavigationIndex } from "$lib/state/types";

  let {
    index,
    current,
    loading = false,
    disabled = false,
    onSelect,
  }: {
    index: SceneNavigationIndex | null;
    current: GameStateView;
    loading?: boolean;
    disabled?: boolean;
    onSelect: (chapterId: string, sceneId: string) => void;
  } = $props();

  let selectedChapterId = $state<string | null>(null);

  let selectedChapter = $derived(
    index?.chapters.find((chapter) => chapter.id === selectedChapterId) ??
      index?.chapters.find((chapter) => chapter.id === current.chapter.id) ??
      index?.chapters[0] ??
      null,
  );

  $effect(() => {
    const chapters = index?.chapters ?? [];
    const currentChapterId =
      current.mode.type === "gameComplete" ? null : current.chapter.id;
    let nextChapterId = selectedChapterId;

    if (chapters.length === 0) {
      nextChapterId = null;
    } else if (
      !nextChapterId ||
      !chapters.some((chapter) => chapter.id === nextChapterId)
    ) {
      nextChapterId =
        chapters.find((chapter) => chapter.id === currentChapterId)?.id ??
        chapters[0]?.id ??
        null;
    }

    if (selectedChapterId !== nextChapterId) {
      selectedChapterId = nextChapterId;
    }
  });

  function sceneTypeLabel(type: "linear" | "investigation" | "interrogation") {
    if (type === "investigation") return "調查";
    if (type === "interrogation") return "詰問";
    return "對話";
  }
</script>

<section class="scene-navigation-panel" aria-label="場景跳轉">
  {#if loading}
    <p class="empty">場景索引載入中...</p>
  {:else if !index || index.chapters.length === 0}
    <p class="empty">沒有可用場景。</p>
  {:else}
    <div class="chapter-tabs" role="list" aria-label="章節列表">
      {#each index.chapters as chapter (chapter.id)}
        <button
          type="button"
          class:selected={selectedChapter?.id === chapter.id}
          aria-pressed={selectedChapter?.id === chapter.id}
          onclick={() => (selectedChapterId = chapter.id)}
        >
          <span>{String(chapter.index + 1).padStart(2, "0")}</span>
          <strong>{chapter.title}</strong>
        </button>
      {/each}
    </div>

    {#if selectedChapter}
      <ul class="scene-list" aria-label="場景列表">
        {#each selectedChapter.scenes as scene (scene.id)}
          {@const isCurrent =
            selectedChapter.id === current.chapter.id &&
            scene.id === current.scene.id}
          <li>
            <button
              type="button"
              {disabled}
              aria-current={isCurrent ? "true" : undefined}
              onclick={() => onSelect(selectedChapter.id, scene.id)}
            >
              <span class="num">{String(scene.index + 1).padStart(2, "0")}</span
              >
              <span class="copy">
                <strong>{scene.title}</strong>
                <small>{sceneTypeLabel(scene.type)} · {scene.id}</small>
              </span>
              {#if isCurrent}
                <span class="current">目前</span>
              {/if}
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  {/if}
</section>

<style>
  .scene-navigation-panel {
    display: grid;
    gap: 12px;
  }

  .chapter-tabs {
    display: grid;
    gap: 8px;
  }

  .chapter-tabs button,
  .scene-list button {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: 10px;
    width: 100%;
    min-height: 44px;
    padding: 10px 12px;
    border: 1px solid var(--rule-strong);
    background: rgba(236, 228, 207, 0.04);
    color: var(--bone);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .chapter-tabs button.selected,
  .chapter-tabs button:hover,
  .scene-list button:hover:not(:disabled),
  .scene-list button[aria-current="true"] {
    border-color: var(--crimson);
    background: var(--crimson-soft);
  }

  .chapter-tabs span,
  .num,
  .current {
    font-family: var(--impact);
    font-size: 10px;
    letter-spacing: 0.18em;
    color: var(--cyan);
  }

  .chapter-tabs strong,
  .copy strong {
    overflow-wrap: anywhere;
    font-family: var(--serif-jp);
    font-size: 13px;
    letter-spacing: 0.06em;
  }

  .scene-list {
    display: grid;
    gap: 8px;
    max-height: min(38vh, 320px);
    margin: 0;
    padding: 0;
    overflow-y: auto;
    list-style: none;
  }

  .copy {
    display: grid;
    gap: 3px;
    min-width: 0;
  }

  .copy small,
  .empty {
    color: var(--bone-dim);
    font-family: var(--mono);
    font-size: 10px;
    letter-spacing: 0.12em;
  }

  button:disabled {
    opacity: 0.55;
    cursor: wait;
  }
</style>

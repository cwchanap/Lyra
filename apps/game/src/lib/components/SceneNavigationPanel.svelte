<script lang="ts">
  import type { GameStateView, SceneNavigationIndex } from "$lib/state/types";

  let {
    index,
    current,
    loading = false,
    error = false,
    disabled = false,
    onSelect,
    onRetry,
  }: {
    index: SceneNavigationIndex | null;
    current: GameStateView;
    loading?: boolean;
    error?: boolean;
    disabled?: boolean;
    onSelect: (chapterId: string, sceneId: string) => void;
    onRetry?: () => void;
  } = $props();

  let expandedChapterId = $state<string | null>(null);
  let hasAutoExpandedChapter = false;

  $effect(() => {
    const chapters = index?.chapters ?? [];
    const currentChapterId =
      current.mode.type === "gameComplete" ? null : current.chapter.id;
    let nextChapterId = expandedChapterId;

    if (chapters.length === 0) {
      nextChapterId = null;
      hasAutoExpandedChapter = false;
    } else if (!hasAutoExpandedChapter) {
      nextChapterId =
        chapters.find((chapter) => chapter.id === currentChapterId)?.id ??
        chapters[0]?.id ??
        null;
      hasAutoExpandedChapter = true;
    } else if (
      nextChapterId &&
      !chapters.some((chapter) => chapter.id === nextChapterId)
    ) {
      nextChapterId = null;
    }

    if (expandedChapterId !== nextChapterId) {
      expandedChapterId = nextChapterId;
    }
  });

  function sceneTypeLabel(type: "linear" | "investigation" | "interrogation") {
    if (type === "investigation") return "調查";
    if (type === "interrogation") return "詰問";
    return "對話";
  }

  function toggleChapter(chapterId: string) {
    expandedChapterId = expandedChapterId === chapterId ? null : chapterId;
  }
</script>

<section class="scene-navigation-panel" aria-label="場景跳轉">
  {#if loading}
    <p class="empty">場景索引載入中...</p>
  {:else if error}
    <div class="load-error">
      <p class="empty">場景索引載入失敗。</p>
      {#if onRetry}
        <button
          type="button"
          class="retry"
          {disabled}
          onclick={() => onRetry()}
        >
          重試
        </button>
      {/if}
    </div>
  {:else if !index || index.chapters.length === 0}
    <p class="empty">沒有可用場景。</p>
  {:else}
    <div class="chapter-accordion" role="list" aria-label="章節列表">
      {#each index.chapters as chapter (chapter.id)}
        {@const isExpanded = expandedChapterId === chapter.id}
        <section class="chapter-group">
          <button
            type="button"
            class:expanded={isExpanded}
            aria-expanded={isExpanded}
            aria-controls={`scene-list-${chapter.id}`}
            onclick={() => toggleChapter(chapter.id)}
          >
            <span class="chapter-number"
              >{String(chapter.index + 1).padStart(2, "0")}</span
            >
            <strong>{chapter.title}</strong>
            <span class="chapter-state" aria-hidden="true"
              >{isExpanded ? "-" : "+"}</span
            >
          </button>

          {#if isExpanded}
            <ul
              id={`scene-list-${chapter.id}`}
              class="scene-list"
              aria-label={`${chapter.title} 場景列表`}
            >
              {#each chapter.scenes as scene (scene.id)}
                {@const isCurrent =
                  chapter.id === current.chapter.id &&
                  scene.id === current.scene.id}
                <li>
                  <button
                    type="button"
                    {disabled}
                    aria-current={isCurrent ? "true" : undefined}
                    aria-disabled={isCurrent || undefined}
                    title={isCurrent ? "目前場景" : undefined}
                    onclick={() => {
                      // Jumping to the *current* scene is a destructive no-op:
                      // jump_to_scene unconditionally resets inventory and
                      // scene progress, so selecting "where you already are"
                      // would silently wipe the run. Short-circuit it. The
                      // button stays focusable with aria-disabled so assistive
                      // tech still locates the current scene.
                      if (isCurrent) return;
                      onSelect(chapter.id, scene.id);
                    }}
                  >
                    <span class="num"
                      >{String(scene.index + 1).padStart(2, "0")}</span
                    >
                    <span class="copy">
                      <strong>{scene.title}</strong>
                      <small>{sceneTypeLabel(scene.type)} · {scene.id}</small>
                    </span>
                    {#if isCurrent}
                      <span class="current" aria-hidden="true">NOW</span>
                    {/if}
                  </button>
                </li>
              {/each}
            </ul>
          {/if}
        </section>
      {/each}
    </div>
  {/if}
</section>

<style>
  .scene-navigation-panel {
    display: grid;
    gap: 12px;
    min-height: 0;
  }

  .chapter-accordion {
    display: grid;
    gap: 8px;
    min-height: 0;
    max-height: 100%;
    overflow-y: auto;
    padding-right: 2px;
  }

  .chapter-group {
    display: grid;
    gap: 8px;
  }

  .chapter-group > button,
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

  .chapter-group > button.expanded,
  .chapter-group > button:hover,
  .scene-list button:hover:not(:disabled),
  .scene-list button[aria-current="true"] {
    border-color: var(--crimson);
    background: var(--crimson-soft);
  }

  .chapter-number,
  .num,
  .current,
  .chapter-state {
    font-family: var(--impact);
    font-size: 10px;
    letter-spacing: 0.18em;
    color: var(--cyan);
  }

  .chapter-group > button strong,
  .copy strong {
    overflow-wrap: anywhere;
    font-family: var(--serif-jp);
    font-size: 13px;
    letter-spacing: 0.06em;
  }

  .scene-list {
    display: grid;
    gap: 8px;
    margin: 0;
    padding: 0;
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

  .load-error {
    display: grid;
    gap: 10px;
    justify-content: start;
  }

  .retry {
    justify-self: start;
    min-height: 36px;
    padding: 6px 14px;
    border: 1px solid var(--crimson);
    background: var(--crimson-soft);
    color: var(--bone);
    font: inherit;
    font-family: var(--impact);
    font-size: 11px;
    letter-spacing: 0.18em;
    cursor: pointer;
  }

  .retry:hover:not(:disabled) {
    background: var(--crimson);
    color: var(--bone);
  }

  .retry:disabled {
    opacity: 0.55;
    cursor: wait;
  }
</style>

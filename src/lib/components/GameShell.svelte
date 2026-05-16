<script lang="ts">
  import type { Snippet } from "svelte";
  import type { GameStateView } from "../state/types";

  let {
    gameState,
    onReset,
    children,
  }: {
    gameState: GameStateView;
    onReset: () => void;
    children: Snippet;
  } = $props();
</script>

<header>
  <div>
    <small class="eyebrow">第 {gameState.chapter.index + 1} 章 / {gameState.chapter.total}</small>
    <h1>{gameState.chapter.title}</h1>
    <p class="summary">{gameState.chapter.summary}</p>
  </div>
  <button type="button" onclick={onReset}>重新開始</button>
</header>

{@render children()}

<style>
  header {
    display: flex; align-items: flex-start; justify-content: space-between;
    padding: 24px; border-bottom: 1px solid #30363d; background: #0d1117; color: #e6edf3;
  }
  .eyebrow { color: #58a6ff; font-size: 0.75rem; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; }
  h1 { margin: 4px 0 6px; font-size: 1.4rem; }
  .summary { margin: 0; color: #8b949e; max-width: 600px; }
  header > button {
    padding: 8px 14px; background: transparent; color: #d0d7de;
    border: 1px solid #30363d; border-radius: 6px; cursor: pointer; font: inherit;
  }
  header > button:hover { border-color: #58a6ff; }
</style>

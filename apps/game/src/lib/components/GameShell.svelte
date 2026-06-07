<script lang="ts">
  import type { Snippet } from "svelte";
  import type { GameStateView } from "../state/types";
  import GameAtmosphere from "./GameAtmosphere.svelte";

  let {
    gameState,
    onReset,
    disabled = false,
    children,
  }: {
    gameState: GameStateView;
    onReset: () => void;
    disabled?: boolean;
    children: Snippet;
  } = $props();
</script>

<div class="shell">
  <GameAtmosphere intensity={0.55} />

  <header>
    <div class="left">
      <span class="case-marker">
        <span class="diamond"></span>
        FILE&nbsp;{String(gameState.chapter.index + 1).padStart(
          2,
          "0",
        )}&nbsp;/&nbsp;{String(gameState.chapter.total).padStart(2, "0")}
      </span>
      <div class="title-row">
        <p class="eyebrow">
          第&nbsp;{gameState.chapter.index + 1}&nbsp;章&nbsp;·&nbsp;CHAPTER
        </p>
        <h1>{gameState.chapter.title}</h1>
      </div>
      <p class="summary">{gameState.chapter.summary}</p>
    </div>
    <button type="button" onclick={onReset} {disabled}>
      <span class="x">✕</span>
      <span>結束<br /><span class="en">CLOSE&nbsp;CASE</span></span>
    </button>
  </header>

  <div class="rule"></div>

  <main>
    {@render children()}
  </main>
</div>

<style>
  .shell {
    position: relative;
    min-height: 100vh;
    color: var(--bone);
    isolation: isolate;
  }

  header {
    position: relative;
    z-index: 2;
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 32px;
    padding: 22px clamp(20px, 3vw, 40px) 18px;
  }

  .left {
    display: flex;
    flex-direction: column;
    gap: 10px;
    max-width: 720px;
  }

  .case-marker {
    align-self: flex-start;
    display: inline-flex;
    align-items: center;
    gap: 10px;
    font-family: var(--impact);
    font-weight: 500;
    font-size: 11px;
    letter-spacing: 0.32em;
    color: var(--bone);
    padding: 6px 11px 5px;
    border: 1px solid var(--crimson);
    background: var(--crimson-soft);
    text-transform: uppercase;
  }

  .case-marker .diamond {
    width: 5px;
    height: 5px;
    background: var(--crimson);
    transform: rotate(45deg);
    box-shadow: 0 0 7px var(--crimson);
  }

  .title-row {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .eyebrow {
    margin: 0;
    font-family: var(--impact);
    font-weight: 500;
    font-size: 11px;
    letter-spacing: 0.32em;
    color: var(--cyan);
    text-transform: uppercase;
  }

  h1 {
    margin: 0;
    font-family: var(--display-jp);
    font-weight: 400;
    font-size: clamp(22px, 2.4vw, 30px);
    line-height: 1.05;
    letter-spacing: 0.06em;
    color: var(--bone);
    text-shadow: 2px 2px 0 var(--cell);
  }

  .summary {
    margin: 4px 0 0;
    color: var(--bone-dim);
    font-family: var(--serif-jp);
    font-size: 13px;
    line-height: 1.55;
    max-width: 56ch;
  }

  header > button {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 14px 9px;
    background: transparent;
    color: var(--bone-dim);
    border: 1px solid var(--rule-strong);
    cursor: pointer;
    font: inherit;
    font-size: 12px;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    line-height: 1.2;
    text-align: left;
    transition:
      color 0.18s,
      border-color 0.18s,
      background 0.18s;
  }

  header > button:hover:not(:disabled) {
    color: var(--crimson);
    border-color: var(--crimson);
    background: var(--crimson-soft);
  }

  header > button:disabled {
    opacity: 0.55;
    cursor: wait;
  }

  header > button .x {
    font-family: var(--display-jp);
    font-size: 16px;
    line-height: 1;
  }

  header > button .en {
    font-family: var(--impact);
    font-size: 9px;
    letter-spacing: 0.24em;
    color: var(--bone-faint);
  }

  .rule {
    position: relative;
    z-index: 2;
    height: 1px;
    margin: 0 clamp(20px, 3vw, 40px);
    background: linear-gradient(
      90deg,
      transparent,
      var(--rule-strong) 12%,
      var(--rule-strong) 88%,
      transparent
    );
  }

  main {
    position: relative;
    z-index: 2;
  }
</style>

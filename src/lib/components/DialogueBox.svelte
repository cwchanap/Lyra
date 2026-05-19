<script lang="ts">
  import type { DialogueItem, QueueToken } from "../state/types";

  let { current, queueToken, onAdvance, disabled = false }: {
    current: DialogueItem;
    queueToken: QueueToken;
    onAdvance: (t: QueueToken) => void;
    disabled?: boolean;
  } = $props();

  function handleClick() {
    if (disabled) return;
    onAdvance(queueToken);
  }
  function handleKey(e: KeyboardEvent) {
    if (disabled) return;
    if (e.repeat) return;
    if (e.key !== " " && e.key !== "Enter") return;
    const active = document.activeElement;
    if (active && active !== document.body) return;
    e.preventDefault();
    onAdvance(queueToken);
  }
</script>

<svelte:window onkeydown={handleKey} />

<button class="box" onclick={handleClick} type="button" aria-label="推進對話" {disabled}>
  {#if current.kind === "sceneTag"}
    <span class="placeholder">（場景切換）</span>
  {:else if current.kind === "action"}
    <p class="action">{current.text}</p>
  {:else if current.kind === "line"}
    <div class="line">
      <span class="speaker">{current.speaker}</span>
      <p class="text">{current.text}</p>
    </div>
  {/if}
  <span class="hint">點擊或按 Space ▶</span>
</button>

<style>
  .box {
    position: fixed;
    left: 50%;
    bottom: 32px;
    transform: translateX(-50%);
    min-width: 60ch;
    max-width: 80ch;
    padding: 24px 28px 32px;
    background: rgba(13, 17, 23, 0.95);
    color: #e6edf3;
    border: 1px solid #30363d;
    border-radius: 12px;
    text-align: left;
    cursor: pointer;
    font: inherit;
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.4);
  }
  .box:hover { border-color: #58a6ff; }
  .box:disabled { cursor: wait; opacity: 0.72; }
  .speaker { font-weight: 700; color: #58a6ff; display: block; margin-bottom: 6px; }
  .text { margin: 0; line-height: 1.6; }
  .action { margin: 0; font-style: italic; color: #8b949e; text-align: center; }
  .placeholder { color: #8b949e; font-style: italic; }
  .hint { position: absolute; right: 14px; bottom: 8px; font-size: 0.75rem; color: #8b949e; }
</style>

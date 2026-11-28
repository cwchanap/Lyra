<script lang="ts">
  let {
    disabled = false,
    onOpen,
  }: {
    disabled?: boolean;
    onOpen?: (trigger: HTMLElement) => void;
  } = $props();
</script>

<button
  type="button"
  data-game-menu-trigger=""
  {disabled}
  onclick={(event) => onOpen?.(event.currentTarget)}
>
  遊戲選單
</button>

<style>
  button {
    box-sizing: border-box;
    flex: none;
    min-height: 44px;
    padding: 8px 12px;
    border: 1px solid var(--rule-strong);
    background: rgba(8, 8, 14, 0.78);
    color: var(--bone);
    font: inherit;
    font-family: var(--serif-jp);
    font-size: 13px;
    letter-spacing: 0.06em;
    white-space: nowrap;
    cursor: pointer;
    pointer-events: auto;
  }

  button:hover:not(:disabled),
  button:focus-visible {
    border-color: var(--crimson);
    background: var(--crimson-soft);
    outline: 2px solid var(--crimson);
    outline-offset: 2px;
  }

  button:disabled {
    opacity: 0.55;
    cursor: wait;
  }
</style>

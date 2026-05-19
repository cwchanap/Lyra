<script lang="ts">
  let { onReset, disabled = false }: { onReset: () => void; disabled?: boolean } = $props();
</script>

<section class="complete">
  <h1>第零證人</h1>
  <p>調查結束。</p>
  <button onclick={onReset} type="button" {disabled}>重新開始</button>
</section>

<style>
  .complete { display: grid; place-items: center; min-height: 60vh; gap: 16px; color: #e6edf3; text-align: center; }
  button { padding: 10px 22px; background: #58a6ff; color: #0d1117; border: 0; border-radius: 8px; cursor: pointer; font: inherit; font-weight: 700; }
  button:disabled { opacity: 0.6; cursor: wait; }
</style>

<script lang="ts">
  let { onReset, disabled = false }: { onReset: () => void; disabled?: boolean } = $props();
</script>

<section class="complete">
  <div class="stamp-wrap">
    <span class="stamp">案件結案</span>
    <span class="stamp-en">CASE&nbsp;CLOSED</span>
  </div>

  <h1>
    <span class="zh">第零證人</span>
    <span class="en">— ZERO WITNESS —</span>
  </h1>

  <p class="line">調查結束。<br /><em>The dossier closes — but the rain keeps falling.</em></p>

  <button onclick={onReset} type="button" {disabled}>
    <span class="num">00</span>
    <span class="label">
      <span class="lbl-zh">重新開啟</span>
      <span class="lbl-en">RESTART&nbsp;CASE</span>
    </span>
    <span class="chip">▶</span>
  </button>
</section>

<style>
  .complete {
    position: relative;
    display: grid;
    place-items: center;
    min-height: 70vh;
    gap: 32px;
    padding: 64px 24px;
    color: var(--bone);
    text-align: center;
  }

  .stamp-wrap {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    transform: rotate(-3deg);
  }

  .stamp {
    display: inline-block;
    padding: 12px 22px 10px;
    font-family: var(--display-jp);
    font-size: 22px;
    letter-spacing: 0.32em;
    color: var(--crimson);
    border: 3px solid var(--crimson);
    background:
      repeating-linear-gradient(
        45deg,
        transparent 0,
        transparent 6px,
        rgba(212, 20, 58, 0.06) 6px,
        rgba(212, 20, 58, 0.06) 7px
      );
    text-shadow: 0 0 12px rgba(212, 20, 58, 0.45);
    box-shadow: inset 0 0 0 1px rgba(212, 20, 58, 0.4);
  }

  .stamp-en {
    font-family: var(--impact);
    font-size: 10px;
    letter-spacing: 0.42em;
    color: var(--crimson);
    text-transform: uppercase;
  }

  h1 {
    margin: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
  }

  h1 .zh {
    font-family: var(--display-jp);
    font-weight: 400;
    font-size: clamp(40px, 5vw, 64px);
    letter-spacing: 0.12em;
    line-height: 0.95;
    color: var(--bone);
    text-shadow: 4px 4px 0 var(--cell);
  }

  h1 .en {
    font-family: var(--serif-it);
    font-style: italic;
    font-size: 13px;
    letter-spacing: 0.42em;
    color: var(--bone-dim);
    text-transform: uppercase;
  }

  .line {
    margin: 0;
    font-family: var(--serif-jp);
    font-size: 15px;
    line-height: 1.7;
    color: var(--bone-dim);
    max-width: 48ch;
  }

  .line em {
    font-family: var(--serif-it);
    font-style: italic;
    color: var(--bone-faint);
  }

  button {
    display: grid;
    grid-template-columns: 56px 1fr auto;
    align-items: center;
    gap: 18px;
    padding: 16px 20px 16px 22px;
    background: var(--char);
    color: var(--bone);
    border: 1px solid var(--rule-strong);
    cursor: pointer;
    font: inherit;
    text-align: left;
    clip-path: polygon(0 0, calc(100% - 16px) 0, 100% 16px, 100% 100%, 16px 100%, 0 calc(100% - 16px));
    transition: transform 0.18s, background 0.18s, border-color 0.18s;
  }

  button:hover:not(:disabled) {
    transform: translateY(-2px);
    background: var(--char-2);
    border-color: var(--crimson);
  }

  button:disabled {
    opacity: 0.55;
    cursor: wait;
  }

  button .num {
    font-family: var(--impact);
    font-weight: 500;
    font-size: 32px;
    color: var(--crimson);
    line-height: 1;
  }

  button .label {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  button .lbl-zh {
    font-family: var(--display-jp);
    font-size: 18px;
    letter-spacing: 0.12em;
    line-height: 1;
    color: var(--bone);
  }

  button .lbl-en {
    font-family: var(--mono);
    font-size: 10px;
    letter-spacing: 0.24em;
    color: var(--bone-faint);
    text-transform: uppercase;
  }

  button .chip {
    font-family: var(--impact);
    font-size: 14px;
    color: var(--crimson);
    padding: 4px 8px;
    border: 1px solid var(--crimson);
  }
</style>

<script lang="ts">
  import { currentInterrogationPhase } from "$lib/interrogation/presentation";
  import type { SceneView } from "../state/types";

  let {
    scene,
    onAsk,
    onComplete,
    disabled = false,
  }: {
    scene: SceneView;
    onAsk: (questionId: string) => void | Promise<void>;
    onComplete: () => void | Promise<void>;
    disabled?: boolean;
  } = $props();

  let phase = $derived(currentInterrogationPhase(scene));
</script>

{#if phase}
  <section class="interrogation" aria-label="訊問記錄">
    <div class="record-heading">
      <p>訊問記錄</p>
      <span>INQUIRY RECORD</span>
    </div>

    <ul class="menu">
      {#each phase.questions as question (question.id)}
        <li>
          <button
            class="qbtn"
            class:broken={question.broken}
            type="button"
            {disabled}
            onclick={() => onAsk(question.id)}
          >
            <span class="ql">{question.label}</span>
            <span class="qs">{question.broken ? "已破" : "提問"}</span>
          </button>
        </li>
      {/each}
    </ul>

    <div class="phase-actions">
      <button
        class="complete"
        type="button"
        disabled={disabled || !phase.canComplete}
        onclick={() => onComplete()}
      >
        完成訊問
      </button>
    </div>
  </section>
{:else if scene.kind === "interrogation"}
  <p class="muted">尚未進入任何訊問階段。</p>
{/if}

<style>
  .interrogation {
    display: grid;
    gap: 14px;
    width: min(960px, 100%);
    margin: 0 auto;
    padding: 24px clamp(20px, 3vw, 40px) 140px;
    color: var(--bone);
  }

  .record-heading {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 16px;
    padding-bottom: 9px;
    border-bottom: 1px solid var(--rule-strong);
  }

  .record-heading p,
  .record-heading span {
    margin: 0;
    font-family: var(--impact);
    font-size: 11px;
    letter-spacing: 0.24em;
    text-transform: uppercase;
  }

  .record-heading p {
    color: var(--bone);
  }

  .record-heading span {
    color: var(--bone-faint);
  }

  .menu {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .qbtn {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    width: 100%;
    min-height: 82px;
    padding: 16px 18px;
    border: 1px solid var(--rule-strong);
    border-left: 2px solid rgba(236, 228, 207, 0.2);
    background: rgba(9, 9, 15, 0.72);
    color: var(--bone);
    cursor: pointer;
    font: inherit;
    text-align: left;
    transition:
      transform 0.18s ease,
      background 0.18s ease,
      border-color 0.18s ease;
  }

  .qbtn::before {
    content: "";
    position: absolute;
    top: 0;
    left: 0;
    width: 4px;
    height: 100%;
    background: var(--crimson);
    opacity: 0;
    transition: opacity 0.18s ease;
  }

  .qbtn:hover:not(:disabled),
  .qbtn:focus-visible {
    transform: translateY(-2px);
    border-color: var(--crimson);
    background: var(--crimson-soft);
    outline: none;
  }

  .qbtn:hover:not(:disabled)::before,
  .qbtn:focus-visible::before {
    opacity: 1;
  }

  .qbtn.broken {
    border-color: rgba(71, 184, 203, 0.35);
    border-left-color: var(--cyan);
    background: rgba(71, 184, 203, 0.07);
  }

  .qbtn.broken::before {
    background: var(--cyan);
  }

  .qbtn:disabled {
    cursor: wait;
    opacity: 0.55;
  }

  .ql {
    font-family: var(--serif-jp);
    font-size: 16px;
    line-height: 1.45;
  }

  .qs {
    flex: 0 0 auto;
    color: var(--bone-faint);
    font-family: var(--impact);
    font-size: 10px;
    letter-spacing: 0.2em;
  }

  .broken .qs {
    color: var(--cyan);
  }

  .phase-actions {
    display: flex;
    justify-content: end;
    padding-top: 2px;
  }

  .complete {
    min-width: 156px;
    min-height: 42px;
    border: 1px solid var(--crimson);
    background: var(--crimson-soft);
    color: var(--bone);
    cursor: pointer;
    font: inherit;
    font-family: var(--serif-jp);
    letter-spacing: 0.1em;
  }

  .complete:disabled {
    border-color: var(--rule-strong);
    background: rgba(236, 228, 207, 0.04);
    color: var(--bone-faint);
    cursor: not-allowed;
  }

  .muted {
    margin: 0;
    padding: 24px clamp(20px, 3vw, 40px);
    color: var(--bone-faint);
    font-family: var(--serif-jp);
  }

  @media (max-width: 720px) {
    .interrogation {
      padding-bottom: 110px;
    }

    .menu {
      grid-template-columns: 1fr;
    }

    .record-heading span {
      display: none;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .qbtn,
    .qbtn::before {
      transition: none;
    }
  }
</style>

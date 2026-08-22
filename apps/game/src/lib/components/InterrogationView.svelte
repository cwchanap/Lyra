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
  <section
    class="interrogation"
    aria-label="訊問記錄"
    data-interrogation-question-record=""
  >
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
            <span class="q-copy">
              <span class="q-dot" aria-hidden="true"></span>
              <span class="ql">{question.label}</span>
            </span>
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
    position: absolute;
    left: 50%;
    bottom: 28px;
    width: min(1000px, calc(100% - 56px));
    transform: translateX(-50%);
    max-height: max(160px, calc(100% - 250px));
    overflow: auto;
    box-sizing: border-box;
    z-index: 25;
    display: flex;
    flex-direction: column;
    color: var(--bone);
    background: linear-gradient(
      180deg,
      rgba(14, 14, 22, 0.95),
      rgba(20, 13, 24, 0.97)
    );
    backdrop-filter: blur(10px);
    border: 1px solid rgba(236, 228, 207, 0.28);
    border-top: 3px solid var(--crimson);
    box-shadow: 0 26px 64px rgba(0, 0, 0, 0.68);
    clip-path: polygon(
      0 0,
      100% 0,
      100% calc(100% - 22px),
      calc(100% - 22px) 100%,
      0 100%
    );
  }

  .record-heading {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
    padding: 18px 30px 14px;
    border-bottom: 1px solid rgba(236, 228, 207, 0.14);
  }

  .record-heading p,
  .record-heading span {
    margin: 0;
    text-transform: uppercase;
  }

  .record-heading p {
    color: var(--bone);
    font-family: var(--display-jp);
    font-size: 17px;
    font-weight: 400;
    letter-spacing: 0.16em;
  }

  .record-heading span {
    color: var(--bone-faint);
    font-family: var(--mono);
    font-size: 10px;
    letter-spacing: 0.2em;
  }

  .menu {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px;
    margin: 0;
    padding: 16px 30px 22px;
    list-style: none;
  }

  .qbtn {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    width: 100%;
    min-height: 0;
    padding: 15px 16px;
    box-sizing: border-box;
    border: 1px solid rgba(236, 228, 207, 0.32);
    background: rgba(29, 29, 43, 0.82);
    color: var(--bone);
    cursor: pointer;
    font: inherit;
    text-align: left;
    clip-path: polygon(0 0, calc(100% - 14px) 0, 100% 14px, 100% 100%, 0 100%);
    transition:
      transform 0.18s ease,
      background 0.18s ease,
      border-color 0.18s ease;
  }

  .qbtn:hover:not(:disabled),
  .qbtn:focus-visible {
    transform: translateY(-2px);
    border-color: var(--crimson);
    background: rgba(212, 20, 58, 0.12);
    outline: none;
  }

  .q-copy {
    display: flex;
    align-items: center;
    min-width: 0;
    gap: 10px;
    text-align: left;
  }

  .q-dot {
    width: 6px;
    height: 6px;
    flex: 0 0 auto;
    transform: rotate(45deg);
    background: var(--crimson);
  }

  .qbtn.broken {
    background: rgba(20, 20, 31, 0.55);
    border-color: rgba(236, 228, 207, 0.18);
    opacity: 0.62;
  }

  .qbtn.broken .q-dot {
    background: var(--bone-faint);
  }

  .qbtn:disabled {
    border-style: dashed;
    border-color: rgba(236, 228, 207, 0.2);
    background: rgba(20, 20, 31, 0.5);
    cursor: not-allowed;
    opacity: 0.5;
  }

  .qbtn:disabled .q-dot {
    background: transparent;
    border: 1px solid var(--bone-faint);
  }

  .ql {
    min-width: 0;
    font-family: var(--display-jp);
    font-size: 13.5px;
    font-weight: 400;
    line-height: 1.5;
    letter-spacing: 0.08em;
  }

  .qs {
    flex: 0 0 auto;
    color: var(--crimson);
    font-family: var(--mono);
    font-size: 9.5px;
    letter-spacing: 0.24em;
  }

  .broken .qs,
  .qbtn:disabled .qs {
    color: var(--bone-faint);
  }

  .phase-actions {
    display: flex;
    align-items: center;
    justify-content: end;
    padding: 0 30px 22px;
  }

  .complete {
    min-width: 156px;
    min-height: 42px;
    padding: 11px 22px 10px;
    border: 1px solid var(--crimson);
    background: var(--crimson-soft);
    color: var(--crimson);
    cursor: pointer;
    font: inherit;
    font-family: var(--display-jp);
    font-size: 13px;
    letter-spacing: 0.16em;
    clip-path: polygon(0 0, calc(100% - 12px) 0, 100% 12px, 100% 100%, 0 100%);
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
    .menu {
      grid-template-columns: 1fr;
      padding: 14px 20px 18px;
    }

    .record-heading {
      padding: 16px 20px 12px;
    }

    .phase-actions {
      padding: 0 20px 18px;
    }

    .record-heading span {
      display: none;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .qbtn {
      transition: none;
    }
  }
</style>

<script lang="ts">
  import type { Snippet } from "svelte";
  import {
    brokenQuestionProgress,
    currentInterrogationPhase,
  } from "$lib/interrogation/presentation";
  import type { Inventory, Mode, SceneView } from "../state/types";
  import InterrogationEvidenceTray from "./InterrogationEvidenceTray.svelte";

  let {
    active,
    scene,
    mode,
    inventory,
    onPresent,
    onResume,
    onOpenCaseFile,
    disabled = false,
    children,
  }: {
    active: boolean;
    scene: SceneView;
    mode: Mode;
    inventory: Inventory;
    onPresent: (
      lineId: string,
      kind: "evidence" | "statement",
      itemId: string,
    ) => void | Promise<void>;
    onResume: () => void | Promise<void>;
    onOpenCaseFile: (trigger: HTMLElement) => void;
    disabled?: boolean;
    children: Snippet;
  } = $props();

  let stageRoot: HTMLDivElement | undefined = $state();
  let trayReturnFocus = $state<HTMLElement | null>(null);
  let wasPresenting = false;

  let phase = $derived(currentInterrogationPhase(scene));
  let progress = $derived(brokenQuestionProgress(phase));
  let crossExam = $derived(phase?.crossExam ?? null);
  let presenting = $derived(active && crossExam?.presenting === true);

  $effect(() => {
    if (presenting && !wasPresenting) {
      const activeElement = document.activeElement;
      trayReturnFocus =
        activeElement instanceof HTMLElement ? activeElement : null;
    }
    wasPresenting = presenting;
  });

  function openCaseFile(event: MouseEvent) {
    if (disabled) return;
    const trigger = event.currentTarget;
    if (trigger instanceof HTMLElement) {
      onOpenCaseFile(trigger);
    }
  }
</script>

<div
  bind:this={stageRoot}
  class="interrogation-stage"
  class:active
  data-interrogation-mode={mode.type}
  tabindex="-1"
>
  {#if active && phase}
    <section class="stage-chrome" aria-label="訊問舞台">
      <div class="subject-record">
        <p class="eyebrow">INTERROGATION / 訊問中</p>
        <h2>{phase.subject.name}</h2>
        <p class="role">{phase.subject.role}</p>
      </div>

      <div class="phase-record" aria-label="訊問進度">
        <p>{phase.label}</p>
        <strong>{progress.broken} / {progress.total}</strong>
        <span>突破題目</span>
      </div>

      <button
        class="case-file-hud"
        type="button"
        {disabled}
        onclick={openCaseFile}
      >
        <span>案件檔案</span>
        <span>CASE FILE</span>
      </button>
    </section>
  {/if}

  {@render children()}

  {#if presenting && crossExam}
    <InterrogationEvidenceTray
      {crossExam}
      {inventory}
      {onPresent}
      {onResume}
      {disabled}
      returnFocusTo={trayReturnFocus}
      fallbackFocusTarget={stageRoot}
    />
  {/if}
</div>

<style>
  .interrogation-stage {
    position: relative;
    min-height: 100%;
  }

  .stage-chrome {
    position: relative;
    z-index: 4;
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto auto;
    align-items: center;
    gap: clamp(14px, 2vw, 28px);
    width: min(1180px, calc(100% - clamp(40px, 6vw, 80px)));
    margin: 0 auto;
    padding: 24px 0 10px;
    border-bottom: 1px solid var(--rule-strong);
    color: var(--bone);
  }

  .subject-record,
  .phase-record {
    min-width: 0;
  }

  .eyebrow,
  .subject-record h2,
  .subject-record .role,
  .phase-record p,
  .phase-record strong,
  .phase-record span {
    margin: 0;
  }

  .eyebrow,
  .phase-record span,
  .case-file-hud span:last-child {
    font-family: var(--impact);
    font-size: 10px;
    letter-spacing: 0.22em;
    text-transform: uppercase;
  }

  .eyebrow {
    color: var(--crimson);
  }

  .subject-record h2 {
    margin-top: 4px;
    font-family: var(--display-jp);
    font-size: clamp(24px, 3vw, 38px);
    font-weight: 400;
    line-height: 1.05;
    letter-spacing: 0.08em;
  }

  .subject-record .role {
    margin-top: 5px;
    color: var(--bone-dim);
    font-family: var(--serif-jp);
    font-size: 13px;
  }

  .phase-record {
    display: grid;
    grid-template-columns: auto auto;
    column-gap: 8px;
    align-items: baseline;
    padding-left: clamp(14px, 2vw, 28px);
    border-left: 1px solid var(--rule-strong);
    text-align: right;
  }

  .phase-record p {
    grid-column: 1 / -1;
    color: var(--bone-dim);
    font-family: var(--serif-jp);
    font-size: 12px;
  }

  .phase-record strong {
    color: var(--cyan);
    font-family: var(--impact);
    font-size: 24px;
    font-weight: 500;
    letter-spacing: 0.08em;
  }

  .phase-record span {
    color: var(--bone-faint);
  }

  .case-file-hud {
    display: grid;
    gap: 2px;
    min-width: 112px;
    padding: 10px 12px;
    border: 1px solid var(--rule-strong);
    background: rgba(9, 9, 15, 0.72);
    color: var(--bone);
    cursor: pointer;
    font: inherit;
    text-align: left;
    transition:
      border-color 0.18s ease,
      background 0.18s ease;
  }

  .case-file-hud span:first-child {
    font-family: var(--serif-jp);
    font-size: 13px;
  }

  .case-file-hud span:last-child {
    color: var(--bone-faint);
  }

  .case-file-hud:hover:not(:disabled),
  .case-file-hud:focus-visible {
    border-color: var(--cyan);
    background: rgba(71, 184, 203, 0.1);
    outline: none;
  }

  .case-file-hud:disabled {
    cursor: wait;
    opacity: 0.55;
  }

  @media (max-width: 720px) {
    .stage-chrome {
      grid-template-columns: minmax(0, 1fr) auto;
      width: calc(100% - 40px);
      gap: 12px;
      padding-top: 18px;
    }

    .phase-record {
      grid-column: 1 / -1;
      grid-template-columns: auto auto;
      justify-content: start;
      padding: 9px 0 0;
      border-top: 1px solid var(--rule-strong);
      border-left: 0;
      text-align: left;
    }

    .phase-record p {
      grid-column: 1 / -1;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .case-file-hud {
      transition: none;
    }
  }
</style>

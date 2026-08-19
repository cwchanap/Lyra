<script lang="ts">
  import type { Snippet } from "svelte";
  import {
    brokenQuestionProgress,
    currentInterrogationPhase,
  } from "$lib/interrogation/presentation";
  import type {
    Inventory,
    Mode,
    ObjectiveView,
    PortraitRef,
    SceneView,
  } from "../state/types";
  import InterrogationEvidenceTray from "./InterrogationEvidenceTray.svelte";
  import InterrogationSubjectArt from "./InterrogationSubjectArt.svelte";
  import PrimaryObjectiveHud from "./PrimaryObjectiveHud.svelte";
  import SceneBackdrop from "./SceneBackdrop.svelte";

  let {
    active,
    scene,
    mode,
    inventory,
    onPresent,
    onResume,
    onOpenGameMenu,
    onOpenCaseFile,
    activePrimaryObjective = null,
    disabled = false,
    topLayerOpen = false,
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
    onOpenGameMenu: (trigger: HTMLElement) => void;
    onOpenCaseFile: (trigger: HTMLElement) => void;
    activePrimaryObjective?: ObjectiveView | null;
    disabled?: boolean;
    // Forwarded to InterrogationEvidenceTray so its Tab trap suspends while
    // an upper layer (Game Menu / Save Browser / acquisition popup) is open.
    topLayerOpen?: boolean;
    children: Snippet;
  } = $props();

  let stageRoot: HTMLDivElement | undefined = $state();
  let trayReturnFocus = $state<HTMLElement | null>(null);
  let wasPresenting = false;

  let phase = $derived(currentInterrogationPhase(scene));
  let progress = $derived(brokenQuestionProgress(phase));
  let crossExam = $derived(phase?.crossExam ?? null);
  let presenting = $derived(active && crossExam?.presenting === true);
  let activePortrait = $derived<PortraitRef | null>(
    mode.type === "dialogue" &&
      mode.current.kind === "line" &&
      mode.current.portrait !== null
      ? (mode.current.portrait ?? phase?.subject.portrait ?? null)
      : (phase?.subject.portrait ?? null),
  );
  let stageBackdrop = $derived.by<{
    sceneTag: string | null;
    backgroundAssetId: string | null;
  } | null>(() => {
    if (!active) return null;
    if (mode.type === "dialogue") {
      return {
        sceneTag: mode.sceneTag,
        backgroundAssetId: mode.backgroundAssetId ?? null,
      };
    }
    if (mode.type === "interrogation") {
      return {
        sceneTag: null,
        backgroundAssetId: mode.backgroundAssetId ?? null,
      };
    }
    return null;
  });

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
  {#if active}
    {#if stageBackdrop}
      <SceneBackdrop
        sceneTag={stageBackdrop.sceneTag}
        backgroundAssetId={stageBackdrop.backgroundAssetId}
      />
    {/if}

    <InterrogationSubjectArt portrait={activePortrait} />

    <section class="stage-chrome" aria-label="訊問舞台">
      <div class="stage-left-stack">
        <PrimaryObjectiveHud objective={activePrimaryObjective} />
        {#if phase}
          <div class="subject-record">
            <p class="eyebrow">INTERROGATION / 訊問中</p>
            <h2>{phase.subject.name}</h2>
            <p class="role">{phase.subject.role}</p>
            <div class="phase-record" aria-label="訊問進度">
              <p>{phase.label}</p>
              <strong>{progress.broken} / {progress.total}</strong>
              <span>突破題目</span>
            </div>
          </div>
        {/if}
      </div>

      {#if phase}
        <button
          class="case-file-hud"
          type="button"
          {disabled}
          onclick={openCaseFile}
        >
          <span class="case-file-ghost">案件檔案</span>
          <span class="case-file-accent">CASE FILE</span>
        </button>
      {/if}
    </section>
  {/if}

  {@render children()}

  {#if presenting && crossExam}
    <InterrogationEvidenceTray
      {crossExam}
      {inventory}
      {onPresent}
      {onResume}
      {onOpenGameMenu}
      {disabled}
      {topLayerOpen}
      returnFocusTo={trayReturnFocus}
      fallbackFocusTarget={stageRoot}
    />
  {/if}
</div>

<style>
  .interrogation-stage {
    position: relative;
  }

  .interrogation-stage.active {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 100%;
  }

  .stage-chrome {
    position: absolute;
    z-index: 4;
    inset: 0;
    width: 100%;
    margin: 0;
    padding: 0;
    color: var(--bone);
    pointer-events: none;
  }

  .stage-left-stack,
  .subject-record,
  .phase-record {
    min-width: 0;
  }

  .stage-left-stack {
    position: absolute;
    top: 24px;
    left: 26px;
    display: grid;
    width: min(560px, calc(100% - 52px));
    gap: 14px;
    pointer-events: none;
  }

  .stage-left-stack :global(.primary-objective-hud) {
    position: relative;
    max-width: none;
    padding: 0 0 0 17px;
    border-left: 0;
    background: transparent;
  }

  .stage-left-stack :global(.primary-objective-hud)::before {
    position: absolute;
    inset: 0 auto 0 0;
    width: 3px;
    background: linear-gradient(var(--crimson), rgba(212, 20, 58, 0));
    content: "";
  }

  .stage-left-stack :global(.primary-objective-hud .eyebrow) {
    color: var(--bone-faint);
    font-family: var(--impact);
    font-size: 10px;
    letter-spacing: 0.34em;
  }

  .stage-left-stack :global(.primary-objective-hud .label) {
    color: var(--bone);
    font-family: var(--serif-jp);
    font-size: 15px;
    letter-spacing: 0.04em;
  }

  .stage-left-stack .subject-record {
    padding: 12px 18px 14px;
    background: rgba(20, 20, 31, 0.82);
    backdrop-filter: blur(6px);
    border: 1px solid rgba(236, 228, 207, 0.32);
    border-left: 3px solid var(--crimson);
    clip-path: polygon(0 0, calc(100% - 16px) 0, 100% 16px, 100% 100%, 0 100%);
  }

  .stage-left-stack .subject-record > .eyebrow {
    display: none;
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
  .case-file-accent {
    font-family: var(--impact);
    font-size: 10px;
    letter-spacing: 0.22em;
    text-transform: uppercase;
  }

  .eyebrow {
    color: var(--crimson);
  }

  .subject-record h2 {
    margin-top: 0;
    color: var(--bone);
    font-family: var(--display-jp);
    font-size: 22px;
    font-weight: 400;
    line-height: 1.1;
    letter-spacing: 0.12em;
  }

  .subject-record .role {
    margin-top: 5px;
    color: var(--bone-dim);
    font-family: var(--serif-jp);
    font-size: 12px;
    letter-spacing: 0.1em;
  }

  .phase-record {
    display: grid;
    grid-template-columns: 1fr auto;
    column-gap: 8px;
    align-items: baseline;
    margin-top: 12px;
    padding-top: 10px;
    border-top: 1px solid rgba(236, 228, 207, 0.14);
    text-align: left;
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
    font-size: 20px;
    font-weight: 500;
    letter-spacing: 0.08em;
  }

  .phase-record span {
    color: var(--bone-faint);
  }

  .case-file-hud {
    position: absolute;
    top: 24px;
    right: 26px;
    z-index: 1;
    display: inline-flex;
    align-items: stretch;
    gap: 4px;
    min-width: 0;
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--bone);
    cursor: pointer;
    font: inherit;
    text-align: left;
    pointer-events: auto;
    transition:
      border-color 0.18s ease,
      background 0.18s ease;
  }

  .case-file-ghost,
  .case-file-accent {
    display: inline-flex;
    align-items: center;
    min-height: 38px;
    padding: 8px 12px;
    box-sizing: border-box;
  }

  .case-file-ghost {
    border: 1px solid var(--rule-strong);
    background: transparent;
    color: var(--bone-dim);
    font-family: var(--serif-jp);
    font-size: 13px;
  }

  .case-file-accent {
    border: 1px solid var(--crimson);
    background: var(--crimson-soft);
    color: var(--bone);
    clip-path: polygon(0 0, calc(100% - 10px) 0, 100% 10px, 100% 100%, 0 100%);
  }

  .case-file-hud:hover:not(:disabled) .case-file-ghost,
  .case-file-hud:focus-visible .case-file-ghost {
    border-color: var(--crimson);
    color: var(--bone);
  }

  .case-file-hud:hover:not(:disabled) .case-file-accent,
  .case-file-hud:focus-visible .case-file-accent {
    background: rgba(174, 28, 49, 0.34);
    outline: none;
  }

  .case-file-hud:disabled {
    cursor: wait;
    opacity: 0.55;
  }

  @media (max-width: 720px) {
    .stage-left-stack {
      top: 18px;
      left: 20px;
      width: min(420px, calc(100% - 40px));
      gap: 10px;
    }

    .stage-left-stack .subject-record {
      padding: 10px 14px 12px;
    }

    .case-file-hud {
      top: 18px;
      right: 20px;
      min-width: 0;
      padding: 8px 10px;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .case-file-hud {
      transition: none;
    }
  }
</style>

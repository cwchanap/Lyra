<script lang="ts">
  import { tick } from "svelte";
  import type { Snippet } from "svelte";
  import {
    brokenQuestionProgress,
    currentInterrogationPhase,
  } from "$lib/interrogation/presentation";
  import type { CaseFileSection } from "$lib/case-file/types";
  import type {
    DialogueHistoryEntry,
    Inventory,
    Mode,
    ObjectiveView,
    PortraitRef,
    SceneView,
  } from "../state/types";
  import InterrogationEvidenceTray from "./InterrogationEvidenceTray.svelte";
  import DialogueHistoryOverlay from "./DialogueHistoryOverlay.svelte";
  import InterrogationSubjectArt from "./InterrogationSubjectArt.svelte";
  import PrimaryObjectiveHud from "./PrimaryObjectiveHud.svelte";
  import SceneBackdrop from "./SceneBackdrop.svelte";

  let {
    active,
    scene,
    mode,
    inventory,
    history,
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
    onOpenCaseFile: (
      section: Extract<CaseFileSection, "objective" | "evidence">,
      trigger: HTMLElement,
    ) => void;
    history: DialogueHistoryEntry[];
    activePrimaryObjective?: ObjectiveView | null;
    disabled?: boolean;
    // Forwarded to InterrogationEvidenceTray so its Tab trap suspends while
    // an upper layer (Game Menu / Save Browser / acquisition popup) is open.
    topLayerOpen?: boolean;
    children: Snippet;
  } = $props();

  let stageRoot: HTMLDivElement | undefined = $state();
  let trayReturnFocus = $state<HTMLElement | null>(null);
  let stageHistoryOpen = $state(false);
  let stageLogButton: HTMLButtonElement | undefined = $state();
  let wasPresenting = false;

  let phase = $derived(currentInterrogationPhase(scene));
  let progress = $derived(brokenQuestionProgress(phase));
  let crossExam = $derived(phase?.crossExam ?? null);
  let presenting = $derived(active && crossExam?.presenting === true);
  let menuChromeVisible = $derived(
    active && mode.type === "interrogation" && !presenting,
  );
  let activePortrait = $derived.by<PortraitRef | null>(() => {
    /* v8 ignore next -- Svelte compilation artifact: the && chain's third arm is never tracked as hit even though tests exercise dialogue-with-portrait mode */
    if (
      mode.type === "dialogue" &&
      mode.current.kind === "line" &&
      mode.current.portrait !== null
    ) {
      return mode.current.portrait ?? phase?.subject.portrait ?? null;
    }
    return phase?.subject.portrait ?? null;
  });
  let stageBackdrop = $derived.by<{
    sceneTag: string | null;
    backgroundAssetId: string | null;
  } | null>(() => {
    /* v8 ignore next -- unreachable: stageBackdrop is only read inside the {#if active} block, so the derived is never evaluated when active is false */
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
    if (!menuChromeVisible) stageHistoryOpen = false;
  });

  $effect(() => {
    if (presenting && !wasPresenting) {
      const activeElement = document.activeElement;
      trayReturnFocus =
        activeElement instanceof HTMLElement ? activeElement : null;
    }
    wasPresenting = presenting;
  });

  function openStageHistory(): void {
    if (!disabled) stageHistoryOpen = true;
  }

  function closeStageHistory(options: { refocusLog?: boolean } = {}): void {
    if (!stageHistoryOpen) return;
    stageHistoryOpen = false;
    if (options.refocusLog === false) return;
    void tick().then(() => stageLogButton?.focus());
  }

  function openCaseFile(
    section: Extract<CaseFileSection, "objective" | "evidence">,
    event: MouseEvent,
  ): void {
    if (disabled) return;
    const trigger = event.currentTarget;
    /* v8 ignore next -- unreachable: event.currentTarget is always an HTMLElement for click events on buttons */
    if (trigger instanceof HTMLElement) {
      closeStageHistory({ refocusLog: false });
      onOpenCaseFile(section, trigger);
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
            <div class="subject-meter">
              <p>動搖 · COMPOSURE</p>
              <div
                data-interrogation-broken-progress=""
                role="progressbar"
                aria-label={"已突破 " +
                  progress.broken +
                  " / " +
                  progress.total +
                  " 題"}
                aria-valuenow={progress.broken}
                aria-valuemin="0"
                aria-valuemax={progress.total}
              >
                <span
                  style={"--progress: " +
                    (progress.total === 0
                      ? 0
                      : progress.broken / progress.total)}
                ></span>
              </div>
            </div>
          </div>
        {/if}
      </div>

      {#if menuChromeVisible}
        <div class="interrogation-menu-toolbar" aria-label="訊問工具">
          <button
            bind:this={stageLogButton}
            data-interrogation-stage-log=""
            type="button"
            {disabled}
            onclick={openStageHistory}
          >
            LOG
          </button>
          <button
            data-interrogation-case-file-objective=""
            type="button"
            {disabled}
            onclick={(event) => openCaseFile("objective", event)}
          >
            案件檔案
          </button>
          <button
            data-interrogation-evidence-locker=""
            type="button"
            {disabled}
            onclick={(event) => openCaseFile("evidence", event)}
          >
            證物櫃 {String(inventory.evidence.length).padStart(2, "0")}
          </button>
        </div>
      {/if}
    </section>

    {#if menuChromeVisible && stageHistoryOpen}
      <DialogueHistoryOverlay
        {history}
        bottom={180}
        showCloseShortcutHint={false}
        onClose={closeStageHistory}
      />
    {/if}
  {/if}

  <div class="stage-children" inert={stageHistoryOpen}>
    {@render children()}
  </div>

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

  .stage-children {
    display: contents;
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
  .subject-meter {
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
  .subject-meter p {
    margin: 0;
  }

  .eyebrow,
  .subject-meter p {
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

  .subject-meter {
    margin-top: 12px;
    padding-top: 10px;
    border-top: 1px solid rgba(236, 228, 207, 0.14);
    text-align: left;
  }

  .subject-meter p {
    color: var(--bone-faint);
    font-size: 10px;
    letter-spacing: 0.18em;
  }

  .subject-meter [role="progressbar"] {
    position: relative;
    height: 6px;
    margin-top: 8px;
    overflow: hidden;
    border: 1px solid rgba(236, 228, 207, 0.24);
    background: rgba(8, 8, 14, 0.6);
  }

  .subject-meter [role="progressbar"] span {
    display: block;
    width: calc(var(--progress, 0) * 100%);
    height: 100%;
    background: linear-gradient(90deg, var(--crimson-deep), var(--crimson));
    transition: width 0.2s ease;
  }

  .interrogation-menu-toolbar {
    position: absolute;
    top: 24px;
    right: 26px;
    z-index: 1;
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 6px;
    max-width: min(560px, calc(100% - 52px));
    pointer-events: auto;
  }

  .interrogation-menu-toolbar button {
    min-height: 38px;
    padding: 8px 12px;
    border: 1px solid var(--rule-strong);
    background: rgba(8, 8, 14, 0.78);
    color: var(--bone-dim);
    cursor: pointer;
    font: inherit;
    font-family: var(--serif-jp);
    font-size: 13px;
    letter-spacing: 0.06em;
    pointer-events: auto;
    transition:
      border-color 0.18s ease,
      color 0.18s ease,
      background 0.18s ease;
  }

  .interrogation-menu-toolbar button:first-child {
    color: var(--crimson);
    font-family: var(--impact);
    font-size: 10px;
    letter-spacing: 0.22em;
  }

  .interrogation-menu-toolbar button:hover:not(:disabled),
  .interrogation-menu-toolbar button:focus-visible {
    border-color: var(--crimson);
    background: var(--crimson-soft);
    color: var(--bone);
    outline: none;
  }

  .interrogation-menu-toolbar button:disabled {
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

    .interrogation-menu-toolbar {
      top: 18px;
      right: 20px;
      max-width: calc(100% - 40px);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .interrogation-menu-toolbar button,
    .subject-meter [role="progressbar"] span {
      transition: none;
    }
  }
</style>

<script lang="ts">
  import type {
    DialogueItem,
    EvidenceSource,
    InvestigationLayoutSidecar,
    InvestigationSceneJson,
    RevealTarget,
    RectLayout,
    SpriteLayout,
  } from "./layout-types";
  import { publicPathForEditorAsset } from "./editor-assets";
  import { SvelteSet } from "svelte/reactivity";
  import {
    alphaBoundsFromImageData,
    cropVariablesForAlphaBounds,
    moveLayout,
    resizeLayoutFromHandle,
    type ResizeHandle,
  } from "./layout-geometry";

  type SceneCharacter =
    InvestigationSceneJson["sublocations"][number]["characters"][number];
  type SceneHotspot =
    InvestigationSceneJson["sublocations"][number]["hotspots"][number];
  type TargetKind = "hotspot" | "character";
  type DragMode = "move" | ResizeHandle;
  type DragState = {
    kind: TargetKind;
    id: string;
    mode: DragMode;
    pointerId: number;
    startX: number;
    startY: number;
    moved: boolean;
    startLayout: RectLayout | SpriteLayout;
  };
  type RevealedTarget = {
    kind: TargetKind;
    id: string;
  };
  type HotspotSourceState = EvidenceSource | "missing" | null;
  type EvidenceCorrelation = {
    id: string;
    name: string;
    imageAssetId: string | null;
  };
  type EvidenceMenuState = {
    hotspotLabel: string;
    evidenceItems: EvidenceCorrelation[];
    sourceState: HotspotSourceState;
    sceneSourcePrompt: string | null;
    x: number;
    y: number;
  };

  const defaultHotspotLayout: RectLayout = {
    kind: "rect",
    x: 0.4,
    y: 0.4,
    w: 0.12,
    h: 0.1,
  };
  const resizeHandles = [
    "nw",
    "n",
    "ne",
    "e",
    "se",
    "s",
    "sw",
    "w",
  ] as const satisfies readonly ResizeHandle[];
  const clickDragThresholdPx = 3;

  let {
    scene,
    layout,
    sublocationId,
    onHotspotLayoutChange,
    onCharacterLayoutChange,
  }: {
    scene: InvestigationSceneJson;
    layout: InvestigationLayoutSidecar;
    sublocationId: string;
    onHotspotLayoutChange: (
      sublocationId: string,
      hotspotId: string,
      layout: RectLayout,
    ) => void;
    onCharacterLayoutChange: (
      sublocationId: string,
      characterId: string,
      layout: SpriteLayout,
    ) => void;
  } = $props();

  let plateElement: HTMLDivElement | null = $state(null);
  let dragState = $state<DragState | null>(null);
  let showBoxes = $state(true);
  let revealedTarget = $state<RevealedTarget | null>(null);
  let evidenceMenu = $state<EvidenceMenuState | null>(null);
  let hiddenTargetKeys = new SvelteSet<string>();
  let cropStyles = $state<Record<string, string>>({});

  const currentSublocation = $derived(
    scene.sublocations.find((sublocation) => sublocation.id === sublocationId),
  );

  const sublocationLayout = $derived(layout.sublocations[sublocationId]);

  const evidenceById = $derived(
    new Map(
      scene.evidenceManifest.map((evidence) => [
        evidence.id,
        {
          name: evidence.name,
          imageAssetId: evidence.imageAssetId,
        },
      ]),
    ),
  );

  const portraitAssetBySpeaker = $derived(collectPortraitAssets(scene));

  const hotspotTargets = $derived(
    currentSublocation?.hotspots.map((hotspot) => ({
      ...hotspot,
      evidenceItems: evidenceItemsForHotspot(hotspot),
      sourceState: sourceStateForHotspot(hotspot),
      layout:
        sublocationLayout?.hotspots[hotspot.id] ??
        hotspot.layout ??
        defaultHotspotLayout,
    })) ?? [],
  );

  const characterTargets = $derived(
    currentSublocation?.characters.map((character) => ({
      ...character,
      layout: normalizeCharacterLayout(
        sublocationLayout?.characters[character.id] ??
          character.layout ??
          defaultCharacterLayout(character),
      ),
    })) ?? [],
  );

  function defaultCharacterLayout(character: SceneCharacter): SpriteLayout {
    return {
      kind: "sprite",
      assetId: standeeAssetIdForCharacter(character),
      x: 0.66,
      y: 0.14,
      w: 0.18,
      h: 0.76,
      anchor: "bottomCenter",
    };
  }

  function startDrag(
    kind: TargetKind,
    id: string,
    mode: DragMode,
    targetLayout: RectLayout | SpriteLayout,
    event: PointerEvent,
  ) {
    if (event.button === 2) return;

    event.preventDefault();
    event.stopPropagation();
    evidenceMenu = null;

    dragState = {
      kind,
      id,
      mode,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
      startLayout: { ...targetLayout },
    };

    plateElement?.setPointerCapture?.(event.pointerId);
  }

  function handlePointerMove(event: PointerEvent) {
    if (
      !dragState ||
      !plateElement ||
      dragState.pointerId !== event.pointerId
    ) {
      return;
    }

    const currentDrag = dragState;
    const plateRect = plateElement.getBoundingClientRect();
    const deltaX = event.clientX - currentDrag.startX;
    const deltaY = event.clientY - currentDrag.startY;
    const moved =
      currentDrag.moved ||
      Math.abs(deltaX) > clickDragThresholdPx ||
      Math.abs(deltaY) > clickDragThresholdPx;
    if (moved !== currentDrag.moved) {
      dragState = { ...currentDrag, moved };
      showTargetBox(currentDrag.kind, currentDrag.id);
    }

    const dx = deltaX / plateRect.width;
    const dy = deltaY / plateRect.height;
    const startLayout = currentDrag.startLayout;
    const nextLayout =
      currentDrag.mode === "move"
        ? moveLayout(startLayout, dx, dy)
        : resizeLayoutFromHandle(startLayout, currentDrag.mode, dx, dy);

    commitLayout(currentDrag.kind, currentDrag.id, nextLayout);
  }

  function handlePointerUp(event: PointerEvent) {
    const currentDrag = dragState;
    if (!currentDrag || currentDrag.pointerId !== event.pointerId) return;
    plateElement?.releasePointerCapture?.(event.pointerId);
    if (!currentDrag.moved && currentDrag.mode === "move") {
      toggleTargetBox(currentDrag.kind, currentDrag.id);
    }
    dragState = null;
  }

  function handlePlatePointerDown() {
    evidenceMenu = null;
    if (!showBoxes) revealedTarget = null;
  }

  function toggleBoxes() {
    showBoxes = !showBoxes;
    revealedTarget = null;
    evidenceMenu = null;
    hiddenTargetKeys = new SvelteSet();
  }

  function isRevealedTarget(kind: TargetKind, id: string): boolean {
    return (
      !showBoxes && revealedTarget?.kind === kind && revealedTarget.id === id
    );
  }

  function isHiddenTarget(kind: TargetKind, id: string): boolean {
    return showBoxes && hiddenTargetKeys.has(targetKey(kind, id));
  }

  function toggleHiddenTarget(kind: TargetKind, id: string) {
    const key = targetKey(kind, id);
    if (hiddenTargetKeys.has(key)) {
      hiddenTargetKeys.delete(key);
    } else {
      hiddenTargetKeys.add(key);
    }
  }

  function targetKey(kind: TargetKind, id: string): string {
    return `${kind}:${id}`;
  }

  function toggleTargetBox(kind: TargetKind, id: string) {
    if (showBoxes) {
      toggleHiddenTarget(kind, id);
      return;
    }

    revealedTarget = isRevealedTarget(kind, id) ? null : { kind, id };
  }

  function showTargetBox(kind: TargetKind, id: string) {
    if (showBoxes) {
      const key = targetKey(kind, id);
      if (!hiddenTargetKeys.has(key)) return;
      hiddenTargetKeys.delete(key);
      return;
    }

    revealedTarget = { kind, id };
  }

  function isTargetBoxVisible(kind: TargetKind, id: string): boolean {
    return showBoxes ? !isHiddenTarget(kind, id) : isRevealedTarget(kind, id);
  }

  function commitLayout(
    kind: TargetKind,
    id: string,
    targetLayout: RectLayout | SpriteLayout,
  ) {
    if (kind === "hotspot") {
      onHotspotLayoutChange(sublocationId, id, {
        kind: "rect",
        x: targetLayout.x,
        y: targetLayout.y,
        w: targetLayout.w,
        h: targetLayout.h,
      });
      return;
    }

    const spriteLayout =
      targetLayout.kind === "sprite"
        ? targetLayout
        : defaultCharacterLayout(characterById(id));
    onCharacterLayoutChange(sublocationId, id, {
      ...spriteLayout,
      x: targetLayout.x,
      y: targetLayout.y,
      w: targetLayout.w,
      h: targetLayout.h,
    });
  }

  function layoutStyle(targetLayout: RectLayout | SpriteLayout): string {
    return [
      `left: ${toPercent(targetLayout.x)}`,
      `top: ${toPercent(targetLayout.y)}`,
      `width: ${toPercent(targetLayout.w)}`,
      `height: ${toPercent(targetLayout.h)}`,
    ].join(";");
  }

  function toPercent(value: number): string {
    return `${value * 100}%`;
  }

  function assetUrl(
    assetId: string | null,
    type: "background" | "portrait" | "standee" | "evidence",
  ) {
    return assetId ? publicPathForEditorAsset(assetId, type) : null;
  }

  function cropStyleForAsset(assetId: string): string {
    return cropStyles[assetId] ?? "";
  }

  function loadCharacterCrop(assetId: string, event: Event) {
    if (cropStyles[assetId]) return;

    const image = event.currentTarget;
    if (!(image instanceof HTMLImageElement)) return;
    if (!image.naturalWidth || !image.naturalHeight) return;

    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;

    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return;

    context.drawImage(image, 0, 0);
    const imageData = context.getImageData(
      0,
      0,
      image.naturalWidth,
      image.naturalHeight,
    );
    const bounds = alphaBoundsFromImageData(
      imageData.data,
      image.naturalWidth,
      image.naturalHeight,
    );
    if (!bounds) return;

    cropStyles = {
      ...cropStyles,
      [assetId]: cropVariablesForAlphaBounds(
        bounds,
        image.naturalWidth,
        image.naturalHeight,
      ),
    };
  }

  function characterAssetType(
    assetId: string,
  ): "portrait" | "standee" | "evidence" | "background" {
    if (assetId.startsWith("standee.")) return "standee";
    if (assetId.startsWith("evidence.")) return "evidence";
    if (assetId.startsWith("background.")) return "background";
    return "portrait";
  }

  function normalizeCharacterLayout(layout: SpriteLayout): SpriteLayout {
    return {
      ...layout,
      assetId: portraitAssetIdToStandee(layout.assetId),
    };
  }

  function standeeAssetIdForCharacter(character: SceneCharacter): string {
    const dialoguePortrait = portraitAssetBySpeaker.get(character.name);
    if (dialoguePortrait) return portraitAssetIdToStandee(dialoguePortrait);
    return `standee.${character.id}.standard`;
  }

  function portraitAssetIdToStandee(assetId: string): string {
    if (assetId.startsWith("standee.")) return assetId;
    if (!assetId.startsWith("portrait.")) {
      console.warn(
        `[EditorCanvas] Unrecognized asset ID format: "${assetId}". ` +
          `Expected "portrait.<id>.<pose>" or "standee.<id>.<pose>".`,
      );
      return assetId;
    }

    const parts = assetId.split(".");
    const characterId = parts[1];
    if (!characterId) return assetId;
    return `standee.${characterId}.standard`;
  }

  function characterById(characterId: string): SceneCharacter {
    const found = currentSublocation?.characters.find(
      (character) => character.id === characterId,
    );
    if (found) return found;

    console.warn(
      `[EditorCanvas] Character "${characterId}" not found in sublocation "${sublocationId}". ` +
        `Scene and layout sidecar may be out of sync. Using fallback.`,
    );

    return {
      id: characterId,
      name: characterId,
      role: "",
      bio: "",
      layout: null,
      topics: [],
    };
  }

  function evidenceItemsForHotspot(
    hotspot: SceneHotspot,
  ): EvidenceCorrelation[] {
    const items: EvidenceCorrelation[] = [];
    for (const reveal of hotspot.reveals) {
      if (isEvidenceReveal(reveal)) {
        const evidence = evidenceById.get(reveal.id);
        items.push({
          id: reveal.id,
          name: evidence?.name ?? reveal.id,
          imageAssetId: evidence?.imageAssetId ?? null,
        });
      }
    }
    return items;
  }

  function hasEvidenceReveal(hotspot: SceneHotspot): boolean {
    return hotspot.reveals.some(isEvidenceReveal);
  }

  function sourceStateForHotspot(hotspot: SceneHotspot): HotspotSourceState {
    if (!hasEvidenceReveal(hotspot)) return null;
    return hotspot.evidenceSource ?? "missing";
  }

  function sourceLabel(sourceState: HotspotSourceState): string | null {
    if (!sourceState) return null;
    return sourceState === "missing" ? "missing source" : sourceState;
  }

  function sourceClass(sourceState: HotspotSourceState): string {
    if (!sourceState) return "";
    return sourceState === "missing"
      ? "missing-source"
      : `source-${sourceState}`;
  }

  function evidenceTitle(evidenceItems: EvidenceCorrelation[]): string {
    return evidenceItems
      .map((evidence) => `${evidence.name} (${evidence.id})`)
      .join(", ");
  }

  function openEvidenceMenu(
    hotspot: SceneHotspot & {
      evidenceItems: EvidenceCorrelation[];
      sourceState: HotspotSourceState;
    },
    event: MouseEvent,
  ) {
    event.preventDefault();
    event.stopPropagation();

    if (hotspot.evidenceItems.length === 0) {
      evidenceMenu = null;
      return;
    }

    const plateRect = plateElement?.getBoundingClientRect();
    evidenceMenu = {
      hotspotLabel: hotspot.label,
      evidenceItems: hotspot.evidenceItems,
      sourceState: hotspot.sourceState,
      sceneSourcePrompt: hotspot.sceneSourcePrompt,
      x: plateRect ? Math.max(0, event.clientX - plateRect.left) : 0,
      y: plateRect ? Math.max(0, event.clientY - plateRect.top) : 0,
    };
  }

  function evidenceMenuStyle(menu: EvidenceMenuState): string {
    return [`left: ${menu.x}px`, `top: ${menu.y}px`].join(";");
  }

  function hotspotControlTitle(
    hotspot: SceneHotspot & { evidenceItems?: EvidenceCorrelation[] },
  ): string {
    const parts = [hotspot.description || hotspot.label];
    const source = sourceLabel(sourceStateForHotspot(hotspot));
    if (source) parts.push(`Source: ${source}`);
    if (hotspot.sceneSourcePrompt) {
      parts.push(`Prompt: ${hotspot.sceneSourcePrompt}`);
    }
    const evidenceItems =
      hotspot.evidenceItems ?? evidenceItemsForHotspot(hotspot);
    if (evidenceItems.length > 0) {
      parts.push(`Evidence: ${evidenceTitle(evidenceItems)}`);
    }
    return parts.join("\n");
  }

  function isEvidenceReveal(
    reveal: RevealTarget,
  ): reveal is Extract<RevealTarget, { kind: "evidence" }> {
    return reveal.kind === "evidence";
  }

  function collectPortraitAssets(
    targetScene: InvestigationSceneJson,
  ): Map<string, string> {
    const portraits = new Map<string, string>();

    collectDialoguePortraits(portraits, targetScene.intro);
    for (const sublocation of targetScene.sublocations) {
      collectDialoguePortraits(portraits, sublocation.transitionDialogue);
      for (const hotspot of sublocation.hotspots) {
        collectDialoguePortraits(portraits, hotspot.inspectDialogue);
      }
      for (const character of sublocation.characters) {
        for (const topic of character.topics) {
          collectDialoguePortraits(portraits, topic.topicDialogue);
        }
      }
    }

    return portraits;
  }

  function collectDialoguePortraits(
    portraits: Map<string, string>,
    dialogue: DialogueItem[],
  ) {
    for (const item of dialogue) {
      if (item.kind === "line" && item.portrait?.assetId) {
        portraits.set(item.speaker, item.portrait.assetId);
      }
    }
  }

  function handleAssetError(assetId: string, type: string) {
    console.warn(
      `[EditorCanvas] Missing asset: ${assetId} (type: ${type}). ` +
        `Check that the file exists in the public assets directory.`,
    );
  }
</script>

{#if currentSublocation}
  <section class="canvas-shell" aria-label="Layout canvas">
    <div class="canvas-heading">
      <div>
        <p class="eyebrow">Canvas</p>
        <h3>{currentSublocation.label}</h3>
      </div>
      <div class="canvas-actions">
        <button
          type="button"
          class="box-toggle"
          aria-label="Toggle placement boxes"
          aria-pressed={showBoxes}
          onclick={toggleBoxes}
        >
          Boxes
        </button>
        <span>{currentSublocation.sceneTag}</span>
      </div>
    </div>

    <div
      class="plate"
      role="application"
      aria-label={`${currentSublocation.label} layout plate`}
      class:hide-boxes={!showBoxes}
      bind:this={plateElement}
      onpointerdown={handlePlatePointerDown}
      onpointermove={handlePointerMove}
      onpointerup={handlePointerUp}
      onpointercancel={handlePointerUp}
    >
      {#if assetUrl(currentSublocation.backgroundAssetId, "background")}
        <img
          class="scene-background"
          src={assetUrl(currentSublocation.backgroundAssetId, "background")}
          alt=""
          aria-hidden="true"
          onerror={() =>
            handleAssetError(
              currentSublocation.backgroundAssetId ?? "",
              "background",
            )}
        />
      {/if}

      {#each hotspotTargets as hotspot (hotspot.id)}
        <button
          type="button"
          class={`target hotspot ${sourceClass(hotspot.sourceState)}`}
          class:dragging={dragState?.kind === "hotspot" &&
            dragState.id === hotspot.id}
          class:revealed={isRevealedTarget("hotspot", hotspot.id)}
          class:hidden={isHiddenTarget("hotspot", hotspot.id)}
          style={layoutStyle(hotspot.layout)}
          onpointerdown={(event) =>
            startDrag("hotspot", hotspot.id, "move", hotspot.layout, event)}
          oncontextmenu={(event) => openEvidenceMenu(hotspot, event)}
        >
          {#if hotspot.sourceState === "implied"}
            <i class="source-marker" aria-hidden="true" title="Implied source"
            ></i>
          {/if}
          <span class="target-label">{hotspot.label}</span>
          {#if sourceLabel(hotspot.sourceState)}
            <span class="source-badge">{sourceLabel(hotspot.sourceState)}</span>
          {/if}
          {#each resizeHandles as handle (handle)}
            <i
              aria-hidden="true"
              class={`resize-handle ${handle}`}
              onpointerdown={(event) =>
                startDrag("hotspot", hotspot.id, handle, hotspot.layout, event)}
            ></i>
          {/each}
        </button>
      {/each}

      {#if evidenceMenu}
        <div
          class="evidence-menu"
          role="menu"
          aria-label={`Evidence for ${evidenceMenu.hotspotLabel}`}
          style={evidenceMenuStyle(evidenceMenu)}
        >
          <div class="evidence-menu-heading">
            <strong>{evidenceMenu.hotspotLabel}</strong>
            {#if sourceLabel(evidenceMenu.sourceState)}
              <span>{sourceLabel(evidenceMenu.sourceState)}</span>
            {/if}
          </div>
          {#if evidenceMenu.sceneSourcePrompt}
            <p>{evidenceMenu.sceneSourcePrompt}</p>
          {/if}
          <ul>
            {#each evidenceMenu.evidenceItems as evidence (evidence.id)}
              <li role="menuitem">
                <span>{evidence.name}</span>
                <code>{evidence.id}</code>
              </li>
            {/each}
          </ul>
        </div>
      {/if}

      {#each characterTargets as character (character.id)}
        <button
          type="button"
          class="target character"
          class:dragging={dragState?.kind === "character" &&
            dragState.id === character.id}
          class:revealed={isRevealedTarget("character", character.id)}
          class:hidden={isHiddenTarget("character", character.id)}
          style={layoutStyle(character.layout)}
          onpointerdown={(event) =>
            startDrag(
              "character",
              character.id,
              "move",
              character.layout,
              event,
            )}
        >
          <div
            class="character-preview-crop"
            style={cropStyleForAsset(character.layout.assetId)}
          >
            <img
              class="character-preview"
              src={assetUrl(
                character.layout.assetId,
                characterAssetType(character.layout.assetId),
              )}
              alt=""
              aria-hidden="true"
              onload={(event) =>
                loadCharacterCrop(character.layout.assetId, event)}
              onerror={() =>
                handleAssetError(
                  character.layout.assetId,
                  characterAssetType(character.layout.assetId),
                )}
            />
          </div>
          <span class="target-label">{character.name}</span>
          {#each resizeHandles as handle (handle)}
            <i
              aria-hidden="true"
              class={`resize-handle ${handle}`}
              onpointerdown={(event) =>
                startDrag(
                  "character",
                  character.id,
                  handle,
                  character.layout,
                  event,
                )}
            ></i>
          {/each}
        </button>
      {/each}
    </div>

    <div class="target-controls" aria-label="Target controls">
      {#each hotspotTargets as hotspot (hotspot.id)}
        <button
          class="box-state"
          type="button"
          aria-pressed={isTargetBoxVisible("hotspot", hotspot.id)}
          title={hotspotControlTitle(hotspot)}
          onclick={() => toggleTargetBox("hotspot", hotspot.id)}
        >
          {hotspot.label}
        </button>
      {/each}

      {#each characterTargets as character (character.id)}
        <button
          class="box-state"
          type="button"
          aria-pressed={isTargetBoxVisible("character", character.id)}
          title={character.bio || character.role || character.name}
          onclick={() => toggleTargetBox("character", character.id)}
        >
          {character.name}
        </button>
      {/each}
    </div>
  </section>
{:else}
  <p class="empty">Select a sublocation.</p>
{/if}

<style>
  .canvas-shell {
    display: grid;
    gap: 16px;
    margin-top: 28px;
  }

  .canvas-heading {
    display: flex;
    align-items: end;
    justify-content: space-between;
    gap: 16px;
  }

  .canvas-actions {
    display: flex;
    align-items: center;
    justify-content: end;
    gap: 12px;
    min-width: 0;
  }

  .eyebrow {
    margin: 0 0 6px;
    color: #5f6b64;
    font-size: 0.78rem;
    font-weight: 700;
    letter-spacing: 0;
    text-transform: uppercase;
  }

  h3 {
    margin: 0;
    font-size: 1.1rem;
    letter-spacing: 0;
  }

  .canvas-actions span {
    color: #60706b;
    font-size: 0.85rem;
    text-align: right;
  }

  .box-toggle {
    flex: 0 0 auto;
    height: 30px;
    padding: 0 10px;
    border: 1px solid #bfc7bf;
    border-radius: 5px;
    background: #ffffff;
    color: #26302e;
    cursor: pointer;
    font-size: 0.78rem;
    font-weight: 700;
  }

  .box-toggle[aria-pressed="true"] {
    border-color: #57776a;
    background: #edf4f0;
  }

  .plate {
    position: relative;
    width: 100%;
    aspect-ratio: 16 / 9;
    overflow: hidden;
    border: 1px solid #bfc7bf;
    border-radius: 8px;
    background:
      linear-gradient(90deg, rgb(255 255 255 / 7%) 1px, transparent 1px),
      linear-gradient(rgb(255 255 255 / 7%) 1px, transparent 1px), #25302e;
    background-size: 6.25% 11.111%;
    touch-action: none;
    user-select: none;
  }

  .scene-background {
    position: absolute;
    inset: 0;
    z-index: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    pointer-events: none;
  }

  .target {
    position: absolute;
    z-index: 2;
    min-width: 36px;
    min-height: 28px;
    padding: 0;
    border: 2px solid;
    border-radius: 4px;
    background: rgb(255 255 255 / 14%);
    color: #ffffff;
    cursor: move;
    overflow: hidden;
    text-align: left;
  }

  .character-preview-crop {
    position: absolute;
    inset: 0;
    z-index: 0;
    overflow: hidden;
    pointer-events: none;
  }

  .character-preview {
    position: absolute;
    top: calc(-100% * var(--crop-top, 0) / var(--crop-height, 1));
    left: 50%;
    width: auto;
    max-width: none;
    height: calc(100% / var(--crop-height, 1));
    transform: translateX(-50%);
    object-fit: contain;
    pointer-events: none;
  }

  .character-preview-crop:not([style]) .character-preview,
  .character-preview-crop[style=""] .character-preview {
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: contain;
    transform: none;
  }

  .target-label {
    position: absolute;
    z-index: 1;
    top: 4px;
    left: 5px;
    right: 18px;
    overflow: hidden;
    font-size: 0.72rem;
    font-weight: 700;
    line-height: 1.15;
    text-overflow: ellipsis;
    text-shadow: 0 1px 2px rgb(0 0 0 / 60%);
    white-space: nowrap;
  }

  .source-badge {
    position: absolute;
    right: 4px;
    bottom: 4px;
    z-index: 1;
    max-width: calc(50% - 6px);
    padding: 2px 5px;
    border: 1px solid rgb(255 255 255 / 48%);
    border-radius: 4px;
    background: rgb(38 48 46 / 82%);
    color: #ffffff;
    font-size: 0.62rem;
    font-weight: 800;
    line-height: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    text-shadow: 0 1px 2px rgb(0 0 0 / 56%);
    white-space: nowrap;
  }

  .source-marker {
    position: absolute;
    top: 50%;
    left: 50%;
    z-index: 0;
    width: 18px;
    height: 18px;
    border: 2px solid rgb(255 255 255 / 72%);
    border-radius: 50%;
    background: rgb(38 48 46 / 42%);
    transform: translate(-50%, -50%);
    pointer-events: none;
  }

  .source-marker::after {
    position: absolute;
    inset: 5px;
    border-radius: 50%;
    background: rgb(255 255 255 / 82%);
    content: "";
  }

  .hotspot {
    border-color: #ffcb69;
    background: rgb(255 203 105 / 18%);
  }

  .hotspot.missing-source {
    border-color: #f07f5f;
    background: rgb(240 127 95 / 22%);
    box-shadow: inset 0 0 0 1px rgb(240 127 95 / 60%);
  }

  .character {
    border-color: #7fc7d9;
    background: rgb(127 199 217 / 18%);
  }

  .dragging {
    outline: 2px solid #ffffff;
    outline-offset: 1px;
  }

  .hide-boxes .target {
    border-color: transparent;
    background: transparent;
    outline: 0;
    box-shadow: none;
  }

  .target.hidden {
    border-color: transparent;
    background: transparent;
    outline: 0;
    box-shadow: none;
  }

  .hide-boxes .target.character {
    overflow: visible;
  }

  .target.hidden.character {
    overflow: visible;
  }

  .hide-boxes .character-preview,
  .hide-boxes .character-preview-crop,
  .target.hidden .character-preview,
  .target.hidden .character-preview-crop {
    border: 0;
    outline: 0;
    box-shadow: none;
  }

  .hide-boxes .target-label,
  .hide-boxes .source-badge,
  .hide-boxes .source-marker,
  .hide-boxes .resize-handle,
  .target.hidden .target-label,
  .target.hidden .source-badge,
  .target.hidden .source-marker,
  .target.hidden .resize-handle {
    opacity: 0;
    pointer-events: none;
  }

  .hide-boxes .target.revealed.hotspot {
    border-color: #ffcb69;
    background: rgb(255 203 105 / 18%);
  }

  .hide-boxes .target.revealed.hotspot.missing-source {
    border-color: #f07f5f;
    background: rgb(240 127 95 / 22%);
    box-shadow: inset 0 0 0 1px rgb(240 127 95 / 60%);
  }

  .hide-boxes .target.revealed.character {
    overflow: hidden;
    border-color: #7fc7d9;
    background: rgb(127 199 217 / 18%);
  }

  .hide-boxes .target.revealed .target-label,
  .hide-boxes .target.revealed .source-badge,
  .hide-boxes .target.revealed .source-marker,
  .hide-boxes .target.revealed .resize-handle {
    opacity: 1;
    pointer-events: auto;
  }

  .evidence-menu {
    position: absolute;
    z-index: 6;
    min-width: 190px;
    max-width: min(280px, calc(100% - 16px));
    padding: 10px;
    border: 1px solid rgb(38 48 46 / 36%);
    border-radius: 6px;
    background: rgb(255 255 255 / 96%);
    box-shadow: 0 10px 24px rgb(0 0 0 / 24%);
    color: #26302e;
    transform: translate(6px, 6px);
  }

  .evidence-menu-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    min-width: 0;
    margin-bottom: 8px;
  }

  .evidence-menu-heading strong {
    min-width: 0;
    overflow: hidden;
    font-size: 0.82rem;
    line-height: 1.2;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .evidence-menu-heading span {
    flex: 0 0 auto;
    padding: 2px 5px;
    border: 1px solid #c9d0ca;
    border-radius: 4px;
    background: #edf4f0;
    color: #43514d;
    font-size: 0.62rem;
    font-weight: 800;
    line-height: 1;
  }

  .evidence-menu p {
    margin: 0 0 8px;
    color: #5f6b64;
    font-size: 0.72rem;
    line-height: 1.3;
  }

  .evidence-menu ul {
    display: grid;
    gap: 4px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .evidence-menu li {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: 10px;
    min-height: 28px;
    padding: 5px 7px;
    border-radius: 4px;
    background: #f4f7f5;
    font-size: 0.76rem;
  }

  .evidence-menu li span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .evidence-menu code {
    color: #60706b;
    font-family: inherit;
    font-size: 0.68rem;
  }

  .resize-handle {
    position: absolute;
    z-index: 2;
    width: 10px;
    height: 10px;
    border: 1px solid rgb(255 255 255 / 82%);
    border-radius: 2px;
    background: rgb(38 48 46 / 82%);
    box-shadow: 0 0 0 1px rgb(0 0 0 / 32%);
  }

  .resize-handle.n,
  .resize-handle.s {
    left: 50%;
    transform: translateX(-50%);
    cursor: ns-resize;
  }

  .resize-handle.e,
  .resize-handle.w {
    top: 50%;
    transform: translateY(-50%);
    cursor: ew-resize;
  }

  .resize-handle.n {
    top: -6px;
  }

  .resize-handle.e {
    right: -6px;
  }

  .resize-handle.s {
    bottom: -6px;
  }

  .resize-handle.w {
    left: -6px;
  }

  .resize-handle.nw,
  .resize-handle.ne,
  .resize-handle.sw,
  .resize-handle.se {
    width: 12px;
    height: 12px;
  }

  .resize-handle.nw {
    top: -7px;
    left: -7px;
    cursor: nwse-resize;
  }

  .resize-handle.ne {
    top: -7px;
    right: -7px;
    cursor: nesw-resize;
  }

  .resize-handle.sw {
    bottom: -7px;
    left: -7px;
    cursor: nesw-resize;
  }

  .resize-handle.se {
    right: -7px;
    bottom: -7px;
    cursor: nwse-resize;
  }

  .target-controls {
    display: grid;
    grid-template-columns: repeat(6, minmax(0, 1fr));
    gap: 8px;
  }

  .box-state {
    min-width: 0;
    height: 34px;
    padding: 0 10px;
    border: 1px solid #c9d0ca;
    border-radius: 5px;
    background: #f7faf8;
    color: #26302e;
    cursor: pointer;
    font-size: 0.76rem;
    font-weight: 700;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .box-state:hover {
    border-color: #57776a;
    background: #edf4f0;
  }

  .box-state[aria-pressed="true"] {
    border-color: #57776a;
    background: #edf4f0;
  }

  .empty {
    margin: 24px 0 0;
    color: #7d3c2f;
  }

  @media (max-width: 900px) {
    .canvas-heading {
      display: grid;
    }

    .canvas-actions {
      justify-content: start;
    }

    .canvas-actions span {
      text-align: left;
    }

    .target-controls {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
</style>

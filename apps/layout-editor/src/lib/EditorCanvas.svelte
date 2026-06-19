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

  function targetClass(
    kind: TargetKind,
    id: string,
    sourceState: HotspotSourceState = null,
  ): string {
    const isVisible = isTargetBoxVisible(kind, id);
    const isDragging = dragState?.kind === kind && dragState.id === id;
    const classes = [
      "target",
      kind,
      kind === "hotspot" ? sourceClass(sourceState) : "",
      isDragging ? "dragging outline-2 outline-offset-1 outline-white" : "",
      isRevealedTarget(kind, id) ? "revealed" : "",
      isHiddenTarget(kind, id) ? "box-hidden" : "",
      "absolute z-[2] min-h-7 min-w-9 cursor-move rounded border-2 p-0 text-left text-white",
      kind === "hotspot"
        ? hotspotVisualClass(sourceState, isVisible)
        : characterVisualClass(isVisible),
    ];
    return classes.filter(Boolean).join(" ");
  }

  function hotspotVisualClass(
    sourceState: HotspotSourceState,
    isVisible: boolean,
  ): string {
    if (!isVisible) return "overflow-hidden border-transparent bg-transparent";
    if (sourceState === "missing") {
      return "overflow-hidden border-[#f07f5f] bg-[rgb(240_127_95_/_22%)] shadow-[inset_0_0_0_1px_rgb(240_127_95_/_60%)]";
    }
    return "overflow-hidden border-[#ffcb69] bg-[rgb(255_203_105_/_18%)]";
  }

  function characterVisualClass(isVisible: boolean): string {
    if (!isVisible) return "overflow-visible border-transparent bg-transparent";
    return "overflow-hidden border-[#7fc7d9] bg-[rgb(127_199_217_/_18%)]";
  }

  function targetOverlayClass(kind: TargetKind, id: string): string {
    return isTargetBoxVisible(kind, id)
      ? "opacity-100 pointer-events-auto"
      : "opacity-0 pointer-events-none";
  }

  function targetLabelClass(kind: TargetKind, id: string): string {
    return [
      "target-label absolute top-1 left-[5px] right-[18px] z-[1] overflow-hidden text-ellipsis whitespace-nowrap text-[0.72rem] leading-[1.15] font-bold [text-shadow:0_1px_2px_rgb(0_0_0_/_60%)]",
      targetOverlayClass(kind, id),
    ].join(" ");
  }

  function sourceBadgeClass(kind: TargetKind, id: string): string {
    return [
      "source-badge absolute right-1 bottom-1 z-[1] max-w-[calc(50%-6px)] overflow-hidden text-ellipsis whitespace-nowrap rounded border border-white/50 bg-[#26302e]/80 px-[5px] py-0.5 text-[0.62rem] leading-none font-extrabold text-white [text-shadow:0_1px_2px_rgb(0_0_0_/_56%)]",
      targetOverlayClass(kind, id),
    ].join(" ");
  }

  function sourceMarkerClass(kind: TargetKind, id: string): string {
    return [
      "source-marker absolute top-1/2 left-1/2 z-0 h-[18px] w-[18px] -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white/70 bg-[#26302e]/40",
      targetOverlayClass(kind, id),
    ].join(" ");
  }

  function resizeHandleClass(
    handle: ResizeHandle,
    kind: TargetKind,
    id: string,
  ): string {
    const positions: Record<ResizeHandle, string> = {
      n: "top-[-6px] left-1/2 h-2.5 w-2.5 -translate-x-1/2 cursor-ns-resize",
      e: "right-[-6px] top-1/2 h-2.5 w-2.5 -translate-y-1/2 cursor-ew-resize",
      s: "bottom-[-6px] left-1/2 h-2.5 w-2.5 -translate-x-1/2 cursor-ns-resize",
      w: "left-[-6px] top-1/2 h-2.5 w-2.5 -translate-y-1/2 cursor-ew-resize",
      nw: "top-[-7px] left-[-7px] h-3 w-3 cursor-nwse-resize",
      ne: "top-[-7px] right-[-7px] h-3 w-3 cursor-nesw-resize",
      sw: "bottom-[-7px] left-[-7px] h-3 w-3 cursor-nesw-resize",
      se: "right-[-7px] bottom-[-7px] h-3 w-3 cursor-nwse-resize",
    };

    return [
      "resize-handle",
      handle,
      "absolute z-[2] rounded-sm border border-white/80 bg-[rgb(38_48_46_/_82%)] shadow-[0_0_0_1px_rgb(0_0_0_/_32%)]",
      positions[handle],
      targetOverlayClass(kind, id),
    ].join(" ");
  }

  function characterPreviewClass(assetId: string): string {
    if (cropStyles[assetId]) {
      return "character-preview absolute left-1/2 top-[calc(-100%*var(--crop-top,0)/var(--crop-height,1))] h-[calc(100%/var(--crop-height,1))] w-auto max-w-none -translate-x-1/2 object-contain pointer-events-none";
    }
    return "character-preview absolute inset-0 h-full w-full object-contain pointer-events-none";
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
  <section class="canvas-shell mt-7 grid gap-4" aria-label="Layout canvas">
    <div
      class="canvas-heading flex items-end justify-between gap-4 max-[900px]:grid"
    >
      <div>
        <p
          class="eyebrow m-0 mb-1.5 text-[0.78rem] font-bold tracking-normal text-[#5f6b64] uppercase"
        >
          Canvas
        </p>
        <h3 class="m-0 text-[1.1rem] tracking-normal">
          {currentSublocation.label}
        </h3>
      </div>
      <div
        class="canvas-actions flex min-w-0 items-center justify-end gap-3 max-[900px]:justify-start"
      >
        <button
          type="button"
          class="box-toggle h-[30px] flex-none cursor-pointer rounded-[5px] border border-[#bfc7bf] bg-white px-2.5 text-[0.78rem] font-bold text-[#26302e] [aria-pressed=true]:border-[#57776a] [aria-pressed=true]:bg-[#edf4f0]"
          aria-label="Toggle placement boxes"
          aria-pressed={showBoxes}
          onclick={toggleBoxes}
        >
          Boxes
        </button>
        <span
          class="text-right text-[0.85rem] text-[#60706b] max-[900px]:text-left"
          >{currentSublocation.sceneTag}</span
        >
      </div>
    </div>

    <div
      class={[
        "plate relative aspect-video w-full touch-none select-none overflow-hidden rounded-lg border border-[#bfc7bf] bg-[#25302e] [background-image:linear-gradient(90deg,rgb(255_255_255_/_7%)_1px,transparent_1px),linear-gradient(rgb(255_255_255_/_7%)_1px,transparent_1px)] [background-size:6.25%_11.111%]",
        !showBoxes ? "hide-boxes" : "",
      ].join(" ")}
      role="application"
      aria-label={`${currentSublocation.label} layout plate`}
      bind:this={plateElement}
      onpointerdown={handlePlatePointerDown}
      onpointermove={handlePointerMove}
      onpointerup={handlePointerUp}
      onpointercancel={handlePointerUp}
    >
      {#if assetUrl(currentSublocation.backgroundAssetId, "background")}
        <img
          class="scene-background pointer-events-none absolute inset-0 z-0 h-full w-full object-cover"
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
          class={targetClass("hotspot", hotspot.id, hotspot.sourceState)}
          style={layoutStyle(hotspot.layout)}
          onpointerdown={(event) =>
            startDrag("hotspot", hotspot.id, "move", hotspot.layout, event)}
          oncontextmenu={(event) => openEvidenceMenu(hotspot, event)}
        >
          {#if hotspot.sourceState === "implied"}
            <i
              class={sourceMarkerClass("hotspot", hotspot.id)}
              aria-hidden="true"
              title="Implied source"
            >
              <span class="absolute inset-[5px] rounded-full bg-white/80"
              ></span>
            </i>
          {/if}
          <span class={targetLabelClass("hotspot", hotspot.id)}
            >{hotspot.label}</span
          >
          {#if sourceLabel(hotspot.sourceState)}
            <span class={sourceBadgeClass("hotspot", hotspot.id)}
              >{sourceLabel(hotspot.sourceState)}</span
            >
          {/if}
          {#each resizeHandles as handle (handle)}
            <i
              aria-hidden="true"
              class={resizeHandleClass(handle, "hotspot", hotspot.id)}
              onpointerdown={(event) =>
                startDrag("hotspot", hotspot.id, handle, hotspot.layout, event)}
            ></i>
          {/each}
        </button>
      {/each}

      {#if evidenceMenu}
        <div
          class="evidence-menu absolute z-[6] min-w-[190px] max-w-[min(280px,calc(100%-16px))] translate-x-1.5 translate-y-1.5 rounded-md border border-[#26302e]/35 bg-white/95 p-2.5 text-[#26302e] shadow-[0_10px_24px_rgb(0_0_0_/_24%)]"
          role="menu"
          aria-label={`Evidence for ${evidenceMenu.hotspotLabel}`}
          style={evidenceMenuStyle(evidenceMenu)}
        >
          <div
            class="evidence-menu-heading mb-2 flex min-w-0 items-center justify-between gap-2"
          >
            <strong
              class="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[0.82rem] leading-[1.2]"
              >{evidenceMenu.hotspotLabel}</strong
            >
            {#if sourceLabel(evidenceMenu.sourceState)}
              <span
                class="flex-none rounded border border-[#c9d0ca] bg-[#edf4f0] px-[5px] py-0.5 text-[0.62rem] leading-none font-extrabold text-[#43514d]"
                >{sourceLabel(evidenceMenu.sourceState)}</span
              >
            {/if}
          </div>
          {#if evidenceMenu.sceneSourcePrompt}
            <p class="m-0 mb-2 text-[0.72rem] leading-[1.3] text-[#5f6b64]">
              {evidenceMenu.sceneSourcePrompt}
            </p>
          {/if}
          <ul class="m-0 grid list-none gap-1 p-0">
            {#each evidenceMenu.evidenceItems as evidence (evidence.id)}
              <li
                class="grid min-h-7 grid-cols-[minmax(0,1fr)_auto] items-center gap-2.5 rounded bg-[#f4f7f5] px-[7px] py-[5px] text-[0.76rem]"
                role="menuitem"
              >
                <span class="overflow-hidden text-ellipsis whitespace-nowrap"
                  >{evidence.name}</span
                >
                <code class="font-inherit text-[0.68rem] text-[#60706b]"
                  >{evidence.id}</code
                >
              </li>
            {/each}
          </ul>
        </div>
      {/if}

      {#each characterTargets as character (character.id)}
        <button
          type="button"
          class={targetClass("character", character.id)}
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
            class="character-preview-crop pointer-events-none absolute inset-0 z-0 overflow-hidden"
            style={cropStyleForAsset(character.layout.assetId)}
          >
            <img
              class={characterPreviewClass(character.layout.assetId)}
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
          <span class={targetLabelClass("character", character.id)}
            >{character.name}</span
          >
          {#each resizeHandles as handle (handle)}
            <i
              aria-hidden="true"
              class={resizeHandleClass(handle, "character", character.id)}
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

    <div
      class="target-controls grid grid-cols-6 gap-2 max-[900px]:grid-cols-2"
      aria-label="Target controls"
    >
      {#each hotspotTargets as hotspot (hotspot.id)}
        <button
          class="box-state h-[34px] min-w-0 cursor-pointer truncate rounded-[5px] border border-[#c9d0ca] bg-[#f7faf8] px-2.5 text-[0.76rem] font-bold text-[#26302e] hover:border-[#57776a] hover:bg-[#edf4f0] [aria-pressed=true]:border-[#57776a] [aria-pressed=true]:bg-[#edf4f0]"
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
          class="box-state h-[34px] min-w-0 cursor-pointer truncate rounded-[5px] border border-[#c9d0ca] bg-[#f7faf8] px-2.5 text-[0.76rem] font-bold text-[#26302e] hover:border-[#57776a] hover:bg-[#edf4f0] [aria-pressed=true]:border-[#57776a] [aria-pressed=true]:bg-[#edf4f0]"
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
  <p class="empty mt-6 mb-0 text-[#7d3c2f]">Select a sublocation.</p>
{/if}

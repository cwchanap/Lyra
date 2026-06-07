<script lang="ts">
  import type {
    InvestigationLayoutSidecar,
    InvestigationSceneJson,
    RectLayout,
    SpriteLayout,
  } from "./layout-types";

  type TargetKind = "hotspot" | "character";
  type DragMode = "move" | "resize";
  type DragState = {
    kind: TargetKind;
    id: string;
    mode: DragMode;
    pointerId: number;
    startX: number;
    startY: number;
    startLayout: RectLayout | SpriteLayout;
  };

  const defaultHotspotLayout: RectLayout = {
    kind: "rect",
    x: 0.4,
    y: 0.4,
    w: 0.12,
    h: 0.1,
  };

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

  const currentSublocation = $derived(
    scene.sublocations.find((sublocation) => sublocation.id === sublocationId),
  );

  const sublocationLayout = $derived(layout.sublocations[sublocationId]);

  const hotspotTargets = $derived(
    currentSublocation?.hotspots.map((hotspot) => ({
      ...hotspot,
      layout: sublocationLayout?.hotspots[hotspot.id] ?? defaultHotspotLayout,
    })) ?? [],
  );

  const characterTargets = $derived(
    currentSublocation?.characters.map((character) => ({
      ...character,
      layout:
        sublocationLayout?.characters[character.id] ??
        defaultCharacterLayout(character.id),
    })) ?? [],
  );

  function defaultCharacterLayout(characterId: string): SpriteLayout {
    return {
      kind: "sprite",
      assetId: `portrait.${characterId}.standard`,
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
    event.preventDefault();
    event.stopPropagation();

    dragState = {
      kind,
      id,
      mode,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startLayout: { ...targetLayout },
    };

    plateElement?.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event: PointerEvent) {
    if (
      !dragState ||
      !plateElement ||
      dragState.pointerId !== event.pointerId
    ) {
      return;
    }

    const plateRect = plateElement.getBoundingClientRect();
    const dx = (event.clientX - dragState.startX) / plateRect.width;
    const dy = (event.clientY - dragState.startY) / plateRect.height;
    const startLayout = dragState.startLayout;
    const nextLayout =
      dragState.mode === "move"
        ? {
            ...startLayout,
            x: startLayout.x + dx,
            y: startLayout.y + dy,
          }
        : {
            ...startLayout,
            w: startLayout.w + dx,
            h: startLayout.h + dy,
          };

    commitLayout(dragState.kind, dragState.id, nextLayout);
  }

  function handlePointerUp(event: PointerEvent) {
    if (!dragState || dragState.pointerId !== event.pointerId) return;
    plateElement?.releasePointerCapture(event.pointerId);
    dragState = null;
  }

  function nudge(
    kind: TargetKind,
    id: string,
    targetLayout: RectLayout | SpriteLayout,
    delta: Partial<Pick<RectLayout, "x" | "y" | "w" | "h">>,
  ) {
    commitLayout(kind, id, {
      ...targetLayout,
      x: targetLayout.x + (delta.x ?? 0),
      y: targetLayout.y + (delta.y ?? 0),
      w: targetLayout.w + (delta.w ?? 0),
      h: targetLayout.h + (delta.h ?? 0),
    });
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
        : defaultCharacterLayout(id);
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
</script>

{#if currentSublocation}
  <section class="canvas-shell" aria-label="Layout canvas">
    <div class="canvas-heading">
      <div>
        <p class="eyebrow">Canvas</p>
        <h3>{currentSublocation.label}</h3>
      </div>
      <span>{currentSublocation.sceneTag}</span>
    </div>

    <div
      class="plate"
      role="application"
      aria-label={`${currentSublocation.label} layout plate`}
      bind:this={plateElement}
      onpointermove={handlePointerMove}
      onpointerup={handlePointerUp}
      onpointercancel={handlePointerUp}
    >
      {#each hotspotTargets as hotspot (hotspot.id)}
        <button
          type="button"
          class="target hotspot"
          class:dragging={dragState?.kind === "hotspot" &&
            dragState.id === hotspot.id}
          style={layoutStyle(hotspot.layout)}
          onpointerdown={(event) =>
            startDrag("hotspot", hotspot.id, "move", hotspot.layout, event)}
        >
          <span>{hotspot.label}</span>
          <i
            aria-hidden="true"
            class="resize-handle"
            onpointerdown={(event) =>
              startDrag("hotspot", hotspot.id, "resize", hotspot.layout, event)}
          ></i>
        </button>
      {/each}

      {#each characterTargets as character (character.id)}
        <button
          type="button"
          class="target character"
          class:dragging={dragState?.kind === "character" &&
            dragState.id === character.id}
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
          <span>{character.name}</span>
          <i
            aria-hidden="true"
            class="resize-handle"
            onpointerdown={(event) =>
              startDrag(
                "character",
                character.id,
                "resize",
                character.layout,
                event,
              )}
          ></i>
        </button>
      {/each}
    </div>

    <div class="target-controls" aria-label="Target controls">
      {#each hotspotTargets as hotspot (hotspot.id)}
        <div class="control-row">
          <div class="target-name">
            <strong>{hotspot.label}</strong>
            <small>hotspot.{hotspot.id}</small>
          </div>
          <div class="button-grid" aria-label={`${hotspot.label} controls`}>
            <button
              type="button"
              title="Move left"
              onclick={() =>
                nudge("hotspot", hotspot.id, hotspot.layout, { x: -0.01 })}
            >
              L
            </button>
            <button
              type="button"
              title="Move up"
              onclick={() =>
                nudge("hotspot", hotspot.id, hotspot.layout, { y: -0.01 })}
            >
              U
            </button>
            <button
              type="button"
              title="Move down"
              onclick={() =>
                nudge("hotspot", hotspot.id, hotspot.layout, { y: 0.01 })}
            >
              D
            </button>
            <button
              type="button"
              title="Move right"
              onclick={() =>
                nudge("hotspot", hotspot.id, hotspot.layout, { x: 0.01 })}
            >
              R
            </button>
            <button
              type="button"
              title="Narrow"
              onclick={() =>
                nudge("hotspot", hotspot.id, hotspot.layout, { w: -0.01 })}
            >
              W-
            </button>
            <button
              type="button"
              title="Widen"
              onclick={() =>
                nudge("hotspot", hotspot.id, hotspot.layout, { w: 0.01 })}
            >
              W+
            </button>
            <button
              type="button"
              title="Shorter"
              onclick={() =>
                nudge("hotspot", hotspot.id, hotspot.layout, { h: -0.01 })}
            >
              H-
            </button>
            <button
              type="button"
              title="Taller"
              onclick={() =>
                nudge("hotspot", hotspot.id, hotspot.layout, { h: 0.01 })}
            >
              H+
            </button>
          </div>
        </div>
      {/each}

      {#each characterTargets as character (character.id)}
        <div class="control-row">
          <div class="target-name">
            <strong>{character.name}</strong>
            <small>character.{character.id}</small>
          </div>
          <div class="button-grid" aria-label={`${character.name} controls`}>
            <button
              type="button"
              title="Move left"
              onclick={() =>
                nudge("character", character.id, character.layout, {
                  x: -0.01,
                })}
            >
              L
            </button>
            <button
              type="button"
              title="Move up"
              onclick={() =>
                nudge("character", character.id, character.layout, {
                  y: -0.01,
                })}
            >
              U
            </button>
            <button
              type="button"
              title="Move down"
              onclick={() =>
                nudge("character", character.id, character.layout, { y: 0.01 })}
            >
              D
            </button>
            <button
              type="button"
              title="Move right"
              onclick={() =>
                nudge("character", character.id, character.layout, { x: 0.01 })}
            >
              R
            </button>
            <button
              type="button"
              title="Narrow"
              onclick={() =>
                nudge("character", character.id, character.layout, {
                  w: -0.01,
                })}
            >
              W-
            </button>
            <button
              type="button"
              title="Widen"
              onclick={() =>
                nudge("character", character.id, character.layout, { w: 0.01 })}
            >
              W+
            </button>
            <button
              type="button"
              title="Shorter"
              onclick={() =>
                nudge("character", character.id, character.layout, {
                  h: -0.01,
                })}
            >
              H-
            </button>
            <button
              type="button"
              title="Taller"
              onclick={() =>
                nudge("character", character.id, character.layout, { h: 0.01 })}
            >
              H+
            </button>
          </div>
        </div>
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

  .canvas-heading span {
    color: #60706b;
    font-size: 0.85rem;
    text-align: right;
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

  .target {
    position: absolute;
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

  .target span {
    position: absolute;
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

  .hotspot {
    border-color: #ffcb69;
    background: rgb(255 203 105 / 18%);
  }

  .character {
    border-color: #7fc7d9;
    background: rgb(127 199 217 / 18%);
  }

  .dragging {
    outline: 2px solid #ffffff;
    outline-offset: 1px;
  }

  .resize-handle {
    position: absolute;
    right: 0;
    bottom: 0;
    width: 16px;
    height: 16px;
    border-top: 2px solid rgb(255 255 255 / 72%);
    border-left: 2px solid rgb(255 255 255 / 72%);
    background: rgb(0 0 0 / 20%);
    cursor: nwse-resize;
  }

  .target-controls {
    display: grid;
    gap: 10px;
  }

  .control-row {
    display: grid;
    grid-template-columns: minmax(120px, 1fr) auto;
    gap: 12px;
    align-items: center;
    padding: 10px;
    border: 1px solid #e4ded3;
    border-radius: 6px;
    background: #ffffff;
  }

  .target-name {
    display: grid;
    gap: 3px;
    min-width: 0;
  }

  .target-name strong,
  .target-name small {
    min-width: 0;
    overflow-wrap: anywhere;
  }

  .target-name small {
    color: #60706b;
  }

  .button-grid {
    display: grid;
    grid-template-columns: repeat(8, 34px);
    gap: 5px;
  }

  .button-grid button {
    width: 34px;
    height: 30px;
    padding: 0;
    border: 1px solid #c9d0ca;
    border-radius: 5px;
    background: #f7faf8;
    color: #26302e;
    cursor: pointer;
    font-size: 0.76rem;
    font-weight: 700;
  }

  .button-grid button:hover {
    border-color: #57776a;
    background: #edf4f0;
  }

  .empty {
    margin: 24px 0 0;
    color: #7d3c2f;
  }

  @media (max-width: 900px) {
    .canvas-heading,
    .control-row {
      display: grid;
    }

    .canvas-heading span {
      text-align: left;
    }

    .button-grid {
      grid-template-columns: repeat(4, 34px);
    }
  }
</style>

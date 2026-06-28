<script lang="ts">
  import type { Snippet } from "svelte";
  import {
    imageStoryAssetTypeForId,
    placeholderForMissingStoryAsset,
    resolveStoryAsset,
    type ResolvedStoryAsset,
  } from "$lib/assets/story-assets";
  import {
    alphaBoundsFromImageData,
    cropVariablesForAlphaBounds,
  } from "$lib/assets/alpha-crop";
  import type {
    CharacterLayout,
    CharacterView,
    HotspotLayout,
    HotspotView,
    SublocationView,
    TopicView,
  } from "../state/types";
  import { claimEscape } from "$lib/state/escape-coordinator";

  let {
    sublocation,
    backgroundAssetId = null,
    onInspect,
    onInterview,
    disabled = false,
    hud,
  }: {
    sublocation: SublocationView;
    backgroundAssetId?: string | null;
    onInspect: (id: string) => void;
    onInterview: (characterId: string, topicId: string) => void;
    disabled?: boolean;
    hud?: Snippet;
  } = $props();

  let activeCharacterId = $state<string | null>(null);
  let portraits = $state<Record<string, ResolvedStoryAsset | null>>({});
  let background = $state<ResolvedStoryAsset | null>(null);
  let cropStyles = $state<Record<string, string>>({});

  let placedHotspots = $derived(
    sublocation.hotspots.filter(
      (hotspot): hotspot is HotspotView & { layout: HotspotLayout } =>
        hotspot.layout !== null,
    ),
  );
  let unplacedHotspots = $derived(
    sublocation.hotspots.filter((hotspot) => hotspot.layout === null),
  );
  let placedCharacters = $derived(
    sublocation.characters.filter(
      (character): character is CharacterView & { layout: CharacterLayout } =>
        character.layout !== null,
    ),
  );
  let unplacedCharacters = $derived(
    sublocation.characters.filter((character) => character.layout === null),
  );
  let activeCharacter = $derived(
    placedCharacters.find((character) => character.id === activeCharacterId) ??
      null,
  );

  $effect(() => {
    let cancelled = false;
    portraits = {};

    for (const character of placedCharacters) {
      const { id, layout } = character;
      resolveStoryAsset(
        layout.assetId,
        imageStoryAssetTypeForId(layout.assetId),
      )
        .then((asset) => {
          if (!cancelled) portraits[id] = asset;
        })
        .catch(() => {
          if (!cancelled)
            portraits[id] = placeholderForMissingStoryAsset(
              layout.assetId,
              imageStoryAssetTypeForId(layout.assetId),
            );
        });
    }

    return () => {
      cancelled = true;
    };
  });

  $effect(() => {
    let cancelled = false;
    background = null;

    resolveStoryAsset(backgroundAssetId, "background")
      .then((asset) => {
        if (!cancelled) background = asset;
      })
      .catch(() => {
        if (!cancelled)
          background = placeholderForMissingStoryAsset(
            backgroundAssetId ?? "background.unknown",
            "background",
          );
      });

    return () => {
      cancelled = true;
    };
  });

  function percent(value: number) {
    return `${value * 100}%`;
  }

  function layoutStyle(layout: { x: number; y: number; w: number; h: number }) {
    return `--x: ${percent(layout.x)}; --y: ${percent(layout.y)}; --w: ${percent(layout.w)}; --h: ${percent(layout.h)};`;
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

  function toggleCharacter(characterId: string) {
    activeCharacterId = activeCharacterId === characterId ? null : characterId;
  }

  // Claim Escape while the topic popover is open so GameShell closes the
  // popover (one layer) instead of opening the game menu on the first
  // Escape. The claim is released automatically when the popover closes for
  // any reason — the × button, re-clicking the character, a topic interview
  // navigating away, the active character disappearing from the current
  // sublocation, or this component unmounting — because the $effect cleanup
  // runs whenever `activeCharacter` becomes null or the component tears
  // down. Keying on `activeCharacter` (not `activeCharacterId`) ensures the
  // claim also releases when the sublocation changes and the previously
  // active character is no longer placed, even though `activeCharacterId`
  // itself stays non-null. The cleanup also clears `activeCharacterId` so
  // that if the same character reappears later (e.g. the player navigates
  // back to the original sublocation) the popover does not reopen without
  // an explicit click. See $lib/state/escape-coordinator for the routing
  // contract.
  $effect(() => {
    if (!activeCharacter) return;
    const release = claimEscape(closeTopics);
    return () => {
      release();
      activeCharacterId = null;
    };
  });

  function interviewActive(topic: TopicView) {
    if (!activeCharacter) return;
    onInterview(activeCharacter.id, topic.id);
  }

  function closeTopics() {
    activeCharacterId = null;
  }

  function handleBackgroundError() {
    if (!background || background.placeholder) return;
    console.warn(
      `[InvestigationSceneSurface] Missing background asset: ${background.url} (assetId: ${background.assetId})`,
    );
    background = placeholderForMissingStoryAsset(
      background.assetId,
      "background",
    );
  }

  function handlePortraitError(
    character: CharacterView & { layout: CharacterLayout },
  ) {
    const current = portraits[character.id];
    if (!current || current.placeholder) return;
    console.warn(
      `[InvestigationSceneSurface] Missing portrait asset: ${current.url} (assetId: ${current.assetId})`,
    );
    portraits[character.id] = placeholderForMissingStoryAsset(
      character.layout.assetId,
      imageStoryAssetTypeForId(character.layout.assetId),
    );
  }
</script>

<section class="surface-shell" aria-label={`${sublocation.label}調查場景`}>
  {#if background}
    <img
      class="background-image"
      src={background.url}
      alt=""
      aria-hidden="true"
      onerror={handleBackgroundError}
    />
  {/if}

  <div class="scene-surface">
    <div class="scene-label">
      <span class="eyebrow">INVESTIGATION</span>
      <strong>{sublocation.label}</strong>
    </div>

    <div class="scene-coordinate-plane">
      {#each placedHotspots as hotspot (hotspot.id)}
        <button
          class="hotspot-target"
          class:inspected={hotspot.inspected}
          type="button"
          aria-label={`調查：${hotspot.label}`}
          style={layoutStyle(hotspot.layout)}
          {disabled}
          onclick={() => onInspect(hotspot.id)}
        >
          <span class="hotspot-content">
            <span class="hotspot-dot"></span>
            <span class="target-label">{hotspot.label}</span>
          </span>
          {#if hotspot.inspected}
            <span class="hotspot-check" aria-label="已調查">✓</span>
          {/if}
        </button>
      {/each}

      {#each placedCharacters as character (character.id)}
        <button
          class="character-target"
          type="button"
          aria-label={`詢問：${character.name}`}
          aria-expanded={activeCharacterId === character.id}
          aria-haspopup="dialog"
          style={layoutStyle(character.layout)}
          {disabled}
          onclick={() => toggleCharacter(character.id)}
        >
          <span class="character-highlight"></span>
          {#if portraits[character.id]}
            <div
              class="character-preview-crop"
              style={cropStyleForAsset(character.layout.assetId)}
            >
              <img
                src={portraits[character.id]?.url}
                alt=""
                aria-hidden="true"
                onload={(event) =>
                  loadCharacterCrop(character.layout.assetId, event)}
                onerror={() => handlePortraitError(character)}
              />
            </div>
          {:else}
            <span class="portrait-loading">{character.name}</span>
          {/if}
          <span class="character-name">{character.name}</span>
        </button>
      {/each}
    </div>

    {#if hud}
      <div class="scene-hud">
        {@render hud()}
      </div>
    {/if}
  </div>

  {#if activeCharacter}
    <div
      class="topic-popover"
      role="dialog"
      aria-label={`${activeCharacter.name}詢問項目`}
    >
      <div class="topic-heading">
        <div>
          <strong>{activeCharacter.name}</strong>
          <span>{activeCharacter.role}</span>
        </div>
        <button
          class="close-topics"
          type="button"
          aria-label="關閉詢問項目"
          onclick={closeTopics}
        >
          ×
        </button>
      </div>
      <div class="topic-actions">
        {#each activeCharacter.topics as topic (topic.id)}
          <button
            class:done={topic.discussed}
            type="button"
            {disabled}
            onclick={() => interviewActive(topic)}
          >
            <span>{topic.label}</span>
            {#if topic.discussed}
              <small>已詢問</small>
            {/if}
          </button>
        {/each}
      </div>
    </div>
  {/if}

  {#if unplacedHotspots.length > 0 || unplacedCharacters.length > 0}
    <div class="fallback-controls">
      {#if unplacedHotspots.length > 0}
        <section class="fallback-section" aria-label="未放置線索">
          <header>
            <span class="eyebrow">UNPLACED HOTSPOTS</span>
          </header>
          <div class="fallback-list">
            {#each unplacedHotspots as hotspot (hotspot.id)}
              <button
                class="fallback-button"
                class:done={hotspot.inspected}
                type="button"
                aria-label={`未放置：${hotspot.label}`}
                {disabled}
                onclick={() => onInspect(hotspot.id)}
              >
                <span>{hotspot.label}</span>
                <small>{hotspot.description}</small>
              </button>
            {/each}
          </div>
        </section>
      {/if}

      {#if unplacedCharacters.length > 0}
        <section class="fallback-section" aria-label="未放置證人">
          <header>
            <span class="eyebrow">UNPLACED WITNESSES</span>
          </header>
          <div class="fallback-list">
            {#each unplacedCharacters as character (character.id)}
              <div class="fallback-witness">
                <div class="witness-copy">
                  <strong>{character.name}</strong>
                  <small>{character.role}</small>
                  <p>{character.bio}</p>
                </div>
                <div class="fallback-topics">
                  {#each character.topics as topic (topic.id)}
                    <button
                      class:done={topic.discussed}
                      type="button"
                      {disabled}
                      onclick={() => onInterview(character.id, topic.id)}
                    >
                      <span>{topic.label}</span>
                      {#if topic.discussed}
                        <small>已詢問</small>
                      {/if}
                    </button>
                  {/each}
                </div>
              </div>
            {/each}
          </div>
        </section>
      {/if}
    </div>
  {/if}
</section>

<style>
  .surface-shell {
    padding: 0;
    height: 0;
    min-height: 0;
  }

  .scene-surface {
    --investigation-hud-top: 22px;
    --investigation-hud-inline: clamp(20px, 3vw, 40px);
    position: fixed;
    inset: 0;
    /* Below .fallback-controls so placed hotspot/character targets
       (pointer-events: auto) never cover the fallback panel in the overlap
       region. The topic-popover is rendered as a sibling (not a child of
       this isolation: isolate surface) with its own higher z-index, so it
       alone sits above the fallback panel. */
    z-index: 1;
    width: 100vw;
    max-width: none;
    height: 100vh;
    margin: 0;
    overflow: hidden;
    isolation: isolate;
    pointer-events: none;
  }

  .scene-coordinate-plane {
    --scene-cover-width: max(100vw, 177.77777778vh);
    --scene-cover-height: max(100vh, 56.25vw);
    position: absolute;
    left: 50%;
    top: 50%;
    width: var(--scene-cover-width);
    height: var(--scene-cover-height);
    transform: translate(-50%, -50%);
    pointer-events: none;
  }

  .background-image {
    position: fixed;
    inset: 0;
    z-index: -1;
    width: 100vw;
    height: 100vh;
    object-fit: cover;
    opacity: 0.62;
    pointer-events: none;
  }

  .scene-label {
    position: absolute;
    left: var(--investigation-hud-inline);
    top: var(--investigation-hud-top);
    z-index: 5;
    display: flex;
    flex-direction: column;
    gap: 4px;
    color: var(--bone);
    text-shadow: 0 1px 10px var(--cell);
    pointer-events: none;
  }

  .eyebrow {
    font-family: var(--impact);
    font-weight: 500;
    font-size: 9px;
    letter-spacing: 0.28em;
    color: var(--cyan);
    text-transform: uppercase;
  }

  .scene-label strong {
    font-family: var(--display-jp);
    font-weight: 400;
    font-size: 18px;
    letter-spacing: 0.12em;
  }

  .scene-hud {
    position: fixed;
    inset: 0;
    z-index: 9;
    pointer-events: none;
  }

  button {
    font: inherit;
  }

  .hotspot-target,
  .character-target {
    position: absolute;
    color: var(--bone);
    cursor: pointer;
    pointer-events: auto;
  }

  .hotspot-target {
    z-index: 4;
    left: var(--x);
    top: var(--y);
    width: var(--w);
    height: var(--h);
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    min-width: 72px;
    min-height: 44px;
    padding: 8px;
    border: 1px solid transparent;
    background: transparent;
    box-shadow: none;
    transition:
      border-color 0.18s,
      background 0.18s,
      transform 0.18s;
  }

  .hotspot-target:hover:not(:disabled),
  .hotspot-target:focus-visible:not(:disabled) {
    border-color: var(--crimson);
    background: var(--crimson-soft);
    transform: translateY(-1px);
  }

  .hotspot-target:hover:not(:disabled) .hotspot-content,
  .hotspot-target:focus-visible:not(:disabled) .hotspot-content {
    opacity: 1;
    transform: translateY(0);
  }

  .hotspot-target.inspected {
    opacity: 1;
  }

  .hotspot-content {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    opacity: 0;
    transform: translateY(2px);
    transition:
      opacity 0.18s,
      transform 0.18s;
  }

  .hotspot-dot {
    width: 9px;
    height: 9px;
    flex: 0 0 auto;
    border-radius: 999px;
    background: var(--cyan);
    box-shadow: 0 0 14px rgba(113, 209, 220, 0.72);
  }

  .target-label {
    font-family: var(--serif-jp);
    font-size: 12px;
    letter-spacing: 0.08em;
    line-height: 1.2;
  }

  .hotspot-check {
    position: absolute;
    top: 4px;
    right: 4px;
    display: grid;
    width: 18px;
    height: 18px;
    place-items: center;
    border: 1px solid var(--rule-strong);
    border-radius: 999px;
    background: rgba(10, 10, 16, 0.78);
    color: var(--cyan);
    font-family: var(--mono);
    font-size: 12px;
    line-height: 1;
  }

  .character-target {
    z-index: 2;
    left: var(--x);
    top: var(--y);
    width: var(--w);
    height: var(--h);
    display: flex;
    align-items: flex-end;
    justify-content: center;
    padding: 0;
    border: 0;
    background: transparent;
  }

  .character-highlight {
    position: absolute;
    inset: -6px;
    z-index: 0;
    border: 1px solid transparent;
    background: transparent;
    box-shadow: none;
    opacity: 0;
    transform: translateY(2px);
    transition:
      border-color 0.18s,
      background 0.18s,
      opacity 0.18s,
      transform 0.18s;
    pointer-events: none;
  }

  .character-target:hover:not(:disabled) .character-highlight,
  .character-target:focus-visible:not(:disabled) .character-highlight,
  .character-target[aria-expanded="true"] .character-highlight {
    border-color: var(--crimson);
    background: var(--crimson-soft);
    opacity: 1;
    transform: translateY(0);
  }

  .character-preview-crop,
  .portrait-loading {
    position: relative;
    z-index: 1;
    width: 100%;
    height: 100%;
    filter: drop-shadow(0 12px 24px rgba(0, 0, 0, 0.48));
  }

  .character-preview-crop {
    position: relative;
    overflow: hidden;
    pointer-events: none;
  }

  .character-preview-crop img {
    position: absolute;
    top: calc(-100% * var(--crop-top, 0) / var(--crop-height, 1));
    left: 50%;
    width: auto;
    max-width: none;
    height: calc(100% / var(--crop-height, 1));
    transform: translateX(-50%);
    object-fit: contain;
    object-position: bottom center;
    pointer-events: none;
  }

  .character-preview-crop:not([style]) img,
  .character-preview-crop[style=""] img {
    inset: 0;
    width: 100%;
    height: 100%;
    transform: none;
    object-fit: contain;
  }

  .portrait-loading {
    display: grid;
    place-items: center;
    padding: 10px;
    border: 1px solid var(--rule-strong);
    background: rgba(20, 20, 31, 0.82);
    color: var(--bone-dim);
    font-family: var(--serif-jp);
    font-size: 13px;
    text-align: center;
  }

  .character-name {
    position: absolute;
    top: 10px;
    right: 10px;
    z-index: 2;
    transform: translateY(-2px);
    max-width: min(220px, calc(100% - 20px));
    padding: 6px 10px 5px;
    overflow: hidden;
    background: rgba(10, 10, 16, 0.82);
    border: 1px solid transparent;
    color: var(--bone);
    font-family: var(--serif-jp);
    font-size: 18px;
    letter-spacing: 0.08em;
    opacity: 0;
    pointer-events: none;
    text-overflow: ellipsis;
    white-space: nowrap;
    transition:
      border-color 0.18s,
      background 0.18s,
      color 0.18s,
      opacity 0.18s,
      transform 0.18s;
  }

  .character-target:hover:not(:disabled) .character-name,
  .character-target:focus-visible:not(:disabled) .character-name,
  .character-target[aria-expanded="true"] .character-name {
    border-color: var(--crimson);
    background: rgba(32, 12, 19, 0.84);
    color: var(--bone);
    opacity: 1;
    transform: translateY(0);
  }

  button:disabled {
    opacity: 0.55;
    cursor: wait;
  }

  .topic-popover {
    position: fixed;
    right: 18px;
    bottom: 18px;
    /* Above .fallback-controls so the popover stays accessible when both
       are visible. Rendered as a sibling of .scene-surface (which has
       isolation: isolate and a lower z-index), so this z-index participates
       in the root stacking context directly. */
    z-index: 11;
    width: min(320px, calc(100% - 36px));
    padding: 12px;
    border: 1px solid var(--rule-strong);
    background: rgba(20, 20, 31, 0.92);
    color: var(--bone);
    box-shadow: 0 14px 28px rgba(0, 0, 0, 0.28);
    pointer-events: auto;
  }

  .topic-heading,
  .witness-copy {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .topic-heading {
    flex-direction: row;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
  }

  .topic-heading strong,
  .witness-copy strong {
    font-family: var(--display-jp);
    font-weight: 400;
    font-size: 16px;
    letter-spacing: 0.1em;
  }

  .topic-heading span,
  .witness-copy small {
    display: block;
    color: var(--bone-dim);
    font-family: var(--serif-jp);
    font-size: 12px;
    letter-spacing: 0.06em;
  }

  .witness-copy p {
    margin: 4px 0 0;
    color: var(--bone-dim);
    font-family: var(--serif-jp);
    font-size: 12px;
    line-height: 1.5;
  }

  .close-topics {
    width: 28px;
    height: 28px;
    flex: 0 0 auto;
    border: 1px solid var(--rule);
    background: transparent;
    color: var(--bone-dim);
    cursor: pointer;
    font-family: var(--mono);
    font-size: 16px;
    line-height: 1;
  }

  .close-topics:hover:not(:disabled),
  .close-topics:focus-visible:not(:disabled) {
    border-color: var(--crimson);
    color: var(--bone);
  }

  .topic-actions,
  .fallback-topics,
  .fallback-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .topic-actions {
    margin-top: 12px;
  }

  .topic-actions button,
  .fallback-topics button,
  .fallback-button {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    width: 100%;
    padding: 8px 10px;
    border: 1px solid var(--rule);
    background: transparent;
    color: var(--bone);
    cursor: pointer;
    text-align: left;
    font-family: var(--serif-jp);
    font-size: 13px;
  }

  .topic-actions button:hover:not(:disabled),
  .fallback-topics button:hover:not(:disabled),
  .fallback-button:hover:not(:disabled) {
    border-color: var(--crimson);
    background: var(--crimson-soft);
  }

  .topic-actions button.done,
  .fallback-topics button.done,
  .fallback-button.done {
    opacity: 0.66;
  }

  .topic-actions small,
  .fallback-topics small,
  .fallback-button small {
    color: var(--bone-faint);
    font-family: var(--mono);
    font-size: 9px;
    letter-spacing: 0.2em;
    text-transform: uppercase;
  }

  .fallback-controls {
    position: fixed;
    left: clamp(20px, 3vw, 40px);
    right: clamp(20px, 3vw, 40px);
    bottom: 16px;
    z-index: 10;
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
    gap: 16px;
    max-height: min(36vh, 280px);
    overflow-y: auto;
    pointer-events: auto;
  }

  .fallback-section {
    border-block: 1px solid var(--rule);
    padding-block: 12px;
  }

  .fallback-section header {
    margin-bottom: 10px;
  }

  .fallback-button {
    align-items: flex-start;
    flex-direction: column;
  }

  .fallback-button span {
    color: var(--bone);
    letter-spacing: 0.08em;
  }

  .fallback-button small {
    font-family: var(--serif-jp);
    font-size: 12px;
    letter-spacing: 0.04em;
    line-height: 1.5;
    text-transform: none;
  }

  .fallback-witness {
    display: grid;
    grid-template-columns: minmax(120px, 0.7fr) 1fr;
    gap: 12px;
    align-items: start;
    padding: 10px 0;
    border-top: 1px solid var(--rule);
  }

  .fallback-witness:first-child {
    border-top: 0;
    padding-top: 0;
  }

  @media (max-width: 720px) {
    /* lyra-mobile-breakpoint — see tokens.css. */
    .surface-shell {
      padding: 0;
    }

    .target-label {
      display: none;
    }

    .fallback-controls {
      left: 12px;
      right: 12px;
      bottom: 12px;
      grid-template-columns: 1fr;
    }

    .fallback-witness {
      grid-template-columns: 1fr;
    }
  }
</style>

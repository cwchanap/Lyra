<script lang="ts">
  import {
    placeholderForMissingStoryAsset,
    resolveStoryAsset,
    type ResolvedStoryAsset,
  } from "$lib/assets/story-assets";
  import type {
    CharacterLayout,
    CharacterView,
    HotspotLayout,
    HotspotView,
    SublocationView,
    TopicView,
  } from "../state/types";

  let {
    sublocation,
    backgroundAssetId = null,
    onInspect,
    onInterview,
    disabled = false,
  }: {
    sublocation: SublocationView;
    backgroundAssetId?: string | null;
    onInspect: (id: string) => void;
    onInterview: (characterId: string, topicId: string) => void;
    disabled?: boolean;
  } = $props();

  let activeCharacterId = $state<string | null>(null);
  let portraits = $state<Record<string, ResolvedStoryAsset | null>>({});
  let background = $state<ResolvedStoryAsset | null>(null);

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
      resolveStoryAsset(layout.assetId, "portrait").then((asset) => {
        if (!cancelled) portraits = { ...portraits, [id]: asset };
      });
    }

    return () => {
      cancelled = true;
    };
  });

  $effect(() => {
    let cancelled = false;
    background = null;

    resolveStoryAsset(backgroundAssetId, "background").then((asset) => {
      if (!cancelled) background = asset;
    });

    return () => {
      cancelled = true;
    };
  });

  function percent(value: number) {
    return `${value * 100}%`;
  }

  function rectStyle(layout: HotspotLayout) {
    return `--x: ${percent(layout.x)}; --y: ${percent(layout.y)}; --w: ${percent(layout.w)}; --h: ${percent(layout.h)};`;
  }

  function spriteStyle(layout: CharacterLayout) {
    return `--x: ${percent(layout.x)}; --y: ${percent(layout.y)}; --w: ${percent(layout.w)}; --h: ${percent(layout.h)};`;
  }

  function toggleCharacter(characterId: string) {
    activeCharacterId = activeCharacterId === characterId ? null : characterId;
  }

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
    portraits = {
      ...portraits,
      [character.id]: placeholderForMissingStoryAsset(
        character.layout.assetId,
        "portrait",
      ),
    };
  }
</script>

<section class="surface-shell" aria-label={`${sublocation.label}調查場景`}>
  <div class="scene-surface">
    {#if background}
      <img
        class="background-image"
        src={background.url}
        alt=""
        aria-hidden="true"
        onerror={handleBackgroundError}
      />
    {/if}

    <div class="scene-label">
      <span class="eyebrow">INVESTIGATION</span>
      <strong>{sublocation.label}</strong>
    </div>

    {#each placedHotspots as hotspot (hotspot.id)}
      <button
        class="hotspot-target"
        class:inspected={hotspot.inspected}
        type="button"
        aria-label={`調查：${hotspot.label}`}
        style={rectStyle(hotspot.layout)}
        {disabled}
        onclick={() => onInspect(hotspot.id)}
      >
        <span class="hotspot-dot"></span>
        <span class="target-label">{hotspot.label}</span>
        {#if hotspot.inspected}
          <span class="status">已調查</span>
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
        style={spriteStyle(character.layout)}
        {disabled}
        onclick={() => toggleCharacter(character.id)}
      >
        {#if portraits[character.id]}
          <img
            src={portraits[character.id]?.url}
            alt=""
            aria-hidden="true"
            onerror={() => handlePortraitError(character)}
          />
        {:else}
          <span class="portrait-loading">{character.name}</span>
        {/if}
        <span class="character-name">{character.name}</span>
      </button>
    {/each}

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
  </div>

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
    padding: 8px clamp(20px, 3vw, 40px) 140px;
  }

  .scene-surface {
    position: relative;
    width: min(100%, calc((100vh - 220px) * 16 / 9));
    max-width: 1280px;
    aspect-ratio: 16 / 9;
    margin: 0 auto;
    overflow: hidden;
    isolation: isolate;
    border-block: 1px solid var(--rule-strong);
    background:
      linear-gradient(rgba(255, 255, 255, 0.025) 1px, transparent 1px),
      linear-gradient(90deg, rgba(255, 255, 255, 0.02) 1px, transparent 1px),
      rgba(20, 20, 31, 0.58);
    background-size: 32px 32px;
  }

  .background-image {
    position: absolute;
    inset: 0;
    z-index: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    opacity: 0.62;
    pointer-events: none;
  }

  .scene-label {
    position: absolute;
    left: 18px;
    top: 16px;
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

  button {
    font: inherit;
  }

  .hotspot-target,
  .character-target {
    position: absolute;
    color: var(--bone);
    cursor: pointer;
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
    border: 1px solid rgba(113, 209, 220, 0.58);
    background: rgba(9, 19, 28, 0.42);
    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.04);
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

  .hotspot-target.inspected {
    border-color: var(--rule-strong);
    opacity: 0.74;
  }

  .hotspot-dot {
    width: 9px;
    height: 9px;
    flex: 0 0 auto;
    border-radius: 999px;
    background: var(--cyan);
    box-shadow: 0 0 14px rgba(113, 209, 220, 0.72);
  }

  .target-label,
  .status {
    font-family: var(--serif-jp);
    font-size: 12px;
    letter-spacing: 0.08em;
    line-height: 1.2;
  }

  .status {
    color: var(--bone-faint);
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

  .character-target img,
  .portrait-loading {
    width: 100%;
    height: 100%;
    object-fit: contain;
    object-position: bottom center;
    filter: drop-shadow(0 12px 24px rgba(0, 0, 0, 0.48));
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
    left: 50%;
    bottom: -28px;
    transform: translateX(-50%);
    padding: 4px 8px;
    max-width: 140px;
    background: rgba(10, 10, 16, 0.74);
    border: 1px solid var(--rule);
    color: var(--bone);
    font-family: var(--serif-jp);
    font-size: 12px;
    letter-spacing: 0.08em;
    white-space: nowrap;
  }

  .character-target:hover:not(:disabled) .character-name,
  .character-target:focus-visible:not(:disabled) .character-name,
  .character-target[aria-expanded="true"] .character-name {
    border-color: var(--crimson);
    color: var(--bone);
  }

  button:disabled {
    opacity: 0.55;
    cursor: wait;
  }

  .topic-popover {
    position: absolute;
    right: 18px;
    bottom: 18px;
    z-index: 6;
    width: min(320px, calc(100% - 36px));
    padding: 12px;
    border: 1px solid var(--rule-strong);
    background: rgba(20, 20, 31, 0.92);
    color: var(--bone);
    box-shadow: 0 14px 28px rgba(0, 0, 0, 0.28);
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
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
    gap: 16px;
    margin-top: 16px;
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
    .surface-shell {
      padding-inline: 16px;
    }

    .target-label,
    .status {
      display: none;
    }

    .fallback-witness {
      grid-template-columns: 1fr;
    }
  }
</style>

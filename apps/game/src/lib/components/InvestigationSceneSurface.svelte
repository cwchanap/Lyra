<script lang="ts">
  import { SvelteMap, SvelteSet } from "svelte/reactivity";
  import type { Snippet } from "svelte";
  import CrossfadeImage from "./CrossfadeImage.svelte";
  import InterrogationEvidenceTray from "./InterrogationEvidenceTray.svelte";
  import {
    imageStoryAssetTypeForId,
    placeholderForMissingStoryAsset,
    resolveStoryAsset,
    type ResolvedStoryAsset,
  } from "$lib/assets/story-assets";
  import {
    alphaBoundsFromImageData,
    cropVariablesForAlphaBounds,
  } from "@lyra/shared";
  import type {
    CharacterLayout,
    CharacterView,
    FeedbackLine,
    HotspotLayout,
    HotspotView,
    Inventory,
    SublocationView,
    TopicView,
  } from "../state/types";
  import { claimEscape } from "$lib/state/escape-coordinator";
  import { undiscussedTopicCount } from "$lib/investigation/progress";
  import { targetLayoutStyle } from "$lib/investigation/target-layout";

  let {
    sublocation,
    backgroundAssetId = null,
    onInspect,
    onInterview,
    inventory = { evidence: [], statements: [] },
    onPresent = () => {},
    presentFeedback = null,
    disabled = false,
    hud,
  }: {
    sublocation: SublocationView;
    backgroundAssetId?: string | null;
    onInspect: (id: string) => void;
    onInterview: (characterId: string, topicId: string) => void;
    /** The records the 出示紀錄 tray offers. */
    inventory?: Inventory;
    onPresent?: (
      characterId: string,
      kind: "evidence" | "statement",
      itemId: string,
    ) => void;
    /** A character's reply to a shown record that opened nothing. */
    presentFeedback?: { characterId: string; line: FeedbackLine } | null;
    disabled?: boolean;
    hud?: Snippet;
  } = $props();

  // A Present topic stays out of the list until a shown record opens it.
  function listedTopics(character: CharacterView): TopicView[] {
    return character.topics.filter(
      (topic) => !topic.requiresPresent || topic.discussed,
    );
  }

  function feedbackFor(character: CharacterView): FeedbackLine | null {
    return presentFeedback?.characterId === character.id
      ? presentFeedback.line
      : null;
  }

  let presentingCharacterId = $state<string | null>(null);
  let presentingCharacter = $derived(
    sublocation.characters.find(
      (character) => character.id === presentingCharacterId,
    ) ?? null,
  );

  function closePresentTray() {
    presentingCharacterId = null;
  }

  function presentRecord(kind: "evidence" | "statement", itemId: string) {
    const character = presentingCharacter;
    presentingCharacterId = null;
    if (character) onPresent(character.id, kind, itemId);
  }

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
  // .hotspot-target clamps each button to a 72×44px minimum target, which
  // drags a small painted rect over its neighbours and steals their clicks
  // wherever two expanded boxes overlap. Buttons size as border-box (the
  // WebKit/Chromium UA default; nothing here overrides it), so the 8px
  // padding and 1px border live INSIDE the box and only the clamp extends
  // the hit edge right/down (the border box is anchored at the authored
  // top-left). A collision is therefore resolved by compacting just the
  // culprit box on the axis whose clamp caused it: compact-x/compact-y zero
  // that axis's min-size, restoring the hit edge to the authored edge while
  // the free axis keeps its minimum-target affordance. Pairs whose authored
  // rects already intersect on both axes compact fully — unless the layout
  // sidecar declared them in intentionalOverlaps, which keeps the minimum
  // size as authored intent. Characters (z-index 2, never expanded) can only
  // be stolen from, so the hotspot side compacts.
  // Expansion is evaluated at the minimum window (tauri.conf.json
  // minWidth/minHeight), where the cover plane is ~1067×600px;
  // clamp-induced collisions are monotonic in viewport size, so a pair safe
  // there is safe larger.
  const MIN_TARGET_PX = { w: 72, h: 44 };
  const MIN_COVER_PLANE_PX = {
    w: Math.max(800, (16 / 9) * 600),
    h: Math.max(600, (9 / 16) * 800),
  };

  type HitRect = { left: number; top: number; right: number; bottom: number };
  type CompactAxis = "x" | "y";

  function authoredRect(layout: {
    x: number;
    y: number;
    w: number;
    h: number;
  }): HitRect {
    const left = layout.x * MIN_COVER_PLANE_PX.w;
    const top = layout.y * MIN_COVER_PLANE_PX.h;
    return {
      left,
      top,
      right: left + layout.w * MIN_COVER_PLANE_PX.w,
      bottom: top + layout.h * MIN_COVER_PLANE_PX.h,
    };
  }

  function hotspotHitRect(layout: HotspotLayout): HitRect {
    const rect = authoredRect(layout);
    return {
      left: rect.left,
      top: rect.top,
      right: rect.left + Math.max(rect.right - rect.left, MIN_TARGET_PX.w),
      bottom: rect.top + Math.max(rect.bottom - rect.top, MIN_TARGET_PX.h),
    };
  }

  function hitRectsIntersect(a: HitRect, b: HitRect) {
    return overlapOnX(a, b) && overlapOnY(a, b);
  }

  function overlapOnX(a: HitRect, b: HitRect) {
    return a.left < b.right && b.left < a.right;
  }

  function overlapOnY(a: HitRect, b: HitRect) {
    return a.top < b.bottom && b.top < a.bottom;
  }

  function overlapPairKey(a: string, b: string): string {
    return a < b ? `${a}\0${b}` : `${b}\0${a}`;
  }

  let compactHotspotClasses = $derived.by(() => {
    const declaredOverlaps = new Set(
      (sublocation.intentionalOverlaps ?? []).map(({ hotspots }) =>
        overlapPairKey(hotspots[0], hotspots[1]),
      ),
    );
    const boxes = placedHotspots.map((hotspot) => ({
      id: hotspot.id,
      authored: authoredRect(hotspot.layout),
      clamped: hotspotHitRect(hotspot.layout),
    }));
    type HitBox = (typeof boxes)[number];
    // Scratch collections local to this $derived.by; svelte/prefer-svelte-reactivity
    // requires the reactive variants even for non-reactive scratch use.
    const axesById = new SvelteMap<string, SvelteSet<CompactAxis>>();
    const markCompact = (id: string, axis: CompactAxis) => {
      const axes = axesById.get(id) ?? new SvelteSet<CompactAxis>();
      axes.add(axis);
      axesById.set(id, axes);
    };
    const authoredSize = (box: HitBox, axis: CompactAxis) =>
      axis === "x"
        ? box.authored.right - box.authored.left
        : box.authored.bottom - box.authored.top;
    // Compacting an axis drops its clamp as well as its chrome, so prefer
    // the axis where the culprit already meets the minimum — the hit box it
    // keeps is larger.
    const leastLossAxis = (
      candidates: { axis: CompactAxis; culprit: HitBox }[],
    ) =>
      (candidates.find(
        ({ axis, culprit }) =>
          authoredSize(culprit, axis) >=
          (axis === "x" ? MIN_TARGET_PX.w : MIN_TARGET_PX.h),
      ) ?? candidates[0])!;
    for (const [index, a] of boxes.entries()) {
      for (const b of boxes.slice(index + 1)) {
        if (declaredOverlaps.has(overlapPairKey(a.id, b.id))) continue;
        if (!hitRectsIntersect(a.clamped, b.clamped)) continue;
        const freeX = !overlapOnX(a.authored, b.authored);
        const freeY = !overlapOnY(a.authored, b.authored);
        if (!freeX && !freeY) {
          // Undeclared authored overlap: both boxes fall to authored size so
          // the clamp can't enlarge the theft area.
          for (const box of [a, b]) {
            markCompact(box.id, "x");
            markCompact(box.id, "y");
          }
          continue;
        }
        const candidates: { axis: CompactAxis; culprit: HitBox }[] = [];
        if (freeX)
          candidates.push({
            axis: "x",
            culprit: a.authored.left <= b.authored.left ? a : b,
          });
        if (freeY)
          candidates.push({
            axis: "y",
            culprit: a.authored.top <= b.authored.top ? a : b,
          });
        const { axis, culprit } = leastLossAxis(candidates);
        markCompact(culprit.id, axis);
      }
      for (const character of placedCharacters) {
        const characterRect = authoredRect(character.layout);
        if (!hitRectsIntersect(a.clamped, characterRect)) continue;
        const freeX = !overlapOnX(a.authored, characterRect);
        const freeY = !overlapOnY(a.authored, characterRect);
        if (!freeX && !freeY) {
          markCompact(a.id, "x");
          markCompact(a.id, "y");
          continue;
        }
        // The character's box is authored-exact, so only the hotspot's own
        // right/bottom extension could have crossed a disjoint authored
        // edge — the hotspot is necessarily the culprit on a free axis.
        const candidates: { axis: CompactAxis; culprit: HitBox }[] = [];
        if (freeX) candidates.push({ axis: "x", culprit: a });
        if (freeY) candidates.push({ axis: "y", culprit: a });
        markCompact(a.id, leastLossAxis(candidates).axis);
      }
    }
    const classes = new SvelteMap<
      string,
      "compact" | "compact-x" | "compact-y"
    >();
    for (const [id, axes] of axesById) {
      classes.set(
        id,
        axes.size === 2 ? "compact" : axes.has("x") ? "compact-x" : "compact-y",
      );
    }
    return classes;
  });
  let activeCharacter = $derived(
    placedCharacters.find((character) => character.id === activeCharacterId) ??
      null,
  );

  $effect(() => {
    let cancelled = false;

    for (const character of placedCharacters) {
      const { id, layout } = character;
      if (layout.kind !== "sprite") continue;
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
  // itself stays non-null.
  //
  // The cleanup MUST NOT clear `activeCharacterId`. Svelte 5 defers state
  // writes from event handlers until the effect flush, and the cleanup runs
  // against the pre-flush snapshot — so when the player clicks a different
  // placed character, `toggleCharacter`'s fresh `activeCharacterId = "<new>"`
  // write is still queued and the cleanup reads the stale previous id.
  // Clearing there would clobber that fresh selection and the new
  // character's popover would never open until the player clicks it again.
  // Instead, the stale-id clear happens in the body, which runs after queued
  // writes are applied, and only when `activeCharacter` is genuinely null
  // (the character disappeared from the current sublocation) — so a
  // witness→suspect switch (where `activeCharacter` stays non-null) is
  // untouched, while a sublocation change that drops the active character
  // still clears the id so the popover does not reopen without an explicit
  // click if the player navigates back. See $lib/state/escape-coordinator
  // for the routing contract.
  $effect(() => {
    const current = activeCharacter;
    if (!current) {
      if (activeCharacterId !== null) {
        activeCharacterId = null;
      }
      return;
    }
    const release = claimEscape(closeTopics);
    return () => {
      release();
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

  function handlePortraitError(characterId: string) {
    const current = portraits[characterId];
    if (!current || current.placeholder) return;
    console.warn(
      `[InvestigationSceneSurface] Missing portrait asset: ${current.url} (assetId: ${current.assetId})`,
    );
    portraits[characterId] = placeholderForMissingStoryAsset(
      current.assetId,
      imageStoryAssetTypeForId(current.assetId),
    );
  }
</script>

<section class="surface-shell" aria-label={`${sublocation.label}調查場景`}>
  <CrossfadeImage
    src={background?.url ?? null}
    imageClass="background-image"
    imageStyle="--crossfade-visible-opacity: 0.62;"
    dataAttributes={{ "save-thumbnail-asset-role": "background" }}
    alt=""
    ariaHidden={true}
    onImageError={handleBackgroundError}
  />

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
          class:compact={compactHotspotClasses.get(hotspot.id) === "compact"}
          class:compact-x={compactHotspotClasses.get(hotspot.id) ===
            "compact-x"}
          class:compact-y={compactHotspotClasses.get(hotspot.id) ===
            "compact-y"}
          type="button"
          aria-label={`調查：${hotspot.label}`}
          style={targetLayoutStyle(hotspot.layout)}
          {disabled}
          onclick={() => onInspect(hotspot.id)}
        >
          <span class="hotspot-content">
            <span class="hotspot-dot"></span>
            <span class="target-label">{hotspot.label}</span>
          </span>
          {#if hotspot.inspected}
            <span class="hotspot-check" aria-label="已調查">✓</span>
          {:else}
            <span class="target-pending" aria-hidden="true"></span>
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
          style={targetLayoutStyle(character.layout)}
          {disabled}
          onclick={() => toggleCharacter(character.id)}
        >
          <span class="character-highlight"></span>
          {#if character.layout.kind === "sprite"}
            {#if portraits[character.id]}
              {@const portrait = portraits[character.id]!}
              <div class="character-preview-crop">
                <CrossfadeImage
                  src={portrait.url}
                  imageClass=""
                  imageStyle={cropStyleForAsset(portrait.assetId)}
                  alt=""
                  ariaHidden={true}
                  onImageLoad={(event) =>
                    loadCharacterCrop(portrait.assetId, event)}
                  onImageError={() => handlePortraitError(character.id)}
                />
              </div>
            {:else}
              <span class="portrait-loading">{character.name}</span>
            {/if}
          {/if}
          {#if undiscussedTopicCount(character) > 0}
            <span class="target-pending character-pending" aria-hidden="true"
            ></span>
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
        {#each listedTopics(activeCharacter) as topic (topic.id)}
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
        {#if activeCharacter.acceptsPresent}
          {@render presentButton(activeCharacter)}
        {/if}
      </div>
      {@render presentReply(activeCharacter)}
    </div>
  {/if}

  {#snippet presentButton(character: CharacterView)}
    <button
      class="present-record"
      type="button"
      {disabled}
      onclick={() => (presentingCharacterId = character.id)}
    >
      <span>出示紀錄</span>
      <small>SHOW</small>
    </button>
  {/snippet}

  {#snippet presentReply(character: CharacterView)}
    {@const reply = feedbackFor(character)}
    {#if reply}
      <p class="present-reply" role="status">
        {#if reply.speaker}
          <strong>{reply.speaker}</strong>{reply.text}
        {:else}
          <em>{reply.text}</em>
        {/if}
      </p>
    {/if}
  {/snippet}

  {#if presentingCharacter}
    <InterrogationEvidenceTray
      presentTo={presentingCharacter}
      {inventory}
      onPresent={presentRecord}
      onResume={closePresentTray}
      {disabled}
    />
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
                  {#each listedTopics(character) as topic (topic.id)}
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
                  {#if character.acceptsPresent}
                    {@render presentButton(character)}
                  {/if}
                  {@render presentReply(character)}
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

  .surface-shell > :global(img.background-image) {
    position: fixed;
    inset: 0;
    z-index: -1;
    width: 100vw;
    height: 100vh;
    object-fit: cover;
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

  .hotspot-target.compact {
    min-width: 0;
    min-height: 0;
  }

  /* Single-axis compact: remove only this axis's clamp so the hit edge
     returns to the authored edge while the other axis keeps the
     minimum-target affordance. Padding and border stay — the button sizes
     as border-box, so they live inside the box and never extend the hit
     edge; keeping the border whole also keeps the focus outline on all
     four sides. */
  .hotspot-target.compact-x {
    min-width: 0;
  }

  .hotspot-target.compact-y {
    min-height: 0;
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
    /* The label overflows small compact targets and would extend the
       button's hit area past its box. */
    pointer-events: none;
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
    /* Narrow (compact) targets would otherwise stack the label one
       character per line; it may overflow the box, which never widens the
       hit area (.hotspot-content has pointer-events: none). */
    white-space: nowrap;
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
    /* The badge overflows a compact target shorter than ~22px and would
       extend the button's hit area past its box, like .hotspot-content. */
    pointer-events: none;
  }

  /* Always-visible cue on targets the player has not finished, so the auto
     outro's remaining work can be found without hovering every prop. It
     sits where the inspected check appears and, like it, never extends the
     hit area.
     The scene plane overhangs any window that is not 16:9 (about 133px off
     each side at 800×600), so a target's corner can sit offscreen. The cue
     keeps its preferred corner but is clamped into the part of its target
     that is inside the viewport; the target's viewport offset comes from
     the plane's cover size and the layout ratios, so no hit box moves. A
     target with no visible part keeps its cue on itself, offscreen. */
  .target-pending {
    --pending-inset: 6px;
    --pending-size: 12px;
    --pending-left: calc(100% - var(--pending-inset) - var(--pending-size));
    --pending-target-left: calc(
      var(--x-ratio) * var(--scene-cover-width) -
        (var(--scene-cover-width) - 100vw) / 2
    );
    --pending-target-top: calc(
      var(--y-ratio) * var(--scene-cover-height) -
        (var(--scene-cover-height) - 100vh) / 2
    );
    position: absolute;
    left: clamp(
      max(0px, calc(var(--pending-inset) - var(--pending-target-left))),
      var(--pending-left),
      min(
        calc(100% - var(--pending-size)),
        calc(
          100vw - var(--pending-target-left) - var(--pending-inset) -
            var(--pending-size)
        )
      )
    );
    top: clamp(
      max(0px, calc(var(--pending-inset) - var(--pending-target-top))),
      var(--pending-inset),
      min(
        calc(100% - var(--pending-size)),
        calc(
          100vh - var(--pending-target-top) - var(--pending-inset) -
            var(--pending-size)
        )
      )
    );
    z-index: 3;
    box-sizing: border-box;
    width: var(--pending-size);
    height: var(--pending-size);
    border: 1px solid rgba(10, 10, 16, 0.72);
    border-radius: 999px;
    background: var(--cyan);
    box-shadow: 0 0 10px rgba(113, 209, 220, 0.8);
    opacity: 0.85;
    pointer-events: none;
    animation: target-pending-pulse 2.4s ease-in-out infinite;
  }

  .character-pending {
    --pending-inset: 10px;
    --pending-left: var(--pending-inset);
  }

  @keyframes target-pending-pulse {
    0%,
    100% {
      opacity: 0.85;
      transform: scale(1);
    }
    50% {
      opacity: 0.45;
      transform: scale(0.8);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .target-pending {
      animation: none;
    }
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

  .character-preview-crop :global(img) {
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

  .character-preview-crop :global(img:not([style*="--crop-height"])) {
    inset: 0;
    width: 100%;
    height: 100%;
    left: auto;
    top: auto;
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

  .topic-actions button.present-record,
  .fallback-topics button.present-record {
    border-color: rgba(174, 28, 49, 0.6);
    border-style: dashed;
  }

  .present-reply {
    margin: 10px 0 0;
    padding: 6px 10px;
    border-left: 2px solid var(--cyan);
    background: rgba(236, 228, 207, 0.05);
    color: var(--bone-dim);
    font-family: var(--serif-jp);
    font-size: 13px;
    line-height: 1.6;
  }

  .present-reply strong {
    margin-right: 0.6em;
    color: var(--bone);
    font-weight: 400;
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

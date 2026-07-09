# Scene Image Crossfade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace abrupt scene background and character portrait cutovers with a direct 300 ms crossfade that keeps the old image visible until the new image is loaded.

**Architecture:** Add one reusable Svelte 5 `CrossfadeImage` presentation component that renders one or more `<img>` layers and owns cutover timing. Existing Lyra components keep resolving story asset IDs and handling missing-asset fallbacks locally, then pass resolved URLs to the shared component.

**Tech Stack:** Svelte 5 runes, `@testing-library/svelte`, Vitest fake timers, existing Lyra asset resolver helpers, Bun workspace scripts.

## Global Constraints

- Direct crossfade only: no black veil, iris wipe, or full-screen cinematic transition.
- Default transition duration is exactly `300` ms.
- Do not remove the old image until the replacement image has loaded.
- `prefers-reduced-motion: reduce` must make the opacity transition near-instant while preserving the load-before-removal rule.
- No Rust runtime, scene compiler, asset manifest, authoring-format, generated image, menu, inventory, dialogue log, or audio behavior changes.
- Preserve current component-owned missing asset warnings and placeholder fallback behavior.
- Preserve the fixed viewport backdrop contract for story/interrogation and investigation backgrounds.
- Preserve current investigation coordinate plane and alpha crop math.

---

## File Structure

- Create `apps/game/src/lib/components/CrossfadeImage.svelte`
  - Owns image layer state, load/error forwarding, opacity class state, cleanup timers, and reduced-motion CSS.
  - Renders raw `<img>` siblings instead of wrapping them, so existing selectors such as `img.background-image` and `.character-preview-crop img` keep working.
- Create `apps/game/src/lib/components/CrossfadeImage.test.ts`
  - Unit tests for layer retention, load-gated activation, cleanup, null fade-out, error forwarding, and source-level CSS contract.
- Modify `apps/game/src/lib/components/SceneBackdrop.svelte`
  - Use `CrossfadeImage` for the viewport background and stop clearing the visible background during async resolution.
- Modify `apps/game/src/lib/components/SceneBackdrop.test.ts`
  - Assert crossfade import/use and verify old/new background layers coexist during a source change.
- Modify `apps/game/src/lib/components/DialogueBox.svelte`
  - Use `CrossfadeImage` for speaker portraits and stop clearing visible portraits during async resolution.
- Modify `apps/game/src/lib/components/DialogueBox.test.ts`
  - Assert placement/data attributes still sit on the rendered `<img>` and old/new portrait layers coexist during a source change.
- Modify `apps/game/src/lib/components/InvestigationSceneSurface.svelte`
  - Use `CrossfadeImage` for the viewport background and each placed character image.
  - Stop clearing visible background/portrait state during async resolution.
- Modify `apps/game/src/lib/components/InvestigationSceneSurface.test.ts`
  - Assert investigation background and placed character images use the crossfade path and preserve existing CSS/layout contracts.

---

### Task 1: Shared CrossfadeImage Component

**Files:**

- Create: `apps/game/src/lib/components/CrossfadeImage.svelte`
- Create: `apps/game/src/lib/components/CrossfadeImage.test.ts`

**Interfaces:**

- Produces: Svelte component `CrossfadeImage` with props:
  - `src: string | null`
  - `alt?: string`
  - `imageClass?: string`
  - `imageStyle?: string`
  - `durationMs?: number`
  - `ariaHidden?: boolean | "true" | "false"`
  - `dataAttributes?: Record<string, string | number | boolean | null | undefined>`
  - `onImageLoad?: (event: Event) => void`
  - `onImageError?: (event: Event) => void`
- Later tasks consume: raw `<img>` elements with caller-provided classes, plus internal classes `crossfade-image-layer`, `visible`, and `leaving`.

- [ ] **Step 1: Write the failing component tests**

Create `apps/game/src/lib/components/CrossfadeImage.test.ts`:

```ts
import { fireEvent, render, waitFor } from "@testing-library/svelte";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import CrossfadeImage from "./CrossfadeImage.svelte";

function imageSources(container: HTMLElement) {
  return Array.from(container.querySelectorAll("img")).map((img) =>
    img.getAttribute("src"),
  );
}

function firstImage(container: HTMLElement) {
  return container.querySelector("img") as HTMLImageElement;
}

describe("CrossfadeImage", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders the initial image with caller classes, style, aria, and data attributes", () => {
    const { container } = render(CrossfadeImage, {
      src: "/assets/backgrounds/chapter_1/scene_0/cafe.png",
      alt: "",
      imageClass: "background-image",
      imageStyle: "--portrait-height: min(1536px, 80vh);",
      ariaHidden: true,
      dataAttributes: { placement: "left", layer: "behind-dialogue" },
    });

    const image = firstImage(container);
    expect(image).toHaveAttribute(
      "src",
      "/assets/backgrounds/chapter_1/scene_0/cafe.png",
    );
    expect(image).toHaveClass("crossfade-image-layer", "background-image", "visible");
    expect(image).toHaveAttribute("aria-hidden", "true");
    expect(image).toHaveAttribute("data-placement", "left");
    expect(image).toHaveAttribute("data-layer", "behind-dialogue");
    expect(image.style.getPropertyValue("--portrait-height")).toBe(
      "min(1536px, 80vh)",
    );
  });

  it("keeps the old image mounted while the incoming image has not loaded", async () => {
    const { container, rerender } = render(CrossfadeImage, {
      src: "/old.png",
      imageClass: "background-image",
      alt: "",
      ariaHidden: true,
    });

    await rerender({
      src: "/new.png",
      imageClass: "background-image",
      alt: "",
      ariaHidden: true,
    });

    expect(imageSources(container)).toEqual(["/old.png", "/new.png"]);
    const [oldImage, newImage] = Array.from(container.querySelectorAll("img"));
    expect(oldImage).toHaveClass("visible");
    expect(newImage).not.toHaveClass("visible");
    expect(newImage).not.toHaveClass("leaving");
  });

  it("activates the incoming image after load and removes the old layer after the duration", async () => {
    vi.useFakeTimers();
    const { container, rerender } = render(CrossfadeImage, {
      src: "/old.png",
      imageClass: "portrait left",
      alt: "",
      ariaHidden: true,
      durationMs: 300,
    });

    await rerender({
      src: "/new.png",
      imageClass: "portrait left",
      alt: "",
      ariaHidden: true,
      durationMs: 300,
    });

    const incoming = container.querySelectorAll("img")[1] as HTMLImageElement;
    await fireEvent.load(incoming);

    const [oldImage, newImage] = Array.from(container.querySelectorAll("img"));
    expect(oldImage).toHaveClass("leaving");
    expect(newImage).toHaveClass("visible");

    vi.advanceTimersByTime(300);
    await waitFor(() => {
      expect(imageSources(container)).toEqual(["/new.png"]);
    });
  });

  it("fades out the active image when src becomes null", async () => {
    vi.useFakeTimers();
    const { container, rerender } = render(CrossfadeImage, {
      src: "/portrait.png",
      imageClass: "portrait right",
      alt: "",
      ariaHidden: true,
      durationMs: 300,
    });

    await rerender({
      src: null,
      imageClass: "portrait right",
      alt: "",
      ariaHidden: true,
      durationMs: 300,
    });

    expect(firstImage(container)).toHaveClass("leaving");
    vi.advanceTimersByTime(300);
    await waitFor(() => {
      expect(container.querySelector("img")).not.toBeInTheDocument();
    });
  });

  it("forwards load and error events while preserving the previous loaded layer on incoming error", async () => {
    const onImageLoad = vi.fn();
    const onImageError = vi.fn();
    const { container, rerender } = render(CrossfadeImage, {
      src: "/old.png",
      imageClass: "background-image",
      alt: "",
      ariaHidden: true,
      onImageLoad,
      onImageError,
    });

    await rerender({
      src: "/new-missing.png",
      imageClass: "background-image",
      alt: "",
      ariaHidden: true,
      onImageLoad,
      onImageError,
    });

    const incoming = container.querySelectorAll("img")[1] as HTMLImageElement;
    await fireEvent.error(incoming);

    expect(onImageError).toHaveBeenCalledTimes(1);
    expect(onImageLoad).not.toHaveBeenCalled();
    expect(imageSources(container)).toEqual(["/old.png"]);
    expect(firstImage(container)).toHaveClass("visible");
  });

  it("defines the transition and reduced-motion CSS contract", () => {
    const source = readFileSync(
      resolve(import.meta.dirname!, "CrossfadeImage.svelte"),
      "utf8",
    );

    expect(source).toContain(".crossfade-image-layer");
    expect(source).toContain("transition: opacity var(--crossfade-duration, 300ms)");
    expect(source).toContain("@media (prefers-reduced-motion: reduce)");
    expect(source).toContain("--crossfade-duration: 1ms");
  });
});
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run:

```bash
bun run --cwd apps/game test src/lib/components/CrossfadeImage.test.ts
```

Expected: FAIL because `./CrossfadeImage.svelte` does not exist.

- [ ] **Step 3: Implement `CrossfadeImage.svelte`**

Create `apps/game/src/lib/components/CrossfadeImage.svelte`:

```svelte
<script lang="ts">
  type ImageDataAttributeValue =
    | string
    | number
    | boolean
    | null
    | undefined;

  type ImageLayer = {
    id: number;
    src: string;
    visible: boolean;
    leaving: boolean;
    pending: boolean;
  };

  let {
    src,
    alt = "",
    imageClass = "",
    imageStyle = "",
    durationMs = 300,
    ariaHidden = true,
    dataAttributes = {},
    onImageLoad,
    onImageError,
  }: {
    src: string | null;
    alt?: string;
    imageClass?: string;
    imageStyle?: string;
    durationMs?: number;
    ariaHidden?: boolean | "true" | "false";
    dataAttributes?: Record<string, ImageDataAttributeValue>;
    onImageLoad?: (event: Event) => void;
    onImageError?: (event: Event) => void;
  } = $props();

  let layers = $state<ImageLayer[]>([]);
  let layerSequence = 0;
  let lastRequestedSrc = $state<string | null>(null);
  const cleanupTimers = new Map<number, ReturnType<typeof setTimeout>>();

  const durationStyle = $derived(`--crossfade-duration: ${durationMs}ms;`);
  const imageStyleValue = $derived(
    imageStyle ? `${durationStyle} ${imageStyle}` : durationStyle,
  );
  const imageAriaHidden = $derived(
    ariaHidden === true ? "true" : ariaHidden === false ? undefined : ariaHidden,
  );
  const dataProps = $derived(
    Object.fromEntries(
      Object.entries(dataAttributes)
        .filter(([, value]) => value !== null && value !== undefined)
        .map(([key, value]) => [`data-${key}`, String(value)]),
    ),
  );

  $effect(() => {
    if (src === lastRequestedSrc) {
      return;
    }

    lastRequestedSrc = src;

    if (!src) {
      fadeOutAllLayers();
      return;
    }

    const existing = layers.find((layer) => layer.src === src && !layer.leaving);
    if (existing) {
      activateLayer(existing.id);
      return;
    }

    const hasVisibleLayer = layers.some((layer) => layer.visible && !layer.leaving);
    const nextLayer: ImageLayer = {
      id: ++layerSequence,
      src,
      visible: !hasVisibleLayer,
      leaving: false,
      pending: hasVisibleLayer,
    };
    layers = [...layers, nextLayer];
  });

  function fadeOutAllLayers() {
    const activeIds = layers
      .filter((layer) => !layer.leaving)
      .map((layer) => layer.id);
    layers = layers.map((layer) => ({ ...layer, visible: false, leaving: true }));
    for (const id of activeIds) {
      scheduleRemoval(id);
    }
  }

  function activateLayer(layerId: number) {
    const target = layers.find((layer) => layer.id === layerId);
    if (!target || target.leaving) {
      return;
    }

    const leavingIds = layers
      .filter((layer) => layer.id !== layerId)
      .map((layer) => layer.id);

    layers = layers.map((layer) =>
      layer.id === layerId
        ? { ...layer, visible: true, pending: false, leaving: false }
        : { ...layer, visible: false, pending: false, leaving: true },
    );

    for (const id of leavingIds) {
      scheduleRemoval(id);
    }
  }

  function scheduleRemoval(layerId: number) {
    clearRemoval(layerId);
    const timer = setTimeout(() => {
      cleanupTimers.delete(layerId);
      layers = layers.filter((layer) => layer.id !== layerId);
    }, durationMs);
    cleanupTimers.set(layerId, timer);
  }

  function clearRemoval(layerId: number) {
    const timer = cleanupTimers.get(layerId);
    if (!timer) return;
    clearTimeout(timer);
    cleanupTimers.delete(layerId);
  }

  function handleLoad(layer: ImageLayer, event: Event) {
    onImageLoad?.(event);
    if (layer.src !== lastRequestedSrc || layer.leaving) {
      return;
    }
    activateLayer(layer.id);
  }

  function handleError(layer: ImageLayer, event: Event) {
    onImageError?.(event);
    if (layer.pending) {
      layers = layers.filter((current) => current.id !== layer.id);
    }
  }

  $effect(() => {
    return () => {
      for (const timer of cleanupTimers.values()) {
        clearTimeout(timer);
      }
      cleanupTimers.clear();
    };
  });
</script>

{#each layers as layer (layer.id)}
  <img
    class={`crossfade-image-layer ${imageClass}`}
    class:visible={layer.visible}
    class:leaving={layer.leaving}
    src={layer.src}
    {alt}
    aria-hidden={imageAriaHidden}
    style={imageStyleValue}
    {...dataProps}
    onload={(event) => handleLoad(layer, event)}
    onerror={(event) => handleError(layer, event)}
  />
{/each}

<style>
  .crossfade-image-layer {
    opacity: 0;
    transition: opacity var(--crossfade-duration, 300ms) ease;
  }

  .crossfade-image-layer.visible {
    opacity: 1;
  }

  .crossfade-image-layer.leaving {
    opacity: 0;
  }

  @media (prefers-reduced-motion: reduce) {
    .crossfade-image-layer {
      --crossfade-duration: 1ms;
    }
  }
</style>
```

- [ ] **Step 4: Run the component tests to verify they pass**

Run:

```bash
bun run --cwd apps/game test src/lib/components/CrossfadeImage.test.ts
```

Expected: PASS for all `CrossfadeImage` tests.

- [ ] **Step 5: Commit Task 1**

Run:

```bash
git add apps/game/src/lib/components/CrossfadeImage.svelte apps/game/src/lib/components/CrossfadeImage.test.ts
git commit -m "feat(game): add crossfade image primitive"
```

Expected: commit succeeds.

---

### Task 2: Story Background And Dialogue Portrait Integration

**Files:**

- Modify: `apps/game/src/lib/components/SceneBackdrop.svelte`
- Modify: `apps/game/src/lib/components/SceneBackdrop.test.ts`
- Modify: `apps/game/src/lib/components/DialogueBox.svelte`
- Modify: `apps/game/src/lib/components/DialogueBox.test.ts`

**Interfaces:**

- Consumes: `CrossfadeImage` props from Task 1.
- Produces: `SceneBackdrop` and `DialogueBox` continue to expose their existing props and DOM classes:
  - `img.background-image`
  - `img.portrait.left`
  - `img.portrait.right`
  - `data-placement`
  - `data-layer="behind-dialogue"`

- [ ] **Step 1: Add failing story backdrop tests**

Modify `apps/game/src/lib/components/SceneBackdrop.test.ts` by appending the two tests below inside `describe("SceneBackdrop", ...)`:

```ts
import { render, waitFor } from "@testing-library/svelte";
```

```ts
  it("crossfades between background asset changes without removing the old image first", async () => {
    const { container, rerender } = render(SceneBackdrop, {
      sceneTag: null,
      backgroundAssetId: "background.chapter_1.scene_0.old",
    });

    await waitFor(() => {
      expect(container.querySelector("img.background-image")).toHaveAttribute(
        "src",
        "/assets/backgrounds/chapter_1/scene_0/old.png",
      );
    });

    await rerender({
      sceneTag: null,
      backgroundAssetId: "background.chapter_1.scene_0.new",
    });

    await waitFor(() => {
      const images = container.querySelectorAll("img.background-image");
      expect(images.length).toBe(2);
      expect(images[0]).toHaveAttribute(
        "src",
        "/assets/backgrounds/chapter_1/scene_0/old.png",
      );
      expect(images[1]).toHaveAttribute(
        "src",
        "/assets/backgrounds/chapter_1/scene_0/new.png",
      );
    });
  });

  it("uses the shared crossfade image primitive for backdrop rendering", () => {
    const source = readFileSync(
      resolve(import.meta.dirname!, "SceneBackdrop.svelte"),
      "utf-8",
    );
    expect(source).toContain('import CrossfadeImage from "./CrossfadeImage.svelte"');
    expect(source).toContain("<CrossfadeImage");
    expect(source).toContain('imageClass="background-image"');
  });
```

- [ ] **Step 2: Run the SceneBackdrop tests to verify they fail**

Run:

```bash
bun run --cwd apps/game test src/lib/components/SceneBackdrop.test.ts
```

Expected: FAIL because `SceneBackdrop.svelte` still renders a plain `<img>` and clears its resolved asset.

- [ ] **Step 3: Integrate CrossfadeImage into `SceneBackdrop.svelte`**

Update `apps/game/src/lib/components/SceneBackdrop.svelte`:

```svelte
<script lang="ts">
  import {
    placeholderForMissingStoryAsset,
    resolveStoryAsset,
    type ResolvedStoryAsset,
  } from "$lib/assets/story-assets";
  import CrossfadeImage from "./CrossfadeImage.svelte";

  let {
    sceneTag,
    backgroundAssetId = null,
  }: {
    sceneTag: string | null;
    backgroundAssetId?: string | null;
  } = $props();

  let resolved = $state<ResolvedStoryAsset | null>(null);

  $effect(() => {
    let cancelled = false;
    resolveStoryAsset(backgroundAssetId, "background").then((asset) => {
      if (!cancelled) resolved = asset;
    });
    return () => {
      cancelled = true;
    };
  });

  function handleBackgroundError() {
    if (!resolved || resolved.placeholder) return;
    console.warn(
      `[SceneBackdrop] Missing background asset: ${resolved.url} (assetId: ${resolved.assetId})`,
    );
    resolved = placeholderForMissingStoryAsset(resolved.assetId, "background");
  }
</script>

{#if sceneTag || backgroundAssetId || resolved}
  <div class="backdrop">
    <CrossfadeImage
      src={resolved?.url ?? null}
      imageClass="background-image"
      alt=""
      ariaHidden={true}
      onImageError={handleBackgroundError}
    />
    {#if sceneTag}
      <span class="stamp">
        <span class="kana">場 / SCENE</span>
        <span class="label">{sceneTag}</span>
      </span>
    {/if}
  </div>
{/if}
```

Keep the existing `<style>` block unchanged, including `.background-image`.

- [ ] **Step 4: Run the SceneBackdrop tests to verify they pass**

Run:

```bash
bun run --cwd apps/game test src/lib/components/SceneBackdrop.test.ts
```

Expected: PASS for `SceneBackdrop`.

- [ ] **Step 5: Add failing dialogue portrait tests**

Modify `apps/game/src/lib/components/DialogueBox.test.ts` by appending these tests inside `describe("DialogueBox", ...)`:

```ts
  it("crossfades between portrait asset changes without removing the old portrait first", async () => {
    const { container, rerender } = renderDialogueBox({
      kind: "line",
      speaker: "早坂茜",
      text: "第一句。",
      portrait: {
        characterId: "hayasaka_akane",
        expression: "standard",
        assetId: "portrait.hayasaka_akane.standard",
      },
    });

    await waitFor(() => {
      expect(container.querySelector("img.portrait")).toHaveAttribute(
        "src",
        "/assets/portraits/hayasaka_akane/standard.png",
      );
    });

    await rerender({
      current: {
        kind: "line",
        speaker: "早坂茜",
        text: "第二句。",
        portrait: {
          characterId: "hayasaka_akane",
          expression: "concerned",
          assetId: "portrait.hayasaka_akane.concerned",
        },
      },
      queueToken: token,
      onAdvance: vi.fn(),
      history: [],
      disabled: false,
      crossExam: null,
    });

    await waitFor(() => {
      const portraits = container.querySelectorAll("img.portrait");
      expect(portraits.length).toBe(2);
      expect(portraits[0]).toHaveAttribute(
        "src",
        "/assets/portraits/hayasaka_akane/standard.png",
      );
      expect(portraits[1]).toHaveAttribute(
        "src",
        "/assets/portraits/hayasaka_akane/concerned.png",
      );
    });
  });

  it("uses the shared crossfade image primitive for portrait rendering", () => {
    const source = dialogueBoxSource();
    expect(source).toContain('import CrossfadeImage from "./CrossfadeImage.svelte"');
    expect(source).toContain("<CrossfadeImage");
    expect(source).toContain('imageClass={`portrait ${portraitPlacement}`}');
    expect(source).toContain("dataAttributes={{");
    expect(source).toContain("placement: portraitPlacement");
    expect(source).toContain('layer: "behind-dialogue"');
  });
```

- [ ] **Step 6: Run the DialogueBox tests to verify they fail**

Run:

```bash
bun run --cwd apps/game test src/lib/components/DialogueBox.test.ts
```

Expected: FAIL because `DialogueBox.svelte` still renders a plain portrait `<img>` and clears `portraitAsset`.

- [ ] **Step 7: Integrate CrossfadeImage into `DialogueBox.svelte`**

Modify `apps/game/src/lib/components/DialogueBox.svelte`:

1. Add the import:

```ts
  import CrossfadeImage from "./CrossfadeImage.svelte";
```

2. Change the portrait resolution effect so it does not clear the visible portrait during each resolve:

```ts
  $effect(() => {
    let cancelled = false;
    resolveStoryAsset(portraitAssetId, "portrait").then((asset) => {
      if (!cancelled) portraitAsset = asset;
    });
    return () => {
      cancelled = true;
    };
  });
```

3. Replace the portrait `<img>` block with:

```svelte
<CrossfadeImage
  src={current.kind === "line" ? (portraitAsset?.url ?? null) : null}
  imageClass={`portrait ${portraitPlacement}`}
  alt=""
  ariaHidden={true}
  imageStyle="--portrait-height: min(1536px, 80vh);"
  dataAttributes={{ placement: portraitPlacement, layer: "behind-dialogue" }}
  onImageError={handlePortraitError}
/>
```

4. Keep the existing `.portrait`, `.portrait.left`, and `.portrait.right` CSS rules unchanged.

- [ ] **Step 8: Run the DialogueBox tests to verify they pass**

Run:

```bash
bun run --cwd apps/game test src/lib/components/DialogueBox.test.ts
```

Expected: PASS for `DialogueBox`.

- [ ] **Step 9: Run both Task 2 test files together**

Run:

```bash
bun run --cwd apps/game test src/lib/components/SceneBackdrop.test.ts src/lib/components/DialogueBox.test.ts
```

Expected: PASS for both files.

- [ ] **Step 10: Commit Task 2**

Run:

```bash
git add apps/game/src/lib/components/SceneBackdrop.svelte apps/game/src/lib/components/SceneBackdrop.test.ts apps/game/src/lib/components/DialogueBox.svelte apps/game/src/lib/components/DialogueBox.test.ts
git commit -m "feat(game): crossfade story backgrounds and portraits"
```

Expected: commit succeeds.

---

### Task 3: Investigation Background And Placed Character Integration

**Files:**

- Modify: `apps/game/src/lib/components/InvestigationSceneSurface.svelte`
- Modify: `apps/game/src/lib/components/InvestigationSceneSurface.test.ts`

**Interfaces:**

- Consumes: `CrossfadeImage` props from Task 1.
- Produces:
  - investigation viewport backgrounds still render as `img.background-image`;
  - placed character images still render inside `.character-preview-crop`;
  - `loadCharacterCrop(assetId, event)` still runs from the rendered image's load event;
  - `handleBackgroundError()` and `handlePortraitError(character)` keep local missing-asset warning/fallback behavior.

- [ ] **Step 1: Add failing investigation crossfade tests**

Modify `apps/game/src/lib/components/InvestigationSceneSurface.test.ts` by adding these tests inside `describe("InvestigationSceneSurface", ...)`:

```ts
  it("crossfades investigation background asset changes without removing the old background first", async () => {
    const { container, rerender } = render(InvestigationSceneSurface, {
      sublocation,
      backgroundAssetId: "background.chapter_1.scene_0.cafe",
      onInspect: vi.fn(),
      onInterview: vi.fn(),
    });

    await waitFor(() => {
      expect(
        container.querySelector(".surface-shell > img.background-image"),
      ).toHaveAttribute(
        "src",
        "/assets/backgrounds/chapter_1/scene_0/cafe.png",
      );
    });

    await rerender({
      sublocation,
      backgroundAssetId: "background.chapter_1.scene_0.alley",
      onInspect: vi.fn(),
      onInterview: vi.fn(),
    });

    await waitFor(() => {
      const images = container.querySelectorAll(
        ".surface-shell > img.background-image",
      );
      expect(images.length).toBe(2);
      expect(images[0]).toHaveAttribute(
        "src",
        "/assets/backgrounds/chapter_1/scene_0/cafe.png",
      );
      expect(images[1]).toHaveAttribute(
        "src",
        "/assets/backgrounds/chapter_1/scene_0/alley.png",
      );
    });
  });

  it("crossfades a placed character asset change inside the existing target", async () => {
    const { container, rerender } = render(InvestigationSceneSurface, {
      sublocation,
      onInspect: vi.fn(),
      onInterview: vi.fn(),
    });

    await waitFor(() => {
      expect(container.querySelector(".character-target img")).toHaveAttribute(
        "src",
        "/assets/portraits/witness/standard.png",
      );
    });

    const updatedSublocation = {
      ...sublocation,
      characters: [
        {
          ...sublocation.characters[0],
          layout: {
            ...sublocation.characters[0].layout!,
            assetId: "standee.witness.standard",
          },
        },
      ],
    } satisfies SublocationView;

    await rerender({
      sublocation: updatedSublocation,
      onInspect: vi.fn(),
      onInterview: vi.fn(),
    });

    await waitFor(() => {
      const images = container.querySelectorAll(".character-target img");
      expect(images.length).toBe(2);
      expect(images[0]).toHaveAttribute(
        "src",
        "/assets/portraits/witness/standard.png",
      );
      expect(images[1]).toHaveAttribute(
        "src",
        "/assets/standees/witness/standard.png",
      );
    });
  });

  it("uses the shared crossfade image primitive for investigation images", () => {
    const source = surfaceSource();
    expect(source).toContain('import CrossfadeImage from "./CrossfadeImage.svelte"');
    expect(source).toContain("<CrossfadeImage");
    expect(source).toContain('imageClass="background-image"');
    expect(source).toContain('imageClass=""');
    expect(source).toContain("onImageLoad");
    expect(source).toContain("onImageError");
  });
```

- [ ] **Step 2: Run the InvestigationSceneSurface tests to verify they fail**

Run:

```bash
bun run --cwd apps/game test src/lib/components/InvestigationSceneSurface.test.ts
```

Expected: FAIL because `InvestigationSceneSurface.svelte` still clears the background and portrait maps during resolution and renders plain `<img>` elements.

- [ ] **Step 3: Integrate CrossfadeImage into `InvestigationSceneSurface.svelte`**

Modify `apps/game/src/lib/components/InvestigationSceneSurface.svelte`:

1. Add the import:

```ts
  import CrossfadeImage from "./CrossfadeImage.svelte";
```

2. Replace the portrait resolution effect with a version that preserves existing entries while each replacement resolves. Stale map entries for characters no longer placed are acceptable because the DOM target is removed and the entry is unused; avoid reading and rewriting `portraits` inside this effect so the effect does not subscribe to the same state it mutates.

```ts
  $effect(() => {
    let cancelled = false;

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
```

3. Replace the background resolution effect with a version that does not clear the visible background during each resolve:

```ts
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
```

4. Replace the background `<img>` block with:

```svelte
  <CrossfadeImage
    src={background?.url ?? null}
    imageClass="background-image"
    alt=""
    ariaHidden={true}
    onImageError={handleBackgroundError}
  />
```

5. Replace the placed character `<img>` inside `.character-preview-crop` with:

```svelte
              <CrossfadeImage
                src={portraits[character.id]?.url ?? null}
                imageClass=""
                alt=""
                ariaHidden={true}
                onImageLoad={(event) =>
                  loadCharacterCrop(character.layout.assetId, event)}
                onImageError={() => handlePortraitError(character)}
              />
```

6. Keep `.background-image`, `.character-preview-crop`, and `.character-preview-crop img` CSS rules unchanged.

- [ ] **Step 4: Run the InvestigationSceneSurface tests to verify they pass**

Run:

```bash
bun run --cwd apps/game test src/lib/components/InvestigationSceneSurface.test.ts
```

Expected: PASS for `InvestigationSceneSurface`.

- [ ] **Step 5: Run the focused visual cutover suite**

Run:

```bash
bun run --cwd apps/game test src/lib/components/CrossfadeImage.test.ts src/lib/components/SceneBackdrop.test.ts src/lib/components/DialogueBox.test.ts src/lib/components/InvestigationSceneSurface.test.ts
```

Expected: PASS for all four files.

- [ ] **Step 6: Run Svelte type checking**

Run:

```bash
bun run --cwd apps/game check
```

Expected: PASS. `svelte-check` reports 0 errors.

- [ ] **Step 7: Commit Task 3**

Run:

```bash
git add apps/game/src/lib/components/InvestigationSceneSurface.svelte apps/game/src/lib/components/InvestigationSceneSurface.test.ts
git commit -m "feat(game): crossfade investigation scene images"
```

Expected: commit succeeds.

---

## Final Verification

- [ ] **Step 1: Run the focused visual cutover suite**

Run:

```bash
bun run --cwd apps/game test src/lib/components/CrossfadeImage.test.ts src/lib/components/SceneBackdrop.test.ts src/lib/components/DialogueBox.test.ts src/lib/components/InvestigationSceneSurface.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run app type checking**

Run:

```bash
bun run --cwd apps/game check
```

Expected: PASS. `svelte-check` reports 0 errors.

- [ ] **Step 3: Inspect final git status**

Run:

```bash
git status --short
```

Expected: clean worktree after the task commits, or only the implementation-plan file if the plan itself is intentionally left uncommitted.

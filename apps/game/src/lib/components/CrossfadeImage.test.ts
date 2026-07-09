import { fireEvent, render, waitFor } from "@testing-library/svelte";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import CrossfadeImage from "./CrossfadeImage.svelte";
import CrossfadeImageHarness from "./CrossfadeImageHarness.svelte";

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
    expect(image).toHaveClass(
      "crossfade-image-layer",
      "background-image",
      "visible",
    );
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

  it("adds a pending layer when only src changes and presentation props stay stable", async () => {
    const { container } = render(CrossfadeImageHarness);

    await fireEvent.click(
      container.querySelector("button") as HTMLButtonElement,
    );

    await waitFor(() => {
      const images = Array.from(container.querySelectorAll("img"));
      expect(images).toHaveLength(2);
      expect(images[0]).toHaveAttribute("src", "/old.png");
      expect(images[0]).toHaveClass("visible");
      expect(images[1]).toHaveAttribute("src", "/new.png");
      expect(images[1]).not.toHaveClass("visible");
      expect(images[1]).not.toHaveClass("leaving");
    });
  });

  it("updates the live image presentation props when src stays the same", async () => {
    const { container, rerender } = render(CrossfadeImage, {
      src: "/portrait.png",
      imageClass: "portrait left",
      imageStyle: "--portrait-height: min(1536px, 80vh);",
      alt: "",
      ariaHidden: true,
      dataAttributes: { placement: "left", layer: "back" },
    });

    await rerender({
      src: "/portrait.png",
      imageClass: "portrait right",
      imageStyle: "--portrait-height: min(1024px, 60vh);",
      alt: "",
      ariaHidden: "false",
      dataAttributes: {
        placement: "right",
        layer: "front",
        tone: "bright",
      },
    });

    expect(container.querySelectorAll("img")).toHaveLength(1);
    const image = firstImage(container);
    expect(image).toHaveClass(
      "crossfade-image-layer",
      "portrait right",
      "visible",
    );
    expect(image).not.toHaveClass("portrait left");
    expect(image).toHaveAttribute("aria-hidden", "false");
    expect(image).toHaveAttribute("data-placement", "right");
    expect(image).toHaveAttribute("data-layer", "front");
    expect(image).toHaveAttribute("data-tone", "bright");
    expect(image.style.getPropertyValue("--portrait-height")).toBe(
      "min(1024px, 60vh)",
    );
  });

  it("creates a transition layer when the transition key changes even if src stays the same", async () => {
    const { container, rerender } = render(CrossfadeImage, {
      src: "/portrait.png",
      transitionKey: "/portrait.png:left",
      imageClass: "portrait left",
      imageStyle: "--portrait-height: min(1536px, 80vh);",
      alt: "",
      ariaHidden: true,
      dataAttributes: { placement: "left", layer: "back" },
    });

    await rerender({
      src: "/portrait.png",
      transitionKey: "/portrait.png:right",
      imageClass: "portrait right",
      imageStyle: "--portrait-height: min(1536px, 80vh);",
      alt: "",
      ariaHidden: true,
      dataAttributes: { placement: "right", layer: "back" },
    });

    const [oldImage, newImage] = Array.from(
      container.querySelectorAll("img"),
    ) as HTMLImageElement[];

    expect(container.querySelectorAll("img")).toHaveLength(2);
    expect(oldImage).toHaveAttribute("src", "/portrait.png");
    expect(oldImage).toHaveClass("portrait left", "visible");
    expect(oldImage).toHaveAttribute("data-placement", "left");
    expect(newImage).toHaveAttribute("src", "/portrait.png");
    expect(newImage).toHaveClass("portrait right");
    expect(newImage).not.toHaveClass("visible");
    expect(newImage).toHaveAttribute("data-placement", "right");
  });

  it("snapshots caller presentation props per layer during a transition", async () => {
    const { container, rerender } = render(CrossfadeImage, {
      src: "/old.png",
      imageClass: "portrait left",
      imageStyle: "--portrait-height: min(1536px, 80vh);",
      alt: "",
      ariaHidden: true,
      dataAttributes: { placement: "left", layer: "back" },
    });

    await rerender({
      src: "/new.png",
      imageClass: "portrait right",
      imageStyle: "--portrait-height: min(1024px, 60vh);",
      alt: "",
      ariaHidden: "false",
      dataAttributes: {
        placement: "right",
        layer: "front",
        tone: "bright",
      },
    });

    const [oldImage, newImage] = Array.from(
      container.querySelectorAll("img"),
    ) as HTMLImageElement[];

    expect(oldImage).toHaveClass(
      "crossfade-image-layer",
      "portrait left",
      "visible",
    );
    expect(oldImage).toHaveAttribute("aria-hidden", "true");
    expect(oldImage).toHaveAttribute("data-placement", "left");
    expect(oldImage).toHaveAttribute("data-layer", "back");
    expect(oldImage).not.toHaveAttribute("data-tone");
    expect(oldImage.style.getPropertyValue("--portrait-height")).toBe(
      "min(1536px, 80vh)",
    );

    expect(newImage).toHaveClass("crossfade-image-layer", "portrait right");
    expect(newImage).not.toHaveClass("visible");
    expect(newImage).toHaveAttribute("aria-hidden", "false");
    expect(newImage).toHaveAttribute("data-placement", "right");
    expect(newImage).toHaveAttribute("data-layer", "front");
    expect(newImage).toHaveAttribute("data-tone", "bright");
    expect(newImage.style.getPropertyValue("--portrait-height")).toBe(
      "min(1024px, 60vh)",
    );
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

  it("ignores stale pending load events during rapid source changes and still forwards the current load", async () => {
    const onImageLoad = vi.fn();
    const { container, rerender } = render(CrossfadeImage, {
      src: "/a.png",
      imageClass: "background-image",
      alt: "",
      ariaHidden: true,
      onImageLoad,
    });

    await rerender({
      src: "/b.png",
      imageClass: "background-image",
      alt: "",
      ariaHidden: true,
      onImageLoad,
    });

    const stalePending = container.querySelectorAll(
      "img",
    )[1] as HTMLImageElement;

    await rerender({
      src: "/c.png",
      imageClass: "background-image",
      alt: "",
      ariaHidden: true,
      onImageLoad,
    });
    await fireEvent.load(stalePending);

    await waitFor(() => {
      expect(onImageLoad).not.toHaveBeenCalled();
      expect(imageSources(container)).toEqual(["/a.png", "/c.png"]);
    });

    const currentPending = container.querySelectorAll(
      "img",
    )[1] as HTMLImageElement;
    await fireEvent.load(currentPending);

    expect(onImageLoad).toHaveBeenCalledTimes(1);
    const [oldImage, newImage] = Array.from(container.querySelectorAll("img"));
    expect(oldImage).toHaveClass("leaving");
    expect(newImage).toHaveClass("visible");
  });

  it("ignores stale pending error events during rapid source changes and still forwards the current error", async () => {
    const onImageError = vi.fn();
    const { container, rerender } = render(CrossfadeImage, {
      src: "/a.png",
      imageClass: "background-image",
      alt: "",
      ariaHidden: true,
      onImageError,
    });

    await rerender({
      src: "/b.png",
      imageClass: "background-image",
      alt: "",
      ariaHidden: true,
      onImageError,
    });

    const stalePending = container.querySelectorAll(
      "img",
    )[1] as HTMLImageElement;

    await rerender({
      src: "/c.png",
      imageClass: "background-image",
      alt: "",
      ariaHidden: true,
      onImageError,
    });
    await fireEvent.error(stalePending);

    await waitFor(() => {
      expect(onImageError).not.toHaveBeenCalled();
      expect(imageSources(container)).toEqual(["/a.png", "/c.png"]);
    });

    const currentPending = container.querySelectorAll(
      "img",
    )[1] as HTMLImageElement;
    await fireEvent.error(currentPending);

    expect(onImageError).toHaveBeenCalledTimes(1);
    expect(imageSources(container)).toEqual(["/a.png"]);
    expect(firstImage(container)).toHaveClass("visible");
  });

  it("drops superseded pending layers immediately during rapid source changes", async () => {
    const { container, rerender } = render(CrossfadeImage, {
      src: "/a.png",
      imageClass: "background-image",
      alt: "",
      ariaHidden: true,
    });

    await rerender({
      src: "/b.png",
      imageClass: "background-image",
      alt: "",
      ariaHidden: true,
    });

    expect(imageSources(container)).toEqual(["/a.png", "/b.png"]);

    await rerender({
      src: "/c.png",
      imageClass: "background-image",
      alt: "",
      ariaHidden: true,
    });

    expect(imageSources(container)).toEqual(["/a.png", "/c.png"]);
  });

  it("renders no image when the initial src is null", () => {
    const { container } = render(CrossfadeImage, {
      src: null,
      alt: "",
      ariaHidden: true,
    });

    expect(container.querySelector("img")).not.toBeInTheDocument();
  });

  it("clears pending removal timers on unmount so no layer mutates after detach", async () => {
    vi.useFakeTimers();
    const { container, rerender, unmount } = render(CrossfadeImage, {
      src: "/old.png",
      imageClass: "background-image",
      alt: "",
      ariaHidden: true,
      durationMs: 300,
    });

    await rerender({
      src: "/new.png",
      imageClass: "background-image",
      alt: "",
      ariaHidden: true,
      durationMs: 300,
    });

    const incoming = container.querySelectorAll("img")[1] as HTMLImageElement;
    await fireEvent.load(incoming);

    // Old layer is now `leaving` with a pending 300ms removal timer.
    expect(container.querySelectorAll("img")).toHaveLength(2);
    expect(container.querySelectorAll("img")[0]).toHaveClass("leaving");

    unmount();
    // Advancing past the scheduled removal must not throw or mutate state.
    vi.advanceTimersByTime(300);
    expect(container.querySelector("img")).not.toBeInTheDocument();
  });

  it("removes leaving layers on the reduced-motion schedule, not the full duration", async () => {
    const reducedMotionList = {
      matches: true,
      media: "(prefers-reduced-motion: reduce)",
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    } as unknown as MediaQueryList;
    vi.stubGlobal("matchMedia", (query: string) =>
      query === "(prefers-reduced-motion: reduce)"
        ? reducedMotionList
        : ({ matches: false } as unknown as MediaQueryList),
    );

    vi.useFakeTimers();
    const { container, rerender } = render(CrossfadeImage, {
      src: "/old.png",
      imageClass: "background-image",
      alt: "",
      ariaHidden: true,
      durationMs: 1500,
    });

    await rerender({
      src: "/new.png",
      imageClass: "background-image",
      alt: "",
      ariaHidden: true,
      durationMs: 1500,
    });

    const incoming = container.querySelectorAll("img")[1] as HTMLImageElement;
    await fireEvent.load(incoming);

    expect(container.querySelectorAll("img")).toHaveLength(2);
    expect(container.querySelectorAll("img")[0]).toHaveClass("leaving");

    // Full duration has NOT elapsed, but the reduced-motion grace (50ms) has.
    vi.advanceTimersByTime(50);
    await waitFor(() => {
      expect(imageSources(container)).toEqual(["/new.png"]);
    });

    // Advance the remainder of the full duration to prove the layer was
    // already removed early and no further mutation occurs.
    vi.advanceTimersByTime(1450);
    expect(imageSources(container)).toEqual(["/new.png"]);

    vi.unstubAllGlobals();
  });

  it("reactivates an existing non-leaving layer when the key switches back before the pending layer loads", async () => {
    const { container, rerender } = render(CrossfadeImage, {
      src: "/a.png",
      imageClass: "background-image",
      alt: "",
      ariaHidden: true,
    });

    // Add a pending /b layer alongside the visible /a layer.
    await rerender({
      src: "/b.png",
      imageClass: "background-image",
      alt: "",
      ariaHidden: true,
    });
    expect(imageSources(container)).toEqual(["/a.png", "/b.png"]);
    const aImage = container.querySelectorAll("img")[0] as HTMLImageElement;
    const bImage = container.querySelectorAll("img")[1] as HTMLImageElement;
    expect(aImage).toHaveClass("visible");
    expect(bImage).not.toHaveClass("visible");

    // Switch back to /a before /b loads — /a is still visible and non-leaving,
    // so the effect should reactivate it and mark /b as leaving.
    await rerender({
      src: "/a.png",
      imageClass: "background-image",
      alt: "",
      ariaHidden: true,
    });

    expect(imageSources(container)).toEqual(["/a.png", "/b.png"]);
    expect(aImage).toHaveClass("visible");
    expect(bImage).toHaveClass("leaving");
    expect(bImage).not.toHaveClass("visible");
  });

  it("creates a fresh layer when switching back to a key whose prior layer is already leaving", async () => {
    vi.useFakeTimers();
    const { container, rerender } = render(CrossfadeImage, {
      src: "/a.png",
      imageClass: "background-image",
      alt: "",
      ariaHidden: true,
      durationMs: 300,
    });

    // Transition to /b and load it so /a becomes leaving.
    await rerender({
      src: "/b.png",
      imageClass: "background-image",
      alt: "",
      ariaHidden: true,
      durationMs: 300,
    });
    const incoming = container.querySelectorAll("img")[1] as HTMLImageElement;
    await fireEvent.load(incoming);

    // /a is now leaving (removal scheduled), /b is visible.
    expect(container.querySelectorAll("img")[0]).toHaveClass("leaving");
    expect(container.querySelectorAll("img")[1]).toHaveClass("visible");

    // Switch back to /a. The find at the top of the effect should skip the
    // leaving /a layer (key matches but leaving is true) and create a fresh
    // /a layer instead of reactivating the stale one.
    await rerender({
      src: "/a.png",
      imageClass: "background-image",
      alt: "",
      ariaHidden: true,
      durationMs: 300,
    });

    const images = Array.from(container.querySelectorAll("img"));
    // The old leaving /a, the visible /b (now leaving), and the new /a.
    expect(images.length).toBe(3);
    expect(images[2]).toHaveAttribute("src", "/a.png");
    expect(images[2]).not.toHaveClass("visible");
    expect(images[2]).not.toHaveClass("leaving");
  });

  it("does not create a new layer when rerendered with identical presentation props", async () => {
    const { container, rerender } = render(CrossfadeImage, {
      src: "/portrait.png",
      imageClass: "portrait left",
      imageStyle: "--portrait-height: min(1536px, 80vh);",
      alt: "",
      ariaHidden: true,
      dataAttributes: { placement: "left", layer: "back" },
    });

    await rerender({
      src: "/portrait.png",
      imageClass: "portrait left",
      imageStyle: "--portrait-height: min(1536px, 80vh);",
      alt: "",
      ariaHidden: true,
      dataAttributes: { placement: "left", layer: "back" },
    });

    expect(container.querySelectorAll("img")).toHaveLength(1);
    expect(firstImage(container)).toHaveClass("visible");
  });

  it("updates only data attributes when src and other presentation props stay the same", async () => {
    const { container, rerender } = render(CrossfadeImage, {
      src: "/portrait.png",
      imageClass: "portrait left",
      imageStyle: "--portrait-height: min(1536px, 80vh);",
      alt: "",
      ariaHidden: true,
      dataAttributes: { tone: "bright" },
    });

    await rerender({
      src: "/portrait.png",
      imageClass: "portrait left",
      imageStyle: "--portrait-height: min(1536px, 80vh);",
      alt: "",
      ariaHidden: true,
      dataAttributes: { tone: "dim" },
    });

    expect(container.querySelectorAll("img")).toHaveLength(1);
    const image = firstImage(container);
    expect(image).toHaveAttribute("data-tone", "dim");
    expect(image).not.toHaveAttribute("data-tone", "bright");
  });

  it("detects data attribute length changes when src and other presentation props stay the same", async () => {
    const { container, rerender } = render(CrossfadeImage, {
      src: "/portrait.png",
      imageClass: "portrait left",
      imageStyle: "--portrait-height: min(1536px, 80vh);",
      alt: "",
      ariaHidden: true,
      dataAttributes: { tone: "bright" },
    });

    await rerender({
      src: "/portrait.png",
      imageClass: "portrait left",
      imageStyle: "--portrait-height: min(1536px, 80vh);",
      alt: "",
      ariaHidden: true,
      dataAttributes: { tone: "bright", mood: "calm" },
    });

    expect(container.querySelectorAll("img")).toHaveLength(1);
    const image = firstImage(container);
    expect(image).toHaveAttribute("data-tone", "bright");
    expect(image).toHaveAttribute("data-mood", "calm");
  });

  it("does not set aria-hidden when ariaHidden is false", () => {
    const { container } = render(CrossfadeImage, {
      src: "/portrait.png",
      imageClass: "portrait left",
      alt: "",
      ariaHidden: false,
    });

    const image = firstImage(container);
    expect(image).not.toHaveAttribute("aria-hidden");
  });

  it("removes a stale pending layer on load after src becomes null", async () => {
    vi.useFakeTimers();
    const onImageLoad = vi.fn();
    const { container, rerender } = render(CrossfadeImage, {
      src: "/a.png",
      imageClass: "background-image",
      alt: "",
      ariaHidden: true,
      durationMs: 300,
      onImageLoad,
    });

    // Create a pending /b layer alongside visible /a.
    await rerender({
      src: "/b.png",
      imageClass: "background-image",
      alt: "",
      ariaHidden: true,
      durationMs: 300,
      onImageLoad,
    });

    // Fade out all layers (including the pending /b) by clearing src.
    await rerender({
      src: null,
      imageClass: "background-image",
      alt: "",
      ariaHidden: true,
      durationMs: 300,
      onImageLoad,
    });

    const pendingImage = container.querySelectorAll(
      "img",
    )[1] as HTMLImageElement;
    expect(pendingImage).toHaveAttribute("src", "/b.png");
    expect(pendingImage).toHaveClass("leaving");

    // The stale pending layer's load event should not forward to onImageLoad
    // and should remove the layer immediately.
    await fireEvent.load(pendingImage);
    expect(onImageLoad).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(imageSources(container)).toEqual(["/a.png"]);
    });
  });

  it("ignores load events from a stale leaving non-pending layer without removing it early", async () => {
    vi.useFakeTimers();
    const onImageLoad = vi.fn();
    const { container, rerender } = render(CrossfadeImage, {
      src: "/a.png",
      imageClass: "background-image",
      alt: "",
      ariaHidden: true,
      durationMs: 300,
      onImageLoad,
    });

    // Transition to /b and load it so /a becomes leaving (pending=false).
    await rerender({
      src: "/b.png",
      imageClass: "background-image",
      alt: "",
      ariaHidden: true,
      durationMs: 300,
      onImageLoad,
    });
    const bImage = container.querySelectorAll("img")[1] as HTMLImageElement;
    await fireEvent.load(bImage);

    const aImage = container.querySelectorAll("img")[0] as HTMLImageElement;
    expect(aImage).toHaveClass("leaving");

    // onImageLoad was called once for /b's legitimate load. Clear it so we
    // can verify the stale /a load is NOT forwarded.
    onImageLoad.mockClear();

    // A load event on the leaving, non-pending /a layer should not forward
    // to onImageLoad and should not remove the layer early (the removal
    // timer handles that).
    await fireEvent.load(aImage);
    expect(onImageLoad).not.toHaveBeenCalled();
    expect(aImage).toBeInTheDocument();
  });

  it("ignores error events from a stale leaving non-pending layer without removing it early", async () => {
    vi.useFakeTimers();
    const onImageError = vi.fn();
    const { container, rerender } = render(CrossfadeImage, {
      src: "/a.png",
      imageClass: "background-image",
      alt: "",
      ariaHidden: true,
      durationMs: 300,
      onImageError,
    });

    await rerender({
      src: "/b.png",
      imageClass: "background-image",
      alt: "",
      ariaHidden: true,
      durationMs: 300,
      onImageError,
    });
    const bImage = container.querySelectorAll("img")[1] as HTMLImageElement;
    await fireEvent.load(bImage);

    const aImage = container.querySelectorAll("img")[0] as HTMLImageElement;
    expect(aImage).toHaveClass("leaving");

    await fireEvent.error(aImage);
    expect(onImageError).not.toHaveBeenCalled();
    expect(aImage).toBeInTheDocument();
  });

  it("removes a stale pending layer on error after src becomes null", async () => {
    vi.useFakeTimers();
    const onImageError = vi.fn();
    const { container, rerender } = render(CrossfadeImage, {
      src: "/a.png",
      imageClass: "background-image",
      alt: "",
      ariaHidden: true,
      durationMs: 300,
      onImageError,
    });

    await rerender({
      src: "/b.png",
      imageClass: "background-image",
      alt: "",
      ariaHidden: true,
      durationMs: 300,
      onImageError,
    });

    await rerender({
      src: null,
      imageClass: "background-image",
      alt: "",
      ariaHidden: true,
      durationMs: 300,
      onImageError,
    });

    const pendingImage = container.querySelectorAll(
      "img",
    )[1] as HTMLImageElement;
    expect(pendingImage).toHaveAttribute("src", "/b.png");

    await fireEvent.error(pendingImage);
    expect(onImageError).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(imageSources(container)).toEqual(["/a.png"]);
    });
  });

  it("forces aria-hidden on leaving layers even when the caller opts out", async () => {
    vi.useFakeTimers();
    const { container, rerender } = render(CrossfadeImage, {
      src: "/old.png",
      imageClass: "background-image",
      alt: "",
      ariaHidden: false,
      durationMs: 300,
    });

    const oldImage = firstImage(container);
    // Caller opted out, so the visible layer is NOT aria-hidden.
    expect(oldImage).not.toHaveAttribute("aria-hidden", "true");

    await rerender({
      src: "/new.png",
      imageClass: "background-image",
      alt: "",
      ariaHidden: false,
      durationMs: 300,
    });

    const incoming = container.querySelectorAll("img")[1] as HTMLImageElement;
    await fireEvent.load(incoming);

    // The old layer is now leaving and must be hidden from AT regardless of
    // the caller's aria-hidden preference.
    expect(oldImage).toHaveClass("leaving");
    expect(oldImage).toHaveAttribute("aria-hidden", "true");
    // The incoming visible layer still respects the caller's opt-out.
    expect(incoming).not.toHaveAttribute("aria-hidden", "true");
  });

  it("defines the transition and reduced-motion CSS contract", () => {
    const source = readFileSync(
      resolve(import.meta.dirname!, "CrossfadeImage.svelte"),
      "utf8",
    );

    expect(source).toContain(".crossfade-image-layer");
    expect(source).toContain(
      "transition: opacity var(--crossfade-duration, 300ms)",
    );
    expect(source).toContain("opacity: var(--crossfade-visible-opacity, 1)");
    expect(source).toContain("@media (prefers-reduced-motion: reduce)");
    expect(source).toContain("transition-duration: 1ms");
    expect(source).not.toContain("--crossfade-duration: 1ms");
  });
});

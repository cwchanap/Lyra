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

  it("defines the transition and reduced-motion CSS contract", () => {
    const source = readFileSync(
      resolve(import.meta.dirname!, "CrossfadeImage.svelte"),
      "utf8",
    );

    expect(source).toContain(".crossfade-image-layer");
    expect(source).toContain(
      "transition: opacity var(--crossfade-duration, 300ms)",
    );
    expect(source).toContain("@media (prefers-reduced-motion: reduce)");
    expect(source).toContain("--crossfade-duration: 1ms");
  });
});

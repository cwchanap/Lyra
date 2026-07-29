import { tick } from "svelte";
import type { SaveSlotRef } from "./types";

export type SaveBrowserMode = "titleLoad" | "gameLoad" | "manualSave";
export type SaveBrowserLayer = "browser" | "name" | "confirmation";
export type LayerFocusTarget = () => HTMLElement | null;

export type SaveBrowserController = {
  readonly mode: SaveBrowserMode;
  readonly continueCandidate: SaveSlotRef | null;
  readonly selected: SaveSlotRef | null;
  readonly layer: SaveBrowserLayer;
  select(reference: SaveSlotRef): void;
  openName(opener: LayerFocusTarget, initialFocus?: LayerFocusTarget): void;
  openConfirmation(
    opener: LayerFocusTarget,
    initialFocus?: LayerFocusTarget,
  ): void;
  handleKeydown(event: KeyboardEvent): boolean;
  back(): void;
  close(): void;
};

export type SaveBrowserControllerOptions = {
  mode: SaveBrowserMode;
  continueCandidate: SaveSlotRef | null;
  returnFocusTo?: LayerFocusTarget;
  onClose: () => void;
};

export function createSaveBrowserController(
  options: SaveBrowserControllerOptions,
): SaveBrowserController {
  let selected = $state<SaveSlotRef | null>(null);
  let layer = $state<SaveBrowserLayer>("browser");
  let closed = false;
  const stack: Array<{
    layer: SaveBrowserLayer;
    opener: LayerFocusTarget;
  }> = [];

  function focusWhenReady(target?: LayerFocusTarget): void {
    if (!target) return;
    void tick().then(() => {
      const element = target();
      if (element?.isConnected) element.focus();
    });
  }

  function restoreFocus(target: LayerFocusTarget | undefined): void {
    focusWhenReady(target);
  }

  function open(
    nextLayer: Exclude<SaveBrowserLayer, "browser">,
    opener: LayerFocusTarget,
    initialFocus?: LayerFocusTarget,
  ): void {
    stack.push({ layer, opener });
    layer = nextLayer;
    focusWhenReady(initialFocus);
  }

  function close(): void {
    if (closed) return;
    closed = true;
    stack.length = 0;
    layer = "browser";
    options.onClose();
    restoreFocus(options.returnFocusTo);
  }

  function back(): void {
    const previous = stack.pop();
    if (!previous) {
      close();
      return;
    }
    layer = previous.layer;
    restoreFocus(previous.opener);
  }

  return {
    mode: options.mode,
    continueCandidate: options.continueCandidate,
    get selected() {
      return selected;
    },
    get layer() {
      return layer;
    },
    select(reference) {
      selected = reference;
    },
    openName(opener, initialFocus) {
      open("name", opener, initialFocus);
    },
    openConfirmation(opener, initialFocus) {
      open("confirmation", opener, initialFocus);
    },
    handleKeydown(event) {
      if (event.key !== "Escape" || event.repeat) return false;
      event.preventDefault();
      event.stopPropagation();
      back();
      return true;
    },
    back,
    close,
  };
}

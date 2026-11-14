import { tick } from "svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createSaveBrowserController,
  type LayerFocusTarget,
  type SaveBrowserControllerOptions,
} from "./save-browser-controller.svelte";

afterEach(() => {
  document.body.replaceChildren();
});

function button(label: string): HTMLButtonElement {
  const element = document.createElement("button");
  element.textContent = label;
  document.body.append(element);
  return element;
}

async function settleFocus(): Promise<void> {
  await tick();
}

describe("createSaveBrowserController", () => {
  it("retains the Rust-selected Continue candidate and typed selection", () => {
    const continueCandidate = { type: "manual", slot: 2 } as const;
    const controller = createSaveBrowserController({
      mode: "titleLoad",
      continueCandidate,
      onClose: vi.fn(),
    });

    expect(controller.mode).toBe("titleLoad");
    expect(controller.continueCandidate).toEqual(continueCandidate);
    expect(controller.selected).toBeNull();

    controller.select({ type: "auto", slot: 4 });
    expect(controller.selected).toEqual({ type: "auto", slot: 4 });
  });

  it("steps confirmation to name to browser and restores each opener", async () => {
    const caller = button("caller");
    const browserOpener = button("open name");
    const nameInput = document.createElement("input");
    nameInput.setAttribute("aria-label", "name");
    document.body.append(nameInput);
    const nameOpener = button("open confirmation");
    const onClose = vi.fn();
    const controller = createSaveBrowserController({
      mode: "manualSave",
      continueCandidate: null,
      returnFocusTo: () => caller,
      onClose,
    });

    browserOpener.focus();
    controller.openName(
      () => browserOpener,
      () => nameInput,
    );
    await settleFocus();
    expect(controller.layer).toBe("name");
    expect(document.activeElement).toBe(nameInput);

    nameOpener.focus();
    controller.openConfirmation(() => nameOpener);
    await settleFocus();
    expect(controller.layer).toBe("confirmation");
    // The confirmation dialog owns its autofocus; the controller must not
    // move focus when the layer opens.
    expect(document.activeElement).toBe(nameOpener);

    controller.back();
    await settleFocus();
    expect(controller.layer).toBe("name");
    expect(document.activeElement).toBe(nameOpener);

    controller.back();
    await settleFocus();
    expect(controller.layer).toBe("browser");
    expect(document.activeElement).toBe(browserOpener);

    controller.back();
    await settleFocus();
    expect(onClose).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(caller);
  });

  it("consumes one non-repeated Escape per layer without focusing behind it", async () => {
    const caller = button("caller");
    const browserOpener = button("open confirmation");
    const onClose = vi.fn();
    const controller = createSaveBrowserController({
      mode: "gameLoad",
      continueCandidate: null,
      returnFocusTo: () => caller,
      onClose,
    });
    browserOpener.focus();
    controller.openConfirmation(() => browserOpener);
    await settleFocus();

    const repeated = new KeyboardEvent("keydown", {
      key: "Escape",
      repeat: true,
      cancelable: true,
    });
    expect(controller.handleKeydown(repeated)).toBe(false);
    expect(controller.layer).toBe("confirmation");
    expect(document.activeElement).toBe(browserOpener);

    const escape = new KeyboardEvent("keydown", {
      key: "Escape",
      cancelable: true,
    });
    expect(controller.handleKeydown(escape)).toBe(true);
    await settleFocus();
    expect(escape.defaultPrevented).toBe(true);
    expect(controller.layer).toBe("browser");
    expect(document.activeElement).toBe(browserOpener);
    expect(onClose).not.toHaveBeenCalled();

    controller.handleKeydown(
      new KeyboardEvent("keydown", { key: "Escape", cancelable: true }),
    );
    await settleFocus();
    expect(onClose).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(caller);
  });

  it("re-resolves the caller after close remounts its host", async () => {
    let caller = button("caller");
    caller.dataset.focusTarget = "caller";
    const opener = button("opener");
    const modalButton = button("modal");
    const onClose = vi.fn(() => {
      caller.remove();
      queueMicrotask(() => {
        caller = button("remounted caller");
        caller.dataset.focusTarget = "caller";
      });
    });
    const controller = createSaveBrowserController({
      mode: "manualSave",
      continueCandidate: null,
      returnFocusTo: () =>
        document.querySelector<HTMLElement>('[data-focus-target="caller"]'),
      onClose,
    });
    controller.openName(
      () => opener,
      () => modalButton,
    );
    await settleFocus();

    controller.close();
    await settleFocus();

    expect(controller.layer).toBe("browser");
    expect(onClose).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(caller);
  });

  it("re-resolves a name-layer opener recreated after confirmation unmounts it", async () => {
    const browserOpener = button("open name");
    const nameInput = document.createElement("input");
    document.body.append(nameInput);
    let nameSubmit = button("continue to confirmation");
    nameSubmit.dataset.focusTarget = "name-submit";
    const controller = createSaveBrowserController({
      mode: "manualSave",
      continueCandidate: null,
      onClose: vi.fn(),
    });

    controller.openName(
      () => browserOpener,
      () => nameInput,
    );
    await settleFocus();
    controller.openConfirmation(() =>
      document.querySelector<HTMLElement>('[data-focus-target="name-submit"]'),
    );
    await settleFocus();

    nameSubmit.remove();
    controller.back();

    // Mirrors Svelte's conditional layer render: the controller changes the
    // layer first, then the prior name form recreates its submit control in the
    // resulting render microtask. A synchronous locator lookup would run before
    // this replacement exists and leave focus behind the restored layer.
    expect(controller.layer).toBe("name");
    queueMicrotask(() => {
      nameSubmit = button("recreated continue");
      nameSubmit.dataset.focusTarget = "name-submit";
    });
    await settleFocus();

    expect(controller.layer).toBe("name");
    expect(document.activeElement).toBe(nameSubmit);
  });

  it("restores a delete opener by locator after cancel remounts the browser list", async () => {
    const caller = button("caller");
    let remountedDelete: HTMLButtonElement | null = null;
    const controller = createSaveBrowserController({
      mode: "titleLoad",
      continueCandidate: null,
      returnFocusTo: () => caller,
      onClose: vi.fn(),
    });
    const deleteButton = button("刪除手動存檔 1");
    deleteButton.dataset.focusTarget = "delete-manual-1";
    controller.openConfirmation(() =>
      document.querySelector<HTMLElement>(
        '[data-focus-target="delete-manual-1"]',
      ),
    );
    await settleFocus();
    expect(controller.layer).toBe("confirmation");

    // Cancelling unmounts the confirmation layer and Svelte re-renders the
    // browser list, so the delete button that opened it is a brand-new
    // element by the time the controller resolves the opener locator. A
    // captured element would be stale and leave focus behind the modal.
    deleteButton.remove();
    queueMicrotask(() => {
      remountedDelete = button("刪除手動存檔 1");
      remountedDelete.dataset.focusTarget = "delete-manual-1";
    });
    controller.back();
    await settleFocus();

    expect(controller.layer).toBe("browser");
    expect(document.activeElement).toBe(remountedDelete);
  });

  it("focuses the configured initialFocus target when the browser controller is created", async () => {
    const backButton = button("返回");
    // Task 3 adds `initialFocus` to the controller options so a freshly
    // opened browser has one predictable focus owner; the cast keeps this
    // red test type-checking until the option lands.
    const controller = createSaveBrowserController({
      mode: "titleLoad",
      continueCandidate: null,
      initialFocus: () => backButton,
      onClose: vi.fn(),
    } as SaveBrowserControllerOptions);

    await settleFocus();

    expect(controller.layer).toBe("browser");
    expect(document.activeElement).toBe(backButton);
  });

  it("never moves focus when opening the confirmation layer; the dialog owns autofocus", async () => {
    const opener = button("刪除手動存檔 1");
    opener.focus();
    const stolenConfirm = button("確認刪除");
    const controller = createSaveBrowserController({
      mode: "titleLoad",
      continueCandidate: null,
      onClose: vi.fn(),
    });

    // The old API let callers pass a second initialFocus locator whose
    // last-child query landed on the dangerous confirm button, so a second
    // Return confirmed immediately. Pin the single-focus-owner API by
    // casting: opening a confirmation must not move focus even if a caller
    // still passes the legacy second argument.
    const legacyOpenConfirmation = controller.openConfirmation as unknown as (
      opener: LayerFocusTarget,
      initialFocus?: LayerFocusTarget,
    ) => void;
    legacyOpenConfirmation(
      () => opener,
      () => stolenConfirm,
    );
    await settleFocus();

    expect(controller.layer).toBe("confirmation");
    expect(document.activeElement).toBe(opener);
  });
});

import { tick } from "svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSaveBrowserController } from "./save-browser-controller.svelte";

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
    const confirmationButton = button("confirm");
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
    controller.openConfirmation(
      () => nameOpener,
      () => confirmationButton,
    );
    await settleFocus();
    expect(controller.layer).toBe("confirmation");
    expect(document.activeElement).toBe(confirmationButton);

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
    const modalButton = button("modal action");
    const onClose = vi.fn();
    const controller = createSaveBrowserController({
      mode: "gameLoad",
      continueCandidate: null,
      returnFocusTo: () => caller,
      onClose,
    });
    controller.openConfirmation(
      () => browserOpener,
      () => modalButton,
    );
    await settleFocus();

    const repeated = new KeyboardEvent("keydown", {
      key: "Escape",
      repeat: true,
      cancelable: true,
    });
    expect(controller.handleKeydown(repeated)).toBe(false);
    expect(controller.layer).toBe("confirmation");
    expect(document.activeElement).toBe(modalButton);

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
    const confirmationButton = button("confirm");
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
    controller.openConfirmation(
      () =>
        document.querySelector<HTMLElement>(
          '[data-focus-target="name-submit"]',
        ),
      () => confirmationButton,
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
});

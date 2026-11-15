export const DEFAULT_DIALOG_FOCUSABLE_SELECTOR =
  'button:not([disabled]), [tabindex]:not([tabindex="-1"])';

export type TrapDialogTabOptions = {
  selector?: string;
  stopPropagation?: boolean;
};

/**
 * Cycle Tab/Shift+Tab across matching controls inside a modal container in JS.
 * Native traversal cannot be relied on across jsdom and macOS WebKit when
 * "Keyboard navigation" is disabled, so every Tab key is handled explicitly.
 */
export function trapDialogTabKey(
  event: KeyboardEvent,
  container: HTMLElement | null | undefined,
  options?: TrapDialogTabOptions,
): boolean {
  if (event.key !== "Tab" || !container) return false;
  event.preventDefault();
  if (options?.stopPropagation) {
    event.stopPropagation();
    event.stopImmediatePropagation();
  }

  const selector = options?.selector ?? DEFAULT_DIALOG_FOCUSABLE_SELECTOR;
  const controls = Array.from(
    container.querySelectorAll<HTMLElement>(selector),
  );
  if (controls.length === 0) {
    container.focus();
    return true;
  }

  const activeIndex = controls.indexOf(document.activeElement as HTMLElement);
  const nextIndex =
    activeIndex < 0
      ? event.shiftKey
        ? controls.length - 1
        : 0
      : (activeIndex + (event.shiftKey ? -1 : 1) + controls.length) %
        controls.length;
  controls[nextIndex]?.focus();
  return true;
}

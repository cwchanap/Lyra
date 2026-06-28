import { afterEach, describe, expect, it, vi } from "vitest";
import {
  claimEscape,
  closeTopmostEscapeClaim,
  escapeClaimed,
  resetEscapeCoordinator,
} from "./escape-coordinator";

describe("escape-coordinator", () => {
  afterEach(() => {
    resetEscapeCoordinator();
  });

  it("reports no claim when empty", () => {
    expect(escapeClaimed()).toBe(false);
    expect(closeTopmostEscapeClaim()).toBe(false);
  });

  it("routes Escape to the topmost claim and reports it consumed", () => {
    const first = vi.fn();
    const second = vi.fn();
    claimEscape(first);
    claimEscape(second);

    expect(escapeClaimed()).toBe(true);
    expect(closeTopmostEscapeClaim()).toBe(true);
    // second was registered last, so it is the topmost claim.
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
  });

  it("removes a claim when its release function is called", () => {
    const closer = vi.fn();
    const release = claimEscape(closer);

    release();
    expect(escapeClaimed()).toBe(false);
    expect(closeTopmostEscapeClaim()).toBe(false);
    expect(closer).not.toHaveBeenCalled();
  });

  it("makes each release function idempotent and scoped to its own claim", () => {
    const closer = vi.fn();
    const release = claimEscape(closer);

    release();
    release(); // no-op: a release is idempotent
    expect(escapeClaimed()).toBe(false);

    // A fresh claim gets a fresh release; the stale release can't touch it.
    const release2 = claimEscape(closer);
    expect(escapeClaimed()).toBe(true);
    release(); // stale release — must not release the new claim
    expect(escapeClaimed()).toBe(true);
    release2(); // the new claim's own release
    expect(escapeClaimed()).toBe(false);
  });

  it("drains claims LIFO across multiple Escape presses when closers self-release", () => {
    // Mirrors the production $effect pattern: each closer releases its own
    // claim synchronously, so one Escape closes exactly one layer.
    const outer = vi.fn();
    const releaseOuter = claimEscape(outer);
    outer.mockImplementation(() => releaseOuter());

    const inner = vi.fn();
    const releaseInner = claimEscape(inner);
    inner.mockImplementation(() => releaseInner());

    // stack: [outer, inner]; topmost is inner.
    expect(closeTopmostEscapeClaim()).toBe(true);
    expect(inner).toHaveBeenCalledTimes(1);
    expect(outer).not.toHaveBeenCalled();
    expect(escapeClaimed()).toBe(true); // outer remains

    expect(closeTopmostEscapeClaim()).toBe(true);
    expect(outer).toHaveBeenCalledTimes(1);
    expect(escapeClaimed()).toBe(false); // both released

    expect(closeTopmostEscapeClaim()).toBe(false); // stack drained
  });

  it("releases only the owning claim when the same closer is registered multiple times", () => {
    // Two simultaneous claims sharing the same closer reference must each
    // release their own entry, not the other's. Releasing in FIFO order
    // (first registered, first released) must remove the first entry and
    // leave the second intact — lastIndexOf(closer) would instead remove
    // the wrong (last) entry, leaving a stale claim behind.
    const closer = vi.fn();
    const releaseA = claimEscape(closer);
    const releaseB = claimEscape(closer);

    expect(escapeClaimed()).toBe(true);

    releaseA();
    expect(escapeClaimed()).toBe(true); // releaseB's claim still holds

    releaseB();
    expect(escapeClaimed()).toBe(false);
  });

  it("a closer that does not self-release keeps consuming Escape", () => {
    // Documents the caller contract: a buggy closer that never releases its
    // claim leaves the stack non-empty, so Escape keeps routing to it. This
    // is why the $effect cleanup release is mandatory in production code.
    const sticky = vi.fn();
    claimEscape(sticky);

    expect(closeTopmostEscapeClaim()).toBe(true);
    expect(sticky).toHaveBeenCalledTimes(1);
    expect(escapeClaimed()).toBe(true);
    expect(closeTopmostEscapeClaim()).toBe(true);
    expect(sticky).toHaveBeenCalledTimes(2);
  });
});

/**
 * HPA-601 §11: deterministic sole-destination decision for the Chapter 1
 * city-map drain. Zero enabled destinations => no map decision (null); one
 * => its id; several => fail rather than guess. Pure: callers keep all DOM
 * querying on their side of the seam.
 */
export function soleMapDestinationId(ids: readonly string[]): string | null {
  if (ids.length === 0) return null;
  if (ids.length === 1) return ids[0];
  throw new Error(
    `expected at most one enabled map destination, got ${ids.length}: ${ids.join(
      ", ",
    )}`,
  );
}

export async function drainPendingAcquisitionsWithinCap<Acquisition>(options: {
  cap: number;
  readCurrent: () => Promise<Acquisition | null>;
  acknowledge: (current: Acquisition) => Promise<void>;
}): Promise<void> {
  for (let index = 0; index < options.cap; index += 1) {
    const current = await options.readCurrent();
    if (current === null) return;
    await options.acknowledge(current);
  }

  if ((await options.readCurrent()) === null) return;
  throw new Error(
    `pending acquisitions did not drain within the cap of ${options.cap}`,
  );
}

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

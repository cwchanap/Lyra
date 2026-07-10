import type { AcquisitionNotification } from "./acquisition-notifications";

export type AcquisitionController = {
  readonly current: AcquisitionNotification | null;
  readonly blocking: boolean;
  readonly size: number;
  enqueue: (notifications: readonly AcquisitionNotification[]) => void;
  dismissCurrent: (expectedKey: string) => boolean;
  clear: () => void;
};

export function createAcquisitionController(): AcquisitionController {
  const queue = $state<AcquisitionNotification[]>([]);

  return {
    get current() {
      return queue[0] ?? null;
    },
    get blocking() {
      return queue.length > 0;
    },
    get size() {
      return queue.length;
    },
    enqueue(notifications) {
      queue.push(...notifications);
    },
    dismissCurrent(expectedKey) {
      if (queue[0]?.key !== expectedKey) return false;
      queue.shift();
      return true;
    },
    clear() {
      queue.splice(0, queue.length);
    },
  };
}

export const acquisitionController = createAcquisitionController();

import { describe, expect, it } from "vitest";
import { drainPendingAcquisitionsWithinCap } from "./pending-acquisition-drain";

type Acquisition = { id: string };

describe("pending acquisition drain cap", () => {
  it("accepts one successful acknowledgement when the cap is one", async () => {
    const pending: Acquisition[] = [{ id: "kagami_summary" }];
    const acknowledged: string[] = [];

    await drainPendingAcquisitionsWithinCap({
      cap: 1,
      readCurrent: async () => pending[0] ?? null,
      acknowledge: async (current) => {
        acknowledged.push(current.id);
        pending.shift();
      },
    });

    expect(acknowledged).toEqual(["kagami_summary"]);
    expect(pending).toEqual([]);
  });

  it("reports cap exhaustion when an acquisition still remains", async () => {
    const pending: Acquisition[] = [
      { id: "kagami_summary" },
      { id: "remaining_record" },
    ];

    await expect(
      drainPendingAcquisitionsWithinCap({
        cap: 1,
        readCurrent: async () => pending[0] ?? null,
        acknowledge: async () => {
          pending.shift();
        },
      }),
    ).rejects.toThrow("pending acquisitions did not drain within the cap of 1");
    expect(pending).toEqual([{ id: "remaining_record" }]);
  });
});

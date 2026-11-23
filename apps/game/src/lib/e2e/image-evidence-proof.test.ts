import { afterEach, describe, expect, it } from "vitest";
import {
  probeImagePresenceDom,
  runCaseFileRecordGate,
  runImageEvidenceProof,
  type CaseFileRecordTarget,
} from "./image-evidence-proof";

describe("runImageEvidenceProof", () => {
  it("captures failure evidence and rethrows the original error when the image never mounts", async () => {
    const mountError = new Error("image did not mount");
    const calls: string[] = [];
    const captured: { error: unknown; inspection: unknown }[] = [];
    await expect(
      runImageEvidenceProof({
        inspect: async () => {
          calls.push("inspect");
          throw mountError;
        },
        report: () => calls.push("report"),
        assert: () => {
          calls.push("assert");
        },
        provePainted: async () => {
          calls.push("provePainted");
        },
        onReceipt: () => calls.push("onReceipt"),
        captureFailure: async ({ error, inspection }) => {
          captured.push({ error, inspection });
          calls.push("captureFailure");
        },
      }),
    ).rejects.toBe(mountError);
    expect(captured).toEqual([{ error: mountError, inspection: null }]);
    expect(calls).toEqual(["inspect", "captureFailure"]);
  });

  it("passes the collected inspection to captureFailure when the source proof fails", async () => {
    const inspection = { decode: { ok: false }, mountWaitMs: 3 };
    const sourceError = new Error("img.decode() rejected");
    const captured: { error: unknown; inspection: unknown }[] = [];
    const calls: string[] = [];
    await expect(
      runImageEvidenceProof({
        inspect: async () => {
          calls.push("inspect");
          return inspection;
        },
        assert: () => {
          calls.push("assert");
          throw sourceError;
        },
        provePainted: async () => {
          calls.push("provePainted");
        },
        onReceipt: () => calls.push("onReceipt"),
        captureFailure: async ({ error, inspection: seen }) => {
          captured.push({ error, inspection: seen });
          calls.push("captureFailure");
        },
      }),
    ).rejects.toBe(sourceError);
    expect(captured).toEqual([{ error: sourceError, inspection }]);
    expect(calls).toEqual(["inspect", "assert", "captureFailure"]);
  });

  it("never produces a receipt when the crop proof throws", async () => {
    const calls: string[] = [];
    await expect(
      runImageEvidenceProof({
        inspect: async () => ({}),
        assert: () => {},
        provePainted: async () => {
          calls.push("provePainted");
          throw new Error("crop region was single-color");
        },
        onReceipt: () => calls.push("onReceipt"),
        captureFailure: async () => {
          calls.push("captureFailure");
        },
      }),
    ).rejects.toThrow("crop region was single-color");
    expect(calls).toEqual(["provePainted", "captureFailure"]);
  });

  it("rethrows the original error even when failure capture itself fails", async () => {
    const original = new Error("img.decode() rejected");
    await expect(
      runImageEvidenceProof({
        inspect: async () => ({}),
        assert: () => {
          throw original;
        },
        captureFailure: async () => {
          throw new Error("saveScreenshot failed");
        },
      }),
    ).rejects.toBe(original);
  });

  it("runs prepare, inspect, assert, crop, and receipt in order on success", async () => {
    const calls: string[] = [];
    await runImageEvidenceProof({
      prepare: async () => {
        calls.push("prepare");
      },
      inspect: async () => {
        calls.push("inspect");
        return {};
      },
      report: () => calls.push("report"),
      assert: () => {
        calls.push("assert");
      },
      provePainted: async () => {
        calls.push("provePainted");
      },
      onReceipt: () => calls.push("onReceipt"),
      captureFailure: async () => {
        calls.push("captureFailure");
      },
    });
    expect(calls).toEqual([
      "prepare",
      "inspect",
      "report",
      "assert",
      "provePainted",
      "onReceipt",
    ]);
  });
});

describe("probeImagePresenceDom", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("reports mounted:false when no image matches", () => {
    expect(probeImagePresenceDom("img.missing")).toEqual({
      mounted: false,
      images: [],
    });
  });

  it("reports each mounted image's observable state", () => {
    const image = document.createElement("img");
    image.src = "http://localhost/assets/evidence/cctv_screenshot.png";
    document.body.appendChild(image);
    const probe = probeImagePresenceDom("img");
    expect(probe.mounted).toBe(true);
    expect(probe.images).toHaveLength(1);
    expect(probe.images[0]?.currentSrc).toContain("cctv_screenshot.png");
  });
});

/**
 * Caller-level coverage for the Case File early validation: the gate that
 * rejects a missing record or a null/wrong imageAssetId must attempt the
 * required 800x600 failure evidence before the viewport restore, exactly
 * like the in-menu mount/source failures — and must still rethrow the
 * original error when capture itself fails. The injected findRecord /
 * captureFailure seams are the same ones verifyHpa831CaseFileRecords wires
 * to the real state read and captureImageFailureDiagnostics.
 */
describe("runCaseFileRecordGate", () => {
  const TARGETS: readonly CaseFileRecordTarget[] = [
    {
      id: "cctv_screenshot",
      assetId: "evidence.cctv_screenshot",
      name: "閉店監視器截圖",
    },
    {
      id: "timecard_record",
      assetId: "evidence.timecard_record",
      name: "三宅打卡紀錄",
    },
  ];
  const WRAPPER = "inv_3_wrap";

  const records = (entries: { id: string; imageAssetId: string | null }[]) =>
    new Map(entries.map((entry) => [entry.id, entry]));

  function gate(
    evidence: ReturnType<typeof records>,
    captured: { target: { id: string }; error: unknown }[],
  ) {
    return {
      targets: TARGETS,
      gateWrapper: WRAPPER,
      findRecord: (target: CaseFileRecordTarget) => evidence.get(target.id),
      captureFailure: async (input: {
        target: CaseFileRecordTarget;
        error: unknown;
      }) => {
        captured.push(input);
      },
    };
  }

  it("attempts failure evidence and rethrows the original error when a gated record is missing", async () => {
    const evidence = records([
      { id: "timecard_record", imageAssetId: "evidence.timecard_record" },
    ]);
    const captured: { target: { id: string }; error: unknown }[] = [];
    const failure = await runCaseFileRecordGate(gate(evidence, captured)).then(
      () => null,
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toContain(
      `Case File gate reached ${WRAPPER} without organically acquiring cctv_screenshot`,
    );
    expect(captured).toHaveLength(1);
    expect(captured[0]?.target.id).toBe("cctv_screenshot");
    expect(captured[0]?.error).toBe(failure);
  });

  it("attempts failure evidence for a null imageAssetId, naming the expected asset", async () => {
    const evidence = records([
      { id: "cctv_screenshot", imageAssetId: null },
      { id: "timecard_record", imageAssetId: "evidence.timecard_record" },
    ]);
    const captured: { target: { id: string }; error: unknown }[] = [];
    await expect(
      runCaseFileRecordGate(gate(evidence, captured)),
    ).rejects.toThrow(
      /cctv_screenshot imageAssetId is null, expected evidence\.cctv_screenshot/,
    );
    expect(captured).toHaveLength(1);
    expect(captured[0]?.target.id).toBe("cctv_screenshot");
  });

  it("attempts failure evidence for a wrong imageAssetId", async () => {
    const evidence = records([
      { id: "cctv_screenshot", imageAssetId: "evidence.cctv_screenshot" },
      {
        id: "timecard_record",
        imageAssetId: "evidence.doorlock_summary_timetable",
      },
    ]);
    const captured: { target: { id: string }; error: unknown }[] = [];
    await expect(
      runCaseFileRecordGate(gate(evidence, captured)),
    ).rejects.toThrow(/expected evidence\.timecard_record/);
    expect(captured).toHaveLength(1);
    expect(captured[0]?.target.id).toBe("timecard_record");
  });

  it("rethrows the original validation error even when failure capture itself rejects", async () => {
    const evidence = records([
      { id: "timecard_record", imageAssetId: "evidence.timecard_record" },
    ]);
    await expect(
      runCaseFileRecordGate({
        targets: TARGETS,
        gateWrapper: WRAPPER,
        findRecord: (target) => evidence.get(target.id),
        captureFailure: async () => {
          throw new Error("saveScreenshot failed");
        },
      }),
    ).rejects.toThrow(/without organically acquiring cctv_screenshot/);
  });

  it("captures nothing when every gated record is present with its authored asset", async () => {
    const evidence = records([
      { id: "cctv_screenshot", imageAssetId: "evidence.cctv_screenshot" },
      { id: "timecard_record", imageAssetId: "evidence.timecard_record" },
    ]);
    const captured: { target: { id: string }; error: unknown }[] = [];
    await runCaseFileRecordGate(gate(evidence, captured));
    expect(captured).toEqual([]);
  });
});

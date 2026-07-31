import { render, screen, waitFor } from "@testing-library/svelte";
import { userEvent } from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import InventoryPanel from "./InventoryPanel.svelte";
import type { CaseRecordProvenance, Inventory } from "../state/types";
import {
  neutralCaseRecordProvenance,
  neutralEvidenceRecordView,
  neutralStatementRecordView,
} from "../state/test-fixtures";
import { cssRule } from "$lib/test-utils";

const testDir = dirname(fileURLToPath(import.meta.url));

const annotatedProvenance: CaseRecordProvenance = {
  sourceKind: "digital",
  representationLayer: "raw",
  proceduralStatus: "exhibit",
  completeness: "complete",
  confidence: "corroborated",
  sourceGroupId: "cafe_register_export",
  sourceLabel: "鑑識原始檔",
  proofCapabilities: ["time", "identity", "procedure"],
  supersedesRecordId: null,
};

const inventory: Inventory = {
  evidence: [
    {
      id: "coffee_receipt",
      name: "咖啡收據",
      description: "收據上的時間被圈起。",
      details: "一張潮濕的收據。",
      provenance: annotatedProvenance,
      imageAssetId: "evidence.coffee_receipt_load_error_component_test",
      onReexamine: null,
      collectedInChapterId: "chapter_1",
      collectedInSceneId: "scene_0",
      acquisitionContext: {
        chapterId: "chapter_1",
        chapterTitle: "第一章",
        sceneId: "scene_0",
        sceneTitle: "咖啡館",
      },
      sourceGroup: null,
    },
  ],
  statements: [
    neutralStatementRecordView({
      id: "statement_1",
      speaker: "若月",
      content: "我一直在店內。",
      onReexamine: null,
      acquiredInChapterId: "chapter_1",
      acquiredInSceneId: "scene_0",
    }),
  ],
};

function source() {
  return readFileSync(join(testDir, "InventoryPanel.svelte"), "utf8");
}

function normalizedText(element: Element): string {
  return element.textContent?.replace(/\s+/g, " ").trim() ?? "";
}

function inventoryOutput(provenance: CaseRecordProvenance) {
  const rendered = render(InventoryPanel, {
    inventory: {
      ...inventory,
      evidence: inventory.evidence.map((record) => ({
        ...record,
        provenance,
      })),
    },
    reexamineEnabled: true,
    onReexamineEvidence: vi.fn(),
    onReexamineStatement: vi.fn(),
    open: true,
  });
  const inventoryPanel = rendered.container.querySelector("aside");
  if (!inventoryPanel) {
    throw new Error("expected rendered inventory panel");
  }
  const output = {
    visibleText: normalizedText(inventoryPanel),
    buttons: Array.from(inventoryPanel.querySelectorAll("button")),
    unmount: rendered.unmount,
  };
  return output;
}

describe("InventoryPanel", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("falls back to an evidence thumbnail placeholder when the image fails to load", async () => {
    const user = userEvent.setup();

    const { container } = render(InventoryPanel, {
      inventory,
      reexamineEnabled: true,
      onReexamineEvidence: vi.fn(),
      onReexamineStatement: vi.fn(),
    });

    await user.click(screen.getByRole("button", { name: /EVIDENCE/ }));

    await waitFor(() => {
      expect(container.querySelector("img.evidence-thumb")).toHaveAttribute(
        "src",
        "/assets/evidence/coffee_receipt_load_error_component_test.png",
      );
    });

    const image = container.querySelector(
      "img.evidence-thumb",
    ) as HTMLImageElement;
    image.dispatchEvent(new Event("error"));

    await waitFor(() => {
      expect(container.querySelector("img.evidence-thumb")).toHaveAttribute(
        "src",
        expect.stringContaining("data:image/svg+xml"),
      );
    });
  });

  it("keeps statement rows on the non-thumbnail layout", async () => {
    const user = userEvent.setup();

    render(InventoryPanel, {
      inventory,
      reexamineEnabled: true,
      onReexamineEvidence: vi.fn(),
      onReexamineStatement: vi.fn(),
    });

    await user.click(screen.getByRole("button", { name: /EVIDENCE/ }));

    const statementRow = screen.getByRole("button", { name: /若月/ });
    expect(statementRow).toHaveClass("statement-row");
    expect(
      statementRow.querySelector("img.evidence-thumb"),
    ).not.toBeInTheDocument();
  });

  it("renders inline inside the Escape game menu", () => {
    const { container } = render(InventoryPanel, {
      inventory,
      reexamineEnabled: true,
      onReexamineEvidence: vi.fn(),
      onReexamineStatement: vi.fn(),
    });

    expect(container.querySelector("aside")).toBeInTheDocument();
    expect(container.querySelector("aside.scene")).not.toBeInTheDocument();
  });

  it("keeps provenance out of visible and accessible inventory content", () => {
    const establishedVisibleText =
      "收合 EVIDENCE ▸ 1 證 1 言 DOSSIER · 物證檔案 2 項已歸檔 證 證物 (1) 01 咖啡收據 收據上的時間被圈起。 言 證言 (1) 01 若月 我一直在店內。";
    const establishedAccessibleNames = [
      "收合 EVIDENCE ▸ 1 證 1 言",
      "01 咖啡收據 收據上的時間被圈起。",
      "01 若月 我一直在店內。",
    ];
    const expectEstablishedOutput = (
      output: ReturnType<typeof inventoryOutput>,
    ) => {
      expect(output.visibleText).toBe(establishedVisibleText);
      expect(output.buttons).toHaveLength(establishedAccessibleNames.length);
      for (const [
        index,
        accessibleName,
      ] of establishedAccessibleNames.entries()) {
        expect(output.buttons[index]).toHaveAccessibleName(accessibleName);
      }
    };
    const neutralOutput = inventoryOutput(neutralCaseRecordProvenance());
    expectEstablishedOutput(neutralOutput);
    neutralOutput.unmount();

    const annotatedOutput = inventoryOutput(annotatedProvenance);
    expectEstablishedOutput(annotatedOutput);
    annotatedOutput.unmount();

    expect(annotatedOutput.visibleText).toBe(neutralOutput.visibleText);
  });

  it("respects a bound open prop to start expanded", () => {
    // The `open` prop is $bindable: when a parent passes a value, the panel
    // honors it on mount instead of defaulting to collapsed. This is the
    // controlled half of the contract that lets +page.svelte preserve the
    // expand/collapse state across Escape menu close/reopen.
    render(InventoryPanel, {
      inventory,
      reexamineEnabled: true,
      onReexamineEvidence: vi.fn(),
      onReexamineStatement: vi.fn(),
      open: true,
    });

    expect(
      screen.getByRole("region", { name: "物證清單" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /收合/ })).toBeInTheDocument();
  });

  it("keeps evidence inline instead of fixed to the viewport", () => {
    const componentSource = source();
    const asideRule = cssRule(componentSource, "aside");
    const toggleRule = cssRule(componentSource, ".toggle");
    const panelRule = cssRule(componentSource, ".panel");

    expect(asideRule).toContain("position: static");
    expect(asideRule).toContain("width: 100%");
    expect(asideRule).toContain("max-width: none");
    expect(toggleRule).toContain("width: 100%");
    expect(panelRule).toContain("max-height: min(42vh, 360px)");
  });

  it("does not apply evidence-row class when evidence has no image", async () => {
    const user = userEvent.setup();

    const inventoryNoImage: Inventory = {
      evidence: [
        neutralEvidenceRecordView({
          id: "no_image_evidence",
          name: "無圖物證",
          description: "沒有附圖。",
          details: "",
          imageAssetId: null,
          onReexamine: null,
          collectedInChapterId: "chapter_1",
          collectedInSceneId: "scene_0",
        }),
      ],
      statements: [],
    };

    render(InventoryPanel, {
      inventory: inventoryNoImage,
      reexamineEnabled: true,
      onReexamineEvidence: vi.fn(),
      onReexamineStatement: vi.fn(),
    });

    await user.click(screen.getByRole("button", { name: /EVIDENCE/ }));

    const evidenceButton = screen.getByRole("button", { name: /無圖物證/ });
    expect(evidenceButton).not.toHaveClass("evidence-row");
    expect(
      evidenceButton.querySelector("img.evidence-thumb"),
    ).not.toBeInTheDocument();
  });

  it("does not warn when evidence image errors on an already-placeholder thumbnail", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const user = userEvent.setup();

    const { container } = render(InventoryPanel, {
      inventory,
      reexamineEnabled: true,
      onReexamineEvidence: vi.fn(),
      onReexamineStatement: vi.fn(),
    });

    await user.click(screen.getByRole("button", { name: /EVIDENCE/ }));

    await waitFor(() => {
      expect(container.querySelector("img.evidence-thumb")).toBeInTheDocument();
    });

    const img = container.querySelector(
      "img.evidence-thumb",
    ) as HTMLImageElement;
    img.dispatchEvent(new Event("error"));

    await waitFor(() => {
      expect(img.src).toContain("data:image/svg+xml");
    });

    warnSpy.mockClear();
    img.dispatchEvent(new Event("error"));
    expect(warnSpy).not.toHaveBeenCalled();

    warnSpy.mockRestore();
  });

  it("calls onReexamineEvidence when a reexamine is triggered", async () => {
    const user = userEvent.setup();
    const onReexamineEvidence = vi.fn();

    render(InventoryPanel, {
      inventory,
      reexamineEnabled: true,
      onReexamineEvidence,
      onReexamineStatement: vi.fn(),
    });

    await user.click(screen.getByRole("button", { name: /EVIDENCE/ }));
    await user.click(screen.getByRole("button", { name: /咖啡收據/ }));

    expect(onReexamineEvidence).toHaveBeenCalledWith("coffee_receipt");
  });
});

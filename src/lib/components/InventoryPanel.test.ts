import { render, screen, waitFor } from "@testing-library/svelte";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import InventoryPanel from "./InventoryPanel.svelte";
import type { Inventory } from "../state/types";

const inventory: Inventory = {
  evidence: [
    {
      id: "coffee_receipt",
      name: "咖啡收據",
      description: "收據上的時間被圈起。",
      details: "一張潮濕的收據。",
      imageAssetId: "evidence.coffee_receipt_load_error_component_test",
      onReexamine: null,
      collectedInChapterId: "chapter_1",
      collectedInSceneId: "scene_0",
    },
  ],
  statements: [
    {
      id: "statement_1",
      speaker: "若月",
      content: "我一直在店內。",
      onReexamine: null,
      acquiredInChapterId: "chapter_1",
      acquiredInSceneId: "scene_0",
    },
  ],
};

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

    const image = container.querySelector("img.evidence-thumb") as HTMLImageElement;
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
    expect(statementRow.querySelector("img.evidence-thumb")).not.toBeInTheDocument();
  });

  it("does not apply evidence-row class when evidence has no image", async () => {
    const user = userEvent.setup();

    const inventoryNoImage: Inventory = {
      evidence: [
        {
          id: "no_image_evidence",
          name: "無圖物證",
          description: "沒有附圖。",
          details: "",
          imageAssetId: null,
          onReexamine: null,
          collectedInChapterId: "chapter_1",
          collectedInSceneId: "scene_0",
        },
      ],
      statements: [],
    };

    const { container } = render(InventoryPanel, {
      inventory: inventoryNoImage,
      reexamineEnabled: true,
      onReexamineEvidence: vi.fn(),
      onReexamineStatement: vi.fn(),
    });

    await user.click(screen.getByRole("button", { name: /EVIDENCE/ }));

    const evidenceButton = screen.getByRole("button", { name: /無圖物證/ });
    expect(evidenceButton).not.toHaveClass("evidence-row");
    expect(evidenceButton.querySelector("img.evidence-thumb")).not.toBeInTheDocument();
  });
});

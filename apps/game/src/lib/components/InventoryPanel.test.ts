import { render, screen, waitFor } from "@testing-library/svelte";
import { userEvent } from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import InventoryPanel from "./InventoryPanel.svelte";
import type { Inventory } from "../state/types";
import { cssRule } from "$lib/test-utils";

const testDir = dirname(fileURLToPath(import.meta.url));

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

function source() {
  return readFileSync(join(testDir, "InventoryPanel.svelte"), "utf8");
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

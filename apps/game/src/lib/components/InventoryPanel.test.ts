import { render, screen, waitFor } from "@testing-library/svelte";
import { userEvent } from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import InventoryPanel from "./InventoryPanel.svelte";
import type { Inventory } from "../state/types";

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

function cssRule(componentSource: string, selector: string) {
  const match = new RegExp(
    `${selector.replaceAll(".", "\\.")}\\s*{([^}]*)}`,
  ).exec(componentSource);
  return match?.[1] ?? "";
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

  it("can render relative to an investigation scene instead of the viewport", () => {
    const { container } = render(InventoryPanel, {
      inventory,
      reexamineEnabled: true,
      onReexamineEvidence: vi.fn(),
      onReexamineStatement: vi.fn(),
      placement: "scene",
    });

    expect(container.querySelector("aside.scene")).toBeInTheDocument();
  });

  it("can render inline inside the Escape game menu", () => {
    const { container } = render(InventoryPanel, {
      inventory,
      reexamineEnabled: true,
      onReexamineEvidence: vi.fn(),
      onReexamineStatement: vi.fn(),
      placement: "menu",
    });

    expect(container.querySelector("aside.menu")).toBeInTheDocument();
  });

  it("keeps the scene evidence HUD fixed when the panel opens", () => {
    const componentSource = source();
    const asideRule = cssRule(componentSource, "aside.scene");
    const scenePanelRule = cssRule(componentSource, "aside.scene .panel");

    expect(asideRule).toContain("position: fixed");
    expect(asideRule).toContain("top: 22px");
    expect(asideRule).toContain("right: 0");
    expect(asideRule).toContain("width: min(360px, calc(100vw - 24px))");
    expect(scenePanelRule).toContain("max-height: calc(100vh - 96px)");
  });

  it("keeps menu evidence inline instead of fixed to the viewport", () => {
    const componentSource = source();
    const menuAsideRule = cssRule(componentSource, "aside.menu");
    const menuToggleRule = cssRule(componentSource, "aside.menu .toggle");
    const menuPanelRule = cssRule(componentSource, "aside.menu .panel");

    expect(menuAsideRule).toContain("position: static");
    expect(menuAsideRule).toContain("width: 100%");
    expect(menuAsideRule).toContain("max-width: none");
    expect(menuToggleRule).toContain("width: 100%");
    expect(menuPanelRule).toContain("max-height: min(42vh, 360px)");
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

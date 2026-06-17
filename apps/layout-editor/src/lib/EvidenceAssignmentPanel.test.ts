// @vitest-environment jsdom

import { render, screen } from "@testing-library/svelte";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import EvidenceAssignmentPanel from "./EvidenceAssignmentPanel.svelte";
import type { InvestigationSceneJson } from "./layout-types";

const scene = {
  type: "investigation",
  id: "investigation_scene_1",
  title: "Test",
  intro: [],
  sublocations: [
    {
      id: "front",
      label: "Front",
      sceneTag: "Front",
      backgroundAssetId: null,
      transitionDialogue: [],
      hotspots: [
        {
          id: "desk",
          label: "Desk",
          description: "Desk.",
          evidenceSource: "visible",
          sceneSourcePrompt: null,
          reveals: [{ kind: "evidence", id: "receipt" }],
          inspectDialogue: [],
          layout: null,
        },
        {
          id: "window",
          label: "Window",
          description: "Window.",
          evidenceSource: null,
          sceneSourcePrompt: null,
          reveals: [],
          inspectDialogue: [],
          layout: null,
        },
      ],
      characters: [],
    },
    {
      id: "corridor",
      label: "Corridor",
      sceneTag: "Corridor",
      backgroundAssetId: null,
      transitionDialogue: [],
      hotspots: [
        {
          id: "terminal",
          label: "Terminal",
          description: "Terminal.",
          evidenceSource: null,
          sceneSourcePrompt: null,
          reveals: [],
          inspectDialogue: [],
          layout: null,
        },
      ],
      characters: [],
    },
  ],
  evidenceManifest: [
    {
      id: "receipt",
      name: "Receipt",
      description: "Receipt clue.",
      imageAssetId: "evidence.receipt",
      sourceSublocationId: null,
    },
    {
      id: "log",
      name: "Access log",
      description: "Log clue.",
      imageAssetId: null,
      sourceSublocationId: "corridor",
    },
  ],
} satisfies InvestigationSceneJson;

describe("EvidenceAssignmentPanel", () => {
  it("lists evidence with thumbnails and current hotspot assignments", () => {
    render(EvidenceAssignmentPanel, {
      scene,
      disabled: false,
      onAssignEvidence: vi.fn(),
    });

    expect(screen.getByText("Receipt")).toBeInTheDocument();
    expect(screen.getByText("Access log")).toBeInTheDocument();
    expect(screen.getByAltText("Receipt")).toHaveAttribute(
      "src",
      "/assets/evidence/receipt.png",
    );
    expect(screen.getByLabelText("Assign Receipt")).toHaveValue("desk");
    expect(screen.getByLabelText("Assign Access log")).toHaveValue("");
  });

  it("limits hotspot choices to the evidence source sublocation", () => {
    render(EvidenceAssignmentPanel, {
      scene,
      disabled: false,
      onAssignEvidence: vi.fn(),
    });

    const optionLabels = Array.from(
      (screen.getByLabelText("Assign Access log") as HTMLSelectElement).options,
      (option) => option.textContent,
    );

    expect(optionLabels).not.toContain("Front / Desk");
    expect(optionLabels).not.toContain("Front / Window");
    expect(optionLabels).toContain("Corridor / Terminal");
  });

  it("calls the assignment handler when a hotspot is selected", async () => {
    const user = userEvent.setup();
    const onAssignEvidence = vi.fn();

    render(EvidenceAssignmentPanel, {
      scene,
      disabled: false,
      onAssignEvidence,
    });

    await user.selectOptions(screen.getByLabelText("Assign Access log"), [
      "terminal",
    ]);

    expect(onAssignEvidence).toHaveBeenCalledWith("log", "terminal");
  });
});

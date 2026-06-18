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
          evidenceSource: "implied",
          sceneSourcePrompt: null,
          reveals: [],
          inspectDialogue: [],
          layout: null,
        },
      ],
      characters: [
        {
          id: "kurose",
          name: "黑瀨徹",
          role: "Forensic consultant",
          bio: "Consults on evidence timing.",
          layout: null,
          topics: [
            {
              id: "forensic_brief",
              label: "法醫初步簡報",
              reveals: [],
              topicDialogue: [],
            },
          ],
        },
      ],
    },
  ],
  evidenceManifest: [
    {
      id: "receipt",
      name: "Receipt",
      description: "Receipt clue.",
      imageAssetId: "evidence.receipt",
      sourceSublocationId: "front",
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

function sceneWithGeneratedStandaloneLog(): InvestigationSceneJson {
  return {
    ...scene,
    sublocations: scene.sublocations.map((sublocation) =>
      sublocation.id === "corridor"
        ? {
            ...sublocation,
            hotspots: [
              ...sublocation.hotspots,
              {
                id: "evidence_source_log",
                label: "Access log generated source",
                description: "Generated hidden source.",
                evidenceSource: "hidden",
                sceneSourcePrompt: "Generated hidden source.",
                reveals: [{ kind: "evidence", id: "log" }],
                inspectDialogue: [],
                layout: null,
              },
            ],
          }
        : sublocation,
    ),
  };
}

describe("EvidenceAssignmentPanel", () => {
  it("lists only evidence sourced from the selected sublocation with carrier labels", async () => {
    const { container, rerender } = render(EvidenceAssignmentPanel, {
      scene,
      sublocationId: "front",
    });

    expect(
      screen.getByRole("heading", { name: "Evidence Sources" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Receipt")).toBeInTheDocument();
    expect(screen.getByText("receipt")).toBeInTheDocument();
    expect(screen.queryByText("Access log")).not.toBeInTheDocument();
    expect(container.querySelector("img")).toHaveAttribute(
      "src",
      "/assets/evidence/receipt.png",
    );
    expect(screen.queryByAltText("Receipt")).not.toBeInTheDocument();
    expect(screen.getByText("Front / Desk")).toBeInTheDocument();

    await rerender({
      scene,
      sublocationId: "corridor",
    });

    expect(screen.queryByText("Receipt")).not.toBeInTheDocument();
    expect(screen.getByText("Access log")).toBeInTheDocument();
    expect(screen.getByText("log")).toBeInTheDocument();
    expect(screen.getByText("Unassigned")).toBeInTheDocument();
  });

  it("shows a current topic carrier assignment label", () => {
    const topicAssignedScene: InvestigationSceneJson = {
      ...scene,
      sublocations: scene.sublocations.map((sublocation) =>
        sublocation.id === "corridor"
          ? {
              ...sublocation,
              characters: sublocation.characters.map((character) =>
                character.id === "kurose"
                  ? {
                      ...character,
                      topics: character.topics.map((topic) =>
                        topic.id === "forensic_brief"
                          ? {
                              ...topic,
                              reveals: [{ kind: "evidence", id: "log" }],
                            }
                          : topic,
                      ),
                    }
                  : character,
              ),
            }
          : sublocation,
      ),
    };

    render(EvidenceAssignmentPanel, {
      scene: topicAssignedScene,
      sublocationId: "corridor",
    });

    expect(
      screen.getByText("Corridor / 黑瀨徹 / 法醫初步簡報"),
    ).toBeInTheDocument();
  });

  it("shows a current generated standalone hotspot assignment label", () => {
    render(EvidenceAssignmentPanel, {
      scene: sceneWithGeneratedStandaloneLog(),
      sublocationId: "corridor",
    });

    expect(screen.getByText("Create standalone hotspot")).toBeInTheDocument();
  });

  it("renders no editable assignment select", () => {
    const { container } = render(EvidenceAssignmentPanel, {
      scene,
      sublocationId: "corridor",
    });

    expect(container.querySelector("select")).toBeNull();
    expect(screen.queryByLabelText(/^Assign /)).not.toBeInTheDocument();
  });

  it("does not call a legacy assignment handler on user change", async () => {
    const user = userEvent.setup();
    const onAssignEvidence = vi.fn();
    const legacyProps = {
      scene,
      sublocationId: "corridor",
      onAssignEvidence,
    } as unknown as {
      scene: InvestigationSceneJson;
      sublocationId: string;
    };

    const { container } = render(EvidenceAssignmentPanel, legacyProps);

    const legacySelect = container.querySelector("select");
    if (legacySelect) {
      await user.selectOptions(legacySelect, ["hotspot:corridor:terminal"]);
    } else {
      await user.click(screen.getByText("Unassigned"));
    }

    expect(onAssignEvidence).not.toHaveBeenCalled();
  });
});

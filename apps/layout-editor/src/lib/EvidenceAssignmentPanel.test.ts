// @vitest-environment jsdom

import { render, screen } from "@testing-library/svelte";
import { describe, expect, it } from "vitest";
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

  it("labels a hotspot carrier even when it lacks Evidence Source metadata", () => {
    // Audit-flagged case: a hotspot reveals evidence but has
    // evidenceSource: null. The panel must still show the actual carrier
    // label (e.g. "Front / Safe") rather than "Unassigned", so the user
    // can see which hotspot to tag. The untagged hotspot is the SOLE carrier
    // here — if desk also revealed receipt, selectedCarrier() would pick desk
    // first (it has evidenceSource: "visible") and the test would pass without
    // exercising the fix.
    const untaggedCarrierScene: InvestigationSceneJson = {
      ...scene,
      sublocations: scene.sublocations.map((sublocation) =>
        sublocation.id === "front"
          ? {
              ...sublocation,
              hotspots: [
                {
                  id: "desk",
                  label: "Desk",
                  description: "Desk.",
                  evidenceSource: "visible",
                  sceneSourcePrompt: null,
                  reveals: [],
                  inspectDialogue: [],
                  layout: null,
                },
                {
                  id: "safe",
                  label: "Safe",
                  description: "A locked safe.",
                  evidenceSource: null,
                  sceneSourcePrompt: null,
                  reveals: [{ kind: "evidence", id: "receipt" }],
                  inspectDialogue: [],
                  layout: null,
                },
              ],
            }
          : sublocation,
      ),
    };

    render(EvidenceAssignmentPanel, {
      scene: untaggedCarrierScene,
      sublocationId: "front",
    });

    expect(screen.getByText("Front / Safe")).toBeInTheDocument();
    expect(screen.queryByText("Unassigned")).not.toBeInTheDocument();
  });

  it("shows a current generated standalone hotspot assignment label", () => {
    render(EvidenceAssignmentPanel, {
      scene: sceneWithGeneratedStandaloneLog(),
      sublocationId: "corridor",
    });

    expect(
      screen.getByText("Corridor / Access log generated source"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Create standalone hotspot"),
    ).not.toBeInTheDocument();
  });

  it("renders no editable assignment select", () => {
    const { container } = render(EvidenceAssignmentPanel, {
      scene,
      sublocationId: "corridor",
    });

    expect(container.querySelector("select")).toBeNull();
    expect(screen.queryByLabelText(/^Assign /)).not.toBeInTheDocument();
  });
});

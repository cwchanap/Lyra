import { describe, expect, it } from "vitest";
import {
  evidenceAssignmentsForScene,
  moveEvidenceRevealInScene,
  updateEvidenceAssignmentInMarkdown,
} from "./evidence-assignment";
import type { InvestigationSceneJson } from "./layout-types";

const markdown = `# Investigation

## Sublocation: Office {#office}

### Hotspot: Desk {#desk}
- **Description:** A messy desk.
- **Evidence Source:** visible
- **Reveals:** [evidence:receipt, topic:witness/rain]

### Hotspot: Terminal {#terminal}
- **Description:** A locked terminal.

### Hotspot: Folder {#folder}
- **Description:** A folder.
- **Reveals:** [evidence:memo]
`;

const scene = {
  type: "investigation",
  id: "investigation_scene_1",
  title: "Test",
  intro: [],
  sublocations: [
    {
      id: "office",
      label: "Office",
      sceneTag: "Office",
      backgroundAssetId: null,
      transitionDialogue: [],
      hotspots: [
        {
          id: "desk",
          label: "Desk",
          description: "A messy desk.",
          evidenceSource: "visible",
          sceneSourcePrompt: null,
          reveals: [
            { kind: "evidence", id: "receipt" },
            { kind: "topic", characterId: "witness", topicId: "rain" },
          ],
          inspectDialogue: [],
          layout: null,
        },
        {
          id: "terminal",
          label: "Terminal",
          description: "A locked terminal.",
          evidenceSource: null,
          sceneSourcePrompt: null,
          reveals: [],
          inspectDialogue: [],
          layout: null,
        },
        {
          id: "folder",
          label: "Folder",
          description: "A folder.",
          evidenceSource: null,
          sceneSourcePrompt: null,
          reveals: [{ kind: "evidence", id: "memo" }],
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
      id: "memo",
      name: "Memo",
      description: "Memo clue.",
      imageAssetId: "evidence.memo",
      sourceSublocationId: null,
    },
  ],
} satisfies InvestigationSceneJson;

describe("updateEvidenceAssignmentInMarkdown", () => {
  it("moves evidence to another hotspot while preserving non-evidence reveals", () => {
    const result = updateEvidenceAssignmentInMarkdown(markdown, {
      evidenceId: "receipt",
      hotspotId: "terminal",
    });

    expect(result.changed).toBe(true);
    expect(result.contents).toContain(
      "### Hotspot: Desk {#desk}\n- **Description:** A messy desk.\n- **Evidence Source:** visible\n- **Reveals:** [topic:witness/rain]",
    );
    expect(result.contents).toContain(
      "### Hotspot: Terminal {#terminal}\n- **Description:** A locked terminal.\n- **Reveals:** [evidence:receipt]",
    );
  });

  it("adds evidence to a hotspot that already reveals another evidence item", () => {
    const result = updateEvidenceAssignmentInMarkdown(markdown, {
      evidenceId: "receipt",
      hotspotId: "folder",
    });

    expect(result.contents).toContain(
      "- **Reveals:** [evidence:memo, evidence:receipt]",
    );
  });

  it("detaches evidence and removes an empty Reveals line", () => {
    const result = updateEvidenceAssignmentInMarkdown(markdown, {
      evidenceId: "memo",
      hotspotId: null,
    });

    expect(result.contents).toContain(
      "### Hotspot: Folder {#folder}\n- **Description:** A folder.\n",
    );
    expect(result.contents).not.toContain("- **Reveals:** [evidence:memo]");
  });

  it("throws when the target hotspot does not exist", () => {
    expect(() =>
      updateEvidenceAssignmentInMarkdown(markdown, {
        evidenceId: "receipt",
        hotspotId: "missing",
      }),
    ).toThrow('Hotspot "missing" was not found');
  });
});

describe("evidenceAssignmentsForScene", () => {
  it("lists current hotspot assignments for every evidence manifest item", () => {
    expect(evidenceAssignmentsForScene(scene)).toEqual([
      {
        evidence: scene.evidenceManifest[0],
        hotspots: [
          {
            id: "desk",
            label: "Desk",
            sublocationId: "office",
            sublocationLabel: "Office",
          },
        ],
      },
      {
        evidence: scene.evidenceManifest[1],
        hotspots: [
          {
            id: "folder",
            label: "Folder",
            sublocationId: "office",
            sublocationLabel: "Office",
          },
        ],
      },
    ]);
  });
});

describe("moveEvidenceRevealInScene", () => {
  it("updates scene reveal arrays without dropping other reveal targets", () => {
    const updated = moveEvidenceRevealInScene(scene, "receipt", "folder");
    const desk = updated.sublocations[0].hotspots[0];
    const folder = updated.sublocations[0].hotspots[2];

    expect(desk.reveals).toEqual([
      { kind: "topic", characterId: "witness", topicId: "rain" },
    ]);
    expect(folder.reveals).toEqual([
      { kind: "evidence", id: "memo" },
      { kind: "evidence", id: "receipt" },
    ]);
  });
});

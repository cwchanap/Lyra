import { describe, expect, it } from "vitest";
import {
  carrierOptionsForEvidence,
  evidenceAssignmentsForScene,
  generatedStandaloneHotspotId,
  isGeneratedStandaloneHotspotId,
} from "./evidence-assignment";
import type { InvestigationSceneJson } from "./layout-types";

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

const kuroseCharacter = {
  id: "kurose",
  name: "黑瀨徹",
  role: "刑警",
  bio: "提供程序內可公開的資訊。",
  layout: null,
  topics: [
    {
      id: "forensic_brief",
      label: "法醫初步簡報",
      status: "unlocked",
      reveals: [],
      topicDialogue: [],
    },
  ],
};

const sourceSublocationScene = {
  type: "investigation",
  id: "investigation_scene_source_sublocations",
  title: "Source sublocation test",
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
          id: "front-door",
          label: "Front door",
          description: "The front door.",
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
          id: "access-panel",
          label: "Access panel",
          description: "A maintenance panel.",
          evidenceSource: "visible",
          sceneSourcePrompt: null,
          reveals: [{ kind: "evidence", id: "log" }],
          inspectDialogue: [],
          layout: null,
        },
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
        {
          id: "plain-door",
          label: "Plain door",
          description: "A door without evidence-source metadata.",
          evidenceSource: null,
          sceneSourcePrompt: null,
          reveals: [],
          inspectDialogue: [],
          layout: null,
        },
      ],
      characters: [kuroseCharacter],
    },
  ],
  evidenceManifest: [
    {
      id: "log",
      name: "Access log",
      description: "A corridor access log.",
      imageAssetId: null,
      sourceSublocationId: "corridor",
    },
  ],
} satisfies InvestigationSceneJson;

describe("carrierOptionsForEvidence", () => {
  it("lists evidence-capable hotspots and character topics in the evidence source sublocation", () => {
    // The panel is read-only, so no "Create standalone hotspot" option is
    // emitted — only existing carriers that can be labeled.
    expect(
      carrierOptionsForEvidence(
        sourceSublocationScene,
        sourceSublocationScene.evidenceManifest[0],
      ),
    ).toEqual([
      {
        label: "Corridor / Access panel",
        carrier: {
          kind: "hotspot",
          sublocationId: "corridor",
          hotspotId: "access-panel",
        },
      },
      {
        label: "Corridor / 黑瀨徹 / 法醫初步簡報",
        carrier: {
          kind: "topic",
          sublocationId: "corridor",
          characterId: "kurose",
          topicId: "forensic_brief",
        },
      },
    ]);
  });

  it("does not list non-source sublocation targets", () => {
    const labels = carrierOptionsForEvidence(
      sourceSublocationScene,
      sourceSublocationScene.evidenceManifest[0],
    ).map((option) => option.label);

    expect(labels).not.toContain("Front / Front door");
  });

  it("does not list generated standalone hotspots as normal carrier targets and emits no create option", () => {
    const labels = carrierOptionsForEvidence(
      sourceSublocationScene,
      sourceSublocationScene.evidenceManifest[0],
    ).map((option) => option.label);

    expect(labels).not.toContain("Corridor / Access log generated source");
    // The read-only panel offers no standalone creation affordance.
    expect(labels).not.toContain("Create standalone hotspot");
  });
});

describe("generatedStandaloneHotspotId", () => {
  it("uses the evidence_source id convention", () => {
    expect(generatedStandaloneHotspotId("forensic_prelim_range")).toBe(
      "evidence_source_forensic_prelim_range",
    );
  });

  it("generator output satisfies the detector (prefix contract cannot drift)", () => {
    // If someone changes the prefix in the generator but not the detector (or
    // vice versa) this round-trip breaks. Locks the single-constant contract.
    for (const evidenceId of ["log", "forensic_prelim_range", "new_record"]) {
      expect(
        isGeneratedStandaloneHotspotId(
          generatedStandaloneHotspotId(evidenceId),
        ),
      ).toBe(true);
    }

    // Non-generated hotspot ids and degenerate forms are not mistaken for
    // standalone sources.
    expect(isGeneratedStandaloneHotspotId("desk")).toBe(false);
    expect(isGeneratedStandaloneHotspotId("evidence_source_")).toBe(false);
    expect(isGeneratedStandaloneHotspotId("x_evidence_source_log")).toBe(false);
    expect(isGeneratedStandaloneHotspotId("EVIDENCE_source_log")).toBe(false);
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

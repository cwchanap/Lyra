import type { InvestigationSceneJson, RevealTarget } from "./layout-types";

export type EvidenceAssignment = {
  evidenceId: string;
  hotspotId: string | null;
};

export type EvidenceAssignmentResult = {
  contents: string;
  changed: boolean;
};

export type EvidenceHotspotSummary = {
  id: string;
  label: string;
  sublocationId: string;
  sublocationLabel: string;
};

export type SceneEvidenceAssignment = {
  evidence: InvestigationSceneJson["evidenceManifest"][number];
  hotspots: EvidenceHotspotSummary[];
};

type EvidenceManifestItem = InvestigationSceneJson["evidenceManifest"][number];

const hotspotHeadingPattern = /^### Hotspot: .+ \{#([^}]+)\}$/;
const revealsPattern = /^- \*\*Reveals:\*\* \[(.*)\]$/;

type HotspotBlock = {
  id: string;
  start: number;
  end: number;
  revealsLine: number | null;
};

export function updateEvidenceAssignmentInMarkdown(
  contents: string,
  assignment: EvidenceAssignment,
): EvidenceAssignmentResult {
  const hadFinalNewline = contents.endsWith("\n");
  const lines = contents.split("\n");
  if (hadFinalNewline) lines.pop();

  const blocks = findHotspotBlocks(lines);
  const targetBlock = assignment.hotspotId
    ? blocks.find((block) => block.id === assignment.hotspotId)
    : null;

  if (assignment.hotspotId && !targetBlock) {
    throw new Error(`Hotspot "${assignment.hotspotId}" was not found`);
  }

  let changed = false;
  const revealToken = `evidence:${assignment.evidenceId}`;

  for (const block of blocks) {
    if (block.revealsLine === null) continue;
    const line = lines[block.revealsLine];
    const items = parseReveals(line);
    if (!items.includes(revealToken)) continue;

    const nextItems = items.filter((item) => item !== revealToken);
    if (nextItems.length === 0) {
      lines.splice(block.revealsLine, 1);
      return updateEvidenceAssignmentInMarkdown(
        joinLines(lines, hadFinalNewline),
        assignment,
      );
    }

    lines[block.revealsLine] = formatReveals(nextItems);
    changed = true;
  }

  if (targetBlock) {
    const refreshedBlocks = findHotspotBlocks(lines);
    const refreshedTarget = refreshedBlocks.find(
      (block) => block.id === assignment.hotspotId,
    );
    if (!refreshedTarget) {
      throw new Error(`Hotspot "${assignment.hotspotId}" was not found`);
    }

    if (refreshedTarget.revealsLine !== null) {
      const items = parseReveals(lines[refreshedTarget.revealsLine]);
      if (!items.includes(revealToken)) {
        lines[refreshedTarget.revealsLine] = formatReveals([
          ...items,
          revealToken,
        ]);
        changed = true;
      }
    } else {
      lines.splice(
        findRevealInsertIndex(lines, refreshedTarget),
        0,
        formatReveals([revealToken]),
      );
      changed = true;
    }
  }

  const nextContents = joinLines(lines, hadFinalNewline);
  return {
    contents: nextContents,
    changed: changed || nextContents !== contents,
  };
}

export function hotspotOptionsForEvidence(
  scene: InvestigationSceneJson,
  evidence: EvidenceManifestItem,
): EvidenceHotspotSummary[] {
  return scene.sublocations.flatMap((sublocation) => {
    if (
      evidence.sourceSublocationId &&
      sublocation.id !== evidence.sourceSublocationId
    ) {
      return [];
    }

    return sublocation.hotspots
      .filter((hotspot) => hotspot.evidenceSource !== null)
      .map((hotspot) => ({
        id: hotspot.id,
        label: hotspot.label,
        sublocationId: sublocation.id,
        sublocationLabel: sublocation.label,
      }));
  });
}

export function evidenceAssignmentsForScene(
  scene: InvestigationSceneJson,
): SceneEvidenceAssignment[] {
  return scene.evidenceManifest.map((evidence) => ({
    evidence,
    hotspots: scene.sublocations.flatMap((sublocation) =>
      sublocation.hotspots
        .filter((hotspot) =>
          hotspot.reveals.some(
            (reveal) => reveal.kind === "evidence" && reveal.id === evidence.id,
          ),
        )
        .map((hotspot) => ({
          id: hotspot.id,
          label: hotspot.label,
          sublocationId: sublocation.id,
          sublocationLabel: sublocation.label,
        })),
    ),
  }));
}

export function moveEvidenceRevealInScene(
  scene: InvestigationSceneJson,
  evidenceId: string,
  hotspotId: string | null,
): InvestigationSceneJson {
  return {
    ...scene,
    sublocations: scene.sublocations.map((sublocation) => ({
      ...sublocation,
      hotspots: sublocation.hotspots.map((hotspot) => {
        const reveals = hotspot.reveals.filter(
          (reveal) => !(reveal.kind === "evidence" && reveal.id === evidenceId),
        );
        if (hotspot.id === hotspotId) {
          reveals.push({ kind: "evidence", id: evidenceId });
        }
        return {
          ...hotspot,
          reveals: reveals as RevealTarget[],
        };
      }),
    })),
  };
}

function findHotspotBlocks(lines: string[]): HotspotBlock[] {
  const blocks: HotspotBlock[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const headingMatch = lines[index].match(hotspotHeadingPattern);
    if (!headingMatch) continue;

    let end = lines.length;
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      if (lines[cursor].startsWith("### ") || lines[cursor].startsWith("## ")) {
        end = cursor;
        break;
      }
    }

    let revealsLine: number | null = null;
    for (let cursor = index + 1; cursor < end; cursor += 1) {
      if (revealsPattern.test(lines[cursor])) {
        revealsLine = cursor;
        break;
      }
    }

    blocks.push({
      id: headingMatch[1],
      start: index,
      end,
      revealsLine,
    });
  }

  return blocks;
}

function parseReveals(line: string): string[] {
  const match = line.match(revealsPattern);
  if (!match) return [];
  return match[1]
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function formatReveals(items: string[]): string {
  return `- **Reveals:** [${items.join(", ")}]`;
}

function findRevealInsertIndex(lines: string[], block: HotspotBlock): number {
  let insertIndex = block.start + 1;
  for (let cursor = block.start + 1; cursor < block.end; cursor += 1) {
    if (!lines[cursor].startsWith("- **")) break;
    insertIndex = cursor + 1;
  }
  return insertIndex;
}

function joinLines(lines: string[], hadFinalNewline: boolean): string {
  return `${lines.join("\n")}${hadFinalNewline ? "\n" : ""}`;
}

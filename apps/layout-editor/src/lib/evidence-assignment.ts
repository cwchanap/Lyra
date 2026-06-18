import type { InvestigationSceneJson, RevealTarget } from "./layout-types";

export type EvidenceAssignment = {
  evidenceId: string;
  hotspotId: string | null;
};

export type EvidenceAssignmentResult = {
  contents: string;
  changed: boolean;
};

export type EvidenceCarrierAssignment = {
  evidenceId: string;
  evidenceName: string;
  sourceSublocationId: string;
  carrier: EvidenceCarrier | null;
};

export type EvidenceCarrierAssignmentResult = {
  contents: string;
  changed: boolean;
  createdStandaloneHotspotId: string | null;
  removedStandaloneHotspotIds: string[];
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

export type EvidenceCarrier =
  | { kind: "hotspot"; sublocationId: string; hotspotId: string }
  | {
      kind: "topic";
      sublocationId: string;
      characterId: string;
      topicId: string;
    }
  | { kind: "standalone_hotspot"; sublocationId: string };

export type EvidenceCarrierOption = {
  label: string;
  carrier: EvidenceCarrier;
};

type EvidenceManifestItem = InvestigationSceneJson["evidenceManifest"][number];

const hotspotHeadingPattern = /^### Hotspot: .+ \{#([^}]+)\}$/;
const sublocationHeadingPattern = /^## Sub-?location: .+ \{#([^}]+)\}$/;
const characterHeadingPattern = /^### Character: .+ \{#([^}]+)\}$/;
const topicHeadingPattern = /^#### Topic: .+ \{#([^}]+)\}$/;
const revealsPattern = /^- \*\*Reveals:\*\* \[(.*)\]$/;

type HotspotBlock = {
  id: string;
  start: number;
  end: number;
  revealsLine: number | null;
};

type TopicBlock = {
  characterId: string;
  id: string;
  start: number;
  end: number;
  revealsLine: number | null;
};

type SublocationBlock = {
  id: string;
  start: number;
  end: number;
};

type RevealBlock = {
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
    const items = parseReveals(lines[block.revealsLine]);
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
    const refreshedTarget = findHotspotBlocks(lines).find(
      (block) => block.id === assignment.hotspotId,
    );
    if (!refreshedTarget) {
      throw new Error(`Hotspot "${assignment.hotspotId}" was not found`);
    }

    changed = addRevealToBlock(lines, refreshedTarget, revealToken) || changed;
  }

  const nextContents = joinLines(lines, hadFinalNewline);
  return {
    contents: nextContents,
    changed: changed || nextContents !== contents,
  };
}

export function updateEvidenceCarrierInMarkdown(
  contents: string,
  assignment: EvidenceCarrierAssignment,
): EvidenceCarrierAssignmentResult {
  const hadFinalNewline = contents.endsWith("\n");
  const lines = contents.split("\n");
  if (hadFinalNewline) lines.pop();

  let changed = false;
  const revealToken = `evidence:${assignment.evidenceId}`;
  const removedStandaloneHotspotIds: string[] = [];

  const blocksWithReveals = [
    ...findHotspotBlocks(lines),
    ...findTopicBlocks(lines),
  ]
    .filter(
      (block): block is (HotspotBlock | TopicBlock) & { revealsLine: number } =>
        block.revealsLine !== null,
    )
    .sort((left, right) => right.revealsLine - left.revealsLine);

  for (const block of blocksWithReveals) {
    const items = parseReveals(lines[block.revealsLine]);
    if (!items.includes(revealToken)) continue;
    if (
      assignment.carrier?.kind === "standalone_hotspot" &&
      !isTopicBlock(block) &&
      block.id === generatedStandaloneHotspotId(assignment.evidenceId)
    ) {
      continue;
    }

    const nextItems = items.filter((item) => item !== revealToken);
    if (nextItems.length === 0) {
      lines.splice(block.revealsLine, 1);
      changed = true;
    } else {
      lines[block.revealsLine] = formatReveals(nextItems);
      changed = true;
    }
  }

  for (const block of findHotspotBlocks(lines).slice().reverse()) {
    if (!isGeneratedStandaloneHotspotId(block.id)) continue;
    if (hotspotHasEvidenceReveal(lines, block)) continue;
    lines.splice(block.start, block.end - block.start);
    removedStandaloneHotspotIds.push(block.id);
    changed = true;
  }

  let createdStandaloneHotspotId: string | null = null;
  if (assignment.carrier?.kind === "hotspot") {
    changed =
      addRevealToHotspot(lines, assignment.carrier.hotspotId, revealToken) ||
      changed;
  } else if (assignment.carrier?.kind === "topic") {
    changed =
      addRevealToTopic(
        lines,
        assignment.carrier.characterId,
        assignment.carrier.topicId,
        revealToken,
      ) || changed;
  } else if (assignment.carrier?.kind === "standalone_hotspot") {
    const standaloneHotspotId = generatedStandaloneHotspotId(
      assignment.evidenceId,
    );
    if (!hotspotHasRevealToken(lines, standaloneHotspotId, revealToken)) {
      createdStandaloneHotspotId = standaloneHotspotId;
      insertStandaloneHotspot(lines, {
        sublocationId:
          assignment.carrier.sublocationId || assignment.sourceSublocationId,
        hotspotId: createdStandaloneHotspotId,
        evidenceName: assignment.evidenceName,
        revealToken,
      });
      changed = true;
    }
  }

  const nextContents = joinLines(lines, hadFinalNewline);
  return {
    contents: nextContents,
    changed: changed || nextContents !== contents,
    createdStandaloneHotspotId,
    removedStandaloneHotspotIds: removedStandaloneHotspotIds.reverse(),
  };
}

function addRevealToHotspot(
  lines: string[],
  hotspotId: string,
  revealToken: string,
): boolean {
  const targetBlock = findHotspotBlocks(lines).find(
    (block) => block.id === hotspotId,
  );
  if (!targetBlock) {
    throw new Error(`Hotspot "${hotspotId}" was not found`);
  }
  return addRevealToBlock(lines, targetBlock, revealToken);
}

function addRevealToTopic(
  lines: string[],
  characterId: string,
  topicId: string,
  revealToken: string,
): boolean {
  const targetBlock = findTopicBlocks(lines).find(
    (block) => block.characterId === characterId && block.id === topicId,
  );
  if (!targetBlock) {
    throw new Error(`Topic "${characterId}/${topicId}" was not found`);
  }
  return addRevealToBlock(lines, targetBlock, revealToken);
}

function addRevealToBlock(
  lines: string[],
  block: RevealBlock,
  revealToken: string,
): boolean {
  if (block.revealsLine !== null) {
    const items = parseReveals(lines[block.revealsLine]);
    if (items.includes(revealToken)) return false;
    lines[block.revealsLine] = formatReveals([...items, revealToken]);
    return true;
  }

  lines.splice(
    findRevealInsertIndex(lines, block),
    0,
    formatReveals([revealToken]),
  );
  return true;
}

function insertStandaloneHotspot(
  lines: string[],
  options: {
    sublocationId: string;
    hotspotId: string;
    evidenceName: string;
    revealToken: string;
  },
): void {
  const sublocation = findSublocationBlocks(lines).find(
    (block) => block.id === options.sublocationId,
  );
  if (!sublocation) {
    throw new Error(`Sublocation "${options.sublocationId}" was not found`);
  }

  let insertIndex = sublocation.end;
  for (
    let cursor = sublocation.start + 1;
    cursor < sublocation.end;
    cursor += 1
  ) {
    if (characterHeadingPattern.test(lines[cursor])) {
      insertIndex = cursor;
      break;
    }
  }

  const hotspotLines = [
    `### Hotspot: ${options.evidenceName} {#${options.hotspotId}}`,
    "- **Description:** 編輯器產生的隱藏證據來源。",
    "- **Evidence Source:** hidden",
    "- **Scene Source Prompt:** Hidden local evidence source generated by the layout editor; the collected evidence is not visibly readable in the background.",
    formatReveals([options.revealToken]),
  ];

  if (insertIndex > 0 && lines[insertIndex - 1] !== "") {
    hotspotLines.unshift("");
  }
  if (insertIndex < lines.length && lines[insertIndex] !== "") {
    hotspotLines.push("");
  }

  lines.splice(insertIndex, 0, ...hotspotLines);
}

function isGeneratedStandaloneHotspotId(id: string): boolean {
  return /^evidence_source_[a-z0-9_]+$/.test(id);
}

function hotspotHasEvidenceReveal(
  lines: string[],
  block: HotspotBlock,
): boolean {
  if (block.revealsLine === null) return false;
  return parseReveals(lines[block.revealsLine]).some((item) =>
    item.startsWith("evidence:"),
  );
}

function hotspotHasRevealToken(
  lines: string[],
  hotspotId: string,
  revealToken: string,
): boolean {
  const block = findHotspotBlocks(lines).find(
    (hotspot) => hotspot.id === hotspotId,
  );
  if (block?.revealsLine === undefined || block.revealsLine === null) {
    return false;
  }
  return parseReveals(lines[block.revealsLine]).includes(revealToken);
}

function isTopicBlock(block: HotspotBlock | TopicBlock): block is TopicBlock {
  return "characterId" in block;
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

export function generatedStandaloneHotspotId(evidenceId: string): string {
  return `evidence_source_${evidenceId}`;
}

export function carrierOptionsForEvidence(
  scene: InvestigationSceneJson,
  evidence: EvidenceManifestItem,
): EvidenceCarrierOption[] {
  const options: EvidenceCarrierOption[] = [];

  for (const sublocation of scene.sublocations) {
    if (
      evidence.sourceSublocationId &&
      sublocation.id !== evidence.sourceSublocationId
    ) {
      continue;
    }

    for (const hotspot of sublocation.hotspots) {
      if (hotspot.evidenceSource === null) continue;
      options.push({
        label: `${sublocation.label} / ${hotspot.label}`,
        carrier: {
          kind: "hotspot",
          sublocationId: sublocation.id,
          hotspotId: hotspot.id,
        },
      });
    }

    for (const character of sublocation.characters) {
      for (const topic of character.topics) {
        options.push({
          label: `${sublocation.label} / ${character.name} / ${topic.label}`,
          carrier: {
            kind: "topic",
            sublocationId: sublocation.id,
            characterId: character.id,
            topicId: topic.id,
          },
        });
      }
    }

    options.push({
      label: "Create standalone hotspot",
      carrier: {
        kind: "standalone_hotspot",
        sublocationId: sublocation.id,
      },
    });
  }

  return options;
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

function findTopicBlocks(lines: string[]): TopicBlock[] {
  const blocks: TopicBlock[] = [];
  let currentCharacterId: string | null = null;

  for (let index = 0; index < lines.length; index += 1) {
    const characterMatch = lines[index].match(characterHeadingPattern);
    if (characterMatch) {
      currentCharacterId = characterMatch[1];
      continue;
    }

    if (lines[index].startsWith("## ")) {
      currentCharacterId = null;
    }

    const headingMatch = lines[index].match(topicHeadingPattern);
    if (!headingMatch || currentCharacterId === null) continue;

    let end = lines.length;
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      if (
        lines[cursor].startsWith("#### ") ||
        lines[cursor].startsWith("### ") ||
        lines[cursor].startsWith("## ")
      ) {
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
      characterId: currentCharacterId,
      id: headingMatch[1],
      start: index,
      end,
      revealsLine,
    });
  }

  return blocks;
}

function findSublocationBlocks(lines: string[]): SublocationBlock[] {
  const blocks: SublocationBlock[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const headingMatch = lines[index].match(sublocationHeadingPattern);
    if (!headingMatch) continue;

    let end = lines.length;
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      if (lines[cursor].startsWith("## ")) {
        end = cursor;
        break;
      }
    }

    blocks.push({
      id: headingMatch[1],
      start: index,
      end,
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

function findRevealInsertIndex(lines: string[], block: RevealBlock): number {
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

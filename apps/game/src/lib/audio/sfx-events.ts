import type { GameStateView, SceneView } from "$lib/state/types";

export type GameplaySfxEvent =
  | "ui:new-game"
  | "ui:reset"
  | "ui:menu-confirm"
  | "ui:action-unavailable"
  | "investigation:hotspot-inspected"
  | "investigation:topic-discussed"
  | "investigation:sublocation-entered"
  | "investigation:evidence-acquired"
  | "investigation:statement-acquired"
  | "interrogation:phase-entered"
  | "interrogation:question-answered"
  | "interrogation:testimony-pressed"
  | "interrogation:wrong-present"
  | "interrogation:successful-contradiction"
  | "story:anonymous-message"
  | "story:rice-ball-bag"
  | "story:coffee-backflush"
  | "story:usb-insert";

// Mapping policy for v1. SFX_ASSETS below has FIVE entries, partitioned as:
//   - four Chapter 1 story-beat SFX (anonymous-message, rice-ball-bag,
//     coffee-backflush, usb-insert). Three of these (rice-ball-bag,
//     coffee-backflush, usb-insert) couple a cue to a specific authored
//     dialogue line via STORY_BEAT_SFX_TRIGGERS; anonymous-message instead
//     couples by scene id (enteredChapterOneAnonymousMessage), since its cue
//     marks entering a scene rather than a specific line; plus
//   - one generic UI tick (ui:menu-confirm) reused across confirm actions.
//
// Every other event in the GameplaySfxEvent union currently resolves to NO
// SOUND, but for two different reasons — keep them straight:
//   1. "No dispatch path yet." Events like ui:new-game / ui:reset /
//      investigation:* / interrogation:phase-entered / question-answered /
//      testimony-pressed ARE emitted by inferGameplaySfxEvents, but they have
//      no Chapter 1 asset so assetIdForGameplaySfxEvent returns null and
//      playGameplaySfxEvent short-circuits. These are intentionally silent
//      generic feedback for v1.
//   2. "Emitted would imply functionality that does not exist." The three
//      reserved events — "ui:action-unavailable", "interrogation:wrong-present",
//      and "interrogation:successful-contradiction" — are part of the spec's
//      first-pass event families but have no Chapter 1 SFX asset AND their
//      dispatch signals are not yet wired ("action-unavailable" needs a
//      UI-level unavailable-action signal the current disabled-prop gating
//      does not produce; the two interrogation outcomes need Rust
//      contradiction-result signals). Do NOT emit them from
//      inferGameplaySfxEvents until they map to a real asset — emitting
//      unmapped events would only imply functionality that produces silence.
// The design spec explicitly permits an event to resolve to NO SOUND.

export type GameplayCommandName =
  | "start_game"
  | "reset_game"
  | "advance_dialogue"
  | "inspect_hotspot"
  | "interview_topic"
  | "enter_sublocation"
  | "reexamine_evidence"
  | "reexamine_statement"
  | "answer_interrogation_question"
  | "press_testimony_statement"
  | "present_testimony_item";

const SFX_ASSETS: Partial<Record<GameplaySfxEvent, string>> = {
  "ui:menu-confirm": "audio.sfx.sfx_dialogue_proceed_tick",
  "story:anonymous-message": "audio.sfx.sfx_anonymous_message_buzz",
  "story:rice-ball-bag": "audio.sfx.sfx_rice_ball_bag_crinkle",
  "story:coffee-backflush": "audio.sfx.sfx_coffee_machine_backflush",
  "story:usb-insert": "audio.sfx.sfx_usb_insert_chime",
};

export function assetIdForGameplaySfxEvent(
  event: GameplaySfxEvent,
): string | null {
  return SFX_ASSETS[event] ?? null;
}

// All asset IDs that currently map to a real SFX asset. Used to warm the
// low-latency WebAudio decode cache on the first user gesture (see
// preloadKnownGameplaySfx in gameplay-audio-runtime) so the first occurrence
// of any mapped SFX hits the buffer cache instead of falling back to the
// higher-latency HTMLAudioElement path while the decode races.
export function mappedGameplaySfxAssetIds(): string[] {
  return Object.values(SFX_ASSETS);
}

// v1 story-beat SFX couple to specific authored Chapter 1 dialogue lines by
// substring. This is intentional for the materially meaningful Chapter 1 SFX
// but fragile: if a writer edits one of these lines, the cue silently stops
// firing. This table is the single source of truth shared by the runtime
// matcher (enteredStoryBeatSfx) and the authored-content drift guard in
// sfx-events.test.ts, so a substring change here is checked against the
// authored Markdown in CI. A compiler-validated tag is the future-proof
// path; for v1 the substring match is an accepted, documented trade-off.
export type StoryBeatSfxTrigger = {
  event: GameplaySfxEvent;
  chapterId: string;
  sceneKind: SceneView["kind"];
  sceneId: string;
  dialogueKind: "action" | "line";
  substring: string;
};

export const STORY_BEAT_SFX_TRIGGERS: readonly StoryBeatSfxTrigger[] = [
  {
    event: "story:usb-insert",
    chapterId: "chapter_1",
    sceneKind: "linear",
    sceneId: "scene_11",
    dialogueKind: "action",
    substring: "隨身碟插上筆電",
  },
  {
    event: "story:rice-ball-bag",
    chapterId: "chapter_1",
    sceneKind: "interrogation",
    sceneId: "interrogation_scene_10",
    dialogueKind: "action",
    substring: "飯糰袋",
  },
  {
    event: "story:coffee-backflush",
    chapterId: "chapter_1",
    sceneKind: "investigation",
    sceneId: "investigation_scene_7",
    dialogueKind: "line",
    substring: "那台機器 backflush 的時候",
  },
];

export function inferGameplaySfxEvents(
  previous: GameStateView | null,
  next: GameStateView | null,
  command: GameplayCommandName,
): GameplaySfxEvent[] {
  if (!next) return [];

  const events: GameplaySfxEvent[] = [];
  if (command === "start_game") events.push("ui:new-game");
  if (command === "reset_game") events.push("ui:reset");
  if (command === "inspect_hotspot")
    events.push("investigation:hotspot-inspected");
  if (command === "interview_topic")
    events.push("investigation:topic-discussed");
  if (command === "enter_sublocation")
    events.push("investigation:sublocation-entered");
  if (command === "answer_interrogation_question")
    events.push("interrogation:question-answered");
  if (command === "press_testimony_statement")
    events.push("interrogation:testimony-pressed");

  if (inventoryEvidenceCount(next) > inventoryEvidenceCount(previous)) {
    events.push("investigation:evidence-acquired");
  }
  if (inventoryStatementCount(next) > inventoryStatementCount(previous)) {
    events.push("investigation:statement-acquired");
  }
  if (enteredPhase(previous, next)) events.push("interrogation:phase-entered");
  if (enteredChapterOneAnonymousMessage(previous, next)) {
    events.push("story:anonymous-message");
  }
  for (const trigger of STORY_BEAT_SFX_TRIGGERS) {
    if (enteredStoryBeatSfx(previous, next, trigger)) {
      events.push(trigger.event);
    }
  }

  return dedupe(events);
}

function inventoryEvidenceCount(state: GameStateView | null): number {
  return state?.inventory.evidence.length ?? 0;
}

function inventoryStatementCount(state: GameStateView | null): number {
  return state?.inventory.statements.length ?? 0;
}

function enteredPhase(
  previous: GameStateView | null,
  next: GameStateView,
): boolean {
  if (next.mode.type !== "interrogation") return false;
  const previousPhase =
    previous?.mode.type === "interrogation" ? previous.mode.phaseId : null;
  return previousPhase !== next.mode.phaseId;
}

function enteredChapterOneAnonymousMessage(
  previous: GameStateView | null,
  next: GameStateView,
): boolean {
  return (
    next.chapter.id === "chapter_1" &&
    next.scene.kind === "investigation" &&
    next.scene.id === "investigation_scene_7" &&
    previous?.scene.id !== next.scene.id
  );
}

function enteredStoryBeatSfx(
  previous: GameStateView | null,
  next: GameStateView,
  trigger: StoryBeatSfxTrigger,
): boolean {
  // Gated by chapter id + scene kind + scene id + dialogue kind to narrow the
  // blast radius of the substring match (see STORY_BEAT_SFX_TRIGGERS).
  if (next.chapter.id !== trigger.chapterId) return false;
  if (next.scene.kind !== trigger.sceneKind) return false;
  if (next.scene.id !== trigger.sceneId) return false;
  return enteredDialogueBeat(
    previous,
    next,
    (kind, text) =>
      kind === trigger.dialogueKind && text.includes(trigger.substring),
  );
}

function enteredDialogueBeat(
  previous: GameStateView | null,
  next: GameStateView,
  matches: (kind: string, text: string) => boolean,
): boolean {
  if (next.mode.type !== "dialogue") return false;
  if (!matches(next.mode.current.kind, next.mode.current.text)) return false;
  if (previous?.mode.type !== "dialogue") return true;

  return (
    previous.mode.queueToken.sceneId !== next.mode.queueToken.sceneId ||
    previous.mode.queueToken.queueGen !== next.mode.queueToken.queueGen ||
    previous.mode.queueToken.cursor !== next.mode.queueToken.cursor
  );
}

function dedupe(events: GameplaySfxEvent[]): GameplaySfxEvent[] {
  return Array.from(new Set(events));
}

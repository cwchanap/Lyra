import type { GameStateView } from "$lib/state/types";

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
  if (enteredChapterOneUsbBeat(previous, next)) events.push("story:usb-insert");
  if (enteredChapterOneRiceBallBeat(previous, next)) {
    events.push("story:rice-ball-bag");
  }
  if (enteredChapterOneCoffeeBackflushBeat(previous, next)) {
    events.push("story:coffee-backflush");
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

function enteredChapterOneUsbBeat(
  previous: GameStateView | null,
  next: GameStateView,
): boolean {
  if (next.chapter.id !== "chapter_1") return false;
  if (next.scene.kind !== "linear" || next.scene.id !== "scene_11")
    return false;
  return enteredDialogueBeat(
    previous,
    next,
    (kind, text) => kind === "action" && text.includes("隨身碟插上筆電"),
  );
}

function enteredChapterOneRiceBallBeat(
  previous: GameStateView | null,
  next: GameStateView,
): boolean {
  return (
    next.chapter.id === "chapter_1" &&
    next.scene.kind === "interrogation" &&
    next.scene.id === "interrogation_scene_10" &&
    enteredDialogueBeat(
      previous,
      next,
      (kind, text) => kind === "action" && text.includes("飯糰袋"),
    )
  );
}

function enteredChapterOneCoffeeBackflushBeat(
  previous: GameStateView | null,
  next: GameStateView,
): boolean {
  return (
    next.chapter.id === "chapter_1" &&
    next.scene.kind === "investigation" &&
    next.scene.id === "investigation_scene_7" &&
    enteredDialogueBeat(
      previous,
      next,
      (kind, text) =>
        kind === "line" && text.includes("那台機器 backflush 的時候"),
    )
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

import type { EvidenceRecord, GameStateView, StatementRecord } from "./types";

export type AcquisitionNotification =
  | {
      key: string;
      kind: "evidence";
      record: EvidenceRecord;
    }
  | {
      key: string;
      kind: "statement";
      record: StatementRecord;
    };

export function inferAcquisitionNotifications(
  previous: GameStateView | null,
  next: GameStateView,
): AcquisitionNotification[] {
  if (!previous) return [];

  const notifications: AcquisitionNotification[] = [];
  const knownEvidenceIds = new Set(
    previous.inventory.evidence.map((record) => record.id),
  );
  const knownStatementIds = new Set(
    previous.inventory.statements.map((record) => record.id),
  );

  for (const record of next.inventory.evidence) {
    if (knownEvidenceIds.has(record.id)) continue;
    knownEvidenceIds.add(record.id);
    notifications.push({
      key: `evidence:${record.id}`,
      kind: "evidence",
      record,
    });
  }

  for (const record of next.inventory.statements) {
    if (knownStatementIds.has(record.id)) continue;
    knownStatementIds.add(record.id);
    notifications.push({
      key: `statement:${record.id}`,
      kind: "statement",
      record,
    });
  }

  return notifications;
}

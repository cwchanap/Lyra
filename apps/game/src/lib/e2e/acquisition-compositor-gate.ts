/**
 * Scoped compositor-coverage bookkeeping for the HPA-831 inv3 gate
 * (final review). The journey arms a gate that scopes expectations by
 * recordId: each gated record's popup MUST arrive carrying its authored
 * imageAssetId and produce a successful screenshot-crop receipt before
 * the segment may leave inv3. Ungated records — including legitimate
 * null-imageAssetId ones — stay exempt: their popups keep the original
 * fast acknowledgement path.
 */

/** recordId -> the authored imageAssetId its popup must report. */
export type CompositorGateExpectations = ReadonlyMap<string, string>;

/**
 * The scoped expectation for one pending acquisition: a recordId named
 * by the gate must carry exactly its authored imageAssetId — a null or
 * different id returns the violation message so the caller fails loudly
 * instead of silently skipping the compositor proof. Ungated records
 * return null regardless of their asset id.
 */
export function gatedAcquisitionViolation(
  expectedAssetIds: CompositorGateExpectations | null,
  current: { id: string; recordId: string; imageAssetId: string | null },
): string | null {
  if (expectedAssetIds === null) return null;
  const expected = expectedAssetIds.get(current.recordId);
  if (expected === undefined) return null;
  if (current.imageAssetId === expected) return null;
  return (
    `acquisition ${current.id}: gated record ${current.recordId} reported ` +
    `imageAssetId ${JSON.stringify(current.imageAssetId)}, expected ` +
    `${expected} — the compositor proof cannot silently skip this popup`
  );
}

/**
 * recordIds the gate scoped that still lack a successful compositor-crop
 * receipt — the journey requires this list to be empty before leaving
 * the gated segment, so popup coverage can never disappear while the
 * journey stays green.
 */
export function missingCompositorReceipts(
  expectedAssetIds: CompositorGateExpectations,
  receipts: ReadonlyMap<string, unknown>,
): string[] {
  return [...expectedAssetIds.keys()].filter(
    (recordId) => !receipts.has(recordId),
  );
}

<script lang="ts">
  import {
    placeholderForMissingStoryAsset,
    placeholderForStoryAsset,
    resolveStoryAsset,
    type ResolvedStoryAsset,
  } from "$lib/assets/story-assets";
  import { recordKey } from "$lib/case-file/case-file-model";
  import { caseRecordProvenancePresentation } from "$lib/case-file/provenance-badges";
  import type { CaseFileKey, CaseFileRecordItem } from "$lib/case-file/types";
  import type {
    EvidenceRecord,
    InventoryTarget,
    StatementRecord,
  } from "$lib/state/types";

  let {
    item,
    reexamineEnabled,
    onReexamineEvidence,
    onReexamineStatement,
    onNavigate,
    disabled = false,
  }: {
    item: CaseFileRecordItem;
    reexamineEnabled: boolean;
    onReexamineEvidence: (id: string) => void;
    onReexamineStatement: (id: string) => void;
    onNavigate: (key: CaseFileKey) => void;
    disabled?: boolean;
  } = $props();

  let image = $state<ResolvedStoryAsset | null>(null);
  const evidence = $derived(isEvidenceRecord(item.record) ? item.record : null);
  const statement = $derived(
    /* v8 ignore next -- lazily evaluated: statement is only read when evidence is null */
    isEvidenceRecord(item.record) ? null : item.record,
  );
  const provenancePresentation = $derived(
    caseRecordProvenancePresentation(item.record),
  );
  const canReexamine = $derived(reexamineEnabled && !disabled);
  const reexamineAvailable = $derived(item.record.onReexamine !== null);

  $effect(() => {
    let cancelled = false;
    image = null;
    const imageAssetId = evidence?.imageAssetId ?? null;
    if (imageAssetId) {
      resolveStoryAsset(imageAssetId, "evidence")
        .then((asset) => {
          if (!cancelled) image = asset ?? placeholderForStoryAsset("evidence");
        })
        .catch(() => {
          if (!cancelled) {
            image = placeholderForMissingStoryAsset(imageAssetId, "evidence");
          }
        });
    }
    return () => {
      cancelled = true;
    };
  });

  function handleImageError() {
    if (image === null || image.placeholder) return;
    console.warn(
      `[CaseFileRecordDetail] Missing evidence asset: ${image.url} (id: ${item.target.id}, assetId: ${image.assetId})`,
    );
    image = placeholderForMissingStoryAsset(image.assetId, "evidence");
  }

  function reexamine() {
    /* v8 ignore next -- unreachable: reexamine button is disabled when !canReexamine */
    if (!canReexamine) return;
    if (evidence !== null) onReexamineEvidence(evidence.id);
    else if (statement !== null) onReexamineStatement(statement.id);
  }

  function navigate(target: InventoryTarget | null) {
    /* v8 ignore next -- unreachable: navigate is only called from rendered predecessor/successor buttons */
    if (target !== null) onNavigate(recordKey(target));
  }

  function isEvidenceRecord(
    record: EvidenceRecord | StatementRecord,
  ): record is EvidenceRecord {
    return "name" in record;
  }
</script>

<div
  id={`case-file-section-${item.section}`}
  role="tabpanel"
  aria-labelledby={`case-file-tab-${item.section}`}
>
  <h2 id="case-file-detail-heading" data-case-file-detail-heading tabindex="-1">
    {evidence !== null
      ? `證物：${evidence.name}`
      : `證詞：${statement?.speaker ?? ""}`}
  </h2>

  {#if image !== null}
    <img
      class="case-file-record-image"
      src={image.url}
      alt={evidence?.name ?? ""}
      aria-hidden={evidence === null ? "true" : undefined}
      onerror={handleImageError}
    />
  {/if}

  {#if evidence !== null}
    <p>{evidence.description}</p>
    <p>{evidence.details}</p>
  {:else}
    <p>{statement?.content ?? ""}</p>
  {/if}
  <p>
    取得於：{item.record.acquisitionContext.chapterTitle}・{item.record
      .acquisitionContext.sceneTitle}
  </p>

  {#if item.hasVisibleProvenance}
    <section aria-label="來源與狀態">
      <h3>來源與狀態</h3>
      {#if provenancePresentation.sourceKind}<p>
          來源類型：{provenancePresentation.sourceKind}
        </p>{/if}
      {#if provenancePresentation.representationLayer}<p>
          呈現層：{provenancePresentation.representationLayer}
        </p>{/if}
      {#if provenancePresentation.proceduralStatus}<p>
          程序狀態：{provenancePresentation.proceduralStatus}
        </p>{/if}
      {#if provenancePresentation.completeness}<p>
          完整度：{provenancePresentation.completeness}
        </p>{/if}
      {#if provenancePresentation.confidence}<p>
          可信度：{provenancePresentation.confidence}
        </p>{/if}
      {#if provenancePresentation.source}<p>
          來源：{provenancePresentation.source}
        </p>{/if}
      {#if provenancePresentation.sourceGroup}<p>
          來源群組：{provenancePresentation.sourceGroup}
        </p>{/if}
      {#if provenancePresentation.sourceGroupSummary}<p>
          {provenancePresentation.sourceGroupSummary}
        </p>{/if}
      {#if provenancePresentation.proofCapabilities}<p>
          可證明：{provenancePresentation.proofCapabilities}
        </p>{/if}
      {#if item.successor !== null}<p>已被後續紀錄取代</p>{/if}
    </section>
  {/if}

  {#if item.predecessor !== null || item.successor !== null}
    <nav aria-label="紀錄歷程">
      {#if item.predecessor !== null}
        <button
          type="button"
          {disabled}
          onclick={() => navigate(item.predecessor)}>查看前一項紀錄</button
        >
      {/if}
      {#if item.successor !== null}
        <button
          type="button"
          {disabled}
          onclick={() => navigate(item.successor)}>查看後續紀錄</button
        >
      {/if}
    </nav>
  {/if}

  {#if reexamineAvailable}
    {#if !reexamineEnabled}
      <p id="case-file-reexamine-note" class="reexamine-note">
        重新檢視僅可在調查或訊問期間使用。
      </p>
    {/if}
    <button
      type="button"
      disabled={!canReexamine}
      onclick={reexamine}
      aria-describedby={!reexamineEnabled
        ? "case-file-reexamine-note"
        : undefined}>重新檢視</button
    >
  {/if}
</div>

<style>
  .reexamine-note {
    margin: 0;
    color: var(--bone-faint);
    font-family: var(--serif-jp);
    font-size: 13px;
    font-style: italic;
  }
</style>

<script lang="ts">
  import {
    placeholderForMissingStoryAsset,
    placeholderForStoryAsset,
    resolveStoryAsset,
    type ResolvedStoryAsset,
  } from "$lib/assets/story-assets";
  import { recordKey } from "$lib/case-file/case-file-model";
  import {
    completenessLabels,
    confidenceLabels,
    proceduralStatusLabels,
    proofCapabilityLabels,
    representationLayerLabels,
    sourceKindLabels,
  } from "$lib/case-file/labels";
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
    isEvidenceRecord(item.record) ? null : item.record,
  );
  const sourceText = $derived(
    item.record.provenance.sourceLabel ??
      item.record.sourceGroup?.label ??
      null,
  );
  const provenance = $derived(item.record.provenance);
  const sourceKind = $derived(sourceKindLabels[provenance.sourceKind]);
  const representationLayer = $derived(
    representationLayerLabels[provenance.representationLayer],
  );
  const proceduralStatus = $derived(
    proceduralStatusLabels[provenance.proceduralStatus],
  );
  const completeness = $derived(completenessLabels[provenance.completeness]);
  const confidence = $derived(confidenceLabels[provenance.confidence]);
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
    if (!canReexamine) return;
    if (evidence !== null) onReexamineEvidence(evidence.id);
    else if (statement !== null) onReexamineStatement(statement.id);
  }

  function navigate(target: InventoryTarget | null) {
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
      {#if sourceKind !== null}<p>來源類型：{sourceKind}</p>{/if}
      {#if representationLayer !== null}<p>
          呈現層：{representationLayer}
        </p>{/if}
      {#if proceduralStatus !== null}<p>程序狀態：{proceduralStatus}</p>{/if}
      {#if completeness !== null}<p>完整度：{completeness}</p>{/if}
      {#if confidence !== null}<p>可信度：{confidence}</p>{/if}
      {#if sourceText !== null}<p>來源：{sourceText}</p>{/if}
      {#if item.record.sourceGroup !== null && provenance.sourceLabel !== null}
        <p>來源群組：{item.record.sourceGroup.label}</p>
      {/if}
      {#if item.record.sourceGroup !== null}
        <p>{item.record.sourceGroup.summary}</p>
      {/if}
      {#if provenance.proofCapabilities.length > 0}
        <p>
          可證明：{provenance.proofCapabilities
            .map((capability) => proofCapabilityLabels[capability])
            .join("、")}
        </p>
      {/if}
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

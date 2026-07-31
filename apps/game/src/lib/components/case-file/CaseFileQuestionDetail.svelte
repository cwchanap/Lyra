<script lang="ts">
  import type {
    CaseFileFactItem,
    CaseFileKey,
    CaseFileQuestionItem,
  } from "$lib/case-file/types";

  let {
    item,
    resolvedFact,
    onNavigate,
    disabled = false,
  }: {
    item: CaseFileQuestionItem;
    resolvedFact: CaseFileFactItem | null;
    onNavigate: (key: CaseFileKey) => void;
    disabled?: boolean;
  } = $props();
</script>

<div
  id="case-file-section-questions"
  role="tabpanel"
  aria-labelledby="case-file-tab-questions"
>
  <h2 id="case-file-detail-heading" data-case-file-detail-heading tabindex="-1">
    問題：{item.question.label}
  </h2>
  <p>{item.question.summary}</p>
  <p>狀態：{item.question.status === "open" ? "待解" : "已解決"}</p>
  {#if item.question.status === "resolved" && resolvedFact !== null}
    <button
      type="button"
      {disabled}
      onclick={() => onNavigate(resolvedFact.key)}
      >查看解答事實：{resolvedFact.fact.label}</button
    >
  {/if}
</div>

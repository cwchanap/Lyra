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
  }: {
    item: CaseFileQuestionItem;
    resolvedFact: CaseFileFactItem | null;
    onNavigate: (key: CaseFileKey) => void;
  } = $props();
</script>

<section
  id="case-file-section-questions"
  aria-labelledby="case-file-detail-heading"
>
  <h2 id="case-file-detail-heading" data-case-file-detail-heading tabindex="-1">
    問題：{item.question.label}
  </h2>
  <p>{item.question.summary}</p>
  <p>狀態：{item.question.status === "open" ? "待解" : "已解決"}</p>
  {#if item.question.status === "resolved" && resolvedFact !== null}
    <button type="button" onclick={() => onNavigate(resolvedFact.key)}
      >查看解答事實：{resolvedFact.fact.label}</button
    >
  {/if}
</section>

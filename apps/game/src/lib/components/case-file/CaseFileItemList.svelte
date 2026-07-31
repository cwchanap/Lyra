<script lang="ts">
  import type {
    CaseFileItem,
    CaseFileKey,
    CaseFileSection,
  } from "$lib/case-file/types";
  import { caseFileSectionLabels } from "$lib/case-file/labels";

  let {
    section,
    items,
    selectedKey,
    emptyText,
    disabled = false,
    onSelect,
  }: {
    section: CaseFileSection;
    items: CaseFileItem[];
    selectedKey: CaseFileKey | null;
    emptyText: string;
    disabled?: boolean;
    onSelect: (key: CaseFileKey) => void;
  } = $props();

  function labelFor(item: CaseFileItem): string {
    if ("record" in item) {
      return "name" in item.record ? item.record.name : item.record.speaker;
    }
    if ("fact" in item) return item.fact.label;
    if ("question" in item) return item.question.label;
    if ("objective" in item) return item.objective.label;
    return item.authorization.label;
  }
</script>

<section
  class="case-file-item-list"
  aria-label={`${caseFileSectionLabels[section]}清單`}
>
  {#if items.length === 0}
    <p>{emptyText}</p>
  {:else}
    <ul>
      {#each items as item (item.key)}
        <li>
          <button
            type="button"
            aria-current={item.key === selectedKey ? "true" : undefined}
            disabled={disabled && !("record" in item)}
            onclick={() => onSelect(item.key)}>{labelFor(item)}</button
          >
        </li>
      {/each}
    </ul>
  {/if}
</section>

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
      return "name" in item.record
        ? item.record.name
        : `${item.record.speaker} ${item.record.content}`;
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
            data-case-file-item-key={item.key}
            disabled={disabled && !("record" in item)}
            onclick={() => onSelect(item.key)}
          >
            {#if "record" in item && !("name" in item.record)}
              <span class="statement-speaker">{item.record.speaker}</span>
              <span class="statement-excerpt">{item.record.content}</span>
            {:else}
              {labelFor(item)}
            {/if}
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</section>

<style>
  button {
    width: 100%;
    text-align: left;
  }

  .statement-speaker,
  .statement-excerpt {
    display: block;
  }

  .statement-excerpt {
    margin-top: 0.25rem;
    color: var(--bone-dim);
    font-size: 0.88em;
    line-height: 1.35;
    display: -webkit-box;
    overflow: hidden;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
  }
</style>

<script lang="ts">
  import { tick } from "svelte";
  import { caseFileSectionLabels } from "$lib/case-file/labels";
  import type { CaseFileSection } from "$lib/case-file/types";

  const sections: CaseFileSection[] = [
    "objective",
    "evidence",
    "statements",
    "facts",
    "questions",
    "authorizations",
  ];

  let {
    section,
    counts,
    onSelect,
    disabled = false,
  }: {
    section: CaseFileSection;
    counts: Record<CaseFileSection, number>;
    onSelect: (section: CaseFileSection) => void;
    disabled?: boolean;
  } = $props();

  let rovingIndex = $state(0);
  let tabButtons = $state<Array<HTMLButtonElement | undefined>>([]);

  async function moveFocus(offset: number) {
    rovingIndex = (rovingIndex + offset + sections.length) % sections.length;
    await tick();
    tabButtons[rovingIndex]?.focus();
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === "ArrowDown" || event.key === "ArrowRight") {
      event.preventDefault();
      void moveFocus(1);
    } else if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
      event.preventDefault();
      void moveFocus(-1);
    } else if (event.key === "Home") {
      event.preventDefault();
      rovingIndex = 0;
      void tick().then(() => tabButtons[0]?.focus());
    } else if (event.key === "End") {
      event.preventDefault();
      rovingIndex = sections.length - 1;
      void tick().then(() => tabButtons.at(-1)?.focus());
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSelect(sections[rovingIndex]);
    }
  }
</script>

<nav class="case-file-section-nav" aria-label="案件檔案分類">
  <div role="tablist" aria-orientation="vertical">
    {#each sections as entry, index (entry)}
      {@const active = section === entry}
      <button
        bind:this={tabButtons[index]}
        type="button"
        role="tab"
        aria-selected={active}
        aria-controls={`case-file-section-${entry}`}
        tabindex={active ? 0 : -1}
        data-submenu-initial-focus={active ? "" : undefined}
        {disabled}
        onkeydown={handleKeydown}
        onclick={() => {
          rovingIndex = index;
          onSelect(entry);
        }}
      >
        {caseFileSectionLabels[entry]}
        {counts[entry]} 項
      </button>
    {/each}
  </div>
</nav>

<style>
  .case-file-section-nav [role="tablist"] {
    display: grid;
    gap: 0.35rem;
  }

  button[role="tab"] {
    width: 100%;
    text-align: left;
  }
</style>

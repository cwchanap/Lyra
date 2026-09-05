<script lang="ts">
  import type { PlanSurface } from "./plan-store.svelte";
  import type { PlanWorkspace } from "./plan-workspace";

  let {
    workspace,
    surface,
    selectedDocumentId,
    selectedAnchor = null,
    onRefresh,
    onShowOverview,
    onSelectDocument,
    onSelectHeading,
  }: {
    workspace: PlanWorkspace | null;
    surface: PlanSurface;
    selectedDocumentId: string;
    selectedAnchor?: string | null;
    onRefresh: () => void;
    onShowOverview: () => void;
    onSelectDocument: (id: string) => void;
    onSelectHeading: (id: string, anchor: string) => void;
  } = $props();

  // Compact by default: the real documents contain hundreds of headings, so
  // the outline shows H1/H2 until this local (never persisted) toggle flips.
  let showAllLevels = $state(false);

  const selectedDocument = $derived(
    workspace?.documents.find((doc) => doc.id === selectedDocumentId) ?? null,
  );
  const outlineHeadings = $derived(
    selectedDocument?.headings.filter(
      (heading) => showAllLevels || heading.level <= 2,
    ) ?? [],
  );
  const hasDeepHeadings = $derived(
    selectedDocument?.headings.some((heading) => heading.level > 2) ?? false,
  );

  function documentLabel(doc: {
    kind: string;
    chapterNumber: number | null;
  }): string {
    return doc.kind === "storyBible"
      ? "Story Bible"
      : `Chapter ${doc.chapterNumber} plan`;
  }
</script>

<nav class="plan-sidebar grid content-start gap-2" aria-label="Plan documents">
  <button
    type="button"
    class="min-h-9 cursor-pointer rounded-md border px-3 text-left text-sm font-bold {surface ===
    'overview'
      ? 'border-[#57776a] bg-[#edf4f0]'
      : 'border-[#bfc7bf] bg-white hover:border-[#57776a]'}"
    aria-current={surface === "overview" ? "true" : undefined}
    onclick={onShowOverview}
  >
    Overview
  </button>
  <button
    type="button"
    class="w-fit cursor-pointer rounded border border-[#e4ded3] bg-white px-2 py-0.5 text-[0.8rem] hover:border-[#57776a]"
    onclick={onRefresh}
  >
    Refresh plan
  </button>
  {#each workspace?.documents ?? [] as doc (doc.id)}
    <button
      type="button"
      class="min-h-9 cursor-pointer rounded-md border px-3 py-2 text-left text-sm font-bold {doc.id ===
        selectedDocumentId && surface === 'document'
        ? 'border-[#57776a] bg-[#edf4f0]'
        : 'border-[#bfc7bf] bg-white hover:border-[#57776a]'}"
      aria-current={doc.id === selectedDocumentId && surface === "document"
        ? "true"
        : undefined}
      onclick={() => onSelectDocument(doc.id)}
    >
      {documentLabel(doc)}
    </button>
    {#if surface === "document" && doc.id === selectedDocumentId}
      {#if hasDeepHeadings}
        <button
          type="button"
          class="w-fit cursor-pointer rounded border border-[#e4ded3] bg-white px-2 py-0.5 text-[0.8rem] hover:border-[#57776a]"
          aria-pressed={showAllLevels}
          onclick={() => (showAllLevels = !showAllLevels)}
        >
          Show all levels
        </button>
      {/if}
      <ul
        class="ml-3 grid list-none gap-0.5 border-l-2 border-[#e4ded3] p-0 pl-2"
        aria-label="Document outline"
      >
        {#each outlineHeadings as heading (heading.anchor)}
          <li>
            <button
              type="button"
              class="w-full cursor-pointer rounded px-1.5 py-1 text-left text-[0.85rem] hover:bg-[#edf4f0] {heading.anchor ===
              selectedAnchor
                ? 'bg-[#edf4f0] font-bold'
                : ''}"
              aria-current={heading.anchor === selectedAnchor
                ? "true"
                : undefined}
              onclick={() => onSelectHeading(doc.id, heading.anchor)}
            >
              {heading.text}
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  {/each}
</nav>

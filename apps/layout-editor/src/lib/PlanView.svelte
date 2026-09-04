<script lang="ts">
  import type { PlanSurface } from "./plan-store.svelte";
  import { planSourceRef, type PlanWorkspace } from "./plan-workspace";

  let {
    workspace,
    error = null,
    loading = false,
    surface,
    selectedDocumentId,
    selectedAnchor = null,
    onNavigateSource,
  }: {
    workspace: PlanWorkspace | null;
    error?: string | null;
    loading?: boolean;
    surface: PlanSurface;
    selectedDocumentId: string;
    selectedAnchor?: string | null;
    onNavigateSource: (documentId: string, anchor: string | null) => void;
  } = $props();

  let documentBody = $state<HTMLElement | null>(null);
  let copyStatus = $state<string | null>(null);

  const selectedDocument = $derived(
    workspace?.documents.find((doc) => doc.id === selectedDocumentId) ?? null,
  );

  // Selected-heading highlight + scroll. Anchors are bare DOM ids inside the
  // projected HTML, so they are looked up after the {@html} lands; reading
  // selectedDocument re-runs the effect when a refresh swaps the projection.
  $effect(() => {
    const body = documentBody;
    const document = selectedDocument;
    if (!body || !document) return;
    for (const marked of body.querySelectorAll(".plan-heading-selected")) {
      marked.classList.remove("plan-heading-selected");
    }
    if (!selectedAnchor) return;
    const target = body.querySelector(`[id="${selectedAnchor}"]`);
    if (!target) return;
    target.classList.add("plan-heading-selected");
    // jsdom (component tests) has no layout; scrolling is best-effort.
    target.scrollIntoView?.({ block: "start" });
  });

  async function copySourceReference(): Promise<void> {
    if (!selectedDocument) return;
    try {
      await navigator.clipboard.writeText(
        planSourceRef(selectedDocument.path, selectedAnchor),
      );
      copyStatus = "Copied source";
    } catch {
      copyStatus = "Copy failed";
    }
  }
</script>

<section class="plan-view grid content-start gap-4" aria-label="Plan">
  {#if error}
    <p class="m-0 text-[#b3543e]" role="alert">{error}</p>
  {/if}

  {#if !workspace}
    {#if loading}
      <p class="m-0">Loading plan workspace…</p>
    {/if}
  {:else if surface === "overview"}
    <section class="grid content-start gap-4" aria-label="Plan overview">
      {#if workspace.aobaOverrideNotice}
        <blockquote
          class="m-0 grid gap-1 rounded border border-[#d9c9a3] bg-[#fdf6e3] p-3"
        >
          <strong class="text-[0.8rem] tracking-wide text-[#5f6b64] uppercase">
            §18 Canon Addendum override
          </strong>
          <p class="m-0 whitespace-pre-wrap">
            {workspace.aobaOverrideNotice.text}
          </p>
        </blockquote>
      {/if}

      <section class="grid gap-1" aria-label="Plan diagnostics">
        <h3 class="m-0">Diagnostics</h3>
        {#if workspace.diagnostics.length === 0}
          <p class="m-0">No plan diagnostics.</p>
        {:else}
          <ul class="m-0 grid list-none gap-1 p-0">
            {#each workspace.diagnostics as diagnostic, index (index)}
              <li
                class="text-[0.85rem] text-[#b3543e]"
                data-diagnostic-code={diagnostic.code}
              >
                {diagnostic.code}: {diagnostic.message}
              </li>
            {/each}
          </ul>
        {/if}
      </section>

      {#if workspace.chapterOverview}
        <section class="grid gap-1" aria-label="Chapter overview matrix">
          <h3 class="m-0">章節總覽</h3>
          <table class="w-full border-collapse text-[0.85rem]">
            <thead>
              <tr>
                <th class="border border-[#e4ded3] px-2 py-1 text-left">章節</th
                >
                <th class="border border-[#e4ded3] px-2 py-1 text-left">標題</th
                >
                <th class="border border-[#e4ded3] px-2 py-1 text-left">
                  案件類型
                </th>
                <th class="border border-[#e4ded3] px-2 py-1 text-left">變體</th
                >
                <th class="border border-[#e4ded3] px-2 py-1 text-left">
                  主線誤導
                </th>
              </tr>
            </thead>
            <tbody>
              {#each workspace.chapterOverview.rows as row, index (index)}
                <tr>
                  <td class="border border-[#e4ded3] px-2 py-1">
                    {row.chapter}
                  </td>
                  <td class="border border-[#e4ded3] px-2 py-1">{row.title}</td>
                  <td class="border border-[#e4ded3] px-2 py-1">
                    {row.caseType}
                  </td>
                  <td class="border border-[#e4ded3] px-2 py-1">
                    {row.variant}
                  </td>
                  <td class="border border-[#e4ded3] px-2 py-1">
                    {row.mainMisdirection}
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </section>
      {/if}

      {#if workspace.aobaReveal}
        <section class="grid gap-1" aria-label="Aoba reveal timeline">
          <h3 class="m-0">18.5 第一幕 reveal ladder</h3>
          <ol class="m-0 grid list-decimal gap-1 pl-5">
            {#each workspace.aobaReveal.stages as stage, index (index)}
              <li>
                <strong>{stage.chapterLabel}</strong> — {stage.mustEstablish}
              </li>
            {/each}
          </ol>
        </section>

        <section class="grid gap-1" aria-label="Aoba boundary table">
          <h3 class="m-0">必須建立 / 絕對不能建立</h3>
          <table class="w-full border-collapse text-[0.85rem]">
            <thead>
              <tr>
                <th class="border border-[#e4ded3] px-2 py-1 text-left">章節</th
                >
                <th class="border border-[#e4ded3] px-2 py-1 text-left">
                  必須建立
                </th>
                <th class="border border-[#e4ded3] px-2 py-1 text-left">
                  絕對不能建立
                </th>
                <th class="border border-[#e4ded3] px-2 py-1">
                  <span class="sr-only">Source</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {#each workspace.aobaReveal.stages as stage, index (index)}
                <tr>
                  <td class="border border-[#e4ded3] px-2 py-1">
                    {stage.chapterLabel}
                  </td>
                  <td class="border border-[#e4ded3] px-2 py-1">
                    {stage.mustEstablish}
                  </td>
                  <td class="border border-[#e4ded3] px-2 py-1">
                    {stage.mustNotEstablish}
                  </td>
                  <td class="border border-[#e4ded3] px-2 py-1">
                    <button
                      type="button"
                      class="cursor-pointer rounded border border-[#e4ded3] bg-white px-2 py-0.5 hover:border-[#57776a]"
                      onclick={() =>
                        onNavigateSource(
                          "story-bible",
                          workspace.aobaReveal?.anchor ?? null,
                        )}
                    >
                      Open source
                    </button>
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </section>
      {/if}
    </section>
  {:else if selectedDocument}
    <section class="grid content-start gap-3" aria-label="Plan document">
      <header class="grid gap-1">
        <code class="break-all text-[0.75rem] text-[#60706b]">
          {selectedDocument.path}
        </code>
        <div class="flex flex-wrap items-center gap-2">
          <button
            type="button"
            class="w-fit cursor-pointer rounded border border-[#e4ded3] bg-white px-2 py-1 hover:border-[#57776a]"
            onclick={() => void copySourceReference()}
          >
            Copy source reference
          </button>
          {#if copyStatus}
            <p class="m-0 text-[0.85rem]" role="status">{copyStatus}</p>
          {/if}
        </div>
      </header>
      <div
        class="plan-document-body grid content-start gap-2 [&_h1]:mt-4 [&_h2]:mt-4 [&_h3]:mt-3"
        bind:this={documentBody}
      >
        <!-- eslint-disable-next-line svelte/no-at-html-tags -- repo-authored Markdown; raw HTML is escaped by plan-workspace renderer -->
        {@html selectedDocument.renderedHtml}
      </div>
    </section>
  {/if}
</section>

<style>
  /* Selected-heading highlight: headings come from {@html}, so the rule
     must be :global but stays scoped to this component's document body. */
  .plan-document-body :global(.plan-heading-selected) {
    background: #edf4f0;
    box-shadow: 0 0 0 2px #57776a;
    border-radius: 4px;
  }
</style>

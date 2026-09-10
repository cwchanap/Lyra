<script lang="ts">
  import { untrack } from "svelte";
  // HPA-136: presentation + request lifecycle only. No Tauri imports and no
  // Workbench store imports — the provider is injected and the context bundle
  // arrives prebuilt; the panel only narrows chips into the provider request.
  import type {
    AiReviewLens,
    AiReviewProvider,
    AiReviewProviderRequest,
    AiReviewResult,
  } from "./ai-review";
  import { validateAiReviewResult } from "./ai-review";
  import type { AiReviewContextBundle } from "./ai-review-context";

  let {
    selectionLabel,
    lenses,
    initialLens,
    context,
    rebuildContext,
    provider,
    onReviewReplacement,
    onClose,
  }: {
    selectionLabel: string;
    lenses: AiReviewLens[];
    initialLens: AiReviewLens;
    context: AiReviewContextBundle;
    /** Rebuilds the context bundle for a new lens; the panel calls this on
     * lens switch so buildRequest uses lens-appropriate supporting chips. */
    rebuildContext: (lens: AiReviewLens) => AiReviewContextBundle;
    provider: AiReviewProvider;
    /** Called with a validated replacement text; the owner opens the edit. */
    onReviewReplacement?: (replacementText: string) => void;
    onClose: () => void;
  } = $props();

  type Phase = "ready" | "running" | "result" | "failed" | "canceled";

  const LENS_LABELS: Record<AiReviewLens, string> = {
    storyConsistency: "Story consistency",
    dialogue: "Dialogue",
    promptRefinement: "Prompt refinement",
  };

  let phase = $state<Phase>("ready");
  // The initial lens is intentionally captured once at mount; lens changes
  // are panel-local (selectLens).
  let currentLens = $state<AiReviewLens>(untrack(() => initialLens));
  // The context bundle is rebuilt on lens switch so buildRequest always
  // uses lens-appropriate supporting chips. Initialized from the prebuilt
  // prop; the panel never touches workspace/selection directly.
  let contextBundle = $state<AiReviewContextBundle>(untrack(() => context));
  let removedRefs = $state<ReadonlyArray<string>>([]);
  let result = $state<AiReviewResult | null>(null);
  let failure = $state<string | null>(null);
  // Monotonic fence: Cancel (or a newer Run) discards every older response.
  let runGeneration = 0;

  const activeChips = $derived(
    contextBundle.context.filter(
      (chip) => chip.required || !removedRefs.includes(chip.ref),
    ),
  );

  function buildRequest(): AiReviewProviderRequest {
    return {
      lens: currentLens,
      selectedSourceRef: contextBundle.selectedSourceRef,
      selectedText: contextBundle.selectedText,
      context: activeChips.map((chip) => ({
        ref: chip.ref,
        sourceRef: chip.sourceRef,
        kind: chip.kind,
        content: chip.content,
      })),
      missingContext: contextBundle.missingContext,
      replacementTargetRef: contextBundle.replacementTargetRef,
    };
  }

  /** Distinct failure text per native transport error kind. */
  function providerFailureText(error: unknown): string {
    if (typeof error === "object" && error !== null && "code" in error) {
      const { code, message } = error as { code: string; message?: string };
      if (code === "aiProviderConfigMissing") {
        return "AI review is not configured: the review agent CLI is missing.";
      }
      if (code === "aiProviderResponseTruncated") {
        return "The provider response was truncated before completing; retry the review.";
      }
      if (code === "aiProviderRequestFailed") {
        return `AI review request failed: ${message ?? "unknown transport error"}`;
      }
      if (code === "aiProviderInvalidResponse") {
        return `The provider returned an unusable response: ${message ?? "unknown error"}`;
      }
    }
    if (error instanceof Error) return `AI review failed: ${error.message}`;
    return `AI review failed: ${String(error)}`;
  }

  async function runReview(): Promise<void> {
    const generation = ++runGeneration;
    phase = "running";
    result = null;
    failure = null;
    const request = buildRequest();
    try {
      const candidate = await provider(request);
      if (generation !== runGeneration) return; // canceled / superseded
      const outcome = validateAiReviewResult(request, candidate);
      if (!outcome.ok) {
        failure = outcome.reason;
        phase = "failed";
        return;
      }
      result = outcome.result;
      phase = "result";
    } catch (error) {
      if (generation !== runGeneration) return; // canceled / superseded
      failure = providerFailureText(error);
      phase = "failed";
    }
  }

  function cancelReview(): void {
    // Local fence only — there is no backend cancellation registry.
    runGeneration += 1;
    result = null;
    failure = null;
    phase = "canceled";
  }

  function selectLens(lens: AiReviewLens): void {
    if (lens === currentLens) return;
    currentLens = lens;
    // Rebuild the context bundle for the new lens so supporting chips match
    // (e.g. dialogue adds voice/group chips that storyConsistency omits).
    contextBundle = rebuildContext(lens);
    removedRefs = [];
    result = null;
    failure = null;
    phase = "ready";
  }

  function removeChip(ref: string): void {
    removedRefs = [...removedRefs, ref];
  }

  function applyReplacement(): void {
    if (result?.replacement) {
      onReviewReplacement?.(result.replacement.replacementText);
    }
  }
</script>

<section
  class="ai-review-panel grid content-start gap-3 rounded-lg border border-[#d7d2c8] bg-[#fffcf7] p-5 shadow-[0_16px_40px_rgb(39_35_29_/_10%)]"
  aria-label="AI review"
  data-state={phase}
>
  <header class="grid gap-1">
    <p
      class="eyebrow m-0 text-[0.78rem] font-bold tracking-normal text-[#5f6b64] uppercase"
    >
      AI review
    </p>
    <h2 class="m-0 break-words text-lg">{selectionLabel}</h2>
    <p class="m-0">
      <code class="text-[0.8rem]" data-selected-source-ref
        >{contextBundle.selectedSourceRef}</code
      >
    </p>
  </header>

  <div
    class="flex flex-wrap items-center gap-1 rounded-md border border-[#bfc7bf] bg-white p-1"
    role="group"
    aria-label="Review lens"
  >
    {#each lenses as lens (lens)}
      <button
        type="button"
        class="min-h-8 cursor-pointer rounded border px-3 text-sm font-bold disabled:cursor-not-allowed"
        class:border-[#57776a]={lens === currentLens}
        class:bg-[#edf4f0]={lens === currentLens}
        class:border-[#bfc7bf]={lens !== currentLens}
        class:bg-white={lens !== currentLens}
        aria-pressed={lens === currentLens}
        disabled={phase === "running"}
        onclick={() => selectLens(lens)}
      >
        {LENS_LABELS[lens]}
      </button>
    {/each}
  </div>

  <ul class="m-0 grid list-none gap-1.5 p-0" aria-label="Context chips">
    {#each activeChips as chip (chip.ref)}
      <li
        class="flex items-start justify-between gap-2 rounded border border-[#e4ded3] bg-white px-2 py-1"
        data-chip-ref={chip.ref}
        data-chip-kind={chip.kind}
      >
        <div class="min-w-0 grid gap-0.5">
          <p class="m-0 text-[0.8rem] font-bold">
            {chip.label}
            <span class="font-normal text-[#60706b]"
              >· {chip.approxChars} chars</span
            >
            {#if chip.required}
              <span
                class="ml-1 rounded bg-[#eef2ee] px-1 py-0.5 text-[0.65rem] text-[#5f6b64] uppercase"
                >Required</span
              >
            {/if}
          </p>
          <code class="break-all text-[0.7rem] text-[#60706b]"
            >{chip.sourceRef}</code
          >
          <details class="min-w-0">
            <summary
              class="w-fit cursor-pointer text-[0.72rem] font-bold text-[#5f6b64] hover:text-[#26302e]"
            >
              Outgoing content
            </summary>
            <pre
              class="m-0 max-h-40 overflow-auto rounded bg-[#f7f4ee] p-2 text-[0.72rem] break-words whitespace-pre-wrap"
              data-chip-content>{chip.content}</pre>
          </details>
        </div>
        {#if !chip.required}
          <button
            type="button"
            class="flex-none cursor-pointer rounded border border-[#e4ded3] bg-white px-1.5 py-0.5 text-[0.75rem] hover:border-[#57776a] disabled:cursor-not-allowed disabled:opacity-60"
            disabled={phase === "running"}
            onclick={() => removeChip(chip.ref)}
          >
            Remove
          </button>
        {/if}
      </li>
    {/each}
  </ul>

  {#if contextBundle.missingContext.length > 0}
    <div
      class="grid gap-1 rounded-md border border-[#d9c9a3] bg-[#fdf6e3] p-3"
      aria-label="Missing context"
      role="note"
    >
      <p class="m-0 text-[0.78rem] font-bold text-[#7a6535] uppercase">
        Missing context
      </p>
      <ul class="m-0 grid list-none gap-1 p-0">
        {#each contextBundle.missingContext as missing, index (index)}
          <li
            class="text-[0.85rem] text-[#7a6535]"
            data-missing-kind={missing.kind}
          >
            {missing.label}：{missing.reason}
          </li>
        {/each}
      </ul>
    </div>
  {/if}

  {#if phase === "running"}
    <p class="m-0" role="status">Reviewing…</p>
  {:else if phase === "canceled"}
    <p class="m-0" role="status">Canceled</p>
  {/if}

  {#if failure}
    <p
      class="m-0 rounded-md border border-[#d9a99e] bg-[#fff4f1] p-3 text-[#7d3c2f]"
      role="alert"
      data-review-failure
    >
      {failure}
    </p>
  {/if}

  {#if result}
    {#if result.noChange}
      <p
        class="m-0 rounded-md border border-[#9fc3ad] bg-[#f0f7f1] p-3 text-[#2e5340]"
        role="status"
        data-no-change
      >
        No findings — the provider reports no change.
      </p>
    {:else}
      <div class="grid gap-2" aria-label="AI review findings">
        {#each result.findings as finding, index (index)}
          <article
            class="grid gap-1 rounded border border-[#e4ded3] bg-white p-3"
            data-finding
            data-severity={finding.severity}
          >
            <p class="m-0 text-[0.85rem] font-bold">
              <span
                class="mr-1.5 rounded px-1.5 py-0.5 text-[0.7rem] uppercase"
                class:bg-[#fdebe7]={finding.severity === "Blocker"}
                class:text-[#a03d2d]={finding.severity === "Blocker"}
                class:bg-[#fdf3d7]={finding.severity === "Important"}
                class:text-[#7a6535]={finding.severity === "Important"}
                class:bg-[#eef2ee]={finding.severity === "Minor"}
                class:text-[#5f6b64]={finding.severity === "Minor"}
                >{finding.severity}</span
              >{finding.summary}
            </p>
            <p class="m-0 text-[0.9rem]">{finding.explanation}</p>
            <p class="m-0 break-all text-[0.75rem] text-[#60706b]">
              {finding.supportingSourceRefs.join("、")}
            </p>
          </article>
        {/each}
      </div>
    {/if}
    {#if result.uncertainty.length > 0}
      <ul
        class="m-0 grid list-none gap-1 rounded border border-[#d9c9a3] bg-[#fdf6e3] p-3"
        aria-label="Review uncertainty"
      >
        {#each result.uncertainty as note, index (index)}
          <li class="text-[0.85rem] text-[#7a6535]">{note}</li>
        {/each}
      </ul>
    {/if}
    {#if result.replacement}
      <div
        class="grid gap-1 rounded-md border border-[#9fc3ad] bg-[#f0f7f1] p-3"
        data-replacement
      >
        <p class="m-0 text-[0.78rem] font-bold text-[#2e5340] uppercase">
          Suggested replacement
        </p>
        <p class="m-0 break-words" data-replacement-text>
          {result.replacement.replacementText}
        </p>
        <p class="m-0 text-[0.85rem] text-[#2e5340]">
          {result.replacement.rationale}
        </p>
        {#if onReviewReplacement}
          <button
            type="button"
            class="w-fit cursor-pointer rounded-md border border-[#57776a] bg-[#edf4f0] px-4 text-sm font-bold text-[#26302e] hover:bg-[#dfeae3]"
            data-apply-replacement
            onclick={applyReplacement}
          >
            Use replacement
          </button>
        {/if}
      </div>
    {/if}
  {/if}

  <div class="flex gap-2">
    <button
      type="button"
      class="min-h-9 cursor-pointer rounded-md border border-[#57776a] bg-[#edf4f0] px-4 text-sm font-bold text-[#26302e] hover:bg-[#dfeae3] disabled:cursor-not-allowed disabled:opacity-60"
      data-run-review
      disabled={phase === "running"}
      onclick={() => void runReview()}
    >
      {phase === "running" ? "Reviewing…" : "Run review"}
    </button>
    {#if phase === "running"}
      <button
        type="button"
        class="min-h-9 cursor-pointer rounded-md border border-[#bfc7bf] bg-white px-4 text-sm font-bold text-[#26302e] hover:border-[#57776a]"
        onclick={cancelReview}
      >
        Cancel
      </button>
    {:else}
      <button
        type="button"
        class="min-h-9 cursor-pointer rounded-md border border-[#bfc7bf] bg-white px-4 text-sm font-bold text-[#26302e] hover:border-[#57776a]"
        onclick={onClose}
      >
        Close
      </button>
    {/if}
  </div>
</section>

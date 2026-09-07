<script lang="ts">
  import type { CompileError } from "@lyra/scripts/compile-scenes/types";
  import type {
    FocusedEditDraft,
    FocusedEditDiffHunk,
    WorkbenchValidationReport,
  } from "./focused-edit";

  let {
    state,
    sourcePath = null,
    draft = null,
    hunk = null,
    diagnostic = null,
    error = null,
    validation = null,
    replacement = "",
    onReplacementChange,
    onApply,
    onCancel,
  }: {
    state:
      | "idle"
      | "loading-source"
      | "editing"
      | "applying"
      | "applied-valid"
      | "applied-invalid"
      | "error";
    sourcePath: string | null;
    draft: FocusedEditDraft | null;
    /** Structured one-hunk diff of the active draft (unified-style render). */
    hunk: FocusedEditDiffHunk | null;
    /** Draft-open failure (stale / no-change / not-editable / not-focused). */
    diagnostic: CompileError | null;
    /** Load or apply-rejection failure message. */
    error: string | null;
    /** Backend validation outcome for applied-invalid (written, not fresh). */
    validation: WorkbenchValidationReport | null;
    replacement: string;
    onReplacementChange: (text: string) => void;
    onApply: () => void;
    onCancel: () => void;
  } = $props();

  const isTerminal = $derived(
    state === "applied-valid" ||
      state === "applied-invalid" ||
      state === "error",
  );
</script>

<section
  class="focused-edit-review grid content-start gap-3 rounded-lg border border-[#d7d2c8] bg-[#fffcf7] p-5 shadow-[0_16px_40px_rgb(39_35_29_/_10%)]"
  aria-label="Focused edit review"
  data-state={state}
>
  <header class="grid gap-1">
    <p
      class="eyebrow m-0 text-[0.78rem] font-bold tracking-normal text-[#5f6b64] uppercase"
    >
      Focused edit review
    </p>
    {#if sourcePath}
      <p class="m-0">
        <code class="text-[0.8rem]" data-source-path>{sourcePath}</code>
      </p>
    {/if}
    {#if draft}
      <p class="m-0">
        <code class="text-[0.8rem]" data-semantic-ref>{draft.semanticRef}</code>
      </p>
    {/if}
  </header>

  {#if state === "loading-source"}
    <p class="m-0" role="status">Loading source document…</p>
  {/if}

  {#if error}
    <p
      class="m-0 rounded-md border border-[#d9a99e] bg-[#fff4f1] p-3 text-[#7d3c2f]"
      role="alert"
      data-review-error
    >
      {error}
    </p>
  {/if}

  {#if diagnostic}
    <p
      class="m-0 rounded-md border border-[#d9a99e] bg-[#fff4f1] p-3 text-[#7d3c2f]"
      role="alert"
      data-diagnostic-code={diagnostic.code}
    >
      {diagnostic.code}: {diagnostic.message}
    </p>
  {/if}

  {#if validation && !validation.ok}
    <div
      class="grid gap-1 rounded-md border border-[#d9a99e] bg-[#fff4f1] p-3 text-[#7d3c2f]"
      role="alert"
      data-validation-failed
    >
      <p class="m-0 font-bold">
        Applied, but scenes:compile failed. The source edit stays written and
        Reader/Assets projections were not refreshed.
      </p>
      <ul class="m-0 grid list-none gap-1 p-0">
        {#each validation.diagnostics as entry, index (index)}
          <li data-validation-code={entry.code}>
            {entry.code}: {entry.message}
          </li>
        {/each}
      </ul>
    </div>
  {/if}

  {#if state === "applied-valid"}
    <p
      class="m-0 rounded-md border border-[#9fc3ad] bg-[#f0f7f1] p-3 text-[#2e5340]"
      role="status"
      data-applied-valid
    >
      Applied — scenes:compile passed. Refreshing Reader and Assets.
    </p>
  {/if}

  {#if draft}
    <dl class="m-0 grid gap-2">
      <div class="grid gap-0.5">
        <dt class="text-[0.78rem] font-bold text-[#60706b] uppercase">
          Current
        </dt>
        <dd class="m-0 break-words" data-current-text>
          {draft.originalText}
        </dd>
      </div>
      <div class="grid gap-0.5">
        <dt class="text-[0.78rem] font-bold text-[#60706b] uppercase">
          Impact
        </dt>
        <dd class="m-0" data-impact data-impact-scope={draft.impact.scope}>
          {#if draft.impact.scope === "scene"}
            Scene {draft.impact.chapterId} / {draft.impact.sceneId}
          {:else}
            Asset {draft.impact.assetId} · {draft.impact.usages}
            usage{draft.impact.usages === 1 ? "" : "s"} across
            {draft.impact.scenes.length}
            scene{draft.impact.scenes.length === 1 ? "" : "s"}{draft.impact
              .shared
              ? " — shared across scenes, every usage recompiles"
              : ""}
          {/if}
        </dd>
      </div>
    </dl>
    {#if hunk}
      <pre
        class="m-0 overflow-x-auto rounded bg-[#f6f4ee] p-2 text-[0.8rem] leading-relaxed whitespace-pre-wrap"
        data-diff><span class="text-[#60706b]"
          >@@ -{hunk.oldStart},{hunk.oldLines} +{hunk.newStart},{hunk.newLines} @@</span
        >{#each hunk.lines as line, index (index)}<span
            data-diff-kind={line.kind}
            class:text-[#7d3c2f]={line.kind === "del"}
            class:text-[#2e5340]={line.kind === "add"}
            class:font-bold={line.kind !== "context"}
            >{line.kind === "add"
              ? "+ "
              : line.kind === "del"
                ? "- "
                : "  "}{line.text}</span
          >{/each}</pre>
    {/if}
  {/if}

  {#if state === "editing" || state === "applying"}
    <label class="grid gap-1">
      <span class="text-[0.78rem] font-bold text-[#60706b] uppercase">
        Replacement
      </span>
      <textarea
        class="min-h-16 rounded-md border border-[#bfc7bf] bg-white p-2 text-[0.9rem]"
        aria-label="Replacement text"
        rows={2}
        disabled={state === "applying"}
        value={replacement}
        oninput={(event) => onReplacementChange(event.currentTarget.value)}
      ></textarea>
    </label>
    <div class="flex gap-2">
      <button
        type="button"
        class="min-h-9 cursor-pointer rounded-md border border-[#57776a] bg-[#edf4f0] px-4 text-sm font-bold text-[#26302e] hover:bg-[#dfeae3] disabled:cursor-not-allowed disabled:opacity-60"
        data-apply
        disabled={draft === null || state !== "editing"}
        onclick={onApply}
      >
        {state === "applying" ? "Applying…" : "Apply"}
      </button>
      <button
        type="button"
        class="min-h-9 cursor-pointer rounded-md border border-[#bfc7bf] bg-white px-4 text-sm font-bold text-[#26302e] hover:border-[#57776a] disabled:cursor-not-allowed disabled:opacity-60"
        disabled={state === "applying"}
        onclick={onCancel}
      >
        Cancel
      </button>
    </div>
  {:else if isTerminal}
    <div class="flex gap-2">
      <button
        type="button"
        class="min-h-9 cursor-pointer rounded-md border border-[#bfc7bf] bg-white px-4 text-sm font-bold text-[#26302e] hover:border-[#57776a]"
        onclick={onCancel}
      >
        Close
      </button>
    </div>
  {/if}
</section>

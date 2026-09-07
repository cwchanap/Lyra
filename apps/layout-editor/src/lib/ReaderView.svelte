<script lang="ts">
  import { isSynthesizedDefaultDialogue } from "./focused-edit";
  import type {
    ReaderEditableRef,
    ReaderGroup,
    ReaderItem,
    ReaderScene,
  } from "./workbench-types";

  let {
    scene,
    onEditItem,
  }: {
    scene: ReaderScene;
    /** Selection-only callback: the view never loads source or opens drafts. */
    onEditItem?: (ref: ReaderEditableRef, item: ReaderItem) => void;
  } = $props();

  /** Line/action items get an Edit affordance; everything else is display
   * only. Compiler-synthesized defaults (e.g. evidence re-examination
   * fallbacks) have no authored source line, multiline actions are read-only
   * in v1 (their source line does not contain the complete action), and
   * Analysis scenes are outside the focused-edit seam (the editor holds only
   * their sanitized public view), so none of those may render Edit. */
  function isEditableItem(item: ReaderItem): boolean {
    if (scene.type === "analysis") return false;
    if (item.kind === "line") return true;
    if (item.kind === "action")
      return !item.multiline && !isSynthesizedDefaultDialogue(item);
    return false;
  }

  const NOTICE_LABELS: Record<
    Extract<ReaderItem, { kind: "notice" }>["noticeKind"],
    string
  > = {
    reveal: "Reveal",
    evidence: "Evidence",
    statement: "Statement",
    contradiction: "Contradiction",
    prompt: "Prompt",
    card: "Card",
    group: "Group",
    feedback: "Feedback",
    constraint: "Constraint",
  };

  async function copySourceReference(reference: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(reference);
    } catch {
      // Clipboard is best-effort; the reference stays visible and selectable.
    }
  }
</script>

{#snippet groupBody(group: ReaderGroup)}
  {#if group.sourceAnchor}
    <button
      type="button"
      class="w-fit cursor-pointer rounded border border-[#e4ded3] bg-white px-2 py-0.5 text-left hover:border-[#57776a]"
      title="Copy source reference"
      onclick={() =>
        copySourceReference(`${scene.sourcePath}${group.sourceAnchor}`)}
    >
      <code class="text-[0.75rem] text-[#60706b]"
        >{scene.sourcePath}{group.sourceAnchor}</code
      >
    </button>
  {/if}
  {#if group.items.length > 0}
    <ul class="m-0 grid list-none gap-1.5 p-0">
      {#each group.items as item, index (index)}
        <li class="text-[0.95rem] leading-relaxed">
          <div class="flex items-start justify-between gap-2">
            {#if item.kind === "line"}
              <p class="m-0">{item.speaker}: {item.text}</p>
            {:else if item.kind === "action"}
              <p class="m-0">
                <span
                  class="mr-1.5 inline-block rounded bg-[#eef2ee] px-1.5 py-0.5 align-middle text-[0.7rem] font-bold tracking-wide text-[#5f6b64] uppercase"
                  >Action</span
                ><span>{item.text}</span>
              </p>
            {:else if item.kind === "sceneTag"}
              <p class="m-0">
                <span
                  class="mr-1.5 inline-block rounded bg-[#eef2ee] px-1.5 py-0.5 align-middle text-[0.7rem] font-bold tracking-wide text-[#5f6b64] uppercase"
                  >Scene tag</span
                ><span>{item.text}</span>
              </p>
            {:else}
              <p class="m-0">
                <span
                  class="mr-1.5 inline-block rounded bg-[#eef2ee] px-1.5 py-0.5 align-middle text-[0.7rem] font-bold tracking-wide text-[#5f6b64] uppercase"
                  >{NOTICE_LABELS[item.noticeKind]}</span
                ><span>{item.text}</span>
              </p>
            {/if}
            {#if (item.kind === "line" || item.kind === "action") && isEditableItem(item)}
              <button
                type="button"
                class="flex-none cursor-pointer rounded border border-[#e4ded3] bg-white px-1.5 py-0.5 text-[0.75rem] hover:border-[#57776a]"
                data-edit-item
                onclick={() => onEditItem?.(item.editable, item)}
              >
                Edit
              </button>
            {/if}
          </div>
        </li>
      {/each}
    </ul>
  {/if}
  {#each group.children as child (child.id)}
    {@render renderGroup(child)}
  {/each}
{/snippet}

{#snippet renderGroup(group: ReaderGroup)}
  <section class="grid gap-2" data-group-kind={group.kind}>
    {#if group.children.length > 0 || group.flow === "branch"}
      <details open={group.flow === "main"}>
        <summary
          class="cursor-pointer text-[0.8rem] font-bold tracking-wide text-[#5f6b64] uppercase"
        >
          {group.label}
        </summary>
        <div class="mt-2 grid gap-2 border-l border-[#e4ded3] pl-3">
          {@render groupBody(group)}
        </div>
      </details>
    {:else}
      <h3
        class="m-0 text-[0.8rem] font-bold tracking-wide text-[#5f6b64] uppercase"
      >
        {group.label}
      </h3>
      {@render groupBody(group)}
    {/if}
  </section>
{/snippet}

<article
  class="reader-view grid content-start gap-5"
  aria-label={`Reader for ${scene.title}`}
>
  <header class="grid gap-1.5">
    <h2 class="m-0 text-[1.75rem] leading-[1.1] tracking-normal">
      {scene.title}
    </h2>
    <p class="m-0 text-[0.85rem] text-[#60706b]">{scene.type} scene</p>
    <button
      type="button"
      class="w-fit cursor-pointer rounded border border-[#e4ded3] bg-white px-2 py-1 text-left hover:border-[#57776a]"
      title="Copy source reference"
      onclick={() => copySourceReference(scene.sourcePath)}
    >
      <code class="text-[0.8rem]">{scene.sourcePath}</code>
    </button>
  </header>

  {#each scene.groups as group (group.id)}
    {@render renderGroup(group)}
  {/each}
</article>

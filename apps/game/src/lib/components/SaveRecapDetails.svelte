<script lang="ts">
  import type { SaveSummaryView } from "$lib/persistence/types";

  let {
    slotType,
    savedAt,
    summary,
    density = "compact",
  }: {
    slotType: "auto" | "manual";
    savedAt: string | null;
    summary: SaveSummaryView;
    density?: "compact" | "expanded";
  } = $props();

  const slotTypeLabel = $derived(slotType === "auto" ? "自動存檔" : "手動存檔");
  const formattedSavedAt = $derived(localSavedAt(savedAt));
  const accessibleLabel = $derived(
    [slotTypeLabel, summary.chapterTitle, summary.sceneTitle, formattedSavedAt]
      .filter((value): value is string => value !== null)
      .join("，"),
  );

  function localSavedAt(value: string | null): string | null {
    if (!value) return null;
    const instant = new Date(value);
    if (Number.isNaN(instant.valueOf())) return null;
    return new Intl.DateTimeFormat("zh-Hant", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(instant);
  }
</script>

<div
  class="save-recap-details"
  class:compact={density === "compact"}
  class:expanded={density === "expanded"}
  data-testid="save-recap-details"
  role="group"
  aria-label={accessibleLabel}
>
  <div class="save-meta">
    <span class="save-type">{slotTypeLabel}</span>
    {#if formattedSavedAt}
      <time data-testid="saved-at" datetime={savedAt ?? undefined}
        >{formattedSavedAt}</time
      >
    {/if}
  </div>

  <div class="recap-section">
    <span class="recap-kicker">章節</span>
    <strong class="recap-title">{summary.chapterTitle}</strong>
    {#if summary.chapterSummary}
      <p
        class="summary-copy"
        class:compact-clamp={density === "compact"}
        class:expanded-copy={density === "expanded"}
        data-testid="recap-summary-copy"
      >
        {summary.chapterSummary}
      </p>
    {/if}
  </div>

  <div class="recap-section">
    <span class="recap-kicker">場景</span>
    <strong class="recap-title">{summary.sceneTitle}</strong>
    {#if summary.sceneSummary}
      <p
        class="summary-copy"
        class:compact-clamp={density === "compact"}
        class:expanded-copy={density === "expanded"}
        data-testid="recap-summary-copy"
      >
        {summary.sceneSummary}
      </p>
    {/if}
  </div>

  <div class="recap-section objective-section">
    <span class="recap-kicker">主要目標</span>
    <strong class="recap-title objective-label">
      {summary.activePrimaryObjectiveLabel ?? "沒有進行中的主要目標"}
    </strong>
    {#if summary.activePrimaryObjectiveSummary}
      <p
        class="summary-copy"
        class:compact-clamp={density === "compact"}
        class:expanded-copy={density === "expanded"}
        data-testid="recap-summary-copy"
      >
        {summary.activePrimaryObjectiveSummary}
      </p>
    {/if}
  </div>
</div>

<style>
  .save-recap-details {
    display: grid;
    gap: 8px;
    min-width: 0;
    color: var(--bone, #e8e0d1);
  }

  .save-meta {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    justify-content: space-between;
    gap: 4px 10px;
  }

  .save-type,
  time,
  .recap-kicker,
  .summary-copy {
    color: var(--bone-dim, #a7a092);
    font-size: 0.8rem;
  }

  .save-type,
  .recap-kicker {
    letter-spacing: 0.08em;
  }

  .recap-section {
    display: grid;
    gap: 2px;
    min-width: 0;
  }

  .recap-title,
  .summary-copy {
    margin: 0;
  }

  .recap-title {
    font-size: 0.9rem;
    line-height: 1.4;
  }

  .summary-copy {
    line-height: 1.45;
  }

  .compact {
    gap: 5px;
  }

  .compact .recap-section {
    gap: 1px;
  }

  .compact-clamp {
    display: -webkit-box;
    overflow: hidden;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
  }

  .expanded {
    gap: 12px;
  }

  .expanded-copy {
    max-width: 62ch;
    color: var(--bone, #e8e0d1);
    font-size: 0.9rem;
  }

  .objective-label {
    color: var(--cyan, #65d8ea);
  }
</style>

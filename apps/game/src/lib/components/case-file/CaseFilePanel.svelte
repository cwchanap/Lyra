<script lang="ts">
  import { tick } from "svelte";
  import { buildCaseFileModel } from "$lib/case-file/case-file-model";
  import { caseFileSectionLabels } from "$lib/case-file/labels";
  import type {
    CaseFileItem,
    CaseFileKey,
    CaseFileModel,
    CaseFileSection,
  } from "$lib/case-file/types";
  import type { GameStateView } from "$lib/state/types";
  import { claimEscape } from "$lib/state/escape-coordinator";
  import CaseFileAuthorizationDetail from "./CaseFileAuthorizationDetail.svelte";
  import CaseFileFactDetail from "./CaseFileFactDetail.svelte";
  import CaseFileItemList from "./CaseFileItemList.svelte";
  import CaseFileObjectiveSection from "./CaseFileObjectiveSection.svelte";
  import CaseFileQuestionDetail from "./CaseFileQuestionDetail.svelte";
  import CaseFileRecordDetail from "./CaseFileRecordDetail.svelte";
  import CaseFileSectionNav from "./CaseFileSectionNav.svelte";

  let {
    state: gameState,
    section = $bindable<CaseFileSection>("objective"),
    reexamineEnabled,
    onReexamineEvidence,
    onReexamineStatement,
    disabled = false,
  }: {
    state: GameStateView;
    section?: CaseFileSection;
    reexamineEnabled: boolean;
    onReexamineEvidence: (id: string) => void;
    onReexamineStatement: (id: string) => void;
    disabled?: boolean;
  } = $props();

  type BackTarget = { section: CaseFileSection; key: CaseFileKey | null };

  let selectedKey = $state<CaseFileKey | null>(null);
  let backTarget = $state<BackTarget | null>(null);
  let focusedItemKey = $state<CaseFileKey | null>(null);
  let panel = $state<HTMLElement>();
  let model = $derived<CaseFileModel>(buildCaseFileModel(gameState));
  let selectedItem = $derived(
    selectedKey === null ? null : (model.itemsByKey.get(selectedKey) ?? null),
  );

  function itemsFor(targetSection: CaseFileSection): CaseFileItem[] {
    if (targetSection === "objective") {
      return [
        ...(model.objectives.activePrimary === null
          ? []
          : [model.objectives.activePrimary]),
        ...model.objectives.incompleteSecondaries,
        ...model.objectives.recentCompleted,
        ...model.objectives.earlierCompleted,
      ].flatMap((objective) => {
        const item = model.itemsByKey.get(`objective:${objective.id}`);
        return item === undefined ? [] : [item];
      });
    }
    if (targetSection === "evidence") return model.evidence;
    if (targetSection === "statements") return model.statements;
    if (targetSection === "facts") return model.facts;
    if (targetSection === "questions")
      return [...model.questions.open, ...model.questions.resolved];
    return model.authorizations;
  }

  function fallbackSelection(
    targetSection: CaseFileSection,
  ): CaseFileKey | null {
    return itemsFor(targetSection)[0]?.key ?? null;
  }

  $effect(() => {
    const previousKey = selectedKey;
    const item =
      selectedKey === null ? null : model.itemsByKey.get(selectedKey);
    if (item === undefined || item === null || item.section !== section) {
      const nextKey = fallbackSelection(section);
      selectedKey = nextKey;
      if (previousKey !== null && focusedItemKey === previousKey) {
        focusAfterInvalidation(nextKey);
      }
    }
  });

  const emptyText: Record<CaseFileSection, string> = {
    objective: "目前沒有可追蹤的目標。",
    evidence: "目前尚無證物。",
    statements: "目前尚無證詞。",
    facts: "目前尚無已確認事實。",
    questions: "目前尚無待解問題。",
    authorizations: "目前尚無授權。",
  };

  function selectSection(nextSection: CaseFileSection) {
    section = nextSection;
    selectedKey = fallbackSelection(nextSection);
    backTarget = null;
  }

  function selectItem(key: CaseFileKey) {
    if (model.itemsByKey.get(key)?.section === section) selectedKey = key;
  }

  function sectionForKey(key: CaseFileKey): CaseFileSection {
    if (key.startsWith("evidence:")) return "evidence";
    if (key.startsWith("statement:")) return "statements";
    if (key.startsWith("fact:")) return "facts";
    if (key.startsWith("question:")) return "questions";
    if (key.startsWith("authorization:")) return "authorizations";
    return "objective";
  }

  function focusDetailHeading() {
    void tick().then(() => {
      panel
        ?.querySelector<HTMLElement>("[data-case-file-detail-heading]")
        ?.focus();
    });
  }

  function focusAfterInvalidation(nextKey: CaseFileKey | null) {
    void tick().then(() => {
      const row = Array.from(
        panel?.querySelectorAll<HTMLButtonElement>(
          "[data-case-file-item-key]",
        ) ?? [],
      ).find((candidate) => candidate.dataset.caseFileItemKey === nextKey);
      if (row !== undefined) {
        row.focus();
        return;
      }
      const activeTab = panel?.querySelector<HTMLButtonElement>(
        `#case-file-tab-${section}`,
      );
      if (
        activeTab !== null &&
        activeTab !== undefined &&
        !activeTab.disabled
      ) {
        activeTab.focus();
        return;
      }
      panel
        ?.querySelector<HTMLElement>("[data-case-file-detail-heading]")
        ?.focus();
    });
  }

  function trackFocusedItem(event: FocusEvent) {
    const target = event.target;
    focusedItemKey =
      target instanceof HTMLElement
        ? ((target.closest<HTMLButtonElement>("[data-case-file-item-key]")
            ?.dataset.caseFileItemKey as CaseFileKey | undefined) ?? null)
        : null;
  }

  function followRelation(key: CaseFileKey) {
    backTarget = { section, key: selectedKey };
    const target = model.itemsByKey.get(key);
    const targetSection = target?.section ?? sectionForKey(key);
    section = targetSection;
    selectedKey = target?.key ?? fallbackSelection(targetSection);
    focusDetailHeading();
  }

  function goBack() {
    if (backTarget === null) return;
    const target = backTarget;
    backTarget = null;
    section = target.section;
    selectedKey =
      target.key !== null &&
      model.itemsByKey.get(target.key)?.section === target.section
        ? target.key
        : fallbackSelection(target.section);
    focusDetailHeading();
  }

  // While an internal relation layer is active (返回上一項 visible), claim
  // Escape so GameShell's global router steps back within the Case File
  // before closing the submenu — one Escape per layer. The claim
  // auto-releases when backTarget clears (goBack, selectSection, or unmount),
  // so it can never trap the player out of closing the submenu.
  $effect(() => {
    if (backTarget === null) return;
    return claimEscape(goBack);
  });

  function supportItems(keys: CaseFileKey[]): CaseFileItem[] {
    return keys.flatMap((key) => {
      const item = model.itemsByKey.get(key);
      return item === undefined ? [] : [item];
    });
  }
</script>

<section
  bind:this={panel}
  class="case-file-panel"
  aria-label="案件檔案"
  onfocusin={trackFocusedItem}
>
  <div class="case-file-rail">
    <CaseFileSectionNav
      {section}
      counts={model.counts}
      onSelect={selectSection}
      {disabled}
    />
  </div>

  <div class="case-file-list">
    <CaseFileItemList
      {section}
      items={itemsFor(section)}
      {selectedKey}
      emptyText={emptyText[section]}
      {disabled}
      onSelect={selectItem}
    />
  </div>

  <div class="case-file-detail">
    {#if backTarget !== null}
      <button type="button" {disabled} onclick={goBack}>返回上一項</button>
    {/if}

    {#if section === "objective"}
      <CaseFileObjectiveSection
        objectives={model.objectives}
        selected={selectedItem?.section === "objective" ? selectedItem : null}
        {disabled}
      />
    {:else if selectedItem?.section === "facts"}
      <CaseFileFactDetail
        item={selectedItem}
        supportingRecords={supportItems(selectedItem.supportingRecordKeys)}
        supportingFacts={supportItems(selectedItem.supportingFactKeys)}
        onNavigate={followRelation}
        {disabled}
      />
    {:else if selectedItem?.section === "questions"}
      {@const resolvedFact =
        selectedItem.resolvedFactKey === null
          ? null
          : model.itemsByKey.get(selectedItem.resolvedFactKey)}
      <CaseFileQuestionDetail
        item={selectedItem}
        resolvedFact={resolvedFact?.section === "facts" ? resolvedFact : null}
        onNavigate={followRelation}
        {disabled}
      />
    {:else if selectedItem?.section === "authorizations"}
      <CaseFileAuthorizationDetail item={selectedItem} />
    {:else if selectedItem?.section === "evidence" || selectedItem?.section === "statements"}
      <CaseFileRecordDetail
        item={selectedItem}
        {reexamineEnabled}
        {onReexamineEvidence}
        {onReexamineStatement}
        onNavigate={followRelation}
        {disabled}
      />
    {:else}
      <div
        id={`case-file-section-${section}`}
        role="tabpanel"
        aria-labelledby={`case-file-tab-${section}`}
      >
        <h2
          id="case-file-detail-heading"
          data-case-file-detail-heading
          tabindex="-1"
        >
          {caseFileSectionLabels[section]}
        </h2>
      </div>
    {/if}
  </div>
</section>

<style>
  .case-file-panel {
    display: grid;
    gap: 1rem;
    grid-template-columns:
      minmax(9.5rem, 0.55fr) minmax(12rem, 0.8fr)
      minmax(0, 1.65fr);
    align-items: start;
  }

  .case-file-rail {
    position: sticky;
    top: 0;
    align-self: start;
  }

  .case-file-list,
  .case-file-detail {
    min-width: 0;
  }

  @media (max-width: 900px) {
    .case-file-panel {
      grid-template-columns: 1fr;
    }

    .case-file-rail {
      position: static;
    }
  }
</style>

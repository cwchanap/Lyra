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
  import CaseFileAuthorizationDetail from "./CaseFileAuthorizationDetail.svelte";
  import CaseFileFactDetail from "./CaseFileFactDetail.svelte";
  import CaseFileItemList from "./CaseFileItemList.svelte";
  import CaseFileObjectiveSection from "./CaseFileObjectiveSection.svelte";
  import CaseFileQuestionDetail from "./CaseFileQuestionDetail.svelte";
  import CaseFileSectionNav from "./CaseFileSectionNav.svelte";

  let {
    state: gameState,
    section = $bindable<CaseFileSection>("objective"),
    reexamineEnabled: _reexamineEnabled,
    onReexamineEvidence: _onReexamineEvidence,
    onReexamineStatement: _onReexamineStatement,
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
  let panel = $state<HTMLElement>();
  let model = $derived<CaseFileModel>(buildCaseFileModel(gameState));
  let selectedItem = $derived(
    model.itemsByKey.get(selectedKey ?? "objective:missing") ?? null,
  );

  // Task 6 owns re-examination controls. These declared props preserve the
  // gameplay boundary without introducing Svelte-side persistence, IPC, or
  // catalog reads in this shell.

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
    const item =
      selectedKey === null ? null : model.itemsByKey.get(selectedKey);
    if (item === undefined || item === null || item.section !== section) {
      selectedKey = fallbackSelection(section);
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

  function supportItems(keys: CaseFileKey[]): CaseFileItem[] {
    return keys.flatMap((key) => {
      const item = model.itemsByKey.get(key);
      return item === undefined ? [] : [item];
    });
  }

  function recordHeading(item: CaseFileItem): string {
    if ("record" in item) {
      return "name" in item.record
        ? `證物：${item.record.name}`
        : `證詞：${item.record.speaker}`;
    }
    return caseFileSectionLabels[item.section];
  }
</script>

<section bind:this={panel} class="case-file-panel" aria-label="案件檔案">
  <CaseFileSectionNav
    {section}
    counts={model.counts}
    onSelect={selectSection}
    {disabled}
  />

  <div class="case-file-content">
    <CaseFileItemList
      {section}
      items={itemsFor(section)}
      {selectedKey}
      emptyText={emptyText[section]}
      {disabled}
      onSelect={selectItem}
    />

    <div class="case-file-detail">
      {#if backTarget !== null}
        <button type="button" {disabled} onclick={goBack}>返回上一項</button>
      {/if}

      {#if section === "objective"}
        <CaseFileObjectiveSection
          objectives={model.objectives}
          selected={selectedItem?.section === "objective" ? selectedItem : null}
        />
      {:else if selectedItem?.section === "facts"}
        <CaseFileFactDetail
          item={selectedItem}
          supportingRecords={supportItems(selectedItem.supportingRecordKeys)}
          supportingFacts={supportItems(selectedItem.supportingFactKeys)}
          onNavigate={followRelation}
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
        />
      {:else if selectedItem?.section === "authorizations"}
        <CaseFileAuthorizationDetail item={selectedItem} />
      {:else if selectedItem !== null}
        <section
          id={`case-file-section-${section}`}
          aria-labelledby="case-file-detail-heading"
        >
          <h2
            id="case-file-detail-heading"
            data-case-file-detail-heading
            tabindex="-1"
          >
            {recordHeading(selectedItem)}
          </h2>
        </section>
      {:else}
        <section
          id={`case-file-section-${section}`}
          aria-labelledby="case-file-detail-heading"
        >
          <h2
            id="case-file-detail-heading"
            data-case-file-detail-heading
            tabindex="-1"
          >
            {caseFileSectionLabels[section]}
          </h2>
        </section>
      {/if}
    </div>
  </div>
</section>

<style>
  .case-file-panel {
    display: grid;
    gap: 1rem;
  }
  .case-file-content {
    display: grid;
    gap: 1rem;
    grid-template-columns: minmax(10rem, 0.35fr) minmax(0, 1fr);
  }
  .case-file-detail {
    min-width: 0;
  }
  @media (max-width: 640px) {
    .case-file-content {
      grid-template-columns: 1fr;
    }
  }
</style>

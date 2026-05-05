<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import { onMount } from "svelte";

  type CaseStatus = "investigating" | "solved";

  type CaseState = {
    id: string;
    title: string;
    summary: string;
    status: CaseStatus;
    scene: SceneState;
    characters: CharacterState[];
    evidence: EvidenceState[];
    statements: StatementState[];
    deductionSlots: DeductionSlotState[];
    lastFeedback: DeductionFeedback | null;
  };

  type SceneState = {
    title: string;
    description: string;
    hotspots: HotspotState[];
  };

  type HotspotState = {
    id: string;
    label: string;
    description: string;
    inspected: boolean;
    locked: boolean;
    lockedReason: string | null;
  };

  type CharacterState = {
    id: string;
    name: string;
    role: string;
    profile: string;
    topics: TopicState[];
  };

  type TopicState = {
    id: string;
    label: string;
    response: string;
    discussed: boolean;
    locked: boolean;
    lockedReason: string | null;
  };

  type EvidenceState = {
    id: string;
    label: string;
    description: string;
    detail: string;
    collected: boolean;
  };

  type StatementState = {
    id: string;
    speaker: string;
    text: string;
    discovered: boolean;
  };

  type DeductionSlotState = {
    id: string;
    prompt: string;
    candidateAnswerIds: string[];
  };

  type DeductionAnswer = {
    slotId: string;
    answerId: string;
  };

  type DeductionFeedback = {
    complete: boolean;
    solved: boolean;
    message: string;
    slotResults: DeductionSlotResult[];
  };

  type DeductionSlotResult = {
    slotId: string;
    correct: boolean;
    guidance: string;
  };

  type AnswerOption = {
    id: string;
    label: string;
    description: string;
  };

  type InvestigationError = {
    code: string;
    message: string;
  };

  type Tab = "scene" | "people" | "evidence" | "deduction";

  const tabs: { id: Tab; label: string }[] = [
    { id: "scene", label: "Scene" },
    { id: "people", label: "People" },
    { id: "evidence", label: "Evidence" },
    { id: "deduction", label: "Deduction" },
  ];

  let caseState = $state<CaseState | null>(null);
  let activeTab = $state<Tab>("scene");
  let selectedEvidenceId = $state<string | null>(null);
  let selectedCharacterId = $state<string | null>(null);
  let draftAnswers = $state<Record<string, string>>({});
  let lastSubmittedAnswers = $state<Record<string, string>>({});
  let errorMessage = $state<string | null>(null);
  let loading = $state(true);

  let collectedEvidence = $derived(
    caseState?.evidence.filter((evidence) => evidence.collected) ?? [],
  );
  let discoveredStatements = $derived(
    caseState?.statements.filter((statement) => statement.discovered) ?? [],
  );
  let answerOptions = $derived<AnswerOption[]>([
    ...collectedEvidence.map((evidence) => ({
      id: evidence.id,
      label: evidence.label,
      description: evidence.description,
    })),
    ...discoveredStatements.map((statement) => ({
      id: statement.id,
      label: `${statement.speaker}: ${statement.text}`,
      description: "Known statement",
    })),
  ]);
  const selectedCharacter = $derived(
    caseState?.characters.find((character) => character.id === selectedCharacterId) ??
      caseState?.characters[0] ??
      null,
  );
  const selectedEvidence = $derived(
    collectedEvidence.find((item) => item.id === selectedEvidenceId) ??
      collectedEvidence[0] ??
      null,
  );

  onMount(() => {
    void startCase();
  });

  async function runCommand<T>(
    command: string,
    args?: Record<string, unknown>,
  ): Promise<T | null> {
    errorMessage = null;

    try {
      return await invoke<T>(command, args);
    } catch (error) {
      errorMessage = normalizeError(error);
      return null;
    }
  }

  function normalizeError(error: unknown): string {
    if (error && typeof error === "object" && "message" in error) {
      return String((error as InvestigationError).message);
    }

    if (typeof error === "string") {
      return error;
    }

    return "The investigation command failed.";
  }

  async function startCase() {
    loading = true;

    const nextCaseState = await runCommand<CaseState>("start_case");

    if (nextCaseState) {
      caseState = nextCaseState;
      draftAnswers = {};
      lastSubmittedAnswers = {};
      selectedEvidenceId = null;
      selectedCharacterId = nextCaseState.characters[0]?.id ?? null;
    }

    loading = false;
  }

  async function inspectHotspot(hotspotId: string) {
    const state = await runCommand<CaseState>("inspect_hotspot", { hotspotId });
    if (state) {
      caseState = state;
    }
  }

  async function interviewCharacter(characterId: string, topicId: string) {
    const state = await runCommand<CaseState>("interview_character", {
      characterId,
      topicId,
    });
    if (state) {
      caseState = state;
    }
  }

  async function submitDeduction() {
    if (!caseState) return;

    const answers: DeductionAnswer[] = caseState.deductionSlots.map((slot) => ({
      slotId: slot.id,
      answerId: draftAnswers[slot.id] ?? "",
    }));
    const submittedAnswers = Object.fromEntries(
      answers.map((answer) => [answer.slotId, answer.answerId]),
    );

    const feedback = await runCommand<DeductionFeedback>("submit_deduction", { answers });
    if (feedback) {
      lastSubmittedAnswers = submittedAnswers;

      const refreshedCaseState = await runCommand<CaseState>("get_case_state");
      caseState =
        refreshedCaseState ?? {
          ...caseState,
          status: feedback.solved ? "solved" : caseState.status,
          lastFeedback: feedback,
        };
    }
  }

  function feedbackForSlot(slotId: string): DeductionSlotResult | null {
    const submittedAnswer = lastSubmittedAnswers[slotId] ?? "";
    if (!submittedAnswer || (draftAnswers[slotId] ?? "") !== submittedAnswer) {
      return null;
    }

    return (
      caseState?.lastFeedback?.slotResults.find((result) => result.slotId === slotId) ?? null
    );
  }

  function statusLabel(status: CaseStatus): string {
    return status === "solved" ? "Solved" : "Investigating";
  }

  function optionLabel(answerId: string): string {
    return answerOptions.find((option) => option.id === answerId)?.label ?? "Unknown clue";
  }
</script>

{#if loading}
  <main class="app-shell">
    <section class="workbench" aria-live="polite">
      <p class="status-line">Loading investigation...</p>
    </section>
  </main>
{:else if caseState}
  <main class="app-shell">
    <header class="case-header">
      <div>
        <p class="eyebrow">Investigation</p>
        <h1>{caseState.title}</h1>
        <p>{caseState.summary}</p>
      </div>
      <div class="header-actions">
        <span class:solved={caseState.status === "solved"}>{statusLabel(caseState.status)}</span>
        <button type="button" class="secondary-action" onclick={startCase}>Reset Case</button>
      </div>
    </header>

    {#if errorMessage}
      <p class="error-banner" role="alert">{errorMessage}</p>
    {/if}

    <nav class="tabs" aria-label="Investigation sections">
      {#each tabs as tab}
        <button
          type="button"
          class:active={activeTab === tab.id}
          onclick={() => (activeTab = tab.id)}
        >
          {tab.label}
        </button>
      {/each}
    </nav>

    <section class="workbench">
      {#if activeTab === "scene"}
        <div class="panel-grid">
          <section class="main-panel" aria-labelledby="scene-title">
            <h2 id="scene-title">{caseState.scene.title}</h2>
            <p>{caseState.scene.description}</p>
            <div class="hotspot-grid">
              {#each caseState.scene.hotspots as hotspot}
                <button
                  type="button"
                  class="hotspot"
                  class:complete={hotspot.inspected}
                  disabled={hotspot.locked}
                  onclick={() => inspectHotspot(hotspot.id)}
                >
                  <span>{hotspot.label}</span>
                  <small>
                    {hotspot.locked
                      ? (hotspot.lockedReason ?? "Locked until more evidence is found")
                      : hotspot.inspected
                        ? "Inspected"
                        : "Inspect"}
                  </small>
                </button>
              {/each}
            </div>
          </section>

          <aside class="side-panel">
            <h3>Collected</h3>
            <p>{collectedEvidence.length} evidence items</p>
            <p>{discoveredStatements.length} statements</p>
          </aside>
        </div>
      {:else if activeTab === "people"}
        <div class="panel-grid detail-grid">
          <section class="list-panel" aria-label="People">
            {#each caseState.characters as character}
              <button
                type="button"
                class="list-row"
                class:active={selectedCharacter?.id === character.id}
                onclick={() => (selectedCharacterId = character.id)}
              >
                <strong>{character.name}</strong>
                <span>{character.role}</span>
              </button>
            {/each}
          </section>

          {#if selectedCharacter}
            <section class="main-panel">
              <h2>{selectedCharacter.name}</h2>
              <p class="muted">{selectedCharacter.role}</p>
              <p>{selectedCharacter.profile}</p>
              <div class="topic-list">
                {#each selectedCharacter.topics as topic}
                  <button
                    type="button"
                    class="topic"
                    class:complete={topic.discussed}
                    disabled={topic.locked}
                    onclick={() => interviewCharacter(selectedCharacter.id, topic.id)}
                  >
                    <span>{topic.label}</span>
                    <small>
                      {topic.locked
                        ? (topic.lockedReason ?? "Locked until more evidence is found")
                        : topic.discussed
                          ? "Discussed"
                          : "Ask"}
                    </small>
                  </button>
                  {#if topic.discussed}
                    <p class="response">{topic.response}</p>
                  {/if}
                {/each}
              </div>
            </section>
          {/if}
        </div>
      {:else if activeTab === "evidence"}
        <div class="panel-grid detail-grid">
          <section class="list-panel" aria-label="Evidence">
            {#each collectedEvidence as item}
              <button
                type="button"
                class="list-row"
                class:active={selectedEvidence?.id === item.id}
                onclick={() => (selectedEvidenceId = item.id)}
              >
                <strong>{item.label}</strong>
                <span>{item.description}</span>
              </button>
            {:else}
              <p class="muted">No evidence collected yet.</p>
            {/each}
          </section>

          <section class="main-panel">
            {#if selectedEvidence}
              <h2>{selectedEvidence.label}</h2>
              <p>{selectedEvidence.description}</p>
              <p class="response">{selectedEvidence.detail}</p>
            {:else}
              <h2>Evidence</h2>
              <p class="muted">Inspect the scene to collect evidence.</p>
            {/if}

            <h3>Known Statements</h3>
            <div class="statement-list">
              {#each discoveredStatements as statement}
                <p><strong>{statement.speaker}:</strong> {statement.text}</p>
              {:else}
                <p class="muted">No statements discovered yet.</p>
              {/each}
            </div>
          </section>
        </div>
      {:else if activeTab === "deduction"}
        <div class="panel-grid">
          <section class="main-panel" aria-labelledby="deduction-title">
            <h2 id="deduction-title">Deduction Board</h2>
            <p class="muted">
              Match each question to collected evidence or a known statement, then submit
              the theory for review.
            </p>

            <div class="deduction-list">
              {#each caseState.deductionSlots as slot}
                {@const result = feedbackForSlot(slot.id)}
                {@const slotOptions = answerOptions.filter((option) =>
                  slot.candidateAnswerIds.includes(option.id),
                )}
                <label
                  class="deduction-slot"
                  class:correct={Boolean(result?.correct)}
                  class:incorrect={Boolean(result && !result.correct)}
                >
                  <span>{slot.prompt}</span>
                  <select
                    value={draftAnswers[slot.id] ?? ""}
                    onchange={(event) => {
                      draftAnswers = {
                        ...draftAnswers,
                        [slot.id]: event.currentTarget.value,
                      };
                    }}
                  >
                    <option value="">Select a clue</option>
                    {#each slotOptions as option}
                      <option value={option.id}>{option.label}</option>
                    {/each}
                  </select>
                  {#if slotOptions.length === 0}
                    <small>No eligible clues available yet.</small>
                  {/if}
                  {#if result}
                    <small>{result.guidance}</small>
                  {/if}
                </label>
              {/each}
            </div>

            <button class="primary-action" type="button" onclick={submitDeduction}>
              Submit Theory
            </button>

            {#if caseState.lastFeedback}
              <section class="last-theory" aria-label="Last Theory">
                <h3>Last Theory</h3>
                <p>{caseState.lastFeedback.message}</p>
                <div class="statement-list">
                  {#each caseState.deductionSlots as slot}
                    <p>
                      <strong>{slot.prompt}</strong>
                      {optionLabel(lastSubmittedAnswers[slot.id] ?? "")}
                    </p>
                  {/each}
                </div>
              </section>
            {/if}
          </section>

          <aside class="side-panel">
            <h3>Available Clues</h3>
            <div class="statement-list">
              {#each answerOptions as option}
                <p><strong>{option.label}</strong> <small>{option.description}</small></p>
              {:else}
                <p class="muted">No clues available for deduction yet.</p>
              {/each}
            </div>
          </aside>
        </div>
      {/if}
    </section>
  </main>
{:else}
  <main class="app-shell">
    {#if errorMessage}
      <p class="error-banner" role="alert">{errorMessage}</p>
    {/if}
    <section class="workbench">
      <p class="status-line">Unable to load the investigation.</p>
      <button class="secondary-action" type="button" onclick={startCase}>Retry</button>
    </section>
  </main>
{/if}

<style>
  :global(*) {
    box-sizing: border-box;
  }

  :global(body) {
    margin: 0;
    min-width: 320px;
    min-height: 100vh;
    color: #202124;
    background: #f4f1eb;
    font-family:
      Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI",
      sans-serif;
  }

  button {
    font: inherit;
  }

  .app-shell {
    min-height: 100vh;
    padding: 32px;
  }

  .case-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 24px;
    margin: 0 auto 24px;
    max-width: 1120px;
    border-bottom: 1px solid #d7d0c4;
    padding-bottom: 24px;
  }

  .case-header h1 {
    margin: 4px 0 8px;
    color: #161616;
    font-size: 2rem;
    line-height: 1.15;
  }

  .case-header p {
    margin: 0;
    max-width: 680px;
    color: #55514a;
  }

  .header-actions {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .header-actions span {
    border: 1px solid #c7d0da;
    border-radius: 999px;
    background: #ffffff;
    color: #536170;
    padding: 0.45rem 0.7rem;
    font-size: 0.85rem;
    font-weight: 700;
  }

  .header-actions span.solved {
    border-color: #15803d;
    color: #15803d;
  }

  .eyebrow {
    color: #6f5132;
    font-size: 0.75rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .secondary-action {
    min-height: 40px;
    border: 1px solid #a99c8d;
    border-radius: 6px;
    padding: 0 14px;
    color: #2d2923;
    background: #fffdf8;
    cursor: pointer;
  }

  .secondary-action:hover {
    border-color: #6f5132;
  }

  .tabs {
    display: flex;
    gap: 8px;
    margin: 0 auto 16px;
    max-width: 1120px;
    border-bottom: 1px solid #d7d0c4;
  }

  .tabs button {
    border: 0;
    border-bottom: 3px solid transparent;
    padding: 12px 14px 10px;
    color: #5d5850;
    background: transparent;
    cursor: pointer;
  }

  .tabs button:hover {
    color: #161616;
  }

  .tabs button.active {
    border-color: #6f5132;
    color: #161616;
    font-weight: 700;
  }

  .workbench {
    margin: 0 auto;
    max-width: 1120px;
    border: 1px solid #d7d0c4;
    border-radius: 8px;
    padding: 24px;
    background: #fffdf8;
  }

  .workbench p {
    margin: 0;
  }

  .panel-grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 280px;
    gap: 16px;
  }

  .detail-grid {
    grid-template-columns: 280px minmax(0, 1fr);
  }

  .main-panel,
  .side-panel,
  .list-panel {
    min-width: 0;
  }

  .main-panel h2,
  .main-panel h3,
  .side-panel h3 {
    margin: 0 0 8px;
  }

  .main-panel h3 {
    margin-top: 20px;
  }

  .main-panel p,
  .side-panel p {
    color: #536170;
  }

  .hotspot-grid,
  .topic-list,
  .statement-list {
    display: grid;
    gap: 10px;
    margin-top: 16px;
  }

  .hotspot,
  .topic,
  .list-row {
    width: 100%;
    border: 1px solid #c7d0da;
    border-radius: 7px;
    padding: 0.85rem;
    color: #1d2430;
    background: #f8fafc;
    text-align: left;
  }

  .hotspot,
  .topic {
    display: flex;
    gap: 12px;
    justify-content: space-between;
  }

  .hotspot.complete,
  .topic.complete {
    border-color: #15803d;
    background: #f0fdf4;
  }

  .hotspot:disabled,
  .topic:disabled {
    cursor: not-allowed;
    opacity: 0.72;
  }

  .list-panel {
    display: grid;
    align-content: start;
    gap: 8px;
  }

  .list-row {
    display: grid;
    gap: 4px;
  }

  .list-row.active {
    border-color: #7c2d12;
    background: #fff7ed;
  }

  .hotspot:not(:disabled),
  .topic:not(:disabled),
  .list-row {
    cursor: pointer;
  }

  .list-row span,
  .hotspot small,
  .topic small,
  .muted {
    color: #64748b;
  }

  .response {
    border-left: 3px solid #7c2d12;
    padding: 0.75rem 0.9rem;
    background: #fff7ed;
  }

  .deduction-list {
    display: grid;
    gap: 12px;
    margin-top: 16px;
  }

  .deduction-slot {
    display: grid;
    gap: 8px;
    border: 1px solid #c7d0da;
    border-radius: 7px;
    padding: 0.9rem;
    background: #f8fafc;
  }

  .deduction-slot.correct {
    border-color: #15803d;
    background: #f0fdf4;
  }

  .deduction-slot.incorrect {
    border-color: #b45309;
    background: #fffbeb;
  }

  .deduction-slot span {
    color: #1d2430;
    font-weight: 700;
  }

  .deduction-slot select {
    min-height: 40px;
    width: 100%;
    border: 1px solid #aab6c4;
    border-radius: 6px;
    padding: 0 10px;
    color: #1d2430;
    background: #fff;
    font: inherit;
  }

  .deduction-slot small,
  .side-panel small {
    display: block;
    color: #64748b;
  }

  .primary-action {
    min-height: 42px;
    margin-top: 16px;
    border: 1px solid #6f5132;
    border-radius: 6px;
    padding: 0 16px;
    color: #fffdf8;
    background: #6f5132;
    font: inherit;
    font-weight: 700;
    cursor: pointer;
  }

  .primary-action:hover {
    background: #5d4227;
  }

  .last-theory {
    margin-top: 20px;
  }

  .status-line {
    margin-top: 12px;
    color: #68625a;
    font-size: 0.9rem;
  }

  .error-banner {
    margin: 0 auto 16px;
    max-width: 1120px;
    border: 1px solid #c4644e;
    border-radius: 6px;
    padding: 12px 14px;
    color: #6f2318;
    background: #fff0ec;
  }

  @media (max-width: 720px) {
    .app-shell {
      padding: 20px;
    }

    .case-header {
      display: block;
    }

    .header-actions {
      align-items: flex-start;
      flex-direction: column;
      margin-top: 14px;
    }

    .secondary-action {
      width: 100%;
    }

    .tabs {
      overflow-x: auto;
      padding-bottom: 1px;
    }

    .tabs button {
      flex: 0 0 auto;
    }

    .workbench {
      padding: 18px;
    }

    .panel-grid {
      grid-template-columns: 1fr;
    }
  }
</style>

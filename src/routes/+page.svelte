<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import { onMount } from "svelte";

  type CaseStatus = "Investigating" | "Solved";

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
  let errorMessage = $state<string | null>(null);
  let loading = $state(true);

  let collectedEvidence = $derived(
    caseState?.evidence.filter((evidence) => evidence.collected) ?? [],
  );
  let discoveredStatements = $derived(
    caseState?.statements.filter((statement) => statement.discovered) ?? [],
  );
  let answerOptions = $derived([...collectedEvidence, ...discoveredStatements]);

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
      selectedEvidenceId = null;
      selectedCharacterId = nextCaseState.characters[0]?.id ?? null;
    }

    loading = false;
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
      <button class="secondary-action" type="button" onclick={startCase}>Reset</button>
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
      <p>Workbench wiring complete. Tab content comes next.</p>
      <p class="status-line">
        {caseState.status} · {caseState.scene.title} · {collectedEvidence.length}
        evidence · {discoveredStatements.length} statements · {answerOptions.length}
        answer options · {Object.keys(draftAnswers).length} draft answers
        {#if selectedCharacterId}
          · interviewing {selectedCharacterId}
        {/if}
        {#if selectedEvidenceId}
          · reviewing {selectedEvidenceId}
        {/if}
      </p>
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

    .secondary-action {
      margin-top: 16px;
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
  }
</style>

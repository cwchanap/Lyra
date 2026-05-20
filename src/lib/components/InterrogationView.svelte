<script lang="ts">
  import type { Inventory, SceneView } from "../state/types";

  let {
    scene,
    inventory,
    onAnswerQuestion,
    onPressStatement,
    onPresentItem,
    disabled = false,
  }: {
    scene: SceneView;
    inventory: Inventory;
    onAnswerQuestion: (questionId: string) => void | Promise<void>;
    onPressStatement: (statementId: string) => void | Promise<void>;
    onPresentItem: (statementId: string, itemKind: "evidence" | "statement", itemId: string) => void | Promise<void>;
    disabled?: boolean;
  } = $props();

  let interrogation = $derived(scene.kind === "interrogation" ? scene : null);
  let currentPhase = $derived(
    interrogation?.visiblePhases.find((phase) => phase.id === interrogation.currentPhaseId) ?? null,
  );
</script>

{#if interrogation && currentPhase}
  <section class="interrogation" aria-label="interrogation">
    <header class="phase-header">
      <div>
        <p class="eyebrow">{currentPhase.kind === "inquiry" ? "詢問" : "證詞"}</p>
        <h2>{currentPhase.label}</h2>
        <p class="subject">{currentPhase.subject.name} · {currentPhase.subject.role}</p>
      </div>
      {#if currentPhase.subject.bio}
        <p class="bio">{currentPhase.subject.bio}</p>
      {/if}
    </header>

    {#if currentPhase.kind === "inquiry"}
      <div class="question-grid">
        {#each currentPhase.questions as question (question.id)}
          <button class:done={question.answered} type="button" {disabled} onclick={() => onAnswerQuestion(question.id)}>
            <span>{question.label}</span>
            <small>{question.answered ? "已詢問" : "未詢問"}</small>
          </button>
        {/each}
      </div>
    {:else}
      <div class="testimony-list">
        {#each currentPhase.testimony as statement (statement.id)}
          <article class:pressed={statement.pressed}>
            <header>
              <strong>{statement.label}</strong>
              <small>{statement.pressed ? "已追問" : "未追問"}</small>
            </header>
            <p>{statement.content}</p>
            <div class="statement-actions">
              <button type="button" {disabled} onclick={() => onPressStatement(statement.id)}>
                {statement.pressed ? "再次追問" : "追問"}
              </button>
              {#each inventory.evidence as item (item.id)}
                <button type="button" {disabled} onclick={() => onPresentItem(statement.id, "evidence", item.id)}>
                  提示：{item.name}
                </button>
              {/each}
              {#each inventory.statements as item (item.id)}
                <button type="button" {disabled} onclick={() => onPresentItem(statement.id, "statement", item.id)}>
                  證言：{item.speaker}
                </button>
              {/each}
            </div>
          </article>
        {/each}
      </div>
    {/if}
  </section>
{:else if interrogation}
  <p class="muted">尚未進入任何詢問階段。</p>
{/if}

<style>
  .interrogation {
    display: grid;
    gap: 16px;
    padding: 24px;
    color: #e6edf3;
  }
  .phase-header {
    display: flex;
    justify-content: space-between;
    gap: 24px;
    padding: 16px;
    background: #161b22;
    border: 1px solid #30363d;
    border-radius: 10px;
  }
  .eyebrow {
    margin: 0 0 4px;
    color: #58a6ff;
    font-size: 0.75rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  h2 {
    margin: 0;
    font-size: 1.2rem;
  }
  .subject {
    margin: 6px 0 0;
    color: #8b949e;
  }
  .bio {
    margin: 0;
    max-width: 420px;
    color: #c9d1d9;
    font-size: 0.9rem;
  }
  .question-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 12px;
  }
  .question-grid button {
    min-height: 82px;
    justify-content: space-between;
  }
  button {
    display: flex;
    flex-direction: column;
    gap: 6px;
    text-align: left;
    padding: 12px 14px;
    background: #161b22;
    color: #e6edf3;
    border: 1px solid #30363d;
    border-radius: 8px;
    cursor: pointer;
    font: inherit;
  }
  button:hover {
    border-color: #58a6ff;
  }
  button:disabled {
    cursor: wait;
    opacity: 0.6;
  }
  button:disabled:hover {
    border-color: #30363d;
  }
  button.done,
  article.pressed {
    opacity: 0.78;
  }
  button small,
  article small {
    color: #8b949e;
  }
  .testimony-list {
    display: grid;
    gap: 12px;
  }
  article {
    display: grid;
    gap: 12px;
    padding: 14px;
    background: #161b22;
    border: 1px solid #30363d;
    border-radius: 10px;
  }
  article header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
  }
  article p {
    margin: 0;
    color: #d0d7de;
    line-height: 1.6;
  }
  .statement-actions {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
    gap: 8px;
  }
  .statement-actions button {
    min-height: 46px;
    justify-content: center;
    padding: 8px 10px;
    background: #0d1117;
  }
  .muted {
    padding: 24px;
    color: #8b949e;
  }
</style>

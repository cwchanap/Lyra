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
    onPresentItem: (
      statementId: string,
      itemKind: "evidence" | "statement",
      itemId: string,
    ) => void | Promise<void>;
    disabled?: boolean;
  } = $props();

  let interrogation = $derived(scene.kind === "interrogation" ? scene : null);
  let currentPhase = $derived(
    interrogation?.visiblePhases.find(
      (phase) => phase.id === interrogation.currentPhaseId,
    ) ?? null,
  );
</script>

{#if interrogation && currentPhase}
  <section class="interrogation" aria-label="interrogation">
    <header class="phase">
      <div class="phase-id">
        <span class="kind-marker {currentPhase.kind}">
          <span class="diamond"></span>
          {currentPhase.kind === "inquiry"
            ? "詢問 · INQUIRY"
            : "證詞 · TESTIMONY"}
        </span>
        <h2>{currentPhase.label}</h2>
      </div>
      <div class="subject">
        <div class="subject-id">
          <strong>{currentPhase.subject.name}</strong>
          <small>{currentPhase.subject.role}</small>
        </div>
        {#if currentPhase.subject.bio}
          <p class="bio">{currentPhase.subject.bio}</p>
        {/if}
      </div>
    </header>

    {#if currentPhase.kind === "inquiry"}
      <div class="question-grid">
        {#each currentPhase.questions as question, i (question.id)}
          <button
            class="qcard"
            class:done={question.answered}
            type="button"
            {disabled}
            onclick={() => onAnswerQuestion(question.id)}
          >
            <span class="qnum">Q.{String(i + 1).padStart(2, "0")}</span>
            <span class="qbody">{question.label}</span>
            <span class="qstatus"
              >{question.answered ? "已詢問" : "未詢問"}</span
            >
          </button>
        {/each}
      </div>
    {:else}
      <div class="testimony-list">
        {#each currentPhase.testimony as statement, i (statement.id)}
          <article class="statement" class:pressed={statement.pressed}>
            <header class="statement-head">
              <div class="statement-id">
                <span class="snum">§{String(i + 1).padStart(2, "0")}</span>
                <strong>{statement.label}</strong>
              </div>
              <span class="status"
                >{statement.pressed ? "● 已追問" : "○ 未追問"}</span
              >
            </header>
            <blockquote class="statement-quote">{statement.content}</blockquote>
            <div class="statement-actions">
              <button
                class="primary"
                type="button"
                {disabled}
                onclick={() => onPressStatement(statement.id)}
              >
                <span class="act-mark">▸</span>
                <span>{statement.pressed ? "再次追問" : "追問"}</span>
                <span class="act-en">PRESS</span>
              </button>
              {#if inventory.evidence.length + inventory.statements.length > 0}
                <span class="present-label">提示 · PRESENT</span>
                {#each inventory.evidence as item (item.id)}
                  <button
                    class="secondary"
                    type="button"
                    {disabled}
                    onclick={() =>
                      onPresentItem(statement.id, "evidence", item.id)}
                  >
                    <span class="item-kind">證</span>
                    <span>{item.name}</span>
                  </button>
                {/each}
                {#each inventory.statements as item (item.id)}
                  <button
                    class="secondary"
                    type="button"
                    {disabled}
                    onclick={() =>
                      onPresentItem(statement.id, "statement", item.id)}
                  >
                    <span class="item-kind alt">言</span>
                    <span>{item.speaker}</span>
                  </button>
                {/each}
              {/if}
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
    gap: 18px;
    padding: 16px clamp(20px, 3vw, 40px) 140px;
    color: var(--bone);
  }

  /* phase header */
  .phase {
    display: grid;
    grid-template-columns: minmax(280px, 1fr) minmax(280px, 1.4fr);
    gap: 0;
    background: var(--char);
    border: 1px solid var(--rule-strong);
    border-left: 3px solid var(--crimson);
  }

  .phase-id {
    padding: 18px 20px 20px;
    border-right: 1px solid var(--rule);
  }

  .kind-marker {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    font-family: var(--impact);
    font-weight: 500;
    font-size: 10px;
    letter-spacing: 0.32em;
    color: var(--bone);
    padding: 6px 11px 5px;
    border: 1px solid var(--crimson);
    background: var(--crimson-soft);
    text-transform: uppercase;
    margin-bottom: 10px;
  }

  .kind-marker.testimony {
    border-color: var(--cyan);
    background: var(--cyan-soft);
    color: var(--cyan);
  }

  .diamond {
    width: 5px;
    height: 5px;
    background: var(--crimson);
    transform: rotate(45deg);
    box-shadow: 0 0 7px var(--crimson);
  }

  .kind-marker.testimony .diamond {
    background: var(--cyan);
    box-shadow: 0 0 7px var(--cyan);
  }

  h2 {
    margin: 0;
    font-family: var(--display-jp);
    font-weight: 400;
    font-size: 22px;
    letter-spacing: 0.08em;
    line-height: 1.15;
    color: var(--bone);
    text-shadow: 2px 2px 0 var(--cell);
  }

  .subject {
    padding: 18px 20px 20px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .subject-id strong {
    font-family: var(--display-jp);
    font-weight: 400;
    font-size: 18px;
    letter-spacing: 0.1em;
    color: var(--bone);
    display: block;
  }

  .subject-id small {
    display: inline-block;
    margin-top: 4px;
    font-family: var(--serif-jp);
    font-size: 12px;
    color: var(--bone-dim);
    letter-spacing: 0.06em;
  }

  .bio {
    margin: 0;
    color: var(--bone-dim);
    font-family: var(--serif-jp);
    font-size: 13px;
    line-height: 1.6;
    max-width: 56ch;
  }

  /* inquiry: question grid */
  .question-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
    gap: 12px;
  }

  .qcard {
    position: relative;
    display: grid;
    grid-template-columns: auto 1fr;
    grid-template-rows: auto 1fr;
    column-gap: 12px;
    row-gap: 6px;
    padding: 14px 16px;
    background: var(--char);
    color: var(--bone);
    border: 1px solid var(--rule-strong);
    cursor: pointer;
    font: inherit;
    text-align: left;
    clip-path: polygon(0 0, calc(100% - 14px) 0, 100% 14px, 100% 100%, 0 100%);
    transition:
      transform 0.18s,
      background 0.18s,
      border-color 0.18s;
  }

  .qcard::before {
    content: "";
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    width: 2px;
    background: var(--crimson);
    transform: scaleY(0);
    transform-origin: top center;
    transition: transform 0.22s cubic-bezier(0.6, 0, 0.3, 1);
  }

  .qcard:hover:not(:disabled)::before,
  .qcard:focus-visible:not(:disabled)::before {
    transform: scaleY(1);
  }

  .qcard:hover:not(:disabled),
  .qcard:focus-visible:not(:disabled) {
    transform: translateX(-2px);
    background: var(--char-2);
    border-color: rgba(212, 20, 58, 0.4);
  }

  .qcard:disabled {
    opacity: 0.55;
    cursor: wait;
  }

  .qcard.done {
    opacity: 0.7;
  }

  .qnum {
    grid-column: 1;
    grid-row: 1 / 3;
    align-self: start;
    font-family: var(--impact);
    font-weight: 500;
    font-size: 12px;
    letter-spacing: 0.18em;
    color: var(--crimson);
    padding-right: 12px;
    border-right: 1px solid var(--rule);
    height: 100%;
  }

  .qbody {
    grid-column: 2;
    grid-row: 1;
    font-family: var(--display-jp);
    font-weight: 400;
    font-size: 14px;
    letter-spacing: 0.08em;
    line-height: 1.4;
    color: var(--bone);
  }

  .qstatus {
    grid-column: 2;
    grid-row: 2;
    font-family: var(--mono);
    font-size: 10px;
    letter-spacing: 0.24em;
    color: var(--bone-faint);
    text-transform: uppercase;
  }

  .qcard.done .qnum {
    color: var(--bone-faint);
  }

  /* testimony list */
  .testimony-list {
    display: grid;
    gap: 14px;
  }

  .statement {
    position: relative;
    background: var(--char);
    border: 1px solid var(--rule-strong);
    border-left: 2px solid var(--cyan);
    padding: 16px 18px 18px;
    color: var(--bone);
  }

  .statement.pressed {
    border-left-color: var(--bone-faint);
    opacity: 0.85;
  }

  .statement-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
    padding-bottom: 10px;
    border-bottom: 1px solid var(--rule);
    margin-bottom: 12px;
  }

  .statement-id {
    display: flex;
    align-items: baseline;
    gap: 12px;
  }

  .snum {
    font-family: var(--impact);
    font-weight: 500;
    font-size: 12px;
    letter-spacing: 0.18em;
    color: var(--cyan);
  }

  .statement.pressed .snum {
    color: var(--bone-faint);
  }

  .statement-id strong {
    font-family: var(--display-jp);
    font-weight: 400;
    font-size: 15px;
    letter-spacing: 0.08em;
    color: var(--bone);
  }

  .status {
    font-family: var(--mono);
    font-size: 10px;
    letter-spacing: 0.24em;
    color: var(--bone-faint);
    text-transform: uppercase;
  }

  .statement-quote {
    margin: 0 0 14px;
    padding: 0 0 0 14px;
    border-left: 1px solid var(--rule);
    color: var(--bone);
    font-family: var(--serif-jp);
    font-size: 15px;
    line-height: 1.7;
    font-style: italic;
    quotes: "「" "」";
  }

  .statement-quote::before {
    content: open-quote;
    color: var(--crimson);
    font-family: var(--display-jp);
    font-style: normal;
    margin-right: 2px;
  }

  .statement-quote::after {
    content: close-quote;
    color: var(--crimson);
    font-family: var(--display-jp);
    font-style: normal;
    margin-left: 2px;
  }

  .statement-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
  }

  .present-label {
    flex: 1 0 100%;
    font-family: var(--impact);
    font-weight: 500;
    font-size: 9px;
    letter-spacing: 0.32em;
    color: var(--bone-faint);
    text-transform: uppercase;
    margin: 8px 0 -2px;
  }

  .statement-actions button {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px 7px;
    background: transparent;
    color: var(--bone);
    border: 1px solid var(--rule-strong);
    cursor: pointer;
    font: inherit;
    font-family: var(--serif-jp);
    font-size: 13px;
    letter-spacing: 0.04em;
    transition:
      border-color 0.18s,
      background 0.18s,
      color 0.18s;
  }

  .statement-actions button:hover:not(:disabled) {
    border-color: var(--crimson);
    background: var(--crimson-soft);
  }

  .statement-actions button.primary {
    color: var(--crimson);
    border-color: var(--crimson);
    background: var(--crimson-soft);
  }

  .statement-actions button.primary .act-en {
    color: var(--crimson);
  }

  .statement-actions button:disabled {
    opacity: 0.55;
    cursor: wait;
  }

  .act-mark {
    color: var(--crimson);
  }

  .act-en {
    font-family: var(--mono);
    font-size: 9px;
    letter-spacing: 0.24em;
    color: var(--bone-faint);
    text-transform: uppercase;
    margin-left: 4px;
  }

  .item-kind {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    font-family: var(--display-jp);
    font-size: 10px;
    color: var(--bone);
    background: var(--crimson-deep);
    border: 1px solid var(--crimson);
  }

  .item-kind.alt {
    background: var(--cyan-deep);
    border-color: var(--cyan);
  }

  .muted {
    padding: 24px clamp(20px, 3vw, 40px);
    color: var(--bone-faint);
    font-family: var(--serif-jp);
    font-style: italic;
  }

  @media (max-width: 720px) {
    .phase {
      grid-template-columns: 1fr;
    }
    .phase-id {
      border-right: none;
      border-bottom: 1px solid var(--rule);
    }
  }
</style>

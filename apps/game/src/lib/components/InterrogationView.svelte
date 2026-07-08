<script lang="ts">
  import type { Inventory, SceneView, DialogueItem } from "../state/types";

  let {
    scene,
    inventory,
    onAsk,
    onPresent,
    onResume,
    onComplete,
    disabled = false,
  }: {
    scene: SceneView;
    inventory: Inventory;
    onAsk: (questionId: string) => void | Promise<void>;
    onPresent: (
      lineId: string,
      itemKind: "evidence" | "statement",
      itemId: string,
    ) => void | Promise<void>;
    /** Backs out of the evidence tray to keep listening to the testimony. */
    onResume: () => void | Promise<void>;
    onComplete: () => void | Promise<void>;
    disabled?: boolean;
  } = $props();

  let interrogation = $derived(scene.kind === "interrogation" ? scene : null);
  let phase = $derived(
    interrogation?.visiblePhases.find(
      (p) => p.id === interrogation.currentPhaseId,
    ) ?? null,
  );
  let xexam = $derived(phase?.crossExam ?? null);

  // Only the "line" and "action" arms carry rendered dialogue text (a
  // sceneTag item is stage-setting metadata, not spoken/narrated content
  // that belongs inside a cross-exam line card).
  function lineText(items: DialogueItem[]): string {
    return items
      .filter((item) => item.kind === "line" || item.kind === "action")
      .map((item) => item.text)
      .join("");
  }
</script>

{#if phase}
  <section class="interrogation" aria-label="interrogation">
    <header class="subject">
      <div class="subject-id">
        <strong>{phase.subject.name}</strong>
        <small>{phase.subject.role}</small>
      </div>
      {#if phase.subject.bio}
        <p class="bio">{phase.subject.bio}</p>
      {/if}
    </header>

    {#if xexam?.presenting}
      <article class="line-card presenting">
        <div class="prog">
          <span class="prog-count"
            >{xexam.lineIndex + 1} / {xexam.lineTotal}</span
          >
          <span class="prog-mark">↻</span>
        </div>
        <blockquote class="line">{lineText(xexam.lineContent)}</blockquote>

        <p class="tray-label">針對此句提出證據 · PRESENT</p>
        <div class="tray">
          {#each inventory.evidence as item (item.id)}
            <button
              class="secondary"
              type="button"
              {disabled}
              onclick={() => onPresent(xexam.lineId, "evidence", item.id)}
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
              onclick={() => onPresent(xexam.lineId, "statement", item.id)}
            >
              <span class="item-kind alt">言</span>
              <span>{item.speaker}</span>
            </button>
          {/each}
          <button
            class="ghost"
            type="button"
            {disabled}
            onclick={() => onResume()}
          >
            收回
          </button>
        </div>
      </article>
    {:else}
      <ul class="menu">
        {#each phase.questions as question (question.id)}
          <li>
            <button
              class="qbtn"
              class:broken={question.broken}
              type="button"
              {disabled}
              onclick={() => onAsk(question.id)}
            >
              <span class="ql">{question.label}</span>
              <span class="qs">{question.broken ? "已破" : "提問"}</span>
            </button>
          </li>
        {/each}
      </ul>
      <div class="phase-actions">
        <button
          class="complete"
          type="button"
          disabled={disabled || !phase.canComplete}
          onclick={() => onComplete()}
        >
          完成訊問
        </button>
      </div>
    {/if}
  </section>
{:else if interrogation}
  <p class="muted">尚未進入任何訊問階段。</p>
{/if}

<style>
  .interrogation {
    display: grid;
    gap: 18px;
    padding: 16px clamp(20px, 3vw, 40px) 140px;
    color: var(--bone);
  }

  /* subject header */
  .subject {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 18px 20px 20px;
    background: var(--char);
    border: 1px solid var(--rule-strong);
    border-left: 3px solid var(--crimson);
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

  /* question menu */
  .menu {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
    gap: 12px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .qbtn {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    width: 100%;
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

  .qbtn::before {
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

  .qbtn:hover:not(:disabled)::before,
  .qbtn:focus-visible:not(:disabled)::before {
    transform: scaleY(1);
  }

  .qbtn:hover:not(:disabled),
  .qbtn:focus-visible:not(:disabled) {
    transform: translateX(-2px);
    background: var(--char-2);
    border-color: rgba(212, 20, 58, 0.4);
  }

  .qbtn:disabled {
    opacity: 0.55;
    cursor: wait;
  }

  .qbtn.broken {
    opacity: 0.7;
  }

  .ql {
    font-family: var(--display-jp);
    font-weight: 400;
    font-size: 14px;
    letter-spacing: 0.08em;
    line-height: 1.4;
    color: var(--bone);
  }

  .qs {
    flex: none;
    font-family: var(--mono);
    font-size: 10px;
    letter-spacing: 0.24em;
    color: var(--crimson);
    text-transform: uppercase;
  }

  .qbtn.broken .qs {
    color: var(--bone-faint);
  }

  /* complete-phase action */
  .phase-actions {
    display: flex;
    justify-content: flex-end;
    margin-top: 4px;
  }

  .complete {
    padding: 11px 22px 10px;
    background: var(--crimson-soft);
    color: var(--crimson);
    border: 1px solid var(--crimson);
    cursor: pointer;
    font: inherit;
    font-family: var(--display-jp);
    font-size: 13px;
    letter-spacing: 0.16em;
    clip-path: polygon(0 0, calc(100% - 12px) 0, 100% 12px, 100% 100%, 0 100%);
    transition:
      transform 0.18s,
      background 0.18s,
      border-color 0.18s,
      color 0.18s;
  }

  .complete:hover:not(:disabled),
  .complete:focus-visible:not(:disabled) {
    transform: translateY(-1px);
    background: var(--crimson);
    color: var(--bone);
  }

  .complete:disabled {
    opacity: 0.4;
    cursor: not-allowed;
    color: var(--bone-faint);
    background: transparent;
    border-color: var(--rule-strong);
  }

  /* cross-exam line card */
  .line-card {
    position: relative;
    background: var(--char);
    border: 1px solid var(--rule-strong);
    border-left: 2px solid var(--cyan);
    padding: 16px 18px 18px;
    color: var(--bone);
  }

  .line-card.presenting {
    border-left-color: var(--crimson);
  }

  .prog {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
    padding-bottom: 10px;
    border-bottom: 1px solid var(--rule);
    margin-bottom: 12px;
  }

  .prog-count {
    font-family: var(--impact);
    font-weight: 500;
    font-size: 12px;
    letter-spacing: 0.18em;
    color: var(--cyan);
  }

  .line-card.presenting .prog-count {
    color: var(--crimson);
  }

  .prog-mark {
    font-family: var(--mono);
    font-size: 10px;
    letter-spacing: 0.24em;
    color: var(--bone-faint);
  }

  .line {
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

  .line::before {
    content: open-quote;
    color: var(--crimson);
    font-family: var(--display-jp);
    font-style: normal;
    margin-right: 2px;
  }

  .line::after {
    content: close-quote;
    color: var(--crimson);
    font-family: var(--display-jp);
    font-style: normal;
    margin-left: 2px;
  }

  .tray {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
  }

  .tray-label {
    flex: 1 0 100%;
    font-family: var(--impact);
    font-weight: 500;
    font-size: 9px;
    letter-spacing: 0.32em;
    color: var(--bone-faint);
    text-transform: uppercase;
    margin: 0 0 6px;
  }

  .tray button {
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

  .tray button:hover:not(:disabled) {
    border-color: var(--crimson);
    background: var(--crimson-soft);
  }

  .tray button.ghost {
    color: var(--bone-faint);
  }

  .tray button:disabled {
    opacity: 0.55;
    cursor: wait;
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
    /* lyra-mobile-breakpoint — see tokens.css. */
    .menu {
      grid-template-columns: 1fr;
    }
  }
</style>

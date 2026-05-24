<script lang="ts">
  import type { CharacterView } from "../state/types";

  let {
    characters,
    onInterview,
    disabled = false,
  }: {
    characters: CharacterView[];
    onInterview: (cId: string, tId: string) => void;
    disabled?: boolean;
  } = $props();
</script>

{#if characters.length > 0}
  <section class="section">
    <header class="section-header">
      <span class="eyebrow">證人 · WITNESSES</span>
      <span class="count">{characters.length} 名</span>
    </header>

    <div class="list">
      {#each characters as c (c.id)}
        <article class="witness">
          <header class="who">
            <div class="who-text">
              <strong>{c.name}</strong>
              <small>{c.role}</small>
            </div>
            <span class="badge">WITNESS</span>
          </header>
          <p class="bio">{c.bio}</p>
          <div class="topics">
            <span class="topics-label">詢問項目 · TOPICS</span>
            {#each c.topics as t (t.id)}
              <button class:done={t.discussed} type="button" {disabled} onclick={() => onInterview(c.id, t.id)}>
                <span class="topic-mark">{t.discussed ? "▣" : "▸"}</span>
                <span class="topic-label">{t.label}</span>
                {#if t.discussed}
                  <span class="topic-status">已詢問</span>
                {/if}
              </button>
            {/each}
          </div>
        </article>
      {/each}
    </div>
  </section>
{/if}

<style>
  .section {
    padding: 8px clamp(20px, 3vw, 40px) 140px;
  }

  .section-header {
    display: flex;
    align-items: baseline;
    gap: 14px;
    margin-bottom: 10px;
  }

  .eyebrow {
    font-family: var(--impact);
    font-weight: 500;
    font-size: 10px;
    letter-spacing: 0.32em;
    color: var(--cyan);
    text-transform: uppercase;
  }

  .count {
    font-family: var(--mono);
    font-size: 11px;
    letter-spacing: 0.18em;
    color: var(--bone-faint);
  }

  .list {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
    gap: 14px;
  }

  .witness {
    position: relative;
    background: var(--char);
    border: 1px solid var(--rule-strong);
    border-left: 2px solid var(--crimson);
    padding: 14px 16px 16px;
    color: var(--bone);
  }

  .who {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
    padding-bottom: 8px;
    border-bottom: 1px solid var(--rule);
  }

  .who-text strong {
    display: block;
    font-family: var(--display-jp);
    font-weight: 400;
    font-size: 18px;
    letter-spacing: 0.1em;
    line-height: 1;
    color: var(--bone);
  }

  .who-text small {
    display: inline-block;
    margin-top: 4px;
    font-family: var(--serif-jp);
    font-size: 12px;
    color: var(--bone-dim);
    letter-spacing: 0.06em;
  }

  .badge {
    flex: 0 0 auto;
    padding: 3px 7px 2px;
    font-family: var(--impact);
    font-weight: 500;
    font-size: 9px;
    letter-spacing: 0.28em;
    color: var(--cyan);
    border: 1px solid var(--cyan-deep);
    background: var(--cyan-soft);
    text-transform: uppercase;
  }

  .bio {
    margin: 10px 0 12px;
    color: var(--bone-dim);
    font-family: var(--serif-jp);
    font-size: 13px;
    line-height: 1.6;
  }

  .topics {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .topics-label {
    font-family: var(--impact);
    font-weight: 500;
    font-size: 9px;
    letter-spacing: 0.32em;
    color: var(--bone-faint);
    text-transform: uppercase;
    margin-bottom: 4px;
  }

  .topics button {
    display: grid;
    grid-template-columns: 16px 1fr auto;
    gap: 10px;
    align-items: center;
    text-align: left;
    padding: 8px 10px;
    background: transparent;
    border: 1px solid var(--rule);
    color: var(--bone);
    cursor: pointer;
    font: inherit;
    font-family: var(--serif-jp);
    font-size: 13px;
    transition: border-color 0.18s, background 0.18s;
  }

  .topics button:hover:not(:disabled) {
    border-color: var(--crimson);
    background: var(--crimson-soft);
  }

  .topics button:disabled {
    opacity: 0.55;
    cursor: wait;
  }

  .topics button.done {
    opacity: 0.62;
  }

  .topic-mark {
    color: var(--crimson);
    font-family: var(--mono);
    font-size: 12px;
  }

  .topics button.done .topic-mark {
    color: var(--bone-faint);
  }

  .topic-label {
    flex: 1 1 auto;
  }

  .topic-status {
    font-family: var(--mono);
    font-size: 9px;
    letter-spacing: 0.24em;
    color: var(--bone-faint);
    text-transform: uppercase;
  }
</style>

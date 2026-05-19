<script lang="ts">
  import type { CharacterView } from "../state/types";
  let { characters, onInterview, disabled = false }: {
    characters: CharacterView[];
    onInterview: (cId: string, tId: string) => void;
    disabled?: boolean;
  } = $props();
</script>

{#if characters.length > 0}
  <section class="list">
    {#each characters as c (c.id)}
      <article>
        <header>
          <strong>{c.name}</strong>
          <small>{c.role}</small>
        </header>
        <p class="bio">{c.bio}</p>
        <div class="topics">
          {#each c.topics as t (t.id)}
            <button class:done={t.discussed} type="button" {disabled} onclick={() => onInterview(c.id, t.id)}>
              • {t.label}
            </button>
          {/each}
        </div>
      </article>
    {/each}
  </section>
{/if}

<style>
  .list { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 16px; padding: 12px 24px; }
  article { background: #161b22; border: 1px solid #30363d; border-radius: 10px; padding: 14px; color: #e6edf3; }
  header strong { display: block; }
  header small { color: #8b949e; }
  .bio { margin: 8px 0 12px; color: #c9d1d9; font-size: 0.9rem; }
  .topics { display: flex; flex-direction: column; gap: 6px; }
  .topics button {
    text-align: left; padding: 8px 10px; background: #0d1117; border: 1px solid #30363d;
    border-radius: 6px; color: #d0d7de; cursor: pointer; font: inherit;
  }
  .topics button:hover { border-color: #58a6ff; }
  .topics button.done { opacity: 0.7; }
  .topics button:disabled { cursor: wait; opacity: 0.6; }
</style>

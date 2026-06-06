<main class="app-shell">
  <section class="intro-panel" aria-labelledby="editor-title">
    <p class="eyebrow">Developer Tool</p>
    <h1 id="editor-title">Lyra Layout Editor</h1>
    <p class="summary">
      Select a compiled investigation scene to inspect and adjust layout
      metadata.
    </p>
  </section>
</main>

<style>
  :global(body) {
    margin: 0;
    min-width: 320px;
    min-height: 100vh;
    font-family:
      Inter,
      ui-sans-serif,
      system-ui,
      -apple-system,
      BlinkMacSystemFont,
      "Segoe UI",
      sans-serif;
    color: #1e2428;
    background: #f4f1ec;
  }

  :global(button),
  :global(input),
  :global(select),
  :global(textarea) {
    font: inherit;
  }

  .app-shell {
    min-height: 100vh;
    display: grid;
    place-items: center;
    padding: 48px;
    box-sizing: border-box;
  }

  .intro-panel {
    width: min(720px, 100%);
    border: 1px solid #d7d2c8;
    border-radius: 8px;
    background: #fffcf7;
    padding: 32px;
    box-sizing: border-box;
    box-shadow: 0 16px 40px rgb(39 35 29 / 10%);
  }

  .eyebrow {
    margin: 0 0 12px;
    color: #5f6b64;
    font-size: 0.78rem;
    font-weight: 700;
    letter-spacing: 0;
    text-transform: uppercase;
  }

  h1 {
    margin: 0;
    font-size: 2.25rem;
    line-height: 1.1;
    letter-spacing: 0;
  }

  .summary {
    margin: 18px 0 0;
    max-width: 54ch;
    color: #4f5756;
    font-size: 1rem;
    line-height: 1.6;
  }

  @media (max-width: 640px) {
    .app-shell {
      padding: 24px;
      place-items: stretch;
      align-content: center;
    }

    .intro-panel {
      padding: 24px;
    }

    h1 {
      font-size: 1.8rem;
    }
  }
</style>

<script lang="ts">
  import { onDestroy } from "svelte";
  import {
    assetUsageGroups,
    projectAssetWorkspace,
    sceneCueRows,
    type AssetWorkspace,
  } from "./asset-workspace";
  import { loadAssetWorkspace } from "./workbench-api";

  let {
    selectedChapterId,
    selectedSceneId,
    onSelectScene,
  }: {
    selectedChapterId: string | null;
    selectedSceneId: string | null;
    onSelectScene: (chapterId: string, sceneId: string) => void;
  } = $props();

  type LibraryEntry = AssetWorkspace["library"][number];
  type Section = "cues" | "library" | "characters";
  type KindFilter =
    | "all"
    | Exclude<LibraryEntry["type"], "audio">
    | "bgm"
    | "bgs";

  const KIND_FILTERS: Array<{ value: KindFilter; label: string }> = [
    { value: "all", label: "All kinds" },
    { value: "background", label: "background" },
    { value: "portrait", label: "portrait" },
    { value: "standee", label: "standee" },
    { value: "evidence", label: "evidence" },
    { value: "bgm", label: "bgm" },
    { value: "bgs", label: "bgs" },
  ];

  const AUDIO_STATE_LABELS = {
    inherit: "Inherit",
    stop: "Stop",
    set: "Set",
  } as const;

  let workspace = $state<AssetWorkspace | null>(null);
  let loadError = $state<string | null>(null);
  let section = $state<Section>("cues");
  let selectedAssetId = $state<string | null>(null);
  let kindFilter = $state<KindFilter>("all");
  let assetSearch = $state("");
  let copyStatus = $state<string | null>(null);

  // One component-local load generation counter: every Refresh (or destroy)
  // invalidates all older in-flight loads, so a slower older snapshot can
  // never overwrite a newer one. No watcher/polling — Refresh only rereads
  // the snapshot.
  let loadGeneration = 0;

  async function refresh(): Promise<void> {
    const generation = ++loadGeneration;
    loadError = null;
    try {
      const payload = await loadAssetWorkspace();
      if (generation !== loadGeneration) return;
      workspace = projectAssetWorkspace(payload);
    } catch (error) {
      if (generation !== loadGeneration) return;
      loadError = error instanceof Error ? error.message : String(error);
    }
  }
  onDestroy(() => {
    ++loadGeneration;
  });
  void refresh();

  const selectedScene = $derived.by(() => {
    if (!workspace) return null;
    return (
      workspace.scenes.find(
        (scene) =>
          scene.chapterId === selectedChapterId &&
          scene.sceneId === selectedSceneId,
      ) ?? null
    );
  });

  const cueRows = $derived.by(() => {
    if (!workspace || !selectedScene) return [];
    return sceneCueRows(
      workspace,
      selectedScene.chapterId,
      selectedScene.sceneId,
    );
  });

  const entryByAssetId = $derived(
    new Map(
      (workspace?.manifest.entries ?? []).map((entry) => [
        entry.assetId,
        entry,
      ]),
    ),
  );

  const libraryRows = $derived.by(() => {
    const needle = assetSearch.trim().toLowerCase();
    return (workspace?.manifest.entries ?? []).filter((entry) => {
      if (kindFilter !== "all" && kindOf(entry) !== kindFilter) return false;
      return needle === "" || entry.assetId.toLowerCase().includes(needle);
    });
  });

  const selectedEntry = $derived.by(() => {
    if (!workspace || selectedAssetId === null) return null;
    return (
      workspace.manifest.entries.find(
        (entry) => entry.assetId === selectedAssetId,
      ) ?? null
    );
  });

  const usageRows = $derived.by(() => {
    if (!workspace || selectedAssetId === null) return [];
    return workspace.sceneUsages.filter(
      (usage) => usage.assetId === selectedAssetId,
    );
  });

  // Asset ids are dot-joined slugs (`portrait.akane.standard`), so a plain
  // `message.includes(id)` prefix-collides: `portrait.akane.standard` would
  // also match a diagnostic for `portrait.akane.standard_alt`. The producers
  // emit two formats — `references "${id}"` (quoted) and
  // `(assetId: ${id}, type:` (unquoted, comma-delimited) — so match the id
  // only when bounded by non-id characters on both sides, which handles both
  // formats and prevents longer-id prefix matches.
  function assetIdMentionedIn(message: string, id: string): boolean {
    const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(?<![a-z0-9_.])${escaped}(?![a-z0-9_.])`).test(message);
  }

  const assetDiagnostics = $derived.by(() => {
    if (!workspace || selectedAssetId === null) return [];
    const id = selectedAssetId;
    return [...workspace.report.warnings, ...workspace.diagnostics].filter(
      (diagnostic) => assetIdMentionedIn(diagnostic.message, id),
    );
  });

  // Workspace-wide facts only: compiler report warnings (including missing
  // expected files), unresolved joins, and shared config-read failures. No
  // approval/status model is derived on top.
  const workspaceDiagnostics = $derived(
    workspace === null
      ? []
      : [...workspace.report.warnings, ...workspace.diagnostics],
  );

  // Snapshot-scoped presence set: rebuilt only when the workspace snapshot
  // changes, so per-entry presence checks stay O(1) instead of O(n) scans.
  const existingAssetPathSet = $derived(
    new Set(workspace?.existingAssetPaths ?? []),
  );

  function kindOf(entry: LibraryEntry): string {
    return entry.type === "audio" ? entry.source.channel : entry.type;
  }

  // Presence joins on the repo-relative path family (`static/assets/...`):
  // `existingAssetPaths` comes from Rust in that shape, and manifest/model
  // `expectedPath` is its matching pair. publicPath (`/assets/...`) is the
  // URL form and never compares equal (F1).
  function isPathPresent(repoRelativePath: string): boolean {
    return existingAssetPathSet.has(repoRelativePath);
  }

  function isPresent(entry: LibraryEntry): boolean {
    return isPathPresent(entry.expectedPath);
  }

  function audioLabel(
    channel: "bgm" | "bgs",
    state: "inherit" | "stop" | "set",
  ): string {
    return `${channel.toUpperCase()} ${AUDIO_STATE_LABELS[state]}`;
  }

  function selectAsset(assetId: string): void {
    selectedAssetId = assetId;
    copyStatus = null;
    section = "library";
  }

  function assetSourceReference(entry: LibraryEntry): string {
    const scene = workspace?.scenes.find(
      (candidate) =>
        candidate.chapterId === entry.source.chapterId &&
        candidate.sceneId === entry.source.sceneId,
    );
    return scene
      ? scene.sourcePath
      : `${entry.source.chapterId}/${entry.source.sceneId}`;
  }

  async function copyText(text: string, okMessage: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      copyStatus = okMessage;
    } catch {
      copyStatus = "Copy failed";
    }
  }
</script>

{#snippet assetChip(
  label: string,
  assetId: string,
  type: LibraryEntry["type"] | null,
)}
  {@const entry = entryByAssetId.get(assetId)}
  <p class="m-0 flex flex-wrap items-center gap-2 text-[0.9rem]">
    <span
      class="inline-block rounded bg-[#eef2ee] px-1.5 py-0.5 text-[0.7rem] font-bold tracking-wide text-[#5f6b64] uppercase"
      >{label}</span
    >
    <button
      type="button"
      class="cursor-pointer rounded border border-[#e4ded3] bg-white px-1.5 py-0.5 hover:border-[#57776a]"
      data-asset-id={assetId}
      onclick={() => selectAsset(assetId)}>{assetId}</button
    >
    {#if entry}
      <span class="text-[0.75rem] text-[#60706b]"
        >{isPresent(entry) ? "Present" : "Missing"}</span
      >
      {#if type === "background" && entry.publicPath && isPresent(entry)}
        <img
          class="h-12 w-20 rounded object-cover"
          src={entry.publicPath}
          alt={assetId}
        />
      {/if}
      {#if entry.type === "portrait"}
        <span class="text-[0.75rem] text-[#60706b]"
          >expression: {entry.source.expression}</span
        >
      {/if}
    {:else}
      <span class="text-[0.75rem] font-bold text-[#f07f5f]">Unresolved</span>
    {/if}
  </p>
{/snippet}

{#snippet inspector(entry: LibraryEntry)}
  <section
    class="grid gap-2 rounded border border-[#e4ded3] p-3"
    aria-label="Asset inspector"
  >
    <h3 class="m-0 break-all">{entry.assetId}</h3>
    <p class="m-0">Kind: {kindOf(entry)}</p>
    <p class="m-0">{isPresent(entry) ? "Present" : "Missing"}</p>
    <p class="m-0">Expected path: <code>{entry.expectedPath}</code></p>
    <p class="m-0">Public path: <code>{entry.publicPath}</code></p>
    <div class="grid gap-1">
      <h4 class="m-0 text-[0.8rem] tracking-wide text-[#5f6b64] uppercase">
        Manifest source
      </h4>
      {#each Object.entries(entry.source) as [key, value] (key)}
        <p class="m-0 text-[0.85rem]">{key}: {value}</p>
      {/each}
    </div>
    <div class="grid gap-1">
      <h4 class="m-0 text-[0.8rem] tracking-wide text-[#5f6b64] uppercase">
        Prompt parts
      </h4>
      <p class="m-0 text-[0.85rem]">
        Global style: {entry.promptParts.globalStyle}
      </p>
      <p class="m-0 text-[0.85rem]">
        Type prompt: {entry.promptParts.typePrompt}
      </p>
      <p class="m-0 text-[0.85rem]">
        Subject prompt: {entry.promptParts.subjectPrompt}
      </p>
      <p class="m-0 text-[0.85rem]">
        Entry prompt: {entry.promptParts.entryPrompt}
      </p>
      <pre
        class="m-0 overflow-x-auto rounded bg-[#f6f4ee] p-2 text-[0.8rem] whitespace-pre-wrap"
        data-final-prompt>{entry.finalPrompt}</pre>
    </div>
    {#if entry.type !== "audio" && entry.publicPath && isPresent(entry)}
      <img
        class="max-h-40 w-fit rounded"
        src={entry.publicPath}
        alt={entry.assetId}
      />
    {/if}
    {#if (kindOf(entry) === "bgm" || kindOf(entry) === "bgs") && isPresent(entry)}
      <audio controls src={entry.publicPath}></audio>
    {/if}
    <div class="flex gap-2">
      <button
        type="button"
        class="cursor-pointer rounded border border-[#e4ded3] bg-white px-2 py-1 hover:border-[#57776a]"
        onclick={() => void copyText(entry.finalPrompt, "Copied prompt")}
      >
        Copy prompt
      </button>
      <button
        type="button"
        class="cursor-pointer rounded border border-[#e4ded3] bg-white px-2 py-1 hover:border-[#57776a]"
        onclick={() =>
          void copyText(assetSourceReference(entry), "Copied source")}
      >
        Copy source
      </button>
    </div>
    {#if copyStatus}
      <p class="m-0 text-[0.85rem]" role="status">{copyStatus}</p>
    {/if}
    <div class="grid gap-1">
      <h4 class="m-0 text-[0.8rem] tracking-wide text-[#5f6b64] uppercase">
        Usages: {usageRows.length}
      </h4>
      {#if usageRows.length === 0}
        <p class="m-0 text-[0.85rem]">Not referenced by any scene cue.</p>
      {:else}
        <ul class="m-0 grid list-none gap-1 p-0" aria-label="Asset usages">
          {#each usageRows as usage ([usage.chapterId, usage.sceneId, usage.carrierId, usage.role, usage.itemIndex === null ? "" : String(usage.itemIndex)].join("\u0000"))}
            <li>
              <button
                type="button"
                class="w-fit cursor-pointer rounded border border-[#e4ded3] bg-white px-2 py-0.5 text-left text-[0.85rem] hover:border-[#57776a]"
                title="Select this usage's scene"
                onclick={() => onSelectScene(usage.chapterId, usage.sceneId)}
              >
                {`${usage.chapterId} / ${usage.sceneId} · ${usage.carrierId} · ${usage.role}`}
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    </div>
    {#if assetDiagnostics.length > 0}
      <div class="grid gap-1">
        <h4 class="m-0 text-[0.8rem] tracking-wide text-[#5f6b64] uppercase">
          Diagnostics
        </h4>
        <ul class="m-0 grid list-none gap-1 p-0">
          {#each assetDiagnostics as diagnostic, index (index)}
            <li class="text-[0.85rem] text-[#b3543e]">
              {diagnostic.code}: {diagnostic.message}
            </li>
          {/each}
        </ul>
      </div>
    {/if}
  </section>
{/snippet}

<section class="assets-view grid content-start gap-4" aria-label="Assets">
  <div class="flex flex-wrap items-center gap-3">
    <div role="tablist" aria-label="Assets sections" class="flex gap-1">
      <button
        role="tab"
        id="assets-tab-cues"
        aria-selected={section === "cues"}
        aria-controls="assets-panel"
        class="cursor-pointer rounded border border-[#e4ded3] bg-white px-2 py-1 hover:border-[#57776a] {section ===
        'cues'
          ? 'font-bold'
          : ''}"
        onclick={() => (section = "cues")}
      >
        Scene cues
      </button>
      <button
        role="tab"
        id="assets-tab-library"
        aria-selected={section === "library"}
        aria-controls="assets-panel"
        class="cursor-pointer rounded border border-[#e4ded3] bg-white px-2 py-1 hover:border-[#57776a] {section ===
        'library'
          ? 'font-bold'
          : ''}"
        onclick={() => (section = "library")}
      >
        Library
      </button>
      <button
        role="tab"
        id="assets-tab-characters"
        aria-selected={section === "characters"}
        aria-controls="assets-panel"
        class="cursor-pointer rounded border border-[#e4ded3] bg-white px-2 py-1 hover:border-[#57776a] {section ===
        'characters'
          ? 'font-bold'
          : ''}"
        onclick={() => (section = "characters")}
      >
        Characters
      </button>
    </div>
    <button
      type="button"
      class="cursor-pointer rounded border border-[#e4ded3] bg-white px-2 py-1 hover:border-[#57776a]"
      onclick={() => void refresh()}
    >
      Refresh
    </button>
  </div>

  {#if loadError}
    <p class="m-0 text-[#b3543e]" role="alert">
      Failed to load asset workspace: {loadError}
    </p>
  {/if}

  <div
    role="tabpanel"
    id="assets-panel"
    aria-labelledby={`assets-tab-${section}`}
    class="grid content-start gap-4"
  >
    {#if workspace === null}
      {#if !loadError}
        <p class="m-0">Loading asset workspace…</p>
      {/if}
    {:else if section === "cues"}
      <section class="grid gap-3" aria-label="Scene cues">
        {#if selectedScene === null}
          <p class="m-0">Select a scene to inspect its asset cues.</p>
        {:else}
          <header class="grid gap-1">
            <h3 class="m-0">
              {selectedScene.chapterId} / {selectedScene.sceneId}
            </h3>
            <button
              type="button"
              class="w-fit cursor-pointer rounded border border-[#e4ded3] bg-white px-2 py-0.5 text-left hover:border-[#57776a]"
              title="Copy source reference"
              onclick={() =>
                void copyText(selectedScene.sourcePath, "Copied source")}
            >
              <code class="text-[0.75rem] text-[#60706b]"
                >{selectedScene.sourcePath}</code
              >
            </button>
          </header>
          <ul class="m-0 grid list-none gap-2 p-0" aria-label="Scene cue rows">
            {#each cueRows as row, index (index)}
              <li
                class="grid gap-1.5 rounded border border-[#e4ded3] p-2"
                data-cue-row
              >
                <p class="m-0 text-[0.75rem] text-[#60706b]">
                  <code>{row.carrierId}</code>{#if row.itemIndex !== null}<span>
                      · item {row.itemIndex}</span
                    >{/if}
                </p>
                {#if row.kind === "visualCue"}
                  {#if row.background}
                    {@render assetChip(
                      "Background",
                      row.background.assetId,
                      row.background.type,
                    )}
                  {/if}
                  {#if row.bgm.assetId !== null}
                    <p
                      class="m-0 flex flex-wrap items-center gap-2 text-[0.9rem]"
                    >
                      <span>{audioLabel("bgm", row.bgm.state)}</span>
                      <button
                        type="button"
                        class="cursor-pointer rounded border border-[#e4ded3] bg-white px-1.5 py-0.5 hover:border-[#57776a]"
                        data-asset-id={row.bgm.assetId}
                        onclick={() => selectAsset(row.bgm.assetId!)}
                      >
                        {row.bgm.assetId}
                      </button>
                    </p>
                  {:else}
                    <p class="m-0 text-[0.9rem]">
                      {audioLabel("bgm", row.bgm.state)}
                    </p>
                  {/if}
                  {#if row.bgs.assetId !== null}
                    <p
                      class="m-0 flex flex-wrap items-center gap-2 text-[0.9rem]"
                    >
                      <span>{audioLabel("bgs", row.bgs.state)}</span>
                      <button
                        type="button"
                        class="cursor-pointer rounded border border-[#e4ded3] bg-white px-1.5 py-0.5 hover:border-[#57776a]"
                        data-asset-id={row.bgs.assetId}
                        onclick={() => selectAsset(row.bgs.assetId!)}
                      >
                        {row.bgs.assetId}
                      </button>
                    </p>
                  {:else}
                    <p class="m-0 text-[0.9rem]">
                      {audioLabel("bgs", row.bgs.state)}
                    </p>
                  {/if}
                {:else if row.kind === "portrait"}
                  {@render assetChip("Portrait", row.assetId, row.type)}
                {:else if row.kind === "evidence"}
                  {@render assetChip("Evidence", row.assetId, row.type)}
                {:else}
                  {@render assetChip("Sprite", row.assetId, row.type)}
                {/if}
              </li>
            {/each}
          </ul>
          {#if cueRows.length === 0}
            <p class="m-0">This scene has no asset cues.</p>
          {/if}
        {/if}
      </section>
    {:else if section === "library"}
      <section class="grid gap-3" aria-label="Library">
        <div class="flex flex-wrap items-center gap-3 text-[0.85rem]">
          <label class="flex items-center gap-1">
            Kind
            <select bind:value={kindFilter}>
              {#each KIND_FILTERS as filter (filter.value)}
                <option value={filter.value}>{filter.label}</option>
              {/each}
            </select>
          </label>
          <label class="flex items-center gap-1">
            Search assets
            <input type="search" bind:value={assetSearch} />
          </label>
        </div>
        <ul class="m-0 grid list-none gap-1 p-0" aria-label="Asset library">
          {#each libraryRows as entry (entry.assetId)}
            <li>
              <button
                type="button"
                class="flex w-full items-center gap-2 rounded border border-[#e4ded3] bg-white px-2 py-1 text-left hover:border-[#57776a] {selectedAssetId ===
                entry.assetId
                  ? 'border-[#57776a]'
                  : ''}"
                aria-label={entry.assetId}
                onclick={() => (selectedAssetId = entry.assetId)}
              >
                <span
                  class="inline-block rounded bg-[#eef2ee] px-1.5 py-0.5 text-[0.7rem] font-bold tracking-wide text-[#5f6b64] uppercase"
                  >{kindOf(entry)}</span
                >
                <code class="break-all text-[0.85rem]">{entry.assetId}</code>
                <span class="ml-auto text-[0.75rem] text-[#60706b]"
                  >{isPresent(entry) ? "Present" : "Missing"}</span
                >
              </button>
            </li>
          {/each}
        </ul>
        {#if libraryRows.length === 0}
          <p class="m-0">No assets match the current filters.</p>
        {/if}
        {#if selectedEntry}
          {@render inspector(selectedEntry)}
        {:else}
          <p class="m-0">
            Select a Library asset to inspect its manifest record.
          </p>
        {/if}
      </section>
    {:else if section === "characters"}
      <section class="grid gap-3" aria-label="Characters">
        {#each workspace.characters as character (character.id)}
          <article
            class="grid gap-2 rounded border border-[#e4ded3] p-3"
            aria-label={character.id}
          >
            <header class="grid gap-1">
              <h3 class="m-0 break-all">{character.id}</h3>
              <p class="m-0">{character.displayNames.join("、")}</p>
              {#if character.visualPrompt}
                <p class="m-0 text-[0.85rem] text-[#60706b]">
                  {character.visualPrompt}
                </p>
              {/if}
            </header>
            {#if character.portraitMode === "portrait"}
              <ul class="m-0 grid list-none gap-2 p-0" aria-label="Expressions">
                {#each character.expressions as expression (expression.assetId)}
                  {@const groups = assetUsageGroups(
                    workspace,
                    expression.assetId,
                  )}
                  <li
                    class="grid gap-1.5 rounded border border-[#e4ded3] p-2"
                    data-expression-row
                    data-expression-id={expression.expressionId}
                  >
                    <p class="m-0 flex flex-wrap items-center gap-2">
                      <span
                        class="inline-block rounded bg-[#eef2ee] px-1.5 py-0.5 text-[0.7rem] font-bold tracking-wide text-[#5f6b64] uppercase"
                        >{expression.expressionId}</span
                      >
                      <button
                        type="button"
                        class="cursor-pointer rounded border border-[#e4ded3] bg-white px-1.5 py-0.5 hover:border-[#57776a]"
                        data-asset-id={expression.assetId}
                        onclick={() => selectAsset(expression.assetId)}
                      >
                        {expression.assetId}
                      </button>
                      <span class="text-[0.75rem] text-[#60706b]">
                        {isPathPresent(expression.expectedPath)
                          ? "Present"
                          : "Missing"}
                      </span>
                      <span class="text-[0.75rem] text-[#60706b]">
                        Usages: {expression.usages}
                      </span>
                    </p>
                    <p class="m-0 text-[0.85rem]">{expression.prompt}</p>
                    <p class="m-0 text-[0.75rem] text-[#60706b]">
                      <code>{expression.expectedPath}</code> ·
                      <code>{expression.publicPath}</code>
                    </p>
                    {#if groups.scenes.length > 0}
                      <div class="grid gap-1">
                        <h4
                          class="m-0 text-[0.8rem] tracking-wide text-[#5f6b64] uppercase"
                        >
                          Scenes
                        </h4>
                        <ul class="m-0 grid list-none gap-1 p-0">
                          {#each groups.scenes as group (`${group.chapterId}\u0000${group.sceneId}`)}
                            <li>
                              <button
                                type="button"
                                class="w-fit cursor-pointer rounded border border-[#e4ded3] bg-white px-2 py-0.5 text-left text-[0.85rem] hover:border-[#57776a]"
                                title="Select this usage's scene"
                                onclick={() =>
                                  onSelectScene(group.chapterId, group.sceneId)}
                              >
                                {`${group.chapterId} / ${group.sceneId}`}
                              </button>
                            </li>
                          {/each}
                        </ul>
                      </div>
                    {/if}
                    {#if groups.sprites.length > 0}
                      <div class="grid gap-1">
                        <h4
                          class="m-0 text-[0.8rem] tracking-wide text-[#5f6b64] uppercase"
                        >
                          Sprite usages
                        </h4>
                        <ul class="m-0 grid list-none gap-1 p-0">
                          {#each groups.sprites as usage ([usage.chapterId, usage.sceneId, usage.carrierId].join("\u0000"))}
                            <li>
                              <button
                                type="button"
                                class="w-fit cursor-pointer rounded border border-[#e4ded3] bg-white px-2 py-0.5 text-left text-[0.85rem] hover:border-[#57776a]"
                                title="Select this usage's scene"
                                onclick={() =>
                                  onSelectScene(usage.chapterId, usage.sceneId)}
                              >
                                {`${usage.chapterId} / ${usage.sceneId} · ${usage.carrierId} · ${usage.role}`}
                              </button>
                            </li>
                          {/each}
                        </ul>
                      </div>
                    {/if}
                  </li>
                {/each}
              </ul>
            {/if}
          </article>
        {/each}
      </section>
    {/if}
  </div>

  {#if workspace !== null}
    <section class="grid gap-2" aria-label="Asset diagnostics">
      <h3 class="m-0">Diagnostics</h3>
      {#if workspaceDiagnostics.length === 0}
        <p class="m-0">No asset diagnostics.</p>
      {:else}
        <ul class="m-0 grid list-none gap-1 p-0">
          {#each workspaceDiagnostics as diagnostic, index (index)}
            <li
              class="text-[0.85rem] text-[#b3543e]"
              data-diagnostic-code={diagnostic.code}
            >
              {diagnostic.code}: {diagnostic.message}
            </li>
          {/each}
        </ul>
      {/if}
    </section>
  {/if}
</section>

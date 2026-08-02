<script lang="ts">
  import "$lib/styles/tokens.css";
  import type { Snippet } from "svelte";
  import { onMount } from "svelte";

  let { children }: { children: Snippet } = $props();
  let checkpointGeneration = $state(0);

  // E2E-only: import @wdio/tauri-plugin so its auto-init sets
  // window.__wdio_original_core__, which @wdio/tauri-service's focus hook
  // polls (plugin:wdio|get_window_states). Without this, every findElement /
  // elementClick / $() incurs a ~5s timeout. Tree-shaken out of non-e2e
  // builds because VITE_E2E is undefined there.
  if (import.meta.env.VITE_E2E) {
    void import("@wdio/tauri-plugin");
    onMount(() => {
      let dispose: (() => void) | undefined;
      void import("$lib/e2e/checkpoint-bridge.svelte").then(
        ({ installPackagedE2eCheckpointBridge }) => {
          dispose = installPackagedE2eCheckpointBridge(window, (generation) => {
            checkpointGeneration = generation;
          });
        },
      );
      return () => dispose?.();
    });
  }
</script>

{@render children()}

{#if import.meta.env.VITE_E2E}
  <output
    hidden
    data-e2e-checkpoint-generation={checkpointGeneration}
    aria-label="E2E checkpoint generation"
  ></output>
{/if}

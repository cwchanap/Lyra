<script lang="ts">
  import "$lib/styles/tokens.css";
  import type { Snippet } from "svelte";

  let { children }: { children: Snippet } = $props();

  // E2E-only: import @wdio/tauri-plugin so its auto-init sets
  // window.__wdio_original_core__, which @wdio/tauri-service's focus hook
  // polls (plugin:wdio|get_window_states). Without this, every findElement /
  // elementClick / $() incurs a ~5s timeout. Tree-shaken out of non-e2e
  // builds because VITE_E2E is undefined there.
  if (import.meta.env.VITE_E2E) {
    void import("@wdio/tauri-plugin");
  }
</script>

{@render children()}

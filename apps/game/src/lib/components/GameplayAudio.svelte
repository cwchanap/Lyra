<script lang="ts">
  import { onDestroy } from "svelte";
  import {
    disposeGameplayAudio,
    syncGameplayAudioMode,
  } from "$lib/audio/gameplay-audio-runtime.svelte";
  import type { Mode } from "$lib/state/types";

  let { mode }: { mode: Mode } = $props();

  $effect(() => {
    syncGameplayAudioMode(mode);
  });

  onDestroy(() => {
    disposeGameplayAudio();
  });
</script>

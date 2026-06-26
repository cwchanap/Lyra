<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import {
    disposeGameplayAudio,
    preloadKnownGameplaySfx,
    retryLockedGameplayAudio,
    syncGameplayAudioMode,
  } from "$lib/audio/gameplay-audio-runtime.svelte";
  import type { Mode } from "$lib/state/types";

  let { mode }: { mode: Mode } = $props();

  $effect(() => {
    syncGameplayAudioMode(mode);
  });

  // Browser autoplay policy can reject BGM/BGS startup before the first user
  // gesture. Listen once for the first gesture and re-sync the desired loops.
  // (Design spec: autoplay rejection records a locked state and retries after
  // the next player gesture.) Browsers unlock media for the session after the
  // first gesture, so a single retry arm per mount is sufficient.
  const unlockEvents = ["pointerdown", "keydown"] as const;

  function handleUnlockGesture(): void {
    for (const event of unlockEvents) {
      window.removeEventListener(event, handleUnlockGesture);
    }
    // Warm the low-latency WebAudio decode cache for every mapped SFX on the
    // first gesture. The gesture clears the autoplay lock and is the earliest
    // gesture-adjacent moment to construct the AudioContext; preloading here
    // starts fetch+decode so the first real SFX play hits the buffer cache
    // instead of falling back to HTMLAudioElement while the decode races.
    preloadKnownGameplaySfx();
    retryLockedGameplayAudio();
  }

  onMount(() => {
    for (const event of unlockEvents) {
      window.addEventListener(event, handleUnlockGesture);
    }
  });

  onDestroy(() => {
    for (const event of unlockEvents) {
      window.removeEventListener(event, handleUnlockGesture);
    }
    disposeGameplayAudio();
  });
</script>

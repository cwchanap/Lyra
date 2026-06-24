<script lang="ts">
  import type { AudioPreferences } from "$lib/audio/audio-preferences";

  type Channel = "bgmVolume" | "bgsVolume" | "sfxVolume";

  let {
    preferences,
    onUpdate,
  }: {
    preferences: AudioPreferences;
    onUpdate: (patch: Partial<AudioPreferences>) => void;
  } = $props();

  function percent(value: number): number {
    return Math.round(value * 100);
  }

  function updateChannel(channel: Channel, event: Event): void {
    const value = Number((event.currentTarget as HTMLInputElement).value);
    onUpdate({ [channel]: value / 100 });
  }
</script>

<section class="audio-settings" aria-label="音訊設定">
  <button
    class:active={preferences.muted}
    type="button"
    aria-label={preferences.muted ? "音訊取消靜音" : "音訊靜音"}
    aria-pressed={preferences.muted}
    onclick={() => onUpdate({ muted: !preferences.muted })}
  >
    <span class="icon" aria-hidden="true"
      >{preferences.muted ? "OFF" : "ON"}</span
    >
    <span>{preferences.muted ? "靜音" : "音訊"}</span>
  </button>

  <div class="sliders">
    <label>
      <span>BGM</span>
      <input
        type="range"
        min="0"
        max="100"
        value={percent(preferences.bgmVolume)}
        oninput={(event) => updateChannel("bgmVolume", event)}
      />
    </label>
    <label>
      <span>BGS</span>
      <input
        type="range"
        min="0"
        max="100"
        value={percent(preferences.bgsVolume)}
        oninput={(event) => updateChannel("bgsVolume", event)}
      />
    </label>
    <label>
      <span>SFX</span>
      <input
        type="range"
        min="0"
        max="100"
        value={percent(preferences.sfxVolume)}
        oninput={(event) => updateChannel("sfxVolume", event)}
      />
    </label>
  </div>
</section>

<style>
  .audio-settings {
    box-sizing: border-box;
    display: flex;
    align-items: center;
    gap: 14px;
    width: 100%;
    min-width: 0;
    padding: 8px 10px;
    border: 1px solid var(--rule-strong);
    background: color-mix(in srgb, var(--cell) 64%, transparent);
  }

  button {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    min-height: 34px;
    padding: 7px 10px;
    border: 1px solid var(--rule-strong);
    background: transparent;
    color: var(--bone-dim);
    cursor: pointer;
    font: inherit;
    font-size: 11px;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    transition:
      color 0.18s,
      border-color 0.18s,
      background 0.18s;
  }

  button:hover {
    color: var(--cyan);
    border-color: var(--cyan);
    background: color-mix(in srgb, var(--cyan) 12%, transparent);
  }

  button.active {
    color: var(--crimson);
    border-color: var(--crimson);
    background: var(--crimson-soft);
  }

  .icon {
    font-family: var(--impact);
    font-size: 9px;
    letter-spacing: 0.12em;
    color: var(--bone-faint);
  }

  .sliders {
    flex: 1 1 auto;
    display: grid;
    gap: 5px;
    min-width: 0;
  }

  label {
    display: grid;
    grid-template-columns: 34px minmax(0, 1fr);
    align-items: center;
    gap: 8px;
    color: var(--bone-dim);
    font-family: var(--impact);
    font-size: 10px;
    letter-spacing: 0.18em;
  }

  input {
    width: 100%;
    accent-color: var(--cyan);
  }
</style>

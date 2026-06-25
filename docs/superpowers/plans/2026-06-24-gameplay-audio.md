# Gameplay Audio Implementation Plan

> **Status: Implemented.** This plan was executed and the feature shipped. The
> code blocks below are the *original design sketches* captured at planning
> time; **the shipped source is the source of truth** and has evolved past
> several sketches here (notably the `GameplayAudioController` gained a
> WebAudio `sfxBackend` abstraction, `dispose()` became idempotent and gained a
> `stopLoopChannels()` helper, `SFX_ASSETS`/`inferGameplaySfxEvents` were
> refined, and the Chapter-1 beat predicates now use a shared
> `enteredDialogueBeat(previous, next)` transition guard). Treat anything below
> as historical design; verify against the files under
> `apps/game/src/lib/audio/` and `packages/scripts/audio/` before relying on it.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add chapter-general gameplay audio playback for BGM, BGS, and coarse SFX, with persisted channel volume controls and Chapter 1 as the acceptance rollout.

**Architecture:** Keep the existing Markdown -> compiler JSON -> Rust state -> Svelte presentation path. Add a focused frontend audio controller that observes `GameStateView.mode.bgm` and `.bgs`, a typed frontend SFX event map, and a tiny Svelte settings surface that writes local audio preferences. Runtime audio failures resolve to warnings and silence, not gameplay errors.

**Tech Stack:** Svelte 5 runes, TypeScript, Vitest/jsdom, browser `HTMLAudioElement`, Tauri-served static assets, Bun/Turbo.

---

## File Structure

- Create `apps/game/src/lib/audio/audio-preferences.ts`
  - Owns preference type, defaults, local-storage serialization, normalization, and pure helper tests.
- Create `apps/game/src/lib/audio/audio-preferences.test.ts`
  - Verifies defaults, clamping, malformed storage recovery, and write behavior.
- Create `apps/game/src/lib/audio/audio-controller.ts`
  - Owns looped BGM/BGS elements, one-shot SFX playback, play rejection handling, mute/volume application, and disposal.
- Create `apps/game/src/lib/audio/audio-controller.test.ts`
  - Uses injected fake audio elements; no real playback.
- Create `apps/game/src/lib/audio/sfx-events.ts`
  - Defines coarse SFX event names, maps them to existing Chapter 1 `audio.sfx.*` IDs where meaningful, and infers events from command/state transitions.
- Create `apps/game/src/lib/audio/sfx-events.test.ts`
  - Verifies restrained event mapping and transition inference.
- Create `apps/game/src/lib/audio/gameplay-audio-runtime.svelte.ts`
  - Exposes a singleton controller, reactive preferences, `syncGameplayAudioMode`, `playGameplaySfxEvent`, and `disposeGameplayAudio`.
- Create `apps/game/src/lib/components/GameplayAudio.svelte`
  - Markup-free lifecycle component that syncs the current mode into the audio runtime and disposes on teardown.
- Create `apps/game/src/lib/components/AudioSettings.svelte`
  - Compact mute button plus BGM/BGS/SFX sliders, used inside `GameShell`.
- Create `apps/game/src/lib/components/AudioSettings.test.ts`
  - Verifies the controls call preference updates and show current values.
- Modify `apps/game/src/lib/state/game-client.svelte.ts`
  - After successful commands, infer and dispatch coarse SFX events.
- Modify `apps/game/src/routes/+page.svelte`
  - Mount `GameplayAudio` when a game state exists.
- Modify `apps/game/src/lib/components/GameShell.svelte`
  - Render `AudioSettings` in the header.
- Optionally create `static/assets/audio/bgm/*.ogg`
  - Only if ElevenLabs generation succeeds for the three approved Chapter 1 BGM entries.

## Task 1: Audio Preferences Helpers

**Files:**
- Create: `apps/game/src/lib/audio/audio-preferences.ts`
- Create: `apps/game/src/lib/audio/audio-preferences.test.ts`

- [ ] **Step 1: Write the failing preference tests**

Create `apps/game/src/lib/audio/audio-preferences.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  AUDIO_PREFERENCES_STORAGE_KEY,
  DEFAULT_AUDIO_PREFERENCES,
  loadAudioPreferences,
  normalizeAudioPreferences,
  saveAudioPreferences,
} from "./audio-preferences";

class MemoryStorage implements Pick<Storage, "getItem" | "setItem"> {
  values = new Map<string, string>();
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

describe("audio preferences", () => {
  it("returns defaults when storage is unavailable", () => {
    expect(loadAudioPreferences(null)).toEqual(DEFAULT_AUDIO_PREFERENCES);
  });

  it("normalizes malformed and out-of-range values", () => {
    expect(
      normalizeAudioPreferences({
        muted: "yes",
        bgmVolume: 2,
        bgsVolume: -1,
        sfxVolume: 0.25,
      }),
    ).toEqual({
      muted: false,
      bgmVolume: 1,
      bgsVolume: 0,
      sfxVolume: 0.25,
    });
  });

  it("loads valid stored preferences", () => {
    const storage = new MemoryStorage();
    storage.setItem(
      AUDIO_PREFERENCES_STORAGE_KEY,
      JSON.stringify({
        muted: true,
        bgmVolume: 0.4,
        bgsVolume: 0.5,
        sfxVolume: 0.6,
      }),
    );
    expect(loadAudioPreferences(storage)).toEqual({
      muted: true,
      bgmVolume: 0.4,
      bgsVolume: 0.5,
      sfxVolume: 0.6,
    });
  });

  it("falls back to defaults for invalid stored JSON", () => {
    const storage = new MemoryStorage();
    storage.setItem(AUDIO_PREFERENCES_STORAGE_KEY, "{bad json");
    expect(loadAudioPreferences(storage)).toEqual(DEFAULT_AUDIO_PREFERENCES);
  });

  it("saves normalized preferences", () => {
    const storage = new MemoryStorage();
    const saved = saveAudioPreferences(
      { muted: true, bgmVolume: 9, bgsVolume: 0.2, sfxVolume: -3 },
      storage,
    );
    expect(saved).toBe(true);
    expect(
      JSON.parse(storage.getItem(AUDIO_PREFERENCES_STORAGE_KEY) ?? "{}"),
    ).toEqual({
      muted: true,
      bgmVolume: 1,
      bgsVolume: 0.2,
      sfxVolume: 0,
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
rtk bun run --cwd apps/game test src/lib/audio/audio-preferences.test.ts
```

Expected: FAIL because `src/lib/audio/audio-preferences.ts` does not exist.

- [ ] **Step 3: Implement preference helpers**

Create `apps/game/src/lib/audio/audio-preferences.ts`:

```ts
export type AudioPreferences = {
  muted: boolean;
  bgmVolume: number;
  bgsVolume: number;
  sfxVolume: number;
};

export const AUDIO_PREFERENCES_STORAGE_KEY = "lyra.audioPreferences.v1";

export const DEFAULT_AUDIO_PREFERENCES: AudioPreferences = {
  muted: false,
  bgmVolume: 0.55,
  bgsVolume: 0.45,
  sfxVolume: 0.7,
};

type StorageLike = Pick<Storage, "getItem" | "setItem">;

function clampVolume(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(1, Math.max(0, value));
}

export function normalizeAudioPreferences(
  value: unknown,
): AudioPreferences {
  const raw = value && typeof value === "object" ? value : {};
  const record = raw as Partial<AudioPreferences>;
  return {
    muted:
      typeof record.muted === "boolean"
        ? record.muted
        : DEFAULT_AUDIO_PREFERENCES.muted,
    bgmVolume: clampVolume(
      record.bgmVolume,
      DEFAULT_AUDIO_PREFERENCES.bgmVolume,
    ),
    bgsVolume: clampVolume(
      record.bgsVolume,
      DEFAULT_AUDIO_PREFERENCES.bgsVolume,
    ),
    sfxVolume: clampVolume(
      record.sfxVolume,
      DEFAULT_AUDIO_PREFERENCES.sfxVolume,
    ),
  };
}

export function browserStorage(): StorageLike | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function loadAudioPreferences(
  storage: StorageLike | null = browserStorage(),
): AudioPreferences {
  if (!storage) return DEFAULT_AUDIO_PREFERENCES;
  try {
    const text = storage.getItem(AUDIO_PREFERENCES_STORAGE_KEY);
    if (!text) return DEFAULT_AUDIO_PREFERENCES;
    return normalizeAudioPreferences(JSON.parse(text));
  } catch {
    return DEFAULT_AUDIO_PREFERENCES;
  }
}

export function saveAudioPreferences(
  preferences: AudioPreferences,
  storage: StorageLike | null = browserStorage(),
): boolean {
  if (!storage) return false;
  try {
    storage.setItem(
      AUDIO_PREFERENCES_STORAGE_KEY,
      JSON.stringify(normalizeAudioPreferences(preferences)),
    );
    return true;
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: Run the preference tests**

Run:

```bash
rtk bun run --cwd apps/game test src/lib/audio/audio-preferences.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 1**

```bash
rtk proxy git add apps/game/src/lib/audio/audio-preferences.ts apps/game/src/lib/audio/audio-preferences.test.ts
rtk proxy git commit -m "feat(audio): add audio preference helpers"
```

## Task 2: Audio Controller

**Files:**
- Create: `apps/game/src/lib/audio/audio-controller.ts`
- Create: `apps/game/src/lib/audio/audio-controller.test.ts`

- [ ] **Step 1: Write the failing controller tests**

Create `apps/game/src/lib/audio/audio-controller.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_AUDIO_PREFERENCES } from "./audio-preferences";
import {
  GameplayAudioController,
  type AudioElementLike,
} from "./audio-controller";

class FakeAudio implements AudioElementLike {
  currentTime = 0;
  loop = false;
  muted = false;
  preload = "";
  volume = 1;
  paused = true;
  listeners = new Map<string, Set<() => void>>();
  play = vi.fn(async () => {
    this.paused = false;
  });
  pause = vi.fn(() => {
    this.paused = true;
  });

  constructor(public src: string) {}

  addEventListener(type: string, listener: () => void) {
    const listeners = this.listeners.get(type) ?? new Set<() => void>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: () => void) {
    this.listeners.get(type)?.delete(listener);
  }

  emit(type: string) {
    for (const listener of this.listeners.get(type) ?? []) listener();
  }
}

const preferences = DEFAULT_AUDIO_PREFERENCES;

describe("GameplayAudioController", () => {
  let created: FakeAudio[];
  let warn: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    created = [];
    warn = vi.fn();
  });

  function controller() {
    return new GameplayAudioController({
      audioFactory: (url) => {
        const audio = new FakeAudio(url);
        created.push(audio);
        return audio;
      },
      logger: { warn },
    });
  }

  it("starts BGM and BGS loops", async () => {
    const audio = controller();
    await audio.updateLoopChannels(
      {
        bgm: { channel: "bgm", assetId: "audio.bgm.review" },
        bgs: { channel: "bgs", assetId: "audio.bgs.rain" },
      },
      preferences,
    );

    expect(created.map((a) => a.src)).toEqual([
      "/assets/audio/bgm/review.ogg",
      "/assets/audio/bgs/rain.ogg",
    ]);
    expect(created.every((a) => a.loop)).toBe(true);
    expect(created[0]?.volume).toBe(preferences.bgmVolume);
    expect(created[1]?.volume).toBe(preferences.bgsVolume);
    expect(created[0]?.play).toHaveBeenCalledTimes(1);
    expect(created[1]?.play).toHaveBeenCalledTimes(1);
  });

  it("keeps unchanged loops without restarting", async () => {
    const audio = controller();
    await audio.updateLoopChannels(
      { bgm: { channel: "bgm", assetId: "audio.bgm.review" }, bgs: null },
      preferences,
    );
    await audio.updateLoopChannels(
      { bgm: { channel: "bgm", assetId: "audio.bgm.review" }, bgs: null },
      preferences,
    );
    expect(created).toHaveLength(1);
    expect(created[0]?.play).toHaveBeenCalledTimes(1);
  });

  it("stops on explicit none", async () => {
    const audio = controller();
    await audio.updateLoopChannels(
      { bgm: { channel: "bgm", assetId: "audio.bgm.review" }, bgs: null },
      preferences,
    );
    await audio.updateLoopChannels(
      { bgm: { channel: "bgm", assetId: null }, bgs: null },
      preferences,
    );
    expect(created[0]?.pause).toHaveBeenCalledTimes(1);
    expect(created[0]?.currentTime).toBe(0);
  });

  it("applies mute and volumes to active loops", async () => {
    const audio = controller();
    await audio.updateLoopChannels(
      { bgm: { channel: "bgm", assetId: "audio.bgm.review" }, bgs: null },
      preferences,
    );
    audio.applyPreferences({
      muted: true,
      bgmVolume: 0.1,
      bgsVolume: 0.2,
      sfxVolume: 0.3,
    });
    expect(created[0]?.muted).toBe(true);
    expect(created[0]?.volume).toBe(0.1);
  });

  it("plays SFX as a non-looping one-shot", async () => {
    const audio = controller();
    await audio.playSfx("audio.sfx.sfx_usb_insert_chime", preferences);
    expect(created[0]?.src).toBe("/assets/audio/sfx/sfx_usb_insert_chime.ogg");
    expect(created[0]?.loop).toBe(false);
    expect(created[0]?.volume).toBe(preferences.sfxVolume);
  });

  it("suppresses SFX while muted", async () => {
    const audio = controller();
    await audio.playSfx("audio.sfx.sfx_usb_insert_chime", {
      ...preferences,
      muted: true,
    });
    expect(created).toHaveLength(0);
  });

  it("logs and silences rejected playback", async () => {
    const audio = new GameplayAudioController({
      audioFactory: (url) => {
        const element = new FakeAudio(url);
        element.play = vi.fn(async () => {
          throw new Error("blocked");
        });
        created.push(element);
        return element;
      },
      logger: { warn },
    });
    await audio.updateLoopChannels(
      { bgm: { channel: "bgm", assetId: "audio.bgm.review" }, bgs: null },
      preferences,
    );
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("audio.bgm.review"),
    );
    expect(created[0]?.pause).toHaveBeenCalled();
  });

  it("disposes active loops", async () => {
    const audio = controller();
    await audio.updateLoopChannels(
      { bgm: { channel: "bgm", assetId: "audio.bgm.review" }, bgs: null },
      preferences,
    );
    audio.dispose();
    expect(created[0]?.pause).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the controller tests to verify they fail**

Run:

```bash
rtk bun run --cwd apps/game test src/lib/audio/audio-controller.test.ts
```

Expected: FAIL because `src/lib/audio/audio-controller.ts` does not exist.

- [ ] **Step 3: Implement the controller**

Create `apps/game/src/lib/audio/audio-controller.ts`:

```ts
import { publicPathForStoryAsset } from "$lib/assets/story-assets";
import type { AudioCue } from "$lib/state/types";
import type { AudioPreferences } from "./audio-preferences";

type LoopChannel = "bgm" | "bgs";

export type AudioElementLike = {
  src: string;
  currentTime: number;
  loop: boolean;
  muted: boolean;
  preload: string;
  volume: number;
  play: () => Promise<void> | void;
  pause: () => void;
  addEventListener?: (type: string, listener: () => void) => void;
  removeEventListener?: (type: string, listener: () => void) => void;
};

export type AudioFactory = (url: string) => AudioElementLike;

type LoggerLike = Pick<Console, "warn">;

type LoopState = {
  assetId: string;
  audio: AudioElementLike;
  onError: () => void;
};

export type LoopChannelInput = {
  bgm: AudioCue | null;
  bgs: AudioCue | null;
};

export type GameplayAudioControllerOptions = {
  audioFactory?: AudioFactory;
  logger?: LoggerLike;
};

function defaultAudioFactory(url: string): AudioElementLike {
  const audio = new Audio(url);
  return audio;
}

function channelVolume(
  channel: LoopChannel | "sfx",
  preferences: AudioPreferences,
): number {
  if (channel === "bgm") return preferences.bgmVolume;
  if (channel === "bgs") return preferences.bgsVolume;
  return preferences.sfxVolume;
}

export class GameplayAudioController {
  private loops: Record<LoopChannel, LoopState | null> = {
    bgm: null,
    bgs: null,
  };
  private readonly audioFactory: AudioFactory;
  private readonly logger: LoggerLike;

  constructor(options: GameplayAudioControllerOptions = {}) {
    this.audioFactory = options.audioFactory ?? defaultAudioFactory;
    this.logger = options.logger ?? console;
  }

  async updateLoopChannels(
    input: LoopChannelInput,
    preferences: AudioPreferences,
  ): Promise<void> {
    await Promise.all([
      this.updateLoopChannel("bgm", input.bgm, preferences),
      this.updateLoopChannel("bgs", input.bgs, preferences),
    ]);
  }

  applyPreferences(preferences: AudioPreferences): void {
    for (const channel of ["bgm", "bgs"] as const) {
      const loop = this.loops[channel];
      if (!loop) continue;
      loop.audio.muted = preferences.muted;
      loop.audio.volume = channelVolume(channel, preferences);
    }
  }

  // > **Superseded — see `apps/game/src/lib/audio/audio-controller.ts`.**
  // > The shipped controller routes SFX through a low-latency WebAudio
  // > `sfxBackend` first (falling back to an `HTMLAudioElement` pool), tracks
  // > play attempts with a generation counter via `restartSfx`/
  // > `handleSfxPlaybackFailure`, and makes `dispose()` idempotent. The sketch
  // > below (one-off `Audio` element per SFX, non-idempotent dispose) is kept
  // > only as the original design rationale.
  async playSfx(
    assetId: string | null,
    preferences: AudioPreferences,
  ): Promise<void> {
    if (!assetId || preferences.muted) return;
    let url: string;
    try {
      url = publicPathForStoryAsset(assetId, "audio");
    } catch (error) {
      this.warn(assetId, String(error));
      return;
    }

    const audio = this.audioFactory(url);
    audio.loop = false;
    audio.preload = "auto";
    audio.muted = preferences.muted;
    audio.volume = channelVolume("sfx", preferences);
    const onError = () => this.warn(assetId, url);
    audio.addEventListener?.("error", onError);
    try {
      await audio.play();
    } catch {
      this.warn(assetId, url);
      audio.pause();
      audio.currentTime = 0;
    }
  }

  // Shipped: idempotent (guards on a `disposed` flag so repeated teardown —
  // e.g. Svelte `onDestroy` firing twice — doesn't re-close the AudioContext),
  // and also stops active SFX and disposes the `sfxBackend`. A separate
  // `stopLoopChannels()` stops only BGM/BGS and is used for transient silence
  // (e.g. `gameComplete`) so the singleton stays usable for replay.
  dispose(): void {
    this.stopLoop("bgm");
    this.stopLoop("bgs");
  }

  stopLoopChannels(): void {
    this.stopLoop("bgm");
    this.stopLoop("bgs");
  }

  private async updateLoopChannel(
    channel: LoopChannel,
    cue: AudioCue | null,
    preferences: AudioPreferences,
  ): Promise<void> {
    if (!cue) {
      this.applyPreferences(preferences);
      return;
    }
    if (cue.assetId === null) {
      this.stopLoop(channel);
      return;
    }
    if (this.loops[channel]?.assetId === cue.assetId) {
      this.applyPreferences(preferences);
      return;
    }

    this.stopLoop(channel);
    await this.startLoop(channel, cue.assetId, preferences);
  }

  private async startLoop(
    channel: LoopChannel,
    assetId: string,
    preferences: AudioPreferences,
  ): Promise<void> {
    let url: string;
    try {
      url = publicPathForStoryAsset(assetId, "audio");
    } catch (error) {
      this.warn(assetId, String(error));
      return;
    }

    const audio = this.audioFactory(url);
    const onError = () => {
      this.warn(assetId, url);
      if (this.loops[channel]?.audio === audio) this.stopLoop(channel);
    };
    audio.loop = true;
    audio.preload = "auto";
    audio.muted = preferences.muted;
    audio.volume = channelVolume(channel, preferences);
    audio.addEventListener?.("error", onError);
    this.loops[channel] = { assetId, audio, onError };

    try {
      await audio.play();
    } catch {
      this.warn(assetId, url);
      if (this.loops[channel]?.audio === audio) this.stopLoop(channel);
    }
  }

  private stopLoop(channel: LoopChannel): void {
    const loop = this.loops[channel];
    if (!loop) return;
    loop.audio.removeEventListener?.("error", loop.onError);
    loop.audio.pause();
    loop.audio.currentTime = 0;
    this.loops[channel] = null;
  }

  private warn(assetId: string, detail: string): void {
    this.logger.warn(`[GameplayAudio] Audio unavailable: ${assetId} (${detail})`);
  }
}
```

- [ ] **Step 4: Run the controller tests**

Run:

```bash
rtk bun run --cwd apps/game test src/lib/audio/audio-controller.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 2**

```bash
rtk proxy git add apps/game/src/lib/audio/audio-controller.ts apps/game/src/lib/audio/audio-controller.test.ts
rtk proxy git commit -m "feat(audio): add gameplay audio controller"
```

## Task 3: Coarse SFX Events

**Files:**
- Create: `apps/game/src/lib/audio/sfx-events.ts`
- Create: `apps/game/src/lib/audio/sfx-events.test.ts`

- [ ] **Step 1: Write the failing SFX tests**

Create `apps/game/src/lib/audio/sfx-events.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  assetIdForGameplaySfxEvent,
  inferGameplaySfxEvents,
  type GameplayCommandName,
} from "./sfx-events";
import type { GameStateView } from "$lib/state/types";

function state(overrides: Partial<GameStateView> = {}): GameStateView {
  return {
    chapter: { id: "chapter_1", title: "Chapter", summary: "", index: 0, total: 1 },
    scene: { kind: "investigation", id: "investigation_scene_7", title: "", index: 0, total: 1, currentSublocationId: "back_door", visibleSublocations: [] },
    mode: {
      type: "explore",
      sublocationId: "back_door",
      backgroundAssetId: null,
      bgm: null,
      bgs: null,
    },
    inventory: { evidence: [], statements: [] },
    ...overrides,
  };
}

describe("SFX event mapping", () => {
  it("maps existing Chapter 1 story beat hooks to generated SFX", () => {
    expect(assetIdForGameplaySfxEvent("story:anonymous-message")).toBe(
      "audio.sfx.sfx_anonymous_message_buzz",
    );
    expect(assetIdForGameplaySfxEvent("story:rice-ball-bag")).toBe(
      "audio.sfx.sfx_rice_ball_bag_crinkle",
    );
    expect(assetIdForGameplaySfxEvent("story:coffee-backflush")).toBe(
      "audio.sfx.sfx_coffee_machine_backflush",
    );
    expect(assetIdForGameplaySfxEvent("story:usb-insert")).toBe(
      "audio.sfx.sfx_usb_insert_chime",
    );
  });

  it("leaves generic events silent unless they have a meaningful match", () => {
    expect(assetIdForGameplaySfxEvent("investigation:hotspot-inspected")).toBeNull();
    expect(assetIdForGameplaySfxEvent("interrogation:question-answered")).toBeNull();
  });
});

describe("inferGameplaySfxEvents", () => {
  it("dispatches the anonymous-message hook when entering chapter 1 investigation scene 7", () => {
    const previous = state({
      scene: { kind: "linear", id: "scene_6", title: "", index: 0, total: 1 },
      mode: {
        type: "dialogue",
        current: { kind: "action", text: "" },
        queueRemaining: 0,
        sceneTag: null,
        backgroundAssetId: null,
        bgm: null,
        bgs: null,
        queueToken: { sceneId: "scene_6", queueGen: 1, cursor: 0 },
      },
    });
    const next = state();
    expect(inferGameplaySfxEvents(previous, next, "advance_dialogue")).toEqual([
      "story:anonymous-message",
    ]);
  });

  it("dispatches the USB hook when entering the chapter 1 office-night scene tag", () => {
    const previous = state({ scene: { kind: "linear", id: "scene_11", title: "", index: 0, total: 1 } });
    const next = state({
      scene: { kind: "linear", id: "scene_11", title: "", index: 0, total: 1 },
      mode: {
        type: "dialogue",
        current: { kind: "sceneTag", text: "相馬事務所，夜晚。" },
        queueRemaining: 0,
        sceneTag: "相馬事務所，夜晚。",
        backgroundAssetId: "background.chapter_1.scene_11.office_night",
        bgm: null,
        bgs: null,
        queueToken: { sceneId: "scene_11", queueGen: 2, cursor: 4 },
      },
    });
    expect(inferGameplaySfxEvents(previous, next, "advance_dialogue")).toEqual([
      "story:usb-insert",
    ]);
  });

  it("dispatches acquired-evidence only when inventory grows", () => {
    const previous = state();
    const next = state({
      inventory: {
        evidence: [
          {
            id: "amemiya_message_thumb",
            name: "雨宮匿名訊息縮圖",
            description: "",
            details: "",
            imageAssetId: null,
            onReexamine: null,
            collectedInChapterId: "chapter_1",
            collectedInSceneId: "investigation_scene_7",
          },
        ],
        statements: [],
      },
    });
    expect(inferGameplaySfxEvents(previous, next, "inspect_hotspot")).toEqual([
      "investigation:hotspot-inspected",
      "investigation:evidence-acquired",
    ]);
  });

  it("does not dispatch success SFX without a next state", () => {
    expect(inferGameplaySfxEvents(state(), null, "inspect_hotspot")).toEqual([]);
  });

  it("accepts all command names used by the state client", () => {
    const names: GameplayCommandName[] = [
      "start_game",
      "reset_game",
      "advance_dialogue",
      "inspect_hotspot",
      "interview_topic",
      "enter_sublocation",
      "reexamine_evidence",
      "reexamine_statement",
      "answer_interrogation_question",
      "press_testimony_statement",
      "present_testimony_item",
    ];
    expect(names).toContain("present_testimony_item");
  });
});
```

- [ ] **Step 2: Run the SFX tests to verify they fail**

Run:

```bash
rtk bun run --cwd apps/game test src/lib/audio/sfx-events.test.ts
```

Expected: FAIL because `src/lib/audio/sfx-events.ts` does not exist.

- [ ] **Step 3: Implement SFX mapping and inference**

Create `apps/game/src/lib/audio/sfx-events.ts`:

```ts
import type { GameStateView } from "$lib/state/types";

export type GameplaySfxEvent =
  | "ui:new-game"
  | "ui:reset"
  | "ui:menu-confirm"
  | "ui:action-unavailable"
  | "investigation:hotspot-inspected"
  | "investigation:topic-discussed"
  | "investigation:sublocation-entered"
  | "investigation:evidence-acquired"
  | "investigation:statement-acquired"
  | "interrogation:phase-entered"
  | "interrogation:question-answered"
  | "interrogation:testimony-pressed"
  | "interrogation:wrong-present"
  | "interrogation:successful-contradiction"
  | "story:anonymous-message"
  | "story:rice-ball-bag"
  | "story:coffee-backflush"
  | "story:usb-insert";

export type GameplayCommandName =
  | "start_game"
  | "reset_game"
  | "advance_dialogue"
  | "inspect_hotspot"
  | "interview_topic"
  | "enter_sublocation"
  | "reexamine_evidence"
  | "reexamine_statement"
  | "answer_interrogation_question"
  | "press_testimony_statement"
  | "present_testimony_item";

const SFX_ASSETS: Partial<Record<GameplaySfxEvent, string>> = {
  "ui:menu-confirm": "audio.sfx.sfx_dialogue_proceed_tick",
  "story:anonymous-message": "audio.sfx.sfx_anonymous_message_buzz",
  "story:rice-ball-bag": "audio.sfx.sfx_rice_ball_bag_crinkle",
  "story:coffee-backflush": "audio.sfx.sfx_coffee_machine_backflush",
  "story:usb-insert": "audio.sfx.sfx_usb_insert_chime",
};

export function assetIdForGameplaySfxEvent(
  event: GameplaySfxEvent,
): string | null {
  return SFX_ASSETS[event] ?? null;
}

export function inferGameplaySfxEvents(
  previous: GameStateView | null,
  next: GameStateView | null,
  command: GameplayCommandName,
): GameplaySfxEvent[] {
  if (!next) return [];

  const events: GameplaySfxEvent[] = [];
  if (command === "start_game") events.push("ui:new-game");
  if (command === "reset_game") events.push("ui:reset");
  if (command === "inspect_hotspot")
    events.push("investigation:hotspot-inspected");
  if (command === "interview_topic")
    events.push("investigation:topic-discussed");
  if (command === "enter_sublocation")
    events.push("investigation:sublocation-entered");
  if (command === "answer_interrogation_question")
    events.push("interrogation:question-answered");
  if (command === "press_testimony_statement")
    events.push("interrogation:testimony-pressed");

  if (inventoryEvidenceCount(next) > inventoryEvidenceCount(previous)) {
    events.push("investigation:evidence-acquired");
  }
  if (inventoryStatementCount(next) > inventoryStatementCount(previous)) {
    events.push("investigation:statement-acquired");
  }
  if (enteredPhase(previous, next)) events.push("interrogation:phase-entered");
  if (enteredChapterOneAnonymousMessage(previous, next)) {
    events.push("story:anonymous-message");
  }
  if (enteredChapterOneUsbBeat(previous, next)) events.push("story:usb-insert");
  if (enteredChapterOneRiceBallBeat(previous, next)) {
    events.push("story:rice-ball-bag");
  }
  if (enteredChapterOneCoffeeBackflushBeat(previous, next)) {
    events.push("story:coffee-backflush");
  }

  return dedupe(events);
}

function inventoryEvidenceCount(state: GameStateView | null): number {
  return state?.inventory.evidence.length ?? 0;
}

function inventoryStatementCount(state: GameStateView | null): number {
  return state?.inventory.statements.length ?? 0;
}

function enteredPhase(
  previous: GameStateView | null,
  next: GameStateView,
): boolean {
  if (next.mode.type !== "interrogation") return false;
  const previousPhase =
    previous?.mode.type === "interrogation" ? previous.mode.phaseId : null;
  return previousPhase !== next.mode.phaseId;
}

function enteredChapterOneAnonymousMessage(
  previous: GameStateView | null,
  next: GameStateView,
): boolean {
  return (
    next.chapter.id === "chapter_1" &&
    next.scene.kind === "investigation" &&
    next.scene.id === "investigation_scene_7" &&
    previous?.scene.id !== next.scene.id
  );
}

function enteredChapterOneUsbBeat(
  previous: GameStateView | null,
  next: GameStateView,
): boolean {
  if (next.chapter.id !== "chapter_1") return false;
  if (next.scene.kind !== "linear" || next.scene.id !== "scene_11")
    return false;
  return enteredDialogueBeat(
    previous,
    next,
    (kind, text) => kind === "action" && text.includes("隨身碟插上筆電"),
  );
}

function enteredChapterOneRiceBallBeat(
  previous: GameStateView | null,
  next: GameStateView,
): boolean {
  return (
    next.chapter.id === "chapter_1" &&
    next.scene.kind === "interrogation" &&
    next.scene.id === "interrogation_scene_10" &&
    enteredDialogueBeat(
      previous,
      next,
      (kind, text) => kind === "action" && text.includes("飯糰袋"),
    )
  );
}

function enteredChapterOneCoffeeBackflushBeat(
  previous: GameStateView | null,
  next: GameStateView,
): boolean {
  return (
    next.chapter.id === "chapter_1" &&
    next.scene.kind === "investigation" &&
    next.scene.id === "investigation_scene_7" &&
    enteredDialogueBeat(
      previous,
      next,
      (kind, text) =>
        kind === "line" && text.includes("那台機器 backflush 的時候"),
    )
  );
}

// Shared transition guard for dialogue-anchored story beats: fires only on the
// actual cursor/queue advance onto the matching line, not on every re-derive of
// the same state (e.g. repeated explore/inner in investigation_scene_7).
function enteredDialogueBeat(
  previous: GameStateView | null,
  next: GameStateView,
  matches: (kind: string, text: string) => boolean,
): boolean {
  if (next.mode.type !== "dialogue") return false;
  if (!matches(next.mode.current.kind, next.mode.current.text)) return false;
  if (previous?.mode.type !== "dialogue") return true;

  return (
    previous.mode.queueToken.sceneId !== next.mode.queueToken.sceneId ||
    previous.mode.queueToken.queueGen !== next.mode.queueToken.queueGen ||
    previous.mode.queueToken.cursor !== next.mode.queueToken.cursor
  );
}

function dedupe(events: GameplaySfxEvent[]): GameplaySfxEvent[] {
  return Array.from(new Set(events));
}
```

- [ ] **Step 4: Run the SFX tests**

Run:

```bash
rtk bun run --cwd apps/game test src/lib/audio/sfx-events.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 3**

```bash
rtk proxy git add apps/game/src/lib/audio/sfx-events.ts apps/game/src/lib/audio/sfx-events.test.ts
rtk proxy git commit -m "feat(audio): add coarse gameplay sfx events"
```

## Task 4: Runtime Singleton And BGM/BGS Page Wiring

**Files:**
- Create: `apps/game/src/lib/audio/gameplay-audio-runtime.svelte.ts`
- Create: `apps/game/src/lib/components/GameplayAudio.svelte`
- Modify: `apps/game/src/routes/+page.svelte`
- Test: `apps/game/src/routes/page-source.test.ts`

- [ ] **Step 1: Add a failing source test for page audio wiring**

Modify `apps/game/src/routes/page-source.test.ts` by appending:

```ts
describe("+page gameplay audio wiring", () => {
  it("mounts GameplayAudio whenever a game state exists", () => {
    const source = pageSource();

    expect(source).toContain('import GameplayAudio from "$lib/components/GameplayAudio.svelte";');
    expect(source).toContain("<GameplayAudio mode={gameState.value.mode} />");
  });
});
```

- [ ] **Step 2: Run the source test to verify it fails**

Run:

```bash
rtk bun run --cwd apps/game test src/routes/page-source.test.ts
```

Expected: FAIL because `GameplayAudio` is not imported or mounted yet.

- [ ] **Step 3: Implement the audio runtime singleton**

Create `apps/game/src/lib/audio/gameplay-audio-runtime.svelte.ts`:

```ts
import type { Mode } from "$lib/state/types";
import {
  DEFAULT_AUDIO_PREFERENCES,
  loadAudioPreferences,
  normalizeAudioPreferences,
  saveAudioPreferences,
  type AudioPreferences,
} from "./audio-preferences";
import { GameplayAudioController } from "./audio-controller";
import {
  assetIdForGameplaySfxEvent,
  type GameplaySfxEvent,
} from "./sfx-events";

export const audioPreferences = $state<AudioPreferences>(
  loadAudioPreferences(),
);

const controller = new GameplayAudioController();

export function updateAudioPreferences(
  patch: Partial<AudioPreferences>,
): void {
  const next = normalizeAudioPreferences({ ...audioPreferences, ...patch });
  audioPreferences.muted = next.muted;
  audioPreferences.bgmVolume = next.bgmVolume;
  audioPreferences.bgsVolume = next.bgsVolume;
  audioPreferences.sfxVolume = next.sfxVolume;
  saveAudioPreferences(next);
  controller.applyPreferences(next);
}

export function syncGameplayAudioMode(mode: Mode): void {
  if (mode.type === "gameComplete") {
    controller.dispose();
    return;
  }
  void controller.updateLoopChannels(
    {
      bgm: mode.bgm ?? null,
      bgs: mode.bgs ?? null,
    },
    audioPreferences,
  );
}

export function playGameplaySfxEvent(event: GameplaySfxEvent): void {
  const assetId = assetIdForGameplaySfxEvent(event);
  if (!assetId) return;
  void controller.playSfx(assetId, audioPreferences);
}

export function disposeGameplayAudio(): void {
  controller.dispose();
}

export function resetAudioPreferences(): void {
  updateAudioPreferences(DEFAULT_AUDIO_PREFERENCES);
}
```

- [ ] **Step 4: Add the lifecycle component**

Create `apps/game/src/lib/components/GameplayAudio.svelte`:

```svelte
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
```

- [ ] **Step 5: Mount GameplayAudio in the page**

Modify `apps/game/src/routes/+page.svelte`:

```svelte
  import GameplayAudio from "$lib/components/GameplayAudio.svelte";
```

Inside the `{#if gameState.value}` branch, immediately before `<GameShell ...>`:

```svelte
  <GameplayAudio mode={gameState.value.mode} />
```

- [ ] **Step 6: Run the page wiring test**

Run:

```bash
rtk bun run --cwd apps/game test src/routes/page-source.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit Task 4**

```bash
rtk proxy git add apps/game/src/lib/audio/gameplay-audio-runtime.svelte.ts apps/game/src/lib/components/GameplayAudio.svelte apps/game/src/routes/+page.svelte apps/game/src/routes/page-source.test.ts
rtk proxy git commit -m "feat(audio): wire mode audio into gameplay"
```

## Task 5: Dispatch SFX From Successful Commands

**Files:**
- Modify: `apps/game/src/lib/state/game-client.svelte.ts`
- Create: `apps/game/src/lib/state/game-client-source.test.ts`

- [ ] **Step 1: Write a source test for SFX dispatch wiring**

Create `apps/game/src/lib/state/game-client-source.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function source() {
  return readFileSync(
    join(process.cwd(), "src/lib/state/game-client.svelte.ts"),
    "utf8",
  );
}

describe("game client audio events", () => {
  it("infers SFX events after successful game commands", () => {
    const text = source();
    expect(text).toContain("inferGameplaySfxEvents");
    expect(text).toContain("playGameplaySfxEvent");
    expect(text).toContain("const previous = gameState.value;");
    expect(text).toContain("for (const event of inferGameplaySfxEvents(previous, v, command))");
  });
});
```

- [ ] **Step 2: Run the source test to verify it fails**

Run:

```bash
rtk bun run --cwd apps/game test src/lib/state/game-client-source.test.ts
```

Expected: FAIL because the game client does not dispatch SFX events.

- [ ] **Step 3: Import SFX helpers**

Modify `apps/game/src/lib/state/game-client.svelte.ts` near the imports:

```ts
import { playGameplaySfxEvent } from "$lib/audio/gameplay-audio-runtime.svelte";
import {
  inferGameplaySfxEvents,
  type GameplayCommandName,
} from "$lib/audio/sfx-events";
```

- [ ] **Step 4: Dispatch SFX only after successful state updates**

Replace `dispatchGameCommand` in `apps/game/src/lib/state/game-client.svelte.ts` with:

```ts
async function dispatchGameCommand(
  command: GameplayCommandName,
  args?: Record<string, unknown>,
  loading = false,
) {
  if (gameState.inFlight) return;
  gameState.inFlight = true;
  if (loading) gameState.loading = true;
  try {
    const previous = gameState.value;
    const v = await runCommand<GameStateView>(command, args);
    if (v) {
      gameState.value = v;
      for (const event of inferGameplaySfxEvents(previous, v, command)) {
        playGameplaySfxEvent(event);
      }
    }
  } finally {
    if (loading) gameState.loading = false;
    gameState.inFlight = false;
  }
}
```

- [ ] **Step 5: Run SFX and source tests**

Run:

```bash
rtk bun run --cwd apps/game test src/lib/audio/sfx-events.test.ts src/lib/state/game-client-source.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit Task 5**

```bash
rtk proxy git add apps/game/src/lib/state/game-client.svelte.ts apps/game/src/lib/state/game-client-source.test.ts
rtk proxy git commit -m "feat(audio): dispatch gameplay sfx events"
```

## Task 6: Audio Settings UI

**Files:**
- Create: `apps/game/src/lib/components/AudioSettings.svelte`
- Create: `apps/game/src/lib/components/AudioSettings.test.ts`
- Modify: `apps/game/src/lib/components/GameShell.svelte`

- [ ] **Step 1: Write the failing settings tests**

Create `apps/game/src/lib/components/AudioSettings.test.ts`:

```ts
import { fireEvent, render, screen } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import AudioSettings from "./AudioSettings.svelte";
import type { AudioPreferences } from "$lib/audio/audio-preferences";

const preferences: AudioPreferences = {
  muted: false,
  bgmVolume: 0.55,
  bgsVolume: 0.45,
  sfxVolume: 0.7,
};

describe("AudioSettings", () => {
  it("renders mute and channel sliders", () => {
    render(AudioSettings, {
      preferences,
      onUpdate: vi.fn(),
    });
    expect(screen.getByRole("button", { name: /音訊/ })).toBeInTheDocument();
    expect(screen.getByLabelText("BGM")).toHaveValue("55");
    expect(screen.getByLabelText("BGS")).toHaveValue("45");
    expect(screen.getByLabelText("SFX")).toHaveValue("70");
  });

  it("updates mute", async () => {
    const onUpdate = vi.fn();
    render(AudioSettings, { preferences, onUpdate });
    await fireEvent.click(screen.getByRole("button", { name: /音訊/ }));
    expect(onUpdate).toHaveBeenCalledWith({ muted: true });
  });

  it("updates a channel volume", async () => {
    const onUpdate = vi.fn();
    render(AudioSettings, { preferences, onUpdate });
    await fireEvent.input(screen.getByLabelText("BGS"), {
      target: { value: "25" },
    });
    expect(onUpdate).toHaveBeenCalledWith({ bgsVolume: 0.25 });
  });
});
```

- [ ] **Step 2: Run the settings tests to verify they fail**

Run:

```bash
rtk bun run --cwd apps/game test src/lib/components/AudioSettings.test.ts
```

Expected: FAIL because `AudioSettings.svelte` does not exist.

- [ ] **Step 3: Implement AudioSettings**

Create `apps/game/src/lib/components/AudioSettings.svelte`:

```svelte
<script lang="ts">
  import type { AudioPreferences } from "$lib/audio/audio-preferences";

  let {
    preferences,
    onUpdate,
  }: {
    preferences: AudioPreferences;
    onUpdate: (patch: Partial<AudioPreferences>) => void;
  } = $props();

  function percent(value: number) {
    return Math.round(value * 100);
  }

  function volumeFromEvent(event: Event) {
    const input = event.currentTarget;
    if (!(input instanceof HTMLInputElement)) return 0;
    return Number(input.value) / 100;
  }
</script>

<section class="audio-settings" aria-label="音訊設定">
  <button
    type="button"
    class:muted={preferences.muted}
    aria-pressed={preferences.muted}
    aria-label={preferences.muted ? "音訊已靜音" : "音訊開啟"}
    onclick={() => onUpdate({ muted: !preferences.muted })}
  >
    {preferences.muted ? "MUTE" : "AUDIO"}
  </button>
  <label>
    <span>BGM</span>
    <input
      aria-label="BGM"
      type="range"
      min="0"
      max="100"
      value={percent(preferences.bgmVolume)}
      oninput={(event) => onUpdate({ bgmVolume: volumeFromEvent(event) })}
    />
  </label>
  <label>
    <span>BGS</span>
    <input
      aria-label="BGS"
      type="range"
      min="0"
      max="100"
      value={percent(preferences.bgsVolume)}
      oninput={(event) => onUpdate({ bgsVolume: volumeFromEvent(event) })}
    />
  </label>
  <label>
    <span>SFX</span>
    <input
      aria-label="SFX"
      type="range"
      min="0"
      max="100"
      value={percent(preferences.sfxVolume)}
      oninput={(event) => onUpdate({ sfxVolume: volumeFromEvent(event) })}
    />
  </label>
</section>

<style>
  .audio-settings {
    display: grid;
    grid-template-columns: auto repeat(3, minmax(72px, 1fr));
    gap: 8px;
    align-items: center;
    min-width: min(420px, 100%);
  }

  button {
    border: 1px solid var(--rule-strong);
    background: transparent;
    color: var(--bone-dim);
    cursor: pointer;
    font-family: var(--impact);
    font-size: 10px;
    letter-spacing: 0.24em;
    padding: 8px 10px;
  }

  button.muted {
    color: var(--crimson);
    border-color: var(--crimson);
    background: var(--crimson-soft);
  }

  label {
    display: grid;
    gap: 3px;
    color: var(--bone-faint);
    font-family: var(--impact);
    font-size: 9px;
    letter-spacing: 0.24em;
  }

  input {
    width: 100%;
    accent-color: var(--cyan);
  }
</style>
```

- [ ] **Step 4: Render settings in GameShell**

Modify `apps/game/src/lib/components/GameShell.svelte` imports:

```svelte
  import AudioSettings from "./AudioSettings.svelte";
  import {
    audioPreferences,
    updateAudioPreferences,
  } from "$lib/audio/gameplay-audio-runtime.svelte";
```

In the `<header>` after the `.left` block and before the close-case button, insert:

```svelte
    <AudioSettings
      preferences={audioPreferences}
      onUpdate={updateAudioPreferences}
    />
```

In the `header` CSS, keep the layout stable on narrow widths:

```css
  header {
    flex-wrap: wrap;
  }
```

- [ ] **Step 5: Run settings tests**

Run:

```bash
rtk bun run --cwd apps/game test src/lib/components/AudioSettings.test.ts
```

Expected: PASS.

- [ ] **Step 6: Run Svelte type check for the new component wiring**

Run:

```bash
rtk bun run check
```

Expected: PASS.

- [ ] **Step 7: Commit Task 6**

```bash
rtk proxy git add apps/game/src/lib/components/AudioSettings.svelte apps/game/src/lib/components/AudioSettings.test.ts apps/game/src/lib/components/GameShell.svelte
rtk proxy git commit -m "feat(audio): add gameplay audio controls"
```

## Task 7: Chapter 1 BGM Asset Rollout

**Files:**
- Optionally create: `static/assets/audio/bgm/bgm_review_board_loss.ogg`
- Optionally create: `static/assets/audio/bgm/bgm_review_board_victory.ogg`
- Optionally create: `static/assets/audio/bgm/bgm_chapter_close.ogg`

- [ ] **Step 1: Confirm current BGM file state**

Run:

```bash
rtk rg --files static/assets/audio/bgm
```

Expected if generation is still pending: command exits non-zero or lists no files. Expected after successful generation: the three Chapter 1 BGM `.ogg` files are listed.

- [ ] **Step 2: Validate the approved Chapter 1 audio plan**

Run:

```bash
rtk bun run audio:validate docs/audio_plans/chapter_1.sound-plan.yaml
```

Expected: PASS with `[audio] docs/audio_plans/chapter_1.sound-plan.yaml OK`.

- [ ] **Step 3: Dry-run the BGM generation batch**

Run:

```bash
rtk bun run audio:generate docs/audio_plans/chapter_1.sound-plan.yaml --dry-run --only bgm_review_board_loss
rtk bun run audio:generate docs/audio_plans/chapter_1.sound-plan.yaml --dry-run --only bgm_review_board_victory
rtk bun run audio:generate docs/audio_plans/chapter_1.sound-plan.yaml --dry-run --only bgm_chapter_close
```

Expected: each command reports the selected approved BGM entry without network access.

- [ ] **Step 4: Generate BGM only if ElevenLabs access is available**

Run these commands only when `ELEVENLABS_API_KEY` is configured and the user has available ElevenLabs billing/API access:

```bash
rtk bun run audio:generate docs/audio_plans/chapter_1.sound-plan.yaml --only bgm_review_board_loss
rtk bun run audio:generate docs/audio_plans/chapter_1.sound-plan.yaml --only bgm_review_board_victory
rtk bun run audio:generate docs/audio_plans/chapter_1.sound-plan.yaml --only bgm_chapter_close
```

Expected success: each command writes one `.ogg` under `static/assets/audio/bgm/`.

Expected billing stop: if any command exits with code 3 and mentions `402 Payment Required` or payment-method-required, stop immediately. Do not retry with `--force`. Record in the final implementation notes that runtime acceptance can pass but Chapter 1 all-audio rollout remains incomplete.

- [ ] **Step 5: Commit generated BGM files if present**

If all three files exist, run:

```bash
rtk proxy git add static/assets/audio/bgm/bgm_review_board_loss.ogg static/assets/audio/bgm/bgm_review_board_victory.ogg static/assets/audio/bgm/bgm_chapter_close.ogg
rtk proxy git commit -m "feat(audio): add chapter 1 bgm assets"
```

If the files do not exist because generation is externally blocked, do not create placeholder audio and do not commit this task.

## Task 8: Final Verification And Smoke

**Files:**
- Verify all changed frontend and audio files.

- [ ] **Step 1: Run focused audio tests**

Run:

```bash
rtk bun run --cwd apps/game test src/lib/audio/audio-preferences.test.ts src/lib/audio/audio-controller.test.ts src/lib/audio/sfx-events.test.ts src/lib/components/AudioSettings.test.ts src/lib/state/game-client-source.test.ts src/routes/page-source.test.ts
```

Expected: PASS.

- [ ] **Step 2: Compile scenes**

Run:

```bash
rtk bun run scenes:compile
```

Expected: PASS. Generated ignored resources may appear locally; do not commit generated resource JSON.

- [ ] **Step 3: Run frontend type check**

Run:

```bash
rtk bun run check
```

Expected: PASS.

- [ ] **Step 4: Run the broader frontend test suite**

Run:

```bash
rtk bun run --cwd apps/game test
```

Expected: PASS.

- [ ] **Step 5: Smoke real playback in Tauri**

Run:

```bash
rtk bun run dev:game
```

Expected:

- The app launches through Tauri.
- Starting a new game unlocks browser audio after the user gesture.
- Chapter 1 BGS plays in scenes with existing BGS assets.
- Coarse SFX events can be heard where mapped.
- Missing BGM files log warnings and do not break gameplay if BGM generation was blocked.
- Mute immediately suppresses SFX and mutes active loops.
- BGM/BGS/SFX sliders affect playback volume.

- [ ] **Step 6: Commit any final test-only fixes**

If verification required fixes, commit them with a narrow message:

```bash
rtk proxy git add apps/game/src/lib/audio apps/game/src/lib/components apps/game/src/lib/state apps/game/src/routes
rtk proxy git commit -m "fix(audio): stabilize gameplay audio runtime"
```

Skip this commit if there are no final fixes.

## Self-Review Checklist

- Spec coverage:
  - BGM/BGS loop playback: Tasks 2 and 4.
  - Coarse SFX: Tasks 3 and 5.
  - Persisted mute and per-channel volume: Tasks 1 and 6.
  - Missing-file silence: Task 2.
  - Chapter 1 rollout and BGM dependency rule: Task 7.
  - Tauri smoke verification: Task 8.
- Placeholder scan: clean.
- Type consistency:
  - `AudioPreferences` is defined in Task 1 and reused by Tasks 2, 4, and 6.
  - `GameplaySfxEvent` and `GameplayCommandName` are defined in Task 3 and reused by Tasks 4 and 5.
  - `syncGameplayAudioMode`, `playGameplaySfxEvent`, and `updateAudioPreferences` are defined in Task 4 and used by Tasks 5 and 6.

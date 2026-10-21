import type { DialogueLocaleManifestV1 } from "@lyra/dialogue-locale";
import { describe, expect, it, vi } from "vitest";
import {
  createDialogueVoiceLoader,
  EMPTY_DIALOGUE_VOICE_INDEX,
  fetchDialogueLocale,
  indexDialogueVoices,
} from "./dialogue-voice";

const tauri = vi.hoisted(() => ({
  invoke: vi.fn(),
  isTauri: vi.fn(() => false),
}));

vi.mock("@tauri-apps/api/core", () => tauri);

const manifest: DialogueLocaleManifestV1 = {
  schemaVersion: 1,
  locale: "ja",
  chapters: [
    {
      id: "chapter_1",
      lines: [
        {
          speaker: "相馬律",
          expression: null,
          zh: "不說謊。",
          text: "嘘をつかない。",
          voice: "voice.ja.ch1_soma_ritsu_0001",
        },
        {
          speaker: "早坂茜",
          expression: "concerned",
          zh: "門鎖時間線指向他。",
          text: "ドアロックの記録は彼を指してる。",
          voice: "voice.ja.ch1_hayasaka_akane_0001",
        },
        {
          speaker: "早坂茜",
          expression: null,
          zh: "還沒錄音。",
          text: "まだ録音してない。",
          voice: null,
        },
      ],
    },
    {
      id: "chapter_2",
      lines: [
        {
          speaker: "相馬律",
          expression: null,
          zh: "不說謊。",
          text: "嘘をつかない。",
          voice: "voice.ja.ch2_soma_ritsu_0001",
        },
      ],
    },
  ],
};

describe("indexDialogueVoices", () => {
  const index = indexDialogueVoices(manifest);

  it("finds a clip by chapter, speaker, text and expression", () => {
    expect(
      index.voiceFor({
        chapterId: "chapter_1",
        speaker: "相馬律",
        text: "不說謊。",
        expression: null,
      }),
    ).toBe("voice.ja.ch1_soma_ritsu_0001");
    expect(
      index.voiceFor({
        chapterId: "chapter_2",
        speaker: "相馬律",
        text: "不說謊。",
        expression: null,
      }),
    ).toBe("voice.ja.ch2_soma_ritsu_0001");
    expect(
      index.voiceFor({
        chapterId: "chapter_1",
        speaker: "早坂茜",
        text: "門鎖時間線指向他。",
        expression: "concerned",
      }),
    ).toBe("voice.ja.ch1_hayasaka_akane_0001");
  });

  it("treats the standard portrait as no expression", () => {
    expect(
      index.voiceFor({
        chapterId: "chapter_1",
        speaker: "相馬律",
        text: "不說謊。",
        expression: "standard",
      }),
    ).toBe("voice.ja.ch1_soma_ritsu_0001");
  });

  it("returns null for unvoiced, unknown or differently expressed lines", () => {
    const line = { chapterId: "chapter_1", speaker: "早坂茜" };
    expect(
      index.voiceFor({ ...line, text: "還沒錄音。", expression: null }),
    ).toBeNull();
    expect(
      index.voiceFor({ ...line, text: "門鎖時間線指向他。", expression: null }),
    ).toBeNull();
    expect(
      index.voiceFor({
        ...line,
        chapterId: "chapter_9",
        text: "門鎖時間線指向他。",
        expression: "concerned",
      }),
    ).toBeNull();
  });

  it("returns the empty index when nothing is voiced", () => {
    expect(indexDialogueVoices(null)).toBe(EMPTY_DIALOGUE_VOICE_INDEX);
    expect(
      indexDialogueVoices({ schemaVersion: 1, locale: "ja", chapters: [] }),
    ).toBe(EMPTY_DIALOGUE_VOICE_INDEX);
  });
});

describe("createDialogueVoiceLoader", () => {
  it("fetches the Japanese manifest once and reuses the index", async () => {
    const fetcher = vi.fn(async () => manifest);
    const load = createDialogueVoiceLoader(fetcher, { warn: vi.fn() });

    const first = await load();
    const second = await load();

    expect(fetcher).toHaveBeenCalledExactlyOnceWith("ja");
    expect(second).toBe(first);
    expect(
      first.voiceFor({
        chapterId: "chapter_1",
        speaker: "相馬律",
        text: "不說謊。",
        expression: null,
      }),
    ).toBe("voice.ja.ch1_soma_ritsu_0001");
  });

  it("warns once and plays on without voices when the manifest fails to load", async () => {
    const warn = vi.fn();
    const fetcher = vi.fn(async () => {
      throw { code: "dialogueLocaleLoadFailed", message: "bad json" };
    });
    const load = createDialogueVoiceLoader(fetcher, { warn });

    expect(await load()).toBe(EMPTY_DIALOGUE_VOICE_INDEX);
    expect(await load()).toBe(EMPTY_DIALOGUE_VOICE_INDEX);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledExactlyOnceWith(
      "[GameplayAudio] Voice lines unavailable: the ja dialogue locale could not be loaded (bad json)",
    );
  });
});

describe("fetchDialogueLocale", () => {
  it("has nothing to read outside the Tauri shell", async () => {
    await expect(fetchDialogueLocale("ja")).resolves.toBeNull();
  });

  it("reads the manifest through the Rust shell inside Tauri", async () => {
    tauri.isTauri.mockReturnValueOnce(true);
    tauri.invoke.mockResolvedValueOnce(manifest);
    await expect(fetchDialogueLocale("ja")).resolves.toBe(manifest);
    expect(tauri.invoke).toHaveBeenCalledExactlyOnceWith(
      "get_dialogue_locale",
      { locale: "ja" },
    );
  });
});

describe("EMPTY_DIALOGUE_VOICE_INDEX", () => {
  it("voices nothing", () => {
    expect(
      EMPTY_DIALOGUE_VOICE_INDEX.voiceFor({
        chapterId: "chapter_1",
        speaker: "相馬律",
        text: "不說謊。",
        expression: null,
      }),
    ).toBeNull();
  });
});

describe("createDialogueVoiceLoader errors", () => {
  it("reports a plain rejection reason as text", async () => {
    const warn = vi.fn();
    const load = createDialogueVoiceLoader(() => Promise.reject("ipc closed"), {
      warn,
    });
    expect(await load()).toBe(EMPTY_DIALOGUE_VOICE_INDEX);
    expect(warn).toHaveBeenCalledExactlyOnceWith(
      expect.stringContaining("could not be loaded (ipc closed)"),
    );
  });
});

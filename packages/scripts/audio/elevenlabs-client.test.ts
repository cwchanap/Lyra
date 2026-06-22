import { describe, expect, it, vi } from "vitest";
import {
  createElevenLabsClient,
  PaymentRequiredError,
} from "./elevenlabs-client";
import type { ElevenLabsGenerateRequest } from "./elevenlabs-client";

type FetchCall = {
  url: string;
  init: RequestInit | undefined;
};

describe("ElevenLabs client", () => {
  it("shapes BGM requests for the music endpoint", async () => {
    const { fetch, calls } = mockFetchReturning(new Uint8Array([1, 2, 3, 4]));
    const client = createElevenLabsClient({ apiKey: "test-key", fetch });

    const audio = await client.generate({
      id: "low_tension_rain",
      channel: "bgm",
      prompt: "Low tension rainy Tokyo strings.",
      loop: true,
      intendedDurationSeconds: 42.4,
    });

    expect(audio).toHaveLength(4);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain("/v1/music");
    expect(calls[0].url).toContain("output_format=mp3_44100_128");
    expect(headerValue(calls[0].init, "xi-api-key")).toBe("test-key");
    expect(headerValue(calls[0].init, "Content-Type")).toBe("application/json");
    expect(jsonBody(calls[0].init)).toEqual({
      prompt: "Low tension rainy Tokyo strings.",
      music_length_ms: 42400,
      force_instrumental: true,
    });
  });

  it("shapes BGS requests for the sound-generation endpoint", async () => {
    const { fetch, calls } = mockFetchReturning(new Uint8Array([5, 6, 7]));
    const client = createElevenLabsClient({ apiKey: "test-key", fetch });

    await client.generate({
      id: "rain_street_light",
      channel: "bgs",
      prompt: "Steady light Tokyo street rain.",
      loop: true,
      intendedDurationSeconds: 30,
    });

    expect(calls[0].url).toContain("/v1/sound-generation");
    expect(jsonBody(calls[0].init)).toEqual({
      text: "Steady light Tokyo street rain.",
      loop: true,
      duration_seconds: 30,
      prompt_influence: 0.3,
      model_id: "eleven_text_to_sound_v2",
    });
  });

  it("uses sound generation for SFX requests", async () => {
    const { fetch, calls } = mockFetchReturning(new Uint8Array([8, 9]));
    const client = createElevenLabsClient({ apiKey: "test-key", fetch });

    await client.generate({
      id: "door_chime",
      channel: "sfx",
      prompt: "Short door chime in a quiet office.",
      loop: false,
      intendedDurationSeconds: 2.5,
    });

    expect(calls[0].url).toContain("/v1/sound-generation");
    expect(jsonBody(calls[0].init)).toMatchObject({
      text: "Short door chime in a quiet office.",
      loop: false,
      duration_seconds: 2.5,
      model_id: "eleven_text_to_sound_v2",
    });
  });

  it("includes channel, id, and response status in failed generation errors", async () => {
    const fetch = vi.fn(
      async () =>
        new Response("rate limited", {
          status: 429,
          statusText: "Too Many Requests",
        }),
    ) as unknown as typeof globalThis.fetch;
    const client = createElevenLabsClient({ apiKey: "test-key", fetch });
    const request: ElevenLabsGenerateRequest = {
      id: "rain_street_light",
      channel: "bgs",
      prompt: "Steady light Tokyo street rain.",
      loop: true,
      intendedDurationSeconds: 30,
    };

    await expect(client.generate(request)).rejects.toThrow(
      /bgs.*rain_street_light.*429.*Too Many Requests/,
    );
  });

  it("throws a typed PaymentRequiredError on 402 so callers can branch on billing failures", async () => {
    const fetch = vi.fn(
      async () =>
        new Response("payment required", {
          status: 402,
          statusText: "Payment Required",
        }),
    ) as unknown as typeof globalThis.fetch;
    const client = createElevenLabsClient({ apiKey: "test-key", fetch });
    const request: ElevenLabsGenerateRequest = {
      id: "rain_street_light",
      channel: "bgs",
      prompt: "Steady light Tokyo street rain.",
      loop: true,
      intendedDurationSeconds: 30,
    };

    await expect(client.generate(request)).rejects.toBeInstanceOf(
      PaymentRequiredError,
    );
    try {
      await client.generate(request);
    } catch (error) {
      expect(error).toBeInstanceOf(PaymentRequiredError);
      const typed = error as PaymentRequiredError;
      expect(typed.channel).toBe("bgs");
      expect(typed.id).toBe("rain_street_light");
      expect(typed.status).toBe(402);
      expect(typed.message).toMatch(/402 Payment Required/);
    }
  });
});

function mockFetchReturning(bytes: Uint8Array): {
  fetch: typeof globalThis.fetch;
  calls: FetchCall[];
} {
  const calls: FetchCall[] = [];
  const fetch = vi.fn(
    async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return new Response(bytes, { status: 200 });
    },
  ) as unknown as typeof globalThis.fetch;
  return { fetch, calls };
}

function headerValue(
  init: RequestInit | undefined,
  header: string,
): string | null {
  return new Headers(init?.headers).get(header);
}

function jsonBody(init: RequestInit | undefined): unknown {
  return JSON.parse(String(init?.body));
}

import { describe, expect, it } from "vitest";
import { PaymentRequiredError } from "../audio/elevenlabs-client";
import { createTtsClient, ttsEndpoint } from "./tts-client";
import type { TtsBody } from "./tts-request";

const BODY: TtsBody = {
  text: "[calm] こんにちは。",
  model_id: "eleven_v3",
  voice_settings: {
    stability: 0.5,
    similarity_boost: 0.75,
    style: 0,
    speed: 1,
  },
  seed: 1,
};

describe("createTtsClient", () => {
  it("posts the body to the voice's text-to-speech endpoint with the key", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const client = createTtsClient({
      apiKey: "key",
      fetch: (async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        return new Response(new Uint8Array([1, 2, 3]));
      }) as unknown as typeof fetch,
    });
    const bytes = await client.speak({ id: "c1", voiceId: "v1", body: BODY });
    expect([...bytes]).toEqual([1, 2, 3]);
    expect(calls[0]?.url).toBe(ttsEndpoint("v1"));
    expect(calls[0]?.url).toBe(
      "https://api.elevenlabs.io/v1/text-to-speech/v1?output_format=mp3_44100_128",
    );
    expect(
      (calls[0]?.init.headers as Record<string, string>)["xi-api-key"],
    ).toBe("key");
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual(BODY);
  });

  it("throws PaymentRequiredError for billing failures and a plain error otherwise", async () => {
    const respond = (status: number, body: string) =>
      createTtsClient({
        apiKey: "key",
        fetch: (async () =>
          new Response(body, { status })) as unknown as typeof fetch,
      });
    const payment = respond(
      401,
      '{"detail":{"status":"quota_exceeded"}}',
    ).speak({
      id: "c1",
      voiceId: "v1",
      body: BODY,
    });
    await expect(payment).rejects.toBeInstanceOf(PaymentRequiredError);
    await payment.catch((error: PaymentRequiredError) => {
      expect(error.channel).toBe("voice");
      expect(error.id).toBe("c1");
    });
    const badKey = respond(
      401,
      '{"detail":{"status":"invalid_api_key"}}',
    ).speak({
      id: "c1",
      voiceId: "v1",
      body: BODY,
    });
    await expect(badKey).rejects.toThrow(/voice generation failed for c1: 401/);
    await expect(badKey).rejects.not.toBeInstanceOf(PaymentRequiredError);
  });
});

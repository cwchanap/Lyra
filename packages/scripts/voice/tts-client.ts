import {
  isPaymentFailure,
  PaymentRequiredError,
} from "../audio/elevenlabs-client";
import type { TtsBody } from "./tts-request";

export const TTS_OUTPUT_FORMAT = "mp3_44100_128";

export type TtsClient = {
  /** Returns the provider's mp3 bytes for one clip. `id` names it in errors. */
  speak(input: {
    id: string;
    voiceId: string;
    body: TtsBody;
  }): Promise<Uint8Array>;
};

export function ttsEndpoint(voiceId: string): string {
  return `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=${TTS_OUTPUT_FORMAT}`;
}

/**
 * ElevenLabs text-to-speech. Billing and quota failures throw
 * {@link PaymentRequiredError} with channel `voice`, like the sound tools.
 */
export function createTtsClient(input: {
  apiKey: string;
  fetch?: typeof fetch;
}): TtsClient {
  const fetchImpl = input.fetch ?? fetch;
  return {
    async speak({ id, voiceId, body }) {
      const response = await fetchImpl(ttsEndpoint(voiceId), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "audio/mpeg",
          "xi-api-key": input.apiKey,
        },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        if (isPaymentFailure(response.status, detail)) {
          throw new PaymentRequiredError(
            "voice",
            id,
            response.status,
            response.statusText,
            detail || undefined,
          );
        }
        throw new Error(
          `ElevenLabs voice generation failed for ${id}: ${response.status} ${response.statusText}${detail ? `\n${detail}` : ""}`,
        );
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.length === 0) {
        throw new Error(`ElevenLabs returned no audio for ${id}.`);
      }
      return bytes;
    },
  };
}

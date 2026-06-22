import type { SoundPlanChannel } from "./types";

/**
 * Thrown when ElevenLabs returns `402 Payment Required` (or an equivalent
 * payment-method-required error). Kept as a typed error class — distinct from
 * the generic generation failure — so the generate command can surface
 * actionable top-up guidance, return a distinct exit code, and (per the
 * CLAUDE.md contract) steer the user away from a wasteful `--force` retry.
 */
export class PaymentRequiredError extends Error {
  readonly status = 402;
  constructor(
    public readonly channel: SoundPlanChannel,
    public readonly id: string,
    public readonly statusText: string,
  ) {
    super(
      `ElevenLabs ${channel} generation failed for ${id}: 402 ${statusText}`,
    );
    this.name = "PaymentRequiredError";
  }
}

export type ElevenLabsGenerateRequest = {
  id: string;
  channel: SoundPlanChannel;
  prompt: string;
  loop: boolean;
  intendedDurationSeconds: number;
  forceInstrumental?: boolean;
};

export type ElevenLabsClient = {
  generate(request: ElevenLabsGenerateRequest): Promise<Uint8Array>;
};

/**
 * The ElevenLabs endpoint URL used for a given channel. Exposed so the
 * generation step can record it in plan metadata (spec L284: "endpoint or
 * model when known") without changing the client's byte-only return type.
 */
export function endpointForChannel(channel: SoundPlanChannel): string {
  return channel === "bgm"
    ? "https://api.elevenlabs.io/v1/music?output_format=mp3_44100_128"
    : "https://api.elevenlabs.io/v1/sound-generation?output_format=mp3_44100_128";
}

export function createElevenLabsClient(input: {
  apiKey: string;
  fetch?: typeof fetch;
}): ElevenLabsClient {
  const fetchImpl = input.fetch ?? fetch;

  return {
    async generate(request) {
      const endpoint = endpointForChannel(request.channel);
      const body =
        request.channel === "bgm"
          ? {
              prompt: request.prompt,
              music_length_ms: Math.round(
                request.intendedDurationSeconds * 1000,
              ),
              force_instrumental: request.forceInstrumental ?? true,
            }
          : {
              text: request.prompt,
              loop: request.loop,
              duration_seconds: request.intendedDurationSeconds,
              prompt_influence: 0.3,
              model_id: "eleven_text_to_sound_v2",
            };

      const response = await fetchImpl(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "xi-api-key": input.apiKey,
        },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        // 402 is a billing/credit problem, not a transient or input error.
        // Surface it as a typed error so the caller can give actionable
        // guidance and avoid a credit-burning --force retry (CLAUDE.md).
        if (response.status === 402) {
          throw new PaymentRequiredError(
            request.channel,
            request.id,
            response.statusText,
          );
        }
        throw new Error(
          `ElevenLabs ${request.channel} generation failed for ${request.id}: ${response.status} ${response.statusText}`,
        );
      }
      return new Uint8Array(await response.arrayBuffer());
    },
  };
}

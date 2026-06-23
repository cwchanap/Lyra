import type { SoundPlanChannel } from "./types";

/**
 * Thrown when ElevenLabs signals a billing, credit, or quota problem.
 * Detection covers both the literal `402 Payment Required` response AND the
 * more common ElevenLabs pattern of returning quota/credit exhaustion as a
 * `401 Unauthorized` (or sometimes 400) with a descriptive body — see the
 * ElevenLabs docs: `quota_exceeded` is documented as a 401, and the body
 * carries the real reason (`{"error":"quota_exceeded"}`, `needs_payment`,
 * `add a payment method`, etc.).
 *
 * Kept as a typed error class — distinct from the generic generation failure —
 * so the generate command can surface actionable top-up guidance, return a
 * distinct exit code, and (per the CLAUDE.md contract) steer the user away
 * from a wasteful `--force` retry.
 */
export class PaymentRequiredError extends Error {
  constructor(
    public readonly channel: SoundPlanChannel,
    public readonly id: string,
    public readonly status: number,
    public readonly statusText: string,
    public readonly detail?: string,
  ) {
    const tail = detail && detail.length > 0 ? `\n${detail}` : "";
    super(
      `ElevenLabs ${channel} generation failed for ${id}: ${status} ${statusText}${tail}`,
    );
    this.name = "PaymentRequiredError";
  }
}

/**
 * Returns true when an ElevenLabs error response represents a billing, credit,
 * or quota problem rather than a transient or input error. Detection combines
 * the HTTP status (literal 402) with body substring matching, because
 * ElevenLabs surfaces most quota/credit issues as 401/400 with a descriptive
 * body. A plain `invalid_api_key` 401 must NOT match — its remedy is "fix the
 * key," not "top up credits."
 */
function isPaymentFailure(status: number, body: string): boolean {
  if (status === 402) return true;
  return /quota_exceeded|exceeds your quota|payment_required|needs_payment|payment_method_required|add a payment method/i.test(
    body,
  );
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
        // Read the body on every error path — ElevenLabs surfaces the real
        // reason (quota_exceeded, needs_payment, ...) in the body, frequently
        // over a 401/400 status rather than a literal 402. Without reading it
        // the generic message is opaque and the documented exit-3 contract is
        // silently suppressed for the most common billing failure mode.
        const body = await response.text().catch(() => "");
        if (isPaymentFailure(response.status, body)) {
          throw new PaymentRequiredError(
            request.channel,
            request.id,
            response.status,
            response.statusText,
            body || undefined,
          );
        }
        const tail = body && body.length > 0 ? `\n${body}` : "";
        throw new Error(
          `ElevenLabs ${request.channel} generation failed for ${request.id}: ${response.status} ${response.statusText}${tail}`,
        );
      }
      return new Uint8Array(await response.arrayBuffer());
    },
  };
}

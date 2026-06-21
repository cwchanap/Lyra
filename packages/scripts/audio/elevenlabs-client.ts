import type { SoundPlanChannel } from "./types";

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

export function createElevenLabsClient(input: {
  apiKey: string;
  fetch?: typeof fetch;
}): ElevenLabsClient {
  const fetchImpl = input.fetch ?? fetch;

  return {
    async generate(request) {
      const endpoint =
        request.channel === "bgm"
          ? "https://api.elevenlabs.io/v1/music?output_format=mp3_44100_128"
          : "https://api.elevenlabs.io/v1/sound-generation?output_format=mp3_44100_128";
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
        throw new Error(
          `ElevenLabs ${request.channel} generation failed for ${request.id}: ${response.status} ${response.statusText}`,
        );
      }
      return new Uint8Array(await response.arrayBuffer());
    },
  };
}

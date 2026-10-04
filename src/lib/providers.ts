/**
 * Server-side TTS providers. These run in the plugin worker only; API keys are
 * resolved from Paperclip secrets per request and never leave the worker.
 */
import { openaiSpeechUrl, type TtsConfig } from "./config.ts";

export const AUDIO_MIME = "audio/mpeg";
const MAX_AUDIO_BYTES = 50 * 1024 * 1024;

export class ProviderError extends Error {
  readonly status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "ProviderError";
    this.status = status;
  }
}

export interface SynthesizeChunkInput {
  config: TtsConfig;
  text: string;
  apiKey: string | null;
}

async function readAudio(res: Response): Promise<Buffer> {
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length === 0) throw new ProviderError("The provider returned an empty audio response.");
  if (buf.length > MAX_AUDIO_BYTES) throw new ProviderError("The provider returned more audio than allowed (50 MB).");
  return buf;
}

async function describeFailure(provider: string, res: Response): Promise<ProviderError> {
  let detail = "";
  try {
    const body = (await res.text()).slice(0, 500);
    try {
      const json = JSON.parse(body) as { error?: { message?: string } | string; detail?: unknown; message?: string };
      const err = json.error;
      detail =
        (typeof err === "string" ? err : err?.message) ??
        (typeof json.detail === "string" ? json.detail : json.detail ? JSON.stringify(json.detail) : undefined) ??
        json.message ??
        body;
    } catch {
      detail = body;
    }
  } catch {
    // ignore unreadable bodies
  }
  const hint =
    res.status === 401 || res.status === 403
      ? " Check the API key secret in the plugin settings."
      : res.status === 429
        ? " Rate limit or quota exceeded at the provider."
        : "";
  return new ProviderError(`${provider} responded ${res.status}${detail ? `: ${detail.trim()}` : ""}.${hint}`, res.status);
}

async function post(provider: string, url: string, init: RequestInit, timeoutSec: number): Promise<Buffer> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, method: "POST", redirect: "error", signal: AbortSignal.timeout(timeoutSec * 1000) });
  } catch (err) {
    const e = err as Error & { cause?: { code?: string } };
    if (e.name === "TimeoutError") throw new ProviderError(`${provider} did not answer within ${timeoutSec}s.`);
    const code = e.cause?.code ? ` (${e.cause.code})` : "";
    throw new ProviderError(`Cannot reach ${provider} at ${new URL(url).origin}${code}. Is it reachable from the Paperclip server?`);
  }
  if (!res.ok) throw await describeFailure(provider, res);
  return readAudio(res);
}

export async function synthesizeOpenAiCompatible({ config, text, apiKey }: SynthesizeChunkInput): Promise<Buffer> {
  const headers: Record<string, string> = { "Content-Type": "application/json", Accept: AUDIO_MIME };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  const body: Record<string, unknown> = {
    model: config.openaiModel,
    input: text,
    voice: config.openaiVoice,
    response_format: "mp3",
  };
  if (config.openaiSpeed !== 1) body.speed = config.openaiSpeed;
  return post("OpenAI-compatible TTS", openaiSpeechUrl(config.openaiBaseUrl), { headers, body: JSON.stringify(body) }, config.requestTimeoutSec);
}

export async function synthesizeElevenLabs({ config, text, apiKey }: SynthesizeChunkInput): Promise<Buffer> {
  if (!apiKey) throw new ProviderError("ElevenLabs needs an API key. Set the 'ElevenLabs: API key' secret in the plugin settings.");
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(config.elevenlabsVoiceId)}?output_format=mp3_44100_128`;
  return post(
    "ElevenLabs",
    url,
    {
      headers: { "Content-Type": "application/json", Accept: AUDIO_MIME, "xi-api-key": apiKey },
      body: JSON.stringify({ text, model_id: config.elevenlabsModel }),
    },
    config.requestTimeoutSec,
  );
}

export function providerVoiceIdentity(config: TtsConfig): { endpoint: string; model: string; voice: string } {
  if (config.provider === "elevenlabs") {
    return { endpoint: "https://api.elevenlabs.io", model: config.elevenlabsModel, voice: config.elevenlabsVoiceId };
  }
  return {
    endpoint: openaiSpeechUrl(config.openaiBaseUrl),
    model: config.openaiModel,
    voice: `${config.openaiVoice}@${config.openaiSpeed}`,
  };
}

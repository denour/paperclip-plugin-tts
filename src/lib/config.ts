/**
 * Plugin settings: JSON Schema (rendered by Paperclip's settings form) plus a
 * parser that applies defaults. Keep the two in sync.
 */

export type ProviderId = "browser" | "openai-compatible" | "elevenlabs";

export const PROVIDERS: ProviderId[] = ["browser", "openai-compatible", "elevenlabs"];

export interface TtsConfig {
  provider: ProviderId;
  maxChars: number;
  codeBlockLabel: string;
  tableLabel: string;
  browserLang: string;
  browserVoice: string;
  browserRate: number;
  openaiBaseUrl: string;
  openaiApiKey: unknown;
  openaiModel: string;
  openaiVoice: string;
  openaiSpeed: number;
  elevenlabsApiKey: unknown;
  elevenlabsVoiceId: string;
  elevenlabsModel: string;
  chunkChars: number;
  requestTimeoutSec: number;
  cacheDir: string;
  cacheMaxMb: number;
}

export const DEFAULT_CONFIG: TtsConfig = {
  provider: "browser",
  maxChars: 4000,
  codeBlockLabel: "Code block",
  tableLabel: "Table",
  browserLang: "",
  browserVoice: "",
  browserRate: 1,
  openaiBaseUrl: "https://api.openai.com/v1",
  openaiApiKey: null,
  openaiModel: "gpt-4o-mini-tts",
  openaiVoice: "alloy",
  openaiSpeed: 1,
  elevenlabsApiKey: null,
  // "Sarah": one of ElevenLabs' default voices, available on every account.
  elevenlabsVoiceId: "EXAVITQu4vr4xnSDxMaL",
  // Multilingual (32 languages), low latency, half the credits of v2 models.
  elevenlabsModel: "eleven_flash_v2_5",
  chunkChars: 1000,
  requestTimeoutSec: 180,
  cacheDir: "",
  cacheMaxMb: 200,
};

export const instanceConfigSchema = {
  type: "object",
  properties: {
    provider: {
      type: "string",
      title: "Provider",
      enum: PROVIDERS,
      default: DEFAULT_CONFIG.provider,
      description:
        "browser = Web Speech API in the viewer's browser (no setup, no server-side calls). openai-compatible = any server exposing POST /v1/audio/speech (OpenAI, Kokoro-FastAPI, openedai-speech...). elevenlabs = ElevenLabs API.",
    },
    maxChars: {
      type: "integer",
      title: "Max characters",
      minimum: 50,
      maximum: 100000,
      default: DEFAULT_CONFIG.maxChars,
      description: "Longer text is cut at a sentence boundary and the player says so.",
    },
    codeBlockLabel: {
      type: "string",
      title: "Code block label",
      default: DEFAULT_CONFIG.codeBlockLabel,
      description: "Spoken instead of each fenced code block. Translate it to your content's language.",
    },
    tableLabel: {
      type: "string",
      title: "Table label",
      default: DEFAULT_CONFIG.tableLabel,
      description: "Spoken instead of each markdown table.",
    },
    browserLang: {
      type: "string",
      title: "Browser: language",
      default: "",
      description: "BCP 47 tag such as en-US or es-MX. Empty = the viewer's browser language.",
    },
    browserVoice: {
      type: "string",
      title: "Browser: voice name",
      default: "",
      description: "Optional. Case-insensitive substring of a voice name offered by the browser (e.g. 'Google', 'Samantha').",
    },
    browserRate: {
      type: "number",
      title: "Browser: rate",
      minimum: 0.5,
      maximum: 2,
      default: DEFAULT_CONFIG.browserRate,
    },
    openaiBaseUrl: {
      type: "string",
      title: "OpenAI-compatible: base URL",
      default: DEFAULT_CONFIG.openaiBaseUrl,
      description: "The plugin calls {base}/audio/speech, adding /v1 when the base URL does not end with it. Must be reachable from the Paperclip server.",
    },
    openaiApiKey: {
      format: "secret-ref",
      title: "OpenAI-compatible: API key",
      description: "Paperclip secret. Optional for self-hosted servers without auth.",
    },
    openaiModel: {
      type: "string",
      title: "OpenAI-compatible: model",
      default: DEFAULT_CONFIG.openaiModel,
      description: "OpenAI: gpt-4o-mini-tts, tts-1, tts-1-hd. Kokoro-FastAPI: kokoro.",
    },
    openaiVoice: {
      type: "string",
      title: "OpenAI-compatible: voice",
      default: DEFAULT_CONFIG.openaiVoice,
      description: "OpenAI: alloy, ash, coral, echo, nova, sage, shimmer... Kokoro: af_heart, ef_dora...",
    },
    openaiSpeed: {
      type: "number",
      title: "OpenAI-compatible: speed",
      minimum: 0.25,
      maximum: 4,
      default: DEFAULT_CONFIG.openaiSpeed,
    },
    elevenlabsApiKey: {
      format: "secret-ref",
      title: "ElevenLabs: API key",
      description: "Paperclip secret holding your ElevenLabs API key (Developers > API keys).",
    },
    elevenlabsVoiceId: {
      type: "string",
      title: "ElevenLabs: voice ID",
      default: DEFAULT_CONFIG.elevenlabsVoiceId,
      description: "Voice ID from the ElevenLabs voice library (the default is the premade voice 'Sarah').",
    },
    elevenlabsModel: {
      type: "string",
      title: "ElevenLabs: model",
      default: DEFAULT_CONFIG.elevenlabsModel,
      description: "eleven_flash_v2_5 (cheap, fast, multilingual) or eleven_multilingual_v2 (higher quality).",
    },
    chunkChars: {
      type: "integer",
      title: "Server: chunk size",
      minimum: 100,
      maximum: 4096,
      default: DEFAULT_CONFIG.chunkChars,
      description: "Long text is sent to server providers in chunks of at most this many characters.",
    },
    requestTimeoutSec: {
      type: "integer",
      title: "Server: request timeout (s)",
      minimum: 5,
      maximum: 900,
      default: DEFAULT_CONFIG.requestTimeoutSec,
      description: "Per chunk. Raise it for slow self-hosted engines.",
    },
    cacheDir: {
      type: "string",
      title: "Server: cache directory",
      default: "",
      description: "Absolute path for cached audio. Empty = ~/.paperclip/plugin-cache/paperclip-plugin-tts of the server user.",
    },
    cacheMaxMb: {
      type: "integer",
      title: "Server: cache size limit (MB)",
      minimum: 0,
      maximum: 100000,
      default: DEFAULT_CONFIG.cacheMaxMb,
      description: "Oldest entries are evicted beyond this size. 0 disables the cache.",
    },
  },
} as const;

function str(v: unknown, d: string): string {
  return typeof v === "string" && v.trim() !== "" ? v.trim() : d;
}

function num(v: unknown, d: number, min: number, max: number): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  if (!Number.isFinite(n)) return d;
  return Math.min(max, Math.max(min, n));
}

export function parseConfig(raw: Record<string, unknown> | null | undefined): TtsConfig {
  const c = raw ?? {};
  const provider = PROVIDERS.includes(c.provider as ProviderId) ? (c.provider as ProviderId) : DEFAULT_CONFIG.provider;
  return {
    provider,
    maxChars: Math.round(num(c.maxChars, DEFAULT_CONFIG.maxChars, 50, 100000)),
    codeBlockLabel: str(c.codeBlockLabel, DEFAULT_CONFIG.codeBlockLabel),
    tableLabel: str(c.tableLabel, DEFAULT_CONFIG.tableLabel),
    browserLang: str(c.browserLang, ""),
    browserVoice: str(c.browserVoice, ""),
    browserRate: num(c.browserRate, 1, 0.5, 2),
    openaiBaseUrl: str(c.openaiBaseUrl, DEFAULT_CONFIG.openaiBaseUrl),
    openaiApiKey: c.openaiApiKey ?? null,
    openaiModel: str(c.openaiModel, DEFAULT_CONFIG.openaiModel),
    openaiVoice: str(c.openaiVoice, DEFAULT_CONFIG.openaiVoice),
    openaiSpeed: num(c.openaiSpeed, 1, 0.25, 4),
    elevenlabsApiKey: c.elevenlabsApiKey ?? null,
    elevenlabsVoiceId: str(c.elevenlabsVoiceId, DEFAULT_CONFIG.elevenlabsVoiceId),
    elevenlabsModel: str(c.elevenlabsModel, DEFAULT_CONFIG.elevenlabsModel),
    chunkChars: Math.round(num(c.chunkChars, DEFAULT_CONFIG.chunkChars, 100, 4096)),
    requestTimeoutSec: Math.round(num(c.requestTimeoutSec, DEFAULT_CONFIG.requestTimeoutSec, 5, 900)),
    cacheDir: str(c.cacheDir, ""),
    cacheMaxMb: Math.round(num(c.cacheMaxMb, DEFAULT_CONFIG.cacheMaxMb, 0, 100000)),
  };
}

/** `{base}/audio/speech`, inserting `/v1` unless the base already ends with a version segment. */
export function openaiSpeechUrl(baseUrl: string): string {
  const base = baseUrl.replace(/\/+$/, "");
  return /\/v\d+$/.test(base) ? `${base}/audio/speech` : `${base}/v1/audio/speech`;
}

import { definePlugin, runWorker, type PluginContext } from "@paperclipai/plugin-sdk";
import { cacheGet, cachePut, resolveCacheDir } from "./lib/audio-cache.ts";
import { cacheKey } from "./lib/cache-key.ts";
import { cleanText, limitText, splitIntoChunks } from "./lib/clean-text.ts";
import { parseConfig, type TtsConfig } from "./lib/config.ts";
import {
  AUDIO_MIME,
  ProviderError,
  providerVoiceIdentity,
  synthesizeElevenLabs,
  synthesizeOpenAiCompatible,
} from "./lib/providers.ts";

type SourceKind = "issue" | "comment";

interface SourceParams {
  companyId: string;
  kind: SourceKind;
  issueId: string;
  commentId?: string;
}

interface PreparedText {
  text: string;
  truncated: boolean;
  chars: number;
  originalChars: number;
}

/** In-flight and freshly finished generations, keyed by cache key. */
interface Job {
  status: "pending" | "done" | "error";
  error?: string;
  audio?: Buffer;
  startedAt: number;
}

const jobs = new Map<string, Job>();
/** Server providers are often a single GPU: run at most this many generations at once. */
const MAX_CONCURRENT = 2;
let running = 0;
const queue: Array<() => void> = [];

async function withSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (running >= MAX_CONCURRENT) await new Promise<void>((resolve) => queue.push(resolve));
  running += 1;
  try {
    return await fn();
  } finally {
    running -= 1;
    queue.shift()?.();
  }
}

function readSource(params: Record<string, unknown>): SourceParams {
  const companyId = typeof params.companyId === "string" ? params.companyId : "";
  const kind = params.kind === "comment" ? "comment" : params.kind === "issue" ? "issue" : null;
  const issueId = typeof params.issueId === "string" ? params.issueId : "";
  const commentId = typeof params.commentId === "string" ? params.commentId : undefined;
  if (!companyId || !kind || !issueId || (kind === "comment" && !commentId)) {
    throw new Error("Expected { companyId, kind: 'issue' | 'comment', issueId, commentId? }");
  }
  return { companyId, kind, issueId, commentId };
}

async function loadConfig(ctx: PluginContext, companyId?: string): Promise<TtsConfig> {
  return parseConfig(await ctx.config.get(companyId || undefined));
}

async function prepareText(ctx: PluginContext, src: SourceParams, config: TtsConfig): Promise<PreparedText> {
  const issue = await ctx.issues.get(src.issueId, src.companyId);
  if (!issue) throw new Error("Issue not found.");
  let raw: string;
  if (src.kind === "issue") {
    const description = (issue.description ?? "").trim();
    raw = description ? `${issue.title}\n\n${description}` : issue.title;
  } else {
    const comments = await ctx.issues.listComments(src.issueId, src.companyId);
    const comment = comments.find((c) => c.id === src.commentId);
    if (!comment) throw new Error("Comment not found.");
    raw = comment.body ?? "";
  }
  const cleaned = cleanText(raw, { codeBlockLabel: config.codeBlockLabel, tableLabel: config.tableLabel });
  const limited = limitText(cleaned, config.maxChars);
  return { text: limited.text, truncated: limited.truncated, chars: limited.text.length, originalChars: limited.originalChars };
}

async function resolveApiKey(ctx: PluginContext, config: TtsConfig, companyId: string): Promise<string | null> {
  const field = config.provider === "elevenlabs" ? "elevenlabsApiKey" : "openaiApiKey";
  const ref = config[field];
  if (!ref || typeof ref !== "object") return null;
  try {
    return await ctx.secrets.resolve(ref as never, { companyId, configPath: field });
  } catch (err) {
    throw new ProviderError(`Could not read the API key secret (${field}): ${(err as Error).message}`);
  }
}

async function generate(ctx: PluginContext, config: TtsConfig, companyId: string, text: string): Promise<Buffer> {
  const apiKey = await resolveApiKey(ctx, config, companyId);
  const synth = config.provider === "elevenlabs" ? synthesizeElevenLabs : synthesizeOpenAiCompatible;
  const parts: Buffer[] = [];
  // MP3 frames can be concatenated byte-wise; players treat the result as one stream.
  for (const chunk of splitIntoChunks(text, config.chunkChars)) {
    parts.push(await withSlot(() => synth({ config, text: chunk, apiKey })));
  }
  return Buffer.concat(parts);
}

function startJob(ctx: PluginContext, key: string, config: TtsConfig, companyId: string, text: string): void {
  const job: Job = { status: "pending", startedAt: Date.now() };
  jobs.set(key, job);
  void (async () => {
    try {
      const audio = await generate(ctx, config, companyId, text);
      try {
        await cachePut(resolveCacheDir(config.cacheDir), key, audio, config.cacheMaxMb);
      } catch (err) {
        ctx.logger.warn("tts: could not write audio cache", { error: (err as Error).message });
      }
      job.status = "done";
      job.audio = audio;
      ctx.logger.info("tts: generated audio", { provider: config.provider, chars: text.length, bytes: audio.length, ms: Date.now() - job.startedAt });
    } catch (err) {
      job.status = "error";
      job.error = err instanceof ProviderError ? err.message : `TTS failed: ${(err as Error).message}`;
      ctx.logger.warn("tts: generation failed", { provider: config.provider, error: job.error });
    }
    // Forget finished jobs that nobody polls for.
    setTimeout(() => {
      if (jobs.get(key) === job) jobs.delete(key);
    }, 10 * 60 * 1000).unref?.();
  })();
}

const plugin = definePlugin({
  multiCompanyConfig: true,

  async setup(ctx) {
    /** Public (non-secret) settings the UI needs to pick a playback path. */
    ctx.data.register("tts-settings", async (params) => {
      const companyId = typeof params.companyId === "string" ? params.companyId : undefined;
      const config = await loadConfig(ctx, companyId);
      return {
        provider: config.provider,
        maxChars: config.maxChars,
        browser: { lang: config.browserLang, voice: config.browserVoice, rate: config.browserRate },
      };
    });

    /**
     * Comment list for the issue panel. Hosts that do not mount the
     * `commentAnnotation` slot still get a play button per comment this way.
     */
    ctx.data.register("tts-comments", async (params) => {
      const companyId = typeof params.companyId === "string" ? params.companyId : "";
      const issueId = typeof params.issueId === "string" ? params.issueId : "";
      if (!companyId || !issueId) return { comments: [] };
      const config = await loadConfig(ctx, companyId);
      const comments = await ctx.issues.listComments(issueId, companyId);
      return {
        comments: comments
          .filter((c) => !c.deletedAt && (c.body ?? "").trim() !== "")
          .map((c) => ({
            id: c.id,
            authorType: c.authorType,
            createdAt: c.createdAt,
            preview: limitText(cleanText(c.body, { codeBlockLabel: config.codeBlockLabel, tableLabel: config.tableLabel }), 90).text,
          }))
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
      };
    });

    /** Cleaned text for the in-browser provider (no audio is generated on the server). */
    ctx.actions.register("tts-text", async (params) => {
      const src = readSource(params);
      const config = await loadConfig(ctx, src.companyId);
      return prepareText(ctx, src, config);
    });

    /**
     * Server-side synthesis. Idempotent and poll-friendly: the UI calls it until
     * `status` is `ready` or `error`, so long generations never hit the host's
     * per-call RPC timeout.
     */
    ctx.actions.register("tts-speak", async (params) => {
      const src = readSource(params);
      const config = await loadConfig(ctx, src.companyId);
      if (config.provider === "browser") {
        return { status: "error", message: "The configured provider is 'browser'; audio is generated in the browser." };
      }
      const prepared = await prepareText(ctx, src, config);
      const meta = { truncated: prepared.truncated, chars: prepared.chars, originalChars: prepared.originalChars, provider: config.provider };
      if (!prepared.text) return { status: "error", message: "There is no text to read.", ...meta };

      const id = providerVoiceIdentity(config);
      const key = cacheKey({ provider: config.provider, ...id, format: "mp3", text: prepared.text });
      const ready = (audio: Buffer, source: "cache" | "generated") => ({
        status: "ready",
        source,
        key,
        mime: AUDIO_MIME,
        bytes: audio.length,
        audioBase64: audio.toString("base64"),
        ...meta,
      });

      const job = jobs.get(key);
      if (job?.status === "pending") return { status: "pending", key, ...meta };
      if (job?.status === "done" && job.audio) {
        jobs.delete(key);
        return ready(job.audio, "generated");
      }
      if (job?.status === "error") {
        jobs.delete(key); // the next click retries
        return { status: "error", message: job.error, key, ...meta };
      }

      if (config.cacheMaxMb > 0) {
        const cached = await cacheGet(resolveCacheDir(config.cacheDir), key);
        if (cached) return ready(cached, "cache");
      }
      startJob(ctx, key, config, src.companyId, prepared.text);
      return { status: "pending", key, ...meta };
    });
  },

  async onConfigChanged() {
    // Settings are read per request, so nothing to reload.
  },

  async onValidateConfig(raw) {
    const config = parseConfig(raw);
    const errors: string[] = [];
    const warnings: string[] = [];
    if (config.provider === "openai-compatible") {
      try {
        const u = new URL(config.openaiBaseUrl);
        if (!/^https?:$/.test(u.protocol)) errors.push("OpenAI-compatible base URL must be http(s).");
      } catch {
        errors.push("OpenAI-compatible base URL is not a valid URL.");
      }
      if (!raw.openaiApiKey && /api\.openai\.com/.test(config.openaiBaseUrl)) {
        errors.push("api.openai.com needs an API key secret.");
      }
    }
    if (config.provider === "elevenlabs" && !raw.elevenlabsApiKey) errors.push("ElevenLabs needs an API key secret.");
    if (config.cacheDir && !config.cacheDir.startsWith("/")) warnings.push("Cache directory is not absolute; the default is used.");
    return { ok: errors.length === 0, errors, warnings };
  },

  async onHealth() {
    return { status: "ok", details: { pendingJobs: [...jobs.values()].filter((j) => j.status === "pending").length } };
  },
});

export default plugin;
runWorker(plugin, import.meta.url);

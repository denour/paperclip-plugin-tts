import { createHash } from "node:crypto";

/** Everything that changes the generated audio must be part of the key. */
export interface CacheKeyInput {
  provider: string;
  /** Endpoint identity (base URL) so two servers never share entries. */
  endpoint?: string;
  model?: string;
  voice?: string;
  format?: string;
  /** Final text sent to the provider (already cleaned and truncated). */
  text: string;
}

/** Bump when the audio pipeline changes in a way that invalidates old entries. */
export const CACHE_KEY_VERSION = 1;

export function cacheKey(input: CacheKeyInput): string {
  const parts = [
    CACHE_KEY_VERSION,
    input.provider,
    (input.endpoint ?? "").replace(/\/+$/, ""),
    input.model ?? "",
    input.voice ?? "",
    input.format ?? "mp3",
    input.text,
  ];
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

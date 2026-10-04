/**
 * Content-addressed audio cache on the Paperclip server's disk.
 * Files are named `<sha256>.mp3`; least-recently-used entries are evicted
 * once the directory grows past the configured size.
 */
import { mkdir, readFile, readdir, rename, stat, unlink, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export function resolveCacheDir(configured: string): string {
  if (configured && path.isAbsolute(configured)) return configured;
  return path.join(os.homedir(), ".paperclip", "plugin-cache", "paperclip-plugin-tts");
}

function entryPath(dir: string, key: string): string {
  if (!/^[a-f0-9]{64}$/.test(key)) throw new Error("Invalid cache key");
  return path.join(dir, `${key}.mp3`);
}

export async function cacheGet(dir: string, key: string): Promise<Buffer | null> {
  const file = entryPath(dir, key);
  try {
    const buf = await readFile(file);
    const now = new Date();
    await utimes(file, now, now).catch(() => undefined); // LRU touch
    return buf;
  } catch {
    return null;
  }
}

export async function cachePut(dir: string, key: string, data: Buffer, maxMb: number): Promise<void> {
  if (maxMb <= 0) return;
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const file = entryPath(dir, key);
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, data, { mode: 0o600 });
  await rename(tmp, file);
  await evict(dir, maxMb * 1024 * 1024);
}

async function evict(dir: string, maxBytes: number): Promise<void> {
  const names = (await readdir(dir)).filter((n) => n.endsWith(".mp3"));
  const entries = await Promise.all(
    names.map(async (name) => {
      const s = await stat(path.join(dir, name)).catch(() => null);
      return s ? { name, size: s.size, mtime: s.mtimeMs } : null;
    }),
  );
  const files = entries.filter((e): e is { name: string; size: number; mtime: number } => e !== null);
  let total = files.reduce((sum, f) => sum + f.size, 0);
  files.sort((a, b) => a.mtime - b.mtime);
  for (const f of files) {
    if (total <= maxBytes) break;
    await unlink(path.join(dir, f.name)).catch(() => undefined);
    total -= f.size;
  }
}

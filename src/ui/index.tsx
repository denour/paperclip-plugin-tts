import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import {
  usePluginAction,
  usePluginData,
  type PluginCommentAnnotationProps,
  type PluginDetailTabProps,
} from "@paperclipai/plugin-sdk/ui";
import { splitIntoChunks } from "../lib/clean-text.ts";

type Source = { kind: "issue"; issueId: string } | { kind: "comment"; issueId: string; commentId: string };

interface Settings {
  provider: "browser" | "openai-compatible" | "elevenlabs";
  maxChars: number;
  browser: { lang: string; voice: string; rate: number };
}

interface TextResult {
  text: string;
  truncated: boolean;
  chars: number;
  originalChars: number;
}

interface SpeakResult {
  status: "pending" | "ready" | "error";
  message?: string;
  source?: "cache" | "generated";
  mime?: string;
  audioBase64?: string;
  truncated?: boolean;
  chars?: number;
  originalChars?: number;
}

type Phase = "idle" | "loading" | "playing" | "paused";

const POLL_MS = 1500;
const MAX_WAIT_MS = 15 * 60 * 1000;

/** Only one player at a time across the page. */
let stopActive: (() => void) | null = null;

function errorMessage(err: unknown): string {
  if (err && typeof err === "object" && "message" in err && typeof (err as { message: unknown }).message === "string") {
    return (err as { message: string }).message;
  }
  return String(err);
}

function base64ToBlobUrl(b64: string, mime: string): string {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return URL.createObjectURL(new Blob([bytes], { type: mime }));
}

async function loadVoices(): Promise<SpeechSynthesisVoice[]> {
  const synth = window.speechSynthesis;
  const now = synth.getVoices();
  if (now.length > 0) return now;
  return new Promise((resolve) => {
    const done = () => resolve(synth.getVoices());
    synth.addEventListener("voiceschanged", done, { once: true });
    setTimeout(done, 1500);
  });
}

function pickVoice(voices: SpeechSynthesisVoice[], lang: string, wanted: string): SpeechSynthesisVoice | null {
  if (wanted) {
    const w = wanted.toLowerCase();
    const byName = voices.find((v) => v.name.toLowerCase().includes(w) || v.voiceURI.toLowerCase().includes(w));
    if (byName) return byName;
  }
  const l = lang.toLowerCase();
  return (
    voices.find((v) => v.lang.toLowerCase() === l) ??
    voices.find((v) => v.lang.toLowerCase().split(/[-_]/)[0] === l.split(/[-_]/)[0]) ??
    null
  );
}

const styles: Record<string, CSSProperties> = {
  row: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontSize: 12, lineHeight: "16px" },
  button: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "3px 10px",
    borderRadius: 999,
    border: "1px solid color-mix(in srgb, currentColor 25%, transparent)",
    background: "transparent",
    color: "inherit",
    font: "inherit",
    cursor: "pointer",
  },
  stop: { background: "transparent", border: "none", color: "inherit", font: "inherit", cursor: "pointer", opacity: 0.7, padding: "3px 4px" },
  muted: { opacity: 0.65 },
  error: { color: "#dc2626" },
};

function Icon({ phase }: { phase: Phase }) {
  if (phase === "loading") {
    return (
      <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="3" strokeDasharray="42 100" strokeLinecap="round">
          <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.9s" repeatCount="indefinite" />
        </circle>
      </svg>
    );
  }
  if (phase === "playing") {
    return (
      <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
        <rect x="5" y="4" width="5" height="16" rx="1" />
        <rect x="14" y="4" width="5" height="16" rx="1" />
      </svg>
    );
  }
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
      <path d="M7 4.5v15a1 1 0 0 0 1.5.86l12.5-7.5a1 1 0 0 0 0-1.72L8.5 3.64A1 1 0 0 0 7 4.5z" />
    </svg>
  );
}

function ListenButton({ companyId, source, label }: { companyId: string; source: Source; label: string }) {
  const settings = usePluginData<Settings>("tts-settings", { companyId });
  const fetchText = usePluginAction("tts-text");
  const speak = usePluginAction("tts-speak");

  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);
  const runRef = useRef(0); // increments to cancel in-flight work
  const browserModeRef = useRef(false);

  const params = { companyId, ...source };

  const stop = useCallback(() => {
    runRef.current += 1;
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
    if (browserModeRef.current && typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    browserModeRef.current = false;
    setPhase("idle");
  }, []);

  useEffect(() => () => {
    if (stopActive === stop) stopActive = null;
    stop();
  }, [stop]);

  const claimPlayer = () => {
    if (stopActive && stopActive !== stop) stopActive();
    stopActive = stop;
  };

  const truncationNote = (r: { truncated?: boolean; chars?: number; originalChars?: number }) =>
    r.truncated ? `Truncated: reading the first ${r.chars} of ${r.originalChars} characters.` : null;

  async function playInBrowser(run: number, s: Settings) {
    if (typeof window === "undefined" || !window.speechSynthesis || typeof SpeechSynthesisUtterance === "undefined") {
      throw new Error("This browser does not support speech synthesis (Web Speech API).");
    }
    const result = (await fetchText(params)) as TextResult;
    if (run !== runRef.current) return;
    if (!result.text) throw new Error("There is no text to read.");
    setNote(truncationNote(result));

    const lang = s.browser.lang || navigator.language || "en-US";
    const voice = pickVoice(await loadVoices(), lang, s.browser.voice);
    if (run !== runRef.current) return;

    const synth = window.speechSynthesis;
    synth.cancel();
    browserModeRef.current = true;
    // Short utterances: some browsers silently stop long ones after ~15 s.
    const chunks = splitIntoChunks(result.text, 220);
    chunks.forEach((chunk, i) => {
      const u = new SpeechSynthesisUtterance(chunk);
      u.lang = voice?.lang ?? lang;
      if (voice) u.voice = voice;
      u.rate = s.browser.rate || 1;
      if (i === chunks.length - 1) {
        u.onend = () => {
          if (run === runRef.current) {
            browserModeRef.current = false;
            setPhase("idle");
          }
        };
      }
      u.onerror = (ev) => {
        if (run !== runRef.current || ev.error === "interrupted" || ev.error === "canceled") return;
        setError(`Speech synthesis failed: ${ev.error}`);
        stop();
      };
      synth.speak(u);
    });
    setPhase("playing");
  }

  async function playFromServer(run: number) {
    const started = Date.now();
    let result: SpeakResult;
    for (;;) {
      result = (await speak(params)) as SpeakResult;
      if (run !== runRef.current) return;
      if (result.status !== "pending") break;
      if (Date.now() - started > MAX_WAIT_MS) throw new Error("Timed out waiting for the TTS provider.");
      await new Promise((r) => setTimeout(r, POLL_MS));
      if (run !== runRef.current) return;
    }
    if (result.status === "error" || !result.audioBase64) throw new Error(result.message ?? "The TTS provider returned no audio.");

    const url = base64ToBlobUrl(result.audioBase64, result.mime ?? "audio/mpeg");
    urlRef.current = url;
    const audio = new Audio(url);
    audioRef.current = audio;
    audio.onended = () => {
      if (run === runRef.current) setPhase("idle");
    };
    audio.onerror = () => {
      if (run !== runRef.current) return;
      setError("The browser could not play the generated audio.");
      stop();
    };
    const parts = [truncationNote(result), result.source === "cache" ? "From cache." : null].filter(Boolean);
    setNote(parts.length ? parts.join(" ") : null);
    await audio.play();
    if (run === runRef.current) setPhase("playing");
  }

  async function onClick() {
    if (phase === "loading") return;
    if (phase === "playing") {
      if (browserModeRef.current) window.speechSynthesis.pause();
      else audioRef.current?.pause();
      setPhase("paused");
      return;
    }
    if (phase === "paused") {
      claimPlayer();
      if (browserModeRef.current) window.speechSynthesis.resume();
      else await audioRef.current?.play();
      setPhase("playing");
      return;
    }

    claimPlayer();
    const run = ++runRef.current;
    setError(null);
    setNote(null);
    setPhase("loading");
    try {
      const s = settings.data ?? { provider: "browser", maxChars: 0, browser: { lang: "", voice: "", rate: 1 } };
      if (s.provider === "browser") await playInBrowser(run, s);
      else await playFromServer(run);
    } catch (err) {
      if (run !== runRef.current) return;
      setError(errorMessage(err));
      stop();
    }
  }

  const buttonText = phase === "loading" ? "Generating…" : phase === "playing" ? "Pause" : phase === "paused" ? "Resume" : label;

  return (
    <div style={styles.row} data-paperclip-tts="">
      <button
        type="button"
        style={{ ...styles.button, cursor: phase === "loading" ? "progress" : "pointer" }}
        onClick={() => void onClick()}
        aria-label={buttonText}
        title={settings.data ? `Text to speech (${settings.data.provider})` : "Text to speech"}
      >
        <Icon phase={phase} />
        <span>{buttonText}</span>
      </button>
      {phase === "playing" || phase === "paused" || phase === "loading" ? (
        <button type="button" style={styles.stop} onClick={stop} aria-label="Stop">
          Stop
        </button>
      ) : null}
      {note ? <span style={styles.muted}>{note}</span> : null}
      {error ? (
        <span style={styles.error} role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}

interface CommentSummary {
  id: string;
  authorType: string;
  createdAt: string;
  preview: string;
}

function CommentList({ companyId, issueId }: { companyId: string; issueId: string }) {
  const { data, error } = usePluginData<{ comments: CommentSummary[] }>("tts-comments", { companyId, issueId });
  if (error) return <span style={styles.error}>Could not load comments: {error.message}</span>;
  const comments = data?.comments ?? [];
  if (comments.length === 0) return null;
  return (
    <details style={{ marginTop: 8, fontSize: 12 }}>
      <summary style={{ cursor: "pointer", ...styles.muted }}>Listen to a comment ({comments.length})</summary>
      <ul style={{ listStyle: "none", margin: "8px 0 0", padding: 0, display: "grid", gap: 6, maxHeight: 320, overflowY: "auto" }}>
        {comments.map((c) => (
          <li key={c.id} style={{ display: "grid", gap: 2 }}>
            <span style={styles.muted}>
              {new Date(c.createdAt).toLocaleString()} · {c.preview}
            </span>
            <ListenButton companyId={companyId} source={{ kind: "comment", issueId, commentId: c.id }} label="Listen" />
          </li>
        ))}
      </ul>
    </details>
  );
}

/**
 * Slot `taskDetailView` on issues: reads the issue title and description, and
 * offers a per-comment list (some hosts do not mount `commentAnnotation`).
 */
export function IssueListen({ context }: PluginDetailTabProps) {
  if (!context.companyId || !context.entityId) return null;
  return (
    <div>
      <ListenButton companyId={context.companyId} source={{ kind: "issue", issueId: context.entityId }} label="Listen to issue" />
      <CommentList companyId={context.companyId} issueId={context.entityId} />
    </div>
  );
}

/** Slot `commentAnnotation`: reads one comment. */
export function CommentListen({ context }: PluginCommentAnnotationProps) {
  if (!context.companyId || !context.entityId || !context.parentEntityId) return null;
  return (
    <ListenButton
      companyId={context.companyId}
      source={{ kind: "comment", issueId: context.parentEntityId, commentId: context.entityId }}
      label="Listen"
    />
  );
}

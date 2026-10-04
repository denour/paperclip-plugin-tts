/**
 * Turns Paperclip markdown (issue descriptions, comments) into plain text that
 * sounds natural when read aloud.
 *
 * Pure functions only: this module is shared by the worker and the unit tests.
 */

export interface CleanTextOptions {
  /** Spoken replacement for fenced code blocks. */
  codeBlockLabel?: string;
  /** Spoken replacement for markdown tables. */
  tableLabel?: string;
  /** Spoken replacement for a bare URL whose host cannot be parsed. */
  linkLabel?: string;
}

export interface LimitResult {
  text: string;
  truncated: boolean;
  originalChars: number;
}

const DEFAULTS: Required<CleanTextOptions> = {
  codeBlockLabel: "Code block",
  tableLabel: "Table",
  linkLabel: "link",
};

/** Placeholder markers that survive the markdown stripping below. */
const CODE_MARK = "\u0000CODE\u0000";
const TABLE_MARK = "\u0000TABLE\u0000";

function urlToSpeech(raw: string, linkLabel: string): string {
  try {
    const host = new URL(raw).hostname.replace(/^www\./, "");
    return host || linkLabel;
  } catch {
    return linkLabel;
  }
}

function isTableLine(line: string): boolean {
  const t = line.trim();
  // A markdown table row starts with a pipe, or contains at least two pipes
  // (GitHub allows rows without leading/trailing pipes).
  return t.startsWith("|") || (t.match(/\|/g)?.length ?? 0) >= 2;
}

function isTableSeparator(line: string): boolean {
  return /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line);
}

/** Replace every markdown table (header + separator + rows) with a marker. */
function replaceTables(lines: string[]): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    if (isTableLine(lines[i]) && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      i += 2;
      while (i < lines.length && isTableLine(lines[i]) && lines[i].trim() !== "") i += 1;
      out.push(TABLE_MARK);
      continue;
    }
    out.push(lines[i]);
    i += 1;
  }
  return out;
}

/** Ensure a line ends with sentence punctuation so the TTS pauses between lines. */
function terminate(line: string): string {
  return /[.!?;:…。！？]$/.test(line) ? line : `${line}.`;
}

export function cleanText(input: string, options: CleanTextOptions = {}): string {
  const opts = { ...DEFAULTS, ...stripEmpty(options) };
  let text = (input ?? "").replace(/\r\n?/g, "\n");

  // Fenced code blocks (``` or ~~~), including unterminated ones at the end.
  text = text.replace(/(^|\n)[ \t]*(```|~~~)[^\n]*\n[\s\S]*?(\n[ \t]*\2[ \t]*(?=\n|$)|$)/g, `$1${CODE_MARK}`);
  // HTML comments and <details>/<summary>-style tags: keep inner text only.
  text = text.replace(/<!--[\s\S]*?-->/g, " ");
  text = text.replace(/<\/?[a-zA-Z][^>\n]*>/g, " ");

  let lines = replaceTables(text.split("\n"));

  lines = lines.map((line) => {
    let l = line;
    // Indented code blocks (4 spaces / tab) are rare in Paperclip; leave them as text.
    l = l.replace(/^\s{0,3}#{1,6}\s+/, ""); // headings
    l = l.replace(/^\s{0,3}>\s?/, ""); // blockquotes
    l = l.replace(/^\s*([-*+]|\d+[.)])\s+\[[ xX]\]\s+/, ""); // task list items
    l = l.replace(/^\s*([-*+]|\d+[.)])\s+/, ""); // list markers
    if (/^\s*([-*_]\s*){3,}$/.test(l)) return ""; // horizontal rules
    l = l.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1"); // images -> alt text
    l = l.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1"); // links -> link text
    l = l.replace(/\[([^\]]+)\]\[[^\]]*\]/g, "$1"); // reference links
    l = l.replace(/<(https?:\/\/[^>\s]+)>/g, "$1"); // autolinks
    l = l.replace(/\bhttps?:\/\/[^\s)<>\]]+/g, (m) => urlToSpeech(m.replace(/[.,;:!?]+$/, ""), opts.linkLabel));
    l = l.replace(/`([^`]+)`/g, "$1"); // inline code -> content
    l = l.replace(/(\*\*|__)(.+?)\1/g, "$2"); // bold
    l = l.replace(/(^|[^\w*])\*(?!\s)([^*\n]+?)\*(?!\w)/g, "$1$2"); // italic *x*
    l = l.replace(/(^|[^\w])_(?!\s)([^_\n]+?)_(?!\w)/g, "$1$2"); // italic _x_
    l = l.replace(/~~(.+?)~~/g, "$1"); // strikethrough
    l = l.replace(/\\([\\`*_{}[\]()#+\-.!|>~])/g, "$1"); // markdown escapes
    l = l.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
    return l.replace(/[ \t]+/g, " ").trim();
  });

  const sentences = lines
    .filter((l) => l.length > 0)
    .map((l) => {
      if (l === CODE_MARK) return `${opts.codeBlockLabel}.`;
      if (l === TABLE_MARK) return `${opts.tableLabel}.`;
      return terminate(l.split(CODE_MARK).join(` ${opts.codeBlockLabel}. `).replace(/\s+/g, " ").trim());
    });

  return sentences.join(" ").replace(/\s+/g, " ").trim();
}

/**
 * Cap text at `maxChars`, cutting at the last sentence end (or word boundary)
 * before the limit so the audio never stops mid-word.
 */
export function limitText(text: string, maxChars: number): LimitResult {
  const originalChars = text.length;
  if (!Number.isFinite(maxChars) || maxChars <= 0 || text.length <= maxChars) {
    return { text, truncated: false, originalChars };
  }
  const slice = text.slice(0, maxChars);
  const sentenceEnd = Math.max(slice.lastIndexOf(". "), slice.lastIndexOf("! "), slice.lastIndexOf("? "));
  let cut: string;
  if (sentenceEnd >= maxChars * 0.5) {
    cut = slice.slice(0, sentenceEnd + 1);
  } else {
    const space = slice.lastIndexOf(" ");
    cut = space > 0 ? slice.slice(0, space) : slice;
  }
  return { text: cut.trim(), truncated: true, originalChars };
}

/**
 * Split text into chunks of at most `maxChars`, preferring sentence boundaries.
 * Providers have per-request input limits (OpenAI: 4096 chars), and smaller
 * requests keep slow self-hosted engines inside their HTTP timeouts.
 */
export function splitIntoChunks(text: string, maxChars: number): string[] {
  const limit = Math.max(50, Math.floor(maxChars));
  const sentences = text.match(/[^.!?…。！？]+[.!?…。！？]*\s*/g) ?? [text];
  const chunks: string[] = [];
  let current = "";
  const flush = () => {
    if (current.trim()) chunks.push(current.trim());
    current = "";
  };
  for (const sentence of sentences) {
    if (sentence.length > limit) {
      flush();
      // Very long "sentence": fall back to word boundaries.
      let rest = sentence.trim();
      while (rest.length > limit) {
        const space = rest.lastIndexOf(" ", limit);
        const at = space > limit * 0.3 ? space : limit;
        chunks.push(rest.slice(0, at).trim());
        rest = rest.slice(at).trim();
      }
      current = rest ? `${rest} ` : "";
      continue;
    }
    if ((current + sentence).length > limit) flush();
    current += sentence;
  }
  flush();
  return chunks;
}

function stripEmpty(o: CleanTextOptions): CleanTextOptions {
  const out: CleanTextOptions = {};
  for (const [k, v] of Object.entries(o)) {
    if (typeof v === "string" && v.trim() !== "") (out as Record<string, string>)[k] = v;
  }
  return out;
}

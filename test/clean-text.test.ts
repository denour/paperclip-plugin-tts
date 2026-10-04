import assert from "node:assert/strict";
import { test } from "node:test";
import { cleanText, limitText, splitIntoChunks } from "../src/lib/clean-text.ts";

test("strips headings, emphasis, lists and inline code", () => {
  const md = "# Release plan\n\n- **Ship** the _new_ `parser`\n- Update ~~old~~ docs";
  assert.equal(cleanText(md), "Release plan. Ship the new parser. Update old docs.");
});

test("replaces fenced code blocks with a spoken label", () => {
  const md = "Run this:\n\n```bash\nnpm install\nnpm test\n```\n\nThen deploy.";
  assert.equal(cleanText(md), "Run this: Code block. Then deploy.");
  assert.equal(cleanText(md, { codeBlockLabel: "Bloque de código" }), "Run this: Bloque de código. Then deploy.");
});

test("handles an unterminated code fence", () => {
  assert.equal(cleanText("Before\n```\nconst x = 1;"), "Before. Code block.");
});

test("replaces markdown tables with a spoken label", () => {
  const md = "Results:\n\n| Name | Value |\n| --- | ---: |\n| a | 1 |\n| b | 2 |\n\nDone.";
  assert.equal(cleanText(md), "Results: Table. Done.");
});

test("keeps link text and reads bare URLs as their host", () => {
  const md =
    "See [the docs](https://example.com/very/long/path?with=query) or https://www.github.com/org/repo/pull/123/files#diff-abcdef.";
  assert.equal(cleanText(md), "See the docs or github.com.");
});

test("drops images' URLs but keeps alt text, and strips HTML", () => {
  assert.equal(cleanText("![diagram of the flow](https://x.io/a.png) <b>bold</b>"), "diagram of the flow bold.");
});

test("limitText cuts at a sentence boundary and reports truncation", () => {
  const text = "First sentence here. Second sentence here. Third sentence is long.";
  const r = limitText(text, 45);
  assert.deepEqual(r, { text: "First sentence here. Second sentence here.", truncated: true, originalChars: text.length });
  assert.equal(limitText(text, 1000).truncated, false);
});

test("splitIntoChunks respects the limit and keeps all words", () => {
  const text = "One two three. ".repeat(40).trim();
  const chunks = splitIntoChunks(text, 100);
  assert.ok(chunks.every((c) => c.length <= 100));
  assert.equal(chunks.join(" ").split(/\s+/).length, text.split(/\s+/).length);
});

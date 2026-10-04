# paperclip-plugin-tts

A [Paperclip](https://github.com/paperclipai/paperclip) plugin that adds a **play button** to issues and comments, so you can listen to them instead of reading them.

![Idle: "Listen to issue" button and the per-comment list](docs/screenshot-idle.png)

![Playing: pause, stop, and a note that the audio came from the cache](docs/screenshot-playing.png)

It works out of the box with your browser's built-in voices. If you want better voices, point it at **any OpenAI-compatible TTS server** (OpenAI itself, Kokoro-FastAPI, openedai-speech, and others) or at **ElevenLabs**.

## Contents

- [Features](#features)
- [Requirements](#requirements)
- [Installation](#installation)
- [Configuration](#configuration)
- [All settings](#all-settings)
- [How it works](#how-it-works)
- [Security and privacy](#security-and-privacy)
- [Troubleshooting](#troubleshooting)
- [Development](#development)
- [License](#license)

## Features

- A **Listen to issue** button on every issue page. It reads the title and the description.
- **Listen to a comment**: an expandable list under that button with a play button for each comment, newest first.
- Play, pause, resume and stop, plus a "Generating…" state while the server makes the audio.
- Three providers that you pick in the plugin settings:
  - `browser` (the default): the Web Speech API in your browser. It needs no keys and no server, and works as soon as the plugin is installed.
  - `openai-compatible`: any server that implements `POST /v1/audio/speech`.
  - `elevenlabs`: the ElevenLabs text-to-speech API.
- **Text cleanup** before speaking. Markdown is stripped, code blocks are replaced with a short spoken label, links are read as their text, bare URLs as their host name, and tables are replaced with a label.
- A **length limit**. Long text is cut at a sentence boundary, and the player tells you it did that.
- An **audio cache** keyed by the hash of (text, provider, endpoint, model, voice), so the same audio is never paid for twice.
- Server providers run in the plugin worker. API keys are stored as Paperclip secrets and never reach the browser.

## Requirements

| What | Version |
|---|---|
| Paperclip | Tested on **2026.1001.0** (plugin API v1). |
| Node.js | **22.18 or newer** to build and run the tests (Node 24 recommended; Paperclip itself runs on Node 24). |
| npm | 10 or newer. |

The plugin uses these Paperclip plugin capabilities: `issues.read`, `issue.comments.read`, `http.outbound`, `secrets.read-ref`, `ui.detailTab.register` and `ui.commentAnnotation.register`.

## Installation

### From the repository (local path)

Run these commands **on the machine where the Paperclip server runs**, as the user that runs Paperclip. The server loads the plugin from this directory, so keep it in place after installing.

```bash
git clone https://github.com/denour/paperclip-plugin-tts.git
cd paperclip-plugin-tts
npm install
npm test          # optional: unit tests
npm run build     # writes dist/manifest.js, dist/worker.js and dist/ui/index.js
```

Then install it with **one** of the following.

**Paperclip CLI** (use the same account that is logged in to the instance):

```bash
npx paperclipai plugin install --local "$(pwd)"
# If your server is not on http://localhost:3100:
npx paperclipai plugin install --local "$(pwd)" --api-base http://your-server:3100

npx paperclipai plugin list   # should show: key=paperclip-plugin-tts  status=ready
```

**HTTP API** (needs an instance-admin board token):

```bash
curl -X POST http://localhost:3100/api/plugins/install \
  -H "Authorization: Bearer $PAPERCLIP_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"packageName\": \"$(pwd)\", \"isLocalPath\": true}"
```

Open any issue. A **Listen to issue** button appears under the title.

### From npm

> **Coming soon.** The package is not published to npm yet. Once it is, install it with `npx paperclipai plugin install paperclip-plugin-tts`.

### Updating

```bash
git pull && npm install && npm run build
curl -X POST http://localhost:3100/api/plugins/paperclip-plugin-tts/upgrade \
  -H "Authorization: Bearer $PAPERCLIP_TOKEN" -H "Content-Type: application/json" -d '{}'
```

The `upgrade` call reloads the worker and the UI bundle from disk.

### Uninstalling

```bash
npx paperclipai plugin uninstall paperclip-plugin-tts
```

## Configuration

Settings are per company. In Paperclip, open **Company settings → Instance → Plugins → Text to Speech** (URL: `/<company-prefix>/company/settings/instance/plugins`), edit the form and click **Save Configuration**, or `POST /api/plugins/paperclip-plugin-tts/config` with `{ "companyId": "...", "configJson": { ... } }`.

API keys are **Paperclip secrets**. In the settings form, the key fields have a secret picker where you can create and bind a secret. Over the API, store the secret first (`POST /api/companies/:companyId/secrets` with `{ "name", "value" }`), then reference it as `{ "type": "secret_ref", "secretId": "<id>" }`.

### `browser` (no configuration)

This is the default. The text is spoken by your browser's built-in speech engine. By default the language is your browser's language. You can set a fixed language and, optionally, a voice:

```json
{
  "provider": "browser",
  "browserLang": "es-MX",
  "browserVoice": "Google",
  "codeBlockLabel": "Bloque de código",
  "tableLabel": "Tabla"
}
```

The voices you get depend on the operating system and browser. Chrome, Edge and Safari include good voices. Firefox on Linux needs `speech-dispatcher`.

### `openai-compatible`

The plugin calls `POST {openaiBaseUrl}/audio/speech` (it adds `/v1` when the base URL does not end with a version) with:

```json
{ "model": "<openaiModel>", "input": "<text>", "voice": "<openaiVoice>", "response_format": "mp3" }
```

The request comes from the **Paperclip server**, not from the browser, so the URL must be reachable from the server.

**OpenAI:**

1. Create an API key at <https://platform.openai.com/api-keys>.
2. Set these values:

```json
{
  "provider": "openai-compatible",
  "openaiBaseUrl": "https://api.openai.com/v1",
  "openaiApiKey": { "type": "secret_ref", "secretId": "<your OPENAI secret id>" },
  "openaiModel": "gpt-4o-mini-tts",
  "openaiVoice": "coral"
}
```

**Self-hosted Kokoro-FastAPI** (free, runs on a CPU or GPU, many languages):

```bash
docker run -d --name kokoro -p 8880:8880 ghcr.io/remsky/kokoro-fastapi-cpu:latest
# with an NVIDIA GPU: ghcr.io/remsky/kokoro-fastapi-gpu:latest  (add --gpus all)
```

```json
{
  "provider": "openai-compatible",
  "openaiBaseUrl": "http://localhost:8880/v1",
  "openaiModel": "kokoro",
  "openaiVoice": "af_heart"
}
```

`localhost` here means the Paperclip server. If Kokoro runs on another machine, use that machine's address. Kokoro's Spanish voices are `ef_dora`, `em_alex` and `em_santa`. Self-hosted servers usually need no API key. Leave the field empty.

The same settings work for other compatible servers, such as openedai-speech, LocalAI and Chatterbox TTS servers that expose `/v1/audio/speech`. Use whatever model and voice names that server expects (for example, some Chatterbox servers expect the voice file name, `MyVoice.wav`).

### `elevenlabs`

1. **API key:** ElevenLabs dashboard → **Developers → API keys** → *Create API key*. The key only needs the *Text to Speech* permission.
2. **Voice ID:** ElevenLabs → **Voices** → open a voice → **⋯ → Copy voice ID**. The default, `EXAVITQu4vr4xnSDxMaL`, is the premade voice "Sarah", which every account has.
3. Set these values:

```json
{
  "provider": "elevenlabs",
  "elevenlabsApiKey": { "type": "secret_ref", "secretId": "<your ELEVENLABS secret id>" },
  "elevenlabsVoiceId": "EXAVITQu4vr4xnSDxMaL",
  "elevenlabsModel": "eleven_flash_v2_5"
}
```

`eleven_flash_v2_5` is fast, speaks 32 languages, and costs about half the credits per character of `eleven_multilingual_v2`, which sounds better. ElevenLabs bills by character. Keep `maxChars` modest, and let the cache do its job.

## All settings

| Setting | Default | Description |
|---|---|---|
| `provider` | `browser` | `browser`, `openai-compatible` or `elevenlabs`. |
| `maxChars` | `4000` | Maximum characters read per item. Longer text is cut at a sentence boundary and the UI says so. |
| `codeBlockLabel` | `Code block` | Spoken in place of each fenced code block. Translate it to your content's language. |
| `tableLabel` | `Table` | Spoken in place of each markdown table. |
| `browserLang` | *(browser language)* | BCP 47 tag for the `browser` provider, such as `en-US` or `es-MX`. |
| `browserVoice` | *(automatic)* | Case-insensitive part of a browser voice name. When it is empty, the first voice that matches the language is used. |
| `browserRate` | `1` | Speech rate for the `browser` provider (0.5–2). |
| `openaiBaseUrl` | `https://api.openai.com/v1` | Base URL of the OpenAI-compatible server. |
| `openaiApiKey` | *(none)* | Paperclip secret holding the API key. Optional for self-hosted servers. |
| `openaiModel` | `gpt-4o-mini-tts` | Model name sent as `model`. |
| `openaiVoice` | `alloy` | Voice name sent as `voice`. |
| `openaiSpeed` | `1` | Sent as `speed` when it is not 1 (0.25–4). |
| `elevenlabsApiKey` | *(none)* | Paperclip secret holding the ElevenLabs API key. |
| `elevenlabsVoiceId` | `EXAVITQu4vr4xnSDxMaL` | ElevenLabs voice ID. |
| `elevenlabsModel` | `eleven_flash_v2_5` | ElevenLabs model ID. |
| `chunkChars` | `1000` | Server providers get long text in chunks of at most this many characters. |
| `requestTimeoutSec` | `180` | Timeout for each chunk request. Raise it for slow self-hosted engines. |
| `cacheDir` | `~/.paperclip/plugin-cache/paperclip-plugin-tts` | Absolute path of the audio cache, in the home directory of the user that runs Paperclip. |
| `cacheMaxMb` | `200` | Size limit of the cache. The least recently used files are deleted past it. `0` disables the cache. |

## How it works

```
Browser (plugin UI)                     Paperclip server (plugin worker)            TTS provider
───────────────────                     ───────────────────────────────            ────────────
click ▶ ── action "tts-text" ─────────▶ load issue/comment, clean, limit
   │  ◀────────────── cleaned text ────┘
   └─ provider = browser: speechSynthesis speaks it locally (nothing else is called)

click ▶ ── action "tts-speak" ────────▶ load + clean + limit → cache key
   │                                     ├─ cache hit  → return MP3
   │                                     └─ miss → background job ─── chunks ───▶ /v1/audio/speech
   │  ◀── "pending" (poll every 1.5 s) ──┘                                         or ElevenLabs
   │  ◀── "ready" + MP3 (base64) ─────── write to the cache ◀────── MP3 ──────────┘
   └─ plays it with an <audio> element (pause, resume, stop)
```

- **Text source:** the worker reads the issue or comment itself through the Paperclip SDK. The browser only sends IDs, never the text.
- **Cleanup:** fenced code blocks become `codeBlockLabel`. Tables become `tableLabel`. Links are read as their text, images as their alt text, and bare URLs as their host name (`github.com`). Headings, emphasis, list markers, blockquotes and HTML tags are removed. Each line ends with punctuation so the voice pauses between lines.
- **Length limit:** text past `maxChars` is cut at the last sentence end (or word) before the limit. The player shows "Truncated: reading the first N of M characters."
- **Long text:** server providers receive the text in chunks of up to `chunkChars` characters, split at sentence boundaries, and the MP3 pieces are joined. Generation runs as a background job and the UI polls for it, so slow engines never hit Paperclip's 30-second limit per call. At most two generations run at once.
- **Cache:** the key is `sha256(version, provider, endpoint, model, voice, format, final text)`. Files are stored as `<key>.mp3` (mode `0600`) in `cacheDir` on the Paperclip server. The player shows "From cache." when it gets a hit. If the text, voice, model or endpoint changes, the key changes too, so stale audio is never played.
- **Comments:** Paperclip's SDK defines a `commentAnnotation` slot for content under each comment, and this plugin registers it. Paperclip 2026.1001.0 does not render that slot yet, so the issue panel also lists the comments with their own play buttons.

## Security and privacy

- **API keys never reach the browser.** They are stored as Paperclip secrets and resolved by the worker only when it needs them (`ctx.secrets.resolve`). They are never cached, logged or returned to the UI. The UI only receives non-secret settings: provider name, length limit and browser voice options.
- **`browser` provider:** the text never leaves the user's machine, apart from the normal Paperclip API call that returns the cleaned text. Some browsers and operating systems use cloud voices for certain languages (for example, Chrome's "Google" voices). Check your browser if this matters to you.
- **`openai-compatible` and `elevenlabs`:** the cleaned text of the issue or comment is **sent to that provider**, and the provider's data policies apply. Use a self-hosted server if the content must stay on your network.
- The audio cache holds spoken versions of your issues and comments on the Paperclip server's disk. Delete `cacheDir`, or set `cacheMaxMb` to `0`, if that is a concern.
- Plugin UI code runs as same-origin JavaScript inside Paperclip, like every Paperclip plugin, so install it only from a source you trust.

## Troubleshooting

**The button does not appear.**
- Check the plugin status with `npx paperclipai plugin list`. It must be `ready`. If it is `error`, run `npx paperclipai plugin logs <plugin id>`.
- Make sure `npm run build` ran. `dist/ui/index.js` must exist.
- Reload the page after installing or upgrading. The issue button appears under the issue title.
- Per-comment buttons are under **Listen to a comment (N)** in the issue panel, not next to each comment (see [How it works](#how-it-works)).

**"OpenAI-compatible TTS responded 401" / "ElevenLabs responded 401".** The key is missing, wrong or revoked. Bind the secret again in the settings, and check that the ElevenLabs key has the *Text to Speech* permission.

**"… responded 429".** You hit a rate limit, or you are out of credits or quota at the provider. With ElevenLabs, check *Subscription → usage*.

**"Cannot reach … Is it reachable from the Paperclip server?"** The request is made by the Paperclip **server**. `curl` the base URL from that machine. Check firewalls, Docker port mappings, and that the URL is not `localhost` when the TTS server runs elsewhere. CORS does not matter, because the browser never calls the TTS server.

**"… did not answer within 180s."** The self-hosted engine is slow for the chunk size. Raise `requestTimeoutSec` or lower `chunkChars`.

**"Voice … not found" or a 404/422 from a self-hosted server.** The model or voice name is not one that the server knows. Most servers list their voices (for example, `GET /v1/audio/voices` on Kokoro-FastAPI).

**No sound with the `browser` provider.**
- "Speech synthesis failed: synthesis-failed" means the browser has no voice for the language. Install a voice in the operating system, or set `browserLang` and `browserVoice` to one that exists. Run `speechSynthesis.getVoices()` in the browser console to see the list.
- On Linux, Chromium and Firefox need `speech-dispatcher` with a voice engine installed.
- Headless and automated browsers usually have no voices at all.

**No sound with a server provider.** Check that the tab is not muted and that the response was not an error. Errors show in red next to the button, and the rest of the page keeps working.

## Development

```bash
npm install
npm test            # unit tests for text cleanup and the cache key (node:test, no extra deps)
npm run typecheck   # tsc --noEmit
npm run build       # esbuild via the official @paperclipai/plugin-sdk bundler presets
```

Layout:

```
src/manifest.ts        plugin manifest (slots, capabilities, settings schema)
src/worker.ts          worker: data/actions, background jobs, cache, providers
src/lib/clean-text.ts  markdown → speakable text, length limit, chunking (pure)
src/lib/cache-key.ts   cache key (pure)
src/lib/config.ts      settings schema and defaults
src/lib/providers.ts   OpenAI-compatible and ElevenLabs clients
src/lib/audio-cache.ts on-disk LRU cache
src/ui/index.tsx       React UI for the slots (host provides React and the SDK)
test/                  node:test unit tests
```

To try changes on a running instance, rebuild and call the `upgrade` endpoint shown in [Updating](#updating).

Contributions are welcome. Open an issue first for larger changes. Keep the pure modules covered by tests, write all user-facing text in English, and never commit keys, tokens or instance-specific addresses.

## License

[MIT](LICENSE)

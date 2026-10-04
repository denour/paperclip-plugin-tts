# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-10-03

### Added

- Play, pause, resume and stop controls on issues (`taskDetailView` slot), with a per-comment list in the same panel.
- `commentAnnotation` slot for per-comment buttons on hosts that render it.
- Providers: `browser` (Web Speech API, default), `openai-compatible` (`POST /v1/audio/speech`), and `elevenlabs`.
- Markdown cleanup before synthesis: code blocks and tables become spoken labels, links become their text, bare URLs become their host name.
- Configurable length limit with a truncation notice.
- On-disk LRU audio cache keyed by a sha256 of text, provider, endpoint, model and voice.
- Background generation with UI polling, so slow engines do not hit the host's RPC timeout.
- Unit tests for text cleanup and the cache key.

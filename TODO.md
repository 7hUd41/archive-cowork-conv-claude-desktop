# TODO — Cowork Local Viewer

<!-- authors: 7hud41 -->

## Features
- [ ] Confirm the exact field that links a `local_….json` to its project on every platform (`userSelectedFolders` today) and drop the path-sniffing fallback when it is not needed.
- [ ] Standalone scanner: a small script that builds the session index from a dropped parent folder without loading any conversation, shareable as a single file.
- [ ] Per-project export: select a project, drop its folders, get one ZIP per session plus the project index.
- [ ] Streaming parser for very large `audit.jsonl` files (hundreds of MB) instead of reading them whole.
- [ ] Windows / Linux locations of `local-agent-mode-sessions` documented and tested.
- [ ] Optional dark theme for the preview.

## Quality practices to build up

Engineering habits this project wants to grow, in rough priority order. Each item is a concrete, checkable step.

### Testing
- [ ] Keep the end-to-end Playwright suite green on every change (`npm test`); add a case for each bug fixed.
- [ ] Unit-test the pure functions of the engine (`cleanUserText`, `stripBinary`, `compactionSummary`, `listDays`, `dayKey`, `extractImages`, `extractWrittenFiles`) with Node's built-in test runner, no browser needed.
- [ ] Generate every fixture from code (`tests/fixtures/make-fixtures.js`): no real conversation, no real image, nothing personal in the repository.
- [ ] Snapshot-test the exports (`transcript.md`, the by-day `.md`, `manifest.json`) so a formatting change is a deliberate diff.

### Code quality
- [ ] ESLint + Prettier with a shared config, run in CI; fail the build on warnings.
- [ ] Split `archive.js` (fetching, extraction, rendering, exports) into modules with explicit imports; keep the single-file build as an output, not a source.
- [ ] Publish the shared engine (`archive.js`, `viewer.*`, `i18n.js`) from one place and vendor it by version in the other projects instead of copying files by hand.
- [ ] Type the event model (JSDoc or TypeScript declarations): `event_type`, `payload`, tool blocks, `file_attachments`, `compact_metadata`.
- [ ] Replace ad-hoc `(s)` plurals with proper plural rules in `i18n.js`; load dictionaries lazily.

### Releases
- [ ] Semantic versioning with a single source of truth (`manifest.json` → `VERSION` in the engine) checked by a script.
- [ ] Keep `CHANGELOG.md` up to date (Keep a Changelog format) and tag releases.
- [ ] GitHub Actions: lint, test, build, and attach the packaged artifact (extension ZIP / built `index.html`) to each release.
- [ ] Reproducible builds: pin the Playwright and tooling versions; make `build.py` deterministic (no timestamps in the output).

### Security and privacy
- [ ] Document the threat model: the tools run entirely client-side, no network except claude.ai for the extension; state it in a short `SECURITY.md`.
- [ ] Add a strict Content Security Policy to the extension pages and to the generated `index.html` (no inline event handlers, no `eval`).
- [ ] Audit `renderMarkdown`/`renderInline` against untrusted content (everything comes from logs): keep `textContent` only, fuzz with odd inputs.
- [ ] Review the manifest permissions at every release; keep them minimal (`activeTab`, `tabs`, `claude.ai` host only).

### Accessibility and UX
- [ ] Keyboard navigation and visible focus on every control; `aria-live` on the status line and the log.
- [ ] Check colour contrast of the bubbles, chips and status boxes (WCAG AA) in both modes.
- [ ] Respect `prefers-reduced-motion` and `prefers-color-scheme` (a dark theme for the preview).
- [ ] Large-archive performance: virtualise the conversation list and stream `events.json` instead of `JSON.parse` on the whole file.

### Documentation and community
- [ ] `CONTRIBUTING.md`: how to run, test, build, translate; commit message conventions.
- [ ] Issue and pull-request templates; a short roadmap in the README.
- [ ] Screenshots or a short GIF of the preview in the README.
- [ ] Document the event schema observed on the endpoint, with examples, in `docs/`.

### Portability
- [ ] Firefox support for the extension (Manifest V3 differences, `browser.*` namespace).
- [ ] Windows and Linux paths in the desktop viewer's documentation and project matching (`userSelectedFolders` on each platform).
- [ ] Safari drag-and-drop of folders (WebKit directory entries) verified.

# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased] — 2026-10-07
### Added
- English interface with a French translation, language selector; exports follow the selected language.
- `build.py --mode archive` builds the archive-only reader (shipped by the export-viewer project).
- README, TODO (quality roadmap), CHANGELOG, MIT license, end-to-end tests with synthetic fixtures.
### Changed
- Repository layout: `src/loader.js`, `engine/` (vendored from the extension), `build.py`, `server.js`, generated `index.html`.
- Dropped files are captured synchronously so plain file drops (ZIPs on a `file://` page) work too.
- `UNREADABLE-FILES.txt`, `session-local.json` and the CSV/Markdown index columns are in English.

## [0.9.2] — 2026-09-21
### Added
- Drag-and-drop of `local_…` session folders and their `local_….json`, served from localhost (`server.js`) because Chrome does not read folders dropped on `file://` pages; one unified drop zone, drops add up.
- `audit.jsonl` adapter to the engine's event model; uploaded images re-attached from `uploads/`; title inferred from the first message when the metadata file is missing.
- Projects from `spaces.json` (folder match, with a path-sniffing fallback marked *inferred*), project filter, project chip in the list and the header.
- Session index export (`.csv` + `.md`) from the `local_….json` files alone; sessions without their conversation listed as such.
- Per-session display time zone (default `America/Toronto`), remembered in the browser, written into the exports.
- Attachments pre-read at open time; unreadable files listed in a text file instead of failing the ZIP.
- Reopening of exported archives (ZIP or unzipped folder), with project and time zone restored; `session-local.json` added to every ZIP.

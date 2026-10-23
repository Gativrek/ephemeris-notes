# Ephemeris

> Internally `ephemeris-notes` (repository, packages, app id and data folders). People only ever see **Ephemeris**.

A personal desktop note app for technical work: Markdown notes, LaTeX math, wikilinks and PDFs, organized into **Vaults** under three **Domains** (Academic, Work, Personal). Vaults are picked from an ornamental, collection-screen-style chooser and edited in a calm workspace.

Notes are plain Markdown files. The library folder can be opened in Obsidian at any time with nothing lost.

**Status:** in development. See [`PROGRESS.md`](PROGRESS.md) for each milestone.

---

## Documents

| File | Purpose | Read when |
|---|---|---|
| [`GOALS.md`](GOALS.md) | Problem, vision, principles, goals and non-goals, roadmap, priority plugins, parked ideas, decisions log | First. The *why*. |
| [`SPECS.md`](SPECS.md) | Source of truth for behavior: architecture, storage, editor, UI, index, plugin API, plugin specs, testing | Before writing or changing any code. |
| [`KICKOFF.md`](KICKOFF.md) | Instructions for the coding agent: working agreement, milestones with acceptance criteria, guardrails | At the start of every implementation session. |
| `design/` | The exported **Ephemeris Design System**: `README.md` (brand book and rules), `tokens.json` (source of truth for tokens), `components/` (guidelines and previews) | Before building any UI. |

If code and spec disagree, the spec wins, or the spec is updated first in the same change.

## Concepts in 30 seconds

- **Library**: one folder on disk holding everything.
- **Domain**: Academic, Work or Personal. Fixed top-level folders.
- **Vault**: a folder inside a Domain, with a name and a cover image. One per company, research project or study area.
- **Section**: a top-level folder inside a Vault, shown as a tile in the sidebar.
- **Desk**: the strip above the editor holding open and pinned items. Replaces tabs.
- **Inbox**: a library-level folder that external tools (phone capture) may only add new files to.

Links, search and backlinks work across the whole library. Domains and Vaults are for focus, not walls.

## Stack

Electron, TypeScript, React, CodeMirror 6 (`@lezer/markdown`), KaTeX, pdf.js, SQLite with FTS5 (Electron's built-in `node:sqlite` for now, GOALS decision 34), chokidar. pnpm workspaces. Vitest and Playwright (Electron).

## Repository layout

```
apps/desktop/            Electron app
  src/main/              main process: library I/O, watcher, index, IPC
  src/preload/           the narrow bridge exposed to the renderer
  src/renderer/          React UI, editor, plugin host
packages/markdown/       shared Lezer Markdown extensions (editor and index)
packages/plugin-api/     public plugin types (@ephemeris-notes/plugin-api)
packages/sample-plugin/  minimal plugin used as the API contract test
design/                  exported Ephemeris Design System
scripts/                 build-tokens and other tooling
GOALS.md  SPECS.md  KICKOFF.md  README.md
```

## Development

The repository folder can have any name. After renaming or moving it, run `pnpm install` once: on Windows pnpm links `node_modules` with absolute paths, and the install re-links them (no download). `pnpm --filter @ephemeris-notes/desktop icons` re-renders the app icon from `design/assets/Logos`.

```
pnpm install
node apps/desktop/node_modules/electron/install.js   # once, if Electron did not download
pnpm dev          # run the desktop app with hot reload
pnpm test         # unit tests (Vitest)
pnpm test:e2e     # end-to-end tests (Playwright, Electron)
pnpm tokens       # regenerate CSS variables from design/tokens.json
```

**Windows app:** `pnpm dist` builds `apps/desktop/release/Ephemeris-Setup-0.1.0.exe` (a per-user installer: no administrator prompt, install folder of your choice, Start menu and desktop shortcuts) and `Ephemeris-0.1.0-portable.exe` (runs without installing). They are not code-signed, so Windows SmartScreen asks once (More info, then Run anyway). `VX_PACKAGED=1 pnpm test:e2e` smoke-tests the packaged app.

The performance budgets (SPECS 16) are measured on a generated 5,000-note library by an opt-in test: set `VX_PERF=1` and run `pnpm test:e2e`. It takes a few minutes and writes `apps/desktop/test-results/perf.json`.

The sample plugin (`packages/sample-plugin`) builds with `node packages/sample-plugin/build.mjs` into `dist/`, a folder you can install from Settings > Plugins > Install from Folder….

## Plugins

The core ships no feature plugins. Priority plugins live in their own repositories, built against `@ephemeris-notes/plugin-api`:

- **Diagrams**: Mermaid plus a drag-and-drop canvas for circle, square and diamond flowcharts.
- **Text-to-image**: fighting-game notation (and other token languages) rendered as images through data-only profiles.
- **Control plots**: Bode, step response and pole-zero maps from transfer functions.
- **Data plot**: plots from CSV files in the vault.
- **Citations** (API v2): `[@key]` with BibTeX and CSL styles.
- **Flashcards** (API v2): spaced repetition with FSRS.

See `SPECS.md` section 12 for the plugin API and section 13 for each plugin.

## License

MIT. See [`LICENSE`](LICENSE).

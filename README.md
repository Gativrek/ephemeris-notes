# vaults

> Working codename. The product name is not chosen yet; the UI shows `{AppName}`.

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
| `design/` | The exported **Vaults Design System**: `README.md` (brand book and rules), `tokens.json` (source of truth for tokens), `components/` (guidelines and previews) | Before building any UI. |

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

Electron, TypeScript, React, CodeMirror 6 (`@lezer/markdown`), KaTeX, pdf.js, SQLite (better-sqlite3 with FTS5), chokidar. pnpm workspaces. Vitest and Playwright (Electron).

## Repository layout (planned)

```
apps/desktop/            Electron app
  src/main/              main process: library I/O, watcher, index, IPC
  src/preload/           the narrow bridge exposed to the renderer
  src/renderer/          React UI, editor, plugin host
packages/markdown/       shared Lezer Markdown extensions (editor and index)
packages/plugin-api/     public plugin types (@vaults/plugin-api)
packages/sample-plugin/  minimal plugin used as the API contract test
design/                  exported Vaults Design System
scripts/                 build-tokens and other tooling
GOALS.md  SPECS.md  KICKOFF.md  README.md
```

## Development

```
pnpm install
node apps/desktop/node_modules/electron/install.js   # once, if Electron did not download
pnpm dev          # run the desktop app with hot reload
pnpm test         # unit tests (Vitest)
pnpm test:e2e     # end-to-end tests (Playwright, Electron)
pnpm tokens       # regenerate CSS variables from design/tokens.json
```

## Plugins

The core ships no feature plugins. Priority plugins live in their own repositories, built against `@vaults/plugin-api`:

- **Diagrams**: Mermaid plus a drag-and-drop canvas for circle, square and diamond flowcharts.
- **Text-to-image**: fighting-game notation (and other token languages) rendered as images through data-only profiles.
- **Control plots**: Bode, step response and pole-zero maps from transfer functions.
- **Data plot**: plots from CSV files in the vault.
- **Citations** (API v2): `[@key]` with BibTeX and CSL styles.
- **Flashcards** (API v2): spaced repetition with FSRS.

See `SPECS.md` section 12 for the plugin API and section 13 for each plugin.

## License

MIT. See [`LICENSE`](LICENSE).

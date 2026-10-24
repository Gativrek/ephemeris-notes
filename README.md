# Ephemeris

A desktop note app for a library of plain Markdown notes: LaTeX math, wikilinks and PDFs, organized into **Vaults** under three **Domains** (Academic, Work, Personal). Vaults are picked from an ornamental, collection-screen-style chooser and edited in a calm workspace.

Notes stay plain Markdown files in a folder you choose. The same folder opens in Obsidian at any time with nothing lost.

**Status:** in development (0.1.0). Windows builds are tested; macOS and Linux run in CI.

## Features

- **Live-preview editor** (CodeMirror 6): Markdown with a source mode always one key away, KaTeX math with numbered display equations and `@eq:` references, code blocks with syntax highlighting, tables, tasks, properties and embeds.
- **Links across the whole library**: `[[wikilinks]]` with suggestions, backlinks, and link updates when a note is renamed or moved.
- **Search** over the current Vault, its Domain or everything, with phrases, exclusions, tags, paths and file types.
- **PDFs** open beside your notes, with links to a page.
- **Desk** instead of tabs: open and pinned notes as cards above the editor.
- **Outline panel** in four styles, with backlinks.
- **Inbox**: a folder other tools (a phone, a script) can drop new notes into.
- **Plugins** add block renderers, inline decorations, index extractors, outline entries, views, commands, settings and help pages.
- Light and dark themes, keyboard shortcuts you can set, optional git auto-commit. No account, no server, and no network use at runtime.

## Concepts in 30 seconds

- **Library**: one folder on disk holding everything.
- **Domain**: Academic, Work or Personal. Fixed top-level folders.
- **Vault**: a folder inside a Domain, with a name, a cover and a banner. One per company, project or area of study.
- **Section**: a top-level folder inside a Vault, shown as a tile in the sidebar.
- **Desk**: the strip above the editor holding open and pinned items.
- **Inbox**: a library-level folder that outside tools may only add new files to.

Links, search and backlinks work across the whole library. Domains and Vaults are for focus, not walls.

## Stack

Electron, TypeScript, React, CodeMirror 6 (`@lezer/markdown`), KaTeX, pdf.js, SQLite with FTS5 (Electron's built-in `node:sqlite`), chokidar. pnpm workspaces. Vitest and Playwright (Electron).

## Repository layout

```
apps/desktop/            Electron app
  src/main/              main process: library I/O, watcher, index, IPC
  src/preload/           the narrow bridge exposed to the renderer
  src/renderer/          React UI, editor, plugin host
packages/markdown/       shared Lezer Markdown extensions (editor and index)
packages/plugin-api/     public plugin types (@ephemeris-notes/plugin-api)
packages/sample-plugin/  minimal plugin used as the API contract test
design/                  the Ephemeris Design System: tokens, components, fonts, logos
scripts/                 build-tokens and other tooling
```

## Development

Requires Node.js and pnpm.

```
pnpm install
node apps/desktop/node_modules/electron/install.js   # once, if Electron did not download
pnpm dev          # run the desktop app with hot reload
pnpm test         # unit tests (Vitest)
pnpm test:e2e     # end-to-end tests (Playwright, Electron)
pnpm tokens       # regenerate CSS variables from design/tokens.json
```

After renaming or moving the repository folder, run `pnpm install` once: on Windows pnpm links `node_modules` with absolute paths, and the install re-links them (no download). `pnpm --filter @ephemeris-notes/desktop icons` re-renders the app icon from `design/assets/Logos`.

**Windows app:** `pnpm dist` builds `apps/desktop/release/Ephemeris-Setup-0.1.0.exe` (a per-user installer: no administrator prompt, install folder of your choice, Start menu and desktop shortcuts) and `Ephemeris-0.1.0-portable.exe` (runs without installing). They are not code-signed, so Windows SmartScreen asks once (More info, then Run anyway). `VX_PACKAGED=1 pnpm test:e2e` smoke-tests the packaged app.

**Performance:** an opt-in test measures the app on a generated 5,000-note library. Set `VX_PERF=1` and run `pnpm test:e2e`; it takes a few minutes and writes `apps/desktop/test-results/perf.json`.

## Plugins

The core ships no feature plugins; they live in their own repositories, built against the typed API in `packages/plugin-api` (`@ephemeris-notes/plugin-api`). Plugins are trusted code: install only plugins you trust.

The sample plugin (`packages/sample-plugin`) shows every part of the API. Build it with `node packages/sample-plugin/build.mjs` into `dist/`, then install that folder from Settings > Plugins > Install from Folder….

## License

MIT. See [`LICENSE`](LICENSE).

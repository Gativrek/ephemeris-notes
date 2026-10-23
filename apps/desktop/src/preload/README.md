# `window.vx`: the bridge

The renderer's only door to the system (SPECS 3.4). `src/preload/index.ts` exposes one
deeply frozen object through `contextBridge`. Every method forwards to an
`ipcMain.handle('vx:<namespace>.<method>')` handler in main, which validates every
argument. Types live in `src/shared/bridge.ts`.

## Rules

- Every call returns `Promise<Result<T>>`: `{ ok: true, value }` or
  `{ ok: false, error: { code, message, detail? } }`. Nothing throws across the bridge.
- Handlers accept calls only from the app's own page (`vx-app://app/…`, or the Vite dev
  server origin when unpackaged).
- Paths are library-relative POSIX paths. Hidden paths (any segment starting with `.`)
  are refused with `FORBIDDEN`. The renderer never sends absolute paths.
- No process spawning, no arbitrary filesystem access, no shell access beyond
  `shell.openExternal(url)` (http and https only, and only during a user gesture) and
  `shell.revealInFolder(path)` (library paths).

## Error codes

`INVALID_ARGUMENT`, `INVALID_PATH`, `OUTSIDE_LIBRARY`, `RESERVED_NAME`, `NOT_FOUND`,
`EXISTS`, `CONFLICT` (detail: `{ hash }` of the file now on disk), `NOT_UTF8`,
`NO_LIBRARY`, `NOT_A_LIBRARY`, `ALREADY_LIBRARY`, `NOT_IMPLEMENTED`, `FORBIDDEN`, `IO`.

## Surface

| Method | Returns | Notes |
|---|---|---|
| `library.open()` | `{ kind: 'opened', library } \| { kind: 'not-library', token, folder } \| { kind: 'cancelled' }` | Shows the folder dialog in main. |
| `library.create(token?)` | `{ kind: 'created', library } \| { kind: 'cancelled' }` | With `token` (from `open`), creates there; otherwise shows a dialog. |
| `library.current()` | `LibraryInfo \| null` | |
| `library.close()` | `null` | |
| `library.stats()` | `{ notes: Record<Domain, number> }` | |
| `library.onChanged(cb)` | unsubscribe | |
| `library.files()` / `library.onFilesChanged(cb)` | `{ version, files: { path, size, mtime }[] }` | The file catalog: every visible file. |
| `notes.create(vaultPath, folder, title, template)` | path | Unique name in `folder`; template variables expanded. |
| `notes.templates(vaultPath)` | paths | Markdown files in the Vault's template folder. |
| `notes.daily(vaultPath)` | `{ path, created }` | Today's daily note (SPECS 4.5). |
| `notes.addAttachment(vaultPath, fileName, bytes)` | path | Copies into the attachment folder with `name 1.png`-style names. |
| `vaults.*` | | List, get, create, update, moveImpact, move, remove (typed name), nonVaultFolders, makeVault. |
| `ui.get(key)` / `ui.set(key, value)` | | Per-machine UI state for the open library (desk, pins, last Vault). |
| `fs.read(path)` | `TextFile` | LF text, `hash` (SHA-256 of raw bytes), `eol`, `mixedEol`, `bom`, `finalNewline`, `readOnly` (not UTF-8). |
| `fs.readBinary(path)` | `Uint8Array` | Up to 512 MB. |
| `fs.write(path, text, expectedHash)` | `{ path, hash, mtime }` | `CONFLICT` if the disk changed; `NOT_UTF8` for read-only files; unchanged text is a no-op. |
| `fs.create(path, text)` | `{ path, hash, mtime }` | New LF file; `EXISTS` if anything is there. Parent must exist. |
| `fs.rename(from, to, { updateLinks? })` | `{ path }` | Refuses to replace. Case-only renames work. Link updates arrive in M3. |
| `fs.trash(path)` | `null` | OS trash only. |
| `fs.mkdir(path)` | `{ path }` | Creates missing parents; validates each new name. |
| `fs.list(dir)` / `fs.stat(path)` | `FileEntry[]` / `FileEntry` | `""` is the library root. |
| `index.*` | | `NOT_IMPLEMENTED` until M3. |
| `settings.get(key)` / `set(key, value)` / `onChanged(cb)` | | Keys `library.*` are stored in `.vaults/settings.json`; others per machine. |
| `window.minimize/maximize/close/setTitle` | `null` | |
| `window.contextMenu(items)` | item id or `null` | Native menu. Test mode returns `globalThis.__vxContextMenuChoice`. |
| `window.setChrome({ background, symbols })` | `null` | Title-bar overlay colours (`#rrggbb`). |
| `window.onBeforeClose(cb)` / `window.readyToClose()` | | Main asks before closing; the renderer saves, then confirms. Main closes anyway after 4 s. |
| `shell.openExternal(url)` / `revealInFolder(path)` | `null` | |
| `events.onFileChanged/Created/Deleted(cb)` | unsubscribe | External changes only; the app's own writes are filtered by hash. |

Later milestones add namespaces here (`vaults`, `index`, `plugins`); each is listed in
`BRIDGE_METHODS` in `src/shared/bridge.ts` so preload and main agree on channels.

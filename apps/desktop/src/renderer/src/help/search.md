# Search syntax

`Ctrl+K` focuses the search field in the title bar. The scope next to it searches the current **Vault**, its **Domain**, or **All** of the library (including folders outside the Domains).

| You type | It finds |
|---|---|
| `sourdough starter` | notes with both words |
| `"french revolution"` | the exact phrase |
| `kalman -unscented` | notes with "kalman" but not "unscented" |
| `tag:#travel` | notes tagged `#travel` (and `#travel/...`) |
| `path:Lectures` | notes whose path contains "Lectures" |
| `vault:garden` | notes in Vaults whose name contains "garden" |
| `ext:pdf` | files with that extension, by name |

Accents do not matter: `cafe` finds "café".

Notes whose title contains every word come first. Use Up and Down to move through results, Enter to open, and `Ctrl+Enter` to open a result while keeping the list.

While the index is being built the field shows its progress; search works on what is already indexed. Settings > Library > Rebuild Index starts over from the files.

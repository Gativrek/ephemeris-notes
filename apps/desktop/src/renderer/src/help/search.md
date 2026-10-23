# Search syntax

`Ctrl+K` focuses the search field in the title bar. The scope next to it searches the current **Vault**, its **Domain**, or **All** of the library (including folders outside the Domains).

| You type | It finds |
|---|---|
| `kalman filter` | notes with both words |
| `"extended kalman"` | the exact phrase |
| `kalman -unscented` | notes with "kalman" but not "unscented" |
| `tag:#gnss` | notes tagged `#gnss` (and `#gnss/...`) |
| `path:Lectures` | notes whose path contains "Lectures" |
| `vault:robotics` | notes in Vaults whose name contains "robotics" |
| `ext:pdf` | files with that extension, by name |

Accents do not matter: `navegacao` finds "navegação".

Notes whose title contains every word come first. Use Up and Down to move through results, Enter to open, and `Ctrl+Enter` to open a result while keeping the list.

While the index is being built the field shows its progress; search works on what is already indexed. Settings > Library > Rebuild Index starts over from the files.

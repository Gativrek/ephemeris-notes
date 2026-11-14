# The workspace

Opening a Vault shows its workspace: the rail on the left, the sidebar, the desk above the editor, the outline panel on the right and the status bar at the bottom.

## The rail

From top to bottom: **Switch Vault** (back to the chooser, `Ctrl+O`), **Files** (the sidebar), **Search** (`Ctrl+K`), **Inbox** (with a count when notes are waiting), **Daily note** (`Ctrl+Shift+D`), then **Help** and **Settings** (`Ctrl+,`) at the bottom.

## The sidebar

`Ctrl+\` shows or hides it.

- **The Vault header** shows the cover, the Vault's name and its note count. Hover it to get arrows in its corners that step to the previous and next Vault of the same Domain (also **Previous Vault in Domain** and **Next Vault in Domain** in the command palette). Right-click it to change or remove its wide **banner** image.
- **Section tiles** sit two per row. At most six show; past that, the last tile is **More**, which shows them all. A cut-off name shows in full in the tile's tooltip.
- **Wider sidebar:** drag the sidebar's right edge (or focus it and use the arrow keys, Home and End) to give long names room. Double-click the edge to go back to the standard width. The width is remembered.
- **The tree** lists the selected section's notes and folders, folders first, `Lecture 2` before `Lecture 10`. Deeper folders are listed flat under their second-level folder, with the rest of their path beside them.

Right-click a note or folder for **New Note**, **New Note from Template…**, **New Folder**, **Rename…** (or `F2`), **Move to…**, **Pin to Desk**, **Show History**, **Show in File Manager** and **Move to Trash…**. Drag a note onto a folder to move it. Renaming or moving offers to update every link that points to it.

## Templates, daily notes and attachments

- **Templates** are Markdown files in the Vault's `_templates` folder. **New Note from Template** offers them; `{{title}}`, `{{date}}`, `{{time}}`, `{{vault}}` and `{{domain}}` are filled in.
- **Today's daily note** (`Ctrl+Shift+D`, or the rail) opens `YYYY-MM-DD.md` in the Vault's daily folder, made from `_templates/Daily.md` when that exists. The daily folder has its own tile.
- **Attachments:** paste or drop a file into a note to copy it into `_attachments` and embed it.

## The desk

The notes, PDFs and other items you open sit on the desk, a strip of cards above the editor. Click a card to switch to it; middle-click it or press `Ctrl+W` to close it. Right-click a card and choose **Pin to Desk**: pinned cards stay after the divider, marked with a gold diamond. Up to twelve items stay open; opening another closes the one you used least recently, never a pinned one. When the cards do not fit, drag or scroll the desk sideways.

## The editor

The editor shows rendered Markdown and reveals the source of the line you are editing. `Ctrl+E` switches the whole note to plain source. `Ctrl+F` finds in the note.

## The outline panel

`Ctrl+Shift+O` shows or hides it. It follows the note: headings, with each section's links, equations and code blocks, and **Linked from**, the notes that link here. Click any entry to scroll there. Settings > Appearance > **Outline style** offers four ways to show it:

- **Annotated outline**: the list described above.
- **Margin track**: a thin rail for the whole note, headings as labelled ticks, and a band for the lines in view.
- **Document map**: a miniature page, each section as tall as its text.
- **Tabbed inspector**: Outline, Links and Info (properties, counts and the path).

## The status bar

The Vault and section on the left; the word count, the cursor's line and column, indexing progress and "Saved" or "Saving…" on the right.

## The command palette

`Ctrl+P` lists every command, core and plugin, with fuzzy search. **Open Note…** finds any note by name; **Insert Link** puts a link to one at the cursor. Commands without a shortcut can be given one in Settings > Keyboard.

## Settings

`Ctrl+,` opens Settings:

- **General**: reopen the last Vault on launch, the language for dates.
- **Editor**: font size, line width, autosave delay, spell check.
- **Keyboard**: every shortcut (see **Keyboard shortcuts**).
- **Math**: equation numbering, reference format, KaTeX macros.
- **Appearance**: light, dark or system theme (the chooser stays light), and the outline style.
- **Library**: rebuild the index, find ambiguous links, folders that are not Vaults, and git (see **History and git**).
- **Plugins**: install and enable plugins (see **Plugins**).
- **Help** and **About**.

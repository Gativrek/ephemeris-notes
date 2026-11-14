# Getting started

Your notes live in one folder on disk, the **library**. Everything in it is plain Markdown, so any editor, sync tool or git can work with it.

## Domains

The library has three fixed folders, the **Domains**:

- **Academic**: research and coursework.
- **Work**: industry work.
- **Personal**: personal projects.

The chooser shows them as columns. Their folder names never change.

## Vaults

A **Vault** is a folder inside a Domain that holds `.vault/vault.json`. Each Vault has a name, an optional cover image and its own attachment, template and daily-note folders. Create one with **New Vault** in the chooser; right-click a Vault card to edit it, rename its folder or move it to another Domain.

Links, search and backlinks work across the whole library, not just one Vault.

## The chooser

The chooser shows each Domain's Vaults as cards on a strip: drag or flick it, or scroll with the wheel. Click a card to select it and double-click (or press Enter) to open it; its cover flies up into the Vault's header.

- Left and Right select a card; `[` and `]` switch Domain; Enter opens; `E` edits the selected Vault; Escape goes back to the open Vault.
- `R` arranges the cards: drag one to its place, or select one and press Left and Right; Enter or **Done** keeps the order, Escape cancels.
- **New Vault** asks for a name, a Domain and a cover. Pick the cover's focus point by clicking the image, and its zoom with the slider; the card beside it shows the result. Editing a Vault can also move it to another Domain, or delete it (you type its name to confirm; the folder goes to the system trash).

`Ctrl+O` returns to the chooser from anywhere. Settings > General > **Reopen last Vault** skips the chooser at launch.

## Sections

The top-level folders of a Vault are its **sections**, shown as tiles at the top of the sidebar, two per row (drag the sidebar's edge to widen it). Notes at the Vault root, outside any section, appear under **Unfiled**: right-click a section tile and choose **New Unfiled Note**, or right-click a note and choose **Move to Unfiled**. **New Section** is the + beside "Sections"; right-click a tile to rename it, delete it or change its icon. Right-click a note and choose **Move to…** to file it in another section. Right-click the Vault header to give it a wide **banner** image. Folders whose names start with `_` (attachments, templates) are not sections.

## The desk

Notes you open sit on the **desk**, the strip above the editor. Pin a note to keep it there; `Ctrl+W` closes the active one. The editor shows rendered Markdown and reveals the source of the line you are editing. `Ctrl+E` switches to plain source. See **The workspace** for the desk, the outline panel and the rest.

## Inbox

`Inbox/` at the library root collects notes created by other tools. See **Inbox contract**.

## Saving

Notes save automatically a moment after you stop typing, when you switch notes, and when the window closes. The app never writes a note you did not change, and anything it deletes goes to the system trash.

When a note changes on disk (another editor, a sync tool), the app reloads it. If you had unsaved edits, it asks instead: **Keep Mine** or **Load Theirs**. A note deleted on disk while open offers **Restore** or **Close**.

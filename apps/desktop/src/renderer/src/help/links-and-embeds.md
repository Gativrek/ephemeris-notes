# Links and embeds

## Wikilinks

- `[[Note]]` links to a note.
- `[[Note|shown text]]` shows other text.
- `[[Note#Heading]]` links to a heading, `[[Note#^id]]` to a block.
- `[[paper.pdf#page=3]]` opens a PDF at page 3.

Type `[[` to get suggestions. The app inserts the shortest form that names exactly one file, so the same link works in Obsidian. The palette command **Insert Link** does the same.

Click a rendered link to open it. A link to a note that does not exist has a dashed underline; clicking it offers to create the note.

## How links resolve

Links are resolved across the whole library and ignore case.

1. A link with `/` is a path: from the library root, then from the current Vault, then as the end of a longer path.
2. A bare name matches any file with that name.
3. When several files match, the one in the same Vault wins, then the same Domain, then the shortest path. The link shows an "ambiguous" hint; Settings > Library > Find Ambiguous Links lists them all.

## Embeds

Put `!` in front of a link to show the file inside the note:

- `![[diagram.png]]`: an image (also video and audio).
- `![[Other note]]` or `![[Other note#Heading]]`: the note or one section, read-only.
- `![[paper.pdf#page=3]]`: one PDF page.

Paste or drop a file into a note to copy it into the Vault's attachment folder and embed it.

## Renaming and moving

When you rename or move a note through the app, it offers to update every link that points to it, and lists the notes it would change.

## Backlinks

The outline panel lists the notes that link to the current note under **Linked from**.

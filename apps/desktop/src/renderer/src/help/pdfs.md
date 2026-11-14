# PDFs

PDFs in the library open on the desk, like notes. The file itself is never changed.

## Reading

- The toolbar has previous and next page, the page number (type one and press Enter), zoom out and in, and **Fit Width**.
- **Find in document** (`Ctrl+F` in the viewer) highlights every match; Enter goes to the next one, Shift+Enter to the one before.
- **Thumbnails** opens a sidebar of pages; click one to go there.
- Text can be selected and copied. Links to websites open in your browser when clicked.
- Each PDF reopens at the page you left it on.

## Linking

- `[[paper.pdf]]` opens a PDF; `[[paper.pdf#page=3]]` opens it at page 3.
- `![[paper.pdf#page=3]]` shows that page inside the note.
- `[[paper.pdf#page=3&selection=4,0,6,12]]` opens it at a passage and marks it: a highlight.

## Highlights

Select text in a PDF and a small bar appears over it:

- **Highlight** (or press `H`) keeps the passage in the PDF's highlights note, "paper highlights" next to the PDF, made the first time. Each highlight is the quoted text and a link back to the passage.
- **Copy Quote** (`Ctrl+Shift+C`) copies the same two lines, to paste into any note you like.

A selection across two pages makes one highlight per page.

Any note that links to a passage marks it in the PDF, in yellow, whichever note it is in. Hover a mark to see which note; click it to open that note. A followed link flashes its passage.

The **Highlights** button in the toolbar lists every highlight in page order, with its text from the PDF; click one to go to it. Right-click for **Open Note**, or **Remove Highlight** for those in the highlights note (undo with `Ctrl+Z` in that note). A passage the PDF no longer has is listed as "Not found in this PDF".

Highlights use Obsidian's selection links, so they open in Obsidian at the passage, and a link copied from Obsidian's PDF viewer shows here as a highlight. Scanned pages without selectable text cannot be highlighted.

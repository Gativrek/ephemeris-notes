# Using with Obsidian

The library is an ordinary folder of Markdown files. Open it as a vault in Obsidian at any time; nothing is lost.

## What carries over

- Wikilinks, headings and block links, embeds and PDF page links use Obsidian's syntax.
- Link resolution matches Obsidian's: case-insensitive, by file name when unique. Links the app writes use the shortest unambiguous form, so Obsidian resolves them to the same files.
- Frontmatter, tags, task lists and `$` math look the same.

## What degrades to text

- Equation labels (`{#eq:name}`) and references (`@eq:name`) show as plain text in Obsidian.
- Plugin blocks show as fenced code.

## Folders

- Folders starting with `.` (`.ephemeris`, `.vault`, `.obsidian`, `.git`) are hidden in the app and skipped by the index, so Obsidian's own settings never appear here.
- Folders next to the Domains, such as an archive moved in from Obsidian, are indexed, searchable with the **All** scope and linkable, but not shown in the sidebar. Settings > Library lists them.

## Editing in both

Changes made in Obsidian while the app is open are picked up immediately. If you had unsaved edits to the same note, the app keeps yours and shows a banner to compare or reload.

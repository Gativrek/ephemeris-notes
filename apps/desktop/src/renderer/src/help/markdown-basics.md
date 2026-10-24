# Markdown basics

Notes use CommonMark with the GitHub additions, plus a few extras for links and math.

## Text

- `**bold**` for **bold**, `*italic*` for *italic* (`Ctrl+B`, `Ctrl+I`).
- `~~struck~~` for ~~struck~~.
- `` `code` `` for `inline code`.

## Headings

Start a line with one to six `#` and a space. Headings build the outline panel (`Ctrl+Shift+O`).

## Lists and tasks

- `- item` or `1. item` for lists.
- `- [ ] task` and `- [x] done` for task lists. Click the box to toggle it.

## Quotes, rules and tables

> A line starting with `>` is a quote.

Three dashes on their own line draw a rule. Tables use pipes:

| Ingredient | Amount |
|---|---|
| Flour | 500 g |
| Water | 350 ml |

## Code

Fence code with three backticks and a language name:

```python
print("hello")
```

A fence whose language belongs to a plugin renders as that plugin's block. Double-click a plugin block to edit its source.

Add `title="…"` after the language to name a block. The outline shows the title instead of the language, and plugins show it as a caption:

````
```python title="Greeting"
print("hello")
```
````

## Properties

YAML between `---` lines at the very top of a note holds its properties (tags, aliases, dates). It renders as a property list.

## Tags and block IDs

`#tag` and `#nested/tag` mark notes. ` ^id` at the end of a line names that block so links can point at it.

## Not rendered

Raw HTML stays visible as source text.

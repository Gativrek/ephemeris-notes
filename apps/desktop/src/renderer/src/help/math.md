# Math and equation references

Math is typeset with KaTeX.

## Inline and display

- `$x^2$` is inline math: $x^2$.
- `$$ … $$` on its own lines is a display equation.

$$
P(A \mid B) = \frac{P(B \mid A)\, P(A)}{P(B)}
$$

An opening `$` must not be followed by a space, and a closing `$` must not follow a space or come before a digit, so prices like $5 and $10 stay text. Write `\$` for a literal dollar sign.

## Labels and references

Label a display equation by writing `{#eq:name}` right after the closing `$$`:

```
$$
F = m a
$$ {#eq:newton}
```

Refer to it anywhere in the same note with `@eq:newton`. The reference shows the equation's number and jumps to it when clicked. Type `@eq:` for suggestions.

## Settings

Settings > Math chooses:

- whether every display equation is numbered or only labeled ones (as pandoc-crossref numbers them for export);
- how references read: "Eq. (3)", "(3)" or "Equation 3";
- KaTeX macros, one per line as `\name = definition`. They are stored with the library, so they travel with your notes.

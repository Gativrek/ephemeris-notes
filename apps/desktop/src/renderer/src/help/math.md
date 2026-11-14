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

## Equations in other notes

A labeled equation in another note is a link to it: `[[Kalman Filter#eq:kf-gain]]` reads "Kalman Filter, Eq. (3)", with the number that note shows. Hover it to see the equation; click it to open the note at the equation. `[[Kalman Filter#eq:kf-gain|the gain]]` shows your own text instead.

Put `!` in front, on a line of its own, to show the equation itself here, numbered as in its note: `![[Kalman Filter#eq:kf-update]]`.

After `[[Kalman Filter#`, suggestions list the note's labeled equations after its headings; after `#eq:`, only equations. A label that note does not have reads "Eq. (?)". Renaming the note updates these links like any other; renaming a label does not.

## Settings

Settings > Math chooses:

- whether every display equation is numbered or only labeled ones (as pandoc-crossref numbers them for export);
- how references read: "Eq. (3)", "(3)" or "Equation 3";
- KaTeX macros, one per line as `\name = definition`. They are stored with the library, so they travel with your notes.

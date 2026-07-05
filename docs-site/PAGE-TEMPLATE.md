# Page Template

Every workflow page in this manual (a page documenting a concrete feature or
action, as opposed to a section overview) follows the same structure so
readers can scan pages consistently. Copy the shape below when writing a new
page, and fill in each section as described.

```markdown
---
title: <Feature name>
---
# <Feature name>
> One sentence: what it does + when you'd reach for it.

**Where:** <ribbon tab ▸ panel ▸ button> · **Shortcut:** <key or —> · **Applies to:** <part / assembly / drawing>

## What it does
## Before you start
## Steps
## Options
## Tips & gotchas
## See also

<!-- SCREENSHOT: <what to capture> — TODO follow-up -->
```

## Section-by-section

- **Frontmatter `title`** — the page title, used for `<title>`, the sidebar,
  and the `<h1>`. Keep it identical to the `# <Feature name>` heading.
- **Lede line** — a single blockquote sentence: what the feature does and the
  situation that would send a reader to this page. No more than one sentence.
- **Meta line** — where to find the feature in the UI (ribbon tab ▸ panel ▸
  button), its keyboard shortcut (or `—` if none), and what it applies to
  (part, assembly, drawing, ...). Keeps orientation cheap before reading steps.
- **What it does** — a short paragraph of prose explaining the feature's
  purpose and behavior in plain language.
- **Before you start** — a bullet list of prerequisites: state the document
  must be in, prior steps that must be complete, selections that must exist.
- **Steps** — a numbered list. Each step names a real UI label (button, menu
  item, field) exactly as it appears in the app. End the list with an
  italicized result line, e.g. `*Result: the new panel appears in the browser
  tree.*`
- **Options** — a markdown table mapping each dialog field or option to what
  it means and when to change it. Columns: `Field`, `Meaning`.
- **Tips & gotchas** — a freeform bullet list of caveats, edge cases, and
  things that trip people up.
- **See also** — relative markdown links to sibling pages, e.g.
  `[Panels](./panels.md)`. Use standard relative markdown links, **not**
  `[[wiki-style]]` links — VitePress does not resolve those.

## Screenshots

Never invent, fake, or hand-draw a screenshot. Leave the
`<!-- SCREENSHOT: ... -->` comment in place as a placeholder that
describes exactly what a future capture pass should screenshot; a real image
gets dropped in later.

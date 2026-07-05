---
title: Concepts
---
# Concepts

> The ideas that stay the same across every tool in Zilventor — document kinds, materials,
> parameters, saving, and the browser tree — read these once and the rest of the manual makes
> more sense.

The workflow pages in this manual (sketching, panels, drilling, drawings, and so on) all lean
on a handful of ideas that don't belong to any one tool. Every open file is one of exactly
three document kinds, and that kind decides what the ribbon even shows you. Every panel gets
its thickness, edge-banding, sheet size, and hatch pattern from a material record you manage in
one place. Named parameters drive dimensions everywhere a number can be typed, and a part can
save several parameter snapshots as named configurations. Nothing you do is ever really "lost"
because the app is quietly autosaving to browser storage as you go. And the tree on the left —
the Browser pane — is how you navigate everything you've built, including a couple of
context-menu actions that aren't where you'd expect them.

This section covers those five ideas on their own, once, so the workflow pages that use them
don't have to re-explain them every time.

## In this section

| Page | What it covers |
|---|---|
| [Documents and Kinds](./documents-and-kinds.md) | Part (`.zipt`), Assembly (`.ziasm`), and Drawing (`.zidw`) — what each stores, how the ribbon changes per kind, and how assemblies reference parts and sub-assemblies |
| [Materials](./materials.md) | The Material Registry: thickness, sheet size, hatching, edge-banding, and custom textures, plus why grain direction lives on the panel instead |
| [Parameters and Configurations](./parameters-and-configurations.md) | The Parameters panel (F7) for named values, and part-level Configurations for saved parameter snapshots — including their real limits |
| [Saving and Sessions](./saving-and-sessions.md) | Why there's no Save button, how OPFS autosave and session restore work, Save As to disk, and format-version migration |
| [The Browser Tree](./the-browser-tree.md) | Expanding, selecting, and double-clicking in the component/feature tree, and its prompt-based right-click actions |

## See also

- [Interface Tour](../getting-started/interface-tour.md)
- [Your First Project](../getting-started/your-first-project.md)
- [Glossary](../reference/glossary.md)

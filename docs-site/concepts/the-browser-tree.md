---
title: The Browser Tree
---
# The Browser Tree

> The Browser pane is the tree view of everything in the open document — components,
> sub-assemblies, and (for a selected part) its own feature list — and it's how you navigate
> structure without hunting through the 3D viewport.

<!-- SCREENSHOT: the Browser pane showing an expanded sub-assembly with a leaf part's feature tree open underneath — TODO follow-up -->

## Expanding and selecting

Any row that is a sub-assembly, or that has feature rows nested under it, carries a ▼/▶ toggle
next to its name. Click the toggle to expand it: a sub-assembly expands into its own
components, a leaf part expands into its feature tree.

A single click on any row selects that component in the 3D viewport, and the reverse works
too — clicking a part in the viewport highlights its row in the tree. This is the fastest way
to find a part buried several assembly levels deep: click it in 3D and let the tree scroll to
and highlight it, rather than expanding rows by hand.

## Double-click to edit

Double-clicking behaves differently depending on what row you double-click:

- **A component's root row** (part or sub-assembly, at the top level of the tree) opens its
  edit dialog — position, rotation, and other placement properties for that instance.
- **A panel feature row**, inside a leaf part's own feature tree, opens that panel's edit
  dialog.
- **A work-axis or work-point feature row** opens the work-feature edit flow.
- **Any other feature row** (a plain extrude, etc.) just selects it — double-clicking doesn't
  open anything for these.

## Right-click actions

This is the part of the Browser pane that catches people off guard: there is no polished
dropdown menu here. Every right-click action is a plain browser `confirm()` or `prompt()`
dialog, and which one you get depends entirely on what kind of row you right-clicked.

- **A sub-assembly flagged with a legacy pose** — right-clicking shows a confirm dialog: *"Repair
  cabinet geometry? This backfills correct panel placement for a legacy cabinet without
  changing panel sizes or materials."* This only appears on cabinets saved before the pose
  system existed and that still need the backfill; an already-current cabinet won't show it.
  Confirming runs the repair in place.
- **Any other sub-assembly** — a confirm dialog: *"Open {name} in standalone?"* Confirming opens
  that nested assembly as its own top-level document, outside the parent assembly — useful for
  editing a sub-assembly in isolation.
- **A leaf part (component)** — a text-entry prompt for a color override. See the next section;
  this one has a second, hidden behavior.
- **A panel feature inside a part's own feature tree** (one level deeper than the component
  tree) — a separate text prompt: *"Panel actions: type "suppress" or "delete""*. Typing
  `delete` removes the feature; typing `suppress` toggles it hidden/inactive without deleting
  it. It's the same type-a-word-into-a-prompt pattern as the color-override prompt below, just
  with different vocabulary and a different target — worth recognizing once you've seen it the
  first time.

### The color-override prompt doubles as a convert command

Right-clicking a leaf part in the component tree opens a prompt reading: *"Override color (hex,
e.g. #d4a574); blank to clear:"*. What you type decides what actually happens:

- A hex color (e.g. `#d4a574`) overrides that component's display color in this assembly only —
  it doesn't touch the part's own file.
- Leaving it blank clears any existing color override, reverting to the part's own color.
- Typing the literal word **`convert`** (case-insensitive) does something unrelated to color: it
  triggers **convert imported part to panel**. The app checks that the part actually came from
  an import and has real geometry, then opens a panel dialog pre-filled from the imported shape
  so you can turn a raw imported solid into a proper, editable Zilventor panel feature.

Nothing in the UI hints that this prompt does two unrelated things. There's no separate menu
item, no tooltip, no asterisk next to "convert" — it's an undocumented shortcut layered onto the
color-override prompt. State it plainly because you need to know it to use it: if you want to
convert an imported part, right-click it and type `convert` into what looks like a
color field. See [Convert imported part to panel](../import-migration/convert-to-panel.md) for
the full dialog and undo behavior.

<!-- SCREENSHOT: the "Override color (hex...); blank to clear:" browser prompt open on a leaf part row — TODO follow-up -->

## See also

- [Documents and kinds](./documents-and-kinds.md)
- [Convert imported part to panel](../import-migration/convert-to-panel.md)
- [Placing components](../assemblies/placing-components.md)

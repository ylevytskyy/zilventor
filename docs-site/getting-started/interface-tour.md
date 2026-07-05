---
title: Interface Tour
---
# Interface Tour

> A tour of Zilventor's main window: the ribbon, the browser pane, the properties panel, and the status bar.

This page is descriptive, not a workflow — it orients you before you dive into a specific
feature page. What you actually see in each of the four regions below depends on **what kind
of document you have open** (part, assembly, or drawing) and **what's currently selected**.

## The ribbon

The ribbon sits along the top of the window. Its tabs change depending on the document kind:

| Document kind | Tabs |
|---|---|
| Part | **File, Model, Sketch, Furniture, Inspect, Drawing, View** |
| Assembly | **File, Assembly, Sketch, Furniture, Inspect, Drawing, View** |
| Drawing | **File, Drawing, View** |

An assembly document swaps **Model** for **Assembly** — everything else is the same set of
tabs as a part. A drawing document only shows **File, Drawing, View**, since modeling and
furniture tools don't apply to a 2D sheet.

Roughly what each tab is for:

- **File** — open, save, import, export.
- **Model** / **Assembly** — 3D modeling operations (sketches into features, or placing and
  constraining components).
- **Sketch** — 2D sketching tools.
- **Furniture** — cabinet, door, hardware, Присадка (drilling/machining), and nesting tools.
- **Inspect** — measurement and interference-check tools.
- **Drawing** — 2D drawing-sheet tools (views, dimensions, annotations, export).
- **View** — camera and display toggles.

Beyond what a tab's name suggests, this tour doesn't enumerate every button on it — see the
relevant section of the manual for the tools inside a given tab.

## The browser pane

The browser pane sits on the left and shows the structure of your document as a tree.

- In a **part** document, it shows that part's feature tree directly — there are no extra
  sub-tabs.
- In an **assembly** document, it's a combined tree of components and their nested features
  under an **Assembly** tab, plus sibling sub-tabs: **BOM**, **Cut List**, **Nesting**,
  **Statistics**, **Production**. These five sub-tabs only appear for assemblies — a part
  document has none of them.

What the assembly-only sub-tabs roughly cover:

- **BOM** — the bill of materials. See [Bill of Materials](../assemblies/bill-of-materials.md).
- **Cut List** — the panel cut list. See [Cut List](../furniture/cut-list.md).
- **Nesting** — sheet-layout results. See [Nesting](../manufacturing/nesting.md).
- **Statistics** — cost and material stats. See [Cost and Statistics](../furniture/cost-and-statistics.md).
- **Production** — QR/packing-slip reconciliation. See [Production Reconciliation](../manufacturing/production-reconciliation.md).

## The properties panel

There isn't one single, generic "properties panel." The right-hand side of the window is
contextual: it shows a panel relevant to whatever you've currently selected. Select an
extrude feature and you get its numeric parameters; select a bore, groove, or keyhole-slot
feature and you get a panel built for that feature. Select nothing relevant, and there may be
nothing to show there at all.

Think of it as **a contextual panel on the right that shows editable parameters for whatever
you've selected**, rather than a fixed, uniform component. This tour doesn't attempt to list
every feature-specific panel that exists — each feature's own page in this manual documents
its panel.

## The status bar

The status bar runs along the bottom of the window, left to right:

1. **Status message** — "Ready" normally, "Loading CAD kernel…" while the CAD kernel
   initializes, or a kernel-failure message with a **Retry** button if kernel init failed.
   There's no separate always-visible kernel-status light; kernel state shares this same slot.
2. **Selection text** — describes whatever is currently selected.
3. **Modified indicator** — a dot that appears when there are unsaved changes.
4. **Save-state indicator** — "✓ Saved" / "⟳ Saving…" / "✕ Not saved".
5. **Sketch DOF** — shown only while actively sketching: "Fully constrained" / "N DOF" /
   "Over constrained: N".
6. **Assembly DOF/solver** — shown in assembly documents: "Assembly: fully constrained" /
   "Assembly: N DOF" / "Assembly: over-constrained" / "Assembly: solver did not converge".
7. **Component count** — "N components in M sub-assemblies".
8. **Diagnostics warning icon** — appears when relevant.
9. **Unit label** — right-aligned, always "mm". Zilventor works in millimeters.

## Tips & gotchas

- Tabs and sub-tabs change by document kind — don't be surprised that a part document has no
  **Assembly** tab, or that **BOM**/**Cut List**/**Nesting**/**Statistics**/**Production**
  only show up once you're in an assembly.
- The right-hand panel is selection-driven, not a fixed layout — if you expect to see
  parameters and see nothing, check what (if anything) is actually selected.
- The sketch-DOF and assembly-DOF segments in the status bar only appear in their relevant
  contexts (actively sketching, or an assembly document) — they're not always visible.
- Units are always millimeters; there's no unit switcher in the status bar.

## See also

- [Your First Project](./your-first-project.md)
- [Documents and Kinds](../concepts/documents-and-kinds.md)
- [The Browser Tree](../concepts/the-browser-tree.md)
- [Bill of Materials](../assemblies/bill-of-materials.md)
- [Cut List](../furniture/cut-list.md)
- [Nesting](../manufacturing/nesting.md)
- [Cost and Statistics](../furniture/cost-and-statistics.md)
- [Production Reconciliation](../manufacturing/production-reconciliation.md)

<!-- SCREENSHOT: the full main window with the four regions labeled — ribbon (top), browser pane (left), properties panel (right), status bar (bottom) — TODO follow-up -->

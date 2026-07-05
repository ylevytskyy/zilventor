---
title: Parameters and Configurations
---
# Parameters and Configurations

> Parameters are named values that drive sketch dimensions and feature inputs; configurations
> are saved snapshots of a part's parameter values you can switch between with one click.

**Where:** Parameters — **F7** (any panel) · Configurations — **Model ▸ Configurations…** ·
**Shortcut:** F7 (Parameters), — (Configurations) · **Applies to:** part (configurations are
part-only; see Known limits)

## Parameters

The Parameters panel is a table with four columns: **Name**, **Value**, **Unit**, and
**Expression**. Each row is a named value — a plain number with a unit — that you can reference
by name from anywhere an expression is accepted: sketch dimensions, feature inputs (extrude
distance, hole depth, pattern count, and so on). Change a parameter's value once and every
sketch or feature that references it by name updates on the next regeneration.

Press **F7** to open the Parameters panel. It's a standard dockable panel like any other in the
shell — toggle it again to close it.

For how expressions are typed into a dimension field (referencing a parameter by name, writing
arithmetic, etc.), see [Dimensions](../modeling/dimensions.md).

## Configurations

A **Configuration** is a named row that overrides some subset of the part's parameters with
alternate values — effectively an "iPart"-style variant table. A part can carry any number of
configurations; activating one applies its overrides to the live part immediately.

Open the dialog from the ribbon: **Model ▸ Configurations…**. The Configurations panel shows a
table of rows — **Name** and **Values** — and the row for whichever configuration is currently
active is highlighted.

Rows get into the table two ways:

- **Add Row** — clones the part's *current* live parameter values into a new named
  configuration. Set the part up the way you want it, click Add Row, and that state becomes a
  saved row.
- **Import CSV** — uploads a CSV file and parses it into configuration rows. This **replaces
  the entire configurations table** with what's in the file — it does not merge or append.

Clicking a row **activates** it: the part's parameters are immediately updated to that row's
values and every dependent sketch/feature regenerates. This is a live apply, not a preview.

## Known limits

- **Part-level only.** Configurations live on the part document; there is no equivalent on
  assemblies. The **Model** ribbon tab — where the Configurations… button lives — only exists
  when the active document is a part; opening an assembly replaces it with an **Assembly** tab,
  so there is no menu path to configurations from an assembly at all.
- **No CSV export.** You can import a CSV to populate the table, but there's no button to
  export the current table back out as one.
- **No inline cell editing.** You can't click a cell in the table and retype a value. The only
  ways to change the table are Add Row (clone-from-current) and Import CSV (whole-table
  replace). Fixing a typo in one row means re-importing a corrected CSV or re-adding the row.
- **Active configuration isn't saved.** Which configuration (if any) is active lives only in
  the running app's in-memory state — it's not written into the part document and not kept in
  the app's persisted store. It resets whenever the app remounts, so reopening a part always
  starts with no configuration flagged active, even if one was active when you last touched the
  file.

<!-- SCREENSHOT: Parameters panel (F7) showing Name/Value/Unit/Expression columns — TODO follow-up -->
<!-- SCREENSHOT: Configurations dialog (Model ▸ Configurations…) with several rows and one active/highlighted — TODO follow-up -->

## See also

- [Documents and kinds](./documents-and-kinds.md)
- [Dimensions](../modeling/dimensions.md)
- [Sketching](../modeling/sketching.md)

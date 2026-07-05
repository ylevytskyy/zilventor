---
title: Templates
---
# Templates
> Saves the active sheet's layout as a reusable template, and adds new sheets built from a
> saved template instead of a blank one.

**Where:** Drawing ▸ Templates ▸ **Save as Template…** / **New from Template…** ·
**Shortcut:** — · **Applies to:** drawing

## What it does

`Save as Template…` captures the current sheet's layout — views, title block placement, and
so on — as a reusable `.zitpl` template file, stored locally in the browser (OPFS). `New from
Template…` lets you pick one of those saved templates and adds a new sheet built from it,
instead of starting from a blank [sheet](./sheets.md).

## Before you start

- **Save as Template…** needs the sheet you want to save as the active sheet.
- **New from Template…** needs at least one template already saved — if you haven't saved one
  yet, the dialog's list will be empty.

## Steps

### Save as Template…

1. Make the sheet you want to save the active sheet.
2. Click **Save as Template…** in the Drawing ▸ Templates panel.
3. Enter a name for the template in the prompt.

*Result: the sheet's layout is saved as a `.zitpl` template file in local browser storage,
available for reuse in this and future drawings.*

### New from Template…

1. Click **New from Template…** in the Drawing ▸ Templates panel.
2. In the dialog that opens, pick the saved template you want from the list.

*Result: a new sheet is added to the drawing, built from the saved template's layout.*

## Options

| Field | Meaning |
|---|---|
| Template name (Save as Template… prompt) | The name the `.zitpl` file is saved under; how you'll find it later in the New from Template… list. |
| Template (New from Template… dialog) | Which saved `.zitpl` layout to build the new sheet from. |

## Tips & gotchas

- Templates are stored **locally in the browser** (OPFS) — they aren't exported to disk
  automatically and won't follow you to a different browser or machine unless you export the
  drawing itself.
- `New from Template…` is a faster starting point than [New Sheet](./sheets.md) when you're
  producing several drawings that share the same sheet layout — save the layout once, then
  reuse it per drawing.

## See also

- [Drawings](./index.md)
- [Sheets](./sheets.md)

<!-- SCREENSHOT: the Save as Template… name prompt, and the New from Template… dialog listing saved .zitpl templates — TODO follow-up -->

---
title: Convert to Panel
---
# Convert to Panel
> Turn a read-only imported STEP body into a fully parametric `PanelFeature`, in place, once
> you're ready to treat it as editable stock instead of a frozen shape.

**Where:** Browser tree ▸ right-click a leaf part ▸ type `convert` in the prompt · **Shortcut:**
— · **Applies to:** part (placed as a component in an assembly)

## What it does

An [imported STEP part](./step-files.md) is read-only: its geometry is a single opaque
`kind: 'imported'` feature. Convert to Panel replaces that feature, in place, with a real
`PanelFeature` sized from the imported body's bounding box — the smallest of the three bbox
extents becomes thickness, and the other two become length (larger) and width (smaller). Once
converted, the part behaves exactly like a panel you created from scratch: editable dimensions,
material, grain, edge bands, and it's a valid target for [Присадка](../drilling-prisadka/index.md)
bores.

This is a **replace**, not an augment — the kernel's feature tree requires `kind: 'panel'` as
the first user feature, and there's no geometry to carry over from the imported shape into the
panel executor. The conversion is a manifest-only rewrite of the part's `.zipt`, so undo is
byte-exact: it restores the original file bytes, not just an approximation of the prior state.

## Before you start

- The target must be a **single-solid** imported STEP part placed as a component leaf in an
  assembly's browser tree (not a sub-assembly row).
- The part needs cached bounding-box geometry — parts whose geometry cache is missing can't be
  converted (see Tips below).

## Steps

1. In an assembly, right-click the imported leaf part in the browser tree. This reuses the
   part's normal right-click prompt (the same one used for color overrides) — there is no
   dedicated "Convert to Panel" menu item.
2. Type `convert` into the prompt (case-insensitive) instead of a hex color, and confirm.
3. The **Panel** dialog opens, pre-filled with dimensions derived from the imported body's
   bounding box.
4. Adjust Length, Width, Thickness, Material, Grain, or Edge Bands as needed — see
   [Panels](../furniture/panels.md) for the full field reference.
5. Click **OK/Create** to confirm the dialog.
6. *Result: the part's imported feature is replaced by the new `PanelFeature`; the browser tree
   now shows a normal Panel node instead of an `Imported (...)` row. Undo restores the original
   imported part exactly.*

## Options

| Field | Meaning |
|---|---|
| Length / Width / Thickness | Pre-filled from the imported body's bounding box (thickness = smallest extent); editable before confirming |
| Material | Defaults to the first material in the active assembly's registry |
| Grain / Edge Bands | Default to `none` / no bands — the conversion has no way to infer these from bbox geometry alone |

## Tips & gotchas

- **v1 limitation: no 3D position correction.** The converted panel recenters to its local
  origin — this is cosmetic (the panel's own geometry is correct), but if the imported part was
  positioned off-origin within its own body space, expect a visible jump. Reposition the
  component afterward if needed.
- If the part has no imported feature at all (e.g. you already converted it, or it's a native
  panel), the prompt shows *"This part has no imported geometry to convert."* and nothing
  happens.
- If the imported part has no cached bounding-box geometry, the prompt shows *"Can't derive
  panel dimensions: the imported part has no cached geometry."* — reopen the part once (which
  rebuilds the cache) and try again.
- The trigger is intentionally a plain browser prompt, not a ribbon button — it's an unusual UI
  pattern in zilventor, easy to miss if you're looking for a menu item instead.
- Conversion only works on **single-solid** imports. For a multi-body STEP import, run
  [Explode into Assembly](./step-files.md#split-a-multi-body-import-into-an-assembly) first,
  then convert individual resulting bodies.

<!-- SCREENSHOT: right-click prompt with "convert" typed in, followed by the pre-filled Panel dialog — TODO follow-up -->

## See also

- [Import & Migration overview](./index.md)
- [STEP Files](./step-files.md)
- [Panels](../furniture/panels.md)
- [The Browser Tree](../concepts/the-browser-tree.md)

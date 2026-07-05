---
title: Materials
---
# Materials

> A material is a named record — thickness, color, sheet stock size, edge-band tape thickness,
> and section-hatch style — that a panel is assigned to; reach for it whenever you need to
> change what a panel is made of or how it's cut, banded, or drawn.

**Where:** any material picker's **Manage…** button (e.g. Panel dialog ▸ Material dropdown ▸
Manage…) · **Shortcut:** — · **Applies to:** part, assembly

## What it does

A **material** is not a texture or a swatch — it's the record that drives several otherwise
unrelated parts of the pipeline: how thick a panel is by default, how big the raw sheet stock
is for nesting, how much edge-band tape allowance to add, and what hatch pattern a section view
draws for it. Every part and assembly document carries its own material list; there is no single
global registry shared across every open document, though in practice most panels in one project
share the same assembly's material list.

## Fields

| Field | Drives |
|---|---|
| `name` | Label shown in material pickers and the cut list |
| `defaultThickness` (mm) | The panel's material thickness when this material is assigned |
| `color` | Hex swatch shown in the 3D viewport when no custom texture is set |
| `sheetLengthMm` / `sheetWidthMm` | Raw sheet-stock size the nesting/sheet-layout tool packs panels onto (both present or both absent) |
| `hatchAngleDeg` (default 45°) / `hatchSpacingMm` (default 3 mm) | Section-view hatch pattern drawn for panels of this material |
| `bandThicknessMm` (default 0.4 mm) | Edge-banding tape thickness, used for edge-band allowance |
| `textureId` (optional) | References an uploaded custom texture record (see below) |
| `kind` (`sheet` default, or `linear`) | `linear` materials (edge-banding roll stock, moldings) are excluded from the sheet-panel BOM and instead roll into a linear cut-length breakdown |

## How materials drive downstream tools

- **Panel thickness** — assigning a material to a panel sets its thickness to that material's
  `defaultThickness`.
- **Edge-banding** — a material's `bandThicknessMm` is the tape thickness used when computing
  edge-band gross sizes for that panel.
- **Nesting sheet size** — the nesting/sheet-layout tool packs panels of a given material onto
  sheets sized `sheetLengthMm` × `sheetWidthMm`; a material with no sheet size set can't be
  nested.
- **Section hatching** — drawings hatch a material's cross-sections at `hatchAngleDeg` /
  `hatchSpacingMm` (falling back to 45° / 3 mm when unset).

## Grain direction is per-panel, not per-material

Grain direction is **not** a material field — it's a per-panel setting. Each panel's dialog has
a **Grain** radio group with three options, **Length**, **Width**, and **None**, independent of
which material the panel uses. Two panels cut from the same material can have different grain
settings.

Grain matters at nesting time: a panel with grain locked to Length or Width can only be placed
on the sheet in the orientation that keeps the grain running that way — nesting will not rotate
it to make it fit, even if rotating it would let it fit. When that happens the panel is excluded
from the nest with the reason **grain-locked-exceeds-sheet** rather than being silently rotated.

## Custom textures

A material can reference an uploaded custom texture via its `textureId`, but the texture itself
is not a field on the material — it's a separately managed record (name, physical width/height
in mm, and albedo/normal/roughness image references) created and edited through the same
Material Registry editor. Click **Upload custom texture…** in the editor to create or manage
texture records, then pick one from the **Texture** column dropdown on the material row that
should use it.

## Opening the registry

The Material Registry editor doesn't have its own ribbon entry — it opens from wherever a
material is picked. In a panel dialog's Material dropdown, click the **Manage…** button next to
it; this opens the registry editor inline, showing every material in the current document (part
or assembly) as an editable table row, plus an **+ Add** control for new materials (new entries
default to 18 mm thickness and color `#cccccc`).

<!-- SCREENSHOT: the Material Registry editor open inline below a panel dialog's Material dropdown, showing the table of materials and the Upload custom texture… panel — TODO follow-up -->

## See also

- [Panels](../furniture/panels.md)
- [Cut List](../furniture/cut-list.md)
- [Nesting](../manufacturing/nesting.md)
- [Drawings](../drawings/index.md)

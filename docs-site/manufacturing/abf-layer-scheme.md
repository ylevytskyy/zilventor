---
title: ABF Layer Scheme
---
# ABF Layer Scheme
> An alternate layer-naming scheme for Manufacturing DXF that matches the layer grammar of the third-party ABF cutting-service plugin, for shops built around that workflow.

**Where:** Furniture ▸ Присадка ▸ **Export DXF (Manufacturing)** ▸ Layer Scheme: **ABF** · **Shortcut:** — · **Applies to:** Manufacturing DXF export

## What it does

"ABF" is a brand name, not an acronym — it refers to a specific third-party
cutting-service plugin whose DXF layer names follow a known convention. When
**Layer Scheme** is set to **ABF** (see [Manufacturing DXF](./manufacturing-dxf.md)),
zilventor names each feature's DXF layer to match that convention instead of
its own native names:

| Feature | ABF layer name | Example |
|---|---|---|
| Panel outline | `ABF_cuttingLines` | `ABF_cuttingLines` |
| Face bore (Top/Bottom), preset has a SKU | `DEPTH<depth>-ARTICLE<sku>` | `DEPTH15-ARTICLE$12345` |
| Face bore (Top/Bottom), preset has no SKU | `DEPTH<depth>` | `DEPTH15` |
| Edge bore (Front/Back/Left/Right) | `ABF-DSIDE-<diameter>` | `ABF-DSIDE-5` |

The SKU used for a face bore's `ARTICLE` suffix comes from the
[machining preset](../drilling-prisadka/machining-presets.md) applied to that
bore. Edge bores never get an article suffix — the SKU is ignored for them.

## Before you start

- Export DXF (Manufacturing) must be reachable (an assembly with generated
  bores/grooves is active) — see [Manufacturing DXF](./manufacturing-dxf.md).
- If you want `ARTICLE` suffixes on face bores, the relevant
  [machining preset](../drilling-prisadka/machining-presets.md) needs a SKU set.

## Steps

1. In the Furniture tab, Присадка panel, set **Layer Scheme** to **ABF**.
2. Set **DXF Export Mode** as usual (Folders per material / Single combined
   file).
3. Click **Export DXF (Manufacturing)**.

*Result: the exported DXF(s) use ABF-style layer names instead of zilventor's
native ones, for every feature that has an ABF mapping.*

## Options

| Field | Meaning |
|---|---|
| Layer Scheme — ABF | Switches Manufacturing DXF's layer naming to the ABF convention shown above. |
| Layer Scheme — Native | zilventor's own layer names — see [Manufacturing DXF](./manufacturing-dxf.md). |

## Cyrillic SKUs

A preset's SKU can contain Cyrillic characters (Ukrainian or Russian). Before
it's used in a face-bore `ARTICLE` layer name, it's sanitized: Cyrillic
letters are transliterated to Latin (a romanization table, preserving the
case of the first transliterated letter), then any character outside
`[A-Za-z0-9_$-]` is replaced with `_`, repeated underscores collapse to one,
and leading/trailing underscores are trimmed. `$` is deliberately allowed
because real ABF SKUs are `$`-prefixed. The exact transliterated form of a
given Cyrillic SKU depends on that romanization table — check the exported
layer name directly if you need to know it precisely.

## Tips & gotchas

- **A `throughAll` (through-all-depth) bore never gets an ABF layer name.**
  There's no "through" convention in this scheme, so a through bore silently
  falls back to its Native layer name even while the rest of the export uses
  ABF names. If you're grepping a DXF for ABF-style layers and a bore is
  missing, check whether it's a through bore.
- **This is a subset of the full ABF grammar**, not a complete
  reimplementation. Real third-party ABF export files also use layer
  families like `D<n>-DEPTHF-$<sku>` and an `ABF_Label` layer that
  zilventor's exporter does not produce — those belong to the read-only
  import side (see [ABF Flatten Import](../import-migration/abf-flatten-import.md)),
  not to this exporter.
- Switching Layer Scheme doesn't change which panels are exported or how
  they're deduplicated — only how each feature's layer is labeled. See
  [Manufacturing DXF](./manufacturing-dxf.md) for that mechanism.
- A [machining preset's](../drilling-prisadka/machining-presets.md) explicit
  target layer name always overrides the ABF scheme for that feature, same as
  it overrides the Native scheme.

## See also

- [Manufacturing DXF](./manufacturing-dxf.md)
- [ABF Flatten Import](../import-migration/abf-flatten-import.md)
- [Machining Presets](../drilling-prisadka/machining-presets.md)

<!-- SCREENSHOT: Layer Scheme toggle set to ABF next to DXF Export Mode — TODO follow-up -->
<!-- SCREENSHOT: exported DXF opened in a CAD viewer showing ABF_cuttingLines, DEPTH15-ARTICLE$12345, and ABF-DSIDE-5 layers — TODO follow-up -->

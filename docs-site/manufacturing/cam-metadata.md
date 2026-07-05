---
title: CAM Metadata
---
# CAM Metadata
> Tool number and spindle speed, snapshotted from a machining preset onto a bore or groove, embedded in the Manufacturing DXF as recoverable metadata for a CNC operator.

**Where:** Furniture ▸ Присадка ▸ **Export DXF (Manufacturing)** (metadata is automatic, not a separate toggle) · **Shortcut:** — · **Applies to:** bores/grooves created or edited from a machining preset

## What it does

CAM metadata isn't a setting you turn on — it's a byproduct of using
[machining presets](../drilling-prisadka/machining-presets.md). When a preset
that has a **Tool number** and/or **Speed** value is applied to a bore or
groove, those two values are snapshotted onto that feature, per
[ADR 0001](../../docs/adr/0001-machining-presets-global-with-snapshot.md) —
editing or deleting the preset afterward never changes a feature it was
already applied to.

Whenever such a feature is included in a
[Manufacturing DXF](./manufacturing-dxf.md) export, its tool number and speed
are written into the DXF as XDATA under a registered application ID
`ZILVENTOR`: group code `1000` (`TOOL_NUMBER`) followed by `1070` (integer)
for the tool number, and/or group code `1000` (`SPEED`) followed by `1040`
(float) for the spindle speed. A bore with neither value set emits no XDATA
at all — its DXF entity is byte-identical to a bore with no CAM metadata.
In **Single combined file** export mode, the same tool number and speed also
appear as `toolNumber`/`speed` columns in the `machining.csv` sidecar file.

**There is no feed-rate field anywhere in this pipeline.** Only tool number
and spindle speed exist.

This metadata is advisory: zilventor does not drive a CNC directly, and
native CAM formats (CIX, MPR, XNC) are not implemented. The Manufacturing DXF
(and its `machining.csv` sidecar) is the only shipped output that a CNC
operator or cutting service can read tool/speed hints from.

## Before you start

- The bore or groove must have been created or edited using a
  [machining preset](../drilling-prisadka/machining-presets.md) that has a
  Tool number and/or Speed set.
- You export via [Manufacturing DXF](./manufacturing-dxf.md) — there's no
  separate export path for CAM metadata alone.

## Steps

1. In **Machining Presets**, set **Tool number** and/or **Speed** on the
   preset(s) your bores/grooves use — see
   [Machining Presets](../drilling-prisadka/machining-presets.md).
2. Apply the preset to the bores/grooves that need it.
3. Run [Export DXF (Manufacturing)](./manufacturing-dxf.md) as usual — no
   extra toggle is needed for the metadata to be included.
4. If you used **Single combined file** mode and at least one exported
   feature carries CAM metadata, also collect the `machining.csv` sidecar
   written alongside the DXF.

*Result: any exported bore/groove that has a tool number or speed carries it
as `ZILVENTOR`-APPID XDATA in the DXF, and, in combined mode, as a row in
`machining.csv`.*

## Options

| Field | Meaning |
|---|---|
| Tool number (on the preset) | Integer CNC tool number, written as DXF XDATA group code `1070` under key `TOOL_NUMBER`, and as the `toolNumber` column in `machining.csv`. |
| Speed (on the preset) | Spindle speed in RPM, written as DXF XDATA group code `1040` under key `SPEED`, and as the `speed` column in `machining.csv`. |

## Tips & gotchas

- **Not every export carries this.** The plain
  [Export CSV (Boring) / Export DXF (Boring)](../drilling-prisadka/exporting-boring-data.md)
  reports never include tool number, speed, or any XDATA — the boring DXF's
  layers are always the size-derived `D<dia>_<depth>` name, and the boring
  CSV has no tool/speed columns at all. Only
  [Manufacturing DXF](./manufacturing-dxf.md) (and its `machining.csv`
  sidecar) carries CAM metadata; see
  [Known Limitations](../troubleshooting/known-limitations.md) and
  [Exporting Boring Data](../drilling-prisadka/exporting-boring-data.md) for
  the full contrast.
- **This is advisory metadata, not CNC control.** zilventor never drives a
  machine directly, and there's no CIX/MPR/XNC export — the DXF's XDATA is
  meant to be read by whatever CAM software or operator processes the file.
- Because tool/speed are snapshotted at apply-time, two bores that used the
  same preset can end up with different metadata if the preset was edited
  between applying them — check the bore, not the preset, if a number looks
  wrong.
- A bore with no tool number and no speed produces no XDATA block for that
  bore — this is expected, not a bug; don't expect an empty/zero XDATA entry.

## See also

- [Manufacturing DXF](./manufacturing-dxf.md)
- [Machining Presets](../drilling-prisadka/machining-presets.md)
- [Exporting Boring Data](../drilling-prisadka/exporting-boring-data.md)
- [Known Limitations](../troubleshooting/known-limitations.md)
- ADR: [0001 — Machining presets global with snapshot](../../docs/adr/0001-machining-presets-global-with-snapshot.md)

<!-- SCREENSHOT: Machining Presets dialog with Tool number and Speed fields filled in — TODO follow-up -->
<!-- SCREENSHOT: exported machining.csv opened in a spreadsheet showing toolNumber/speed columns — TODO follow-up -->

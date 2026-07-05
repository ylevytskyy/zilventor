---
title: Machining Presets
---
# Machining Presets
> Named, reusable tool/depth/layer settings for a boring or groove operation type — saved app-wide, not per document.

**Where:** Furniture ▸ Присадка ▸ **Machining Presets** · **Shortcut:** — · **Applies to:** app-global settings, applied to bores/grooves in a part or assembly

## What it does

A machining preset bundles the settings a specific CNC operation type always needs:
tool diameter, cut depth, an optional edge offset, a target DXF layer name, and
optional CAM metadata (tool number, spindle speed). You create presets once — for
"6mm dowel face bore", "system-32 shelf pin", "hinge cup", and so on — and reuse them
every time that operation type comes up, instead of retyping the same numbers.

**Presets describe your shop's tooling, not any one model**, so they are stored
**app-global** and are visible in every document you open, not just the one you were
editing when you created them. Applying a preset **copies (snapshots) its current
values** onto the bore or groove you applied it to. After that, the bore/groove and
the preset are independent — editing or deleting the preset later never changes
anything you already applied it to. This is deliberate (see
ADR 0001): a
production file that already went to the CNC must not silently drift because someone
retuned a preset for a different job afterwards. If you need a bore's tool/depth to
change, edit that bore directly.

## Before you start

- Nothing — the dialog is always reachable and works with zero presets.
- It's most useful right before generating or editing bores: create the presets
  first, then they show up as an **Apply** option wherever a matching bore/groove
  exists (see below).

## Steps

### Create a preset

1. In the Furniture tab, Присадка panel, click **Machining Presets**.
2. Fill in the fields (see Options below) and click **Add**.
3. Click **Close** when done, or keep adding more.

### Edit or delete a preset

1. Open **Machining Presets**.
2. Next to the preset, click **Edit** to load it into the form, change fields, and
   click **Save** — or click **Delete** to remove it.
3. Editing/deleting only affects future applications of the preset; anything already
   applied keeps its snapshotted values.

### Apply a preset to a bore

1. Select a bore in the 3D viewport so its properties panel opens (see
   [Editing and Clearing Bores](./editing-and-clearing-bores.md)).
2. If a saved preset's **Operation type** matches that bore's role, a **Machining
   preset** dropdown appears in the panel — pick it and click **Apply**.
3. The bore's diameter, depth, layer, tool number, and speed are overwritten with the
   preset's current values at that moment; the two are not linked afterwards.

Some creation dialogs (for example [Leg Levelers](./leg-levelers.md)) also offer a
**Machining preset** picker so every bore they create starts pre-filled from a preset.

### Import / export presets

1. Open **Machining Presets**.
2. Click **Export** to save your whole preset list as a `machining-presets.json`
   file — useful for sharing a shop's tooling setup or backing it up.
3. Click **Import** to load a JSON file of presets; entries are validated before
   being merged into your app-global list.

*Result: presets you create/import are available from any document you open on this
machine, and stay listed until you delete them.*

## Options

| Field | Meaning |
|---|---|
| Name | Label shown in preset pickers, e.g. "6mm shelf pin". |
| Operation type | Which kind of bore/groove this preset applies to (e.g. `shelfPin-system32`, `hingeCup`, `hingePlate`, `drawerSlide-cabinet`, `handleScrew-face`, `legLeveler`, `tandem-cabinet`, `groove`, etc.). Only bores/grooves whose role matches this value will offer the preset. |
| Diameter | Tool/bore diameter in mm. |
| Depth | Cut depth in mm. |
| Offset | Optional edge offset in mm, if this operation type uses one. |
| Target layer name | DXF layer this operation's geometry is drawn on when the preset is applied — overrides the app's default layer-naming scheme for that bore/groove. |
| Tool number | Optional CAM tool number, recoverable later from the exported manufacturing DXF (see below). |
| Speed | Optional spindle speed (RPM), recoverable the same way. |

## Tips & gotchas

- **The snapshot is the whole point.** If you need a batch of already-drilled bores
  to pick up a new tool number, you must re-apply the preset to each of them (or edit
  them directly) — there is no bulk re-apply, and that's intentional so old jobs
  can't drift.
- Tool number and speed are the CAM metadata that flows into the **manufacturing**
  DXF export as recoverable XDATA and into the machining CSV — see
  [Exporting Boring Data](./exporting-boring-data.md) for exactly which export
  carries this metadata (the quick boring exports do **not**; the full manufacturing
  DXF does).
- A preset only shows up as applicable where its **Operation type** exactly matches
  the target bore's role — there's no "closest match" fallback.

## See also

- [Editing and Clearing Bores](./editing-and-clearing-bores.md)
- [Exporting Boring Data](./exporting-boring-data.md)
- [Leg Levelers](./leg-levelers.md)
- ADR: `docs/adr/0001-machining-presets-global-with-snapshot.md`

<!-- SCREENSHOT: Machining Presets dialog with a filled preset form + existing preset list — TODO follow-up -->
<!-- SCREENSHOT: Bore properties panel showing the Machining preset dropdown + Apply button — TODO follow-up -->

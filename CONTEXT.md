# CONTEXT.md — glossary

Project-specific terms with one canonical meaning. Keep definitions tight; no implementation detail.

- **Machining preset** — a named, app-global bundle of parameters for one machining operation type (diameter, depth, offset, target DXF layer name, tool number, spindle speed). Applying a preset snapshots its values into the document; later preset edits never alter existing documents. _Avoid:_ "hardware template", "SKU" (a SKU is a catalog item, not a parameter bundle).
- **CAM metadata** — the `toolNumber` and `speed` fields on a machining operation that map a DXF layer to a physical CNC tool slot. Advisory data for downstream CAM software; ZilInventor does not drive a CNC.
- **Pre-flight check** — the named, reusable validity gate a panel must pass before boring/nesting/export: exactly one closed manifold solid, has a name, has a material. Fails loud with a named reason, never silently skips.
- **Grain direction** — a per-panel manufacturing attribute (long-grain axis), independent of visual texture/UV. Follows the panel through nesting rotation/flip into nest DXF and labels.
- **Linear material** — stock sold and cut by length (closet rods, profiles), reported as individual cut pieces (e.g. "3 rods: 1×958, 2×466 mm"), not a summed running length.
- **Statistics report** — the five-category production report: hardware/fittings, joints/connectors, edge-band tape, linear-material cut lengths, panel/sheet data; each line priceable, rolling up to a quote total. (ABF's "Thống Kê".)
- **Remnant** — the labeled leftover of a sheet after the last cut of a nest. We record and label it on the sheet output; there is no persistent remnant-stock inventory.
- **Nest override** — a manual move/rotate/flip of one placed part after automatic nesting. Overrides are validated (no overlap, in-bounds) but not re-optimized, and may void the guillotine-cut property (flagged, not forbidden).
- **Production reconciliation** — the in-app workflow that consumes panel-label QR codes: scan or enter a code, mark the physical panel produced/packed, track progress against the job, and emit a packing slip. (ABF ships this as separate hosted web apps; ours is in-app.)

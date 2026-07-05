---
title: Manufacturing
---
# Manufacturing
An overview of the Manufacturing section: what it covers and where to start.

Once a cabinet or assembly is modeled and its bores/grooves are generated, the
Manufacturing section carries it the rest of the way to a physical piece of
furniture. The pipeline runs roughly in this order:

1. **Cut list** — the assembly's panels, sizes, and materials are aggregated
   (see [Cut List](../furniture/cut-list.md)).
2. **Nest** — panels are packed onto sheet stock, one layout per material, so
   you know how many sheets to buy and how to cut them
   ([Nesting](./nesting.md)), with an option to nudge a placement afterwards
   ([Editing the Nest](./editing-the-nest.md)).
3. **Manufacturing outputs** — the shop-facing files that actually leave the
   app: a per-panel CNC-ready DXF ([Manufacturing DXF](./manufacturing-dxf.md)),
   optionally in a third-party-compatible layer naming
   ([ABF Layer Scheme](./abf-layer-scheme.md)) and carrying recoverable
   tool/speed metadata ([CAM Metadata](./cam-metadata.md)); printable shop
   labels with QR codes ([Labels and QR](./labels-and-qr.md)); a materials/
   hardware cost breakdown ([Cost Report](./cost-report.md)); and a packing
   slip for the finished order ([Packing Slip](./packing-slip.md)).
4. **Cutting** — the DXF (and, for CAM-aware shops, the embedded tool/speed
   metadata) goes to a cutting service or CNC operator, who returns cut panels.
5. **Production reconciliation** — as panels come back, their QR codes are
   scanned to check the physical pile against the cut list
   ([Production Reconciliation](./production-reconciliation.md)).

## Pages in this section

- [Manufacturing DXF](./manufacturing-dxf.md) — per-panel, deduplicated DXF
  export for cutting/CNC.
- [Nesting](./nesting.md) — pack the cut list onto sheets.
- [Editing the Nest](./editing-the-nest.md) — adjust a packed layout by hand.
- [Labels and QR](./labels-and-qr.md) — printable per-panel shop labels.
- [ABF Layer Scheme](./abf-layer-scheme.md) — third-party-plugin-compatible
  layer naming for Manufacturing DXF.
- [CAM Metadata](./cam-metadata.md) — tool number/spindle speed embedded in
  Manufacturing DXF.
- [Cost Report](./cost-report.md) — materials/hardware cost breakdown.
- [Packing Slip](./packing-slip.md) — printable order summary.
- [Production Reconciliation](./production-reconciliation.md) — scan-back
  against the cut list.

---
title: Interference Check
---
# Interference Check

> Scans an open assembly for parts that overlap or crowd each other, so you can catch a door
> that clips a shelf or two cabinets pushed together before you cut anything.

**Where:** Inspect tab ▸ Interference Check · **Shortcut:** — · **Applies to:** assembly

## What it does

Interference Check walks every component in the active assembly — including anything nested
inside sub-assemblies — and computes clashes between pairs of parts at a clearance distance you
choose. A true overlap is reported as an **Interference**; two parts closer together than the
clearance threshold but not actually overlapping are reported as a **Clearance** violation. The
check automatically hides the overlaps you'd expect to see inside any well-built cabinet (a
side panel touching the back, a shelf sitting in its dado) so the results list stays focused on
clashes that actually indicate a design problem.

**Interference Check lives on its own Inspect ribbon tab, not on the Assembly tab** — if you're
looking for it among Place/Constrain/Pattern/BOM, it isn't there.

## Before you start

- Have an assembly open — the **Interference Check** button in the Inspect tab is disabled
  until an assembly is active.
- The geometry kernel must be ready; the button is also disabled while it's still loading.
- No selection is required — the check always scans the whole assembly.

## Steps

1. Switch to the **Inspect** ribbon tab.
2. Click **Interference Check**. An inline panel titled "Interference Check" opens directly in
   the tab — it isn't a floating dialog.
3. Set **Minimum clearance (mm)** — defaults to `1.0`, minimum `0`, in `0.1` mm steps. Anything
   closer than this counts as a clearance violation even if the parts don't overlap.
4. Click **Run**. While the check is running, the button label shows `…`. Click **Cancel**
   instead to dismiss the panel without running.

*Result: a **Clash Results** table appears below the panel, listing every clash found; any
previously highlighted parts in the viewport are cleared before the new results appear.*

## Options

| Field | Meaning |
|---|---|
| Minimum clearance (mm) | Distance threshold for reporting a near-miss as a Clearance violation. Actual overlaps are always reported as Interference regardless of this value. Default 1.0 mm. |
| Run | Starts the scan across the whole assembly, including nested sub-assemblies. |
| Cancel | Closes the panel without running a check. |

## Tips & gotchas

- **Clash Results columns**: Interference/Clearance (colored red for Interference, orange for
  Clearance), Part A, Part B, and Volume (mm³) / Gap (mm) — Interference rows show the
  overlapping volume, Clearance rows show the gap distance, and either shows `—` when the value
  isn't available.
- **Click a result row** to select both parts in the browser tree and highlight them in the 3D
  viewport — the fastest way to find a clash without hunting through the tree yourself.
- **Structural carcass overlaps are suppressed automatically**, and a disclaimer under the
  results always says so: "Structural carcass-panel overlaps within a cabinet are expected and
  hidden; door/drawer and cross-cabinet clashes are shown." A pair is hidden this way only if
  *all three* hold: both parts carry a structural carcass role (side panels, top, bottom, back,
  toekick, hanging rail, corner post, shelf, or blind filler — see
  [Cabinets](../furniture/cabinets.md) for where these roles come from), both are nested at
  least one level inside a sub-assembly, and they share the same immediate parent (the same
  cabinet). A door, drawer, or hardware clash — or any clash between two different cabinets —
  is always shown, never suppressed.
- Before you've ever run the check, the panel shows "Run Interference Check to see results."
  Running it and finding nothing shows "No interferences found." plus the same carcass
  disclaimer — that's a clean assembly, not a broken check.
- Re-running the check clears the previous 3D highlight first, so stale highlights from an
  earlier run never linger after you click Run again.

## See also

- [Assemblies](./index.md)
- [Cabinets](../furniture/cabinets.md) — where carcass roles (side panels, toekick, hanging
  rail, etc.) come from

<!-- SCREENSHOT: the Interference Check panel open in the Inspect tab, showing the Minimum clearance (mm) input and Run/Cancel buttons — TODO follow-up -->
<!-- SCREENSHOT: the Clash Results table with a couple of rows (one Interference, one Clearance) and the carcass-noise disclaimer visible — TODO follow-up -->

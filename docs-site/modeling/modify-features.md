---
title: Modify Features
---
# Modify Features
> Rounds, bevels, hollows, and pierces an existing solid body with Fillet, Chamfer, Shell, and Hole.

**Where:** Model ▸ Modify · **Shortcut:** Fillet **F** · Chamfer **K** · Shell **S** · Hole **H** · **Applies to:** part

## What it does

The Modify panel holds the four tools that reshape a solid body that already exists, rather
than creating one from a sketch: **Fillet** rounds edges, **Chamfer** bevels edges, **Shell**
hollows the body out into a shell of constant wall thickness, and **Hole** cuts a hole (simple,
counterbored, or countersunk) through or into the body.

All four open a dialog docked at the top-right of the screen with the 3D viewport still
interactive underneath. Where a dialog has a **Pick** or **Add** button, click it first to
arm a viewport pick-mode, then click the edge/face/loop in the 3D view — the dialog's
selection list updates live while the dialog stays open.

## Before you start

- The part needs an existing solid body — none of the four tools has anything to act on
  otherwise.
- Every button here is disabled with tooltip *"This part was imported from Inventor and is
  read-only. Re-author parametrically by creating a new part."* when the active part was
  imported (e.g. from STEP).

## Steps

### Fillet

1. Click **Fillet (F)** or press **F**.
2. Choose **Mode**: **Constant** or **Variable**.
3. Choose a selection mode (**Edge / Loop / Feature / All Fillets / All Rounds**) and pick
   edges in the viewport to add them to the **Edges** tab.
4. Set **Radius** (Constant mode), or switch to the **Variable** tab to set per-edge **Start
   radius**/**End radius** (Variable mode only).
5. If a vertex has exactly three filleted edges meeting at it, set its value on the
   **Setbacks** tab if needed.
6. Click **Apply** to preview, then **OK**.

*Result: the picked edges are rounded, and a Fillet feature is added to the part's feature
tree.*

### Chamfer

1. Click **Chamfer (K)** or press **K**.
2. Choose a selection mode (**Edge / Loop / Feature**) and pick edges in the viewport.
3. Set **Distance**.
4. Click **Apply** to preview, then **OK**.

*Result: the picked edges are beveled at an equal distance, and a Chamfer feature is added to
the part's feature tree.*

### Shell

1. Click **Shell (S)** or press **S**.
2. The dialog opens pre-populated with a checkbox for every face on the body; check the faces
   you want removed (opened), or click **Pick** to add a face by clicking it in the viewport.
3. Set **Thickness**.
4. Click **OK**.

*Result: the body is hollowed into a constant-thickness shell, open at the checked faces, and
a Shell feature is added to the part's feature tree.*

### Hole

1. Click **Hole (H)** or press **H**.
2. Choose **Placement**: **From Sketch**, **Linear**, or **Concentric**, and pick the
   sketch/face/edges it asks for.
3. Choose **Profile**: **Simple**, **Counterbore**, or **Countersink**, and set the diameter
   fields it shows.
4. Choose **Termination** and set its **Depth** or **Pick target face** as needed.
5. Click **OK**.

*Result: the hole is cut into the body, and a Hole feature is added to the part's feature
tree.*

## Options

### Fillet

| Field | Meaning | Default |
|---|---|---|
| Radius | Fillet radius (Edges tab); accepts expressions | `1` |
| Start radius / End radius | Per-edge pair, Variable tab only, when mode = Variable | — |
| Setbacks | Per-edge setback values, only shown for vertices where exactly 3 filleted edges meet | — |

### Chamfer

| Field | Meaning | Default |
|---|---|---|
| Distance | Single equal chamfer distance; accepts expressions | `1` |

### Shell

| Field | Meaning | Default |
|---|---|---|
| Faces to remove | Checkbox list of all current body faces (pre-populated), plus a Pick button to add a face by clicking it in the viewport | none checked |
| Thickness | Wall thickness — negative hollows inward (cup), positive grows outward | `-1` |

### Hole

| Field | Meaning | Default |
|---|---|---|
| Placement | **From Sketch / Linear / Concentric** — determines which pick buttons appear | — |
| Diameter | Hole diameter (all profiles) | `5` |
| CBORE diameter / CBORE depth | Counterbore profile only | `10` / `3` |
| CSK diameter / CSK angle | Countersink profile only | `10` / `82` |
| Termination | **Distance / Through All / To Face / To Next** | Through All |
| Depth | Shown when Termination = Distance | `10` |

## Tips & gotchas

- **Fillet's** selection-mode toggle includes **All Fillets** and **All Rounds**, which
  **Chamfer** does not offer — Chamfer only has Edge / Loop / Feature.
- **Chamfer is equal-distance only.** There is no angle field and no two-distance mode.
- **Shell's** dialog is the only one of the four whose selection list is pre-populated (with
  every body face, unchecked) rather than starting empty — Fillet, Chamfer, and Hole all start
  with nothing selected until you pick.
- Shell and Hole have no **Apply** button (Cancel/OK only); Fillet and Chamfer do.
- **The View tab's "Fit (F)" button is currently non-functional** — it has no click handler
  wired up at all, so it never fits the view. The **F** key you might expect to fit the view
  instead opens the **Fillet** dialog. If a view fit doesn't happen when you press F, that's
  why — use the viewport's other framing controls instead.

<!-- SCREENSHOT: Fillet dialog with Constant mode and an edge selection, and the resulting rounded edges — TODO follow-up -->
<!-- SCREENSHOT: Chamfer dialog with an edge selection, and the resulting beveled edges — TODO follow-up -->
<!-- SCREENSHOT: Shell dialog with faces checked and Thickness set, and the resulting hollowed body — TODO follow-up -->
<!-- SCREENSHOT: Hole dialog for a Counterbore profile with Linear placement, and the resulting hole — TODO follow-up -->

## See also

- [Extrude, Revolve & Sweep](./extrude-revolve-sweep.md)
- [Work Features](./work-features.md)
- [Patterns and Mirror](./patterns-and-mirror.md)

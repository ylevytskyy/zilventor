---
title: Keyboard Shortcuts
---
# Keyboard Shortcuts
> Every keyboard shortcut the app recognizes, grouped by the mode it applies in — plus two shortcuts documented here as broken so you don't waste time on them.

All shortcuts are case-insensitive and are ignored while a text input or textarea has focus (so typing a value into a dialog field never triggers a tool). Which table applies depends on what's active: **sketch mode** while editing a sketch, **assembly mode** while an assembly document is active, and **part/model mode** otherwise (a part document, or an assembly with no sketch active).

## Sketch mode (no modifier)

Active only while a sketch is being edited.

| Key | Action |
|---|---|
| L | Line |
| R | Rectangle |
| C | Circle |
| A | Arc |
| S | Spline |
| N | Coincident constraint |
| H | Horizontal constraint |
| V | Vertical constraint |
| P | Parallel constraint |
| E | Perpendicular constraint |
| T | Tangent constraint |
| Q | Equal constraint |
| Y | Symmetric constraint |
| D | Dimension |
| Esc | Cancel the active tool and return to Select |
| Enter | Confirm the current step of the active tool |

## Part/Model mode (no modifier)

Active whenever a sketch isn't being edited (a part document, or an assembly with no sketch open).

| Key | Action |
|---|---|
| R | Revolve |
| F | Fillet |
| K | Chamfer |
| S | Shell |
| L | Linear Pattern |
| M | Mirror |
| H | Hole |
| W | Sweep |

## Modifiers (any mode except sketch)

| Shortcut | Action |
|---|---|
| Ctrl/Cmd+Shift+P | Work Plane |
| Ctrl/Cmd+Shift+A | Work Axis |
| Ctrl/Cmd+Shift+W | Work Point |

Work Point is bound to Shift+W (not plain W) because plain `W` is already Sweep in part/model mode — a deliberate divergence from Autodesk Inventor's stock key map.

## Assembly mode (no modifier)

Active only while an assembly document is active.

| Key | Action | Works? |
|---|---|---|
| P | Place Component | Yes |
| M | Mate | **No — see known issue below** |
| F | Flush | **No — see known issue below** |
| N | Angle | Yes |
| I | Insert | Yes |
| G | Toggle grounded (on the selected component) | Yes, if a component is selected |
| Ctrl/Cmd+Shift+S | Toggle constraint suppression (on the selected constraint) | Yes, if a constraint is selected |

## Global (any mode)

| Shortcut | Action |
|---|---|
| F7 | Toggle the Parameters panel |
| Ctrl/Cmd+Z | Undo |
| Ctrl/Cmd+Y **or** Ctrl/Cmd+Shift+Z | Redo |

## Known issues

- **View tab's "Fit (F)" and "Home" buttons do nothing.** Both buttons render with no click handler at all — clicking them has no effect. There is no working "fit to view" or "reset to home view" command reachable from any button or key anywhere in the app. The view does automatically re-frame the model once, right after you open a document or switch to one, but nothing lets you re-trigger that afterward.
- **Plain F does not fit the view — it opens Fillet**, because part/model mode claims the F key first. The "(F)" in the Fit button's label is stale; it doesn't reflect a live binding.
- **In Assembly mode, plain M (Mate) and plain F (Flush) never fire**, even though the assembly shortcut handler defines them. The part/model-mode handlers for Mirror (M) and Fillet (F) run first and consume the keystroke before the assembly handler ever sees it, so those two assembly shortcuts are dead code. Use the ribbon buttons for Mate and Flush instead of the keyboard shortcut. Angle (N), Insert (I), Ground toggle (G), and Ctrl/Cmd+Shift+S all work as expected.

See [Known Limitations](../troubleshooting/known-limitations.md) for the running list this belongs to.

## See also

- [Interface Tour](../getting-started/interface-tour.md)
- [Known Limitations](../troubleshooting/known-limitations.md)
- [Placing Components](../assemblies/placing-components.md)
- [Constraints](../assemblies/constraints.md)

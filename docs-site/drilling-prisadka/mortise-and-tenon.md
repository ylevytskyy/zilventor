---
title: Mortise and Tenon
---
# Mortise and Tenon
> Cuts a matched pair of tenon tabs on one panel and mortise pockets on another, wherever the
> two panels form a real butt joint.

**Where:** Furniture ▸ Присадка ▸ **Tenon/Mortise** · **Shortcut:** — · **Applies to:**
assembly (two panels)

## What it does

Tenon/Mortise is the joinery tool: pick two panels that meet edge-to-face, and it cuts
full-thickness tenon tabs on the end-presenting panel and matching mortise pockets (enlarged
by a fit clearance) on the face-presenting panel. Both panels are updated atomically, and the
tool can either place a fixed count/spacing of tenons yourself (**Manual**) or derive the
count and spacing from the joint's actual measured length (**Auto**).

## Before you start

- Have an assembly open with the two panels you want to joint.
- **The two panels must form a real butt joint** — one panel's end must land flush against
  the other's face. If they don't, the tool detects this and does nothing (see Gotchas).

## Steps

1. Click **Tenon/Mortise** in the Furniture ▸ Присадка ribbon panel — this arms a pick cursor
   for the first panel.
2. Click **Panel A**, then click **Panel B** in the 3D viewport.
3. The **Tenon/Mortise** dialog opens showing the paths of both picked panels. Enter **Width**
   and **Depth**, then choose a **Layout** mode:
   - **Manual** — enter **Count** and **Spacing** directly.
   - **Auto** — choose **By count** (I want exactly N tenons) or **By pitch** (I want ~P mm
     spacing); the dialog shows a live preview of the resolved count and spacing as you type.
4. Set **Fit clearance** (mortise oversize relative to the tenon) and, optionally, a
   **Position** to offset the tenon group along the joint (leave blank to center it).
5. Click **OK**.

*Result: tenon tabs are cut into one panel and matching mortise pockets into the other, and
both feature trees are updated together.*

## Options

| Field | Meaning |
|---|---|
| Panel A / Panel B | Read-only — the two panels you picked. The tool determines which one gets tenons (end-presenting) and which gets mortises (face-presenting). |
| Width (mm) | Tenon/mortise width. |
| Depth (mm) | Tenon/mortise depth. |
| Layout | **Manual** or **Auto** — see Steps above. |
| Count (Manual) | Exact number of tenons, evenly spaced. |
| Spacing (mm) (Manual) | Center-to-center spacing between tenons. |
| By count (Auto) | Target tenon count — spacing is derived from the joint's real length. |
| By pitch (Auto) | Target spacing in mm — count is derived from the joint's real length. |
| Min end margin (mm) (Auto) | Minimum clearance from the joint's ends to the outermost tenons. Leave blank to default to the tenon width. |
| Fit clearance (mm) | How much larger the mortise pocket is cut than the tenon, for a workable fit. |
| Position (mm) | Optional offset of the tenon group's center along the joint. Leave blank to center automatically. |

## Tips & gotchas

- **If the two picked panels don't form a real butt joint, the tool silently does nothing** —
  no tenons or mortises are added, and you'll see a toast telling you the two panels don't
  form a butt joint. Re-pick the panels, making sure one panel's end genuinely meets the
  other's face.
- **Auto-layout is clamped so tenons never overrun the joint.** If your requested count or
  pitch doesn't fit within the joint's real length (respecting the end margin), the tool
  automatically reduces the count to the largest that fits and shows a clamped-layout warning
  in the dialog preview — it will not silently produce an overlapping or out-of-bounds layout.
- Auto mode's preview recalculates live as you type — trust the preview's **Count**/**Spacing**
  numbers over your typed target; they're what actually gets built.
- Manual mode is unchanged from typing literal count/spacing — use it if you already know
  exactly how many tenons and at what pitch you want, without the joint-length math.
- There is currently no in-place edit for a placed tenon/mortise pair — to change it, undo and
  re-run the tool (or clear and regenerate; see
  [Editing and Clearing Bores](./editing-and-clearing-bores.md) for what clearing covers here).

<!-- SCREENSHOT: TenonMortiseDialog in Auto/By count mode showing the live preview, and the resulting tenon/mortise pair cut into two joined panels — TODO follow-up -->

## See also

- [Grooves and Dados](./grooves-and-dados.md)
- [Generate Carcass Boring](./generate-carcass-boring.md)
- [Editing and Clearing Bores](./editing-and-clearing-bores.md)

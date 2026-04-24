# Sub-project 3a — Manual test checklist

## Setup
- [ ] `pnpm dev` starts Vite. Open `http://localhost:5173`. Ready / mm.

## Golden path
- [ ] New Part -> 2D Sketch -> draw a rectangle profile + a vertical line as axis -> Finish Sketch.
- [ ] Model tab -> Revolve (or press **R**). Dialog opens. Profile auto-fills from the active sketch (current implementation derives Profile from the sketch containing closed wires; the `Pick` profile button is a stub, no picking required).
- [ ] Click the Axis `Pick` button, then click the vertical line in the viewport. Axis field shows the primitive id.
- [ ] Type `360` in the Angle field. Preview mesh appears (50% opacity) after the 200 ms debounce.
- [ ] OK. Solid appears, dialog closes. Feature tree shows the new revolve entry.

## Join / Cut
- [ ] With an existing body, open Revolve dialog. Join is the default operation; New and Cut are enabled.
- [ ] Pick axis, type `90`, select Join -> OK. Body updates; bounding box grows.
- [ ] Revolve again with Cut -> carves material away.

## Parametric
- [ ] Name the angle parameter `theta0` in the Revolve dialog, expression `90`.
- [ ] Open Parameters panel (**F7**), edit `theta0` to `180`. Solid regenerates live (param cascade pushes the new value into the kernel part; re-execute emits updated mesh).
- [ ] Edit to `theta0 + 90`. Expression evaluates; cascade works.

## Error paths
- [ ] Place axis so it crosses the profile: preview fails silently (no preview mesh appears); committing with OK surfaces a toast `Revolve failed: ...`. (Dialog does not currently render an inline error badge in the footer.)
- [ ] Cut with no body: the Cut button is disabled while `hasRunningBody` is false; only New is selectable. (Dialog does not auto-switch + toast — disabled-button guard replaces that flow.)
- [ ] Type `0 + width` with `width` undefined: commit surfaces a toast `Revolve failed: ...` from `ParameterRegistry.setParameter` throwing. (Dialog does not render an inline error under the Angle field in the current build.) (TODO: inline parse-error UI under Angle field.)

## Save / reopen
- [ ] Save `.zipt`. Reopen fresh tab. Revolve feature + angle parameter persist. Geometry regenerates.

## Extrude retrofit
- [ ] New extrude on an existing body defaults Operation to Join. User can pick Cut.
- [ ] Legacy v4 file opens: first extrude shows as New, subsequent as Join.

## Direction row
- [ ] `Normal` (default) and `Flipped` (negates angle) work. `Symmetric` is exposed in the UI but in 3a is treated as `Normal` internally (pre-rotation deferred). (TODO: real symmetric pre-rotation.)

## Plane support
- [ ] Revolves only execute for sketches on the XY plane in 3a. XZ / YZ sketches return a `revolveFailed` warning from the kernel. (TODO: XZ / YZ plane support.)

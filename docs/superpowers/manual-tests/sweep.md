# Sweep feature manual checklist

- [ ] **Path orientation:** sketch a circle (profile, XY plane) and a line (path, XZ plane); press W; pick profile + path; OK; verify a clean cylinder.
- [ ] **Parallel orientation:** same setup, switch orientation to Parallel; OK; verify the profile keeps its initial orientation (no rotation along path).
- [ ] **Guide Rail orientation:** add a parallel guide-rail sketch; switch orientation to Guide Rail; pick guide rail; OK; verify the swept body tracks the rail. Note: ContactOnBorder mode may slightly deform the profile to touch the rail.
- [ ] **Closed-loop path:** sketch a rectangle (path, XY) + small circle (profile, XZ); OK with Path orientation; verify a picture-frame ring (note: closed-loop sweeps produce shells, not solids — visible but not boolean-combinable yet).
- [ ] **Cut operation:** create a body first (extrude), then sweep with `cut`; verify a carved channel.
- [ ] **Edit-reopen:** double-click Sweep node in browser pane; verify all fields prefilled (profile, path, orientation, operation).
- [ ] **Parametric cascade:** edit a sketch dimension that drives the path; verify the swept body regenerates.
- [ ] **Live preview:** open dialog, switch picks; verify translucent preview updates within ~200 ms (note: guide-rail preview can take ~10–15s due to OCCT ContactOnBorder).
- [ ] **Validation:** open dialog with no profile picked; OK should be disabled.
- [ ] **Profile validation:** profile sketch must be a closed loop; open profile sketches reject at commit time with an error badge.

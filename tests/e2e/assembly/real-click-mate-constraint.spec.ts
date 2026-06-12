import { test, expect } from '@playwright/test';
import { waitForKernelReady } from '../helpers/buildBox';
import { seedAssemblyCubePart } from '../helpers/seedAssemblyPart';

/**
 * T36 fix: real-click face resolution for assembly mate constraints.
 *
 * THE BUG (regression pin):
 *   In assembly pick mode, the viewport click handler called
 *   `raycastComponent(clientX, clientY)` (returns ComponentPath only),
 *   then forwarded a placeholder FaceName { featureId:'unresolved',
 *   role:'unresolved' } to handleFaceHit(). Downstream, extractFacePlane
 *   searched the NamedShape's faceNames for featureId='unresolved', found
 *   nothing, returned null → ref excluded from resolvedRefs → solver marked
 *   the constraint brokenRef=true → constraint silently skipped.
 *   The existing e2e (create-mate-constraint.spec.ts) used
 *   __zilventorAssemblyPickerSimulate which bypasses this path entirely —
 *   classic green-probe-e2e ≠ working-UI false green.
 *
 * THE FIX (T36):
 *   For pickerMode==='face', replace raycastComponent with
 *   raycastAssemblyRef('face', ...) to get the triangleIndex, look up the
 *   part's TessellatedFace[] from a new partTessellatedFacesCacheRef, and
 *   call FacePickController.pickByTriangleIndex to get the real FaceName.
 *
 * TEST STRATEGY:
 *  1. Seed a 50 mm cube, place two instances.
 *  2. Move component B to x=200 (via store) so only A sits under the canvas
 *     centre ray. Trigger solver to update B's mesh pose.
 *  3. Wait for geometry to be loaded (data-geometry-hash ≠ '0').
 *  4. Open Place Constraint / Mate; click "Pick A"; issue a REAL canvas click
 *     at the canvas centre → hits component A → should resolve a real FaceName.
 *  5. Click "Pick B"; use dev-probe to inject a known FaceName for B
 *     (deterministic; ensures refB always resolves).
 *  6. Commit; wait for solver.
 *  7. Assert brokenRef=false — FAILS before fix (placeholder → brokenRef=true).
 *  8. Assert B's translation.z changed — FAILS before fix (no solve → z stays 0).
 *
 * REAL-CLICK INVOCATION (load-bearing proof):
 *   `await canvas.click({ position: { x: Math.floor(box.width/2), y: Math.floor(box.height/2) }, force: true })`
 *   where `canvas = page.locator('main#region-viewport canvas')`.
 *   This fires the React `onClick` handler → `props.onPointer({type:'click',...})`
 *   → App.tsx `handleViewportPointer` → `assemblyPickerRef.current.isActive()` path
 *   → (pre-fix) `raycastComponent` + placeholder FaceName
 *   → (post-fix) `raycastAssemblyRef('face',...)` + real FaceName.
 */
test('T36 — real canvas click resolves face name for mate constraint (brokenRef=false)', async ({ page }) => {
  page.on('console', (m) => console.log('BROWSER:', m.type(), m.text()));
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

  await page.goto('/');
  await waitForKernelReady(page);
  await seedAssemblyCubePart(page);

  // Open a new assembly.
  await page.getByRole('tab', { name: 'File' }).click();
  await page.getByRole('button', { name: /new assembly/i }).click();
  await page.waitForFunction(() => {
    const w = window as any;
    return w.__zilventorStore?.getState().activeDocument?.kind === 'assembly';
  });

  // Place cube twice.
  for (let i = 0; i < 2; i++) {
    await page.keyboard.press('p');
    await expect(page.getByRole('dialog', { name: /place component/i })).toBeVisible();
    await page.getByText(/^cube$/).click();
    await page.getByRole('button', { name: /^place$/i }).click();
    await expect(page.getByRole('dialog', { name: /place component/i })).toBeHidden();
    await page.waitForFunction(
      (expected) => {
        const w = window as any;
        return (w.__zilventorStore.getState().activeAssembly?.components?.length ?? 0) === expected;
      },
      i + 1,
    );
  }

  // Grab component IDs.
  const componentIds = await page.evaluate((): string[] => {
    const w = window as any;
    return w.__zilventorStore.getState().activeAssembly.components.map((c: any) => c.id);
  });
  expect(componentIds).toHaveLength(2);
  const [c1, c2] = componentIds as [string, string];

  // Move component B (c2) to z=200 so it is OFF the canvas-centre ray
  // AND in a position that only requires pure translation (no rotation) to
  // satisfy a mate against A's top (+Z) face.
  //
  // Rationale: c1 is at [0,50]³ (origin); camera at (400,400,400) looking at
  // origin; the closest face of c1 under the centre ray is the +Z top face
  // (featureId:'E1', role:'top') at z=50. The probe picks c2's bottom face
  // (normal=(0,0,-1)), which is antiparallel to c1's top face (normal=(0,0,+1)).
  // With c2 at z=200, the solver only needs to translate c2 from z=200 to z=50
  // (no rotation) — guaranteed to converge within a few iterations.
  //
  // updateComponent changes activeAssembly → solver re-fires next tick.
  // setSolverDirty(true) triggers the solver effect.
  await page.evaluate(([c2Id]) => {
    const store = (window as any).__zilventorStore;
    const s = store.getState();
    // Clear any prior solver-set pose and set a fresh position at z=200.
    // flattenForSolver uses c.pose if present (takes precedence over c.position);
    // clearing it ensures the initial solver condition comes from position.
    s.updateComponent(c2Id, { position: { x: 0, y: 0, z: 200 }, pose: undefined });
    // Set dirty AFTER updateComponent so the solver effect picks up both changes.
    // Using a microtask ensures React has processed the activeAssembly update before
    // solverDirty is toggled (avoids the guard `if (!solverDirty) return` firing
    // on the intermediate render).
    Promise.resolve().then(() => s.setSolverDirty(true));
  }, [c2]);

  // Wait for geometry to be in the viewport. data-geometry-hash ≠ '0' means
  // at least one component mesh has been registered by the assembly mesh-sync effect.
  await page.waitForFunction(() => {
    const el = document.querySelector('[data-testid="viewport"]');
    return el && el.getAttribute('data-geometry-hash') !== '0';
  }, undefined, { timeout: 30_000 });

  // Wait for the solver to run and update c2's componentPose to z=200.
  // The solver fires 50ms after setSolverDirty(true). We poll until c2's
  // componentPose.translation.z reflects the updated position (z≈200).
  await page.waitForFunction((c2Id) => {
    const w = window as any;
    const poses: Map<string, any> | undefined = w.__zilventorAssemblyPoses?.();
    if (!poses) return false;
    const pose = poses.get(c2Id);
    // c2 was set to z=200; wait until the solver's output reflects this.
    return pose && Math.abs((pose.translation?.z ?? 0) - 200) < 1;
  }, c2, { timeout: 10_000 });

  // Switch to Assembly tab and open Place Constraint dialog in Mate mode.
  await page.getByRole('tab', { name: 'Assembly' }).click();
  await page.getByRole('button', { name: 'Mate' }).click();
  await expect(page.getByRole('dialog', { name: /place constraint/i })).toBeVisible();

  // ----- Pick face A via REAL canvas click -----
  // Activate the picker for slot A.
  await page.getByRole('button', { name: /^pick…$/i }).first().click();

  // Issue a real mouse click at the canvas centre. Component A (c1) is at
  // origin [0,50]³; the camera looks from (400,400,400) towards (0,0,0),
  // so the centre ray passes through the cube. THREE.js raycasting works
  // against scene geometry even in headless Chrome (renders black but
  // geometry is present in the scene graph).
  const canvas = page.locator('main#region-viewport canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Canvas bounding box not found — viewport not rendered');

  await canvas.click({
    position: { x: Math.floor(box.width / 2), y: Math.floor(box.height / 2) },
    force: true,
  });

  // The real click fires onClick → props.onPointer({type:'click',...}) →
  // handleViewportPointer → assemblyPickerRef path.
  // Pre-fix:  handleFaceHit(componentPath, {featureId:'unresolved', role:'unresolved'})
  // Post-fix: handleFaceHit(componentPath, realFaceName from FacePickController)
  // In both cases: if the ray hit a mesh, handleFaceHit is called and the
  // dialog advances from "(none)" for slot A to a resolved label.

  // Wait for slot A to show a pick (no longer "(none)").
  // The pick fires synchronously in the click handler (no async), so React
  // state updates should appear within a few animation frames.
  await page.waitForFunction(() => {
    const allText = document.body.innerText;
    // Count "(none)" occurrences: started at 2 (both A and B); after picking A → 1.
    const count = (allText.match(/\(none\)/g) ?? []).length;
    return count < 2;
  }, undefined, { timeout: 8_000 });

  // ----- Pick face B via dev-probe (deterministic) -----
  // The probe injects a known FaceName directly, bypassing click resolution.
  // This ensures refB always resolves regardless of the fix state,
  // so the only variable is whether refA (from the real click) resolves.
  await page.getByRole('button', { name: /^pick…$/i }).last().click();
  await page.evaluate(([c2Id]) => {
    (window as any).__zilventorAssemblyPickerSimulate('B', 'face', {
      componentId: c2Id,
      face: { featureId: 'E1', role: 'bottom', instance: 0 },
    });
  }, [c2]);

  // Both picks done.
  await expect(page.locator('text=(none)')).toHaveCount(0);

  // Commit the constraint.
  await page.getByRole('button', { name: 'OK' }).click();
  await expect(page.getByRole('dialog', { name: /place constraint/i })).toBeHidden();

  // Wait for the solver to run (50 ms debounce + async OCCT ref resolution).
  await page.waitForFunction(() => {
    const w = window as any;
    const diag = w.__zilventorAssemblySolverResult?.();
    if (!diag) return false;
    return (diag.perConstraint?.size ?? 0) > 0;
  }, undefined, { timeout: 15_000 });

  // ----- Key assertions -----

  const diag = await page.evaluate(() => {
    const w = window as any;
    const d = w.__zilventorAssemblySolverResult();
    const entries = Array.from((d.perConstraint as Map<string, any>).entries());
    return {
      status: d.status,
      constraintCount: entries.length,
      firstConstraint: entries.length > 0 ? entries[0]![1] : null,
    };
  });

  expect(diag.constraintCount).toBe(1);
  expect(diag.firstConstraint).not.toBeNull();

  // THE KEY ASSERTION: brokenRef must be false after the fix.
  //
  // Before fix (placeholder FaceName):
  //   extractAssemblyRef(partId, {featureId:'unresolved', role:'unresolved'})
  //   → kernel searches NamedShape.faceNames for featureId='unresolved'
  //   → finds nothing → returns ok:false
  //   → ref NOT added to resolvedRefs → solver: brokenRef=true.
  //
  // After fix (real FaceName from FacePickController.pickByTriangleIndex):
  //   extractAssemblyRef(partId, {featureId:'E1', role:'top', instance:0})
  //   → kernel finds the named face in NamedShape → returns ok:true
  //   → ref added to resolvedRefs → solver: brokenRef=false.
  expect(diag.firstConstraint!.brokenRef).toBe(false);

  // The solver ran: status is any of the valid non-brokenRef states.
  // Note: 'did-not-converge' is acceptable here — what matters is brokenRef=false
  // (both refs resolved and the solver attempted to satisfy the constraint).
  // Convergence depends on the face orientation of whichever face the click hit;
  // for faces requiring rotation from identity quaternion the solver may not
  // converge in 50 iterations but always makes progress (poses change).
  expect(['fully-constrained', 'underconstrained', 'over-constrained', 'did-not-converge'])
    .toContain(diag.status);

  // Component B's pose must have changed from its initial position (0,0,200).
  // Pre-fix:  constraint brokenRef=true → solver ignores it → B stays at (0,0,200).
  // Post-fix: constraint brokenRef=false → solver runs → B moves to satisfy the mate.
  // We check the full 3D displacement (not just z) because the specific direction
  // depends on which face the real click hit — could be +Z (→ Δz≈150) or a side
  // face (→ ΔX or ΔY movement).
  const finalPoseB = await page.evaluate((c2Id) => {
    const w = window as any;
    const poses: Map<string, any> | undefined = w.__zilventorAssemblyPoses?.();
    if (!poses) return null;
    const pose = poses.get(c2Id);
    if (!pose) return null;
    return {
      x: pose.translation?.x ?? 0,
      y: pose.translation?.y ?? 0,
      z: pose.translation?.z ?? 0,
    };
  }, c2);

  expect(finalPoseB).not.toBeNull();
  const dx = (finalPoseB?.x ?? 0) - 0;  // initial x = 0
  const dy = (finalPoseB?.y ?? 0) - 0;  // initial y = 0
  const dz = (finalPoseB?.z ?? 200) - 200;  // initial z = 200
  const displacement = Math.sqrt(dx * dx + dy * dy + dz * dz);
  // Pre-fix (brokenRef=true): solver ignores constraint → B stays at (0,0,200) → displacement ≈ 0.
  // Post-fix (brokenRef=false): solver moves B to satisfy the mate → displacement >> 0.
  expect(displacement).toBeGreaterThan(0.1);
});

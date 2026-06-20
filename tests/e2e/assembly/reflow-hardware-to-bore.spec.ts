import { test, expect } from '@playwright/test';
import { waitForKernelReady } from '../helpers/buildBox';

/**
 * S-B: Hardware-to-bore axis pick via REAL canvas click (Task 2 axis pick gate).
 *
 * THE GATE: This spec uses a REAL pointer click (not __zilventorAssemblyPickerSimulate)
 * to fill slot A of an Angle constraint. The click exercises the full App.tsx axis pick
 * handler at lines 2673–2741:
 *   1. pickerMode === 'axis' → raycastAssemblyRef('axis', clientX, clientY)
 *   2. Primary: EdgePickController from partTessellatedEdgesCacheRef
 *   3. Fallback: re-raycast in 'face' mode → FacePickController →
 *      handleCylindricalFaceHit(componentPath, faceName)
 *
 * Geometry choice — Z-axis cylinder, c1 positioned at z=10:
 *
 *   Camera at (400,400,400) looks at (0,0,0). Ray direction = (−1,−1,−1)/√3.
 *   Cylinder: XY-plane sketch, r=25, h=40 → spans z=0..40 in part-local.
 *
 *   c1 placed at world position (0,0,10): cylinder world z spans [10, 50].
 *   c2 placed far away at (500,0,0) → only c1 is near the canvas-centre ray.
 *
 *   Ray analysis (c1 at z_offset=10):
 *     P(t) = (400−400t, 400−400t, 400−400t)
 *
 *   (a) Side face hit: |400−400t|·√2 = 25  →  t ≈ 0.956,  z ≈ 17.6
 *       World z = 17.6 is inside [10, 50]. ✓ HIT at t ≈ 0.956.
 *
 *   (b) Bottom face hit: z_world = 10 → 400−400t = 10 → t = 0.975.
 *       (x,y) = (10, 10). Distance from (10,10) to axis (0,0) = 10√2 ≈ 14.1 < 25.
 *       ✓ BACK-FACE hit at t = 0.975.
 *
 *   (c) Top face: z_world = 50 → t = 0.875. (x,y) = (50,50). Dist = 70.7 > 25. MISS.
 *
 *   THREE.js returns the FIRST (smallest t) intersection: t ≈ 0.956 (side) < 0.975 (bottom).
 *   → pickByTriangleIndex → face role 'side' → extractCylinderAxis succeeds → brokenRef=false.
 *
 * Seed geometry: sketch on XY plane, circle r=25, extrude h=40 along Z (standard).
 *   Faces: top (role:'top' at z=40), bottom (role:'bottom' at z=0), side (cylindrical, Z-axis).
 *
 * Strategy:
 *  1. Seed Z-axis cylinder part inline.
 *  2. Open assembly, place cylinder TWICE.
 *  3. Move c1 to z=10 (so side face is at z=17.6, first on camera ray).
 *     Move c2 to x=500 (off-screen, won't interfere with click).
 *  4. Wait for geometry-hash ≠ '0' to confirm mesh is in scene.
 *  5. Open Angle constraint dialog ('n' key).
 *  6. Click "Pick…" for slot A → activates axis picker (pickerMode = 'axis').
 *  7. Issue a REAL canvas click at canvas centre → hits c1's side face (Z-axis cylinder).
 *  8. Assert slot A filled: "(none)" count drops from 2 to 1. If not → BLOCKED.
 *  9. Fill slot B via __zilventorAssemblyPickerSimulate (deterministic).
 * 10. Commit + wait for solver.
 * 11. Assert brokenRef=false (axis refs resolved → side face is cylindrical).
 * 12. Trigger invalidation reflow, assert solver re-runs and constraint stays satisfied.
 */
test('S-B — real canvas click axis pick for Angle constraint, then invalidation reflow', async ({ page }) => {
  page.on('console', (m) => console.log('BROWSER:', m.type(), m.text()));
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

  await page.goto('/');
  await waitForKernelReady(page);

  // ---- Seed a standard Z-axis cylinder part inline ----
  // XY sketch plane → extrude along +Z, h=40, r=25.
  // The cylinder placed at world z=10 will have its side face hit first by the
  // canvas-centre ray before the bottom face (see geometry analysis in JSDoc).
  await page.evaluate(async () => {
    const w = window as unknown as {
      __zilventorPackProject: (input: {
        manifest: unknown; blobs: Record<string, Uint8Array>; thumbnail?: Uint8Array;
      }) => Promise<Uint8Array>;
      __zilventorGetOpfs: () => Promise<{ write(path: string, data: Uint8Array): Promise<void> }>;
    };
    const partDoc = {
      id: 'P_cyl_sb',
      name: 'cylSB',
      units: 'mm',
      parameters: {
        d0: { name: 'd0', expression: '40', value: 40, unit: 'mm' },
      },
      featureTree: [
        // Standard XY sketch → extrude along Z
        { kind: 'sketch', id: 'S0', plane: 'XY',
          primitives: [{ id: 'C1', kind: 'circle', cx: 0, cy: 0, r: 25 }],
          constraints: [] },
        { kind: 'extrude', id: 'E1', sketchRef: 'S0', distanceParam: 'd0',
          direction: 'forward', operation: 'new' },
      ],
    };
    const manifest = {
      formatVersion: 7,
      kind: 'part',
      createdAt: new Date().toISOString(),
      appVersion: '0.0.0',
      document: partDoc,
    };
    const png = new Uint8Array([
      0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
      0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
      0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
      0x08, 0x06, 0x00, 0x00, 0x00, 0x1F, 0x15, 0xC4,
      0x89, 0x00, 0x00, 0x00, 0x0A, 0x49, 0x44, 0x41,
      0x54, 0x78, 0x9C, 0x63, 0x00, 0x01, 0x00, 0x00,
      0x05, 0x00, 0x01, 0x0D, 0x0A, 0x2D, 0xB4, 0x00,
      0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE,
      0x42, 0x60, 0x82,
    ]);
    const archive = await w.__zilventorPackProject({ manifest, blobs: {}, thumbnail: png });
    const opfs = await w.__zilventorGetOpfs();
    await opfs.write('parts/cylSB.zipt', archive);
  });

  // Open a new assembly.
  await page.getByRole('tab', { name: 'File' }).click();
  await page.getByRole('button', { name: /new assembly/i }).click();
  await page.waitForFunction(() => {
    const w = window as any;
    return w.__zilventorStore?.getState().activeDocument?.kind === 'assembly';
  });

  // Place cylinder twice.
  for (let i = 0; i < 2; i++) {
    await page.keyboard.press('p');
    await expect(page.getByRole('dialog', { name: /place component/i })).toBeVisible();
    await page.getByText(/^cylSB$/).click();
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

  const componentIds = await page.evaluate((): string[] => {
    const w = window as any;
    return w.__zilventorStore.getState().activeAssembly.components.map((c: any) => c.id);
  });
  expect(componentIds).toHaveLength(2);
  const [c1, c2] = componentIds as [string, string];

  // Position c1 at z=10 so the camera ray hits the SIDE face (z≈17.6) BEFORE
  // the bottom face (z=10). See geometry analysis in the JSDoc above.
  // Move c2 far off to x=500 so it is NOT under the canvas-centre ray.
  await page.evaluate(([c1Id, c2Id]) => {
    const store = (window as any).__zilventorStore;
    const s = store.getState();
    s.updateComponent(c1Id, { position: { x: 0, y: 0, z: 10 }, pose: undefined });
    s.updateComponent(c2Id, { position: { x: 500, y: 0, z: 0 }, pose: undefined });
    Promise.resolve().then(() => s.setSolverDirty(true));
  }, [c1, c2]);

  // Wait for the scene geometry to be populated (data-geometry-hash ≠ '0').
  await page.waitForFunction(() => {
    const el = document.querySelector('[data-testid="viewport"]');
    return el && el.getAttribute('data-geometry-hash') !== '0';
  }, undefined, { timeout: 30_000 });

  // Wait for the solver to run and confirm c1's pose is at z=10.
  // The solver fires 50ms after setSolverDirty(true); the mesh sync effect then
  // updates the THREE.js world matrix. We poll componentPoses for c1.translation.z ≈ 10.
  await page.waitForFunction((c1Id) => {
    const w = window as any;
    const poses: Map<string, any> | undefined = w.__zilventorAssemblyPoses?.();
    if (!poses) return false;
    const pose = poses.get(c1Id);
    return pose && Math.abs((pose.translation?.z ?? 0) - 10) < 1;
  }, c1, { timeout: 10_000 });

  // Extra wait for tessellated-faces + tessellated-edges caches to populate.
  // These are set in the geometry effect (App.tsx line 4486/4489) which runs
  // after mesh upload. The axis pick fallback reads partTessellatedFacesCacheRef.
  await page.waitForTimeout(1_500);

  // Switch to Assembly tab and open the Angle constraint dialog via 'n' key.
  await page.getByRole('tab', { name: 'Assembly' }).click();
  await page.keyboard.press('n');
  await expect(page.getByRole('dialog', { name: /place constraint/i })).toBeVisible();

  // ----- Pick axis A via REAL canvas click -----
  // Activate the axis picker for slot A.
  await page.getByRole('button', { name: /^pick…$/i }).first().click();

  // Get canvas bounding box and issue a REAL click at the canvas centre.
  //
  // LOAD-BEARING PROOF: this fires the React onClick → handleViewportPointer →
  // pickerMode==='axis' branch (App.tsx 2673) → raycastAssemblyRef('axis',...) →
  // edge cache primary (likely misses — circular edges at r=25 are >2mm from ray) →
  // fallback face-raycast → FacePickController.pickByTriangleIndex →
  // handleCylindricalFaceHit(componentPath, {featureId:'E1', role:'side', instance:0}).
  // This is the ONLY gate for Task 2's real pointer path.
  const canvas = page.locator('main#region-viewport canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Canvas bounding box not found — viewport not rendered');

  await canvas.click({
    position: { x: Math.floor(box.width / 2), y: Math.floor(box.height / 2) },
    force: true,
  });

  // Wait for slot A to be filled: "(none)" count must drop from 2 to 1.
  // The angle dialog shows TWO "(none)" slots initially (refA and refB).
  // After a real axis pick for slot A, one "(none)" is replaced by the pick label.
  const slotAFilled = await page.waitForFunction(() => {
    const allText = document.body.innerText;
    const count = (allText.match(/\(none\)/g) ?? []).length;
    return count < 2;
  }, undefined, { timeout: 8_000 }).then(() => true).catch(() => false);

  if (!slotAFilled) {
    // Centre missed — try a slight offset (camera angle may shift projection slightly).
    console.log('[S-B] Centre click missed — retrying at centre + (4, -4) offset');
    await canvas.click({
      position: {
        x: Math.floor(box.width / 2) + 4,
        y: Math.floor(box.height / 2) - 4,
      },
      force: true,
    });

    const retryFilled = await page.waitForFunction(() => {
      const allText = document.body.innerText;
      const count = (allText.match(/\(none\)/g) ?? []).length;
      return count < 2;
    }, undefined, { timeout: 8_000 }).then(() => true).catch(() => false);

    if (!retryFilled) {
      // BLOCKED: real pointer cannot reliably hit the cylinder geometry.
      // Fail explicitly — do NOT fake-pass with a simulate bypass.
      throw new Error(
        '[S-B] BLOCKED: real canvas click (centre and centre+offset) did not hit cylinder geometry. ' +
        'The axis pick path (Task 2) cannot be verified. ' +
        'Check: (1) geometry-hash ≠ 0 before click, (2) c1 at z=10 (side face at z≈17.6 world), ' +
        '(3) tessellated-faces cache populated after waitForTimeout, ' +
        '(4) canvas centre projects correctly onto c1 under camera (400,400,400).'
      );
    }
  }

  // Slot A is filled by the real canvas click.
  // The real pick hit the cylindrical side face → handleCylindricalFaceHit fired.

  // ----- Pick axis B via dev-probe (deterministic) -----
  // c2 is at x=500 (off-screen), so a real click won't hit it.
  // Inject the cylindrical side face directly via the simulate hook.
  await page.getByRole('button', { name: /^pick…$/i }).last().click();
  await page.evaluate(([c2Id]) => {
    (window as any).__zilventorAssemblyPickerSimulate('B', 'cylindricalFace', {
      componentId: c2Id,
      face: { featureId: 'E1', role: 'side', instance: 0 },
    });
  }, [c2]);

  // Both slots filled: no "(none)" remaining.
  await expect(page.locator('text=(none)')).toHaveCount(0);

  // Commit the constraint and wait for the dialog to close.
  await page.getByRole('button', { name: 'OK' }).click();
  await expect(page.getByRole('dialog', { name: /place constraint/i })).toBeHidden();

  // Wait for the solver to run and produce a result (50ms debounce + OCCT ref resolution).
  await page.waitForFunction(() => {
    const w = window as any;
    const diag = w.__zilventorAssemblySolverResult?.();
    return (diag?.perConstraint?.size ?? 0) > 0;
  }, undefined, { timeout: 15_000 });

  // ----- Key assertion: brokenRef=false -----
  // brokenRef=false proves the real axis pick resolved the cylindrical side face
  // correctly and extractCylinderAxis succeeded on {featureId:'E1', role:'side'}.
  //
  // If brokenRef=true: the click hit geometry (slot A filled) but the kernel
  // could not extract an axis ref from the face name. This means the click
  // landed on a planar face (top or bottom), not the cylindrical side face.
  // Status: DONE_WITH_CONCERNS.
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

  if (diag.firstConstraint!.brokenRef === true) {
    throw new Error(
      '[S-B] DONE_WITH_CONCERNS: real axis pick registered (slot A filled) but ' +
      'brokenRef=true after solver run. The click hit geometry but ref extraction ' +
      'failed — the picked face was likely planar (top or bottom), not the cylindrical ' +
      'side face. The axis pick code path fires correctly (Task 2 wiring confirmed) ' +
      'but the cylindrical face targeting is non-deterministic at this camera angle. ' +
      'Geometry: cylinder at z_offset=10, camera (400,400,400) → (0,0,0). ' +
      'Expected side face hit at world z≈17.6, t≈0.956 < bottom face t=0.975.'
    );
  }

  // THE KEY ASSERTION: brokenRef=false proves end-to-end axis pick works.
  expect(diag.firstConstraint!.brokenRef).toBe(false);

  // Solver must have run in any non-error state.
  expect(['fully-constrained', 'underconstrained', 'over-constrained', 'did-not-converge'])
    .toContain(diag.status);

  // ----- Reflow: invalidate part and assert solver re-runs -----
  // After confirming the constraint is set up (Task 2 proof), trigger a part
  // invalidation (Task 1) to verify the solver re-runs and stays satisfied.
  await page.evaluate(() => {
    const s = (window as any).__zilventorStore.getState();
    s.setSolverDirty(false);
  });

  await page.evaluate(async () => {
    await (window as any).__zilventorAssemblyInvalidatePart('parts/cylSB.zipt');
  });

  // Invalidate must bump solverDirty=true immediately (Task 1 wiring).
  const wentDirty = await page.evaluate(() => {
    return (window as any).__zilventorStore.getState().solverDirty;
  });
  expect(wentDirty).toBe(true);

  // Solver re-runs after the 50ms debounce; wait for it to settle.
  await page.waitForFunction(() => {
    const s = (window as any).__zilventorStore.getState();
    return s.solverDirty === false;
  }, undefined, { timeout: 15_000 });

  // After reflow, constraint must still be brokenRef=false (same part file).
  await page.waitForFunction(() => {
    const w = window as any;
    const diag = w.__zilventorAssemblySolverResult?.();
    if ((diag?.perConstraint?.size ?? 0) === 0) return false;
    return Array.from((diag.perConstraint as Map<string, any>).values())[0]?.brokenRef === false;
  }, undefined, { timeout: 15_000 });

  const reflowDiag = await page.evaluate(() => {
    const w = window as any;
    const d = w.__zilventorAssemblySolverResult();
    return Array.from((d.perConstraint as Map<string, any>).values())[0] ?? null;
  });
  expect(reflowDiag).not.toBeNull();
  expect(reflowDiag!.brokenRef).toBe(false);
});

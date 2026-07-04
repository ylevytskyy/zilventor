/**
 * E2E: Interference / Clash Check — SC-11.
 *
 * §6 proof strategy: viewport is BLACK in headless → use __zilventor* probes only.
 *   __zilventorClashCount() → number of clash rows in store.
 *   __zilventorClashResults() → ClashReportRow[] for exact pathKey + aPath assertions.
 *
 * PATH_SEPARATOR NOTE: shared/src/componentPath.ts declares PATH_SEPARATOR = '\x00' (null byte,
 * not a space). Nested pathKeys look like "cabinetId\x00panelId". Assertions use
 * `aPath.length > 1` (the ComponentPath array) rather than splitting the key string.
 *
 * PC-2 compliance: the NESTED clash test seeds via CreateCabinetCommand (which produces
 * a cabinet .ziasm sub-assembly containing panel components), then places a deliberately-
 * overlapping flat panel in the ROOT assembly at the same position as the cabinet's Left Side
 * panel. This exercises the flatten+compose chain through the nested .ziasm.
 * Assertion: at least one result row has aPath.length > 1 OR bPath.length > 1
 * — proving recursion reached a leaf INSIDE the cabinet sub-assembly.
 *
 * Tests:
 *   A. SC-11(b): Cabinet (nested .ziasm) + overlapping root panel → nested component path detected.
 *   B. SC-11(c): Two non-overlapping panels placed far apart → 0 clashes (no false positives).
 *      This exercises the face-touching / no-overlap suppression path: panels at Z=0..18 and
 *      Z=20..38 share no geometry; Common() → no solid; extrema dist=2mm > clearanceThreshold=1mm.
 */
import { test, expect } from '@playwright/test';
import { waitForKernelReady } from './helpers/buildBox';

// ── Shared seeding helpers ────────────────────────────────────────────────────

async function setupNewAssemblyWithMaterials(page: import('@playwright/test').Page): Promise<void> {
  await page.getByRole('tab', { name: 'File' }).click();
  await page.getByRole('button', { name: /new assembly/i }).click();
  await page.waitForFunction(() => {
    const w = window as any;
    return w.__zilventorStore?.getState().activeDocument?.kind === 'assembly';
  });
  await page.evaluate(() => {
    const add = (window as any).__zilventorStore.getState().addMaterial;
    add({ id: 'm-birch-18', name: 'Birch 18mm', defaultThickness: 18, color: '#d8c896' });
    add({ id: 'm-hb-6', name: 'Hardboard 6mm', defaultThickness: 6, color: '#8b6f47' });
  });
}

/** Creates a 600×720×560 cabinet. Returns the cabinet's component ID in the root assembly. */
async function createCabinetAndGetId(page: import('@playwright/test').Page): Promise<string> {
  await page.evaluate(async () => {
    const w = window as any;
    const { CreateCabinetCommand } = await import('/src/commands/CreateCabinetCommand.ts');
    const opfs = await w.__zilventorGetOpfs();
    const cmd = new CreateCabinetCommand({
      template: 'baseCabinet',
      params: {
        name: 'ClashCabinet',
        width: 600,
        depth: 560,
        height: 720,
        toekickHeight: 100,
        toekickSetback: 50,
        shelfCount: 0,
        carcassMaterialId: 'm-birch-18',
        backMaterialId: 'm-hb-6',
        bandMaterialId: null,
      },
      opfs,
    });
    await w.__zilventorStore.getState().bus.execute(cmd);
  });

  await page.waitForFunction(
    () => {
      const comps = (window as any).__zilventorStore?.getState().activeAssembly?.components ?? [];
      return comps.length >= 1 && comps[0]?.partPath?.endsWith('.ziasm');
    },
    undefined,
    { timeout: 60_000 },
  );

  const cabinetId: string = await page.evaluate(
    () => (window as any).__zilventorStore.getState().activeAssembly.components[0].id,
  );
  console.log('[e2e] cabinetId =', cabinetId);
  return cabinetId;
}

/**
 * Creates and places a panel at a given Z offset in the root assembly.
 * Panel dims: 100×100×18 (length × width × thickness).
 * Native Z: [0, 18]. At assembly position (0, 0, zOffset) → world Z: [zOffset, zOffset+18].
 * The panel's X:[-50,+50], Y:[-50,+50] are centered at origin.
 *
 * NOTE: CreateAndPlacePanelCommand always places at (0,0,0) in the root assembly.
 * After placement, we move the component to the desired Z offset via updateComponent.
 */
async function placePanel(
  page: import('@playwright/test').Page,
  partName: string,
  partPath: string,
  zOffset: number,
): Promise<string> {
  await page.evaluate(
    async ([name, path]: [string, string]) => {
      const w = window as any;
      const { CreateAndPlacePanelCommand } = await import('/src/commands/CreateAndPlacePanelCommand.ts');
      const opfs = await w.__zilventorGetOpfs();
      const asm = w.__zilventorStore.getState().activeAssembly;
      const materials: any[] = asm?.materials ?? [];
      const mat = materials.find((m: any) => m.id === 'm-birch-18');
      const partMaterials = mat
        ? [mat]
        : [{ id: 'm-birch-18', name: 'Birch 18mm', defaultThickness: 18, color: '#d8c896' }];

      const cmd = new CreateAndPlacePanelCommand({
        partName: name,
        partPath: path,
        panel: {
          kind: 'panel',
          id: 'pf-panel',
          length: { kind: 'literal', value: 100 },
          width: { kind: 'literal', value: 100 },
          thickness: { kind: 'literal', value: 18 },
          thicknessFromMaterial: false,
          materialId: mat?.id ?? 'm-birch-18',
          grain: 'none',
          edgeBands: { front: null, back: null, left: null, right: null },
        },
        partMaterials,
        opfs,
      });
      await w.__zilventorStore.getState().bus.execute(cmd);
    },
    [partName, partPath] as [string, string],
  );

  // bus.execute is awaited in page.evaluate, so the component is already in the store

  const compId: string = await page.evaluate(() => {
    const comps = (window as any).__zilventorStore.getState().activeAssembly?.components ?? [];
    return comps[comps.length - 1].id;
  });

  // Move to desired Z offset (CreateAndPlacePanelCommand always places at origin)
  if (zOffset !== 0) {
    await page.evaluate(
      ([id, z]: [string, number]) => {
        (window as any).__zilventorStore.getState().updateComponent(id, { position: { x: 0, y: 0, z } });
      },
      [compId, zOffset] as [string, number],
    );
  }

  return compId;
}

/**
 * Runs the interference check by replicating InspectTab.handleRun logic in page.evaluate.
 * Uses the same imports and subAsmCache build pattern as InspectTab.
 * unpackAssembly accessed via __zilventorUnpackAssembly probe (App.tsx:450).
 */
async function runClashCheck(page: import('@playwright/test').Page, clearanceMm = 1.0): Promise<void> {
  await page.evaluate(async (threshold: number) => {
    const w = window as any;

    // App /src/ path imports — confirmed working in other e2e specs
    const { runInterferenceCheck } = await import('/src/assembly/runInterferenceCheck.ts');
    const { resolvePartInfo } = await import('/src/shell/resolvePartInfo.ts');
    const { computeInnerStaticPoses } = await import('/src/assembly/computeInnerStaticPoses.ts');

    // unpackAssembly via probe — avoids bare @zilventor/kernel module resolution
    const unpackAssembly: (bytes: Uint8Array) => Promise<any> = w.__zilventorUnpackAssembly;
    if (!unpackAssembly) throw new Error('__zilventorUnpackAssembly probe not registered');

    const state = w.__zilventorStore.getState();
    const { activeAssembly, kernel, subAssemblyDocs, subAssemblyInnerPoses, componentPoses, setClashResult } = state;
    if (!activeAssembly || !kernel) throw new Error('no assembly or kernel');

    const opfs = await w.__zilventorGetOpfs();

    // Mirror InspectTab.handleRun BFS sub-asm cache build
    let docs: Record<string, any> = { ...subAssemblyDocs };
    const innerPoses: Record<string, any> = { ...subAssemblyInnerPoses };

    if (Object.keys(docs).length === 0) {
      const stack: any[] = [activeAssembly];
      const seen = new Set<string>();
      while (stack.length) {
        const d = stack.pop()!;
        for (const c of d.components) {
          if (!c.partPath.endsWith('.ziasm')) continue;
          if (seen.has(c.partPath)) continue;
          seen.add(c.partPath);
          if (docs[c.partPath]) { stack.push(docs[c.partPath]); continue; }
          try {
            if (await opfs.exists(c.partPath)) {
              const sub = await unpackAssembly(await opfs.read(c.partPath));
              docs[c.partPath] = sub;
              innerPoses[c.partPath] = computeInnerStaticPoses(sub);
              stack.push(sub);
            }
          } catch { /* skip */ }
        }
      }
    } else {
      for (const [p, d] of Object.entries(docs)) {
        if (!innerPoses[p]) innerPoses[p] = computeInnerStaticPoses(d);
      }
    }

    const subAsmCache = {
      get: (p: string) =>
        docs[p]
          ? { kind: 'ok' as const, doc: docs[p], partPath: p, ...(innerPoses[p] ? { innerStaticPoses: innerPoses[p] } : {}) }
          : undefined,
    };

    const rows = await runInterferenceCheck({
      assembly: activeAssembly,
      kernel,
      opfs,
      subAsmCache,
      componentPoses,
      partInfoCache: new Map(),
      resolvePartInfo: (o: any, p: string, c: any) => resolvePartInfo(o, p, c),
      clearanceThreshold: threshold,
    });

    setClashResult(rows);
  }, clearanceMm);
}

async function waitForClashRan(page: import('@playwright/test').Page): Promise<void> {
  await page.waitForFunction(
    () => (window as any).__zilventorStore?.getState().clashRan === true,
    undefined,
    { timeout: 120_000 },
  );
}

// ── TEST A: SC-11(b) — nested sub-assembly clash ──────────────────────────────

test(
  'SC-11(b): cabinet .ziasm + overlapping root panel → interference detected with nested component path',
  async ({ page }) => {
    test.setTimeout(360_000);
    page.setDefaultTimeout(120_000);

    const consoleErrors: string[] = [];
    page.on('console', (m) => {
      if (m.text().startsWith('[e2e]')) console.log('BROWSER:', m.text());
      if (m.type() === 'error') consoleErrors.push(m.text());
    });
    page.on('pageerror', (e) => consoleErrors.push(`PAGEERROR: ${e.message}`));

    await page.goto('/');
    await waitForKernelReady(page);

    // 1. New assembly + materials
    await setupNewAssemblyWithMaterials(page);

    // 2. Create cabinet — places a .ziasm containing panel components.
    //    Post-fix (cabinet-pose-fix plan §3): Left Side (role='leftSide', local dims
    //    L=H=720, W=D=560, T=Tc=18, cabinet-local position (0,0,0)) carries an additive
    //    pose: translation = position + (0, D/2, H/2) = (0, 280, 360), rotation ≈90° about
    //    Y. That rotation maps local +Z (thickness) → world X, local length → world Z, and
    //    leaves local width on world Y — so the composed world AABB is
    //    X:[0,18] Y:[0,560] Z:[0,720] (verified against the live app below, not hand-typed).
    //    (The OLD comment here described the PRE-FIX bug: composedPoses hardcoded identity
    //    rotation and dropped c.rotation/c.pose entirely, so panels rendered flat at their
    //    raw `position` — giving a false X:[-360,+360] Y:[-280,+280] Z:[0,18] box. That
    //    geometry no longer exists once composedPoses reads c.pose.)
    const cabinetId = await createCabinetAndGetId(page);

    // 3. Place a 100×100×18 panel in the ROOT assembly at (0, 0, 0).
    //    World: X:[-50,+50], Y:[-50,+50], Z:[0,18] (flat, unrotated — a root-level panel is
    //    untouched by the pose fix).
    //    Overlap with Left Side (X:[0,18] Y:[0,560] Z:[0,720]): intersection is
    //    X:[0,18]∩[-50,50]=[0,18], Y:[0,560]∩[-50,50]=[0,50], Z:[0,720]∩[0,18]=[0,18]
    //    → 18×50×18 = 16 200 mm³ >> VOLUME_THRESHOLD_MM3=1.0 (still a real, non-empty overlap;
    //    SC-11(b)'s count>0 expectation holds post-fix for a different geometric reason than
    //    the stale comment claimed).
    await placePanel(page, 'OverlapPanel', 'OverlapPanel.zipt', 0);

    // 4. Run interference check
    await runClashCheck(page, 1.0);
    await waitForClashRan(page);

    // 5. Assert interference detected
    const count: number = await page.evaluate(() => (window as any).__zilventorClashCount());
    console.log('[e2e] SC-11(b) clash count =', count);
    expect(count, 'expected at least one interference').toBeGreaterThan(0);

    // 6. PC-2 CORE ASSERTION: at least one result row must have aPath.length > 1 OR bPath.length > 1.
    //    aPath is the ComponentPath array returned by resolveExportLeaves — when a panel is inside
    //    a .ziasm, its path is [cabinetComponentId, panelComponentId] (length=2).
    //    This proves resolveExportLeaves recursed through the .ziasm sub-assembly.
    const results = await page.evaluate(
      () => (window as any).__zilventorClashResults() as Array<{
        aPathKey: string; bPathKey: string;
        aPath: string[]; bPath: string[];
        aName: string; bName: string;
        kind: string; volume?: number;
      }>,
    );
    console.log('[e2e] SC-11(b) results:', JSON.stringify(results));

    // Nested path check: any row where either aPath or bPath has > 1 element
    const hasNestedPath = results.some((r) => r.aPath.length > 1 || r.bPath.length > 1);
    expect(hasNestedPath, `expected ≥1 row with nested ComponentPath (path.length > 1). Results: ${JSON.stringify(results.map(r => ({ aPath: r.aPath, bPath: r.bPath })))}`).toBe(true);

    // The nested path's first element must be the cabinet's component ID
    const nestedRows = results.filter((r) => r.aPath.length > 1 || r.bPath.length > 1);
    const nestedPaths = nestedRows.flatMap((r) => [r.aPath, r.bPath]).filter((p) => p.length > 1);
    expect(
      nestedPaths.some((p) => p[0] === cabinetId),
      `expected nested path to start with cabinetId=${cabinetId}. Nested paths: ${JSON.stringify(nestedPaths)}`,
    ).toBe(true);

    // All results should be interference (not clearance) given large overlaps
    expect(results.every((r) => r.kind === 'interference'), 'all results should be interference kind').toBe(true);

    // No unexpected console errors
    expect(consoleErrors.filter((e) => !e.includes('ResizeObserver'))).toHaveLength(0);

    // 7. NEW (cabinet-pose-fix plan Slice 9): read the Left Side panel's ACTUAL composed
    //    world pose from the LIVE app (not hand-typed) and derive its world AABB from that
    //    pose + its known local box, to prove the comment above matches real runtime geometry.
    //    Mirrors runClashCheck's BFS pattern: unpack the cabinet's .ziasm, find the
    //    role='leftSide' leaf, compose its local pose with the cabinet component's own pose
    //    via the same componentLocalPose/composePoses helpers composedPoses.ts uses.
    const leftSideAabb = await page.evaluate(async (cabId: string) => {
      const w = window as any;
      const { componentLocalPose } = await import('/src/assembly/walkers/componentLocalPose.ts');
      const { composePoses } = await import('/src/assembly/walkers/composedPoses.ts');

      const unpackAssembly: (bytes: Uint8Array) => Promise<any> = w.__zilventorUnpackAssembly;
      const opfs = await w.__zilventorGetOpfs();
      const activeAssembly = w.__zilventorStore.getState().activeAssembly;

      const cabinetComp = activeAssembly.components.find((c: any) => c.id === cabId);
      if (!cabinetComp) throw new Error('cabinet component not found in root assembly');
      const cabinetDoc = await unpackAssembly(await opfs.read(cabinetComp.partPath));

      const leftSideComp = cabinetDoc.components.find((c: any) => c.role === 'leftSide');
      if (!leftSideComp) throw new Error('role=leftSide component not found inside cabinet .ziasm');

      const cabinetPose = componentLocalPose(cabinetComp);
      const leftSideLocalPose = componentLocalPose(leftSideComp);
      const worldPose = composePoses(cabinetPose, leftSideLocalPose);

      // leftSide template dims (baseCabinet.ts): L=H=720, W=D=560, T=Tc=18.
      // Local box per buildPanelBox convention: X∈[-L/2,L/2], Y∈[-W/2,W/2], Z∈[0,T].
      const L = 720, Wd = 560, T = 18;
      const corners: Array<{ x: number; y: number; z: number }> = [];
      for (const x of [-L / 2, L / 2]) {
        for (const y of [-Wd / 2, Wd / 2]) {
          for (const z of [0, T]) corners.push({ x, y, z });
        }
      }

      // Inline quaternion rotation (mirrors kernel/src/assembly/quat.ts quatRotateVec) —
      // a bare `@zilventor/kernel/...` specifier can't be dynamically imported from this
      // raw page.evaluate script (only Vite-transformed app modules resolve bare specifiers).
      function rotate(q: [number, number, number, number], v: { x: number; y: number; z: number }) {
        const [qx, qy, qz, qw] = q;
        const cx = qy * v.z - qz * v.y + qw * v.x;
        const cy = qz * v.x - qx * v.z + qw * v.y;
        const cz = qx * v.y - qy * v.x + qw * v.z;
        return {
          x: v.x + 2 * (qy * cz - qz * cy),
          y: v.y + 2 * (qz * cx - qx * cz),
          z: v.z + 2 * (qx * cy - qy * cx),
        };
      }

      const worldCorners = corners.map((c) => {
        const r = rotate(worldPose.quaternion, c);
        return {
          x: r.x + worldPose.translation.x,
          y: r.y + worldPose.translation.y,
          z: r.z + worldPose.translation.z,
        };
      });

      const xs = worldCorners.map((c) => c.x);
      const ys = worldCorners.map((c) => c.y);
      const zs = worldCorners.map((c) => c.z);
      return {
        xMin: Math.min(...xs), xMax: Math.max(...xs),
        yMin: Math.min(...ys), yMax: Math.max(...ys),
        zMin: Math.min(...zs), zMax: Math.max(...zs),
      };
    }, cabinetId);
    console.log('[e2e] SC-11(b) leftSide world AABB =', JSON.stringify(leftSideAabb));

    const AABB_TOL = 1e-3;
    expect(Math.abs(leftSideAabb.xMin - 0), `xMin: ${JSON.stringify(leftSideAabb)}`).toBeLessThan(AABB_TOL);
    expect(Math.abs(leftSideAabb.xMax - 18), `xMax: ${JSON.stringify(leftSideAabb)}`).toBeLessThan(AABB_TOL);
    expect(Math.abs(leftSideAabb.yMin - 0), `yMin: ${JSON.stringify(leftSideAabb)}`).toBeLessThan(AABB_TOL);
    expect(Math.abs(leftSideAabb.yMax - 560), `yMax: ${JSON.stringify(leftSideAabb)}`).toBeLessThan(AABB_TOL);
    expect(Math.abs(leftSideAabb.zMin - 0), `zMin: ${JSON.stringify(leftSideAabb)}`).toBeLessThan(AABB_TOL);
    expect(Math.abs(leftSideAabb.zMax - 720), `zMax: ${JSON.stringify(leftSideAabb)}`).toBeLessThan(AABB_TOL);
  },
);

// ── TEST B: SC-11(c) — non-overlapping panels → 0 clashes ────────────────────

test(
  'SC-11(c): two non-overlapping panels (2mm gap) → 0 clashes, no false positives',
  async ({ page }) => {
    test.setTimeout(360_000);
    page.setDefaultTimeout(120_000);

    const consoleErrors: string[] = [];
    page.on('console', (m) => {
      if (m.text().startsWith('[e2e]')) console.log('BROWSER:', m.text());
      if (m.type() === 'error') consoleErrors.push(m.text());
    });
    page.on('pageerror', (e) => consoleErrors.push(`PAGEERROR: ${e.message}`));

    await page.goto('/');
    await waitForKernelReady(page);

    // 1. New assembly + materials
    await setupNewAssemblyWithMaterials(page);

    // 2. Panel A: 100×100×18 at Z=0 → world Z:[0,18]
    //    Panel B: 100×100×18 at Z=20 → world Z:[20,38]
    //    Gap between them: 20-18 = 2mm > clearanceThreshold=1mm → NOT a clearance hit.
    //    No interference (no volume overlap). Common() → no solid. Extrema dist=2mm > 1mm.
    //    Expected result: 0 rows.
    await placePanel(page, 'PanelA', 'PanelA.zipt', 0);
    await placePanel(page, 'PanelB', 'PanelB.zipt', 20);

    // Verify 2 components placed
    await page.waitForFunction(
      () => ((window as any).__zilventorStore?.getState().activeAssembly?.components.length ?? 0) >= 2,
      undefined,
      { timeout: 30_000 },
    );

    // 3. Run interference check with clearance=1.0mm
    await runClashCheck(page, 1.0);
    await waitForClashRan(page);

    // 4. SC-11(c): must be 0 clashes — proves no false positives for clearly-separated geometry.
    const count: number = await page.evaluate(() => (window as any).__zilventorClashCount());
    console.log('[e2e] SC-11(c) non-overlapping panels clash count =', count);
    expect(count, '2mm-gapped panels must report 0 clashes').toBe(0);

    // No unexpected console errors
    expect(consoleErrors.filter((e) => !e.includes('ResizeObserver'))).toHaveLength(0);
  },
);

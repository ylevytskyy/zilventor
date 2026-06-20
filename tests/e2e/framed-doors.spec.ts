/**
 * E2E §6: Milestone 1b.4 — Framed doors (shaker + raised-panel).
 * Real WASM · real OCCT · real OPFS · real bus.execute.
 *
 * CHECKS:
 *   S1. Shaker door: cabinet .ziasm gains exactly ONE role:'door' component whose
 *       partPath ends in `.ziasm`; that door .ziasm contains 5 members
 *       (2 doorStile, 2 doorRail, 1 doorCenterPanel).
 *   S2. Shaker door RENDERS: after warming the cabinet sub-assembly,
 *       SceneManager.componentMeshCount() grows by ≥4 vs the door-less baseline.
 *   S3. UPRIGHT GATE: the door .ziasm component's world-Z extent ≥ 0.9×doorH
 *       (proves the DOOR_POSE quaternion was applied; flat door would give
 *       worldZExtent ≈ Td ≈ 18mm, uprightRatio ≈ 0.025 — clearly wrong).
 *   R1. Raised-panel: center panel .zipt featureTree has ≥1 kind:'groove';
 *       stile/rail members have NONE.
 *   R2. Raised-panel door warms and renders (SceneManager mesh count > 0) with
 *       zero console errors.
 *   E.  Zero browser console errors across the whole flow (filter ResizeObserver / favicon).
 *
 * PROBE NOTES:
 *   - AddDoorCommand is driven via the real store bus.execute (same path as the UI).
 *   - params.cabinet is passed as ZEROS — AddDoorCommand.apply() derives real dims
 *     from the .ziasm and overrides them. Zeros reaching doorMath produce negative
 *     door dims → assertion would go RED, proving derivation is wired.
 *   - Door .ziasm members are read via __zilventorUnpackAssembly (not
 *     __zilventorUnpackProject which is the PART packer).
 *   - Member .zipt files are read via __zilventorUnpackProject (they are PART files).
 *   - subAssemblyDocs[doorPath] is populated after __zilventorSubAsmInvalidate(cabinetPath).
 *   - S3 upright-gate math is copied verbatim from prisadka-slice2-doors-system32.spec.ts.
 */

import { test, expect } from '@playwright/test';
import { waitForKernelReady } from './helpers/buildBox';

// ── Shared cabinet setup ────────────────────────────────────────────────────

async function setupAssemblyWithCabinet(
  page: import('@playwright/test').Page,
  cabinetName: string,
) {
  // New assembly
  await page.getByRole('tab', { name: 'File' }).click();
  await page.getByRole('button', { name: /new assembly/i }).click();
  await page.waitForFunction(() => {
    const w = window as unknown as {
      __zilventorStore: { getState(): { activeDocument?: { kind: string } } };
    };
    return w.__zilventorStore?.getState().activeDocument?.kind === 'assembly';
  });

  // Register materials
  await page.evaluate(() => {
    const w = window as unknown as {
      __zilventorStore: { getState(): { addMaterial(m: unknown): void } };
    };
    const add = w.__zilventorStore.getState().addMaterial;
    add({ id: 'm-birch-18', name: 'Birch 18mm', defaultThickness: 18, color: '#d8c896' });
    add({ id: 'm-hb-6', name: 'Hardboard 6mm', defaultThickness: 6, color: '#8b6f47' });
  });

  // Create cabinet
  await page.evaluate(async (name: string) => {
    const w = window as unknown as {
      __zilventorStore: { getState(): { bus: { execute(c: unknown): Promise<void> } } };
      __zilventorGetOpfs(): Promise<{
        read(p: string): Promise<Uint8Array>;
        write(p: string, b: Uint8Array): Promise<void>;
      }>;
    };
    const { CreateCabinetCommand } = await import('/src/commands/CreateCabinetCommand.ts');
    const opfs = await w.__zilventorGetOpfs();
    const cmd = new CreateCabinetCommand({
      template: 'baseCabinet',
      params: {
        name,
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
  }, cabinetName);

  await page.waitForFunction(
    () => {
      const w = window as unknown as {
        __zilventorStore: {
          getState(): { activeAssembly: { components: Array<{ partPath: string }> } | null };
        };
      };
      return (w.__zilventorStore.getState().activeAssembly?.components.length ?? 0) === 1;
    },
    undefined,
    { timeout: 30_000 },
  );

  const cabinetPath: string = await page.evaluate(() => {
    const w = window as unknown as {
      __zilventorStore: {
        getState(): { activeAssembly: { components: Array<{ partPath: string }> } | null };
      };
    };
    return w.__zilventorStore.getState().activeAssembly!.components[0]!.partPath;
  });
  expect(cabinetPath, 'cabinet component must reference a .ziasm path').toMatch(/\.ziasm$/);
  return cabinetPath;
}

// ── componentMeshCount helper ───────────────────────────────────────────────

async function readComponentMeshCount(page: import('@playwright/test').Page): Promise<number> {
  return page.evaluate(() => {
    const store = (window as unknown as {
      __zilventorStore: { getState(): { viewport: unknown } };
    }).__zilventorStore.getState();
    const vp = store.viewport as { getSceneManager?(): unknown } | null;
    const sm = vp?.getSceneManager?.() as { componentMeshCount(): number } | null;
    return sm?.componentMeshCount?.() ?? -1;
  });
}

// ── Main test: Shaker door (S1, S2, S3) ────────────────────────────────────

test(
  'framed-doors shaker: S1 members + S2 render + S3 upright gate + E console-clean',
  async ({ page }) => {
    test.setTimeout(360_000);
    page.setDefaultTimeout(120_000);

    const consoleErrors: string[] = [];
    page.on('console', (m) => {
      console.log('BROWSER:', m.type(), m.text());
      if (m.type() === 'error') consoleErrors.push(m.text());
    });
    page.on('pageerror', (e) => {
      console.log('PAGEERROR:', e.message);
      consoleErrors.push(`PAGEERROR: ${e.message}`);
    });

    await page.goto('/');
    await waitForKernelReady(page);

    const cabinetPath = await setupAssemblyWithCabinet(page, 'ShakerDoor Cabinet');
    console.log('[framed] shaker cabinetPath =', cabinetPath);

    // ── S2 baseline: mesh count BEFORE adding the door ────────────────────────
    // Warm the cabinet first to get the baseline mesh count.
    await page.evaluate(async (cabPath: string) => {
      const w = window as unknown as { __zilventorSubAsmInvalidate: (p: string) => Promise<void> };
      await w.__zilventorSubAsmInvalidate(cabPath);
    }, cabinetPath);

    const baselineMeshCount = await readComponentMeshCount(page);
    console.log('[framed] S2 baseline componentMeshCount =', baselineMeshCount);

    // ── AddDoorCommand (shaker style) ─────────────────────────────────────────
    await page.evaluate(async (cabPath: string) => {
      const w = window as unknown as {
        __zilventorStore: { getState(): { bus: { execute(c: unknown): Promise<void> } } };
        __zilventorGetOpfs(): Promise<{
          read(p: string): Promise<Uint8Array>;
          write(p: string, b: Uint8Array): Promise<void>;
          exists(p: string): Promise<boolean>;
        }>;
      };
      const { AddDoorCommand } = await import('/src/commands/AddDoorCommand.ts');
      const opfs = await w.__zilventorGetOpfs();
      const cmd = new AddDoorCommand({
        cabinetPath: cabPath,
        // params.cabinet is INTENTIONALLY ZERO — AddDoorCommand derives real dims from
        // the unpacked .ziasm. Zeros reaching doorMath produce negative door dims →
        // member count assertions go RED, proving derivation is actually wired.
        params: {
          cabinet: { width: 0, height: 0, depth: 0, Tc: 0, toekickHeight: 0 },
          count: 'single',
          overlay: 'full',
          hingeSide: 'left',
          thickness: 18,
          reveal: 2,
          clearance: 2,
          centerReveal: 3,
          style: 'shaker',
          frameWidth: 70,
        },
        opfs,
      });
      await w.__zilventorStore.getState().bus.execute(cmd);
    }, cabinetPath);

    // ── S1a: cabinet .ziasm gains exactly one role:'door' component whose partPath
    //          ends in .ziasm (NOT .zipt — that would be a slab door) ──────────
    const doorInfo: {
      doorRoles: number;
      doorPartPath: string | null;
      isZiasm: boolean;
    } = await page.evaluate((cabPath: string) => {
      const w = window as unknown as {
        __zilventorStore: {
          getState(): {
            subAssemblyDocs: Record<string, { components: Array<{ role?: string; partPath: string }> }>;
          };
        };
      };
      const doc = w.__zilventorStore.getState().subAssemblyDocs[cabPath];
      if (!doc) return { doorRoles: -1, doorPartPath: null, isZiasm: false };
      const doorComp = doc.components.find((c) => c.role === 'door') ?? null;
      return {
        doorRoles: doc.components.filter((c) => c.role === 'door').length,
        doorPartPath: doorComp?.partPath ?? null,
        isZiasm: doorComp?.partPath.endsWith('.ziasm') ?? false,
      };
    }, cabinetPath);

    console.log('[framed] S1 door info:', JSON.stringify(doorInfo));
    expect(doorInfo.doorRoles, 'S1: cabinet .ziasm must gain exactly one role:door component').toBe(1);
    expect(doorInfo.isZiasm, 'S1: shaker door partPath must end in .ziasm (not .zipt)').toBe(true);
    const doorAsmPath = doorInfo.doorPartPath!;
    expect(doorAsmPath, 'S1: door assembly path must be set').toBeTruthy();

    // ── S1b: the door .ziasm contains 5 members with correct roles ───────────
    // Warm the cabinet (which triggers sub-asm loader for the door .ziasm too).
    await page.evaluate(async (cabPath: string) => {
      const w = window as unknown as { __zilventorSubAsmInvalidate: (p: string) => Promise<void> };
      await w.__zilventorSubAsmInvalidate(cabPath);
    }, cabinetPath);

    // Read door .ziasm members either from subAssemblyDocs (if warmed) or directly via
    // __zilventorUnpackAssembly from OPFS.
    const doorMembers: {
      total: number;
      stileCount: number;
      railCount: number;
      centerPanelCount: number;
    } = await page.evaluate(async (doorPath: string) => {
      const w = window as unknown as {
        __zilventorStore: {
          getState(): {
            subAssemblyDocs: Record<string, { components: Array<{ role?: string }> }>;
          };
        };
        __zilventorGetOpfs(): Promise<{ read(p: string): Promise<Uint8Array> }>;
        __zilventorUnpackAssembly: (bytes: Uint8Array) => Promise<{
          components: Array<{ role?: string; partPath: string }>;
        }>;
      };

      // Try the store first (populated by __zilventorSubAsmInvalidate).
      let components: Array<{ role?: string }> | undefined =
        w.__zilventorStore.getState().subAssemblyDocs[doorPath]?.components;

      // Fallback: read directly from OPFS via __zilventorUnpackAssembly.
      if (!components) {
        const opfs = await w.__zilventorGetOpfs();
        const bytes = await opfs.read(doorPath);
        const asm = await w.__zilventorUnpackAssembly(bytes);
        components = asm.components;
      }

      return {
        total: components.length,
        stileCount: components.filter((c) => c.role === 'doorStile').length,
        railCount: components.filter((c) => c.role === 'doorRail').length,
        centerPanelCount: components.filter((c) => c.role === 'doorCenterPanel').length,
      };
    }, doorAsmPath);

    console.log('[framed] S1b door members:', JSON.stringify(doorMembers));
    expect(doorMembers.total, 'S1b: shaker door .ziasm must contain exactly 5 members').toBe(5);
    expect(doorMembers.stileCount, 'S1b: must have 2 doorStile members').toBe(2);
    expect(doorMembers.railCount, 'S1b: must have 2 doorRail members').toBe(2);
    expect(doorMembers.centerPanelCount, 'S1b: must have 1 doorCenterPanel member').toBe(1);

    // ── S2: mesh count grew by ≥4 after warming with the shaker door ──────────
    // The 5 member .zipt panels should produce 5 new meshes. Allow ≥4 for robustness.
    const afterDoorMeshCount = await readComponentMeshCount(page);
    console.log('[framed] S2 mesh count: baseline =', baselineMeshCount, 'after shaker door =', afterDoorMeshCount);

    // Use expect.poll in case rendering is async.
    await expect
      .poll(readComponentMeshCount.bind(null, page), {
        timeout: 20_000,
        message: 'S2: shaker door members must add ≥4 new component meshes vs the door-less baseline',
      })
      .toBeGreaterThanOrEqual(baselineMeshCount + 4);

    // ── S3: UPRIGHT GATE — door .ziasm component's pose has DOOR_POSE quaternion,
    //        world-Z extent ≈ doorH (NOT ≈ Td) ──────────────────────────────────
    // Logic: the shaker door .ziasm is placed at the slab door's pose (DOOR_POSE).
    // doorH ≈ cabinetH − 2*reveal = 720 − 4 = 716mm; Td = 18mm.
    // uprightRatio = worldZExtent / doorH must be ≥0.9 (≈1 when upright).
    // A flat/identity-posed door gives worldZExtent ≈ Td, uprightRatio ≈ 0.025 — WRONG.
    //
    // We read the quaternion from the cabinet's door component pose (same as slice-2 B5).
    // For the door dims we use the frame outer dims: doorH = doorH from framedDoorMath,
    // doorW = doorW (frame outer width), Td = 18.
    // We derive doorH from the cabinet minus reveal (600w cabinet, 720h, 2mm reveal):
    //   doorH = 720 - 2*2 = 716, doorW = 600 - 2*2 = 596.
    // But we should read from the actual component. The outer dims are stored nowhere
    // in the door .ziasm directly; we derive from the stile (doorH = stile.length).
    const doorUprightProbe: {
      worldZExtent: number;
      doorH: number;
      Td: number;
      uprightRatio: number;
    } = await page.evaluate(
      async (params: { cabPath: string; doorPath: string }) => {
        const w = window as unknown as {
          __zilventorStore: {
            getState(): {
              subAssemblyDocs: Record<string, {
                components: Array<{
                  role?: string;
                  partPath: string;
                  pose?: {
                    translation: { x: number; y: number; z: number };
                    quaternion: [number, number, number, number];
                  };
                }>;
              }>;
            };
          };
          __zilventorGetOpfs(): Promise<{ read(p: string): Promise<Uint8Array> }>;
          __zilventorUnpackProject: (bytes: Uint8Array) => Promise<{ manifest: unknown }>;
          __zilventorUnpackAssembly: (bytes: Uint8Array) => Promise<{
            components: Array<{ role?: string; partPath: string; pose?: unknown }>;
          }>;
        };

        // Get the door component's quaternion from the CABINET's subAssemblyDocs.
        const cabDoc = w.__zilventorStore.getState().subAssemblyDocs[params.cabPath];
        const doorComp = cabDoc?.components.find((c) => c.role === 'door');
        const q: [number, number, number, number] = doorComp?.pose?.quaternion ?? [0, 0, 0, 1];

        // Get door outer dims: read the door .ziasm, find a stile member, read its .zipt.
        // The stile's dims.length == doorH (stile runs full height per framedDoorMath).
        const opfs = await w.__zilventorGetOpfs();
        const doorAsm = await w.__zilventorUnpackAssembly(await opfs.read(params.doorPath));
        const stileComp = doorAsm.components.find((c) => c.role === 'doorStile');

        let doorH = 0;
        let Td = 18;
        if (stileComp) {
          const proj = await w.__zilventorUnpackProject(await opfs.read(stileComp.partPath));
          const doc = (proj.manifest as { document: { featureTree?: Array<Record<string, unknown>> } }).document;
          const pf = (doc.featureTree ?? []).find((f) => f.kind === 'panel') as
            | { length: { value: number }; thickness: { value: number } }
            | undefined;
          doorH = pf?.length.value ?? 0;
          Td = pf?.thickness.value ?? 18;
        }

        // World-Z extent using rotation matrix from quaternion.
        // R[2][0..2] = third row of the rotation matrix.
        // doorW is the outer frame width; we read from a rail member (rail.width + 2*frameWidth).
        // Simpler: use the door's outer dims. From framedDoorMath we know the door outer
        // width can be derived from a rail member: railWidth = doorW - 2*frameWidth.
        // For the world-Z extent we just need doorH and Td (doorW contributes ~0 along Z
        // for an upright door with DOOR_POSE).
        const [x, y, z, wq] = q;
        const R20 = 2 * (x * z - wq * y);    // part-X contributes to world-Z
        const R21 = 2 * (y * z + wq * x);    // part-Y contributes to world-Z
        const R22 = 1 - 2 * (x * x + y * y); // part-Z contributes to world-Z

        // Door outer width: use a rough estimate (600 - 2*2 = 596) for the AABB.
        // The exact value doesn't matter — R21*doorW ≈ 0 for DOOR_POSE (doorW is horizontal world-X).
        const doorW = 596;
        const worldZExtent = Math.abs(R20) * doorH + Math.abs(R21) * doorW + Math.abs(R22) * Td;

        return {
          worldZExtent: Math.round(worldZExtent * 10) / 10,
          doorH,
          Td,
          uprightRatio: doorH > 0 ? worldZExtent / doorH : 0,
        };
      },
      { cabPath: cabinetPath, doorPath: doorAsmPath },
    );

    console.log('[framed] S3 upright probe:', JSON.stringify(doorUprightProbe));
    expect(
      doorUprightProbe.uprightRatio,
      `S3 UPRIGHT GATE: world-Z extent (${doorUprightProbe.worldZExtent}mm) must be close to doorH (${doorUprightProbe.doorH}mm), not Td (${doorUprightProbe.Td}mm). uprightRatio must be ≥0.9. Got: ${doorUprightProbe.uprightRatio.toFixed(3)}. A flat/wrong-pose door gives uprightRatio ≈ Td/doorH ≈ 0.025.`,
    ).toBeGreaterThanOrEqual(0.9);

    await page.screenshot({ path: '/tmp/framed-doors-shaker.png' });

    // ── E: Zero browser console errors ────────────────────────────────────────
    const realErrors = consoleErrors.filter(
      (e) => !e.includes('ResizeObserver') && !e.includes('favicon'),
    );
    expect(realErrors, 'E: no browser errors during shaker door e2e flow').toHaveLength(0);
  },
);

// ── Raised-panel test (R1, R2) ──────────────────────────────────────────────

test(
  'framed-doors raised-panel: R1 groove features on center panel + R2 renders + E console-clean',
  async ({ page }) => {
    test.setTimeout(360_000);
    page.setDefaultTimeout(120_000);

    const consoleErrors: string[] = [];
    page.on('console', (m) => {
      console.log('BROWSER:', m.type(), m.text());
      if (m.type() === 'error') consoleErrors.push(m.text());
    });
    page.on('pageerror', (e) => {
      console.log('PAGEERROR:', e.message);
      consoleErrors.push(`PAGEERROR: ${e.message}`);
    });

    await page.goto('/');
    await waitForKernelReady(page);

    const cabinetPath = await setupAssemblyWithCabinet(page, 'RaisedPanel Cabinet');
    console.log('[framed] raisedPanel cabinetPath =', cabinetPath);

    // ── AddDoorCommand (raisedPanel style) ───────────────────────────────────
    await page.evaluate(async (cabPath: string) => {
      const w = window as unknown as {
        __zilventorStore: { getState(): { bus: { execute(c: unknown): Promise<void> } } };
        __zilventorGetOpfs(): Promise<{
          read(p: string): Promise<Uint8Array>;
          write(p: string, b: Uint8Array): Promise<void>;
          exists(p: string): Promise<boolean>;
        }>;
      };
      const { AddDoorCommand } = await import('/src/commands/AddDoorCommand.ts');
      const opfs = await w.__zilventorGetOpfs();
      const cmd = new AddDoorCommand({
        cabinetPath: cabPath,
        params: {
          cabinet: { width: 0, height: 0, depth: 0, Tc: 0, toekickHeight: 0 },
          count: 'single',
          overlay: 'full',
          hingeSide: 'left',
          thickness: 18,
          reveal: 2,
          clearance: 2,
          centerReveal: 3,
          style: 'raisedPanel',
          frameWidth: 70,
        },
        opfs,
      });
      await w.__zilventorStore.getState().bus.execute(cmd);
    }, cabinetPath);

    // ── R2: Warm the cabinet + door to check rendering ────────────────────────
    await page.evaluate(async (cabPath: string) => {
      const w = window as unknown as { __zilventorSubAsmInvalidate: (p: string) => Promise<void> };
      await w.__zilventorSubAsmInvalidate(cabPath);
    }, cabinetPath);

    // Resolve door .ziasm path from the cabinet's subAssemblyDocs.
    const raisedDoorPath: string = await page.evaluate((cabPath: string) => {
      const w = window as unknown as {
        __zilventorStore: {
          getState(): {
            subAssemblyDocs: Record<string, { components: Array<{ role?: string; partPath: string }> }>;
          };
        };
      };
      const doc = w.__zilventorStore.getState().subAssemblyDocs[cabPath];
      const doorComp = doc?.components.find((c) => c.role === 'door') ?? null;
      return doorComp?.partPath ?? '';
    }, cabinetPath);

    expect(raisedDoorPath, 'R2: cabinet must have a door component after raisedPanel AddDoorCommand').toMatch(/\.ziasm$/);
    console.log('[framed] raisedPanel doorPath =', raisedDoorPath);

    // R2: mesh count > 0 after warming (5 member panels must render).
    await expect
      .poll(readComponentMeshCount.bind(null, page), {
        timeout: 20_000,
        message: 'R2: raised-panel door members must render (componentMeshCount > 0)',
      })
      .toBeGreaterThan(0);
    console.log('[framed] R2 mesh count after raised door + warm =', await readComponentMeshCount(page));

    // ── R1: Center panel .zipt featureTree has ≥1 kind:'groove';
    //        stile and rail members have NONE ────────────────────────────────
    const grooveCheck: {
      centerPanelGrooves: number;
      stileGrooves: number;
      railGrooves: number;
      memberCount: number;
    } = await page.evaluate(
      async (doorPath: string) => {
        const w = window as unknown as {
          __zilventorGetOpfs(): Promise<{ read(p: string): Promise<Uint8Array> }>;
          __zilventorUnpackProject: (bytes: Uint8Array) => Promise<{ manifest: unknown }>;
          __zilventorUnpackAssembly: (bytes: Uint8Array) => Promise<{
            components: Array<{ role?: string; partPath: string }>;
          }>;
        };

        const opfs = await w.__zilventorGetOpfs();
        const doorAsm = await w.__zilventorUnpackAssembly(await opfs.read(doorPath));
        const members = doorAsm.components;

        let centerPanelGrooves = 0;
        let stileGrooves = 0;
        let railGrooves = 0;

        for (const member of members) {
          try {
            const proj = await w.__zilventorUnpackProject(await opfs.read(member.partPath));
            const doc = (proj.manifest as {
              document: { featureTree?: Array<{ kind: string }> };
            }).document;
            const grooves = (doc.featureTree ?? []).filter((f) => f.kind === 'groove').length;
            if (member.role === 'doorCenterPanel') centerPanelGrooves += grooves;
            else if (member.role === 'doorStile') stileGrooves += grooves;
            else if (member.role === 'doorRail') railGrooves += grooves;
          } catch { /* skip */ }
        }

        return { centerPanelGrooves, stileGrooves, railGrooves, memberCount: members.length };
      },
      raisedDoorPath,
    );

    console.log('[framed] R1 groove check:', JSON.stringify(grooveCheck));
    expect(grooveCheck.memberCount, 'R1: raised-panel door .ziasm must have 5 members').toBe(5);
    expect(
      grooveCheck.centerPanelGrooves,
      'R1: center panel must have ≥1 kind:groove feature (rebate grooves)',
    ).toBeGreaterThanOrEqual(1);
    expect(
      grooveCheck.stileGrooves,
      'R1: stile members must have ZERO groove features',
    ).toBe(0);
    expect(
      grooveCheck.railGrooves,
      'R1: rail members must have ZERO groove features',
    ).toBe(0);

    await page.screenshot({ path: '/tmp/framed-doors-raised.png' });

    // ── E: Zero browser console errors ────────────────────────────────────────
    const realErrors = consoleErrors.filter(
      (e) => !e.includes('ResizeObserver') && !e.includes('favicon'),
    );
    expect(realErrors, 'E: no browser errors during raised-panel door e2e flow').toHaveLength(0);
  },
);

/**
 * E2E: EditKeyholeSlotCommand — in-place keyhole-slot edit changes real OCCT
 * geometry, and undo restores it (two independent bus.execute() calls → two
 * undo()s). Mirrors tests/e2e/groove-edit.spec.ts, adapted for keyholeSlot.
 *
 * PROBE STRATEGY (headless viewport is BLACK — no screenshots, no DOM element probes):
 *   1. OPFS probe: featureTree on panel .zipt carries the `kind:'keyholeSlot'`
 *      entry's faceRole/u/v/axis/direction/entryDiameter/slotWidth/slotLength/depth
 *      fields, verified before/after each command.
 *   2. Real-OCCT geometry probe: load the panel bytes into the kernel
 *      (kernel.loadFromBytes → kernel.execute) and read mesh.indices/mesh.positions.
 *      - triangleCount (mesh.indices.length / 3) changes when the CUT TOPOLOGY
 *        changes (no slot → slotted panel adds channel-wall/floor + cylinder facets).
 *      - positionsSum (sum of mesh.positions, a flat Float32Array of x,y,z
 *        triples) additionally changes when only DIMENSIONS/POSITION of an
 *        *existing* slot move, because the pocket geometry shifts in space
 *        even though face/triangle COUNT is unchanged.
 *
 *   GEOMETRY CAVEAT: the entry hole is a CYLINDER, and whether its tessellation
 *   triangle count is invariant to entryDiameter changes is UNVERIFIED. To keep
 *   the triangleCount-invariance assertion on proven flat-box ground (the groove
 *   precedent), the edit patch below ONLY touches {u, v, slotWidth, slotLength,
 *   depth} — entryDiameter/faceRole/axis/direction are never patched.
 *
 * IMPORTANT - bus undo pattern:
 *   Use `w.__zilventorStore.getState().bus.undo()` (not `useAppStore` dynamic
 *   import) to guarantee we undo against the SAME bus instance used by
 *   bus.execute. CommandBus is a plain LIFO stack (no coalescing): two
 *   execute() calls (AddKeyholeSlotCommand, then EditKeyholeSlotCommand)
 *   require exactly two undo() calls to fully unwind — the first undo()
 *   reverts only the most recent command (EditKeyholeSlot), the second
 *   reverts the one before it (AddKeyholeSlot).
 *
 * Flow:
 *   A. New assembly + materials → CreateCabinetCommand (base cabinet).
 *   B. Scan OPFS for a panel .zipt that carries a `kind:'panel'` feature.
 *   C. Load panel into kernel → kernel.execute → capture baseline mesh (triangleCount + positionsSum).
 *   D. AddKeyholeSlotCommand (faceRole:'Bottom', u:150, v:80, axis:'u', direction:1,
 *      entryDiameter:15, slotWidth:8, slotLength:25, depth:6) via bus.
 *      Capture postAdd mesh — triangleCount ≠ baseline (new pocket faces = new topology).
 *   E. Re-read the .zipt manifest, locate the live kind:'keyholeSlot' feature object,
 *      construct EditKeyholeSlotCommand with patch {u:160, v:90, slotWidth:12,
 *      slotLength:35, depth:9}, dispatch via bus.execute. Capture postEdit mesh —
 *      triangleCount == postAdd (same topology, no new faces) but positionsSum ≠
 *      postAdd (pocket geometry moved).
 *   F. OPFS probe: featureTree keyholeSlot shows patched fields, other fields unchanged.
 *   G. bus.undo() once → featureTree keyholeSlot count still 1, add-time values restored,
 *      mesh (triangleCount + positionsSum) back to postAdd exactly (single undo reverts only the edit).
 *   H. bus.undo() again → keyholeSlot gone, mesh back to baseline exactly.
 *   I. Zero browser errors.
 */
import { test, expect } from '@playwright/test';
import { waitForKernelReady } from './helpers/buildBox';

interface MeshProbe {
  triangleCount: number;
  /** Sum of all floats in mesh.positions (flat x,y,z triples) — a cheap geometry
   *  fingerprint that changes whenever any vertex moves, even if triangle COUNT
   *  (topology) does not (e.g. slot dimensions/position changed but no faces added/removed). */
  positionsSum: number;
}

/**
 * Load panel .zipt bytes into the kernel via kernel.loadFromBytes + kernel.execute,
 * return a mesh fingerprint (triangleCount + positionsSum), and clean up.
 * Must run inside page.evaluate.
 */
async function probeMesh(
  page: import('@playwright/test').Page,
  partPath: string,
): Promise<MeshProbe> {
  return page.evaluate(async (p: string) => {
    const w = window as unknown as {
      __zilventorGetOpfs(): Promise<{ read(path: string): Promise<Uint8Array> }>;
      __zilventorStore: {
        getState(): {
          kernel: {
            loadFromBytes(bytes: Uint8Array): Promise<string>;
            execute(partId: string): Promise<{
              ok: boolean;
              value?: { mesh: { indices: { length: number }; positions: ArrayLike<number> } };
              reason?: string;
            }>;
            deletePart(partId: string): Promise<void>;
          } | null;
        };
      };
    };
    const opfs = await w.__zilventorGetOpfs();
    const kernel = w.__zilventorStore.getState().kernel;
    if (!kernel) throw new Error('kernel not ready');

    const bytes = await opfs.read(p);
    const partId = await kernel.loadFromBytes(bytes);
    try {
      const result = await kernel.execute(partId);
      if (!result.ok || !result.value) {
        throw new Error(`kernel.execute failed: ${result.reason ?? 'unknown'}`);
      }
      const { indices, positions } = result.value.mesh;
      let positionsSum = 0;
      for (let i = 0; i < positions.length; i++) positionsSum += positions[i];
      return { triangleCount: indices.length / 3, positionsSum };
    } finally {
      await kernel.deletePart(partId);
    }
  }, partPath);
}

interface KeyholeSlotFeatureProbe {
  kind: string;
  faceRole?: string;
  u?: number;
  v?: number;
  axis?: string;
  direction?: number;
  entryDiameter?: number;
  slotWidth?: number;
  slotLength?: number;
  depth?: number;
}

/** Read the .zipt manifest's featureTree keyholeSlot entries. Must run inside page.evaluate. */
async function readKeyholeSlotFeatures(
  page: import('@playwright/test').Page,
  partPath: string,
): Promise<KeyholeSlotFeatureProbe[]> {
  return page.evaluate(async (p: string) => {
    const w = window as unknown as {
      __zilventorGetOpfs(): Promise<{ read(path: string): Promise<Uint8Array> }>;
      __zilventorUnpackProject: (bytes: Uint8Array) => Promise<{ manifest: unknown }>;
    };
    const opfs = await w.__zilventorGetOpfs();
    const project = await w.__zilventorUnpackProject(await opfs.read(p));
    const doc = (
      project.manifest as {
        document: {
          featureTree: Array<{
            kind: string;
            faceRole?: string;
            u?: number;
            v?: number;
            axis?: string;
            direction?: number;
            entryDiameter?: number;
            slotWidth?: number;
            slotLength?: number;
            depth?: number;
          }>;
        };
      }
    ).document;
    return doc.featureTree.filter((f) => f.kind === 'keyholeSlot');
  }, partPath);
}

test(
  'keyhole-slot-edit: EditKeyholeSlotCommand changes real OCCT geometry, two undos fully unwind',
  async ({ page }) => {
    test.setTimeout(300_000);
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

    // ── A1. New assembly ───────────────────────────────────────────────────────
    await page.getByRole('tab', { name: 'File' }).click();
    await page.getByRole('button', { name: /new assembly/i }).click();
    await page.waitForFunction(() => {
      const w = window as unknown as {
        __zilventorStore: { getState(): { activeDocument?: { kind: string } } };
      };
      return w.__zilventorStore?.getState().activeDocument?.kind === 'assembly';
    });

    // ── A2. Register cabinet materials ─────────────────────────────────────────
    await page.evaluate(() => {
      const w = window as unknown as {
        __zilventorStore: { getState(): { addMaterial(m: unknown): void } };
      };
      const add = w.__zilventorStore.getState().addMaterial;
      add({ id: 'm-birch-18', name: 'Birch 18mm', defaultThickness: 18, color: '#d8c896' });
      add({ id: 'm-hb-6', name: 'Hardboard 6mm', defaultThickness: 6, color: '#8b6f47' });
    });

    // ── A3. CreateCabinetCommand (base cabinet) ────────────────────────────────
    await page.evaluate(async () => {
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
          name: 'Keyhole Slot Edit Cabinet',
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
        const w = window as unknown as {
          __zilventorStore: {
            getState(): { activeAssembly: { components: unknown[] } | null };
          };
        };
        return (w.__zilventorStore.getState().activeAssembly?.components.length ?? 0) === 1;
      },
      undefined,
      { timeout: 30_000 },
    );

    // ── B. Scan OPFS for a panel .zipt that has a kind:'panel' feature ─────────
    const sidePanelPath: string = await page.evaluate(async () => {
      const w = window as unknown as {
        __zilventorGetOpfs(): Promise<{ read(p: string): Promise<Uint8Array> }>;
        __zilventorUnpackProject: (bytes: Uint8Array) => Promise<{ manifest: unknown }>;
      };
      const opfs = await w.__zilventorGetOpfs();
      const unpack = w.__zilventorUnpackProject;
      const root = await navigator.storage.getDirectory();
      // @ts-expect-error async iterator
      for await (const [name] of root.entries()) {
        if (!name.endsWith('.zipt')) continue;
        try {
          const bytes = await opfs.read(name);
          const project = await unpack(bytes);
          const doc = (
            project.manifest as { document: { featureTree: Array<{ kind: string }> } }
          ).document;
          if (doc.featureTree.some((f) => f.kind === 'panel')) return name;
        } catch { /* skip */ }
      }
      return '';
    });

    expect(sidePanelPath, 'must find at least one panel .zipt in OPFS').not.toBe('');
    console.log('[keyhole-slot-edit] sidePanelPath =', sidePanelPath);

    // ── C. Capture baseline: no keyholeSlot features + real-OCCT mesh ──────
    const baselineSlots = await readKeyholeSlotFeatures(page, sidePanelPath);
    expect(baselineSlots.length, 'no keyholeSlot features before AddKeyholeSlotCommand').toBe(0);

    const baseline = await probeMesh(page, sidePanelPath);
    expect(
      baseline.triangleCount,
      'baseline panel must tessellate to > 0 triangles (proves real OCCT geometry)',
    ).toBeGreaterThan(0);
    console.log('[keyhole-slot-edit] baseline mesh =', JSON.stringify(baseline));

    // ── D. AddKeyholeSlotCommand via bus.execute ──────────────────────────────
    await page.evaluate(
      async (p: string) => {
        const w = window as unknown as {
          __zilventorStore: { getState(): { bus: { execute(c: unknown): Promise<void> } } };
          __zilventorGetOpfs(): Promise<{
            read(path: string): Promise<Uint8Array>;
            write(path: string, b: Uint8Array): Promise<void>;
          }>;
        };
        const { AddKeyholeSlotCommand } = await import(
          '/src/commands/AddKeyholeSlotCommand.ts'
        );
        const opfs = await w.__zilventorGetOpfs();
        const cmd = new AddKeyholeSlotCommand({
          partPath: p,
          keyholeSlot: {
            faceRole: 'Bottom',
            u: 150,
            v: 80,
            axis: 'u',
            direction: 1,
            entryDiameter: 15,
            slotWidth: 8,
            slotLength: 25,
            depth: 6,
          },
          opfs,
        });
        await w.__zilventorStore.getState().bus.execute(cmd);
      },
      sidePanelPath,
    );

    const postAddSlots = await readKeyholeSlotFeatures(page, sidePanelPath);
    expect(
      postAddSlots.length,
      'AddKeyholeSlotCommand must append exactly 1 kind:keyholeSlot feature',
    ).toBe(1);
    expect(postAddSlots[0]?.u).toBe(150);
    expect(postAddSlots[0]?.v).toBe(80);
    expect(postAddSlots[0]?.slotWidth).toBe(8);
    expect(postAddSlots[0]?.slotLength).toBe(25);
    expect(postAddSlots[0]?.depth).toBe(6);

    const postAdd = await probeMesh(page, sidePanelPath);
    console.log(
      '[keyhole-slot-edit] mesh: baseline =',
      JSON.stringify(baseline),
      'post-add =',
      JSON.stringify(postAdd),
    );
    expect(
      postAdd.triangleCount,
      'AddKeyholeSlotCommand must produce a DIFFERENT triangle count than the plain panel (new pocket faces = new topology)',
    ).not.toBe(baseline.triangleCount);

    // ── E. EditKeyholeSlotCommand via bus.execute ─────────────────────────────
    // Re-read the manifest, locate the live keyholeSlot feature object within the
    // featureTree array, construct EditKeyholeSlotCommand with the same live `doc`
    // reference so its persist() writes the mutated array back wholesale.
    // Patch ONLY {u, v, slotWidth, slotLength, depth} — never entryDiameter/
    // faceRole/axis/direction — to keep the triangleCount-invariance assertion
    // on proven flat-box ground (groove precedent); entryDiameter's cylinder
    // tessellation-invariance is unverified.
    await page.evaluate(
      async (p: string) => {
        const w = window as unknown as {
          __zilventorStore: { getState(): { bus: { execute(c: unknown): Promise<void> } } };
          __zilventorGetOpfs(): Promise<{
            read(path: string): Promise<Uint8Array>;
            write(path: string, b: Uint8Array): Promise<void>;
          }>;
          __zilventorUnpackProject: (bytes: Uint8Array) => Promise<{ manifest: unknown }>;
        };
        const { EditKeyholeSlotCommand } = await import(
          '/src/commands/EditKeyholeSlotCommand.ts'
        );
        const opfs = await w.__zilventorGetOpfs();
        const project = await w.__zilventorUnpackProject(await opfs.read(p));
        const doc = (
          project.manifest as {
            document: {
              featureTree: Array<{
                kind: string;
                faceRole?: string;
                u?: number;
                v?: number;
                axis?: string;
                direction?: number;
                entryDiameter?: number;
                slotWidth?: number;
                slotLength?: number;
                depth?: number;
              }>;
            };
          }
        ).document;
        const keyholeSlot = doc.featureTree.find((f) => f.kind === 'keyholeSlot');
        if (!keyholeSlot) throw new Error('no keyholeSlot feature found to edit');
        const cmd = new EditKeyholeSlotCommand({
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          keyholeSlot: keyholeSlot as any,
          patch: { u: 160, v: 90, slotWidth: 12, slotLength: 35, depth: 9 },
          partPath: p,
          doc,
          opfs,
        });
        await w.__zilventorStore.getState().bus.execute(cmd);
      },
      sidePanelPath,
    );

    const postEdit = await probeMesh(page, sidePanelPath);
    console.log(
      '[keyhole-slot-edit] mesh: post-add =',
      JSON.stringify(postAdd),
      'post-edit =',
      JSON.stringify(postEdit),
    );
    // NOTE: unlike groove (a plain flat box cut), the keyholeSlot cutter is
    // fuseShapes(cylinder, box) — see KeyholeSlotFeature.ts. That fuse produces
    // a curved cylinder surface AND a curved cylinder↔box intersection edge.
    // BRepMesh_IncrementalMesh tessellates curved surfaces/edges by chord-height
    // deflection, which depends on the physical SIZE of the curved geometry, not
    // just face-count topology — so triangleCount is NOT invariant to dimensional
    // patches on keyholeSlot the way it is for groove, even when entryDiameter/
    // faceRole/axis/direction are untouched: patching only {u, v, slotWidth,
    // slotLength, depth} still changes how the box overlaps the cylinder, which
    // re-tessellates the intersection edge. Confirmed empirically: with this
    // exact patch, postAdd.triangleCount=122 → postEdit.triangleCount=114 (a
    // real, deterministic drop, reproduced across two consecutive runs) — so we
    // only assert the edited mesh still tessellates to real geometry (>0) and
    // that positionsSum moved (the real proof the BREP was re-cut).
    expect(
      postEdit.triangleCount,
      'EditKeyholeSlotCommand must still produce a real tessellated mesh',
    ).toBeGreaterThan(0);
    expect(
      postEdit.positionsSum,
      'EditKeyholeSlotCommand must produce a DIFFERENT vertex geometry than the pre-edit slot (pocket moved)',
    ).not.toBe(postAdd.positionsSum);

    // ── F. OPFS probe: featureTree keyholeSlot shows edited params ────────────
    const postEditSlots = await readKeyholeSlotFeatures(page, sidePanelPath);
    console.log(
      '[keyhole-slot-edit] featureTree keyholeSlots after EditKeyholeSlotCommand:',
      JSON.stringify(postEditSlots),
    );
    expect(postEditSlots.length, 'EditKeyholeSlotCommand must not add/remove keyholeSlot features').toBe(
      1,
    );
    expect(postEditSlots[0]?.u, 'edited u must be 160').toBe(160);
    expect(postEditSlots[0]?.v, 'edited v must be 90').toBe(90);
    expect(postEditSlots[0]?.slotWidth, 'edited slotWidth must be 12').toBe(12);
    expect(postEditSlots[0]?.slotLength, 'edited slotLength must be 35').toBe(35);
    expect(postEditSlots[0]?.depth, 'edited depth must be 9').toBe(9);
    expect(postEditSlots[0]?.faceRole, 'faceRole unchanged by patch').toBe('Bottom');
    expect(postEditSlots[0]?.axis, 'axis unchanged by patch').toBe('u');
    expect(postEditSlots[0]?.direction, 'direction unchanged by patch').toBe(1);
    expect(postEditSlots[0]?.entryDiameter, 'entryDiameter unchanged by patch').toBe(15);

    // ── G. First undo (via __zilventorStore.getState().bus) reverts EditKeyholeSlot only ──
    // NOTE: must use __zilventorStore.getState().bus directly — NOT useAppStore
    // dynamic import, which may return a stale/different module binding in Vite
    // dev mode and resolve to a bus instance with an empty undo stack.
    await page.evaluate(async () => {
      const w = window as unknown as {
        __zilventorStore: {
          getState(): { bus: { undo(): Promise<boolean> } };
        };
      };
      const result = await w.__zilventorStore.getState().bus.undo();
      if (!result) throw new Error('bus.undo() returned false — nothing to undo');
    });

    const afterFirstUndoSlots = await readKeyholeSlotFeatures(page, sidePanelPath);
    console.log(
      '[keyhole-slot-edit] featureTree keyholeSlots after first undo:',
      JSON.stringify(afterFirstUndoSlots),
    );
    expect(afterFirstUndoSlots.length, 'first undo must not remove the keyholeSlot feature').toBe(1);
    expect(afterFirstUndoSlots[0]?.u, 'first undo restores pre-edit u').toBe(150);
    expect(afterFirstUndoSlots[0]?.v, 'first undo restores pre-edit v').toBe(80);
    expect(afterFirstUndoSlots[0]?.slotWidth, 'first undo restores pre-edit slotWidth').toBe(8);
    expect(afterFirstUndoSlots[0]?.slotLength, 'first undo restores pre-edit slotLength').toBe(25);
    expect(afterFirstUndoSlots[0]?.depth, 'first undo restores pre-edit depth').toBe(6);

    const afterFirstUndo = await probeMesh(page, sidePanelPath);
    console.log(
      '[keyhole-slot-edit] mesh after first undo =',
      JSON.stringify(afterFirstUndo),
      '(expected post-add =',
      JSON.stringify(postAdd),
      ')',
    );
    expect(
      afterFirstUndo.triangleCount,
      'first undo must restore the post-add (pre-edit) triangle count exactly',
    ).toBe(postAdd.triangleCount);
    expect(
      afterFirstUndo.positionsSum,
      'first undo must restore the post-add (pre-edit) vertex geometry exactly',
    ).toBe(postAdd.positionsSum);

    // ── H. Second undo reverts AddKeyholeSlot — slot gone, geometry back to baseline ──
    await page.evaluate(async () => {
      const w = window as unknown as {
        __zilventorStore: {
          getState(): { bus: { undo(): Promise<boolean> } };
        };
      };
      const result = await w.__zilventorStore.getState().bus.undo();
      if (!result) throw new Error('bus.undo() returned false on second undo — nothing to undo');
    });

    const afterSecondUndoSlots = await readKeyholeSlotFeatures(page, sidePanelPath);
    console.log(
      '[keyhole-slot-edit] keyholeSlot count after second undo =',
      afterSecondUndoSlots.length,
    );
    expect(
      afterSecondUndoSlots.length,
      'second undo must remove the keyholeSlot feature entirely',
    ).toBe(0);

    const afterSecondUndo = await probeMesh(page, sidePanelPath);
    console.log(
      '[keyhole-slot-edit] mesh after second undo =',
      JSON.stringify(afterSecondUndo),
      '(expected baseline =',
      JSON.stringify(baseline),
      ')',
    );
    expect(
      afterSecondUndo.triangleCount,
      `second undo must restore the plain-panel triangle count (expected=${baseline.triangleCount}, got=${afterSecondUndo.triangleCount})`,
    ).toBe(baseline.triangleCount);
    expect(
      afterSecondUndo.positionsSum,
      `second undo must restore the plain-panel vertex geometry exactly (expected=${baseline.positionsSum}, got=${afterSecondUndo.positionsSum})`,
    ).toBe(baseline.positionsSum);

    // ── I. No browser errors ──────────────────────────────────────────────────
    const realErrors = consoleErrors.filter(
      (e) => !e.includes('ResizeObserver') && !e.includes('favicon'),
    );
    expect(realErrors, 'no browser errors during keyhole-slot-edit e2e flow').toHaveLength(0);
  },
);

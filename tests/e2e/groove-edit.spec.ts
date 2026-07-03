/**
 * E2E: EditGrooveCommand — in-place groove edit changes real OCCT geometry,
 * and undo restores it (two independent bus.execute() calls → two undo()s).
 *
 * PROBE STRATEGY (headless viewport is BLACK — no screenshots, no DOM element probes):
 *   1. OPFS probe: featureTree on panel .zipt carries the `kind:'groove'` entry's
 *      faceRole/axis/position/width/depth fields, verified before/after each command.
 *   2. Real-OCCT geometry probe: load the panel bytes into the kernel
 *      (kernel.loadFromBytes → kernel.execute) and read mesh.indices/mesh.positions.
 *      - triangleCount (mesh.indices.length / 3) changes when the CUT TOPOLOGY
 *        changes (no groove → grooved panel adds channel-wall/floor faces).
 *      - positionsSum (sum of mesh.positions, a flat Float32Array of x,y,z
 *        triples) additionally changes when only DIMENSIONS of an *existing*
 *        groove move (width/depth/position), because the channel floor/walls
 *        shift in space even though face/triangle COUNT is unchanged — flat,
 *        straight-edged faces tessellate to the same number of triangles
 *        regardless of size (confirmed against Tessellator.ts / BRepMesh_IncrementalMesh:
 *        triangle count is topology-dependent, not dimension-dependent, for
 *        this axis-aligned box-cut groove). So the edit-only assertion uses
 *        positionsSum, not triangleCount, to prove the BREP was re-cut.
 *
 * IMPORTANT - bus undo pattern:
 *   Use `w.__zilventorStore.getState().bus.undo()` (not `useAppStore` dynamic import)
 *   to guarantee we undo against the SAME bus instance used by bus.execute.
 *   CommandBus is a plain LIFO stack (no coalescing): two execute() calls
 *   (AddGrooveCommand, then EditGrooveCommand) require exactly two undo() calls
 *   to fully unwind — the first undo() reverts only the most recent command
 *   (EditGroove), the second reverts the one before it (AddGroove).
 *
 * Flow:
 *   A. New assembly + materials → CreateCabinetCommand (base cabinet).
 *   B. Scan OPFS for a panel .zipt that carries a `kind:'panel'` feature.
 *   C. Load panel into kernel → kernel.execute → capture baseline mesh (triangleCount + positionsSum).
 *   D. AddGrooveCommand (faceRole:'Top', axis:'u', position:50, width:6, depth:9) via bus.
 *      Capture postAdd mesh — triangleCount ≠ baseline (new channel faces = new topology).
 *   E. Re-read the .zipt manifest, locate the live kind:'groove' feature object,
 *      construct EditGrooveCommand with patch {width:12, depth:15, position:80},
 *      dispatch via bus.execute. Capture postEdit mesh — triangleCount == postAdd
 *      (same topology, no new faces) but positionsSum ≠ postAdd (channel geometry moved).
 *   F. OPFS probe: featureTree groove shows width:12/depth:15/position:80.
 *   G. bus.undo() once → featureTree groove count still 1, width:6/depth:9/position:50,
 *      mesh (triangleCount + positionsSum) back to postAdd exactly (single undo reverts only the edit).
 *   H. bus.undo() again → groove gone, mesh back to baseline exactly.
 *   I. Zero browser errors.
 */
import { test, expect } from '@playwright/test';
import { waitForKernelReady } from './helpers/buildBox';

interface MeshProbe {
  triangleCount: number;
  /** Sum of all floats in mesh.positions (flat x,y,z triples) — a cheap geometry
   *  fingerprint that changes whenever any vertex moves, even if triangle COUNT
   *  (topology) does not (e.g. groove dimensions changed but no faces added/removed). */
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

/** Read the .zipt manifest's featureTree groove entries. Must run inside page.evaluate. */
async function readGrooveFeatures(
  page: import('@playwright/test').Page,
  partPath: string,
): Promise<
  Array<{
    kind: string;
    faceRole?: string;
    axis?: string;
    position?: number;
    width?: number;
    depth?: number;
  }>
> {
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
            axis?: string;
            position?: number;
            width?: number;
            depth?: number;
          }>;
        };
      }
    ).document;
    return doc.featureTree.filter((f) => f.kind === 'groove');
  }, partPath);
}

test(
  'groove-edit: EditGrooveCommand changes real OCCT geometry, two undos fully unwind',
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
          name: 'Groove Edit Cabinet',
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
    console.log('[groove-edit] sidePanelPath =', sidePanelPath);

    // ── C. Capture baseline: no groove features + real-OCCT mesh ──────
    const baselineGrooves = await readGrooveFeatures(page, sidePanelPath);
    expect(baselineGrooves.length, 'no groove features before AddGrooveCommand').toBe(0);

    const baseline = await probeMesh(page, sidePanelPath);
    expect(
      baseline.triangleCount,
      'baseline panel must tessellate to > 0 triangles (proves real OCCT geometry)',
    ).toBeGreaterThan(0);
    console.log('[groove-edit] baseline mesh =', JSON.stringify(baseline));

    // ── D. AddGrooveCommand via bus.execute ───────────────────────────────────
    await page.evaluate(
      async (p: string) => {
        const w = window as unknown as {
          __zilventorStore: { getState(): { bus: { execute(c: unknown): Promise<void> } } };
          __zilventorGetOpfs(): Promise<{
            read(path: string): Promise<Uint8Array>;
            write(path: string, b: Uint8Array): Promise<void>;
          }>;
        };
        const { AddGrooveCommand } = await import('/src/commands/AddGrooveCommand.ts');
        const opfs = await w.__zilventorGetOpfs();
        const cmd = new AddGrooveCommand({
          partPath: p,
          groove: {
            faceRole: 'Top',
            axis: 'u',
            position: 50,
            width: 6,
            depth: 9,
          },
          opfs,
        });
        await w.__zilventorStore.getState().bus.execute(cmd);
      },
      sidePanelPath,
    );

    const postAddGrooves = await readGrooveFeatures(page, sidePanelPath);
    expect(postAddGrooves.length, 'AddGrooveCommand must append exactly 1 kind:groove feature').toBe(
      1,
    );
    expect(postAddGrooves[0]?.width).toBe(6);
    expect(postAddGrooves[0]?.depth).toBe(9);
    expect(postAddGrooves[0]?.position).toBe(50);

    const postAdd = await probeMesh(page, sidePanelPath);
    console.log('[groove-edit] mesh: baseline =', JSON.stringify(baseline), 'post-add =', JSON.stringify(postAdd));
    expect(
      postAdd.triangleCount,
      'AddGrooveCommand must produce a DIFFERENT triangle count than the plain panel (new channel faces = new topology)',
    ).not.toBe(baseline.triangleCount);

    // ── E. EditGrooveCommand via bus.execute ──────────────────────────────────
    // Re-read the manifest, locate the live groove feature object within the
    // featureTree array, construct EditGrooveCommand with the same live `doc`
    // reference so its persist() writes the mutated array back wholesale.
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
        const { EditGrooveCommand } = await import('/src/commands/EditGrooveCommand.ts');
        const opfs = await w.__zilventorGetOpfs();
        const project = await w.__zilventorUnpackProject(await opfs.read(p));
        const doc = (
          project.manifest as {
            document: {
              featureTree: Array<{
                kind: string;
                faceRole?: string;
                axis?: string;
                position?: number;
                width?: number;
                depth?: number;
              }>;
            };
          }
        ).document;
        const groove = doc.featureTree.find((f) => f.kind === 'groove');
        if (!groove) throw new Error('no groove feature found to edit');
        const cmd = new EditGrooveCommand({
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          groove: groove as any,
          patch: { width: 12, depth: 15, position: 80 },
          partPath: p,
          doc,
          opfs,
        });
        await w.__zilventorStore.getState().bus.execute(cmd);
      },
      sidePanelPath,
    );

    const postEdit = await probeMesh(page, sidePanelPath);
    console.log('[groove-edit] mesh: post-add =', JSON.stringify(postAdd), 'post-edit =', JSON.stringify(postEdit));
    expect(
      postEdit.triangleCount,
      'EditGrooveCommand must produce a DIFFERENT triangle count than the baseline panel',
    ).not.toBe(baseline.triangleCount);
    // Topology is unchanged by a dimension-only patch (still one rectangular
    // channel, same face count) — flat straight-edged faces tessellate to a
    // fixed triangle count regardless of size, so triangleCount stays equal
    // to postAdd. The real proof the BREP was re-cut is positionsSum moving.
    expect(
      postEdit.triangleCount,
      'EditGrooveCommand must NOT change topology (same triangle count as pre-edit groove)',
    ).toBe(postAdd.triangleCount);
    expect(
      postEdit.positionsSum,
      'EditGrooveCommand must produce a DIFFERENT vertex geometry than the pre-edit groove (channel floor/walls moved)',
    ).not.toBe(postAdd.positionsSum);

    // ── F. OPFS probe: featureTree groove shows edited params ─────────────────
    const postEditGrooves = await readGrooveFeatures(page, sidePanelPath);
    console.log('[groove-edit] featureTree grooves after EditGrooveCommand:', JSON.stringify(postEditGrooves));
    expect(postEditGrooves.length, 'EditGrooveCommand must not add/remove groove features').toBe(1);
    expect(postEditGrooves[0]?.width, 'edited width must be 12').toBe(12);
    expect(postEditGrooves[0]?.depth, 'edited depth must be 15').toBe(15);
    expect(postEditGrooves[0]?.position, 'edited position must be 80').toBe(80);
    expect(postEditGrooves[0]?.faceRole, 'faceRole unchanged by patch').toBe('Top');
    expect(postEditGrooves[0]?.axis, 'axis unchanged by patch').toBe('u');

    // ── G. First undo (via __zilventorStore.getState().bus) reverts EditGroove only ──
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

    const afterFirstUndoGrooves = await readGrooveFeatures(page, sidePanelPath);
    console.log(
      '[groove-edit] featureTree grooves after first undo:',
      JSON.stringify(afterFirstUndoGrooves),
    );
    expect(afterFirstUndoGrooves.length, 'first undo must not remove the groove feature').toBe(1);
    expect(afterFirstUndoGrooves[0]?.width, 'first undo restores pre-edit width').toBe(6);
    expect(afterFirstUndoGrooves[0]?.depth, 'first undo restores pre-edit depth').toBe(9);
    expect(afterFirstUndoGrooves[0]?.position, 'first undo restores pre-edit position').toBe(50);

    const afterFirstUndo = await probeMesh(page, sidePanelPath);
    console.log(
      '[groove-edit] mesh after first undo =',
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

    // ── H. Second undo reverts AddGroove — groove gone, geometry back to baseline ──
    await page.evaluate(async () => {
      const w = window as unknown as {
        __zilventorStore: {
          getState(): { bus: { undo(): Promise<boolean> } };
        };
      };
      const result = await w.__zilventorStore.getState().bus.undo();
      if (!result) throw new Error('bus.undo() returned false on second undo — nothing to undo');
    });

    const afterSecondUndoGrooves = await readGrooveFeatures(page, sidePanelPath);
    console.log(
      '[groove-edit] groove count after second undo =',
      afterSecondUndoGrooves.length,
    );
    expect(
      afterSecondUndoGrooves.length,
      'second undo must remove the groove feature entirely',
    ).toBe(0);

    const afterSecondUndo = await probeMesh(page, sidePanelPath);
    console.log(
      '[groove-edit] mesh after second undo =',
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
    expect(realErrors, 'no browser errors during groove-edit e2e flow').toHaveLength(0);
  },
);

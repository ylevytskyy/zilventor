/**
 * E2E §P16: Keyhole-slot routing — AddKeyholeSlotCommand end-to-end with real OCCT.
 *
 * PROBE STRATEGY (headless viewport is BLACK — no screenshots, no DOM element probes):
 *   1. OPFS probe: featureTree on panel .zipt gains a `kind:'keyholeSlot'` entry after
 *      AddKeyholeSlotCommand, and loses it after undo.
 *   2. Real-OCCT geometry probe: load the panel bytes into the kernel
 *      (kernel.loadFromBytes → kernel.execute) and read mesh.indices.length / 3
 *      (= triangleCount). A keyhole-slotted panel has a DIFFERENT triangle count
 *      from the plain panel (cylinder∪box pocket adds curved facets), proving
 *      the BREP was actually cut by OCCT.
 *
 * IMPORTANT - bus undo pattern:
 *   Use `w.__zilventorStore.getState().bus.undo()` (not `useAppStore` dynamic import)
 *   to guarantee we undo against the SAME bus instance used by bus.execute.
 *   A Vite dev-mode dynamic import of useAppStore.ts may return a freshly-created
 *   module binding that resolves to a different bus instance.
 *
 * Flow:
 *   A. New assembly + materials → CreateCabinetCommand (base cabinet).
 *   B. Scan OPFS for a panel .zipt that carries a `kind:'panel'` feature.
 *   C. Load panel into kernel → kernel.execute → capture baseline triangleCount.
 *   D. AddKeyholeSlotCommand (faceRole:'Bottom', u:150, v:80, axis:'u', direction:1,
 *      entryDiameter:15, slotWidth:8, slotLength:25, depth:6) via bus.
 *   E. Assert OPFS: featureTree has exactly 1 kind:'keyholeSlot' with the right params.
 *   F. Assert real-OCCT: re-load panel bytes → kernel.execute → triangleCount ≠ baseline.
 *   G. Undo via __zilventorStore.getState().bus.undo().
 *   H. Assert OPFS: featureTree no longer has kind:'keyholeSlot'.
 *   I. Assert real-OCCT: triangleCount restores to baseline.
 *   J. Zero browser errors.
 */
import { test, expect } from '@playwright/test';
import { waitForKernelReady } from './helpers/buildBox';

/**
 * Load panel .zipt bytes into the kernel via kernel.loadFromBytes + kernel.execute,
 * return triangle count, and clean up. Must run inside page.evaluate.
 */
async function probeTriangleCount(
  page: import('@playwright/test').Page,
  partPath: string,
): Promise<number> {
  return page.evaluate(async (p: string) => {
    const w = window as unknown as {
      __zilventorGetOpfs(): Promise<{ read(path: string): Promise<Uint8Array> }>;
      __zilventorStore: {
        getState(): {
          kernel: {
            loadFromBytes(bytes: Uint8Array): Promise<string>;
            execute(partId: string): Promise<{
              ok: boolean;
              value?: { mesh: { indices: { length: number } } };
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
      return result.value.mesh.indices.length / 3;
    } finally {
      await kernel.deletePart(partId);
    }
  }, partPath);
}

test(
  'keyhole-slot-cut: AddKeyholeSlotCommand → featureTree + real-OCCT geometry change + undo restores both',
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
          name: 'Keyhole Slot Cabinet',
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
    // Pick any carcass panel — u=150,v=80 (axis u, direction 1, slotLength 25,
    // entryDiameter 15) stays >=40mm from every edge on even the smallest
    // panel this cabinet produces (Top/Bottom at 564x554mm).
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
    console.log('[keyhole-slot] sidePanelPath =', sidePanelPath);

    // ── C. Capture baseline: no keyholeSlot features + real-OCCT triangle count ──
    const baselineKeyholeSlotCount: number = await page.evaluate(
      async (p: string) => {
        const w = window as unknown as {
          __zilventorGetOpfs(): Promise<{ read(path: string): Promise<Uint8Array> }>;
          __zilventorUnpackProject: (bytes: Uint8Array) => Promise<{ manifest: unknown }>;
        };
        const opfs = await w.__zilventorGetOpfs();
        const project = await w.__zilventorUnpackProject(await opfs.read(p));
        const doc = (
          project.manifest as { document: { featureTree: Array<{ kind: string }> } }
        ).document;
        return doc.featureTree.filter((f) => f.kind === 'keyholeSlot').length;
      },
      sidePanelPath,
    );
    expect(baselineKeyholeSlotCount, 'no keyholeSlot features before AddKeyholeSlotCommand').toBe(
      0,
    );

    const baselineTriangles = await probeTriangleCount(page, sidePanelPath);
    expect(
      baselineTriangles,
      'baseline panel must tessellate to > 0 triangles (proves real OCCT geometry)',
    ).toBeGreaterThan(0);
    console.log('[keyhole-slot] baseline triangleCount =', baselineTriangles);

    // ── D. AddKeyholeSlotCommand via bus.execute ──────────────────────────────
    // Bottom face, entry-hole center at u=150,v=80, slot runs along +u for 25mm,
    // entryDiameter 15mm, slotWidth 8mm, depth 6mm — well inside every panel
    // this cabinet produces (>=40mm margin from every edge).
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

    // ── E. OPFS probe: featureTree has 1 kind:'keyholeSlot' with correct params ─
    const keyholeSlotSpec = await page.evaluate(
      async (p: string) => {
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
        const slots = doc.featureTree.filter((f) => f.kind === 'keyholeSlot');
        return { count: slots.length, first: slots[0] ?? null };
      },
      sidePanelPath,
    );

    console.log(
      '[keyhole-slot] featureTree keyholeSlots after AddKeyholeSlotCommand:',
      JSON.stringify(keyholeSlotSpec),
    );
    expect(
      keyholeSlotSpec.count,
      'AddKeyholeSlotCommand must append exactly 1 kind:keyholeSlot feature to featureTree',
    ).toBe(1);
    expect(keyholeSlotSpec.first?.faceRole, 'keyholeSlot faceRole must be Bottom').toBe('Bottom');
    expect(keyholeSlotSpec.first?.u, 'keyholeSlot u must be 150').toBe(150);
    expect(keyholeSlotSpec.first?.v, 'keyholeSlot v must be 80').toBe(80);
    expect(keyholeSlotSpec.first?.axis, 'keyholeSlot axis must be u').toBe('u');
    expect(keyholeSlotSpec.first?.direction, 'keyholeSlot direction must be 1').toBe(1);
    expect(keyholeSlotSpec.first?.entryDiameter, 'keyholeSlot entryDiameter must be 15').toBe(15);
    expect(keyholeSlotSpec.first?.slotWidth, 'keyholeSlot slotWidth must be 8').toBe(8);
    expect(keyholeSlotSpec.first?.slotLength, 'keyholeSlot slotLength must be 25').toBe(25);
    expect(keyholeSlotSpec.first?.depth, 'keyholeSlot depth must be 6').toBe(6);

    // ── F. Real-OCCT geometry probe: triangleCount must change ────────────────
    // executeTree re-runs with the keyholeSlot feature → OCCT cuts a
    // cylinder∪box pocket. The tessellated mesh will differ from the plain
    // rectangular panel.
    const postSlotTriangles = await probeTriangleCount(page, sidePanelPath);
    console.log(
      '[keyhole-slot] triangleCount: baseline =',
      baselineTriangles,
      'post-slot =',
      postSlotTriangles,
    );

    expect(
      postSlotTriangles,
      `keyholeSlot must produce a DIFFERENT triangle count than the plain panel (baseline=${baselineTriangles}, post-slot=${postSlotTriangles}); equal means executeTree did NOT cut the slot — real-OCCT cut is not happening`,
    ).not.toBe(baselineTriangles);
    // The slot's cylinder entry hole adds curved facets (channel walls + floor
    // + cylindrical bore surface), so triangle count should increase.
    expect(
      postSlotTriangles,
      'keyhole-slotted panel must have MORE triangles than plain panel (pocket + cylinder add new faces)',
    ).toBeGreaterThan(baselineTriangles);

    // ── G. Undo via __zilventorStore.getState().bus.undo() ────────────────────
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

    // ── H. OPFS probe: featureTree no longer has kind:'keyholeSlot' ───────────
    const afterUndoKeyholeSlotCount: number = await page.evaluate(
      async (p: string) => {
        const w = window as unknown as {
          __zilventorGetOpfs(): Promise<{ read(path: string): Promise<Uint8Array> }>;
          __zilventorUnpackProject: (bytes: Uint8Array) => Promise<{ manifest: unknown }>;
        };
        const opfs = await w.__zilventorGetOpfs();
        const project = await w.__zilventorUnpackProject(await opfs.read(p));
        const doc = (
          project.manifest as { document: { featureTree: Array<{ kind: string }> } }
        ).document;
        return doc.featureTree.filter((f) => f.kind === 'keyholeSlot').length;
      },
      sidePanelPath,
    );

    console.log('[keyhole-slot] keyholeSlot count after undo =', afterUndoKeyholeSlotCount);
    expect(
      afterUndoKeyholeSlotCount,
      'undo must remove the keyholeSlot feature from featureTree (OPFS restored to pre-slot bytes)',
    ).toBe(0);

    // ── I. Real-OCCT geometry probe: triangleCount restores to baseline ─────────
    const afterUndoTriangles = await probeTriangleCount(page, sidePanelPath);
    console.log(
      '[keyhole-slot] triangleCount after undo =',
      afterUndoTriangles,
      '(expected baseline =',
      baselineTriangles,
      ')',
    );

    expect(
      afterUndoTriangles,
      `undo must restore the plain-panel triangle count (expected=${baselineTriangles}, got=${afterUndoTriangles})`,
    ).toBe(baselineTriangles);

    // ── J. No browser errors ──────────────────────────────────────────────────
    const realErrors = consoleErrors.filter(
      (e) => !e.includes('ResizeObserver') && !e.includes('favicon'),
    );
    expect(realErrors, 'no browser errors during keyhole-slot-cut e2e flow').toHaveLength(0);
  },
);

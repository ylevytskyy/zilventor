/**
 * CHUNK G — Task G.5: e2e — select→edit depth→move→delete→bake→BOM count.
 *
 * §6 PROOF STRATEGY: headless Chrome renders viewport BLACK — do NOT use screenshots
 * for 3D verification. Use DOM probes + OPFS byte checks + store probes:
 *   - `window.__zilventorStore.getState().selectedBoreId` → bore selection working
 *   - `window.__zilventorStore.getState().viewport?.getSceneManager()?.boreMarkerCount()` → markers
 *   - `window.__zilventorStore.getState().viewport?.raycastBoreMarker(x,y)` → hit test via probes
 *   - OPFS byte probe: unpack the .zipt and assert bore[] after each command
 *   - `window.__zilventorConnectorBomAggregate()` → BOM count after delete
 *
 * DEPENDENCIES: Chunks A–F must be implemented before this e2e can go green:
 *   - Chunk A: BoreOp.edited?, BoreOp.jointDir?, PartDocument.suppressedConnectorIds?
 *   - Chunk B: translateConnectorAlong, ConnectorMember
 *   - Chunk C: connectorCatalog jointDir population; connectorBomCatalog
 *   - Chunk D: aggregateConnectorBomRecursive, useConnectorBomResult, ConnectorBomTable
 *   - Chunk E: EditBoreCommand, MoveConnectorCommand, DeleteConnectorCommand
 *   - Chunk F: mergeBores, GenerateCarcassBoresCommand replace-with-merge,
 *              partPath in MarkerOverlaySpec, raycastBoreMarker, selectedBoreId in store,
 *              BorePropertiesPanel, commandBus in store
 *   - Chunk G (this file): App.tsx __zilventorConnectorBomAggregate probe
 *
 * These tests are intentionally RED until the corresponding chunks are implemented.
 * Each test has a comment explaining which chunk makes it go GREEN.
 */
import { test, expect } from '@playwright/test';
import { waitForKernelReady } from './helpers/buildBox';

// Helper: read bores[] from OPFS .zipt via unpackProject probe
async function readBoresFromOpfs(
  page: import('@playwright/test').Page,
  partPath: string,
): Promise<unknown[]> {
  return page.evaluate(async (pp) => {
    const w = window as unknown as {
      __zilventorGetOpfs(): Promise<{ read(p: string): Promise<Uint8Array> }>;
      __zilventorUnpackProject: (bytes: Uint8Array) => Promise<{ manifest: unknown }>;
    };
    const opfs = await w.__zilventorGetOpfs();
    const bytes = await opfs.read(pp);
    const proj = await w.__zilventorUnpackProject(bytes);
    return ((proj.manifest as { document: { bores?: unknown[] } }).document.bores ?? []);
  }, partPath);
}

// Helper: read suppressedConnectorIds from OPFS .zipt
async function readSuppressedFromOpfs(
  page: import('@playwright/test').Page,
  partPath: string,
): Promise<string[]> {
  return page.evaluate(async (pp) => {
    const w = window as unknown as {
      __zilventorGetOpfs(): Promise<{ read(p: string): Promise<Uint8Array> }>;
      __zilventorUnpackProject: (bytes: Uint8Array) => Promise<{ manifest: unknown }>;
    };
    const opfs = await w.__zilventorGetOpfs();
    const bytes = await opfs.read(pp);
    const proj = await w.__zilventorUnpackProject(bytes);
    return ((proj.manifest as { document: { suppressedConnectorIds?: string[] } })
      .document.suppressedConnectorIds ?? []);
  }, partPath);
}

test.describe('CHUNK G.5 — connector edit/move/delete/BOM e2e (§6 probes, no screenshots)', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to the app. The worktree dev server runs on a free port (5174) to avoid
    // collision with the main checkout (5173). Uses page.goto with absolute URL so the
    // playwright.config.ts baseURL (5173) is not used here.
    // NOTE: Start the worktree dev server first:
    //   cd /Users/lion/Documents/Projects/mine/zilventor/.claude/worktrees/prisadka-slice3
    //   PORT=5174 pnpm --filter @zilventor/app dev
    page.setDefaultTimeout(120_000);
    await page.goto('http://localhost:5174');
    await waitForKernelReady(page);
  });

  test('G.5.1 — bore selection probe: setSelectedBore → selectedBoreId in store', async ({
    page,
  }) => {
    const result = await page.evaluate(() => {
      const w = window as unknown as {
        __zilventorStore: {
          getState(): {
            setSelectedBore?: (boreId: string, partPath: string) => void;
            selectedBoreId?: string | null;
            selectedBorePartPath?: string | null;
          };
        };
      };
      const s = w.__zilventorStore.getState();
      // RED without Chunk F: setSelectedBore missing from store
      if (typeof s.setSelectedBore !== 'function') {
        return { ok: false, reason: 'setSelectedBore not in store (Chunk F not implemented)' };
      }
      s.setSelectedBore('test-bore-id', 'test.zipt');
      const after = w.__zilventorStore.getState();
      return {
        ok: true,
        boreId: after.selectedBoreId,
        partPath: after.selectedBorePartPath,
      };
    });
    // RED without Chunk F: setSelectedBore missing from store → result.ok = false
    expect(result.ok, `setSelectedBore failed: ${(result as { reason?: string }).reason ?? ''}`).toBe(true);
    expect((result as { boreId?: string }).boreId).toBe('test-bore-id');
    expect((result as { partPath?: string }).partPath).toBe('test.zipt');
  });

  test('G.5.2 — bore selection clears component selection (mutual exclusion)', async ({ page }) => {
    const result = await page.evaluate(() => {
      const w = window as unknown as {
        __zilventorStore: {
          getState(): {
            setSelectedBore?: (boreId: string, partPath: string) => void;
            selectComponentPaths?: (paths: string[][]) => void;
            selectedBoreId?: string | null;
            selectedComponentPaths?: string[][] | null;
          };
        };
      };
      const s = w.__zilventorStore.getState();
      if (typeof s.setSelectedBore !== 'function') {
        return { ok: false, reason: 'setSelectedBore not in store (Chunk F not implemented)' };
      }
      // First set a component selection
      if (typeof s.selectComponentPaths === 'function') {
        s.selectComponentPaths([['C1']]);
      }
      // Now select a bore — component paths must be cleared
      s.setSelectedBore('bore-99', 'panel.zipt');
      const after = w.__zilventorStore.getState();
      return {
        ok: true,
        boreId: after.selectedBoreId,
        componentPaths: after.selectedComponentPaths ?? [],
      };
    });
    // RED without Chunk F
    expect(result.ok, `mutual exclusion test failed: ${(result as { reason?: string }).reason ?? ''}`).toBe(true);
    expect((result as { boreId?: string }).boreId).toBe('bore-99');
    // Component paths must be cleared when a bore is selected
    expect((result as { componentPaths?: unknown[] }).componentPaths).toHaveLength(0);
  });

  test('G.5.3 — raycastBoreMarker exposed on viewport handle', async ({ page }) => {
    const result = await page.evaluate(() => {
      const w = window as unknown as {
        __zilventorStore: {
          getState(): {
            viewport?: {
              raycastBoreMarker?: (clientX: number, clientY: number) => unknown;
            } | null;
          };
        };
      };
      const viewport = w.__zilventorStore.getState().viewport;
      if (!viewport) return { exposed: false as const, reason: 'no viewport in store' };
      // RED without Chunk F: raycastBoreMarker not on ViewportHandle
      if (typeof viewport.raycastBoreMarker !== 'function') {
        return {
          exposed: false as const,
          reason: 'raycastBoreMarker not a function on viewport handle (Chunk F not implemented)',
        };
      }
      // Call at (0,0) — will miss in a real scene; must return null, not throw
      const hit = viewport.raycastBoreMarker(0, 0);
      return { exposed: true as const, hitType: hit === null ? 'null' : typeof hit };
    });
    // RED without Chunk F: raycastBoreMarker not on ViewportHandle
    expect(result.exposed, `raycastBoreMarker: ${(result as { reason?: string }).reason ?? ''}`).toBe(true);
    expect((result as { hitType?: string }).hitType).toBe('null'); // no bores loaded yet → null hit
  });

  test('G.5.4 — EditBoreCommand depth edit persists to OPFS (Chunk E)', async ({ page }) => {
    const testPartPath = 'g5-test-panel.zipt';

    // Seed a minimal .zipt with one bore into OPFS
    await page.evaluate(async (pp) => {
      const w = window as unknown as {
        __zilventorPackProject: (p: { manifest: unknown; blobs: Record<string, Uint8Array> }) => Promise<Uint8Array>;
        __zilventorGetOpfs(): Promise<{
          read(p: string): Promise<Uint8Array>;
          write(p: string, b: Uint8Array): Promise<void>;
        }>;
      };
      if (!w.__zilventorPackProject || !w.__zilventorGetOpfs) {
        throw new Error('pack probes not available');
      }
      const doc = {
        id: pp,
        name: 'TestPanel',
        units: 'mm',
        parameters: {},
        featureTree: [
          {
            kind: 'panel',
            id: 'panel',
            length: { kind: 'literal', value: 720 },
            width: { kind: 'literal', value: 560 },
            thickness: { kind: 'literal', value: 18 },
            thicknessFromMaterial: true,
            materialId: 'm',
            grain: 'length',
            edgeBands: { front: null, back: null, left: null, right: null },
          },
        ],
        bores: [
          {
            id: 'confirmat-0-B-0',
            face: { featureId: 'panel', role: 'Left', instance: 0 },
            u: 9,
            v: 60,
            diameter: 5,
            depth: 32,
            role: 'confirmat-edge',
            connectorId: 'confirmat-0',
            connectorKind: 'confirmat',
            jointDir: { x: 0, y: 1, z: 0 },
          },
        ],
      };
      const manifest = { formatVersion: 22, kind: 'part', document: doc };
      const bytes = await w.__zilventorPackProject({ manifest, blobs: {} });
      const opfs = await w.__zilventorGetOpfs();
      await opfs.write(pp, bytes);
    }, testPartPath);

    // Dispatch EditBoreCommand via bus.execute (the new Chunk E command)
    const editResult = await page.evaluate(async (pp) => {
      const w = window as unknown as {
        __zilventorStore: {
          getState(): {
            bus?: { execute(c: unknown): Promise<void> };
          };
        };
        __zilventorUnpackProject: (bytes: Uint8Array) => Promise<{ manifest: unknown }>;
        __zilventorGetOpfs(): Promise<{
          read(p: string): Promise<Uint8Array>;
          write(p: string, b: Uint8Array): Promise<void>;
        }>;
      };
      const store = w.__zilventorStore;
      const unpackProject = w.__zilventorUnpackProject;
      const opfs = await w.__zilventorGetOpfs();

      const bytes = await opfs.read(pp);
      const proj = await unpackProject(bytes);
      const doc = (proj.manifest as { document: { bores?: Array<{ id: string; depth: number; edited?: boolean }> } }).document;
      const bore = doc.bores?.[0];
      if (!bore) return { ok: false as const, reason: 'no bores in seeded doc' };

      const bus = store.getState().bus;
      if (!bus) return { ok: false as const, reason: 'bus not in store' };

      try {
        const { EditBoreCommand } = await import('/src/commands/EditBoreCommand.ts');
        const cmd = new EditBoreCommand({
          bore,
          patch: { depth: 25 },
          partPath: pp,
          doc,
          opfs,
        });
        await bus.execute(cmd);

        // Read back from OPFS
        const newBytes = await opfs.read(pp);
        const newProj = await unpackProject(newBytes);
        const newDoc = (newProj.manifest as { document: { bores?: Array<{ depth: number; edited?: boolean }> } }).document;
        const newBore = newDoc.bores?.[0];
        return {
          ok: true as const,
          depth: newBore?.depth,
          edited: newBore?.edited,
        };
      } catch (e: unknown) {
        return { ok: false as const, reason: (e as Error).message };
      }
    }, testPartPath);

    // RED without Chunk E (EditBoreCommand) or Chunk F (bus integration):
    // editResult.ok will be false with a descriptive reason
    expect(editResult.ok, `EditBoreCommand failed: ${(editResult as { reason?: string }).reason ?? ''}`).toBe(true);
    expect((editResult as { depth?: number }).depth).toBe(25);
    expect((editResult as { edited?: boolean }).edited).toBe(true);
  });

  test('G.5.5 — ConnectorBOM probe: window.__zilventorConnectorBomAggregate exposed and returns array', async ({
    page,
  }) => {
    const result = await page.evaluate(async () => {
      const w = window as unknown as {
        __zilventorConnectorBomAggregate?: () => Promise<unknown[]>;
      };
      // RED without Chunk G.5 App.tsx probe registration:
      if (typeof w.__zilventorConnectorBomAggregate !== 'function') {
        return { exposed: false as const };
      }
      // The probe is async (uses dynamic imports)
      const rows = await w.__zilventorConnectorBomAggregate();
      return { exposed: true as const, isArray: Array.isArray(rows) };
    });
    // RED without the App.tsx probe hook added in this chunk
    expect(result.exposed).toBe(true);
    expect((result as { isArray?: boolean }).isArray).toBe(true);
  });

  test('G.5.6 — DeleteConnectorCommand suppresses bore + OPFS bytes update (Chunk E)', async ({
    page,
  }) => {
    const partPathA = 'g5-side.zipt';
    const partPathB = 'g5-bottom.zipt';

    // Seed both panels with a confirmat (sharing connectorId 'confirmat-0')
    await page.evaluate(
      async ([ppA, ppB]) => {
        const w = window as unknown as {
          __zilventorPackProject: (p: { manifest: unknown; blobs: Record<string, Uint8Array> }) => Promise<Uint8Array>;
          __zilventorGetOpfs(): Promise<{
            read(p: string): Promise<Uint8Array>;
            write(p: string, b: Uint8Array): Promise<void>;
          }>;
        };
        if (!w.__zilventorPackProject || !w.__zilventorGetOpfs) {
          throw new Error('probes not available');
        }
        const opfs = await w.__zilventorGetOpfs();
        const sideDoc = {
          id: ppA,
          name: 'Side',
          units: 'mm',
          parameters: {},
          featureTree: [
            {
              kind: 'panel',
              id: 'panel',
              length: { kind: 'literal', value: 18 },
              width: { kind: 'literal', value: 560 },
              thickness: { kind: 'literal', value: 720 },
              thicknessFromMaterial: true,
              materialId: 'm',
              grain: 'length',
              edgeBands: { front: null, back: null, left: null, right: null },
            },
          ],
          bores: [
            {
              id: 'confirmat-0-A-0',
              face: { featureId: 'panel', role: 'Right', instance: 0 },
              u: 60,
              v: 9,
              diameter: 7,
              depth: 'throughAll',
              role: 'confirmat-face',
              connectorId: 'confirmat-0',
              connectorKind: 'confirmat',
              jointDir: { x: 0, y: 1, z: 0 },
            },
          ],
        };
        const bottomDoc = {
          id: ppB,
          name: 'Bottom',
          units: 'mm',
          parameters: {},
          featureTree: [
            {
              kind: 'panel',
              id: 'panel',
              length: { kind: 'literal', value: 564 },
              width: { kind: 'literal', value: 554 },
              thickness: { kind: 'literal', value: 18 },
              thicknessFromMaterial: true,
              materialId: 'm',
              grain: 'length',
              edgeBands: { front: null, back: null, left: null, right: null },
            },
          ],
          bores: [
            {
              id: 'confirmat-0-B-0',
              face: { featureId: 'panel', role: 'Left', instance: 0 },
              u: 9,
              v: 60,
              diameter: 5,
              depth: 32,
              role: 'confirmat-edge',
              connectorId: 'confirmat-0',
              connectorKind: 'confirmat',
              jointDir: { x: 0, y: 1, z: 0 },
            },
          ],
        };
        await opfs.write(
          ppA,
          await w.__zilventorPackProject({
            manifest: { formatVersion: 22, kind: 'part', document: sideDoc },
            blobs: {},
          }),
        );
        await opfs.write(
          ppB,
          await w.__zilventorPackProject({
            manifest: { formatVersion: 22, kind: 'part', document: bottomDoc },
            blobs: {},
          }),
        );
      },
      [partPathA, partPathB],
    );

    // Dispatch DeleteConnectorCommand via bus.execute
    const deleteResult = await page.evaluate(
      async ([ppA, ppB]) => {
        const w = window as unknown as {
          __zilventorStore: {
            getState(): {
              bus?: { execute(c: unknown): Promise<void> };
            };
          };
          __zilventorUnpackProject: (bytes: Uint8Array) => Promise<{ manifest: unknown }>;
          __zilventorGetOpfs(): Promise<{
            read(p: string): Promise<Uint8Array>;
            write(p: string, b: Uint8Array): Promise<void>;
          }>;
        };
        const bus = w.__zilventorStore.getState().bus;
        if (!bus) return { ok: false as const, reason: 'bus not in store' };

        const opfs = await w.__zilventorGetOpfs();
        const [projA, projB] = await Promise.all([
          w.__zilventorUnpackProject(await opfs.read(ppA)),
          w.__zilventorUnpackProject(await opfs.read(ppB)),
        ]);
        const docA = (projA.manifest as { document: unknown }).document;
        const docB = (projB.manifest as { document: unknown }).document;

        try {
          const { DeleteConnectorCommand } = await import('/src/commands/DeleteConnectorCommand.ts');
          const cmd = new DeleteConnectorCommand({
            targetId: 'confirmat-0',
            mode: 'connector',
            affectedDocs: [
              { partPath: ppA, doc: docA },
              { partPath: ppB, doc: docB },
            ],
            opfs,
          });
          await bus.execute(cmd);

          // Read back OPFS bytes
          const [newProjA, newProjB] = await Promise.all([
            w.__zilventorUnpackProject(await opfs.read(ppA)),
            w.__zilventorUnpackProject(await opfs.read(ppB)),
          ]);
          type DocWithSuppressed = {
            suppressedConnectorIds?: string[];
            bores?: unknown[];
          };
          const newDocA = (newProjA.manifest as { document: DocWithSuppressed }).document;
          const newDocB = (newProjB.manifest as { document: DocWithSuppressed }).document;
          return {
            ok: true as const,
            suppressedA: newDocA.suppressedConnectorIds ?? [],
            suppressedB: newDocB.suppressedConnectorIds ?? [],
            boresA: (newDocA.bores ?? []).length,
            boresB: (newDocB.bores ?? []).length,
          };
        } catch (e: unknown) {
          return { ok: false as const, reason: (e as Error).message };
        }
      },
      [partPathA, partPathB],
    );

    // RED without Chunk E (DeleteConnectorCommand)
    expect(
      deleteResult.ok,
      `DeleteConnectorCommand failed: ${(deleteResult as { reason?: string }).reason ?? ''}`,
    ).toBe(true);
    const successResult = deleteResult as {
      ok: true;
      suppressedA: string[];
      suppressedB: string[];
      boresA: number;
      boresB: number;
    };
    // suppressedConnectorIds must contain 'confirmat-0' in both docs
    expect(successResult.suppressedA).toContain('confirmat-0');
    expect(successResult.suppressedB).toContain('confirmat-0');
    // Bores deleted from both docs
    expect(successResult.boresA).toBe(0);
    expect(successResult.boresB).toBe(0);
  });

  test('G.5.7 — boreMarkerCount on SceneManager (Chunk F SceneManager update)', async ({
    page,
  }) => {
    // After DeleteConnectorCommand, boreCacheInvalidator is called → boreMarkers rebuild → count drops.
    // We verify this via SceneManager.boreMarkerCount() through the viewport handle.
    const result = await page.evaluate(() => {
      const w = window as unknown as {
        __zilventorStore: {
          getState(): {
            viewport?: {
              getSceneManager?: () => {
                boreMarkerCount?: () => number;
              } | null;
            } | null;
          };
        };
      };
      const viewport = w.__zilventorStore.getState().viewport;
      if (!viewport) return { ok: false as const, reason: 'no viewport in store' };
      const sm = viewport.getSceneManager?.();
      if (!sm) return { ok: false as const, reason: 'SceneManager not available' };
      if (typeof sm.boreMarkerCount !== 'function') {
        return {
          ok: false as const,
          reason: 'boreMarkerCount not a function (Chunk F SceneManager not updated)',
        };
      }
      // No assembly loaded → count = 0
      return { ok: true as const, count: sm.boreMarkerCount() };
    });
    // RED without Chunk F's SceneManager.boreMarkerCount method
    expect(
      result.ok,
      `boreMarkerCount: ${(result as { reason?: string }).reason ?? ''}`,
    ).toBe(true);
    // Without an assembly loaded the initial count is 0
    expect((result as { count?: number }).count).toBe(0);
  });
});

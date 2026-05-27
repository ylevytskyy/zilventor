// tests/e2e/drawing/T-6-28-assembly-section-regen.spec.ts
/**
 * T-6-28 — Assembly-sourced section view: reopen → Regenerate (pose-aware, real kernel).
 *
 * Proves that Tasks 1–5 (cutAssemblyComponentsBySectionPlane wired into both
 * AddSectionViewCommand and regenerateSectionView) work end-to-end in real Chromium.
 *
 * The non-trivial pose (Part B translated +100mm in X) ensures that a poseless cut
 * (ignoring component transforms, dumping all cached shapes at origin) produces
 * measurably different hatch geometry than the pose-aware cut:
 *
 * The section is a HORIZONTAL CUT looking along world-Y. In the section view's
 * look-at matrix, world-X maps to view-Y. So Part A at world-X=0 lands at
 * sectionView Y≈[−30,0] and Part B at world-X=+100mm lands at Y≈[−130,−100].
 * Posed Y-extent ≈ 130mm. Poseless (both at origin) Y-extent ≈ 30mm.
 * Teeth verified: TransformOps.ts stub (translateShape(0,0,0)) → assertion RED at 30mm.
 * Reverted → assertion GREEN at 130mm. Threshold 80mm, 50mm margin both sides.
 *
 * Steps:
 *  1. Build Box A (30×30×20) via UI; save bytes to OPFS 'parts/t628-A.zipt'. Capture partIdA.
 *  2. Build Box B (30×30×20) via UI (must be before CreateDrawingCommand);
 *     save bytes to OPFS 'parts/t628-B.zipt'. Capture partIdB. Stash bytes for source-edit step.
 *  3. Pack a 2-part .ziasm (Part A at x=0, Part B at x=+100) via __zilventorPackAssembly;
 *     write to OPFS 'assemblies/t628.ziasm'. Seed activeAssembly in store.
 *  4. CreateDrawingCommand (assembly source) → verify activeDrawingSourceComponents has ≥2 entries.
 *  5. AddBaseViewCommand → add viewMatrix patch (required by AddSectionViewCommand).
 *  6. AddSectionViewCommand (full mode, horizontal cut at view-y=0) → capture sectionViewId.
 *     Assert initialHatchCount > 0 (real kernel cut ran with pose-aware components).
 *  7. Pack → unpack drawing round-trip; store reopenedDoc in globalThis.
 *  8. activateDrawingDocument(reopenedDoc) → loads components from .ziasm → sets
 *     activeDrawingSourceComponents (≥2) + new fingerprint.
 *  9. Switch to Drawing tab; assert section view stale marker is visible.
 * 10. Click Regenerate on section stale marker.
 * 11. Assert: stale marker clears; hatchSegments.length > 0 (no "not yet supported" throw);
 *     hatch Y-extent > 80mm (pose-separation: posed ≈ 130mm, poseless ≈ 30mm).
 *
 * Dev hooks used:
 *   - window.__zilventorStore
 *   - window.__zilventorPackAssembly
 *   - dynamic import('/src/commands/CreateDrawingCommand.ts') inside page.evaluate
 *   - dynamic import('/src/commands/AddBaseViewCommand.ts') inside page.evaluate
 *   - dynamic import('/src/commands/AddSectionViewCommand.ts') inside page.evaluate
 *   - dynamic import('/src/storage/DrawingPacker.ts') inside page.evaluate
 *   - dynamic import('/src/drawing/activateDrawingDocument.ts') inside page.evaluate
 */
import { test, expect } from '@playwright/test';
import { buildBox, waitForKernelReady } from '../helpers/buildBox';

const ASM_PATH = 'assemblies/t628.ziasm';
const PART_A_PATH = 'parts/t628-A.zipt';
const PART_B_PATH = 'parts/t628-B.zipt';

test('T-6-28: assembly section reopen → Regenerate (pose-aware, no "not yet supported")', async ({ page }) => {
  test.setTimeout(180_000);
  page.setDefaultTimeout(120_000);

  page.on('console', (m) => console.log('BROWSER:', m.type(), m.text()));
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

  await page.goto('/');
  await waitForKernelReady(page);

  // ── Step 1: Build Part A (30×30×20) via UI ────────────────────────────────
  await buildBox(page, { width: 30, height: 30, depth: 20 });

  const { partIdA } = await page.evaluate(
    async ({ partAPath }: { partAPath: string }) => {
      async function opfsWrite(path: string, data: Uint8Array): Promise<void> {
        const root = await navigator.storage.getDirectory();
        const parts = path.split('/').filter((p) => p.length > 0);
        let dir: FileSystemDirectoryHandle = root;
        for (let i = 0; i < parts.length - 1; i++) {
          dir = await dir.getDirectoryHandle(parts[i]!, { create: true });
        }
        const fh = await dir.getFileHandle(parts[parts.length - 1]!, { create: true });
        const wh = await fh.createWritable();
        await wh.write(data as unknown as FileSystemWriteChunkType);
        await wh.close();
      }

      const store = (window as unknown as {
        __zilventorStore: {
          getState(): {
            activePart: { id: string } | null;
            kernel: {
              execute(id: string): Promise<{ ok: boolean; error?: unknown }>;
              saveToBytes(id: string): Promise<Uint8Array>;
            } | null;
          };
        };
      }).__zilventorStore;

      const s = store.getState();
      if (!s.activePart || !s.kernel) throw new Error('T-6-28 step 1: kernel or activePart not ready');
      await s.kernel.execute(s.activePart.id);
      const bytesA = await s.kernel.saveToBytes(s.activePart.id);
      await opfsWrite(partAPath, bytesA);
      return { partIdA: s.activePart.id };
    },
    { partAPath: PART_A_PATH },
  );

  // ── Step 2: Build Part B (30×30×20) via UI (must be before CreateDrawingCommand) ──
  await buildBox(page, { width: 30, height: 30, depth: 20 });

  const { partIdB } = await page.evaluate(
    async ({ partBPath }: { partBPath: string }) => {
      async function opfsWrite(path: string, data: Uint8Array): Promise<void> {
        const root = await navigator.storage.getDirectory();
        const parts = path.split('/').filter((p) => p.length > 0);
        let dir: FileSystemDirectoryHandle = root;
        for (let i = 0; i < parts.length - 1; i++) {
          dir = await dir.getDirectoryHandle(parts[i]!, { create: true });
        }
        const fh = await dir.getFileHandle(parts[parts.length - 1]!, { create: true });
        const wh = await fh.createWritable();
        await wh.write(data as unknown as FileSystemWriteChunkType);
        await wh.close();
      }

      const store = (window as unknown as {
        __zilventorStore: {
          getState(): {
            activePart: { id: string } | null;
            kernel: {
              execute(id: string): Promise<{ ok: boolean; error?: unknown }>;
              saveToBytes(id: string): Promise<Uint8Array>;
            } | null;
          };
        };
      }).__zilventorStore;

      const s = store.getState();
      if (!s.activePart || !s.kernel) throw new Error('T-6-28 step 2: kernel or activePart not ready');
      await s.kernel.execute(s.activePart.id);
      const bytesB = await s.kernel.saveToBytes(s.activePart.id);
      await opfsWrite(partBPath, bytesB);
      // Stash bytesB for source-edit step (overwrite A with B to trigger staleness).
      (globalThis as unknown as Record<string, unknown>)['__t628_bytesB'] = bytesB;
      return { partIdB: s.activePart.id };
    },
    { partBPath: PART_B_PATH },
  );

  // ── Step 3: Pack .ziasm (Part A at x=0, Part B at x=+100mm) ────────────────
  // The +100mm X offset makes the pose NON-TRIVIAL: a poseless cut collapses both
  // boxes at origin, yielding a smaller hatch footprint than the pose-aware cut.
  await page.evaluate(
    async ({ asmPath, partAPath, partBPath, partIdA, partIdB }: {
      asmPath: string; partAPath: string; partBPath: string;
      partIdA: string; partIdB: string;
    }) => {
      async function opfsWrite(path: string, data: Uint8Array): Promise<void> {
        const root = await navigator.storage.getDirectory();
        const parts = path.split('/').filter((p) => p.length > 0);
        let dir: FileSystemDirectoryHandle = root;
        for (let i = 0; i < parts.length - 1; i++) {
          dir = await dir.getDirectoryHandle(parts[i]!, { create: true });
        }
        const fh = await dir.getFileHandle(parts[parts.length - 1]!, { create: true });
        const wh = await fh.createWritable();
        await wh.write(data as unknown as FileSystemWriteChunkType);
        await wh.close();
      }

      // Part A at x=0 (origin), Part B at x=+100mm — non-trivial X translation.
      const asmDoc = {
        id: 'asm-t628',
        name: 'T628 Assembly',
        units: 'mm',
        parameters: {},
        components: [
          {
            id: partIdA,
            partPath: partAPath,
            position: { x: 0, y: 0, z: 0 },
            rotation: { rx: 0, ry: 0, rz: 0 },
            visible: true,
            flexible: false,
          },
          {
            id: partIdB,
            partPath: partBPath,
            position: { x: 100, y: 0, z: 0 },  // +100mm X — non-trivial pose
            rotation: { rx: 0, ry: 0, rz: 0 },
            visible: true,
            flexible: false,
          },
        ],
        constraints: [],
        groundedComponentPaths: [],
        bomItemNumbers: {},
        cutListItemNumbers: {},
        colorOverrides: {},
        colors: {},
        properties: {},
        materials: [],
        hardware: [],
      };

      const w = window as unknown as {
        __zilventorPackAssembly: (doc: unknown, thumb: Uint8Array) => Promise<Uint8Array>;
      };
      if (!w.__zilventorPackAssembly) {
        throw new Error('T-6-28 step 3: __zilventorPackAssembly dev hook not found');
      }
      // Minimal 1×1 PNG thumbnail (required by pack).
      const png = new Uint8Array([
        0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
        0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
        0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
        0x08, 0x06, 0x00, 0x00, 0x00, 0x1F, 0x15, 0xC4,
        0x89, 0x00, 0x00, 0x00, 0x0A, 0x49, 0x44, 0x41,
        0x54, 0x78, 0x9C, 0x63, 0x00, 0x01, 0x00, 0x00,
        0x05, 0x00, 0x01, 0x0D, 0x0A, 0x2D, 0xB4, 0x00,
        0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82,
      ]);
      const archive = await w.__zilventorPackAssembly(asmDoc, png);
      await opfsWrite(asmPath, archive);

      // Seed activeAssembly so CreateDrawingCommand can read it.
      const store = (window as unknown as {
        __zilventorStore: { setState(p: unknown): void };
      }).__zilventorStore;
      store.setState({ activeAssembly: asmDoc } as never);
    },
    { asmPath: ASM_PATH, partAPath: PART_A_PATH, partBPath: PART_B_PATH, partIdA, partIdB },
  );

  // ── Steps 4–6: CreateDrawing + base view + section view ───────────────────
  const { sheetId, sectionViewId, initialHatchCount } = await page.evaluate(
    async ({ asmPath, partIdA: pA }: { asmPath: string; partIdA: string }) => {
      const store = (window as unknown as {
        __zilventorStore: {
          getState(): {
            activeDocument: {
              kind: string;
              document: {
                id: string;
                sheets: Array<{
                  id: string;
                  views: Array<{
                    id: string;
                    kind: string;
                    hatchSegments?: unknown[];
                    projection?: { visibleEdges: unknown[]; bbox: { minX: number; minY: number; maxX: number; maxY: number } };
                    inputFingerprint?: string;
                  }>;
                }>;
              };
            } | null;
            activeDrawingSourceComponents: unknown[] | null;
            activeDrawingSourceFingerprint: string | null;
            activeDrawingSourcePartId: string | null;
            activeDrawingSourceComponents: Array<{ partId: string; pose: unknown }> | null;
            activePart: { id: string } | null;
            kernel: {
              execute(id: string): Promise<{ ok: boolean; error?: unknown }>;
              getProjectorInput(args: { kind: string; partId: string }): Promise<{ bbox: readonly number[] } | null>;
            } | null;
          };
          setState(p: unknown): void;
        };
      }).__zilventorStore;

      // Warm the kernel for Part A (required by AddSectionViewCommand namedShapeCache).
      const s0 = store.getState();
      if (s0.kernel && pA) await s0.kernel.execute(pA);

      // Step 4: Create drawing (assembly source).
      const { CreateDrawingCommand } = await import('/src/commands/CreateDrawingCommand.ts');
      await new CreateDrawingCommand({ sourcePath: asmPath, sourceKind: 'assembly' }).apply();

      const s1 = store.getState();
      if (!s1.activeDrawingSourceComponents || s1.activeDrawingSourceComponents.length < 2) {
        throw new Error(
          `T-6-28: activeDrawingSourceComponents must have ≥2 entries after CreateDrawingCommand. Got: ${JSON.stringify(s1.activeDrawingSourceComponents)}`,
        );
      }
      if (!s1.activeDrawingSourceFingerprint) {
        throw new Error('T-6-28: activeDrawingSourceFingerprint not set after CreateDrawingCommand');
      }

      const drawing = (s1.activeDocument as {
        document: { id: string; sheets: Array<{ id: string }> };
      }).document;
      const sheetId = drawing.sheets[0]!.id;

      // Step 5: AddBaseViewCommand (front, 1:1).
      const { AddBaseViewCommand } = await import('/src/commands/AddBaseViewCommand.ts');
      await new AddBaseViewCommand({
        sheetId,
        positionMm: { x: 80, y: 80 },
        orientation: 'front',
        scale: { numerator: 1, denominator: 1 },
      }).apply();

      const s2 = store.getState();
      const doc2 = (s2.activeDocument as {
        document: {
          sheets: Array<{
            id: string;
            views: Array<{
              id: string;
              kind: string;
              projection?: { visibleEdges: unknown[]; bbox: { minX: number; minY: number; maxX: number; maxY: number } };
            }>;
          }>;
        };
      }).document;
      const sh2 = doc2.sheets.find((s) => s.id === sheetId)!;
      const baseView = sh2.views.find((v) => v.kind === 'base')!;
      if (!baseView.projection || baseView.projection.visibleEdges.length === 0) {
        throw new Error('T-6-28: base view has no projected edges');
      }
      console.log('[T-6-28] base view projected edges:', baseView.projection.visibleEdges.length);

      // Patch base view with viewMatrix (required by AddSectionViewCommand to derive section plane).
      // front orientation: viewMatrix = translation(-cx, -cy, -cz) with identity rotation.
      {
        // For assembly drawings, activePart and activeDrawingSourcePartId are null.
        // Use the first component's partId from activeDrawingSourceComponents instead.
        const components = s2.activeDrawingSourceComponents as Array<{ partId: string }> | null;
        const partKernelId = s2.activeDrawingSourcePartId
          ?? s2.activePart?.id
          ?? components?.[0]?.partId;
        if (!partKernelId || !s2.kernel) throw new Error('T-6-28: kernel or partId not available for viewMatrix patch');
        const input = await s2.kernel.getProjectorInput({ kind: 'part', partId: partKernelId });
        if (!input) throw new Error('T-6-28: getProjectorInput returned null — part not cached');
        const [minX, minY, minZ, maxX, maxY, maxZ] = input.bbox;
        const cx = ((minX as number) + (maxX as number)) / 2;
        const cy = ((minY as number) + (maxY as number)) / 2;
        const cz = ((minZ as number) + (maxZ as number)) / 2;
        const vm = [1, 0, 0, -cx, 0, 1, 0, -cy, 0, 0, 1, -cz, 0, 0, 0, 1];
        console.log('[T-6-28] viewMatrix patch translation:', -cx, -cy, -cz);

        const cDoc = store.getState().activeDocument!.document;
        const patched = {
          ...cDoc,
          sheets: (cDoc as { sheets: Array<{ id: string; views: Array<Record<string, unknown>> }> }).sheets.map((sh) =>
            sh.id !== sheetId ? sh : {
              ...sh,
              views: sh.views.map((v) =>
                (v as { id: string })['id'] !== baseView.id ? v : { ...v, viewMatrix: vm }
              ),
            }
          ),
        };
        store.setState({
          activeDocument: { kind: 'drawing', document: patched },
          activeDrawing: patched,
        });
      }

      // Step 6: AddSectionViewCommand — full mode, cut at view-y=0 (world-y = midpoint of box Y).
      // Box is 30mm tall → midpoint at 15mm. View-space: y=0 cuts through the center.
      const { AddSectionViewCommand } = await import('/src/commands/AddSectionViewCommand.ts');
      await new AddSectionViewCommand({
        drawingId: drawing.id,
        sheetId,
        parentViewId: baseView.id,
        p0: { x: -20, y: 0 },
        p1: { x: 20, y: 0 },
        arrowDirection: 1 as -1 | 1,
        dropAt: { x: 200, y: 80 },
        mode: 'full',
      }).apply();

      const s3 = store.getState();
      const sh3 = (s3.activeDocument as {
        document: { sheets: Array<{ id: string; views: Array<{ id: string; kind: string; hatchSegments?: unknown[] }> }> };
      }).document.sheets.find((s) => s.id === sheetId)!;
      const sectionView = sh3.views.find((v) => v.kind === 'section')!;
      if (!sectionView) throw new Error('T-6-28: section view not found after AddSectionViewCommand');

      const initialHatchCount = sectionView.hatchSegments?.length ?? 0;
      console.log('[T-6-28] initial section hatchSegments:', initialHatchCount);

      return { sheetId, sectionViewId: sectionView.id, initialHatchCount };
    },
    { asmPath: ASM_PATH, partIdA },
  );

  // Assert real kernel cut ran at creation time (assembly cut wired in AddSectionViewCommand).
  expect(initialHatchCount, 'AddSectionViewCommand (assembly source) must produce hatch segments > 0').toBeGreaterThan(0);

  // ── Step 7: Pack → unpack round-trip ────────────────────────────────────────
  const { viewCountAfterUnpack } = await page.evaluate(async () => {
    const store = (window as unknown as {
      __zilventorStore: {
        getState(): { activeDocument: { kind: string; document: unknown } | null };
      };
    }).__zilventorStore;
    const state = store.getState();
    if (!state.activeDocument || state.activeDocument.kind !== 'drawing') {
      throw new Error('T-6-28 step 7: no active drawing');
    }

    const { packDrawing, unpackDrawing } = await import('/src/storage/DrawingPacker.ts');

    console.log('[T-6-28] STEP7: calling real packDrawing');
    const t0 = Date.now();
    const packedBytes = await packDrawing(state.activeDocument.document as Parameters<typeof packDrawing>[0]);
    console.log('[T-6-28] STEP7: packDrawing done in', Date.now() - t0, 'ms, bytes:', packedBytes.length);

    console.log('[T-6-28] STEP7: calling real unpackDrawing');
    const t1 = Date.now();
    const reopenedDoc = await unpackDrawing(packedBytes);
    console.log('[T-6-28] STEP7: unpackDrawing done in', Date.now() - t1, 'ms');

    (globalThis as unknown as Record<string, unknown>)['__t628_reopenedDoc'] = reopenedDoc;

    const viewCountAfterUnpack = (reopenedDoc as { sheets: Array<{ views: unknown[] }> }).sheets[0]?.views.length ?? 0;
    return { viewCountAfterUnpack };
  });

  expect(viewCountAfterUnpack, 'reopened drawing must have ≥2 views (base + section)').toBeGreaterThanOrEqual(2);

  // ── Step 7b: Overwrite OPFS Part A with Part B bytes to force staleness ───────
  // activateDrawingDocument re-reads the part bytes to compute the assembly fingerprint.
  // If the bytes are unchanged the fingerprint matches and the view is NOT marked stale.
  // Overwriting Part A with Part B bytes changes the djb2 hash → fingerprint differs →
  // stale marker appears. (Same pattern as T-6-19 step 7 and T-6-21 step 10.)
  await page.evaluate(
    async ({ partAPath }: { partAPath: string }) => {
      async function opfsWrite(path: string, data: Uint8Array): Promise<void> {
        const root = await navigator.storage.getDirectory();
        const parts = path.split('/').filter((p) => p.length > 0);
        let dir: FileSystemDirectoryHandle = root;
        for (let i = 0; i < parts.length - 1; i++) {
          dir = await dir.getDirectoryHandle(parts[i]!, { create: true });
        }
        const fh = await dir.getFileHandle(parts[parts.length - 1]!, { create: true });
        const wh = await fh.createWritable();
        await wh.write(data as unknown as FileSystemWriteChunkType);
        await wh.close();
      }
      const bytesB = (globalThis as unknown as Record<string, unknown>)['__t628_bytesB'] as Uint8Array;
      if (!bytesB) throw new Error('T-6-28 step 7b: bytesB not in globalThis — step 2 may have failed');
      // Overwrite Part A path with Part B bytes → djb2 hash of Part A changes.
      await opfsWrite(partAPath, bytesB);
    },
    { partAPath: PART_A_PATH },
  );

  // ── Step 8: activateDrawingDocument → loads components from .ziasm ──────────
  // This mirrors T-6-19 step 8. The assembly branch reads .ziasm from OPFS,
  // calls loadAssemblyForProjection, and sets activeDrawingSourceComponents (≥2).
  await page.evaluate(
    async ({ asmPath }: { asmPath: string }) => {
      async function opfsRead(path: string): Promise<Uint8Array> {
        const root = await navigator.storage.getDirectory();
        const parts = path.split('/').filter((p) => p.length > 0);
        let dir: FileSystemDirectoryHandle = root;
        for (let i = 0; i < parts.length - 1; i++) {
          dir = await dir.getDirectoryHandle(parts[i]!, { create: false });
        }
        const fh = await dir.getFileHandle(parts[parts.length - 1]!, { create: false });
        const file = await fh.getFile();
        return new Uint8Array(await file.arrayBuffer());
      }
      async function opfsExists(path: string): Promise<boolean> {
        try { await opfsRead(path); return true; } catch { return false; }
      }

      const opfsShim = { exists: opfsExists, read: opfsRead };
      const store = (window as unknown as {
        __zilventorStore: { getState(): { kernel: unknown } };
      }).__zilventorStore;
      const kernel = store.getState().kernel;
      const reopenedDoc = (globalThis as unknown as Record<string, unknown>)['__t628_reopenedDoc'];
      if (!reopenedDoc) throw new Error('T-6-28 step 8: reopenedDoc not in globalThis — step 7 may have failed');

      const { activateDrawingDocument } = await import('/src/drawing/activateDrawingDocument.ts');
      await activateDrawingDocument(reopenedDoc as never, {
        kernel: kernel as never,
        opfs: opfsShim as never,
      });

      // Verify activeDrawingSourceComponents was populated by the assembly branch.
      const afterActivate = (window as unknown as {
        __zilventorStore: {
          getState(): { activeDrawingSourceComponents: unknown[] | null };
        };
      }).__zilventorStore.getState();
      const compCount = afterActivate.activeDrawingSourceComponents?.length ?? 0;
      console.log('[T-6-28] STEP8: activeDrawingSourceComponents after reopen:', compCount);
      if (compCount < 2) {
        throw new Error(
          `T-6-28 step 8: activeDrawingSourceComponents has ${compCount} entries after activateDrawingDocument — assembly reopen path not wiring components. Check loadAssemblyForProjection.`,
        );
      }
      void asmPath;
    },
    { asmPath: ASM_PATH },
  );

  // ── Step 9: Switch to Drawing tab; assert section view stale marker ─────────
  await page.getByRole('tab', { name: 'Drawing' }).click();
  await expect(page.locator('[data-sheet-border]')).toBeVisible({ timeout: 15_000 });

  // Section view should be stale (fingerprint changed at activateDrawingDocument
  // because the assembly source was re-read and a new fingerprint computed).
  // Even if the source bytes are identical the fingerprint slot was updated, which
  // triggers the staleness useEffect in DrawingCanvas.
  const sectionStaleMarker = page.locator(`g[data-view-id="${sectionViewId}"] [data-stale-marker]`);
  await expect(sectionStaleMarker, 'section view must show stale marker after reopen').toBeVisible({ timeout: 15_000 });

  // ── Step 10: Regenerate ─────────────────────────────────────────────────────
  await sectionStaleMarker.click();

  // ── Step 11: Assert — no throw, hatch > 0, pose-aware ──────────────────────
  // Stale marker must clear (Regenerate did not throw "not yet supported").
  await expect(async () => {
    const count = await page.locator(`g[data-view-id="${sectionViewId}"] [data-stale-marker]`).count();
    expect(count, 'section stale marker must clear after Regenerate (no "not yet supported" throw)').toBe(0);
  }).toPass({ timeout: 30_000 });

  // Read hatchSegments from the store to confirm real kernel cut ran.
  // Compute both X and Y extents across all hatch p0/p1 points — pose-separation metric.
  // With Part A at world-X=0 and Part B at world-X=+100mm (both 30×30×20), the section is
  // a horizontal cut (looking along world-Y). In sectionViewMatrix space world-X maps to
  // view-Y, so the Y-extent of hatch segments is the discriminating axis:
  //   Posed (correct): Part A hatch at Y≈[−30,0], Part B at Y≈[−130,−100] → Y-extent ≈ 130mm
  //   Poseless (bug):  Both at origin, Y≈[−30,0] → Y-extent ≈ 30mm
  // Threshold 80mm cleanly separates both cases with ≥50mm margin either way.
  const { regenHatchCount, hatchXExtent, hatchYExtent } = await page.evaluate(
    ({ svId, shId }: { svId: string; shId: string }) => {
      const store = (window as unknown as {
        __zilventorStore: {
          getState(): {
            activeDocument?: {
              kind: string;
              document: {
                sheets: Array<{
                  id: string;
                  views: Array<{
                    id: string;
                    hatchSegments?: Array<{
                      materialId?: string;
                      p0?: { x: number; y: number };
                      p1?: { x: number; y: number };
                    }>;
                    projection?: {
                      visibleEdges: Array<{ points: ReadonlyArray<readonly [number, number]> }>;
                    };
                  }>;
                }>;
              };
            };
          };
        };
      }).__zilventorStore;
      const doc = store.getState().activeDocument;
      if (doc?.kind !== 'drawing') return { regenHatchCount: 0, hatchXExtent: 0 };
      const sh = doc.document.sheets.find((s) => s.id === shId);
      const sv = sh?.views.find((v) => v.id === svId) as {
        hatchSegments?: Array<{ p0?: { x: number; y: number }; p1?: { x: number; y: number } }>;
        projection?: { visibleEdges: Array<{ points: ReadonlyArray<readonly [number, number]> }> };
      } | undefined;

      const segments = sv?.hatchSegments ?? [];
      const count = segments.length;

      // Compute X-extent from hatch p0/p1 coordinates.
      // These are in view-space mm (pre-scale, from projectSectionView/generateHatchSegments).
      // With Part A at X=0 and Part B at X=+100mm, posed output spans ~[0..130mm].
      // Poseless (both at origin) spans only ~[0..30mm].
      let minX = Infinity, maxX = -Infinity;
      let minY = Infinity, maxY = -Infinity;
      for (const seg of segments) {
        if (seg.p0 != null) {
          if (seg.p0.x < minX) minX = seg.p0.x; if (seg.p0.x > maxX) maxX = seg.p0.x;
          if (seg.p0.y < minY) minY = seg.p0.y; if (seg.p0.y > maxY) maxY = seg.p0.y;
        }
        if (seg.p1 != null) {
          if (seg.p1.x < minX) minX = seg.p1.x; if (seg.p1.x > maxX) maxX = seg.p1.x;
          if (seg.p1.y < minY) minY = seg.p1.y; if (seg.p1.y > maxY) maxY = seg.p1.y;
        }
      }

      const hatchXExtent = Number.isFinite(maxX) ? maxX - minX : 0;
      const hatchYExtent = Number.isFinite(maxY) ? maxY - minY : 0;

      console.log(
        '[T-6-28] hatch bbox:',
        'X:', minX.toFixed(1), '→', maxX.toFixed(1), '(', hatchXExtent.toFixed(1), 'mm)',
        'Y:', minY.toFixed(1), '→', maxY.toFixed(1), '(', hatchYExtent.toFixed(1), 'mm)',
      );

      return { regenHatchCount: count, hatchXExtent, hatchYExtent };
    },
    { svId: sectionViewId, shId: sheetId },
  );

  console.log('[T-6-28] hatchSegments after Regenerate:', regenHatchCount,
    '| X-extent:', hatchXExtent.toFixed(1), 'mm | Y-extent:', hatchYExtent.toFixed(1), 'mm');
  expect(regenHatchCount, 'regenerated section view must have hatch segments > 0 (pose-aware assembly cut ran)').toBeGreaterThan(0);

  // ── Pose-separation assertion (real teeth) ────────────────────────────────
  // With Part A at world-X=0 and Part B at world-X=+100mm, the section is a
  // horizontal cut (looking along world-Y). In sectionViewMatrix space:
  //   world-X → view-Y  (the look-at maps world-X spread to Y spread)
  //   world-Z → view-X  (depth of box, 20mm)
  // Part A cut-face: sectionView Y ∈ [~-30, ~0] (30mm wide in Y)
  // Part B cut-face: sectionView Y ∈ [~-130, ~-100] (same width, offset 100mm)
  // Posed Y-extent: ~130mm. Poseless (both at origin): ~30mm.
  // Threshold 80mm cleanly separates both cases with ≥50mm margin either way.
  // This assertion FAILS if component poses are ignored (regressing to poseless cut).
  expect(
    hatchYExtent,
    `pose-separation: Y-extent of regenerated section hatch must be > 80mm ` +
    `(posed ≈ 130mm; poseless ≈ 30mm — got ${hatchYExtent.toFixed(1)}mm)`
  ).toBeGreaterThan(80);
});

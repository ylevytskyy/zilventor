// tests/e2e/drawing/T-6-23-drawing-export-source.spec.ts
/**
 * T-6-23 — Export buttons enabled for drawings without an activePart/activeAssembly stub.
 *
 * Before this fix, DrawingTab read `source = activePart ?? activeAssembly`.
 * CreateDrawingCommand sets activeDocument to a drawing (nulling activePart/activeAssembly),
 * so export buttons were always disabled after creation unless a stub was injected (as done
 * in T-6-22 Step 8). The fix adds `activeDrawingSourceDocument` store slot populated by
 * CreateDrawingCommand; DrawingTab now falls back to that slot.
 *
 * This spec has TEETH: the absence of a stub IS the regression proof.
 *
 * Test 1 — Part variant:
 *   1. Build a 40×40×20 box; save bytes to OPFS as 'parts/src-T623.zipt'.
 *   2. CreateDrawingCommand (part-sourced) — sets activeDrawingSourceDocument.
 *   3. NO activePart stub injected.
 *   4. Switch to Drawing tab.
 *   5. Assert all four export buttons (Export PDF/SVG/PNG/DXF) are enabled.
 *   6. Assert activePart === null AND activeDrawingSourceDocument is truthy (slot proof).
 *   7. Click Export DXF → capture download → assert path() truthy.
 *
 * Test 2 — Assembly variant:
 *   1. Build two boxes; pack a .ziasm; seed activeAssembly in store.
 *   2. CreateDrawingCommand (assembly-sourced) — sets activeDrawingSourceDocument.
 *   3. NO stub injected.
 *   4. Switch to Drawing tab.
 *   5. Assert all four export buttons enabled.
 *   6. Assert activeAssembly === null AND activeDrawingSourceDocument is truthy (slot proof).
 */
import { test, expect } from '@playwright/test';
import { buildBox, waitForKernelReady } from '../helpers/buildBox';

const PART_SOURCE_PATH = 'parts/src-T623.zipt';
const ASM_PATH_T623 = 'assemblies/t623.ziasm';
const PART_A_PATH_T623 = 'parts/t623-A.zipt';
const PART_B_PATH_T623 = 'parts/t623-B.zipt';

// ─── Helper: write bytes to OPFS ──────────────────────────────────────────────
async function opfsWriteInPage(page: import('@playwright/test').Page, path: string, data: Uint8Array): Promise<void> {
  await page.evaluate(
    async ({ p, d }: { p: string; d: number[] }) => {
      const bytes = new Uint8Array(d);
      const root = await navigator.storage.getDirectory();
      const parts2 = p.split('/').filter((x) => x.length > 0);
      let dir: FileSystemDirectoryHandle = root;
      for (let i = 0; i < parts2.length - 1; i++) {
        dir = await dir.getDirectoryHandle(parts2[i]!, { create: true });
      }
      const fh = await dir.getFileHandle(parts2[parts2.length - 1]!, { create: true });
      const w = await fh.createWritable();
      await w.write(bytes as unknown as FileSystemWriteChunkType);
      await w.close();
    },
    { p: path, d: Array.from(data) },
  );
}

// ─── Test 1: Part-sourced drawing — buttons enabled without activePart stub ───
test('T-6-23a: part-sourced drawing — export buttons enabled without activePart stub', async ({ page }) => {
  test.setTimeout(240_000);
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

  // Step 1: Build box part; save bytes to OPFS.
  await buildBox(page, { width: 40, height: 40, depth: 20 });

  const { partIdA } = await page.evaluate(
    async ({ sourcePath }: { sourcePath: string }) => {
      async function opfsWrite(path: string, data: Uint8Array): Promise<void> {
        const root = await navigator.storage.getDirectory();
        const parts2 = path.split('/').filter((p) => p.length > 0);
        let dir: FileSystemDirectoryHandle = root;
        for (let i = 0; i < parts2.length - 1; i++) {
          dir = await dir.getDirectoryHandle(parts2[i]!, { create: true });
        }
        const fh = await dir.getFileHandle(parts2[parts2.length - 1]!, { create: true });
        const w = await fh.createWritable();
        await w.write(data as unknown as FileSystemWriteChunkType);
        await w.close();
      }

      const store = (window as unknown as {
        __zilventorStore: {
          getState(): {
            activePart: { id: string } | null;
            kernel: {
              execute(id: string): Promise<unknown>;
              saveToBytes(id: string): Promise<Uint8Array>;
            } | null;
          };
        };
      }).__zilventorStore;

      const s = store.getState();
      if (!s.activePart || !s.kernel) throw new Error('T-6-23a step 1: kernel or activePart not ready');
      await s.kernel.execute(s.activePart.id);
      const bytes = await s.kernel.saveToBytes(s.activePart.id);
      await opfsWrite(sourcePath, bytes);
      return { partIdA: s.activePart.id };
    },
    { sourcePath: PART_SOURCE_PATH },
  );

  // Step 2: CreateDrawingCommand (part-sourced). NO activePart stub after this.
  await page.evaluate(
    async ({ sourcePath, partId }: { sourcePath: string; partId: string }) => {
      const store = (window as unknown as {
        __zilventorStore: {
          getState(): {
            kernel: {
              execute(id: string): Promise<unknown>;
            } | null;
          };
        };
      }).__zilventorStore;

      // Warm kernel cache for the box.
      const s0 = store.getState();
      if (s0.kernel) await s0.kernel.execute(partId);

      const { CreateDrawingCommand } = await import('/src/commands/CreateDrawingCommand.ts');
      await new CreateDrawingCommand({ sourcePath, sourceKind: 'part' }).apply();
    },
    { sourcePath: PART_SOURCE_PATH, partId: partIdA },
  );

  // Step 3 (intentionally absent): NO activePart stub injection — absence is the regression proof.

  // Step 4: Switch to Drawing tab.
  await page.getByRole('tab', { name: 'Drawing' }).click();
  await expect(page.locator('[data-sheet-border]')).toBeVisible({ timeout: 15_000 });

  // Step 5: Assert all four export buttons enabled — WITHOUT any activePart stub.
  for (const label of ['Export PDF', 'Export SVG', 'Export PNG', 'Export DXF']) {
    await expect(
      page.getByRole('button', { name: label }),
      `${label} button must be enabled (activeDrawingSourceDocument set by CreateDrawingCommand)`,
    ).toBeEnabled({ timeout: 5_000 });
  }

  // Step 6: Prove it is the slot (not activePart) that enabled them.
  const storeSlot = await page.evaluate(() => {
    const store = (window as unknown as {
      __zilventorStore: {
        getState(): {
          activePart: unknown;
          activeAssembly: unknown;
          activeDrawingSourceDocument: unknown;
        };
      };
    }).__zilventorStore;
    const s = store.getState();
    return {
      activePart: s.activePart,
      activeAssembly: s.activeAssembly,
      activeDrawingSourceDocument: s.activeDrawingSourceDocument,
    };
  });

  expect(storeSlot.activePart, 'activePart must be null — NO stub was injected').toBeNull();
  expect(
    storeSlot.activeDrawingSourceDocument,
    'activeDrawingSourceDocument must be truthy (set by CreateDrawingCommand, enabled the buttons)',
  ).toBeTruthy();

  // Step 7: Trigger real DXF export — capture download.
  await page.evaluate(() => {
    (window as unknown as Record<string, unknown>).showSaveFilePicker = undefined;
  });

  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 30_000 }),
    page.getByRole('button', { name: 'Export DXF' }).click(),
  ]);

  expect(await download.path(), 'DXF download path must be truthy (file was written to disk)').toBeTruthy();
  console.log('[T-6-23a] DXF download filename:', download.suggestedFilename());

  // No unexpected browser errors.
  if (consoleErrors.length > 0) {
    console.log('[T-6-23a] BROWSER ERRORS:', consoleErrors.join('\n'));
  }
  expect(consoleErrors, 'No browser errors during the test').toHaveLength(0);

  console.log('[T-6-23a] PASSED: activePart=null, activeDrawingSourceDocument truthy, DXF downloaded');
});

// ─── Test 2: Assembly-sourced drawing — buttons enabled without activeAssembly stub ─
test('T-6-23b: assembly-sourced drawing — export buttons enabled without activeAssembly stub', async ({ page }) => {
  test.setTimeout(240_000);
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

  // Step 1a: Build Part A (50×50×30); save to OPFS.
  await buildBox(page, { width: 50, height: 50, depth: 30 });

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
      if (!s.activePart || !s.kernel) throw new Error('T-6-23b step 1: kernel or activePart not ready');
      await s.kernel.execute(s.activePart.id);
      const bytesA = await s.kernel.saveToBytes(s.activePart.id);
      await opfsWrite(partAPath, bytesA);
      return { partIdA: s.activePart.id };
    },
    { partAPath: PART_A_PATH_T623 },
  );

  // Step 1b: Build Part B (40×40×20); save to OPFS.
  await buildBox(page, { width: 40, height: 40, depth: 20 });

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
      if (!s.activePart || !s.kernel) throw new Error('T-6-23b step 2: kernel or activePart not ready');
      await s.kernel.execute(s.activePart.id);
      const bytesB = await s.kernel.saveToBytes(s.activePart.id);
      await opfsWrite(partBPath, bytesB);
      return { partIdB: s.activePart.id };
    },
    { partBPath: PART_B_PATH_T623 },
  );

  // Step 2: Pack a .ziasm for the 2-part assembly; seed it to OPFS; set activeAssembly in store.
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

      const asmDoc = {
        id: 'asm-t623',
        name: 'T623 Assembly',
        units: 'mm',
        parameters: {},
        components: [
          {
            id: partIdA,
            partPath: partAPath,
            position: { x: 60, y: 0, z: 0 },
            rotation: { rx: 0, ry: 0, rz: 0 },
            visible: true,
            flexible: false,
          },
          {
            id: partIdB,
            partPath: partBPath,
            position: { x: -40, y: 0, z: 0 },
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
        __zilventorStore: { setState(p: unknown): void };
      };
      if (!w.__zilventorPackAssembly) {
        throw new Error('T-6-23b: __zilventorPackAssembly dev hook not found on window');
      }
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

      // Set activeAssembly in store so CreateDrawingCommand can read it.
      w.__zilventorStore.setState({ activeAssembly: asmDoc });
    },
    { asmPath: ASM_PATH_T623, partAPath: PART_A_PATH_T623, partBPath: PART_B_PATH_T623, partIdA, partIdB },
  );

  // Step 3: CreateDrawingCommand (assembly-sourced). Sets activeDrawingSourceDocument.
  await page.evaluate(
    async ({ asmPath }: { asmPath: string }) => {
      const { CreateDrawingCommand } = await import('/src/commands/CreateDrawingCommand.ts');
      await new CreateDrawingCommand({ sourcePath: asmPath, sourceKind: 'assembly' }).apply();
    },
    { asmPath: ASM_PATH_T623 },
  );

  // Step 4 (intentionally absent): NO activeAssembly stub injection.

  // Step 5: Switch to Drawing tab.
  await page.getByRole('tab', { name: 'Drawing' }).click();
  await expect(page.locator('[data-sheet-border]')).toBeVisible({ timeout: 15_000 });

  // Step 6: Assert all four export buttons enabled — WITHOUT any activeAssembly stub.
  for (const label of ['Export PDF', 'Export SVG', 'Export PNG', 'Export DXF']) {
    await expect(
      page.getByRole('button', { name: label }),
      `${label} button must be enabled (activeDrawingSourceDocument set by assembly CreateDrawingCommand)`,
    ).toBeEnabled({ timeout: 5_000 });
  }

  // Step 7: Prove it is the slot (not activeAssembly) that enabled them.
  const storeSlot = await page.evaluate(() => {
    const store = (window as unknown as {
      __zilventorStore: {
        getState(): {
          activePart: unknown;
          activeAssembly: unknown;
          activeDrawingSourceDocument: unknown;
        };
      };
    }).__zilventorStore;
    const s = store.getState();
    return {
      activePart: s.activePart,
      activeAssembly: s.activeAssembly,
      activeDrawingSourceDocument: s.activeDrawingSourceDocument,
    };
  });

  expect(storeSlot.activeAssembly, 'activeAssembly must be null — NO stub was injected').toBeNull();
  expect(
    storeSlot.activeDrawingSourceDocument,
    'activeDrawingSourceDocument must be truthy (set by assembly CreateDrawingCommand)',
  ).toBeTruthy();

  // No unexpected browser errors.
  if (consoleErrors.length > 0) {
    console.log('[T-6-23b] BROWSER ERRORS:', consoleErrors.join('\n'));
  }
  expect(consoleErrors, 'No browser errors during the test').toHaveLength(0);

  console.log('[T-6-23b] PASSED: activeAssembly=null, activeDrawingSourceDocument truthy, all export buttons enabled');
});

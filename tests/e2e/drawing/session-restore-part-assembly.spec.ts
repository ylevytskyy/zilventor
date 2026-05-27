// tests/e2e/drawing/session-restore-part-assembly.spec.ts
/**
 * Session-restore e2e — Part + Assembly (Task 4 of 2026-05-27 plan).
 *
 * Proves the full loop for both non-drawing document kinds:
 *   1. Build a real part / pack a real assembly.
 *   2. Wait ≥500ms for the autosave debounce → setLastOpenDocument fires.
 *   3. page.reload() → boot effect calls restoreLastOpenDocument.
 *   4. After reload + kernel-ready, assert:
 *      - activeDocument.kind === 'part' | 'assembly' (store bridge)
 *      - PART: activePart is set + kernel is warm (kernel.execute on the part id succeeds)
 *      - ASSEMBLY: activeAssembly has expected component count
 *
 * Import idiom: `await import('/src/...')` inside page.evaluate — commands are
 * NOT window-exposed (per lesson from T-6-15 / T-6-20).
 *
 * Console errors FAIL the test; all browser output is printed.
 */
import { test, expect } from '@playwright/test';
import { buildBox, waitForKernelReady } from '../helpers/buildBox';

/** Minimal 1×1 transparent PNG — shared across both tests. */
const MINIMAL_PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41,
  0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00,
  0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
]);

// ─── Part restore ────────────────────────────────────────────────────────────

test('session-restore: part is restored as active document after reload', async ({ page }) => {
  test.setTimeout(180_000);
  page.setDefaultTimeout(90_000);

  const consoleErrors: string[] = [];
  page.on('console', (m) => {
    console.log('BROWSER:', m.type(), m.text());
    if (m.type() === 'error') consoleErrors.push(m.text());
  });
  page.on('pageerror', (e) => {
    console.log('PAGEERROR:', e.message);
    consoleErrors.push(e.message);
  });

  await page.goto('/');
  await waitForKernelReady(page);

  // 1. Build a 40×40×25 box part via UI ribbon.
  await buildBox(page, { width: 40, height: 40, depth: 25 });

  // 2. Read the active part id + save bytes to OPFS at a stable path.
  //    (autosave will write to `${name}.zipt`; we confirm via localStorage polling.)
  const { partId, partName } = await page.evaluate(async () => {
    const store = (window as unknown as {
      __zilventorStore: {
        getState(): {
          activePart: { id: string; name: string } | null;
          kernel: {
            execute(id: string): Promise<{ ok: boolean; error?: unknown }>;
            saveToBytes(id: string): Promise<Uint8Array>;
          } | null;
        };
      };
    }).__zilventorStore;

    const s = store.getState();
    if (!s.activePart || !s.kernel) throw new Error('session-restore part step 1: kernel or activePart not ready');
    // Ensure geometry is built before we try saveToBytes.
    await s.kernel.execute(s.activePart.id);
    return { partId: s.activePart.id, partName: s.activePart.name };
  });

  // 3. Wait for autosave debounce (500ms) + localStorage pointer.
  //    The autosave effect writes <name>.zipt then sets setLastOpenDocument({kind:'part',...}).
  await page.waitForFunction(
    () => {
      const raw = localStorage.getItem('zilventor:lastOpenDocument');
      if (!raw) return false;
      try {
        const p = JSON.parse(raw) as { kind?: string };
        return p.kind === 'part';
      } catch {
        return false;
      }
    },
    undefined,
    { timeout: 10_000 },
  );

  // Verify localStorage pointer + OPFS file.
  const autosaveVerified = await page.evaluate(
    async ({ expectedPartName }: { expectedPartName: string }) => {
      const raw = localStorage.getItem('zilventor:lastOpenDocument');
      if (!raw) return { ok: false, reason: 'localStorage pointer not set' };
      let pointer: Record<string, unknown>;
      try { pointer = JSON.parse(raw) as Record<string, unknown>; } catch {
        return { ok: false, reason: 'localStorage pointer not valid JSON' };
      }
      if (pointer['kind'] !== 'part') return { ok: false, reason: `pointer kind is ${pointer['kind']}` };
      const opfsPath = pointer['opfsPath'] as string;
      if (!opfsPath.includes(expectedPartName)) {
        return { ok: false, reason: `opfsPath "${opfsPath}" does not include part name "${expectedPartName}"` };
      }
      // Check OPFS file exists.
      try {
        const root = await navigator.storage.getDirectory();
        const parts = opfsPath.split('/').filter((p: string) => p.length > 0);
        let dir: FileSystemDirectoryHandle = root;
        for (let i = 0; i < parts.length - 1; i++) {
          dir = await dir.getDirectoryHandle(parts[i]!, { create: false });
        }
        await dir.getFileHandle(parts[parts.length - 1]!, { create: false });
      } catch {
        return { ok: false, reason: `OPFS file "${opfsPath}" not found` };
      }
      return { ok: true, reason: '', opfsPath };
    },
    { expectedPartName: partName },
  );

  expect(autosaveVerified.ok, `Autosave not verified: ${autosaveVerified.reason}`).toBe(true);
  console.log('[session-restore] part autosave verified at:', autosaveVerified.opfsPath);

  // 4. Reload — boot effect calls restoreLastOpenDocument.
  await page.reload();
  await expect(page.getByText(/^(Ready|Opened)$/)).toBeVisible({ timeout: 120_000 });

  // 5. Wait for boot-restore: activeDocument.kind === 'part'.
  await page.waitForFunction(
    () => {
      const store = (window as unknown as {
        __zilventorStore?: {
          getState(): { activeDocument: { kind: string } | null };
        };
      }).__zilventorStore;
      return store?.getState()?.activeDocument?.kind === 'part';
    },
    undefined,
    { timeout: 30_000 },
  );

  // 6. Assert part is editable — activePart set + kernel warm (execute succeeds).
  const kernelWarm = await page.evaluate(
    async ({ expectedPartId }: { expectedPartId: string }) => {
      const store = (window as unknown as {
        __zilventorStore: {
          getState(): {
            activeDocument: { kind: string; document: { id: string } } | null;
            activePart: { id: string; name: string } | null;
            kernel: {
              execute(id: string): Promise<{ ok: boolean; error?: unknown }>;
            } | null;
          };
        };
      }).__zilventorStore;

      const s = store.getState();
      if (!s.activePart) return { ok: false, reason: 'activePart is null after restore' };
      if (!s.kernel) return { ok: false, reason: 'kernel is null after restore' };

      // The restored part's id is the kernel id returned by loadFromBytes — it may differ
      // from the original pre-reload id (OCCT returns a new handle each load).
      // What matters: execute succeeds on the restored part's id.
      const restoredKernelId = s.activePart.id;
      const result = await s.kernel.execute(restoredKernelId);

      return {
        ok: result.ok,
        reason: result.ok ? '' : `kernel.execute failed: ${JSON.stringify(result)}`,
        restoredKernelId,
        originalPartId: expectedPartId,
        activeDocKind: s.activeDocument?.kind ?? 'null',
        partName: s.activePart.name,
      };
    },
    { expectedPartId: partId },
  );

  console.log('[session-restore] kernel warm check:', kernelWarm);
  expect(kernelWarm.ok, `Kernel not warm after part restore: ${kernelWarm.reason}`).toBe(true);
  expect((kernelWarm as { activeDocKind?: string }).activeDocKind).toBe('part');

  // 7. No console errors.
  expect(consoleErrors, `Console errors after part restore: ${consoleErrors.join('; ')}`).toHaveLength(0);
});

// ─── Assembly restore ─────────────────────────────────────────────────────────

test('session-restore: assembly is restored as active document after reload', async ({ page }) => {
  test.setTimeout(180_000);
  page.setDefaultTimeout(90_000);

  const consoleErrors: string[] = [];
  page.on('console', (m) => {
    console.log('BROWSER:', m.type(), m.text());
    if (m.type() === 'error') consoleErrors.push(m.text());
  });
  page.on('pageerror', (e) => {
    console.log('PAGEERROR:', e.message);
    consoleErrors.push(e.message);
  });

  await page.goto('/');
  await waitForKernelReady(page);

  // 1. Build a cube part via UI and save to OPFS for the assembly to reference.
  await buildBox(page, { width: 30, height: 30, depth: 30 });

  const PART_PATH = 'parts/session-restore-cube.zipt';
  const ASM_NAME = 'SessionRestoreAsm';
  const ASM_PATH = `${ASM_NAME}.ziasm`;

  await page.evaluate(
    async ({ partPath }: { partPath: string }) => {
      async function opfsWrite(path: string, data: Uint8Array): Promise<void> {
        const root = await navigator.storage.getDirectory();
        const segs = path.split('/').filter((p) => p.length > 0);
        let dir: FileSystemDirectoryHandle = root;
        for (let i = 0; i < segs.length - 1; i++) {
          dir = await dir.getDirectoryHandle(segs[i]!, { create: true });
        }
        const fh = await dir.getFileHandle(segs[segs.length - 1]!, { create: true });
        const w2 = await fh.createWritable();
        await w2.write(data as unknown as FileSystemWriteChunkType);
        await w2.close();
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
      if (!s.activePart || !s.kernel) throw new Error('session-restore asm step 1: kernel or activePart not ready');
      await s.kernel.execute(s.activePart.id);
      const bytes = await s.kernel.saveToBytes(s.activePart.id);
      await opfsWrite(partPath, bytes);
    },
    { partPath: PART_PATH },
  );

  // 2. Create a new assembly via File ribbon, add 2 components, and write to OPFS.
  await page.getByRole('tab', { name: 'File' }).click();
  await page.getByRole('button', { name: /new assembly/i }).click();
  await page.waitForFunction(() => {
    const w = window as unknown as { __zilventorStore?: { getState(): { activeDocument: { kind: string } | null } } };
    return w.__zilventorStore?.getState().activeDocument?.kind === 'assembly';
  });

  // Add 2 components via store + rename assembly.
  const { asmId } = await page.evaluate(
    async ({ partPath, asmName, asmPath, png }: {
      partPath: string; asmName: string; asmPath: string; png: number[];
    }) => {
      const w = window as unknown as {
        __zilventorStore: {
          getState(): {
            activeAssembly: { id: string; name: string; components: unknown[] } | null;
            kernel: unknown;
          };
          setState(patch: unknown): void;
        };
        __zilventorPackAssembly: (doc: unknown, thumb: Uint8Array) => Promise<Uint8Array>;
        __zilventorGetOpfs: () => Promise<{ write(path: string, data: Uint8Array): Promise<void> }>;
      };

      const s = w.__zilventorStore.getState();
      if (!s.activeAssembly) throw new Error('session-restore asm step 2: no activeAssembly');

      // Rename to known name (so we can predict the autosave path).
      const renamedAsm = { ...s.activeAssembly, name: asmName };

      // Add 2 cube components.
      renamedAsm.components = [
        {
          id: 'C0', partPath, flexible: false, visible: true,
          position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 },
        },
        {
          id: 'C1', partPath, flexible: false, visible: true,
          position: { x: 60, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 },
        },
      ];

      // Patch the full assembly document to include all required fields.
      const fullAsm = {
        ...renamedAsm,
        parameters: renamedAsm.parameters ?? {},
        constraints: (renamedAsm as Record<string, unknown>)['constraints'] ?? [],
        groundedComponentPaths: (renamedAsm as Record<string, unknown>)['groundedComponentPaths'] ?? [],
        bomItemNumbers: (renamedAsm as Record<string, unknown>)['bomItemNumbers'] ?? {},
        cutListItemNumbers: (renamedAsm as Record<string, unknown>)['cutListItemNumbers'] ?? {},
        colorOverrides: (renamedAsm as Record<string, unknown>)['colorOverrides'] ?? {},
        colors: (renamedAsm as Record<string, unknown>)['colors'] ?? {},
        properties: (renamedAsm as Record<string, unknown>)['properties'] ?? {},
        materials: (renamedAsm as Record<string, unknown>)['materials'] ?? [],
        hardware: (renamedAsm as Record<string, unknown>)['hardware'] ?? [],
        units: (renamedAsm as Record<string, unknown>)['units'] ?? 'mm',
      };

      w.__zilventorStore.setState({
        activeDocument: { kind: 'assembly', document: fullAsm },
        activeAssembly: fullAsm,
      });

      // Also pack + write to OPFS directly so the autosave can overwrite with the same path.
      const thumbnail = new Uint8Array(png);
      const archive = await w.__zilventorPackAssembly(fullAsm, thumbnail);
      const opfs = await w.__zilventorGetOpfs();
      await opfs.write(asmPath, archive);

      return { asmId: fullAsm.id };
    },
    { partPath: PART_PATH, asmName: ASM_NAME, asmPath: ASM_PATH, png: Array.from(MINIMAL_PNG) },
  );

  // 3. Wait for autosave pointer to be set for assembly kind.
  await page.waitForFunction(
    () => {
      const raw = localStorage.getItem('zilventor:lastOpenDocument');
      if (!raw) return false;
      try {
        const p = JSON.parse(raw) as { kind?: string };
        return p.kind === 'assembly';
      } catch {
        return false;
      }
    },
    undefined,
    { timeout: 10_000 },
  );

  // Verify localStorage pointer + OPFS file.
  const asmAutosaveVerified = await page.evaluate(
    async ({ expectedAsmName }: { expectedAsmName: string }) => {
      const raw = localStorage.getItem('zilventor:lastOpenDocument');
      if (!raw) return { ok: false, reason: 'localStorage pointer not set' };
      let pointer: Record<string, unknown>;
      try { pointer = JSON.parse(raw) as Record<string, unknown>; } catch {
        return { ok: false, reason: 'localStorage pointer not valid JSON' };
      }
      if (pointer['kind'] !== 'assembly') return { ok: false, reason: `pointer kind is ${pointer['kind']}` };
      const opfsPath = pointer['opfsPath'] as string;
      if (!opfsPath.includes(expectedAsmName)) {
        return { ok: false, reason: `opfsPath "${opfsPath}" does not include asm name "${expectedAsmName}"` };
      }
      // Check OPFS file exists.
      try {
        const root = await navigator.storage.getDirectory();
        const parts = opfsPath.split('/').filter((p: string) => p.length > 0);
        let dir: FileSystemDirectoryHandle = root;
        for (let i = 0; i < parts.length - 1; i++) {
          dir = await dir.getDirectoryHandle(parts[i]!, { create: false });
        }
        await dir.getFileHandle(parts[parts.length - 1]!, { create: false });
      } catch {
        return { ok: false, reason: `OPFS file "${opfsPath}" not found` };
      }
      return { ok: true, reason: '', opfsPath };
    },
    { expectedAsmName: ASM_NAME },
  );

  expect(asmAutosaveVerified.ok, `Assembly autosave not verified: ${asmAutosaveVerified.reason}`).toBe(true);
  console.log('[session-restore] assembly autosave verified at:', asmAutosaveVerified.opfsPath);

  // 4. Reload.
  await page.reload();
  await expect(page.getByText(/^(Ready|Opened)$/)).toBeVisible({ timeout: 120_000 });

  // 5. Wait for boot-restore: activeDocument.kind === 'assembly'.
  await page.waitForFunction(
    () => {
      const store = (window as unknown as {
        __zilventorStore?: {
          getState(): { activeDocument: { kind: string } | null };
        };
      }).__zilventorStore;
      return store?.getState()?.activeDocument?.kind === 'assembly';
    },
    undefined,
    { timeout: 30_000 },
  );

  // 6. Assert: activeAssembly is set with 2 components (component count proves round-trip).
  const asmRestored = await page.evaluate(
    ({ expectedAsmId }: { expectedAsmId: string }) => {
      const store = (window as unknown as {
        __zilventorStore: {
          getState(): {
            activeDocument: { kind: string; document: { id: string } } | null;
            activeAssembly: { id: string; name: string; components: unknown[] } | null;
          };
        };
      }).__zilventorStore;

      const s = store.getState();
      const asm = s.activeAssembly;
      if (!asm) return { ok: false, reason: 'activeAssembly is null after restore', compCount: 0 };

      return {
        ok: true,
        reason: '',
        compCount: asm.components.length,
        asmName: asm.name,
        restoredId: asm.id,
        originalId: expectedAsmId,
        activeDocKind: s.activeDocument?.kind ?? 'null',
      };
    },
    { expectedAsmId: asmId },
  );

  console.log('[session-restore] assembly restore check:', asmRestored);
  expect(asmRestored.ok, `Assembly not restored: ${asmRestored.reason}`).toBe(true);
  expect((asmRestored as { activeDocKind?: string }).activeDocKind).toBe('assembly');
  expect((asmRestored as { compCount?: number }).compCount, 'restored assembly must have 2 components').toBe(2);

  // 7. No console errors.
  expect(consoleErrors, `Console errors after assembly restore: ${consoleErrors.join('; ')}`).toHaveLength(0);
});

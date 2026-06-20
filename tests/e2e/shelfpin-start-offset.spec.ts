/**
 * E2E §6: System-32 configurable start offset (Milestone 1a.4).
 *
 * Headless viewport is BLACK — no screenshots. Bore MARKERS are rendered from
 * `document.bores`, so "the first-hole marker shifts" is proven by the persisted
 * front-column min-u moving in OPFS after a real-browser command round-trip.
 *
 * Flow (all via the real bus, real kernel packing, real OPFS):
 *   A. New assembly + materials → CreateCabinetCommand (base cabinet).
 *   B. GenerateShelfPinBoresCommand (DEFAULT params) → find a side panel that got
 *      shelf-pin bores; capture the centered front-column min-u (= 72 for H=720).
 *   C. UpdateShelfPinStartOffsetCommand startOffset=48 → front-column first hole
 *      re-anchors to bottomMargin+48 = 112; persisted shelfPinParams.startOffset=48.
 *   D. Undo via __zilventorStore.getState().bus.undo() → min-u + params restore.
 *   E. Zero browser errors.
 */
import { test, expect } from '@playwright/test';
import { waitForKernelReady } from './helpers/buildBox';

/** Read a panel's shelf-pin front-column min-u + persisted startOffset from OPFS. */
async function probeFrontColumn(
  page: import('@playwright/test').Page,
  partPath: string,
): Promise<{ minU: number; startOffset: number | undefined; count: number }> {
  return page.evaluate(async (p: string) => {
    const w = window as unknown as {
      __zilventorGetOpfs(): Promise<{ read(path: string): Promise<Uint8Array> }>;
      __zilventorUnpackProject: (bytes: Uint8Array) => Promise<{ manifest: unknown }>;
    };
    const opfs = await w.__zilventorGetOpfs();
    const project = await w.__zilventorUnpackProject(await opfs.read(p));
    const doc = (project.manifest as {
      document: { bores?: Array<{ connectorId: string; u: number }>; shelfPinParams?: { startOffset?: number } };
    }).document;
    const front = (doc.bores ?? []).filter((b) => b.connectorId === 'pin-col-front');
    const minU = front.length ? Math.min(...front.map((b) => b.u)) : -1;
    return { minU, startOffset: doc.shelfPinParams?.startOffset, count: front.length };
  }, partPath);
}

test(
  'shelfpin-start-offset: Update re-anchors front column in OPFS + undo restores (real browser)',
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

    // ── A1. New assembly ──────────────────────────────────────────────────────
    await page.getByRole('tab', { name: 'File' }).click();
    await page.getByRole('button', { name: /new assembly/i }).click();
    await page.waitForFunction(() => {
      const w = window as unknown as {
        __zilventorStore: { getState(): { activeDocument?: { kind: string } } };
      };
      return w.__zilventorStore?.getState().activeDocument?.kind === 'assembly';
    });

    // ── A2. Register cabinet materials ────────────────────────────────────────
    await page.evaluate(() => {
      const w = window as unknown as {
        __zilventorStore: { getState(): { addMaterial(m: unknown): void } };
      };
      const add = w.__zilventorStore.getState().addMaterial;
      add({ id: 'm-birch-18', name: 'Birch 18mm', defaultThickness: 18, color: '#d8c896' });
      add({ id: 'm-hb-6', name: 'Hardboard 6mm', defaultThickness: 6, color: '#8b6f47' });
    });

    // ── A3. CreateCabinetCommand (base cabinet) ───────────────────────────────
    await page.evaluate(async () => {
      const w = window as unknown as {
        __zilventorStore: { getState(): { bus: { execute(c: unknown): Promise<void> } } };
        __zilventorGetOpfs(): Promise<{ read(p: string): Promise<Uint8Array>; write(p: string, b: Uint8Array): Promise<void> }>;
      };
      const { CreateCabinetCommand } = await import('/src/commands/CreateCabinetCommand.ts');
      const opfs = await w.__zilventorGetOpfs();
      await w.__zilventorStore.getState().bus.execute(new CreateCabinetCommand({
        template: 'baseCabinet',
        params: {
          name: 'Pin Cabinet', width: 600, depth: 560, height: 720,
          toekickHeight: 100, toekickSetback: 50, shelfCount: 0,
          carcassMaterialId: 'm-birch-18', backMaterialId: 'm-hb-6', bandMaterialId: null,
        },
        opfs,
      }));
    });
    await page.waitForFunction(() => {
      const w = window as unknown as {
        __zilventorStore: { getState(): { activeAssembly: { components: unknown[] } | null } };
      };
      return (w.__zilventorStore.getState().activeAssembly?.components.length ?? 0) === 1;
    }, undefined, { timeout: 30_000 });

    // ── B. GenerateShelfPinBoresCommand (DEFAULT params) ──────────────────────
    await page.evaluate(async () => {
      const w = window as unknown as {
        __zilventorStore: { getState(): { bus: { execute(c: unknown): Promise<void> } } };
        __zilventorGetOpfs(): Promise<{ read(p: string): Promise<Uint8Array>; write(p: string, b: Uint8Array): Promise<void> }>;
      };
      const { GenerateShelfPinBoresCommand } = await import('/src/commands/GenerateShelfPinBoresCommand.ts');
      const opfs = await w.__zilventorGetOpfs();
      // DEFAULT_SHELF_PIN_PARAMS inlined to avoid a fragile shared-package dev-server import.
      const params = {
        pitch: 32, diameter: 5, depth: 13, frontSetback: 37, backSetback: 37,
        topMargin: 64, bottomMargin: 64, columns: 2,
      };
      await w.__zilventorStore.getState().bus.execute(
        new GenerateShelfPinBoresCommand({ params, opfs }),
      );
    });

    // Find a side panel that received shelf-pin bores.
    const sidePanelPath: string = await page.evaluate(async () => {
      const w = window as unknown as {
        __zilventorGetOpfs(): Promise<{ read(p: string): Promise<Uint8Array> }>;
        __zilventorUnpackProject: (bytes: Uint8Array) => Promise<{ manifest: unknown }>;
      };
      const opfs = await w.__zilventorGetOpfs();
      const root = await navigator.storage.getDirectory();
      // @ts-expect-error async iterator
      for await (const [name] of root.entries()) {
        if (!name.endsWith('.zipt')) continue;
        try {
          const project = await w.__zilventorUnpackProject(await opfs.read(name));
          const doc = (project.manifest as { document: { bores?: Array<{ role: string }> } }).document;
          if ((doc.bores ?? []).some((b) => b.role === 'shelfPin-system32')) return name;
        } catch { /* skip */ }
      }
      return '';
    });
    expect(sidePanelPath, 'a side panel must carry shelf-pin bores').not.toBe('');
    console.log('[shelfpin] sidePanelPath =', sidePanelPath);

    const before = await probeFrontColumn(page, sidePanelPath);
    console.log('[shelfpin] before:', JSON.stringify(before));
    expect(before.count, 'front column has holes').toBeGreaterThan(0);
    expect(before.minU, 'centered ladder first hole ~72 for H=720').toBeCloseTo(72, 3);
    expect(before.startOffset ?? 0, 'persisted startOffset starts at 0').toBe(0);

    // ── C. UpdateShelfPinStartOffsetCommand startOffset=48 ────────────────────
    await page.evaluate(async (p: string) => {
      const w = window as unknown as {
        __zilventorStore: { getState(): { bus: { execute(c: unknown): Promise<void> } } };
        __zilventorGetOpfs(): Promise<{ read(path: string): Promise<Uint8Array>; write(path: string, b: Uint8Array): Promise<void> }>;
        __zilventorUnpackProject: (bytes: Uint8Array) => Promise<{ manifest: unknown }>;
      };
      const { UpdateShelfPinStartOffsetCommand } = await import('/src/commands/UpdateShelfPinStartOffsetCommand.ts');
      const opfs = await w.__zilventorGetOpfs();
      // Read the persisted params (mirror the panel: keep custom params, override offset).
      const project = await w.__zilventorUnpackProject(await opfs.read(p));
      const base = (project.manifest as { document: { shelfPinParams: object } }).document.shelfPinParams;
      await w.__zilventorStore.getState().bus.execute(
        new UpdateShelfPinStartOffsetCommand({ params: { ...base, startOffset: 48 }, opfs }),
      );
    }, sidePanelPath);

    const after = await probeFrontColumn(page, sidePanelPath);
    console.log('[shelfpin] after:', JSON.stringify(after));
    expect(after.minU, 'first hole re-anchored to bottomMargin+48 = 112').toBeCloseTo(112, 3);
    expect(after.startOffset, 'persisted startOffset updated').toBe(48);

    // ── D. Undo restores both ─────────────────────────────────────────────────
    await page.evaluate(async () => {
      const w = window as unknown as { __zilventorStore: { getState(): { bus: { undo(): Promise<void> } } } };
      await w.__zilventorStore.getState().bus.undo();
    });
    const restored = await probeFrontColumn(page, sidePanelPath);
    console.log('[shelfpin] restored:', JSON.stringify(restored));
    expect(restored.minU, 'undo restores the centered first hole').toBeCloseTo(72, 3);
    expect(restored.startOffset ?? 0, 'undo restores startOffset to 0').toBe(0);

    // ── E. No browser errors ──────────────────────────────────────────────────
    expect(consoleErrors, `browser errors: ${consoleErrors.join('\n')}`).toEqual([]);
  },
);

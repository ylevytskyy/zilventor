import { test, expect } from '@playwright/test';
import { waitForKernelReady } from '../helpers/buildBox';

test('place a component in an assembly', async ({ page }) => {
  page.on('console', (m) => console.log('BROWSER:', m.type(), m.text()));
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

  await page.goto('/');
  await waitForKernelReady(page);

  // Build a 50×50×50 cube part as a complete v7 .zipt manifest +
  // packProject it, then write to OPFS at parts/cube.zipt.
  await page.evaluate(async () => {
    const w = window as unknown as {
      __zilventorPackProject: (input: {
        manifest: unknown; blobs: Record<string, Uint8Array>; thumbnail?: Uint8Array;
      }) => Promise<Uint8Array>;
      __zilventorGetOpfs: () => Promise<{ write(path: string, data: Uint8Array): Promise<void> }>;
    };
    const partDoc = {
      id: 'P_cube',
      name: 'cube',
      units: 'mm',
      parameters: {
        d0: { name: 'd0', expression: '50', value: 50, unit: 'mm' },
      },
      featureTree: [
        { kind: 'sketch', id: 'S0', plane: 'XY',
          primitives: [{ id: 'R1', kind: 'rect', x: 0, y: 0, w: 50, h: 50 }],
          constraints: [] },
        { kind: 'extrude', id: 'E1', sketchRef: 'S0', distanceParam: 'd0', direction: 'forward', operation: 'new' },
      ],
    };
    const manifest = {
      formatVersion: 7,
      kind: 'part',
      createdAt: new Date().toISOString(),
      appVersion: '0.0.0',
      document: partDoc,
    };
    // 1×1 PNG so loadAssemblyTiles picks up a thumbnail
    const png = new Uint8Array([
      0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
      0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
      0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
      0x08, 0x06, 0x00, 0x00, 0x00, 0x1F, 0x15, 0xC4,
      0x89, 0x00, 0x00, 0x00, 0x0A, 0x49, 0x44, 0x41,
      0x54, 0x78, 0x9C, 0x63, 0x00, 0x01, 0x00, 0x00,
      0x05, 0x00, 0x01, 0x0D, 0x0A, 0x2D, 0xB4, 0x00,
      0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE,
      0x42, 0x60, 0x82,
    ]);
    const archive = await w.__zilventorPackProject({ manifest, blobs: {}, thumbnail: png });
    const opfs = await w.__zilventorGetOpfs();
    await opfs.write('parts/cube.zipt', archive);
  });

  // File → New Assembly
  await page.getByRole('tab', { name: 'File' }).click();
  await page.getByRole('button', { name: /new assembly/i }).click();

  // Wait for the activeDocument to be assembly-kinded
  await page.waitForFunction(() => {
    const w = window as any;
    return w.__zilventorStore?.getState().activeDocument?.kind === 'assembly';
  });

  // Press P to open the Place Component dialog
  await page.keyboard.press('p');
  await expect(page.getByRole('dialog', { name: /place component/i })).toBeVisible();

  // Click the "cube" tile
  await page.getByText(/^cube$/).click();

  // Click Place
  await page.getByRole('button', { name: /^place$/i }).click();

  // Assert one component in active assembly
  const count = await page.evaluate(() => {
    const w = window as any;
    return w.__zilventorStore.getState().activeAssembly?.components?.length ?? 0;
  });
  expect(count).toBe(1);

  // Geometry hash should reflect a non-empty assembly state (not the default "0")
  await expect.poll(async () => {
    return await page.locator('[data-testid=viewport]').getAttribute('data-geometry-hash');
  }, { timeout: 10_000 }).not.toBe('0');
});

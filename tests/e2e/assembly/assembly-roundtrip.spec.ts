import { test, expect } from '@playwright/test';
import { waitForKernelReady } from '../helpers/buildBox';
import { seedAssemblyCubePart } from '../helpers/seedAssemblyPart';

test('save + reload an assembly preserves all components', async ({ page }) => {
  page.on('console', (m) => console.log('BROWSER:', m.type(), m.text()));
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

  await page.goto('/');
  await waitForKernelReady(page);
  await seedAssemblyCubePart(page);

  await page.getByRole('tab', { name: 'File' }).click();
  await page.getByRole('button', { name: /new assembly/i }).click();
  await page.waitForFunction(() => {
    const w = window as any;
    return w.__zilventorStore?.getState().activeDocument?.kind === 'assembly';
  });

  // Place 2 components at different positions via direct store mutation —
  // exercises the same addComponent / autosave path the UI uses but skips the
  // dialog for speed.
  await page.evaluate(() => {
    const w = window as any;
    w.__zilventorStore.getState().addComponent({
      id: 'C0', partPath: 'parts/cube.zipt',
      position: { x: 0, y: 0, z: 0 },
      rotation: { rx: 0, ry: 0, rz: 0 },
      visible: true,
    });
    w.__zilventorStore.getState().addComponent({
      id: 'C1', partPath: 'parts/cube.zipt',
      position: { x: 50, y: 0, z: 0 },
      rotation: { rx: 0, ry: 0, rz: 0 },
      visible: true,
    });
  });

  // Wait for autosave (500 ms debounce + write latency).
  const autosavedName = await page.evaluate(() => {
    const w = window as any;
    return w.__zilventorStore.getState().activeAssembly.name + '.ziasm';
  });
  await expect.poll(async () => {
    return await page.evaluate(async (name) => {
      const w = window as any;
      try {
        const opfs = await w.__zilventorGetOpfs();
        const bytes = await opfs.read(name);
        return bytes.length;
      } catch {
        return 0;
      }
    }, autosavedName);
  }, { timeout: 5_000 }).toBeGreaterThan(0);

  // Re-load: clear activeDocument, then read the .ziasm and dispatch.
  // Geometry-cache also gets reset by the activeDocument transition.
  await page.evaluate(async (name) => {
    const w = window as any;
    w.__zilventorStore.getState().setActiveDocument(null);
    const opfs = await w.__zilventorGetOpfs();
    const bytes = await opfs.read(name);
    const doc = await w.__zilventorUnpackAssembly(bytes);
    w.__zilventorStore.getState().setActiveDocument({ kind: 'assembly', document: doc });
  }, autosavedName);

  await page.waitForFunction(() => {
    const w = window as any;
    return (w.__zilventorStore.getState().activeAssembly?.components?.length ?? 0) === 2;
  });

  const positions = await page.evaluate(() => {
    const w = window as any;
    return w.__zilventorStore.getState().activeAssembly.components.map((c: any) => c.position);
  });
  expect(positions).toEqual([
    { x: 0, y: 0, z: 0 },
    { x: 50, y: 0, z: 0 },
  ]);
});

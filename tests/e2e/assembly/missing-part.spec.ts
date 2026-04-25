import { test, expect } from '@playwright/test';
import { waitForKernelReady } from '../helpers/buildBox';

test('an assembly referencing a missing partPath records a diagnostic + still loads', async ({ page }) => {
  page.on('console', (m) => console.log('BROWSER:', m.type(), m.text()));
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

  await page.goto('/');
  await waitForKernelReady(page);

  // Construct an AssemblyDocument with one component pointing at a path
  // that does not exist in OPFS. Push it into the store directly.
  await page.evaluate(() => {
    const w = window as any;
    const asm = {
      id: 'A1', name: 'broken', units: 'mm', parameters: {},
      components: [
        { id: 'C1', partPath: 'nonexistent.zipt',
          position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
      ],
    };
    w.__zilventorStore.getState().setActiveDocument({ kind: 'assembly', document: asm });
  });

  // Wait for the assembly-mesh sync effect to record the diagnostic.
  await expect.poll(async () => {
    return await page.evaluate(() => {
      const w = window as any;
      return w.__zilventorStore.getState().componentDiagnostics?.length ?? 0;
    });
  }, { timeout: 15_000 }).toBeGreaterThan(0);

  const diags = await page.evaluate(() => {
    const w = window as any;
    return w.__zilventorStore.getState().componentDiagnostics;
  });
  expect(diags[0].componentId).toBe('C1');
  expect(diags[0].message).toMatch(/nonexistent/);

  // Assembly is still loaded — placeholder geometry is rendered for the
  // missing component. components.length is preserved.
  const count = await page.evaluate(() => {
    const w = window as any;
    return w.__zilventorStore.getState().activeAssembly?.components?.length ?? 0;
  });
  expect(count).toBe(1);
});

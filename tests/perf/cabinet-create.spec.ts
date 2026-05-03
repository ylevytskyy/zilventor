import { test, expect } from '@playwright/test';
import { waitForKernelReady } from '../e2e/helpers/buildBox';

/**
 * T22 (5b Phase 11): Perf — CreateCabinetCommand.apply() end-to-end p95 < 600 ms.
 *
 * 20 timed apply() calls, each creating a uniquely-named cabinet so that
 * the collision-free name resolver never loops and OPFS file names don't
 * overlap across iterations. The active assembly is set once outside the
 * loop. Each apply() writes 8 files (7 panel .zipt + 1 .ziasm) and places
 * one component into the active assembly, mirroring the real-world path.
 */
test('Perf T22: CreateCabinetCommand.apply() p95 < 600 ms over 20 runs', async ({ page }) => {
  page.on('console', (m) => console.log('BROWSER:', m.type(), m.text()));
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

  await page.goto('/');
  await waitForKernelReady(page);

  // 1. New assembly.
  await page.getByRole('tab', { name: 'File' }).click();
  await page.getByRole('button', { name: /new assembly/i }).click();
  await page.waitForFunction(() => {
    const w = window as unknown as {
      __zilventorStore: { getState(): { activeDocument?: { kind: string } } };
    };
    return w.__zilventorStore?.getState().activeDocument?.kind === 'assembly';
  });

  // 2. Register the two materials used by the base cabinet builder.
  await page.evaluate(() => {
    const w = window as unknown as {
      __zilventorStore: { getState(): { addMaterial(m: unknown): void } };
    };
    w.__zilventorStore.getState().addMaterial({
      id: 'm-birch-18', name: 'Birch 18mm', defaultThickness: 18, color: '#d8c896',
    });
    w.__zilventorStore.getState().addMaterial({
      id: 'm-hb-6', name: 'Hardboard 6mm', defaultThickness: 6, color: '#8b6f47',
    });
  });

  // 3. Run 20 timed apply() calls. Each cabinet uses a unique name so the
  //    collision resolver returns immediately (no suffix loop overhead).
  const times: number[] = await page.evaluate(async () => {
    const w = window as unknown as {
      __zilventorStore: {
        getState(): {
          bus: { execute(cmd: unknown): Promise<void> };
        };
      };
      __zilventorGetOpfs(): Promise<{
        exists(p: string): Promise<boolean>;
        read(p: string): Promise<Uint8Array>;
        write(p: string, b: Uint8Array): Promise<void>;
        list?(): Promise<string[]>;
      }>;
    };

    // Dynamically import the command class from within the page context.
    // The dev server exposes the module graph, so this resolves correctly.
    const { CreateCabinetCommand } = await import(
      /* @vite-ignore */ '/src/commands/CreateCabinetCommand.ts'
    );

    const opfs = await w.__zilventorGetOpfs();
    const bus = w.__zilventorStore.getState().bus;

    const RUNS = 20;
    const results: number[] = [];

    for (let n = 0; n < RUNS; n++) {
      const params = {
        name: `Perf Cabinet ${n}`,
        width: 600,
        depth: 560,
        height: 720,
        toekickHeight: 100,
        toekickSetback: 50,
        shelfCount: 1,
        carcassMaterialId: 'm-birch-18',
        backMaterialId: 'm-hb-6',
        bandMaterialId: null,
      };
      const cmd = new CreateCabinetCommand({ template: 'baseCabinet', params, opfs });
      const t0 = performance.now();
      await bus.execute(cmd);
      results.push(performance.now() - t0);
    }

    return results;
  });

  const sorted = [...times].sort((a, b) => a - b);
  const p95 = sorted[Math.floor((sorted.length - 1) * 0.95)] ?? 0;

  console.log(JSON.stringify({
    metric: 'cabinet-create-p95-ms',
    runs: times.length,
    p95Ms: Math.round(p95),
    maxMs: Math.round(Math.max(...times)),
    minMs: Math.round(Math.min(...times)),
  }));

  expect(p95).toBeLessThan(600);
});

/**
 * E2E (Task 8 capstone): Open a multi-body STEP in part-mode → drive the real
 * "Explode into Assembly" button on the Model tab → assert 2 components at
 * identity pose → undo → assert part restored.
 *
 * This test drives the REAL UI (showOpenFilePicker override + button click)
 * rather than calling the command directly.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { waitForKernelReady } from './helpers/buildBox';

const TWO_BODIES = resolve(
  __dirname,
  '../../packages/kernel/src/occt/__tests__/fixtures/step/two-bodies.step',
);

test(
  'Explode into Assembly: open STEP → explode → 2 components → undo restores part',
  async ({ page }) => {
    // ── 0. Error collection ──────────────────────────────────────────────────
    const pageErrors: string[] = [];
    page.on('pageerror', (e) => {
      pageErrors.push(e.message);
      console.log('PAGEERROR:', e.message);
    });
    page.on('console', (m) => {
      if (m.type() === 'error') console.log('BROWSER ERROR:', m.text());
    });

    // ── 1. Boot ──────────────────────────────────────────────────────────────
    await page.goto('/');
    await waitForKernelReady(page);

    // Confirm clean starting state (no active document).
    const initialDoc = await page.evaluate(
      () => (window as any).__zilventorStore?.getState().activeDocument ?? null,
    );
    expect(initialDoc).toBeNull();

    // ── 2. Override showOpenFilePicker → two-bodies.step ────────────────────
    const stepBytes = readFileSync(TWO_BODIES);
    await page.evaluate(
      async ([bytes]: [number[]]) => {
        const fakeFile = {
          name: 'two-bodies.step',
          arrayBuffer: async () => new Uint8Array(bytes).buffer,
        };
        const fakeHandle = { getFile: async () => fakeFile };
        (window as any).showOpenFilePicker = async () => [fakeHandle];
      },
      [Array.from(stepBytes)] as [number[]],
    );

    // ── 3. File → Open → wait for part ──────────────────────────────────────
    await page.getByRole('tab', { name: 'File' }).click();
    await page.getByRole('button', { name: /open/i }).click();

    await page.waitForFunction(
      () => (window as any).__zilventorStore?.getState().activeDocument?.kind === 'part',
      undefined,
      { timeout: 60_000 },
    );

    // Verify the part has an imported feature (pre-condition for Explode button).
    const partState = await page.evaluate(() => {
      const s = (window as any).__zilventorStore?.getState();
      const part = s?.activePart;
      return {
        partName: part?.name ?? null,
        hasImported: part?.featureTree?.some((f: any) => f.kind === 'imported') ?? false,
      };
    });
    expect(partState.partName).toBe('two-bodies');
    expect(partState.hasImported).toBe(true);

    // ── 4. Switch to Model tab (Explode button lives here, not Assembly tab) ─
    await page.getByRole('tab', { name: /^model$/i }).click();

    // ── 5. Assert "Explode into Assembly" button is enabled ──────────────────
    const explodeBtn = page.getByRole('button', { name: /explode into assembly/i });
    await expect(explodeBtn).toBeVisible({ timeout: 5_000 });
    await expect(explodeBtn).toBeEnabled({ timeout: 5_000 });

    // ── 6. Click the button (real UI action) ─────────────────────────────────
    await explodeBtn.click();

    // ── 7. Wait for active document to become an assembly with 2 components ──
    await page.waitForFunction(
      () => {
        const doc = (window as any).__zilventorStore?.getState().activeDocument;
        return (
          doc?.kind === 'assembly' &&
          doc.document.components.length === 2
        );
      },
      undefined,
      { timeout: 30_000 },
    );

    // ── 8. Detailed assertions via store ─────────────────────────────────────
    const asmState = await page.evaluate(() => {
      const s = (window as any).__zilventorStore?.getState();
      const doc = s?.activeDocument;
      if (doc?.kind !== 'assembly') return null;
      const components: Array<{
        partPath: string;
        position: { x: number; y: number; z: number };
        rotation: { rx: number; ry: number; rz: number };
      }> = doc.document.components;
      return {
        componentCount: components.length,
        partPaths: components.map((c) => c.partPath).sort(),
        positions: components.map((c) => c.position),
        rotations: components.map((c) => c.rotation),
      };
    });

    expect(asmState).not.toBeNull();
    // two-bodies.step has 2 solids and 0 free shells → exactly 2 components
    expect(asmState!.componentCount).toBe(2);
    // Part paths must be the two solid names
    expect(asmState!.partPaths).toEqual(['two-bodies_1.zipt', 'two-bodies_2.zipt']);
    // All components at identity pose (position = 0,0,0; rotation = 0,0,0)
    for (const pos of asmState!.positions) {
      expect(pos.x).toBe(0);
      expect(pos.y).toBe(0);
      expect(pos.z).toBe(0);
    }
    for (const rot of asmState!.rotations) {
      expect(rot.rx).toBe(0);
      expect(rot.ry).toBe(0);
      expect(rot.rz).toBe(0);
    }

    // ── 9. Undo → part restored ───────────────────────────────────────────────
    await page.evaluate(async () => {
      await (window as any).__zilventorStore.getState().bus?.undo();
    });

    await page.waitForFunction(
      () => (window as any).__zilventorStore?.getState().activeDocument?.kind === 'part',
      undefined,
      { timeout: 15_000 },
    );

    const afterUndo = await page.evaluate(() => {
      const s = (window as any).__zilventorStore?.getState();
      return {
        kind: s?.activeDocument?.kind ?? null,
        partName: s?.activePart?.name ?? null,
      };
    });
    expect(afterUndo.kind).toBe('part');
    expect(afterUndo.partName).toBe('two-bodies');

    // ── 10. No uncaught page errors ───────────────────────────────────────────
    expect(pageErrors).toHaveLength(0);
  },
);

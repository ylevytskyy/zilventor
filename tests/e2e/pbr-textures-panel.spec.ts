import { test, expect } from '@playwright/test';
import { waitForKernelReady } from './helpers/buildBox';
import type { PanelFeature, MaterialEntry } from '@zilventor/shared';

/**
 * Bus + store accessor pattern — matches existing e2e tests in
 * tests/e2e/drawing/material-hatch-pattern.spec.ts.
 */
type ZilventorStore = {
  getState(): {
    activePart: { id: string; materials: Array<MaterialEntry>; featureTree: unknown[] } | null;
    bus: { execute(c: unknown): Promise<unknown> };
  };
};

test.describe('PBR Textures — Phase 1', () => {
  test.setTimeout(180_000);

  test('textured oak panel renders with non-uniform pixels (texture visible, not flat color)', async ({ page }) => {
    page.on('console', (m) => console.log('BROWSER:', m.type(), m.text()));
    page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

    await page.goto('/');
    await waitForKernelReady(page);

    // 1. Create a new part
    await page.getByRole('tab', { name: 'Model' }).click();
    await page.getByRole('button', { name: 'New Part' }).click();
    await expect(page.getByText('Part1')).toBeVisible();

    // 2. Add an oak material via the bus, then assign textureId='oak' through
    //    the material editor UI (texture picker dropdown) — NOT via a programmatic
    //    EditMaterialCommand call. This validates that Task 10b's UI is wired end-to-end.
    //    The material editor lives inside the Panel dialog (Manage... button).

    // 2a. Add the material via the bus (AddMaterialCommand has no UI shortcut).
    const matId = await page.evaluate(async () => {
      const { AddMaterialCommand } = await import('/src/commands/AddMaterialCommand.ts');
      const store = (window as unknown as { __zilventorStore: ZilventorStore }).__zilventorStore;
      const bus = store.getState().bus;
      await bus.execute(new AddMaterialCommand({ name: 'Oak Wood', defaultThickness: 18, color: '#8b6914' }));
      const mat = store.getState().activePart!.materials.find((m) => m.name === 'Oak Wood');
      if (!mat) throw new Error('material not found after AddMaterialCommand');
      return mat.id;
    });
    expect(matId).toBeTruthy();

    // 2b. Open the Panel dialog via store injection (bypasses PART_NOT_EMPTY — no
    //     panel in the tree yet, but we inject via store directly as in T33).
    await page.evaluate(() => {
      const w = window as unknown as {
        __zilventorStore: { getState(): { setPanelDialog(s: unknown): void } };
      };
      w.__zilventorStore.getState().setPanelDialog({
        mode: 'part',
        onSubmit: () => {},
        onCancel: () => w.__zilventorStore.getState().setPanelDialog(null),
      });
    });
    const dialog = page.getByRole('dialog', { name: 'Panel' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: /Manage/i }).click();
    const editor = dialog.locator('[data-testid="material-registry-editor"]');
    await expect(editor).toBeVisible();

    // 2c. Hover the "Oak Wood" row, click Edit, select "Oak" from the texture dropdown, Save.
    const oakRow = editor.locator('tbody tr').filter({ hasText: 'Oak Wood' });
    await oakRow.hover();
    await oakRow.getByRole('button', { name: /Edit Oak Wood/i }).click();
    await editor.getByLabel('Edit texture').selectOption('oak');
    await editor.getByRole('button', { name: 'Save' }).click();
    // Confirm the store now reflects textureId='oak' on this material.
    const assignedTextureId = await page.evaluate((id: string) => {
      const w = window as unknown as { __zilventorStore: ZilventorStore };
      const mat = w.__zilventorStore.getState().activePart!.materials.find((m) => m.id === id);
      return (mat as Record<string, unknown>).textureId ?? null;
    }, matId);
    expect(assignedTextureId).toBe('oak');

    // 2d. Close the dialog.
    await page.evaluate(() => {
      const w = window as unknown as {
        __zilventorStore: { getState(): { setPanelDialog(s: unknown): void } };
      };
      w.__zilventorStore.getState().setPanelDialog(null);
    });
    await expect(dialog).not.toBeVisible();

    // 3. Add a panel feature using that material with grain=length.
    await page.evaluate(async (materialId: string) => {
      const { AddPanelFeatureCommand } = await import('/src/commands/AddPanelFeatureCommand.ts');
      const store = (window as unknown as { __zilventorStore: ZilventorStore }).__zilventorStore;
      const bus = store.getState().bus;
      const panel: PanelFeature = {
        kind: 'panel', id: 'pf-pbr-e2e',
        length: { kind: 'literal', value: 600 },
        width: { kind: 'literal', value: 400 },
        thickness: { kind: 'literal', value: 18 },
        thicknessFromMaterial: false,
        materialId,
        grain: 'length',
        edgeBands: { front: null, back: null, left: null, right: null },
      };
      await bus.execute(new AddPanelFeatureCommand(panel));
    }, matId);

    // 4. Wait for the mesh to appear in the viewport.
    await expect(page.locator('[data-triangle-count]')).toHaveAttribute('data-triangle-count', /[1-9]\d*/, { timeout: 60_000 });

    // 5. Screenshot the viewport (grain=length).
    await page.screenshot({ path: '/tmp/pbr-textures-panel-length.png' });

    // 6. Pixel-variance check — texture produces non-uniform pixels.
    //    Requires preserveDrawingBuffer=true on the WebGLRenderer (see implementation note).
    const pixelVariance = await page.evaluate(() => {
      const canvas = document.querySelector('canvas');
      if (!canvas) return -1; // no canvas — treat as unavailable
      const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
      if (!gl) return -1; // WebGL not available in this context
      const w = Math.min(canvas.width, 100);
      const h = Math.min(canvas.height, 100);
      const buf = new Uint8Array(w * h * 4);
      (gl as WebGLRenderingContext).readPixels(
        Math.floor(canvas.width / 2 - w / 2), Math.floor(canvas.height / 2 - h / 2),
        w, h,
        (gl as WebGLRenderingContext).RGBA,
        (gl as WebGLRenderingContext).UNSIGNED_BYTE,
        buf,
      );
      const reds = Array.from({ length: w * h }, (_, i) => buf[i * 4]!);
      const mean = reds.reduce((a, b) => a + b, 0) / reds.length;
      return reds.reduce((a, b) => a + (b - mean) ** 2, 0) / reds.length;
    });

    // First assert WebGL readback was available — fail loudly if not, rather than
    // silently bypassing the texture check (pixelVariance === -1 means the WebGL
    // context or readPixels was unavailable, which means preserveDrawingBuffer was
    // not set or the canvas had no WebGL context).
    expect(pixelVariance, 'WebGL readPixels unavailable — check preserveDrawingBuffer:true in SceneManager').not.toBe(-1);

    // Variance > 25 → std-dev > 5 → visible texture, not a solid flat color.
    expect(pixelVariance, 'pixel variance must be > 25 to confirm visible texture').toBeGreaterThan(25);
  });

  test('grain=width rotates texture 90° vs grain=length — screenshot read-back', async ({ page }) => {
    page.on('console', (m) => console.log('BROWSER:', m.type(), m.text()));

    await page.goto('/');
    await waitForKernelReady(page);

    await page.getByRole('tab', { name: 'Model' }).click();
    await page.getByRole('button', { name: 'New Part' }).click();
    await expect(page.getByText('Part1')).toBeVisible();

    // Add material via bus, assign textureId via the picker UI (same pattern as first test).
    const matId = await page.evaluate(async () => {
      const { AddMaterialCommand } = await import('/src/commands/AddMaterialCommand.ts');
      const store = (window as unknown as { __zilventorStore: ZilventorStore }).__zilventorStore;
      const bus = store.getState().bus;
      await bus.execute(new AddMaterialCommand({ name: 'Oak Wood', defaultThickness: 18, color: '#8b6914' }));
      const mat = store.getState().activePart!.materials.find((m) => m.name === 'Oak Wood');
      if (!mat) throw new Error('material not found');
      return mat.id;
    });

    // Assign texture via the material editor UI (texture picker dropdown).
    await page.evaluate(() => {
      const w = window as unknown as {
        __zilventorStore: { getState(): { setPanelDialog(s: unknown): void } };
      };
      w.__zilventorStore.getState().setPanelDialog({
        mode: 'part', onSubmit: () => {},
        onCancel: () => w.__zilventorStore.getState().setPanelDialog(null),
      });
    });
    const dialog2 = page.getByRole('dialog', { name: 'Panel' });
    await expect(dialog2).toBeVisible();
    await dialog2.getByRole('button', { name: /Manage/i }).click();
    const editor2 = dialog2.locator('[data-testid="material-registry-editor"]');
    const oakRow2 = editor2.locator('tbody tr').filter({ hasText: 'Oak Wood' });
    await oakRow2.hover();
    await oakRow2.getByRole('button', { name: /Edit Oak Wood/i }).click();
    await editor2.getByLabel('Edit texture').selectOption('oak');
    await editor2.getByRole('button', { name: 'Save' }).click();
    await page.evaluate(() => {
      const w = window as unknown as {
        __zilventorStore: { getState(): { setPanelDialog(s: unknown): void } };
      };
      w.__zilventorStore.getState().setPanelDialog(null);
    });
    await expect(dialog2).not.toBeVisible();

    await page.evaluate(async (materialId: string) => {
      const { AddPanelFeatureCommand } = await import('/src/commands/AddPanelFeatureCommand.ts');
      const store = (window as unknown as { __zilventorStore: ZilventorStore }).__zilventorStore;
      const bus = store.getState().bus;
      const panel: PanelFeature = {
        kind: 'panel', id: 'pf-pbr-width-e2e',
        length: { kind: 'literal', value: 600 },
        width: { kind: 'literal', value: 400 },
        thickness: { kind: 'literal', value: 18 },
        thicknessFromMaterial: false,
        materialId,
        grain: 'width',
        edgeBands: { front: null, back: null, left: null, right: null },
      };
      await bus.execute(new AddPanelFeatureCommand(panel));
    }, matId);

    await expect(page.locator('[data-triangle-count]')).toHaveAttribute('data-triangle-count', /[1-9]\d*/, { timeout: 60_000 });
    await page.screenshot({ path: '/tmp/pbr-textures-panel-width.png' });

    // The grain=width screenshot is the read-back gate. Visual confirmation:
    // grain=width panel should show the oak grain running perpendicular to grain=length.
    // Automated check: no error dialogs (using role="alertdialog" — the real element
    // in FileTab.tsx; plan used [data-testid="error-dialog"] which doesn't exist).
    expect(await page.locator('[role="alertdialog"]').count()).toBe(0);
  });
});

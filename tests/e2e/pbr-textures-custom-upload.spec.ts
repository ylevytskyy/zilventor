import { test, expect } from '@playwright/test';
import { waitForKernelReady } from './helpers/buildBox';
import path from 'node:path';

type ZilventorStore = {
  getState(): {
    activePart: { id: string; materials: Array<{ id: string; name: string; textureId?: string }>; featureTree: unknown[] } | null;
    bus: { execute(c: unknown): Promise<unknown> };
    setPanelDialog(s: unknown): void;
  };
};

test('upload a custom texture, assign to a panel, render textured, reload still textured', async ({ page }) => {
  test.setTimeout(180_000);
  page.on('console', (m) => console.log('BROWSER:', m.type(), m.text()));
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

  await page.goto('/');
  await waitForKernelReady(page);

  // 1. Create a new part.
  await page.getByRole('tab', { name: 'Model' }).click();
  await page.getByRole('button', { name: 'New Part' }).click();
  await expect(page.getByText('Part1')).toBeVisible();

  // 2. Add a material via the bus (no direct UI shortcut — same pattern as Phase 1).
  const matId = await page.evaluate(async () => {
    const { AddMaterialCommand } = await import('/src/commands/AddMaterialCommand.ts');
    const store = (window as unknown as { __zilventorStore: ZilventorStore }).__zilventorStore;
    const bus = store.getState().bus;
    await bus.execute(new AddMaterialCommand({ name: 'Custom Mat', defaultThickness: 18, color: '#888888' }));
    const mat = store.getState().activePart!.materials.find((m) => m.name === 'Custom Mat');
    if (!mat) throw new Error('material not found after AddMaterialCommand');
    return mat.id;
  });
  expect(matId).toBeTruthy();

  // 3. Open the Panel dialog (injection pattern from Phase 1).
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

  // 4. Open the upload dialog, fill fields, upload albedo + normal JPEG fixtures.
  //    Providing the normal map ensures the lighting-variation boost that lifts
  //    pixel variance above the > 25 threshold (Phase 1 calibration assumed
  //    normal maps present; albedo-only gives ~11 variance).
  await editor.getByRole('button', { name: /Upload custom texture/i }).click();
  await page.getByLabel('Texture name').fill('My Wood');
  await page.getByLabel(/Albedo/).setInputFiles(
    path.resolve(__dirname, 'fixtures/custom-texture-upload.jpg'),
  );
  await page.getByLabel(/Normal/).setInputFiles(
    path.resolve(__dirname, 'fixtures/custom-texture-normal.jpg'),
  );
  await page.getByRole('button', { name: 'Add texture' }).click();

  // 5. Assign the newly uploaded custom texture to the 'Custom Mat' material via
  //    the Edit texture picker, then Save.
  const row = editor.locator('tbody tr').filter({ hasText: 'Custom Mat' });
  await row.hover();
  await row.getByRole('button', { name: /Edit Custom Mat/i }).click();
  await editor.getByLabel('Edit texture').selectOption({ label: 'My Wood' });
  await editor.getByRole('button', { name: 'Save' }).click();

  // Confirm the store reflects the custom textureId on this material.
  const assignedTextureId = await page.evaluate((id: string) => {
    const w = window as unknown as { __zilventorStore: ZilventorStore };
    const mat = w.__zilventorStore.getState().activePart!.materials.find((m) => m.id === id);
    return (mat as Record<string, unknown>).textureId ?? null;
  }, matId);
  expect(assignedTextureId).toMatch(/^custom-/);

  // 6. Close the dialog.
  await page.evaluate(() => {
    const w = window as unknown as {
      __zilventorStore: { getState(): { setPanelDialog(s: unknown): void } };
    };
    w.__zilventorStore.getState().setPanelDialog(null);
  });
  await expect(dialog).not.toBeVisible();

  // 7. Add a panel feature using the custom-textured material.
  await page.evaluate(async (materialId: string) => {
    const { AddPanelFeatureCommand } = await import('/src/commands/AddPanelFeatureCommand.ts');
    const store = (window as unknown as { __zilventorStore: ZilventorStore }).__zilventorStore;
    const bus = store.getState().bus;
    await bus.execute(
      new AddPanelFeatureCommand({
        kind: 'panel',
        id: 'pf-custom-e2e',
        length: { kind: 'literal', value: 600 },
        width: { kind: 'literal', value: 400 },
        thickness: { kind: 'literal', value: 18 },
        thicknessFromMaterial: false,
        materialId,
        grain: 'length',
        edgeBands: { front: null, back: null, left: null, right: null },
      }),
    );
  }, matId);

  // 8. Wait for the mesh to appear in the viewport.
  await expect(page.locator('[data-triangle-count]')).toHaveAttribute(
    'data-triangle-count',
    /[1-9]\d*/,
    { timeout: 60_000 },
  );

  // Allow THREE.js texture GPU upload to complete (blob URL loads are async).
  // The triangle-count attribute appears when geometry lands; the texture upload
  // completes on a subsequent rAF cycle. Wait for networkidle to ensure
  // all blob-URL fetches have resolved before we readPixels.
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(500);

  // 9. Screenshot pre-reload.
  await page.screenshot({ path: '/tmp/pbr-custom-textured.png' });

  // 10. Pixel-variance gate — verbatim block from pbr-textures-panel.spec.ts.
  const variance = await page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    if (!canvas) return -1;
    const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
    if (!gl) return -1;
    const w = Math.min(canvas.width, 100);
    const h = Math.min(canvas.height, 100);
    const buf = new Uint8Array(w * h * 4);
    (gl as WebGLRenderingContext).readPixels(
      Math.floor(canvas.width / 2 - w / 2),
      Math.floor(canvas.height / 2 - h / 2),
      w,
      h,
      (gl as WebGLRenderingContext).RGBA,
      (gl as WebGLRenderingContext).UNSIGNED_BYTE,
      buf,
    );
    const reds = Array.from({ length: w * h }, (_, i) => buf[i * 4]!);
    const mean = reds.reduce((a, b) => a + b, 0) / reds.length;
    return reds.reduce((a, b) => a + (b - mean) ** 2, 0) / reds.length;
  });

  expect(variance, 'WebGL readPixels unavailable — check preserveDrawingBuffer:true in SceneManager').not.toBe(-1);
  expect(variance, 'custom texture must produce visible non-uniform pixels before reload').toBeGreaterThan(25);

  // 11. Reload the page (autosaved to OPFS) → restoreLastOpenDocument → still textured.
  await page.reload();
  await waitForKernelReady(page);
  await expect(page.locator('[data-triangle-count]')).toHaveAttribute(
    'data-triangle-count',
    /[1-9]\d*/,
    { timeout: 60_000 },
  );

  // Allow THREE.js texture GPU upload to complete after reload.
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(500);

  // 12. Screenshot post-reload.
  await page.screenshot({ path: '/tmp/pbr-custom-textured-after-reload.png' });

  // 13. Post-reload pixel-variance gate (verbatim readPixels block).
  const varianceAfter = await page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    if (!canvas) return -1;
    const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
    if (!gl) return -1;
    const w = Math.min(canvas.width, 100);
    const h = Math.min(canvas.height, 100);
    const buf = new Uint8Array(w * h * 4);
    (gl as WebGLRenderingContext).readPixels(
      Math.floor(canvas.width / 2 - w / 2),
      Math.floor(canvas.height / 2 - h / 2),
      w,
      h,
      (gl as WebGLRenderingContext).RGBA,
      (gl as WebGLRenderingContext).UNSIGNED_BYTE,
      buf,
    );
    const reds = Array.from({ length: w * h }, (_, i) => buf[i * 4]!);
    const mean = reds.reduce((a, b) => a + b, 0) / reds.length;
    return reds.reduce((a, b) => a + (b - mean) ** 2, 0) / reds.length;
  });

  expect(varianceAfter, 'reloaded panel must still be textured (custom texture survived OPFS round-trip)').toBeGreaterThan(25);
});

import { test, expect } from '@playwright/test';
import { waitForKernelReady } from './helpers/buildBox';
import { waitForAutosave } from './helpers/waitForAutosave';
import path from 'node:path';

type ZilventorStore = {
  getState(): {
    activePart: { id: string; materials: Array<{ id: string; name: string; textureId?: string }>; featureTree: unknown[] } | null;
    bus: { execute(c: unknown): Promise<unknown> };
    setPanelDialog(s: unknown): void;
  };
};

/** Decode a PNG Uint8Array via ImageBitmap+canvas; sample a w×h center region.
 *  Returns pixel variance over the red channel (>25 = texture grain present). */
async function measureVarianceInPage(
  bytes: Uint8Array,
): Promise<number> {
  const blob = new Blob([bytes], { type: 'image/png' });
  const bmp = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = bmp.width;
  canvas.height = bmp.height;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bmp, 0, 0);
  const w = Math.min(bmp.width, 100);
  const h = Math.min(bmp.height, 100);
  const imgData = ctx.getImageData(
    Math.floor(bmp.width / 2 - w / 2),
    Math.floor(bmp.height / 2 - h / 2),
    w, h,
  );
  const reds = Array.from({ length: w * h }, (_, i) => imgData.data[i * 4]!);
  const mean = reds.reduce((a, b) => a + b, 0) / reds.length;
  return reds.reduce((a, b) => a + (b - mean) ** 2, 0) / reds.length;
}

/** Create a new part, add a custom texture + panel, wait for mesh to appear. */
async function setupTexturedPart(
  page: import('@playwright/test').Page,
  matName: string,
  texName: string,
  featureId: string,
): Promise<string> {
  await page.getByRole('tab', { name: 'Model' }).click();
  await page.getByRole('button', { name: 'New Part' }).click();
  await expect(page.getByText('Part1')).toBeVisible();

  // Add material via bus.
  const matId = await page.evaluate(async (name: string) => {
    const { AddMaterialCommand } = await import('/src/commands/AddMaterialCommand.ts');
    const store = (window as unknown as { __zilventorStore: ZilventorStore }).__zilventorStore;
    await store.getState().bus.execute(
      new AddMaterialCommand({ name, defaultThickness: 18, color: '#888888' }),
    );
    const mat = store.getState().activePart!.materials.find((m) => m.name === name);
    if (!mat) throw new Error(`material ${name} not found`);
    return mat.id;
  }, matName);
  expect(matId).toBeTruthy();

  // Open panel dialog → material registry editor.
  await page.evaluate(() => {
    const w = window as unknown as { __zilventorStore: { getState(): { setPanelDialog(s: unknown): void } } };
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

  // Upload custom texture (albedo + normal).
  await editor.getByRole('button', { name: /Upload custom texture/i }).click();
  await page.getByLabel('Texture name').fill(texName);
  await page.getByLabel(/Albedo/).setInputFiles(
    path.resolve(__dirname, 'fixtures/custom-texture-upload.jpg'),
  );
  await page.getByLabel(/Normal/).setInputFiles(
    path.resolve(__dirname, 'fixtures/custom-texture-normal.jpg'),
  );
  await page.getByRole('button', { name: 'Add texture' }).click();

  // Assign texture to the material row.
  const row = editor.locator('tbody tr').filter({ hasText: matName });
  await row.hover();
  await row.getByRole('button', { name: new RegExp(`Edit ${matName}`, 'i') }).click();
  await editor.getByLabel('Edit texture').selectOption({ label: texName });
  await editor.getByRole('button', { name: 'Save' }).click();

  // Close dialog.
  await page.evaluate(() => {
    const w = window as unknown as { __zilventorStore: { getState(): { setPanelDialog(s: unknown): void } } };
    w.__zilventorStore.getState().setPanelDialog(null);
  });
  await expect(dialog).not.toBeVisible();

  // Add a panel feature with this material.
  await page.evaluate(async (args: { materialId: string; featureId: string }) => {
    const { AddPanelFeatureCommand } = await import('/src/commands/AddPanelFeatureCommand.ts');
    const store = (window as unknown as { __zilventorStore: ZilventorStore }).__zilventorStore;
    await store.getState().bus.execute(
      new AddPanelFeatureCommand({
        kind: 'panel',
        id: args.featureId,
        length: { kind: 'literal', value: 600 },
        width: { kind: 'literal', value: 400 },
        thickness: { kind: 'literal', value: 18 },
        thicknessFromMaterial: false,
        materialId: args.materialId,
        grain: 'length',
        edgeBands: { front: null, back: null, left: null, right: null },
      }),
    );
  }, { materialId: matId, featureId });

  // Wait for mesh + texture GPU upload.
  await expect(page.locator('[data-triangle-count]')).toHaveAttribute(
    'data-triangle-count',
    /[1-9]\d*/,
    { timeout: 60_000 },
  );
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(500);

  return matId;
}

test.describe('PBR Textures Phase 3 — Export Image + autosave thumbnail', () => {
  test.setTimeout(240_000);

  test('Export Image opaque: PNG has grain (pixel-variance > 25)', async ({ page }) => {
    page.on('console', (m) => console.log('BROWSER:', m.type(), m.text()));
    page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

    await page.goto('/');
    await waitForKernelReady(page);

    await setupTexturedPart(page, 'Wood Export', 'Export Wood', 'pf-export-e2e');

    // Screenshot of the textured viewport before export.
    await page.screenshot({ path: '/tmp/pbr-phase3-viewport-before-export.png' });

    // Call captureViewportPng({ transparent: false }) via store viewport ref.
    const opaqueVariance = await page.evaluate(async () => {
      const store = (window as unknown as {
        __zilventorStore: {
          getState(): {
            viewport: {
              captureViewportPng(opts: { transparent: boolean }): Promise<Uint8Array>;
            } | null;
          };
        };
      }).__zilventorStore;
      const vp = store.getState().viewport;
      if (!vp) return -1;

      const bytes = await vp.captureViewportPng({ transparent: false });

      // Decode PNG → canvas → measure pixel variance in center region.
      const blob = new Blob([bytes], { type: 'image/png' });
      const bmp = await createImageBitmap(blob);
      const canvas = document.createElement('canvas');
      canvas.width = bmp.width;
      canvas.height = bmp.height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(bmp, 0, 0);
      const w = Math.min(bmp.width, 100);
      const h = Math.min(bmp.height, 100);
      const imgData = ctx.getImageData(
        Math.floor(bmp.width / 2 - w / 2),
        Math.floor(bmp.height / 2 - h / 2),
        w, h,
      );
      const reds = Array.from({ length: w * h }, (_, i) => imgData.data[i * 4]!);
      const mean = reds.reduce((a, b) => a + b, 0) / reds.length;
      return reds.reduce((a, b) => a + (b - mean) ** 2, 0) / reds.length;
    });

    // If -1, viewport was null — fail with a clear message.
    expect(opaqueVariance, 'viewport must be non-null').not.toBe(-1);
    expect(opaqueVariance, 'opaque PNG must have texture grain (variance > 25)').toBeGreaterThan(25);

    await page.screenshot({ path: '/tmp/pbr-phase3-opaque.png' });
  });

  test('Export Image transparent: PNG background has alpha < 255 + model has grain', async ({ page }) => {
    page.on('console', (m) => console.log('BROWSER:', m.type(), m.text()));
    page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

    await page.goto('/');
    await waitForKernelReady(page);

    await setupTexturedPart(page, 'Wood Transparent', 'Trans Wood', 'pf-trans-e2e');

    const result = await page.evaluate(async () => {
      const store = (window as unknown as {
        __zilventorStore: {
          getState(): {
            viewport: {
              captureViewportPng(opts: { transparent: boolean }): Promise<Uint8Array>;
            } | null;
          };
        };
      }).__zilventorStore;
      const vp = store.getState().viewport;
      if (!vp) return { hasTransparentBg: false, modelVariance: -1, error: 'no viewport' };

      const bytes = await vp.captureViewportPng({ transparent: true });
      const blob = new Blob([bytes], { type: 'image/png' });
      const bmp = await createImageBitmap(blob);
      const canvas = document.createElement('canvas');
      canvas.width = bmp.width;
      canvas.height = bmp.height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(bmp, 0, 0);

      // Sample a top-left corner (10×10) for transparent background.
      const cornerData = ctx.getImageData(0, 0, 10, 10);
      const alphas = Array.from({ length: 10 * 10 }, (_, i) => cornerData.data[i * 4 + 3]!);
      const hasTransparentBg = alphas.some((a) => a < 255);

      // Sample center region for model grain variance.
      const w = Math.min(bmp.width, 100);
      const h = Math.min(bmp.height, 100);
      const centerData = ctx.getImageData(
        Math.floor(bmp.width / 2 - w / 2),
        Math.floor(bmp.height / 2 - h / 2),
        w, h,
      );
      // Only count pixels that are visible (alpha > 0) for grain measurement.
      const visibleReds: number[] = [];
      for (let i = 0; i < w * h; i++) {
        if (centerData.data[i * 4 + 3]! > 0) {
          visibleReds.push(centerData.data[i * 4]!);
        }
      }
      let modelVariance = -1;
      if (visibleReds.length > 10) {
        const mean = visibleReds.reduce((a, b) => a + b, 0) / visibleReds.length;
        modelVariance = visibleReds.reduce((a, b) => a + (b - mean) ** 2, 0) / visibleReds.length;
      }

      return { hasTransparentBg, modelVariance, error: null };
    });

    expect(result.error, 'viewport must be available').toBeNull();
    expect(
      result.hasTransparentBg,
      'transparent PNG must have alpha < 255 in corner (background is transparent)',
    ).toBe(true);
    expect(
      result.modelVariance,
      'transparent PNG visible model pixels must have grain (variance > 25)',
    ).toBeGreaterThan(25);

    await page.screenshot({ path: '/tmp/pbr-phase3-transparent-restored.png' });
  });

  test('autosave thumbnail: OPFS file contains non-blank thumbnail after autosave', async ({ page }) => {
    page.on('console', (m) => console.log('BROWSER:', m.type(), m.text()));
    page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

    await page.goto('/');
    await waitForKernelReady(page);

    // Capture write count BEFORE part setup (setup itself triggers autosave).
    const writeCountBefore = await page.evaluate(() => {
      const fn = (window as unknown as { __zilventorAutosaveStats?: () => { writeCount: number } }).__zilventorAutosaveStats;
      return fn ? fn().writeCount : 0;
    });

    await setupTexturedPart(page, 'Tile Wood', 'Tile Tex', 'pf-tile-e2e');

    // Wait for autosave to run (must increment from writtenBefore).
    // setupTexturedPart already waited for networkidle + 500ms; autosave fires
    // 500ms after activeDoc changes, so we give up to 8000ms more from here.
    await page.waitForFunction(
      (before: number) => {
        const fn = (window as unknown as { __zilventorAutosaveStats?: () => { writeCount: number } }).__zilventorAutosaveStats;
        return (fn ? fn().writeCount : 0) > before;
      },
      writeCountBefore,
      { timeout: 8000 },
    );

    // Verify autosave actually ran.
    const writeCount = await page.evaluate(() => {
      const fn = (window as unknown as { __zilventorAutosaveStats?: () => { writeCount: number } }).__zilventorAutosaveStats;
      return fn ? fn().writeCount : 0;
    });
    expect(writeCount, 'autosave must have run at least once').toBeGreaterThan(0);

    // Read the saved .zipt from OPFS and verify the thumbnail is non-empty.
    const thumbnailVariance = await page.evaluate(async () => {
      const w = window as unknown as {
        __zilventorGetOpfs?: () => Promise<{ read(path: string): Promise<Uint8Array> }>;
        __zilventorUnpackProject?: (archive: Uint8Array) => Promise<{ thumbnail?: Uint8Array }>;
      };
      if (!w.__zilventorGetOpfs || !w.__zilventorUnpackProject) {
        return { error: 'dev hooks missing', variance: -1, thumbLength: -1 };
      }
      const opfs = await w.__zilventorGetOpfs();
      let archive: Uint8Array;
      try {
        archive = await opfs.read('Part1.zipt');
      } catch (e) {
        return { error: `OPFS read failed: ${String(e)}`, variance: -1, thumbLength: -1 };
      }
      const unpacked = await w.__zilventorUnpackProject(archive);
      const thumb = unpacked.thumbnail;
      if (!thumb || thumb.length < 100) {
        return { error: null, variance: 0, thumbLength: thumb?.length ?? 0 };
      }

      // Decode thumbnail PNG → canvas → measure variance.
      const blob = new Blob([thumb], { type: 'image/png' });
      let bmp: ImageBitmap;
      try {
        bmp = await createImageBitmap(blob);
      } catch {
        return { error: 'thumbnail is not a valid PNG', variance: -1, thumbLength: thumb.length };
      }
      const canvas = document.createElement('canvas');
      canvas.width = bmp.width;
      canvas.height = bmp.height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(bmp, 0, 0);
      const w2 = bmp.width;
      const h2 = bmp.height;
      const imgData = ctx.getImageData(0, 0, w2, h2);
      const reds = Array.from({ length: w2 * h2 }, (_, i) => imgData.data[i * 4]!);
      const mean = reds.reduce((a, b) => a + b, 0) / reds.length;
      const variance = reds.reduce((a, b) => a + (b - mean) ** 2, 0) / reds.length;
      return { error: null, variance, thumbLength: thumb.length };
    });

    expect(thumbnailVariance.error, 'thumbnail read must not error').toBeNull();
    expect(
      thumbnailVariance.thumbLength,
      'thumbnail must be non-empty (> 100 bytes)',
    ).toBeGreaterThan(100);
    expect(
      thumbnailVariance.variance,
      'thumbnail must not be blank (variance > 10 — any texture or shading is sufficient)',
    ).toBeGreaterThan(10);

    await page.screenshot({ path: '/tmp/pbr-phase3-place-component-tile.png' });
  });
});

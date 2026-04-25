import type { Page } from '@playwright/test';

/**
 * Seed a cube part to OPFS for assembly E2E tests.
 *
 * Builds a complete v7 .zipt manifest (sketch + extrude) at `parts/cube.zipt`
 * with a 1×1 PNG thumbnail. Once seeded, the Place Component dialog will
 * render a "cube" tile that can be clicked.
 *
 * Requires `__zilventorPackProject` and `__zilventorGetOpfs` dev hooks to be
 * present on `window` (added in T26).
 */
export async function seedAssemblyCubePart(page: Page): Promise<void> {
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
          primitives: [{ id: 'R1', kind: 'rectangle', x: 0, y: 0, w: 50, h: 50 }],
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
}

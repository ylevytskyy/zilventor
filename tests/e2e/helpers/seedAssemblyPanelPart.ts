import type { Page } from '@playwright/test';

export type SeedPanelPartArgs = {
  partPath: string;
  partName?: string;
  length: number;
  width: number;
  thickness: number;
  materialId: string;
  grain?: 'length' | 'width' | 'none';
  edgeBands?: Partial<Record<'front' | 'back' | 'left' | 'right', { materialId: string } | null>>;
  /** Materials registry to embed at the part level (will reconcile on placement). */
  materials?: Array<{ id: string; name: string; defaultThickness: number; color: string }>;
};

/**
 * Seed a panel part to OPFS for cut-list / furniture E2E tests.
 *
 * Builds a v11 .zipt manifest with a single PanelFeature at featureTree[0]
 * and writes it to the given OPFS path.
 *
 * Requires `__zilventorPackProject` and `__zilventorGetOpfs` dev hooks (added
 * in T26 alongside other assembly dev hooks).
 */
export async function seedAssemblyPanelPart(page: Page, args: SeedPanelPartArgs): Promise<void> {
  await page.evaluate(async (a) => {
    const w = window as unknown as {
      __zilventorPackProject: (input: {
        manifest: unknown;
        blobs: Record<string, Uint8Array>;
        thumbnail?: Uint8Array;
      }) => Promise<Uint8Array>;
      __zilventorGetOpfs: () => Promise<{ write(path: string, data: Uint8Array): Promise<void> }>;
    };

    const manifest = {
      formatVersion: 11,
      kind: 'part',
      createdAt: new Date().toISOString(),
      appVersion: '0.0.0',
      document: {
        id: `part-${a.partPath}`,
        name: a.partName ?? a.partPath.split('/').pop()!.replace(/\.zipt$/, ''),
        units: 'mm',
        parameters: {},
        featureTree: [
          {
            kind: 'panel',
            id: 'pf1',
            length: { kind: 'literal', value: a.length },
            width: { kind: 'literal', value: a.width },
            thickness: { kind: 'literal', value: a.thickness },
            thicknessFromMaterial: false,
            materialId: a.materialId,
            grain: a.grain ?? 'length',
            edgeBands: {
              front: a.edgeBands?.front ?? null,
              back: a.edgeBands?.back ?? null,
              left: a.edgeBands?.left ?? null,
              right: a.edgeBands?.right ?? null,
            },
          },
        ],
        properties: {},
        materials: a.materials ?? [],
      },
    };

    const archive = await w.__zilventorPackProject({ manifest, blobs: {} });
    const opfs = await w.__zilventorGetOpfs();
    await opfs.write(a.partPath, archive);
  }, args);
}

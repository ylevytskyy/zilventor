import type { Page } from '@playwright/test';
import type { AssemblyDocument, ComponentInstance } from '@zilventor/shared';

/**
 * Build a minimal AssemblyDocument suitable for seeding a sub-assembly to
 * OPFS for E2E. `name` becomes both the doc.name and (combined with the
 * caller's chosen partPath) the OPFS path the parent will reference.
 */
export function makeSubAsmDoc(
  name: string,
  components: ComponentInstance[],
  overrides: Partial<AssemblyDocument> = {},
): AssemblyDocument {
  return {
    id: `${name}-id`,
    name,
    units: 'mm',
    parameters: {},
    components,
    constraints: [],
    groundedComponentPaths: [],
    colors: {},
    bomItemNumbers: {},
    colorOverrides: {},
    ...overrides,
  };
}

/**
 * Pack an AssemblyDocument as a `.ziasm` archive (with a 1×1 PNG thumbnail
 * so loadAssemblyTiles surfaces it in the Place dialog) and write it to OPFS
 * at `partPath`.
 *
 * Requires `__zilventorPackAssembly` and `__zilventorGetOpfs` dev hooks
 * (added with the 4d sub-assembly helpers).
 */
export async function seedSubAssemblyZiasm(
  page: Page,
  partPath: string,
  doc: AssemblyDocument,
): Promise<void> {
  await page.evaluate(async ({ partPath, doc }) => {
    const w = window as unknown as {
      __zilventorPackAssembly: (doc: AssemblyDocument, thumb: Uint8Array) => Promise<Uint8Array>;
      __zilventorGetOpfs: () => Promise<{ write(path: string, data: Uint8Array): Promise<void> }>;
    };
    // 1×1 transparent PNG so loadAssemblyTiles emits a tile for this archive.
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
    const archive = await w.__zilventorPackAssembly(doc as AssemblyDocument, png);
    const opfs = await w.__zilventorGetOpfs();
    await opfs.write(partPath, archive);
  }, { partPath, doc });
}

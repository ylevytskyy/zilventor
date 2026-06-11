// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { buildPullPart } from '../buildPullPart';
import { unpackProject } from '@zilventor/kernel/src/storage/ProjectPacker';
import { BUILTIN_CATALOG } from '@zilventor/shared/src/hardware/builtinCatalog';
import type { HardwareFeature } from '@zilventor/shared';

describe('buildPullPart', () => {
  it('returns path hardware/bar-pull-128.zipt for skuId bar-pull-128', async () => {
    const { path } = await buildPullPart('bar-pull-128');
    expect(path).toBe('hardware/bar-pull-128.zipt');
  });

  it('packs a PartDocument whose single user feature is kind:hardware with correct skuId and bboxMm.l', async () => {
    const { bytes } = await buildPullPart('bar-pull-128');
    const project = await unpackProject(bytes);
    const doc = (project.manifest as { document: { featureTree: unknown[] } }).document;

    const hwFeature = doc.featureTree.find(
      (f): f is HardwareFeature =>
        (f as HardwareFeature).kind === 'hardware',
    );
    expect(hwFeature).toBeDefined();
    expect(hwFeature!.hardwareSkuId).toBe('bar-pull-128');
    // cc=128, END_ALLOWANCE=16 → barLength = 128 + 2*16 = 160
    expect(hwFeature!.bboxMm.l).toBe(160);
  });

  it('BUILTIN_CATALOG has bar-pull-128 with category drawerHandles and name (not label)', () => {
    const entry = BUILTIN_CATALOG.find((e) => e.id === 'bar-pull-128');
    expect(entry).toBeDefined();
    expect(entry!.category).toBe('drawerHandles');
    // name field must be set (not label — HardwareEntry uses name, not label)
    expect(typeof entry!.name).toBe('string');
    expect(entry!.name.length).toBeGreaterThan(0);
  });
});

/**
 * U2 — clearBoresForAssembly: nested-sub-assembly recursion
 *
 * Proves that panels nested inside a .ziasm sub-assembly have their bores
 * collected (and subsequently cleared) — the old code skipped .ziasm entries
 * entirely, so nested-panel bores were silently ignored.
 */
import { describe, it, expect } from 'vitest';
import { packProject } from '@zilventor/kernel/src/storage/ProjectPacker';
import { packAssembly } from '@zilventor/kernel/src/storage/AssemblyPacker';
import { collectBoreDocsForClear } from '../clearBoresForAssembly';
import type { AssemblyDocument, BoreOp } from '@zilventor/shared';
import { CURRENT_FORMAT_VERSION } from '@zilventor/shared';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const BORE: BoreOp = {
  id: 'b1',
  face: { featureId: 'panel', role: 'Front', instance: 0 },
  u: 10, v: 10, diameter: 5, depth: 12,
  role: 'confirmat-face', connectorId: 'conn1', connectorKind: 'confirmat',
};

async function packPanelDoc(bores: BoreOp[]): Promise<Uint8Array> {
  const manifest = {
    formatVersion: CURRENT_FORMAT_VERSION,
    kind: 'part' as const,
    document: {
      id: 'panel-1',
      featureTree: [{ kind: 'panel', length: 600, width: 400, thickness: 18 }],
      bores: bores.length > 0 ? bores : undefined,
    },
  };
  return packProject({ manifest, blobs: {} });
}

function makeAsm(components: AssemblyDocument['components']): AssemblyDocument {
  return {
    id: 'asm-root',
    name: 'assembly',
    units: 'mm',
    parameters: {},
    properties: {},
    components,
    constraints: [],
    groundedComponentPaths: [],
    colors: {},
    bomItemNumbers: {},
    cutListItemNumbers: {},
    colorOverrides: {},
    materials: [],
    hardware: [],
  };
}

function makeComp(partPath: string): AssemblyDocument['components'][number] {
  return {
    id: `comp-${partPath}`,
    partPath,
    position: { x: 0, y: 0, z: 0 },
    rotation: { rx: 0, ry: 0, rz: 0 },
    visible: true,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('collectBoreDocsForClear — flat assembly', () => {
  it('collects .zipt panel with bores', async () => {
    const panelBytes = await packPanelDoc([BORE]);
    const opfs = {
      read: async (p: string) => {
        if (p === 'panel.zipt') return panelBytes;
        throw new Error(`unexpected read: ${p}`);
      },
    };
    const asm = makeAsm([makeComp('panel.zipt')]);
    const results = await collectBoreDocsForClear(asm, opfs);
    expect(results).toHaveLength(1);
    expect(results[0]!.partPath).toBe('panel.zipt');
    expect(results[0]!.doc.bores).toHaveLength(1);
  });

  it('skips .zipt panel with no bores', async () => {
    const panelBytes = await packPanelDoc([]);
    const opfs = { read: async () => panelBytes };
    const asm = makeAsm([makeComp('panel.zipt')]);
    const results = await collectBoreDocsForClear(asm, opfs);
    expect(results).toHaveLength(0);
  });
});

describe('collectBoreDocsForClear — nested .ziasm', () => {
  it('recurses into .ziasm and collects nested .zipt bores', async () => {
    const nestedPanelBytes = await packPanelDoc([BORE]);

    // Sub-assembly contains the panel with bores
    const subAsm = makeAsm([makeComp('cabinet/panel.zipt')]);
    subAsm.id = 'asm-sub';
    const subAsmBytes = await packAssembly(subAsm, new Uint8Array(0));

    const opfs = {
      read: async (p: string): Promise<Uint8Array> => {
        if (p === 'cabinet/panel.zipt') return nestedPanelBytes;
        if (p === 'cabinet.ziasm') return subAsmBytes;
        throw new Error(`unexpected read: ${p}`);
      },
    };

    // Top-level assembly only has the .ziasm; NO direct .zipt entries
    const topAsm = makeAsm([makeComp('cabinet.ziasm')]);
    const results = await collectBoreDocsForClear(topAsm, opfs);

    // Must find the nested panel's bores
    expect(results).toHaveLength(1);
    expect(results[0]!.partPath).toBe('cabinet/panel.zipt');
    expect(results[0]!.doc.bores).toHaveLength(1);
  });

  it('collects bores from BOTH top-level and nested panels', async () => {
    const panelBytes = await packPanelDoc([BORE]);
    const nestedPanelBytes = await packPanelDoc([{ ...BORE, id: 'b2', connectorId: 'conn2' }]);

    const subAsm = makeAsm([makeComp('nested/panel.zipt')]);
    subAsm.id = 'asm-nested';
    const subAsmBytes = await packAssembly(subAsm, new Uint8Array(0));

    const opfs = {
      read: async (p: string): Promise<Uint8Array> => {
        if (p === 'top-panel.zipt') return panelBytes;
        if (p === 'nested/panel.zipt') return nestedPanelBytes;
        if (p === 'cabinet.ziasm') return subAsmBytes;
        throw new Error(`unexpected read: ${p}`);
      },
    };

    const topAsm = makeAsm([makeComp('top-panel.zipt'), makeComp('cabinet.ziasm')]);
    const results = await collectBoreDocsForClear(topAsm, opfs);

    expect(results).toHaveLength(2);
    const paths = results.map((r) => r.partPath).sort();
    expect(paths).toEqual(['nested/panel.zipt', 'top-panel.zipt']);
  });
});

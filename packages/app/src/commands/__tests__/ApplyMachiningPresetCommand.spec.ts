// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ApplyMachiningPresetCommand } from '../ApplyMachiningPresetCommand';
import { useAppStore } from '../../store/useAppStore';
import { packProject, unpackProject } from '@zilventor/kernel/src/storage/ProjectPacker';
import { CURRENT_FORMAT_VERSION } from '@zilventor/shared';
import type { BoreOp, PartDocument, MachiningPreset, GrooveFeature } from '@zilventor/shared';

class MemOpfs {
  files = new Map<string, Uint8Array>();
  async read(p: string) { const b = this.files.get(p); if (!b) throw new Error(`no ${p}`); return b; }
  async write(p: string, b: Uint8Array) { this.files.set(p, b); }
}

async function writePanel(opfs: MemOpfs, path: string, bores: BoreOp[]) {
  const doc: Partial<PartDocument> = {
    id: path, name: path, units: 'mm', parameters: {},
    featureTree: [],
    bores,
  };
  const manifest = { formatVersion: CURRENT_FORMAT_VERSION, kind: 'part' as const, document: doc };
  await opfs.write(path, await packProject({ manifest, blobs: {} }));
}

async function boresOf(opfs: MemOpfs, path: string): Promise<BoreOp[]> {
  const project = await unpackProject(await opfs.read(path));
  return ((project.manifest as { document: { bores?: BoreOp[] } }).document.bores) ?? [];
}

function makeBore(id = 'b1', overrides: Partial<BoreOp> = {}): BoreOp {
  return {
    id, face: { featureId: 'panel', role: 'Front', instance: 0 },
    u: 10, v: 5, diameter: 7, depth: 12,
    role: 'confirmat-face', connectorId: 'c0', connectorKind: 'confirmat',
    ...overrides,
  };
}

function makePreset(overrides: Partial<MachiningPreset> = {}): MachiningPreset {
  return {
    id: 'preset-1', name: 'Confirmat std', opType: 'confirmat-face',
    diameter: 8, depth: 15, layerName: 'BORE_CONFIRMAT',
    ...overrides,
  };
}

describe('ApplyMachiningPresetCommand', () => {
  beforeEach(() => {
    useAppStore.getState().setBoreCacheInvalidator(null);
    // Clean up any presets left by other test files sharing the store module.
    for (const p of useAppStore.getState().machiningPresets) {
      useAppStore.getState().deleteMachiningPreset(p.id);
    }
  });

  it('apply sets diameter, depth, presetLayerName, toolNumber, speed from the snapshot values', async () => {
    const bore = makeBore();
    const doc = { bores: [bore] };
    const cmd = new ApplyMachiningPresetCommand({
      bore, partPath: 'p.zipt', doc, opfs: null,
      values: { diameter: 8, depth: 15, layerName: 'BORE_CONFIRMAT', toolNumber: 3, speed: 12000 },
    });
    await cmd.apply();
    expect(bore.diameter).toBe(8);
    expect(bore.depth).toBe(15);
    expect(bore.presetLayerName).toBe('BORE_CONFIRMAT');
    expect(bore.toolNumber).toBe(3);
    expect(bore.speed).toBe(12000);
  });

  it('apply with toolNumber/speed absent from values deletes any prior toolNumber/speed on the bore', async () => {
    const bore = makeBore('b1', { toolNumber: 9, speed: 8000 });
    const doc = { bores: [bore] };
    const cmd = new ApplyMachiningPresetCommand({
      bore, partPath: 'p.zipt', doc, opfs: null,
      values: { diameter: 8, depth: 15, layerName: 'BORE_CONFIRMAT' },
    });
    await cmd.apply();
    expect('toolNumber' in bore).toBe(false);
    expect('speed' in bore).toBe(false);
  });

  it('revert restores prior diameter/depth/presetLayerName and removes toolNumber/speed/presetLayerName that were absent before', async () => {
    const bore = makeBore(); // no presetLayerName/toolNumber/speed
    const doc = { bores: [bore] };
    const cmd = new ApplyMachiningPresetCommand({
      bore, partPath: 'p.zipt', doc, opfs: null,
      values: { diameter: 8, depth: 15, layerName: 'BORE_CONFIRMAT', toolNumber: 3, speed: 12000 },
    });
    await cmd.apply();
    expect(bore.diameter).toBe(8);
    await cmd.revert();
    expect(bore.diameter).toBe(7);
    expect(bore.depth).toBe(12);
    expect('presetLayerName' in bore).toBe(false);
    expect('toolNumber' in bore).toBe(false);
    expect('speed' in bore).toBe(false);
  });

  it('revert restores prior presetLayerName/toolNumber/speed when they existed before apply', async () => {
    const bore = makeBore('b1', { presetLayerName: 'OLD_LAYER', toolNumber: 1, speed: 6000 });
    const doc = { bores: [bore] };
    const cmd = new ApplyMachiningPresetCommand({
      bore, partPath: 'p.zipt', doc, opfs: null,
      values: { diameter: 8, depth: 15, layerName: 'NEW_LAYER', toolNumber: 3, speed: 12000 },
    });
    await cmd.apply();
    await cmd.revert();
    expect(bore.presetLayerName).toBe('OLD_LAYER');
    expect(bore.toolNumber).toBe(1);
    expect(bore.speed).toBe(6000);
  });

  it('re-apply after revert (redo) sets values again', async () => {
    const bore = makeBore();
    const doc = { bores: [bore] };
    const cmd = new ApplyMachiningPresetCommand({
      bore, partPath: 'p.zipt', doc, opfs: null,
      values: { diameter: 8, depth: 15, layerName: 'BORE_CONFIRMAT', toolNumber: 3, speed: 12000 },
    });
    await cmd.apply();
    await cmd.revert();
    await cmd.apply();
    expect(bore.diameter).toBe(8);
    expect(bore.presetLayerName).toBe('BORE_CONFIRMAT');
    expect(bore.toolNumber).toBe(3);
    expect(bore.speed).toBe(12000);
  });

  it('persists bore to opfs and updates bores[] in the manifest', async () => {
    const bore = makeBore();
    const doc = { bores: [bore] };
    const opfs = new MemOpfs();
    await writePanel(opfs, 'p.zipt', [{ ...bore }]);
    const cmd = new ApplyMachiningPresetCommand({
      bore, partPath: 'p.zipt', doc, opfs,
      values: { diameter: 8, depth: 15, layerName: 'BORE_CONFIRMAT', toolNumber: 3, speed: 12000 },
    });
    await cmd.apply();
    const persisted = await boresOf(opfs, 'p.zipt');
    expect(persisted[0]!.diameter).toBe(8);
    expect(persisted[0]!.presetLayerName).toBe('BORE_CONFIRMAT');
  });

  it('revert persists restored (absent) fields to opfs', async () => {
    const bore = makeBore();
    const doc = { bores: [bore] };
    const opfs = new MemOpfs();
    await writePanel(opfs, 'p.zipt', [{ ...bore }]);
    const cmd = new ApplyMachiningPresetCommand({
      bore, partPath: 'p.zipt', doc, opfs,
      values: { diameter: 8, depth: 15, layerName: 'BORE_CONFIRMAT', toolNumber: 3, speed: 12000 },
    });
    await cmd.apply();
    await cmd.revert();
    const persisted = await boresOf(opfs, 'p.zipt');
    expect(persisted[0]!.diameter).toBe(7);
    expect('presetLayerName' in persisted[0]!).toBe(false);
    expect('toolNumber' in persisted[0]!).toBe(false);
  });

  it('calls boreCacheInvalidator on apply and revert', async () => {
    const bore = makeBore();
    const doc = { bores: [bore] };
    const spy = vi.fn<(paths: string[]) => void>();
    useAppStore.getState().setBoreCacheInvalidator(spy);
    const cmd = new ApplyMachiningPresetCommand({
      bore, partPath: 'p.zipt', doc, opfs: null,
      values: { diameter: 8, depth: 15, layerName: 'BORE_CONFIRMAT' },
    });
    await cmd.apply();
    expect(spy).toHaveBeenCalledWith(['p.zipt']);
    spy.mockClear();
    await cmd.revert();
    expect(spy).toHaveBeenCalledWith(['p.zipt']);
  });

  // ── ADR 0001 core guarantee: snapshot-on-apply ─────────────────────────────
  it('LOCKING: mutating the preset in the store AFTER apply does not change the already-applied bore', async () => {
    const preset = makePreset();
    useAppStore.getState().addMachiningPreset(preset);

    const bore = makeBore();
    const doc = { bores: [bore] };
    // Panel-style usage: snapshot VALUES out of the preset at apply time, not a preset reference.
    const cmd = new ApplyMachiningPresetCommand({
      bore, partPath: 'p.zipt', doc, opfs: null,
      values: { diameter: preset.diameter, depth: preset.depth, layerName: preset.layerName },
    });
    await cmd.apply();
    expect(bore.diameter).toBe(8);
    expect(bore.depth).toBe(15);
    expect(bore.presetLayerName).toBe('BORE_CONFIRMAT');

    // The shop later re-tunes the preset (e.g. a new drill bit changes the diameter).
    useAppStore.getState().updateMachiningPreset({
      ...preset, diameter: 99, depth: 88, layerName: 'CHANGED_LAYER',
    });

    // The already-applied bore must be unaffected — production files don't drift.
    expect(bore.diameter).toBe(8);
    expect(bore.depth).toBe(15);
    expect(bore.presetLayerName).toBe('BORE_CONFIRMAT');
  });

  // ── P9 W1: widened groove target (D4) — same command, discriminated by presence of `groove` ──
  function makeGroove(overrides: Partial<GrooveFeature> = {}): GrooveFeature {
    return {
      kind: 'groove', id: 'g1', faceRole: 'Front', axis: 'u', position: 10, width: 8, depth: 6,
      ...overrides,
    };
  }

  it('groove: apply sets toolNumber/speed/presetLayerName only — never width/depth', async () => {
    const groove = makeGroove();
    const doc = { featureTree: [groove] as GrooveFeature[] };
    const cmd = new ApplyMachiningPresetCommand({
      groove, partPath: 'p.zipt', doc, opfs: null,
      values: { layerName: 'GROOVE_LAYER', toolNumber: 4, speed: 15000 },
    });
    await cmd.apply();
    expect(groove.presetLayerName).toBe('GROOVE_LAYER');
    expect(groove.toolNumber).toBe(4);
    expect(groove.speed).toBe(15000);
    // Invariant: dimensional fields untouched.
    expect(groove.width).toBe(8);
    expect(groove.depth).toBe(6);
    expect(groove.position).toBe(10);
  });

  it('groove: apply with toolNumber/speed absent from values deletes any prior toolNumber/speed', async () => {
    const groove = makeGroove({ toolNumber: 9, speed: 8000 });
    const doc = { featureTree: [groove] as GrooveFeature[] };
    const cmd = new ApplyMachiningPresetCommand({
      groove, partPath: 'p.zipt', doc, opfs: null,
      values: { layerName: 'GROOVE_LAYER' },
    });
    await cmd.apply();
    expect('toolNumber' in groove).toBe(false);
    expect('speed' in groove).toBe(false);
  });

  it('groove: revert restores prior presetLayerName/toolNumber/speed exactly, including absence', async () => {
    const groove = makeGroove(); // no presetLayerName/toolNumber/speed
    const doc = { featureTree: [groove] as GrooveFeature[] };
    const cmd = new ApplyMachiningPresetCommand({
      groove, partPath: 'p.zipt', doc, opfs: null,
      values: { layerName: 'GROOVE_LAYER', toolNumber: 4, speed: 15000 },
    });
    await cmd.apply();
    await cmd.revert();
    expect('presetLayerName' in groove).toBe(false);
    expect('toolNumber' in groove).toBe(false);
    expect('speed' in groove).toBe(false);
    // Invariant: dimensional fields never touched by apply OR revert.
    expect(groove.width).toBe(8);
    expect(groove.depth).toBe(6);
  });

  it('groove: revert restores prior presetLayerName/toolNumber/speed when they existed before apply', async () => {
    const groove = makeGroove({ presetLayerName: 'OLD_LAYER', toolNumber: 1, speed: 6000 });
    const doc = { featureTree: [groove] as GrooveFeature[] };
    const cmd = new ApplyMachiningPresetCommand({
      groove, partPath: 'p.zipt', doc, opfs: null,
      values: { layerName: 'NEW_LAYER', toolNumber: 3, speed: 12000 },
    });
    await cmd.apply();
    await cmd.revert();
    expect(groove.presetLayerName).toBe('OLD_LAYER');
    expect(groove.toolNumber).toBe(1);
    expect(groove.speed).toBe(6000);
  });

  it('groove: persists the mutated groove to opfs via manifest.document.featureTree', async () => {
    const groove = makeGroove();
    const doc = { featureTree: [groove] as GrooveFeature[] };
    const opfs = new MemOpfs();
    const partDoc: Partial<PartDocument> = {
      id: 'p.zipt', name: 'p.zipt', units: 'mm', parameters: {},
      featureTree: [{ ...groove }],
    };
    const manifest = { formatVersion: CURRENT_FORMAT_VERSION, kind: 'part' as const, document: partDoc };
    await opfs.write('p.zipt', await packProject({ manifest, blobs: {} }));
    const cmd = new ApplyMachiningPresetCommand({
      groove, partPath: 'p.zipt', doc, opfs,
      values: { layerName: 'GROOVE_LAYER', toolNumber: 4, speed: 15000 },
    });
    await cmd.apply();
    const project = await unpackProject(await opfs.read('p.zipt'));
    const persistedTree = (project.manifest as { document: { featureTree: GrooveFeature[] } }).document.featureTree;
    expect(persistedTree[0]!.toolNumber).toBe(4);
    expect(persistedTree[0]!.presetLayerName).toBe('GROOVE_LAYER');
    expect(persistedTree[0]!.width).toBe(8);
  });

  it('existing bore-target construction (no `groove` field) keeps working unchanged', async () => {
    // Guards against the widened constructor silently requiring a discriminant field.
    const bore = makeBore();
    const doc = { bores: [bore] };
    const cmd = new ApplyMachiningPresetCommand({
      bore, partPath: 'p.zipt', doc, opfs: null,
      values: { diameter: 8, depth: 15, layerName: 'BORE_CONFIRMAT' },
    });
    await cmd.apply();
    expect(bore.diameter).toBe(8);
    expect(bore.depth).toBe(15);
  });
});

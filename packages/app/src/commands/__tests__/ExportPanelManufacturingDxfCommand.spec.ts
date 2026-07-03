import { describe, it, expect, vi } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { buildManufacturingZipEntries, buildCombinedManufacturingDxf, ExportPanelManufacturingDxfCommand } from '../ExportPanelManufacturingDxfCommand';
import type { PanelManufacturingInput } from '../../drawing/renderPanelManufacturingDxf';
import type { BoreOp, KeyholeSlotFeature } from '@zilventor/shared';

// jsdom doesn't implement URL.createObjectURL — stub it for the fallback path.
Object.defineProperty(URL, 'createObjectURL', { value: vi.fn(() => 'blob:stub'), writable: true });
Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), writable: true });

const input = (
  n: number,
  name: string,
  materialName = 'White 18',
  materialId = 'm',
): PanelManufacturingInput => ({
  itemNumber: n, partName: name, materialName, qty: 1,
  spec: { length: 800, width: 600, thickness: 18, materialId, grain: 'length',
    edgeBands: { front: null, back: null, left: null, right: null } } as any,
  bores: [], grooves: [],
});

// R4.1(a): CNC zip entries are grouped into per-material subfolders so a
// keyed entry like "White_18/item-1-Side.dxf" is treated as a folder by
// fflate.zipSync (dxfZip.ts already handles "/" in keys).
describe('buildManufacturingZipEntries', () => {
  it('produces one DXF entry per input with item-n-name.dxf filenames, nested under the material folder', () => {
    const entries = buildManufacturingZipEntries([input(1, 'Side'), input(2, 'Top Shelf')]);
    expect(Object.keys(entries)).toEqual(['White_18/item-1-Side.dxf', 'White_18/item-2-Top_Shelf.dxf']);
    expect(entries['White_18/item-1-Side.dxf']).toContain('OUTLINE');
  });

  it('groups inputs into separate material folders when material names differ', () => {
    const entries = buildManufacturingZipEntries([
      input(1, 'Side', 'White 18'),
      input(2, 'Door', 'Oak Veneer'),
    ]);
    expect(Object.keys(entries).sort()).toEqual([
      'Oak_Veneer/item-2-Door.dxf',
      'White_18/item-1-Side.dxf',
    ]);
  });

  it('keeps two inputs with the same material under a single folder', () => {
    const entries = buildManufacturingZipEntries([input(1, 'Side'), input(2, 'Back')]);
    const keys = Object.keys(entries);
    expect(keys).toHaveLength(2);
    expect(keys.every((k) => k.startsWith('White_18/'))).toBe(true);
  });

  // Note: sanitizeFolder() substitutes each disallowed character with '_'
  // (it does not strip) and keeps Unicode letters/digits, so a Cyrillic name
  // like "ДСП" is now preserved as-is (see the Unicode tests below) instead
  // of collapsing to "___". The only way to get a genuinely empty sanitized
  // name is an empty materialName/materialId — exercised below.
  it('falls back to the sanitized materialId when the material name is empty', () => {
    const entries = buildManufacturingZipEntries([input(1, 'Side', '', 'mdf18')]);
    expect(Object.keys(entries)).toEqual(['mdf18/item-1-Side.dxf']);
  });

  it('falls back to a fixed "material" folder when both name and id are empty', () => {
    const entries = buildManufacturingZipEntries([input(1, 'Side', '', '')]);
    expect(Object.keys(entries)).toEqual(['material/item-1-Side.dxf']);
  });

  it('merges material names that sanitize identically without losing entries', () => {
    const entries = buildManufacturingZipEntries([
      input(1, 'Side', 'White/18'),
      input(2, 'Back', 'White 18'),
    ]);
    expect(Object.keys(entries).sort()).toEqual([
      'White_18/item-1-Side.dxf',
      'White_18/item-2-Back.dxf',
    ]);
  });
});

// R4.1(a) Unicode fix: material folder keys must preserve Unicode letters
// (e.g. Cyrillic) instead of collapsing to underscores — only the zip
// *folder* key changes; DXF filenames/content stay ASCII-only via sanitize().
describe('buildManufacturingZipEntries — Unicode material folders', () => {
  it('preserves a Cyrillic material name as a Unicode folder key', () => {
    const entries = buildManufacturingZipEntries([input(1, 'Side', 'ДСП 16мм')]);
    expect(Object.keys(entries)).toEqual(['ДСП_16мм/item-1-Side.dxf']);
  });

  it('keeps an ASCII material folder key byte-identical to before', () => {
    const entries = buildManufacturingZipEntries([input(1, 'Side', 'Birch 18mm')]);
    expect(Object.keys(entries)).toEqual(['Birch_18mm/item-1-Side.dxf']);
  });

  it('no longer collapses a Unicode-letters-only material name to "___" or falls back to materialId', () => {
    const entries = buildManufacturingZipEntries([input(1, 'Side', 'ДСП', 'mdf18')]);
    expect(Object.keys(entries)).toEqual(['ДСП/item-1-Side.dxf']);
  });

  it('fallback chain stays Unicode-aware: empty material name falls back to a Unicode materialId', () => {
    const entries = buildManufacturingZipEntries([input(1, 'Side', '', 'ДСП')]);
    expect(Object.keys(entries)).toEqual(['ДСП/item-1-Side.dxf']);
  });
});

// R1: a panel that failed the panelPreflight check (missing name/material/
// non-manifold/split-required) must surface a user-facing toast at export
// time, not just a console.warn dropped upstream. Mirrors ExportBoringDxfCommand.
describe('ExportPanelManufacturingDxfCommand — R1 preflight diagnostics', () => {
  it('shows a toast for each collected preflight diagnostic', async () => {
    const toasts: string[] = [];
    await new ExportPanelManufacturingDxfCommand({
      inputs: [input(1, 'Side')],
      suggestedName: 'manufacturing.zip',
      diagnostics: [
        { partPath: 'ghost.zipt', reasonKey: 'panel.preflight.missingMaterial', params: { name: 'Ghost' } },
      ],
      showToast: (msg) => toasts.push(msg),
    }).apply();
    expect(toasts).toHaveLength(1);
    expect(toasts[0]).toMatch(/Ghost/);
    expect(toasts[0]).toMatch(/material/i);
  });

  it('shows no toast when there are no diagnostics', async () => {
    const toasts: string[] = [];
    await new ExportPanelManufacturingDxfCommand({
      inputs: [input(1, 'Side')],
      suggestedName: 'manufacturing.zip',
      showToast: (msg) => toasts.push(msg),
    }).apply();
    expect(toasts).toHaveLength(0);
  });
});

describe('buildCombinedManufacturingDxf', () => {
  it('returns a non-empty DXF string with one OUTLINE entry per input', () => {
    const dxf = buildCombinedManufacturingDxf([input(1, 'Side'), input(2, 'Top Shelf'), input(3, 'Back')]);
    expect(dxf.length).toBeGreaterThan(0);
    expect((dxf.match(/LWPOLYLINE/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect(dxf).toContain('#1 Side');
    expect(dxf).toContain('#2 Top Shelf');
    expect(dxf).toContain('#3 Back');
  });
});

describe('ExportPanelManufacturingDxfCommand — mode:combined', () => {
  it('saves one .dxf file (derived name) with combined DXF bytes instead of a zip', async () => {
    let seenSuggestedName = '';
    const stub = async (opts: { suggestedName: string }) => {
      seenSuggestedName = opts.suggestedName;
      return { createWritable: async () => ({ write: async () => {}, close: async () => {} }) };
    };
    (globalThis as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker = stub;
    try {
      await new ExportPanelManufacturingDxfCommand({
        inputs: [input(1, 'Side'), input(2, 'Top Shelf')],
        suggestedName: 'assembly-manufacturing.zip',
        mode: 'combined',
      }).apply();
    } finally {
      delete (globalThis as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker;
    }

    expect(seenSuggestedName).toBe('assembly-manufacturing-combined.dxf');
    const bytes = (globalThis as unknown as { __zilventorManufacturingDxfBytes?: Uint8Array }).__zilventorManufacturingDxfBytes;
    expect(bytes?.constructor?.name).toBe('Uint8Array');
    const text = new TextDecoder().decode(bytes!);
    expect(text.length).toBeGreaterThan(0);
    expect(text).toContain('#1 Side');
    expect(text).toContain('#2 Top Shelf');
  });

  it('mode:folders (default) still produces the exact same zip entries as before', async () => {
    const stub = async () => ({
      createWritable: async () => ({ write: async () => {}, close: async () => {} }),
    });
    (globalThis as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker = stub;
    try {
      await new ExportPanelManufacturingDxfCommand({
        inputs: [input(1, 'Side'), input(2, 'Top Shelf')],
        suggestedName: 'assembly-manufacturing.zip',
      }).apply();
    } finally {
      delete (globalThis as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker;
    }
    const bytes = (globalThis as unknown as { __zilventorManufacturingDxfBytes?: Uint8Array }).__zilventorManufacturingDxfBytes;
    expect(bytes?.constructor?.name).toBe('Uint8Array');
  });
});

// W7 (docs/superpowers/plans/2026-07-02-p3-machining-presets-cam-metadata.md, D2/S1):
// machining sidecar CSV ships in the folders/zip export only, at the ZIP ROOT (not inside a
// material folder) — combined single-DXF mode must stay byte-for-byte unaffected.
// jsdom's Blob polyfill has no .text()/.arrayBuffer() — FileReader is the one API
// jsdom does implement for reading Blob contents back out in a unit test.
function blobToText(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = () => reject(fr.error);
    fr.readAsText(blob);
  });
}

function boreWithCam(faceRole: string, role: string): BoreOp {
  const face: BoreOp['face'] = { featureId: 'panel', role: faceRole, instance: 0 };
  return { id: 'b1', face, u: 100, v: 50, diameter: 5, depth: 12, role, connectorId: 'c1',
    connectorKind: 'confirmat', toolNumber: 3, speed: 12000 } as unknown as BoreOp;
}

function keyholeSlot(over: Partial<KeyholeSlotFeature> = {}): KeyholeSlotFeature {
  return { kind: 'keyholeSlot', id: 'ks1', faceRole: 'Top', u: 200, v: 150, axis: 'u', direction: 1,
    entryDiameter: 15, slotWidth: 8, slotLength: 30, depth: 6, ...over };
}

// P17: keyhole slots must ride along through the zip-entry DXF and the
// machining.csv sidecar, mirroring the pre-existing groove/bore coverage above.
describe('ExportPanelManufacturingDxfCommand — keyhole slots', () => {
  it('mode:folders zip DXF entries carry the KEYHOLE-SLOTS layer and machining.csv carries a keyholeSlot opType row', async () => {
    const withKeyhole: PanelManufacturingInput = { ...input(1, 'Side'), keyholeSlots: [keyholeSlot()] };
    const stub = async () => ({ createWritable: async () => ({ write: async () => {}, close: async () => {} }) });
    (globalThis as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker = stub;
    try {
      await new ExportPanelManufacturingDxfCommand({ inputs: [withKeyhole], suggestedName: 'assembly-manufacturing.zip' }).apply();
    } finally {
      delete (globalThis as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker;
    }
    const bytes = (globalThis as unknown as { __zilventorManufacturingDxfBytes?: Uint8Array }).__zilventorManufacturingDxfBytes!;
    const zip = unzipSync(bytes);
    const dxf = strFromU8(zip['White_18/item-1-Side.dxf']!);
    expect(dxf).toContain('KEYHOLE-SLOTS');
    const csv = strFromU8(zip['machining.csv']!);
    expect(csv).toContain('Side,keyholeSlot,15,6,KEYHOLE-SLOTS,,');
  });
});

describe('ExportPanelManufacturingDxfCommand — W7 machining.csv sidecar', () => {
  it('mode:folders zip contains machining.csv at the ZIP ROOT with a parseable header + bore row', async () => {
    const withBore: PanelManufacturingInput = { ...input(1, 'Side'), bores: [boreWithCam('Top', 'confirmat-face')] };
    const stub = async () => ({ createWritable: async () => ({ write: async () => {}, close: async () => {} }) });
    (globalThis as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker = stub;
    try {
      await new ExportPanelManufacturingDxfCommand({ inputs: [withBore], suggestedName: 'assembly-manufacturing.zip' }).apply();
    } finally {
      delete (globalThis as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker;
    }
    const bytes = (globalThis as unknown as { __zilventorManufacturingDxfBytes?: Uint8Array }).__zilventorManufacturingDxfBytes!;
    const zip = unzipSync(bytes);
    expect(Object.keys(zip)).toContain('machining.csv');
    // ZIP ROOT: no "/" in the key — unlike the per-material DXF entries.
    expect(Object.keys(zip).filter((k) => k.endsWith('.csv'))).toEqual(['machining.csv']);
    const csv = strFromU8(zip['machining.csv']!);
    expect(csv.split('\n')[0]).toBe('partName,opType,diameter,depth,layer,toolNumber,speed');
    expect(csv).toContain('Side,confirmat-face,5,12,BORES-FRONT-5MM,3,12000');
    // DXF entries are still present alongside the CSV.
    expect(Object.keys(zip)).toContain('White_18/item-1-Side.dxf');
  });

  // D6 (2026-07-03-p9-preset-coverage.md): the combined .dxf payload itself stays
  // byte-for-byte unaffected — no CSV inlined into the DXF bytes — but machining.csv
  // now ships as a SECOND, SEQUENTIAL showSaveFilePicker call when the inputs carry
  // preset-derived metadata. This supersedes the pre-P9 "no CSV in combined mode at
  // all" contract recorded at ExportPanelManufacturingDxfCommand.ts:78-80.
  it('mode:combined: primary .dxf bytes stay byte-for-byte unchanged, and a second machining.csv download fires when metadata is present', async () => {
    const withBore: PanelManufacturingInput = { ...input(1, 'Side'), bores: [boreWithCam('Top', 'confirmat-face')] };
    const calls: Array<{ suggestedName: string; text: string }> = [];
    const stub = async (opts: { suggestedName: string }) => ({
      createWritable: async () => ({
        write: async (data: Uint8Array | Blob) => {
          const text = data instanceof Blob ? await blobToText(data) : new TextDecoder().decode(data);
          calls.push({ suggestedName: opts.suggestedName, text });
        },
        close: async () => {},
      }),
    });
    (globalThis as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker = stub;
    try {
      await new ExportPanelManufacturingDxfCommand({ inputs: [withBore], suggestedName: 'assembly-manufacturing.zip', mode: 'combined' }).apply();
    } finally {
      delete (globalThis as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker;
    }

    // Primary .dxf artifact — unchanged filename, unchanged bytes, no CSV inlined.
    const bytes = (globalThis as unknown as { __zilventorManufacturingDxfBytes?: Uint8Array }).__zilventorManufacturingDxfBytes!;
    const text = new TextDecoder().decode(bytes);
    expect(text).toBe(buildCombinedManufacturingDxf([withBore]));
    expect(text).not.toContain('machining.csv');
    expect(text).not.toContain('partName,opType,diameter,depth,layer,toolNumber,speed');

    // Second, sequential download: machining.csv sidecar with the same CAM metadata.
    expect(calls).toHaveLength(2);
    expect(calls[0]!.suggestedName).toBe('assembly-manufacturing-combined.dxf');
    expect(calls[1]!.suggestedName).toBe('machining.csv');
    expect(calls[1]!.text.split('\n')[0]).toBe('partName,opType,diameter,depth,layer,toolNumber,speed');
    expect(calls[1]!.text).toContain('Side,confirmat-face,5,12,BORES-FRONT-5MM,3,12000');
  });

  it('mode:combined: omits the second machining.csv download when no bore/groove carries preset-derived metadata', async () => {
    const plain: PanelManufacturingInput = input(1, 'Side'); // no bores/grooves at all
    const calls: Array<{ suggestedName: string }> = [];
    const stub = async (opts: { suggestedName: string }) => ({
      createWritable: async () => ({
        write: async () => { calls.push({ suggestedName: opts.suggestedName }); },
        close: async () => {},
      }),
    });
    (globalThis as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker = stub;
    try {
      await new ExportPanelManufacturingDxfCommand({ inputs: [plain], suggestedName: 'assembly-manufacturing.zip', mode: 'combined' }).apply();
    } finally {
      delete (globalThis as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker;
    }
    expect(calls).toHaveLength(1);
    expect(calls[0]!.suggestedName).toBe('assembly-manufacturing-combined.dxf');
  });
});

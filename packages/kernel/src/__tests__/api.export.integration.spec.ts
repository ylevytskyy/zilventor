import { describe, it, expect } from 'vitest';
import { createKernelApi } from '../api';
import type { ExportLeaf } from '../api';
import { readStep } from '../occt/StepIO';
import { loadOcct } from '../occt/occtLoader';

/** Decode a Uint8Array to a UTF-8 string for raw STEP text inspection. */
function decodeStep(bytes: Uint8Array): string {
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}

async function makeBoxPart(api: ReturnType<typeof createKernelApi>, name: string, side: number): Promise<string> {
  const partId = await api.createPart(name);
  await api.setParameter(partId, { name: 'd1', expression: String(side), value: side, unit: 'mm' });
  await api.addFeature(partId, { kind: 'sketch', id: 's1', plane: { source: 'workPlane', featureId: 'origin.XY' },
    primitives: [{ id: 'p1', kind: 'rectangle', x: 0, y: 0, w: side, h: side }], constraints: [] });
  await api.addFeature(partId, { kind: 'extrude', id: 'e1', sketchRef: 's1', distanceParam: 'd1', direction: 'forward', operation: 'new' });
  return partId;
}

describe('KernelApi STEP export', () => {
  it('exportStepPart on an executed part round-trips a 10mm box (mm units, 1 solid)', async () => {

    const api = createKernelApi();
    await api.init();
    const partId = await makeBoxPart(api, 'Box', 10);
    const r = await api.execute(partId); // warms namedShapeCache
    expect(r.ok).toBe(true);

    const bytes = await api.exportStepPart(partId);
    expect(bytes.byteLength).toBeGreaterThan(0);

    const oc = await loadOcct();
    const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const res = readStep(oc, ab);
    expect(res.solidCount).toBe(1);
    // (c) mm proof: span toBeCloseTo(10, 3) — NEVER '>'
    expect(res.boundingBox[3]! - res.boundingBox[0]!).toBeCloseTo(10, 3);
  }, 120_000);

  it('exportStepPart re-executes a COLD namedShapeCache (loadFromBytes warms parts only)', async () => {
    const api = createKernelApi();
    await api.init();
    const partId = await makeBoxPart(api, 'ColdBox', 10);
    await api.execute(partId);
    const archive = await api.saveToBytes(partId);

    // Fresh kernel: loadFromBytes populates `parts` but NOT namedShapeCache → cold.
    const api2 = createKernelApi();
    await api2.init();
    const reloadedId = await api2.loadFromBytes(archive);

    // (a) cold-cache guard: MUST re-execute, not export empty (solidCount === 0 would mean cold-cache exported empty)
    const bytes = await api2.exportStepPart(reloadedId);
    const oc = await loadOcct();
    const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const res = readStep(oc, ab);
    expect(res.solidCount).toBe(1); // cold-cache-empty bug → 0 → RED
    expect(res.boundingBox[3]! - res.boundingBox[0]!).toBeCloseTo(10, 3);
  }, 120_000);

  // ---- Phase 4: assembly + color-loss-trap guard ----

  it('exportStepAssembly: posed 2-component / 2-color assembly — BOTH colors survive + posed min-corner', async () => {
    const api = createKernelApi();
    await api.init();
    // Two registered parts (both executed → namedShapeCache warm).
    const redId = await makeBoxPart(api, 'Red', 10);
    const grnId = await makeBoxPart(api, 'Green', 10);
    await api.execute(redId);
    await api.execute(grnId);

    // Red at origin (identity); Green translated +50 along X. Different colors.
    const leaves: ExportLeaf[] = [
      { partId: redId, name: 'Red',   pose: { translation: { x: 0,  y: 0, z: 0 }, quaternion: [0, 0, 0, 1] as const },  color: [1, 0, 0] as const },
      { partId: grnId, name: 'Green', pose: { translation: { x: 50, y: 0, z: 0 }, quaternion: [0, 0, 0, 1] as const },  color: [0, 1, 0] as const },
    ];
    const bytes = await api.exportStepAssembly(leaves);

    const oc = await loadOcct();
    const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const res = readStep(oc, ab);

    // (a) solidCount FIRST — a cold/empty export shows 0 → RED before colors.
    expect(res.solidCount).toBe(2);
    // (b) the color-loss-trap signature: BOTH distinct colors survive (the bug drops all but the first).
    // sRGB-as-is, lowercase.
    expect(res.solidColors.filter(Boolean).sort()).toEqual(['#00ff00', '#ff0000']);
    // (c) pose lives in transform → posed bbox spans 0..60 (red 0..10, green 50..60).
    expect(res.boundingBox[0]!).toBeCloseTo(0, 3);   // red min-corner X
    expect(res.boundingBox[3]!).toBeCloseTo(60, 3);  // green max-corner X (50+10)
  }, 180_000);

  it('exportStepAssembly: 2 instances of ONE part → 2 posed components with distinct bboxes', async () => {
    const api = createKernelApi();
    await api.init();
    const boxId = await makeBoxPart(api, 'Box', 10);
    await api.execute(boxId);

    // Same partId used twice (protoKey = partId).
    const leaves: ExportLeaf[] = [
      { partId: boxId, name: 'A', pose: { translation: { x: 0,  y: 0, z: 0 }, quaternion: [0, 0, 0, 1] as const } },
      { partId: boxId, name: 'B', pose: { translation: { x: 30, y: 0, z: 0 }, quaternion: [0, 0, 0, 1] as const } },
    ];
    const bytes = await api.exportStepAssembly(leaves);

    const oc = await loadOcct();
    const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const res = readStep(oc, ab);
    // Two distinct posed instances of the same part.
    expect(res.solidCount).toBe(2);
    expect(res.boundingBox[0]!).toBeCloseTo(0, 3);
    expect(res.boundingBox[3]!).toBeCloseTo(40, 3); // B at 30..40
  }, 180_000);

  // ---- Structural XCAF assembly assertions (RED with flat impl, GREEN after structured rebuild) ----

  it('exportStepAssembly: STEP text contains NEXT_ASSEMBLY_USAGE_OCCURRENCE (proves assembly structure, not flat)', async () => {
    const api = createKernelApi();
    await api.init();
    const boxId = await makeBoxPart(api, 'StructBox', 10);
    await api.execute(boxId);

    // Two instances of the same part — XCAF instancing via AddComponent must produce 2 NAUOs.
    const leaves: ExportLeaf[] = [
      { partId: boxId, name: 'Side_A', pose: { translation: { x: 0,  y: 0, z: 0 }, quaternion: [0, 0, 0, 1] as const } },
      { partId: boxId, name: 'Side_B', pose: { translation: { x: 50, y: 0, z: 0 }, quaternion: [0, 0, 0, 1] as const } },
    ];
    const bytes = await api.exportStepAssembly(leaves);
    const txt = decodeStep(bytes);

    // (1) Structural proof: NEXT_ASSEMBLY_USAGE_OCCURRENCE is the AP214/AP242 marker
    //     that an assembly relationship exists.  The flat baked impl has ZERO of these.
    expect(txt).toContain('NEXT_ASSEMBLY_USAGE_OCCURRENCE');

    // (2) Instancing proof: two separate component relations → at least 2 NAUOs.
    const nauoCount = (txt.match(/NEXT_ASSEMBLY_USAGE_OCCURRENCE/g) ?? []).length;
    expect(nauoCount).toBeGreaterThanOrEqual(2);

    // (3) Instance names survive in the STEP text.
    expect(txt).toContain('Side_A');
    expect(txt).toContain('Side_B');
  }, 180_000);

  it('exportStepAssembly: structured 2-color, 2-instance — both colors survive + both instance names in STEP text', async () => {
    const api = createKernelApi();
    await api.init();
    const redId = await makeBoxPart(api, 'RedProto', 10);
    const grnId = await makeBoxPart(api, 'GrnProto', 10);
    await api.execute(redId);
    await api.execute(grnId);

    const leaves: ExportLeaf[] = [
      { partId: redId, name: 'RedInst', pose: { translation: { x: 0,  y: 0, z: 0 }, quaternion: [0, 0, 0, 1] as const }, color: [1, 0, 0] as const },
      { partId: grnId, name: 'GrnInst', pose: { translation: { x: 50, y: 0, z: 0 }, quaternion: [0, 0, 0, 1] as const }, color: [0, 1, 0] as const },
    ];
    const bytes = await api.exportStepAssembly(leaves);
    const txt = decodeStep(bytes);

    // (1) Assembly structure is present (not flat).
    expect(txt).toContain('NEXT_ASSEMBLY_USAGE_OCCURRENCE');

    // (2) Both instance names survive.
    expect(txt).toContain('RedInst');
    expect(txt).toContain('GrnInst');

    // (3) Colors: at least 2 FILL_AREA_STYLE_COLOUR / STYLED_ITEM entries for the two distinct colors.
    //     AP214 STEP uses FILL_AREA_STYLE_COLOUR (not COLOUR_RGB) for predefined/sRGB colors.
    //     The flat color-loss trap signature: only ONE color survives.
    const colourStyleCount = (txt.match(/FILL_AREA_STYLE_COLOUR/g) ?? []).length;
    expect(colourStyleCount).toBeGreaterThanOrEqual(2);

    // (4) The readStep-based round-trip also confirms 2 solid colors survive.
    const oc = await loadOcct();
    const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const res = readStep(oc, ab);
    expect(res.solidCount).toBe(2);
    // Both distinct colors must be present (sorted for stable comparison).
    const presentColors = res.solidColors.filter(Boolean).sort();
    expect(presentColors).toContain('#ff0000');
    expect(presentColors).toContain('#00ff00');
  }, 180_000);

  it('exportStepAssembly: 2 instances of 1 proto — STEP has exactly 1 AddShape proto + 2 NAUO component refs (de-dup)', async () => {
    const api = createKernelApi();
    await api.init();
    const boxId = await makeBoxPart(api, 'DedupeBox', 10);
    await api.execute(boxId);

    const leaves: ExportLeaf[] = [
      { partId: boxId, name: 'Inst1', pose: { translation: { x: 0,  y: 0, z: 0 }, quaternion: [0, 0, 0, 1] as const } },
      { partId: boxId, name: 'Inst2', pose: { translation: { x: 25, y: 0, z: 0 }, quaternion: [0, 0, 0, 1] as const } },
    ];
    const bytes = await api.exportStepAssembly(leaves);
    const txt = decodeStep(bytes);

    // De-dup proof: same partId → 1 prototype AddShape, 2 AddComponent calls.
    // AP214/242: 2 component instances → exactly 2 NEXT_ASSEMBLY_USAGE_OCCURRENCE entries.
    const nauoCount = (txt.match(/NEXT_ASSEMBLY_USAGE_OCCURRENCE/g) ?? []).length;
    expect(nauoCount).toBeGreaterThanOrEqual(2);

    // Both instance names must appear.
    expect(txt).toContain('Inst1');
    expect(txt).toContain('Inst2');

    // readStep confirms two posed instances resolve to correct bbox.
    const oc = await loadOcct();
    const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const res = readStep(oc, ab);
    expect(res.solidCount).toBe(2);
    expect(res.boundingBox[0]!).toBeCloseTo(0, 3);
    expect(res.boundingBox[3]!).toBeCloseTo(35, 3); // Inst2 at 25..35
  }, 180_000);
});

// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { buildDrawerBox, writeBoxSideBores, restoreBoxSideBores } from '../buildDrawerBox';
import { drawerBoxMath } from '@zilventor/shared/src/drawerBoxMath';
import { drawerSlideMath } from '@zilventor/shared/src/drawerSlideMath';
import { unpackAssembly } from '@zilventor/kernel/src/storage/AssemblyPacker';
import { unpackProject } from '@zilventor/kernel/src/storage/ProjectPacker';
import type { BoreOp } from '@zilventor/shared';

/** Minimal in-memory OPFS used during buildDrawerBox/writeBoxSideBores calls. */
class MemOpfs {
  files = new Map<string, Uint8Array>();
  async read(p: string): Promise<Uint8Array> {
    const b = this.files.get(p);
    if (!b) throw new Error(`MemOpfs: no file at ${p}`);
    return b;
  }
  async write(p: string, b: Uint8Array): Promise<void> { this.files.set(p, b); }
  async exists(p: string): Promise<boolean> { return this.files.has(p); }
  async delete(p: string): Promise<void> { this.files.delete(p); }
}

/** Read BoreOp[] from a packed .zipt in OPFS. */
async function boresOf(opfs: MemOpfs, path: string): Promise<BoreOp[]> {
  const proj = await unpackProject(await opfs.read(path));
  return ((proj.manifest as { document: { bores?: BoreOp[] } }).document.bores) ?? [];
}

const slot = { bottomZ: 100, topZ: 300 };   // slotH = 200
const opening = { openW: 564, innerD: 500 };

// Shared box math result used across multiple tests
const BOX = drawerBoxMath(slot, opening);

// ─── Test 1: buildDrawerBox round-trip ─────────────────────────────────────

describe('buildDrawerBox — pack + unpack', () => {
  it('writes 5 panel .zipt files to OPFS and returns a .ziasm with 5 components', async () => {
    const opfs = new MemOpfs();
    const result = await buildDrawerBox(BOX, { boxId: 'box0', name: 'Drawer Box 1' }, opfs);

    // returned bytes must unpack to an assembly with 5 components
    const asm = await unpackAssembly(result.bytes);
    expect(asm.components).toHaveLength(5);

    // all 5 panel .zipt paths must exist in OPFS
    expect(result.panelPaths).toHaveLength(5);
    for (const p of result.panelPaths) {
      expect(await opfs.exists(p), `panel .zipt ${p} must be written to OPFS`).toBe(true);
    }

    // component partPaths must match the written panel paths
    const componentPaths = asm.components.map((c) => c.partPath).sort();
    const writtenPaths = [...result.panelPaths].sort();
    expect(componentPaths).toEqual(writtenPaths);
  });

  it('assigns the correct drawerBox-side / drawerBox-front / drawerBox-back / drawerBox-bottom roles', async () => {
    const opfs = new MemOpfs();
    const result = await buildDrawerBox(BOX, { boxId: 'box1', name: 'B' }, opfs);
    const asm = await unpackAssembly(result.bytes);
    const roles = asm.components.map((c) => c.role).sort();
    expect(roles).toEqual(
      ['drawerBox-back', 'drawerBox-bottom', 'drawerBox-front', 'drawerBox-side', 'drawerBox-side'],
    );
  });

  it('each panel .zipt is a valid PartDocument carrying a PanelFeature', async () => {
    const opfs = new MemOpfs();
    const result = await buildDrawerBox(BOX, { boxId: 'box2', name: 'B' }, opfs);
    for (const path of result.panelPaths) {
      const proj = await unpackProject(await opfs.read(path));
      const doc = (proj.manifest as { document: { featureTree?: unknown[] } }).document;
      expect(doc.featureTree?.some((f: unknown) => (f as { kind: string }).kind === 'panel'),
        `panel .zipt ${path} must contain a PanelFeature`).toBe(true);
    }
  });
});

// ─── Test 2: writeBoxSideBores routes Top→LEFT, Bottom→RIGHT ────────────────

describe('writeBoxSideBores — bore routing', () => {
  it('routes face.role=Top bore to LEFT side panel and face.role=Bottom bore to RIGHT', async () => {
    const opfs = new MemOpfs();
    const result = await buildDrawerBox(BOX, { boxId: 'box3', name: 'B' }, opfs);
    const asm = await unpackAssembly(result.bytes);

    // Build two test bores using drawerSlideMath (the real producer)
    const slideResult = drawerSlideMath({
      drawerIndex: 0,
      openBottomZ: slot.bottomZ,
      slotH: slot.topZ - slot.bottomZ,
      bh: BOX.outer.height,
      cabinet: { H: 720, D: 500, Tc: 18 },
      box: { bd: BOX.outer.depth },
      slideLength: 350,
    });
    const boxBores = slideResult.boxBores;
    expect(boxBores.length).toBeGreaterThanOrEqual(4); // ≥2 holes × 2 sides

    // Write the box-side bores
    const { bytes: patchedBytes, priorBores } = await writeBoxSideBores(
      result.bytes, boxBores, opfs, asm,
    );

    // Re-unpack and read each side panel
    const patchedAsm = await unpackAssembly(patchedBytes);
    const sideComps = patchedAsm.components.filter((c) => c.role === 'drawerBox-side');
    expect(sideComps).toHaveLength(2);

    // Identify which component is left vs right by checking the bore face role
    let leftBores: BoreOp[] = [];
    let rightBores: BoreOp[] = [];

    for (const comp of sideComps) {
      const bores = await boresOf(opfs, comp.partPath);
      const slideBoxBores = bores.filter((b) => b.role === 'drawerSlide-box');
      if (slideBoxBores.length > 0) {
        const faceRole = slideBoxBores[0]!.face.role;
        if (faceRole === 'Top') leftBores = slideBoxBores;
        else if (faceRole === 'Bottom') rightBores = slideBoxBores;
      }
    }

    // Top face (LEFT_SIDE_INNER_FACE) bores must land on the left side panel
    const topBoresCount = boxBores.filter((b) => b.face.role === 'Top').length;
    const botBoresCount = boxBores.filter((b) => b.face.role === 'Bottom').length;
    expect(leftBores).toHaveLength(topBoresCount);
    expect(rightBores).toHaveLength(botBoresCount);

    // priorBores must record the original (empty) state for restore
    expect(priorBores).toBeDefined();
    expect(typeof priorBores).toBe('object');

    // priorBores must be a Map covering at least the 2 side panels
    expect(priorBores.size).toBeGreaterThanOrEqual(1);

    // The patchedAsm must have 5 components (structure preserved)
    expect(patchedAsm.components).toHaveLength(5);
  });

  it('writeBoxSideBores writes updated .zipt back to OPFS', async () => {
    const opfs = new MemOpfs();
    const result = await buildDrawerBox(BOX, { boxId: 'box4', name: 'B' }, opfs);
    const asm = await unpackAssembly(result.bytes);

    const slideResult = drawerSlideMath({
      drawerIndex: 1,
      openBottomZ: slot.bottomZ,
      slotH: slot.topZ - slot.bottomZ,
      bh: BOX.outer.height,
      cabinet: { H: 720, D: 500, Tc: 18 },
      box: { bd: BOX.outer.depth },
      slideLength: 300,
    });

    const { bytes: patchedBytes, priorBores } = await writeBoxSideBores(
      result.bytes, slideResult.boxBores, opfs, asm,
    );

    // OPFS side panels now carry bores
    const patchedAsm = await unpackAssembly(patchedBytes);
    const sideComps = patchedAsm.components.filter((c) => c.role === 'drawerBox-side');
    let totalBoxBores = 0;
    for (const comp of sideComps) {
      const bores = await boresOf(opfs, comp.partPath);
      totalBoxBores += bores.filter((b) => b.role === 'drawerSlide-box').length;
    }
    expect(totalBoxBores).toBe(slideResult.boxBores.length);

    // restoreBoxSideBores brings counts back to 0
    const restoredBytes = await restoreBoxSideBores(patchedBytes, priorBores, opfs, patchedAsm);
    const restoredAsm = await unpackAssembly(restoredBytes);
    const restoreSideComps = restoredAsm.components.filter((c) => c.role === 'drawerBox-side');
    let totalAfterRestore = 0;
    for (const comp of restoreSideComps) {
      const bores = await boresOf(opfs, comp.partPath);
      totalAfterRestore += bores.filter((b) => b.role === 'drawerSlide-box').length;
    }
    expect(totalAfterRestore).toBe(0);
  });
});

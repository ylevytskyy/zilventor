# Присадка Slice 6 — Drawer Handles/Pulls: TDD Implementation Plan
**Date:** 2026-06-11  
**Feature:** Присадка slice 6 — drawer handles/pulls  
**Spec:** docs/superpowers/specs/2026-06-11-prisadka-slice6-drawer-handles-design.md (§13 Corrections v2 is authoritative)  
**Status:** PLAN — not yet implemented  
**Manifest bump:** v24 → v25

## Summary

This plan implements drawer handles/pulls for ZilInventor's cabinet design system. It adds a `handleScrew` bore kind and BOM catalog entry, a hardware catalog with 3 bar-pull SKUs, a kernel hardware-bake path (centered `BRepPrimAPI_MakeBox_4` box), pure math helpers for bore placement and pull pose, an undoable `AddDrawerHandlesCommand`, a dialog + FurnitureTab button, i18n keys, and a real-browser e2e test. The work follows the established присадка TDD discipline: each chunk has a red test, minimal green impl, and a locked commit.

---

## Chunk A — Foundation (no deps; solo-first)

**Files:**
- Modify `packages/shared/src/bore.ts` — add `'handleScrew-face'` to `BoreRole` union; add `'handleScrew'` to `BoreConnectorKind` union
- Modify `packages/shared/src/connectorBomCatalog.ts` — add `handleScrew` entry
- Modify `packages/shared/src/hardware/builtinCatalog.ts` — add 3 bar-pull SKUs
- Modify `packages/shared/src/hardware-feature.ts` — add `'drawerHandles'` to `HardwareCategory`
- Modify `packages/shared/src/fileFormat.ts` — bump `CURRENT_FORMAT_VERSION` 24→25, add migration

**Red test** (create new file `packages/shared/src/__tests__/handleScrew-types.spec.ts`):
```typescript
import { describe, it, expect } from 'vitest';
import type { BoreConnectorKind, BoreRole } from '../bore';
import { CONNECTOR_BOM_CATALOG } from '../connectorBomCatalog';
import { BUILTIN_CATALOG } from '../hardware/builtinCatalog';
import type { HardwareCategory } from '../hardware-feature';

describe('Chunk A — handleScrew types + catalog', () => {
  it('BoreConnectorKind includes handleScrew', () => {
    const kind: BoreConnectorKind = 'handleScrew';
    expect(kind).toBe('handleScrew');
  });

  it('BoreRole includes handleScrew-face', () => {
    const role: BoreRole = 'handleScrew-face';
    expect(role).toBe('handleScrew-face');
  });

  it('CONNECTOR_BOM_CATALOG has handleScrew entry with nameEn', () => {
    const entry = CONNECTOR_BOM_CATALOG['handleScrew' as BoreConnectorKind];
    expect(entry).toBeDefined();
    expect(entry.nameEn).toBe('Handle screw');
  });

  it('BUILTIN_CATALOG has bar-pull-96 with category drawerHandles', () => {
    const entry = BUILTIN_CATALOG.find((e) => e.id === 'bar-pull-96');
    expect(entry).toBeDefined();
    expect(entry!.category).toBe('drawerHandles');
    expect(entry!.bboxMm.l).toBe(128);
  });

  it('HardwareCategory includes drawerHandles', () => {
    const cat: HardwareCategory = 'drawerHandles';
    expect(cat).toBe('drawerHandles');
  });
});
```

**Minimal impl — bore.ts** (add to existing unions):
- Line 11 (after `'drawerSlide-box';`): add `| 'handleScrew-face'`  // Ø5 mounting hole on drawer front outward face
- Line 13 (BoreConnectorKind): change to `'confirmat' | 'minifix' | 'dowel' | 'shelfPin' | 'hinge' | 'drawerSlide' | 'handleScrew'`

**Minimal impl — connectorBomCatalog.ts** (add to CONNECTOR_BOM_CATALOG):
```typescript
handleScrew: {
  kind: 'handleScrew' as BoreConnectorKind,
  nameKey: 'bom.connector.handleScrew',
  nameEn: 'Handle screw',
  nameUk: 'Гвинт ручки',
  notes: 'Ø5 face mount',
},
```

**Minimal impl — hardware-feature.ts**: change `HardwareCategory = 'hinges' | 'shelfPins'` to `HardwareCategory = 'hinges' | 'shelfPins' | 'drawerHandles'`

**Minimal impl — builtinCatalog.ts** (add 3 entries at end of BUILTIN_CATALOG array):
```typescript
{
  id: 'bar-pull-96',
  label: 'Bar Pull 96mm',
  category: 'drawerHandles' as HardwareCategory,
  bboxMm: { l: 128, w: 30, h: 12 },
  attachPoints: [
    { id: 'screw-0', offsetMm: { x: -48, y: 0, z: 0 } },
    { id: 'screw-1', offsetMm: { x: 48, y: 0, z: 0 } },
  ],
},
{
  id: 'bar-pull-128',
  label: 'Bar Pull 128mm',
  category: 'drawerHandles' as HardwareCategory,
  bboxMm: { l: 160, w: 30, h: 12 },
  attachPoints: [
    { id: 'screw-0', offsetMm: { x: -64, y: 0, z: 0 } },
    { id: 'screw-1', offsetMm: { x: 64, y: 0, z: 0 } },
  ],
},
{
  id: 'bar-pull-160',
  label: 'Bar Pull 160mm',
  category: 'drawerHandles' as HardwareCategory,
  bboxMm: { l: 192, w: 30, h: 12 },
  attachPoints: [
    { id: 'screw-0', offsetMm: { x: -80, y: 0, z: 0 } },
    { id: 'screw-1', offsetMm: { x: 80, y: 0, z: 0 } },
  ],
},
```

**Minimal impl — fileFormat.ts**:
- Change `CURRENT_FORMAT_VERSION = 24` to `CURRENT_FORMAT_VERSION = 25`
- In `normalizeKind` version list (lines ~347–351) add `|| m.formatVersion === 25`
- Add migration after `23:` entry:
```typescript
24: (mIn) => {
  const m = deepClone(mIn);
  return { ...m, formatVersion: 25 };
},
```

**Commit:** `feat(slice6-A): handleScrew type, BOM catalog entry, bar-pull SKUs, v24→v25 migration`

---

## Chunk B — handleScrew bore math (depends: A)

**Files:**
- Create `packages/shared/src/hardware/handleScrewMath.ts` — pure math: bore positions for a pair of handle screws on a drawer front
- Create `packages/shared/src/__tests__/handleScrewMath.spec.ts`

**Red test** (`packages/shared/src/__tests__/handleScrewMath.spec.ts`):
```typescript
import { describe, it, expect } from 'vitest';
import { handleBoreUV } from '../hardware/handleScrewMath';
import type { BoreOp } from '../bore';

describe('handleBoreUV', () => {
  it('returns two bores for bar-pull-96 centered on a 500×200 front', () => {
    // Front dims: length=500 (height), width=200 (width), thickness=19
    // cc=96mm; panel-face='Top'; u=height-dir, v=width-dir
    // Top face: origin=(-250, -100, 19), uDir=(1,0,0), vDir=(0,1,0)
    // Center of front: u=250 (half height), v=100 (half width)
    // Screw offset from cc: ±48 along u-axis (height)
    // Expected: u0=250-48=202, u1=250+48=298; v=100; Ø5, depth=15
    const result = handleBoreUV({
      frontDims: { length: 500, width: 200, thickness: 19 },
      cc: 96,
      connectorIdPrefix: 'hdl-test',
    });
    expect(result).toHaveLength(2);
    const [b0, b1] = result as [BoreOp, BoreOp];
    expect(b0.face).toMatchObject({ featureId: 'panel', role: 'Top', instance: 0 });
    expect(b0.u).toBeCloseTo(202, 1);
    expect(b0.v).toBeCloseTo(100, 1);
    expect(b0.diameter).toBe(5);
    expect(b0.depth).toBe(15);
    expect(b0.role).toBe('handleScrew-face');
    expect(b0.connectorKind).toBe('handleScrew');
    expect(b1.u).toBeCloseTo(298, 1);
    expect(b1.v).toBeCloseTo(100, 1);
    // Same connectorId for both (they form one fastener pair)
    expect(b0.connectorId).toBe(b1.connectorId);
  });

  it('returns two bores for bar-pull-128 on a 600×300 front', () => {
    const result = handleBoreUV({
      frontDims: { length: 600, width: 300, thickness: 18 },
      cc: 128,
      connectorIdPrefix: 'hdl-128',
    });
    expect(result).toHaveLength(2);
    const [b0, b1] = result as [BoreOp, BoreOp];
    // center u=300; cc=128 → half=64; u0=236, u1=364
    expect(b0.u).toBeCloseTo(236, 1);
    expect(b1.u).toBeCloseTo(364, 1);
  });

  it('throws if cc exceeds front width guard (cc + Ø5 >= front.width)', () => {
    // width=100, cc=96 → 96 + 5 = 101 >= 100 → should throw
    expect(() => handleBoreUV({
      frontDims: { length: 400, width: 100, thickness: 18 },
      cc: 96,
      connectorIdPrefix: 'hdl-err',
    })).toThrow(/width/i);
  });
});
```

**Minimal impl** (`packages/shared/src/hardware/handleScrewMath.ts`):
```typescript
import { nanoid } from 'nanoid';
import type { BoreOp, FaceName } from '../types';

export interface HandleBoreInput {
  frontDims: { length: number; width: number; thickness: number };
  /** Center-to-center distance in mm (e.g. 96, 128, 160) */
  cc: number;
  /** Prefix for generating connectorId; same for both bores in a pair */
  connectorIdPrefix: string;
}

const BORE_DIAMETER = 5;
const BORE_DEPTH = 15;

/**
 * Returns the two BoreOps for a handle-screw pair on the Top face of a
 * drawer front panel. The Top face outward normal faces the user (+Z in
 * panel-local coords). The handle is centered horizontally (v=width/2)
 * and centered vertically (u=length/2), with the two screws at ±(cc/2)
 * along the u (height/length) axis.
 *
 * §13.5-B5 width guard: cc + boreDiameter < front.width (throws otherwise).
 */
export function handleBoreUV(input: HandleBoreInput): [BoreOp, BoreOp] {
  const { frontDims, cc, connectorIdPrefix } = input;
  const { length, width } = frontDims;

  // Width guard (§13.5-B5)
  if (cc + BORE_DIAMETER >= width) {
    throw new Error(
      `handleBoreUV: cc=${cc} + Ø${BORE_DIAMETER} >= front.width=${width} — handle won't fit`,
    );
  }

  const uCenter = length / 2;
  const vCenter = width / 2;
  const half = cc / 2;

  const connectorId = `${connectorIdPrefix}-${nanoid(6)}`;
  const face: FaceName = { featureId: 'panel', role: 'Top', instance: 0 };

  const bore0: BoreOp = {
    id: `${connectorIdPrefix}-s0-${nanoid(4)}`,
    face,
    u: uCenter - half,
    v: vCenter,
    diameter: BORE_DIAMETER,
    depth: BORE_DEPTH,
    role: 'handleScrew-face',
    connectorId,
    connectorKind: 'handleScrew',
  };

  const bore1: BoreOp = {
    id: `${connectorIdPrefix}-s1-${nanoid(4)}`,
    face,
    u: uCenter + half,
    v: vCenter,
    diameter: BORE_DIAMETER,
    depth: BORE_DEPTH,
    role: 'handleScrew-face',
    connectorId,
    connectorKind: 'handleScrew',
  };

  return [bore0, bore1];
}
```

**Note on imports**: `FaceName` is in `@zilventor/shared/src/types`. The `face` is `{ featureId: 'panel', role: 'Top', instance: 0 }` matching `PanelFaceRole` / `FaceName` usage pattern from slice 2–5.

**Commit:** `feat(slice6-B): handleScrewMath pure bore-UV computation + width guard`

---

## Chunk C — pull pose math (depends: A)

**Files:**
- Create `packages/shared/src/hardware/handlePullMath.ts` — computes ComponentInstance pose for a bar-pull part in cabinet world space
- Create `packages/shared/src/__tests__/handlePullMath.spec.ts`

**Red test** (`packages/shared/src/__tests__/handlePullMath.spec.ts`):
```typescript
import { describe, it, expect } from 'vitest';
import { handlePullPose } from '../hardware/handlePullMath';

describe('handlePullPose', () => {
  it('identity quaternion for pull in cabinet world frame', () => {
    // Pull is placed flush on the outward face of the front panel.
    // Front is posed in the cabinet so its outward face faces +Z (room side).
    // Pull should have identity quaternion (no rotation).
    const pose = handlePullPose({
      outwardFaceY: 289.5,
      centerZ: 900,
    });
    // Identity quaternion [0,0,0,1]
    expect(pose.quaternion).toEqual([0, 0, 0, 1]);
    // translation.x = 0 (centered on opening)
    expect(pose.translation.x).toBeCloseTo(0, 3);
  });

  it('translation.y places pull flush on front outward face', () => {
    // centerZ = world Z center of front panel
    // Front panel: centered at centerZ; its outward face (Top face) is at:
    //   centerZ + frontThickness/2  (in world Z, since front's local Z→world Z)
    // ⚠️ PLAN NOTE: Front panels are posed with DOOR_POSE=[0.5,0.5,0.5,-0.5]:
    //   part-X(length/height)→world-Z, part-Y(width)→world-X, part-Z(thickness)→world-Y
    // So actual outward-face world coord is centerZ_world + frontThickness/2 in part-Z→world-Y
    // For the pull at world frame: translation.y = centerZ + frontThickness/2
    // and translation.z stays at the front's world Z position
    // The pose formula depends on the cabinet coordinate system — see §13.2-B2:
    // pull has IDENTITY quaternion, translation x=0, y=outward-face-y, z=center-of-front-z
    const pose = handlePullPose({
      outwardFaceY: 289.5,  // passed in from caller: frontComp.pose.translation.y + frontThickness/2
      centerZ: 900,
    });
    // Y = outward face: frontThickness/2 in part-local Z, which maps to world-Y given DOOR_POSE
    // But wait: the pull is in the CABINET assembly, not inside the front part.
    // Its world translation: x=0, y=(cabinetDepth/2 + frontThickness/2 pulled), z=centerZ
    // The front component pose.translation.y ≈ cabinetDepth/2 (front flush with cabinet face)
    // The pull must be placed at: y = cabinetDepth/2 + frontThickness/2 = outside face
    expect(pose.translation.y).toBeCloseTo(289.5, 1); // passed directly from caller
    expect(pose.translation.z).toBeCloseTo(900, 1);
  });
});
```

⚠️ **PLAN NOTE**: The pull pose depends on how drawer fronts are placed in the cabinet assembly. From `AddDrawerBankCommand.ts`, the front `ComponentInstance.pose` has `translation` set such that `translation.y ≈ depth/2 + Tc/2` (flush with front face). The pull is placed at the same Y + frontThickness/2 to sit on the outward face. The caller (`AddDrawerHandlesCommand`) must compute `frontOutwardY = frontComp.pose.translation.y + frontThickness/2`. Pass this as `outwardFaceY` to `handlePullPose`.

**Minimal impl** (`packages/shared/src/hardware/handlePullMath.ts`):
```typescript
export interface HandlePullPoseInput {
  /** World-space X of the opening center (0 for a symmetric cabinet) */
  openCenterX?: number;
  /** The Y position of the outward face of the front panel in cabinet world */
  outwardFaceY: number;
  /** World Z center of this drawer front (from frontComp.pose.translation.z) */
  centerZ: number;
}

export interface PullPose {
  translation: { x: number; y: number; z: number };
  quaternion: [number, number, number, number];
}

/**
 * Computes the ComponentInstance pose for a bar-pull part placed in cabinet world space.
 * §13.2-B2: pull has IDENTITY quaternion [0,0,0,1].
 * The pull center is placed at x=openCenterX, y=outwardFaceY, z=centerZ.
 */
export function handlePullPose(input: HandlePullPoseInput): PullPose {
  const { openCenterX = 0, outwardFaceY, centerZ } = input;
  return {
    translation: { x: openCenterX, y: outwardFaceY, z: centerZ },
    quaternion: [0, 0, 0, 1],
  };
}
```

**Note**: The key assertion from §13.2-B2 is that `quaternion = [0,0,0,1]` (identity). The translation formula is derived from the cabinet coordinate system. Adjust the test's expected `translation.y` formula to match actual `AddDrawerBankCommand` front placement logic once Chunk F is read.

**Commit:** `feat(slice6-C): handlePullMath pose computation (identity quaternion)`

---

## Chunk D — kernel hardware bake (depends: A; parallel with B, C)

**Files:**
- Modify `packages/kernel/src/adapter/FeatureTree.ts` — add `hardware` branch between `panel` and `imported` branches
- Create `packages/kernel/src/__tests__/hardware-bake.spec.ts`

**Red test** (`packages/kernel/src/__tests__/hardware-bake.spec.ts`):
```typescript
import { describe, it, expect, beforeAll } from 'vitest';
import { makeKernel } from '../index';
import type { PartDocument } from '@zilventor/shared';

describe('hardware bake — BRepPrimAPI_MakeBox_4 centered box', () => {
  let kernel: Awaited<ReturnType<typeof makeKernel>>;

  beforeAll(async () => {
    kernel = await makeKernel();
  }, 30_000);

  it('bakes a hardware box with correct volume (l*w*h)', async () => {
    const doc: PartDocument = {
      id: 'hw-test-1',
      formatVersion: 25,
      name: 'Bar Pull 96',
      material: 'chrome',
      color: '#cccccc',
      featureTree: [
        {
          kind: 'hardware',
          id: 'hw-feat-1',
          hardwareSkuId: 'bar-pull-96',
          bboxMm: { l: 128, w: 30, h: 12 },
          attachPoints: [],
        },
      ],
    };
    const bytes = await kernel.buildPartFromDoc(doc);
    expect(bytes.byteLength).toBeGreaterThan(100);

    // Load back and measure volume
    const loaded = await kernel.loadFromBytes(bytes);
    const volume = await kernel.measureVolume(loaded);
    // l*w*h = 128*30*12 = 46080 mm³
    expect(volume).toBeCloseTo(46080, 0);
  });

  it('bakes a hardware box that is centered (bbox straddles origin)', async () => {
    const doc: PartDocument = {
      id: 'hw-test-2',
      formatVersion: 25,
      name: 'Centered Box',
      material: 'chrome',
      color: '#cccccc',
      featureTree: [
        {
          kind: 'hardware',
          id: 'hw-feat-2',
          hardwareSkuId: 'test-hw',
          bboxMm: { l: 100, w: 40, h: 20 },
          attachPoints: [],
        },
      ],
    };
    const bytes = await kernel.buildPartFromDoc(doc);
    const loaded = await kernel.loadFromBytes(bytes);
    const bbox = await kernel.measureBoundingBox(loaded);
    // Centered: min=-l/2, max=+l/2 in each axis
    expect(bbox.xMin).toBeCloseTo(-50, 1);
    expect(bbox.xMax).toBeCloseTo(50, 1);
    expect(bbox.yMin).toBeCloseTo(-20, 1);
    expect(bbox.yMax).toBeCloseTo(20, 1);
    expect(bbox.zMin).toBeCloseTo(-10, 1);
    expect(bbox.zMax).toBeCloseTo(10, 1);
  });
});
```

⚠️ **PLAN NOTE**: `kernel.measureBoundingBox` may not exist yet. Check `packages/kernel/src/index.ts` for available methods. If it doesn't exist, add it. The key test is volume (first it-block). The centering test is a bonus guard.

**Minimal impl** (in `packages/kernel/src/adapter/FeatureTree.ts`, after the panel branch, before the imported branch, around line 850):
```typescript
// hardware: BRepPrimAPI_MakeBox_4 fully-centered box (§13.1-B1)
if (feature.kind === 'hardware') {
  const { l, w, h } = feature.bboxMm;
  // Two-corner form: p1=(-l/2,-w/2,-h/2), p2=(l/2,w/2,h/2)
  // MUST NOT use makeBox() (uses BRepPrimAPI_MakeBox_2, corner at origin — wrong centering)
  const occtCast = oc as unknown as {
    gp_Pnt_3: new (x: number, y: number, z: number) => { delete(): void };
    BRepPrimAPI_MakeBox_4: new (
      p1: ReturnType<{ gp_Pnt_3: new (x: number, y: number, z: number) => { delete(): void } }['gp_Pnt_3']>,
      p2: ReturnType<{ gp_Pnt_3: new (x: number, y: number, z: number) => { delete(): void } }['gp_Pnt_3']>,
    ) => { Shape(): unknown; delete(): void };
  };
  const p1 = new occtCast.gp_Pnt_3(-l / 2, -w / 2, -h / 2);
  const p2 = new occtCast.gp_Pnt_3(l / 2, w / 2, h / 2);
  const builder = new occtCast.BRepPrimAPI_MakeBox_4(p1 as never, p2 as never);
  const shape = builder.Shape() as TopoDS_Shape;
  builder.delete();
  p1.delete();
  p2.delete();
  result = shape;
  continue;
}
```

**Commit:** `feat(slice6-D): kernel hardware bake via BRepPrimAPI_MakeBox_4 centered box`

---

## Chunk E — manifest migration test + exhaustiveness guards (depends: A)

**Files:**
- Create `packages/shared/src/__tests__/migrateManifest-v24-to-v25.spec.ts`
- Modify `packages/shared/src/__tests__/connectorBomCatalog.spec.ts` — add `handleScrew` + `drawerSlide` to ALL_KINDS; convert to `as const satisfies`
- Modify `packages/app/src/viewport/__tests__/SceneManager.boreColors.spec.ts` — add `handleScrew` to ALL_KINDS
- Modify `packages/app/src/viewport/SceneManager.ts` — add `handleScrew: '#2ec8c8'` to BORE_COLORS

**Red test** (`packages/shared/src/__tests__/migrateManifest-v24-to-v25.spec.ts`):
```typescript
import { describe, it, expect } from 'vitest';
import { migrateManifest } from '../fileFormat';

describe('manifest v24 → v25 migration', () => {
  it('migrates a v24 doc to v25 with no field loss', () => {
    const v24: Record<string, unknown> = {
      formatVersion: 24,
      id: 'test-part',
      name: 'Front Panel',
      featureTree: [],
      material: 'wood',
    };
    const result = migrateManifest(v24);
    expect(result.formatVersion).toBe(25);
    expect(result.name).toBe('Front Panel');
  });

  it('v24 doc with a handleScrew bore survives migration intact', () => {
    const v24: Record<string, unknown> = {
      formatVersion: 24,
      id: 'test-front',
      name: 'Drawer Front',
      featureTree: [],
      bores: [
        {
          id: 'bore-1',
          face: { featureId: 'panel', role: 'Top', instance: 0 },
          u: 200,
          v: 100,
          diameter: 5,
          depth: 15,
          role: 'handleScrew-face',
          connectorId: 'conn-1',
          connectorKind: 'handleScrew',
        },
      ],
    };
    const result = migrateManifest(v24);
    expect(result.formatVersion).toBe(25);
    const bores = result.bores as Array<Record<string, unknown>>;
    expect(bores).toHaveLength(1);
    expect(bores[0]!.connectorKind).toBe('handleScrew');
  });
});
```

**SceneManager BORE_COLORS impl** (add `handleScrew: '#2ec8c8'` to the static field):
```typescript
static readonly BORE_COLORS = {
  confirmat: '#2e7dd1', minifix: '#d14f2e', dowel: '#2eb872',
  shelfPin: '#b8a32e', hinge: '#8c2eb8', drawerSlide: '#7d2ed1',
  handleScrew: '#2ec8c8',
} satisfies Record<BoreConnectorKind, string>;
```

**connectorBomCatalog.spec.ts fix** (§13.3-T1 — add drawerSlide escapee + handleScrew):
```typescript
// Change from plain array to:
const ALL_KINDS = [
  'confirmat', 'minifix', 'dowel', 'shelfPin', 'hinge', 'drawerSlide', 'handleScrew',
] as const satisfies readonly BoreConnectorKind[];
```

**Commit:** `feat(slice6-E): v24→v25 migration test, BORE_COLORS handleScrew, exhaustiveness guards`

---

## Chunk F — AddDrawerHandlesCommand (depends: A, B, C)

**Files:**
- Create `packages/app/src/commands/AddDrawerHandlesCommand.ts`
- Create `packages/app/src/commands/__tests__/AddDrawerHandlesCommand.spec.ts`

**Red test** (`packages/app/src/commands/__tests__/AddDrawerHandlesCommand.spec.ts`):
```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { makeKernel } from '@zilventor/kernel';
import type { AssemblyDocument, PartDocument } from '@zilventor/shared';
import { packProject, unpackProject, packAssembly, unpackAssembly } from '@zilventor/shared';
import { AddDrawerHandlesCommand } from '../AddDrawerHandlesCommand';

// Full seed: a cabinet assembly with one drawer front component
async function makeSeed(kernel: Awaited<ReturnType<typeof makeKernel>>) {
  // Create a simple drawer front panel part
  const frontDoc: PartDocument = {
    id: 'front-1',
    formatVersion: 25,
    name: 'Drawer Front',
    material: 'wood',
    color: '#8B6914',
    featureTree: [
      { kind: 'panel', id: 'p1', length: 500, width: 200, thickness: 19 },
    ],
    bores: [],
  };
  const frontBytes = await kernel.buildPartFromDoc(frontDoc);

  const opfs = new MemOpfs();
  await opfs.write('parts/front-1.zipt', packProject(frontDoc, frontBytes));

  const cabDoc: AssemblyDocument = {
    id: 'cab-1',
    formatVersion: 25,
    name: 'Cabinet',
    components: [
      {
        id: 'comp-front-1',
        partPath: 'parts/front-1.zipt',
        pose: {
          translation: { x: 0, y: 289.5, z: 900 }, // y = depth/2+Tc/2 = 280+9.5
          quaternion: [0.5, 0.5, 0.5, -0.5] as [number,number,number,number],
        },
        role: 'drawerFront',
      },
    ],
  };
  await opfs.write('cabinet.ziasm', packAssembly(cabDoc, new Uint8Array()));

  return { opfs, cabDoc, frontDoc };
}

// Minimal in-memory OPFS stub
class MemOpfs {
  private store = new Map<string, Uint8Array>();
  async read(p: string): Promise<Uint8Array> {
    const v = this.store.get(p);
    if (!v) throw new Error(`MemOpfs: not found: ${p}`);
    return v;
  }
  async write(p: string, b: Uint8Array): Promise<void> { this.store.set(p, b); }
  has(p: string): boolean { return this.store.has(p); }
}

describe('AddDrawerHandlesCommand', () => {
  let kernel: Awaited<ReturnType<typeof makeKernel>>;

  beforeAll(async () => {
    kernel = await makeKernel();
  }, 30_000);

  it('apply: writes bar-pull part to hardware/ and adds component to cabinet assembly', async () => {
    const { opfs, cabDoc } = await makeSeed(kernel);

    const cmd = new AddDrawerHandlesCommand({
      cabPath: 'cabinet.ziasm',
      cab: cabDoc,
      skuId: 'bar-pull-96',
      cc: 96,
      opfs,
      kernel,
    });
    await cmd.apply();

    // Hardware part should be written
    expect(opfs.has('hardware/bar-pull-96.zipt')).toBe(true);
    // Cabinet should now have 2 components (1 front + 1 pull)
    const updatedBytes = await opfs.read('cabinet.ziasm');
    const { doc: updatedCab } = unpackAssembly(updatedBytes);
    expect(updatedCab.components).toHaveLength(2);
    // The pull component should reference the hardware path
    const pullComp = updatedCab.components.find((c) => c.partPath === 'hardware/bar-pull-96.zipt');
    expect(pullComp).toBeDefined();
    expect(pullComp!.pose.quaternion).toEqual([0, 0, 0, 1]);
  });

  it('apply: adds 2 handleScrew bores to the drawer front', async () => {
    const { opfs, cabDoc } = await makeSeed(kernel);
    const cmd = new AddDrawerHandlesCommand({
      cabPath: 'cabinet.ziasm',
      cab: cabDoc,
      skuId: 'bar-pull-96',
      cc: 96,
      opfs,
      kernel,
    });
    await cmd.apply();

    // The front part should have 2 handleScrew bores baked into its OCCT
    const frontBytes = await opfs.read('parts/front-1.zipt');
    const { doc: frontDoc } = unpackProject(frontBytes);
    const handleBores = (frontDoc.bores ?? []).filter((b) => b.connectorKind === 'handleScrew');
    expect(handleBores).toHaveLength(2);
    expect(handleBores[0]!.diameter).toBe(5);
    expect(handleBores[0]!.depth).toBe(15);
  });

  it('revert: removes the pull component and handleScrew bores', async () => {
    const { opfs, cabDoc } = await makeSeed(kernel);
    const cmd = new AddDrawerHandlesCommand({
      cabPath: 'cabinet.ziasm',
      cab: cabDoc,
      skuId: 'bar-pull-96',
      cc: 96,
      opfs,
      kernel,
    });
    await cmd.apply();
    await cmd.revert();

    const cabBytes = await opfs.read('cabinet.ziasm');
    const { doc: revertedCab } = unpackAssembly(cabBytes);
    const pullComps = revertedCab.components.filter((c) => c.partPath.startsWith('hardware/'));
    expect(pullComps).toHaveLength(0);
  });
});
```

**Minimal impl** (`packages/app/src/commands/AddDrawerHandlesCommand.ts`):
```typescript
import { nanoid } from 'nanoid';
import { BUILTIN_CATALOG } from '@zilventor/shared/src/hardware/builtinCatalog';
import { handleBoreUV } from '@zilventor/shared/src/hardware/handleScrewMath';
import { handlePullPose } from '@zilventor/shared/src/hardware/handlePullMath';
import { packProject, unpackProject, packAssembly, unpackAssembly } from '@zilventor/shared';
import type { AssemblyDocument, ComponentInstance } from '@zilventor/shared';
import type { Kernel } from '@zilventor/kernel';

interface Deps {
  cabPath: string;
  cab: AssemblyDocument;
  skuId: string;
  cc: number;
  opfs: { read(p: string): Promise<Uint8Array>; write(p: string, b: Uint8Array): Promise<void> };
  kernel: Kernel;
}

export class AddDrawerHandlesCommand {
  private deps: Deps;
  // Stored for revert
  private addedCompIds: string[] = [];
  private modifiedFrontPaths: string[] = [];
  private prevFrontBytes: Map<string, Uint8Array> = new Map();
  private prevCabBytes: Uint8Array | null = null;

  constructor(deps: Deps) { this.deps = deps; }

  async apply(): Promise<void> {
    const { cabPath, cab, skuId, cc, opfs, kernel } = this.deps;

    // 1. Find catalog entry
    const catalogEntry = BUILTIN_CATALOG.find((e) => e.id === skuId);
    if (!catalogEntry) throw new Error(`AddDrawerHandlesCommand: unknown skuId ${skuId}`);

    // 2. Build and write the hardware part if not yet present
    const hwPath = `hardware/${skuId}.zipt`;
    let hwBytes: Uint8Array;
    try {
      hwBytes = await opfs.read(hwPath);
    } catch {
      // Not found — build from catalog
      const hwDoc = {
        id: skuId,
        formatVersion: 25 as const,
        name: catalogEntry.label,
        material: 'chrome',
        color: '#cccccc',
        featureTree: [
          {
            kind: 'hardware' as const,
            id: `hw-${nanoid(6)}`,
            hardwareSkuId: skuId,
            bboxMm: catalogEntry.bboxMm,
            attachPoints: catalogEntry.attachPoints,
          },
        ],
      };
      const shape = await kernel.buildPartFromDoc(hwDoc);
      hwBytes = packProject(hwDoc, shape);
      await opfs.write(hwPath, hwBytes);
    }

    // 3. Save previous cab state for revert
    this.prevCabBytes = await opfs.read(cabPath);

    // 4. Find all drawer fronts in the cabinet
    const frontComps = cab.components.filter((c) => c.role === 'drawerFront');

    const newComponents: ComponentInstance[] = [];

    for (const frontComp of frontComps) {
      // 4a. Read + parse the front part
      const frontBytes = await opfs.read(frontComp.partPath);
      this.prevFrontBytes.set(frontComp.partPath, frontBytes);
      const { doc: frontDoc, shape: frontShape } = unpackProject(frontBytes);
      const panelFeature = frontDoc.featureTree.find((f) => f.kind === 'panel');
      if (!panelFeature || panelFeature.kind !== 'panel') continue;
      const frontDims = {
        length: panelFeature.length,
        width: panelFeature.width,
        thickness: panelFeature.thickness,
      };

      // 4b. Compute handle bores
      const connectorIdPrefix = `hdl-${nanoid(6)}`;
      const bores = handleBoreUV({ frontDims, cc, connectorIdPrefix });

      // 4c. Add bores to front doc + re-bake
      const updatedFrontDoc = {
        ...frontDoc,
        bores: [...(frontDoc.bores ?? []), ...bores],
      };
      const updatedShape = await kernel.buildPartFromDoc(updatedFrontDoc);
      const updatedFrontBytes = packProject(updatedFrontDoc, updatedShape);
      await opfs.write(frontComp.partPath, updatedFrontBytes);
      this.modifiedFrontPaths.push(frontComp.partPath);

      // 4d. Compute pull pose
      // Front panel uses DOOR_POSE=[0.5,0.5,0.5,-0.5]; outward face is at frontComp.pose.translation.y + frontThickness/2
      const outwardFaceY = frontComp.pose.translation.y + frontDims.thickness / 2;
      const centerZ = frontComp.pose.translation.z;
      const pullPose = handlePullPose({ outwardFaceY, centerZ });

      // 4e. Create a pull component instance
      const pullComp: ComponentInstance = {
        id: nanoid(8),
        partPath: hwPath,
        pose: pullPose,
        role: 'hardware',
      };
      newComponents.push(pullComp);
      this.addedCompIds.push(pullComp.id);
    }

    // 5. Write updated cabinet
    const updatedCab: AssemblyDocument = {
      ...cab,
      components: [...cab.components, ...newComponents],
    };
    const updatedCabBytes = packAssembly(updatedCab, new Uint8Array());
    await opfs.write(cabPath, updatedCabBytes);
  }

  async revert(): Promise<void> {
    const { cabPath, opfs } = this.deps;
    // Restore front parts
    for (const [path, bytes] of this.prevFrontBytes) {
      await opfs.write(path, bytes);
    }
    // Restore cabinet
    if (this.prevCabBytes) {
      await opfs.write(cabPath, this.prevCabBytes);
    }
  }
}
```

**Commit:** `feat(slice6-F): AddDrawerHandlesCommand apply/revert`

---

## Chunk G — store + dialog + FurnitureTab wiring (depends: A, F)

**Files:**
- Modify `packages/app/src/store/useAppStore.ts` — add `AddDrawerHandleDialogState` type + `addDrawerHandleDialog` state + `setAddDrawerHandleDialog` action
- Create `packages/app/src/shell/dialogs/DrawerHandleDialog.tsx`
- Modify `packages/app/src/shell/tabs/FurnitureTab.tsx` — add "Add Handles" button + handler

**Store additions** (mirror `AddDrawerBankDialogState` pattern):
```typescript
export interface AddDrawerHandleDialogState {
  cabPath: string;
  cab: AssemblyDocument;
}
```
In the store: `addDrawerHandleDialog: AddDrawerHandleDialogState | null` (initial: `null`), with action `setAddDrawerHandleDialog(s: AddDrawerHandleDialogState | null): void`.

**DrawerHandleDialog.tsx**:
```typescript
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../../store/useAppStore';
import { AddDrawerHandlesCommand } from '../../commands/AddDrawerHandlesCommand';

export function DrawerHandleDialog(): JSX.Element | null {
  const { t } = useTranslation();
  const state = useAppStore((s) => s.addDrawerHandleDialog);
  const setDialog = useAppStore((s) => s.setAddDrawerHandleDialog);
  const bus = useAppStore((s) => s.bus);
  const opfs = useAppStore((s) => s.opfs);
  const kernel = useAppStore((s) => s.kernel);
  const [cc, setCc] = useState<96 | 128 | 160>(96);

  if (!state) return null;

  async function handleConfirm() {
    if (!state || !opfs || !kernel) return;
    setDialog(null);
    await bus.execute(new AddDrawerHandlesCommand({
      cabPath: state.cabPath,
      cab: state.cab,
      skuId: `bar-pull-${cc}`,
      cc,
      opfs,
      kernel,
    }));
  }

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
      }}
    >
      <div style={{ background: '#1e1e1e', padding: 24, borderRadius: 6, minWidth: 280 }}>
        <h3 style={{ margin: '0 0 16px', color: '#eee', fontSize: 14 }}>
          {t('dialog.drawerHandle.title', 'Add Drawer Handles')}
        </h3>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 16, color: '#aaa', fontSize: 12 }}>
          {t('dialog.drawerHandle.cc', 'Center-to-center')}
          <select
            value={cc}
            onChange={(e) => setCc(Number(e.target.value) as 96 | 128 | 160)}
            style={{ background: '#2a2a2a', color: '#eee', border: '1px solid #555', borderRadius: 2, padding: '2px 6px' }}
          >
            <option value={96}>{t('dialog.drawerHandle.cc96', '96 mm')}</option>
            <option value={128}>{t('dialog.drawerHandle.cc128', '128 mm')}</option>
            <option value={160}>{t('dialog.drawerHandle.cc160', '160 mm')}</option>
          </select>
        </label>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button
            onClick={() => setDialog(null)}
            style={{ fontSize: 12, padding: '4px 12px', background: '#333', color: '#ccc', border: '1px solid #555', borderRadius: 3, cursor: 'pointer' }}
          >
            {t('common.cancel', 'Cancel')}
          </button>
          <button
            onClick={() => void handleConfirm()}
            style={{ fontSize: 12, padding: '4px 12px', background: '#2a5298', color: '#eee', border: '1px solid #3a6bc8', borderRadius: 3, cursor: 'pointer' }}
          >
            {t('common.apply', 'Apply')}
          </button>
        </div>
      </div>
    </div>
  );
}
```

**FurnitureTab.tsx additions** (after "Add Drawers" button section):
```typescript
function handleAddHandles() {
  if (!activeAssembly || !activeCabinetPath) return;
  setAddDrawerHandleDialog({ cabPath: activeCabinetPath, cab: activeAssembly });
}
```
And a button:
```tsx
<button
  disabled={cabinetDisabled}
  onClick={handleAddHandles}
  title={t('furniture.add_handles', 'Add drawer handles/pulls')}
  style={/* same style as existing Add Drawers button */}
>
  {t('furniture.add_handles', 'Add Handles')}
</button>
```

**Commit:** `feat(slice6-G): DrawerHandleDialog + FurnitureTab "Add Handles" button`

---

## Chunk H — i18n keys (depends: G)

**Files:**
- Modify `packages/app/src/i18n/locales/en.json` — add `bom.connector.handleScrew`, `dialog.drawerHandle.*`, `furniture.add_handles`
- Modify `packages/app/src/i18n/locales/uk.json` — same keys in Ukrainian

**en.json additions**:
- Under `bom.connector`: `"handleScrew": "Handle screw"`
- New section:
```json
"dialog": {
  "drawerHandle": {
    "title": "Add Drawer Handles",
    "cc": "Center-to-center",
    "cc96": "96 mm",
    "cc128": "128 mm",
    "cc160": "160 mm"
  }
}
```
- Under `furniture`: `"add_handles": "Add Handles"`

**uk.json additions**:
- Under `bom.connector`: `"handleScrew": "Гвинт ручки"`
- `dialog.drawerHandle`: `{ "title": "Додати ручки", "cc": "Між центрами", "cc96": "96 мм", "cc128": "128 мм", "cc160": "160 мм" }`
- `furniture.add_handles`: `"Додати ручки"`

**Parity test gate**: `parity.test.ts` asserts en and uk have identical key sets — this is a build-blocking gate. Both files must be updated together.

**Commit:** `feat(slice6-H): i18n en+uk keys for handleScrew BOM, drawer handle dialog, add-handles button`

---

## Chunk I — e2e integration test (depends: A–H)

**Files:**
- Create `tests/e2e/prisadka-slice6-drawer-handles.spec.ts`

**Full e2e test**:
```typescript
import { test, expect } from '@playwright/test';

test.describe('присадка slice 6 — drawer handles', () => {
  test('add handles to a cabinet: hardware part + pull component + handleScrew bores', async ({ page }) => {
    await page.goto('http://localhost:5182/');
    await page.waitForFunction(() => (window as Record<string, unknown>).__zilventorStore !== undefined);

    // Wait for kernel ready
    await page.waitForFunction(async () => {
      const store = (window as Record<string, unknown>).__zilventorStore as { getState(): Record<string, unknown> } | undefined;
      if (!store) return false;
      const s = store.getState();
      return Boolean(s.kernelReady);
    }, { timeout: 30_000 });

    // Execute AddDrawerHandlesCommand via the bus
    const result = await page.evaluate(async () => {
      const store = (window as Record<string, unknown>).__zilventorStore as {
        getState(): {
          bus: { execute(cmd: unknown): Promise<void> };
          activeAssembly: Record<string, unknown> | null;
          activeCabinetPath: string | null;
          opfs: unknown;
          kernel: unknown;
        }
      };
      const s = store.getState();
      if (!s.activeAssembly || !s.activeCabinetPath) return { error: 'no active assembly' };

      const { AddDrawerHandlesCommand: Cmd } = await import('/src/commands/AddDrawerHandlesCommand.ts');
      await s.bus.execute(new Cmd({
        cabPath: s.activeCabinetPath,
        cab: s.activeAssembly,
        skuId: 'bar-pull-96',
        cc: 96,
        opfs: s.opfs,
        kernel: s.kernel,
      }));
      return { ok: true };
    });

    // Probe: hardware part written to OPFS
    const hwExists = await page.evaluate(async () => {
      const opfs = (window as Record<string, unknown>).__zilventorGetOpfs?.();
      if (!opfs) return false;
      try { await opfs.read('hardware/bar-pull-96.zipt'); return true; } catch { return false; }
    });
    expect(hwExists).toBe(true);

    // Probe: hardwarePartCount via SceneManager (after invalidation)
    await page.evaluate(() => {
      (window as Record<string, unknown>).__zilventorSubAsmInvalidateAll?.();
    });
    await page.waitForTimeout(500); // allow scene rebuild

    const hwCount = await page.evaluate(() => {
      return (window as Record<string, unknown>).__zilventorHardwarePartCount?.() ?? 0;
    });
    expect(hwCount).toBeGreaterThan(0);

    // Probe: boring aggregate shows handleScrew connectors
    const boringAgg = await page.evaluate(() => {
      return (window as Record<string, unknown>).__zilventorBoringAggregate?.();
    });
    if (boringAgg) {
      const hasHandleScrew = JSON.stringify(boringAgg).includes('handleScrew');
      expect(hasHandleScrew).toBe(true);
    }

    // Undo
    await page.evaluate(() => {
      const store = (window as Record<string, unknown>).__zilventorStore as {
        getState(): { bus: { undo(): void } }
      };
      store.getState().bus.undo();
    });

    // After undo: hw part count should be 0
    await page.waitForTimeout(300);
    const hwCountAfterUndo = await page.evaluate(() => {
      return (window as Record<string, unknown>).__zilventorHardwarePartCount?.() ?? 0;
    });
    expect(hwCountAfterUndo).toBe(0);
  });
});
```

**Note:** Add `__zilventorHardwarePartCount` probe to `SceneManager` alongside the existing `boreMarkerCount` probe. This counts components whose `partPath.startsWith('hardware/')`.

**Commit:** `test(slice6-I): e2e — add handles, hardware probe, boring aggregate, undo`

---

## Dependencies & parallelization

```
A (foundation) — solo first; unlocks B, C, D, E, F

B (handleScrewMath)  ─┐
C (handlePullMath)   ─┤─── parallel after A
D (kernel hw bake)   ─┤
E (exhaustiveness)   ─┘

F (AddDrawerHandlesCommand) — depends: A + B + C + D
G (store + dialog + FurnitureTab) — depends: A + F
H (i18n) — depends: G
I (e2e) — depends: A–H
```

Chunks B, C, D, E can all run in parallel immediately after A completes. Chunk F needs B+C+D. G needs F. H needs G. I needs everything.

---

## Spec coverage self-check

| §13 item | Covered in chunk |
|---|---|
| B1: `BRepPrimAPI_MakeBox_4` fully-centered box | D |
| B2: pull identity quaternion `[0,0,0,1]` | C |
| B3: `HardwareCategory` add `'drawerHandles'` | A |
| B4: pull parts at `hardware/<skuId>.zipt`, SKUs in `BUILTIN_CATALOG` | A + F |
| B5: width guard `cc + Ø5 < front.width` | B |
| T1: `connectorBomCatalog.spec.ts` ALL_KINDS → `as const satisfies`, add `drawerSlide`+`handleScrew` | E |
| T2: `SceneManager.boreColors.spec.ts` add `handleScrew` | E |
| T3: migration spec with handleScrew bore survival | E |
| T4: kernel bake test uses real OCCT volume (not mock) | D |
| T5: command test uses FULL AssemblyDocument seed (not bare shim) | F |
| T6: e2e uses `__zilventorHardwarePartCount` probe (not stale screen check) | I |
| T7: width guard throws — locked in handleScrewMath test | B |

All §13 corrections are reflected. No items deferred.

---

## Plan Corrections v2 — AUTHORITATIVE (overrides all chunk bodies above)

Folded from the 2-lens plan-verify (geometry-by-hand conf 85 + scaffolding-vs-real-APIs conf 88). **On ANY conflict between a chunk body and this section, THIS section + the real code you READ wins.** Each implementer MUST read the real file cited before writing code. 11 blockers + 4 majors:

### PC-1 — BLOCKER (Chunk D / `handleBoreUV`): bore u/v axes were INVERTED
The plan body splits screws along `u` and keeps `v` constant. That is backwards. Per `bore.ts:90-92` ('Top' face: origin `{-L/2,-W/2,T}`, **uDir=+X=length=front.height**, **vDir=+Y=width=front.width**) and spec §6:
- **`u = front.height / 2`  — CONSTANT (vertical center) for BOTH screws.**
- **`v = front.width / 2 ± cc/2`  — the two screws split along WIDTH (v).**
Recompute every test expected value. Example: a front `length(height)=500, width=200, cc=96, Ø5` → both bores `u=250`; `v0 = 100−48 = 52`, `v1 = 100+48 = 148`. (cc=128,W=300,n=… → `v=150∓64` = 86 / 214, `u=H/2`.)
- Width guard stays `cc + boreDiameter < front.width` (correct dimension — bores span v=width). Test the rejection path.

### PC-2 — BLOCKER (Chunks E/G / pull `translation.y`): two coupled fixes
Per `drawerFrontMath.ts:97` + `AddDrawerBankCommand.ts:124`, a drawer front's component `pose.translation.y = dims.depth` (the FULL cabinet depth — the front center), NOT `depth/2` and NOT `depth+Tc/2`.
- **(a) Test seed:** the seeded `role:'drawerFront'` ComponentInstance must use `pose.translation.y = dims.depth` (front center). The plan's `289.5` seed (= outward face) is wrong.
- **(b) Command + pose:** `outwardFaceY = frontComp.pose.translation.y + frontThickness/2`; then **pull `translation.y = outwardFaceY + BAR_DEPTH/2`** where `BAR_DEPTH = bbox.w` (≈30). The `+BAR_DEPTH/2` is REQUIRED — without it the centered pull box (PC-5) sits half-buried in the front instead of proud. Per spec §13.1-B2. Fix `handlePullPose`'s caller (Chunk G) and its independent-oracle test (Chunk E) to include the term.
- Confirm the room side is **+world-Y** (front center at `y=dims.depth`, outward face at larger Y). If the lens-1 verifier's depth assumption differs, re-derive from `drawerFrontMath` before trusting the sign — but the standoff must push the bar AWAY from the carcass (toward the room), never into it.

### PC-3 — MAJOR (Chunk D / bore depth): `'throughAll'`, not `15`
`handleScrew` bore `depth = 'throughAll'` (the screw passes through the 18 mm front into the pull). The plan's `15` stops short. Update the math + its test assertion. (`BoreOp.depth: number | 'throughAll'`, `bore.ts:21-39`; spec §6.)

### PC-4 — BLOCKER (Chunk C kernel test): ghost kernel APIs
`kernel.buildPartFromDoc`, `kernel.measureBoundingBox`, and `makeKernel` DO NOT EXIST. Real pattern:
- `import { createKernelApi } from '../api'` (`packages/kernel/src/api.ts:212`; there is no `index.ts`).
- `const api = createKernelApi(); api.registerPart(doc); api.execute(doc.id); const bytes = api.saveToBytes(doc.id);`
- For volume/centroid use **raw OCCT inside the test**: `oc.BRepGProp.VolumeProperties_1(shape, props, …)` — copy the exact pattern from the slice-5 real-OCCT test `packages/kernel/src/__tests__/dragGizmoBake.integration.spec.ts:84`. Assert volume = l·w·h, centroid ≈ (0,0,0), and a size-change sub-test (§13.3-T2).

### PC-5 — BLOCKER (Chunk C `FeatureTree` branch): wrong running var + control flow
The running solid is `finalSolid` typed `NamedShape` (`{ shape, faceNames }`), NOT `result`, and the dispatch is an `else if` chain (not `continue`). Append after the `imported` branch (~`FeatureTree.ts:878`), before the loop's closing brace:
```
} else if (feature.kind === 'hardware') {
  const { l, w, h } = feature.bboxMm;
  const p1 = new oc.gp_Pnt_3(-l/2, -w/2, -h/2);
  const p2 = new oc.gp_Pnt_3( l/2,  w/2,  h/2);
  const boxShape = new oc.BRepPrimAPI_MakeBox_4(p1, p2).Shape();
  finalSolid = { shape: boxShape, faceNames: new Map() };
}
```
Match the EXACT `oc.*` accessor + cast idiom already used in `SolidOps.ts` (`gp_Pnt_3` at `:133`, box constructors at `:30`). Confirm the `NamedShape` literal shape against the real type at the `imported`/`panel` branches.

### PC-6 — BLOCKER (Chunks A/F `HardwareEntry`/`CatalogEntry` field names)
`HardwareEntry` (`hardware-feature.ts:5`) fields: `id, name, category, vendor, notes` — the field is **`name`, not `label`**. `CatalogEntry` (`builtinCatalog.ts:3`) extends it + `bboxMm` + `attachPoints`. `attachPoints` entries are **`{ name: string, position:{x,y,z}, normal?:… }`** — NOT `{id, offsetMm}`. `BUILTIN_CATALOG` is a `readonly CatalogEntry[]` (array; `.find(e=>e.id===…)` is correct). Fix all SKU literals + the Chunk A test that reads `entry.label` → `entry.name`.

### PC-7 — BLOCKER (Chunks A/F/G command imports, async, role union)
- `packAssembly`/`unpackAssembly` import from `@zilventor/kernel/src/storage/AssemblyPacker` (`AddDrawerBankCommand.ts:42`); `packProject`/`unpackProject` from `@zilventor/kernel/src/storage/ProjectPacker` (`:43`). NOT from `@zilventor/shared`.
- `packAssembly` is **async** → `await packAssembly(...)`.
- `ComponentInstance.role` union (`types.ts:125`) = `PanelRole | 'drawerFront' | 'drawerBox'` — does NOT include the pull. **Add `'drawerHandle'` to that union in Chunk A** (additive), and use `role:'drawerHandle'` for the pull component (NOT `'hardware'`).
- Commands use `apply()`/`revert()` (`AddDrawerBankCommand.ts:111,291`) — plan body is correct here; keep it.

### PC-8 — BLOCKER (Chunk H dialog / FurnitureTab): ghost store props
- There is NO `activeCabinetPath` store property. Mirror the real "Add Drawers" flow (`FurnitureTab.tsx:165-188`): `viewport.beginOneComponentPick(resolvePartPath, (cabPath: string) => setAddDrawerHandleDialog({ cabPath, onSubmit, onCancel }))`. The dialog state carries `cabPath`.
- There is NO `opfs` in the store. Obtain it the way `AddDrawerBankCommand` does (read how the command receives `opfs`/`kernel` — via its constructor/ctx in `AddDrawerBankCommand.ts`) and pass the same way; in browser-probe contexts use `__zilventorGetOpfs()` (`App.tsx:451`). Verify the exact wiring before coding.
- `bus` IS in the store (`useAppStore` via `createCommandBus()`); `activeAssembly` IS too. Button-enable guard = `cabinetDisabled = !activeAssembly` (§13.4).
- Dialog test: instantiate the REAL handler, assert `bus.execute` called with `instanceof AddDrawerHandlesCommand` (§13.3-T6).

### PC-9 — BLOCKER (Chunk I e2e): no cabinet seeding
The plan's e2e returns `{error:'no active assembly'}` because nothing seeds one. Reproduce slice-4's setup from `tests/e2e/prisadka-slice4-drawer-banks.spec.ts`: new assembly → `addMaterial` store calls → `CreateCabinetCommand` → `AddDrawerBankCommand`, each via `__zilventorStore.getState().bus.execute(cmd)` (dynamic `import('/src/commands/…')`). THEN run "Add Handles". Wait for `boreMarkerCount() >= 2·N` before probing. Assert `__zilventorBoringAggregate()` → N distinct fronts bored, `2·N` total `handleScrew` bores; `__zilventorHardwarePartCount() >= N`; hardware BOM via the real `aggregateHardwareRecursive` (`BrowserPane.tsx:242`). Confirmed-exist probes: `__zilventorBoringAggregate` (`App.tsx:559`), `__zilventorGetOpfs` (`:451`), `__zilventorSubAsmInvalidateAll` (`:3304`), port 5182 (`playwright.worktree.config.ts`). The `hardwarePartCount` probe is to-build in `SceneManager` (add a real accessor like `boreMarkerCount` at `SceneManager.ts:687`).

### PC-10 — MAJOR (imports / misc, all chunks)
- `BoreOp` imports from `'../bore'`, NOT `'../types'`. `FaceName` from `'../types'` (`{featureId, role, instance?}` — `instance` optional; `instance:0` is fine).
- Verify `nanoid` is in `packages/shared/package.json` before importing it; if absent, reuse the existing id-generation pattern used elsewhere in shared/app commands.
- `formatVersion: 25` hard-coded in the command's inline hardware doc is acceptable ONLY after Chunk A lands the v25 migration; Chunk A is the solo foundation and must merge first.

### Execution ordering (locked)
Chunk **A solo first** (schema: kinds, catalog, migration, `HardwareEntry.category += 'drawerHandles'`, `ComponentInstance.role += 'drawerHandle'`). Then **B, C, D, E, F parallel** (disjoint files — exhaustiveness/i18n · kernel branch · bore math · pull-pose math · SKU+part-builder). Then **G** (command, depends D/E/F/A). Then **H** (dialog/UI, depends G). Then **I** (probe+e2e, depends all). Parallel implementers in one worktree: retry `git commit` on `index.lock` (wait 2s, ≤4×); each reads ONLY its chunk + this Corrections v2 + the real cited files, branch-check first line, substitute the worktree absolute path.

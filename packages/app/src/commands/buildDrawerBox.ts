/**
 * buildDrawerBox — pack a drawer box .ziasm + nested panel .zipt files to OPFS.
 * This is Chunk G of присадка slice 4 (§14.5 SEAM, load-bearing).
 *
 * Architecture (Correction C-5, AUTHORITATIVE):
 *  - buildDrawerBox: writes 5 panel .zipt files to OPFS + 1 box .ziasm; returns bytes + panelPaths.
 *  - writeBoxSideBores: patches the two side-panel .zipt docs with box-side BoreOps.
 *  - restoreBoxSideBores: inverse of writeBoxSideBores for revert.
 *
 * Box-side bore routing (from drawerSlideMath / §14.4):
 *   face.role === 'Top'    (LEFT_SIDE_INNER_FACE)  → isLeft === true  side panel
 *   face.role === 'Bottom' (RIGHT_SIDE_INNER_FACE) → isLeft === false side panel
 */

import type { AssemblyDocument, BoreOp, ComponentInstance, PanelFeature, PartDocument } from '@zilventor/shared';
import { CURRENT_FORMAT_VERSION } from '@zilventor/shared';
import { newPart, addFeature } from '@zilventor/kernel/src/adapter/PartDocument';
import { packAssembly, unpackAssembly } from '@zilventor/kernel/src/storage/AssemblyPacker';
import { packProject, unpackProject } from '@zilventor/kernel/src/storage/ProjectPacker';
import type { DrawerBoxResult, DrawerBoxPanel } from '@zilventor/shared/src/drawerBoxMath';

type OpfsRWD = {
  read(p: string): Promise<Uint8Array>;
  write(p: string, b: Uint8Array): Promise<void>;
  exists(p: string): Promise<boolean>;
  delete?(p: string): Promise<void>;
};

export interface BuildDrawerBoxMeta {
  /** Unique box identifier used to derive unique OPFS paths for the 5 panels. */
  boxId: string;
  /** Human-readable name for the box assembly. */
  name: string;
}

export interface BuildDrawerBoxResult {
  /** Packed .ziasm bytes for the drawer box sub-assembly. */
  bytes: Uint8Array;
  /** OPFS paths of the 5 panel .zipt files written to OPFS. */
  panelPaths: string[];
}

/**
 * Build and pack a drawer box sub-assembly.
 *
 * For each of the 5 panels in `box.panels`:
 *  - Creates a PartDocument with a PanelFeature carrying the panel's dims.
 *  - Packs it as a .zipt via packProject and writes to OPFS at a unique path.
 *  - Creates a ComponentInstance referencing that .zipt path.
 *
 * Assembles all 5 components into an AssemblyDocument and packs it as .ziasm.
 * Returns the .ziasm bytes and the list of written .zipt panel paths.
 */
export async function buildDrawerBox(
  box: DrawerBoxResult,
  meta: BuildDrawerBoxMeta,
  opfs: OpfsRWD,
): Promise<BuildDrawerBoxResult> {
  const panelPaths: string[] = [];
  const components: ComponentInstance[] = [];

  for (let i = 0; i < box.panels.length; i++) {
    const panel = box.panels[i]!;
    const panelName = panelNameFor(meta.boxId, panel, i);
    const panelPath = `${panelName}.zipt`;

    // Build PartDocument with a PanelFeature for this panel's dims
    const panelFeature: PanelFeature = {
      kind: 'panel',
      id: 'panel',
      length: { kind: 'literal', value: panel.dims.length },
      width: { kind: 'literal', value: panel.dims.width },
      thickness: { kind: 'literal', value: panel.dims.thickness },
      thicknessFromMaterial: false,
      materialId: 'm',
      grain: 'length',
      edgeBands: { front: null, back: null, left: null, right: null },
    };
    const partDoc: PartDocument = addFeature(newPart(panelName), panelFeature);

    // Pack to .zipt and write to OPFS
    const bytes = await packProject({
      manifest: {
        formatVersion: CURRENT_FORMAT_VERSION,
        kind: 'part' as const,
        document: partDoc,
      },
      blobs: {},
    });
    await opfs.write(panelPath, bytes);
    panelPaths.push(panelPath);

    // Build the ComponentInstance
    const component: ComponentInstance = {
      id: `${meta.boxId}-panel-${i}`,
      partPath: panelPath,
      position: {
        x: panel.pose.translation.x,
        y: panel.pose.translation.y,
        z: panel.pose.translation.z,
      },
      rotation: { rx: 0, ry: 0, rz: 0 },
      visible: true,
      pose: panel.pose,
      role: panel.role,
    };
    components.push(component);
  }

  // Assemble the box AssemblyDocument
  const boxDoc: AssemblyDocument = {
    id: `${meta.boxId}-asm`,
    name: meta.name,
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

  const asmBytes = await packAssembly(boxDoc, new Uint8Array());

  return { bytes: asmBytes, panelPaths };
}

/**
 * Prior bores snapshot: maps a panel OPFS path → its original BoreOp[] before we patched.
 * Used by restoreBoxSideBores to revert.
 */
export type BoxSidePriorBores = Map<string, BoreOp[]>;

/**
 * Write box-side BoreOps into the two side-panel .zipt files referenced by the box .ziasm.
 *
 * Routing (§14.4 + drawerSlideMath convention):
 *   bore.face.role === 'Top'    (LEFT_SIDE_INNER_FACE)  → isLeft===true  (left) side panel
 *   bore.face.role === 'Bottom' (RIGHT_SIDE_INNER_FACE) → isLeft===false (right) side panel
 *
 * Returns the updated .ziasm bytes and a prior-bores map for restoreBoxSideBores.
 *
 * NOTE: The passed-in `asm` is the unpacked box assembly (avoids double-unpack by callers that
 * already have it); the returned bytes contain the updated component paths (unchanged paths,
 * but the side-panel .zipt files on OPFS are updated in place).
 */
export async function writeBoxSideBores(
  boxBytes: Uint8Array,
  bores: BoreOp[],
  opfs: OpfsRWD,
  asm?: AssemblyDocument,
): Promise<{ bytes: Uint8Array; priorBores: BoxSidePriorBores }> {
  const boxDoc = asm ?? await unpackAssembly(boxBytes);
  const priorBores: BoxSidePriorBores = new Map();

  // Find the left and right side panel components
  const sideComps = boxDoc.components.filter((c) => c.role === 'drawerBox-side');

  // Split bores by face role → routing to the correct side panel
  const topBores = bores.filter((b) => b.face.role === 'Top');    // LEFT_SIDE_INNER_FACE
  const botBores = bores.filter((b) => b.face.role === 'Bottom'); // RIGHT_SIDE_INNER_FACE

  // We need to identify which sideComp is left (isLeft) vs right.
  // drawerBoxMath emits left panel first (index 0, isLeft=true) then right (index 1, isLeft=false).
  // Since we only have the assembly doc at this point (no isLeft field on ComponentInstance),
  // we use positional order: the first sideComp is left, second is right.
  // This matches drawerBoxMath panel ordering and the ComponentInstance id convention.
  const [leftComp, rightComp] = sideComps;

  const pairsToWrite: Array<{ comp: ComponentInstance; borestToAdd: BoreOp[] }> = [];
  if (leftComp && topBores.length > 0) {
    pairsToWrite.push({ comp: leftComp, borestToAdd: topBores });
  }
  if (rightComp && botBores.length > 0) {
    pairsToWrite.push({ comp: rightComp, borestToAdd: botBores });
  }

  for (const { comp, borestToAdd } of pairsToWrite) {
    const project = await unpackProject(await opfs.read(comp.partPath));
    const doc = (project.manifest as { document: { bores?: BoreOp[] } }).document;
    const existing = doc.bores ?? [];

    // Snapshot prior bores (idempotent — only record once per path)
    if (!priorBores.has(comp.partPath)) {
      priorBores.set(comp.partPath, existing);
    }

    doc.bores = [...existing, ...borestToAdd];
    await opfs.write(
      comp.partPath,
      await packProject({
        manifest: {
          ...(project.manifest as object),
          formatVersion: CURRENT_FORMAT_VERSION,
          document: doc,
        },
        blobs: {},
      }),
    );
  }

  // Re-pack the .ziasm so its bytes reflect the current state (component list unchanged,
  // but we return fresh bytes so callers can use them; OPFS side panels are already updated).
  const updatedBytes = await packAssembly(boxDoc, new Uint8Array());
  return { bytes: updatedBytes, priorBores };
}

/**
 * Write box-bottom BoreOps into the drawerBox-bottom panel .zipt.
 * Routes all bores to the component whose role === 'drawerBox-bottom'.
 */
export async function writeBoxBottomBores(
  boxBytes: Uint8Array,
  bores: BoreOp[],
  opfs: OpfsRWD,
  asm?: AssemblyDocument,
): Promise<{ bytes: Uint8Array; priorBores: BoxSidePriorBores }> {
  const boxDoc = asm ?? await unpackAssembly(boxBytes);
  const priorBores: BoxSidePriorBores = new Map();
  const bottomComp = boxDoc.components.find((c) => c.role === 'drawerBox-bottom');
  if (!bottomComp || bores.length === 0) {
    return { bytes: await packAssembly(boxDoc, new Uint8Array()), priorBores };
  }
  const project = await unpackProject(await opfs.read(bottomComp.partPath));
  const doc = (project.manifest as { document: { bores?: BoreOp[] } }).document;
  const existing = doc.bores ?? [];
  if (!priorBores.has(bottomComp.partPath)) {
    priorBores.set(bottomComp.partPath, existing);
  }
  doc.bores = [...existing, ...bores];
  await opfs.write(
    bottomComp.partPath,
    await packProject({
      manifest: { ...(project.manifest as object), formatVersion: CURRENT_FORMAT_VERSION, document: doc },
      blobs: (project as { blobs?: Record<string, Uint8Array> }).blobs ?? {},
    }),
  );
  return { bytes: await packAssembly(boxDoc, new Uint8Array()), priorBores };
}

/**
 * Write box-back BoreOps into the drawerBox-back panel .zipt.
 * Routes all bores to the component whose role === 'drawerBox-back'.
 */
export async function writeBoxBackBores(
  boxBytes: Uint8Array,
  bores: BoreOp[],
  opfs: OpfsRWD,
  asm?: AssemblyDocument,
): Promise<{ bytes: Uint8Array; priorBores: BoxSidePriorBores }> {
  const boxDoc = asm ?? await unpackAssembly(boxBytes);
  const priorBores: BoxSidePriorBores = new Map();
  const backComp = boxDoc.components.find((c) => c.role === 'drawerBox-back');
  if (!backComp || bores.length === 0) {
    return { bytes: await packAssembly(boxDoc, new Uint8Array()), priorBores };
  }
  const project = await unpackProject(await opfs.read(backComp.partPath));
  const doc = (project.manifest as { document: { bores?: BoreOp[] } }).document;
  const existing = doc.bores ?? [];
  if (!priorBores.has(backComp.partPath)) {
    priorBores.set(backComp.partPath, existing);
  }
  doc.bores = [...existing, ...bores];
  await opfs.write(
    backComp.partPath,
    await packProject({
      manifest: { ...(project.manifest as object), formatVersion: CURRENT_FORMAT_VERSION, document: doc },
      blobs: (project as { blobs?: Record<string, Uint8Array> }).blobs ?? {},
    }),
  );
  return { bytes: await packAssembly(boxDoc, new Uint8Array()), priorBores };
}

/**
 * Restore box-side panel .zipt bores to their prior state (undo of writeBoxSideBores).
 *
 * Returns updated .ziasm bytes (structurally identical to input; side-panel OPFS files restored).
 */
export async function restoreBoxSideBores(
  boxBytes: Uint8Array,
  priorBores: BoxSidePriorBores,
  opfs: OpfsRWD,
  asm?: AssemblyDocument,
): Promise<Uint8Array> {
  const boxDoc = asm ?? await unpackAssembly(boxBytes);

  for (const [panelPath, prior] of priorBores) {
    const project = await unpackProject(await opfs.read(panelPath));
    const doc = (project.manifest as { document: Record<string, unknown> }).document;

    if (prior.length > 0) {
      doc.bores = prior;
    } else {
      delete doc.bores;
    }

    await opfs.write(
      panelPath,
      await packProject({
        manifest: {
          ...(project.manifest as object),
          formatVersion: CURRENT_FORMAT_VERSION,
          document: doc,
        },
        blobs: {},
      }),
    );
  }

  return packAssembly(boxDoc, new Uint8Array());
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Derive a unique, stable panel file name from the box id and panel definition. */
function panelNameFor(boxId: string, panel: DrawerBoxPanel, index: number): string {
  const roleSlug = panel.role.replace('drawerBox-', '');
  const sideSuffix = panel.role === 'drawerBox-side'
    ? (panel.isLeft ? '-L' : '-R')
    : '';
  return `${boxId}-${roleSlug}${sideSuffix}-${index}`;
}

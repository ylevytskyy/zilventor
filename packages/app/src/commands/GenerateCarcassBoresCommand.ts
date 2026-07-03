import type { Command } from './Command';
import type { AssemblyDocument, BoreOp, PanelInput, PanelRole } from '@zilventor/shared';
import {
  enumerateAutoJoints,
  generateConfirmat, generateMinifix, generateDowel,
  CURRENT_FORMAT_VERSION,
  mergeBores,
  syntheticSideBoreToReal,
} from '@zilventor/shared';
import { packProject, unpackProject } from '@zilventor/kernel/src/storage/ProjectPacker';
import { unpackAssembly } from '@zilventor/kernel/src/storage/AssemblyPacker';
import { useAppStore } from '../store/useAppStore';
import type { JointInput } from '@zilventor/shared';

type BoringParams = {
  endSetback: number;
  maxSpacing: number;
  minCount: number;
  confirmat: boolean;
  minifix: boolean;
  dowel: boolean;
};

type OpfsRW = { read(p: string): Promise<Uint8Array>; write(p: string, b: Uint8Array): Promise<void> };

/**
 * Read a panel's resolved dims from its single PanelFeature inside the .zipt manifest.
 * Uses `featureTree` (the real PartDocument field) — NOT `features`.
 * Panel dims are stored as ParamOrLiteral; only `literal` values are supported here
 * (parameter-bound panels are an extension point for later).
 */
function panelDimsFromDoc(
  doc: { featureTree?: Array<Record<string, unknown>> },
): { length: number; width: number; thickness: number } {
  const panel = (doc.featureTree ?? []).find((f) => f.kind === 'panel') as
    | { length: unknown; width: unknown; thickness: unknown }
    | undefined;
  if (!panel) throw new Error('NO_PANEL_FEATURE');

  function resolve(v: unknown, name: string): number {
    if (typeof v === 'number') return v;
    if (v !== null && typeof v === 'object' && (v as Record<string, unknown>).kind === 'literal') {
      const val = (v as { value: unknown }).value;
      if (typeof val === 'number') return val;
    }
    throw new Error(`UNRESOLVABLE_DIM: ${name}`);
  }

  return {
    length: resolve(panel.length, 'length'),
    width: resolve(panel.width, 'width'),
    thickness: resolve(panel.thickness, 'thickness'),
  };
}

export class GenerateCarcassBoresCommand implements Command {
  readonly name = 'GenerateCarcassBores';
  /** partPath → prior bores[] (for revert). Captured during apply(). */
  private priorBores = new Map<string, BoreOp[]>();
  private readonly store: typeof useAppStore;

  constructor(private readonly opts: {
    params: BoringParams;
    opfs: OpfsRW;
    store?: typeof useAppStore;
  }) {
    this.store = opts.store ?? useAppStore;
  }

  async apply(): Promise<void> {
    const asm = this.store.getState().activeAssembly;
    if (!asm) return;

    // Loaded panel docs keyed by partPath — shared across all cabinet groups.
    const docs = new Map<string, { manifest: Record<string, unknown>; document: Record<string, unknown> }>();

    // Accumulate bores per partPath across all cabinet groups.
    const accum = new Map<string, BoreOp[]>();
    const appendBores = (partPath: string, bores: BoreOp[]) => {
      const list = accum.get(partPath) ?? [];
      list.push(...bores);
      accum.set(partPath, list);
    };

    // Collect panel inputs from an assembly doc and process joints within that group.
    // Recurses into nested .ziasm sub-assemblies so each cabinet's panels are processed
    // as a self-contained group (joints are only computed among panels of the SAME cabinet).
    const processAssemblyDoc = async (doc: AssemblyDocument): Promise<void> => {
      const panelInputs: Array<PanelInput & { partPath: string; boardThickness: number }> = [];

      for (const c of doc.components) {
        // Recurse into nested sub-assemblies (each cabinet group is independent).
        if (c.partPath.endsWith('.ziasm')) {
          const subDoc = await unpackAssembly(await this.opts.opfs.read(c.partPath));
          await processAssemblyDoc(subDoc);
          continue;
        }

        if (!c.role) continue; // role-less non-sub-asm component → skip (not a cabinet panel)
        if (c.partPath.startsWith('hardware/')) continue; // hardware part (drawerHandle etc.) → no panel feature, skip

        // Load panel manifest once.
        if (!docs.has(c.partPath)) {
          const project = await this.opts.opfs.read(c.partPath).then(unpackProject);
          const manifest = project.manifest as { document: Record<string, unknown> };
          docs.set(c.partPath, { manifest: manifest as unknown as Record<string, unknown>, document: manifest.document });
        }
        const entry = docs.get(c.partPath)!;
        const dims = panelDimsFromDoc(entry.document as { featureTree?: Array<Record<string, unknown>> });

        // buildBaseCabinet stores side panels (leftSide/rightSide) with dims where `length` is
        // the cabinet HEIGHT (the tall dimension, running along world-Z) and `thickness` is the
        // board thickness (running along world-X). The part-local box convention is
        // [-L/2,-W/2,0]..[L/2,W/2,T], so for side panels L maps to world-X and T to world-Z —
        // which is the opposite of the physical orientation.
        //
        // To make jointMath's worldAABB produce the correct world AABB for side panels, we swap
        // L and T in the dims: this remaps the tall dimension to the T (Z) axis of the fully-
        // centered box, making the side panel correctly appear thin in X (world) and tall in Z.
        //
        // For horizontal panels (bottom/top/shelf/back) the dims already map correctly:
        // L = X-span, W = Y-span, T = Z-span (board thickness).
        //
        // After the optional swap, pose.translation = c.position + (L_eff/2, W/2, T_eff/2) gives
        // the geometric center of the fully-centered world box for identity rotation.
        const role = c.role as PanelRole;
        const { length: L, width: W, thickness: T } = dims;
        const isSidePanel = role === 'leftSide' || role === 'rightSide';
        // For side panels: swap length↔thickness so L_eff = T_orig (thin, X), T_eff = L_orig (tall, Z).
        const Leff = isSidePanel ? T : L;
        const Teff = isSidePanel ? L : T;
        const effectiveDims = isSidePanel ? { length: Leff, width: W, thickness: Teff } : dims;

        const cx = c.position.x + Leff / 2;
        const cy = c.position.y + W / 2;
        const cz = c.position.z + Teff / 2;

        panelInputs.push({
          partPath: c.partPath,
          dims: effectiveDims,
          pose: { translation: { x: cx, y: cy, z: cz }, quaternion: [0, 0, 0, 1] },
          role,
          // T is the REAL board thickness (from the unswapped dims). For side panels the
          // swap moved it to dims.length (Teff), but T is still the correct value.
          boardThickness: T,
        });
      }

      if (panelInputs.length === 0) return;

      // Enumerate auto joints (role-driven butt-joint detection) for THIS cabinet group.
      const joints = enumerateAutoJoints(panelInputs);

      /** Map a PanelInput reference back to its extended entry via identity comparison. */
      const entryOf = (pi: PanelInput): { partPath: string; boardThickness: number } =>
        panelInputs.find((p) => p === pi) as { partPath: string; boardThickness: number };

      for (const joint of joints) {
        const eA = entryOf(joint.panelA);
        const eB = entryOf(joint.panelB);
        const aPath = eA.partPath;
        const bPath = eB.partPath;

        // JointInput is structurally compatible with Joint — cast is safe since Joint
        // extends JointInput with the same line/panelA/panelB/faceA/endB fields.
        // Populate boardThicknessA/B from the pre-swap real board thickness so the
        // connector catalog uses the correct board thickness (not swapped dims.thickness).
        const ji: JointInput = {
          ...(joint as unknown as JointInput),
          boardThicknessA: eA.boardThickness,
          boardThicknessB: eB.boardThickness,
        };

        // enumerateAutoJoints always forces panelA = the side panel (leftSide/rightSide),
        // whose dims were L<->T-swapped above for worldAABB inference. Its bores therefore
        // come back with face.role 'Left'/'Right' in that SYNTHETIC frame, which must be
        // remapped to the panel's REAL PartDocument frame ('Top'/'Bottom') before persisting
        // — see syntheticSideBoreToReal's derivation comment. panelB (bottom/top/shelf) was
        // never swapped, so boresB need no remap.
        const isSideA = joint.panelA.role === 'leftSide' || joint.panelA.role === 'rightSide';
        const remapA = (bores: BoreOp[]): BoreOp[] =>
          isSideA ? bores.map(syntheticSideBoreToReal) : bores;

        if (this.opts.params.confirmat) {
          const { boresA, boresB } = generateConfirmat(ji, this.opts.params);
          appendBores(aPath, remapA(boresA)); appendBores(bPath, boresB);
        }
        if (this.opts.params.minifix) {
          const { boresA, boresB } = generateMinifix(ji, this.opts.params);
          appendBores(aPath, remapA(boresA)); appendBores(bPath, boresB);
        }
        if (this.opts.params.dowel) {
          const { boresA, boresB } = generateDowel(ji, this.opts.params);
          appendBores(aPath, remapA(boresA)); appendBores(bPath, boresB);
        }
      }
    };

    // Start recursion from the top-level active assembly.
    await processAssemblyDoc(asm);

    // Persist: snapshot prior bores, set new bores[], repack each .zipt.
    for (const [partPath, newBores] of accum) {
      const entry = docs.get(partPath)!;
      const existing = (entry.document.bores as BoreOp[] | undefined) ?? [];
      this.priorBores.set(partPath, existing);
      const suppressed = (entry.document.suppressedConnectorIds as string[] | undefined);
      const merged = mergeBores(newBores, existing, suppressed);
      if (merged.length > 0) {
        entry.document.bores = merged;
      } else {
        delete (entry.document as Record<string, unknown>).bores;
      }
      const repackedManifest = {
        ...entry.manifest,
        formatVersion: CURRENT_FORMAT_VERSION,
        document: entry.document,
      };
      await this.opts.opfs.write(
        partPath,
        await packProject({ manifest: repackedManifest, blobs: {} }),
      );
    }
    // Evict bore/geometry caches so the caller (and undo/redo) re-renders bore markers.
    const affectedPaths = [...this.priorBores.keys()];
    if (affectedPaths.length > 0) {
      this.store.getState().boreCacheInvalidator?.(affectedPaths);
    }
  }

  /** Returns the part paths that were written during the most recent apply(). */
  getAffectedPartPaths(): string[] {
    return [...this.priorBores.keys()];
  }

  async revert(): Promise<void> {
    const affectedPaths = [...this.priorBores.keys()];
    for (const [partPath, prior] of this.priorBores) {
      const project = await this.opts.opfs.read(partPath).then(unpackProject);
      const manifest = project.manifest as { document: Record<string, unknown> };
      if (prior.length > 0) {
        manifest.document.bores = prior;
      } else {
        delete manifest.document.bores;
      }
      await this.opts.opfs.write(
        partPath,
        await packProject({
          manifest: { ...manifest, formatVersion: CURRENT_FORMAT_VERSION },
          blobs: {},
        }),
      );
    }
    this.priorBores.clear();
    // Evict bore/geometry caches after revert so undo re-renders bore markers.
    if (affectedPaths.length > 0) {
      this.store.getState().boreCacheInvalidator?.(affectedPaths);
    }
  }
}

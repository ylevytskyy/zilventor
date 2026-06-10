import type { Command } from './Command';
import type { BoreOp, BoreConnectorKind, PanelInput } from '@zilventor/shared';
import {
  inferManualJoint,
  generateConfirmat, generateMinifix, generateDowel,
  CURRENT_FORMAT_VERSION,
} from '@zilventor/shared';
import type { JointInput } from '@zilventor/shared';
import { packProject, unpackProject } from '@zilventor/kernel/src/storage/ProjectPacker';
import { useAppStore } from '../store/useAppStore';

type BoringParams = { endSetback: number; maxSpacing: number; minCount: number };
type OpfsRW = { read(p: string): Promise<Uint8Array>; write(p: string, b: Uint8Array): Promise<void> };

/**
 * Read a panel's resolved dims from its single PanelFeature inside the .zipt manifest.
 * Uses `featureTree` (the real PartDocument field) — NOT `features`.
 */
function panelDimsFromDoc(doc: { featureTree?: Array<Record<string, unknown>> }) {
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

const GEN = {
  confirmat: generateConfirmat,
  minifix: generateMinifix,
  dowel: generateDowel,
} as const;

export class AddManualJointBoresCommand implements Command {
  readonly name = 'AddManualJointBores';
  /** partPath → prior bores[] (for revert). Captured during apply(). */
  private priorBores = new Map<string, BoreOp[]>();
  private readonly store: typeof useAppStore;

  constructor(private readonly opts: {
    panelPathA: string;
    panelPathB: string;
    kind: BoreConnectorKind;
    params: BoringParams;
    opfs: OpfsRW;
    store?: typeof useAppStore;
  }) {
    this.store = opts.store ?? useAppStore;
  }

  private async loadPanel(partPath: string): Promise<{
    input: PanelInput;
    manifest: { document: Record<string, unknown> };
    partPath: string;
  }> {
    const asm = this.store.getState().activeAssembly!;
    const comp = asm.components.find((c) => c.partPath === partPath);
    if (!comp) throw new Error(`NO_COMPONENT_FOR_${partPath}`);
    const project = await this.opts.opfs.read(partPath).then(unpackProject);
    const manifest = project.manifest as { document: Record<string, unknown> };
    const dims = panelDimsFromDoc(manifest.document as { featureTree?: Array<Record<string, unknown>> });
    // comp.position is the CORNER of the panel box (assembly convention).
    // inferManualJoint expects pose.translation to be the geometric CENTER.
    // For manually-picked panels we don't know the role, so we use the straightforward
    // half-dim offset: center = corner + (L/2, W/2, T/2) for identity rotation.
    // This matches the horizontal-panel centering in GenerateCarcassBoresCommand.
    const center = {
      x: comp.position.x + dims.length / 2,
      y: comp.position.y + dims.width / 2,
      z: comp.position.z + dims.thickness / 2,
    };
    return {
      input: {
        dims,
        pose: { translation: center, quaternion: [0, 0, 0, 1] },
      },
      manifest,
      partPath,
    };
  }

  async apply(): Promise<void> {
    const asm = this.store.getState().activeAssembly;
    if (!asm) return;

    const a = await this.loadPanel(this.opts.panelPathA);
    const b = await this.loadPanel(this.opts.panelPathB);

    const joint = inferManualJoint(a.input, b.input);
    if (!joint) return; // not a butt joint → no-op

    // JointInput is structurally compatible with Joint — same line/panelA/panelB/faceA/endB fields.
    const ji = joint as unknown as JointInput;

    const gen = GEN[this.opts.kind];
    const { boresA, boresB } = gen(ji, this.opts.params);

    // inferManualJoint may have swapped which panel is A vs B; map back by reference.
    const aIsPanelA = joint.panelA === a.input;
    await this.persist(aIsPanelA ? a : b, boresA);
    await this.persist(aIsPanelA ? b : a, boresB);
    // Evict bore/geometry caches so undo/redo re-renders bore markers.
    const affected = [this.opts.panelPathA, this.opts.panelPathB];
    this.store.getState().boreCacheInvalidator?.(affected);
  }

  private async persist(
    panel: { manifest: { document: Record<string, unknown> }; partPath: string },
    newBores: BoreOp[],
  ): Promise<void> {
    const { partPath } = panel;
    const existing = (panel.manifest.document.bores as BoreOp[] | undefined) ?? [];
    this.priorBores.set(partPath, existing);
    panel.manifest.document.bores = [...existing, ...newBores];
    await this.opts.opfs.write(partPath, await packProject({
      manifest: {
        ...panel.manifest,
        formatVersion: CURRENT_FORMAT_VERSION,
        document: panel.manifest.document,
      },
      blobs: {},
    }));
  }

  async revert(): Promise<void> {
    const affectedPaths = [this.opts.panelPathA, this.opts.panelPathB];
    for (const [partPath, prior] of this.priorBores) {
      const project = await this.opts.opfs.read(partPath).then(unpackProject);
      const manifest = project.manifest as { document: Record<string, unknown> };
      if (prior.length > 0) {
        manifest.document.bores = prior;
      } else {
        delete manifest.document.bores;
      }
      await this.opts.opfs.write(partPath, await packProject({
        manifest: { ...manifest, formatVersion: CURRENT_FORMAT_VERSION },
        blobs: {},
      }));
    }
    this.priorBores.clear();
    // Evict bore/geometry caches after revert so undo re-renders bore markers.
    this.store.getState().boreCacheInvalidator?.(affectedPaths);
  }
}

import type { Command } from './Command';
import type { PanelInput, PartDocument, TenonMortiseFeature, TenonMortiseCreateInput, TenonMortiseParams } from '@zilventor/shared';
import { inferManualJoint, generateTenonMortisePair, layoutTenonsAlongJoint, CURRENT_FORMAT_VERSION } from '@zilventor/shared';
import type { JointInput } from '@zilventor/shared';
import { addFeature } from '@zilventor/kernel/src/adapter/PartDocument';
import { packProject, unpackProject } from '@zilventor/kernel/src/storage/ProjectPacker';
import { useAppStore } from '../store/useAppStore';

type OpfsRW = { read(p: string): Promise<Uint8Array>; write(p: string, b: Uint8Array): Promise<void> };

/**
 * Read a panel's resolved dims from its single PanelFeature inside the .zipt manifest.
 * Duplicated from AddManualJointBoresCommand's `panelDimsFromDoc` (module-private in both
 * files, not worth extracting a shared helper for a ~15-line function) — same contract.
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

let tenonMortiseCounter = 0;

export type AddTenonMortiseOpts = {
  panelPathA: string;
  panelPathB: string;
  params: TenonMortiseCreateInput;
  opfs: OpfsRW;
  store?: typeof useAppStore;
};

/** mirrors tenonMortiseMath.ts's private jointLength one-liner (not exported —
 *  P11's own convention, per the existing "mirrors connectorCatalog.ts's private
 *  one-liner" comment on that function; not worth widening that module's surface
 *  for a second private call site). */
function jointLength(line: { p0: { x: number; y: number; z: number }; p1: { x: number; y: number; z: number } }): number {
  const { p0, p1 } = line;
  return Math.hypot(p1.x - p0.x, p1.y - p0.y, p1.z - p0.z);
}

type LoadedPanel = {
  input: PanelInput;
  manifest: { document: PartDocument };
  partPath: string;
};

/**
 * Infers which of two manually-picked panels presents the FACE (mating/mortise host) and
 * which presents the END (male/tenon host) of a butt joint, generates a matched
 * tenon/mortise `Feature` pair via `generateTenonMortisePair`, and appends one feature to
 * each panel's `featureTree` — mirrors `AddGrooveCommand`'s featureTree-append persistence
 * style, generalized to two files, and `AddManualJointBoresCommand`'s panel-loading /
 * inferManualJoint / A-vs-B reference-remapping structure.
 *
 * Undo restores the exact prior `.zipt` bytes of BOTH files (not a field-level delete),
 * so field ABSENCE (e.g. a document with no pre-existing `bores` key) round-trips exactly —
 * approved as the revert strategy for this command (see AddGrooveCommand's single-file
 * analog of the same byte-snapshot approach).
 */
export class AddTenonMortiseCommand implements Command {
  readonly name = 'AddTenonMortise';
  /** partPath → prior full manifest bytes (for revert). Captured during apply(). */
  private priorBytes = new Map<string, Uint8Array>();
  private readonly store: typeof useAppStore;
  /** Set during apply() when `opts.params` carries a `layout` descriptor (P11):
   *  true if the requested count/pitch didn't fit the joint's usable span and
   *  was clamped down (see `layoutTenonsAlongJoint`). false for literal params
   *  or a feasible auto-layout. Callers (FurnitureTab) read this after
   *  `bus.execute` to decide whether to surface a clamp-warning toast. */
  clamped = false;

  constructor(private readonly opts: AddTenonMortiseOpts) {
    this.store = opts.store ?? useAppStore;
  }

  private async loadPanel(partPath: string): Promise<LoadedPanel> {
    const asm = this.store.getState().activeAssembly!;
    const comp = asm.components.find((c) => c.partPath === partPath);
    if (!comp) throw new Error(`NO_COMPONENT_FOR_${partPath}`);
    const bytes = await this.opts.opfs.read(partPath);
    const project = await unpackProject(bytes);
    const manifest = project.manifest as { document: PartDocument };
    const dims = panelDimsFromDoc(manifest.document as unknown as { featureTree?: Array<Record<string, unknown>> });
    // comp.position is the CORNER of the panel box (assembly convention); inferManualJoint
    // expects pose.translation to be the geometric CENTER — same half-dim offset as
    // AddManualJointBoresCommand.loadPanel.
    const center = {
      x: comp.position.x + dims.length / 2,
      y: comp.position.y + dims.width / 2,
      z: comp.position.z + dims.thickness / 2,
    };
    return {
      input: { dims, pose: { translation: center, quaternion: [0, 0, 0, 1] } },
      manifest,
      partPath,
    };
  }

  /**
   * Resolves `TenonMortiseCreateInput` to a literal `TenonMortiseParams` (P11 D1):
   * a plain literal input passes through unchanged (clamped=false); a `layout`
   * descriptor is resolved via `layoutTenonsAlongJoint` against the joint's REAL
   * edge length (computed fresh here, not the dialog's preload — mirrors this
   * command's existing pattern of re-deriving the joint fresh rather than
   * trusting a caller-supplied value, per P11 D4). Sets `this.clamped`.
   */
  private resolveParams(input: TenonMortiseCreateInput, joint: JointInput): TenonMortiseParams {
    if (!('layout' in input)) {
      this.clamped = false;
      return input;
    }
    const { layout, ...rest } = input;
    const { count, spacing, clamped } = layoutTenonsAlongJoint(jointLength(joint.line), {
      mode: layout.mode,
      value: layout.value,
      width: rest.width,
      ...(layout.minEndMargin !== undefined ? { minEndMargin: layout.minEndMargin } : {}),
    });
    this.clamped = clamped;
    return { ...rest, count, spacing };
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

    const resolvedParams = this.resolveParams(this.opts.params, ji);

    const n = tenonMortiseCounter++;
    const { tenon, mortise } = generateTenonMortisePair(ji, resolvedParams, {
      tenonId: `tenonMortise-tenon-${n}`,
      mortiseId: `tenonMortise-mortise-${n}`,
      pairId: `tenonMortise-pair-${n}`,
    });

    // inferManualJoint may have swapped which panel is A vs B; map back by reference.
    const aIsPanelA = joint.panelA === a.input;
    const mortiseHost = aIsPanelA ? a : b; // hosts joint.panelA (the FACE side) → mortise
    const tenonHost = aIsPanelA ? b : a; // hosts joint.panelB (the END side) → tenon

    await this.persist(mortiseHost, mortise);
    await this.persist(tenonHost, tenon);

    // Evict bore/geometry caches so undo/redo re-renders the new features.
    this.store.getState().boreCacheInvalidator?.([this.opts.panelPathA, this.opts.panelPathB]);
  }

  private async persist(panel: LoadedPanel, feature: TenonMortiseFeature): Promise<void> {
    const { partPath } = panel;
    if (!this.priorBytes.has(partPath)) {
      this.priorBytes.set(partPath, await this.opts.opfs.read(partPath));
    }
    const doc = addFeature(panel.manifest.document, feature);
    const manifest = { formatVersion: CURRENT_FORMAT_VERSION, kind: 'part' as const, document: doc };
    await this.opts.opfs.write(partPath, await packProject({ manifest, blobs: {} }));
  }

  async revert(): Promise<void> {
    for (const [partPath, bytes] of this.priorBytes) {
      await this.opts.opfs.write(partPath, bytes);
    }
    this.priorBytes.clear();
    // Evict bore/geometry caches after revert so undo re-renders correctly.
    this.store.getState().boreCacheInvalidator?.([this.opts.panelPathA, this.opts.panelPathB]);
  }
}

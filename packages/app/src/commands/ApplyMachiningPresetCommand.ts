import type { Command } from './Command';
import type { BoreOp, GrooveFeature, Feature } from '@zilventor/shared';
import { packProject, unpackProject } from '@zilventor/kernel/src/storage/ProjectPacker';
import { CURRENT_FORMAT_VERSION } from '@zilventor/shared';
import { useAppStore } from '../store/useAppStore';

type OpfsRW = { read(p: string): Promise<Uint8Array>; write(p: string, b: Uint8Array): Promise<void> };

/** Snapshotted preset values (ADR 0001) — VALUES, not a preset id/reference, so
 *  the command is decoupled from the preset store: editing the preset later
 *  never changes an already-applied bore/groove.
 *  `diameter`/`depth` are bore-only (required when opts.bore is the target;
 *  ignored entirely on the groove branch — a groove's own depth/width are
 *  never touched by this command, per D4). */
interface MachiningPresetValues {
  diameter?: number;
  depth?: number;
  layerName: string;
  toolNumber?: number;
  speed?: number;
}

interface ApplyMachiningPresetOpts {
  /** Bore target (P3). Exactly one of `bore`/`groove` must be provided. */
  bore?: BoreOp;
  /** Groove target (P9 W1, D4) — widened from a bore-only command. Only
   *  toolNumber/speed/presetLayerName are ever written; width/depth/position
   *  are never touched. */
  groove?: GrooveFeature;
  values: MachiningPresetValues;
  partPath: string;
  doc: { bores?: BoreOp[]; featureTree?: Feature[] };
  opfs: OpfsRW | null;
}

/**
 * Apply a snapshot of machining-preset values to a single BoreOp or
 * GrooveFeature target (discriminated by which of `bore`/`groove` is present
 * on construction — see D4 in docs/superpowers/plans/2026-07-03-p9-preset-coverage.md).
 *
 * Bore branch: diameter, depth, presetLayerName (from values.layerName),
 * toolNumber, speed.
 * Groove branch: presetLayerName, toolNumber, speed ONLY — diameter/depth are
 * never referenced and width/depth/position on the groove are never mutated.
 *
 * Undoable: revert restores the exact prior field states, including absence
 * of toolNumber/speed/presetLayerName (exactOptionalPropertyTypes).
 */
export class ApplyMachiningPresetCommand implements Command {
  readonly name = 'ApplyMachiningPreset';
  private readonly kind: 'bore' | 'groove';
  private snapshot: {
    diameter?: number;
    depth?: number | 'throughAll';
    hadPresetLayerName: boolean; priorPresetLayerName?: string;
    hadToolNumber: boolean; priorToolNumber?: number;
    hadSpeed: boolean; priorSpeed?: number;
  };

  constructor(private opts: ApplyMachiningPresetOpts) {
    this.kind = opts.groove ? 'groove' : 'bore';
    const target = this.kind === 'groove' ? opts.groove! : opts.bore!;
    const snap: Record<string, unknown> = {
      hadPresetLayerName: 'presetLayerName' in target,
      hadToolNumber: 'toolNumber' in target,
      hadSpeed: 'speed' in target,
    };
    if (this.kind === 'bore') {
      const bore = target as BoreOp;
      snap.diameter = bore.diameter;
      snap.depth = bore.depth;
    }
    if (target.presetLayerName !== undefined) snap.priorPresetLayerName = target.presetLayerName;
    if (target.toolNumber !== undefined) snap.priorToolNumber = target.toolNumber;
    if (target.speed !== undefined) snap.priorSpeed = target.speed;
    this.snapshot = snap as typeof this.snapshot;
  }

  async apply(): Promise<void> {
    const { values } = this.opts;
    if (this.kind === 'groove') {
      const groove = this.opts.groove!;
      groove.presetLayerName = values.layerName;
      if (values.toolNumber === undefined) delete groove.toolNumber; else groove.toolNumber = values.toolNumber;
      if (values.speed === undefined) delete groove.speed; else groove.speed = values.speed;
    } else {
      const bore = this.opts.bore!;
      bore.diameter = values.diameter as number;
      bore.depth = values.depth as number;
      bore.presetLayerName = values.layerName;
      if (values.toolNumber === undefined) delete bore.toolNumber; else bore.toolNumber = values.toolNumber;
      if (values.speed === undefined) delete bore.speed; else bore.speed = values.speed;
    }
    if (this.opts.opfs) await this.persist();
    useAppStore.getState().boreCacheInvalidator?.([this.opts.partPath]);
  }

  async revert(): Promise<void> {
    const snap = this.snapshot;
    if (this.kind === 'groove') {
      const groove = this.opts.groove!;
      if (snap.hadPresetLayerName) groove.presetLayerName = snap.priorPresetLayerName!; else delete groove.presetLayerName;
      if (snap.hadToolNumber) groove.toolNumber = snap.priorToolNumber!; else delete groove.toolNumber;
      if (snap.hadSpeed) groove.speed = snap.priorSpeed!; else delete groove.speed;
    } else {
      const bore = this.opts.bore!;
      bore.diameter = snap.diameter as number;
      bore.depth = snap.depth as number | 'throughAll';
      if (snap.hadPresetLayerName) bore.presetLayerName = snap.priorPresetLayerName!; else delete bore.presetLayerName;
      if (snap.hadToolNumber) bore.toolNumber = snap.priorToolNumber!; else delete bore.toolNumber;
      if (snap.hadSpeed) bore.speed = snap.priorSpeed!; else delete bore.speed;
    }
    if (this.opts.opfs) await this.persist();
    useAppStore.getState().boreCacheInvalidator?.([this.opts.partPath]);
  }

  private async persist(): Promise<void> {
    const opfs = this.opts.opfs!;
    const bytes = await opfs.read(this.opts.partPath);
    const proj = await unpackProject(bytes);
    const manifest = proj.manifest as { document: Record<string, unknown> };
    const doc = this.opts.doc;
    if (this.kind === 'groove') {
      if (doc.featureTree !== undefined) manifest.document.featureTree = doc.featureTree;
    } else {
      if (doc.bores !== undefined && doc.bores.length > 0) manifest.document.bores = doc.bores;
      else delete manifest.document.bores;
    }
    const packed = await packProject({
      manifest: { ...manifest, formatVersion: CURRENT_FORMAT_VERSION },
      blobs: {},
    });
    await opfs.write(this.opts.partPath, packed);
  }
}

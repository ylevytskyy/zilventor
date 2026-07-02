import type { Command } from './Command';
import type { BoreOp } from '@zilventor/shared';
import { packProject, unpackProject } from '@zilventor/kernel/src/storage/ProjectPacker';
import { CURRENT_FORMAT_VERSION } from '@zilventor/shared';
import { useAppStore } from '../store/useAppStore';

type OpfsRW = { read(p: string): Promise<Uint8Array>; write(p: string, b: Uint8Array): Promise<void> };

/** Snapshotted preset values (ADR 0001) — VALUES, not a preset id/reference, so
 *  the command is decoupled from the preset store: editing the preset later
 *  never changes an already-applied bore. */
interface MachiningPresetValues {
  diameter: number;
  depth: number;
  layerName: string;
  toolNumber?: number;
  speed?: number;
}

interface ApplyMachiningPresetOpts {
  bore: BoreOp;
  values: MachiningPresetValues;
  partPath: string;
  doc: { bores?: BoreOp[] };
  opfs: OpfsRW | null;
}

/**
 * Apply a snapshot of machining-preset values to a single BoreOp: diameter,
 * depth, presetLayerName (from values.layerName), toolNumber, speed.
 * Undoable: revert restores the exact prior field states, including absence
 * of toolNumber/speed/presetLayerName (exactOptionalPropertyTypes).
 */
export class ApplyMachiningPresetCommand implements Command {
  readonly name = 'ApplyMachiningPreset';
  private snapshot: {
    diameter: number;
    depth: number | 'throughAll';
    hadPresetLayerName: boolean; priorPresetLayerName?: string;
    hadToolNumber: boolean; priorToolNumber?: number;
    hadSpeed: boolean; priorSpeed?: number;
  };

  constructor(private opts: ApplyMachiningPresetOpts) {
    const { bore } = opts;
    const snap: Record<string, unknown> = {
      diameter: bore.diameter,
      depth: bore.depth,
      hadPresetLayerName: 'presetLayerName' in bore,
      hadToolNumber: 'toolNumber' in bore,
      hadSpeed: 'speed' in bore,
    };
    if (bore.presetLayerName !== undefined) snap.priorPresetLayerName = bore.presetLayerName;
    if (bore.toolNumber !== undefined) snap.priorToolNumber = bore.toolNumber;
    if (bore.speed !== undefined) snap.priorSpeed = bore.speed;
    this.snapshot = snap as typeof this.snapshot;
  }

  async apply(): Promise<void> {
    const { bore, values } = this.opts;
    bore.diameter = values.diameter;
    bore.depth = values.depth;
    bore.presetLayerName = values.layerName;
    if (values.toolNumber === undefined) delete bore.toolNumber; else bore.toolNumber = values.toolNumber;
    if (values.speed === undefined) delete bore.speed; else bore.speed = values.speed;
    if (this.opts.opfs) await this.persist();
    useAppStore.getState().boreCacheInvalidator?.([this.opts.partPath]);
  }

  async revert(): Promise<void> {
    const { bore } = this.opts;
    const snap = this.snapshot;
    bore.diameter = snap.diameter;
    bore.depth = snap.depth;
    if (snap.hadPresetLayerName) bore.presetLayerName = snap.priorPresetLayerName!; else delete bore.presetLayerName;
    if (snap.hadToolNumber) bore.toolNumber = snap.priorToolNumber!; else delete bore.toolNumber;
    if (snap.hadSpeed) bore.speed = snap.priorSpeed!; else delete bore.speed;
    if (this.opts.opfs) await this.persist();
    useAppStore.getState().boreCacheInvalidator?.([this.opts.partPath]);
  }

  private async persist(): Promise<void> {
    const opfs = this.opts.opfs!;
    const bytes = await opfs.read(this.opts.partPath);
    const proj = await unpackProject(bytes);
    const manifest = proj.manifest as { document: Record<string, unknown> };
    const doc = this.opts.doc;
    if (doc.bores !== undefined && doc.bores.length > 0) {
      manifest.document.bores = doc.bores;
    } else {
      delete manifest.document.bores;
    }
    const packed = await packProject({
      manifest: { ...manifest, formatVersion: CURRENT_FORMAT_VERSION },
      blobs: {},
    });
    await opfs.write(this.opts.partPath, packed);
  }
}

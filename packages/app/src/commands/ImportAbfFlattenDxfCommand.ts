import type { AssemblyDocument, ComponentInstance, PartDocument } from '@zilventor/shared';
import { CURRENT_FORMAT_VERSION } from '@zilventor/shared';
import type { AbfPanelRecord } from '@zilventor/shared/src/dxf/abfPanelExtraction';
import { writeTarGz } from '@zilventor/kernel/src/storage/tarGzipUtil';
import type { Command } from './Command';
import i18n from '../i18n';
import { useAppStore, type ActiveDocument } from '../store/useAppStore';
import { dedupeName } from '../import/dedupeName';
import { buildAbfPanelPart } from './buildAbfPanelPart';
import type { AbfImportGroupSelection } from '../shell/ImportAbfFlattenDxfDialog';

export type OpfsWriteDeleteLike = {
  write(path: string, data: Uint8Array): Promise<void>;
  delete(path: string): Promise<void>;
  listAll(): Promise<string[]>;
};

export type ImportAbfFlattenDxfOpts = {
  /** S1-extracted panel records (one per detected ABF panel root). Parsing the raw DXF
   *  (parseDxf + extractAbfPanels) and deriving the material-group tokens for the S4
   *  dialog happens one layer up, in the orchestration handler — this command consumes
   *  already-extracted records so it stays independently testable, matching the sibling
   *  ExplodeIntoAssemblyCommand/CreateAndPlacePanelCommand precedent (Commands operate on
   *  already-resolved inputs, not raw files). */
  readonly records: readonly AbfPanelRecord[];
  /** S4 dialog-confirmed per-material-group selections, joined to records by groupToken. */
  readonly selections: readonly AbfImportGroupSelection[];
  readonly opfs: OpfsWriteDeleteLike;
  /** Basename (sans extension) of the imported DXF file, threaded from the ribbon handler
   *  (S5) — replaces the 'ABF Import' placeholder assembly name when present. */
  readonly assemblyName?: string;
};

export type ImportAbfFlattenDxfSummary = {
  readonly partsImported: number;
  readonly boresImported: number;
  readonly referenceCircles: number;
  readonly nonRectangularPanels: number;
};

/**
 * Orchestrating command for "Import ABF flatten DXF as named panels" (plan
 * docs/superpowers/plans/2026-07-04-abf-import-as-panels.md, slice S3).
 *
 * Builds one manifest-only PartDocument per S1 record via S2's `buildAbfPanelPart`
 * (joined to its dialog-selected material/thickness by `materialGroup.token`), places
 * each at the assembly origin, and wraps all of them in one brand-new AssemblyDocument —
 * mirroring `ExplodeIntoAssemblyCommand`'s assembly-wrapper skeleton (new AssemblyDocument
 * literal, origin-pose ComponentInstances, atomic-abort rollback) but swapping its
 * `kernel.registerPart`/`saveToBytes` step for S2's manifest-only PartDocument + a direct
 * OPFS write — ABF-imported panels have no B-rep source (2D outline + thickness only,
 * per plan §5) so there is nothing to register with the kernel.
 *
 * Revert: restores the prior active document and deletes every part this run created
 * from OPFS (best-effort) — there is no kernel-side part to unregister.
 */
export class ImportAbfFlattenDxfCommand implements Command {
  readonly name = 'ImportAbfFlattenDxf';
  summary: ImportAbfFlattenDxfSummary | null = null;

  private priorActiveDocument: ActiveDocument | null = null;
  private createdPartPaths: string[] = [];

  constructor(private readonly opts: ImportAbfFlattenDxfOpts) {}

  async apply(): Promise<void> {
    const { records, selections, opfs } = this.opts;
    if (records.length === 0) {
      throw new Error('ImportAbfFlattenDxf: no panels to import');
    }
    const byToken = new Map(selections.map((s) => [s.groupToken, s] as const));

    this.priorActiveDocument = useAppStore.getState().activeDocument;
    this.createdPartPaths = [];

    const existing = (await opfs.listAll())
      .filter((p) => p.endsWith('.zipt'))
      .map((p) => p.replace(/\.zipt$/, ''));
    const allocatedNames: string[] = [];
    const resolveName = (candidate: string): string =>
      dedupeName(candidate, [...existing, ...allocatedNames]);

    const components: ComponentInstance[] = [];
    let boresImported = 0;
    let referenceCircles = 0;
    let nonRectangularPanels = 0;

    try {
      for (const record of records) {
        const sel = byToken.get(record.materialGroup.token);
        if (!sel) {
          throw new Error(
            `ImportAbfFlattenDxf: no dialog selection for material group "${record.materialGroup.token}"`,
          );
        }

        const part = buildAbfPanelPart(record, { materialId: sel.materialId, thickness: sel.thickness });
        const name = resolveName(part.name);
        allocatedNames.push(name);
        const partPath = `${name}.zipt`;
        const bytes = await packPartManifest(part);
        await opfs.write(partPath, bytes);
        this.createdPartPaths.push(partPath);
        components.push(makeOriginInstance(partPath));

        if (!record.rectangular) nonRectangularPanels++;
        for (const c of record.circles) {
          if (c.kind === 'bore') boresImported++;
          else referenceCircles++;
        }
      }
    } catch (err) {
      for (const p of this.createdPartPaths) {
        try { await opfs.delete(p); } catch { /* best-effort */ }
      }
      this.createdPartPaths = [];
      this.priorActiveDocument = null;
      throw err;
    }

    const assembly: AssemblyDocument = {
      id: crypto.randomUUID(),
      name: this.opts.assemblyName ?? 'ABF Import',
      units: 'mm',
      parameters: {},
      components,
      constraints: [],
      groundedComponentPaths: [],
      colors: {},
      bomItemNumbers: {},
      cutListItemNumbers: {},
      colorOverrides: {},
      properties: {},
      materials: [],
      hardware: [],
    };

    this.summary = { partsImported: components.length, boresImported, referenceCircles, nonRectangularPanels };

    useAppStore.getState().setActiveDocument({ kind: 'assembly', document: assembly });
    const message =
      i18n.t('status.importAbf.done', { count: components.length, bores: boresImported, referenceCircles }) +
      (nonRectangularPanels > 0
        ? i18n.t('status.importAbf.nonRectangularSuffix', { count: nonRectangularPanels })
        : '');
    useAppStore.getState().setStatus(message);
  }

  async revert(): Promise<void> {
    useAppStore.getState().setActiveDocument(this.priorActiveDocument);
    for (const p of this.createdPartPaths) {
      try { await this.opts.opfs.delete(p); } catch { /* best-effort */ }
    }
    this.createdPartPaths = [];
    this.priorActiveDocument = null;
  }
}

// ---------- helpers ----------------------------------------------------------

function makeOriginInstance(partPath: string): ComponentInstance {
  return {
    id: `comp-${crypto.randomUUID()}`,
    partPath,
    position: { x: 0, y: 0, z: 0 },
    rotation: { rx: 0, ry: 0, rz: 0 },
    visible: true,
  };
}

async function packPartManifest(part: PartDocument): Promise<Uint8Array> {
  const manifest = { formatVersion: CURRENT_FORMAT_VERSION, kind: 'part' as const, document: part };
  const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest));
  return writeTarGz([{ name: 'manifest.json', data: manifestBytes }]);
}

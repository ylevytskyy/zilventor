/**
 * AddDrawerHandlesCommand — присадка slice 6 (Chunk F).
 *
 * apply():
 *   1. Unpack cabinet .ziasm; filter components for role='drawerFront'.
 *   2. No-op if zero drawerFront components.
 *   3. Build and write hardware/<skuId>.zipt once (idempotent) via buildPullPart.
 *   4. Per front:
 *      a. Read front .zipt → PartDocument → resolve panel dims.
 *      b. Compute 2 handleScrew BoreOps via handleBoreUV (distinct connectorId per bore, §13.4/PC-1).
 *      c. Append bores to front doc, repack, write back.
 *      d. Compute pull pose via handlePullPose (identity quaternion, PC-2).
 *      e. Add a ComponentInstance { role:'drawerHandle' } to cab.components.
 *   5. packAssembly (async) + write cabinet + reloadCabinet.
 *
 * revert():
 *   Restore each modified front .zipt from snapshot.
 *   Restore cabinet bytes from snapshot (removes pull components structurally).
 *   Reload cabinet in store.
 *
 * Mirrors AddDrawerBankCommand discipline:
 *   - opfs and optional kernel received via constructor opts.
 *   - packAssembly is awaited.
 *   - Snapshots for undo taken at apply() start.
 *   - FULL AssemblyDocument seed required in tests (PC-5 / C-6).
 */

import type { Command } from './Command';
import type {
  AssemblyDocument,
  ComponentInstance,
  PartDocument,
} from '@zilventor/shared';
import { CURRENT_FORMAT_VERSION } from '@zilventor/shared';
import { packAssembly, unpackAssembly } from '@zilventor/kernel/src/storage/AssemblyPacker';
import { packProject, unpackProject } from '@zilventor/kernel/src/storage/ProjectPacker';
import { useAppStore } from '../store/useAppStore';
import { handleBoreUV } from '@zilventor/shared/src/hardware/handleScrewMath';
import { handlePullPose } from '@zilventor/shared/src/handlePullMath';
import { buildPullPart, BAR_PULL_SKU } from './buildPullPart';
import { BUILTIN_CATALOG } from '@zilventor/shared/src/hardware/builtinCatalog';

// ─── Types ────────────────────────────────────────────────────────────────────

type OpfsRWD = {
  read(p: string): Promise<Uint8Array>;
  write(p: string, b: Uint8Array): Promise<void>;
  exists?(p: string): Promise<boolean>;
  delete?(p: string): Promise<void>;
};

type KernelPartApi = {
  registerPart(part: PartDocument): Promise<void>;
  deletePart(partId: string): Promise<void>;
};

export interface AddDrawerHandlesOpts {
  /** OPFS path to the cabinet .ziasm file. */
  cabinetPath: string;
  /** Centre-to-centre screw spacing in mm: 96 | 128 | 160. */
  cc: 96 | 128 | 160;
  opfs: OpfsRWD;
  kernel?: KernelPartApi;
  store?: typeof useAppStore;
}

// ─── Command ──────────────────────────────────────────────────────────────────

export class AddDrawerHandlesCommand implements Command {
  readonly name = 'AddDrawerHandles';
  private readonly store: typeof useAppStore;

  // Undo snapshots (filled on first apply)
  private prevCabBytes: Uint8Array | null = null;
  /** frontPath → bytes BEFORE apply() appended handle bores */
  private prevFrontBytes = new Map<string, Uint8Array>();

  constructor(private readonly opts: AddDrawerHandlesOpts) {
    this.store = opts.store ?? useAppStore;
  }

  // ─── apply ──────────────────────────────────────────────────────────────────

  async apply(): Promise<void> {
    const { cabinetPath, cc, opfs, kernel } = this.opts;

    // 1. Unpack cabinet
    const cabBytes = await opfs.read(cabinetPath);
    const cab = await unpackAssembly(cabBytes);

    // 2. Filter for drawer fronts
    const frontComps = cab.components.filter((c) => c.role === 'drawerFront');
    if (frontComps.length === 0) {
      // No-op — nothing to do
      return;
    }

    // 3. Build / write hardware part (idempotent)
    const skuId = BAR_PULL_SKU[cc];
    const hwPath = `hardware/${skuId}.zipt`;
    const { bytes: hwBytes } = await buildPullPart(skuId);
    await opfs.write(hwPath, hwBytes);

    // Look up bbox for pull pose calculation
    const catalogEntry = BUILTIN_CATALOG.find((e) => e.id === skuId);
    if (!catalogEntry) {
      throw new Error(`AddDrawerHandlesCommand: SKU '${skuId}' not in BUILTIN_CATALOG`);
    }
    const bbox = catalogEntry.bboxMm;

    // 4. Snapshot cabinet bytes for revert BEFORE any mutation
    this.prevCabBytes = cabBytes;

    // 5. Process each front
    const newComponents: ComponentInstance[] = [];
    const timestamp = Date.now();

    for (let i = 0; i < frontComps.length; i++) {
      const frontComp = frontComps[i]!;
      const frontPath = frontComp.partPath;

      // 5a. Read + snapshot front bytes
      const frontBytes = await opfs.read(frontPath);
      if (!this.prevFrontBytes.has(frontPath)) {
        this.prevFrontBytes.set(frontPath, frontBytes);
      }

      // 5b. Unpack front doc + resolve panel dims
      const project = await unpackProject(frontBytes);
      const frontDoc = (project.manifest as { document: PartDocument }).document;

      const panelFeature = frontDoc.featureTree?.find(
        (f): f is import('@zilventor/shared').Feature & { kind: 'panel' } =>
          (f as { kind: string }).kind === 'panel',
      );
      if (!panelFeature || panelFeature.kind !== 'panel') {
        // Skip fronts without a panel feature (defensive)
        continue;
      }

      // Resolve ParamOrLiteral → number (only literal supported; param = 0 fallback)
      const resolveParam = (p: { kind: string; value?: number; paramName?: string }): number => {
        if (p.kind === 'literal') return p.value as number;
        // For param refs, look up in frontDoc.parameters
        const paramName = p.paramName as string;
        const param = (frontDoc as { parameters?: Record<string, { value: number }> }).parameters?.[paramName];
        return param?.value ?? 0;
      };

      const frontHeight = resolveParam(panelFeature.length as { kind: string; value?: number; paramName?: string });
      const frontWidth = resolveParam(panelFeature.width as { kind: string; value?: number; paramName?: string });
      const frontThickness = resolveParam(panelFeature.thickness as { kind: string; value?: number; paramName?: string });

      // 5c. Compute handle bores — DISTINCT connectorId per bore, UNIQUE per front (§13.4/PC-1)
      // Use a stable prefix incorporating the front component id and loop index.
      const idPrefix = `hdl-${frontComp.id}-${i}`;
      const [b0, b1] = handleBoreUV({
        frontHeight,
        frontWidth,
        cc,
        idPrefix,
      });

      // 5d. Append bores to front doc and write back
      const updatedFrontDoc: PartDocument = {
        ...frontDoc,
        bores: [...(frontDoc.bores ?? []), b0, b1],
      };
      const packInput: import('@zilventor/kernel/src/storage/ProjectPacker').ProjectArchiveInput = {
        manifest: {
          formatVersion: CURRENT_FORMAT_VERSION,
          kind: 'part' as const,
          document: updatedFrontDoc,
        },
        blobs: project.blobs ?? {},
      };
      // exactOptionalPropertyTypes: only spread textures when present (never assign undefined)
      if (project.textures !== undefined) {
        packInput.textures = project.textures;
      }
      const updatedFrontBytes = await packProject(packInput);
      await opfs.write(frontPath, updatedFrontBytes);

      // 5e. Compute pull pose (PC-2):
      //   frontComp.pose.translation.y = dims.depth (front center per drawerFrontMath line 97)
      //   outwardFaceY = translation.y + frontThickness/2
      //   pullY = outwardFaceY + bbox.w/2  (to sit proud of the outward face)
      const frontTranslation = frontComp.pose?.translation ?? { x: 0, y: 0, z: 0 };
      const pullPose = handlePullPose({
        frontTranslation,
        frontThickness,
        bbox,
      });

      const pullComp: ComponentInstance = {
        id: `DH${timestamp}-${i}`,
        partPath: hwPath,
        position: {
          x: pullPose.translation.x,
          y: pullPose.translation.y,
          z: pullPose.translation.z,
        },
        rotation: { rx: 0, ry: 0, rz: 0 },
        visible: true,
        pose: pullPose,
        role: 'drawerHandle',
      };
      newComponents.push(pullComp);
    }

    // 6. Update cabinet components and write back
    cab.components = [...cab.components, ...newComponents];
    await opfs.write(cabinetPath, await packAssembly(cab, new Uint8Array()));

    // 7. Reload cabinet in store
    await this.reloadCabinet(cabinetPath, cab);
  }

  // ─── revert ─────────────────────────────────────────────────────────────────

  async revert(): Promise<void> {
    const { cabinetPath, opfs } = this.opts;

    // Restore each modified front .zipt to its pre-apply bytes
    for (const [frontPath, bytes] of this.prevFrontBytes) {
      await opfs.write(frontPath, bytes);
    }

    // Restore cabinet bytes (removes pull components structurally)
    if (this.prevCabBytes) {
      await opfs.write(cabinetPath, this.prevCabBytes);
      const cab = await unpackAssembly(this.prevCabBytes);
      await this.reloadCabinet(cabinetPath, cab);
    }
  }

  // ─── Private helpers ─────────────────────────────────────────────────────────

  private async reloadCabinet(cabinetPath: string, cab: AssemblyDocument): Promise<void> {
    const docs = { ...this.store.getState().subAssemblyDocs };
    docs[cabinetPath] = cab;
    this.store.getState().setSubAssemblyDocs(docs);
    this.store.getState().setSolverDirty?.(true);
  }
}

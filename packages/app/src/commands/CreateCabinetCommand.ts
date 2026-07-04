import type {
  AssemblyDocument,
  BaseCabinetParams,
  BlindCornerCabinetParams,
  BoreOp,
  CabinetBuildOutput,
  ComponentInstance,
  CornerCabinetParams,
  DiagonalCornerCabinetParams,
  PanelFeature,
  PartDocument,
} from '@zilventor/shared';
import {
  CURRENT_FORMAT_VERSION,
  buildBaseCabinet,
  buildBlindCornerCabinet,
  buildCornerCabinet,
  buildDiagonalCornerCabinet,
} from '@zilventor/shared';
import { resolveHardwareCatalog } from '@zilventor/shared/src/hardware/resolveCatalog';
import { newPart, addFeature } from '@zilventor/kernel/src/adapter/PartDocument';
import { writeTarGz } from '@zilventor/kernel/src/storage/tarGzipUtil';
import { packAssembly } from '@zilventor/kernel/src/storage/AssemblyPacker';
import type { Command } from './Command';
import type { OpfsLike } from '../assembly/SubAssemblyCache';
import { useAppStore } from '../store/useAppStore';
import { PlaceComponentCommand } from './PlaceComponentCommand';
import { synthesizeHardwarePartBytes } from './synthesizeHardwarePartBytes';

interface OpfsWriteDeleteCapable {
  write(path: string, bytes: Uint8Array): Promise<void>;
  delete?(path: string): Promise<void>;
}

type OpfsArg = OpfsLike & OpfsWriteDeleteCapable;

export type CreateCabinetOpts =
  | { template: 'baseCabinet';           params: BaseCabinetParams;           opfs: OpfsArg }
  | { template: 'cornerCabinet';         params: CornerCabinetParams;         opfs: OpfsArg }
  | { template: 'blindCornerCabinet';    params: BlindCornerCabinetParams;    opfs: OpfsArg }
  | { template: 'diagonalCornerCabinet'; params: DiagonalCornerCabinetParams; opfs: OpfsArg };

const SUFFIX_LIMIT = 999;

export class CreateCabinetCommand implements Command {
  readonly name = 'CreateCabinet';
  private writtenFiles: string[] = [];
  private placeCommand: PlaceComponentCommand | null = null;
  private resolvedName: string | null = null;

  constructor(private readonly opts: CreateCabinetOpts) {}

  async apply(): Promise<void> {
    const state = useAppStore.getState();
    const asm = state.activeAssembly;
    if (!asm) throw new Error('NO_ACTIVE_ASSEMBLY');

    const finalName = await this.resolveCollisionFreeName(this.opts.params.name);
    this.resolvedName = finalName;

    let built: CabinetBuildOutput;
    if (this.opts.template === 'cornerCabinet') {
      built = buildCornerCabinet({ ...this.opts.params, name: finalName }, asm.materials);
    } else if (this.opts.template === 'blindCornerCabinet') {
      built = buildBlindCornerCabinet({ ...this.opts.params, name: finalName }, asm.materials);
    } else if (this.opts.template === 'diagonalCornerCabinet') {
      built = buildDiagonalCornerCabinet({ ...this.opts.params, name: finalName }, asm.materials);
    } else {
      built = buildBaseCabinet({ ...this.opts.params, name: finalName }, asm.materials);
    }

    try {
      for (const p of built.panels) {
        const path = `${finalName} - ${p.fileNameSuffix}.zipt`;
        const cupBores = built.doorBores?.find(d => d.doorSuffix === p.fileNameSuffix)?.cupBores;
        const plateBores = built.plateBores?.find(d => d.panelSuffix === p.fileNameSuffix)?.plateBores;
        const bores: BoreOp[] = [...(cupBores ?? []), ...(plateBores ?? [])];
        const bytes = await this.packPanelPart(
          p.panel,
          p.fileNameSuffix,
          asm,
          bores.length > 0 ? bores : undefined,
        );
        await this.opts.opfs.write(path, bytes);
        this.writtenFiles.push(path);
      }

      const hardwareComponents: Array<{ partPath: string }> = [];
      if (built.hardware) {
        const catalog = resolveHardwareCatalog(asm);
        for (const hw of built.hardware) {
          const hwPath = `hardware/${hw.skuId}.zipt`;
          if (!(await this.opts.opfs.exists(hwPath))) {
            const entry = catalog.find(e => e.id === hw.skuId);
            if (entry) {
              const bytes = await synthesizeHardwarePartBytes(entry);
              await this.opts.opfs.write(hwPath, bytes);
              this.writtenFiles.push(hwPath);
            }
          }
          for (let i = 0; i < hw.count; i++) {
            hardwareComponents.push({ partPath: hwPath });
          }
        }
      }

      const ziasmPath = `${finalName}.ziasm`;
      const cabinetDoc = this.buildCabinetAssembly(finalName, built, asm, hardwareComponents);
      const ziasmBytes = await packAssembly(cabinetDoc, new Uint8Array());
      await this.opts.opfs.write(ziasmPath, ziasmBytes);
      this.writtenFiles.push(ziasmPath);

      this.placeCommand = new PlaceComponentCommand({ partPath: ziasmPath, opfs: this.opts.opfs });
      await this.placeCommand.apply();
    } catch (err) {
      await this.deleteWrittenFiles();
      throw err;
    }
  }

  async revert(): Promise<void> {
    if (this.placeCommand) {
      await this.placeCommand.revert();
      this.placeCommand = null;
    }
    await this.deleteWrittenFiles();
  }

  private async deleteWrittenFiles(): Promise<void> {
    if (typeof this.opts.opfs.delete !== 'function') return;
    for (const p of [...this.writtenFiles].reverse()) {
      try { await this.opts.opfs.delete(p); } catch { /* best-effort */ }
    }
    this.writtenFiles = [];
  }

  private async resolveCollisionFreeName(base: string): Promise<string> {
    const trimmed = base.trim();
    if (!(await this.opts.opfs.exists(`${trimmed}.ziasm`))) return trimmed;
    const match = /^(.*?)(?:\s+(\d+))?$/.exec(trimmed);
    const stem = match?.[1] ?? trimmed;
    const startN = match?.[2] ? Number(match[2]) + 1 : 2;
    for (let n = startN; n <= SUFFIX_LIMIT; n++) {
      const candidate = `${stem} ${n}`;
      if (!(await this.opts.opfs.exists(`${candidate}.ziasm`))) return candidate;
    }
    return `${stem} ${Date.now()}`;
  }

  private async packPanelPart(
    panel: PanelFeature,
    nameSuffix: string,
    asm: AssemblyDocument,
    bores?: BoreOp[],
  ): Promise<Uint8Array> {
    const basePart = newPart(`${this.resolvedName} - ${nameSuffix}`);
    const partWithMaterials: PartDocument = {
      ...basePart,
      materials: [...asm.materials],
    };
    const partWithPanel = addFeature(partWithMaterials, panel);
    const partDoc = bores && bores.length > 0
      ? { ...partWithPanel, bores }
      : partWithPanel;
    const manifest = {
      formatVersion: CURRENT_FORMAT_VERSION,
      kind: 'part' as const,
      document: partDoc,
    };
    const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest));
    return writeTarGz([{ name: 'manifest.json', data: manifestBytes }]);
  }

  private buildCabinetAssembly(
    cabinetName: string,
    built: CabinetBuildOutput,
    asm: AssemblyDocument,
    hardwareComponents: Array<{ partPath: string }>,
  ): AssemblyDocument {
    const panelComps: ComponentInstance[] = built.layout.map((c, i) => ({
      id: `C${i + 1}`,
      partPath: `${cabinetName} - ${c.fileNameSuffix}.zipt`,
      position: { x: c.position.x, y: c.position.y, z: c.position.z },
      rotation: { rx: c.rotation.rx, ry: c.rotation.ry, rz: c.rotation.rz },
      visible: true,
      role: built.panels.find((p) => p.fileNameSuffix === c.fileNameSuffix)!.role,
      ...(c.pose ? { pose: c.pose } : {}),
    }));
    const hwComps: ComponentInstance[] = hardwareComponents.map((hw, i) => ({
      id: `HW${i + 1}`,
      partPath: hw.partPath,
      position: { x: 0, y: 0, z: 0 },
      rotation: { rx: 0, ry: 0, rz: 0 },
      visible: false,
    }));
    const components = [...panelComps, ...hwComps];
    return {
      id: `A${Date.now()}`,
      name: cabinetName,
      units: 'mm',
      parameters: {},
      properties: {},
      components,
      constraints: [],
      groundedComponentPaths: components.length > 0 ? [[components[0]!.id]] : [],
      colors: {},
      bomItemNumbers: {},
      cutListItemNumbers: {},
      colorOverrides: {},
      materials: [...asm.materials],
      hardware: [],
    };
  }
}

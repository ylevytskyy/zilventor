import type {
  AssemblyDocument,
  BaseCabinetParams,
  CabinetBuildOutput,
  ComponentInstance,
  PanelFeature,
  PartDocument,
} from '@zilventor/shared';
import { CURRENT_FORMAT_VERSION, buildBaseCabinet } from '@zilventor/shared';
import { newPart, addFeature } from '@zilventor/kernel/src/adapter/PartDocument';
import { writeTarGz } from '@zilventor/kernel/src/storage/tarGzipUtil';
import { packAssembly } from '@zilventor/kernel/src/storage/AssemblyPacker';
import type { Command } from './Command';
import type { OpfsLike } from '../assembly/SubAssemblyCache';
import { useAppStore } from '../store/useAppStore';
import { PlaceComponentCommand } from './PlaceComponentCommand';

interface OpfsWriteDeleteCapable {
  write(path: string, bytes: Uint8Array): Promise<void>;
  delete?(path: string): Promise<void>;
}

export type CreateCabinetOpts = {
  template: 'baseCabinet';
  params: BaseCabinetParams;
  opfs: OpfsLike & OpfsWriteDeleteCapable;
};

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
    const params = { ...this.opts.params, name: finalName };

    const built = buildBaseCabinet(params, asm.materials);

    try {
      for (const p of built.panels) {
        const path = `${finalName} - ${p.fileNameSuffix}.zipt`;
        const bytes = await this.packPanelPart(p.panel, p.fileNameSuffix, asm);
        await this.opts.opfs.write(path, bytes);
        this.writtenFiles.push(path);
      }

      const ziasmPath = `${finalName}.ziasm`;
      const cabinetDoc = this.buildCabinetAssembly(finalName, built, asm);
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
  ): Promise<Uint8Array> {
    const basePart = newPart(`${this.resolvedName} - ${nameSuffix}`);
    const partWithMaterials: PartDocument = {
      ...basePart,
      materials: [...asm.materials],
    };
    const partWithPanel = addFeature(partWithMaterials, panel);
    const manifest = {
      formatVersion: CURRENT_FORMAT_VERSION,
      kind: 'part' as const,
      document: partWithPanel,
    };
    const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest));
    return writeTarGz([{ name: 'manifest.json', data: manifestBytes }]);
  }

  private buildCabinetAssembly(
    cabinetName: string,
    built: CabinetBuildOutput,
    asm: AssemblyDocument,
  ): AssemblyDocument {
    const components: ComponentInstance[] = built.layout.map((c, i) => ({
      id: `C${i + 1}`,
      partPath: `${cabinetName} - ${c.fileNameSuffix}.zipt`,
      position: { x: c.position.x, y: c.position.y, z: c.position.z },
      rotation: { rx: c.rotation.rx, ry: c.rotation.ry, rz: c.rotation.rz },
      visible: true,
    }));
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
    };
  }
}

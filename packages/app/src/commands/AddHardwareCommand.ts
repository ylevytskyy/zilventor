import type { Command } from './Command';
import { resolveHardwareCatalog } from '@zilventor/shared/src/hardware/resolveCatalog';
import { unpackProject } from '@zilventor/kernel/src/storage/ProjectPacker';
import { PlaceComponentCommand } from './PlaceComponentCommand';
import { useAppStore } from '../store/useAppStore';
import { synthesizeHardwarePartBytes } from './synthesizeHardwarePartBytes';

// Mirrors the real Opfs surface (`packages/kernel/src/storage/Opfs.ts`). The
// `listAll()` method is required for the project-wide refcount scan in revert().
interface OpfsForHardware {
  exists(path: string): Promise<boolean>;
  read(path: string): Promise<Uint8Array>;
  write(path: string, bytes: Uint8Array): Promise<void>;
  delete(path: string): Promise<void>;
  listAll(): Promise<string[]>;
}

export class HardwareSkuNotFoundError extends Error {
  constructor(skuId: string) {
    super(`HardwareSkuNotFound: ${skuId}`);
    this.name = 'HardwareSkuNotFoundError';
  }
}

export type AddHardwareOpts = {
  skuId: string;
  opfs: OpfsForHardware;
  store?: typeof useAppStore;
};

export class AddHardwareCommand implements Command {
  readonly name = 'AddHardware';
  private didWriteFile = false;
  private placeCommand: PlaceComponentCommand | null = null;
  private readonly store: typeof useAppStore;

  constructor(private readonly opts: AddHardwareOpts) {
    this.store = opts.store ?? useAppStore;
  }

  private get path(): string {
    return `hardware/${this.opts.skuId}.zipt`;
  }

  async apply(): Promise<void> {
    const activeDoc = this.store.getState().activeAssembly ?? this.store.getState().activePart;
    const catalogEntry = resolveHardwareCatalog(activeDoc).find((e) => e.id === this.opts.skuId);
    if (!catalogEntry) throw new HardwareSkuNotFoundError(this.opts.skuId);

    const { path } = this;

    if (!(await this.opts.opfs.exists(path))) {
      const bytes = await synthesizeHardwarePartBytes(catalogEntry);
      await this.opts.opfs.write(path, bytes);
      this.didWriteFile = true;
    }

    try {
      this.placeCommand = new PlaceComponentCommand({ partPath: path, opfs: this.opts.opfs as never });
      await this.placeCommand.apply();
    } catch (err) {
      if (this.didWriteFile) {
        await this.opts.opfs.delete(path);
        this.didWriteFile = false;
      }
      throw err;
    }
  }

  async revert(): Promise<void> {
    if (this.placeCommand) {
      await this.placeCommand.revert();
      this.placeCommand = null;
    }
    if (this.didWriteFile) {
      const stillReferenced = await this.isFileReferenced(this.path);
      if (!stillReferenced) {
        await this.opts.opfs.delete(this.path);
      }
      this.didWriteFile = false;
    }
  }

  // Spec §5.2: project-wide reference count. Checks the in-memory active
  // assembly first (most current state — autosave may not have flushed),
  // then scans every .ziasm file in OPFS for sibling references.
  private async isFileReferenced(filePath: string): Promise<boolean> {
    const asm = this.store.getState().activeAssembly;
    if (asm?.components.some((c) => c.partPath === filePath)) return true;

    const allFiles = await this.opts.opfs.listAll();
    for (const f of allFiles) {
      if (!f.endsWith('.ziasm')) continue;
      try {
        const bytes = await this.opts.opfs.read(f);
        const project = await unpackProject(bytes);
        const manifest = project.manifest as {
          document?: { components?: Array<{ partPath: string }> };
        } | null;
        const components = manifest?.document?.components ?? [];
        if (components.some((c) => c.partPath === filePath)) return true;
      } catch {
        // Unreadable / non-manifest .ziasm — skip silently. Conservative: if
        // we can't read it, we don't claim a reference exists.
      }
    }
    return false;
  }

}


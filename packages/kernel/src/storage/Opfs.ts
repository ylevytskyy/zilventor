export type OpfsRoot = FileSystemDirectoryHandle;

/**
 * Thin wrapper over the OPFS API (via `FileSystemDirectoryHandle`).
 *
 * Use `Opfs.forNavigator()` in a browser/worker to get the real OPFS root.
 * Use `Opfs.forRoot(root)` to inject a custom root — useful for tests with a stub.
 */
export class Opfs {
  private constructor(private root: OpfsRoot) {}

  static async forNavigator(): Promise<Opfs> {
    const root = await navigator.storage.getDirectory();
    return new Opfs(root);
  }

  static forRoot(root: OpfsRoot): Opfs {
    return new Opfs(root);
  }

  private async resolveHandle(path: string, create: boolean): Promise<{ dir: FileSystemDirectoryHandle; name: string }> {
    const parts = path.split('/').filter((p) => p.length > 0);
    if (parts.length === 0) throw new Error(`invalid path: ${path}`);
    let dir: FileSystemDirectoryHandle = this.root;
    for (let i = 0; i < parts.length - 1; i++) {
      dir = await dir.getDirectoryHandle(parts[i]!, { create });
    }
    return { dir, name: parts[parts.length - 1]! };
  }

  async write(path: string, data: Uint8Array): Promise<void> {
    const { dir, name } = await this.resolveHandle(path, true);
    const file = await dir.getFileHandle(name, { create: true });
    const writable = await file.createWritable();
    await writable.write(data as unknown as FileSystemWriteChunkType);
    await writable.close();
  }

  async read(path: string): Promise<Uint8Array> {
    const { dir, name } = await this.resolveHandle(path, false);
    const file = await dir.getFileHandle(name);
    const f = await file.getFile();
    return new Uint8Array(await f.arrayBuffer());
  }

  async exists(path: string): Promise<boolean> {
    try {
      const { dir, name } = await this.resolveHandle(path, false);
      await dir.getFileHandle(name);
      return true;
    } catch {
      return false;
    }
  }

  async delete(path: string): Promise<void> {
    const { dir, name } = await this.resolveHandle(path, false);
    await dir.removeEntry(name);
  }

  async listAll(): Promise<string[]> {
    const out: string[] = [];
    const walk = async (d: FileSystemDirectoryHandle, prefix: string): Promise<void> => {
      for await (const [name, h] of d as unknown as AsyncIterable<[string, FileSystemHandle]>) {
        if (h.kind === 'file') {
          out.push(prefix + name);
        } else {
          await walk(h as FileSystemDirectoryHandle, prefix + name + '/');
        }
      }
    };
    await walk(this.root, '');
    return out;
  }
}

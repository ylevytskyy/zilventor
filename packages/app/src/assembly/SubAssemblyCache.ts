import type { AssemblyDocument } from '@zilventor/shared';
import { unpackAssembly } from '@zilventor/kernel/src/storage/AssemblyPacker';

export type SubAssemblyEntry =
  | { kind: 'ok'; doc: AssemblyDocument; partPath: string }
  | { kind: 'missing'; partPath: string; message: string }
  | { kind: 'parse'; partPath: string; message: string }
  | { kind: 'cycle'; partPath: string; message: string };

export interface OpfsLike {
  read(path: string): Promise<Uint8Array>;
  exists(path: string): Promise<boolean>;
}

export class SubAssemblyCache {
  private entries = new Map<string, SubAssemblyEntry>();
  private diags: Array<{ kind: 'cycle' | 'missing' | 'parse'; partPath: string; message: string }> = [];
  constructor(private readonly opfs: OpfsLike) {}

  async loadSubAssembly(partPath: string): Promise<SubAssemblyEntry> {
    const cached = this.entries.get(partPath);
    if (cached) return cached;
    const fresh = await this.unpack(partPath);
    this.entries.set(partPath, fresh);
    return fresh;
  }

  invalidate(partPath: string): void {
    this.entries.delete(partPath);
  }

  invalidateAll(): void {
    this.entries.clear();
  }

  get(partPath: string): SubAssemblyEntry | undefined {
    return this.entries.get(partPath);
  }

  diagnostics(): Array<{ kind: 'cycle' | 'missing' | 'parse'; partPath: string; message: string }> {
    return this.diags.slice();
  }

  clearDiagnostics(): void {
    this.diags = [];
  }

  async loadSubAssemblyTree(rootDoc: AssemblyDocument): Promise<void> {
    await this.walkTree(rootDoc, new Set<string>());
  }

  private async walkTree(doc: AssemblyDocument, loadStack: Set<string>): Promise<void> {
    for (const c of doc.components) {
      if (!c.partPath.endsWith('.ziasm')) continue;
      if (loadStack.has(c.partPath)) {
        this.diags.push({ kind: 'cycle', partPath: c.partPath, message: `cycle detected: ${c.partPath}` });
        continue;
      }
      let entry = this.entries.get(c.partPath);
      if (!entry || entry.kind !== 'ok') {
        entry = await this.unpack(c.partPath);
        this.entries.set(c.partPath, entry);
        if (entry.kind === 'missing' || entry.kind === 'parse') {
          this.diags.push({ kind: entry.kind, partPath: entry.partPath, message: entry.message });
        }
      }
      if (entry.kind === 'ok') {
        const next = new Set(loadStack);
        next.add(c.partPath);
        await this.walkTree(entry.doc, next);
      }
    }
  }

  private async unpack(partPath: string): Promise<SubAssemblyEntry> {
    if (!(await this.opfs.exists(partPath))) {
      return { kind: 'missing', partPath, message: `not in OPFS: ${partPath}` };
    }
    try {
      const bytes = await this.opfs.read(partPath);
      const doc = await unpackAssembly(bytes);
      return { kind: 'ok', doc, partPath };
    } catch (err) {
      return { kind: 'parse', partPath, message: err instanceof Error ? err.message : String(err) };
    }
  }
}

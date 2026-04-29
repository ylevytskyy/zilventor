import type { AssemblyConstraint, AssemblyDocument } from '@zilventor/shared';
import { unpackAssembly } from '@zilventor/kernel/src/storage/AssemblyPacker';
import type { Pose } from './walkers/flattenForSolver';
import { flattenForSolver } from './walkers/flattenForSolver';

export type SubAssemblyEntry =
  | { kind: 'ok'; doc: AssemblyDocument; partPath: string; innerStaticPoses?: Map<string, Pose> }
  | { kind: 'missing'; partPath: string; message: string }
  | { kind: 'parse'; partPath: string; message: string }
  | { kind: 'cycle'; partPath: string; message: string };

export interface OpfsLike {
  read(path: string): Promise<Uint8Array>;
  exists(path: string): Promise<boolean>;
}

export interface SolverBridge {
  solveAssembly(input: {
    unknowns: Pose[];
    constraints: AssemblyConstraint[];
    pathToUnknown: Map<string, number>;
    grounded?: Set<string>;
    paramValues?: Record<string, number>;
  }): Promise<{ poses: Pose[]; diagnostics: { dof: number; residual: number } }>;
}

export class SubAssemblyCache {
  private entries = new Map<string, SubAssemblyEntry>();
  private inflight = new Map<string, Promise<SubAssemblyEntry>>();
  private diags: Array<{ kind: 'cycle' | 'missing' | 'parse'; partPath: string; message: string }> = [];
  constructor(
    private readonly opfs: OpfsLike,
    private readonly solver: SolverBridge | null = null,
  ) {}

  async loadSubAssembly(partPath: string): Promise<SubAssemblyEntry> {
    const cached = this.entries.get(partPath);
    if (cached) return cached;
    let p = this.inflight.get(partPath);
    if (!p) {
      p = this.unpack(partPath).then((e) => {
        this.entries.set(partPath, e);
        this.inflight.delete(partPath);
        return e;
      });
      this.inflight.set(partPath, p);
    }
    return p;
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
    this.clearDiagnostics();
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
        entry = await this.loadSubAssembly(c.partPath);
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
    let doc: AssemblyDocument;
    try {
      doc = await unpackAssembly(await this.opfs.read(partPath));
    } catch (err) {
      return { kind: 'parse', partPath, message: err instanceof Error ? err.message : String(err) };
    }
    const okBase: SubAssemblyEntry = { kind: 'ok', doc, partPath };
    try {
      const inner = await this.maybePreSolve(doc);
      if (inner) return { ...okBase, innerStaticPoses: inner };
    } catch (err) {
      this.diags.push({
        kind: 'parse',
        partPath,
        message: `pre-solve failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
    return okBase;
  }

  private async maybePreSolve(doc: AssemblyDocument): Promise<Map<string, Pose> | undefined> {
    if (!this.solver) return undefined;
    // Pre-solve treats deeper sub-asm references as opaque — we only need
    // the static poses for THIS sub-asm's top-level layout.
    const subInput = flattenForSolver(doc, { get: () => undefined });
    const r = await this.solver.solveAssembly({
      unknowns: subInput.unknowns,
      constraints: subInput.constraints,
      pathToUnknown: subInput.pathToUnknown,
    });
    if (r.poses.length !== subInput.unknowns.length) {
      throw new Error(`pre-solve returned ${r.poses.length} poses for ${subInput.unknowns.length} unknowns`);
    }
    const poses = new Map<string, Pose>();
    for (const [k, idx] of subInput.pathToUnknown) {
      poses.set(k, r.poses[idx]!);
    }
    return poses;
  }
}

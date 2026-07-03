import { parsePartJson, parseAssemblyJson } from './inventorJsonSchema';
import { mapInputPathToOpfs } from './resolveOutputPaths';
import { buildDependencyGraph, type GraphNode } from './dependencyGraph';
import { buildAssemblyDocument } from './buildAssemblyDocument';
import { packAssembly } from '@zilventor/kernel/src/storage/AssemblyPacker';
import type { Feature } from '@zilventor/shared';

export type ImportConflict = 'overwrite' | 'skip' | 'cancel-on-conflict';

export type ImportSummary = {
  partsImported: number;
  assembliesImported: number;
  skipped: number;
  errors: { path: string; error: string }[];
};

type KernelStub = {
  importStep(p: { stepBytes: ArrayBuffer; partName: string }): Promise<{
    brepBlobId: string; triangleCount: number;
    boundingBox: readonly [number, number, number, number, number, number];
    faceCount: number;
    /** BRepCheck_Analyzer topology-only validity (D2/D7) of the imported
     *  compound. Threaded onto the ImportedFeature below. */
    isManifold: boolean;
  }>;
  createPart(n: string): Promise<string>;
  addFeature(partId: string, f: Feature): Promise<void>;
  saveToBytes(partId: string): Promise<Uint8Array>;
  deletePart(partId: string): Promise<void>;
};

export type RunImportArgs = {
  input: FileSystemDirectoryHandle;
  target: FileSystemDirectoryHandle;
  conflict: ImportConflict;
  kernel: KernelStub;
  onProgress?: (p: { current: number; total: number; path: string }) => void;
  signal?: AbortSignal;
};

type DiscoveredPart = { kind: 'part'; relPath: string; bytesJson: Uint8Array; bytesStep: Uint8Array | null };
type DiscoveredAssembly = { kind: 'assembly'; relPath: string; bytesJson: Uint8Array };
type DiscoveredFile = DiscoveredPart | DiscoveredAssembly;

async function walkDir(dir: FileSystemDirectoryHandle): Promise<DiscoveredFile[]> {
  const partJsonsByDir = new Map<string, { name: string; bytes: Uint8Array }[]>();
  const asmJsonsByDir = new Map<string, { name: string; bytes: Uint8Array }[]>();
  const stepBytesByDir = new Map<string, Map<string, Uint8Array>>();

  async function recurse(d: FileSystemDirectoryHandle, p: string): Promise<void> {
    for await (const [name, handle] of (d as any).entries()) {
      if (handle.kind === 'directory') {
        const sub = p ? `${p}/${name}` : name;
        await recurse(handle as FileSystemDirectoryHandle, sub);
      } else {
        const file = await (handle as FileSystemFileHandle).getFile();
        const bytes = new Uint8Array(await file.arrayBuffer());
        if (name.endsWith('.ipt.json')) {
          const arr = partJsonsByDir.get(p) ?? [];
          arr.push({ name, bytes });
          partJsonsByDir.set(p, arr);
        } else if (name.endsWith('.iam.json')) {
          const arr = asmJsonsByDir.get(p) ?? [];
          arr.push({ name, bytes });
          asmJsonsByDir.set(p, arr);
        } else if (name.endsWith('.step')) {
          const m = stepBytesByDir.get(p) ?? new Map<string, Uint8Array>();
          m.set(name, bytes);
          stepBytesByDir.set(p, m);
        }
      }
    }
  }
  await recurse(dir, '');

  const out: DiscoveredFile[] = [];
  for (const [p, arr] of partJsonsByDir) {
    const stepMap = stepBytesByDir.get(p) ?? new Map<string, Uint8Array>();
    for (const { name, bytes } of arr) {
      const stem = name.slice(0, -'.ipt.json'.length);
      const stepBytes = stepMap.get(`${stem}.step`) ?? null;
      out.push({ kind: 'part', relPath: p ? `${p}/${name}` : name, bytesJson: bytes, bytesStep: stepBytes });
    }
  }
  for (const [p, arr] of asmJsonsByDir) {
    for (const { name, bytes } of arr) {
      out.push({ kind: 'assembly', relPath: p ? `${p}/${name}` : name, bytesJson: bytes });
    }
  }
  return out;
}

async function getOrCreateDir(root: FileSystemDirectoryHandle, segments: string[]): Promise<FileSystemDirectoryHandle> {
  let cur = root;
  for (const s of segments) cur = await cur.getDirectoryHandle(s, { create: true });
  return cur;
}

async function writeBytes(dir: FileSystemDirectoryHandle, name: string, bytes: Uint8Array): Promise<void> {
  const h = await dir.getFileHandle(name, { create: true });
  const w = await (h as any).createWritable();
  await w.write(bytes);
  await w.close();
}

async function fileExists(dir: FileSystemDirectoryHandle, name: string): Promise<boolean> {
  try { await dir.getFileHandle(name, { create: false }); return true; }
  catch { return false; }
}

function siblingResolve(asmRelPath: string, ref: string): string | null {
  if (!ref.startsWith('./')) return null;
  const dir = asmRelPath.split('/').slice(0, -1).join('/');
  const refName = ref.slice(2);
  return dir ? `${dir}/${refName}` : refName;
}

function safeIdSuffix(s: string): string {
  return s.replace(/[^a-zA-Z0-9]/g, '_');
}

export async function runInventorImport(args: RunImportArgs): Promise<ImportSummary> {
  const summary: ImportSummary = { partsImported: 0, assembliesImported: 0, skipped: 0, errors: [] };
  const discovered = await walkDir(args.input);

  const partsByPath = new Map<string, DiscoveredPart>();
  const parsedAssemblies = new Map<string, ReturnType<typeof parseAssemblyJson>>();
  const graphNodes: GraphNode[] = [];
  for (const d of discovered) {
    if (d.kind === 'part') {
      partsByPath.set(d.relPath, d);
      graphNodes.push({ inputRelPath: d.relPath, kind: 'part', refs: [] });
    } else {
      const parsed = parseAssemblyJson(JSON.parse(new TextDecoder().decode(d.bytesJson)));
      parsedAssemblies.set(d.relPath, parsed);
      const refs: string[] = [];
      if (parsed.ok) {
        for (const occ of parsed.value.occurrences) {
          if (occ.ref) {
            const resolved = siblingResolve(d.relPath, occ.ref);
            if (resolved) refs.push(resolved);
          }
        }
      }
      graphNodes.push({ inputRelPath: d.relPath, kind: 'assembly', refs });
    }
  }

  const graph = buildDependencyGraph(graphNodes);
  if (!graph.ok) throw new Error(`Import aborted: ${graph.error}`);

  const opfsPathByInput = new Map<string, string>();
  for (const node of graph.value.topoOrder) {
    const r = mapInputPathToOpfs(node.inputRelPath);
    if (!r.ok) {
      summary.errors.push({ path: node.inputRelPath, error: r.error });
      continue;
    }
    opfsPathByInput.set(node.inputRelPath, r.value.path);
  }

  let i = 0;
  for (const node of graph.value.topoOrder) {
    if (args.signal?.aborted) break;
    i++;
    args.onProgress?.({ current: i, total: graph.value.topoOrder.length, path: node.inputRelPath });

    const opfsPath = opfsPathByInput.get(node.inputRelPath);
    if (!opfsPath) continue;

    const segs = opfsPath.split('/');
    const fileName = segs.pop()!;
    const dir = await getOrCreateDir(args.target, segs);

    if (await fileExists(dir, fileName)) {
      if (args.conflict === 'skip') { summary.skipped++; continue; }
      if (args.conflict === 'cancel-on-conflict') {
        summary.errors.push({ path: node.inputRelPath, error: `target already exists: ${opfsPath}` });
        return summary;
      }
    }

    if (node.kind === 'part') {
      try {
        const partRecord = partsByPath.get(node.inputRelPath)!;
        if (!partRecord.bytesStep) throw new Error(`STEP file missing for ${node.inputRelPath}`);
        const parsed = parsePartJson(JSON.parse(new TextDecoder().decode(partRecord.bytesJson)));
        if (!parsed.ok) throw new Error(parsed.error);
        const stepBuf = partRecord.bytesStep.buffer.slice(
          partRecord.bytesStep.byteOffset,
          partRecord.bytesStep.byteOffset + partRecord.bytesStep.byteLength,
        );
        const importResult = await args.kernel.importStep({ stepBytes: stepBuf as ArrayBuffer, partName: parsed.value.name });
        const partId = await args.kernel.createPart(parsed.value.name);
        try {
          const importedFeatureId = `imp-${safeIdSuffix(node.inputRelPath)}`;
          await args.kernel.addFeature(partId, {
            kind: 'imported', id: importedFeatureId,
            sourceStep: parsed.value.step, bodyRef: importResult.brepBlobId,
            isManifold: importResult.isManifold,
          });
          const bytes = await args.kernel.saveToBytes(partId);
          await writeBytes(dir, fileName, bytes);
          summary.partsImported++;
        } finally {
          await args.kernel.deletePart(partId);
        }
      } catch (e) {
        summary.errors.push({ path: node.inputRelPath, error: (e as Error).message });
      }
    } else {
      try {
        const parsed = parsedAssemblies.get(node.inputRelPath)!;
        if (!parsed.ok) throw new Error(parsed.error);
        const refResolution = new Map<string, string>();
        for (const occ of parsed.value.occurrences) {
          if (!occ.ref) continue;
          const refRel = siblingResolve(node.inputRelPath, occ.ref);
          if (!refRel) continue;
          const refOpfs = opfsPathByInput.get(refRel);
          if (refOpfs) refResolution.set(occ.ref, refOpfs);
        }
        const asmId = `asm-${safeIdSuffix(node.inputRelPath)}`;
        const doc = buildAssemblyDocument({ asmJson: parsed.value, refResolution, asmId });
        const bytes = await packAssembly(doc, new Uint8Array());
        await writeBytes(dir, fileName, bytes);
        summary.assembliesImported++;
      } catch (e) {
        summary.errors.push({ path: node.inputRelPath, error: (e as Error).message });
      }
    }
  }

  return summary;
}

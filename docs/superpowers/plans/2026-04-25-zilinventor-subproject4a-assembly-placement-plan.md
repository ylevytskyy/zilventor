# Sub-project 4a — Assembly Component Placement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the first piece of Sub-project 4 — `AssemblyDocument` + `ComponentInstance` types, `.ziasm` storage, multi-mesh viewport rendering with shared geometry, custom Place Component dialog with thumbnail grid, browser-pane assembly view, Assembly ribbon tab, and full create/edit/delete component round-trip.

**Architecture:** New `AssemblyDocument` doc type lives alongside `PartDocument` via a discriminated `ProjectFile.kind` union. `AssemblyPacker` mirrors `ProjectPacker` for `.ziasm` storage. The store's `activePart` field is renamed to `activeDocument: { kind: 'part' | 'assembly', document }` with shim for backwards-compat. Viewport gains `setComponentMeshes(...)` for multi-mesh diff-rendering with shared `BufferGeometry`. UI is one `PlaceComponentDialog` (thumbnail grid) + one `EditComponentDialog` (position + rotation) + a new Assembly ribbon tab. Components reference parts by OPFS path; missing parts render a red wireframe placeholder.

**Tech Stack:** React + Zustand + three.js, existing OPFS / `Opfs.ts` storage, existing kernel-side `Tessellator.ts`, existing `unpackPart` / `packPart` from `ProjectPacker.ts`.

**Spec:** `docs/superpowers/specs/2026-04-25-subproject-4a-assembly-placement-design.md`

**Total tasks: 30.** Test-driven throughout. One commit per task unless noted.

---

## Phase 1 — Shared layer

### Task 1: `ComponentInstance` + `AssemblyDocument` + `ProjectFile` discriminator

**Files:**
- Modify: `packages/shared/src/types.ts`
- Test: `packages/shared/src/__tests__/assembly-document.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/shared/src/__tests__/assembly-document.spec.ts
import { describe, it, expect } from 'vitest';
import type {
  ComponentInstance, AssemblyDocument, ProjectFile, PartDocument,
} from '../types';

describe('AssemblyDocument', () => {
  it('ComponentInstance has the documented shape', () => {
    const c: ComponentInstance = {
      id: 'C1',
      partPath: 'parts/leg.zipt',
      position: { x: 0, y: 0, z: 0 },
      rotation: { rx: 0, ry: 0, rz: 0 },
      visible: true,
    };
    expect(c.id).toBe('C1');
  });

  it('AssemblyDocument has the documented shape', () => {
    const a: AssemblyDocument = {
      id: 'A1', name: 'cabinet', units: 'mm', parameters: {},
      components: [],
    };
    expect(a.components).toHaveLength(0);
  });

  it('ProjectFile narrows on kind', () => {
    const part: ProjectFile = {
      formatVersion: 7, kind: 'part',
      document: { id: 'P1', name: 'p', units: 'mm', parameters: {}, featureTree: [] } as unknown as PartDocument,
    };
    const asm: ProjectFile = {
      formatVersion: 7, kind: 'assembly',
      document: { id: 'A1', name: 'a', units: 'mm', parameters: {}, components: [] },
    };
    if (part.kind === 'part') {
      expect((part.document as PartDocument).featureTree).toEqual([]);
    }
    if (asm.kind === 'assembly') {
      expect(asm.document.components).toEqual([]);
    }
  });
});
```

- [ ] **Step 2: Run — should fail**

`pnpm -C packages/shared test:unit -- assembly-document` → FAIL.

- [ ] **Step 3: Extend `types.ts`**

Append:

```ts
export type ComponentInstance = {
  id: string;
  partPath: string;
  position: { x: number; y: number; z: number };
  rotation: { rx: number; ry: number; rz: number };
  visible: boolean;
};

export type AssemblyDocument = {
  id: string;
  name: string;
  units: 'mm';
  parameters: Record<string, ParameterDef>;
  components: ComponentInstance[];
};
```

Find the existing `ProjectFile` type. Currently it's something like:

```ts
export type ProjectFile = {
  formatVersion: 7;
  document: PartDocument;
  // ... thumbnail, etc.
};
```

Convert it to a discriminated union:

```ts
export type ProjectFile =
  | { formatVersion: 7; kind: 'part'; document: PartDocument; /* keep existing siblings */ }
  | { formatVersion: 7; kind: 'assembly'; document: AssemblyDocument; /* keep existing siblings */ };
```

(Preserve any existing sibling fields like `thumbnail`, `cachedGeometry`, etc. — they sit on the `kind: 'part'` branch as today, and the assembly branch may or may not have them. Inspect the current `ProjectFile` shape and keep parity.)

- [ ] **Step 4: Run — should pass**

```
pnpm -C packages/shared test:unit -- assembly-document
pnpm -r typecheck
```

Both PASS. If typecheck breaks elsewhere, it's because consumers of `ProjectFile` don't narrow on `kind`. Add `kind: 'part'` defaults at construction sites; subsequent tasks in this plan will fix all callers properly.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/types.ts \
        packages/shared/src/__tests__/assembly-document.spec.ts
git commit -m "feat(shared): AssemblyDocument + ComponentInstance + ProjectFile discriminator

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: ProjectFile migration shim — default `kind: 'part'` for legacy v7 files

**Files:**
- Modify: `packages/shared/src/fileFormat.ts`
- Modify: `packages/shared/src/__tests__/fileFormat.spec.ts`

- [ ] **Step 1: Write failing tests**

```ts
describe('ProjectFile kind discriminator', () => {
  it('legacy v7 manifest without kind field defaults to kind: part on load', () => {
    const input: AnyManifest = {
      formatVersion: 7,
      document: {
        id: 'P1', name: 'p', units: 'mm', parameters: {},
        featureTree: [],
      },
      // no `kind` field
    };
    const out = migrateManifest(input);
    expect(out.formatVersion).toBe(7);
    expect((out as any).kind).toBe('part');
  });

  it('v7 manifest with kind: assembly is preserved', () => {
    const input: AnyManifest = {
      formatVersion: 7,
      kind: 'assembly',
      document: {
        id: 'A1', name: 'a', units: 'mm', parameters: {}, components: [],
      },
    };
    const out = migrateManifest(input);
    expect((out as any).kind).toBe('assembly');
  });

  it('v7 manifest with kind: part is preserved', () => {
    const input: AnyManifest = {
      formatVersion: 7,
      kind: 'part',
      document: {
        id: 'P1', name: 'p', units: 'mm', parameters: {},
        featureTree: [],
      },
    };
    const out = migrateManifest(input);
    expect((out as any).kind).toBe('part');
  });
});
```

- [ ] **Step 2: Run — should fail**

`pnpm -C packages/shared test:unit -- fileFormat` → FAIL.

- [ ] **Step 3: Implement shim**

In `migrateManifest`, after the v6 → v7 step, add a final normalization pass that defaults `kind` for legacy v7 files:

```ts
function normalizeKind(m: AnyManifest): AnyManifest {
  if (m.formatVersion === 7 && (m as any).kind === undefined) {
    return { ...m, kind: 'part' } as AnyManifest;
  }
  return m;
}

// At the end of migrateManifest:
return normalizeKind(out);
```

If `migrateManifest`'s structure is more rigid (e.g., a switch chain), apply the same shim at whichever point the chain finalizes a v7 manifest.

- [ ] **Step 4: Run — should pass**

```
pnpm -C packages/shared test:unit
pnpm -r typecheck
```

Both PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/fileFormat.ts \
        packages/shared/src/__tests__/fileFormat.spec.ts
git commit -m "feat(shared): default kind: 'part' for legacy v7 manifests

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Phase 2 — Storage

### Task 3: `AssemblyPacker` — pack / unpack `.ziasm`

**Files:**
- Create: `packages/kernel/src/storage/AssemblyPacker.ts`
- Create: `packages/kernel/src/storage/__tests__/AssemblyPacker.spec.ts`

- [ ] **Step 1: Read the existing `ProjectPacker.ts`**

Note its tar+gzip helpers (likely `pako` for gzip, `tar-stream` or a custom writer for tar). The new `AssemblyPacker` reuses the same helpers — refactor common code into a private helper file (`packages/kernel/src/storage/tarGzipUtil.ts`) if helpful, but only if the refactor is small.

- [ ] **Step 2: Write failing tests**

```ts
// packages/kernel/src/storage/__tests__/AssemblyPacker.spec.ts
import { describe, it, expect } from 'vitest';
import { packAssembly, unpackAssembly } from '../AssemblyPacker';
import type { AssemblyDocument } from '@zilventor/shared';

describe('AssemblyPacker', () => {
  const doc: AssemblyDocument = {
    id: 'A1', name: 'cabinet', units: 'mm', parameters: {},
    components: [
      { id: 'C1', partPath: 'leg.zipt',
        position: { x: 0, y: 0, z: 0 },
        rotation: { rx: 0, ry: 0, rz: 0 },
        visible: true },
    ],
  };
  const thumb = new Uint8Array([0x89, 0x50, 0x4e, 0x47]); // PNG magic

  it('round-trips an AssemblyDocument', async () => {
    const bytes = await packAssembly(doc, thumb);
    const out = await unpackAssembly(bytes);
    expect(out).toEqual(doc);
  });

  it('rejects a tar with kind: part', async () => {
    // Pack a part-kinded manifest manually
    const partManifest = JSON.stringify({
      formatVersion: 7, kind: 'part',
      document: { id: 'P1', name: 'p', units: 'mm', parameters: {}, featureTree: [] },
    });
    // Build a valid tar containing a manifest.json with kind:part — reuse the packer's helpers
    // For simplicity in this test, call packAssembly with a sentinel and patch the manifest in-place
    // (or skip this test if too fragile and rely on integration).
    // — alternative: call packPart with the same data and try to unpackAssembly that:
    const { packPart } = await import('../ProjectPacker');
    const partBytes = await packPart({
      id: 'P1', name: 'p', units: 'mm', parameters: {}, featureTree: [],
    } as any, thumb);
    await expect(unpackAssembly(partBytes)).rejects.toThrow(/kind/i);
  });

  it('reports a structured error on malformed JSON', async () => {
    const garbage = new Uint8Array([0x00, 0x01, 0x02]);
    await expect(unpackAssembly(garbage)).rejects.toThrow();
  });
});
```

- [ ] **Step 3: Run — should fail**

`pnpm --filter @zilventor/kernel exec vitest run -- AssemblyPacker` → FAIL.

- [ ] **Step 4: Implement**

```ts
// packages/kernel/src/storage/AssemblyPacker.ts
import type { AssemblyDocument } from '@zilventor/shared';
// Reuse helpers from ProjectPacker — refactor into a shared util if cleaner
import { writeTarGz, readTarGz } from './tarGzipUtil'; // or inline

export async function packAssembly(
  doc: AssemblyDocument,
  thumbnail: Uint8Array,
): Promise<Uint8Array> {
  const manifest = {
    formatVersion: 7,
    kind: 'assembly' as const,
    document: doc,
  };
  return writeTarGz([
    { name: 'manifest.json', data: new TextEncoder().encode(JSON.stringify(manifest)) },
    { name: 'thumbnail.png', data: thumbnail },
  ]);
}

export async function unpackAssembly(bytes: Uint8Array): Promise<AssemblyDocument> {
  const entries = await readTarGz(bytes);
  const manifestEntry = entries.find((e) => e.name === 'manifest.json');
  if (!manifestEntry) throw new Error('AssemblyPacker: manifest.json not found in archive');
  let manifest: any;
  try {
    manifest = JSON.parse(new TextDecoder().decode(manifestEntry.data));
  } catch (e) {
    throw new Error(`AssemblyPacker: malformed manifest.json: ${(e as Error).message}`);
  }
  if (manifest.kind !== 'assembly') {
    throw new Error(`AssemblyPacker: expected kind: 'assembly', got kind: '${manifest.kind ?? 'undefined'}'`);
  }
  if (manifest.formatVersion !== 7) {
    throw new Error(`AssemblyPacker: unsupported formatVersion ${manifest.formatVersion}`);
  }
  return manifest.document as AssemblyDocument;
}
```

If `ProjectPacker.ts` doesn't export reusable `writeTarGz`/`readTarGz` helpers, either:
- Create `packages/kernel/src/storage/tarGzipUtil.ts` exporting those helpers and have both `ProjectPacker` and `AssemblyPacker` use them.
- Or inline a minimal copy in `AssemblyPacker.ts` (smaller change, slight DRY violation — pragmatic for this task).

Pick whichever produces fewer line-changes. If the existing `ProjectPacker` is small (< 150 lines), refactor; otherwise inline.

- [ ] **Step 5: Run — should pass**

```
pnpm --filter @zilventor/kernel exec vitest run
pnpm -r typecheck
```

Both PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/kernel/src/storage/AssemblyPacker.ts \
        packages/kernel/src/storage/__tests__/AssemblyPacker.spec.ts \
        packages/kernel/src/storage/ProjectPacker.ts  # if you refactored
git commit -m "feat(kernel): AssemblyPacker — pack/unpack .ziasm

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: OPFS integration — save / load `.ziasm`

**Files:**
- Modify: `packages/kernel/src/storage/Opfs.ts` (add `.ziasm`-aware save/load if needed; existing `loadFile` may already be format-agnostic)
- Create: `packages/kernel/src/storage/__tests__/Opfs.assembly.integration.spec.ts`

- [ ] **Step 1: Read existing `Opfs.ts`**

Check whether `loadFile`/`saveFile` are format-agnostic byte-IO methods (most likely yes) or format-specific. If agnostic, no changes to `Opfs.ts` itself — just integration tests for the assembly happy paths.

- [ ] **Step 2: Write failing tests**

```ts
// packages/kernel/src/storage/__tests__/Opfs.assembly.integration.spec.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { Opfs } from '../Opfs';
import { packAssembly, unpackAssembly } from '../AssemblyPacker';
import { packPart } from '../ProjectPacker';
import type { AssemblyDocument, PartDocument } from '@zilventor/shared';

describe('Opfs — assembly integration', () => {
  let opfs: Opfs;

  beforeEach(async () => {
    opfs = new Opfs(/* whatever the constructor signature is — likely a virtual root */);
    await opfs.clear?.();
  });

  it('saves and loads a .ziasm file by name', async () => {
    const doc: AssemblyDocument = {
      id: 'A1', name: 'cabinet', units: 'mm', parameters: {},
      components: [],
    };
    const bytes = await packAssembly(doc, new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
    await opfs.saveFile('test.ziasm', bytes);
    const loaded = await opfs.loadFile('test.ziasm');
    const out = await unpackAssembly(loaded);
    expect(out).toEqual(doc);
  });

  it('an assembly with a partPath references a saved part', async () => {
    const partDoc: PartDocument = {
      id: 'P1', name: 'leg', units: 'mm', parameters: {}, featureTree: [],
    } as any;
    const partBytes = await packPart(partDoc, new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
    await opfs.saveFile('parts/leg.zipt', partBytes);

    const asmDoc: AssemblyDocument = {
      id: 'A1', name: 'cabinet', units: 'mm', parameters: {},
      components: [
        { id: 'C1', partPath: 'parts/leg.zipt',
          position: { x: 0, y: 0, z: 0 },
          rotation: { rx: 0, ry: 0, rz: 0 },
          visible: true },
      ],
    };
    const asmBytes = await packAssembly(asmDoc, new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
    await opfs.saveFile('cabinet.ziasm', asmBytes);

    const loaded = await opfs.loadFile('cabinet.ziasm');
    const out = await unpackAssembly(loaded);
    expect(out.components[0]!.partPath).toBe('parts/leg.zipt');

    // Verify the part file is also resolvable
    const partLoaded = await opfs.loadFile('parts/leg.zipt');
    expect(partLoaded.length).toBeGreaterThan(0);
  });
});
```

If the existing OPFS test setup uses a different style (in-memory mock, `vi.mock`, etc.), match that pattern.

- [ ] **Step 3: Run — should fail or pass directly**

If `Opfs.ts` is already format-agnostic, the tests should pass on first run. If they fail because `Opfs.saveFile`/`loadFile` doesn't accept arbitrary paths or doesn't create intermediate directories, fix `Opfs.ts` to support nested paths.

- [ ] **Step 4: Make sure all green**

```
pnpm --filter @zilventor/kernel exec vitest run
pnpm -r typecheck
```

- [ ] **Step 5: Commit**

```bash
git add packages/kernel/src/storage/Opfs.ts \
        packages/kernel/src/storage/__tests__/Opfs.assembly.integration.spec.ts
git commit -m "feat(kernel): Opfs assembly integration — round-trip .ziasm

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

(Stage `Opfs.ts` only if you actually modified it.)

---

## Phase 3 — Store: ActiveDocument discrimination

### Task 5: `useAppStore.activeDocument` discriminator

**Files:**
- Modify: `packages/app/src/store/useAppStore.ts`
- Modify: `packages/app/src/store/__tests__/useAppStore.spec.ts`

- [ ] **Step 1: Write failing tests**

```ts
  it('activeDocument defaults to null', () => {
    const s = useAppStore.getState();
    expect(s.activeDocument).toBeNull();
  });

  it('setActiveDocument with kind: part keeps activePart shim working', () => {
    const part: PartDocument = { id: 'P1', name: 'p', units: 'mm', parameters: {}, featureTree: [] } as any;
    useAppStore.getState().setActiveDocument({ kind: 'part', document: part });
    const s = useAppStore.getState();
    expect(s.activeDocument).toEqual({ kind: 'part', document: part });
    expect(s.activePart).toEqual(part);
  });

  it('setActiveDocument with kind: assembly clears activePart shim', () => {
    const asm: AssemblyDocument = { id: 'A1', name: 'a', units: 'mm', parameters: {}, components: [] };
    useAppStore.getState().setActiveDocument({ kind: 'assembly', document: asm });
    const s = useAppStore.getState();
    expect(s.activeDocument).toEqual({ kind: 'assembly', document: asm });
    expect(s.activePart).toBeNull();
    expect(s.activeAssembly).toEqual(asm);
  });

  it('setActivePart legacy setter wraps as part-kinded activeDocument', () => {
    const part: PartDocument = { id: 'P1', name: 'p', units: 'mm', parameters: {}, featureTree: [] } as any;
    useAppStore.getState().setActivePart(part);
    const s = useAppStore.getState();
    expect(s.activeDocument).toEqual({ kind: 'part', document: part });
  });
```

- [ ] **Step 2: Run — should fail**

FAIL.

- [ ] **Step 3: Implement**

In `useAppStore.ts`, add the discriminator:

```ts
import type { PartDocument, AssemblyDocument } from '@zilventor/shared';

export type ActiveDocument =
  | { kind: 'part'; document: PartDocument }
  | { kind: 'assembly'; document: AssemblyDocument };

// State additions:
activeDocument: ActiveDocument | null;

// Computed accessors (getters via Zustand selectors are fine, but for shim
// compatibility we expose them as state fields):
activePart: PartDocument | null;     // = activeDocument?.kind === 'part' ? activeDocument.document : null
activeAssembly: AssemblyDocument | null;

// Actions:
setActiveDocument(d: ActiveDocument | null): void;
setActivePart(p: PartDocument | null): void;     // legacy — wraps to ActiveDocument
```

Implementation:

```ts
setActiveDocument: (d) => set({
  activeDocument: d,
  activePart: d?.kind === 'part' ? d.document : null,
  activeAssembly: d?.kind === 'assembly' ? d.document : null,
}),
setActivePart: (p) => set({
  activeDocument: p ? { kind: 'part', document: p } : null,
  activePart: p,
  activeAssembly: null,
}),
```

Initialize `activeDocument`, `activePart`, `activeAssembly` to `null`.

Existing call sites that currently call `setActivePart(...)` continue to work via the shim; no migration of those call sites is needed in this task.

- [ ] **Step 4: Run — should pass**

```
pnpm -C packages/app test:unit
pnpm -r typecheck
```

Existing tests must remain green.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/store/useAppStore.ts \
        packages/app/src/store/__tests__/useAppStore.spec.ts
git commit -m "feat(app): useAppStore — activeDocument discriminator + part shim

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Store slice for assembly dialogs + diagnostics

**Files:**
- Modify: `packages/app/src/store/useAppStore.ts`
- Modify: `packages/app/src/store/__tests__/useAppStore.spec.ts`

- [ ] **Step 1: Write failing test**

```ts
  it('assembly dialog state defaults are sane', () => {
    const s = useAppStore.getState();
    expect(s.placeComponentDialogOpen).toBe(false);
    expect(s.editComponentDialogOpen).toBe(false);
    expect(s.editingComponentId).toBeNull();
    expect(s.editComponentInitialValues).toBeNull();
    expect(s.selectedComponentId).toBeNull();
    expect(s.componentDiagnostics).toEqual([]);
  });

  it('openPlaceComponentDialog opens it; resetPlaceComponentDialog closes', () => {
    useAppStore.getState().openPlaceComponentDialog();
    expect(useAppStore.getState().placeComponentDialogOpen).toBe(true);
    useAppStore.getState().resetPlaceComponentDialog();
    expect(useAppStore.getState().placeComponentDialogOpen).toBe(false);
  });

  it('addComponent appends to the active assembly', () => {
    const asm: AssemblyDocument = { id: 'A1', name: 'a', units: 'mm', parameters: {}, components: [] };
    useAppStore.getState().setActiveDocument({ kind: 'assembly', document: asm });
    useAppStore.getState().addComponent({
      id: 'C1', partPath: 'leg.zipt',
      position: { x: 0, y: 0, z: 0 },
      rotation: { rx: 0, ry: 0, rz: 0 },
      visible: true,
    });
    const s = useAppStore.getState();
    expect(s.activeAssembly?.components).toHaveLength(1);
    expect(s.activeAssembly?.components[0]!.id).toBe('C1');
  });

  it('updateComponent patches the named component', () => {
    const asm: AssemblyDocument = {
      id: 'A1', name: 'a', units: 'mm', parameters: {},
      components: [
        { id: 'C1', partPath: 'leg.zipt',
          position: { x: 0, y: 0, z: 0 },
          rotation: { rx: 0, ry: 0, rz: 0 },
          visible: true },
      ],
    };
    useAppStore.getState().setActiveDocument({ kind: 'assembly', document: asm });
    useAppStore.getState().updateComponent('C1', { position: { x: 50, y: 0, z: 0 } });
    expect(useAppStore.getState().activeAssembly?.components[0]!.position.x).toBe(50);
  });

  it('removeComponent removes by id', () => {
    const asm: AssemblyDocument = {
      id: 'A1', name: 'a', units: 'mm', parameters: {},
      components: [
        { id: 'C1', partPath: 'leg.zipt',
          position: { x: 0, y: 0, z: 0 },
          rotation: { rx: 0, ry: 0, rz: 0 },
          visible: true },
      ],
    };
    useAppStore.getState().setActiveDocument({ kind: 'assembly', document: asm });
    useAppStore.getState().removeComponent('C1');
    expect(useAppStore.getState().activeAssembly?.components).toHaveLength(0);
  });
```

- [ ] **Step 2: Run — should fail**

FAIL.

- [ ] **Step 3: Implement**

Add to `useAppStore.ts` state shape:

```ts
placeComponentDialogOpen: boolean;
editComponentDialogOpen: boolean;
editingComponentId: string | null;
editComponentInitialValues: ComponentInstance | null;
selectedComponentId: string | null;
componentDiagnostics: Array<{ componentId: string; message: string }>;

openPlaceComponentDialog(): void;
resetPlaceComponentDialog(): void;
openEditComponentDialog(id: string): void;
resetEditComponentDialog(): void;
addComponent(instance: ComponentInstance): void;
updateComponent(id: string, patch: Partial<ComponentInstance>): void;
removeComponent(id: string): void;
selectComponent(id: string | null): void;
setComponentDiagnostics(diags: Array<{ componentId: string; message: string }>): void;
```

Defaults: `false`, `false`, `null`, `null`, `null`, `[]`.

Implementations:

```ts
openPlaceComponentDialog: () => set({
  placeComponentDialogOpen: true,
  selectedComponentId: null,
}),
resetPlaceComponentDialog: () => set({ placeComponentDialogOpen: false }),

openEditComponentDialog: (id) => set((s) => {
  const c = s.activeAssembly?.components.find((x) => x.id === id);
  return {
    editComponentDialogOpen: true,
    editingComponentId: id,
    editComponentInitialValues: c ?? null,
  };
}),
resetEditComponentDialog: () => set({
  editComponentDialogOpen: false,
  editingComponentId: null,
  editComponentInitialValues: null,
}),

addComponent: (instance) => set((s) => {
  if (!s.activeAssembly) return s;
  const next: AssemblyDocument = {
    ...s.activeAssembly,
    components: [...s.activeAssembly.components, instance],
  };
  return {
    activeDocument: { kind: 'assembly', document: next },
    activeAssembly: next,
  };
}),

updateComponent: (id, patch) => set((s) => {
  if (!s.activeAssembly) return s;
  const next: AssemblyDocument = {
    ...s.activeAssembly,
    components: s.activeAssembly.components.map((c) =>
      c.id === id ? { ...c, ...patch } : c,
    ),
  };
  return {
    activeDocument: { kind: 'assembly', document: next },
    activeAssembly: next,
  };
}),

removeComponent: (id) => set((s) => {
  if (!s.activeAssembly) return s;
  const next: AssemblyDocument = {
    ...s.activeAssembly,
    components: s.activeAssembly.components.filter((c) => c.id !== id),
  };
  return {
    activeDocument: { kind: 'assembly', document: next },
    activeAssembly: next,
  };
}),

selectComponent: (id) => set({ selectedComponentId: id }),
setComponentDiagnostics: (diags) => set({ componentDiagnostics: diags }),
```

- [ ] **Step 4: Run — should pass**

```
pnpm -C packages/app test:unit
pnpm -r typecheck
```

Both PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/store/useAppStore.ts \
        packages/app/src/store/__tests__/useAppStore.spec.ts
git commit -m "feat(app): useAppStore — assembly dialog + component CRUD slice

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Phase 4 — Viewport: multi-mesh

### Task 7: `SceneManager.setComponentMeshes` + diff rendering

**Files:**
- Modify: `packages/app/src/viewport/SceneManager.ts`
- Modify: `packages/app/src/viewport/__tests__/SceneManager.spec.ts`

- [ ] **Step 1: Write failing test**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import { SceneManager } from '../SceneManager';

describe('SceneManager — component meshes', () => {
  let mgr: SceneManager;
  beforeEach(() => {
    mgr = new SceneManager(/* args */);
  });

  it('setComponentMeshes adds a mesh per component', () => {
    const g = new THREE.BoxGeometry(1, 1, 1);
    mgr.setComponentMeshes([
      { componentId: 'C1', geometry: g, transform: new THREE.Matrix4(), visible: true },
    ]);
    expect(mgr.componentMeshCount()).toBe(1);
  });

  it('updating same id updates the mesh in place', () => {
    const g = new THREE.BoxGeometry(1, 1, 1);
    const t1 = new THREE.Matrix4();
    const t2 = new THREE.Matrix4().setPosition(50, 0, 0);
    mgr.setComponentMeshes([{ componentId: 'C1', geometry: g, transform: t1, visible: true }]);
    const meshA = mgr.getComponentMesh('C1');
    mgr.setComponentMeshes([{ componentId: 'C1', geometry: g, transform: t2, visible: true }]);
    const meshB = mgr.getComponentMesh('C1');
    expect(meshA).toBe(meshB);   // same instance reused
    expect(meshB.matrix.elements[12]).toBe(50);   // transform updated
  });

  it('removing an id disposes its mesh and removes from scene', () => {
    const g = new THREE.BoxGeometry(1, 1, 1);
    mgr.setComponentMeshes([{ componentId: 'C1', geometry: g, transform: new THREE.Matrix4(), visible: true }]);
    expect(mgr.componentMeshCount()).toBe(1);
    mgr.setComponentMeshes([]);
    expect(mgr.componentMeshCount()).toBe(0);
  });

  it('two components sharing geometry reference the same BufferGeometry', () => {
    const g = new THREE.BoxGeometry(1, 1, 1);
    mgr.setComponentMeshes([
      { componentId: 'C1', geometry: g, transform: new THREE.Matrix4(), visible: true },
      { componentId: 'C2', geometry: g, transform: new THREE.Matrix4().setPosition(10, 0, 0), visible: true },
    ]);
    const m1 = mgr.getComponentMesh('C1');
    const m2 = mgr.getComponentMesh('C2');
    expect(m1.geometry).toBe(g);
    expect(m2.geometry).toBe(g);
    expect(m1.geometry).toBe(m2.geometry);
  });

  it('clearComponentMeshes removes all', () => {
    const g = new THREE.BoxGeometry(1, 1, 1);
    mgr.setComponentMeshes([
      { componentId: 'C1', geometry: g, transform: new THREE.Matrix4(), visible: true },
      { componentId: 'C2', geometry: g, transform: new THREE.Matrix4(), visible: true },
    ]);
    mgr.clearComponentMeshes();
    expect(mgr.componentMeshCount()).toBe(0);
  });
});
```

- [ ] **Step 2: Run — should fail**

FAIL.

- [ ] **Step 3: Implement**

Add to `SceneManager.ts`:

```ts
private componentMeshes = new Map<string, THREE.Mesh>();

setComponentMeshes(specs: Array<{
  componentId: string;
  geometry: THREE.BufferGeometry;
  transform: THREE.Matrix4;
  visible: boolean;
}>): void {
  const incomingIds = new Set(specs.map((s) => s.componentId));

  // Remove meshes that aren't in the incoming list
  for (const [id, mesh] of this.componentMeshes) {
    if (!incomingIds.has(id)) {
      this.scene.remove(mesh);
      // Don't dispose geometry — it may be shared
      this.componentMeshes.delete(id);
    }
  }

  // Add or update
  for (const spec of specs) {
    let mesh = this.componentMeshes.get(spec.componentId);
    if (!mesh) {
      mesh = new THREE.Mesh(spec.geometry, this.componentMaterial);
      mesh.matrixAutoUpdate = false;
      mesh.userData.componentId = spec.componentId;
      this.scene.add(mesh);
      this.componentMeshes.set(spec.componentId, mesh);
    }
    mesh.geometry = spec.geometry;     // pointer swap if shared geom changed
    mesh.matrix.copy(spec.transform);
    mesh.visible = spec.visible;
  }
}

clearComponentMeshes(): void {
  for (const mesh of this.componentMeshes.values()) {
    this.scene.remove(mesh);
  }
  this.componentMeshes.clear();
}

componentMeshCount(): number {
  return this.componentMeshes.size;
}

getComponentMesh(id: string): THREE.Mesh | undefined {
  return this.componentMeshes.get(id);
}
```

`componentMaterial` is a single shared `MeshStandardMaterial` defined alongside the existing part material — match the existing material constant.

- [ ] **Step 4: Run — should pass**

```
pnpm -C packages/app test:unit
pnpm -r typecheck
```

Both PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/viewport/SceneManager.ts \
        packages/app/src/viewport/__tests__/SceneManager.spec.ts
git commit -m "feat(app): SceneManager — multi-mesh diff rendering for components

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Geometry hash extension for components

**Files:**
- Modify: `packages/app/src/viewport/SceneManager.ts` (or wherever the geometry-hash is computed)
- Modify: existing geometry-hash test

The `data-geometry-hash` attribute on the viewport (3b infrastructure) currently hashes vertex positions of the active mesh. For assembly mode it must also hash component transforms so E2E specs can detect "the assembly changed."

- [ ] **Step 1: Write failing test**

```ts
  it('geometry hash includes component transforms', () => {
    const g = new THREE.BoxGeometry(1, 1, 1);
    mgr.setComponentMeshes([{ componentId: 'C1', geometry: g, transform: new THREE.Matrix4(), visible: true }]);
    const hashA = mgr.geometryHash();
    mgr.setComponentMeshes([{ componentId: 'C1', geometry: g, transform: new THREE.Matrix4().setPosition(50, 0, 0), visible: true }]);
    const hashB = mgr.geometryHash();
    expect(hashA).not.toBe(hashB);
  });

  it('geometry hash differs by component count', () => {
    const g = new THREE.BoxGeometry(1, 1, 1);
    mgr.setComponentMeshes([{ componentId: 'C1', geometry: g, transform: new THREE.Matrix4(), visible: true }]);
    const hashA = mgr.geometryHash();
    mgr.setComponentMeshes([
      { componentId: 'C1', geometry: g, transform: new THREE.Matrix4(), visible: true },
      { componentId: 'C2', geometry: g, transform: new THREE.Matrix4().setPosition(10, 0, 0), visible: true },
    ]);
    const hashB = mgr.geometryHash();
    expect(hashA).not.toBe(hashB);
  });
```

- [ ] **Step 2: Run — should fail**

FAIL.

- [ ] **Step 3: Extend geometry hash**

Find the existing `geometryHash()` method (or whatever computes the `data-geometry-hash` value). Extend with a fold over `componentMeshes`:

```ts
geometryHash(): string {
  let h = this.partGeometryHash();   // existing single-mesh hash, may be 0 in assembly mode
  for (const [id, mesh] of this.componentMeshes) {
    h = fnv1a(h, id);
    const e = mesh.matrix.elements;
    for (let i = 0; i < 16; i++) {
      // Quantise to mm to avoid float-precision noise in the hash
      h = fnv1a(h, Math.round(e[i]! * 1000));
    }
  }
  return h.toString(16);
}
```

If a private `fnv1a` helper exists already, reuse. Otherwise define one inline.

- [ ] **Step 4: Run — should pass**

PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/viewport/SceneManager.ts \
        packages/app/src/viewport/__tests__/SceneManager.spec.ts
git commit -m "feat(app): SceneManager — geometry hash includes component transforms

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: ComponentPickController

**Files:**
- Create: `packages/app/src/model/ComponentPickController.ts`
- Create: `packages/app/src/model/__tests__/ComponentPickController.spec.ts`

- [ ] **Step 1: Write failing test**

```ts
// packages/app/src/model/__tests__/ComponentPickController.spec.ts
import { describe, it, expect, vi } from 'vitest';
import { ComponentPickController } from '../ComponentPickController';

describe('ComponentPickController', () => {
  it('activate / deactivate toggles isActive', () => {
    const ctrl = new ComponentPickController({ onPick: () => {} });
    expect(ctrl.isActive()).toBe(false);
    ctrl.activate();
    expect(ctrl.isActive()).toBe(true);
    ctrl.deactivate();
    expect(ctrl.isActive()).toBe(false);
  });

  it('selectFromViewport fires onPick when active', () => {
    const onPick = vi.fn();
    const ctrl = new ComponentPickController({ onPick });
    ctrl.activate();
    ctrl.selectFromViewport('C1');
    expect(onPick).toHaveBeenCalledWith('C1');
  });

  it('selectFromViewport is a no-op when inactive', () => {
    const onPick = vi.fn();
    const ctrl = new ComponentPickController({ onPick });
    ctrl.selectFromViewport('C1');
    expect(onPick).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run — should fail**

FAIL.

- [ ] **Step 3: Implement**

```ts
// packages/app/src/model/ComponentPickController.ts
export type ComponentPickOpts = { onPick: (componentId: string) => void };

export class ComponentPickController {
  private active = false;
  constructor(private opts: ComponentPickOpts) {}
  activate(): void { this.active = true; }
  deactivate(): void { this.active = false; }
  isActive(): boolean { return this.active; }
  selectFromViewport(componentId: string): void {
    if (!this.active) return;
    this.opts.onPick(componentId);
  }
}
```

- [ ] **Step 4: Run + commit**

```bash
git add packages/app/src/model/ComponentPickController.ts \
        packages/app/src/model/__tests__/ComponentPickController.spec.ts
git commit -m "feat(app): ComponentPickController — viewport raycast → componentId

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Phase 5 — Commands

### Task 10: `NewAssemblyCommand`

**Files:**
- Create: `packages/app/src/commands/NewAssemblyCommand.ts`
- Create: `packages/app/src/commands/__tests__/NewAssemblyCommand.spec.ts`

- [ ] **Step 1: Write failing test**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '../../store/useAppStore';
import { NewAssemblyCommand } from '../NewAssemblyCommand';

describe('NewAssemblyCommand', () => {
  beforeEach(() => {
    useAppStore.getState().setActiveDocument(null);
  });

  it('sets activeDocument to a fresh empty assembly', () => {
    NewAssemblyCommand({ name: 'untitled-assembly' });
    const s = useAppStore.getState();
    expect(s.activeDocument?.kind).toBe('assembly');
    expect(s.activeAssembly?.name).toBe('untitled-assembly');
    expect(s.activeAssembly?.components).toEqual([]);
  });
});
```

- [ ] **Step 2: Run — should fail**

FAIL.

- [ ] **Step 3: Implement**

```ts
// packages/app/src/commands/NewAssemblyCommand.ts
import type { AssemblyDocument } from '@zilventor/shared';
import { useAppStore } from '../store/useAppStore';

export type NewAssemblyOpts = { name: string };

export function NewAssemblyCommand(opts: NewAssemblyOpts): void {
  const doc: AssemblyDocument = {
    id: `A${Date.now()}`,
    name: opts.name,
    units: 'mm',
    parameters: {},
    components: [],
  };
  useAppStore.getState().setActiveDocument({ kind: 'assembly', document: doc });
}
```

- [ ] **Step 4: Run — should pass**

PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/commands/NewAssemblyCommand.ts \
        packages/app/src/commands/__tests__/NewAssemblyCommand.spec.ts
git commit -m "feat(app): NewAssemblyCommand

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: `OpenPlaceComponentDialogCommand` + P hotkey

**Files:**
- Create: `packages/app/src/commands/OpenPlaceComponentDialogCommand.ts`
- Create: `packages/app/src/commands/__tests__/OpenPlaceComponentDialogCommand.spec.ts`
- Modify: `packages/app/src/App.tsx` (P key binding)

- [ ] **Step 1: Write failing test**

```ts
import { describe, it, expect } from 'vitest';
import { useAppStore } from '../../store/useAppStore';
import { OpenPlaceComponentDialogCommand } from '../OpenPlaceComponentDialogCommand';

describe('OpenPlaceComponentDialogCommand', () => {
  it('opens the dialog', () => {
    OpenPlaceComponentDialogCommand();
    expect(useAppStore.getState().placeComponentDialogOpen).toBe(true);
  });
});
```

- [ ] **Step 2: Run — should fail**

FAIL.

- [ ] **Step 3: Implement**

```ts
// packages/app/src/commands/OpenPlaceComponentDialogCommand.ts
import { useAppStore } from '../store/useAppStore';

export function OpenPlaceComponentDialogCommand(): void {
  useAppStore.getState().openPlaceComponentDialog();
}
```

- [ ] **Step 4: Bind P in App.tsx**

Find the existing `case 'h'` (Hole) or `case 'w'` (Sweep) keyboard binding in `App.tsx`'s `handleKeyDown`. Add:

```ts
case 'p':
  if (
    !sketchMode
    && !event.ctrlKey && !event.metaKey && !event.altKey
    && useAppStore.getState().activeDocument?.kind === 'assembly'
  ) {
    event.preventDefault();
    OpenPlaceComponentDialogCommand();
  }
  break;
```

The `activeDocument?.kind === 'assembly'` guard prevents P from triggering in part mode.

If P is already bound, stop and report DONE_WITH_CONCERNS.

- [ ] **Step 5: Run + commit**

```
pnpm -C packages/app test:unit
pnpm -r typecheck
```

```bash
git add packages/app/src/commands/OpenPlaceComponentDialogCommand.ts \
        packages/app/src/commands/__tests__/OpenPlaceComponentDialogCommand.spec.ts \
        packages/app/src/App.tsx
git commit -m "feat(app): OpenPlaceComponentDialogCommand + P hotkey (assembly mode only)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 12: `PlaceComponentCommand` (class)

**Files:**
- Create: `packages/app/src/commands/PlaceComponentCommand.ts`
- Create: `packages/app/src/commands/__tests__/PlaceComponentCommand.spec.ts`

- [ ] **Step 1: Write failing test**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useAppStore } from '../../store/useAppStore';
import { PlaceComponentCommand } from '../PlaceComponentCommand';
import type { AssemblyDocument } from '@zilventor/shared';

describe('PlaceComponentCommand', () => {
  beforeEach(() => {
    const asm: AssemblyDocument = { id: 'A1', name: 'a', units: 'mm', parameters: {}, components: [] };
    useAppStore.getState().setActiveDocument({ kind: 'assembly', document: asm });
  });

  it('apply() adds a ComponentInstance to the active assembly', async () => {
    const cmd = new PlaceComponentCommand({ partPath: 'leg.zipt' });
    await cmd.apply();
    const s = useAppStore.getState();
    expect(s.activeAssembly?.components).toHaveLength(1);
    expect(s.activeAssembly?.components[0]!.partPath).toBe('leg.zipt');
  });

  it('revert() removes the placed component', async () => {
    const cmd = new PlaceComponentCommand({ partPath: 'leg.zipt' });
    await cmd.apply();
    await cmd.revert();
    expect(useAppStore.getState().activeAssembly?.components).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run — should fail**

FAIL.

- [ ] **Step 3: Implement**

```ts
// packages/app/src/commands/PlaceComponentCommand.ts
import type { Command } from './Command';
import type { ComponentInstance } from '@zilventor/shared';
import { useAppStore } from '../store/useAppStore';

export type PlaceComponentOpts = { partPath: string };

export class PlaceComponentCommand implements Command {
  readonly name = 'PlaceComponent';
  private placedId: string | null = null;
  constructor(private opts: PlaceComponentOpts) {}

  async apply(): Promise<void> {
    const id = `C${Date.now()}`;
    const instance: ComponentInstance = {
      id,
      partPath: this.opts.partPath,
      position: { x: 0, y: 0, z: 0 },
      rotation: { rx: 0, ry: 0, rz: 0 },
      visible: true,
    };
    useAppStore.getState().addComponent(instance);
    this.placedId = id;
  }

  async revert(): Promise<void> {
    if (this.placedId) {
      useAppStore.getState().removeComponent(this.placedId);
      this.placedId = null;
    }
  }
}
```

- [ ] **Step 4: Run + commit**

```bash
git add packages/app/src/commands/PlaceComponentCommand.ts \
        packages/app/src/commands/__tests__/PlaceComponentCommand.spec.ts
git commit -m "feat(app): PlaceComponentCommand class

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 13: `OpenEditComponentDialogCommand` + `EditComponentCommand`

**Files:**
- Create: `packages/app/src/commands/OpenEditComponentDialogCommand.ts`
- Create: `packages/app/src/commands/EditComponentCommand.ts`
- Create: `packages/app/src/commands/__tests__/EditComponentCommand.spec.ts`

- [ ] **Step 1: Write failing test**

```ts
// packages/app/src/commands/__tests__/EditComponentCommand.spec.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '../../store/useAppStore';
import { EditComponentCommand } from '../EditComponentCommand';
import type { AssemblyDocument, ComponentInstance } from '@zilventor/shared';

describe('EditComponentCommand', () => {
  const original: ComponentInstance = {
    id: 'C1', partPath: 'leg.zipt',
    position: { x: 0, y: 0, z: 0 },
    rotation: { rx: 0, ry: 0, rz: 0 },
    visible: true,
  };

  beforeEach(() => {
    const asm: AssemblyDocument = {
      id: 'A1', name: 'a', units: 'mm', parameters: {},
      components: [original],
    };
    useAppStore.getState().setActiveDocument({ kind: 'assembly', document: asm });
  });

  it('apply() updates position and rotation', async () => {
    const cmd = new EditComponentCommand({
      id: 'C1',
      patch: { position: { x: 50, y: 0, z: 0 } },
    });
    await cmd.apply();
    expect(useAppStore.getState().activeAssembly?.components[0]!.position.x).toBe(50);
  });

  it('revert() restores original values', async () => {
    const cmd = new EditComponentCommand({
      id: 'C1',
      patch: { position: { x: 50, y: 0, z: 0 } },
    });
    await cmd.apply();
    await cmd.revert();
    expect(useAppStore.getState().activeAssembly?.components[0]!.position.x).toBe(0);
  });
});
```

- [ ] **Step 2: Run — should fail**

FAIL.

- [ ] **Step 3: Implement**

```ts
// packages/app/src/commands/OpenEditComponentDialogCommand.ts
import { useAppStore } from '../store/useAppStore';

export function OpenEditComponentDialogCommand(componentId: string): void {
  useAppStore.getState().openEditComponentDialog(componentId);
}
```

```ts
// packages/app/src/commands/EditComponentCommand.ts
import type { Command } from './Command';
import type { ComponentInstance } from '@zilventor/shared';
import { useAppStore } from '../store/useAppStore';

export type EditComponentOpts = {
  id: string;
  patch: Partial<ComponentInstance>;
};

export class EditComponentCommand implements Command {
  readonly name = 'EditComponent';
  private prior: ComponentInstance | null = null;
  constructor(private opts: EditComponentOpts) {}

  async apply(): Promise<void> {
    const s = useAppStore.getState();
    const c = s.activeAssembly?.components.find((x) => x.id === this.opts.id);
    if (!c) throw new Error(`EditComponent: component ${this.opts.id} not found`);
    this.prior = { ...c };
    s.updateComponent(this.opts.id, this.opts.patch);
  }

  async revert(): Promise<void> {
    if (!this.prior) return;
    useAppStore.getState().updateComponent(this.opts.id, this.prior);
    this.prior = null;
  }
}
```

- [ ] **Step 4: Run + commit**

```bash
git add packages/app/src/commands/OpenEditComponentDialogCommand.ts \
        packages/app/src/commands/EditComponentCommand.ts \
        packages/app/src/commands/__tests__/EditComponentCommand.spec.ts
git commit -m "feat(app): OpenEditComponentDialogCommand + EditComponentCommand

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 14: `DeleteComponentCommand`

**Files:**
- Create: `packages/app/src/commands/DeleteComponentCommand.ts`
- Create: `packages/app/src/commands/__tests__/DeleteComponentCommand.spec.ts`

- [ ] **Step 1: Write failing test**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '../../store/useAppStore';
import { DeleteComponentCommand } from '../DeleteComponentCommand';
import type { AssemblyDocument, ComponentInstance } from '@zilventor/shared';

describe('DeleteComponentCommand', () => {
  const c: ComponentInstance = {
    id: 'C1', partPath: 'leg.zipt',
    position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 },
    visible: true,
  };
  beforeEach(() => {
    const asm: AssemblyDocument = { id: 'A1', name: 'a', units: 'mm', parameters: {}, components: [c] };
    useAppStore.getState().setActiveDocument({ kind: 'assembly', document: asm });
  });

  it('apply() removes the component', async () => {
    const cmd = new DeleteComponentCommand({ id: 'C1' });
    await cmd.apply();
    expect(useAppStore.getState().activeAssembly?.components).toHaveLength(0);
  });

  it('revert() re-adds the component at the same position', async () => {
    const cmd = new DeleteComponentCommand({ id: 'C1' });
    await cmd.apply();
    await cmd.revert();
    expect(useAppStore.getState().activeAssembly?.components).toHaveLength(1);
    expect(useAppStore.getState().activeAssembly?.components[0]).toEqual(c);
  });
});
```

- [ ] **Step 2: Run — should fail**

FAIL.

- [ ] **Step 3: Implement**

```ts
// packages/app/src/commands/DeleteComponentCommand.ts
import type { Command } from './Command';
import type { ComponentInstance } from '@zilventor/shared';
import { useAppStore } from '../store/useAppStore';

export type DeleteComponentOpts = { id: string };

export class DeleteComponentCommand implements Command {
  readonly name = 'DeleteComponent';
  private prior: ComponentInstance | null = null;
  constructor(private opts: DeleteComponentOpts) {}

  async apply(): Promise<void> {
    const s = useAppStore.getState();
    const c = s.activeAssembly?.components.find((x) => x.id === this.opts.id);
    if (!c) throw new Error(`DeleteComponent: component ${this.opts.id} not found`);
    this.prior = { ...c };
    s.removeComponent(this.opts.id);
  }

  async revert(): Promise<void> {
    if (!this.prior) return;
    useAppStore.getState().addComponent(this.prior);
    this.prior = null;
  }
}
```

- [ ] **Step 4: Run + commit**

```bash
git add packages/app/src/commands/DeleteComponentCommand.ts \
        packages/app/src/commands/__tests__/DeleteComponentCommand.spec.ts
git commit -m "feat(app): DeleteComponentCommand class

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Phase 6 — Dialogs

### Task 15: `EditComponentDialog` (presentation)

**Files:**
- Create: `packages/app/src/shell/EditComponentDialog.tsx`
- Create: `packages/app/src/shell/__tests__/EditComponentDialog.spec.tsx`

- [ ] **Step 1: Write failing test**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { EditComponentDialog } from '../EditComponentDialog';
import type { ComponentInstance } from '@zilventor/shared';

describe('EditComponentDialog', () => {
  const initial: ComponentInstance = {
    id: 'C1', partPath: 'parts/leg.zipt',
    position: { x: 10, y: 20, z: 30 },
    rotation: { rx: 0, ry: 90, rz: 0 },
    visible: true,
  };
  const baseProps = {
    initial,
    onCommit: () => {},
    onCancel: () => {},
  };

  it('renders position + rotation + visibility controls with initial values', () => {
    render(<EditComponentDialog {...baseProps} />);
    expect((screen.getByLabelText(/^X$/i) as HTMLInputElement).value).toBe('10');
    expect((screen.getByLabelText(/^Y$/i) as HTMLInputElement).value).toBe('20');
    expect((screen.getByLabelText(/^Z$/i) as HTMLInputElement).value).toBe('30');
    expect((screen.getByLabelText(/^RX$/i) as HTMLInputElement).value).toBe('0');
    expect((screen.getByLabelText(/^RY$/i) as HTMLInputElement).value).toBe('90');
    expect((screen.getByLabelText(/visible/i) as HTMLInputElement).checked).toBe(true);
  });

  it('OK fires onCommit with the edited values', () => {
    const onCommit = vi.fn();
    render(<EditComponentDialog {...baseProps} onCommit={onCommit} />);
    fireEvent.change(screen.getByLabelText(/^X$/i), { target: { value: '50' } });
    fireEvent.click(screen.getByRole('button', { name: /^ok$/i }));
    expect(onCommit).toHaveBeenCalledWith(expect.objectContaining({
      position: { x: 50, y: 20, z: 30 },
    }));
  });
});
```

- [ ] **Step 2: Run — should fail**

FAIL.

- [ ] **Step 3: Implement**

```tsx
// packages/app/src/shell/EditComponentDialog.tsx
import { useState, type FormEvent } from 'react';
import type { ComponentInstance } from '@zilventor/shared';

type Props = {
  initial: ComponentInstance;
  onCommit(patch: Partial<ComponentInstance>): void;
  onCancel(): void;
};

const panel: React.CSSProperties = {
  position: 'fixed', top: 80, right: 20, width: 360,
  background: '#1a1a1a', border: '1px solid #444', borderRadius: 6,
  padding: 12, color: '#eee', fontSize: 12, zIndex: 50,
};
const row: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 };
const input: React.CSSProperties = { flex: 1, background: '#222', color: '#eee', border: '1px solid #333', padding: '4px 6px', fontSize: 11 };
const btn: React.CSSProperties = { background: '#2a2a2a', color: '#eee', border: '1px solid #444', padding: '4px 10px', cursor: 'pointer', fontSize: 11 };

export function EditComponentDialog({ initial, onCommit, onCancel }: Props): JSX.Element {
  const [x, setX] = useState(String(initial.position.x));
  const [y, setY] = useState(String(initial.position.y));
  const [z, setZ] = useState(String(initial.position.z));
  const [rx, setRx] = useState(String(initial.rotation.rx));
  const [ry, setRy] = useState(String(initial.rotation.ry));
  const [rz, setRz] = useState(String(initial.rotation.rz));
  const [visible, setVisible] = useState(initial.visible);

  const handleSubmit = (e: FormEvent): void => {
    e.preventDefault();
    onCommit({
      position: { x: Number(x), y: Number(y), z: Number(z) },
      rotation: { rx: Number(rx), ry: Number(ry), rz: Number(rz) },
      visible,
    });
  };

  return (
    <form role="dialog" aria-label="Edit Component" onSubmit={handleSubmit} style={panel}>
      <div style={{ fontWeight: 600, marginBottom: 8 }}>Edit Component</div>
      <div style={{ color: '#888', fontSize: 11, marginBottom: 8 }}>{initial.partPath}</div>

      <div style={{ marginBottom: 8 }}>
        <div style={{ fontWeight: 600, marginBottom: 4 }}>Position (mm)</div>
        <div style={row}>
          <label style={{ width: 24 }}>X</label>
          <input aria-label="X" value={x} onChange={(e) => setX(e.target.value)} style={input} />
        </div>
        <div style={row}>
          <label style={{ width: 24 }}>Y</label>
          <input aria-label="Y" value={y} onChange={(e) => setY(e.target.value)} style={input} />
        </div>
        <div style={row}>
          <label style={{ width: 24 }}>Z</label>
          <input aria-label="Z" value={z} onChange={(e) => setZ(e.target.value)} style={input} />
        </div>
      </div>

      <div style={{ marginBottom: 8 }}>
        <div style={{ fontWeight: 600, marginBottom: 4 }}>Rotation (deg)</div>
        <div style={row}>
          <label style={{ width: 24 }}>RX</label>
          <input aria-label="RX" value={rx} onChange={(e) => setRx(e.target.value)} style={input} />
        </div>
        <div style={row}>
          <label style={{ width: 24 }}>RY</label>
          <input aria-label="RY" value={ry} onChange={(e) => setRy(e.target.value)} style={input} />
        </div>
        <div style={row}>
          <label style={{ width: 24 }}>RZ</label>
          <input aria-label="RZ" value={rz} onChange={(e) => setRz(e.target.value)} style={input} />
        </div>
      </div>

      <label style={row}>
        <input
          type="checkbox"
          aria-label="visible"
          checked={visible}
          onChange={(e) => setVisible(e.target.checked)}
        />
        <span>visible</span>
      </label>

      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', marginTop: 8 }}>
        <button type="button" onClick={onCancel} style={btn}>Cancel</button>
        <button type="submit" style={btn}>OK</button>
      </div>
    </form>
  );
}
```

- [ ] **Step 4: Run + commit**

```bash
git add packages/app/src/shell/EditComponentDialog.tsx \
        packages/app/src/shell/__tests__/EditComponentDialog.spec.tsx
git commit -m "feat(app): EditComponentDialog presentation component

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 16: `PlaceComponentDialog` (presentation)

**Files:**
- Create: `packages/app/src/shell/PlaceComponentDialog.tsx`
- Create: `packages/app/src/shell/__tests__/PlaceComponentDialog.spec.tsx`

- [ ] **Step 1: Write failing test**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PlaceComponentDialog } from '../PlaceComponentDialog';

describe('PlaceComponentDialog', () => {
  const tiles = [
    { partPath: 'parts/leg.zipt', name: 'leg', thumbnail: 'data:image/png;base64,iVBOR…' },
    { partPath: 'parts/shelf.zipt', name: 'shelf', thumbnail: 'data:image/png;base64,iVBOR…' },
  ];
  const baseProps = {
    tiles,
    onPlace: () => {},
    onCancel: () => {},
  };

  it('renders a tile per part', () => {
    render(<PlaceComponentDialog {...baseProps} />);
    expect(screen.getByText('leg')).toBeInTheDocument();
    expect(screen.getByText('shelf')).toBeInTheDocument();
  });

  it('Place is disabled until a tile is selected', () => {
    render(<PlaceComponentDialog {...baseProps} />);
    expect(screen.getByRole('button', { name: /place/i })).toBeDisabled();
    fireEvent.click(screen.getByText('leg'));
    expect(screen.getByRole('button', { name: /place/i })).not.toBeDisabled();
  });

  it('Place fires onPlace with the selected partPath', () => {
    const onPlace = vi.fn();
    render(<PlaceComponentDialog {...baseProps} onPlace={onPlace} />);
    fireEvent.click(screen.getByText('shelf'));
    fireEvent.click(screen.getByRole('button', { name: /place/i }));
    expect(onPlace).toHaveBeenCalledWith('parts/shelf.zipt');
  });
});
```

- [ ] **Step 2: Run — should fail**

FAIL.

- [ ] **Step 3: Implement**

```tsx
// packages/app/src/shell/PlaceComponentDialog.tsx
import { useState } from 'react';

type Tile = { partPath: string; name: string; thumbnail: string };

type Props = {
  tiles: Tile[];
  onPlace(partPath: string): void;
  onCancel(): void;
};

const panel: React.CSSProperties = {
  position: 'fixed', top: 80, right: 20, width: 480,
  background: '#1a1a1a', border: '1px solid #444', borderRadius: 6,
  padding: 12, color: '#eee', fontSize: 12, zIndex: 50,
};
const grid: React.CSSProperties = {
  display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 8,
};
const tileStyle = (selected: boolean): React.CSSProperties => ({
  border: selected ? '2px solid #5b9ad8' : '1px solid #333',
  background: '#222', padding: 6, borderRadius: 4, cursor: 'pointer',
  textAlign: 'center', fontSize: 11,
});
const btn: React.CSSProperties = { background: '#2a2a2a', color: '#eee', border: '1px solid #444', padding: '4px 10px', cursor: 'pointer', fontSize: 11 };

export function PlaceComponentDialog({ tiles, onPlace, onCancel }: Props): JSX.Element {
  const [selected, setSelected] = useState<string | null>(null);

  return (
    <div role="dialog" aria-label="Place Component" style={panel}>
      <div style={{ fontWeight: 600, marginBottom: 8 }}>Place Component</div>
      <div style={grid}>
        {tiles.map((t) => (
          <div
            key={t.partPath}
            style={tileStyle(selected === t.partPath)}
            onClick={() => setSelected(t.partPath)}
          >
            <img
              src={t.thumbnail}
              alt={t.name}
              style={{ width: '100%', aspectRatio: '1/1', objectFit: 'cover', marginBottom: 4 }}
            />
            <div>{t.name}</div>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
        <button onClick={onCancel} style={btn}>Cancel</button>
        <button
          onClick={() => selected && onPlace(selected)}
          disabled={!selected}
          style={btn}
        >
          Place
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run + commit**

```bash
git add packages/app/src/shell/PlaceComponentDialog.tsx \
        packages/app/src/shell/__tests__/PlaceComponentDialog.spec.tsx
git commit -m "feat(app): PlaceComponentDialog presentation component

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 17: Tile loader — list `.zipt` files in OPFS + extract thumbnails

**Files:**
- Create: `packages/app/src/shell/loadAssemblyTiles.ts`
- Create: `packages/app/src/shell/__tests__/loadAssemblyTiles.spec.ts`

- [ ] **Step 1: Write failing test**

```ts
import { describe, it, expect, vi } from 'vitest';
import { loadAssemblyTiles } from '../loadAssemblyTiles';

describe('loadAssemblyTiles', () => {
  it('returns one tile per .zipt file in OPFS, with name + thumbnail data URL', async () => {
    const opfs: any = {
      list: vi.fn().mockResolvedValue(['parts/leg.zipt', 'parts/shelf.zipt', 'cabinet.ziasm']),
      loadFile: vi.fn().mockResolvedValue(new Uint8Array(/* a valid .zipt */)),
    };
    const unpackPart = vi.fn().mockResolvedValue({
      thumbnail: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
    });
    const tiles = await loadAssemblyTiles(opfs, unpackPart);
    expect(tiles).toHaveLength(2);   // .zipt only, .ziasm filtered out
    expect(tiles[0]!.partPath).toBe('parts/leg.zipt');
    expect(tiles[0]!.name).toBe('leg');
    expect(tiles[0]!.thumbnail).toMatch(/^data:image\/png;base64,/);
  });
});
```

(Mock structure depends on the real `Opfs` API. Adapt as needed.)

- [ ] **Step 2: Run — should fail**

FAIL.

- [ ] **Step 3: Implement**

```ts
// packages/app/src/shell/loadAssemblyTiles.ts
export type AssemblyTile = {
  partPath: string;
  name: string;       // filename without extension
  thumbnail: string;  // data URL
};

function uint8ToDataUrl(bytes: Uint8Array): string {
  // Browser-friendly base64 encode
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return `data:image/png;base64,${btoa(bin)}`;
}

export async function loadAssemblyTiles(
  opfs: { list: (prefix?: string) => Promise<string[]>; loadFile: (path: string) => Promise<Uint8Array> },
  unpackPart: (bytes: Uint8Array) => Promise<{ thumbnail: Uint8Array }>,
): Promise<AssemblyTile[]> {
  const all = await opfs.list();
  const ziptPaths = all.filter((p) => p.endsWith('.zipt'));
  const tiles: AssemblyTile[] = [];
  for (const path of ziptPaths) {
    try {
      const bytes = await opfs.loadFile(path);
      const part = await unpackPart(bytes);
      const filename = path.split('/').pop()!.replace(/\.zipt$/, '');
      tiles.push({
        partPath: path,
        name: filename,
        thumbnail: uint8ToDataUrl(part.thumbnail),
      });
    } catch (e) {
      // Skip unreadable parts; log to console
      console.warn(`loadAssemblyTiles: skipping ${path}: ${(e as Error).message}`);
    }
  }
  return tiles;
}
```

`unpackPart` is the existing `ProjectPacker.unpackPart` — pass it as a dependency for testability. The actual call site (in `App.tsx` Phase 7) imports `unpackPart` directly.

- [ ] **Step 4: Run + commit**

```bash
git add packages/app/src/shell/loadAssemblyTiles.ts \
        packages/app/src/shell/__tests__/loadAssemblyTiles.spec.ts
git commit -m "feat(app): loadAssemblyTiles — OPFS .zipt scan with thumbnail decoding

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Phase 7 — Browser pane + Ribbon

### Task 18: BrowserPane assembly view

**Files:**
- Modify: `packages/app/src/shell/BrowserPane.tsx`
- Modify: `packages/app/src/shell/__tests__/BrowserPane.spec.tsx`

- [ ] **Step 1: Write failing test**

```tsx
  it('assembly mode renders Components node + N component leaves', () => {
    const asm: AssemblyDocument = {
      id: 'A1', name: 'cabinet', units: 'mm', parameters: {},
      components: [
        { id: 'C1', partPath: 'parts/leg.zipt',
          position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
        { id: 'C2', partPath: 'parts/shelf.zipt',
          position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
      ],
    };
    useAppStore.setState((s) => ({ ...s,
      activeDocument: { kind: 'assembly', document: asm },
      activeAssembly: asm,
      activePart: null,
    }));
    render(<BrowserPane />);
    expect(screen.getByText(/Assembly: cabinet/)).toBeInTheDocument();
    expect(screen.getByText(/Components \(2\)/)).toBeInTheDocument();
    expect(screen.getByText(/leg/)).toBeInTheDocument();
    expect(screen.getByText(/shelf/)).toBeInTheDocument();
  });

  it('double-clicking a component opens the edit dialog', () => {
    const asm: AssemblyDocument = {
      id: 'A1', name: 'cabinet', units: 'mm', parameters: {},
      components: [
        { id: 'C1', partPath: 'parts/leg.zipt',
          position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
      ],
    };
    useAppStore.setState((s) => ({ ...s,
      activeDocument: { kind: 'assembly', document: asm },
      activeAssembly: asm,
      activePart: null,
    }));
    render(<BrowserPane />);
    fireEvent.doubleClick(screen.getByText(/leg/));
    expect(useAppStore.getState().editComponentDialogOpen).toBe(true);
    expect(useAppStore.getState().editingComponentId).toBe('C1');
  });
```

- [ ] **Step 2: Run — should fail**

FAIL.

- [ ] **Step 3: Implement**

In `BrowserPane.tsx`, branch on `activeDocument?.kind`:

```tsx
const activeDoc = useAppStore((s) => s.activeDocument);
// existing part-mode branch stays for kind: 'part'

if (activeDoc?.kind === 'assembly') {
  const asm = activeDoc.document;
  return (
    <div data-testid="browser-pane">
      <div style={{ fontWeight: 600 }}>Assembly: {asm.name}</div>
      <div style={{ marginLeft: 8 }}>Components ({asm.components.length})</div>
      {asm.components.map((c) => {
        const partFileName = c.partPath.split('/').pop()!.replace(/\.zipt$/, '');
        return (
          <div
            key={c.id}
            style={{ marginLeft: 16, cursor: 'pointer' }}
            onDoubleClick={() => {
              useAppStore.getState().openEditComponentDialog(c.id);
            }}
          >
            ▸ {c.id} — {partFileName}
          </div>
        );
      })}
      <div style={{ marginLeft: 8 }}>Origin</div>
    </div>
  );
}

// existing part-mode return stays below
```

- [ ] **Step 4: Run + commit**

```bash
git add packages/app/src/shell/BrowserPane.tsx \
        packages/app/src/shell/__tests__/BrowserPane.spec.tsx
git commit -m "feat(app): BrowserPane — assembly mode view + component double-click

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 19: Assembly ribbon tab

**Files:**
- Create: `packages/app/src/shell/tabs/AssemblyTab.tsx`
- Create: `packages/app/src/shell/tabs/__tests__/AssemblyTab.spec.tsx`
- Modify: `packages/app/src/shell/Ribbon.tsx` (or wherever ribbon tabs are wired) to render AssemblyTab when `activeDocument?.kind === 'assembly'` and hide ModelTab

- [ ] **Step 1: Write failing test**

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AssemblyTab } from '../AssemblyTab';
import { useAppStore } from '../../../store/useAppStore';
import type { AssemblyDocument } from '@zilventor/shared';

describe('AssemblyTab', () => {
  it('Place button opens the place dialog', () => {
    const asm: AssemblyDocument = { id: 'A1', name: 'a', units: 'mm', parameters: {}, components: [] };
    useAppStore.setState((s) => ({ ...s,
      activeDocument: { kind: 'assembly', document: asm },
      activeAssembly: asm,
    }));
    render(<AssemblyTab />);
    fireEvent.click(screen.getByRole('button', { name: /^place$/i }));
    expect(useAppStore.getState().placeComponentDialogOpen).toBe(true);
  });

  it('Edit button is disabled until a component is selected', () => {
    const asm: AssemblyDocument = { id: 'A1', name: 'a', units: 'mm', parameters: {},
      components: [
        { id: 'C1', partPath: 'p', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
      ],
    };
    useAppStore.setState((s) => ({ ...s,
      activeDocument: { kind: 'assembly', document: asm },
      activeAssembly: asm,
      selectedComponentId: null,
    }));
    render(<AssemblyTab />);
    expect(screen.getByRole('button', { name: /^edit$/i })).toBeDisabled();
    useAppStore.getState().selectComponent('C1');
    // re-render
    render(<AssemblyTab />);
    expect(screen.getAllByRole('button', { name: /^edit$/i }).pop()).not.toBeDisabled();
  });
```

- [ ] **Step 2: Run — should fail**

FAIL.

- [ ] **Step 3: Implement**

```tsx
// packages/app/src/shell/tabs/AssemblyTab.tsx
import { useAppStore } from '../../store/useAppStore';
import { OpenPlaceComponentDialogCommand } from '../../commands/OpenPlaceComponentDialogCommand';
import { OpenEditComponentDialogCommand } from '../../commands/OpenEditComponentDialogCommand';
import { DeleteComponentCommand } from '../../commands/DeleteComponentCommand';

const btn: React.CSSProperties = {
  background: '#2a2a2a', color: '#eee', border: '1px solid #444',
  padding: '4px 10px', cursor: 'pointer', fontSize: 11, marginRight: 4,
};

export function AssemblyTab(): JSX.Element {
  const selectedId = useAppStore((s) => s.selectedComponentId);
  const hasAssembly = useAppStore((s) => s.activeDocument?.kind === 'assembly');

  return (
    <div style={{ display: 'flex', alignItems: 'center', padding: 4 }}>
      <div style={{ marginRight: 12 }}>
        <div style={{ fontSize: 10, color: '#888', marginBottom: 2 }}>Component</div>
        <button
          aria-label="Place"
          disabled={!hasAssembly}
          onClick={() => OpenPlaceComponentDialogCommand()}
          style={btn}
        >
          Place
        </button>
        <button
          aria-label="Edit"
          disabled={!selectedId}
          onClick={() => selectedId && OpenEditComponentDialogCommand(selectedId)}
          style={btn}
        >
          Edit
        </button>
        <button
          aria-label="Delete"
          disabled={!selectedId}
          onClick={async () => {
            if (!selectedId) return;
            const cmd = new DeleteComponentCommand({ id: selectedId });
            await cmd.apply();
          }}
          style={btn}
        >
          Delete
        </button>
      </div>
    </div>
  );
}
```

In `Ribbon.tsx`, add a branch:

```tsx
const docKind = useAppStore((s) => s.activeDocument?.kind ?? null);
// existing tabs:
{docKind === 'part' && <ModelTab />}
{docKind === 'assembly' && <AssemblyTab />}
```

- [ ] **Step 4: Run + commit**

```bash
git add packages/app/src/shell/tabs/AssemblyTab.tsx \
        packages/app/src/shell/tabs/__tests__/AssemblyTab.spec.tsx \
        packages/app/src/shell/Ribbon.tsx
git commit -m "feat(app): Assembly ribbon tab — Place / Edit / Delete

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 20: NewAssembly menu entry + File menu integration

**Files:**
- Modify: wherever the existing File menu lives (likely `packages/app/src/shell/Ribbon.tsx` or a `FileTab.tsx`)
- Modify: existing tests

- [ ] **Step 1: Find existing "New Part" menu entry**

Search for the New Part action — `grep -rn "New Part" packages/app/src/shell` or similar. Note its render location and onClick handler.

- [ ] **Step 2: Add "New Assembly" entry**

Insert next to "New Part":

```tsx
<button
  aria-label="New Assembly"
  onClick={() => NewAssemblyCommand({ name: 'untitled-assembly' })}
  style={...}
>
  New Assembly
</button>
```

Add the import:

```tsx
import { NewAssemblyCommand } from '../commands/NewAssemblyCommand';
```

- [ ] **Step 3: Add a small test**

```tsx
  it('File → New Assembly creates an empty assembly as activeDocument', () => {
    render(<FileMenu />);
    fireEvent.click(screen.getByRole('button', { name: /new assembly/i }));
    expect(useAppStore.getState().activeDocument?.kind).toBe('assembly');
    expect(useAppStore.getState().activeAssembly?.components).toEqual([]);
  });
```

- [ ] **Step 4: Run + commit**

```
pnpm -C packages/app test:unit
pnpm -r typecheck
```

```bash
git add packages/app/src/shell/Ribbon.tsx \
        packages/app/src/shell/tabs/FileTab.tsx \
        packages/app/src/shell/tabs/__tests__/FileTab.spec.tsx
git commit -m "feat(app): File menu — New Assembly entry

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

(Stage only files actually modified.)

---

## Phase 8 — App.tsx wiring

### Task 21: PlaceComponentDialog + EditComponentDialog wrappers in App.tsx

**Files:**
- Modify: `packages/app/src/App.tsx`

- [ ] **Step 1: Add PlaceComponentDialog wrapper**

Mirror the SweepDialog wrapper pattern (T18 of Sweep). Add:

```tsx
import { PlaceComponentDialog } from './shell/PlaceComponentDialog';
import { EditComponentDialog } from './shell/EditComponentDialog';
import { PlaceComponentCommand } from './commands/PlaceComponentCommand';
import { EditComponentCommand } from './commands/EditComponentCommand';
import { loadAssemblyTiles, type AssemblyTile } from './shell/loadAssemblyTiles';
import { unpackPart } from '../../kernel/src/storage/ProjectPacker';   // or wherever it's exported

const placeOpen = useAppStore((s) => s.placeComponentDialogOpen);
const editOpen = useAppStore((s) => s.editComponentDialogOpen);
const editInitial = useAppStore((s) => s.editComponentInitialValues);

const [tiles, setTiles] = React.useState<AssemblyTile[]>([]);

React.useEffect(() => {
  if (placeOpen) {
    loadAssemblyTiles(opfs, unpackPart).then(setTiles).catch((e) => {
      console.error('Failed to load tiles:', e);
      setTiles([]);
    });
  }
}, [placeOpen, opfs]);

const onPlace = async (partPath: string) => {
  const cmd = new PlaceComponentCommand({ partPath });
  try {
    await cmd.apply();
  } catch (e) {
    console.error('Place failed:', e);
  }
  useAppStore.getState().resetPlaceComponentDialog();
};

const onEditCommit = async (patch: any) => {
  const id = useAppStore.getState().editingComponentId;
  if (!id) return;
  const cmd = new EditComponentCommand({ id, patch });
  try {
    await cmd.apply();
  } catch (e) {
    console.error('Edit failed:', e);
  }
  useAppStore.getState().resetEditComponentDialog();
};

// ... in JSX:
{placeOpen && (
  <PlaceComponentDialog
    tiles={tiles}
    onPlace={onPlace}
    onCancel={() => useAppStore.getState().resetPlaceComponentDialog()}
  />
)}
{editOpen && editInitial && (
  <EditComponentDialog
    initial={editInitial}
    onCommit={onEditCommit}
    onCancel={() => useAppStore.getState().resetEditComponentDialog()}
  />
)}
```

(Adjust imports/instances of `opfs`, `unpackPart` based on what's actually accessible at this scope in `App.tsx`.)

- [ ] **Step 2: Run + commit**

```
pnpm -C packages/app test:unit
pnpm -r typecheck
```

```bash
git add packages/app/src/App.tsx
git commit -m "feat(app): PlaceComponentDialog + EditComponentDialog wrappers

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 22: Component-mesh sync — assembly state → SceneManager

**Files:**
- Modify: `packages/app/src/App.tsx`

- [ ] **Step 1: Add assembly-mesh sync effect**

When `activeDocument.kind === 'assembly'`, watch `activeAssembly.components` and update `viewportRef.current.setComponentMeshes(...)` on every change. The geometry per component is loaded async via `unpackPart` + tessellation; cache by `partPath` so the same part rendered N times tessellates once.

```tsx
const assembly = useAppStore((s) => s.activeAssembly);
const geometryCacheRef = React.useRef<Map<string, THREE.BufferGeometry>>(new Map());

React.useEffect(() => {
  if (!assembly) {
    viewportRef.current?.clearComponentMeshes();
    return;
  }
  let cancelled = false;
  const sync = async () => {
    const cache = geometryCacheRef.current;
    const specs: Array<{
      componentId: string;
      geometry: THREE.BufferGeometry;
      transform: THREE.Matrix4;
      visible: boolean;
    }> = [];
    const diagnostics: Array<{ componentId: string; message: string }> = [];

    for (const c of assembly.components) {
      let geom = cache.get(c.partPath);
      if (!geom) {
        try {
          const bytes = await opfs.loadFile(c.partPath);
          const part = await unpackPart(bytes);
          // Tessellate the part's cached BREP via the kernel client
          const result = await kernel.tessellatePart(part.document);
          geom = new THREE.BufferGeometry();
          geom.setAttribute('position', new THREE.BufferAttribute(result.positions, 3));
          geom.setIndex(new THREE.BufferAttribute(result.indices, 1));
          geom.computeVertexNormals();
          cache.set(c.partPath, geom);
        } catch (e) {
          diagnostics.push({ componentId: c.id, message: `Failed to load ${c.partPath}: ${(e as Error).message}` });
          // Use placeholder geometry — red wireframe cube
          geom = new THREE.BoxGeometry(50, 50, 50);
        }
      }
      const transform = new THREE.Matrix4();
      transform.makeRotationFromEuler(new THREE.Euler(
        (c.rotation.rx * Math.PI) / 180,
        (c.rotation.ry * Math.PI) / 180,
        (c.rotation.rz * Math.PI) / 180,
        'XYZ',
      ));
      transform.setPosition(c.position.x, c.position.y, c.position.z);
      specs.push({ componentId: c.id, geometry: geom, transform, visible: c.visible });
    }
    if (!cancelled) {
      viewportRef.current?.setComponentMeshes(specs);
      useAppStore.getState().setComponentDiagnostics(diagnostics);
    }
  };
  sync();
  return () => { cancelled = true; };
}, [assembly, opfs, kernel]);
```

`kernel.tessellatePart(...)` is a new RPC if it doesn't exist yet. If `kernel.execute(partId)` is what's available, use that and pull tessellation from the result. Match whatever the existing part-mode tessellation flow uses.

- [ ] **Step 2: Run + commit**

```
pnpm -C packages/app test:unit
pnpm -r typecheck
```

```bash
git add packages/app/src/App.tsx
git commit -m "feat(app): assembly-mesh sync — components → SceneManager.setComponentMeshes

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 23: Assembly load — File → Open `.ziasm` flow

**Files:**
- Modify: `packages/app/src/App.tsx` (or wherever File → Open is implemented)
- Modify: existing test

- [ ] **Step 1: Extend the open flow**

Find the existing File → Open handler (probably reads bytes from a file picker, calls `unpackPart`, sets `activePart`). Add a discriminator:

```tsx
const openFile = async (path: string) => {
  const bytes = await opfs.loadFile(path);
  // Peek manifest.json to discriminate
  const entries = await readTarGz(bytes);
  const manifestEntry = entries.find((e) => e.name === 'manifest.json');
  if (!manifestEntry) throw new Error('No manifest.json in archive');
  const manifest = JSON.parse(new TextDecoder().decode(manifestEntry.data));
  const kind = manifest.kind ?? 'part';   // legacy v7 default

  if (kind === 'assembly') {
    const doc = await unpackAssembly(bytes);
    useAppStore.getState().setActiveDocument({ kind: 'assembly', document: doc });
  } else {
    const doc = await unpackPart(bytes);
    useAppStore.getState().setActiveDocument({ kind: 'part', document: doc });
  }
};
```

(Adapt to the actual File → Open implementation.)

- [ ] **Step 2: Run + commit**

```bash
git add packages/app/src/App.tsx
git commit -m "feat(app): File → Open — discriminate .ziasm vs .zipt

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 24: Assembly save — autosave + manual save

**Files:**
- Modify: `packages/app/src/App.tsx`

- [ ] **Step 1: Extend the save flow**

Find the existing autosave / Save / Save As handlers. Add an assembly branch:

```tsx
const saveActive = async () => {
  const doc = useAppStore.getState().activeDocument;
  if (!doc) return;
  const thumb = await captureViewportThumbnail();
  if (doc.kind === 'part') {
    const bytes = await packPart(doc.document, thumb);
    await opfs.saveFile(`${doc.document.name}.zipt`, bytes);
  } else {
    const bytes = await packAssembly(doc.document, thumb);
    await opfs.saveFile(`${doc.document.name}.ziasm`, bytes);
  }
};
```

Trigger `saveActive` on every store mutation that affects `activeDocument` (debounced, e.g. 500 ms) — the existing autosave debouncer already handles this for parts; extend to also fire when `activeAssembly` changes.

- [ ] **Step 2: Run + commit**

```bash
git add packages/app/src/App.tsx
git commit -m "feat(app): autosave — extend to .ziasm

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 25: Component-pick wiring (raycaster → store)

**Files:**
- Modify: `packages/app/src/App.tsx`
- Modify: `packages/app/src/viewport/Viewport.tsx` (raycaster handler)

- [ ] **Step 1: Add raycaster click handler**

In viewport's click handler, when in assembly mode:

```tsx
const handleClick = (event: MouseEvent) => {
  if (useAppStore.getState().activeDocument?.kind !== 'assembly') {
    // existing part-mode behavior
    return;
  }
  // Raycast against component meshes
  raycaster.setFromCamera(/* normalized mouse */, camera);
  const meshes = Array.from(sceneManager.componentMeshes.values());
  const hits = raycaster.intersectObjects(meshes);
  if (hits.length > 0) {
    const id = hits[0]!.object.userData.componentId as string;
    useAppStore.getState().selectComponent(id);
  } else {
    useAppStore.getState().selectComponent(null);
  }
};
```

(`sceneManager.componentMeshes` was added in Task 7; expose it via a public getter if not already public.)

- [ ] **Step 2: Run + commit**

```bash
git add packages/app/src/App.tsx packages/app/src/viewport/Viewport.tsx
git commit -m "feat(app): viewport raycaster — assembly-mode component selection

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Phase 9 — E2E

### Task 26: E2E `place-component`

**Files:**
- Create: `tests/e2e/assembly/place-component.spec.ts`

- [ ] **Step 1: Write E2E**

```ts
import { test, expect } from '@playwright/test';

test('place a component in an assembly', async ({ page }) => {
  await page.goto('/');
  // wait-for-kernel-ready (mirror sweep specs)

  // Save a simple part to OPFS (programmatically — full test infra)
  await page.evaluate(async () => {
    const k = (window as any).__zilventorKernel;
    const opfs = (window as any).__zilventorOpfs;
    // Build a 50x50x50 cube part, pack as .zipt, save to OPFS
    const partDoc = {
      id: 'P1', name: 'cube', units: 'mm', parameters: { d0: { name: 'd0', expression: '50', value: 50, unit: 'mm' } },
      featureTree: [
        { kind: 'sketch', id: 'S0', plane: 'XY', primitives: [{ id: 'R1', kind: 'rect', x: 0, y: 0, w: 50, h: 50 }], constraints: [] },
        { kind: 'extrude', id: 'E1', sketchRef: 'S0', distanceParam: 'd0', direction: 'forward', operation: 'new' },
      ],
    };
    const bytes = await k.packPart(partDoc, new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
    await opfs.saveFile('parts/cube.zipt', bytes);
  });

  // Create new assembly via File menu
  await page.getByRole('button', { name: /new assembly/i }).click();
  await page.waitForFunction(() => (window as any).__zilventorStore.getState().activeDocument?.kind === 'assembly');

  // Press P to open Place dialog
  await page.keyboard.press('p');
  await expect(page.getByRole('dialog', { name: /place component/i })).toBeVisible();

  // Click the cube tile
  await page.getByText(/^cube$/).click();
  await page.getByRole('button', { name: /^place$/i }).click();

  // Assert one component in the active assembly
  const count = await page.evaluate(() =>
    (window as any).__zilventorStore.getState().activeAssembly?.components?.length ?? 0,
  );
  expect(count).toBe(1);

  // Geometry hash should be non-empty
  const hash = await page.locator('[data-testid=viewport]').getAttribute('data-geometry-hash');
  expect(hash).toBeTruthy();
});
```

If `__zilventorKernel.packPart` isn't exposed on `window`, expose it (or use whatever serialization mechanism the existing tests use).

- [ ] **Step 2: Run + iterate**

```
pnpm exec playwright test --project=chromium -- place-component
```

Iterate until green.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/assembly/place-component.spec.ts
git commit -m "test(e2e): assembly place-component — drop a part into an assembly

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 27: E2E `place-multiple` + `edit-component-position`

**Files:**
- Create: `tests/e2e/assembly/place-multiple.spec.ts`
- Create: `tests/e2e/assembly/edit-component-position.spec.ts`

- [ ] **Step 1: place-multiple spec**

Mirror Task 26's spec, but click Place → tile → Place 3 times in a row. Assert 3 components, 1 cached `BufferGeometry` (verifiable via `geometryCacheRef.current.size === 1`, exposed for tests if needed), 3 entries in `componentMeshes`.

```ts
test('placing the same part 3 times shares geometry', async ({ page }) => {
  // (setup as place-component)
  // ... save cube.zipt
  // ... new assembly, press P, click tile, click Place
  // Repeat 3 times.
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press('p');
    await page.getByText(/^cube$/).click();
    await page.getByRole('button', { name: /^place$/i }).click();
  }
  const count = await page.evaluate(() =>
    (window as any).__zilventorStore.getState().activeAssembly?.components?.length ?? 0,
  );
  expect(count).toBe(3);

  // Verify shared geometry — expose geometryCacheRef.current.size for test access
  const cacheSize = await page.evaluate(() => (window as any).__zilventorAssemblyGeomCacheSize?.() ?? -1);
  expect(cacheSize).toBe(1);
});
```

(`__zilventorAssemblyGeomCacheSize` is a tiny test-only window helper — expose it from `App.tsx` next to other test hooks.)

- [ ] **Step 2: edit-component-position spec**

```ts
test('edit a component position via dialog', async ({ page }) => {
  // (setup + place 1 component)
  // ...
  // Double-click the component in browser pane
  await page.locator('[data-testid=browser-pane]').getByText(/cube/).first().dblclick();
  await expect(page.getByRole('dialog', { name: /edit component/i })).toBeVisible();

  // Change X to 50
  await page.getByLabel('X').fill('50');
  await page.getByRole('button', { name: /^ok$/i }).click();

  // Assert geometry hash changed
  // (capture hashBefore earlier; assert hashAfter !== hashBefore)
});
```

- [ ] **Step 3: Run + commit**

```bash
git add tests/e2e/assembly/place-multiple.spec.ts \
        tests/e2e/assembly/edit-component-position.spec.ts \
        packages/app/src/App.tsx
git commit -m "test(e2e): assembly place-multiple + edit-component-position

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

(Stage `App.tsx` only if you added the `__zilventorAssemblyGeomCacheSize` test helper.)

---

### Task 28: E2E `delete-component` + `assembly-roundtrip`

**Files:**
- Create: `tests/e2e/assembly/delete-component.spec.ts`
- Create: `tests/e2e/assembly/assembly-roundtrip.spec.ts`

- [ ] **Step 1: delete-component spec**

Place a component. Click it (raycast selection). Click Delete in the ribbon. Assert components.length === 0.

```ts
test('delete a component via ribbon', async ({ page }) => {
  // (setup + place)
  // Select the component
  await page.evaluate(() => {
    const s = (window as any).__zilventorStore;
    const id = s.getState().activeAssembly.components[0].id;
    s.getState().selectComponent(id);
  });
  await page.getByRole('button', { name: /^delete$/i }).click();
  const count = await page.evaluate(() =>
    (window as any).__zilventorStore.getState().activeAssembly?.components?.length ?? -1,
  );
  expect(count).toBe(0);
});
```

- [ ] **Step 2: assembly-roundtrip spec**

```ts
test('save + reload an assembly preserves all components', async ({ page }) => {
  // (setup + place 2 components at different positions)
  // ...
  // Wait for autosave (~600ms after last mutation)
  await page.waitForTimeout(800);
  // Reload the page
  await page.reload();
  // Wait for kernel + assembly to load
  // Open the saved .ziasm file
  await page.evaluate(async () => {
    const opfs = (window as any).__zilventorOpfs;
    const bytes = await opfs.loadFile('untitled-assembly.ziasm');
    // Trigger the app's open-flow programmatically
    await (window as any).__zilventorApp.openBytes(bytes);
  });
  await page.waitForFunction(() => (window as any).__zilventorStore.getState().activeAssembly?.components?.length === 2);
  const positions = await page.evaluate(() =>
    (window as any).__zilventorStore.getState().activeAssembly.components.map((c: any) => c.position),
  );
  expect(positions).toEqual([
    { x: 0, y: 0, z: 0 },
    { x: 50, y: 0, z: 0 },
  ]);
});
```

- [ ] **Step 3: Run + commit**

```bash
git add tests/e2e/assembly/delete-component.spec.ts \
        tests/e2e/assembly/assembly-roundtrip.spec.ts
git commit -m "test(e2e): assembly delete-component + roundtrip

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 29: E2E `missing-part` + perf `assembly-place-debounce`

**Files:**
- Create: `tests/e2e/assembly/missing-part.spec.ts`
- Create: `tests/perf/assembly-place-debounce.spec.ts`

- [ ] **Step 1: missing-part spec**

```ts
test('loading an assembly with a missing partPath shows a placeholder + diagnostic', async ({ page }) => {
  // Programmatically save a .ziasm with partPath: 'nonexistent.zipt'
  await page.evaluate(async () => {
    const k = (window as any).__zilventorKernel;
    const opfs = (window as any).__zilventorOpfs;
    const asm = {
      id: 'A1', name: 'broken', units: 'mm', parameters: {},
      components: [
        { id: 'C1', partPath: 'nonexistent.zipt',
          position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
      ],
    };
    const bytes = await k.packAssembly(asm, new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
    await opfs.saveFile('broken.ziasm', bytes);
  });

  // Open it
  await page.evaluate(async () => {
    const opfs = (window as any).__zilventorOpfs;
    const bytes = await opfs.loadFile('broken.ziasm');
    await (window as any).__zilventorApp.openBytes(bytes);
  });

  // Diagnostic recorded
  const diags = await page.evaluate(() => (window as any).__zilventorStore.getState().componentDiagnostics);
  expect(diags.length).toBeGreaterThan(0);
  expect(diags[0].componentId).toBe('C1');
  expect(diags[0].message).toMatch(/nonexistent/);

  // Assembly still loaded — component count is 1
  const count = await page.evaluate(() =>
    (window as any).__zilventorStore.getState().activeAssembly?.components?.length ?? 0,
  );
  expect(count).toBe(1);
});
```

- [ ] **Step 2: assembly-place-debounce perf spec**

```ts
test('20 rapid Place commits coalesce through autosave', async ({ page }) => {
  // (setup + save cube.zipt)
  // Open assembly via File menu
  await page.getByRole('button', { name: /new assembly/i }).click();
  await page.waitForFunction(() => (window as any).__zilventorStore.getState().activeDocument?.kind === 'assembly');

  // Place 20 components in rapid succession via direct store mutation
  await page.evaluate(() => {
    const s = (window as any).__zilventorStore;
    for (let i = 0; i < 20; i++) {
      s.getState().addComponent({
        id: `C${i}`, partPath: 'parts/cube.zipt',
        position: { x: i * 10, y: 0, z: 0 },
        rotation: { rx: 0, ry: 0, rz: 0 },
        visible: true,
      });
    }
  });

  // Wait for autosave to settle
  await page.waitForTimeout(1500);

  // Reload + verify all 20 components persisted
  await page.reload();
  // (wait + open)
  const count = await page.evaluate(async () => {
    const opfs = (window as any).__zilventorOpfs;
    const bytes = await opfs.loadFile('untitled-assembly.ziasm');
    await (window as any).__zilventorApp.openBytes(bytes);
    return (window as any).__zilventorStore.getState().activeAssembly?.components?.length ?? -1;
  });
  expect(count).toBe(20);
});
```

- [ ] **Step 3: Run + commit**

```bash
git add tests/e2e/assembly/missing-part.spec.ts \
        tests/perf/assembly-place-debounce.spec.ts
git commit -m "test(e2e): assembly missing-part + place-debounce perf

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 30: Manual checklist + memory + push

**Files:**
- Create: `docs/superpowers/manual-tests/subproject-4a.md`
- Create: `~/.claude/projects/-Users-lion-Documents-Projects-mine-zilventor/memory/project_subproject_4a_execution_state.md`
- Modify: MEMORY.md

- [ ] **Step 1: Manual checklist**

```md
# Sub-project 4a manual checklist

- [ ] **New Assembly:** File → New Assembly creates an empty assembly; ribbon switches to Assembly tab.
- [ ] **Place Component (single):** save a part, open new assembly, press P, pick the part, Place; verify the component appears.
- [ ] **Place Component (multiple):** place the same part 3 times; verify 3 instances visible at the same origin (overlapping until edited).
- [ ] **Edit position:** double-click a component, change X to 50, OK; verify the component moves.
- [ ] **Edit rotation:** double-click a component, set RY to 90, OK; verify the component rotates.
- [ ] **Visibility toggle:** uncheck "visible" in edit dialog, OK; verify the component is hidden but still in the browser pane.
- [ ] **Delete component:** click a component in the viewport, click Delete in the ribbon; verify it's removed.
- [ ] **Save + reload:** save the assembly, reload the page, open the .ziasm; verify all components are back at their saved positions.
- [ ] **Missing part:** rename a referenced .zipt to break the link; reopen the assembly; verify a red placeholder appears + a diagnostic is shown.
- [ ] **Switching docs:** open a part, then open an assembly; verify the part-mode browser pane disappears and the assembly view replaces it.
- [ ] **Hotkeys:** P opens Place Component dialog only when an assembly is active.
- [ ] **Browser pane double-click:** opens the edit dialog; cancel preserves prior values.
```

- [ ] **Step 2: Memory file**

Replace `<FINAL_PUSH_SHA>` after the push:

```md
---
name: Sub-project 4a SHIPPED (2026-04-25)
description: Multi-part document + component placement; AssemblyDocument, .ziasm storage, multi-mesh viewport, Place / Edit / Delete dialogs, Assembly ribbon, P hotkey
type: project
---
**Status:** SHIPPED at <FINAL_PUSH_SHA> on origin/master. First piece of Sub-project 4 (Assemblies + BOM).

## What shipped

- **Shared types:** `ComponentInstance`, `AssemblyDocument`, `ProjectFile` discriminator. Migration shim defaults legacy v7 manifests to `kind: 'part'`.
- **Storage:** `AssemblyPacker.ts` (.ziasm pack/unpack); `Opfs` integration tests for assembly round-trip.
- **Store:** `activeDocument: { kind: 'part' | 'assembly', document }` with `activePart`/`activeAssembly` shims + dialog/component CRUD slice.
- **Viewport:** `SceneManager.setComponentMeshes` with diff rendering + shared `BufferGeometry`; geometry hash extended to include component transforms.
- **Pick controller:** `ComponentPickController` for raycaster-driven component selection.
- **Commands:** `NewAssembly`, `OpenPlaceComponentDialog`, `PlaceComponent` (class), `OpenEditComponentDialog`, `EditComponent` (class), `DeleteComponent` (class).
- **Dialogs:** `PlaceComponentDialog` (thumbnail grid), `EditComponentDialog` (position + rotation + visibility).
- **UI:** Browser pane assembly view; new Assembly ribbon tab (Place / Edit / Delete); File → New Assembly menu entry; P hotkey (assembly-only).
- **App.tsx wiring:** assembly-mesh sync (components → SceneManager), File → Open `.ziasm` discriminator, autosave for `.ziasm`, viewport raycaster component selection.

## Key learnings

1. **`activePart` shim during migration.** Renaming the field everywhere at once is brittle; a shim that wraps the new `activeDocument` keeps existing code working incrementally.
2. **Geometry caching by `partPath`.** N components of the same part tessellate once; the cache lives in `App.tsx` and is invalidated only when the underlying `.zipt` changes.
3. **Missing-component handling.** Don't strip missing components from the saved file — they round-trip with diagnostics so the user can re-link.
4. **Assembly mode hides the Model tab.** The ribbon tab discriminator is the cleanest place to enforce this; trying to disable individual buttons fragments quickly.

## Final verification

| Suite | Result |
|---|---|
| `pnpm -r typecheck` | green |
| `pnpm -C packages/shared test:unit` | passed |
| `pnpm --filter @zilventor/kernel exec vitest run` | passed |
| `pnpm -C packages/app test:unit` | passed |
| `pnpm exec playwright test --project=chromium` | place-component + place-multiple + edit-component-position + delete-component + assembly-roundtrip + missing-part green |
| `pnpm exec playwright test --project=perf` | assembly-place-debounce green |
| Manual checklist | spot-checked |

## Where things live

- Spec: `docs/superpowers/specs/2026-04-25-subproject-4a-assembly-placement-design.md`
- Plan: `docs/superpowers/plans/2026-04-25-zilinventor-subproject4a-assembly-placement-plan.md`
- Storage: `packages/kernel/src/storage/AssemblyPacker.ts`
- App: `packages/app/src/shell/{PlaceComponentDialog,EditComponentDialog}.tsx`, `packages/app/src/shell/tabs/AssemblyTab.tsx`
- Commands: `packages/app/src/commands/{NewAssembly,OpenPlaceComponentDialog,PlaceComponent,OpenEditComponentDialog,EditComponent,DeleteComponent}Command.ts`
- Manual: `docs/superpowers/manual-tests/subproject-4a.md`

## Deferred

- Mate constraints (4b)
- Bill of Materials (4c)
- Sub-assemblies (4d)
- Multi-tab interface
- Ghost-cursor preview during placement
- First-component auto-grounded (lands in 4b)
- Per-component color
- Component arrays / patterns
- Recent-files tab in PlaceComponentDialog
- Section views, exploded views, animation
```

Add a one-line entry to `MEMORY.md`:

```md
- [Sub-project 4a SHIPPED (2026-04-25)](project_subproject_4a_execution_state.md) — assembly placement; first piece of Sub-project 4
```

- [ ] **Step 3: Run all suites**

```
pnpm -r typecheck
pnpm -C packages/shared test:unit
pnpm -C packages/app test:unit
pnpm --filter @zilventor/kernel exec vitest run
pnpm exec playwright test --project=chromium
pnpm exec playwright test --project=perf
```

All green.

- [ ] **Step 4: Final commit**

```bash
git add docs/superpowers/manual-tests/subproject-4a.md
git commit -m "docs(manual-test): sub-project 4a checklist

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 5: Push**

```bash
git push origin master
```

Capture final SHA, update memory file's `<FINAL_PUSH_SHA>` placeholder.

---

## Self-review summary

**Spec coverage:**
- `ComponentInstance` / `AssemblyDocument` / `ProjectFile` discriminator → T1
- File format / migration shim → T2
- `.ziasm` packer → T3
- OPFS integration → T4
- `activeDocument` discriminator → T5
- Component CRUD slice → T6
- Multi-mesh viewport → T7, T8
- Component pick controller → T9
- Commands (New, Open dialogs, Place, Edit, Delete) → T10–T14
- Dialogs (Edit, Place, Tile loader) → T15–T17
- Browser pane assembly view → T18
- Assembly ribbon → T19
- New Assembly menu → T20
- App.tsx wiring (dialogs, mesh sync, open, save, raycaster) → T21–T25
- E2E + perf → T26–T29
- Manual + memory + push → T30

**Placeholder scan:** no "TBD" / "implement later" / "handle edge cases". Where something is "find the existing X and match", that's a directive to the implementer to inspect a known file, not a placeholder.

**Type consistency:** `ComponentInstance` shape is identical across all tasks. `ActiveDocument` discriminator is consistent. Command class signatures (`apply`/`revert`) match the established pattern from Hole/Sweep.

## Execution

Continue via the execution skill chosen at the top of the session.

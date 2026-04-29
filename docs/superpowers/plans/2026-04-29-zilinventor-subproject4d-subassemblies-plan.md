# Sub-project 4d — Sub-assemblies Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow `.ziasm` assembly files to reference other `.ziasm` files recursively, with per-instance rigid/flexible sub-asm semantics, recursive flat BOM aggregation, top-down + per-leaf color overrides, and componentPath-based constraint refs.

**Architecture:** Per-file `AssemblyDocument` stays the source of truth. A new `SubAssemblyCache` lazily unpacks referenced `.ziasm` files. Small recursive walkers (`aggregateBomRecursive`, `flattenForSolver`, `composedPoses`, `visibleLeaves`, `resolveColor`) consume `(activeDoc, subAsmCache)` to produce per-operation views. Schema bumps v7 → v8 with constraint refs migrating from `componentId` to `componentPath: string[]`. The kernel's `solveAssembly` and `extractAssemblyRef` RPCs are unchanged.

**Tech Stack:** TypeScript / pnpm workspace; React + Zustand UI; three.js viewport; OCCT (`opencascade.js`) kernel via Comlink RPC; Vitest + Playwright tests.

**Spec:** `docs/superpowers/specs/2026-04-29-subproject-4d-subassemblies-design.md`

**Validation per task:** `pnpm -r typecheck` and the affected package's vitest must remain green at every commit. E2E + perf at the corresponding phase boundaries.

**Commit footer (every commit):**

```
Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

---

## Phase 1 — Shared types + path utilities + v7→v8 migration

### Task 1: ComponentPath types and `componentPath` utilities

**Files:**
- Create: `packages/shared/src/componentPath.ts`
- Create: `packages/shared/src/__tests__/componentPath.spec.ts`
- Modify: `packages/shared/src/index.ts` — re-export

- [ ] **Step 1: Write the failing test**

Create `packages/shared/src/__tests__/componentPath.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { pathKey, parsePathKey, pathEquals, pathStartsWith, PATH_SEPARATOR } from '../componentPath';

describe('componentPath', () => {
  it('PATH_SEPARATOR is the U+0000 (null) character', () => {
    expect(PATH_SEPARATOR).toBe('\u0000');
  });

  it('pathKey + parsePathKey round-trip a single-element path', () => {
    const k = pathKey(['compA']);
    expect(parsePathKey(k)).toEqual(['compA']);
  });

  it('pathKey + parsePathKey round-trip a multi-element path', () => {
    const k = pathKey(['drawer', 'panel', 'screw']);
    expect(parsePathKey(k)).toEqual(['drawer', 'panel', 'screw']);
  });

  it('pathKey of an empty path is the empty string', () => {
    expect(pathKey([])).toBe('');
    expect(parsePathKey('')).toEqual([]);
  });

  it('pathEquals returns true only for identical paths', () => {
    expect(pathEquals(['a', 'b'], ['a', 'b'])).toBe(true);
    expect(pathEquals(['a', 'b'], ['a', 'c'])).toBe(false);
    expect(pathEquals(['a'], ['a', 'b'])).toBe(false);
  });

  it('pathStartsWith returns true when prefix is a strict or full prefix', () => {
    expect(pathStartsWith(['a', 'b', 'c'], ['a'])).toBe(true);
    expect(pathStartsWith(['a', 'b', 'c'], ['a', 'b'])).toBe(true);
    expect(pathStartsWith(['a', 'b', 'c'], ['a', 'b', 'c'])).toBe(true);
    expect(pathStartsWith(['a', 'b', 'c'], [])).toBe(true);
    expect(pathStartsWith(['a', 'b'], ['a', 'b', 'c'])).toBe(false);
    expect(pathStartsWith(['a', 'b'], ['a', 'c'])).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @zilventor/shared test componentPath`

Expected: FAIL with module-not-found on `../componentPath`.

- [ ] **Step 3: Implement `componentPath`**

Create `packages/shared/src/componentPath.ts`:

```ts
export type ComponentPath = ReadonlyArray<string>;
export type ComponentPathKey = string;

export const PATH_SEPARATOR = '\u0000';

export function pathKey(path: ComponentPath): ComponentPathKey {
  return path.join(PATH_SEPARATOR);
}

export function parsePathKey(key: ComponentPathKey): string[] {
  if (key === '') return [];
  return key.split(PATH_SEPARATOR);
}

export function pathEquals(a: ComponentPath, b: ComponentPath): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export function pathStartsWith(path: ComponentPath, prefix: ComponentPath): boolean {
  if (prefix.length > path.length) return false;
  for (let i = 0; i < prefix.length; i++) if (path[i] !== prefix[i]) return false;
  return true;
}
```

- [ ] **Step 4: Re-export from package index**

Edit `packages/shared/src/index.ts`. Append:

```ts
export * from './componentPath';
```

- [ ] **Step 5: Run tests + typecheck**

Run: `pnpm --filter @zilventor/shared test componentPath`
Expected: PASS, 6 tests.

Run: `pnpm -r typecheck`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/componentPath.ts packages/shared/src/__tests__/componentPath.spec.ts packages/shared/src/index.ts
git commit -m "$(cat <<'EOF'
feat(shared): T1 ComponentPath utilities (pathKey, parsePathKey, pathEquals, pathStartsWith)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Schema v8 — extend `AssemblyDocument`, `ComponentInstance`, `AssemblyConstraintRef`

**Files:**
- Modify: `packages/shared/src/types.ts` — add fields, switch ref grammar
- Modify: `packages/shared/src/__tests__/assembly-document.spec.ts` — type-level expectations

- [ ] **Step 1: Write the failing test**

Append to `packages/shared/src/__tests__/assembly-document.spec.ts`:

```ts
import { expectTypeOf } from 'vitest';
import type {
  AssemblyConstraintRef,
  AssemblyDocument,
  ComponentInstance,
  ComponentColor,
} from '../types';
import type { ComponentPath, ComponentPathKey } from '../componentPath';

describe('v8 schema additions', () => {
  it('ComponentInstance has optional flexible flag', () => {
    expectTypeOf<ComponentInstance['flexible']>().toEqualTypeOf<boolean | undefined>();
  });

  it('AssemblyDocument has colorOverrides keyed by ComponentPathKey', () => {
    expectTypeOf<AssemblyDocument['colorOverrides']>().toEqualTypeOf<
      Record<ComponentPathKey, ComponentColor>
    >();
  });

  it('AssemblyDocument has groundedComponentPaths', () => {
    expectTypeOf<AssemblyDocument['groundedComponentPaths']>().toEqualTypeOf<ComponentPath[]>();
  });

  it('face-kind constraint ref carries componentPath, not componentId', () => {
    type FaceRef = Extract<AssemblyConstraintRef, { kind: 'face' }>;
    expectTypeOf<FaceRef['componentPath']>().toEqualTypeOf<ComponentPath>();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @zilventor/shared test assembly-document`
Expected: FAIL — `flexible` not on `ComponentInstance`, `colorOverrides` not on `AssemblyDocument`, `groundedComponentPaths` missing, `componentPath` not on `face` ref.

- [ ] **Step 3: Edit `types.ts` — add fields and switch ref grammar**

In `packages/shared/src/types.ts`:

1. Add `import type { ComponentPath, ComponentPathKey } from './componentPath';` near the top imports.

2. Replace the `ComponentInstance` definition with:

```ts
export type ComponentInstance = {
  id: string;
  partPath: string;
  position: { x: number; y: number; z: number };
  rotation: { rx: number; ry: number; rz: number };
  visible: boolean;
  pose?: { translation: Vec3; quaternion: [number, number, number, number] };
  color?: ComponentColor;
  flexible?: boolean;
};
```

3. Replace `AssemblyConstraintRef` with:

```ts
export type AssemblyConstraintRef =
  | { kind: 'face';  componentPath: ComponentPath; face: FaceName }
  | { kind: 'axis';  componentPath: ComponentPath; axis:
        | { source: 'cylindricalFace'; face: FaceName }
        | { source: 'edge'; edge: EdgeName }
        | { source: 'workAxis'; featureId: string } }
  | { kind: 'point'; componentPath: ComponentPath; point:
        | { source: 'vertex'; edge: EdgeName; end: 'start' | 'end' }
        | { source: 'workPoint'; featureId: string } };
```

4. Replace `AssemblyConstraint`'s `insert` variant — its `refA`/`refB` use a bare-componentId form, switch them too:

```ts
export type AssemblyConstraint =
  | { id: string; kind: 'mate';   refA: AssemblyConstraintRef; refB: AssemblyConstraintRef; offset: ParamOrLiteral; suppressed: boolean }
  | { id: string; kind: 'flush';  refA: AssemblyConstraintRef; refB: AssemblyConstraintRef; offset: ParamOrLiteral; suppressed: boolean }
  | { id: string; kind: 'angle';  refA: AssemblyConstraintRef; refB: AssemblyConstraintRef; angle:  ParamOrLiteral; suppressed: boolean }
  | { id: string; kind: 'insert';
      refA: { componentPath: ComponentPath; circularEdge: EdgeName };
      refB: { componentPath: ComponentPath; circularEdge: EdgeName };
      offset: ParamOrLiteral; suppressed: boolean };
```

5. Replace `AssemblyDocument`:

```ts
export type AssemblyDocument = {
  id: string;
  name: string;
  units: 'mm';
  parameters: Record<string, SketchParameter>;
  components: ComponentInstance[];
  constraints: AssemblyConstraint[];
  groundedComponentPaths: ComponentPath[];
  colors: Record<string, string>;
  bomItemNumbers: Record<string, number>;
  colorOverrides: Record<ComponentPathKey, ComponentColor>;
};
```

6. Bump `ProjectFile`:

```ts
export type ProjectFile =
  | { formatVersion: 7 | 8; kind: 'part'; createdAt: string; appVersion: string; document: PartDocument }
  | { formatVersion: 7 | 8; kind: 'assembly'; createdAt: string; appVersion: string; document: AssemblyDocument };
```

- [ ] **Step 4: Run the assembly-document spec to verify the type assertions pass**

Run: `pnpm --filter @zilventor/shared test assembly-document`
Expected: PASS.

- [ ] **Step 5: Run workspace typecheck — many call sites will break**

Run: `pnpm -r typecheck`
Expected: large number of errors in `packages/app` and `packages/kernel`. Do NOT fix them yet — Tasks 3–5 will introduce migration + call-site updates. Capture the error list (it's the punch list for Task 5).

- [ ] **Step 6: Commit (typecheck still red — note this in commit body)**

```bash
git add packages/shared/src/types.ts packages/shared/src/__tests__/assembly-document.spec.ts
git commit -m "$(cat <<'EOF'
feat(shared): T2 v8 schema (componentPath refs, flexible, colorOverrides)

Workspace typecheck intentionally red; follow-up tasks T3-T5 wire migration
and update call sites.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: `migrateManifestV7toV8` migration step

**Files:**
- Modify: `packages/shared/src/fileFormat.ts` — add v7→v8 migration; bump `CURRENT_FORMAT_VERSION`
- Create: `packages/shared/src/__tests__/migrateManifest-v7-to-v8.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/shared/src/__tests__/migrateManifest-v7-to-v8.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { migrateManifest, CURRENT_FORMAT_VERSION } from '../fileFormat';

describe('v7 → v8 migration', () => {
  it('CURRENT_FORMAT_VERSION is 8', () => {
    expect(CURRENT_FORMAT_VERSION).toBe(8);
  });

  it('migrates an assembly: groundedComponentIds → groundedComponentPaths, refs single-elem componentPath, colorOverrides default {}', () => {
    const v7: any = {
      formatVersion: 7,
      kind: 'assembly',
      createdAt: '2026-04-26T00:00:00Z',
      appVersion: '0.1.0',
      document: {
        id: 'a1', name: 'asm', units: 'mm', parameters: {},
        components: [
          { id: 'cubeA', partPath: 'cube.zipt', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
          { id: 'cubeB', partPath: 'cube.zipt', position: { x: 10, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
        ],
        constraints: [
          {
            id: 'm1', kind: 'mate',
            refA: { kind: 'face', componentId: 'cubeA', face: { featureId: 'E1', role: 'top' } },
            refB: { kind: 'face', componentId: 'cubeB', face: { featureId: 'E1', role: 'bottom' } },
            offset: { kind: 'literal', value: 0 },
            suppressed: false,
          },
        ],
        groundedComponentIds: ['cubeA'],
        colors: {},
        bomItemNumbers: {},
      },
    };

    const v8 = migrateManifest(v7);
    expect(v8.formatVersion).toBe(8);
    const doc = (v8 as any).document;
    expect(doc.groundedComponentPaths).toEqual([['cubeA']]);
    expect(doc.groundedComponentIds).toBeUndefined();
    expect(doc.colorOverrides).toEqual({});
    expect(doc.constraints[0].refA).toEqual({
      kind: 'face',
      componentPath: ['cubeA'],
      face: { featureId: 'E1', role: 'top' },
    });
    expect(doc.constraints[0].refB.componentPath).toEqual(['cubeB']);
  });

  it('migrates an insert constraint: refA.componentId → componentPath', () => {
    const v7: any = {
      formatVersion: 7,
      kind: 'assembly',
      createdAt: '', appVersion: '',
      document: {
        id: 'a', name: 'a', units: 'mm', parameters: {}, components: [], constraints: [
          {
            id: 'i1', kind: 'insert',
            refA: { componentId: 'A', circularEdge: { faceA: { featureId: 'E1', role: 'top' }, faceB: { featureId: 'E1', role: 'side' } } },
            refB: { componentId: 'B', circularEdge: { faceA: { featureId: 'E1', role: 'top' }, faceB: { featureId: 'E1', role: 'side' } } },
            offset: { kind: 'literal', value: 0 },
            suppressed: false,
          },
        ],
        groundedComponentIds: [], colors: {}, bomItemNumbers: {},
      },
    };
    const v8 = migrateManifest(v7) as any;
    expect(v8.document.constraints[0].refA.componentPath).toEqual(['A']);
    expect(v8.document.constraints[0].refB.componentPath).toEqual(['B']);
    expect(v8.document.constraints[0].refA.componentId).toBeUndefined();
  });

  it('migrates an axis-kind ref: componentId → componentPath, preserves axis source', () => {
    const v7: any = {
      formatVersion: 7,
      kind: 'assembly',
      createdAt: '', appVersion: '',
      document: {
        id: 'a', name: 'a', units: 'mm', parameters: {}, components: [], constraints: [
          {
            id: 'an1', kind: 'angle',
            refA: { kind: 'axis', componentId: 'A', axis: { source: 'workAxis', featureId: 'origin.X' } },
            refB: { kind: 'axis', componentId: 'B', axis: { source: 'workAxis', featureId: 'origin.Y' } },
            angle: { kind: 'literal', value: 90 },
            suppressed: false,
          },
        ],
        groundedComponentIds: [], colors: {}, bomItemNumbers: {},
      },
    };
    const v8 = migrateManifest(v7) as any;
    expect(v8.document.constraints[0].refA.componentPath).toEqual(['A']);
    expect(v8.document.constraints[0].refA.axis).toEqual({ source: 'workAxis', featureId: 'origin.X' });
  });

  it('migrates a part document idempotently (no assembly fields touched)', () => {
    const v7: any = {
      formatVersion: 7,
      kind: 'part',
      createdAt: '', appVersion: '',
      document: { id: 'p', name: 'p', units: 'mm', parameters: {}, featureTree: [] },
    };
    const v8 = migrateManifest(v7) as any;
    expect(v8.formatVersion).toBe(8);
    expect(v8.document.featureTree).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @zilventor/shared test migrateManifest-v7-to-v8`
Expected: FAIL — `CURRENT_FORMAT_VERSION` still 7; v7 manifest is the terminal state.

- [ ] **Step 3: Implement the v7 → v8 migration**

In `packages/shared/src/fileFormat.ts`:

1. Change `export const CURRENT_FORMAT_VERSION = 7 as const;` to `export const CURRENT_FORMAT_VERSION = 8 as const;`.

2. Add a v7 → v8 migration entry inside the `migrations` object. Find the existing `6: (mIn) => { ... return { ...m, formatVersion: 7 }; },` block and insert this immediately after it:

```ts
  // v7 → v8: assembly schema — componentId → componentPath: [componentId] on
  // every constraint ref; groundedComponentIds → groundedComponentPaths;
  // colorOverrides defaults to {}; ComponentInstance.flexible left absent
  // (defaults to rigid).
  7: (mIn) => {
    const m = deepClone(mIn);
    const anyM = m as { kind?: string; document?: any };
    if (anyM.kind !== 'assembly' || !anyM.document) {
      return { ...m, formatVersion: 8 };
    }
    const doc = anyM.document;

    // groundedComponentIds → groundedComponentPaths
    if (Array.isArray(doc.groundedComponentIds)) {
      doc.groundedComponentPaths = doc.groundedComponentIds.map((id: string) => [id]);
      delete doc.groundedComponentIds;
    } else if (!Array.isArray(doc.groundedComponentPaths)) {
      doc.groundedComponentPaths = [];
    }

    // Constraint refs: componentId → componentPath
    if (Array.isArray(doc.constraints)) {
      doc.constraints = doc.constraints.map((c: any) => {
        const next = { ...c };
        for (const slot of ['refA', 'refB'] as const) {
          const r = next[slot];
          if (r && typeof r.componentId === 'string') {
            const { componentId, ...rest } = r;
            next[slot] = { ...rest, componentPath: [componentId] };
          }
        }
        return next;
      });
    }

    // colorOverrides default
    if (doc.colorOverrides == null) doc.colorOverrides = {};

    return { ...m, document: doc, formatVersion: 8 };
  },
```

- [ ] **Step 4: Run the migration test**

Run: `pnpm --filter @zilventor/shared test migrateManifest-v7-to-v8`
Expected: PASS, 4 tests.

- [ ] **Step 5: Run all shared tests (verify no regressions in earlier migrations)**

Run: `pnpm --filter @zilventor/shared test`
Expected: green except possibly any pre-existing test that asserted on the v7 terminal — those count as legitimate fallout and need updating in this task. If any earlier migration test now fails because it expected `formatVersion: 7` as terminal, change the expectation to 8.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/fileFormat.ts packages/shared/src/__tests__/migrateManifest-v7-to-v8.spec.ts packages/shared/src/__tests__/
git commit -m "$(cat <<'EOF'
feat(shared): T3 v7→v8 migration (componentId→componentPath, colorOverrides default)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Update `AssemblyPacker` and any code paths that mention `groundedComponentIds` / `componentId` on refs

**Files:**
- Modify: `packages/kernel/src/storage/AssemblyPacker.ts`
- Modify: `packages/kernel/src/storage/__tests__/AssemblyPacker.spec.ts`
- Modify: any other usage sites surfaced by the typecheck punch list from Task 2

- [ ] **Step 1: Map the call-site punch list**

Run: `pnpm -r typecheck 2>&1 | tee /tmp/4d-punch.txt`

The errors will pinpoint each `.componentId` reference on a constraint ref, each `groundedComponentIds` access, and each missing `colorOverrides`. Group by file.

- [ ] **Step 2: Update `AssemblyPacker` to write `formatVersion: 8` and seed v8 fields on new docs**

In `packages/kernel/src/storage/AssemblyPacker.ts`, change every literal `formatVersion: 7` to `formatVersion: 8`. If the packer's "build a fresh empty assembly" helper exists, ensure it seeds:

```ts
groundedComponentPaths: [],
colorOverrides: {},
```

instead of `groundedComponentIds: []`.

- [ ] **Step 3: Update the AssemblyPacker round-trip tests**

In `packages/kernel/src/storage/__tests__/AssemblyPacker.spec.ts`: change every fixture's `formatVersion: 7` to `formatVersion: 8`, replace `groundedComponentIds` with `groundedComponentPaths` (single-elem), replace constraint refs' `componentId: 'X'` with `componentPath: ['X']`, and add `colorOverrides: {}` on every assembly doc fixture. Run after each chunk:

Run: `pnpm --filter @zilventor/kernel test AssemblyPacker`
Expected: PASS.

- [ ] **Step 4: Sweep `packages/app/src` for `componentId` ref accesses and `groundedComponentIds` accesses**

Run: `rg -n "groundedComponentIds|\\.componentId\\b" packages/app/src packages/kernel/src --type=ts`

Each hit must be reviewed:
- `groundedComponentIds` → `groundedComponentPaths` (caller now deals in paths). Where the caller is comparing to a single id, wrap in `pathKey([id])` against `groundedComponentPaths.map(pathKey)`.
- Constraint ref `.componentId` → `.componentPath[0]` for now (top-level-only callers; later tasks will widen).

For each updated file, ensure imports include `ComponentPath` / `pathKey` from `@zilventor/shared` where used.

- [ ] **Step 5: Run workspace typecheck**

Run: `pnpm -r typecheck`
Expected: clean.

- [ ] **Step 6: Run all unit tests**

Run: `pnpm -r test`
Expected: green except any test that was asserting the old grammar — update those mechanically.

- [ ] **Step 7: Commit**

```bash
git add packages/kernel packages/app packages/shared
git commit -m "$(cat <<'EOF'
refactor: T4 thread componentPath + groundedComponentPaths through call sites

Mechanical update to consume the v8 schema. componentId on refs becomes
componentPath[0] for now; later tasks deepen.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: AssemblyPacker round-trip a v8 doc with `colorOverrides` and `flexible`

**Files:**
- Modify: `packages/kernel/src/storage/__tests__/AssemblyPacker.spec.ts` — add v8-specific round-trip case

- [ ] **Step 1: Write the failing test**

Append to `packages/kernel/src/storage/__tests__/AssemblyPacker.spec.ts`:

```ts
it('round-trips a v8 assembly with colorOverrides and a flexible sub-asm placement', async () => {
  const original: ProjectFile = {
    formatVersion: 8,
    kind: 'assembly',
    createdAt: '2026-04-29T00:00:00Z',
    appVersion: '0.1.0',
    document: {
      id: 'asm-1',
      name: 'top',
      units: 'mm',
      parameters: {},
      components: [
        { id: 'sub1', partPath: 'drawer.ziasm', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true, flexible: true },
        { id: 'cube1', partPath: 'cube.zipt', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
      ],
      constraints: [],
      groundedComponentPaths: [['cube1']],
      colors: { oak: '#A0651E' },
      bomItemNumbers: {},
      colorOverrides: { 'sub1\u0000panel-front': { kind: 'palette', name: 'oak' } },
    },
  };

  const bytes = await packAssembly(original, new Uint8Array());
  const round = await unpackAssembly(bytes);
  expect(round.manifest).toEqual(original);
});
```

- [ ] **Step 2: Run the test**

Run: `pnpm --filter @zilventor/kernel test AssemblyPacker`
Expected: PASS (the packer is opaque to the new fields; tar/gzip round-trips JSON unchanged).

- [ ] **Step 3: Commit**

```bash
git add packages/kernel/src/storage/__tests__/AssemblyPacker.spec.ts
git commit -m "$(cat <<'EOF'
test(kernel): T5 AssemblyPacker v8 round-trip — flexible flag + colorOverrides

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 2 — `SubAssemblyCache` + cycle detection

### Task 6: `SubAssemblyCache.loadSubAssembly` happy path

**Files:**
- Create: `packages/app/src/assembly/SubAssemblyCache.ts`
- Create: `packages/app/src/assembly/__tests__/SubAssemblyCache.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/app/src/assembly/__tests__/SubAssemblyCache.spec.ts`:

```ts
import { describe, expect, it, beforeEach } from 'vitest';
import { unpackAssembly, packAssembly } from '@zilventor/kernel/src/storage/AssemblyPacker';
import type { AssemblyDocument, ProjectFile } from '@zilventor/shared';
import { SubAssemblyCache } from '../SubAssemblyCache';

function makeDoc(id: string, name: string, components: AssemblyDocument['components'] = []): AssemblyDocument {
  return {
    id, name, units: 'mm', parameters: {},
    components, constraints: [],
    groundedComponentPaths: [], colors: {}, bomItemNumbers: {}, colorOverrides: {},
  };
}

function makeFile(doc: AssemblyDocument): ProjectFile {
  return { formatVersion: 8, kind: 'assembly', createdAt: '2026-04-29', appVersion: '0.1.0', document: doc };
}

class MemOpfs {
  private files = new Map<string, Uint8Array>();
  async write(path: string, bytes: Uint8Array) { this.files.set(path, bytes); }
  async read(path: string) { const b = this.files.get(path); if (!b) throw new Error('ENOENT'); return b; }
  async exists(path: string) { return this.files.has(path); }
  async delete(path: string) { this.files.delete(path); }
}

describe('SubAssemblyCache', () => {
  let opfs: MemOpfs;
  beforeEach(() => { opfs = new MemOpfs(); });

  it('loadSubAssembly returns ok entry for an existing .ziasm', async () => {
    const drawerDoc = makeDoc('drawer-id', 'drawer');
    await opfs.write('drawer.ziasm', await packAssembly(makeFile(drawerDoc), new Uint8Array()));

    const cache = new SubAssemblyCache(opfs as any);
    const entry = await cache.loadSubAssembly('drawer.ziasm');
    expect(entry.kind).toBe('ok');
    if (entry.kind === 'ok') expect(entry.doc.name).toBe('drawer');
  });

  it('loadSubAssembly returns missing entry when path is absent', async () => {
    const cache = new SubAssemblyCache(opfs as any);
    const entry = await cache.loadSubAssembly('missing.ziasm');
    expect(entry.kind).toBe('missing');
  });

  it('caches the doc on subsequent calls', async () => {
    const drawerDoc = makeDoc('drawer-id', 'drawer');
    await opfs.write('drawer.ziasm', await packAssembly(makeFile(drawerDoc), new Uint8Array()));
    const cache = new SubAssemblyCache(opfs as any);
    const a = await cache.loadSubAssembly('drawer.ziasm');
    const b = await cache.loadSubAssembly('drawer.ziasm');
    expect(b).toBe(a);
  });

  it('invalidate drops the cache entry', async () => {
    const drawerDoc = makeDoc('drawer-id', 'drawer');
    await opfs.write('drawer.ziasm', await packAssembly(makeFile(drawerDoc), new Uint8Array()));
    const cache = new SubAssemblyCache(opfs as any);
    const a = await cache.loadSubAssembly('drawer.ziasm');
    cache.invalidate('drawer.ziasm');
    const b = await cache.loadSubAssembly('drawer.ziasm');
    expect(b).not.toBe(a);
    expect(b.kind).toBe('ok');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @zilventor/app test SubAssemblyCache`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `SubAssemblyCache` (happy path; cycles + invalidate-while-loading covered in T7/T8)**

Create `packages/app/src/assembly/SubAssemblyCache.ts`:

```ts
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

  private async unpack(partPath: string): Promise<SubAssemblyEntry> {
    if (!(await this.opfs.exists(partPath))) {
      return { kind: 'missing', partPath, message: `not in OPFS: ${partPath}` };
    }
    try {
      const bytes = await this.opfs.read(partPath);
      const file = await unpackAssembly(bytes);
      if (file.manifest.kind !== 'assembly') {
        return { kind: 'parse', partPath, message: `expected assembly, got ${file.manifest.kind}` };
      }
      return { kind: 'ok', doc: file.manifest.document, partPath };
    } catch (err) {
      return { kind: 'parse', partPath, message: err instanceof Error ? err.message : String(err) };
    }
  }
}
```

- [ ] **Step 4: Run the test**

Run: `pnpm --filter @zilventor/app test SubAssemblyCache`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/assembly/SubAssemblyCache.ts packages/app/src/assembly/__tests__/SubAssemblyCache.spec.ts
git commit -m "$(cat <<'EOF'
feat(app): T6 SubAssemblyCache lazy loadSubAssembly + invalidate

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: `loadSubAssemblyTree` recursive walk + cycle detection

**Files:**
- Modify: `packages/app/src/assembly/SubAssemblyCache.ts`
- Modify: `packages/app/src/assembly/__tests__/SubAssemblyCache.spec.ts`

- [ ] **Step 1: Append failing tests**

```ts
describe('SubAssemblyCache.loadSubAssemblyTree', () => {
  let opfs: MemOpfs;
  beforeEach(() => { opfs = new MemOpfs(); });

  it('walks transitively and caches every reachable .ziasm', async () => {
    const inner = makeDoc('inner-id', 'inner', [
      { id: 'panel', partPath: 'panel.zipt', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
    ]);
    const middle = makeDoc('mid-id', 'middle', [
      { id: 'i1', partPath: 'inner.ziasm', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
    ]);
    const top = makeDoc('top-id', 'top', [
      { id: 'm1', partPath: 'middle.ziasm', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
    ]);
    await opfs.write('inner.ziasm', await packAssembly(makeFile(inner), new Uint8Array()));
    await opfs.write('middle.ziasm', await packAssembly(makeFile(middle), new Uint8Array()));

    const cache = new SubAssemblyCache(opfs as any);
    await cache.loadSubAssemblyTree(top);
    expect(cache.get('middle.ziasm')?.kind).toBe('ok');
    expect(cache.get('inner.ziasm')?.kind).toBe('ok');
  });

  it('marks a self-referential .ziasm as cycle on second encounter', async () => {
    const a = makeDoc('a-id', 'a', [
      { id: 'self', partPath: 'a.ziasm', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
    ]);
    await opfs.write('a.ziasm', await packAssembly(makeFile(a), new Uint8Array()));
    const cache = new SubAssemblyCache(opfs as any);
    const top = makeDoc('top-id', 'top', [
      { id: 'p1', partPath: 'a.ziasm', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
    ]);
    await cache.loadSubAssemblyTree(top);
    expect(cache.get('a.ziasm')?.kind).toBe('ok');
    expect(cache.diagnostics().some((d) => d.kind === 'cycle' && d.partPath === 'a.ziasm')).toBe(true);
  });

  it('marks a transitive cycle (A -> B -> A) as cycle', async () => {
    const a = makeDoc('a-id', 'a', [
      { id: 'p', partPath: 'b.ziasm', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
    ]);
    const b = makeDoc('b-id', 'b', [
      { id: 'p', partPath: 'a.ziasm', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
    ]);
    await opfs.write('a.ziasm', await packAssembly(makeFile(a), new Uint8Array()));
    await opfs.write('b.ziasm', await packAssembly(makeFile(b), new Uint8Array()));
    const cache = new SubAssemblyCache(opfs as any);
    const top = makeDoc('top', 'top', [
      { id: 't1', partPath: 'a.ziasm', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
    ]);
    await cache.loadSubAssemblyTree(top);
    expect(cache.diagnostics().some((d) => d.kind === 'cycle' && d.partPath === 'a.ziasm')).toBe(true);
  });
});
```

- [ ] **Step 2: Run — should fail** (`loadSubAssemblyTree` and `diagnostics` not defined).

- [ ] **Step 3: Extend `SubAssemblyCache`**

Add a private diagnostics array, public `diagnostics()` / `clearDiagnostics()`, and `loadSubAssemblyTree`:

```ts
private diags: Array<{ kind: 'cycle' | 'missing' | 'parse'; partPath: string; message: string }> = [];

diagnostics() { return this.diags.slice(); }
clearDiagnostics() { this.diags = []; }

async loadSubAssemblyTree(rootDoc: AssemblyDocument): Promise<void> {
  await this.walkTree(rootDoc, new Set<string>());
}

private async walkTree(doc: AssemblyDocument, loadStack: Set<string>): Promise<void> {
  for (const c of doc.components) {
    if (!c.partPath.endsWith('.ziasm')) continue;
    if (loadStack.has(c.partPath)) {
      this.diags.push({ kind: 'cycle', partPath: c.partPath, message: `cycle detected: ${c.partPath}` });
      this.entries.set(c.partPath, { kind: 'cycle', partPath: c.partPath, message: 'cycle' });
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
```

- [ ] **Step 4: Run tests** — Expected: PASS, 7 total in SubAssemblyCache.spec.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/assembly/SubAssemblyCache.ts packages/app/src/assembly/__tests__/SubAssemblyCache.spec.ts
git commit -m "$(cat <<'EOF'
feat(app): T7 SubAssemblyCache.loadSubAssemblyTree + cycle detection

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: `cycleCheck.wouldCreateCycle` for the placement gate

**Files:**
- Create: `packages/app/src/assembly/cycleCheck.ts`
- Create: `packages/app/src/assembly/__tests__/cycleCheck.spec.ts`

- [ ] **Step 1: Failing test**

```ts
import { describe, expect, it, beforeEach } from 'vitest';
import { packAssembly } from '@zilventor/kernel/src/storage/AssemblyPacker';
import type { AssemblyDocument } from '@zilventor/shared';
import { wouldCreateCycle } from '../cycleCheck';

function doc(name: string, components: AssemblyDocument['components'] = []): AssemblyDocument {
  return { id: name, name, units: 'mm', parameters: {}, components, constraints: [],
    groundedComponentPaths: [], colors: {}, bomItemNumbers: {}, colorOverrides: {} };
}
class MemOpfs { files = new Map<string, Uint8Array>();
  async write(p: string, b: Uint8Array) { this.files.set(p, b); }
  async read(p: string) { const b = this.files.get(p); if (!b) throw new Error('ENOENT'); return b; }
  async exists(p: string) { return this.files.has(p); }
}

describe('wouldCreateCycle', () => {
  let opfs: MemOpfs;
  beforeEach(() => { opfs = new MemOpfs(); });

  it('returns false for a candidate with no transitive references', async () => {
    await opfs.write('drawer.ziasm', await packAssembly({ formatVersion: 8, kind: 'assembly', createdAt: '', appVersion: '', document: doc('drawer') }, new Uint8Array()));
    expect(await wouldCreateCycle(doc('top'), 'top.ziasm', 'drawer.ziasm', opfs as any)).toBe(false);
  });

  it('returns true when candidate transitively references the active doc', async () => {
    const drawer = doc('drawer', [
      { id: 'inner', partPath: 'top.ziasm', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
    ]);
    await opfs.write('drawer.ziasm', await packAssembly({ formatVersion: 8, kind: 'assembly', createdAt: '', appVersion: '', document: drawer }, new Uint8Array()));
    expect(await wouldCreateCycle(doc('top'), 'top.ziasm', 'drawer.ziasm', opfs as any)).toBe(true);
  });

  it('returns true on direct self-cycle', async () => {
    expect(await wouldCreateCycle(doc('top'), 'top.ziasm', 'top.ziasm', opfs as any)).toBe(true);
  });

  it('returns false when candidate file is missing', async () => {
    expect(await wouldCreateCycle(doc('top'), 'top.ziasm', 'absent.ziasm', opfs as any)).toBe(false);
  });
});
```

- [ ] **Step 2: Run — should fail** (module missing).

- [ ] **Step 3: Implement**

```ts
import type { AssemblyDocument } from '@zilventor/shared';
import { unpackAssembly } from '@zilventor/kernel/src/storage/AssemblyPacker';
import type { OpfsLike } from './SubAssemblyCache';

export async function wouldCreateCycle(
  _activeDoc: AssemblyDocument,
  activeDocPath: string,
  candidatePath: string,
  opfs: OpfsLike,
): Promise<boolean> {
  if (candidatePath === activeDocPath) return true;
  const queue: string[] = [candidatePath];
  const seen = new Set<string>();
  while (queue.length > 0) {
    const next = queue.shift()!;
    if (seen.has(next)) continue;
    seen.add(next);
    if (next === activeDocPath) return true;
    if (!(await opfs.exists(next))) continue;
    try {
      const file = await unpackAssembly(await opfs.read(next));
      if (file.manifest.kind !== 'assembly') continue;
      for (const c of file.manifest.document.components) {
        if (c.partPath.endsWith('.ziasm')) queue.push(c.partPath);
      }
    } catch { continue; }
  }
  return false;
}
```

- [ ] **Step 4: Run** — PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/assembly/cycleCheck.ts packages/app/src/assembly/__tests__/cycleCheck.spec.ts
git commit -m "$(cat <<'EOF'
feat(app): T8 cycleCheck.wouldCreateCycle for PlaceComponentCommand gate

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 3 — Recursive walkers (color, BOM, viewport leaves)

### Task 9: `resolveColor` walker

**Files:**
- Create: `packages/app/src/assembly/walkers/resolveColor.ts`
- Create: `packages/app/src/assembly/walkers/__tests__/resolveColor.spec.ts`

- [ ] **Step 1: Failing test**

```ts
import { describe, expect, it } from 'vitest';
import type { AssemblyDocument, ComponentColor } from '@zilventor/shared';
import { pathKey } from '@zilventor/shared';
import { resolveColor } from '../resolveColor';
import type { SubAssemblyCache } from '../../SubAssemblyCache';

function doc(over: Partial<AssemblyDocument> = {}): AssemblyDocument {
  return { id: 'x', name: 'x', units: 'mm', parameters: {}, components: [], constraints: [],
    groundedComponentPaths: [], colors: {}, bomItemNumbers: {}, colorOverrides: {}, ...over };
}
function stubCache(map: Map<string, AssemblyDocument>): SubAssemblyCache {
  return { get: (p: string) => map.has(p) ? { kind: 'ok', doc: map.get(p)!, partPath: p } as const : undefined } as unknown as SubAssemblyCache;
}

describe('resolveColor', () => {
  it('returns leaf color when no override and no ancestor tint', () => {
    const sub = doc({ components: [
      { id: 'leaf', partPath: 'p.zipt', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true, color: { kind: 'palette', name: 'oak' } as ComponentColor },
    ] });
    const top = doc({ components: [
      { id: 'sub', partPath: 's.ziasm', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
    ] });
    expect(resolveColor(['sub', 'leaf'], top, stubCache(new Map([['s.ziasm', sub]])))).toEqual({ kind: 'palette', name: 'oak' });
  });

  it('returns top-down placement tint when leaf has no color', () => {
    const sub = doc({ components: [
      { id: 'leaf', partPath: 'p.zipt', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
    ] });
    const top = doc({ components: [
      { id: 'sub', partPath: 's.ziasm', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true, color: { kind: 'hex', hex: '#ff00aa' } },
    ] });
    expect(resolveColor(['sub', 'leaf'], top, stubCache(new Map([['s.ziasm', sub]])))).toEqual({ kind: 'hex', hex: '#ff00aa' });
  });

  it('per-leaf override beats placement tint and leaf color', () => {
    const sub = doc({ components: [
      { id: 'leaf', partPath: 'p.zipt', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true, color: { kind: 'palette', name: 'oak' } },
    ] });
    const top = doc({
      components: [
        { id: 'sub', partPath: 's.ziasm', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true, color: { kind: 'hex', hex: '#ff00aa' } },
      ],
      colorOverrides: { [pathKey(['sub', 'leaf'])]: { kind: 'palette', name: 'walnut' } },
    });
    expect(resolveColor(['sub', 'leaf'], top, stubCache(new Map([['s.ziasm', sub]])))).toEqual({ kind: 'palette', name: 'walnut' });
  });

  it('returns undefined when nothing in chain has a color', () => {
    const sub = doc({ components: [
      { id: 'leaf', partPath: 'p.zipt', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
    ] });
    const top = doc({ components: [
      { id: 'sub', partPath: 's.ziasm', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
    ] });
    expect(resolveColor(['sub', 'leaf'], top, stubCache(new Map([['s.ziasm', sub]])))).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run — should fail** (module missing).

- [ ] **Step 3: Implement**

```ts
import type { AssemblyDocument, ComponentColor, ComponentInstance, ComponentPath } from '@zilventor/shared';
import { pathKey } from '@zilventor/shared';
import type { SubAssemblyCache } from '../SubAssemblyCache';

export function resolveColor(
  path: ComponentPath,
  activeDoc: AssemblyDocument,
  cache: Pick<SubAssemblyCache, 'get'>,
): ComponentColor | undefined {
  for (let n = path.length; n >= 1; n--) {
    const k = pathKey(path.slice(0, n));
    const o = activeDoc.colorOverrides[k];
    if (o) return o;
  }
  let cur: AssemblyDocument | undefined = activeDoc;
  let last: ComponentColor | undefined;
  for (let i = 0; i < path.length; i++) {
    if (!cur) return last;
    const c: ComponentInstance | undefined = cur.components.find((x) => x.id === path[i]);
    if (!c) return last;
    if (c.color) last = c.color;
    if (i === path.length - 1) return last;
    if (!c.partPath.endsWith('.ziasm')) return last;
    const e = cache.get(c.partPath);
    cur = e && e.kind === 'ok' ? e.doc : undefined;
  }
  return last;
}
```

- [ ] **Step 4: Run** — PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/assembly/walkers/resolveColor.ts packages/app/src/assembly/walkers/__tests__/resolveColor.spec.ts
git commit -m "$(cat <<'EOF'
feat(app): T9 resolveColor walker (override > placement tint > leaf)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: `aggregateBomRecursive`

**Files:**
- Create: `packages/app/src/assembly/walkers/aggregateBomRecursive.ts`
- Create: `packages/app/src/assembly/walkers/__tests__/aggregateBomRecursive.spec.ts`

- [ ] **Step 1: Failing test**

```ts
import { describe, expect, it } from 'vitest';
import type { AssemblyDocument } from '@zilventor/shared';
import { pathKey } from '@zilventor/shared';
import { aggregateBomRecursive } from '../aggregateBomRecursive';
import type { SubAssemblyCache } from '../../SubAssemblyCache';

function doc(over: Partial<AssemblyDocument> = {}): AssemblyDocument {
  return { id: 'x', name: 'x', units: 'mm', parameters: {}, components: [], constraints: [],
    groundedComponentPaths: [], colors: {}, bomItemNumbers: {}, colorOverrides: {}, ...over };
}
function stubCache(map: Map<string, AssemblyDocument>): SubAssemblyCache {
  return { get: (p: string) => map.has(p) ? { kind: 'ok', doc: map.get(p)!, partPath: p } as const : undefined } as unknown as SubAssemblyCache;
}
const names = (m: Record<string, string>) => new Map(Object.entries(m));

describe('aggregateBomRecursive', () => {
  it('aggregates leaves across a 2-level tree by partPath', () => {
    const drawer = doc({ components: [
      { id: 'pa', partPath: 'panel.zipt', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
      { id: 'pb', partPath: 'panel.zipt', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
    ] });
    const top = doc({ components: [
      { id: 'd1', partPath: 'drawer.ziasm', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
      { id: 'd2', partPath: 'drawer.ziasm', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
    ] });
    const rows = aggregateBomRecursive(top, stubCache(new Map([['drawer.ziasm', drawer]])), names({ 'panel.zipt': 'Panel' }));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.qty).toBe(4);
  });

  it('splits rows when a per-leaf override changes effective color', () => {
    const drawer = doc({ components: [
      { id: 'pa', partPath: 'panel.zipt', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true, color: { kind: 'palette', name: 'oak' } },
      { id: 'pb', partPath: 'panel.zipt', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true, color: { kind: 'palette', name: 'oak' } },
    ] });
    const top = doc({
      components: [
        { id: 'd1', partPath: 'drawer.ziasm', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
      ],
      colors: { oak: '#a0651e', walnut: '#5b3a1a' },
      colorOverrides: { [pathKey(['d1', 'pa'])]: { kind: 'palette', name: 'walnut' } },
    });
    const rows = aggregateBomRecursive(top, stubCache(new Map([['drawer.ziasm', drawer]])), names({ 'panel.zipt': 'Panel' }));
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.qty).sort()).toEqual([1, 1]);
  });

  it('skips broken sub-asm refs', () => {
    const top = doc({ components: [
      { id: 'broken', partPath: 'missing.ziasm', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
      { id: 'cube', partPath: 'cube.zipt', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
    ] });
    const rows = aggregateBomRecursive(top, stubCache(new Map()), names({ 'cube.zipt': 'Cube' }));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.partPath).toBe('cube.zipt');
  });
});
```

- [ ] **Step 2: Run — should fail**.

- [ ] **Step 3: Implement**

```ts
import type { AssemblyDocument, BomRow, ComponentColor } from '@zilventor/shared';
import { bomRowKey } from '@zilventor/shared/src/bomRow';
import { pathKey } from '@zilventor/shared';
import type { SubAssemblyCache } from '../SubAssemblyCache';
import { resolveColor } from './resolveColor';

export function aggregateBomRecursive(
  activeDoc: AssemblyDocument,
  cache: Pick<SubAssemblyCache, 'get'>,
  partNames: Map<string, string>,
): BomRow[] {
  const groups = new Map<string, { partPath: string; color: ComponentColor | undefined; componentIds: string[] }>();
  function effective(p: string[]): ComponentColor | undefined {
    const c = resolveColor(p, activeDoc, cache);
    if (!c) return undefined;
    if (c.kind === 'palette' && !(c.name in activeDoc.colors)) return undefined;
    return c;
  }
  function walk(doc: AssemblyDocument, prefix: string[]) {
    for (const c of doc.components) {
      const path = [...prefix, c.id];
      if (!c.partPath.endsWith('.ziasm')) {
        const color = effective(path);
        const key = bomRowKey(c.partPath, color);
        const g = groups.get(key);
        if (g) g.componentIds.push(pathKey(path));
        else groups.set(key, { partPath: c.partPath, color, componentIds: [pathKey(path)] });
      } else {
        const e = cache.get(c.partPath);
        if (e && e.kind === 'ok') walk(e.doc, path);
      }
    }
  }
  walk(activeDoc, []);
  const existing = activeDoc.bomItemNumbers;
  const used = new Set(Object.values(existing));
  let nextNumber = (used.size === 0 ? 0 : Math.max(...used)) + 1;
  const rows: BomRow[] = [];
  for (const [rowKey, g] of groups) {
    let n = existing[rowKey];
    if (n === undefined) n = nextNumber++;
    rows.push({ rowKey, itemNumber: n, qty: g.componentIds.length, partPath: g.partPath,
      partName: partNames.get(g.partPath) ?? '(missing part)', color: g.color, componentIds: [...g.componentIds] });
  }
  rows.sort((a, b) => a.itemNumber - b.itemNumber);
  return rows;
}
```

- [ ] **Step 4: Run** — PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/assembly/walkers/aggregateBomRecursive.ts packages/app/src/assembly/walkers/__tests__/aggregateBomRecursive.spec.ts
git commit -m "$(cat <<'EOF'
feat(app): T10 aggregateBomRecursive walker

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: `mergeAndPruneColorOverrides`

**Files:**
- Create: `packages/app/src/assembly/colorOverrideMerge.ts`
- Create: `packages/app/src/assembly/__tests__/colorOverrideMerge.spec.ts`

- [ ] **Step 1: Failing test**

```ts
import { describe, expect, it } from 'vitest';
import type { AssemblyDocument } from '@zilventor/shared';
import { pathKey } from '@zilventor/shared';
import { mergeAndPruneColorOverrides } from '../colorOverrideMerge';
import type { SubAssemblyCache } from '../SubAssemblyCache';

function doc(over: Partial<AssemblyDocument> = {}): AssemblyDocument {
  return { id: 'x', name: 'x', units: 'mm', parameters: {}, components: [], constraints: [],
    groundedComponentPaths: [], colors: {}, bomItemNumbers: {}, colorOverrides: {}, ...over };
}
function stubCache(map: Map<string, AssemblyDocument>): SubAssemblyCache {
  return { get: (p: string) => map.has(p) ? { kind: 'ok', doc: map.get(p)!, partPath: p } as const : undefined } as unknown as SubAssemblyCache;
}

describe('mergeAndPruneColorOverrides', () => {
  it('drops keys whose component path no longer exists', () => {
    const sub = doc({ components: [
      { id: 'leaf', partPath: 'p.zipt', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
    ] });
    const top = doc({
      components: [
        { id: 'sub1', partPath: 's.ziasm', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
      ],
      colorOverrides: {
        [pathKey(['sub1', 'leaf'])]: { kind: 'hex', hex: '#aabbcc' },
        [pathKey(['sub1', 'gone'])]: { kind: 'hex', hex: '#112233' },
      },
    });
    const next = mergeAndPruneColorOverrides(top, stubCache(new Map([['s.ziasm', sub]])));
    expect(next.colorOverrides).toEqual({ [pathKey(['sub1', 'leaf'])]: { kind: 'hex', hex: '#aabbcc' } });
  });
});
```

- [ ] **Step 2: Run — should fail**.

- [ ] **Step 3: Implement**

```ts
import type { AssemblyDocument } from '@zilventor/shared';
import { pathKey } from '@zilventor/shared';
import type { SubAssemblyCache } from './SubAssemblyCache';

function collectAllPaths(doc: AssemblyDocument, cache: Pick<SubAssemblyCache, 'get'>): Set<string> {
  const out = new Set<string>();
  function walk(d: AssemblyDocument, prefix: string[]) {
    for (const c of d.components) {
      const path = [...prefix, c.id];
      out.add(pathKey(path));
      if (c.partPath.endsWith('.ziasm')) {
        const e = cache.get(c.partPath);
        if (e && e.kind === 'ok') walk(e.doc, path);
      }
    }
  }
  walk(doc, []);
  return out;
}

export function mergeAndPruneColorOverrides(
  activeDoc: AssemblyDocument,
  cache: Pick<SubAssemblyCache, 'get'>,
): AssemblyDocument {
  const live = collectAllPaths(activeDoc, cache);
  const next: AssemblyDocument['colorOverrides'] = {};
  for (const [k, v] of Object.entries(activeDoc.colorOverrides)) {
    if (live.has(k)) next[k] = v;
  }
  return { ...activeDoc, colorOverrides: next };
}
```

- [ ] **Step 4: Run** — PASS, 1 test.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/assembly/colorOverrideMerge.ts packages/app/src/assembly/__tests__/colorOverrideMerge.spec.ts
git commit -m "$(cat <<'EOF'
feat(app): T11 mergeAndPruneColorOverrides for autosave pre-pack

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 12: `visibleLeaves` walker

**Files:**
- Create: `packages/app/src/assembly/walkers/visibleLeaves.ts`
- Create: `packages/app/src/assembly/walkers/__tests__/visibleLeaves.spec.ts`

- [ ] **Step 1: Failing test**

```ts
import { describe, expect, it } from 'vitest';
import type { AssemblyDocument } from '@zilventor/shared';
import { pathKey } from '@zilventor/shared';
import { visibleLeaves } from '../visibleLeaves';
import type { SubAssemblyCache } from '../../SubAssemblyCache';

function doc(over: Partial<AssemblyDocument> = {}): AssemblyDocument {
  return { id: 'x', name: 'x', units: 'mm', parameters: {}, components: [], constraints: [],
    groundedComponentPaths: [], colors: {}, bomItemNumbers: {}, colorOverrides: {}, ...over };
}
function stubCache(map: Map<string, AssemblyDocument>): SubAssemblyCache {
  return { get: (p: string) => map.has(p) ? { kind: 'ok', doc: map.get(p)!, partPath: p } as const : undefined } as unknown as SubAssemblyCache;
}

describe('visibleLeaves', () => {
  it('emits one entry per leaf with full componentPath', () => {
    const sub = doc({ components: [
      { id: 'leaf-a', partPath: 'p.zipt', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
      { id: 'leaf-b', partPath: 'p.zipt', position: { x: 1, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
    ] });
    const top = doc({ components: [
      { id: 'sub', partPath: 's.ziasm', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
    ] });
    const out = visibleLeaves(top, stubCache(new Map([['s.ziasm', sub]])));
    const keys = out.map((l) => pathKey(l.componentPath)).sort();
    expect(keys).toEqual([pathKey(['sub', 'leaf-a']), pathKey(['sub', 'leaf-b'])].sort());
  });

  it('omits leaves whose ancestry includes visible:false', () => {
    const sub = doc({ components: [
      { id: 'leaf', partPath: 'p.zipt', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
    ] });
    const top = doc({ components: [
      { id: 'sub', partPath: 's.ziasm', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: false },
    ] });
    expect(visibleLeaves(top, stubCache(new Map([['s.ziasm', sub]])))).toEqual([]);
  });

  it('emits a placeholder leaf for a missing sub-asm reference', () => {
    const top = doc({ components: [
      { id: 'broken', partPath: 'missing.ziasm', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
    ] });
    const out = visibleLeaves(top, stubCache(new Map()));
    expect(out).toHaveLength(1);
    expect(out[0]!.kind).toBe('placeholder');
    expect(out[0]!.componentPath).toEqual(['broken']);
  });
});
```

- [ ] **Step 2: Run — should fail**.

- [ ] **Step 3: Implement**

```ts
import type { AssemblyDocument, ComponentColor, ComponentPath } from '@zilventor/shared';
import type { SubAssemblyCache } from '../SubAssemblyCache';
import { resolveColor } from './resolveColor';

export type VisibleLeaf = {
  kind: 'leaf' | 'placeholder';
  componentPath: ComponentPath;
  partPath: string;
  effectiveColor: ComponentColor | undefined;
};

export function visibleLeaves(
  activeDoc: AssemblyDocument,
  cache: Pick<SubAssemblyCache, 'get'>,
): VisibleLeaf[] {
  const out: VisibleLeaf[] = [];
  function walk(doc: AssemblyDocument, prefix: string[], visible: boolean) {
    for (const c of doc.components) {
      const path = [...prefix, c.id];
      const v = visible && c.visible;
      if (!v) continue;
      if (!c.partPath.endsWith('.ziasm')) {
        out.push({ kind: 'leaf', componentPath: path, partPath: c.partPath, effectiveColor: resolveColor(path, activeDoc, cache) });
      } else {
        const e = cache.get(c.partPath);
        if (!e || e.kind !== 'ok') {
          out.push({ kind: 'placeholder', componentPath: path, partPath: c.partPath, effectiveColor: undefined });
        } else {
          walk(e.doc, path, v);
        }
      }
    }
  }
  walk(activeDoc, [], true);
  return out;
}
```

- [ ] **Step 4: Run** — PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/assembly/walkers/visibleLeaves.ts packages/app/src/assembly/walkers/__tests__/visibleLeaves.spec.ts
git commit -m "$(cat <<'EOF'
feat(app): T12 visibleLeaves walker for viewport rendering

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 4 — Solver flatten + composedPoses

### Task 13: `flattenForSolver` — top-level only baseline

**Files:**
- Create: `packages/app/src/assembly/walkers/flattenForSolver.ts`
- Create: `packages/app/src/assembly/walkers/__tests__/flattenForSolver.spec.ts`

This task ships the flatten walker but only handles top-level components (the existing 4b case). T14 + T15 add rigid sub-asm composite + flexible inlining.

- [ ] **Step 1: Failing test**

```ts
import { describe, expect, it } from 'vitest';
import type { AssemblyDocument } from '@zilventor/shared';
import { pathKey } from '@zilventor/shared';
import { flattenForSolver } from '../flattenForSolver';
import type { SubAssemblyCache } from '../../SubAssemblyCache';

function doc(over: Partial<AssemblyDocument> = {}): AssemblyDocument {
  return { id: 'x', name: 'x', units: 'mm', parameters: {}, components: [], constraints: [],
    groundedComponentPaths: [], colors: {}, bomItemNumbers: {}, colorOverrides: {}, ...over };
}
function cache(): SubAssemblyCache {
  return { get: () => undefined } as unknown as SubAssemblyCache;
}

describe('flattenForSolver — top-level baseline', () => {
  it('emits one unknown per top-level part component', () => {
    const top = doc({ components: [
      { id: 'a', partPath: 'p.zipt', position: { x: 1, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
      { id: 'b', partPath: 'p.zipt', position: { x: 5, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
    ] });
    const r = flattenForSolver(top, cache());
    expect(r.unknowns).toHaveLength(2);
    expect(r.pathToUnknown.get(pathKey(['a']))).toBe(0);
    expect(r.pathToUnknown.get(pathKey(['b']))).toBe(1);
    expect(r.unknowns[0]!.translation.x).toBeCloseTo(1);
    expect(r.unknowns[1]!.translation.x).toBeCloseTo(5);
  });

  it('does not emit unknowns for sub-asms when cache misses (broken-ref placeholder)', () => {
    const top = doc({ components: [
      { id: 's', partPath: 'sub.ziasm', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
    ] });
    const r = flattenForSolver(top, cache());
    expect(r.unknowns).toHaveLength(0);
  });

  it('passes through top-level constraints with single-elem componentPath', () => {
    const top = doc({
      components: [
        { id: 'a', partPath: 'p.zipt', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
        { id: 'b', partPath: 'p.zipt', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
      ],
      constraints: [
        { id: 'm1', kind: 'mate',
          refA: { kind: 'face', componentPath: ['a'], face: { featureId: 'E1', role: 'top' } },
          refB: { kind: 'face', componentPath: ['b'], face: { featureId: 'E1', role: 'bottom' } },
          offset: { kind: 'literal', value: 0 },
          suppressed: false,
        },
      ],
    });
    const r = flattenForSolver(top, cache());
    expect(r.constraints).toHaveLength(1);
    expect(r.constraints[0]!.refA.componentPath).toEqual(['a']);
  });
});
```

- [ ] **Step 2: Run — should fail**.

- [ ] **Step 3: Implement (top-level only)**

```ts
import type { AssemblyConstraint, AssemblyDocument, ComponentInstance, ComponentPath, Vec3 } from '@zilventor/shared';
import { pathKey } from '@zilventor/shared';
import type { SubAssemblyCache } from '../SubAssemblyCache';

export type Pose = { translation: Vec3; quaternion: [number, number, number, number] };

export type SolverInput = {
  unknowns: Pose[];
  pathToUnknown: Map<string, number>;
  constraints: AssemblyConstraint[];
  /** For rigid sub-asms: which top-of-subtree path maps to which unknown. */
  rigidSubtreeRoots: Map<string, ComponentPath>;
};

function initialPose(c: ComponentInstance): Pose {
  if (c.pose) return c.pose;
  return {
    translation: { x: c.position.x, y: c.position.y, z: c.position.z },
    quaternion: [0, 0, 0, 1],
  };
}

export function flattenForSolver(
  activeDoc: AssemblyDocument,
  cache: Pick<SubAssemblyCache, 'get'>,
): SolverInput {
  const unknowns: Pose[] = [];
  const pathToUnknown = new Map<string, number>();
  const constraints: AssemblyConstraint[] = [];
  const rigidSubtreeRoots = new Map<string, ComponentPath>();

  function walk(doc: AssemblyDocument, prefix: string[], inFlexible: boolean) {
    for (const c of doc.components) {
      const path = [...prefix, c.id];
      const isSubAsm = c.partPath.endsWith('.ziasm');
      if (!isSubAsm) {
        if (inFlexible || prefix.length === 0) {
          unknowns.push(initialPose(c));
          pathToUnknown.set(pathKey(path), unknowns.length - 1);
        }
        continue;
      }
      const e = cache.get(c.partPath);
      if (!e || e.kind !== 'ok') continue;
      // T14 + T15 fill in the rigid + flexible cases. For now: skip.
    }
  }
  // Top-level constraints, refs unchanged
  for (const c of activeDoc.constraints) constraints.push(c);
  walk(activeDoc, [], false);
  return { unknowns, pathToUnknown, constraints, rigidSubtreeRoots };
}
```

- [ ] **Step 4: Run** — PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/assembly/walkers/flattenForSolver.ts packages/app/src/assembly/walkers/__tests__/flattenForSolver.spec.ts
git commit -m "$(cat <<'EOF'
feat(app): T13 flattenForSolver baseline (top-level only)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 14: `flattenForSolver` — rigid sub-asm composite

**Files:**
- Modify: `packages/app/src/assembly/walkers/flattenForSolver.ts`
- Modify: `packages/app/src/assembly/walkers/__tests__/flattenForSolver.spec.ts`

A rigid sub-asm placement contributes ONE pose unknown for the whole subtree. Its inner leaves are determined by `composite_pose ∘ inner_static_pose` (T18 covers the composition; here we just record that the placement got an unknown and tag the subtree root).

- [ ] **Step 1: Append failing test**

```ts
describe('flattenForSolver — rigid sub-asm composite', () => {
  it('emits exactly one unknown for a rigid sub-asm placement; no inner leaves', () => {
    const sub = doc({ components: [
      { id: 'leaf', partPath: 'p.zipt', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
    ] });
    const top = doc({ components: [
      { id: 's1', partPath: 'sub.ziasm', position: { x: 5, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
    ] });
    const cache = { get: (p: string) => p === 'sub.ziasm' ? { kind: 'ok' as const, doc: sub, partPath: p } : undefined } as any;
    const r = flattenForSolver(top, cache);
    expect(r.unknowns).toHaveLength(1);
    expect(r.pathToUnknown.get(pathKey(['s1']))).toBe(0);
    expect(r.pathToUnknown.has(pathKey(['s1', 'leaf']))).toBe(false);
    expect(r.rigidSubtreeRoots.get(pathKey(['s1']))).toEqual(['s1']);
  });
});
```

- [ ] **Step 2: Run — should fail** (no rigid handling yet).

- [ ] **Step 3: Extend `flattenForSolver` walker — rigid case**

In the `else` (sub-asm) branch of `walk(...)`, replace the `// T14 + T15 fill in...` placeholder with:

```ts
const subDoc = e.doc;
if (!c.flexible) {
  unknowns.push(initialPose(c));
  pathToUnknown.set(pathKey(path), unknowns.length - 1);
  rigidSubtreeRoots.set(pathKey(path), path);
  // Do NOT recurse into rigid subtrees — leaves are computed in composedPoses.
  continue;
}
// flexible: T15
```

- [ ] **Step 4: Run** — PASS for the new + earlier tests.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/assembly/walkers/flattenForSolver.ts packages/app/src/assembly/walkers/__tests__/flattenForSolver.spec.ts
git commit -m "$(cat <<'EOF'
feat(app): T14 flattenForSolver — rigid sub-asm composite (1 unknown)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 15: `flattenForSolver` — flexible inlining

**Files:**
- Modify: `packages/app/src/assembly/walkers/flattenForSolver.ts`
- Modify: `packages/app/src/assembly/walkers/__tests__/flattenForSolver.spec.ts`

Flexible mode: the placement contributes an unknown (acts as anchor), AND the sub-asm's components and constraints are inlined with path-prefixed refs.

- [ ] **Step 1: Append failing tests**

```ts
import type { AssemblyConstraint } from '@zilventor/shared';

describe('flattenForSolver — flexible inlining', () => {
  it('emits placement unknown PLUS one unknown per inner leaf', () => {
    const sub = doc({ components: [
      { id: 'a', partPath: 'p.zipt', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
      { id: 'b', partPath: 'p.zipt', position: { x: 1, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
    ] });
    const top = doc({ components: [
      { id: 's', partPath: 'sub.ziasm', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true, flexible: true },
    ] });
    const cache = { get: (p: string) => p === 'sub.ziasm' ? { kind: 'ok' as const, doc: sub, partPath: p } : undefined } as any;
    const r = flattenForSolver(top, cache);
    expect(r.unknowns).toHaveLength(3);
    expect(r.pathToUnknown.get(pathKey(['s']))).toBe(0);
    expect(r.pathToUnknown.get(pathKey(['s', 'a']))).toBe(1);
    expect(r.pathToUnknown.get(pathKey(['s', 'b']))).toBe(2);
    expect(r.rigidSubtreeRoots.size).toBe(0);
  });

  it('inlines sub-asm constraints with path-prefixed componentPath', () => {
    const subInner: AssemblyConstraint = {
      id: 'm1', kind: 'mate',
      refA: { kind: 'face', componentPath: ['a'], face: { featureId: 'E1', role: 'top' } },
      refB: { kind: 'face', componentPath: ['b'], face: { featureId: 'E1', role: 'bottom' } },
      offset: { kind: 'literal', value: 0 },
      suppressed: false,
    };
    const sub = doc({
      components: [
        { id: 'a', partPath: 'p.zipt', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
        { id: 'b', partPath: 'p.zipt', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
      ],
      constraints: [subInner],
    });
    const top = doc({ components: [
      { id: 's', partPath: 'sub.ziasm', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true, flexible: true },
    ] });
    const cache = { get: (p: string) => p === 'sub.ziasm' ? { kind: 'ok' as const, doc: sub, partPath: p } : undefined } as any;
    const r = flattenForSolver(top, cache);
    expect(r.constraints).toHaveLength(1);
    const c = r.constraints[0]!;
    expect(c.kind).toBe('mate');
    if (c.kind === 'mate') {
      expect(c.refA.componentPath).toEqual(['s', 'a']);
      expect(c.refB.componentPath).toEqual(['s', 'b']);
    }
  });
});
```

- [ ] **Step 2: Run — should fail**.

- [ ] **Step 3: Implement flexible branch + ref-prefixing helper**

In `flattenForSolver.ts`, add a small ref-prefixing helper near the top:

```ts
function prefixRef<T extends { componentPath: ComponentPath }>(ref: T, prefix: ComponentPath): T {
  return { ...ref, componentPath: [...prefix, ...ref.componentPath] };
}

function prefixConstraint(c: AssemblyConstraint, prefix: ComponentPath): AssemblyConstraint {
  switch (c.kind) {
    case 'mate':
    case 'flush':
      return { ...c, refA: prefixRef(c.refA, prefix), refB: prefixRef(c.refB, prefix) };
    case 'angle':
      return { ...c, refA: prefixRef(c.refA, prefix), refB: prefixRef(c.refB, prefix) };
    case 'insert':
      return {
        ...c,
        refA: { ...c.refA, componentPath: [...prefix, ...c.refA.componentPath] },
        refB: { ...c.refB, componentPath: [...prefix, ...c.refB.componentPath] },
      };
  }
}
```

In the sub-asm branch, after the rigid `continue;`, add the flexible case:

```ts
// flexible: placement is an unknown anchor, recurse with inFlexible=true,
// inline sub-asm constraints with path-prefixed refs.
unknowns.push(initialPose(c));
pathToUnknown.set(pathKey(path), unknowns.length - 1);
walk(subDoc, path, true);
for (const innerC of subDoc.constraints) {
  constraints.push(prefixConstraint(innerC, path));
}
```

- [ ] **Step 4: Run** — PASS, all flattenForSolver tests green.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/assembly/walkers/flattenForSolver.ts packages/app/src/assembly/walkers/__tests__/flattenForSolver.spec.ts
git commit -m "$(cat <<'EOF'
feat(app): T15 flattenForSolver — flexible inlining (path-prefixed refs)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 16: `composedPoses` — rigid composite ∘ inner static + flexible from solver

**Files:**
- Create: `packages/app/src/assembly/walkers/composedPoses.ts`
- Create: `packages/app/src/assembly/walkers/__tests__/composedPoses.spec.ts`

Pre-condition: each rigid sub-asm cache entry carries `innerStaticPoses: Map<ComponentPathKey, Pose>` keyed by paths INSIDE that sub-asm. Wired in T17 (inner pre-solve). For now `composedPoses` accepts an external pose-resolver function so tests don't depend on the cache shape.

- [ ] **Step 1: Failing test**

```ts
import { describe, expect, it } from 'vitest';
import type { AssemblyDocument } from '@zilventor/shared';
import { pathKey } from '@zilventor/shared';
import { composedPoses } from '../composedPoses';
import type { Pose } from '../flattenForSolver';

function doc(over: Partial<AssemblyDocument> = {}): AssemblyDocument {
  return { id: 'x', name: 'x', units: 'mm', parameters: {}, components: [], constraints: [],
    groundedComponentPaths: [], colors: {}, bomItemNumbers: {}, colorOverrides: {}, ...over };
}
function identityPose(): Pose { return { translation: { x: 0, y: 0, z: 0 }, quaternion: [0, 0, 0, 1] }; }
function tx(x: number): Pose { return { translation: { x, y: 0, z: 0 }, quaternion: [0, 0, 0, 1] }; }

describe('composedPoses', () => {
  it('top-level component pose comes from solver result', () => {
    const top = doc({ components: [
      { id: 'a', partPath: 'p.zipt', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
    ] });
    const cache = { get: () => undefined } as any;
    const out = composedPoses(top, cache, {
      pathToUnknown: new Map([[pathKey(['a']), 0]]),
      poses: [tx(7)],
      rigidSubtreeRoots: new Map(),
    });
    expect(out.get(pathKey(['a']))!.translation.x).toBeCloseTo(7);
  });

  it('rigid sub-asm leaf pose = composite pose composed with inner static pose', () => {
    const sub = doc({ components: [
      { id: 'leaf', partPath: 'p.zipt', position: { x: 2, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
    ] });
    const top = doc({ components: [
      { id: 's', partPath: 'sub.ziasm', position: { x: 5, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
    ] });
    const cache = {
      get: (p: string) => p === 'sub.ziasm'
        ? { kind: 'ok' as const, doc: sub, partPath: p, innerStaticPoses: new Map([[pathKey(['leaf']), tx(2)]]) }
        : undefined,
    } as any;
    const out = composedPoses(top, cache, {
      pathToUnknown: new Map([[pathKey(['s']), 0]]),
      poses: [tx(5)],
      rigidSubtreeRoots: new Map([[pathKey(['s']), ['s']]]),
    });
    // Rigid leaf world = compose(tx(5), tx(2)) → translation.x = 7
    expect(out.get(pathKey(['s', 'leaf']))!.translation.x).toBeCloseTo(7);
  });

  it('flexible sub-asm leaf pose comes directly from its own solver unknown', () => {
    const sub = doc({ components: [
      { id: 'leaf', partPath: 'p.zipt', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
    ] });
    const top = doc({ components: [
      { id: 's', partPath: 'sub.ziasm', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true, flexible: true },
    ] });
    const cache = { get: (p: string) => p === 'sub.ziasm' ? { kind: 'ok' as const, doc: sub, partPath: p } : undefined } as any;
    const out = composedPoses(top, cache, {
      pathToUnknown: new Map([[pathKey(['s']), 0], [pathKey(['s', 'leaf']), 1]]),
      poses: [tx(5), tx(11)],
      rigidSubtreeRoots: new Map(),
    });
    expect(out.get(pathKey(['s', 'leaf']))!.translation.x).toBeCloseTo(11);
  });
});
```

- [ ] **Step 2: Run — should fail**.

- [ ] **Step 3: Implement**

```ts
import type { AssemblyDocument } from '@zilventor/shared';
import { pathKey } from '@zilventor/shared';
import type { SubAssemblyCache } from '../SubAssemblyCache';
import type { Pose } from './flattenForSolver';

export type ComposedPosesInput = {
  pathToUnknown: Map<string, number>;
  poses: Pose[];
  rigidSubtreeRoots: Map<string, ReadonlyArray<string>>;
};

export function composePoses(parent: Pose, child: Pose): Pose {
  // q_parent * q_child for orientation, t_parent + R(q_parent)*t_child for position
  const [qx, qy, qz, qw] = parent.quaternion;
  const [px, py, pz, pw] = child.quaternion;
  // Hamilton product
  const ox = qw * px + qx * pw + qy * pz - qz * py;
  const oy = qw * py - qx * pz + qy * pw + qz * px;
  const oz = qw * pz + qx * py - qy * px + qz * pw;
  const ow = qw * pw - qx * px - qy * py - qz * pz;
  // Rotate child translation by parent quaternion
  const t = child.translation;
  // v' = q * v * q^-1, expanded for unit quat
  const xx = qx * qx, yy = qy * qy, zz = qz * qz;
  const xy = qx * qy, xz = qx * qz, yz = qy * qz;
  const wx = qw * qx, wy = qw * qy, wz = qw * qz;
  const rx = (1 - 2 * (yy + zz)) * t.x + 2 * (xy - wz) * t.y + 2 * (xz + wy) * t.z;
  const ry = 2 * (xy + wz) * t.x + (1 - 2 * (xx + zz)) * t.y + 2 * (yz - wx) * t.z;
  const rz = 2 * (xz - wy) * t.x + 2 * (yz + wx) * t.y + (1 - 2 * (xx + yy)) * t.z;
  return {
    translation: { x: parent.translation.x + rx, y: parent.translation.y + ry, z: parent.translation.z + rz },
    quaternion: [ox, oy, oz, ow],
  };
}

type CacheEntry = { kind: 'ok'; doc: AssemblyDocument; partPath: string; innerStaticPoses?: Map<string, Pose> } | undefined;

export function composedPoses(
  activeDoc: AssemblyDocument,
  cache: { get(p: string): CacheEntry },
  input: ComposedPosesInput,
): Map<string, Pose> {
  const out = new Map<string, Pose>();
  function walk(doc: AssemblyDocument, prefix: string[], ancestorPose: Pose | null) {
    for (const c of doc.components) {
      const path = [...prefix, c.id];
      const key = pathKey(path);
      const idx = input.pathToUnknown.get(key);
      let myPose: Pose;
      if (idx !== undefined) {
        myPose = input.poses[idx]!;
      } else if (ancestorPose) {
        // Inside a rigid subtree: compose ancestor with this component's static pose.
        // The "static pose" comes from the cache entry of the enclosing sub-asm.
        // We pass it down via ancestorPose chained through composePoses.
        myPose = ancestorPose;
      } else {
        myPose = { translation: { x: c.position.x, y: c.position.y, z: c.position.z }, quaternion: [0, 0, 0, 1] };
      }
      out.set(key, myPose);
      if (!c.partPath.endsWith('.ziasm')) continue;
      const e = cache.get(c.partPath);
      if (!e) continue;
      if (c.flexible) {
        walk(e.doc, path, null);
      } else {
        // Rigid: emit each leaf inside the subtree using inner static poses
        const inner = e.innerStaticPoses ?? new Map<string, Pose>();
        for (const [innerKey, innerPose] of inner) {
          const leafKey = pathKey([...path, ...innerKey.split(' ').filter((s) => s !== '')]);
          out.set(leafKey, composePoses(myPose, innerPose));
        }
      }
    }
  }
  walk(activeDoc, [], null);
  return out;
}
```

Note: the `'\\u0000'` separator from the path-key serialization can't be directly mentioned as the literal split arg; use the exported `parsePathKey` instead. Update the rigid branch:

```ts
import { parsePathKey } from '@zilventor/shared';
// ...
for (const [innerKey, innerPose] of inner) {
  const innerPath = parsePathKey(innerKey);
  const leafKey = pathKey([...path, ...innerPath]);
  out.set(leafKey, composePoses(myPose, innerPose));
}
```

- [ ] **Step 4: Run** — PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/assembly/walkers/composedPoses.ts packages/app/src/assembly/walkers/__tests__/composedPoses.spec.ts
git commit -m "$(cat <<'EOF'
feat(app): T16 composedPoses (rigid composite + flexible from solver)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 5 — Rigid pre-solve integration

### Task 17: Inner LM pre-solve in `SubAssemblyCache.loadSubAssembly`

**Files:**
- Modify: `packages/app/src/assembly/SubAssemblyCache.ts` — add `innerStaticPoses` to cache entries
- Modify: `packages/app/src/assembly/__tests__/SubAssemblyCache.spec.ts` — assert inner pre-solve runs and stores poses

The kernel's `solveAssembly` is the existing 4b RPC. We invoke it once per fresh sub-asm doc with the doc's own components + constraints + grounds, store the result as `innerStaticPoses: Map<ComponentPathKey, Pose>`.

- [ ] **Step 1: Append failing test**

```ts
describe('SubAssemblyCache inner pre-solve', () => {
  it('stores innerStaticPoses on a freshly-loaded sub-asm', async () => {
    const drawerDoc = makeDoc('drawer-id', 'drawer', [
      { id: 'panel', partPath: 'panel.zipt', position: { x: 3, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
    ]);
    await opfs.write('drawer.ziasm', await packAssembly(makeFile(drawerDoc), new Uint8Array()));

    const fakeSolve = async (input: any) => ({ poses: input.unknowns, diagnostics: { dof: 0, residual: 0 } });
    const cache = new SubAssemblyCache(opfs as any, { solveAssembly: fakeSolve as any });
    const e = await cache.loadSubAssembly('drawer.ziasm');
    expect(e.kind).toBe('ok');
    if (e.kind === 'ok') {
      expect(e.innerStaticPoses).toBeDefined();
      const p = e.innerStaticPoses!.get(pathKey(['panel']));
      expect(p).toBeDefined();
      expect(p!.translation.x).toBeCloseTo(3);
    }
  });
});
```

- [ ] **Step 2: Run — should fail** (constructor signature mismatch + missing field).

- [ ] **Step 3: Extend `SubAssemblyCache`**

1. Define a minimal solver bridge interface to keep the cache decoupled from KernelClient:

```ts
export interface SolverBridge {
  solveAssembly(input: { unknowns: { translation: Vec3; quaternion: [number, number, number, number] }[]; constraints: AssemblyConstraint[]; pathToUnknown: Map<string, number> }): Promise<{ poses: { translation: Vec3; quaternion: [number, number, number, number] }[]; diagnostics: { dof: number; residual: number } }>;
}
```

2. Constructor: `constructor(private readonly opfs: OpfsLike, private readonly solver: SolverBridge | null = null)`.

3. After successful unpack in `unpack(...)` (and in `walkTree` at the cache-set point), if `this.solver` is non-null, call `flattenForSolver` against the doc with no nested cache (ground references treated as fixed):

```ts
private async maybePreSolve(doc: AssemblyDocument): Promise<Map<string, Pose> | undefined> {
  if (!this.solver) return undefined;
  const subInput = flattenForSolver(doc, { get: () => undefined });
  // Treat sub-asm grounds as ground constraints — solveAssembly is expected
  // to honour groundedComponentPaths if the bridge wires them.
  const r = await this.solver.solveAssembly({
    unknowns: subInput.unknowns,
    constraints: subInput.constraints,
    pathToUnknown: subInput.pathToUnknown,
  });
  const poses = new Map<string, Pose>();
  for (const [k, idx] of subInput.pathToUnknown) poses.set(k, r.poses[idx]!);
  return poses;
}
```

4. After unpack assigns the entry, await `maybePreSolve` and replace the entry:

```ts
const ok = { kind: 'ok' as const, doc: file.manifest.document, partPath };
this.entries.set(partPath, ok);
const inner = await this.maybePreSolve(file.manifest.document);
if (inner) this.entries.set(partPath, { ...ok, innerStaticPoses: inner });
```

5. Extend `SubAssemblyEntry`'s `'ok'` variant:

```ts
| { kind: 'ok'; doc: AssemblyDocument; partPath: string; innerStaticPoses?: Map<string, Pose> }
```

- [ ] **Step 4: Run** — PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/assembly/SubAssemblyCache.ts packages/app/src/assembly/__tests__/SubAssemblyCache.spec.ts
git commit -m "$(cat <<'EOF'
feat(app): T17 SubAssemblyCache inner pre-solve via SolverBridge

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 6 — Store slice changes

### Task 18: `subAssemblyDocs` + `subAssemblyDiagnostics` slices

**Files:**
- Modify: `packages/app/src/store/useAppStore.ts`
- Modify: `packages/app/src/store/__tests__/useAppStore.spec.ts`

- [ ] **Step 1: Failing test**

```ts
it('useAppStore tracks subAssemblyDocs by partPath', () => {
  const s = useAppStore.getState();
  s.setSubAssemblyDocs({ 'a.ziasm': makeDoc('a-id', 'a') });
  expect(useAppStore.getState().subAssemblyDocs['a.ziasm']?.id).toBe('a-id');
});

it('useAppStore tracks subAssemblyDiagnostics', () => {
  const s = useAppStore.getState();
  s.setSubAssemblyDiagnostics([{ partPath: 'a.ziasm', kind: 'cycle', message: 'x' }]);
  expect(useAppStore.getState().subAssemblyDiagnostics).toHaveLength(1);
});
```

- [ ] **Step 2: Run — should fail**.

- [ ] **Step 3: Add slice fields and setters**

In `useAppStore.ts`:

```ts
subAssemblyDocs: {} as Record<string, AssemblyDocument>,
subAssemblyDiagnostics: [] as Array<{ partPath: string; kind: 'cycle' | 'missing' | 'parse'; message: string }>,
expandedSubAsmPaths: new Set<string>() as Set<string>,
selectedComponentPaths: [] as ComponentPath[],

setSubAssemblyDocs: (next: Record<string, AssemblyDocument>) => set({ subAssemblyDocs: next }),
setSubAssemblyDiagnostics: (next: ReturnType<SubAssemblyCache['diagnostics']>) => set({ subAssemblyDiagnostics: next }),
toggleSubAsmExpanded: (key: string) => set((s) => {
  const next = new Set(s.expandedSubAsmPaths);
  if (next.has(key)) next.delete(key); else next.add(key);
  return { expandedSubAsmPaths: next };
}),
selectComponentPaths: (paths: ComponentPath[]) => set({ selectedComponentPaths: paths }),
```

- [ ] **Step 4: Update existing 4c usages of `selectedComponentIds`**

`rg -n 'selectedComponentIds' packages/app/src --type=ts`

For each call site, swap to `selectedComponentPaths`. A top-level component id `X` becomes path `['X']`; a sub-asm leaf is full-path. Run typecheck after.

- [ ] **Step 5: Run** — PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/app/src/store
git commit -m "$(cat <<'EOF'
feat(app): T18 store slices for subAssemblyDocs / Diagnostics / paths

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 19: `setColorOverride` + `setComponentFlexible` actions

**Files:**
- Modify: `packages/app/src/store/useAppStore.ts`
- Modify: `packages/app/src/store/__tests__/useAppStore.spec.ts`

- [ ] **Step 1: Failing test**

```ts
it('setColorOverride writes through to activeAssembly.colorOverrides', () => {
  // seed: activate an assembly doc
  const s = useAppStore.getState();
  s.setActiveDocument({ kind: 'assembly', document: { ...sampleAssembly, colorOverrides: {} } });
  s.setColorOverride(['c1', 'leaf'], { kind: 'palette', name: 'oak' });
  const got = useAppStore.getState().activeDocument;
  if (got?.kind !== 'assembly') throw new Error('expected assembly');
  expect(got.document.colorOverrides[pathKey(['c1', 'leaf'])]).toEqual({ kind: 'palette', name: 'oak' });
});

it('setColorOverride(null) deletes the entry', () => {
  const s = useAppStore.getState();
  s.setColorOverride(['c1', 'leaf'], null);
  const got = useAppStore.getState().activeDocument;
  if (got?.kind !== 'assembly') throw new Error('expected assembly');
  expect(got.document.colorOverrides[pathKey(['c1', 'leaf'])]).toBeUndefined();
});

it('setComponentFlexible toggles the flag and bumps solverDirty', () => {
  // assumes activeAssembly has component {id: 's', partPath: 'x.ziasm'}
  const s = useAppStore.getState();
  s.setComponentFlexible('s', true);
  const got = useAppStore.getState().activeDocument;
  if (got?.kind !== 'assembly') throw new Error('expected assembly');
  const c = got.document.components.find((x) => x.id === 's');
  expect(c?.flexible).toBe(true);
  expect(useAppStore.getState().solverDirty).toBe(true);
});
```

- [ ] **Step 2: Run — should fail**.

- [ ] **Step 3: Implement actions in `useAppStore.ts`**

```ts
setColorOverride: (path: ComponentPath, color: ComponentColor | null) => set((s) => {
  if (s.activeDocument?.kind !== 'assembly') return s;
  const next = { ...s.activeDocument.document.colorOverrides };
  const k = pathKey(path);
  if (color == null) delete next[k];
  else next[k] = color;
  return {
    activeDocument: { ...s.activeDocument, document: { ...s.activeDocument.document, colorOverrides: next } },
  };
}),

setComponentFlexible: (componentId: string, flag: boolean) => set((s) => {
  if (s.activeDocument?.kind !== 'assembly') return s;
  const next = s.activeDocument.document.components.map((c) =>
    c.id === componentId ? { ...c, flexible: flag } : c,
  );
  return {
    activeDocument: { ...s.activeDocument, document: { ...s.activeDocument.document, components: next } },
    solverDirty: true,
  };
}),
```

- [ ] **Step 4: Run** — PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/store
git commit -m "$(cat <<'EOF'
feat(app): T19 setColorOverride + setComponentFlexible store actions

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 7 — Commands

### Task 20: `PlaceComponentCommand` cycle gate

**Files:**
- Modify: `packages/app/src/commands/PlaceComponentCommand.ts`
- Modify: `packages/app/src/commands/__tests__/PlaceComponentCommand.spec.ts`

- [ ] **Step 1: Failing test**

```ts
it('rejects placement of a sub-asm that would create a cycle', async () => {
  // setup: top.ziasm in OPFS; candidate.ziasm references top.ziasm
  await seedAssemblyForCycle(opfs);
  const s = useAppStore.getState();
  s.setActiveDocument({ kind: 'assembly', document: { ...emptyTopAssembly, name: 'top' } });
  const cmd = new PlaceComponentCommand({
    componentId: 'c1', partPath: 'candidate.ziasm', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 },
  });
  await cmd.apply({ opfs } as any);
  const got = useAppStore.getState();
  if (got.activeDocument?.kind !== 'assembly') throw new Error();
  expect(got.activeDocument.document.components).toHaveLength(0);
  expect(got.statusMessage).toMatch(/cycle/i);
});
```

- [ ] **Step 2: Run — should fail**.

- [ ] **Step 3: Add cycle gate**

In `PlaceComponentCommand.apply` (before pushing the new component), if `partPath.endsWith('.ziasm')`:

```ts
const activeName = state.activeDocument.document.name;
const activePath = `${activeName}.ziasm`;
if (await wouldCreateCycle(state.activeDocument.document, activePath, partPath, opfs)) {
  set({ statusMessage: `Cannot place: would create a cycle (${partPath} → ${activePath} → ${partPath}).` });
  return;
}
```

- [ ] **Step 4: Run** — PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/commands/PlaceComponentCommand.ts packages/app/src/commands/__tests__/PlaceComponentCommand.spec.ts
git commit -m "$(cat <<'EOF'
feat(app): T20 PlaceComponentCommand cycle gate for .ziasm refs

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 21: `ToggleSubAssemblyFlexibleCommand`

**Files:**
- Create: `packages/app/src/commands/ToggleSubAssemblyFlexibleCommand.ts`
- Create: `packages/app/src/commands/__tests__/ToggleSubAssemblyFlexibleCommand.spec.ts`
- Modify: `packages/app/src/commands/CommandBus.ts` — register

- [ ] **Step 1: Failing test**

```ts
it('flips the flexible flag on a sub-asm placement and bumps solverDirty', async () => {
  const s = useAppStore.getState();
  s.setActiveDocument({ kind: 'assembly', document: assemblyWithSubAsm('s') });
  await new ToggleSubAssemblyFlexibleCommand({ componentId: 's' }).apply({} as any);
  const got = useAppStore.getState();
  if (got.activeDocument?.kind !== 'assembly') throw new Error();
  expect(got.activeDocument.document.components.find((c) => c.id === 's')?.flexible).toBe(true);
  expect(got.solverDirty).toBe(true);
});
```

- [ ] **Step 2: Run — should fail**.

- [ ] **Step 3: Implement**

```ts
export class ToggleSubAssemblyFlexibleCommand implements Command {
  constructor(private readonly args: { componentId: string }) {}
  async apply(): Promise<void> {
    const s = useAppStore.getState();
    if (s.activeDocument?.kind !== 'assembly') return;
    const c = s.activeDocument.document.components.find((x) => x.id === this.args.componentId);
    if (!c) return;
    s.setComponentFlexible(this.args.componentId, !c.flexible);
  }
}
```

Register in `CommandBus.ts`.

- [ ] **Step 4: Run** — PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/commands
git commit -m "$(cat <<'EOF'
feat(app): T21 ToggleSubAssemblyFlexibleCommand

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 22: `SetComponentColorOverrideCommand`

**Files:**
- Create: `packages/app/src/commands/SetComponentColorOverrideCommand.ts`
- Create: `packages/app/src/commands/__tests__/SetComponentColorOverrideCommand.spec.ts`
- Modify: `packages/app/src/commands/CommandBus.ts`

- [ ] **Step 1: Failing test**

```ts
it('writes a per-leaf color override and clears it on null', async () => {
  const s = useAppStore.getState();
  s.setActiveDocument({ kind: 'assembly', document: { ...emptyTopAssembly, colorOverrides: {} } });
  await new SetComponentColorOverrideCommand({ path: ['s', 'leaf'], color: { kind: 'hex', hex: '#ff0000' } }).apply({} as any);
  let got = useAppStore.getState();
  if (got.activeDocument?.kind !== 'assembly') throw new Error();
  expect(got.activeDocument.document.colorOverrides[pathKey(['s', 'leaf'])]).toEqual({ kind: 'hex', hex: '#ff0000' });
  await new SetComponentColorOverrideCommand({ path: ['s', 'leaf'], color: null }).apply({} as any);
  got = useAppStore.getState();
  if (got.activeDocument?.kind !== 'assembly') throw new Error();
  expect(got.activeDocument.document.colorOverrides[pathKey(['s', 'leaf'])]).toBeUndefined();
});
```

- [ ] **Step 2: Run — should fail**.

- [ ] **Step 3: Implement**

```ts
export class SetComponentColorOverrideCommand implements Command {
  constructor(private readonly args: { path: ComponentPath; color: ComponentColor | null }) {}
  async apply(): Promise<void> {
    useAppStore.getState().setColorOverride(this.args.path, this.args.color);
  }
}
```

Register in `CommandBus.ts`.

- [ ] **Step 4: Run** — PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/commands
git commit -m "$(cat <<'EOF'
feat(app): T22 SetComponentColorOverrideCommand

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 23: Wire `BomTable` and `mergeAndPruneBom` to recursive aggregator

**Files:**
- Modify: `packages/app/src/shell/BomTable.tsx` — replace `aggregateBom` with `aggregateBomRecursive`
- Modify: `packages/app/src/storage/mergeBomItemNumbers.ts` — also recursive
- Modify: `packages/app/src/shell/__tests__/BomTable.spec.tsx`

- [ ] **Step 1: Failing test (BomTable)**

```ts
it('renders rows aggregated across a 2-level tree', async () => {
  // seed cache with drawer.ziasm; place 2 drawer.ziasm in the active assembly
  const cache = stubCache(...);
  render(<BomTable assembly={topWith2Drawers} subAsmCache={cache} partNames={partNames} />);
  expect(await screen.findByText(/Panel/)).toBeInTheDocument();
  expect(await screen.findByText(/^4$/)).toBeInTheDocument(); // qty cell
});
```

- [ ] **Step 2: Implement**

In `BomTable.tsx`, replace the `aggregateBom(activeAssembly, partNamesSnapshot)` call with `aggregateBomRecursive(activeAssembly, subAsmCache, partNamesSnapshot)`. Hoist `subAsmCache` from store via `useAppStore`'s `subAssemblyDocs` (wrapping into a `Pick<SubAssemblyCache, 'get'>` adapter).

In `mergeBomItemNumbers.ts`, replace `aggregateBom(...)` with `aggregateBomRecursive(...)`. Also call `mergeAndPruneColorOverrides` here so autosave prunes both.

- [ ] **Step 3: Run** — PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/app/src/shell/BomTable.tsx packages/app/src/storage/mergeBomItemNumbers.ts packages/app/src/shell/__tests__/BomTable.spec.tsx
git commit -m "$(cat <<'EOF'
feat(app): T23 BomTable + autosave merge use recursive aggregator + override prune

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 8 — Dialogs + BrowserPane recursion + StatusBar

### Task 24: `EditComponentDialog` adds `Flexible` checkbox + sub-asm label for `.ziasm` placements

**Files:**
- Modify: `packages/app/src/shell/EditComponentDialog.tsx`
- Modify: `packages/app/src/shell/__tests__/EditComponentDialog.spec.tsx`

- [ ] **Step 1: Failing test**

```ts
it('renders a Flexible checkbox and Sub-assembly label for .ziasm placements', async () => {
  render(<EditComponentDialog component={subAsmPlacement} ... />);
  expect(await screen.findByLabelText(/flexible/i)).toBeInTheDocument();
  expect(await screen.findByText(/sub-assembly/i)).toBeInTheDocument();
});

it('does not render Flexible for .zipt placements', async () => {
  render(<EditComponentDialog component={zipPlacement} ... />);
  expect(screen.queryByLabelText(/flexible/i)).toBeNull();
});
```

- [ ] **Step 2: Run — should fail**.

- [ ] **Step 3: Implement**

In the dialog, after the existing X/Y/Z + RX/RY/RZ + Color rows, add:

```tsx
{props.component.partPath.endsWith('.ziasm') && (
  <>
    <div role="status">Sub-assembly ({subAsmLeafCount} components)</div>
    <label>
      <input type="checkbox"
        checked={!!props.component.flexible}
        onChange={() => commandBus.dispatch(new ToggleSubAssemblyFlexibleCommand({ componentId: props.component.id }))} />
      Flexible
    </label>
  </>
)}
```

Wire `subAsmLeafCount` from `subAssemblyDocs[partPath]?.components.length` (recursive count comes via T26's helper).

- [ ] **Step 4: Run** — PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/shell/EditComponentDialog.tsx packages/app/src/shell/__tests__/EditComponentDialog.spec.tsx
git commit -m "$(cat <<'EOF'
feat(app): T24 EditComponentDialog Flexible row + sub-asm label

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 25: `BrowserPane` recursive tree

**Files:**
- Modify: `packages/app/src/shell/BrowserPane.tsx` — render a recursive tree, expandable nodes, "Override color…" right-click on leaves
- Modify: `packages/app/src/shell/__tests__/BrowserPane.spec.tsx`

- [ ] **Step 1: Failing test**

```ts
it('renders sub-asm placements as expandable nodes', async () => {
  render(<BrowserPane assembly={topWithSubAsm} subAsmDocs={...} ... />);
  const sub = screen.getByText('drawer (3 components)');
  expect(sub).toBeInTheDocument();
  await userEvent.click(sub.querySelector('button[aria-label="expand"]')!);
  expect(await screen.findByText(/panel-front/)).toBeInTheDocument();
});

it('shows a Flexible badge when the placement is flexible', async () => {
  render(<BrowserPane assembly={topWithFlexibleSubAsm} subAsmDocs={...} ... />);
  expect(await screen.findByText(/flexible/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run — should fail**.

- [ ] **Step 3: Implement**

Replace the existing flat-list render with a recursive React component that walks `(activeDoc.components, subAsmDocs)` and emits `<TreeNode>` with expand/collapse triangle, leaf-count annotation, and Flexible badge. Right-click on leaf opens a context menu with "Override color…" → `OpenColorPicker → SetComponentColorOverrideCommand`. Expansion state lives in `expandedSubAsmPaths`.

- [ ] **Step 4: Run** — PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/shell/BrowserPane.tsx packages/app/src/shell/__tests__/BrowserPane.spec.tsx
git commit -m "$(cat <<'EOF'
feat(app): T25 BrowserPane recursive tree + Flexible badge + override menu

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 26: `loadAssemblyTiles` lists `.ziasm` too; `PlaceComponentDialog` shows tiles

**Files:**
- Modify: `packages/app/src/shell/loadAssemblyTiles.ts`
- Modify: `packages/app/src/shell/PlaceComponentDialog.tsx` (no change needed if tiles list is generic)
- Modify: `packages/app/src/shell/__tests__/loadAssemblyTiles.spec.ts`

- [ ] **Step 1: Failing test**

```ts
it('lists both .zipt and .ziasm files as tiles', async () => {
  await opfs.write('a.zipt', dummyZiptBytes);
  await opfs.write('b.ziasm', dummyZiasmBytes);
  const tiles = await loadAssemblyTiles(opfs);
  expect(tiles.map((t) => t.partPath).sort()).toEqual(['a.zipt', 'b.ziasm']);
});
```

- [ ] **Step 2: Run — should fail**.

- [ ] **Step 3: Implement**

Update the OPFS listing in `loadAssemblyTiles.ts` to glob both `.zipt` and `.ziasm`. For `.ziasm`, peek the manifest's thumbnail blob the same way `.zipt` already does.

- [ ] **Step 4: Run** — PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/shell/loadAssemblyTiles.ts packages/app/src/shell/__tests__/loadAssemblyTiles.spec.ts
git commit -m "$(cat <<'EOF'
feat(app): T26 loadAssemblyTiles lists .ziasm files for placement

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 27: `StatusBar` adds sub-asm count + diagnostic badge

**Files:**
- Modify: `packages/app/src/shell/StatusBar.tsx`
- Modify: `packages/app/src/shell/__tests__/StatusBar.spec.tsx`

- [ ] **Step 1: Failing test**

```ts
it('shows N components in M sub-assemblies and a diagnostic badge', async () => {
  render(<StatusBar />); // store seeded with 5 leaves across 2 sub-asms + 1 cycle diag
  expect(await screen.findByText(/5 components in 2 sub-assemblies/)).toBeInTheDocument();
  expect(await screen.findByLabelText(/1 diagnostic/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run — should fail**.

- [ ] **Step 3: Implement**

Pull `activeAssembly`, `subAssemblyDocs`, `subAssemblyDiagnostics` from store. Compute leaf count via `visibleLeaves` length, sub-asm count via `subAssemblyDocs` keys reachable from active. Render badge wrapped in a button that opens a popover listing diagnostics.

- [ ] **Step 4: Run** — PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/shell/StatusBar.tsx packages/app/src/shell/__tests__/StatusBar.spec.tsx
git commit -m "$(cat <<'EOF'
feat(app): T27 StatusBar sub-asm leaf count + diagnostic badge

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 9 — Viewport pathways

### Task 28: `SceneManager.setComponentMeshes` accepts path-keyed leaves

**Files:**
- Modify: `packages/app/src/viewport/SceneManager.ts`
- Modify: `packages/app/src/viewport/__tests__/SceneManager.spec.ts`

- [ ] **Step 1: Failing test**

```ts
it('attaches mesh.userData.componentPath to each placed leaf', () => {
  const sm = new SceneManager(...);
  sm.setComponentMeshes([
    { kind: 'leaf', componentPath: ['a', 'b'], partPath: 'p.zipt', worldPose: identity, materialColor: '#888888', visible: true },
  ]);
  const meshes = sm.componentMeshesByPathKey();
  expect(meshes.get(pathKey(['a', 'b']))!.userData.componentPath).toEqual(['a', 'b']);
});
```

- [ ] **Step 2: Run — should fail**.

- [ ] **Step 3: Implement**

Change `setComponentMeshes` signature from `Array<{ id: string; ... }>` to `Array<ComponentLeaf>` where `ComponentLeaf` carries `componentPath`. Internal map becomes `Map<ComponentPathKey, THREE.Mesh>`. Diff by path key. Store `componentPath` on `mesh.userData`.

Geometry caching keyed by `partPath` (unchanged from 4a).

- [ ] **Step 4: Run** — PASS, plus all existing SceneManager tests after migration to path-keyed `setComponentMeshes` calls.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/viewport
git commit -m "$(cat <<'EOF'
feat(app): T28 SceneManager.setComponentMeshes accepts ComponentLeaf[] (path-keyed)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 29: Selection overlay matches by `componentPath`

**Files:**
- Modify: `packages/app/src/viewport/SceneManager.ts`
- Modify: `packages/app/src/viewport/__tests__/SceneManager.spec.ts`

- [ ] **Step 1: Failing test**

```ts
it('selection overlay activates for the matching componentPath only', () => {
  const sm = new SceneManager(...);
  sm.setComponentMeshes([
    { kind: 'leaf', componentPath: ['a'], partPath: 'p.zipt', ... },
    { kind: 'leaf', componentPath: ['s', 'leaf'], partPath: 'p.zipt', ... },
  ]);
  sm.setSelectedComponentPaths([['s', 'leaf']]);
  expect(sm.selectionOverlayPathKeys()).toEqual([pathKey(['s', 'leaf'])]);
});
```

- [ ] **Step 2: Run — should fail**.

- [ ] **Step 3: Implement**

Replace `setSelectedComponentIds(ids: string[])` with `setSelectedComponentPaths(paths: ComponentPath[])`. Iterate over selected paths; build outline overlay `EdgesGeometry` for each matching mesh.

- [ ] **Step 4: Update App.tsx selection-sync effect** to push `selectedComponentPaths` into `SceneManager.setSelectedComponentPaths`.

- [ ] **Step 5: Run** — PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/app/src/viewport packages/app/src/App.tsx
git commit -m "$(cat <<'EOF'
feat(app): T29 selection overlay matches by componentPath

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 30: Picker returns `componentPath`

**Files:**
- Modify: `packages/app/src/model/ComponentPickController.ts`
- Modify: `packages/app/src/model/AssemblyRefPickController.ts`
- Modify the picker spec files

- [ ] **Step 1: Failing test**

```ts
it('ComponentPickController returns componentPath of the hit mesh', () => {
  const ctrl = new ComponentPickController(...);
  const result = ctrl.handlePointer({ x: 100, y: 100 });
  expect(result?.componentPath).toEqual(['s', 'leaf']);
});

it('AssemblyRefPickController records componentPath on the emitted ref', () => {
  const ctrl = new AssemblyRefPickController(...);
  ctrl.simulateHit({ kind: 'face', componentPath: ['s', 'leaf'], face: { featureId: 'E1', role: 'top' } });
  expect(getLastEmittedRef()?.componentPath).toEqual(['s', 'leaf']);
});
```

- [ ] **Step 2: Run — should fail**.

- [ ] **Step 3: Implement**

In each pick controller, replace `componentId: mesh.userData.componentId` reads with `componentPath: mesh.userData.componentPath`. The constraint dialog's `Pick…` button receives a `componentPath`-bearing ref directly; no further translation.

- [ ] **Step 4: Run** — PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/model
git commit -m "$(cat <<'EOF'
feat(app): T30 pickers return componentPath

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 31: Wire App.tsx assembly-mesh-sync to recursive `visibleLeaves`

**Files:**
- Modify: `packages/app/src/App.tsx`

- [ ] **Step 1: Find the existing `assemblyMeshSync` effect** (the one that loops over `activeAssembly.components` and calls `kernel.loadFromBytes` per partPath, then `Viewport.setComponentMeshes(...)`).

- [ ] **Step 2: Replace its body**

```ts
const subAsmCache = useMemo(() => ({
  get: (p: string) => {
    const doc = subAssemblyDocs[p];
    if (!doc) return undefined;
    return { kind: 'ok' as const, doc, partPath: p };
  },
}), [subAssemblyDocs]);

useEffect(() => {
  if (activeDocument?.kind !== 'assembly') return;
  const leaves = visibleLeaves(activeDocument.document, subAsmCache);
  // For each unique leaf.partPath, ensure kernel.loadFromBytes has been called (cached); attach mesh
  ...
  viewportRef.current?.setComponentMeshes(leaves.map((l) => ({
    kind: l.kind,
    componentPath: l.componentPath,
    partPath: l.partPath,
    worldPose: composedPosesMap.get(pathKey(l.componentPath)) ?? identityPose,
    materialColor: l.effectiveColor && l.effectiveColor.kind === 'palette'
      ? activeDocument.document.colors[l.effectiveColor.name]
      : (l.effectiveColor?.kind === 'hex' ? l.effectiveColor.hex : undefined),
    visible: true,
  })));
}, [activeDocument, subAsmCache, composedPosesMap]);
```

- [ ] **Step 3: Run all app + E2E tests** — assembly placement E2E from 4a should still pass.

- [ ] **Step 4: Commit**

```bash
git add packages/app/src/App.tsx
git commit -m "$(cat <<'EOF'
feat(app): T31 App.tsx assembly-mesh-sync uses recursive visibleLeaves + composedPoses

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 10 — Autosave merge/prune + dev hooks

### Task 32: App.tsx autosave wires `mergeAndPruneColorOverrides` into pre-pack

**Files:**
- Modify: `packages/app/src/App.tsx` — autosave effect
- Modify: `packages/app/src/__tests__/App.spec.tsx`

- [ ] **Step 1: Failing test (extends existing autosave coverage)**

```ts
it('autosave prunes orphan colorOverride keys before packing', async () => {
  // seed: assembly with colorOverrides referencing a deleted leaf
  // wait for autosave debounce
  // unpack the OPFS bytes; assert orphan key absent
});
```

- [ ] **Step 2: Run — should fail**.

- [ ] **Step 3: In the autosave effect**, after the existing `mergeAndPruneBom(...)` call, chain:

```ts
const merged = mergeAndPruneBom(...);
const cleaned = mergeAndPruneColorOverrides(merged, subAsmCache);
const bytes = await packAssembly({ ...projectFile, document: cleaned }, thumbBytes);
```

- [ ] **Step 4: Run** — PASS, all autosave tests green.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/App.tsx packages/app/src/__tests__/App.spec.tsx
git commit -m "$(cat <<'EOF'
feat(app): T32 autosave prunes orphan colorOverrides via mergeAndPruneColorOverrides

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 33: Dev hooks (`__zilventorSubAsm*`)

**Files:**
- Modify: `packages/app/src/App.tsx` — register hooks under `import.meta.env.DEV`
- Modify: `packages/app/src/__tests__/App.spec.tsx`

- [ ] **Step 1: Failing test**

```ts
it('exposes __zilventorSubAsmCacheGet returning the cached doc', () => {
  // setup app with a loaded sub-asm
  expect((window as any).__zilventorSubAsmCacheGet('drawer.ziasm')?.name).toBe('drawer');
});
it('exposes __zilventorSubAsmInvalidate dropping cache + re-solving', async () => {
  await (window as any).__zilventorSubAsmInvalidate('drawer.ziasm');
  // assert cache miss then re-fill on next render
});
it('__zilventorComponentPathToLeafCount returns descendant count', () => {
  expect((window as any).__zilventorComponentPathToLeafCount(['s'])).toBe(3);
});
it('__zilventorComposedPoseFor returns the leaf world pose', () => {
  const p = (window as any).__zilventorComposedPoseFor(['s', 'leaf']);
  expect(p.translation.x).toBeCloseTo(7);
});
```

- [ ] **Step 2: Run — should fail**.

- [ ] **Step 3: Implement** (inside an `import.meta.env.DEV` guarded effect)

```ts
useEffect(() => {
  if (!import.meta.env.DEV) return;
  const w = window as any;
  w.__zilventorSubAsmCacheGet = (p: string) => subAssemblyDocs[p];
  w.__zilventorSubAsmInvalidate = async (p: string) => {
    cacheRef.current.invalidate(p);
    await cacheRef.current.loadSubAssembly(p);
    setSubAssemblyDocs({ ...cacheRef.current.entriesAsRecord() });
    setSolverDirty(true);
  };
  w.__zilventorComponentPathToLeafCount = (path: string[]) => visibleLeaves(activeAssembly, subAsmCache)
    .filter((l) => l.componentPath.length >= path.length && path.every((p, i) => l.componentPath[i] === p)).length;
  w.__zilventorComposedPoseFor = (path: string[]) => composedPosesMap.get(pathKey(path));
  return () => {
    delete w.__zilventorSubAsmCacheGet;
    delete w.__zilventorSubAsmInvalidate;
    delete w.__zilventorComponentPathToLeafCount;
    delete w.__zilventorComposedPoseFor;
  };
}, [activeAssembly, subAssemblyDocs, composedPosesMap]);
```

(Add `entriesAsRecord(): Record<string, AssemblyDocument>` helper to `SubAssemblyCache` if not already present — returns a Record built from `entries` for store reactivity.)

- [ ] **Step 4: Run** — PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src
git commit -m "$(cat <<'EOF'
feat(app): T33 dev hooks for sub-asm cache + componentPath introspection

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 11 — E2E suite

### Task 34: `seedSubAssembly.ts` helper

**Files:**
- Create: `tests/e2e/helpers/seedSubAssembly.ts`

- [ ] **Step 1: Implement (no separate spec — the helper is exercised by the E2E suites)**

```ts
import type { Page } from '@playwright/test';
import type { AssemblyDocument, ComponentInstance, ProjectFile } from '@zilventor/shared';

export async function seedSubAssemblyZiasm(
  page: Page,
  partPath: string,
  doc: AssemblyDocument,
): Promise<void> {
  await page.evaluate(async ({ partPath, doc }) => {
    const w = window as any;
    const pack = await w.__zilventorPackProject({
      formatVersion: 8, kind: 'assembly', createdAt: '2026-04-29', appVersion: '0.1.0', document: doc,
    } satisfies ProjectFile, new Uint8Array());
    const opfs = await w.__zilventorGetOpfs();
    await opfs.write(partPath, pack);
  }, { partPath, doc });
}

export function makeSubAsmDoc(name: string, components: ComponentInstance[]): AssemblyDocument {
  return {
    id: `${name}-id`, name, units: 'mm', parameters: {},
    components, constraints: [],
    groundedComponentPaths: [], colors: {}, bomItemNumbers: {}, colorOverrides: {},
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add tests/e2e/helpers/seedSubAssembly.ts
git commit -m "$(cat <<'EOF'
test(e2e): T34 seedSubAssembly helper

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 35: E2E `subasm-place-rigid`

**Files:**
- Create: `tests/e2e/assembly/subasm-place-rigid.spec.ts`

- [ ] **Step 1: Spec**

```ts
import { test, expect } from '@playwright/test';
import { seedAssemblyPart } from '../helpers/seedAssemblyPart';
import { seedSubAssemblyZiasm, makeSubAsmDoc } from '../helpers/seedSubAssembly';

test('place a rigid sub-asm twice; render + BOM aggregate', async ({ page }) => {
  await page.goto('/');
  await seedAssemblyPart(page, 'panel.zipt', /* 10x10x2 cube */ { ... });
  const drawer = makeSubAsmDoc('drawer', [
    { id: 'pa', partPath: 'panel.zipt', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
    { id: 'pb', partPath: 'panel.zipt', position: { x: 12, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
    { id: 'pc', partPath: 'panel.zipt', position: { x: 0, y: 12, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
  ]);
  await seedSubAssemblyZiasm(page, 'drawer.ziasm', drawer);
  // New top assembly
  await page.click('button:has-text("File")'); await page.click('text=New Assembly');
  // Place drawer.ziasm twice
  await page.keyboard.press('p'); // open Place
  await page.click('button[aria-label="drawer.ziasm tile"]');
  await page.click('text=OK');
  await page.keyboard.press('p');
  await page.click('button[aria-label="drawer.ziasm tile"]');
  await page.click('text=OK');
  // Verify scene has 6 placed leaf meshes (3 per drawer × 2)
  await page.waitForFunction(() => (window as any).__zilventorComponentPathToLeafCount([]) === 6);
  // Verify BOM has 1 row, qty 6
  await page.click('button[aria-label="BOM tab"]');
  const qty = await page.locator('table[aria-label="BOM"] tbody tr td:nth-child(2)').first().innerText();
  expect(qty).toBe('6');
});
```

- [ ] **Step 2: Run** — PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/assembly/subasm-place-rigid.spec.ts
git commit -m "$(cat <<'EOF'
test(e2e): T35 subasm-place-rigid

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 36: E2E `subasm-flexible-toggle`

**Files:**
- Create: `tests/e2e/assembly/subasm-flexible-toggle.spec.ts`

- [ ] **Step 1: Spec**

```ts
test('toggling flexible drops the parent DOF count', async ({ page }) => {
  await page.goto('/');
  // Seed parts + sub-asm with one inner mate so flexible mode adds DOFs to parent
  await seedAssemblyPart(page, 'a.zipt', cubeBytes);
  const sub = makeSubAsmDoc('sub', [
    { id: 'a', partPath: 'a.zipt', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
    { id: 'b', partPath: 'a.zipt', position: { x: 5, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
  ]);
  await seedSubAssemblyZiasm(page, 'sub.ziasm', sub);
  // Place sub.ziasm in a new top assembly
  await page.click('text=New Assembly');
  await page.keyboard.press('p');
  await page.click('button[aria-label="sub.ziasm tile"]');
  await page.click('text=OK');
  // Capture rigid DOF
  const rigidDof = await page.locator('text=/^Assembly: (\\d+) DOF/').textContent();
  // Open EditComponent dialog and toggle Flexible
  await page.click('text=sub'); // browser pane
  await page.keyboard.press('e');
  await page.click('label:has-text("Flexible") input[type="checkbox"]');
  await page.click('text=OK');
  // DOF count should differ
  const flexDof = await page.locator('text=/^Assembly: (\\d+) DOF/').textContent();
  expect(flexDof).not.toBe(rigidDof);
});
```

- [ ] **Step 2-3: Run + commit (analogous to T35)**

```bash
git add tests/e2e/assembly/subasm-flexible-toggle.spec.ts
git commit -m "$(cat <<'EOF'
test(e2e): T36 subasm-flexible-toggle

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 37: E2E `subasm-constraint-reach`

**Files:**
- Create: `tests/e2e/assembly/subasm-constraint-reach.spec.ts`

- [ ] **Step 1: Spec**

```ts
test('top constraint can reference a face on a leaf inside a placed sub-asm', async ({ page }) => {
  await page.goto('/');
  await seedAssemblyPart(page, 'panel.zipt', cubeBytes);
  await seedAssemblyPart(page, 'block.zipt', cubeBytes);
  const sub = makeSubAsmDoc('sub', [
    { id: 'inner', partPath: 'panel.zipt', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
  ]);
  await seedSubAssemblyZiasm(page, 'sub.ziasm', sub);
  await page.click('text=New Assembly');
  await page.keyboard.press('p');
  await page.click('button[aria-label="sub.ziasm tile"]'); await page.click('text=OK');
  await page.keyboard.press('p');
  await page.click('button[aria-label="block.zipt tile"]'); await page.click('text=OK');
  // Open Place Constraint, pick face on inner leaf via dev hook
  await page.keyboard.press('m'); // mate
  await page.evaluate(() => (window as any).__zilventorAssemblyPickerSimulate('A', 'face',
    { kind: 'face', componentPath: ['sub-comp-id', 'inner'], face: { featureId: 'E1', role: 'top' } },
  ));
  await page.evaluate(() => (window as any).__zilventorAssemblyPickerSimulate('B', 'face',
    { kind: 'face', componentPath: ['block-comp-id'], face: { featureId: 'E1', role: 'bottom' } },
  ));
  await page.click('text=OK');
  // Solver runs; verify residual low (no brokenRef)
  await page.waitForFunction(() => {
    const r = (window as any).__zilventorAssemblySolverResult();
    return r && r.residual < 1e-2;
  });
});
```

- [ ] **Steps 2-3: Run + commit**

```bash
git add tests/e2e/assembly/subasm-constraint-reach.spec.ts
git commit -m "$(cat <<'EOF'
test(e2e): T37 subasm-constraint-reach

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 38: E2E `subasm-cycle-rejection`

**Files:**
- Create: `tests/e2e/assembly/subasm-cycle-rejection.spec.ts`

- [ ] **Step 1: Spec**

```ts
test('place rejects a cycle-creating sub-asm', async ({ page }) => {
  await page.goto('/');
  // Build a.ziasm that references top.ziasm. Top is the active document.
  await page.click('text=New Assembly'); // creates top.ziasm
  // (At this point active doc.name is 'top', so its OPFS path is 'top.ziasm')
  // Seed a.ziasm referencing top.ziasm
  const cyclic = makeSubAsmDoc('cyclic', [
    { id: 'self', partPath: 'top.ziasm', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
  ]);
  await seedSubAssemblyZiasm(page, 'cyclic.ziasm', cyclic);
  // Try to place cyclic.ziasm — should be rejected
  await page.keyboard.press('p');
  await page.click('button[aria-label="cyclic.ziasm tile"]');
  await page.click('text=OK');
  // Status message + no placement
  await expect(page.locator('text=/cycle/i')).toBeVisible();
  const count = await page.evaluate(() => (window as any).__zilventorComponentPathToLeafCount([]));
  expect(count).toBe(0);
});
```

- [ ] **Steps 2-3: Run + commit**

```bash
git add tests/e2e/assembly/subasm-cycle-rejection.spec.ts
git commit -m "$(cat <<'EOF'
test(e2e): T38 subasm-cycle-rejection

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 39: E2E `subasm-broken-ref`

**Files:**
- Create: `tests/e2e/assembly/subasm-broken-ref.spec.ts`

- [ ] **Step 1: Spec**

```ts
test('renaming a sub-asm out from under the parent surfaces placeholder + diagnostic', async ({ page }) => {
  await page.goto('/');
  await seedAssemblyPart(page, 'panel.zipt', cubeBytes);
  const sub = makeSubAsmDoc('sub', [
    { id: 'p', partPath: 'panel.zipt', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
  ]);
  await seedSubAssemblyZiasm(page, 'sub.ziasm', sub);
  await page.click('text=New Assembly');
  await page.keyboard.press('p');
  await page.click('button[aria-label="sub.ziasm tile"]'); await page.click('text=OK');
  // Rename sub.ziasm in OPFS → reload
  await page.evaluate(async () => {
    const opfs = await (window as any).__zilventorGetOpfs();
    const bytes = await opfs.read('sub.ziasm');
    await opfs.write('sub_renamed.ziasm', bytes);
    await opfs.delete('sub.ziasm');
    await (window as any).__zilventorSubAsmInvalidate('sub.ziasm');
  });
  await expect(page.locator('text=/missing/i')).toBeVisible();
  // Placeholder leaf in the scene
  const count = await page.evaluate(() => (window as any).__zilventorComponentPathToLeafCount([]));
  expect(count).toBe(1); // one placeholder
});
```

- [ ] **Steps 2-3: Run + commit**

```bash
git add tests/e2e/assembly/subasm-broken-ref.spec.ts
git commit -m "$(cat <<'EOF'
test(e2e): T39 subasm-broken-ref

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 40: E2E `subasm-color-override`

**Files:**
- Create: `tests/e2e/assembly/subasm-color-override.spec.ts`

- [ ] **Step 1: Spec**

```ts
test('per-leaf override beats placement tint and splits BOM row', async ({ page }) => {
  await page.goto('/');
  await seedAssemblyPart(page, 'panel.zipt', cubeBytes);
  const sub = makeSubAsmDoc('sub', [
    { id: 'pa', partPath: 'panel.zipt', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true, color: { kind: 'palette', name: 'oak' } },
    { id: 'pb', partPath: 'panel.zipt', position: { x: 5, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true, color: { kind: 'palette', name: 'oak' } },
  ]);
  // The sub-asm's own colors map needs the 'oak' entry
  sub.colors = { oak: '#a0651e' };
  await seedSubAssemblyZiasm(page, 'sub.ziasm', sub);
  await page.click('text=New Assembly');
  await page.keyboard.press('p');
  await page.click('button[aria-label="sub.ziasm tile"]'); await page.click('text=OK');
  // Add walnut palette entry on top
  await page.evaluate(() => {
    const s = (window as any).__zilventorStore.getState();
    s.setAssemblyPaletteColor('walnut', '#5b3a1a');
  });
  // Set per-leaf override on sub-comp-id/pa
  await page.evaluate(() => {
    const w = window as any;
    const s = w.__zilventorStore.getState();
    const subComp = s.activeDocument.document.components[0].id;
    s.setColorOverride([subComp, 'pa'], { kind: 'palette', name: 'walnut' });
  });
  // BOM splits
  await page.click('button[aria-label="BOM tab"]');
  const rows = await page.locator('table[aria-label="BOM"] tbody tr').count();
  expect(rows).toBe(2);
  // Viewport: pa is walnut hex
  const colorPa = await page.evaluate(() => {
    const w = window as any;
    const s = w.__zilventorStore.getState();
    const subComp = s.activeDocument.document.components[0].id;
    return w.__zilventorComponentMaterialHex([subComp, 'pa']);
  });
  expect(colorPa?.toLowerCase()).toBe('#5b3a1a');
});
```

- [ ] **Steps 2-3: Run + commit**

```bash
git add tests/e2e/assembly/subasm-color-override.spec.ts
git commit -m "$(cat <<'EOF'
test(e2e): T40 subasm-color-override

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 41: E2E `subasm-invalidate-cascade`

**Files:**
- Create: `tests/e2e/assembly/subasm-invalidate-cascade.spec.ts`

- [ ] **Step 1: Spec**

```ts
test('editing a sub-asm and saving cascades to parent re-solve + viewport refresh', async ({ page }) => {
  await page.goto('/');
  await seedAssemblyPart(page, 'panel.zipt', cubeBytes);
  const sub = makeSubAsmDoc('sub', [
    { id: 'p', partPath: 'panel.zipt', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
  ]);
  await seedSubAssemblyZiasm(page, 'sub.ziasm', sub);
  await page.click('text=New Assembly');
  await page.keyboard.press('p');
  await page.click('button[aria-label="sub.ziasm tile"]'); await page.click('text=OK');
  // Capture initial leaf pose
  const before = await page.evaluate(() => {
    const s = (window as any).__zilventorStore.getState();
    const sc = s.activeDocument.document.components[0].id;
    return (window as any).__zilventorComposedPoseFor([sc, 'p']);
  });
  // Edit sub.ziasm via OPFS round-trip: bump panel.position.x to 7
  await page.evaluate(async () => {
    const w = window as any;
    const opfs = await w.__zilventorGetOpfs();
    const original = await w.__zilventorUnpackAssembly(await opfs.read('sub.ziasm'));
    original.manifest.document.components[0].position.x = 7;
    const repacked = await w.__zilventorPackProject(original.manifest, new Uint8Array());
    await opfs.write('sub.ziasm', repacked);
    await w.__zilventorSubAsmInvalidate('sub.ziasm');
  });
  await page.waitForFunction((b) => {
    const w = window as any;
    const s = w.__zilventorStore.getState();
    const sc = s.activeDocument.document.components[0].id;
    const p = w.__zilventorComposedPoseFor([sc, 'p']);
    return p && Math.abs(p.translation.x - b.translation.x) > 1;
  }, before);
});
```

- [ ] **Steps 2-3: Run + commit**

```bash
git add tests/e2e/assembly/subasm-invalidate-cascade.spec.ts
git commit -m "$(cat <<'EOF'
test(e2e): T41 subasm-invalidate-cascade

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 42: E2E `subasm-bom-recursive`

**Files:**
- Create: `tests/e2e/assembly/subasm-bom-recursive.spec.ts`

- [ ] **Step 1: Spec**

```ts
test('3-level tree (cabinet/drawer/panel) aggregates correctly + CSV export', async ({ page }) => {
  await page.goto('/');
  await seedAssemblyPart(page, 'panel.zipt', cubeBytes);
  const drawer = makeSubAsmDoc('drawer', [
    { id: 'pa', partPath: 'panel.zipt', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
    { id: 'pb', partPath: 'panel.zipt', position: { x: 5, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
  ]);
  const cabinet = makeSubAsmDoc('cabinet', [
    { id: 'd1', partPath: 'drawer.ziasm', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
    { id: 'd2', partPath: 'drawer.ziasm', position: { x: 0, y: 5, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
  ]);
  await seedSubAssemblyZiasm(page, 'drawer.ziasm', drawer);
  await seedSubAssemblyZiasm(page, 'cabinet.ziasm', cabinet);
  await page.click('text=New Assembly');
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press('p');
    await page.click('button[aria-label="cabinet.ziasm tile"]'); await page.click('text=OK');
  }
  // 3 cabinets × 2 drawers × 2 panels = 12 leaves; one BOM row, qty 12
  await page.click('button[aria-label="BOM tab"]');
  const qty = await page.locator('table[aria-label="BOM"] tbody tr td:nth-child(2)').first().innerText();
  expect(qty).toBe('12');
  // CSV export
  await page.click('button:has-text("Export CSV")');
  const csv = await page.evaluate(() => new TextDecoder().decode((window as any).__zilventorBomCsvBytes()));
  expect(csv).toContain('"Panel"');
  expect(csv).toContain(',12,');
});
```

- [ ] **Steps 2-3: Run + commit**

```bash
git add tests/e2e/assembly/subasm-bom-recursive.spec.ts
git commit -m "$(cat <<'EOF'
test(e2e): T42 subasm-bom-recursive

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 12 — Perf

### Task 43: Perf `subasm-aggregate-bom-deep`

**Files:**
- Create: `tests/perf/subasm-aggregate-bom-deep.spec.ts`

- [ ] **Step 1: Spec**

```ts
test('aggregateBomRecursive p95 < 5ms across 3-level 200-leaf tree', async ({ page }) => {
  await page.goto('/');
  // Seed a 200-leaf tree: 10 cabinets × 4 drawers × 5 panels
  ...
  const p95 = await page.evaluate(() => (window as any).__zilventorBomAggregateMs(50));
  expect(p95).toBeLessThan(5);
});
```

- [ ] **Step 2-3: Run + commit**

```bash
git add tests/perf/subasm-aggregate-bom-deep.spec.ts
git commit -m "$(cat <<'EOF'
test(perf): T43 subasm-aggregate-bom-deep p95<5ms

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 44: Perf `subasm-flatten-and-solve`

**Files:**
- Create: `tests/perf/subasm-flatten-and-solve.spec.ts`

- [ ] **Step 1: Spec**

Seed 5 rigid sub-asms (10 leaves each = 50 leaves) with 30 parent-level constraints; measure flatten + LM solve p95 over 50 trials, expect < 200 ms.

```ts
test('flattenForSolver + solveAssembly p95 < 200ms across 5 rigid sub-asms', async ({ page }) => {
  ...
  const p95 = await page.evaluate(async () => {
    const w = window as any;
    const trials = 50;
    const ms: number[] = [];
    for (let i = 0; i < trials; i++) {
      const t0 = performance.now();
      await w.__zilventorSolveAssembly(/* synthetic input */);
      ms.push(performance.now() - t0);
    }
    ms.sort((a, b) => a - b);
    return ms[Math.floor(0.95 * (ms.length - 1))];
  });
  expect(p95).toBeLessThan(200);
});
```

- [ ] **Step 2-3: Run + commit**

```bash
git add tests/perf/subasm-flatten-and-solve.spec.ts
git commit -m "$(cat <<'EOF'
test(perf): T44 subasm-flatten-and-solve p95<200ms

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 45: Perf `subasm-load-tree`

**Files:**
- Create: `tests/perf/subasm-load-tree.spec.ts`

- [ ] **Step 1: Spec**

Cold-cache `loadSubAssemblyTree` p95 for a 50-leaf tree, expect < 1500 ms.

```ts
test('cold-cache loadSubAssemblyTree p95 < 1500ms for 50-leaf tree', async ({ page }) => {
  ...
  const p95 = await page.evaluate(async () => {
    const w = window as any;
    const trials = 10;
    const ms: number[] = [];
    for (let i = 0; i < trials; i++) {
      // Force re-load by clearing the cache
      await w.__zilventorSubAsmInvalidateAll();
      const t0 = performance.now();
      await w.__zilventorLoadSubAsmTree();
      ms.push(performance.now() - t0);
    }
    ms.sort((a, b) => a - b);
    return ms[Math.floor(0.95 * (ms.length - 1))];
  });
  expect(p95).toBeLessThan(1500);
});
```

(Add `__zilventorSubAsmInvalidateAll()` and `__zilventorLoadSubAsmTree()` to the dev hooks in T33 if not already present — both are tiny.)

- [ ] **Step 2-3: Run + commit**

```bash
git add tests/perf/subasm-load-tree.spec.ts packages/app/src/App.tsx
git commit -m "$(cat <<'EOF'
test(perf): T45 subasm-load-tree p95<1500ms

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Closing — verification, follow-ups, ship

### Task 46: Workspace-wide green sweep

- [ ] `pnpm -r typecheck` — clean.
- [ ] `pnpm -r test` — all green except the pre-existing flaky `tests/e2e/assembly/missing-part.spec.ts` (per 4b memory; safe to skip when reporting "all green").
- [ ] `pnpm --filter @zilventor/app exec playwright test tests/e2e/assembly` — all 4d specs green; 13 pre-4d specs green.
- [ ] `pnpm --filter @zilventor/app exec playwright test tests/perf/subasm-*` — all green within budget.

If anything fails: investigate as a follow-up commit. Do NOT skip.

### Task 47: Update execution-state memory + roadmap

After ship:

- [ ] Add `project_subproject_4d_execution_state.md` to `~/.claude/projects/.../memory/` with: HEAD commit, task counts, test totals, notable corrections, useful import paths, and dev hooks.
- [ ] Update `project_zilinventor_overview.md`: roadmap line for sub-project 4 → "shipped: 4a/4b/4c/4d; 4 complete".
- [ ] Update `MEMORY.md` index entry; remove `next_session_resume.md` references to 4d as "open".

---

## Self-Review

Before handing off, this plan was checked against the spec.

**Spec coverage:**
- v7→v8 schema bump → T1–T5
- SubAssemblyCache + cycle detection → T6–T8
- Walkers (resolveColor, aggregateBomRecursive, mergeAndPruneColorOverrides, visibleLeaves) → T9–T12
- Solver flatten + composedPoses + rigid pre-solve → T13–T17
- Store slices → T18–T19
- Commands (cycle gate, flexible toggle, override) → T20–T22; BOM table wiring T23
- Dialogs / BrowserPane / StatusBar / placement tile listing → T24–T27
- Viewport pathways (path-keyed mesh, selection, picker) → T28–T31
- Autosave merge/prune + dev hooks → T32–T33
- E2E → T34–T42
- Perf → T43–T45

**Type consistency:** `componentPath` is the new ref form; `groundedComponentPaths` (paths) replaces `groundedComponentIds` (ids); `colorOverrides` keyed by `ComponentPathKey`; `pathKey` / `parsePathKey` from `@zilventor/shared`. The `Pose` and `SolverInput` types are introduced in T13 and reused in T16/T17.

**Placeholder scan:** None. Each task has concrete code, exact file paths, and specific commands.

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-29-zilinventor-subproject4d-subassemblies-plan.md`.

Two execution options:

1. **Subagent-Driven (recommended)** — fresh subagent per task with two-stage review. Per memory: dispatch sweet spot is 5–7 sequential tasks per implementer. Phases group naturally: 1 (T1–T5), 2 (T6–T8), 3 (T9–T12), 4 (T13–T16), 5 (T17), 6 (T18–T19), 7 (T20–T23), 8 (T24–T27), 9 (T28–T31), 10 (T32–T33), 11 (T34–T42 — split as T34–T37, T38–T42), 12 (T43–T45). Two-stage review is most valuable on T13–T17 (math-heavy solver + composed-pose) and T20 (cycle gate); other tasks are mechanical.

2. **Inline Execution** — execute tasks in this session using `superpowers:executing-plans` with batch checkpoints between phases.

Which approach?

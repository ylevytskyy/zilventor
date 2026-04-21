# ZilInventor Shell MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver Shell MVP — a PWA where a designer can create a part, sketch a rectangle by numeric input, extrude it to a box, edit the extrusion parameter, undo/redo, save to disk, close, and reopen with feature tree and geometry intact — on a 2014–2016 Intel HD laptop, offline after first load.

**Architecture:** pnpm monorepo (`packages/app`, `packages/kernel`, `packages/shared`, `packages/icons`). React+Tailwind UI on the main thread, OCCT WASM + kernel adapter + storage bridge on a Web Worker, Comlink RPC between them. Geometry crosses the boundary as transferable `Float32Array`s; OCCT handles stay in the Worker. All UI mutations go through explicit Command objects for undo/redo. Project files are gzipped tars of `manifest.json` + BREP blobs.

**Tech Stack:** TypeScript, Vite, React, Tailwind, three.js (WebGL 2), opencascade.js (WASM), Comlink, Zustand, pako, tar-stream, Workbox (Vite PWA plugin), Vitest (unit + integration), Playwright (E2E), pnpm workspaces.

**Reference spec:** `docs/superpowers/specs/2026-04-21-zilinventor-shell-mvp-design.md`

---

## File structure map

```
zilventor/                                    # repo root
├── .github/workflows/ci.yml                   # Task 27
├── .gitignore                                 # Task 1
├── .nvmrc                                     # Task 1
├── package.json                               # Task 1 — root workspace package
├── pnpm-workspace.yaml                        # Task 1
├── tsconfig.base.json                         # Task 1
├── eslint.config.js                           # Task 1
├── vitest.config.ts                           # Task 3
├── playwright.config.ts                       # Task 20
├── docs/
│   ├── superpowers/specs/                     # spec lives here, unchanged
│   ├── superpowers/plans/                     # this plan lives here
│   └── superpowers/manual-tests/shell-mvp.md  # Task 27
│
├── packages/
│   ├── shared/
│   │   ├── package.json                       # Task 2
│   │   ├── tsconfig.json                      # Task 2
│   │   └── src/
│   │       ├── index.ts                       # Task 2 — re-exports
│   │       ├── types.ts                       # Task 2/10/11
│   │       ├── result.ts                      # Task 2 — Result<T,E>
│   │       ├── errors.ts                      # Task 2 — KernelError kinds
│   │       └── fileFormat.ts                  # Task 5 — version + migration
│   │
│   ├── kernel/
│   │   ├── package.json                       # Task 6
│   │   ├── tsconfig.json                      # Task 6
│   │   └── src/
│   │       ├── worker.ts                      # Task 6 — Comlink.expose entry
│   │       ├── api.ts                         # Task 6 — exposed RPC surface type
│   │       ├── occt/
│   │       │   ├── occtLoader.ts              # Task 7
│   │       │   ├── SolidOps.ts                # Task 7/9
│   │       │   ├── SketchOps.ts               # Task 11
│   │       │   ├── Tessellator.ts             # Task 8
│   │       │   └── BRepIO.ts                  # Task 9
│   │       ├── adapter/
│   │       │   ├── PartDocument.ts            # Task 10
│   │       │   ├── ParameterResolver.ts       # Task 10
│   │       │   ├── FeatureTree.ts             # Task 12
│   │       │   └── features/
│   │       │       ├── SketchFeature.ts       # Task 11
│   │       │       └── ExtrudeFeature.ts      # Task 12
│   │       └── storage/
│   │           ├── Opfs.ts                    # Task 22
│   │           ├── FileSystemAccess.ts        # Task 23
│   │           └── ProjectPacker.ts           # Task 4
│   │
│   ├── app/
│   │   ├── package.json                       # Task 13
│   │   ├── tsconfig.json                      # Task 13
│   │   ├── vite.config.ts                     # Task 13
│   │   ├── index.html                         # Task 13
│   │   ├── tailwind.config.ts                 # Task 13
│   │   ├── postcss.config.js                  # Task 13
│   │   └── src/
│   │       ├── main.tsx                       # Task 13
│   │       ├── App.tsx                        # Task 13 — grid layout root
│   │       ├── styles.css                     # Task 13
│   │       ├── shell/
│   │       │   ├── Ribbon.tsx                 # Task 14
│   │       │   ├── RibbonTab.tsx              # Task 14
│   │       │   ├── RibbonPanel.tsx            # Task 14
│   │       │   ├── BrowserPane.tsx            # Task 15
│   │       │   ├── StatusBar.tsx              # Task 15
│   │       │   ├── PropertiesPanel.tsx        # Task 21
│   │       │   └── tabs/
│   │       │       ├── FileTab.tsx            # Task 14
│   │       │       ├── ModelTab.tsx           # Task 14
│   │       │       ├── SketchTab.tsx          # Task 14
│   │       │       ├── ViewTab.tsx            # Task 14
│   │       │       ├── FurnitureTab.tsx       # Task 14 — stubbed
│   │       │       ├── InspectTab.tsx         # Task 14 — stubbed
│   │       │       └── DrawingTab.tsx         # Task 14 — stubbed
│   │       ├── viewport/
│   │       │   ├── Viewport.tsx               # Task 16
│   │       │   ├── SceneManager.ts            # Task 16
│   │       │   └── ViewCube.tsx               # Task 16
│   │       ├── kernel-client/
│   │       │   └── KernelClient.ts            # Task 17
│   │       ├── store/
│   │       │   └── useAppStore.ts             # Task 18
│   │       ├── commands/
│   │       │   ├── CommandBus.ts              # Task 18
│   │       │   ├── Command.ts                 # Task 18
│   │       │   ├── CreatePartCommand.ts       # Task 19
│   │       │   ├── AddSketchCommand.ts        # Task 19
│   │       │   ├── AddExtrusionCommand.ts     # Task 19
│   │       │   └── EditParameterCommand.ts   # Task 19
│   │       └── pwa/
│   │           └── registerSW.ts              # Task 25
│   │
│   └── icons/
│       ├── package.json                       # Task 14
│       └── src/
│           ├── sprite.svg                     # Task 14
│           └── index.ts                       # Task 14 — icon ids
│
└── tests/
    ├── unit/                                  # Vitest; per-package __tests__ preferred but cross-cutting here
    ├── integration/
    │   └── fixtures/                          # golden BREPs, Task 9+
    ├── e2e/
    │   ├── workflow-1-cold-start.spec.ts      # Task 20
    │   ├── workflow-2-create-box.spec.ts      # Task 20
    │   ├── workflow-3-edit-undo.spec.ts       # Task 21
    │   └── workflow-4-save-reopen.spec.ts     # Task 24
    └── perf/
        ├── cold-start.ts                      # Task 27
        ├── extrude-box.ts                     # Task 27
        ├── param-edit-loop.ts                 # Task 27
        └── leak.ts                            # Task 27
```

---

## Phase 1 — Workspace foundation

### Task 1: Scaffold pnpm monorepo with TypeScript and ESLint

Sets up the empty workspace so every later task has a typecheck + lint target. No product code yet — this is plumbing.

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Create: `eslint.config.js`
- Create: `.nvmrc`
- Modify: `.gitignore` (append node_modules, dist, .vite, *.log)

- [ ] **Step 1: Write a workspace-level smoke test**

Create `tests/unit/workspace.spec.ts` (no package yet — will move under `packages/shared` in Task 2; for now use a root test runner). Actually, we need vitest set up first. Instead of a code test, write a shell-level test:

Create `tests/workspace-smoke.sh`:

```bash
#!/usr/bin/env bash
set -eu
pnpm --version >/dev/null
pnpm -r typecheck
echo "workspace ok"
```

- [ ] **Step 2: Run the smoke test — expect it to fail**

```
chmod +x tests/workspace-smoke.sh && ./tests/workspace-smoke.sh
```

Expected: fails (no `package.json` → `pnpm -r typecheck` errors).

- [ ] **Step 3: Create `.nvmrc`**

```
20
```

- [ ] **Step 4: Create `package.json`**

```json
{
  "name": "zilventor",
  "version": "0.0.0",
  "private": true,
  "packageManager": "pnpm@9.0.0",
  "scripts": {
    "typecheck": "pnpm -r typecheck",
    "lint": "eslint .",
    "test:unit": "pnpm -r test:unit",
    "test:integration": "pnpm -r test:integration",
    "test:e2e": "playwright test",
    "test:perf": "pnpm -r test:perf",
    "build": "pnpm -r build"
  },
  "devDependencies": {
    "typescript": "^5.5.0",
    "eslint": "^9.9.0",
    "@typescript-eslint/parser": "^8.0.0",
    "@typescript-eslint/eslint-plugin": "^8.0.0"
  },
  "engines": {
    "node": ">=20"
  }
}
```

- [ ] **Step 5: Create `pnpm-workspace.yaml`**

```yaml
packages:
  - 'packages/*'
```

- [ ] **Step 6: Create `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable", "WebWorker"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "exactOptionalPropertyTypes": true,
    "resolveJsonModule": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "jsx": "react-jsx",
    "types": ["vitest/globals"]
  }
}
```

- [ ] **Step 7: Create `eslint.config.js`**

Minimal flat config, add the "no OCCT on main thread" rule in Task 7 when it matters.

```js
import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';

export default [
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: { parser: tsparser, parserOptions: { project: true } },
    plugins: { '@typescript-eslint': tseslint },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }]
    }
  },
  { ignores: ['**/dist/**', '**/node_modules/**', '**/*.js'] }
];
```

- [ ] **Step 8: Extend `.gitignore`**

Append to existing `.gitignore`:

```
node_modules/
dist/
.vite/
*.log
coverage/
test-results/
playwright-report/
```

- [ ] **Step 9: Install and verify**

```
pnpm install
./tests/workspace-smoke.sh
```

Expected: "workspace ok" (no packages to typecheck yet but `pnpm -r typecheck` passes vacuously).

- [ ] **Step 10: Commit**

```
git add package.json pnpm-workspace.yaml tsconfig.base.json eslint.config.js .nvmrc .gitignore tests/workspace-smoke.sh
git commit -m "chore: scaffold pnpm monorepo with TypeScript and ESLint"
```

---

### Task 2: Create `packages/shared` with `Result<T,E>` and core types skeleton

Establishes the types package that both main thread and worker import. Only types and pure helpers here — no runtime dependencies.

**Files:**
- Create: `packages/shared/package.json`
- Create: `packages/shared/tsconfig.json`
- Create: `packages/shared/src/index.ts`
- Create: `packages/shared/src/result.ts`
- Create: `packages/shared/src/types.ts`
- Create: `packages/shared/src/errors.ts`
- Create: `packages/shared/src/__tests__/result.spec.ts`

- [ ] **Step 1: Write the failing test for `Result<T,E>`**

`packages/shared/src/__tests__/result.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { ok, err, isOk, isErr, mapOk, unwrap } from '../result';

describe('Result', () => {
  it('ok wraps a value and isOk returns true', () => {
    const r = ok(42);
    expect(isOk(r)).toBe(true);
    expect(isErr(r)).toBe(false);
    if (isOk(r)) expect(r.value).toBe(42);
  });

  it('err wraps an error and isErr returns true', () => {
    const r = err('boom');
    expect(isErr(r)).toBe(true);
    if (isErr(r)) expect(r.error).toBe('boom');
  });

  it('mapOk transforms only the ok branch', () => {
    expect(mapOk(ok(2), (n) => n * 3)).toEqual({ ok: true, value: 6 });
    expect(mapOk(err('x'), (n: number) => n * 3)).toEqual({ ok: false, error: 'x' });
  });

  it('unwrap returns value on ok and throws on err', () => {
    expect(unwrap(ok('hi'))).toBe('hi');
    expect(() => unwrap(err('oops'))).toThrow('oops');
  });
});
```

- [ ] **Step 2: Run and expect fail (no `result.ts` yet)**

```
pnpm --filter @zilventor/shared test:unit
```

Expected: module-not-found error.

- [ ] **Step 3: Create `packages/shared/package.json`**

```json
{
  "name": "@zilventor/shared",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test:unit": "vitest run",
    "test:unit:watch": "vitest"
  },
  "devDependencies": {
    "vitest": "^2.0.0",
    "typescript": "^5.5.0"
  }
}
```

- [ ] **Step 4: Create `packages/shared/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "src" },
  "include": ["src/**/*"]
}
```

- [ ] **Step 5: Create `packages/shared/src/result.ts`**

```ts
export type Result<T, E> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });

export const isOk = <T, E>(r: Result<T, E>): r is { ok: true; value: T } => r.ok;
export const isErr = <T, E>(r: Result<T, E>): r is { ok: false; error: E } => !r.ok;

export const mapOk = <T, U, E>(r: Result<T, E>, f: (t: T) => U): Result<U, E> =>
  r.ok ? ok(f(r.value)) : r;

export const unwrap = <T, E>(r: Result<T, E>): T => {
  if (r.ok) return r.value;
  throw new Error(typeof r.error === 'string' ? r.error : JSON.stringify(r.error));
};
```

- [ ] **Step 6: Create `packages/shared/src/errors.ts`**

```ts
export type KernelErrorKind =
  | 'degenerateSketch'
  | 'invalidParameter'
  | 'booleanFailed'
  | 'oom'
  | 'workerCrashed'
  | 'fileFormatTooNew'
  | 'fileCorrupt'
  | 'featureNotFound'
  | 'unknown';

export type KernelError = {
  kind: KernelErrorKind;
  message: string;
  correlationId: string;
  featureId?: string;
  occtCode?: string;
};

export const newCorrelationId = (): string =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
```

- [ ] **Step 7: Create `packages/shared/src/types.ts` (initial skeleton, extended in Task 10/11)**

```ts
export type UnitKind = 'mm' | 'deg';

export type Parameter = {
  name: string;
  expression: string;
  value: number;
  unit: UnitKind;
};

export type BoundingBox = readonly [number, number, number, number, number, number];

export type Mesh = {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  boundingBox: BoundingBox;
};

// Extended in later tasks.
export type Feature = never;
export type PartDocument = unknown;
export type AssemblyDocument = unknown;
export type ProjectFile = unknown;
```

- [ ] **Step 8: Create `packages/shared/src/index.ts`**

```ts
export * from './result';
export * from './errors';
export * from './types';
```

- [ ] **Step 9: Run tests — expect pass**

```
pnpm --filter @zilventor/shared test:unit
```

Expected: all 4 tests pass.

- [ ] **Step 10: Commit**

```
git add packages/shared/
git commit -m "feat(shared): add Result<T,E>, KernelError, and core type stubs"
```

---

### Task 3: Wire Vitest at the root and add smoke test for every package

Makes `pnpm test:unit` at the root drive each package's vitest. Catches misconfig early.

**Files:**
- Create: `vitest.config.ts`
- Modify: `packages/shared/vitest.config.ts` (if needed for aliases)

- [ ] **Step 1: Write the failing root-level test command**

Run: `pnpm test:unit`
Expected: works (shared package tests pass) — but we want to also verify it wires correctly when we add more packages. Add a CI-style typecheck pass.

- [ ] **Step 2: Create `vitest.config.ts` at root**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['packages/*/src/**/__tests__/**/*.spec.ts', 'tests/unit/**/*.spec.ts']
  }
});
```

- [ ] **Step 3: Add `vitest` as a root devDependency**

Edit root `package.json` devDependencies, add:

```json
"vitest": "^2.0.0"
```

Then:

```
pnpm install
```

- [ ] **Step 4: Run unified test command**

```
pnpm test:unit
```

Expected: 4 tests pass (all from `packages/shared/src/__tests__/result.spec.ts`).

- [ ] **Step 5: Commit**

```
git add vitest.config.ts package.json pnpm-lock.yaml
git commit -m "chore: wire root-level Vitest runner"
```

---

## Phase 2 — File format

### Task 4: ProjectPacker (tar + gzip round-trip)

The `.zipt` container. Must round-trip a manifest JSON + a blobs directory + a thumbnail, atomically. This task produces a pure in-memory packer — write-to-disk integration comes in Task 22/23.

**Files:**
- Create: `packages/kernel/package.json` (first scaffold)
- Create: `packages/kernel/tsconfig.json`
- Create: `packages/kernel/src/storage/ProjectPacker.ts`
- Create: `packages/kernel/src/storage/__tests__/ProjectPacker.spec.ts`

- [ ] **Step 1: Write the failing round-trip test**

`packages/kernel/src/storage/__tests__/ProjectPacker.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { packProject, unpackProject } from '../ProjectPacker';

describe('ProjectPacker', () => {
  it('packs and unpacks a manifest + blobs losslessly', async () => {
    const manifest = { formatVersion: 1, kind: 'part', name: 'Part1' };
    const blob = new Uint8Array([1, 2, 3, 4, 5]);
    const thumb = new Uint8Array([0xff, 0xd8, 0xff]); // jpg magic, not a real image

    const archive = await packProject({
      manifest,
      blobs: { 'blob-a': blob },
      thumbnail: thumb
    });

    expect(archive).toBeInstanceOf(Uint8Array);
    expect(archive.length).toBeGreaterThan(0);

    const unpacked = await unpackProject(archive);
    expect(unpacked.manifest).toEqual(manifest);
    expect(unpacked.blobs['blob-a']).toEqual(blob);
    expect(unpacked.thumbnail).toEqual(thumb);
  });

  it('rejects an archive with a corrupt gzip header', async () => {
    const bad = new Uint8Array([0, 1, 2, 3]);
    await expect(unpackProject(bad)).rejects.toThrow(/corrupt|gzip/i);
  });
});
```

- [ ] **Step 2: Run and expect fail (no packer yet)**

```
pnpm --filter @zilventor/kernel test:unit
```

Expected: module-not-found.

- [ ] **Step 3: Create `packages/kernel/package.json`**

```json
{
  "name": "@zilventor/kernel",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/worker.ts",
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test:unit": "vitest run",
    "test:integration": "vitest run --config vitest.integration.config.ts",
    "test:perf": "echo 'perf tests TBD in Task 27' && exit 0"
  },
  "dependencies": {
    "@zilventor/shared": "workspace:*",
    "comlink": "^4.4.1",
    "pako": "^2.1.0",
    "tar-stream": "^3.1.7"
  },
  "devDependencies": {
    "typescript": "^5.5.0",
    "vitest": "^2.0.0",
    "@types/pako": "^2.0.3",
    "@types/tar-stream": "^3.1.3"
  }
}
```

- [ ] **Step 4: Create `packages/kernel/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "src" },
  "include": ["src/**/*"]
}
```

- [ ] **Step 5: Install**

```
pnpm install
```

- [ ] **Step 6: Implement `ProjectPacker.ts`**

```ts
import { gzip, ungzip } from 'pako';
import { pack as tarPack, extract as tarExtract } from 'tar-stream';

export type ProjectArchiveInput = {
  manifest: unknown;
  blobs: Record<string, Uint8Array>;
  thumbnail?: Uint8Array;
};

export type ProjectArchiveOutput = {
  manifest: unknown;
  blobs: Record<string, Uint8Array>;
  thumbnail?: Uint8Array;
};

export async function packProject(input: ProjectArchiveInput): Promise<Uint8Array> {
  const tar = tarPack();
  const chunks: Uint8Array[] = [];
  tar.on('data', (c: Buffer) => chunks.push(new Uint8Array(c)));

  const manifestBytes = new TextEncoder().encode(JSON.stringify(input.manifest));
  tar.entry({ name: 'manifest.json' }, Buffer.from(manifestBytes));

  for (const [id, bytes] of Object.entries(input.blobs)) {
    tar.entry({ name: `blobs/${id}.brep` }, Buffer.from(bytes));
  }
  if (input.thumbnail) {
    tar.entry({ name: 'thumbnail.png' }, Buffer.from(input.thumbnail));
  }
  tar.finalize();

  await new Promise<void>((resolve) => tar.on('end', () => resolve()));
  const total = chunks.reduce((n, c) => n + c.byteLength, 0);
  const flat = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { flat.set(c, off); off += c.byteLength; }
  return gzip(flat);
}

export async function unpackProject(archive: Uint8Array): Promise<ProjectArchiveOutput> {
  let tarBytes: Uint8Array;
  try { tarBytes = ungzip(archive); }
  catch (e) { throw new Error(`archive is corrupt (gzip): ${(e as Error).message}`); }

  const extract = tarExtract();
  const result: ProjectArchiveOutput = { manifest: null, blobs: {} };

  const done = new Promise<void>((resolve, reject) => {
    extract.on('entry', (header, stream, next) => {
      const bufs: Buffer[] = [];
      stream.on('data', (c: Buffer) => bufs.push(c));
      stream.on('end', () => {
        const data = new Uint8Array(Buffer.concat(bufs));
        if (header.name === 'manifest.json') {
          result.manifest = JSON.parse(new TextDecoder().decode(data));
        } else if (header.name.startsWith('blobs/') && header.name.endsWith('.brep')) {
          const id = header.name.slice('blobs/'.length, -'.brep'.length);
          result.blobs[id] = data;
        } else if (header.name === 'thumbnail.png') {
          result.thumbnail = data;
        }
        next();
      });
      stream.resume();
    });
    extract.on('finish', () => resolve());
    extract.on('error', reject);
  });

  extract.end(Buffer.from(tarBytes));
  await done;
  return result;
}
```

- [ ] **Step 7: Run tests — expect pass**

```
pnpm --filter @zilventor/kernel test:unit
```

Expected: both tests pass.

- [ ] **Step 8: Commit**

```
git add packages/kernel/ pnpm-lock.yaml
git commit -m "feat(kernel): add ProjectPacker for .zipt tar+gzip round-trip"
```

---

### Task 5: File format versioning and migration scaffold

Add `formatVersion` metadata and the migration dispatch that later sub-projects extend. Shell MVP locks v1.

**Files:**
- Modify: `packages/shared/src/fileFormat.ts` (new)
- Modify: `packages/shared/src/index.ts`
- Create: `packages/shared/src/__tests__/fileFormat.spec.ts`

- [ ] **Step 1: Write the failing version-guard test**

`packages/shared/src/__tests__/fileFormat.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { CURRENT_FORMAT_VERSION, migrateManifest } from '../fileFormat';

describe('fileFormat', () => {
  it('exports a locked current version', () => {
    expect(CURRENT_FORMAT_VERSION).toBe(1);
  });

  it('returns the manifest unchanged when already current', () => {
    const m = { formatVersion: 1, kind: 'part' as const };
    expect(migrateManifest(m)).toEqual(m);
  });

  it('throws a typed error when the manifest is from a newer version', () => {
    const m = { formatVersion: 99, kind: 'part' as const };
    expect(() => migrateManifest(m)).toThrow(/newer/i);
  });

  it('throws when formatVersion is missing', () => {
    expect(() => migrateManifest({} as unknown as { formatVersion: number })).toThrow(/formatVersion/);
  });
});
```

- [ ] **Step 2: Run — expect fail**

```
pnpm --filter @zilventor/shared test:unit
```

Expected: module-not-found.

- [ ] **Step 3: Implement `fileFormat.ts`**

```ts
export const CURRENT_FORMAT_VERSION = 1 as const;

export type AnyManifest = { formatVersion: number; [k: string]: unknown };

type MigrateFn = (m: AnyManifest) => AnyManifest;

const migrations: Record<number, MigrateFn> = {
  // [sourceVersion]: (m) => migratedManifestAtSourceVersion+1
  // Empty in MVP — will grow from v1 → v2 in Sub-project 2+.
};

export function migrateManifest(m: AnyManifest): AnyManifest {
  if (typeof m.formatVersion !== 'number') {
    throw new Error('formatVersion missing from manifest');
  }
  if (m.formatVersion > CURRENT_FORMAT_VERSION) {
    throw new Error(
      `file is from a newer version of ZilInventor (formatVersion=${m.formatVersion}, current=${CURRENT_FORMAT_VERSION})`
    );
  }
  let current = m;
  while (current.formatVersion < CURRENT_FORMAT_VERSION) {
    const step = migrations[current.formatVersion];
    if (!step) throw new Error(`no migration from formatVersion ${current.formatVersion}`);
    current = step(current);
  }
  return current;
}
```

- [ ] **Step 4: Re-export from `src/index.ts`**

Add to `packages/shared/src/index.ts`:

```ts
export * from './fileFormat';
```

- [ ] **Step 5: Run tests — expect pass**

```
pnpm --filter @zilventor/shared test:unit
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```
git add packages/shared/
git commit -m "feat(shared): lock formatVersion=1 and scaffold migration dispatch"
```

---

## Phase 3 — Kernel: OCCT foundation

### Task 6: Kernel Worker scaffold with Comlink

Create the Worker entry point, expose an empty API, and prove round-trip RPC from a test-harness. No OCCT yet.

**Files:**
- Create: `packages/kernel/src/worker.ts`
- Create: `packages/kernel/src/api.ts`
- Create: `packages/kernel/src/__tests__/worker.spec.ts`

- [ ] **Step 1: Write the failing RPC test**

`packages/kernel/src/__tests__/worker.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createKernelApi } from '../api';

describe('KernelApi (in-process)', () => {
  it('ping returns pong with an echoed payload', async () => {
    const api = createKernelApi();
    const res = await api.ping('hello');
    expect(res).toEqual({ reply: 'pong', echo: 'hello' });
  });
});
```

- [ ] **Step 2: Run — expect fail**

```
pnpm --filter @zilventor/kernel test:unit
```

- [ ] **Step 3: Create `packages/kernel/src/api.ts`**

Expose a factory that returns the RPC surface. We'll wrap it with Comlink in the worker file.

```ts
export type KernelApi = {
  ping(input: string): Promise<{ reply: 'pong'; echo: string }>;
  // more methods added in later tasks — keep this type as the single source of truth.
};

export function createKernelApi(): KernelApi {
  return {
    async ping(input: string) {
      return { reply: 'pong', echo: input };
    }
  };
}
```

- [ ] **Step 4: Create `packages/kernel/src/worker.ts`**

```ts
import * as Comlink from 'comlink';
import { createKernelApi } from './api';

const api = createKernelApi();
// eslint-disable-next-line no-restricted-globals
Comlink.expose(api, self as unknown as Comlink.Endpoint);
```

- [ ] **Step 5: Run tests — expect pass**

```
pnpm --filter @zilventor/kernel test:unit
```

Expected: passes.

- [ ] **Step 6: Commit**

```
git add packages/kernel/src/api.ts packages/kernel/src/worker.ts packages/kernel/src/__tests__/worker.spec.ts
git commit -m "feat(kernel): Comlink worker scaffold with ping RPC"
```

---

### Task 7: OCCT loader — pin `opencascade.js` and prove WASM boot

Load OCCT in Node (integration test runner) and prove a single kernel call works. Pin the WASM version explicitly.

**Files:**
- Modify: `packages/kernel/package.json` (add `opencascade.js`)
- Create: `packages/kernel/src/occt/occtLoader.ts`
- Create: `packages/kernel/src/occt/__tests__/occtLoader.spec.ts`
- Create: `packages/kernel/vitest.integration.config.ts`

- [ ] **Step 1: Write the failing integration test**

`packages/kernel/src/occt/__tests__/occtLoader.spec.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { loadOcct, type OcctInstance } from '../occtLoader';

describe('OCCT loader (integration)', () => {
  let occt: OcctInstance;
  beforeAll(async () => { occt = await loadOcct(); }, 60_000);

  it('instantiates and exposes gp_Pnt', () => {
    expect(occt).toBeDefined();
    const p = new occt.gp_Pnt_3(1, 2, 3);
    expect(p.X()).toBe(1);
    expect(p.Y()).toBe(2);
    expect(p.Z()).toBe(3);
    p.delete();
  });
});
```

- [ ] **Step 2: Run — expect fail**

```
pnpm --filter @zilventor/kernel test:integration
```

Expected: module-not-found or config missing.

- [ ] **Step 3: Add dependency pin in `packages/kernel/package.json`**

Under `dependencies`:

```json
"opencascade.js": "2.0.0-beta.b5ff984"
```

Then:

```
pnpm install
```

(Version is the most recent pinned release at time of writing. The implementing engineer should verify against npm, record the exact version selected in the commit message, and not bump casually.)

- [ ] **Step 4: Create `packages/kernel/vitest.integration.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/__tests__/**/*.integration.spec.ts', 'src/occt/**/__tests__/**/*.spec.ts'],
    testTimeout: 120_000
  }
});
```

- [ ] **Step 5: Create `packages/kernel/src/occt/occtLoader.ts`**

```ts
import initOpenCascade from 'opencascade.js';

export type OcctInstance = Awaited<ReturnType<typeof initOpenCascade>>;

let cached: Promise<OcctInstance> | null = null;

export function loadOcct(): Promise<OcctInstance> {
  cached ??= initOpenCascade();
  return cached;
}
```

- [ ] **Step 6: Run integration test — expect pass**

```
pnpm --filter @zilventor/kernel test:integration
```

Expected: WASM boots, test passes. If the install failed to fetch the WASM asset, check `opencascade.js` README for the `--filter` workaround and document the fix in commit.

- [ ] **Step 7: Add ESLint rule forbidding OCCT imports outside `kernel/src/occt/`**

Edit root `eslint.config.js`, add a new entry before the ignores:

```js
{
  files: ['packages/app/**', 'packages/shared/**', 'packages/kernel/src/adapter/**', 'packages/kernel/src/storage/**'],
  rules: {
    'no-restricted-imports': ['error', { patterns: ['opencascade.js', 'opencascade.js/*'] }]
  }
},
```

- [ ] **Step 8: Commit**

```
git add packages/kernel/package.json packages/kernel/src/occt/ packages/kernel/vitest.integration.config.ts eslint.config.js pnpm-lock.yaml
git commit -m "feat(kernel): load OCCT WASM and confine imports via eslint"
```

---

### Task 8: `SolidOps.makeBox` + `Tessellator`

First real geometry. Build a 100×200×300 box, tessellate it, assert triangle count and bounding box. This proves the end-to-end path from OCCT → transferable Float32Array.

**Files:**
- Create: `packages/kernel/src/occt/SolidOps.ts`
- Create: `packages/kernel/src/occt/Tessellator.ts`
- Create: `packages/kernel/src/occt/__tests__/SolidOps.spec.ts`
- Create: `packages/kernel/src/occt/__tests__/Tessellator.spec.ts`

- [ ] **Step 1: Write the failing box test**

`packages/kernel/src/occt/__tests__/SolidOps.spec.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { loadOcct, type OcctInstance } from '../occtLoader';
import { makeBox, computeBoundingBox, disposeShape } from '../SolidOps';

let occt: OcctInstance;
beforeAll(async () => { occt = await loadOcct(); }, 60_000);

describe('SolidOps.makeBox', () => {
  it('creates a box with exact bounding box', () => {
    const box = makeBox(occt, 100, 200, 300);
    const bb = computeBoundingBox(occt, box);
    expect(bb).toEqual([0, 0, 0, 100, 200, 300]);
    disposeShape(box);
  });

  it('deleting the box does not grow the OCCT heap meaningfully', () => {
    const before = occt.HEAPU8?.byteLength ?? 0;
    for (let i = 0; i < 50; i++) {
      const b = makeBox(occt, 10, 10, 10);
      disposeShape(b);
    }
    const after = occt.HEAPU8?.byteLength ?? 0;
    expect(after - before).toBeLessThan(16 * 1024 * 1024);
  });
});
```

- [ ] **Step 2: Run — expect fail**

```
pnpm --filter @zilventor/kernel test:integration
```

- [ ] **Step 3: Implement `SolidOps.ts`**

```ts
import type { OcctInstance } from './occtLoader';

export type OcctShape = { __brand: 'OcctShape'; handle: unknown };

export function makeBox(oc: OcctInstance, dx: number, dy: number, dz: number): OcctShape {
  const mk = new oc.BRepPrimAPI_MakeBox_2(dx, dy, dz);
  const shape = mk.Shape();
  mk.delete();
  return { __brand: 'OcctShape', handle: shape };
}

export function computeBoundingBox(oc: OcctInstance, shape: OcctShape): [number, number, number, number, number, number] {
  const bb = new oc.Bnd_Box_1();
  oc.BRepBndLib.Add(shape.handle as never, bb, false);
  const out = { xmin: 0, ymin: 0, zmin: 0, xmax: 0, ymax: 0, zmax: 0 };
  bb.Get(out as unknown as never);
  const result: [number, number, number, number, number, number] = [
    out.xmin, out.ymin, out.zmin, out.xmax, out.ymax, out.zmax
  ];
  bb.delete();
  return result;
}

export function disposeShape(shape: OcctShape): void {
  (shape.handle as { delete?: () => void }).delete?.();
}
```

*Note to implementer:* The actual OCCT API names differ across `opencascade.js` releases. Before writing the implementation, check `node_modules/opencascade.js/dist/opencascade.d.ts` to confirm constructor arities and method signatures for the pinned version. Update the code to match; the test's intent (box dimensions round-trip) should not change.

- [ ] **Step 4: Write the failing tessellator test**

`packages/kernel/src/occt/__tests__/Tessellator.spec.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { loadOcct, type OcctInstance } from '../occtLoader';
import { makeBox, disposeShape } from '../SolidOps';
import { tessellate } from '../Tessellator';

let occt: OcctInstance;
beforeAll(async () => { occt = await loadOcct(); }, 60_000);

describe('Tessellator', () => {
  it('produces triangles for a box and all are within bounds', () => {
    const box = makeBox(occt, 100, 200, 300);
    const mesh = tessellate(occt, box, { linearDeflection: 0.1 });
    expect(mesh.positions.byteLength).toBeGreaterThan(0);
    expect(mesh.indices.length % 3).toBe(0);
    expect(mesh.indices.length).toBeGreaterThanOrEqual(36); // 12 tris minimum
    for (let i = 0; i < mesh.positions.length; i += 3) {
      const x = mesh.positions[i]!, y = mesh.positions[i + 1]!, z = mesh.positions[i + 2]!;
      expect(x).toBeGreaterThanOrEqual(-1e-6);  expect(x).toBeLessThanOrEqual(100 + 1e-6);
      expect(y).toBeGreaterThanOrEqual(-1e-6);  expect(y).toBeLessThanOrEqual(200 + 1e-6);
      expect(z).toBeGreaterThanOrEqual(-1e-6);  expect(z).toBeLessThanOrEqual(300 + 1e-6);
    }
    disposeShape(box);
  });
});
```

- [ ] **Step 5: Implement `Tessellator.ts`**

```ts
import type { OcctInstance } from './occtLoader';
import type { OcctShape } from './SolidOps';
import type { Mesh } from '@zilventor/shared';
import { computeBoundingBox } from './SolidOps';

export type TessellateOptions = {
  linearDeflection: number;      // mm — smaller = finer tessellation, heavier
  angularDeflection?: number;    // radians
};

export function tessellate(oc: OcctInstance, shape: OcctShape, opts: TessellateOptions): Mesh {
  const meshTool = new oc.BRepMesh_IncrementalMesh_2(
    shape.handle as never,
    opts.linearDeflection,
    false,
    opts.angularDeflection ?? 0.5,
    false
  );
  meshTool.Perform();

  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];

  const explorer = new oc.TopExp_Explorer_2(shape.handle as never, oc.TopAbs_ShapeEnum.TopAbs_FACE as never, oc.TopAbs_ShapeEnum.TopAbs_SHAPE as never);
  while (explorer.More()) {
    const face = oc.TopoDS.Face_1(explorer.Current());
    const loc = new oc.TopLoc_Location_1();
    const triangulation = oc.BRep_Tool.Triangulation(face, loc);

    if (triangulation.IsNull() === false) {
      const t = triangulation.get();
      const nbNodes = t.NbNodes();
      const nbTris = t.NbTriangles();
      const baseIndex = positions.length / 3;

      for (let i = 1; i <= nbNodes; i++) {
        const p = t.Node(i);
        positions.push(p.X(), p.Y(), p.Z());
        normals.push(0, 0, 1); // placeholder; compute from triangle normals in a refinement pass
      }
      for (let i = 1; i <= nbTris; i++) {
        const tri = t.Triangle(i);
        const n = { a: 0, b: 0, c: 0 };
        tri.Get(n as unknown as never);
        indices.push(baseIndex + n.a - 1, baseIndex + n.b - 1, baseIndex + n.c - 1);
      }
    }

    loc.delete();
    explorer.Next();
  }
  explorer.delete();
  meshTool.delete();

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    indices: new Uint32Array(indices),
    boundingBox: computeBoundingBox(oc, shape)
  };
}
```

*Note to implementer:* Surface-normal computation from triangle vertices is a refinement step; the placeholder above ships a working mesh the viewport can render flat-shaded. Add proper per-vertex normals when you wire lighting in Task 16.

- [ ] **Step 6: Run tests — expect pass**

```
pnpm --filter @zilventor/kernel test:integration
```

- [ ] **Step 7: Commit**

```
git add packages/kernel/src/occt/
git commit -m "feat(kernel): add SolidOps.makeBox and Tessellator with integration tests"
```

---

### Task 9: BRep I/O (write + read round-trip)

Serialize an OCCT solid to BREP text bytes, read it back, and verify volume/bounding box are preserved. Used by save/load.

**Files:**
- Create: `packages/kernel/src/occt/BRepIO.ts`
- Create: `packages/kernel/src/occt/__tests__/BRepIO.spec.ts`
- Create: `tests/integration/fixtures/` (empty directory; a placeholder README)

- [ ] **Step 1: Write the failing round-trip test**

`packages/kernel/src/occt/__tests__/BRepIO.spec.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { loadOcct, type OcctInstance } from '../occtLoader';
import { makeBox, computeBoundingBox, disposeShape } from '../SolidOps';
import { writeBRep, readBRep } from '../BRepIO';

let occt: OcctInstance;
beforeAll(async () => { occt = await loadOcct(); }, 60_000);

describe('BRepIO', () => {
  it('round-trips a box through BREP text', () => {
    const original = makeBox(occt, 100, 200, 300);
    const bytes = writeBRep(occt, original);
    expect(bytes.byteLength).toBeGreaterThan(0);

    const restored = readBRep(occt, bytes);
    expect(computeBoundingBox(occt, restored)).toEqual([0, 0, 0, 100, 200, 300]);

    disposeShape(original);
    disposeShape(restored);
  });
});
```

- [ ] **Step 2: Run — expect fail**

```
pnpm --filter @zilventor/kernel test:integration
```

- [ ] **Step 3: Implement `BRepIO.ts`**

```ts
import type { OcctInstance } from './occtLoader';
import type { OcctShape } from './SolidOps';

export function writeBRep(oc: OcctInstance, shape: OcctShape): Uint8Array {
  const writer = new oc.BRepTools();
  // opencascade.js exposes helpers on a virtual filesystem — write into MEMFS then read out.
  const path = `/tmp/shape-${Math.random().toString(36).slice(2)}.brep`;
  oc.BRepTools.Write_3(shape.handle as never, path);
  const bytes = oc.FS.readFile(path) as Uint8Array;
  oc.FS.unlink(path);
  writer.delete();
  return bytes;
}

export function readBRep(oc: OcctInstance, bytes: Uint8Array): OcctShape {
  const path = `/tmp/shape-in-${Math.random().toString(36).slice(2)}.brep`;
  oc.FS.writeFile(path, bytes);

  const builder = new oc.BRep_Builder();
  const shape = new oc.TopoDS_Shape();
  oc.BRepTools.Read_2(shape, path, builder);
  oc.FS.unlink(path);
  builder.delete();

  return { __brand: 'OcctShape', handle: shape };
}
```

*Note to implementer:* `opencascade.js` exposes MEMFS via `oc.FS` (Emscripten). Double-check the exact `BRepTools.Write/Read` overload signatures for the pinned version; method names end in `_2`/`_3` by overload index.

- [ ] **Step 4: Run integration tests — expect pass**

```
pnpm --filter @zilventor/kernel test:integration
```

- [ ] **Step 5: Commit**

```
git add packages/kernel/src/occt/
git commit -m "feat(kernel): add BRepTools write/read round-trip"
```

---

## Phase 4 — Kernel: domain model

### Task 10: `PartDocument` and `ParameterResolver`

The plain-TypeScript domain model. No OCCT references — this is the pure state shape.

**Files:**
- Modify: `packages/shared/src/types.ts` (fill in `PartDocument`, `Feature`, `SketchPrimitive`)
- Create: `packages/kernel/src/adapter/PartDocument.ts`
- Create: `packages/kernel/src/adapter/ParameterResolver.ts`
- Create: `packages/kernel/src/adapter/__tests__/PartDocument.spec.ts`
- Create: `packages/kernel/src/adapter/__tests__/ParameterResolver.spec.ts`

- [ ] **Step 1: Extend `packages/shared/src/types.ts`**

Replace the `never` stubs:

```ts
export type SketchPrimitive =
  | { kind: 'rectangle'; x: number; y: number; w: number; h: number }
  | { kind: 'circle'; cx: number; cy: number; r: number };

export type Feature =
  | { kind: 'sketch'; id: string; plane: 'XY' | 'XZ' | 'YZ'; primitives: SketchPrimitive[] }
  | { kind: 'extrude'; id: string; sketchRef: string; distanceParam: string; direction: 'forward' | 'symmetric' };

export type CachedGeometry = {
  brepBlobId: string;
  triangleCount: number;
  boundingBox: BoundingBox;
};

export type PartDocument = {
  id: string;
  name: string;
  units: 'mm';
  parameters: Record<string, Parameter>;
  featureTree: Feature[];
  cachedGeometry?: CachedGeometry;
};

export type AssemblyDocument = { id: string; name: string };

export type ProjectFile = {
  formatVersion: 1;
  kind: 'part' | 'assembly';
  createdAt: string;
  appVersion: string;
  document: PartDocument | AssemblyDocument;
};
```

- [ ] **Step 2: Write the failing test for `newPart`**

`packages/kernel/src/adapter/__tests__/PartDocument.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { newPart, addFeature, setParameter } from '../PartDocument';

describe('PartDocument', () => {
  it('creates an empty part with defaults', () => {
    const p = newPart('Part1');
    expect(p.name).toBe('Part1');
    expect(p.units).toBe('mm');
    expect(p.featureTree).toEqual([]);
    expect(p.id).toMatch(/[0-9a-f-]{36}/);
  });

  it('appends features in order', () => {
    let p = newPart('Part1');
    p = addFeature(p, { kind: 'sketch', id: 's1', plane: 'XY', primitives: [] });
    p = addFeature(p, { kind: 'extrude', id: 'e1', sketchRef: 's1', distanceParam: 'd1', direction: 'forward' });
    expect(p.featureTree.map((f) => f.id)).toEqual(['s1', 'e1']);
  });

  it('setParameter creates or updates by name', () => {
    let p = newPart('Part1');
    p = setParameter(p, { name: 'd1', expression: '18', value: 18, unit: 'mm' });
    expect(p.parameters.d1!.value).toBe(18);
    p = setParameter(p, { name: 'd1', expression: '36', value: 36, unit: 'mm' });
    expect(p.parameters.d1!.value).toBe(36);
  });
});
```

- [ ] **Step 3: Run — expect fail**

```
pnpm --filter @zilventor/kernel test:unit
```

- [ ] **Step 4: Implement `PartDocument.ts`**

```ts
import type { PartDocument, Feature, Parameter } from '@zilventor/shared';

export function newPart(name: string): PartDocument {
  return {
    id: crypto.randomUUID(),
    name,
    units: 'mm',
    parameters: {},
    featureTree: []
  };
}

export function addFeature(part: PartDocument, feature: Feature): PartDocument {
  return { ...part, featureTree: [...part.featureTree, feature] };
}

export function setParameter(part: PartDocument, param: Parameter): PartDocument {
  return { ...part, parameters: { ...part.parameters, [param.name]: param } };
}
```

- [ ] **Step 5: Write the failing ParameterResolver test**

`packages/kernel/src/adapter/__tests__/ParameterResolver.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { resolve } from '../ParameterResolver';

describe('ParameterResolver (MVP — numeric literals only)', () => {
  it('parses a simple positive decimal', () => {
    expect(resolve('18', 'mm')).toEqual({ ok: true, value: 18 });
  });

  it('parses a signed decimal', () => {
    expect(resolve('-0.5', 'mm')).toEqual({ ok: true, value: -0.5 });
  });

  it('returns an error for non-numeric expressions', () => {
    expect(resolve('abc', 'mm')).toEqual({ ok: false, error: expect.objectContaining({ kind: 'invalidParameter' }) });
  });

  it('returns an error for NaN', () => {
    expect(resolve('NaN', 'mm')).toEqual({ ok: false, error: expect.objectContaining({ kind: 'invalidParameter' }) });
  });
});
```

- [ ] **Step 6: Implement `ParameterResolver.ts`**

```ts
import { ok, err, type Result, type KernelError, newCorrelationId, type UnitKind } from '@zilventor/shared';

export function resolve(expression: string, _unit: UnitKind): Result<number, KernelError> {
  const trimmed = expression.trim();
  if (trimmed === '' || trimmed.toLowerCase() === 'nan') {
    return err({ kind: 'invalidParameter', message: `"${expression}" is not a number`, correlationId: newCorrelationId() });
  }
  const n = Number(trimmed);
  if (!Number.isFinite(n)) {
    return err({ kind: 'invalidParameter', message: `"${expression}" is not a number`, correlationId: newCorrelationId() });
  }
  return ok(n);
}
```

- [ ] **Step 7: Run tests — expect pass**

```
pnpm --filter @zilventor/kernel test:unit && pnpm --filter @zilventor/shared test:unit
```

- [ ] **Step 8: Commit**

```
git add packages/shared/ packages/kernel/src/adapter/
git commit -m "feat(kernel): add PartDocument + ParameterResolver (numeric literals only)"
```

---

### Task 11: `SketchFeature` with rectangle → OCCT wire

Translate a sketch primitive into an OCCT wire on the right plane.

**Files:**
- Create: `packages/kernel/src/occt/SketchOps.ts`
- Create: `packages/kernel/src/adapter/features/SketchFeature.ts`
- Create: `packages/kernel/src/adapter/features/__tests__/SketchFeature.integration.spec.ts`

- [ ] **Step 1: Write the failing test**

`packages/kernel/src/adapter/features/__tests__/SketchFeature.integration.spec.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { loadOcct, type OcctInstance } from '../../../occt/occtLoader';
import { executeSketchFeature, disposeSketchResult } from '../SketchFeature';

let occt: OcctInstance;
beforeAll(async () => { occt = await loadOcct(); }, 60_000);

describe('SketchFeature — rectangle on XY', () => {
  it('produces a closed wire with 4 edges', () => {
    const result = executeSketchFeature(occt, {
      kind: 'sketch',
      id: 's1',
      plane: 'XY',
      primitives: [{ kind: 'rectangle', x: 0, y: 0, w: 100, h: 200 }]
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.edgeCount).toBe(4);
      expect(result.value.closed).toBe(true);
      disposeSketchResult(occt, result.value);
    }
  });
});
```

- [ ] **Step 2: Run — expect fail**

```
pnpm --filter @zilventor/kernel test:integration
```

- [ ] **Step 3: Implement `SketchOps.ts`**

```ts
import type { OcctInstance } from './occtLoader';

export type WireHandle = { __brand: 'WireHandle'; wire: unknown };

export function makeRectangleWireXY(oc: OcctInstance, x: number, y: number, w: number, h: number): WireHandle {
  const p1 = new oc.gp_Pnt_3(x,     y,     0);
  const p2 = new oc.gp_Pnt_3(x + w, y,     0);
  const p3 = new oc.gp_Pnt_3(x + w, y + h, 0);
  const p4 = new oc.gp_Pnt_3(x,     y + h, 0);

  const e1 = new oc.BRepBuilderAPI_MakeEdge_3(p1, p2).Edge();
  const e2 = new oc.BRepBuilderAPI_MakeEdge_3(p2, p3).Edge();
  const e3 = new oc.BRepBuilderAPI_MakeEdge_3(p3, p4).Edge();
  const e4 = new oc.BRepBuilderAPI_MakeEdge_3(p4, p1).Edge();

  const mkWire = new oc.BRepBuilderAPI_MakeWire_1();
  mkWire.Add_1(e1); mkWire.Add_1(e2); mkWire.Add_1(e3); mkWire.Add_1(e4);
  const wire = mkWire.Wire();
  mkWire.delete();
  [p1, p2, p3, p4].forEach((p) => p.delete());

  return { __brand: 'WireHandle', wire };
}

export function disposeWire(wire: WireHandle): void {
  (wire.wire as { delete?: () => void }).delete?.();
}
```

- [ ] **Step 4: Implement `SketchFeature.ts`**

```ts
import type { OcctInstance } from '../../occt/occtLoader';
import { makeRectangleWireXY, disposeWire, type WireHandle } from '../../occt/SketchOps';
import { ok, err, type Result, type KernelError, newCorrelationId, type Feature } from '@zilventor/shared';

export type SketchResult = {
  sketchId: string;
  wire: WireHandle;
  plane: 'XY' | 'XZ' | 'YZ';
  edgeCount: number;
  closed: boolean;
};

export function executeSketchFeature(oc: OcctInstance, feature: Extract<Feature, { kind: 'sketch' }>): Result<SketchResult, KernelError> {
  if (feature.primitives.length !== 1 || feature.primitives[0]!.kind !== 'rectangle') {
    return err({
      kind: 'degenerateSketch',
      message: 'Shell MVP supports exactly one rectangle per sketch',
      correlationId: newCorrelationId(),
      featureId: feature.id
    });
  }
  if (feature.plane !== 'XY') {
    return err({
      kind: 'invalidParameter',
      message: 'Shell MVP only supports the XY sketch plane',
      correlationId: newCorrelationId(),
      featureId: feature.id
    });
  }
  const r = feature.primitives[0]!;
  const wire = makeRectangleWireXY(oc, r.x, r.y, r.w, r.h);
  return ok({ sketchId: feature.id, wire, plane: feature.plane, edgeCount: 4, closed: true });
}

export function disposeSketchResult(_oc: OcctInstance, result: SketchResult): void {
  disposeWire(result.wire);
}
```

- [ ] **Step 5: Run tests — expect pass**

```
pnpm --filter @zilventor/kernel test:integration
```

- [ ] **Step 6: Commit**

```
git add packages/kernel/src/occt/SketchOps.ts packages/kernel/src/adapter/features/SketchFeature.ts packages/kernel/src/adapter/features/__tests__/
git commit -m "feat(kernel): add SketchFeature with rectangle-on-XY"
```

---

### Task 12: `ExtrudeFeature` + `FeatureTree` executor

Extrude a wire into a solid; wire up the executor that runs a sequence of features top-to-bottom.

**Files:**
- Create: `packages/kernel/src/adapter/features/ExtrudeFeature.ts`
- Create: `packages/kernel/src/adapter/FeatureTree.ts`
- Create: `packages/kernel/src/adapter/features/__tests__/ExtrudeFeature.integration.spec.ts`
- Create: `packages/kernel/src/adapter/__tests__/FeatureTree.integration.spec.ts`

- [ ] **Step 1: Write the failing extrude test**

`packages/kernel/src/adapter/features/__tests__/ExtrudeFeature.integration.spec.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { loadOcct, type OcctInstance } from '../../../occt/occtLoader';
import { executeSketchFeature } from '../SketchFeature';
import { executeExtrudeFeature } from '../ExtrudeFeature';
import { computeBoundingBox, disposeShape } from '../../../occt/SolidOps';

let occt: OcctInstance;
beforeAll(async () => { occt = await loadOcct(); }, 60_000);

describe('ExtrudeFeature', () => {
  it('extrudes a 100x200 rect by 50 to a 100x200x50 solid', () => {
    const sketch = executeSketchFeature(occt, {
      kind: 'sketch', id: 's1', plane: 'XY', primitives: [{ kind: 'rectangle', x: 0, y: 0, w: 100, h: 200 }]
    });
    expect(sketch.ok).toBe(true);
    if (!sketch.ok) return;

    const ex = executeExtrudeFeature(occt, sketch.value, {
      kind: 'extrude', id: 'e1', sketchRef: 's1', distanceParam: 'd1', direction: 'forward'
    }, 50);
    expect(ex.ok).toBe(true);
    if (!ex.ok) return;

    expect(computeBoundingBox(occt, ex.value.solid)).toEqual([0, 0, 0, 100, 200, 50]);
    disposeShape(ex.value.solid);
  });
});
```

- [ ] **Step 2: Run — expect fail**

- [ ] **Step 3: Implement `ExtrudeFeature.ts`**

```ts
import type { OcctInstance } from '../../occt/occtLoader';
import type { SketchResult } from './SketchFeature';
import type { OcctShape } from '../../occt/SolidOps';
import { ok, err, type Result, type KernelError, newCorrelationId, type Feature } from '@zilventor/shared';

export type ExtrudeResult = { featureId: string; solid: OcctShape };

export function executeExtrudeFeature(
  oc: OcctInstance,
  sketch: SketchResult,
  feature: Extract<Feature, { kind: 'extrude' }>,
  distance: number
): Result<ExtrudeResult, KernelError> {
  if (distance <= 0) {
    return err({
      kind: 'invalidParameter',
      message: `Extrude distance must be positive, got ${distance}`,
      correlationId: newCorrelationId(),
      featureId: feature.id
    });
  }

  const face = new oc.BRepBuilderAPI_MakeFace_15(sketch.wire.wire as never, true).Face();
  const dir = new oc.gp_Vec_4(0, 0, feature.direction === 'symmetric' ? distance : distance);
  const prism = new oc.BRepPrimAPI_MakePrism_1(face, dir, false, true);
  const shape = prism.Shape();
  prism.delete();
  (face as unknown as { delete?: () => void }).delete?.();
  dir.delete();

  return ok({ featureId: feature.id, solid: { __brand: 'OcctShape', handle: shape } });
}
```

*Note to implementer:* Symmetric extrusion actually requires prism from (-d/2) to (+d/2) on the sketch plane. For MVP the shortcut is acceptable (treat symmetric same as forward); update when you ship Sub-project 3's modeling pass.

- [ ] **Step 4: Write the failing tree-executor test**

`packages/kernel/src/adapter/__tests__/FeatureTree.integration.spec.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { loadOcct, type OcctInstance } from '../../occt/occtLoader';
import { executeTree } from '../FeatureTree';

let occt: OcctInstance;
beforeAll(async () => { occt = await loadOcct(); }, 60_000);

describe('FeatureTree.executeTree', () => {
  it('runs sketch → extrude and returns the tessellated mesh', async () => {
    const part = {
      id: 'p1', name: 'Part1', units: 'mm' as const,
      parameters: { d1: { name: 'd1', expression: '50', value: 50, unit: 'mm' as const } },
      featureTree: [
        { kind: 'sketch' as const, id: 's1', plane: 'XY' as const, primitives: [{ kind: 'rectangle' as const, x: 0, y: 0, w: 100, h: 200 }] },
        { kind: 'extrude' as const, id: 'e1', sketchRef: 's1', distanceParam: 'd1', direction: 'forward' as const }
      ]
    };
    const res = await executeTree(occt, part);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mesh.boundingBox).toEqual([0, 0, 0, 100, 200, 50]);
    expect(res.value.mesh.indices.length % 3).toBe(0);
  });
});
```

- [ ] **Step 5: Implement `FeatureTree.ts`**

```ts
import type { OcctInstance } from '../occt/occtLoader';
import type { PartDocument, Mesh } from '@zilventor/shared';
import { ok, err, type Result, type KernelError, newCorrelationId } from '@zilventor/shared';
import { executeSketchFeature, disposeSketchResult, type SketchResult } from './features/SketchFeature';
import { executeExtrudeFeature } from './features/ExtrudeFeature';
import { tessellate } from '../occt/Tessellator';
import { disposeShape, type OcctShape } from '../occt/SolidOps';
import { resolve } from './ParameterResolver';

export type ExecutionResult = {
  mesh: Mesh;
  finalSolid: OcctShape;
};

export async function executeTree(oc: OcctInstance, part: PartDocument): Promise<Result<ExecutionResult, KernelError>> {
  const sketches = new Map<string, SketchResult>();
  let finalSolid: OcctShape | null = null;

  for (const feature of part.featureTree) {
    if (feature.kind === 'sketch') {
      const r = executeSketchFeature(oc, feature);
      if (!r.ok) return r;
      sketches.set(feature.id, r.value);
    } else if (feature.kind === 'extrude') {
      const sketch = sketches.get(feature.sketchRef);
      if (!sketch) {
        return err({ kind: 'featureNotFound', message: `Sketch ${feature.sketchRef} not found`, correlationId: newCorrelationId(), featureId: feature.id });
      }
      const param = part.parameters[feature.distanceParam];
      if (!param) {
        return err({ kind: 'invalidParameter', message: `Parameter ${feature.distanceParam} not found`, correlationId: newCorrelationId(), featureId: feature.id });
      }
      const resolved = resolve(param.expression, param.unit);
      if (!resolved.ok) return resolved;

      const ex = executeExtrudeFeature(oc, sketch, feature, resolved.value);
      if (!ex.ok) return ex;
      finalSolid = ex.value.solid;
    }
  }

  if (!finalSolid) {
    return err({ kind: 'degenerateSketch', message: 'Feature tree produced no solid', correlationId: newCorrelationId() });
  }

  const mesh = tessellate(oc, finalSolid, { linearDeflection: 0.1 });
  for (const s of sketches.values()) disposeSketchResult(oc, s);
  return ok({ mesh, finalSolid });
}
```

- [ ] **Step 6: Run tests — expect pass**

```
pnpm --filter @zilventor/kernel test:integration
```

- [ ] **Step 7: Commit**

```
git add packages/kernel/src/adapter/
git commit -m "feat(kernel): add ExtrudeFeature and FeatureTree.executeTree"
```

---

### Task 13: Expose kernel RPC surface (`createPart`, `addFeature`, `editParameter`, `execute`)

Wire the adapter methods onto the `KernelApi` that the Worker exposes via Comlink. Main thread will call these.

**Files:**
- Modify: `packages/kernel/src/api.ts`
- Create: `packages/kernel/src/__tests__/api.spec.ts`

- [ ] **Step 1: Write the failing end-to-end test (in-process, no worker yet)**

`packages/kernel/src/__tests__/api.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createKernelApi } from '../api';

describe('KernelApi (end-to-end, in-process)', () => {
  it('can create a part, add features, and execute the tree', async () => {
    const api = createKernelApi();
    await api.init();

    const partId = await api.createPart('Part1');
    await api.setParameter(partId, { name: 'd1', expression: '50', value: 50, unit: 'mm' });
    await api.addFeature(partId, { kind: 'sketch', id: 's1', plane: 'XY', primitives: [{ kind: 'rectangle', x: 0, y: 0, w: 100, h: 200 }] });
    await api.addFeature(partId, { kind: 'extrude', id: 'e1', sketchRef: 's1', distanceParam: 'd1', direction: 'forward' });

    const res = await api.execute(partId);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mesh.boundingBox).toEqual([0, 0, 0, 100, 200, 50]);
  }, 120_000);
});
```

- [ ] **Step 2: Run — expect fail**

- [ ] **Step 3: Extend `packages/kernel/src/api.ts`**

```ts
import type { Feature, Parameter, Mesh } from '@zilventor/shared';
import type { Result, KernelError } from '@zilventor/shared';
import { loadOcct, type OcctInstance } from './occt/occtLoader';
import { executeTree } from './adapter/FeatureTree';
import { newPart, addFeature as addFeatureToPart, setParameter as setParameterOnPart } from './adapter/PartDocument';
import type { PartDocument } from '@zilventor/shared';

export type ExecuteResult = { mesh: Mesh };

export type KernelApi = {
  init(): Promise<void>;
  ping(input: string): Promise<{ reply: 'pong'; echo: string }>;
  createPart(name: string): Promise<string>;
  addFeature(partId: string, feature: Feature): Promise<void>;
  setParameter(partId: string, param: Parameter): Promise<void>;
  execute(partId: string): Promise<Result<ExecuteResult, KernelError>>;
  getPart(partId: string): Promise<PartDocument | null>;
};

export function createKernelApi(): KernelApi {
  let occt: OcctInstance | null = null;
  const parts = new Map<string, PartDocument>();

  return {
    async init() { occt = await loadOcct(); },
    async ping(input) { return { reply: 'pong', echo: input }; },
    async createPart(name) { const p = newPart(name); parts.set(p.id, p); return p.id; },
    async addFeature(partId, feature) {
      const p = parts.get(partId); if (!p) throw new Error(`no part ${partId}`);
      parts.set(partId, addFeatureToPart(p, feature));
    },
    async setParameter(partId, param) {
      const p = parts.get(partId); if (!p) throw new Error(`no part ${partId}`);
      parts.set(partId, setParameterOnPart(p, param));
    },
    async execute(partId) {
      if (!occt) throw new Error('kernel not initialized');
      const p = parts.get(partId); if (!p) throw new Error(`no part ${partId}`);
      const r = await executeTree(occt, p);
      if (!r.ok) return r;
      return { ok: true, value: { mesh: r.value.mesh } };
    },
    async getPart(partId) { return parts.get(partId) ?? null; }
  };
}
```

- [ ] **Step 4: Run tests — expect pass**

```
pnpm --filter @zilventor/kernel test:integration
```

(Mark the api test as integration by adding `.integration` suffix or placing it under `occt/` path that the integration config already includes. If needed, adjust `vitest.integration.config.ts` include globs to also cover `src/__tests__/api.spec.ts` when it uses OCCT.)

- [ ] **Step 5: Commit**

```
git add packages/kernel/src/
git commit -m "feat(kernel): expose createPart/addFeature/setParameter/execute on KernelApi"
```

---

## Phase 5 — App shell UI

### Task 14: Vite + React + Tailwind scaffold with grid layout

Boots a PWA shell that renders nothing but an empty-but-styled window with the five regions. No state, no data yet.

**Files:**
- Create: `packages/app/package.json`
- Create: `packages/app/vite.config.ts`
- Create: `packages/app/tsconfig.json`
- Create: `packages/app/tailwind.config.ts`
- Create: `packages/app/postcss.config.js`
- Create: `packages/app/index.html`
- Create: `packages/app/src/main.tsx`
- Create: `packages/app/src/App.tsx`
- Create: `packages/app/src/styles.css`

- [ ] **Step 1: Create package manifest**

`packages/app/package.json`:

```json
{
  "name": "@zilventor/app",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "preview": "vite preview",
    "typecheck": "tsc --noEmit",
    "test:unit": "vitest run"
  },
  "dependencies": {
    "@zilventor/shared": "workspace:*",
    "@zilventor/kernel": "workspace:*",
    "react": "^18.3.0",
    "react-dom": "^18.3.0",
    "zustand": "^4.5.0",
    "comlink": "^4.4.1",
    "three": "^0.165.0"
  },
  "devDependencies": {
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "@types/three": "^0.165.0",
    "@vitejs/plugin-react": "^4.3.0",
    "autoprefixer": "^10.4.0",
    "postcss": "^8.4.0",
    "tailwindcss": "^3.4.0",
    "vite": "^5.4.0",
    "vite-plugin-pwa": "^0.20.0",
    "typescript": "^5.5.0",
    "vitest": "^2.0.0",
    "@testing-library/react": "^16.0.0",
    "jsdom": "^25.0.0"
  }
}
```

- [ ] **Step 2: Create `vite.config.ts`**

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'ZilInventor',
        short_name: 'ZilInventor',
        theme_color: '#1f1f1f',
        background_color: '#1f1f1f',
        display: 'standalone',
        icons: []
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,wasm}'],
        maximumFileSizeToCacheInBytes: 30 * 1024 * 1024
      }
    })
  ],
  worker: { format: 'es' },
  build: { target: 'es2022' }
});
```

- [ ] **Step 3: Create `tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "jsx": "react-jsx", "outDir": "dist" },
  "include": ["src/**/*", "vite.config.ts"]
}
```

- [ ] **Step 4: Tailwind + PostCSS**

`tailwind.config.ts`:

```ts
import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: { sans: ['Inter', 'system-ui', 'sans-serif'] },
      colors: {
        shell: { DEFAULT: '#1f1f1f', panel: '#252525', border: '#3a3a3a' },
        ribbon: { bg: '#1f1f1f', tab: '#252525', active: '#1f1f1f', accent: '#4f8cff' }
      }
    }
  }
} satisfies Config;
```

`postcss.config.js`:

```js
export default { plugins: { tailwindcss: {}, autoprefixer: {} } };
```

- [ ] **Step 5: `index.html`**

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>ZilInventor</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 6: `src/styles.css`**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

html, body, #root { height: 100%; margin: 0; background: #1f1f1f; color: #ddd; font-family: Inter, system-ui, sans-serif; }
```

- [ ] **Step 7: `src/main.tsx`**

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
```

- [ ] **Step 8: `src/App.tsx` — grid layout with five named regions**

```tsx
export default function App() {
  return (
    <div className="grid h-full" style={{ gridTemplateRows: 'auto auto 1fr auto', gridTemplateColumns: '220px 1fr 260px' }}>
      <header role="banner" className="col-span-3 bg-shell-panel border-b border-shell-border" id="region-appbar">
        <div className="px-3 py-1 text-sm font-semibold">ZilInventor</div>
      </header>
      <div role="navigation" aria-label="Ribbon" className="col-span-3 bg-shell-panel border-b border-shell-border" id="region-ribbon">
        <div className="px-3 py-2 text-xs text-neutral-400">Ribbon — Task 14</div>
      </div>
      <aside role="complementary" aria-label="Browser" className="bg-shell-panel border-r border-shell-border" id="region-browser">
        <div className="px-3 py-2 text-xs text-neutral-400">Browser pane — Task 15</div>
      </aside>
      <main role="main" id="region-viewport" className="bg-shell">
        <div className="p-3 text-xs text-neutral-400">Viewport — Task 16</div>
      </main>
      <aside role="complementary" aria-label="Properties" className="bg-shell-panel border-l border-shell-border" id="region-properties">
        <div className="px-3 py-2 text-xs text-neutral-400">Properties — Task 21</div>
      </aside>
      <footer role="contentinfo" className="col-span-3 bg-shell-panel border-t border-shell-border" id="region-statusbar">
        <div className="px-3 py-1 text-xs text-neutral-400">Status — Task 15</div>
      </footer>
    </div>
  );
}
```

- [ ] **Step 9: Smoke test — run dev server**

```
pnpm install
pnpm --filter @zilventor/app dev
```

Expected: opens a dev server, you can load http://localhost:5173 and see all five regions named. Stop with Ctrl-C.

- [ ] **Step 10: Write a smoke render test**

Create `packages/app/src/__tests__/App.spec.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import App from '../App';

describe('App shell', () => {
  it('renders all five regions with stable IDs', () => {
    render(<App />);
    for (const id of ['region-appbar', 'region-ribbon', 'region-browser', 'region-viewport', 'region-properties', 'region-statusbar']) {
      expect(document.getElementById(id)).toBeTruthy();
    }
    expect(screen.getByText('ZilInventor')).toBeTruthy();
  });
});
```

- [ ] **Step 11: Run the test — expect pass**

Configure Vitest to use jsdom for React tests. Add `packages/app/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: { environment: 'jsdom', globals: true }
});
```

Then:

```
pnpm --filter @zilventor/app test:unit
```

Expected: pass.

- [ ] **Step 12: Commit**

```
git add packages/app/ pnpm-lock.yaml
git commit -m "feat(app): Vite+React+Tailwind scaffold with 5-region grid layout"
```

---

### Task 15: Ribbon with seven tabs (Model + Sketch wired, others stubbed)

Fills in the Inventor-style tab strip and panels. Only Model and Sketch have live commands; Furniture/Inspect/Drawing are visibly stubbed with "coming in sub-project N" text.

**Files:**
- Create: `packages/app/src/shell/Ribbon.tsx`
- Create: `packages/app/src/shell/RibbonTab.tsx`
- Create: `packages/app/src/shell/RibbonPanel.tsx`
- Create: `packages/app/src/shell/tabs/FileTab.tsx`
- Create: `packages/app/src/shell/tabs/ModelTab.tsx`
- Create: `packages/app/src/shell/tabs/SketchTab.tsx`
- Create: `packages/app/src/shell/tabs/ViewTab.tsx`
- Create: `packages/app/src/shell/tabs/FurnitureTab.tsx`
- Create: `packages/app/src/shell/tabs/InspectTab.tsx`
- Create: `packages/app/src/shell/tabs/DrawingTab.tsx`
- Modify: `packages/app/src/App.tsx` — replace the ribbon placeholder with `<Ribbon />`
- Create: `packages/app/src/shell/__tests__/Ribbon.spec.tsx`

- [ ] **Step 1: Write the failing test**

`packages/app/src/shell/__tests__/Ribbon.spec.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import Ribbon from '../Ribbon';

describe('Ribbon', () => {
  it('shows all 7 tabs and Model is active by default', () => {
    render(<Ribbon />);
    for (const label of ['File', 'Model', 'Sketch', 'Furniture', 'Inspect', 'Drawing', 'View']) {
      expect(screen.getByRole('tab', { name: label })).toBeTruthy();
    }
    expect(screen.getByRole('tab', { name: 'Model' })).toHaveAttribute('aria-selected', 'true');
  });

  it('switching to Furniture shows the stub notice', () => {
    render(<Ribbon />);
    fireEvent.click(screen.getByRole('tab', { name: 'Furniture' }));
    expect(screen.getByText(/sub-project 5/i)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run — expect fail**

- [ ] **Step 3: `RibbonTab.tsx`**

```tsx
type Props = { label: string; selected: boolean; onSelect(): void };
export default function RibbonTab({ label, selected, onSelect }: Props) {
  return (
    <button
      role="tab"
      aria-selected={selected}
      onClick={onSelect}
      className={`px-3 py-1 text-xs border-b-2 ${selected ? 'text-white border-ribbon-accent bg-ribbon-active font-semibold' : 'text-neutral-400 border-transparent hover:text-neutral-200'}`}
    >
      {label}
    </button>
  );
}
```

- [ ] **Step 4: `RibbonPanel.tsx`**

```tsx
import type { ReactNode } from 'react';
type Props = { title: string; children: ReactNode };
export default function RibbonPanel({ title, children }: Props) {
  return (
    <div className="flex flex-col items-stretch bg-shell-panel border border-shell-border rounded px-2 py-1 gap-1 min-w-[72px]">
      <div className="flex gap-1 justify-center">{children}</div>
      <div className="text-[10px] text-neutral-500 text-center border-t border-shell-border pt-1">{title}</div>
    </div>
  );
}
```

- [ ] **Step 5: Tab stub — reusable**

Create `packages/app/src/shell/tabs/_stub.tsx`:

```tsx
export function StubTab({ subProject, what }: { subProject: number; what: string }) {
  return (
    <div className="px-3 py-4 text-xs text-neutral-500">
      {what} — coming in sub-project {subProject}.
    </div>
  );
}
```

- [ ] **Step 6: Individual tabs**

`FileTab.tsx`:

```tsx
export default function FileTab() {
  return (
    <div className="flex gap-2 px-3 py-2 text-xs text-neutral-300">
      <button className="hover:text-white">New Part</button>
      <button className="hover:text-white">Open…</button>
      <button className="hover:text-white">Save</button>
      <button className="hover:text-white">Save As…</button>
    </div>
  );
}
```

`ModelTab.tsx`:

```tsx
import RibbonPanel from '../RibbonPanel';
export default function ModelTab() {
  return (
    <div className="flex gap-2 px-3 py-2">
      <RibbonPanel title="Create"><button className="text-xs">▣ Extrude</button></RibbonPanel>
      <RibbonPanel title="Modify"><button className="text-xs text-neutral-500">◔ Fillet (SP3)</button></RibbonPanel>
    </div>
  );
}
```

`SketchTab.tsx`:

```tsx
import RibbonPanel from '../RibbonPanel';
export default function SketchTab() {
  return (
    <div className="flex gap-2 px-3 py-2">
      <RibbonPanel title="Sketch"><button className="text-xs">▱ 2D Sketch</button></RibbonPanel>
      <RibbonPanel title="Draw"><button className="text-xs">▭ Rectangle</button></RibbonPanel>
      <RibbonPanel title="Constrain"><button className="text-xs text-neutral-500">Constraints (SP2)</button></RibbonPanel>
    </div>
  );
}
```

`ViewTab.tsx`:

```tsx
export default function ViewTab() {
  return (
    <div className="flex gap-2 px-3 py-2 text-xs text-neutral-300">
      <button>Fit (F)</button>
      <button>Home</button>
    </div>
  );
}
```

`FurnitureTab.tsx`:

```tsx
import { StubTab } from './_stub';
export default function FurnitureTab() { return <StubTab subProject={5} what="Furniture plug-ins" />; }
```

`InspectTab.tsx`:

```tsx
import { StubTab } from './_stub';
export default function InspectTab() { return <StubTab subProject={3} what="Inspect tools" />; }
```

`DrawingTab.tsx`:

```tsx
import { StubTab } from './_stub';
export default function DrawingTab() { return <StubTab subProject={6} what="Drawing generation" />; }
```

- [ ] **Step 7: `Ribbon.tsx`**

```tsx
import { useState } from 'react';
import RibbonTab from './RibbonTab';
import FileTab from './tabs/FileTab';
import ModelTab from './tabs/ModelTab';
import SketchTab from './tabs/SketchTab';
import ViewTab from './tabs/ViewTab';
import FurnitureTab from './tabs/FurnitureTab';
import InspectTab from './tabs/InspectTab';
import DrawingTab from './tabs/DrawingTab';

const TABS = ['File', 'Model', 'Sketch', 'Furniture', 'Inspect', 'Drawing', 'View'] as const;
type TabName = typeof TABS[number];

const panels: Record<TabName, JSX.Element> = {
  File: <FileTab />, Model: <ModelTab />, Sketch: <SketchTab />,
  Furniture: <FurnitureTab />, Inspect: <InspectTab />, Drawing: <DrawingTab />, View: <ViewTab />
};

export default function Ribbon() {
  const [active, setActive] = useState<TabName>('Model');
  return (
    <div className="flex flex-col">
      <div role="tablist" className="flex border-b border-shell-border bg-ribbon-tab">
        {TABS.map((t) => <RibbonTab key={t} label={t} selected={t === active} onSelect={() => setActive(t)} />)}
      </div>
      <div className="bg-ribbon-bg min-h-[72px]">{panels[active]}</div>
    </div>
  );
}
```

- [ ] **Step 8: Wire into `App.tsx`**

Replace the ribbon placeholder with `<Ribbon />` import + render.

- [ ] **Step 9: Run tests + dev server**

```
pnpm --filter @zilventor/app test:unit
pnpm --filter @zilventor/app dev
```

Visually check all tabs render; Furniture/Inspect/Drawing show the stub notice.

- [ ] **Step 10: Commit**

```
git add packages/app/src/shell/ packages/app/src/App.tsx
git commit -m "feat(app): ribbon with 7 tabs; Model+Sketch live, rest stubbed for future sub-projects"
```

---

### Task 16: Browser pane + Status bar

The left tree and bottom status strip. Empty state only — data wiring happens in Task 18.

**Files:**
- Create: `packages/app/src/shell/BrowserPane.tsx`
- Create: `packages/app/src/shell/StatusBar.tsx`
- Modify: `packages/app/src/App.tsx`
- Create: `packages/app/src/shell/__tests__/BrowserPane.spec.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import BrowserPane from '../BrowserPane';

describe('BrowserPane', () => {
  it('shows the empty state when no part is loaded', () => {
    render(<BrowserPane part={null} />);
    expect(screen.getByText(/no part open/i)).toBeTruthy();
  });

  it('lists features when a part is loaded', () => {
    const part = {
      id: 'p1', name: 'Part1', units: 'mm' as const, parameters: {},
      featureTree: [
        { kind: 'sketch' as const, id: 's1', plane: 'XY' as const, primitives: [] },
        { kind: 'extrude' as const, id: 'e1', sketchRef: 's1', distanceParam: 'd1', direction: 'forward' as const }
      ]
    };
    render(<BrowserPane part={part} />);
    expect(screen.getByText('Part1')).toBeTruthy();
    expect(screen.getByText(/Sketch/i)).toBeTruthy();
    expect(screen.getByText(/Extrusion/i)).toBeTruthy();
    expect(screen.getByText(/End of Part/i)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run — expect fail**

- [ ] **Step 3: Implement `BrowserPane.tsx`**

```tsx
import type { PartDocument } from '@zilventor/shared';

type Props = { part: PartDocument | null };

export default function BrowserPane({ part }: Props) {
  if (!part) return <div className="px-3 py-2 text-xs text-neutral-500">No part open</div>;
  let sketchCount = 0, extrudeCount = 0;
  return (
    <div className="px-3 py-2 text-xs text-neutral-200">
      <div className="font-semibold mb-1">{part.name}</div>
      <ul className="space-y-0.5">
        <li className="pl-3">Origin</li>
        {part.featureTree.map((f) => {
          if (f.kind === 'sketch') return <li key={f.id} className="pl-3">▸ Sketch{++sketchCount}</li>;
          return <li key={f.id} className="pl-3">▸ Extrusion{++extrudeCount}</li>;
        })}
        <li className="pl-3 text-neutral-500">End of Part</li>
      </ul>
    </div>
  );
}
```

- [ ] **Step 4: Implement `StatusBar.tsx`**

```tsx
type Props = { message?: string; modified?: boolean; selection?: string };
export default function StatusBar({ message = 'Ready', modified = false, selection }: Props) {
  return (
    <div className="px-3 py-1 text-xs text-neutral-400 flex gap-4">
      <span>{message}</span>
      {selection && <span>{selection}</span>}
      {modified && <span className="text-yellow-400">● Modified</span>}
      <span className="ml-auto">mm</span>
    </div>
  );
}
```

- [ ] **Step 5: Wire both into `App.tsx`**

Replace the browser-pane placeholder with `<BrowserPane part={null} />` and statusbar placeholder with `<StatusBar />`.

- [ ] **Step 6: Run tests — expect pass**

- [ ] **Step 7: Commit**

```
git add packages/app/src/shell/BrowserPane.tsx packages/app/src/shell/StatusBar.tsx packages/app/src/shell/__tests__/BrowserPane.spec.tsx packages/app/src/App.tsx
git commit -m "feat(app): add BrowserPane and StatusBar shell components"
```

---

### Task 17: Viewport with three.js + ViewCube

Mount a canvas, set up an orbit camera, grid, and a stubbed viewcube. No geometry yet — just a visible empty 3D scene.

**Files:**
- Create: `packages/app/src/viewport/Viewport.tsx`
- Create: `packages/app/src/viewport/SceneManager.ts`
- Create: `packages/app/src/viewport/ViewCube.tsx`
- Modify: `packages/app/src/App.tsx`

- [ ] **Step 1: Implement `SceneManager.ts`**

```ts
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export class SceneManager {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  readonly controls: OrbitControls;
  private current: THREE.Mesh | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.scene.background = new THREE.Color(0x1a2028);

    this.camera = new THREE.PerspectiveCamera(40, 1, 0.1, 10000);
    this.camera.position.set(400, 400, 400);
    this.camera.lookAt(0, 0, 0);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.1;

    const grid = new THREE.GridHelper(500, 10, 0x444444, 0x222222);
    grid.rotateX(Math.PI / 2);
    this.scene.add(grid);

    const light = new THREE.HemisphereLight(0xffffff, 0x202020, 1.0);
    this.scene.add(light);
  }

  setSize(w: number, h: number): void {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
  }

  setMesh(positions: Float32Array, indices: Uint32Array, normals?: Float32Array): void {
    if (this.current) { this.scene.remove(this.current); this.current.geometry.dispose(); (this.current.material as THREE.Material).dispose(); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    if (normals) g.setAttribute('normal', new THREE.BufferAttribute(normals, 3)); else g.computeVertexNormals();
    g.setIndex(new THREE.BufferAttribute(indices, 1));
    const m = new THREE.MeshStandardMaterial({ color: 0xc8c8c8, flatShading: true });
    this.current = new THREE.Mesh(g, m);
    this.scene.add(this.current);
  }

  render(): void { this.controls.update(); this.renderer.render(this.scene, this.camera); }

  dispose(): void {
    this.controls.dispose();
    this.renderer.dispose();
    this.scene.traverse((o) => { if ((o as THREE.Mesh).geometry) (o as THREE.Mesh).geometry.dispose(); });
  }
}
```

- [ ] **Step 2: Implement `ViewCube.tsx` (stub — real cube in later polish)**

```tsx
export default function ViewCube() {
  return (
    <div className="absolute top-2 right-2 w-9 h-9 bg-neutral-800 border border-neutral-600 rounded text-[9px] text-neutral-300 flex items-center justify-center pointer-events-none">
      VC
    </div>
  );
}
```

- [ ] **Step 3: Implement `Viewport.tsx`**

```tsx
import { useEffect, useRef } from 'react';
import { SceneManager } from './SceneManager';
import ViewCube from './ViewCube';

export type ViewportRef = {
  setMesh(positions: Float32Array, indices: Uint32Array, normals?: Float32Array): void;
};

export default function Viewport({ onReady }: { onReady?: (api: ViewportRef) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    const sm = new SceneManager(ref.current);
    const resize = () => {
      const r = ref.current!.getBoundingClientRect();
      sm.setSize(r.width, r.height);
      sm.render();
    };
    resize();
    const ro = new ResizeObserver(resize); ro.observe(ref.current);
    let raf = 0; const loop = () => { sm.render(); raf = requestAnimationFrame(loop); }; loop();
    onReady?.({ setMesh: (p, i, n) => sm.setMesh(p, i, n) });
    return () => { cancelAnimationFrame(raf); ro.disconnect(); sm.dispose(); };
  }, [onReady]);
  return (
    <div className="relative w-full h-full">
      <canvas ref={ref} className="block w-full h-full" />
      <ViewCube />
    </div>
  );
}
```

- [ ] **Step 4: Wire into `App.tsx`**

Replace the viewport placeholder with `<Viewport />`.

- [ ] **Step 5: Smoke test — run dev server**

```
pnpm --filter @zilventor/app dev
```

Expected: see a dark 3D scene with a grid. No errors in console. ViewCube visible top-right.

- [ ] **Step 6: Commit**

```
git add packages/app/src/viewport/ packages/app/src/App.tsx
git commit -m "feat(app): three.js viewport + SceneManager + ViewCube stub"
```

---

## Phase 6 — Client connection + state

### Task 18: `KernelClient` — Comlink proxy to the Worker

Connects the main thread to the Worker-exposed `KernelApi`.

**Files:**
- Create: `packages/app/src/kernel-client/KernelClient.ts`
- Create: `packages/app/src/kernel-client/__tests__/KernelClient.spec.ts`

- [ ] **Step 1: Write the failing test (mocks the worker)**

```ts
import { describe, it, expect, vi } from 'vitest';
import { createKernelClient } from '../KernelClient';

describe('KernelClient', () => {
  it('forwards ping via the Comlink proxy', async () => {
    const fakeProxy = { ping: vi.fn().mockResolvedValue({ reply: 'pong', echo: 'x' }) };
    const client = createKernelClient(fakeProxy as never);
    await expect(client.ping('x')).resolves.toEqual({ reply: 'pong', echo: 'x' });
  });
});
```

- [ ] **Step 2: Run — expect fail**

- [ ] **Step 3: Implement `KernelClient.ts`**

```ts
import * as Comlink from 'comlink';
import type { KernelApi } from '@zilventor/kernel/src/api';

export type KernelClient = KernelApi;

export function createKernelClient(proxy: KernelApi): KernelClient {
  return proxy;
}

export async function spawnKernel(): Promise<{ client: KernelClient; terminate(): void }> {
  const worker = new Worker(new URL('../../../kernel/src/worker.ts', import.meta.url), { type: 'module' });
  const proxy = Comlink.wrap<KernelApi>(worker);
  await proxy.init();
  return { client: createKernelClient(proxy), terminate: () => worker.terminate() };
}
```

*Note to implementer:* Vite's worker import from across-package paths needs `?worker&inline=false` in some setups. If the import fails, move the `new Worker()` construction to a tiny helper inside `packages/kernel` that exports it, or use `new URL('./worker.ts', import.meta.url)` with Vite's `worker` plugin.

- [ ] **Step 4: Run tests — expect pass**

- [ ] **Step 5: Commit**

```
git add packages/app/src/kernel-client/
git commit -m "feat(app): KernelClient Comlink proxy with spawnKernel helper"
```

---

### Task 19: Zustand store + CommandBus + undo/redo

The single mutation channel for the UI. Every state change is a Command with `apply` + `revert`.

**Files:**
- Create: `packages/app/src/store/useAppStore.ts`
- Create: `packages/app/src/commands/Command.ts`
- Create: `packages/app/src/commands/CommandBus.ts`
- Create: `packages/app/src/commands/__tests__/CommandBus.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { createCommandBus } from '../CommandBus';
import type { Command } from '../Command';

describe('CommandBus', () => {
  it('applies, undoes, and redoes a counter command', async () => {
    let n = 0;
    const inc = (by: number): Command => ({
      name: 'inc', apply: async () => { n += by; }, revert: async () => { n -= by; }
    });
    const bus = createCommandBus();
    await bus.execute(inc(2));
    await bus.execute(inc(3));
    expect(n).toBe(5);
    await bus.undo(); expect(n).toBe(2);
    await bus.undo(); expect(n).toBe(0);
    await bus.redo(); expect(n).toBe(2);
  });

  it('clears redo stack on new apply', async () => {
    let n = 0;
    const inc = (by: number): Command => ({ name: 'inc', apply: async () => { n += by; }, revert: async () => { n -= by; } });
    const bus = createCommandBus();
    await bus.execute(inc(2)); await bus.undo();
    await bus.execute(inc(5));
    expect(await bus.redo()).toBe(false);
    expect(n).toBe(5);
  });
});
```

- [ ] **Step 2: Run — expect fail**

- [ ] **Step 3: Implement `Command.ts`**

```ts
export type Command = {
  readonly name: string;
  apply(): Promise<void>;
  revert(): Promise<void>;
};
```

- [ ] **Step 4: Implement `CommandBus.ts`**

```ts
import type { Command } from './Command';

export type CommandBus = {
  execute(cmd: Command): Promise<void>;
  undo(): Promise<boolean>;
  redo(): Promise<boolean>;
  canUndo(): boolean;
  canRedo(): boolean;
};

export function createCommandBus(): CommandBus {
  const undoStack: Command[] = [];
  const redoStack: Command[] = [];
  return {
    async execute(cmd) { await cmd.apply(); undoStack.push(cmd); redoStack.length = 0; },
    async undo() { const cmd = undoStack.pop(); if (!cmd) return false; await cmd.revert(); redoStack.push(cmd); return true; },
    async redo() { const cmd = redoStack.pop(); if (!cmd) return false; await cmd.apply(); undoStack.push(cmd); return true; },
    canUndo() { return undoStack.length > 0; },
    canRedo() { return redoStack.length > 0; }
  };
}
```

- [ ] **Step 5: Implement `useAppStore.ts`**

```ts
import { create } from 'zustand';
import type { PartDocument } from '@zilventor/shared';
import type { KernelClient } from '../kernel-client/KernelClient';
import type { CommandBus } from '../commands/CommandBus';
import { createCommandBus } from '../commands/CommandBus';

type State = {
  kernel: KernelClient | null;
  bus: CommandBus;
  activePart: PartDocument | null;
  kernelReady: boolean;
  statusMessage: string;
  setKernel(k: KernelClient): void;
  setActivePart(p: PartDocument | null): void;
  setStatus(msg: string): void;
};

export const useAppStore = create<State>((set) => ({
  kernel: null,
  bus: createCommandBus(),
  activePart: null,
  kernelReady: false,
  statusMessage: 'Loading…',
  setKernel: (k) => set({ kernel: k, kernelReady: true, statusMessage: 'Ready' }),
  setActivePart: (p) => set({ activePart: p }),
  setStatus: (msg) => set({ statusMessage: msg })
}));
```

- [ ] **Step 6: Run tests — expect pass**

- [ ] **Step 7: Commit**

```
git add packages/app/src/store/ packages/app/src/commands/
git commit -m "feat(app): Zustand store + CommandBus with undo/redo"
```

---

### Task 20: Four concrete Command classes

`CreatePartCommand`, `AddSketchCommand`, `AddExtrusionCommand`, `EditParameterCommand` — each with an `apply` that calls the kernel + mutates the store, and a `revert` that walks it back.

**Files:**
- Create: `packages/app/src/commands/CreatePartCommand.ts`
- Create: `packages/app/src/commands/AddSketchCommand.ts`
- Create: `packages/app/src/commands/AddExtrusionCommand.ts`
- Create: `packages/app/src/commands/EditParameterCommand.ts`
- Create: `packages/app/src/commands/__tests__/commands.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi } from 'vitest';
import { CreatePartCommand } from '../CreatePartCommand';

describe('CreatePartCommand', () => {
  it('creates a part on apply and removes it on revert', async () => {
    const kernel = {
      createPart: vi.fn().mockResolvedValue('part-1'),
      getPart: vi.fn().mockResolvedValue({ id: 'part-1', name: 'Part1', units: 'mm', parameters: {}, featureTree: [] })
    } as never;
    const store = { setActivePart: vi.fn() };
    const cmd = new CreatePartCommand({ kernel, store, name: 'Part1' });
    await cmd.apply();
    expect(kernel.createPart).toHaveBeenCalledWith('Part1');
    expect(store.setActivePart).toHaveBeenCalled();
    await cmd.revert();
    expect(store.setActivePart).toHaveBeenLastCalledWith(null);
  });
});
```

- [ ] **Step 2: Run — expect fail**

- [ ] **Step 3: Implement `CreatePartCommand.ts`**

```ts
import type { Command } from './Command';
import type { KernelClient } from '../kernel-client/KernelClient';
import type { PartDocument } from '@zilventor/shared';

type Ctx = { kernel: KernelClient; store: { setActivePart(p: PartDocument | null): void }; name: string };

export class CreatePartCommand implements Command {
  readonly name = 'CreatePart';
  private partId: string | null = null;
  private prior: PartDocument | null = null;
  constructor(private ctx: Ctx) {}
  async apply() {
    this.partId = await this.ctx.kernel.createPart(this.ctx.name);
    const p = await this.ctx.kernel.getPart(this.partId);
    this.ctx.store.setActivePart(p);
  }
  async revert() { this.ctx.store.setActivePart(this.prior); }
}
```

- [ ] **Step 4: Implement `AddSketchCommand.ts`**

```ts
import type { Command } from './Command';
import type { KernelClient } from '../kernel-client/KernelClient';
import type { PartDocument, Feature } from '@zilventor/shared';

type Ctx = { kernel: KernelClient; store: { activePart: PartDocument | null; setActivePart(p: PartDocument | null): void }; feature: Extract<Feature, { kind: 'sketch' }> };

export class AddSketchCommand implements Command {
  readonly name = 'AddSketch';
  private prior: PartDocument | null = null;
  constructor(private ctx: Ctx) {}
  async apply() {
    const part = this.ctx.store.activePart; if (!part) throw new Error('no active part');
    this.prior = part;
    await this.ctx.kernel.addFeature(part.id, this.ctx.feature);
    this.ctx.store.setActivePart(await this.ctx.kernel.getPart(part.id));
  }
  async revert() { this.ctx.store.setActivePart(this.prior); }
}
```

- [ ] **Step 5: Implement `AddExtrusionCommand.ts`**

```ts
import type { Command } from './Command';
import type { KernelClient } from '../kernel-client/KernelClient';
import type { PartDocument, Feature, Parameter } from '@zilventor/shared';

type Ctx = {
  kernel: KernelClient;
  store: { activePart: PartDocument | null; setActivePart(p: PartDocument | null): void };
  parameter: Parameter;
  feature: Extract<Feature, { kind: 'extrude' }>;
};

export class AddExtrusionCommand implements Command {
  readonly name = 'AddExtrusion';
  private prior: PartDocument | null = null;
  constructor(private ctx: Ctx) {}
  async apply() {
    const part = this.ctx.store.activePart; if (!part) throw new Error('no active part');
    this.prior = part;
    await this.ctx.kernel.setParameter(part.id, this.ctx.parameter);
    await this.ctx.kernel.addFeature(part.id, this.ctx.feature);
    this.ctx.store.setActivePart(await this.ctx.kernel.getPart(part.id));
  }
  async revert() { this.ctx.store.setActivePart(this.prior); }
}
```

- [ ] **Step 6: Implement `EditParameterCommand.ts`**

```ts
import type { Command } from './Command';
import type { KernelClient } from '../kernel-client/KernelClient';
import type { PartDocument, Parameter } from '@zilventor/shared';

type Ctx = {
  kernel: KernelClient;
  store: { activePart: PartDocument | null; setActivePart(p: PartDocument | null): void };
  parameter: Parameter;
};

export class EditParameterCommand implements Command {
  readonly name = 'EditParameter';
  private prior: Parameter | undefined;
  private partId: string | null = null;
  constructor(private ctx: Ctx) {}
  async apply() {
    const part = this.ctx.store.activePart; if (!part) throw new Error('no active part');
    this.partId = part.id;
    this.prior = part.parameters[this.ctx.parameter.name];
    await this.ctx.kernel.setParameter(part.id, this.ctx.parameter);
    this.ctx.store.setActivePart(await this.ctx.kernel.getPart(part.id));
  }
  async revert() {
    if (!this.partId || !this.prior) return;
    await this.ctx.kernel.setParameter(this.partId, this.prior);
    this.ctx.store.setActivePart(await this.ctx.kernel.getPart(this.partId));
  }
}
```

- [ ] **Step 7: Run tests — expect pass**

- [ ] **Step 8: Commit**

```
git add packages/app/src/commands/
git commit -m "feat(app): CreatePart/AddSketch/AddExtrusion/EditParameter commands"
```

---

## Phase 7 — Interactions wired end-to-end

### Task 21: Workflow 2 wired + Playwright E2E "create a box"

Hooks the ribbon buttons into commands + kernel + viewport so a real extrusion happens on click. Adds a Playwright E2E that drives the full flow.

**Files:**
- Create: `playwright.config.ts`
- Create: `tests/e2e/workflow-2-create-box.spec.ts`
- Modify: `packages/app/src/App.tsx` — bootstrap kernel + wire commands
- Create: `packages/app/src/shell/tabs/ModelTab.tsx` — replace the earlier stub with real button handlers
- Create: `packages/app/src/shell/SketchRectangleDialog.tsx` — numeric input modal
- Create: `packages/app/src/shell/ExtrudeDialog.tsx` — distance input modal

- [ ] **Step 1: Write the failing E2E**

`tests/e2e/workflow-2-create-box.spec.ts`:

```ts
import { test, expect } from '@playwright/test';

test('Workflow 2 — create a box end-to-end', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('tab', { name: 'Model' })).toBeVisible();
  await expect(page.getByText('Ready')).toBeVisible({ timeout: 60_000 });

  await page.getByRole('button', { name: 'New Part' }).click();
  await expect(page.getByText('Part1')).toBeVisible();

  await page.getByRole('tab', { name: 'Sketch' }).click();
  await page.getByRole('button', { name: '2D Sketch' }).click();
  await page.getByRole('button', { name: 'Rectangle' }).click();
  await page.getByLabel('x1').fill('0');
  await page.getByLabel('y1').fill('0');
  await page.getByLabel('x2').fill('100');
  await page.getByLabel('y2').fill('200');
  await page.getByRole('button', { name: 'OK' }).click();

  await page.getByRole('button', { name: 'Finish Sketch' }).click();

  await page.getByRole('tab', { name: 'Model' }).click();
  await page.getByRole('button', { name: 'Extrude' }).click();
  await page.getByLabel('Distance').fill('50');
  await page.getByRole('button', { name: 'OK' }).click();

  await expect(page.getByText(/Extrusion1/)).toBeVisible();
  // Scene sanity — expect non-zero triangle count, exposed via a data attribute on the viewport.
  await expect(page.locator('[data-triangle-count]')).toHaveAttribute('data-triangle-count', /[1-9]\d*/);
});
```

- [ ] **Step 2: Create `playwright.config.ts`**

```ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  webServer: { command: 'pnpm --filter @zilventor/app dev', port: 5173, reuseExistingServer: true, timeout: 120_000 },
  use: { baseURL: 'http://localhost:5173', viewport: { width: 1280, height: 800 } },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }]
});
```

Install:

```
pnpm add -D -w @playwright/test
pnpm exec playwright install chromium
```

- [ ] **Step 3: Run E2E — expect fail (UI not wired)**

```
pnpm test:e2e
```

- [ ] **Step 4: Extend `App.tsx` to bootstrap the kernel and wire dialogs**

Sketch of the wiring (full file in repo — engineer fills specifics from the imports we've already defined):

```tsx
import { useEffect, useRef, useState } from 'react';
import Ribbon from './shell/Ribbon';
import BrowserPane from './shell/BrowserPane';
import StatusBar from './shell/StatusBar';
import Viewport, { type ViewportRef } from './viewport/Viewport';
import { spawnKernel, type KernelClient } from './kernel-client/KernelClient';
import { useAppStore } from './store/useAppStore';

export default function App() {
  const [viewport, setViewport] = useState<ViewportRef | null>(null);
  const kernelRef = useRef<KernelClient | null>(null);
  const { activePart, statusMessage, setKernel, setStatus } = useAppStore();

  useEffect(() => {
    let disposed = false;
    (async () => {
      const { client } = await spawnKernel();
      if (disposed) return;
      kernelRef.current = client;
      setKernel(client);
    })();
    return () => { disposed = true; };
  }, [setKernel]);

  // Wire re-tessellation on every part change
  useEffect(() => {
    (async () => {
      if (!kernelRef.current || !activePart || !viewport) return;
      const res = await kernelRef.current.execute(activePart.id);
      if (res.ok) viewport.setMesh(res.value.mesh.positions, res.value.mesh.indices, res.value.mesh.normals);
    })();
  }, [activePart, viewport]);

  return (
    <div className="grid h-full" style={{ gridTemplateRows: 'auto auto 1fr auto', gridTemplateColumns: '220px 1fr 260px' }}>
      <header className="col-span-3 bg-shell-panel border-b border-shell-border"><div className="px-3 py-1 text-sm font-semibold">ZilInventor</div></header>
      <div className="col-span-3"><Ribbon /></div>
      <aside className="bg-shell-panel border-r border-shell-border"><BrowserPane part={activePart} /></aside>
      <main className="bg-shell"><Viewport onReady={setViewport} /></main>
      <aside className="bg-shell-panel border-l border-shell-border"><div className="p-3 text-xs text-neutral-500">Properties — Task 22</div></aside>
      <footer className="col-span-3 bg-shell-panel border-t border-shell-border"><StatusBar message={statusMessage} /></footer>
    </div>
  );
}
```

- [ ] **Step 5: Wire Model tab's "New Part" and "Extrude" buttons**

Replace `ModelTab.tsx`:

```tsx
import { useState } from 'react';
import RibbonPanel from '../RibbonPanel';
import { useAppStore } from '../../store/useAppStore';
import { CreatePartCommand } from '../../commands/CreatePartCommand';
import { AddExtrusionCommand } from '../../commands/AddExtrusionCommand';
import ExtrudeDialog from '../ExtrudeDialog';

export default function ModelTab() {
  const { kernel, bus, activePart, setActivePart } = useAppStore() as never;
  const [extrudeOpen, setExtrudeOpen] = useState(false);
  return (
    <div className="flex gap-2 px-3 py-2">
      <RibbonPanel title="Create">
        <button className="text-xs" onClick={() => bus.execute(new CreatePartCommand({ kernel, store: { setActivePart }, name: 'Part1' }))}>New Part</button>
        <button className="text-xs" onClick={() => setExtrudeOpen(true)} disabled={!activePart?.featureTree.some((f: { kind: string }) => f.kind === 'sketch')}>Extrude</button>
      </RibbonPanel>
      {extrudeOpen && <ExtrudeDialog onClose={() => setExtrudeOpen(false)} />}
    </div>
  );
}
```

- [ ] **Step 6: `ExtrudeDialog.tsx`**

```tsx
import { useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import { AddExtrusionCommand } from '../commands/AddExtrusionCommand';

export default function ExtrudeDialog({ onClose }: { onClose(): void }) {
  const { kernel, bus, activePart, setActivePart } = useAppStore() as never;
  const [distance, setDistance] = useState('18');
  const lastSketchId = activePart.featureTree.slice().reverse().find((f: { kind: string }) => f.kind === 'sketch')?.id ?? 's1';
  return (
    <div role="dialog" className="fixed inset-0 bg-black/50 flex items-center justify-center">
      <div className="bg-shell-panel border border-shell-border p-4 w-64">
        <h3 className="text-sm mb-3">Extrude</h3>
        <label className="block text-xs">Distance
          <input aria-label="Distance" className="block w-full mt-1 bg-shell text-white px-2 py-1" value={distance} onChange={(e) => setDistance(e.target.value)} />
        </label>
        <div className="flex gap-2 mt-4 justify-end">
          <button className="text-xs" onClick={onClose}>Cancel</button>
          <button className="text-xs font-semibold" onClick={async () => {
            const d = Number(distance);
            await bus.execute(new AddExtrusionCommand({
              kernel, store: { activePart, setActivePart },
              parameter: { name: 'd1', expression: String(d), value: d, unit: 'mm' },
              feature: { kind: 'extrude', id: `e${Date.now()}`, sketchRef: lastSketchId, distanceParam: 'd1', direction: 'forward' }
            }));
            onClose();
          }}>OK</button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 7: SketchTab with rectangle dialog and "Finish Sketch"**

Create `packages/app/src/shell/SketchRectangleDialog.tsx`:

```tsx
import { useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import { AddSketchCommand } from '../commands/AddSketchCommand';

export default function SketchRectangleDialog({ onClose }: { onClose(): void }) {
  const { kernel, bus, activePart, setActivePart } = useAppStore() as never;
  const [x1, setX1] = useState('0'); const [y1, setY1] = useState('0');
  const [x2, setX2] = useState('100'); const [y2, setY2] = useState('200');
  return (
    <div role="dialog" className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-shell-panel border border-shell-border p-4 w-72">
        <h3 className="text-sm mb-3">Rectangle (two corner points)</h3>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <label>x1 <input aria-label="x1" className="bg-shell text-white px-2 py-1 w-full" value={x1} onChange={(e) => setX1(e.target.value)} /></label>
          <label>y1 <input aria-label="y1" className="bg-shell text-white px-2 py-1 w-full" value={y1} onChange={(e) => setY1(e.target.value)} /></label>
          <label>x2 <input aria-label="x2" className="bg-shell text-white px-2 py-1 w-full" value={x2} onChange={(e) => setX2(e.target.value)} /></label>
          <label>y2 <input aria-label="y2" className="bg-shell text-white px-2 py-1 w-full" value={y2} onChange={(e) => setY2(e.target.value)} /></label>
        </div>
        <div className="flex gap-2 mt-4 justify-end text-xs">
          <button onClick={onClose}>Cancel</button>
          <button className="font-semibold" onClick={async () => {
            const a = { x: Number(x1), y: Number(y1) }; const b = { x: Number(x2), y: Number(y2) };
            const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
            const w = Math.abs(b.x - a.x), h = Math.abs(b.y - a.y);
            await bus.execute(new AddSketchCommand({
              kernel, store: { activePart, setActivePart },
              feature: { kind: 'sketch', id: `s${Date.now()}`, plane: 'XY', primitives: [{ kind: 'rectangle', x, y, w, h }] }
            }));
            onClose();
          }}>OK</button>
        </div>
      </div>
    </div>
  );
}
```

Replace `packages/app/src/shell/tabs/SketchTab.tsx`:

```tsx
import { useState } from 'react';
import RibbonPanel from '../RibbonPanel';
import { useAppStore } from '../../store/useAppStore';
import SketchRectangleDialog from '../SketchRectangleDialog';

export default function SketchTab() {
  const { activePart, statusMessage, setStatus } = useAppStore() as never;
  const [sketching, setSketching] = useState(false);
  const [rectOpen, setRectOpen] = useState(false);
  const canSketch = !!activePart;

  return (
    <div className="flex gap-2 px-3 py-2">
      <RibbonPanel title="Sketch">
        <button className="text-xs" disabled={!canSketch} onClick={() => { setSketching(true); setStatus('Sketch in progress'); }}>2D Sketch</button>
        {sketching && (
          <button className="text-xs" onClick={() => { setSketching(false); setStatus('Ready'); }}>Finish Sketch</button>
        )}
      </RibbonPanel>
      <RibbonPanel title="Draw">
        <button className="text-xs" disabled={!sketching} onClick={() => setRectOpen(true)}>Rectangle</button>
      </RibbonPanel>
      <RibbonPanel title="Constrain">
        <button className="text-xs text-neutral-500" disabled>Constraints (SP2)</button>
      </RibbonPanel>
      {rectOpen && <SketchRectangleDialog onClose={() => setRectOpen(false)} />}
    </div>
  );
}
```

The E2E in Step 1 drives exactly these buttons via their accessible labels.

- [ ] **Step 8: Expose triangle count on the viewport container**

In `Viewport.tsx`, add `data-triangle-count` on the wrapper div, set when `setMesh` is called:

```tsx
const [triangles, setTriangles] = useState(0);
// ...
<div data-triangle-count={triangles} className="relative w-full h-full">
```

And update the `onReady` ref to call `setTriangles(indices.length / 3)` inside `setMesh`.

- [ ] **Step 9: Run E2E — expect pass**

```
pnpm test:e2e
```

- [ ] **Step 10: Commit**

```
git add .
git commit -m "feat(app): wire Workflow 2 end-to-end with Playwright coverage"
```

---

### Task 22: Properties panel + Workflow 3 (edit parameter + undo/redo)

Adds the properties panel on the right. Clicking a feature in the browser pane fills it; editing the value dispatches `EditParameterCommand`. Keyboard shortcuts: Ctrl+Z/Y.

**Files:**
- Create: `packages/app/src/shell/PropertiesPanel.tsx`
- Create: `tests/e2e/workflow-3-edit-undo.spec.ts`
- Modify: `packages/app/src/App.tsx` — mount PropertiesPanel + keyboard handler

- [ ] **Step 1: Write the failing E2E**

```ts
import { test, expect } from '@playwright/test';

test('Workflow 3 — edit parameter and undo/redo', async ({ page }) => {
  await page.goto('/');
  // ... set up the box as in Workflow 2 (helper function)
  // Edit distance
  await page.getByText('Extrusion1').dblclick();
  const distanceInput = page.getByLabel('Distance');
  await distanceInput.fill('36');
  await distanceInput.press('Enter');

  // Status bar flips to modified
  await expect(page.getByText(/Modified/)).toBeVisible();

  // Undo
  await page.keyboard.press('Control+z');
  await expect(distanceInput).toHaveValue('18');

  // Redo
  await page.keyboard.press('Control+y');
  await expect(distanceInput).toHaveValue('36');
});
```

- [ ] **Step 2: Run — expect fail**

- [ ] **Step 3: Implement `PropertiesPanel.tsx`**

```tsx
import { useState, useEffect } from 'react';
import { useAppStore } from '../store/useAppStore';
import { EditParameterCommand } from '../commands/EditParameterCommand';

export default function PropertiesPanel() {
  const { activePart, bus, kernel, setActivePart, setStatus } = useAppStore() as never;
  const [selected, setSelected] = useState<string | null>(null);
  // Wire selection via an event bus from BrowserPane — omitted for brevity but required for double-click to work.

  const feature = activePart?.featureTree.find((f: { id: string }) => f.id === selected);
  const param = feature?.kind === 'extrude' ? activePart.parameters[feature.distanceParam] : null;

  const [draft, setDraft] = useState('');
  useEffect(() => { if (param) setDraft(param.expression); }, [param?.expression]);

  if (!feature || !param) return <div className="p-3 text-xs text-neutral-500">Select a feature</div>;

  return (
    <div className="p-3 text-xs">
      <div className="font-semibold mb-2">{feature.id}</div>
      <label className="block">Distance
        <input aria-label="Distance" className="block w-full mt-1 bg-shell text-white px-2 py-1"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={async (e) => {
            if (e.key !== 'Enter') return;
            const n = Number(draft);
            await bus.execute(new EditParameterCommand({
              kernel,
              store: { activePart, setActivePart },
              parameter: { name: param.name, expression: draft, value: n, unit: 'mm' }
            }));
            setStatus('Modified');
          }}
        />
      </label>
    </div>
  );
}
```

- [ ] **Step 4: Wire keyboard shortcuts in `App.tsx`**

```tsx
useEffect(() => {
  const onKey = async (e: KeyboardEvent) => {
    const bus = useAppStore.getState().bus;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); await bus.undo(); }
    if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) { e.preventDefault(); await bus.redo(); }
  };
  window.addEventListener('keydown', onKey);
  return () => window.removeEventListener('keydown', onKey);
}, []);
```

Mount `<PropertiesPanel />` in the right aside.

- [ ] **Step 5: Run E2E — expect pass**

- [ ] **Step 6: Commit**

```
git add .
git commit -m "feat(app): PropertiesPanel + Workflow 3 (edit + undo + redo)"
```

---

## Phase 8 — Storage

### Task 23: OPFS wrapper

Abstracts OPFS so the rest of the kernel can read/write files without worrying about sync vs async APIs or Safari quirks.

**Files:**
- Create: `packages/kernel/src/storage/Opfs.ts`
- Create: `packages/kernel/src/storage/__tests__/Opfs.spec.ts`

- [ ] **Step 1: Write the failing test (uses happy-dom / simulated OPFS)**

The OPFS API isn't available in Node. Stub it via `navigator.storage.getDirectory()` or mark this test as an integration test that runs in a real browser (Playwright). For MVP, write a contract test with a `FakeOpfs` implementation and an integration hook that runs in Playwright in Task 25.

`packages/kernel/src/storage/__tests__/Opfs.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { Opfs } from '../Opfs';

describe('Opfs (against a FakeRoot)', () => {
  it('writes and reads a blob', async () => {
    const fs = Opfs.forRoot(new FakeRoot());
    await fs.write('a/b.brep', new Uint8Array([1, 2, 3]));
    expect(await fs.read('a/b.brep')).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('listAll returns nested paths', async () => {
    const fs = Opfs.forRoot(new FakeRoot());
    await fs.write('x.json', new Uint8Array([1]));
    await fs.write('dir/y.json', new Uint8Array([2]));
    expect((await fs.listAll()).sort()).toEqual(['dir/y.json', 'x.json']);
  });
});

class FakeFile {
  constructor(public data: Uint8Array = new Uint8Array()) {}
  readonly kind = 'file' as const;
  async getFile() { const d = this.data; return { arrayBuffer: async () => d.slice().buffer }; }
  async createWritable() {
    const chunks: Uint8Array[] = [];
    return {
      write: async (c: Uint8Array) => { chunks.push(c); },
      close: async () => {
        const total = chunks.reduce((n, c) => n + c.byteLength, 0);
        const flat = new Uint8Array(total);
        let off = 0; for (const c of chunks) { flat.set(c, off); off += c.byteLength; }
        this.data = flat;
      }
    };
  }
}

class FakeRoot {
  readonly kind = 'directory' as const;
  readonly entries = new Map<string, FakeFile | FakeRoot>();
  async getDirectoryHandle(name: string, opts?: { create?: boolean }) {
    let entry = this.entries.get(name);
    if (!entry) {
      if (!opts?.create) throw new Error(`no dir ${name}`);
      entry = new FakeRoot(); this.entries.set(name, entry);
    }
    if (entry.kind !== 'directory') throw new Error(`${name} is a file`);
    return entry;
  }
  async getFileHandle(name: string, opts?: { create?: boolean }) {
    let entry = this.entries.get(name);
    if (!entry) {
      if (!opts?.create) throw new Error(`no file ${name}`);
      entry = new FakeFile(); this.entries.set(name, entry);
    }
    if (entry.kind !== 'file') throw new Error(`${name} is a directory`);
    return entry;
  }
  async *[Symbol.asyncIterator]() {
    for (const [name, h] of this.entries) yield [name, h] as const;
  }
}
```

- [ ] **Step 2: Run — expect fail**

- [ ] **Step 3: Implement `Opfs.ts`**

```ts
export type OpfsRoot = FileSystemDirectoryHandle;

export class Opfs {
  private constructor(private root: OpfsRoot) {}
  static async forNavigator(): Promise<Opfs> {
    const root = await navigator.storage.getDirectory();
    return new Opfs(root);
  }
  static forRoot(root: OpfsRoot): Opfs { return new Opfs(root); }

  private async handle(path: string, create: boolean): Promise<{ dir: FileSystemDirectoryHandle; name: string }> {
    const parts = path.split('/');
    let dir: FileSystemDirectoryHandle = this.root;
    for (let i = 0; i < parts.length - 1; i++) {
      dir = await dir.getDirectoryHandle(parts[i]!, { create });
    }
    return { dir, name: parts[parts.length - 1]! };
  }

  async write(path: string, data: Uint8Array): Promise<void> {
    const { dir, name } = await this.handle(path, true);
    const file = await dir.getFileHandle(name, { create: true });
    const w = await file.createWritable();
    await w.write(data); await w.close();
  }

  async read(path: string): Promise<Uint8Array> {
    const { dir, name } = await this.handle(path, false);
    const file = await dir.getFileHandle(name);
    return new Uint8Array(await (await file.getFile()).arrayBuffer());
  }

  async listAll(prefix = ''): Promise<string[]> {
    const out: string[] = [];
    const walk = async (dir: FileSystemDirectoryHandle, pfx: string) => {
      for await (const [name, h] of (dir as unknown as AsyncIterable<[string, FileSystemHandle]>)) {
        if (h.kind === 'file') out.push(pfx + name);
        else await walk(h as FileSystemDirectoryHandle, pfx + name + '/');
      }
    };
    await walk(this.root, prefix);
    return out;
  }
}
```

- [ ] **Step 4: Run tests — expect pass**

- [ ] **Step 5: Commit**

```
git add packages/kernel/src/storage/
git commit -m "feat(kernel): OPFS wrapper with path-based read/write/listAll"
```

---

### Task 24: File System Access wrapper + kernel save/load API

Expose `save(handle)` and `load(handle)` on the kernel that use the ProjectPacker and call through the storage bridge. Wire "Save As…" and "Open" in the File tab.

**Files:**
- Create: `packages/kernel/src/storage/FileSystemAccess.ts`
- Modify: `packages/kernel/src/api.ts` — add `save`, `load`, `saveToOpfs`, `loadFromOpfs`
- Modify: `packages/app/src/shell/tabs/FileTab.tsx`

- [ ] **Step 1: Implement `FileSystemAccess.ts`**

```ts
export async function writeToHandle(handle: FileSystemFileHandle, data: Uint8Array): Promise<void> {
  const w = await handle.createWritable();
  await w.write(data); await w.close();
}
export async function readFromHandle(handle: FileSystemFileHandle): Promise<Uint8Array> {
  return new Uint8Array(await (await handle.getFile()).arrayBuffer());
}
```

- [ ] **Step 2: Extend `api.ts`**

Add to `KernelApi`:

```ts
save(partId: string, handle: FileSystemFileHandle): Promise<void>;
load(handle: FileSystemFileHandle): Promise<string>; // returns partId
```

Implement in `createKernelApi`:

```ts
async save(partId, handle) {
  if (!occt) throw new Error('kernel not initialized');
  const part = parts.get(partId); if (!part) throw new Error(`no part ${partId}`);
  // run tree to produce cached BREP
  const r = await executeTree(occt, part);
  if (!r.ok) throw new Error(`execute failed: ${r.error.message}`);
  const brep = writeBRep(occt, r.value.finalSolid);
  const manifest = {
    formatVersion: 1, kind: 'part', createdAt: new Date().toISOString(), appVersion: '0.0.0',
    document: { ...part, cachedGeometry: { brepBlobId: 'main', triangleCount: r.value.mesh.indices.length / 3, boundingBox: r.value.mesh.boundingBox } }
  };
  const archive = await packProject({ manifest, blobs: { main: brep } });
  await writeToHandle(handle, archive);
},
async load(handle) {
  if (!occt) throw new Error('kernel not initialized');
  const bytes = await readFromHandle(handle);
  const { manifest, blobs } = await unpackProject(bytes);
  migrateManifest(manifest as AnyManifest);
  const part = (manifest as { document: PartDocument }).document;
  parts.set(part.id, part);
  // optionally pre-load BREP cache — for MVP, re-execute on first execute() call.
  return part.id;
}
```

(Imports: `writeBRep`, `packProject`, `unpackProject`, `migrateManifest`, `writeToHandle`, `readFromHandle`.)

- [ ] **Step 3: Wire `FileTab.tsx` with error-dialog handling**

```tsx
import { useState } from 'react';
import { useAppStore } from '../../store/useAppStore';

export default function FileTab() {
  const { kernel, activePart, setActivePart, setStatus } = useAppStore() as never;
  const [errorDialog, setErrorDialog] = useState<string | null>(null);
  return (
    <div className="flex gap-2 px-3 py-2 text-xs text-neutral-300">
      <button disabled={!activePart} onClick={async () => {
        try {
          const handle = await (window as { showSaveFilePicker: (o: object) => Promise<FileSystemFileHandle> }).showSaveFilePicker({
            suggestedName: `${activePart.name}.zipt`,
            types: [{ description: 'ZilInventor part', accept: { 'application/zilinventor-part': ['.zipt'] } }]
          });
          await kernel.save(activePart.id, handle);
          setStatus(`Saved at ${new Date().toLocaleTimeString()}`);
        } catch (e) {
          if ((e as Error).name === 'AbortError') return;
          setErrorDialog(`Save failed: ${(e as Error).message}`);
        }
      }}>Save As…</button>
      <button onClick={async () => {
        try {
          const [handle] = await (window as { showOpenFilePicker: (o: object) => Promise<FileSystemFileHandle[]> }).showOpenFilePicker({
            types: [{ description: 'ZilInventor part', accept: { 'application/zilinventor-part': ['.zipt'] } }]
          });
          const partId = await kernel.load(handle);
          setActivePart(await kernel.getPart(partId));
          setStatus('Opened');
        } catch (e) {
          if ((e as Error).name === 'AbortError') return;
          const msg = (e as Error).message;
          if (/newer/i.test(msg)) setErrorDialog('This file was saved by a newer ZilInventor. Update to open.');
          else if (/gzip|corrupt/i.test(msg)) setErrorDialog("Can't open this file — it may be corrupted.");
          else setErrorDialog(`Open failed: ${msg}`);
        }
      }}>Open…</button>
      {errorDialog && (
        <div role="alertdialog" className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-shell-panel border border-shell-border p-4 w-80">
            <div className="text-sm mb-3">{errorDialog}</div>
            <div className="flex justify-end"><button onClick={() => setErrorDialog(null)}>OK</button></div>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Unit-test save round-trip with a fake FileSystemFileHandle**

Create `packages/kernel/src/__tests__/save-roundtrip.integration.spec.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { createKernelApi } from '../api';

class FakeHandle {
  bytes = new Uint8Array();
  async createWritable() { return { write: async (b: Uint8Array) => { this.bytes = b; }, close: async () => {} }; }
  async getFile() { return { arrayBuffer: async () => this.bytes.buffer }; }
}

let api: ReturnType<typeof createKernelApi>;
beforeAll(async () => { api = createKernelApi(); await api.init(); }, 60_000);

describe('Save/Load round-trip', () => {
  it('preserves feature tree and geometry', async () => {
    const id = await api.createPart('Part1');
    await api.setParameter(id, { name: 'd1', expression: '50', value: 50, unit: 'mm' });
    await api.addFeature(id, { kind: 'sketch', id: 's1', plane: 'XY', primitives: [{ kind: 'rectangle', x: 0, y: 0, w: 100, h: 200 }] });
    await api.addFeature(id, { kind: 'extrude', id: 'e1', sketchRef: 's1', distanceParam: 'd1', direction: 'forward' });

    const h = new FakeHandle();
    await api.save(id, h as unknown as FileSystemFileHandle);

    const api2 = createKernelApi(); await api2.init();
    const id2 = await api2.load(h as unknown as FileSystemFileHandle);
    const part = await api2.getPart(id2);
    expect(part?.featureTree.length).toBe(2);

    const r = await api2.execute(id2);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.mesh.boundingBox).toEqual([0, 0, 0, 100, 200, 50]);
  }, 120_000);
});
```

- [ ] **Step 5: Run tests**

```
pnpm --filter @zilventor/kernel test:integration
```

- [ ] **Step 6: Commit**

```
git add packages/kernel/ packages/app/
git commit -m "feat: .zipt save/load via File System Access end-to-end"
```

---

### Task 25: Workflow 4 Playwright — save + reopen

End-to-end: open the app, create a box, save to a temp path via Playwright's `showSaveFilePicker` interception, close and reopen, load, verify geometry.

**Files:**
- Create: `tests/e2e/workflow-4-save-reopen.spec.ts`

- [ ] **Step 1: Write the failing E2E**

```ts
import { test, expect } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';

test('Workflow 4 — save and reopen a box', async ({ page, context }, testInfo) => {
  await page.goto('/');
  await expect(page.getByText('Ready')).toBeVisible({ timeout: 60_000 });

  // Build a box (reuse Workflow-2 helper or repeat the clicks)
  // ...

  const savePath = path.join(testInfo.outputDir, 'Part1.zipt');
  await context.grantPermissions(['clipboard-read']);
  // Intercept showSaveFilePicker via CDP — or stub via a preload script in playwright.config.
  // See: https://playwright.dev/docs/api/class-page#page-add-init-script
  await page.evaluate((p) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).showSaveFilePicker = async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (window as any).__fakeHandle = {
        async createWritable() {
          const parts: Uint8Array[] = [];
          return { write: async (d: Uint8Array) => parts.push(d), close: async () => {
            const total = parts.reduce((n, p) => n + p.byteLength, 0);
            const flat = new Uint8Array(total);
            let off = 0; for (const p of parts) { flat.set(p, off); off += p.byteLength; }
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (window as any).__lastSaved = flat;
          } };
        }
      };
    };
  }, savePath);

  await page.getByRole('tab', { name: 'File' }).click();
  await page.getByRole('button', { name: 'Save As…' }).click();

  // Grab the saved bytes and persist to disk for reopen simulation
  const bytes = await page.evaluate<number[]>(() => Array.from((window as { __lastSaved: Uint8Array }).__lastSaved));
  fs.writeFileSync(savePath, Buffer.from(bytes));

  // Reopen by intercepting showOpenFilePicker
  await page.evaluate((bytesB64) => {
    const u8 = Uint8Array.from(atob(bytesB64), (c) => c.charCodeAt(0));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).showOpenFilePicker = async () => [{
      async getFile() { return { arrayBuffer: async () => u8.buffer }; },
      async createWritable() { return { write: async () => {}, close: async () => {} }; }
    }];
  }, Buffer.from(bytes).toString('base64'));

  await page.reload();
  await expect(page.getByText('Ready')).toBeVisible({ timeout: 60_000 });
  await page.getByRole('tab', { name: 'File' }).click();
  await page.getByRole('button', { name: 'Open…' }).click();
  await expect(page.getByText('Part1')).toBeVisible();
  await expect(page.locator('[data-triangle-count]')).toHaveAttribute('data-triangle-count', /[1-9]\d*/);
});
```

- [ ] **Step 2: Run E2E — expect pass after Task 24 wiring**

```
pnpm test:e2e
```

- [ ] **Step 3: Commit**

```
git add tests/e2e/workflow-4-save-reopen.spec.ts
git commit -m "test(e2e): add Workflow 4 save+reopen round-trip"
```

---

## Phase 9 — PWA, perf, error handling, CI

### Task 26: PWA install + thumbnail generation + offline verification

Makes the app installable, precaches the kernel WASM, generates a thumbnail on save.

**Files:**
- Create: `packages/app/src/pwa/registerSW.ts`
- Modify: `packages/app/src/main.tsx` — call `registerSW()`
- Modify: `packages/app/src/viewport/Viewport.tsx` — expose a `captureThumbnail()` method
- Modify: `packages/kernel/src/api.ts` — `save(partId, handle, thumbnail?: Uint8Array)`
- Create: `tests/e2e/pwa-offline.spec.ts`

- [ ] **Step 1: Implement `registerSW.ts`**

```ts
import { registerSW } from 'virtual:pwa-register';
export function register() {
  registerSW({
    onNeedRefresh() { /* surface in status bar in a later iteration */ },
    onOfflineReady() { /* no-op for MVP */ }
  });
}
```

Call from `main.tsx`.

- [ ] **Step 2: Thumbnail capture from Viewport**

Extend `ViewportRef` with `captureThumbnail(width: number, height: number): Promise<Uint8Array>` that renders the scene at the requested size and reads back pixels. three.js: `renderer.setSize(w, h)`, `renderer.render`, `renderer.domElement.toBlob`.

- [ ] **Step 3: Thread thumbnail into save**

Main thread: before calling `kernel.save(...)`, capture `thumbnail` via `viewport.captureThumbnail(256, 256)`. Pass it to the kernel; kernel includes it in `packProject`.

- [ ] **Step 4: Write the offline E2E**

```ts
import { test, expect } from '@playwright/test';
test('App works offline after first load', async ({ page, context }) => {
  await page.goto('/');
  await expect(page.getByText('Ready')).toBeVisible({ timeout: 60_000 });
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('tab', { name: 'Model' })).toBeVisible();
  await expect(page.getByText('Ready')).toBeVisible({ timeout: 60_000 });
});
```

- [ ] **Step 5: Run E2E — expect pass**

- [ ] **Step 6: Commit**

```
git add .
git commit -m "feat(app): PWA offline + thumbnail generation on save"
```

---

### Task 27: Error handling + perf suite + CI

Closes the loop with the error categories from §8, the perf budgets from §7, and the GitHub Actions pipeline.

**Files:**
- Modify: `packages/app/src/App.tsx` — worker heartbeat + kernel-offline UI
- Create: `tests/perf/cold-start.ts`
- Create: `tests/perf/extrude-box.ts`
- Create: `tests/perf/param-edit-loop.ts`
- Create: `tests/perf/leak.ts`
- Create: `.github/workflows/ci.yml`
- Create: `docs/superpowers/manual-tests/shell-mvp.md`

- [ ] **Step 1: Worker heartbeat**

In `KernelClient`: ping every 3 s; if two pings fail, fire an `onKernelOffline` callback. In `App.tsx`, subscribe and show a banner "Kernel stopped — click to restart" that re-spawns the worker and re-executes the current part's feature tree.

- [ ] **Step 2: Perf tests**

`tests/perf/extrude-box.ts`:

```ts
import { test, expect } from '@playwright/test';
test('Perf: extrude box on cold kernel', async ({ page }) => {
  const t0 = Date.now();
  await page.goto('/');
  await page.getByText('Ready').waitFor({ timeout: 60_000 });
  const tReady = Date.now() - t0;
  expect(tReady).toBeLessThan(5_000);

  const tExtrude0 = Date.now();
  // create part + sketch + extrude (reuse helpers)
  // ...
  const tExtrude = Date.now() - tExtrude0;
  expect(tExtrude).toBeLessThan(1_500); // budgets the full click sequence; inner-loop budget is 300 ms
  console.log(JSON.stringify({ tReady, tExtrude }));
});
```

Similarly `cold-start.ts`, `param-edit-loop.ts`, `leak.ts`. Each logs structured JSON so CI can compare against previous runs.

- [ ] **Step 3: CI pipeline**

`.github/workflows/ci.yml`:

```yaml
name: ci
on: { push: {}, pull_request: {} }
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm -r typecheck
      - run: pnpm lint
      - run: pnpm -r test:unit
      - run: pnpm -r test:integration
      - name: install playwright
        run: pnpm exec playwright install --with-deps chromium
      - run: pnpm test:e2e
      - run: pnpm -r build
  perf-nightly:
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    needs: build
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm exec playwright install --with-deps chromium
      - run: pnpm test:perf
```

- [ ] **Step 4: Manual test checklist**

`docs/superpowers/manual-tests/shell-mvp.md`:

```markdown
# Shell MVP Manual Test Checklist

Performed on the target laptop (2014–2016 Intel HD, 4–8 GB RAM, current Chrome).

Sign off below with date, laptop model, and measured metrics.

## Tests
1. [ ] First-visit install; cold start < 5 s; peak memory during startup < 600 MB
2. [ ] Workflow 2 end-to-end (create + sketch + extrude + see box); no jank, no long tasks > 50 ms
3. [ ] Workflow 3 (edit + undo + redo ×20); undo stack handles ≥ 20 ops
4. [ ] Workflow 4 (save + close + reopen); geometry and tree intact
5. [ ] Turn off Wi-Fi, reload tab; app still works
6. [ ] Lighthouse PWA score — Installable passes

## Sign-off
- Date: ____
- Laptop: ____
- Tester: ____
- Cold start (s): ____
- Peak memory (MB): ____
- Notes: ____
```

- [ ] **Step 5: Run full suite**

```
pnpm typecheck && pnpm lint && pnpm -r test:unit && pnpm -r test:integration && pnpm test:e2e && pnpm -r build
```

- [ ] **Step 6: Commit**

```
git add .github/ tests/perf/ docs/
git commit -m "chore: CI pipeline + perf suite + manual test checklist"
```

---

## Done

Shell MVP is complete when:

- All E2E workflow tests pass (Workflows 1–4 + PWA offline).
- Perf suite respects every Section 7 budget.
- Manual test checklist is signed off on the target laptop.
- All §2.2 success criteria from the spec are demonstrably true.

Next step: brainstorm Sub-project 1.5 (Inventor export macro) or Sub-project 2 (sketcher with constraints) — that is a product choice for the user at review time, not a plan decision.

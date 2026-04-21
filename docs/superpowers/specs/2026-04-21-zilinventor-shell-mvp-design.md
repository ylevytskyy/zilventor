# ZilInventor — Shell MVP Design

- **Date:** 2026-04-21
- **Status:** Draft — pending user review
- **Author:** levytskyy@gmail.com + Claude (brainstorming skill)
- **Spec scope:** Sub-project #1 of 6. Shell + minimum parametric part modeling.

---

## 1. Project overview and decomposition

### 1.1 What ZilInventor is

ZilInventor is a browser-based parametric CAD application for furniture design
and construction. Its target user is a furniture designer whose muscle memory
was built on Autodesk Inventor 2012. The product goal is to give those users a
tool that feels familiar enough to be productive on day one, runs offline in a
current Chromium browser on low-spec office hardware, and covers their actual
workflow end-to-end — parametric parts, assemblies, cut lists, and shop
drawings.

ZilInventor is **not** and will **not become** a one-to-one clone of Inventor.
It does not open `.ipt` / `.iam` / `.idw` files natively — these are built on
proprietary Autodesk technologies (ShapeManager kernel, Inventor's assembly
solver, the `.ipt` feature recorder) that are not licensable at any realistic
cost. Migration is handled via a one-time STEP export from the user's existing
Inventor installation (the "A′" migration path, Sub-project 1.5).

### 1.2 Why it is decomposed into 6 sub-projects

Rebuilding Inventor in one release is not achievable and not worth
attempting. The product is decomposed into six sub-projects, each with its own
spec → plan → implementation cycle:

| # | Sub-project | Ships |
|---|---|---|
| 1 | **Shell MVP** *(this spec)* | App skeleton, ribbon, browser pane, viewport, OCCT kernel wired up, create + extrude a rectangle, save/load |
| 1.5 | Inventor export macro (A′ migration) | An iLogic/VBA macro the user runs inside their existing Inventor 2012 to batch-export their library to STEP + JSON metadata |
| 2 | 2D sketcher with constraints | Lines, arcs, circles, splines; parallel/perpendicular/coincident/tangent/dimensional constraints via planegcs |
| 3 | 3D part modeling | Fillet, chamfer, shell, hole, revolve, sweep; full feature tree editing |
| 4 | Assemblies | Part insertion, mate/flush/angle constraints, BOM |
| 5 | Furniture plug-in layer | Parametric cabinets/panels/shelves, hardware library, edge banding, cut list, nesting |
| 6 | 2D drawing generation | Projected views, dimensions, title blocks, PDF export |

Each sub-project builds into the Shell MVP's hook points without architectural
rework.

### 1.3 Deliberate non-goals of Shell MVP

Interactive sketch drawing (numeric-input only in MVP), sketch constraints,
fillets, chamfers, shells, holes, revolves, sweeps, multi-body parts,
assemblies, drawings, cut lists, furniture plug-in commands, STEP import,
collaboration, accounts, cloud sync.

---

## 2. Requirements and success criteria

### 2.1 Product-level user requirements (locked via brainstorming)

These requirements describe the eventual ZilInventor product across all six
sub-projects. Shell MVP delivers the infrastructure for them but none of the
user-facing outputs (cut list, shop drawings) yet — those arrive in
Sub-projects 5 and 6.

- **Workflow:** 70 % configure-from-library (cabinets, panels, shelves), 30 % custom-from-scratch. Shell MVP addresses only the CAD plumbing; the library layer arrives in Sub-project 5.
- **Output:** 3D visualization, cut list, 2D shop drawings. No CNC / G-code / CAM.
- **Target hardware:** 2014–2016 Intel i3/i5 office laptop, Intel HD/UHD integrated GPU, 4–8 GB RAM, WebGL 2, current Chromium.
- **Deployment:** Pure-browser PWA. Local data via OPFS + File System Access API. Offline after first load. No server, no accounts, no cloud sync.
- **UI fidelity:** Layout-faithful to Inventor 2012 (ribbon structure, panel arrangement, command names, keyboard shortcuts, browser pane on the left, view cube in the top-right of the viewport), with modern flat styling (HiDPI-ready, dark-mode-capable).

### 2.2 Shell MVP success criteria

Shell MVP is done when **all** of these are demonstrably true on the target
laptop:

1. A designer installs the PWA from a URL, offline after first load.
2. They see the Inventor-2012-layout ribbon, browser pane, viewport with view cube, and status bar.
3. They can create a new part, draw a rectangle on XY by entering two corner points (`x₁,y₁` and `x₂,y₂`) as numeric input, extrude it, edit the extrusion distance from the properties panel, and see the viewport update.
4. They can save the part via File System Access, close the tab, reopen it later, load the part, and see the feature tree and geometry come back intact.
5. Undo/redo works across at least 20 operations without corruption.
6. Cold start to CAD-ready is under 5 seconds with a warm cache.
7. Steady-state memory for a single simple part is under 400 MB.
8. Lighthouse PWA installability score passes.

### 2.3 Ship-blocking performance budgets

See §7 (Performance).

---

## 3. Foundation choice

### 3.1 Chosen approach — OCCT-first (Approach 1)

The authoritative CAD kernel is **OpenCascade (OCCT)** via `opencascade.js`,
the WASM build used by FreeCAD and several web-CAD pioneers. The sketcher
(Sub-project 2) will use **planegcs**, FreeCAD's 2D geometric constraint
solver. Rendering is **three.js**. A second geometry representation
(e.g. Manifold for interactive booleans) is not built for Shell MVP.

### 3.2 Rejected approaches

- **Manifold-first (mesh-based).** Rejected because shop drawings, STEP
  interop, and parametric precision are first-class requirements. Manifold is
  an excellent library for the wrong problem here.
- **Hybrid OCCT + Manifold.** Rejected for Shell MVP as premature
  optimization. Reserved as an escape hatch if measurements in Shell MVP prove
  OCCT alone cannot hit the interactive budgets on target hardware.

### 3.3 Supporting stack

| Layer | Choice |
|---|---|
| Language / bundler | TypeScript + Vite |
| UI framework | React + Tailwind |
| Ribbon / panels | Custom Tailwind components |
| 3D rendering | three.js (WebGL 2) |
| CAD kernel | opencascade.js (pinned version) |
| Sketch constraints (Sub-project 2) | planegcs WASM |
| Worker IPC | Comlink |
| Storage | OPFS + File System Access API |
| PWA / offline | Vite PWA plugin + Workbox |
| Persistence format | Gzipped tar of JSON manifest + BREP blobs (`.zipt` / `.ziasm`) |
| State | Zustand + explicit command objects |
| Testing | Vitest (unit + integration), Playwright (E2E) |

---

## 4. Architecture

### 4.1 Layers and threads

Six logical layers split across two threads:

```
 Main thread (UI)                        Web Worker (kernel)
 ┌──────────────────────────────┐        ┌──────────────────────────────┐
 │ 1. UI shell                  │        │ 3. Kernel adapter (TS)       │
 │    React + Tailwind          │        │    PartDocument              │
 │    Ribbon · Browser pane     │        │    FeatureTree               │
 │    Viewport host · Status    │◄──────►│    ParameterResolver         │
 │    Properties · ViewCube     │Comlink │    Tessellator               │
 └──────────────────────────────┘ RPC    ├──────────────────────────────┤
 ┌──────────────────────────────┐        │ 4. OCCT WASM                 │
 │ 2. App state & command bus   │        │    opencascade.js            │
 │    Zustand · Commands        │        │    B-rep solids, booleans,   │
 │    Undo/redo · Selection     │        │    BRepTools I/O             │
 └──────────────────────────────┘        ├──────────────────────────────┤
 ┌──────────────────────────────┐        │ 6. Storage bridge            │
 │ 5. Viewport renderer         │        │    OPFS sync writer/reader   │
 │    three.js scene            │        │    File System Access        │
 │    Orbit camera · Picking    │        │    ProjectPacker             │
 └──────────────────────────────┘        └──────────────────────────────┘
                                                        │
                                                        ▼
                                         .zipt file (gzipped tar on disk)
```

### 4.2 Design rules baked into the architecture

1. **OCCT is never imported on the main thread.** Any module that touches
   OCCT lives in the Worker. Enforced via `tsconfig` path restrictions + an
   ESLint rule forbidding `opencascade.js` imports outside `packages/kernel/src/occt/`.
2. **Kernel adapter is the only layer that knows OCCT exists.** Everything
   above it talks to plain-TypeScript domain types (`Part`, `Feature`,
   `Sketch`, `Parameter`). Swapping kernels (or adding a Manifold preview
   path later) touches one directory.
3. **Geometric results cross the worker boundary as transferable `Float32Array`s,**
   never as OCCT handles. Handles stay in the Worker; the main thread never
   holds OCCT objects.
4. **The command bus is the only way the UI mutates state.** Every mutation
   is a Command with `apply` + `revert`. Undo/redo, deterministic replay, and
   atomicity are all downstream of this rule.
5. **The Worker is stateful, but stateless to the UI.** The Worker holds
   OCCT objects and mesh caches; the UI keeps only the serializable domain
   state. Restarting the Worker must be recoverable purely from domain state.

### 4.3 Data flow (two examples)

**On parameter edit:**

```
UI properties panel
  → EditParameterCommand pushed to undo stack
  → command.apply() updates app store
  → KernelClient.editParameter() over Comlink
  → Kernel adapter updates parameter, re-executes from first affected feature
  → OCCT produces new shape
  → Tessellator extracts transferable Float32Array
  → Main thread wraps buffer in three.js BufferGeometry
  → Scene update
```

**On save:**

```
UI "Save" command
  → KernelClient.save(fileHandle) over Comlink
  → Kernel adapter calls BRepTools::Write on cached solid
  → ProjectPacker builds tar(manifest.json + blobs/<id>.brep + thumbnail.png)
  → pako gzip → FileSystemWritableFileStream.write
  → Status bar updates, document marked clean
```

### 4.4 Primary workflows

Four end-to-end flows that Shell MVP must support. Referenced from §9 (Testing).

**Workflow 1 — Cold app startup.**

1. User hits the PWA URL (or launches the installed PWA).
2. Service Worker serves cached `index.html` and JS bundles; no network needed after first install.
3. React shell paints immediately — ribbon, browser pane, viewport placeholder all visible in under 200 ms.
4. In parallel, `KernelClient` spawns the kernel Worker and calls `kernel.init()`. The Worker lazy-loads `opencascade.wasm` from cache and initializes the OCCT runtime.
5. Status bar shows "Loading CAD kernel…" with a progress indicator while step 4 runs; ribbon geometry commands are disabled.
6. Kernel signals ready → status bar flips to "Ready" → ribbon geometry commands enable. Target: under 5 s total with warm cache on the target laptop.

**Workflow 2 — Create a box (the MVP happy path).**

1. User clicks **Model tab → New Part** on the ribbon.
2. `CreatePartCommand` runs: app store creates an empty `PartDocument` with a UUID, default name "Part1", units mm, empty `parameters` and `featureTree`. Browser pane shows the new part root.
3. User clicks **Sketch tab → 2D Sketch** and selects the XY plane from the browser pane's Origin node.
4. `AddSketchCommand` appends a `SketchFeature` to the tree. Viewport enters sketch mode (orthographic view normal to XY). Ribbon switches to "Sketch in progress" context.
5. User clicks **Rectangle** and enters two corner points as numeric input: `x₁, y₁` and `x₂, y₂`. Interactive drag-to-draw is Sub-project 2.
6. Command bus calls `kernel.addPrimitive(sketchId, { kind: "rectangle", ... })`. Kernel adapter updates `SketchFeature.primitives`.
7. User clicks **Finish Sketch**. Viewport returns to 3D.
8. User clicks **Extrude**. Properties panel on the right shows `Distance: 18 mm` and `Direction: Symmetric`. User clicks OK.
9. `AddExtrusionCommand` appends an `ExtrudeFeature` referencing the sketch. Kernel adapter executes the feature tree: sketch → `TopoDS_Wire`, extrude → `BRepPrimAPI_MakePrism` → `TopoDS_Solid`.
10. Tessellator runs `BRepMesh_IncrementalMesh`, extracts triangles into a transferable `Float32Array`, posts back to main thread.
11. Viewport wraps the buffer in a three.js `BufferGeometry` and adds it to the scene. Target: under 300 ms for the box.
12. Browser pane updates to `Origin · Sketch1 · Extrusion1 · End of Part` (Inventor-style tree).

**Workflow 3 — Edit extrusion distance.**

1. User double-clicks **Extrusion1** in the browser pane.
2. Properties panel repopulates with current values.
3. User types `36` and presses Enter.
4. `EditParameterCommand` is pushed onto the undo stack before execution, then runs: parameter value is updated in the app store, kernel receives the update.
5. Kernel adapter re-executes the feature tree **from Extrusion1 onward only** (Sketch1's cache is reused). New solid, new tessellation, new mesh buffer.
6. Viewport updates. Browser pane flashes the changed feature briefly. Status bar: "Modified".
7. User presses **Ctrl+Z**: command bus pops the last `EditParameterCommand`, restores the prior parameter value, re-runs the kernel from Extrusion1 onward. Redo is the mirror.

**Workflow 4 — Save and reopen.**

1. User presses **Ctrl+S**. First save: File System Access prompt asks where to put `Part1.zipt`. Subsequent saves reuse the file handle, no prompt.
2. Main thread calls `kernel.save(fileHandle)` via Comlink.
3. Kernel calls `BRepTools::Write` on the cached solid → BREP bytes. Manifest JSON gets `cachedGeometry.brepBlobId` set.
4. `ProjectPacker` builds the tar (manifest.json + blobs/<id>.brep + thumbnail.png), pipes through pako gzip, writes via the transferred `FileSystemWritableFileStream`.
5. Status bar: "Saved at HH:MM". Tab title loses its dirty-dot.
6. Later, user reopens the PWA, clicks **File → Open**, picks `Part1.zipt`.
7. Storage bridge unpacks → manifest deserialized → `PartDocument` reconstructed. `cachedGeometry.brepBlobId` present, so the kernel calls `BRepTools::Read` and skips re-execution.
8. Tessellate → mesh to main thread → viewport shows the box. Designer is where they left off.

---

## 5. Module structure

```
zilventor/
├── pnpm-workspace.yaml
├── package.json
├── tsconfig.base.json
├── vite.config.ts
├── docs/superpowers/specs/2026-04-21-zilinventor-shell-mvp-design.md
│
├── packages/
│   ├── app/                           # the PWA (main thread)
│   │   ├── index.html
│   │   └── src/
│   │       ├── main.tsx
│   │       ├── shell/                 # ribbon, browser pane, status bar, layout
│   │       │   ├── Ribbon.tsx
│   │       │   ├── RibbonTab.tsx
│   │       │   ├── BrowserPane.tsx
│   │       │   ├── StatusBar.tsx
│   │       │   └── tabs/
│   │       │       ├── FileTab.tsx
│   │       │       ├── ModelTab.tsx
│   │       │       ├── SketchTab.tsx
│   │       │       ├── FurnitureTab.tsx    # stubbed — Sub-project 5
│   │       │       ├── InspectTab.tsx      # stubbed — Sub-project 3
│   │       │       ├── DrawingTab.tsx      # stubbed — Sub-project 6
│   │       │       └── ViewTab.tsx
│   │       ├── viewport/
│   │       ├── properties/
│   │       ├── commands/
│   │       │   ├── CommandBus.ts
│   │       │   ├── CreatePartCommand.ts
│   │       │   ├── AddSketchCommand.ts
│   │       │   ├── AddExtrusionCommand.ts
│   │       │   └── EditParameterCommand.ts
│   │       ├── store/
│   │       ├── kernel-client/
│   │       │   └── KernelClient.ts
│   │       └── pwa/
│   │
│   ├── kernel/                        # runs in a Web Worker
│   │   └── src/
│   │       ├── worker.ts              # Comlink.expose entry point
│   │       ├── adapter/
│   │       │   ├── PartDocument.ts
│   │       │   ├── FeatureTree.ts
│   │       │   ├── ParameterResolver.ts
│   │       │   └── features/
│   │       │       ├── SketchFeature.ts
│   │       │       └── ExtrudeFeature.ts
│   │       ├── occt/                  # only layer importing opencascade.js
│   │       │   ├── occtLoader.ts
│   │       │   ├── SolidOps.ts
│   │       │   ├── SketchOps.ts
│   │       │   └── Tessellator.ts
│   │       └── storage/
│   │           ├── Opfs.ts
│   │           ├── ProjectPacker.ts
│   │           └── FileSystemAccess.ts
│   │
│   ├── shared/                        # types both sides need
│   │   └── src/
│   │       ├── types.ts
│   │       ├── fileFormat.ts
│   │       └── errors.ts
│   │
│   └── icons/                         # Inventor-style icon SVG sprite
│
└── tests/
    ├── unit/
    ├── integration/
    ├── e2e/
    └── perf/
```

**Hook points for future sub-projects:**

- `packages/kernel/src/adapter/features/` — Sub-project 2 adds `ConstraintSolver.ts`; Sub-project 3 adds `FilletFeature.ts`, `HoleFeature.ts`, etc.
- `PartDocument.ts` defines a `Part | Assembly` tagged union from day one; Sub-project 4 fills in the `Assembly` branch.
- `ProjectPacker.ts` handles both `.zipt` and `.ziasm` containers from day one; `.ziasm` throws "not implemented" until Sub-project 4.
- `FurnitureTab.tsx` is present, disabled, wired to an empty plug-in registry.

---

## 6. Data model and file format

### 6.1 Core types (`packages/shared/src/types.ts`)

```ts
type ProjectFile = {
  formatVersion: 1;
  kind: "part" | "assembly";
  createdAt: string;              // ISO-8601
  appVersion: string;
  document: PartDocument | AssemblyDocument;
};

type PartDocument = {
  id: string;                     // stable UUID
  name: string;
  units: "mm";                    // mm only in MVP
  parameters: Record<string, Parameter>;
  featureTree: Feature[];         // ordered, executed top-to-bottom
  cachedGeometry?: {
    brepBlobId: string;
    triangleCount: number;
    boundingBox: [number, number, number, number, number, number];
  };
};

type AssemblyDocument = { id: string; name: string; /* Sub-project 4 */ };

type Parameter = {
  name: string;
  expression: string;             // plain number in MVP; full parser in Sub-project 2
  value: number;                  // resolved in mm
  unit: "mm" | "deg";
};

type Feature =
  | { kind: "sketch"; id: string; plane: "XY" | "XZ" | "YZ"; primitives: SketchPrimitive[] }
  | { kind: "extrude"; id: string; sketchRef: string; distanceParam: string; direction: "forward" | "symmetric" };

type SketchPrimitive =
  | { kind: "rectangle"; x: number; y: number; w: number; h: number }
  | { kind: "circle"; cx: number; cy: number; r: number };
```

### 6.2 File format

A `.zipt` is a gzipped tar containing:

```
some-part.zipt:
├── manifest.json          # ProjectFile JSON with cachedGeometry.brepBlobId set
├── blobs/
│   └── <brepBlobId>.brep  # BRepTools::Write output
└── thumbnail.png          # 256×256 screenshot, generated on save
```

Rationale: designer-readable with any unarchiver; ~150 LoC of packer code
(`pako` + `tar-stream`); atomic writes via File System Access; works equally
for assemblies (`.ziasm`) when Sub-project 4 arrives.

### 6.3 Execution and caching

- **On load:** if `cachedGeometry` is present and `appVersion` matches major
  version, the cached BREP is used directly. Otherwise the feature tree is
  executed top-to-bottom and the cache is rebuilt.
- **On edit:** only features from the first affected node onward are
  re-executed; the tessellator only re-extracts triangles for faces that
  actually changed.
- **On save:** cache is updated and written alongside the manifest.

### 6.4 Versioning

- `formatVersion: 1` is locked by Shell MVP's ship.
- Opening a file with a higher `formatVersion` shows a user-visible "needs newer ZilInventor" dialog; no silent partial load.
- Opening a lower version runs a migration function registered in `packages/shared/src/fileFormat.ts`.

---

## 7. Performance plan

### 7.1 Ship-blocking budgets

| Dimension | Budget | Measurement |
|---|---|---|
| WASM kernel download (gzipped) | ≤ 8 MB | Network tab on cold visit |
| Total initial JS + CSS (gzipped) | ≤ 400 KB | `vite build --report` |
| Cold start to interactive chrome | ≤ 1.5 s | Lighthouse LCP |
| Cold start to CAD-ready (warm cache) | ≤ 5.0 s | Synthetic perf test |
| Warm reload to CAD-ready | ≤ 2.0 s | Same as above |
| Single-feature extrude on test box | ≤ 300 ms | Perf test suite |
| Parameter-edit re-execute on single-feature part | ≤ 200 ms | Perf test suite |
| Viewport frame time, idle orbit | ≥ 55 fps | Chrome perf panel |
| Longest main-thread task during a gesture | ≤ 50 ms | PerformanceObserver('longtask') |
| Steady-state memory, part loaded | ≤ 400 MB | `performance.memory` + WASM heap |
| Peak memory during extrude on test box | ≤ 600 MB | Same |

A CI run that breaches any budget blocks the Shell MVP ship.

### 7.2 Memory strategy

1. OCCT initial heap 128 MB, `ALLOW_MEMORY_GROWTH` on, hard ceiling 768 MB.
   Past the ceiling, the kernel refuses new features with a user-visible
   error instead of letting the tab crash.
2. Every OCCT object goes through a `using`/dispose wrapper. ESLint rule
   forbids bare `new OCCT.*` outside wrapper helpers. Leak tests assert the
   heap does not grow more than 5 MB across 100 extrude/delete cycles.
3. One OCCT context per Worker. Multi-document is post-MVP.
4. `BufferGeometry` instances on the main thread go through a
   `DisposableScene` helper; plain `.dispose()` oversight is a known CAD
   leak.

### 7.3 Startup strategy

1. Three JS chunks: UI shell, kernel client, Worker bundle. Shell paints
   before the Worker is requested.
2. `opencascade.wasm` fetched inside the Worker only after shell paint.
3. Service Worker precaches shell + `opencascade.wasm` after first visit.
4. Ribbon icons are a preloaded SVG sprite, not a web font.

### 7.4 Interactive strategy

1. Feature-tree executor keeps per-feature input hashes; unchanged features
   reuse cached handles.
2. Tessellation is incremental at the face level.
3. All kernel calls are async; a "working…" affordance appears on the
   affected tree node after 100 ms.
4. No OCCT result leaves the Worker without being reduced to a transferable
   buffer.

### 7.5 Escape hatch

A `PreviewKernel` interface is defined alongside the real kernel adapter.
If Shell MVP measurements show OCCT alone cannot meet the interactive
budgets on target hardware, Sub-project 3 (or a short intermediate
sub-project) implements `PreviewKernel` with Manifold for interactive
booleans; OCCT runs on commit and replaces the preview. This is **not**
built for Shell MVP.

---

## 8. Error handling

### 8.1 Error categories

- **Expected user errors** — degenerate sketch, invalid parameter, newer file
  format. Typed `Result<T, KernelError>`, shown in status bar + toast +
  inline red underline on the feature.
- **Kernel exceptions** — OCCT throws, WASM traps. Worker catches, logs
  structured info, returns an opaque correlation id. Command bus rolls back
  the causing command.
- **Hard failures** — Worker crash, WASM OOM, runtime not initialized.
  Detected via `worker.onerror` + heartbeat ping. UI enters "kernel offline"
  mode: viewport freezes on last good frame, geometry commands disabled,
  "Restart kernel" button re-executes the saved feature tree.

### 8.2 Specific failures

| Failure | Detection | User-visible | Recovery |
|---|---|---|---|
| WASM download fails | Fetch error on worker init | Full-page blocker | Retry button; after 3 fails, link to docs |
| WebAssembly unsupported | Feature detect on boot | Full-page blocker | No recovery; info only |
| WebGL 2 unsupported | `getContext('webgl2')` null | Viewport shows "3D unavailable"; rest of app works | User upgrades browser |
| OCCT operation throws | try/catch around adapter call | Red flag on feature; tooltip explains | Undo restores prior state |
| Worker uncaught exception | `worker.onerror` | "Kernel stopped" banner | Restart worker + re-execute saved tree |
| WASM OOM | `RangeError` + budget check | "Assembly too large" dialog | Auto-undo; suggest splitting |
| OPFS quota exceeded | Storage API | Toast: "Storage full" | Autosave pauses until user acts |
| File System Access denied | Feature detect / permission | Fall back to download + pick-file | Transparent |
| File format newer than app | `formatVersion > current` | "Update to open" dialog | Refuse to open |
| File format older than app | `formatVersion < current` | Silent migration | First save writes new version |
| Project archive corrupt | Gzip/tar decode | "Can't open this file" dialog | Refuse to open |
| PWA update available | Service Worker `waiting` | Non-modal banner | User reloads |
| Close with unsaved changes | Dirty flag + `beforeunload` | Browser native confirm | Standard |

### 8.3 Rules the codebase enforces

1. Every Worker-side function returns `Result<T, KernelError>`. No throwing across Comlink.
2. No catch-and-swallow. Every `catch` returns a typed error or re-throws.
3. Structured logging: correlation id, feature id, operation name, OCCT error code, app version, kernel version. Rolling in-memory buffer, copyable via **Help → Copy diagnostics**. No remote telemetry in MVP.
4. Rollback = undo the last command. No partial-state patches.
5. Destructive filesystem writes go to a temp name, then rename. Partial writes never produce half-valid `.zipt` files.

### 8.4 Deferred to later sub-projects

- Crash-recovery autosave to OPFS (Sub-project 2).
- Offline telemetry buffer with opt-in sync.
- Automatic "send diagnostics to support" workflow.

---

## 9. Testing strategy

### 9.1 Test pyramid

**Unit — Vitest in Node + jsdom.** Every commit. < 10 s.
- Feature tree executor, parameter resolver, command objects, undo/redo, project packer, migration functions.
- Kernel calls mocked.
- JSON round-trip for `.zipt` manifests; migration tests per `formatVersion`.

**Integration — Vitest with real OCCT WASM.** Every commit.
- Real kernel adapter, mocked IPC.
- Geometric assertions: extrude 100×200×300, assert volume = 6 000 000 ± ε mm³, bounding box, face count.
- Golden BREP fixtures in `tests/integration/fixtures/`, diffed as text.

**E2E — Playwright against real Chromium.** Every PR.
- Workflow 2 (create + sketch + extrude box), Workflow 3 (edit + undo + redo), Workflow 4 (save + reopen).
- Browser compat: Chrome stable, Edge stable, Firefox stable. Safari best-effort only.

**Performance — pinned CI runner, nightly on main.**
- `cold-start.ts`, `extrude-box.ts`, `param-edit-loop.ts`, `leak.ts`.
- Metrics stored per-commit. +15 % regression flags.

**Visual regression — one screenshot per critical viewport state.**
- Fixed camera angle, 1 % pixel tolerance. Smoke check only; geometric assertions catch real bugs.

### 9.2 Manual test plan

Runs before Shell MVP ships. Scripted in `docs/superpowers/manual-tests/shell-mvp.md`. Performed on the actual target laptop (not a throttle-emulated build). Signed off with date + laptop model + metrics.

1. First-visit install, measure cold start.
2. Run Workflow 2 end-to-end; note any jank, long task, flicker.
3. Power off Wi-Fi, reopen — must work offline.
4. Close + reopen with an existing `.zipt` — must work offline.

### 9.3 TDD posture

Implementation follows the superpowers `test-driven-development` discipline:
every non-trivial unit lands as a failing test first. Scaffolding (React
mount, initial configs) is exempt from TDD.

### 9.4 CI topology

GitHub Actions on every PR:

1. `pnpm install` (cached)
2. `pnpm -r typecheck`
3. `pnpm -r lint`
4. `pnpm -r test:unit`
5. `pnpm -r test:integration`
6. `pnpm -r test:e2e` (required on PRs touching `packages/app/` or main branch)
7. `pnpm -r test:perf` (nightly on main; advisory on PRs unless a Section 7 budget is breached)
8. Build artifacts + size report

### 9.5 Out of scope for MVP testing

- Property-based / fuzz tests on the kernel.
- Accessibility tests (Sub-project 5).
- Load / stress tests (N/A — single-user local app).

---

## 10. What happens next

1. User reviews this spec.
2. Open issues / edits are resolved inline.
3. `superpowers:writing-plans` skill consumes this spec and produces an
   implementation plan broken into TDD-friendly tasks.
4. Implementation proceeds against that plan.
5. When Shell MVP's success criteria (§2.2) are all true, we close this
   sub-project and brainstorm Sub-project 1.5 (the Inventor export macro) or
   Sub-project 2 (the full sketcher), whichever delivers more value to the
   designers first — that's a product decision for review time.

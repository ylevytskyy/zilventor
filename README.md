# Zilventor

Zilventor is a browser-based, parametric 3D CAD application with a furniture-design and panel-manufacturing workflow. It combines a real OpenCascade (OCCT) geometry kernel with sketching, feature-based modeling, assemblies, engineering drawings, cabinet construction, drilling, cut lists, nesting, and production exports.

> **Repository status — reviewed 2026-10-21.** The latest commit currently visible on GitHub `master` is dated 2026-07-19. The latest GitHub Actions run found for that commit failed at the **Lint** step. No GitHub Release was found during this review. The recorded test counts below are historical project notes, not a fresh green CI result; do not treat this snapshot as release-certified until CI and the production smoke test pass.

## What is implemented

### CAD and engineering drawings

- Parametric 2D sketching with geometric constraints, dimensions, and expression-bound parameters.
- Feature-history solid modeling on OpenCascade.js/WASM, including extrude, revolve, sweep, holes, fillet, chamfer, shell, patterns, and mirror.
- Assemblies with nested subassemblies, component patterns, mate/flush/angle/insert/tangent constraints, BOM aggregation, and interference checks.
- 2D drawing sheets with projected, section, detail, and isometric views; dimensions, annotations, parts lists, balloons, and reusable drawing templates.
- DXF drawing import/export, plus PDF and other drawing-output formats.

### Furniture and manufacturing workflows

- Base, wall, and tall cabinets; L-corner, blind-corner, and diagonal-corner cabinet generators.
- Slab, shaker, and raised-panel doors, drawer banks, and a hardware catalogue that includes hinges, shelf pins, drawer slides, levelers, and pulls.
- System-32 shelf-pin drilling, cabinet-connection boring, editable drilling operations, parametric grooves/dados, and mortise/tenon features.
- Recursive cut lists and hardware BOMs, edge-band metadata and gross cut dimensions, guillotine nesting with kerf and oversize allowance, and interactive nest editing.
- Exports for manufacturing and nested-sheet DXF, machining/cut-list/BOM CSV, nesting PDF/PNG, shop-label PDFs with QR codes, statistics/cost reports, and production reconciliation.
- Parameter-driven part configurations, a rule engine, feature suppression, and custom hardware catalogue import.

The feature list describes code present in the repository; it does not imply that every edge case or downstream machine workflow has been independently accepted by a production shop.

## Current scope and known limitations

- **Native CNC/CAM formats:** CIX, MPR, and XNC post-processors are not implemented. DXF and associated manufacturing metadata/CSV are the current manufacturing outputs. Confirm the exported file with the target CAD/CAM or CNC workflow before production.
- **Nesting:** uses a guillotine-style packer, not an unrestricted irregular-shape nesting optimizer. Oversize allowance is currently global per job, rather than independently specified for every panel.
- **Configurations:** configuration tables are part-level; CSV import is available, but CSV export and inline cell editing are not.
- **Imported geometry:** STEP/Inventor imports are stored as opaque geometry rather than editable native feature histories. Converting to a panel has documented placement limitations.
- **External validation:** the repository documentation says manufacturing DXF has not been independently verified in a specific external CAD application, and the Production-tab camera QR scan has not been smoke-tested on a real mobile device.
- **Known UI/function gaps:** see [Known Limitations](docs-site/troubleshooting/known-limitations.md) for the current documented list, including camera-fit controls, manual carcass-boring UI, and door-handle drilling.

See also the [manufacturing capability inventory](docs/abf-plugin/05-parity/01-zilinventor-capability-inventory.md) and [ABF parity milestones](docs/superpowers/plans/2026-07-02-abf-parity-milestones.md). These are detailed engineering notes and may contain snapshots that predate later commits; validate important claims against the source code.

## Technology and architecture

- **Language/UI:** TypeScript, React 18, Vite, Three.js, and Zustand.
- **Geometry kernel:** OpenCascade.js compiled to WebAssembly (WASM), running in a Web Worker.
- **2D sketch constraints:** planegcs through a separate worker.
- **Persistence:** browser-local Origin Private File System (OPFS), with versioned document migrations.
- **PWA:** service worker and offline asset caching. The initial load needs to download the OCCT runtime; offline use depends on a successful first load and cache installation.
- **Repository:** pnpm workspace/monorepo; no application backend is required by the current client-side architecture.

## Prerequisites

- Node.js 20 or newer
- pnpm 9.x (the repository pins `pnpm@9.15.9`)

Enable Corepack if needed:

```bash
corepack enable
corepack prepare pnpm@9.15.9 --activate
```

## Quick start

Run these commands from the repository root:

```bash
# Install workspace dependencies and copy the OCCT runtime assets
pnpm install

# Start the application in development mode
pnpm --filter @zilventor/app dev
```

The application uses browser features including OPFS, workers, and WebAssembly. Use a supported secure context for realistic browser testing.

## Build

```bash
# Install the locked dependencies and build the app
pnpm install --frozen-lockfile
pnpm --filter @zilventor/app build
```

The production artifact is written to `packages/app/dist/`. Verify the OCCT runtime was copied into the output:

```bash
ls -lh packages/app/dist/occt/
# Expected: opencascade.full.js and opencascade.full.wasm
```

## Verification and tests

Root scripts are defined in `package.json`:

```bash
# TypeScript checks
pnpm typecheck

# Lint
pnpm lint

# Unit and integration tests
pnpm test:unit
pnpm test:integration

# End-to-end tests
pnpm test:e2e
pnpm test:e2e:firefox

# Test the built production artifact, including kernel initialization
pnpm test:e2e:built

# Performance tests
pnpm test:perf
```

Some suites—especially real-OCCT integration tests and browser tests—need their configured environments and can take longer than ordinary unit tests. Follow [CLAUDE.md](CLAUDE.md) for package-specific verification guidance and known test-runner pitfalls.

**Last recorded baseline (project notes, 2026-07-19; not rerun for this README update):** app 3,942 tests, shared 1,633 tests, kernel 306 unit tests and 380/381 integration tests, E2E 244/244, and zero typecheck errors across five packages. The latest GitHub Actions run found during this review failed at Lint, so these historical counts must not be interpreted as the current CI status.

## Deployment

See [DEPLOY.md](DEPLOY.md) for the build artifact, hosting requirements, and deployment instructions. In particular:

- Deploy at the **root of a domain**, not under a path prefix, because the OCCT loader uses absolute `/occt/…` URLs.
- The host must support HTTPS, SPA fallback to `/index.html`, the OCCT runtime asset of about 48 MiB, and `Content-Type: application/wasm`.
- Firebase Hosting is documented as the recommended free option. Vercel can be used on an appropriate plan; check the current plan terms before using a free tier for commercial work.
- After deployment, verify the WASM returns HTTP 200 with the correct MIME type, the kernel initializes, a cabinet can be created, and the service worker works offline after the initial load.

## Repository layout

```text
zilventor/
├── packages/
│   ├── app/              # React UI, commands, drawings, furniture and manufacturing workflows
│   ├── kernel/           # OCCT/WASM geometry, solver, workers and storage
│   ├── shared/           # Domain models, CAD/furniture math, nesting and shared types
│   ├── sketcher-worker/  # 2D sketch constraint worker
│   └── icons/            # Shared icon assets
├── tests/
│   ├── e2e/              # Playwright end-to-end tests
│   └── perf/             # Performance tests
├── docs/                 # Architecture, technical research, plans and capability inventories
├── docs-site/            # User-facing product documentation
├── CLAUDE.md             # AI-assisted development and verification guidance
├── DEPLOY.md             # Build and deployment guide
├── pnpm-workspace.yaml
├── playwright.config.ts
├── vitest.config.ts
└── tsconfig.base.json
```

## Further reading

- [User documentation](docs-site/index.md)
- [Architecture and module map](docs-site/architecture/index.md)
- [Known limitations](docs-site/troubleshooting/known-limitations.md)
- [Manufacturing capability inventory](docs/abf-plugin/05-parity/01-zilinventor-capability-inventory.md)
- [ABF parity milestones](docs/superpowers/plans/2026-07-02-abf-parity-milestones.md)
- [AI-assisted development guidance](CLAUDE.md)
- [Deployment guide](DEPLOY.md)

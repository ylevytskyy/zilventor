# zilventor

## Current state

_As of 2026-06-21._  
TODO

## What this is

A web-based 3D CAD / parametric sketching application. _(detected — unverified)_  
Stack: TypeScript + React 18 + Three.js + OpenCascade.js (WASM), bundled with Vite, deployed as a PWA via Firebase Hosting / Vercel. _(detected — unverified)_

## Goals / Scope

**Goals**
- TODO

**Non-goals**
- TODO

**MVP scope**
- TODO

## Confidence & calibration

| Area | Confidence | Notes |
|---|---|---|
| TODO | TODO | TODO |

## Prerequisites

- Node.js ≥ 20 _(detected — unverified)_
- pnpm 9.x (`corepack enable && corepack prepare pnpm@9 --activate`) _(detected — unverified)_
- TypeScript 5.5 (dev dep, installed via pnpm) _(detected — unverified)_

## Quickstart

```bash
# Install dependencies (also runs postinstall to copy OCCT binaries)
pnpm install

# Start the development server (app package)
pnpm --filter @zilventor/app dev
```

## Running tests

```bash
# Type-check all packages
pnpm typecheck

# Lint
pnpm lint

# Unit tests (all packages)
pnpm test:unit

# Integration tests (all packages)
pnpm test:integration

# E2E tests (Playwright, Chromium)
pnpm test:e2e

# E2E — Firefox
pnpm test:e2e:firefox

# E2E — built artifact
pnpm test:e2e:built

# Performance tests
pnpm test:perf
```

## Build & publish

### Build the production artifact

```bash
# From repo root. The frozen-lockfile install triggers the root `postinstall`
# (copy-occt.mjs), which copies the OCCT WASM into packages/app/public/occt/.
pnpm install --frozen-lockfile && pnpm --filter @zilventor/app build
```

The build runs `tsc --noEmit` + `vite build`; output lands in **`packages/app/dist/`**.
Verify the WASM made it in:

```bash
ls packages/app/dist/occt/
# opencascade.full.js   opencascade.full.wasm  (~48 MB)
```

> **Must deploy at a domain root** (`https://example.com/`), not a sub-path — the
> OCCT worker loads `/occt/…` via absolute URLs. The host must also send
> `Content-Type: application/wasm`, allow a ~48 MB static file, serve HTTPS, and
> SPA-rewrite to `/index.html`. See [DEPLOY.md](./DEPLOY.md) for the full host comparison.

### Publish to Firebase Hosting (recommended free host)

Config lives in `firebase.json` at the repo root (SPA rewrite + WASM/cache headers).

```bash
# One-time setup
npm install -g firebase-tools
firebase login            # opens a browser — run it yourself
firebase use --add        # pick your Firebase project, give it an alias

# Build, then deploy only Hosting
pnpm install --frozen-lockfile && pnpm --filter @zilventor/app build
firebase deploy --only hosting
# (or, without an alias:)
firebase deploy --only hosting --project <your-project-id>
```

`firebase deploy` uploads `packages/app/dist/` and prints the live `https://<project>.web.app` URL.
Run the post-deploy smoke checks in [DEPLOY.md](./DEPLOY.md) (kernel loads, `.wasm` is `200`
+ `application/wasm`, a cabinet renders, the service worker activates and works offline).

### Publish to Vercel (paid / non-commercial only)

`vercel.json` auto-configures the build. **The Hobby free tier bans commercial use** —
use only on a paid plan or accept the ToS risk.

```bash
npm install -g vercel
vercel              # first deploy — links the project
vercel --prod       # production deploy
```

Cloudflare Pages needs an R2 workaround for the 48 MB WASM (over its 25 MiB/file cap) —
see [DEPLOY.md](./DEPLOY.md).

## Repository layout

```
zilventor/
├── packages/
│   ├── app/             # Main React application  _(detected — unverified)_
│   ├── kernel/          # CAD kernel (OpenCascade.js wrapper)  _(detected — unverified)_
│   ├── sketcher-worker/ # Web Worker for constraint solving (planegcs)  _(detected — unverified)_
│   ├── shared/          # Shared types / utilities  _(detected — unverified)_
│   └── icons/           # SVG icon assets  _(detected — unverified)_
├── docs/                # Project documentation
├── tests/               # Root-level Playwright E2E tests  _(detected — unverified)_
├── tools/               # Build / codegen scripts  _(detected — unverified)_
├── tmp/                 # Scratch / local artifacts (gitignored?)
├── DEPLOY.md            # Deployment guide
├── firebase.json        # Firebase Hosting config
├── vercel.json          # Vercel deployment config
├── pnpm-workspace.yaml
├── playwright.config.ts
├── vitest.config.ts
├── eslint.config.js
└── tsconfig.base.json
```

## Troubleshooting

| Symptom | Fix |
|---|---|
| TODO | TODO |

## Where to read more

- [ARCHITECTURE.md](./ARCHITECTURE.md) — system design, component map, key decisions
- [CLAUDE.md](./CLAUDE.md) — project-specific guidance for AI-assisted development
- [DEPLOY.md](./DEPLOY.md) — build and deployment instructions

## Caveats

TODO

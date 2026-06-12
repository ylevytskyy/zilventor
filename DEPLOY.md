# ZilInventor — Deploy Guide

## Prerequisites

- **Node.js ≥ 20** (`node --version`)
- **pnpm 9** (`npm install -g pnpm@9` or `corepack enable && corepack prepare pnpm@9 --activate`)

## Build

```bash
# Full production build (from repo root):
pnpm install --frozen-lockfile && pnpm --filter @zilventor/app build
```

What happens:
1. `pnpm install --frozen-lockfile` — installs all workspaces.
   The root `postinstall` script (`node packages/app/scripts/copy-occt.mjs`) runs automatically and copies the OCCT WASM files from `node_modules/opencascade.js/dist/` into `packages/app/public/occt/`. This is required before Vite can include them.
2. `pnpm --filter @zilventor/app build` — triggers the app's `prebuild` hook (which also runs `copy-occt.mjs` as a safety re-copy), then runs `tsc --noEmit` + `vite build`.
3. Output lands in **`packages/app/dist/`**.

Verify the output contains the WASM:
```bash
ls packages/app/dist/occt/
# opencascade.full.js   opencascade.full.wasm
```

---

## 48 MB WASM — Host-Limit Analysis

**Finding (researched 2026-06-12):**

| Host | Per-file static asset limit | Source |
|---|---|---|
| **Cloudflare Pages** | **25 MiB** hard limit | [developers.cloudflare.com/pages/platform/limits/](https://developers.cloudflare.com/pages/platform/limits/) — "The maximum file size for a single Cloudflare Pages site asset is 25 MiB." (April 2026) |
| **Vercel** | No per-file static limit; total source upload is 100 MB (Hobby) / 1 GB (Pro) — individual static files are not subject to a per-file cap | [vercel.com/docs/limits](https://vercel.com/docs/limits) (last updated 2026-05-20) |

`opencascade.full.wasm` is **~48 MiB**. This exceeds the Cloudflare Pages 25 MiB per-file limit and **will be rejected at deploy time**.

### Recommended primary host: Vercel

Vercel serves the 48 MB WASM directly with no per-file restriction. Vercel is the recommended production target.

### Cloudflare Pages — requires R2 workaround

To use Cloudflare Pages, the WASM must NOT be part of the Pages deployment bundle. Instead:

1. Upload `opencascade.full.wasm` and `opencascade.full.js` to a **Cloudflare R2 bucket** with a public custom domain (e.g. `https://occt.yourdomain.com/`).
2. Update `packages/app/src/occtLoader.ts` — change the `locateFile` callback so WASM requests resolve to the R2 URL rather than `/occt/opencascade.full.wasm`.
3. Update Workbox's `globPatterns` in `vite.config.ts` to remove the `**/*.wasm` pattern and instead precache the external R2 URL via `additionalManifestEntries`.
4. Remove `opencascade.full.wasm` (and `.js`) from the Pages deploy artifact so it stays under 25 MiB per file.

This R2 rework is not implemented in the current codebase — it is documented here for reference.

---

## Root-Path Requirement

**The app MUST be deployed at the root of a domain (`https://example.com/`), NOT at a sub-path (`https://example.com/app/`).**

The OCCT kernel worker loads assets via absolute URLs beginning with `/occt/…` (hardcoded in `occtLoader.ts`). A sub-path deploy breaks these URLs, causing the WASM to fail to load at runtime. Fixing sub-path hosting requires:
- Updating `occtLoader.ts` to use a configurable base URL.
- Setting `base` in `vite.config.ts` to the sub-path.

Both are code changes not currently implemented.

---

## Offline Note

The first cold load fetches ~50 MB (OCCT WASM + JS loader). The Workbox service worker precaches this in full (`maximumFileSizeToCacheInBytes: 60 MB`). After the first load, the app works fully offline.

---

## Vercel Deploy (Primary)

### Dashboard (recommended for first deploy)

1. Import the repo at [vercel.com/new](https://vercel.com/new).
2. Vercel auto-detects `vercel.json` — no manual config needed.
   - Build command: `pnpm install --frozen-lockfile && pnpm --filter @zilventor/app build`
   - Output directory: `packages/app/dist`
3. Click **Deploy**.

### CLI

```bash
# Install Vercel CLI globally if not installed
npm install -g vercel

# From repo root — first deploy (prompts to link project):
vercel

# Subsequent production deploys:
vercel --prod
```

The `vercel.json` at repo root configures:
- **Build command** with frozen lockfile (triggers root postinstall → OCCT copy).
- **Output directory** `packages/app/dist`.
- **SPA rewrites** — all routes fall back to `/index.html` (static asset paths are exempted by pattern order).
- **Cache headers** — immutable 1-year for `/assets/*` and `/occt/*`; `no-cache` for `sw.js` and `index.html`; `Content-Type: application/wasm` for `.wasm` files.

> **Live deploy preview is human-gated.** Run: `vercel --prod`

---

## Cloudflare Pages Deploy (Caveat: R2 required for WASM)

> If you proceed without the R2 workaround, the deploy **will fail** because `opencascade.full.wasm` (~48 MiB) exceeds the 25 MiB per-file limit.

Assuming the R2 workaround is in place:

### Dashboard

1. Go to [dash.cloudflare.com](https://dash.cloudflare.com) → **Pages** → **Create a project** → connect repo.
2. Set:
   - **Build command:** `pnpm install --frozen-lockfile && pnpm --filter @zilventor/app build`
   - **Build output directory:** `packages/app/dist`
   - **Node.js version:** 20
3. Click **Save and Deploy**.

`_headers` and `_redirects` in `packages/app/public/` are copied to `dist/` by Vite and are processed by Cloudflare Pages automatically.

### Wrangler CLI

```bash
# Install Wrangler
npm install -g wrangler

# Build first
pnpm install --frozen-lockfile && pnpm --filter @zilventor/app build

# Deploy (first time creates a new Pages project)
npx wrangler pages deploy packages/app/dist --project-name zilventor
```

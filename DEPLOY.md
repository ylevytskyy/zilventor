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

The build ships one **~48 MiB** static file (`occt/opencascade.full.wasm`, exactly 50,305,130 bytes). That single file is the deciding constraint when picking a host. A host must (a) accept a ~48 MB static file, (b) let us set `Content-Type: application/wasm` + cache headers, (c) support an SPA rewrite to `/index.html`, and (d) serve HTTPS (the app needs a secure context for OPFS).

**Findings (free static hosts, re-researched 2026-06-20):**

| Host | 48 MB single file? | Custom headers / SPA? | Free bandwidth/mo | Verdict for this app |
|---|---|---|---|---|
| **Firebase Hosting (Spark)** | ✅ 2 GB/file (confirmed) | ✅ via `firebase.json` | 10 GB (~200 cold loads) | **Recommended free host** — confirmed file size, full control, no commercial-use restriction. Bandwidth is ample for internal use (the SW caches the wasm after first load). |
| **Render (static site)** | ⚠️ per-file limit undocumented — verify with a throwaway deploy | ✅ via `render.yaml` | 100 GB | Viable; most bandwidth headroom, but the 48 MB file is unconfirmed. |
| **Vercel (Hobby)** | ⚠️ ~100 MB total deploy; wasm eats half | ✅ via `vercel.json` | 100 GB | **ToS caveat:** the Hobby free tier *bans commercial use* — an internal shop tool counts. Use only on a paid Vercel plan, or accept the ToS risk. |
| **Cloudflare Pages** | ❌ **25 MiB/file hard cap** | ✅ | unlimited | **Disqualified** unless the wasm is offloaded to R2 (see workaround below). [CF limits](https://developers.cloudflare.com/pages/platform/limits/) |
| GitHub / GitLab Pages, Surge, Neocities | file size OK | ❌ no custom headers | — | **Disqualified** — cannot force `Content-Type: application/wasm`, which breaks `WebAssembly.instantiateStreaming`. |

### Recommended host: Firebase Hosting (Spark / free)

Firebase serves the 48 MB WASM with a confirmed 2 GB/file limit, gives full header + SPA-rewrite control via `firebase.json` (committed at repo root), runs HTTPS automatically, and has no commercial-use restriction. The 10 GB/mo free bandwidth is plenty for an internal tool because the service worker precaches the wasm after the first cold load (repeat visits cost ~0 bandwidth). See **Firebase Hosting Deploy** below.

> The previous "Vercel primary" recommendation (2026-06-12) still works technically, but the Hobby free tier's commercial-use ban makes it a poor fit for an internal shop tool. `vercel.json` is retained for paid-plan / non-commercial use.

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

## Firebase Hosting Deploy (Recommended free host)

Firebase Hosting accepts the 48 MB wasm (2 GB/file limit), serves HTTPS, and is configured entirely by **`firebase.json`** (committed at repo root). It mirrors the `vercel.json` rules: SPA rewrite → `/index.html`, `application/wasm` + 1-year-immutable on `.wasm`, immutable on `/assets/**` and `/occt/**`, `no-cache` on `sw.js` and `index.html`.

> Firebase Hosting reads **only `firebase.json`** — the `_headers`/`_redirects` files (used by Cloudflare/Netlify/Render) are ignored here; they ship harmlessly as static files.

### One-time setup

```bash
# 1. Install the CLI
npm install -g firebase-tools

# 2. Log in (opens a browser — must be run by you)
firebase login

# 3. Create a Hosting site in the Firebase console (https://console.firebase.google.com),
#    then link this repo to it (writes .firebaserc — do NOT commit secrets, the project id is fine):
firebase use --add        # pick your project, give it an alias e.g. "prod"
```

### Build + deploy

```bash
# Build the artifact (from repo root):
pnpm install --frozen-lockfile && pnpm --filter @zilventor/app build

# Deploy only Hosting:
firebase deploy --only hosting
# (or target a specific project without an alias:)
firebase deploy --only hosting --project <your-project-id>
```

`firebase deploy` uploads `packages/app/dist/` (the `public` dir in `firebase.json`) and prints the live `https://<project>.web.app` URL.

### Post-deploy smoke (§6 — do this once live)

In Chrome **and** Firefox at the deployed URL:
1. Confirm the status bar leaves "Loading CAD kernel…" and reaches ready (the worker fetched the 48 MB wasm).
2. DevTools → Network: `opencascade.full.wasm` is `200`, `Content-Type: application/wasm`, ~48 MB.
3. Create a base cabinet → a solid renders.
4. DevTools → Application → Service Workers shows "activated"; go **Offline**, hard-reload → app still boots and the kernel initializes.
5. No console `SyntaxError` / `data:` worker errors.

### Bandwidth note

Each *cold* visitor downloads ~48 MB once; the service worker then serves it from cache. 10 GB/mo free ≈ 200 cold loads — for a handful of internal users this is not a constraint. If you outgrow it, bump to Firebase Blaze (pay-as-you-go, ~$0.15/GB) or switch to Render (100 GB/mo free).

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

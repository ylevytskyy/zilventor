/**
 * Prebuild script: copy OCCT Emscripten glue + WASM from node_modules into
 * public/occt/ so they are served as static assets in production.
 *
 * Why this approach (Step 3b fallback):
 *   - opencascade.full.js is an Emscripten-generated bundle that uses raw
 *     `.wasm` ESM-proposal imports and Node-specific built-ins (`path`,
 *     `url`, `__dirname`). Rollup cannot bundle it into the browser worker.
 *   - When the kernel worker is built via `?worker`, Rollup processes it as
 *     a sub-build and follows all dynamic imports — even `@vite-ignore`-
 *     annotated ones — causing build failures ("dirname not exported by
 *     __vite-browser-external").
 *   - Serving from /public/occt/ and loading via absolute URL at runtime
 *     bypasses Rollup entirely. The `@vite-ignore` on the runtime import()
 *     suppresses dev-server warnings; in production the JS is fetched by the
 *     browser at runtime, not processed by Rollup at build time.
 */

import { copyFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..', '..', '..');

function findOcctDist() {
  // pnpm may hoist the package directly
  const direct = join(repoRoot, 'node_modules', 'opencascade.js', 'dist');
  if (existsSync(direct)) return direct;

  // Fall back to searching the pnpm content-addressable store
  const pnpmStore = join(repoRoot, 'node_modules', '.pnpm');
  let entries;
  try {
    entries = readdirSync(pnpmStore);
  } catch {
    throw new Error(`Cannot read pnpm store at ${pnpmStore}`);
  }
  const matches = entries.filter(e => e.startsWith('opencascade.js@'));
  if (matches.length === 0) throw new Error(`opencascade.js not found in ${pnpmStore}`);
  if (matches.length > 1) {
    throw new Error(
      `Multiple opencascade.js versions in pnpm store: ${matches.join(', ')} — bump may have left a stale entry`
    );
  }
  return join(pnpmStore, matches[0], 'node_modules', 'opencascade.js', 'dist');
}

const srcDir = findOcctDist();
const destDir = join(__dirname, '..', 'public', 'occt');

mkdirSync(destDir, { recursive: true });

const files = ['opencascade.full.js', 'opencascade.full.wasm'];
for (const file of files) {
  copyFileSync(join(srcDir, file), join(destDir, file));
  console.log(`  copied: ${file} → public/occt/${file}`);
}
console.log('copy-occt: done');

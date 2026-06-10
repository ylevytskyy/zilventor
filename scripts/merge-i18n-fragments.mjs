// One-off reconciliation: merge src/i18n/fragments/*.json (flat key -> {en,uk})
// into nested en.json / uk.json. Reports cross-cluster collisions with conflicting
// values. Run from worktree root: node scripts/merge-i18n-fragments.mjs
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const i18nDir = join(root, 'packages/app/src/i18n');
const fragDir = join(i18nDir, 'fragments');

const enExisting = JSON.parse(readFileSync(join(i18nDir, 'locales/en.json'), 'utf8'));
const ukExisting = JSON.parse(readFileSync(join(i18nDir, 'locales/uk.json'), 'utf8'));

// Flatten existing nested bundles back to dotted keys so they participate in merge.
function flatten(obj, prefix = '', out = {}) {
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object') flatten(v, path, out);
    else out[path] = v;
  }
  return out;
}

const enFlat = flatten(enExisting);
const ukFlat = flatten(ukExisting);

const merged = {}; // key -> {en, uk, sources:[]}
for (const [k, v] of Object.entries(enFlat)) merged[k] = { en: v, uk: ukFlat[k] ?? '', sources: ['existing'] };

const collisions = [];
for (const file of readdirSync(fragDir).filter((f) => f.endsWith('.json'))) {
  const frag = JSON.parse(readFileSync(join(fragDir, file), 'utf8'));
  for (const [key, val] of Object.entries(frag)) {
    const en = typeof val === 'object' ? val.en : val;
    const uk = typeof val === 'object' ? (val.uk ?? '') : '';
    if (merged[key]) {
      if (merged[key].en !== en) {
        collisions.push({ key, kind: 'en', a: merged[key].en, aSrc: merged[key].sources.join(','), b: en, bSrc: file });
      } else if (merged[key].uk && uk && merged[key].uk !== uk) {
        collisions.push({ key, kind: 'uk', a: merged[key].uk, aSrc: merged[key].sources.join(','), b: uk, bSrc: file });
      }
      merged[key].sources.push(file);
      // keep first en; prefer a non-empty uk if current is empty
      if (!merged[key].uk && uk) merged[key].uk = uk;
    } else {
      merged[key] = { en, uk, sources: [file] };
    }
  }
}

// Detect leaf-vs-branch conflicts: a key that is both a value and a prefix of another.
const allKeys = Object.keys(merged);
const leafBranch = [];
for (const k of allKeys) {
  for (const other of allKeys) {
    if (other !== k && other.startsWith(k + '.')) {
      leafBranch.push({ leaf: k, branch: other, leafSrc: merged[k].sources.join(','), branchSrc: merged[other].sources.join(',') });
      break;
    }
  }
}
if (leafBranch.length) {
  console.log(`LEAF-vs-BRANCH CONFLICTS (must rename before merge): ${leafBranch.length}`);
  for (const c of leafBranch) console.log(`  "${c.leaf}" (leaf, ${c.leafSrc}) clashes with "${c.branch}" (branch, ${c.branchSrc})`);
  console.log('\nAborting write. Resolve in fragments then re-run.');
  process.exit(2);
}

// Build nested objects
function setNested(obj, dotted, value) {
  const parts = dotted.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    cur[parts[i]] = cur[parts[i]] ?? {};
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = value;
}

const enOut = {};
const ukOut = {};
const emptyUk = [];
for (const [key, { en, uk }] of Object.entries(merged).sort(([a], [b]) => a.localeCompare(b))) {
  setNested(enOut, key, en);
  setNested(ukOut, key, uk);
  if (!uk || uk.trim() === '') emptyUk.push(key);
}

writeFileSync(join(i18nDir, 'locales/en.json'), JSON.stringify(enOut, null, 2) + '\n');
writeFileSync(join(i18nDir, 'locales/uk.json'), JSON.stringify(ukOut, null, 2) + '\n');

console.log(`Merged ${Object.keys(merged).length} keys into en.json / uk.json.`);
console.log(`\nCROSS-CLUSTER COLLISIONS (conflicting values, kept FIRST): ${collisions.length}`);
for (const c of collisions) console.log(`  [${c.kind}] ${c.key}: "${c.a}" (${c.aSrc}) vs "${c.b}" (${c.bSrc})`);
console.log(`\nKEYS WITH EMPTY UKRAINIAN: ${emptyUk.length}`);
for (const k of emptyUk) console.log(`  ${k}`);

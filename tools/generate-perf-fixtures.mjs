#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const outDir = resolve(repoRoot, 'tests/perf/fixtures/inventor-export-batch');
const cubeStep = readFileSync(resolve(repoRoot, 'packages/kernel/src/occt/__tests__/fixtures/step/cube-10mm.step'));

if (existsSync(outDir)) rmSync(outDir, { recursive: true });
mkdirSync(outDir, { recursive: true });

// 50 parts: Part00 .. Part49
for (let i = 0; i < 50; i++) {
  const stem = `Part${String(i).padStart(2, '0')}`;
  writeFileSync(resolve(outDir, `${stem}.step`), cubeStep);
  writeFileSync(resolve(outDir, `${stem}.ipt.json`), JSON.stringify({
    schemaVersion: 1, kind: 'part',
    exportedAt: '2026-04-30T00:00:00Z',
    source: { iptPath: `${stem}.ipt`, fileVersion: 'Inventor 2012' },
    step: `${stem}.step`,
    name: stem,
    properties: { partNumber: `P-${i}`, description: `Perf part ${i}` },
    parameters: {},
  }, null, 2));
}

// 10 assemblies: Asm0 .. Asm9, each referencing 5 parts (Part(i*5) .. Part(i*5+4))
for (let a = 0; a < 10; a++) {
  const stem = `Asm${a}`;
  const occurrences = [];
  for (let j = 0; j < 5; j++) {
    const partIdx = a * 5 + j;
    const partStem = `Part${String(partIdx).padStart(2, '0')}`;
    occurrences.push({
      occurrenceName: `${partStem}:1`,
      ref: `./${partStem}.ipt.json`,
      pose: { translation: { x: j * 20, y: 0, z: 0 }, quaternion: [0, 0, 0, 1] },
      visible: true,
      grounded: j === 0,
    });
  }
  writeFileSync(resolve(outDir, `${stem}.iam.json`), JSON.stringify({
    schemaVersion: 1, kind: 'assembly',
    exportedAt: '2026-04-30T00:00:00Z',
    source: { iamPath: `${stem}.iam`, fileVersion: 'Inventor 2012' },
    name: stem,
    properties: {},
    parameters: {},
    occurrences,
  }, null, 2));
}

console.log(`Wrote 50 parts + 10 assemblies to ${outDir}`);

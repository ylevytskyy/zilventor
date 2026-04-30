// One-time generator. Run via: node tools/generate-step-fixtures.mjs
// Produces three small STEP fixtures for the kernel STEP-IO integration tests
// (sub-project 1.5 — Inventor export importer).
//
// Uses opencascade.js's STEPControl_Writer_1 + Message_ProgressRange_1 to
// emit AP214/MM STEPs. If those bindings are ever removed in a future
// opencascade.js release, the script throws so the failure is loud rather
// than silently producing garbage.

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(__dirname, '..', 'packages/kernel/src/occt/__tests__/fixtures/step');
mkdirSync(OUT_DIR, { recursive: true });

// `opencascade.js` is a workspace dep of @zilventor/kernel. Resolve via an
// absolute file URL so this script runs from the repo root regardless of cwd.
const occNodeEntry = resolve(__dirname, '..', 'packages/kernel/node_modules/opencascade.js/dist/node.js');
const opencascadeMod = await import(pathToFileURL(occNodeEntry).href);
const oc = await opencascadeMod.default();

const Writer = oc.STEPControl_Writer_1 ?? oc.STEPControl_Writer;
const ProgressRange = oc.Message_ProgressRange_1 ?? oc.Message_ProgressRange;
if (!Writer) {
  throw new Error('STEPControl_Writer not found in opencascade.js bindings');
}

function makeBox(dx, dy, dz) {
  const mk = new oc.BRepPrimAPI_MakeBox_2(dx, dy, dz);
  const shape = mk.Shape();
  mk.delete();
  return shape;
}

function writeStep(shape, productName, outFile) {
  const writer = new Writer();
  oc.Interface_Static.SetCVal('write.step.schema', 'AP214');
  oc.Interface_Static.SetCVal('write.step.unit', 'MM');
  oc.Interface_Static.SetCVal('write.step.product.name', productName);

  let transferred = false;
  try {
    writer.Transfer(shape, oc.STEPControl_StepModelType.STEPControl_AsIs, true, new ProgressRange());
    transferred = true;
  } catch (e1) {
    try {
      writer.Transfer(shape, oc.STEPControl_StepModelType.STEPControl_AsIs);
      transferred = true;
    } catch (e2) {
      throw new Error(`STEPControl_Writer.Transfer failed: ${e1?.message ?? e1} / ${e2?.message ?? e2}`);
    }
  }
  if (!transferred) throw new Error('Transfer did not complete');

  const tmpPath = '/_step_out.step';
  try {
    oc.FS.unlink(tmpPath);
  } catch {
    /* ignore: not present yet */
  }
  writer.Write(tmpPath);
  const bytes = oc.FS.readFile(tmpPath);
  writeFileSync(outFile, bytes);
  console.log(`  wrote ${outFile} (${bytes.byteLength} bytes)`);
}

// 1. cube-10mm.step — single 10x10x10 mm solid at origin
writeStep(makeBox(10, 10, 10), 'cube-10mm', `${OUT_DIR}/cube-10mm.step`);

// 2. two-bodies.step — compound of two cubes (12 faces total)
{
  const a = makeBox(10, 10, 10);
  const b = makeBox(5, 5, 5);
  const builder = new oc.BRep_Builder();
  const comp = new oc.TopoDS_Compound();
  builder.MakeCompound(comp);
  builder.Add(comp, a);
  builder.Add(comp, b);
  writeStep(comp, 'two-bodies', `${OUT_DIR}/two-bodies.step`);
}

// 3. cyrillic-name.step — cube with a Ukrainian product name (UTF-8 path test)
writeStep(makeBox(10, 10, 10), 'Бічна_панель', `${OUT_DIR}/cyrillic-name.step`);

console.log('Wrote fixtures to', OUT_DIR);

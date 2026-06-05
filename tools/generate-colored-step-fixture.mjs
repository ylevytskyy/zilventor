// One-time generator for two-colored-boxes.step
// Run via: node tools/generate-colored-step-fixture.mjs
//
// Produces a STEP file containing 2 disjoint boxes with per-body XCAF surface
// colors: #ff0000 (red) and #00ff00 (green). Used by the Task-9 e2e test.

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(__dirname, '..', 'packages/kernel/src/occt/__tests__/fixtures/step');
mkdirSync(OUT_DIR, { recursive: true });

const occNodeEntry = resolve(
  __dirname,
  '..',
  'packages/kernel/node_modules/opencascade.js/dist/node.js',
);
const opencascadeMod = await import(pathToFileURL(occNodeEntry).href);
const oc = await opencascadeMod.default();

function hexToRgb01(hex) {
  const h = hex.replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16) / 255,
    parseInt(h.slice(2, 4), 16) / 255,
    parseInt(h.slice(4, 6), 16) / 255,
  ];
}

// --- XCAF document ---
const appHandle = oc.XCAFApp_Application.GetApplication();
const app = appHandle.get();

const docHandle = new oc.Handle_TDocStd_Document_1();
app.NewDocument_2(new oc.TCollection_ExtendedString_1(), docHandle);
const docObj = docHandle.get();
const mainLabel = docObj.Main();

const shapeTool = oc.XCAFDoc_DocumentTool.ShapeTool(mainLabel).get();
const colorTool = oc.XCAFDoc_DocumentTool.ColorTool(mainLabel).get();

const colors = ['#ff0000', '#00ff00'];
const Pnt = oc.gp_Pnt_3;

colors.forEach((hex, i) => {
  const origin = new Pnt(i * 20, 0, 0);
  const boxMk = new oc.BRepPrimAPI_MakeBox_3(origin, 10, 10, 10);
  const boxShape = boxMk.Shape();
  boxMk.delete();
  origin.delete?.();

  const label = shapeTool.AddShape(boxShape, false, true);
  const [r, g, b] = hexToRgb01(hex);
  const qcol = new oc.Quantity_Color_3(r, g, b, oc.Quantity_TypeOfColor.Quantity_TOC_sRGB);
  colorTool.SetColor_2(label, qcol, oc.XCAFDoc_ColorType.XCAFDoc_ColorSurf);
  console.log(`  box ${i}: ${hex} → label added`);
});

// --- write STEP via STEPCAFControl_Writer ---
const writer = new oc.STEPCAFControl_Writer_1();
const ProgressRange =
  oc.Message_ProgressRange_1 ?? oc.Message_ProgressRange;
writer.Transfer_1(docHandle, oc.STEPControl_StepModelType.STEPControl_AsIs, null, new ProgressRange());

const tmpPath = '/_two_colored_boxes.step';
writer.Write(tmpPath);
writer.delete();

const bytes = oc.FS.readFile(tmpPath);
oc.FS.unlink(tmpPath);

const outFile = `${OUT_DIR}/two-colored-boxes.step`;
writeFileSync(outFile, bytes);
console.log(`Wrote ${outFile} (${bytes.byteLength} bytes)`);

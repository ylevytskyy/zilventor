import type { OcctInstance } from '../occtLoader';

/**
 * Builds a STEP file (bytes) containing `colors.length` separate boxes, each
 * assigned the given hex surface color via XCAF. Used as a self-contained,
 * reproducible colored-STEP fixture for color-extraction tests.
 *
 * Each box is 10×10×10, offset along +X by 20mm per index so they are disjoint.
 */
export function makeColoredBoxStepBytes(oc: OcctInstance, colors: string[]): ArrayBuffer {
  // --- new XCAF document ---
  const appHandle = (oc as { XCAFApp_Application: { GetApplication(): { get(): { NewDocument_2(f: unknown, d: unknown): void } } } }).XCAFApp_Application.GetApplication();
  const app = appHandle.get();

  const TExtStrCtor = (oc as { TCollection_ExtendedString_1: new () => unknown }).TCollection_ExtendedString_1;
  const docHandle = new (oc as { Handle_TDocStd_Document_1: new () => unknown }).Handle_TDocStd_Document_1();
  app.NewDocument_2(new TExtStrCtor(), docHandle as unknown as { get(): { Main(): unknown } });

  const docObj = (docHandle as unknown as { get(): { Main(): unknown } }).get();
  const mainLabel = docObj.Main();

  const shapeTool = (oc as {
    XCAFDoc_DocumentTool: {
      ShapeTool(l: unknown): { get(): { AddShape(s: unknown, makeAssembly: boolean, makePrepare: boolean): unknown } }
    }
  }).XCAFDoc_DocumentTool.ShapeTool(mainLabel).get();

  const colorTool = (oc as {
    XCAFDoc_DocumentTool: {
      ColorTool(l: unknown): { get(): {
        SetColor_2(label: unknown, color: unknown, type: unknown): void;
      } }
    }
  }).XCAFDoc_DocumentTool.ColorTool(mainLabel).get();

  // BRepPrimAPI_MakeBox_3(P: gp_Pnt, dx, dy, dz) — creates a box from corner point.
  // We use this (vs. BRepPrimAPI_MakeBox_2 + BRepBuilderAPI_Transform) because
  // applying a location transform via BRepBuilderAPI_Transform creates an instance
  // with a TopoDS location, which OCCT XCAF treats as a reference rather than a
  // standalone shape. That causes STEP CAF writer to lose the per-shape color for
  // the transformed shapes (only the first label's color survives the round-trip).
  // A box created from a corner point has no location — it's a fresh standalone solid.
  const MakeBoxFromPnt = (oc as { BRepPrimAPI_MakeBox_3: new (p: unknown, x: number, y: number, z: number) => { Shape(): unknown; delete(): void } }).BRepPrimAPI_MakeBox_3;
  const Pnt = (oc as { gp_Pnt_3: new (x: number, y: number, z: number) => { delete?(): void } }).gp_Pnt_3;
  const QColor = (oc as { Quantity_Color_3: new (c1: number, c2: number, c3: number, type: unknown) => unknown }).Quantity_Color_3;
  const ColorType = (oc as { XCAFDoc_ColorType: { XCAFDoc_ColorSurf: unknown } }).XCAFDoc_ColorType;
  const QTOCrgb = (oc as { Quantity_TypeOfColor: { Quantity_TOC_sRGB: unknown } }).Quantity_TypeOfColor;

  colors.forEach((hex, i) => {
    const origin = new Pnt(i * 20, 0, 0);
    const boxMk = new MakeBoxFromPnt(origin, 10, 10, 10);
    const boxShape = boxMk.Shape();
    boxMk.delete();
    origin.delete?.();

    const label = shapeTool.AddShape(boxShape, false, true);
    const [r, g, b] = hexToRgb01(hex);
    // Use sRGB color type since STEP colors are sRGB and we want round-trip accuracy
    const qcol = new QColor(r, g, b, QTOCrgb.Quantity_TOC_sRGB);
    colorTool.SetColor_2(label, qcol, ColorType.XCAFDoc_ColorSurf);
  });

  // --- write STEP via STEPCAFControl_Writer ---
  const writer = new (oc as { STEPCAFControl_Writer_1: new () => {
    Transfer_1(doc: unknown, mode: unknown, multi: unknown, progress: unknown): boolean;
    Write(filename: string): unknown;
    delete(): void;
  } }).STEPCAFControl_Writer_1();

  const stepModelType = (oc as { STEPControl_StepModelType: { STEPControl_AsIs: unknown } }).STEPControl_StepModelType;
  const ProgressRange = (oc as { Message_ProgressRange_1: new () => unknown }).Message_ProgressRange_1
    ?? (oc as { Message_ProgressRange: new () => unknown }).Message_ProgressRange;

  const tmp = `/_step_out_${Math.random().toString(36).slice(2, 10)}.step`;
  writer.Transfer_1(docHandle, stepModelType.STEPControl_AsIs, null, new ProgressRange());
  writer.Write(tmp);
  writer.delete();

  const bytes = (oc as { FS: { readFile(p: string): Uint8Array; unlink(p: string): void } }).FS.readFile(tmp);
  (oc as { FS: { readFile(p: string): Uint8Array; unlink(p: string): void } }).FS.unlink(tmp);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function hexToRgb01(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16) / 255,
    parseInt(h.slice(2, 4), 16) / 255,
    parseInt(h.slice(4, 6), 16) / 255,
  ];
}

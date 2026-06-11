import type { HardwareEntry } from '../hardware-feature';

interface CatalogEntry extends HardwareEntry {
  readonly bboxMm: { readonly l: number; readonly w: number; readonly h: number };
  readonly attachPoints: ReadonlyArray<{
    readonly name: string;
    readonly position: { readonly x: number; readonly y: number; readonly z: number };
    readonly normal?: { readonly x: number; readonly y: number; readonly z: number };
  }>;
}

export const BUILTIN_CATALOG: readonly CatalogEntry[] = [
  {
    id: 'hinge-35mm-cup-full',
    name: '35mm Cup Hinge — Full Overlay',
    category: 'hinges',
    vendor: 'Blum',
    notes: 'Full overlay; requires 35mm Forstner bit',
    bboxMm: { l: 48, w: 35, h: 12 },
    attachPoints: [
      { name: 'cup-center', position: { x: 0,  y: 17.5, z: 0 } },
      { name: 'arm-mount',  position: { x: 48, y: 17.5, z: 0 } },
    ],
  },
  {
    id: 'hinge-35mm-cup-half',
    name: '35mm Cup Hinge — Half Overlay',
    category: 'hinges',
    vendor: 'Blum',
    notes: 'Half overlay; requires 35mm Forstner bit',
    bboxMm: { l: 48, w: 35, h: 12 },
    attachPoints: [
      { name: 'cup-center', position: { x: 0,  y: 17.5, z: 0 } },
      { name: 'arm-mount',  position: { x: 48, y: 17.5, z: 0 } },
    ],
  },
  {
    id: 'hinge-35mm-cup-inset',
    name: '35mm Cup Hinge — Inset',
    category: 'hinges',
    vendor: 'Blum',
    notes: 'Inset door; requires 35mm Forstner bit',
    bboxMm: { l: 48, w: 35, h: 12 },
    attachPoints: [
      { name: 'cup-center', position: { x: 0,  y: 17.5, z: 0 } },
      { name: 'arm-mount',  position: { x: 48, y: 17.5, z: 0 } },
    ],
  },
  {
    id: 'hinge-26mm-cup-full',
    name: '26mm Cup Hinge — Full Overlay',
    category: 'hinges',
    vendor: 'Generic',
    notes: 'Full overlay; requires 26mm Forstner bit',
    bboxMm: { l: 40, w: 26, h: 10 },
    attachPoints: [
      { name: 'cup-center', position: { x: 0,  y: 13, z: 0 } },
      { name: 'arm-mount',  position: { x: 40, y: 13, z: 0 } },
    ],
  },
  {
    id: 'shelf-pin-5mm-steel',
    name: '5mm Shelf Pin — Steel',
    category: 'shelfPins',
    vendor: 'Generic',
    notes: 'Press-fit into 5mm shelf-pin hole; steel',
    bboxMm: { l: 5, w: 5, h: 28 },
    attachPoints: [
      { name: 'tip', position: { x: 0, y: 0, z: 14 } },
    ],
  },
  {
    id: 'shelf-pin-5mm-clear',
    name: '5mm Shelf Pin — Clear',
    category: 'shelfPins',
    vendor: 'Generic',
    notes: 'Press-fit into 5mm shelf-pin hole; clear plastic',
    bboxMm: { l: 5, w: 5, h: 28 },
    attachPoints: [
      { name: 'tip', position: { x: 0, y: 0, z: 14 } },
    ],
  },
  {
    id: 'shelf-pin-7mm-sleeve',
    name: '7mm Shelf Pin — Steel Sleeve',
    category: 'shelfPins',
    vendor: 'Generic',
    notes: 'Sleeve style; requires 7mm hole',
    bboxMm: { l: 7, w: 7, h: 32 },
    attachPoints: [
      { name: 'tip', position: { x: 0, y: 0, z: 18 } },
    ],
  },
  // ── Bar pulls (drawer handles) ──────────────────────────────────────────────
  // cc = centre-to-centre; barLength = cc + 2 × END_ALLOWANCE (16mm)
  {
    id: 'bar-pull-96',
    name: 'Bar Pull 96mm',
    category: 'drawerHandles',
    vendor: 'Generic',
    notes: 'Bar pull; 96mm centre-to-centre; 128mm total length',
    bboxMm: { l: 128, w: 30, h: 12 },
    attachPoints: [
      { name: 'screw-0', position: { x: -48, y: 0, z: 0 } },
      { name: 'screw-1', position: { x:  48, y: 0, z: 0 } },
    ],
  },
  {
    id: 'bar-pull-128',
    name: 'Bar Pull 128mm',
    category: 'drawerHandles',
    vendor: 'Generic',
    notes: 'Bar pull; 128mm centre-to-centre; 160mm total length',
    bboxMm: { l: 160, w: 30, h: 12 },
    attachPoints: [
      { name: 'screw-0', position: { x: -64, y: 0, z: 0 } },
      { name: 'screw-1', position: { x:  64, y: 0, z: 0 } },
    ],
  },
  {
    id: 'bar-pull-160',
    name: 'Bar Pull 160mm',
    category: 'drawerHandles',
    vendor: 'Generic',
    notes: 'Bar pull; 160mm centre-to-centre; 192mm total length',
    bboxMm: { l: 192, w: 30, h: 12 },
    attachPoints: [
      { name: 'screw-0', position: { x: -80, y: 0, z: 0 } },
      { name: 'screw-1', position: { x:  80, y: 0, z: 0 } },
    ],
  },
];

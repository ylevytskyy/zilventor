import type { HardwareEntry, LegLevelerSpec } from '../hardware-feature';

interface CatalogEntry extends HardwareEntry {
  readonly bboxMm: { readonly l: number; readonly w: number; readonly h: number };
  readonly attachPoints: ReadonlyArray<{
    readonly name: string;
    readonly position: { readonly x: number; readonly y: number; readonly z: number };
    readonly normal?: { readonly x: number; readonly y: number; readonly z: number };
  }>;
  readonly legLeveler?: LegLevelerSpec;
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
  // ── Drawer slides (sold as a pair; bbox w = front-to-back run) ──────────────
  {
    id: 'drawer-slide-450-fullext',
    name: 'Full-Extension Slide 450mm (pair)',
    category: 'drawerSlides',
    vendor: 'Generic',
    notes: 'Side-mount full-extension ball-bearing slide; 450mm; sold as pair',
    bboxMm: { l: 12.5, w: 450, h: 45 },
    attachPoints: [
      { name: 'front', position: { x: 0, y:  225, z: 0 } },
      { name: 'back',  position: { x: 0, y: -225, z: 0 } },
    ],
  },
  {
    id: 'drawer-slide-500-fullext',
    name: 'Full-Extension Slide 500mm (pair)',
    category: 'drawerSlides',
    vendor: 'Generic',
    notes: 'Side-mount full-extension ball-bearing slide; 500mm; sold as pair',
    bboxMm: { l: 12.5, w: 500, h: 45 },
    attachPoints: [
      { name: 'front', position: { x: 0, y:  250, z: 0 } },
      { name: 'back',  position: { x: 0, y: -250, z: 0 } },
    ],
  },
  {
    id: 'drawer-slide-500-softclose',
    name: 'Soft-Close Full-Extension Slide 500mm (pair)',
    category: 'drawerSlides',
    vendor: 'Blum',
    notes: 'Soft-close full-extension slide; 500mm; integrated dampers; sold as pair',
    bboxMm: { l: 12.5, w: 500, h: 45 },
    attachPoints: [
      { name: 'front', position: { x: 0, y:  250, z: 0 } },
      { name: 'back',  position: { x: 0, y: -250, z: 0 } },
    ],
  },
  // ── Leg leveler ─────────────────────────────────────────────────────────────
  {
    id: 'leg-leveler-100',
    name: 'Adjustable Cabinet Leg 100–120mm',
    category: 'legLevelers',
    vendor: 'Generic',
    notes: 'Plastic adjustable leveler foot; M10 stem; 100–120mm height range',
    bboxMm: { l: 50, w: 50, h: 120 },
    attachPoints: [
      { name: 'stem', position: { x: 0, y: 0, z: 120 } },
      { name: 'foot', position: { x: 0, y: 0, z: 0 } },
    ],
    legLeveler: { screwCount: 4, patternW: 36, patternD: 36, screwDiameter: 4, screwDepth: 13 },
  },
  // ── Soft-close hinges (Ø35 cup; integrated BLUMOTION damper) ─────────────────
  {
    id: 'hinge-softclose-110',
    name: '35mm Soft-Close Hinge — 110°',
    category: 'softCloseHinges',
    vendor: 'Blum',
    notes: 'CLIP top BLUMOTION; full overlay; integrated soft-close; requires 35mm Forstner bit',
    bboxMm: { l: 48, w: 35, h: 14 },
    attachPoints: [
      { name: 'cup-center', position: { x: 0,  y: 17.5, z: 0 } },
      { name: 'arm-mount',  position: { x: 48, y: 17.5, z: 0 } },
    ],
  },
  {
    id: 'hinge-softclose-155',
    name: '35mm Soft-Close Hinge — 155°',
    category: 'softCloseHinges',
    vendor: 'Blum',
    notes: 'CLIP top BLUMOTION; wide-angle 155°; integrated soft-close; requires 35mm Forstner bit',
    bboxMm: { l: 52, w: 35, h: 14 },
    attachPoints: [
      { name: 'cup-center', position: { x: 0,  y: 17.5, z: 0 } },
      { name: 'arm-mount',  position: { x: 52, y: 17.5, z: 0 } },
    ],
  },
];

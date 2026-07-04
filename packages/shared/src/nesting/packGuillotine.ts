import type { GrainDirection } from '../panel-feature';
import type { MaterialId } from '../material';
import type { NestInputRow } from './types';
import type { NestSheet, PlacedPanel } from './nestState';

interface FreeRect { x: number; y: number; w: number; h: number; }

// Tolerance for free-rect adjacency/equality comparisons, mm. Matches the MERGE_EPS
// convention used for polygon-edge merging in drawing/hatchGenerator.ts. Deliberately
// tiny (not kerf-sized): two free rects separated by a real kerf cut are `kerfMm` apart,
// which must NOT merge — kerf is baked into each rect's own coordinates at split time
// (see the `right`/`bottom` construction below), so a genuine kerf boundary always shows
// up as a >0 gap here. Only rects that truly abut (no cut ever ran between them) merge.
const FREE_RECT_EPS = 1e-6;

/**
 * Fixpoint-merge a sheet's free-rect list: any two rects that share a full common
 * edge (same x+w, vertically contiguous — or same y+h, horizontally contiguous)
 * collapse into one larger rect. Repeats until no pair merges. Pure/order-independent.
 */
export function mergeFreeRects(rects: readonly FreeRect[]): FreeRect[] {
  let list = rects.slice();
  let changed = true;
  while (changed) {
    changed = false;
    outer: for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i]!, b = list[j]!;
        let merged: FreeRect | null = null;
        if (Math.abs(a.x - b.x) < FREE_RECT_EPS && Math.abs(a.w - b.w) < FREE_RECT_EPS) {
          if (Math.abs(a.y + a.h - b.y) < FREE_RECT_EPS) merged = { x: a.x, y: a.y, w: a.w, h: a.h + b.h };
          else if (Math.abs(b.y + b.h - a.y) < FREE_RECT_EPS) merged = { x: b.x, y: b.y, w: b.w, h: a.h + b.h };
        }
        if (!merged && Math.abs(a.y - b.y) < FREE_RECT_EPS && Math.abs(a.h - b.h) < FREE_RECT_EPS) {
          if (Math.abs(a.x + a.w - b.x) < FREE_RECT_EPS) merged = { x: a.x, y: a.y, w: a.w + b.w, h: a.h };
          else if (Math.abs(b.x + b.w - a.x) < FREE_RECT_EPS) merged = { x: b.x, y: b.y, w: a.w + b.w, h: a.h };
        }
        if (merged) {
          list = list.filter((_, k) => k !== i && k !== j);
          list.push(merged);
          changed = true;
          break outer;
        }
      }
    }
  }
  return list;
}
interface PanelInstance {
  itemNumber: number;
  rowKey: string;
  instanceIndex: number;
  L: number;
  W: number;
  grain: GrainDirection;
}

export interface PackResult {
  sheets: NestSheet[];
  oversized: { itemNumber: number; rowKey: string; wouldFitIfRotated: boolean }[];
}

export function packGuillotine(
  rows: readonly NestInputRow[],
  sheetLengthMm: number,
  sheetWidthMm: number,
  kerfMm: number,
  materialId: MaterialId,
): PackResult {
  // 1. Expand qty into a flat list.
  const panels: PanelInstance[] = [];
  for (const r of rows) {
    // Pack on the raw (cut) footprint: net + oversize allowance. Kerf is applied
    // separately as the gap between placed raw rectangles.
    const rawL = r.length + (r.oversize?.lengthMm ?? 0);
    const rawW = r.width + (r.oversize?.widthMm ?? 0);
    for (let i = 0; i < r.qty; i++) {
      panels.push({ itemNumber: r.itemNumber, rowKey: r.rowKey, instanceIndex: i + 1, L: rawL, W: rawW, grain: r.grain });
    }
  }

  // 2. Stable sort: max(L,W) DESC, then min(L,W) DESC, then itemNumber ASC.
  panels.sort((a, b) => {
    const aMax = Math.max(a.L, a.W), bMax = Math.max(b.L, b.W);
    if (aMax !== bMax) return bMax - aMax;
    const aMin = Math.min(a.L, a.W), bMin = Math.min(b.L, b.W);
    if (aMin !== bMin) return bMin - aMin;
    return a.itemNumber - b.itemNumber;
  });

  // 3. Pre-filter oversized.
  const oversized: PackResult['oversized'] = [];
  const fits = (p: PanelInstance): boolean => {
    if (p.grain === 'length') return p.L <= sheetLengthMm && p.W <= sheetWidthMm;
    if (p.grain === 'width')  return p.W <= sheetLengthMm && p.L <= sheetWidthMm;
    const minD = Math.min(p.L, p.W), maxD = Math.max(p.L, p.W);
    const minS = Math.min(sheetLengthMm, sheetWidthMm), maxS = Math.max(sheetLengthMm, sheetWidthMm);
    return minD <= minS && maxD <= maxS;
  };
  // Would the panel fit if the grain-forced orientation were swapped (L/W reversed)?
  // Only meaningful for grain='length'|'width' — grain='none' already tried both orientations.
  const fitsRotated = (p: PanelInstance): boolean => {
    if (p.grain === 'length') return p.W <= sheetLengthMm && p.L <= sheetWidthMm;
    if (p.grain === 'width')  return p.L <= sheetLengthMm && p.W <= sheetWidthMm;
    return false;
  };
  const remaining: PanelInstance[] = [];
  for (const p of panels) {
    if (fits(p)) remaining.push(p);
    else oversized.push({ itemNumber: p.itemNumber, rowKey: p.rowKey, wouldFitIfRotated: fitsRotated(p) });
  }

  // 4. Pack into sheets.
  const sheets: NestSheet[] = [];
  let sheetIndex = 1;
  while (remaining.length > 0) {
    const placed: PlacedPanel[] = [];
    let freeRects: FreeRect[] = [{ x: 0, y: 0, w: sheetLengthMm, h: sheetWidthMm }];
    let progressed = true;
    while (progressed) {
      progressed = false;
      for (let pi = 0; pi < remaining.length; pi++) {
        const p = remaining[pi]!;
        const placement = chooseOrientationAndRect(p, freeRects);
        if (!placement) continue;
        const { rectIdx, panelL, panelW, rotated, x, y } = placement;
        placed.push({ itemNumber: p.itemNumber, rowKey: p.rowKey, instanceIndex: p.instanceIndex, x, y, length: panelL, width: panelW, rotated, grain: p.grain });
        const parent = freeRects[rectIdx]!;
        const right: FreeRect = { x: x + panelL + kerfMm, y, w: parent.w - panelL - kerfMm, h: panelW };
        const bottom: FreeRect = { x, y: y + panelW + kerfMm, w: parent.w, h: parent.h - panelW - kerfMm };
        const next: FreeRect[] = [];
        if (right.w > 0 && right.h > 0) next.push(right);
        if (bottom.w > 0 && bottom.h > 0) next.push(bottom);
        for (let i = 0; i < freeRects.length; i++) if (i !== rectIdx) next.push(freeRects[i]!);
        freeRects = next;
        remaining.splice(pi, 1);
        progressed = true;
        break;
      }
    }
    const totalArea = placed.reduce((sum, p) => sum + p.length * p.width, 0);
    const utilizationPct = Math.round((totalArea / (sheetLengthMm * sheetWidthMm)) * 1000) / 10;
    const remnantMinDimMm = 100;
    const largestQualifyingFreeRect = mergeFreeRects(freeRects)
      .filter((r) => r.w >= remnantMinDimMm && r.h >= remnantMinDimMm)
      .reduce<FreeRect | null>((best, r) => {
        if (!best || r.w * r.h > best.w * best.h) return r;
        return best;
      }, null);
    sheets.push({
      materialId,
      sheetIndex,
      sheetLengthMm,
      sheetWidthMm,
      panels: placed,
      utilizationPct,
      ...(largestQualifyingFreeRect
        ? { remnant: { x: largestQualifyingFreeRect.x, y: largestQualifyingFreeRect.y, length: largestQualifyingFreeRect.w, width: largestQualifyingFreeRect.h } }
        : {}),
    });
    sheetIndex++;
  }

  return { sheets, oversized };
}

interface ChosenPlacement {
  rectIdx: number;
  panelL: number; panelW: number;
  rotated: boolean;
  x: number; y: number;
}

function chooseOrientationAndRect(p: PanelInstance, freeRects: readonly FreeRect[]): ChosenPlacement | null {
  // Build the orientation list per grain rule.
  type Orient = { L: number; W: number; rotated: boolean };
  const orientations: Orient[] = [];
  if (p.grain === 'length') orientations.push({ L: p.L, W: p.W, rotated: false });
  else if (p.grain === 'width') orientations.push({ L: p.W, W: p.L, rotated: true });
  else { // 'none'
    orientations.push({ L: p.L, W: p.W, rotated: false });
    if (p.L !== p.W) orientations.push({ L: p.W, W: p.L, rotated: true });
  }

  // For each free rect (in insertion order), try each allowed orientation.
  // For grain='none', score by max-leftover dim; tie-break rotated=false first.
  let best: ChosenPlacement | null = null;
  let bestScore = -Infinity;
  for (let ri = 0; ri < freeRects.length; ri++) {
    const r = freeRects[ri]!;
    for (const o of orientations) {
      if (o.L > r.w || o.W > r.h) continue;
      // Compute leftover-rect score: larger of (right, bottom) child's max(w,h).
      const rightW = r.w - o.L;
      const bottomH = r.h - o.W;
      const score = Math.max(Math.max(rightW, o.W), Math.max(r.w, bottomH));
      const candidate: ChosenPlacement = { rectIdx: ri, panelL: o.L, panelW: o.W, rotated: o.rotated, x: r.x, y: r.y };
      if (p.grain !== 'none') return candidate; // grain-locked: take the first fit
      if (score > bestScore || (score === bestScore && best && o.rotated === false && best.rotated === true)) {
        best = candidate;
        bestScore = score;
      }
    }
    if (best) return best; // first-fit at the first free rect that admits any orientation
  }
  return best;
}

import type { SketchPrimitive } from '@zilventor/shared';
import type { Point2 } from '../sketcher/snap';

export type ProfilePickCandidate = {
  sketchId: string;
  primitives: SketchPrimitive[];  // the sketch's primitives, for hit-testing
};

type Bbox = { xmin: number; ymin: number; xmax: number; ymax: number };

export class ProfilePickController {
  private candidates: ProfilePickCandidate[] = [];
  private tolerance = 5;  // world units

  setCandidates(sketches: ProfilePickCandidate[]): void {
    this.candidates = sketches;
  }

  setTolerance(t: number): void {
    this.tolerance = t;
  }

  /**
   * Returns the sketchId of the sketch whose bounding box (expanded by
   * tolerance) contains the click point. If multiple bounding boxes contain
   * the point, returns the one with the smallest area (innermost-containing).
   */
  pick(p: Point2): string | null {
    let best: { id: string; area: number } | null = null;
    for (const c of this.candidates) {
      const bb = primitivesBbox(c.primitives);
      if (!bb) continue;
      if (
        p.x >= bb.xmin - this.tolerance &&
        p.x <= bb.xmax + this.tolerance &&
        p.y >= bb.ymin - this.tolerance &&
        p.y <= bb.ymax + this.tolerance
      ) {
        const area = (bb.xmax - bb.xmin) * (bb.ymax - bb.ymin);
        if (!best || area < best.area) best = { id: c.sketchId, area };
      }
    }
    return best?.id ?? null;
  }
}

function primitivesBbox(prims: SketchPrimitive[]): Bbox | null {
  let xmin = Infinity;
  let ymin = Infinity;
  let xmax = -Infinity;
  let ymax = -Infinity;
  let touched = false;
  for (const p of prims) {
    switch (p.kind) {
      case 'rectangle':
        xmin = Math.min(xmin, p.x);
        ymin = Math.min(ymin, p.y);
        xmax = Math.max(xmax, p.x + p.w);
        ymax = Math.max(ymax, p.y + p.h);
        touched = true;
        break;
      case 'line':
        xmin = Math.min(xmin, p.x1, p.x2);
        ymin = Math.min(ymin, p.y1, p.y2);
        xmax = Math.max(xmax, p.x1, p.x2);
        ymax = Math.max(ymax, p.y1, p.y2);
        touched = true;
        break;
      case 'circle':
        xmin = Math.min(xmin, p.cx - p.r);
        ymin = Math.min(ymin, p.cy - p.r);
        xmax = Math.max(xmax, p.cx + p.r);
        ymax = Math.max(ymax, p.cy + p.r);
        touched = true;
        break;
      case 'arc':
        // Conservative: include the bounding circle. Accurate arc bbox
        // is more complex but overkill for pick-test.
        xmin = Math.min(xmin, p.cx - p.r);
        ymin = Math.min(ymin, p.cy - p.r);
        xmax = Math.max(xmax, p.cx + p.r);
        ymax = Math.max(ymax, p.cy + p.r);
        touched = true;
        break;
      case 'spline':
        for (const pt of p.controlPoints) {
          xmin = Math.min(xmin, pt.x);
          ymin = Math.min(ymin, pt.y);
          xmax = Math.max(xmax, pt.x);
          ymax = Math.max(ymax, pt.y);
        }
        touched = true;
        break;
    }
  }
  return touched ? { xmin, ymin, xmax, ymax } : null;
}

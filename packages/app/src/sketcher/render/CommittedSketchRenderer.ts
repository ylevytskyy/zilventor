import * as THREE from 'three';
import type { SketchPrimitive } from '@zilventor/shared';

const SKETCH_COLOR = 0xe8e8e8;
const CONSTRUCTION_COLOR = 0x8a8f98;
const SKETCH_Z = 0.005;

/**
 * Renders committed sketch primitives as three.js objects.
 * Rebuild the whole group whenever the primitives array changes (by joined-id + construction key).
 * Cheap — primitive count is small and geometry is simple.
 */
export class CommittedSketchRenderer {
  readonly group = new THREE.Group();
  private currentKey: string | null = null;

  update(primitives: ReadonlyArray<SketchPrimitive>): void {
    const key = primitives.map((p) => `${p.id}:${p.construction ? 1 : 0}`).join(',');
    if (key === this.currentKey) return;
    this.currentKey = key;
    this.clear();
    for (const p of primitives) this.group.add(this.buildObject(p));
  }

  private buildObject(p: SketchPrimitive): THREE.Object3D {
    const mat: THREE.LineBasicMaterial | THREE.LineDashedMaterial = p.construction
      ? new THREE.LineDashedMaterial({ color: CONSTRUCTION_COLOR, dashSize: 2, gapSize: 1.5 })
      : new THREE.LineBasicMaterial({ color: SKETCH_COLOR });
    const obj = this.buildGeometry(p, mat);
    if (p.construction) {
      obj.computeLineDistances();
    }
    return obj;
  }

  private buildGeometry(p: SketchPrimitive, mat: THREE.LineBasicMaterial | THREE.LineDashedMaterial): THREE.Line {
    if (p.kind === 'line') {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
        p.x1, p.y1, SKETCH_Z,
        p.x2, p.y2, SKETCH_Z
      ]), 3));
      return new THREE.Line(g, mat);
    }
    if (p.kind === 'rectangle') {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
        p.x,         p.y,         SKETCH_Z,
        p.x + p.w,   p.y,         SKETCH_Z,
        p.x + p.w,   p.y + p.h,   SKETCH_Z,
        p.x,         p.y + p.h,   SKETCH_Z,
        p.x,         p.y,         SKETCH_Z
      ]), 3));
      return new THREE.Line(g, mat);
    }
    if (p.kind === 'circle') {
      return this.buildArcLike(p.cx, p.cy, p.r, 0, 2 * Math.PI, 64, mat);
    }
    if (p.kind === 'arc') {
      const segs = Math.max(12, Math.ceil(Math.abs(p.endAngle - p.startAngle) * 32 / Math.PI));
      return this.buildArcLike(p.cx, p.cy, p.r, p.startAngle, p.endAngle, segs, mat);
    }
    if (p.kind === 'ellipse') {
      const cr = Math.cos(p.rotation), sr = Math.sin(p.rotation);
      const t0 = p.startAngle ?? 0;
      const t1 = p.endAngle ?? Math.PI * 2;
      const segs = 64;
      const verts: number[] = [];
      for (let i = 0; i <= segs; i++) {
        const t = t0 + (t1 - t0) * (i / segs);
        const lx = p.rx * Math.cos(t), ly = p.ry * Math.sin(t);
        verts.push(p.cx + lx * cr - ly * sr, p.cy + lx * sr + ly * cr, SKETCH_Z);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts), 3));
      return new THREE.Line(g, mat);
    }
    if (p.kind === 'point') {
      // Render a small cross marker (4 world-unit arm) at the point location.
      // The cross is drawn as two line segments sharing the center.
      const ARM = 2; // half-length of each arm in world units
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
        p.x - ARM, p.y,       SKETCH_Z,
        p.x + ARM, p.y,       SKETCH_Z,
        p.x,       p.y - ARM, SKETCH_Z,
        p.x,       p.y + ARM, SKETCH_Z,
      ]), 3));
      return new THREE.LineSegments(g, mat);
    }
    // spline
    return this.buildSpline(p.controlPoints, mat);
  }

  private buildArcLike(
    cx: number, cy: number, r: number, a0: number, a1: number, segs: number,
    mat: THREE.Material
  ): THREE.Line {
    const arr = new Float32Array((segs + 1) * 3);
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      const a = a0 + (a1 - a0) * t;
      arr[i * 3]     = cx + r * Math.cos(a);
      arr[i * 3 + 1] = cy + r * Math.sin(a);
      arr[i * 3 + 2] = SKETCH_Z;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    return new THREE.Line(g, mat);
  }

  private buildSpline(controlPoints: ReadonlyArray<{ x: number; y: number }>, mat: THREE.Material): THREE.Line {
    const pts = controlPoints.map((cp) => new THREE.Vector3(cp.x, cp.y, SKETCH_Z));
    const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
    const samples = curve.getPoints(Math.max(32, controlPoints.length * 8));
    const g = new THREE.BufferGeometry().setFromPoints(samples);
    return new THREE.Line(g, mat);
  }

  private clear(): void {
    while (this.group.children.length > 0) {
      const obj = this.group.children[0] as THREE.Line;
      this.group.remove(obj);
      obj.geometry.dispose();
      (obj.material as THREE.Material).dispose();
    }
  }

  dispose(): void {
    this.clear();
  }
}

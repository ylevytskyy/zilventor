import * as THREE from 'three';
import type { SketchPrimitive, TextAnnotation } from '@zilventor/shared';

const SKETCH_COLOR = 0xe8e8e8;
const CONSTRUCTION_COLOR = 0x8a8f98;
const SKETCH_Z = 0.005;

export function materialSpec(p: SketchPrimitive): { color: number; dashed: boolean; dashSize: number; gapSize: number } {
  if (p.construction) return { color: CONSTRUCTION_COLOR, dashed: true, dashSize: 2, gapSize: 1.5 };
  const color = p.color ?? SKETCH_COLOR;
  if (p.lineStyle === 'dashed')  return { color, dashed: true, dashSize: 3, gapSize: 2 };
  if (p.lineStyle === 'dashdot') return { color, dashed: true, dashSize: 4, gapSize: 1.5 };
  return { color, dashed: false, dashSize: 0, gapSize: 0 };
}

/**
 * Renders committed sketch primitives as three.js objects.
 * Rebuild the whole group whenever the primitives array changes (by joined-id + construction key).
 * Cheap — primitive count is small and geometry is simple.
 */
export class CommittedSketchRenderer {
  readonly group = new THREE.Group();
  private currentKey: string | null = null;

  update(
    primitives: ReadonlyArray<SketchPrimitive>,
    annotations: ReadonlyArray<TextAnnotation> = [],
  ): void {
    const key =
      primitives.map((p) => `${p.id}:${p.construction ? 1 : 0}`).join(',') +
      '##' +
      annotations.map((a) => `${a.id}:${a.value}:${a.height}:${a.rotation}`).join('|');
    if (key === this.currentKey) return;
    this.currentKey = key;
    this.clear();
    for (const p of primitives) this.group.add(this.buildObject(p));
    for (const a of annotations) this.group.add(this.buildAnnotation(a));
  }

  private buildObject(p: SketchPrimitive): THREE.Object3D {
    const spec = materialSpec(p);
    const mat: THREE.LineBasicMaterial | THREE.LineDashedMaterial = spec.dashed
      ? new THREE.LineDashedMaterial({ color: spec.color, dashSize: spec.dashSize, gapSize: spec.gapSize })
      : new THREE.LineBasicMaterial({ color: spec.color });
    const obj = this.buildGeometry(p, mat);
    if (spec.dashed) {
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

  private buildAnnotation(ann: TextAnnotation): THREE.Mesh {
    const PX_PER_UNIT = 32; // canvas resolution; world size comes from the plane, not this
    const fontPx = Math.max(8, Math.round(ann.height * PX_PER_UNIT));
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    // Set font BEFORE measureText so the measurement uses the real font size (default ~10px otherwise).
    if (ctx) ctx.font = `${fontPx}px sans-serif`;
    // In jsdom/vitest ctx may be null; guard width/height so geometry remains valid.
    const textW = ctx ? Math.max(1, ctx.measureText(ann.value).width) : Math.max(1, ann.value.length * fontPx * 0.6);
    canvas.width = Math.ceil(textW);
    canvas.height = Math.ceil(fontPx * 1.25);
    if (ctx) {
      // re-set font after resize (resizing clears the context state)
      ctx.font = `${fontPx}px sans-serif`;
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#ffffff';
      ctx.fillText(ann.value, 0, canvas.height / 2);
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthTest: false });
    const worldH = ann.height;
    const worldW = (canvas.width / canvas.height) * worldH;
    const geometry = new THREE.PlaneGeometry(worldW, worldH);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(ann.x + worldW / 2, ann.y, SKETCH_Z); // PlaneGeometry is centered; left-anchor at ann.x
    mesh.rotation.z = ann.rotation;
    return mesh;
  }

  private clear(): void {
    while (this.group.children.length > 0) {
      const obj = this.group.children[0] as THREE.Line | THREE.Mesh;
      this.group.remove(obj);
      obj.geometry.dispose();
      const mat = obj.material as THREE.Material & { map?: THREE.Texture | null };
      mat.map?.dispose();
      mat.dispose();
    }
  }

  dispose(): void {
    this.clear();
  }
}

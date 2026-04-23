import * as THREE from 'three';
import { SnapMarker } from './SnapMarker';
import { AxisHint } from './AxisHint';

/**
 * Holds transient visual feedback during sketching: snap markers,
 * axis hints, and the in-progress draft primitive preview polyline.
 * Lives as a separate three.js group so CommittedSketchRenderer's
 * children don't mix with drafts.
 */
export class SketchOverlay {
  readonly group: THREE.Group;
  readonly snapMarker = new SnapMarker();
  readonly axisHint = new AxisHint();
  private draftLine: THREE.Line;
  private draftGeom: THREE.BufferGeometry;
  private draftMat: THREE.LineBasicMaterial;

  constructor() {
    this.group = new THREE.Group();
    this.group.add(this.snapMarker.object);
    this.group.add(this.axisHint.object);

    this.draftGeom = new THREE.BufferGeometry();
    this.draftGeom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(600), 3));
    this.draftMat = new THREE.LineBasicMaterial({ color: 0x4f8cff, transparent: true, opacity: 0.7 });
    this.draftLine = new THREE.Line(this.draftGeom, this.draftMat);
    this.draftLine.visible = false;
    this.draftLine.renderOrder = 8;
    this.group.add(this.draftLine);
  }

  /** Replace the draft polyline. Set `points` to empty or fewer than 2 to hide. */
  setDraftPolyline(points: Array<{ x: number; y: number }>): void {
    if (points.length < 2) {
      this.draftLine.visible = false;
      return;
    }
    const needed = points.length * 3;
    let posAttr = this.draftGeom.attributes.position as THREE.BufferAttribute | undefined;
    const existing = posAttr ? (posAttr.array as Float32Array) : new Float32Array(0);
    if (!posAttr || needed > existing.length) {
      posAttr = new THREE.BufferAttribute(new Float32Array(needed), 3);
      this.draftGeom.setAttribute('position', posAttr);
    }
    const data = posAttr.array as Float32Array;
    for (let i = 0; i < points.length; i++) {
      data[i * 3]     = points[i]!.x;
      data[i * 3 + 1] = points[i]!.y;
      data[i * 3 + 2] = 0.01;
    }
    this.draftGeom.setDrawRange(0, points.length);
    posAttr.needsUpdate = true;
    this.draftLine.visible = true;
  }

  clearDraft(): void {
    this.draftLine.visible = false;
  }

  dispose(): void {
    this.snapMarker.dispose();
    this.axisHint.dispose();
    this.draftGeom.dispose();
    this.draftMat.dispose();
  }
}

import * as THREE from 'three';

/** Dashed line from anchor along a direction (horizontal or vertical). */
export class AxisHint {
  readonly object: THREE.Line;
  private material: THREE.LineDashedMaterial;
  private geom: THREE.BufferGeometry;

  constructor(color = 0x666666) {
    this.geom = new THREE.BufferGeometry();
    this.geom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    this.material = new THREE.LineDashedMaterial({ color, dashSize: 2, gapSize: 2, transparent: true, opacity: 0.8 });
    this.object = new THREE.Line(this.geom, this.material);
    this.object.visible = false;
    this.object.renderOrder = 9;
  }

  showHorizontal(anchor: { x: number; y: number }, cursor: { x: number; y: number }): void {
    this.setPoints(anchor.x, anchor.y, cursor.x, anchor.y);
  }

  showVertical(anchor: { x: number; y: number }, cursor: { x: number; y: number }): void {
    this.setPoints(anchor.x, anchor.y, anchor.x, cursor.y);
  }

  hide(): void {
    this.object.visible = false;
  }

  private setPoints(x1: number, y1: number, x2: number, y2: number): void {
    const pos = this.geom.attributes.position as THREE.BufferAttribute;
    (pos.array as Float32Array).set([x1, y1, 0.01, x2, y2, 0.01]);
    pos.needsUpdate = true;
    this.object.computeLineDistances();
    this.object.visible = true;
  }

  dispose(): void {
    this.geom.dispose();
    this.material.dispose();
  }
}

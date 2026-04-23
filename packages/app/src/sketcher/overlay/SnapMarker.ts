import * as THREE from 'three';

/** A small square marker at a given world point on the XY plane. */
export class SnapMarker {
  readonly object: THREE.Mesh;
  private material: THREE.MeshBasicMaterial;

  constructor() {
    const geom = new THREE.PlaneGeometry(3, 3);
    this.material = new THREE.MeshBasicMaterial({ color: 0xffcc00, transparent: true, opacity: 0.9 });
    this.object = new THREE.Mesh(geom, this.material);
    this.object.visible = false;
    this.object.renderOrder = 10;
  }

  show(x: number, y: number): void {
    this.object.position.set(x, y, 0.01);
    this.object.visible = true;
  }

  hide(): void {
    this.object.visible = false;
  }

  dispose(): void {
    (this.object.geometry as THREE.BufferGeometry).dispose();
    this.material.dispose();
  }
}

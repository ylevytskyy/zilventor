import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export class SceneManager {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  readonly controls: OrbitControls;
  private current: THREE.Mesh | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.scene.background = new THREE.Color(0x1a2028);

    this.camera = new THREE.PerspectiveCamera(40, 1, 0.1, 10000);
    this.camera.position.set(400, 400, 400);
    this.camera.lookAt(0, 0, 0);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.1;

    const grid = new THREE.GridHelper(500, 10, 0x444444, 0x222222);
    grid.rotateX(Math.PI / 2);
    this.scene.add(grid);

    const light = new THREE.HemisphereLight(0xffffff, 0x202020, 1.0);
    this.scene.add(light);
  }

  setSize(w: number, h: number): void {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
  }

  setMesh(positions: Float32Array, indices: Uint32Array, normals?: Float32Array): void {
    if (this.current) {
      this.scene.remove(this.current);
      this.current.geometry.dispose();
      (this.current.material as THREE.Material).dispose();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    if (normals) g.setAttribute('normal', new THREE.BufferAttribute(normals, 3)); else g.computeVertexNormals();
    g.setIndex(new THREE.BufferAttribute(indices, 1));
    const m = new THREE.MeshStandardMaterial({ color: 0xc8c8c8, flatShading: true });
    this.current = new THREE.Mesh(g, m);
    this.scene.add(this.current);
  }

  render(): void {
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.controls.dispose();
    this.renderer.dispose();
    this.scene.traverse((o) => {
      if ((o as THREE.Mesh).geometry) (o as THREE.Mesh).geometry.dispose();
    });
  }
}

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

  /**
   * Render the current scene at a requested size and return the PNG bytes.
   * We temporarily resize the WebGL canvas so the framebuffer matches the
   * requested thumbnail dimensions (keeping aspect-correct projection), grab
   * a PNG blob from the canvas, then restore the prior size. Callers should
   * follow up by invoking `setSize()` with the real viewport extent or rely
   * on the ResizeObserver fallback.
   */
  async captureThumbnail(w: number, h: number): Promise<Uint8Array> {
    const prev = {
      w: this.renderer.domElement.width,
      h: this.renderer.domElement.height
    };
    this.setSize(w, h);
    this.render();
    const canvas = this.renderer.domElement;
    const blob: Blob | null = await new Promise((resolve) =>
      canvas.toBlob((b) => resolve(b), 'image/png')
    );
    // Always restore prior framebuffer size, even if toBlob failed.
    this.setSize(prev.w || 1, prev.h || 1);
    if (!blob) throw new Error('thumbnail capture failed');
    return new Uint8Array(await blob.arrayBuffer());
  }

  dispose(): void {
    this.controls.dispose();
    this.renderer.dispose();
    this.scene.traverse((o) => {
      if ((o as THREE.Mesh).geometry) (o as THREE.Mesh).geometry.dispose();
    });
  }
}

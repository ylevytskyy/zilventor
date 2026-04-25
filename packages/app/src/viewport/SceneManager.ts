import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export class SceneManager {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  readonly controls: OrbitControls;
  private current: THREE.Mesh | null = null;
  private preview: THREE.Mesh | null = null;
  private componentMeshes = new Map<string, THREE.Mesh>();
  private componentMaterial = new THREE.MeshStandardMaterial({ color: 0xc8c8c8, flatShading: true });
  private partGeometryHash: number = 2166136261;

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

  getCamera(): THREE.PerspectiveCamera { return this.camera; }
  getControls(): OrbitControls { return this.controls; }
  getScene(): THREE.Scene { return this.scene; }
  addObject(obj: THREE.Object3D): void { this.scene.add(obj); }
  getCurrentMesh(): THREE.Mesh | null { return this.current; }
  removeObject(obj: THREE.Object3D): void { this.scene.remove(obj); }

  setMesh(positions: Float32Array, indices: Uint32Array): void {
    if (this.current) {
      this.scene.remove(this.current);
      this.current.geometry.dispose();
      (this.current.material as THREE.Material).dispose();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    g.setIndex(new THREE.BufferAttribute(indices, 1));
    g.computeVertexNormals();
    const m = new THREE.MeshStandardMaterial({ color: 0xc8c8c8, flatShading: true });
    this.current = new THREE.Mesh(g, m);
    this.scene.add(this.current);
    let h = 2166136261;
    for (let k = 0; k < positions.length; k++) {
      h = Math.imul(h ^ Math.round(positions[k]! * 1000), 16777619);
    }
    this.partGeometryHash = h;
  }

  geometryHash(): string {
    let h = this.partGeometryHash >>> 0;
    const ids = Array.from(this.componentMeshes.keys()).sort();
    for (const id of ids) {
      const mesh = this.componentMeshes.get(id)!;
      for (let i = 0; i < id.length; i++) {
        h = Math.imul(h ^ id.charCodeAt(i), 16777619);
      }
      const e = mesh.matrix.elements;
      for (let i = 0; i < 16; i++) {
        h = Math.imul(h ^ Math.round(e[i]! * 1000), 16777619);
      }
    }
    return (h >>> 0).toString(16);
  }

  /**
   * Render (or replace) a translucent preview mesh — used by live-preview
   * flows such as RevolveDialog to show a 50% opacity ghost of the in-progress
   * feature. Disposes the prior preview geometry/material before creating a
   * new one. Passing `null` just clears the preview.
   */
  setPreviewMesh(positions: Float32Array, indices: Uint32Array): void {
    this.clearPreviewMesh();
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    g.setIndex(new THREE.BufferAttribute(indices, 1));
    g.computeVertexNormals();
    const m = new THREE.MeshStandardMaterial({
      color: 0xe8c36a,
      flatShading: true,
      transparent: true,
      opacity: 0.5,
      depthWrite: false
    });
    this.preview = new THREE.Mesh(g, m);
    this.scene.add(this.preview);
  }

  clearPreviewMesh(): void {
    if (!this.preview) return;
    this.scene.remove(this.preview);
    this.preview.geometry.dispose();
    (this.preview.material as THREE.Material).dispose();
    this.preview = null;
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

  setComponentMeshes(specs: Array<{
    componentId: string;
    geometry: THREE.BufferGeometry;
    transform: THREE.Matrix4;
    visible: boolean;
  }>): void {
    const incomingIds = new Set(specs.map((s) => s.componentId));

    // Remove meshes that aren't in the incoming list
    for (const [id, mesh] of this.componentMeshes) {
      if (!incomingIds.has(id)) {
        this.scene.remove(mesh);
        // Don't dispose geometry — it may be shared
        this.componentMeshes.delete(id);
      }
    }

    // Add or update
    for (const spec of specs) {
      let mesh = this.componentMeshes.get(spec.componentId);
      if (!mesh) {
        mesh = new THREE.Mesh(spec.geometry, this.componentMaterial);
        mesh.matrixAutoUpdate = false;
        mesh.userData.componentId = spec.componentId;
        this.scene.add(mesh);
        this.componentMeshes.set(spec.componentId, mesh);
      }
      mesh.geometry = spec.geometry;
      mesh.matrix.copy(spec.transform);
      mesh.visible = spec.visible;
    }
  }

  clearComponentMeshes(): void {
    for (const mesh of this.componentMeshes.values()) {
      this.scene.remove(mesh);
    }
    this.componentMeshes.clear();
  }

  componentMeshCount(): number {
    return this.componentMeshes.size;
  }

  getComponentMesh(id: string): THREE.Mesh | undefined {
    return this.componentMeshes.get(id);
  }

  dispose(): void {
    this.controls.dispose();
    this.renderer.dispose();
    this.scene.traverse((o) => {
      if ((o as THREE.Mesh).geometry) (o as THREE.Mesh).geometry.dispose();
    });
  }
}

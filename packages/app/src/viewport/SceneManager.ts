import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export type Vec3 = { x: number; y: number; z: number };
export type WorkFeatureSpec =
  | { featureId: string; kind: 'axis'; origin: Vec3; direction: Vec3; visible: boolean }
  | { featureId: string; kind: 'plane'; origin: Vec3; normal: Vec3; visible: boolean }
  | { featureId: string; kind: 'point'; origin: Vec3; visible: boolean };


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
  private workFeatureNodes = new Map<string, THREE.Object3D>();
  private workFeatureMaterials = {
    axis: new THREE.LineDashedMaterial({ color: 0xe8c36a, dashSize: 8, gapSize: 4, depthTest: false }),
    planeFill: new THREE.MeshBasicMaterial({
      color: 0x5b9ad8, opacity: 0.15, transparent: true,
      side: THREE.DoubleSide, depthWrite: false,
    }),
    planeBorder: new THREE.LineBasicMaterial({ color: 0x5b9ad8, depthTest: false }),
    point: new THREE.LineBasicMaterial({ color: 0x7ed957, depthTest: false }),
  };

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
    const wfIds = Array.from(this.workFeatureNodes.keys()).sort();
    for (const id of wfIds) {
      const node = this.workFeatureNodes.get(id)!;
      if (!node.visible) continue;
      const spec = node.userData.workFeatureSpec as WorkFeatureSpec | undefined;
      if (!spec) continue;
      for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
      h = Math.imul(h ^ Math.round(spec.origin.x * 1000), 16777619);
      h = Math.imul(h ^ Math.round(spec.origin.y * 1000), 16777619);
      h = Math.imul(h ^ Math.round(spec.origin.z * 1000), 16777619);
      if (spec.kind === 'axis') {
        h = Math.imul(h ^ Math.round(spec.direction.x * 10000), 16777619);
        h = Math.imul(h ^ Math.round(spec.direction.y * 10000), 16777619);
        h = Math.imul(h ^ Math.round(spec.direction.z * 10000), 16777619);
      } else if (spec.kind === 'plane') {
        h = Math.imul(h ^ Math.round(spec.normal.x * 10000), 16777619);
        h = Math.imul(h ^ Math.round(spec.normal.y * 10000), 16777619);
        h = Math.imul(h ^ Math.round(spec.normal.z * 10000), 16777619);
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
    pose?: { translation: { x: number; y: number; z: number }; quaternion: [number, number, number, number] };
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
      if (spec.pose) {
        const m = new THREE.Matrix4();
        const q = new THREE.Quaternion(
          spec.pose.quaternion[0],
          spec.pose.quaternion[1],
          spec.pose.quaternion[2],
          spec.pose.quaternion[3],
        );
        m.makeRotationFromQuaternion(q);
        m.setPosition(spec.pose.translation.x, spec.pose.translation.y, spec.pose.translation.z);
        mesh.matrix.copy(m);
      } else {
        mesh.matrix.copy(spec.transform);
      }
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

  raycastComponent(camera: THREE.Camera, ndc: THREE.Vector2): string | null {
    if (this.componentMeshes.size === 0) return null;
    // Component meshes are matrixAutoUpdate=false; force world matrices to reflect manually-set local matrices
    for (const m of this.componentMeshes.values()) {
      m.updateMatrixWorld(true);
    }
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(ndc, camera);
    const meshes = Array.from(this.componentMeshes.values());
    const hits = raycaster.intersectObjects(meshes, false);
    if (hits.length === 0) return null;
    const id = hits[0]!.object.userData.componentId;
    return typeof id === 'string' ? id : null;
  }

  setWorkFeatures(specs: Array<WorkFeatureSpec>): void {
    const incoming = new Set(specs.map((s) => s.featureId));
    for (const [id, node] of this.workFeatureNodes) {
      if (!incoming.has(id)) {
        this.scene.remove(node);
        this.workFeatureNodes.delete(id);
      }
    }
    for (const spec of specs) {
      let node = this.workFeatureNodes.get(spec.featureId);
      if (!node) {
        node = this.buildWorkFeatureNode(spec);
        node.userData.workFeatureId = spec.featureId;
        this.scene.add(node);
        this.workFeatureNodes.set(spec.featureId, node);
      } else {
        this.updateWorkFeatureNode(node, spec);
      }
      // Stash the spec on the node so geometryHash() and pickers can read it
      // without re-deriving from the scene-graph geometry. Axis direction in
      // particular isn't recoverable from a Line node's transform.
      node.userData.workFeatureSpec = spec;
      node.visible = spec.visible;
    }
  }

  clearWorkFeatures(): void {
    for (const n of this.workFeatureNodes.values()) this.scene.remove(n);
    this.workFeatureNodes.clear();
  }

  workFeatureCount(): number { return this.workFeatureNodes.size; }
  getWorkFeatureNode(id: string): THREE.Object3D | undefined { return this.workFeatureNodes.get(id); }

  raycastWorkFeature(camera: THREE.Camera, ndc: THREE.Vector2): string | null {
    if (this.workFeatureNodes.size === 0) return null;
    for (const n of this.workFeatureNodes.values()) n.updateMatrixWorld(true);
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(ndc, camera);
    const objs = Array.from(this.workFeatureNodes.values());
    const hits = raycaster.intersectObjects(objs, true);
    if (hits.length === 0) return null;
    let obj: THREE.Object3D | null = hits[0]!.object;
    while (obj && !obj.userData.workFeatureId) obj = obj.parent ?? null;
    if (obj && typeof obj.userData.workFeatureId === 'string') return obj.userData.workFeatureId;
    return null;
  }

  private buildWorkFeatureNode(spec: WorkFeatureSpec): THREE.Object3D {
    if (spec.kind === 'axis') {
      const dir = new THREE.Vector3(spec.direction.x, spec.direction.y, spec.direction.z).normalize();
      const half = 100;
      const o = new THREE.Vector3(spec.origin.x, spec.origin.y, spec.origin.z);
      const p1 = o.clone().addScaledVector(dir, -half);
      const p2 = o.clone().addScaledVector(dir, half);
      const g = new THREE.BufferGeometry().setFromPoints([p1, p2]);
      const line = new THREE.Line(g, this.workFeatureMaterials.axis);
      line.computeLineDistances();
      return line;
    }
    if (spec.kind === 'plane') {
      const group = new THREE.Group();
      const planeGeom = new THREE.PlaneGeometry(200, 200);
      const fill = new THREE.Mesh(planeGeom, this.workFeatureMaterials.planeFill);
      group.add(fill);
      const edges = new THREE.EdgesGeometry(planeGeom);
      const border = new THREE.LineSegments(edges, this.workFeatureMaterials.planeBorder);
      group.add(border);
      this.orientPlaneGroup(group, spec);
      return group;
    }
    // point
    const group = new THREE.Group();
    const half = 3;
    const make = (axis: 'x' | 'y' | 'z'): THREE.Line => {
      const a = new THREE.Vector3();
      const b = new THREE.Vector3();
      a[axis] = -half;
      b[axis] = half;
      const g = new THREE.BufferGeometry().setFromPoints([a, b]);
      return new THREE.Line(g, this.workFeatureMaterials.point);
    };
    group.add(make('x'));
    group.add(make('y'));
    group.add(make('z'));
    group.position.set(spec.origin.x, spec.origin.y, spec.origin.z);
    return group;
  }

  private updateWorkFeatureNode(node: THREE.Object3D, spec: WorkFeatureSpec): void {
    if (spec.kind === 'axis') {
      const line = node as THREE.Line;
      const dir = new THREE.Vector3(spec.direction.x, spec.direction.y, spec.direction.z).normalize();
      const half = 100;
      const o = new THREE.Vector3(spec.origin.x, spec.origin.y, spec.origin.z);
      const p1 = o.clone().addScaledVector(dir, -half);
      const p2 = o.clone().addScaledVector(dir, half);
      line.geometry.setFromPoints([p1, p2]);
      line.computeLineDistances();
      return;
    }
    if (spec.kind === 'plane') {
      this.orientPlaneGroup(node as THREE.Group, spec);
      return;
    }
    // point
    node.position.set(spec.origin.x, spec.origin.y, spec.origin.z);
  }

  private orientPlaneGroup(group: THREE.Group, spec: { origin: { x: number; y: number; z: number }; normal: { x: number; y: number; z: number } }): void {
    const target = new THREE.Vector3(spec.normal.x, spec.normal.y, spec.normal.z).normalize();
    const def = new THREE.Vector3(0, 0, 1);
    const q = new THREE.Quaternion().setFromUnitVectors(def, target);
    group.quaternion.copy(q);
    group.position.set(spec.origin.x, spec.origin.y, spec.origin.z);
  }


  dispose(): void {
    this.controls.dispose();
    this.renderer.dispose();
    this.scene.traverse((o) => {
      if ((o as THREE.Mesh).geometry) (o as THREE.Mesh).geometry.dispose();
    });
  }
}

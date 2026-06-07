import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { computeCameraFrame } from './frameView';
import { pathKey, findTextureDef, type ComponentPath, type ComponentPathKey, type MaterialEntry, type PanelEdgeKey } from '@zilventor/shared';
import { globalTextureCache } from './textureCache';
import { useAppStore } from '../store/useAppStore';
import type { CustomTextureRegistry } from '../textures/customTextureRegistry';

export type Vec3 = { x: number; y: number; z: number };
export type WorkFeatureSpec =
  | { featureId: string; kind: 'axis'; origin: Vec3; direction: Vec3; visible: boolean }
  | { featureId: string; kind: 'plane'; origin: Vec3; normal: Vec3; visible: boolean }
  | { featureId: string; kind: 'point'; origin: Vec3; visible: boolean };

export type ComponentLeaf = {
  kind: 'leaf' | 'placeholder';
  componentPath: ComponentPath;
  partPath: string;
  worldPose: { translation: Vec3; quaternion: [number, number, number, number] };
  materialColor?: string;
  textureId?: string;
  visible: boolean;
};

/**
 * T29: Specification for the four edge-band overlays of one panel-bearing
 * part. The caller (App.tsx) walks the active part's featureTree, finds each
 * `kind: 'panel'` feature, resolves its L/W/T against the part parameters,
 * and emits one PanelOverlaySpec per panel. SceneManager classifies the four
 * top-rim edges geometrically (panel sits Z=0..T centred at X=0,Y=0):
 *   front +Y, back -Y, left -X, right +X — all on the top face Z=T.
 *
 * `edgeBands[k] = null` means "no band on this edge"; an entry with a
 * `materialId` looks up the color in `materials`. Unresolved materialIds
 * fall back to the warning color #cfa84b.
 */
export type PanelOverlaySpec = {
  /** Stable key for this panel within the scene (e.g. partPath + featureId). */
  key: string;
  length: number;
  width: number;
  thickness: number;
  edgeBands: { readonly [K in PanelEdgeKey]: { materialId: string } | null };
};


export class SceneManager {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  readonly controls: OrbitControls;
  private current: THREE.Mesh | null = null;
  private preview: THREE.Mesh | null = null;
  // One-shot "frame the camera to the model on the next mesh upload". Armed by
  // the App when a new 3D document is shown so an opened model is fit to view
  // (the camera is otherwise hardcoded for ~500mm parts and buries itself in
  // large imports); cleared after framing so edits don't yank the camera.
  private frameOnNextMesh = false;
  // T28: keyed by ComponentPathKey (pathKey(componentPath))
  private componentMeshes = new Map<ComponentPathKey, THREE.Mesh>();
  // T28: per-partPath geometry cache. Callers register geometry for each unique
  // .zipt partPath via setPartGeometry(); setComponentMeshes() looks up the
  // shared BufferGeometry for each leaf. Sub-asm leaves with the same partPath
  // share geometry across instances.
  private partGeometries = new Map<string, THREE.BufferGeometry>();
  private placeholderGeometry: THREE.BufferGeometry | null = null;
  private componentMaterial = new THREE.MeshStandardMaterial({ color: 0xc8c8c8, flatShading: true, side: THREE.DoubleSide });
  private colorMaterials: Map<string, THREE.MeshStandardMaterial> = new Map();
  private selectionOverlayMaterial: THREE.LineBasicMaterial | null = null;
  // T29: selection overlays keyed by ComponentPathKey
  private selectionOverlays: Map<ComponentPathKey, THREE.LineSegments> = new Map();
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
  // T29: edge-band overlay state. `edgeBandOverlays` are world-space
  // LineSegments added to the scene; `panelOverlaySpecs` is the last-known
  // list (rebuilt on flag toggle without recomputation by the caller);
  // `materialColorMap` maps materialId -> hex color. Falls back to
  // EDGE_BAND_FALLBACK_COLOR (#cfa84b) when a band's materialId is
  // unresolved. Default `showEdgeBands` is true so initial render shows
  // bands as soon as a panel-bearing geometry registers.
  private edgeBandOverlays: THREE.LineSegments[] = [];
  private panelOverlaySpecs: PanelOverlaySpec[] = [];
  private materialColorMap: Map<string, string> = new Map();
  private showEdgeBands = true;
  private storeUnsubscribers: Array<() => void> = [];
  private customTextureRegistry: CustomTextureRegistry | null = null;
  private static readonly EDGE_BAND_FALLBACK_COLOR = '#cfa84b';


  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: true });
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
  /** @internal For tests only. Returns the current part geometry or null. */
  currentGeometry(): THREE.BufferGeometry | null {
    return this.current?.geometry ?? null;
  }
  /** @internal For tests only. Returns the current part mesh material or null. */
  getCurrentMaterial(): THREE.Material | null {
    return (this.current?.material as THREE.Material) ?? null;
  }
  setCustomTextureRegistry(r: CustomTextureRegistry | null): void {
    this.customTextureRegistry = r;
    // Clear texture-id-keyed caches so rebuilt registries (new blob URLs for
    // the same textureId ulids) don't serve stale revoked-URL materials.
    for (const mat of this.colorMaterials.values()) mat.dispose();
    this.colorMaterials.clear();
    globalTextureCache.disposeTextures();
  }
  removeObject(obj: THREE.Object3D): void { this.scene.remove(obj); }

  setMesh(positions: Float32Array, indices: Uint32Array, colorHex?: string, uv?: Float32Array, textureId?: string): void {
    if (this.current) {
      this.scene.remove(this.current);
      this.current.geometry.dispose();
      (this.current.material as THREE.Material).dispose();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    g.setIndex(new THREE.BufferAttribute(indices, 1));
    if (uv) {
      g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    }
    g.computeVertexNormals();
    const m = textureId
      ? this.buildMaterial(textureId, colorHex ?? '#ffffff')
      : new THREE.MeshStandardMaterial({ color: colorHex ?? 0xc8c8c8, flatShading: true, side: THREE.DoubleSide });
    this.current = new THREE.Mesh(g, m);
    this.scene.add(this.current);
    let h = 2166136261;
    for (let k = 0; k < positions.length; k++) {
      h = Math.imul(h ^ Math.round(positions[k]! * 1000), 16777619);
    }
    this.partGeometryHash = h;
    // T29: a fresh part geometry replaces any previous panel; rebuild bands.
    this.rebuildEdgeBandOverlays();
    this.maybeFrameToModel();
  }

  /** Arm a one-shot camera fit-to-model on the next mesh upload. */
  requestFrameOnNextMesh(): void {
    this.frameOnNextMesh = true;
  }

  private maybeFrameToModel(): void {
    if (!this.frameOnNextMesh) return;
    if (this.frameToModel()) this.frameOnNextMesh = false;
  }

  /**
   * Frame the camera to the current renderable geometry (part mesh + visible
   * component meshes), preserving the current view direction and deriving
   * near/far from the model size. Returns false (leaving any pending request
   * armed) when there is no geometry yet to measure.
   */
  frameToModel(): boolean {
    this.scene.updateMatrixWorld(true);
    const box = new THREE.Box3();
    let has = false;
    if (this.current) { box.expandByObject(this.current); has = true; }
    for (const mesh of this.componentMeshes.values()) {
      if (!mesh.visible) continue;
      box.expandByObject(mesh);
      has = true;
    }
    if (!has || box.isEmpty()) return false;

    const dir = this.camera.position.clone().sub(this.controls.target);
    const frame = computeCameraFrame(box, this.camera.fov, this.camera.aspect, dir);
    this.camera.position.copy(frame.position);
    this.camera.near = frame.near;
    this.camera.far = frame.far;
    this.camera.updateProjectionMatrix();
    this.controls.target.copy(frame.target);
    this.controls.update();
    return true;
  }

  geometryHash(): string {
    let h = this.partGeometryHash >>> 0;
    const ids = Array.from(this.componentMeshes.keys()).sort();
    for (const id of ids) {
      const mesh = this.componentMeshes.get(id);
      if (!mesh) continue;
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

  /**
   * T28: Register a tessellated geometry for a partPath. setComponentMeshes()
   * looks up geometry per leaf via this cache, so multiple instances of the
   * same .zipt share one BufferGeometry.
   */
  setPartGeometry(partPath: string, geometry: THREE.BufferGeometry): void {
    this.partGeometries.set(partPath, geometry);
  }

  hasPartGeometry(partPath: string): boolean {
    return this.partGeometries.has(partPath);
  }

  private getPlaceholderGeometry(): THREE.BufferGeometry {
    if (!this.placeholderGeometry) {
      this.placeholderGeometry = new THREE.BoxGeometry(50, 50, 50);
    }
    return this.placeholderGeometry;
  }

  private buildMaterial(textureId: string | undefined, tintHex: string): THREE.MeshStandardMaterial {
    if (textureId) {
      const def = findTextureDef(textureId) ?? this.customTextureRegistry?.get(textureId);
      if (def) {
        const texSet = globalTextureCache.loadTextureSet(def);
        return new THREE.MeshStandardMaterial({
          map: texSet.albedo,
          normalMap: texSet.normal,
          roughnessMap: texSet.roughness,
          color: tintHex,
          side: THREE.DoubleSide,
        });
      }
    }
    return new THREE.MeshStandardMaterial({ color: tintHex, side: THREE.DoubleSide });
  }

  setComponentMeshes(leaves: ComponentLeaf[]): void {
    const incomingKeys = new Set(leaves.map((l) => pathKey(l.componentPath)));

    // Remove meshes that aren't in the incoming list
    for (const [key, mesh] of this.componentMeshes) {
      if (!incomingKeys.has(key)) {
        this.scene.remove(mesh);
        // Don't dispose geometry — it's shared via the partGeometries cache
        this.componentMeshes.delete(key);
      }
    }

    // Add or update
    for (const leaf of leaves) {
      const key = pathKey(leaf.componentPath);
      const geom = this.partGeometries.get(leaf.partPath) ?? this.getPlaceholderGeometry();
      let mesh = this.componentMeshes.get(key);
      if (!mesh) {
        mesh = new THREE.Mesh(geom, this.componentMaterial);
        mesh.matrixAutoUpdate = false;
        // T28: store the path on the mesh so pickers / overlays can match by path
        mesh.userData.componentPath = [...leaf.componentPath];
        this.scene.add(mesh);
        this.componentMeshes.set(key, mesh);
      } else {
        mesh.userData.componentPath = [...leaf.componentPath];
      }
      mesh.geometry = geom;
      const m = new THREE.Matrix4();
      const q = new THREE.Quaternion(
        leaf.worldPose.quaternion[0],
        leaf.worldPose.quaternion[1],
        leaf.worldPose.quaternion[2],
        leaf.worldPose.quaternion[3],
      );
      m.makeRotationFromQuaternion(q);
      m.setPosition(leaf.worldPose.translation.x, leaf.worldPose.translation.y, leaf.worldPose.translation.z);
      mesh.matrix.copy(m);
      if (leaf.materialColor || leaf.textureId) {
        const tintHex = leaf.materialColor ?? '#ffffff';
        const cacheKey = `${leaf.textureId ?? 'none'}|${tintHex}`;
        let mat = this.colorMaterials.get(cacheKey);
        if (!mat) {
          mat = this.buildMaterial(leaf.textureId, tintHex);
          this.colorMaterials.set(cacheKey, mat);
        }
        mesh.material = mat;
      } else {
        mesh.material = this.componentMaterial;
      }
      mesh.visible = leaf.visible;
    }
    // T29: assembly rebuilds may have replaced panel geometry; rebuild bands.
    this.rebuildEdgeBandOverlays();
    this.maybeFrameToModel();
  }

  /**
   * T29: Update the selection overlay set. Path-equality on each mesh's
   * userData.componentPath drives overlay attachment.
   */
  setSelectedComponentPaths(paths: ComponentPath[]): void {
    if (!this.selectionOverlayMaterial) {
      this.selectionOverlayMaterial = new THREE.LineBasicMaterial({ color: 0xff8800 });
    }
    const wantedKeys = new Set(paths.map((p) => pathKey(p)));
    for (const key of wantedKeys) {
      if (this.selectionOverlays.has(key)) continue;
      const mesh = this.componentMeshes.get(key);
      if (!mesh) continue;
      const edges = new THREE.EdgesGeometry(mesh.geometry);
      const overlay = new THREE.LineSegments(edges, this.selectionOverlayMaterial);
      overlay.userData.selectionOverlay = true;
      mesh.add(overlay);
      this.selectionOverlays.set(key, overlay);
    }
    for (const [key, overlay] of this.selectionOverlays) {
      if (wantedKeys.has(key)) continue;
      overlay.parent?.remove(overlay);
      overlay.geometry.dispose();
      this.selectionOverlays.delete(key);
    }
  }

  /** T29: test/picker hook — returns the keys of currently-attached overlays. */
  selectionOverlayPathKeys(): string[] {
    return Array.from(this.selectionOverlays.keys());
  }

  hasSelectionOverlay(key: ComponentPathKey): boolean {
    return this.selectionOverlays.has(key);
  }

  clearComponentMeshes(): void {
    for (const mesh of this.componentMeshes.values()) {
      this.scene.remove(mesh);
    }
    this.componentMeshes.clear();
  }

  /**
   * T29: Register the list of panel-bearing parts whose four top-rim edge
   * bands should be highlighted. The caller (App.tsx) walks the active
   * document's part(s), filters featureTree for `kind: 'panel'`, resolves
   * the L/W/T against the part's parameters, and emits one
   * `PanelOverlaySpec` per panel. `materials` is the active registry used
   * to look up each band's color.
   *
   * Calling this clears and rebuilds all current edge-band overlays. To
   * remove every overlay, pass `[]`.
   */
  setPanelOverlays(specs: PanelOverlaySpec[], materials: ReadonlyArray<MaterialEntry>): void {
    this.panelOverlaySpecs = specs.slice();
    this.materialColorMap = new Map(materials.map((m) => [m.id, m.color]));
    this.rebuildEdgeBandOverlays();
  }

  /**
   * T29/T30: Toggle visibility of the edge-band overlays. Subscribed to
   * `useAppStore.showEdgeBands` via `attach()`; tests drive it directly.
   */
  setShowEdgeBands(v: boolean): void {
    this.showEdgeBands = v;
    this.rebuildEdgeBandOverlays();
  }

  /**
   * T29: Drop existing overlays from the scene; if `showEdgeBands` is true,
   * rebuild one `THREE.LineSegments` per non-null band of every registered
   * panel. Edges are computed analytically from the panel's L/W/T (panel
   * sits centred on X/Y, Z=0..T):
   *   front (+Y), back (-Y) span L on the top face;
   *   left  (-X), right (+X) span W on the top face.
   */
  rebuildEdgeBandOverlays(): void {
    for (const overlay of this.edgeBandOverlays) {
      this.scene.remove(overlay);
      overlay.geometry.dispose();
      (overlay.material as THREE.Material).dispose();
    }
    this.edgeBandOverlays.length = 0;
    if (!this.showEdgeBands) return;
    for (const spec of this.panelOverlaySpecs) {
      const halfL = spec.length / 2;
      const halfW = spec.width / 2;
      const z = spec.thickness;
      const corners = {
        ftl: new THREE.Vector3(-halfL,  halfW, z),
        ftr: new THREE.Vector3( halfL,  halfW, z),
        bbl: new THREE.Vector3(-halfL, -halfW, z),
        bbr: new THREE.Vector3( halfL, -halfW, z),
      };
      const segments: Array<{ key: PanelEdgeKey; a: THREE.Vector3; b: THREE.Vector3 }> = [
        { key: 'front', a: corners.ftl, b: corners.ftr },
        { key: 'back',  a: corners.bbl, b: corners.bbr },
        { key: 'left',  a: corners.bbl, b: corners.ftl },
        { key: 'right', a: corners.bbr, b: corners.ftr },
      ];
      for (const seg of segments) {
        const band = spec.edgeBands[seg.key];
        if (!band) continue;
        const color = this.materialColorMap.get(band.materialId) ?? SceneManager.EDGE_BAND_FALLBACK_COLOR;
        const geom = new THREE.BufferGeometry().setFromPoints([seg.a, seg.b]);
        const mat = new THREE.LineBasicMaterial({ color, linewidth: 2 });
        const line = new THREE.LineSegments(geom, mat);
        line.userData.kind = 'edgeBand';
        line.userData.panelKey = spec.key;
        line.userData.edgeKey = seg.key;
        this.scene.add(line);
        this.edgeBandOverlays.push(line);
      }
    }
  }

  /** T29: test/debug accessor — count of currently-attached edge-band overlays. */
  edgeBandOverlayCount(): number {
    return this.edgeBandOverlays.length;
  }

  /** T29: test/debug accessor — read-only handle to the overlays. */
  edgeBandOverlayList(): ReadonlyArray<THREE.LineSegments> {
    return this.edgeBandOverlays;
  }

  /**
   * T30: Subscribe to `useAppStore.showEdgeBands` so the scene reflects the
   * View-tab toggle without the caller having to wire it manually. Fires
   * once immediately to align with the current store value.
   *
   * Returns the unsubscribe so callers can release it explicitly; the
   * SceneManager also tracks all subscriptions internally and releases
   * them in `dispose()`.
   */
  attach(): () => void {
    // Static-imported above so production wiring is a single module ref.
    this.setShowEdgeBands(useAppStore.getState().showEdgeBands);
    let lastShow = useAppStore.getState().showEdgeBands;
    const unsub = useAppStore.subscribe((s) => {
      if (s.showEdgeBands !== lastShow) {
        lastShow = s.showEdgeBands;
        this.setShowEdgeBands(s.showEdgeBands);
      }
    });
    this.storeUnsubscribers.push(unsub);
    return unsub;
  }



  componentMeshCount(): number {
    return this.componentMeshes.size;
  }

  /** T28: read accessor keyed by ComponentPathKey for tests/pickers. */
  componentMeshesByPathKey(): Map<ComponentPathKey, THREE.Mesh> {
    return this.componentMeshes;
  }

  getComponentMesh(key: ComponentPathKey): THREE.Mesh | undefined {
    return this.componentMeshes.get(key);
  }

  /**
   * T28/T30: returns the componentPath of the picked mesh (or null on miss).
   * Pickers consume this directly (no more componentId reads).
   */
  raycastComponent(camera: THREE.Camera, ndc: THREE.Vector2): ComponentPath | null {
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
    const path = hits[0]!.object.userData.componentPath;
    return Array.isArray(path) ? (path as ComponentPath) : null;
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
    for (const u of this.storeUnsubscribers) u();
    this.storeUnsubscribers.length = 0;
    for (const overlay of this.edgeBandOverlays) {
      this.scene.remove(overlay);
      overlay.geometry.dispose();
      (overlay.material as THREE.Material).dispose();
    }
    this.edgeBandOverlays.length = 0;
    this.renderer.dispose();
    for (const mat of this.colorMaterials.values()) mat.dispose();
    this.colorMaterials.clear();
    globalTextureCache.disposeTextures();
    if (this.selectionOverlayMaterial) {
      this.selectionOverlayMaterial.dispose();
      this.selectionOverlayMaterial = null;
    }
    for (const overlay of this.selectionOverlays.values()) {
      overlay.geometry.dispose();
    }
    this.selectionOverlays.clear();
    if (this.placeholderGeometry) {
      this.placeholderGeometry.dispose();
      this.placeholderGeometry = null;
    }
    this.scene.traverse((o) => {
      if ((o as THREE.Mesh).geometry) (o as THREE.Mesh).geometry.dispose();
    });
  }
}

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { computeCameraFrame } from './frameView';
import { pathKey, findTextureDef, face2DFrame, boreGizmoAxis, type BoreOp, type BoreConnectorKind, type PanelFaceRole, type ComponentPath, type ComponentPathKey, type MaterialEntry, type PanelEdgeKey } from '@zilventor/shared';
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

/**
 * Phase 5: one entry per assembly component that carries bores. SceneManager
 * builds a CircleGeometry/RingGeometry marker per bore, transformed first by the
 * face's panel-local 2D frame (face2DFrame), then by the component's world pose.
 */
export type MarkerOverlaySpec = {
  key: string;
  panelDims: { length: number; width: number; thickness: number };
  worldPose: { translation: { x: number; y: number; z: number }; quaternion: [number, number, number, number] };
  bores: BoreOp[];
  /** OPFS path of the owning panel .zipt; used by bore-selection and Edit/Move/Delete commands. */
  partPath: string;
};


// ---------------------------------------------------------------------------
// Slice-5 drag-gizmo helpers (module-private)
// ---------------------------------------------------------------------------

/** Build a double-arrow axis handle: thin cylinder shaft + two cone caps.
 *  Color 0xffaa00, depthTest:false so it renders on top. */
function buildAxisHandle(pos: Vec3, axis: Vec3): THREE.Object3D {
  const len = 24;
  const r = 1.2;
  const group = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: 0xffaa00, depthTest: false });
  const up = new THREE.Vector3(0, 1, 0);
  const dir = new THREE.Vector3(axis.x, axis.y, axis.z).normalize();
  // Shaft
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 12), mat);
  shaft.quaternion.setFromUnitVectors(up, dir);
  group.add(shaft);
  // Two cone caps
  for (const s of [1, -1] as const) {
    const cap = new THREE.Mesh(new THREE.ConeGeometry(r * 2.2, len * 0.25, 12), mat);
    cap.quaternion.setFromUnitVectors(up, dir.clone().multiplyScalar(s));
    cap.position.copy(dir.clone().multiplyScalar(s * len * 0.5));
    group.add(cap);
  }
  group.position.set(pos.x, pos.y, pos.z);
  group.renderOrder = 999;
  return group;
}

/** Traverse and dispose geometry + material on every Mesh in an Object3D tree. */
function disposeObject(o: THREE.Object3D): void {
  o.traverse((child) => {
    const m = child as THREE.Mesh;
    m.geometry?.dispose?.();
    (m.material as THREE.Material | undefined)?.dispose?.();
  });
}

// ---------------------------------------------------------------------------

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
  // SC-17: clash highlight overlays (red LineSegments, same pattern as selection overlays).
  private clashOverlays: Map<ComponentPathKey, THREE.LineSegments> = new Map();
  private clashOverlayMaterial: THREE.LineBasicMaterial | null = null;
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
  private boreMarkers: THREE.Mesh[] = [];
  private boreOverlaySpecs: MarkerOverlaySpec[] = [];
  private showBores = true;
  private boreGizmo: THREE.Object3D | null = null;
  private boreDragActive = false;
  private pendingMarkerRebuild = false;
  private storeUnsubscribers: Array<() => void> = [];
  private customTextureRegistry: CustomTextureRegistry | null = null;
  private static readonly EDGE_BAND_FALLBACK_COLOR = '#cfa84b';
  static readonly BORE_COLORS = {
    confirmat:   '#2e7dd1',
    minifix:     '#d14f2e',
    dowel:       '#2eb872',
    shelfPin:    '#b8a32e',   // amber
    hinge:       '#8c2eb8',   // violet
    drawerSlide:  '#7d2ed1',   // purple
    handleScrew:  '#2ec8c8',   // teal
  } satisfies Record<BoreConnectorKind, string>;


  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: true, alpha: true });
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
  /** @internal For tests only. Returns the number of cached part geometries. */
  partGeometryCount(): number { return this.partGeometries.size; }
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
   * Render the current 3D viewport at its current on-screen canvas size and
   * return the PNG bytes. No resize → no on-screen flicker (WYSIWYG).
   *
   * Opaque (transparent: false): uses the live scene background as-is.
   * Transparent (transparent: true): stashes/restores scene.background and
   * sets clear alpha to 0 around the capture; requires alpha: true on the
   * renderer constructor (added in Task 2).
   *
   * Requires preserveDrawingBuffer: true (already set in constructor).
   */
  async captureViewportPng({ transparent }: { transparent: boolean }): Promise<Uint8Array> {
    if (transparent) {
      const savedBackground = this.scene.background;
      try {
        this.scene.background = null;
        this.renderer.setClearAlpha(0);
        this.render();
        const canvas = this.renderer.domElement;
        const blob: Blob | null = await new Promise((resolve) =>
          canvas.toBlob((b) => resolve(b), 'image/png')
        );
        if (!blob) throw new Error('viewport PNG capture failed');
        return new Uint8Array(await blob.arrayBuffer());
      } finally {
        this.scene.background = savedBackground;
        this.renderer.setClearAlpha(1);
        this.render();
      }
    }
    // Opaque path — render at current canvas size, no setSize.
    this.render();
    const canvas = this.renderer.domElement;
    const blob: Blob | null = await new Promise((resolve) =>
      canvas.toBlob((b) => resolve(b), 'image/png')
    );
    if (!blob) throw new Error('viewport PNG capture failed');
    return new Uint8Array(await blob.arrayBuffer());
  }

  /**
   * Draw the live WebGL canvas into a `size × size` 2D canvas (center-cropped
   * to avoid aspect distortion) and return the PNG bytes. Does NOT call setSize
   * on the WebGL renderer → no on-screen flash. Calls render() first for a
   * fresh frame.
   */
  async captureThumbnailScaled(size: number): Promise<Uint8Array> {
    this.render();
    const src = this.renderer.domElement;
    const srcW = src.width;
    const srcH = src.height;

    // Largest centered square crop
    const cropSize = Math.min(srcW, srcH);
    const sx = Math.floor((srcW - cropSize) / 2);
    const sy = Math.floor((srcH - cropSize) / 2);

    const offscreen = document.createElement('canvas');
    offscreen.width = size;
    offscreen.height = size;
    const ctx = offscreen.getContext('2d')!;
    // drawImage(image, sx, sy, sWidth, sHeight, dx, dy, dWidth, dHeight)
    ctx.drawImage(src, sx, sy, cropSize, cropSize, 0, 0, size, size);

    const blob: Blob | null = await new Promise((resolve) =>
      offscreen.toBlob((b) => resolve(b), 'image/png')
    );
    if (!blob) throw new Error('thumbnail scaled capture failed');
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
        // Slice-6: store partPath for hardware-part counting
        mesh.userData.partPath = leaf.partPath;
        this.scene.add(mesh);
        this.componentMeshes.set(key, mesh);
      } else {
        mesh.userData.componentPath = [...leaf.componentPath];
        mesh.userData.partPath = leaf.partPath;
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

  /**
   * SC-17: Set the clash highlight overlays. Approach (b) — red LineSegments child,
   * same pattern as setSelectedComponentPaths (orange overlay). Composes cleanly:
   * both are children of the same mesh; different material colors.
   * Clears previous overlays before applying new ones (SC-13(d): no stale red).
   */
  setClashHighlight(pathKeys: string[]): void {
    if (!this.clashOverlayMaterial) {
      this.clashOverlayMaterial = new THREE.LineBasicMaterial({ color: 0xff2222 });
    }
    const wantedKeys = new Set(pathKeys);
    // Remove overlays for keys no longer wanted.
    for (const [key, overlay] of this.clashOverlays) {
      if (wantedKeys.has(key)) continue;
      overlay.parent?.remove(overlay);
      overlay.geometry.dispose();
      this.clashOverlays.delete(key);
    }
    // Add overlays for new keys.
    for (const key of wantedKeys) {
      if (this.clashOverlays.has(key)) continue;
      const mesh = this.componentMeshes.get(key);
      if (!mesh) continue;
      const edges = new THREE.EdgesGeometry(mesh.geometry);
      const overlay = new THREE.LineSegments(edges, this.clashOverlayMaterial);
      overlay.userData.clashOverlay = true;
      mesh.add(overlay);
      this.clashOverlays.set(key, overlay);
    }
  }

  /** Returns the keys of currently-attached clash highlight overlays. */
  clashHighlightPathKeys(): string[] {
    return Array.from(this.clashOverlays.keys());
  }

  /** Clears all clash highlights (call on re-run or panel close). */
  clearClashHighlight(): void {
    this.setClashHighlight([]);
  }

  clearComponentMeshes(): void {
    for (const mesh of this.componentMeshes.values()) {
      this.scene.remove(mesh);
    }
    this.componentMeshes.clear();
  }

  /**
   * Dispose every BufferGeometry in the per-partPath geometry cache and clear
   * the cache. Call on project switch so GPU memory from the previous project
   * is released rather than accumulating.
   *
   * Note: meshes in `componentMeshes` reference the same shared geometry
   * objects via the partGeometries map.  Callers must clear component meshes
   * (via clearComponentMeshes) BEFORE or AFTER calling this so the disposed
   * geometries are no longer referenced from scene objects.
   */
  disposeAllPartGeometries(): void {
    for (const geo of this.partGeometries.values()) {
      geo.dispose();
    }
    this.partGeometries.clear();
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

  /** Phase 5: store the per-component bore specs; rebuild markers if shown. */
  setBoreMarkers(specs: MarkerOverlaySpec[]): void {
    this.boreOverlaySpecs = specs.slice();
    this.rebuildBoreMarkers();
  }

  /** Phase 5: toggle bore-marker visibility (subscribed to useAppStore.showBores via attach()). */
  setShowBores(v: boolean): void {
    this.showBores = v;
    this.rebuildBoreMarkers();
  }

  /** Phase 5: test/debug accessor — count of attached bore markers. */
  boreMarkerCount(): number {
    return this.boreMarkers.length;
  }

  /** Slice-6: test/debug accessor — count of rendered scene meshes for hardware parts (partPath starts with 'hardware/'). */
  hardwarePartCount(): number {
    let count = 0;
    for (const mesh of this.componentMeshes.values()) {
      const partPath = mesh.userData.partPath as string | undefined;
      if (partPath && partPath.startsWith('hardware/')) count++;
    }
    return count;
  }

  /** Phase 5: test/debug accessor — read-only handle to the marker meshes. */
  boreMarkerList(): ReadonlyArray<THREE.Mesh> {
    return this.boreMarkers;
  }

  /** Phase 5: test/debug accessor — the last-set specs. */
  boreMarkerSpecList(): ReadonlyArray<MarkerOverlaySpec> {
    return this.boreOverlaySpecs;
  }

  /** Slice-5: set or clear the drag-active flag.  On deactivation, flushes any
   *  deferred rebuildBoreMarkers call (deferred so mid-drag cache-invalidations
   *  don't dispose the dragged marker mesh). */
  setBoreDragActive(active: boolean): void {
    this.boreDragActive = active;
    if (!active && this.pendingMarkerRebuild) {
      this.pendingMarkerRebuild = false;
      this.rebuildBoreMarkers();
    }
  }

  /** Slice-5: show (or clear with null) the double-arrow drag handle at a world
   *  position along a world axis. Clears and disposes any previous gizmo first. */
  setBoreGizmo(spec: { worldPos: Vec3; worldAxis: Vec3 } | null): void {
    if (this.boreGizmo) {
      this.scene.remove(this.boreGizmo);
      disposeObject(this.boreGizmo);
      this.boreGizmo = null;
    }
    if (!spec) return;
    this.boreGizmo = buildAxisHandle(spec.worldPos, spec.worldAxis);
    this.scene.add(this.boreGizmo);
  }

  /** Slice-5: probe for e2e (headless renders black, so pixel checks don't work). */
  boreGizmoVisible(): boolean {
    return this.boreGizmo !== null;
  }

  /** Slice-5: find a bore marker mesh by boreId + partPath (for live-move during drag). */
  findBoreMarkerMesh(boreId: string, partPath: string): THREE.Mesh | null {
    for (const m of this.boreMarkers) {
      if (m.userData.boreId === boreId && m.userData.partPath === partPath) {
        return m;
      }
    }
    return null;
  }

  /** Slice-5: return the world translation of a bore marker mesh, or null if not found.
   *  Calls updateMatrixWorld(true) so the result is valid even when matrixAutoUpdate=false. */
  boreWorldPos(boreId: string, partPath: string): Vec3 | null {
    const mesh = this.findBoreMarkerMesh(boreId, partPath);
    if (!mesh) return null;
    mesh.updateMatrixWorld(true);
    const e = mesh.matrixWorld.elements;
    return { x: e[12]!, y: e[13]!, z: e[14]! };
  }

  /** Slice-5 e2e probe: world point ON the ring face (not the center hole) for a given bore.
   *  Returns a point offset by the ring midpoint radius along the mesh local X axis (uDir of
   *  the face plane). Clicking/raycasting this point hits the ring triangles, not the hollow
   *  center. Returns null if the marker mesh is not found. */
  boreMarkerHitPoint(boreId: string, partPath: string): Vec3 | null {
    const mesh = this.findBoreMarkerMesh(boreId, partPath);
    if (!mesh) return null;
    mesh.updateMatrixWorld(true);
    const e = mesh.matrixWorld.elements;
    let outerR = 2.5; // default for Ø5
    outer: for (const spec of this.boreOverlaySpecs) {
      if (spec.partPath !== partPath) continue;
      for (const bore of spec.bores) {
        if (bore.id !== boreId) continue;
        outerR = bore.diameter / 2;
        break outer;
      }
    }
    const midR = outerR * 0.8; // between inner (0.6*outer) and outer (1.0*outer)
    const localX = new THREE.Vector3(e[0]!, e[1]!, e[2]!).normalize();
    return {
      x: e[12]! + localX.x * midR,
      y: e[13]! + localX.y * midR,
      z: e[14]! + localX.z * midR,
    };
  }

  /** Slice-5: e2e helper — first bore whose axis is non-null (i.e. draggable via gizmo).
   *  Iterates boreOverlaySpecs; uses boreGizmoAxis to test each bore. */
  firstDraggableBore(): { boreId: string; partPath: string } | null {
    for (const spec of this.boreOverlaySpecs) {
      for (const bore of spec.bores) {
        const axis = boreGizmoAxis(bore, spec.worldPose.quaternion);
        if (axis !== null) {
          return { boreId: bore.id, partPath: spec.partPath };
        }
      }
    }
    return null;
  }

  /** Slice-5: return the world drag axis for a bore, or null if not draggable.
   *  Centralises axis derivation so App.tsx never handles quaternions directly. */
  boreDragAxis(boreId: string, partPath: string): Vec3 | null {
    for (const spec of this.boreOverlaySpecs) {
      if (spec.partPath !== partPath) continue;
      for (const bore of spec.bores) {
        if (bore.id !== boreId) continue;
        return boreGizmoAxis(bore, spec.worldPose.quaternion);
      }
    }
    return null;
  }

  /**
   * Phase 5: drop existing bore markers; if showBores, build one RingGeometry
   * disc per bore. The ring sits in the face plane at face2DFrame(u,v), then the
   * whole marker is transformed by the component world pose. Mirrors
   * rebuildEdgeBandOverlays' clear-then-rebuild shape.
   */
  rebuildBoreMarkers(): void {
    if (this.boreDragActive) { this.pendingMarkerRebuild = true; return; }
    for (const marker of this.boreMarkers) {
      this.scene.remove(marker);
      marker.geometry.dispose();
      (marker.material as THREE.Material).dispose();
    }
    this.boreMarkers.length = 0;
    if (!this.showBores) return;
    for (const spec of this.boreOverlaySpecs) {
      const q = new THREE.Quaternion(
        spec.worldPose.quaternion[0], spec.worldPose.quaternion[1],
        spec.worldPose.quaternion[2], spec.worldPose.quaternion[3],
      );
      const t = new THREE.Vector3(
        spec.worldPose.translation.x, spec.worldPose.translation.y, spec.worldPose.translation.z,
      );
      const compMat = new THREE.Matrix4().compose(t, q, new THREE.Vector3(1, 1, 1));
      for (const bore of spec.bores) {
        // bore.face is FaceName (object); face2DFrame takes the role string.
        const f = face2DFrame(spec.panelDims, bore.face.role as PanelFaceRole);
        const uDir = new THREE.Vector3(f.uDir.x, f.uDir.y, f.uDir.z).normalize();
        const vDir = new THREE.Vector3(f.vDir.x, f.vDir.y, f.vDir.z).normalize();
        const nDir = new THREE.Vector3().crossVectors(uDir, vDir).normalize();
        // Panel-local position of the bore.
        const p = new THREE.Vector3(f.origin.x, f.origin.y, f.origin.z)
          .addScaledVector(uDir, bore.u)
          .addScaledVector(vDir, bore.v);
        // RingGeometry is authored in the XY plane (normal +Z); build basis so
        // +X aligns with uDir, +Y aligns with vDir, +Z aligns with nDir.
        const basis = new THREE.Matrix4().makeBasis(uDir, vDir, nDir);
        const localMat = new THREE.Matrix4().copy(basis).setPosition(p);
        const worldMat = new THREE.Matrix4().multiplyMatrices(compMat, localMat);
        const outer = bore.diameter / 2;
        const geom = new THREE.RingGeometry(outer * 0.6, outer, 24);
        const color = SceneManager.BORE_COLORS[bore.connectorKind];
        const mat = new THREE.MeshBasicMaterial({ color, depthWrite: false, side: THREE.DoubleSide });
        const mesh = new THREE.Mesh(geom, mat);
        mesh.matrixAutoUpdate = false;
        mesh.matrix.copy(worldMat);
        mesh.userData.kind = 'boreMarker';
        mesh.userData.boreId = bore.id;
        mesh.userData.markerKey = spec.key;
        mesh.userData.partPath = spec.partPath;
        this.scene.add(mesh);
        this.boreMarkers.push(mesh);
      }
    }
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
    this.setShowBores(useAppStore.getState().showBores);
    let lastShowBores = useAppStore.getState().showBores;
    const unsubBores = useAppStore.subscribe((s) => {
      if (s.showBores !== lastShowBores) {
        lastShowBores = s.showBores;
        this.setShowBores(s.showBores);
      }
    });
    this.storeUnsubscribers.push(unsubBores);
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

  /**
   * Slice-3: Raycasts against bore markers only. Mirror of raycastComponent:
   * takes the SAME camera+ndc args; NDC conversion lives in the Viewport wrapper.
   * Reads boreId and partPath from mesh.userData (set during rebuildBoreMarkers).
   * Returns null on miss or if userData is incomplete.
   */
  raycastBoreMarker(camera: THREE.Camera, ndc: THREE.Vector2): { boreId: string; partPath: string } | null {
    if (this.boreMarkers.length === 0) return null;
    for (const m of this.boreMarkers) {
      m.updateMatrixWorld(true);
    }
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(ndc, camera);
    const hits = raycaster.intersectObjects(this.boreMarkers, false);
    if (hits.length === 0) return null;
    const obj = hits[0]!.object;
    const boreId = obj.userData.boreId as string | undefined;
    const partPath = obj.userData.partPath as string | undefined;
    if (!boreId || !partPath) return null;
    return { boreId, partPath };
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
    for (const marker of this.boreMarkers) {
      this.scene.remove(marker);
      marker.geometry.dispose();
      (marker.material as THREE.Material).dispose();
    }
    this.boreMarkers.length = 0;
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

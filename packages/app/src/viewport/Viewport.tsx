import { useEffect, useRef, useImperativeHandle, useState, forwardRef } from 'react';
import * as THREE from 'three';
import { SceneManager, type WorkFeatureSpec, type ComponentLeaf, type PanelOverlaySpec, type MarkerOverlaySpec } from './SceneManager';
import type { ComponentPath, MaterialEntry } from '@zilventor/shared';
import { pathKey } from '@zilventor/shared';
import ViewCube from './ViewCube';

/**
 * T28 (4d Phase 9): Component meshes are now keyed by `ComponentPath`. The
 * Viewport forwards `ComponentLeaf[]` to the SceneManager and exposes a
 * `setPartGeometry(partPath, geom)` method so callers can register tessellated
 * geometry per unique `.zipt` partPath. Sub-asm leaves with the same partPath
 * share one BufferGeometry.
 */
export type ComponentMeshSpec = ComponentLeaf;

/**
 * Raw raycast hit returned by raycastAssemblyRef. The Viewport has no access
 * to per-component tessellated face/edge tables, so name resolution
 * (triangleIndex → FaceName, ray → EdgeName) is the caller's responsibility
 * (done in App.tsx by T34 using FacePickController / EdgePickController).
 *
 * T30 (4d Phase 9): hits now carry `componentPath`, not `componentId`.
 *
 * - face:  triangleIndex into the component mesh's index buffer (same units as
 *          raycastBody). Caller feeds it to FacePickController.pickByTriangleIndex.
 * - edge:  ray origin + direction in world space. Caller feeds it to
 *          EdgePickController.pickFromRay on the per-component edge table.
 * - axis / point / circularEdge: not yet resolvable at the Viewport layer;
 *   these modes always return null until T34/T38 wires them.
 */
export type AssemblyRefHit =
  | { kind: 'face'; componentPath: ComponentPath; triangleIndex: number }
  | { kind: 'edge'; componentPath: ComponentPath; origin: { x: number; y: number; z: number }; direction: { x: number; y: number; z: number } };

export type ViewportRef = {
  setMesh(positions: Float32Array, indices: Uint32Array, colorHex?: string, uv?: Float32Array, textureId?: string): void;
  setPreviewMesh(positions: Float32Array, indices: Uint32Array): void;
  clearPreviewMesh(): void;
  setComponentMeshes(leaves: ComponentLeaf[]): void;
  /** Arm a one-shot camera fit-to-model on the next mesh upload. */
  requestFrameOnNextMesh(): void;
  setPartGeometry(partPath: string, geometry: THREE.BufferGeometry): void;
  setSelectedComponentPaths(paths: ComponentPath[]): void;
  setPanelOverlays(specs: PanelOverlaySpec[], materials: ReadonlyArray<MaterialEntry>): void;
  setBoreMarkers(specs: MarkerOverlaySpec[]): void;
  clearComponentMeshes(): void;
  captureThumbnail(w: number, h: number): Promise<Uint8Array>;
  captureViewportPng(opts: { transparent: boolean }): Promise<Uint8Array>;
  captureThumbnailScaled(size: number): Promise<Uint8Array>;
  getSceneManager(): SceneManager | null;
  screenToWorld(clientX: number, clientY: number): { x: number; y: number };
  screenToRay(
    clientX: number,
    clientY: number
  ): { origin: { x: number; y: number; z: number }; direction: { x: number; y: number; z: number } };
  worldToScreen(worldX: number, worldY: number): { x: number; y: number };
  worldToScreen3d(worldX: number, worldY: number, worldZ: number): { x: number; y: number };
  raycastBody(clientX: number, clientY: number): { triangleIndex: number } | null;
  raycastComponent(clientX: number, clientY: number): ComponentPath | null;
  raycastWorkFeature(clientX: number, clientY: number): string | null;
  setWorkFeatures(specs: WorkFeatureSpec[]): void;
  /**
   * Assembly-mode pick. Raycasts against component meshes (those with
   * userData.componentPath) and returns a raw hit annotated with componentPath.
   *
   * Supported modes:
   *   'face' → { kind:'face', componentPath, triangleIndex } — caller resolves FaceName
   *   'edge' → { kind:'edge', componentPath, origin, direction } — caller resolves EdgeName
   *
   * Unsupported modes ('axis', 'point', 'circularEdge') always return null.
   * TODO: axis/point/circularEdge pick in T34/T38.
   */
  raycastAssemblyRef(
    mode: 'face' | 'edge' | 'axis' | 'point' | 'circularEdge',
    clientX: number,
    clientY: number,
  ): AssemblyRefHit | null;
  /**
   * T37 drag-along-free-DOFs stub.
   *
   * Projects `deltaWorldXY` onto the null-space basis from
   * `solverDiagnostics.freeDofBasis` (via projectOntoBasis), applies the
   * resulting translation to the component's mesh matrix, and writes the
   * new position back to the store via updateComponent on pointer-up.
   *
   * Pointer-down/move/up wiring is a TODO; this method is exposed so T45
   * E2E can call it directly via a dev hook.
   *
   * @param componentPath - path of the component to drag (T30: was string id)
   * @param deltaWorldXY - desired translation delta in world XY (mm)
   * @param freeDofBasis - null-space basis rows (from store.freeDofBasis); null → apply delta directly
   * @param onComplete - called after matrix update so caller can write back to store
   */
  dragAlongFreeDofs(
    componentPath: ComponentPath,
    deltaWorldXY: { x: number; y: number },
    freeDofBasis: Float64Array | null,
    onComplete?: (componentPath: ComponentPath, translation: { x: number; y: number; z: number }) => void,
  ): void;
};

type Props = {
  onPointer?: (event: { type: 'click' | 'move' | 'pointerdown' | 'pointerup'; clientX: number; clientY: number }) => void;
};

const Viewport = forwardRef<ViewportRef, Props>(function Viewport(props, ref) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<SceneManager | null>(null);
  const [triangles, setTriangles] = useState(0);
  const [geometryHash, setGeometryHash] = useState('0');

  useEffect(() => {
    if (!canvasRef.current) return;
    const canvas = canvasRef.current;
    const sm = new SceneManager(canvas);
    sceneRef.current = sm;
    // T30: subscribe to useAppStore.showEdgeBands so the View-tab toggle
    // shows/hides the edge-band overlays without explicit caller wiring.
    sm.attach();

    const resize = () => {
      const r = canvas.getBoundingClientRect();
      sm.setSize(r.width, r.height);
      sm.render();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    let raf = 0;
    const loop = () => {
      sm.render();
      raf = requestAnimationFrame(loop);
    };
    loop();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      sm.dispose();
      sceneRef.current = null;
    };
  }, []);

  useImperativeHandle(ref, () => ({
    setMesh: (p, i, colorHex, uv, textureId) => {
      if (!sceneRef.current) return;
      sceneRef.current.setMesh(p, i, colorHex, uv, textureId);
      setTriangles(i.length / 3);
      setGeometryHash(sceneRef.current.geometryHash());
    },
    setPreviewMesh: (p, i) => {
      if (!sceneRef.current) return;
      sceneRef.current.setPreviewMesh(p, i);
    },
    clearPreviewMesh: () => {
      if (!sceneRef.current) return;
      sceneRef.current.clearPreviewMesh();
    },
    setComponentMeshes: (leaves) => {
      if (!sceneRef.current) return;
      sceneRef.current.setComponentMeshes(leaves);
      setGeometryHash(sceneRef.current.geometryHash());
    },
    requestFrameOnNextMesh: () => {
      sceneRef.current?.requestFrameOnNextMesh();
    },
    setPartGeometry: (partPath, geometry) => {
      if (!sceneRef.current) return;
      sceneRef.current.setPartGeometry(partPath, geometry);
    },
    setSelectedComponentPaths: (paths) => {
      if (!sceneRef.current) return;
      sceneRef.current.setSelectedComponentPaths(paths);
    },
    setPanelOverlays: (specs, materials) => {
      if (!sceneRef.current) return;
      sceneRef.current.setPanelOverlays(specs, materials);
      setGeometryHash(sceneRef.current.geometryHash());
    },
    setBoreMarkers: (specs) => {
      if (!sceneRef.current) return;
      sceneRef.current.setBoreMarkers(specs);
    },
    clearComponentMeshes: () => {
      if (!sceneRef.current) return;
      sceneRef.current.clearComponentMeshes();
      setGeometryHash(sceneRef.current.geometryHash());
    },
    captureThumbnail: async (w, h) => {
      if (!sceneRef.current) throw new Error('viewport not ready');
      return sceneRef.current.captureThumbnail(w, h);
    },
    captureViewportPng: async (opts) => {
      if (!sceneRef.current) throw new Error('viewport not ready');
      return sceneRef.current.captureViewportPng(opts);
    },
    captureThumbnailScaled: async (size) => {
      if (!sceneRef.current) throw new Error('viewport not ready');
      return sceneRef.current.captureThumbnailScaled(size);
    },
    getSceneManager: () => sceneRef.current,
    screenToWorld: (clientX, clientY) => {
      if (!sceneRef.current || !canvasRef.current) return { x: 0, y: 0 };
      const canvas = canvasRef.current;
      const rect = canvas.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        -(((clientY - rect.top) / rect.height) * 2 - 1)
      );
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(ndc, sceneRef.current.getCamera());
      const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
      const hit = new THREE.Vector3();
      raycaster.ray.intersectPlane(plane, hit);
      return { x: hit.x, y: hit.y };
    },
    screenToRay: (clientX, clientY) => {
      if (!sceneRef.current || !canvasRef.current) {
        return { origin: { x: 0, y: 0, z: 0 }, direction: { x: 0, y: 0, z: -1 } };
      }
      const canvas = canvasRef.current;
      const rect = canvas.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        -(((clientY - rect.top) / rect.height) * 2 - 1)
      );
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(ndc, sceneRef.current.getCamera());
      const o = raycaster.ray.origin;
      const d = raycaster.ray.direction;
      return {
        origin: { x: o.x, y: o.y, z: o.z },
        direction: { x: d.x, y: d.y, z: d.z }
      };
    },
    raycastBody: (clientX, clientY) => {
      if (!sceneRef.current || !canvasRef.current) return null;
      const mesh = sceneRef.current.getCurrentMesh();
      if (!mesh) return null;
      const canvas = canvasRef.current;
      const rect = canvas.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        -(((clientY - rect.top) / rect.height) * 2 - 1)
      );
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(ndc, sceneRef.current.getCamera());
      const hits = raycaster.intersectObject(mesh, false);
      if (hits.length === 0 || hits[0]!.faceIndex === undefined) return null;
      return { triangleIndex: hits[0]!.faceIndex! };
    },
    worldToScreen: (worldX, worldY) => {
      if (!sceneRef.current || !canvasRef.current) return { x: 0, y: 0 };
      const canvas = canvasRef.current;
      const rect = canvas.getBoundingClientRect();
      const vec = new THREE.Vector3(worldX, worldY, 0);
      vec.project(sceneRef.current.getCamera());
      const x = ((vec.x + 1) / 2) * rect.width;
      const y = ((-vec.y + 1) / 2) * rect.height;
      return { x, y };
    },
    raycastComponent: (clientX, clientY) => {
      if (!sceneRef.current || !canvasRef.current) return null;
      const canvas = canvasRef.current;
      const rect = canvas.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        -(((clientY - rect.top) / rect.height) * 2 - 1)
      );
      return sceneRef.current.raycastComponent(sceneRef.current.getCamera(), ndc);
    },
    raycastWorkFeature: (clientX, clientY) => {
      if (!sceneRef.current || !canvasRef.current) return null;
      const canvas = canvasRef.current;
      const rect = canvas.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        -(((clientY - rect.top) / rect.height) * 2 - 1)
      );
      return sceneRef.current.raycastWorkFeature(sceneRef.current.getCamera(), ndc);
    },
    setWorkFeatures: (specs) => {
      if (!sceneRef.current) return;
      sceneRef.current.setWorkFeatures(specs);
      setGeometryHash(sceneRef.current.geometryHash());
    },
    raycastAssemblyRef: (mode, clientX, clientY) => {
      if (!sceneRef.current || !canvasRef.current) return null;

      // axis / point / circularEdge are not resolvable at the Viewport layer.
      // TODO: axis/point/circularEdge pick in T34/T38.
      if (mode === 'axis' || mode === 'point' || mode === 'circularEdge') return null;

      const sm = sceneRef.current;
      const canvas = canvasRef.current;
      const rect = canvas.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        -(((clientY - rect.top) / rect.height) * 2 - 1)
      );
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(ndc, sm.getCamera());

      // Collect only component meshes (those tagged with userData.componentPath).
      const scene = sm.getScene();
      const componentMeshes: THREE.Mesh[] = [];
      scene.traverse((obj) => {
        if ((obj as THREE.Mesh).isMesh && Array.isArray(obj.userData.componentPath)) {
          // Ensure world matrix is current (matrixAutoUpdate is false for component meshes).
          obj.updateMatrixWorld(true);
          componentMeshes.push(obj as THREE.Mesh);
        }
      });
      if (componentMeshes.length === 0) return null;

      const hits = raycaster.intersectObjects(componentMeshes, false);
      if (hits.length === 0) return null;

      const firstHit = hits[0]!;
      const componentPath = firstHit.object.userData.componentPath as ComponentPath;

      if (mode === 'face') {
        if (firstHit.faceIndex === undefined) return null;
        return { kind: 'face', componentPath, triangleIndex: firstHit.faceIndex };
      }

      // mode === 'edge': return the world-space ray; caller runs EdgePickController.
      const o = raycaster.ray.origin;
      const d = raycaster.ray.direction;
      return {
        kind: 'edge',
        componentPath,
        origin: { x: o.x, y: o.y, z: o.z },
        direction: { x: d.x, y: d.y, z: d.z },
      };
    },
    worldToScreen3d: (wx, wy, wz) => {
      if (!sceneRef.current || !canvasRef.current) return { x: 0, y: 0 };
      const canvas = canvasRef.current;
      const rect = canvas.getBoundingClientRect();
      const vec = new THREE.Vector3(wx, wy, wz);
      vec.project(sceneRef.current.getCamera());
      const x = ((vec.x + 1) / 2) * rect.width;
      const y = ((-vec.y + 1) / 2) * rect.height;
      return { x, y };
    },
    dragAlongFreeDofs: (componentPath, deltaWorldXY, freeDofBasis, onComplete) => {
      if (!sceneRef.current) return;
      const mesh = sceneRef.current.getComponentMesh(pathKey(componentPath));
      if (!mesh) return;

      // Project the 2-D screen-plane delta onto the null-space basis.
      // Input vector: [dx, dy, 0] in world space (Z component ignored for v1).
      let projX = deltaWorldXY.x;
      let projY = deltaWorldXY.y;
      let projZ = 0;

      if (freeDofBasis && freeDofBasis.length >= 3) {
        // Each row of freeDofBasis is a 6-DOF basis vector; for translation-only
        // v1 we read the first 3 components (tx, ty, tz) of each row.
        // Project delta onto the span of those translational parts.
        const dof = freeDofBasis.length / 6; // number of free DOF rows
        let ax = 0, ay = 0, az = 0;
        for (let i = 0; i < dof; i++) {
          const bx = freeDofBasis[i * 6 + 0] ?? 0;
          const by = freeDofBasis[i * 6 + 1] ?? 0;
          const bz = freeDofBasis[i * 6 + 2] ?? 0;
          const dot = deltaWorldXY.x * bx + deltaWorldXY.y * by;
          ax += dot * bx;
          ay += dot * by;
          az += dot * bz;
        }
        projX = ax;
        projY = ay;
        projZ = az;
      }

      // Apply translation delta to the mesh matrix (translation-only v1).
      const elems = mesh.matrix.elements;
      elems[12] = (elems[12] ?? 0) + projX;
      elems[13] = (elems[13] ?? 0) + projY;
      elems[14] = (elems[14] ?? 0) + projZ;

      const translation = {
        x: elems[12] ?? 0,
        y: elems[13] ?? 0,
        z: elems[14] ?? 0,
      };

      // TODO T45: pointer-down/move/up event wiring to call this per move event.
      // For now the method is exposed for direct E2E invocation via dev hook.
      onComplete?.(componentPath, translation);
    },
  }), []);

  return (
    <div className="relative w-full h-full" data-testid="viewport" data-triangle-count={triangles} data-geometry-hash={geometryHash}>
      <canvas
        ref={canvasRef}
        className="block w-full h-full"
        onPointerDown={(e) => props.onPointer?.({ type: 'pointerdown', clientX: e.clientX, clientY: e.clientY })}
        onPointerMove={(e) => props.onPointer?.({ type: 'move', clientX: e.clientX, clientY: e.clientY })}
        onPointerUp={(e) => props.onPointer?.({ type: 'pointerup', clientX: e.clientX, clientY: e.clientY })}
        onClick={(e) => props.onPointer?.({ type: 'click', clientX: e.clientX, clientY: e.clientY })}
      />
      <ViewCube />
    </div>
  );
});

export default Viewport;

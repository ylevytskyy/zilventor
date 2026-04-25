import { useEffect, useRef, useImperativeHandle, useState, forwardRef } from 'react';
import * as THREE from 'three';
import { SceneManager } from './SceneManager';
import ViewCube from './ViewCube';

export type ComponentMeshSpec = {
  componentId: string;
  geometry: THREE.BufferGeometry;
  transform: THREE.Matrix4;
  visible: boolean;
};

export type ViewportRef = {
  setMesh(positions: Float32Array, indices: Uint32Array): void;
  setPreviewMesh(positions: Float32Array, indices: Uint32Array): void;
  clearPreviewMesh(): void;
  setComponentMeshes(specs: ComponentMeshSpec[]): void;
  clearComponentMeshes(): void;
  captureThumbnail(w: number, h: number): Promise<Uint8Array>;
  getSceneManager(): SceneManager | null;
  screenToWorld(clientX: number, clientY: number): { x: number; y: number };
  screenToRay(
    clientX: number,
    clientY: number
  ): { origin: { x: number; y: number; z: number }; direction: { x: number; y: number; z: number } };
  worldToScreen(worldX: number, worldY: number): { x: number; y: number };
  worldToScreen3d(worldX: number, worldY: number, worldZ: number): { x: number; y: number };
  raycastBody(clientX: number, clientY: number): { triangleIndex: number } | null;
  raycastComponent(clientX: number, clientY: number): string | null;
  raycastWorkFeature(clientX: number, clientY: number): string | null;
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
    setMesh: (p, i) => {
      if (!sceneRef.current) return;
      sceneRef.current.setMesh(p, i);
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
    setComponentMeshes: (specs) => {
      if (!sceneRef.current) return;
      sceneRef.current.setComponentMeshes(specs);
      setGeometryHash(sceneRef.current.geometryHash());
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
    worldToScreen3d: (wx, wy, wz) => {
      if (!sceneRef.current || !canvasRef.current) return { x: 0, y: 0 };
      const canvas = canvasRef.current;
      const rect = canvas.getBoundingClientRect();
      const vec = new THREE.Vector3(wx, wy, wz);
      vec.project(sceneRef.current.getCamera());
      const x = ((vec.x + 1) / 2) * rect.width;
      const y = ((-vec.y + 1) / 2) * rect.height;
      return { x, y };
    }
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

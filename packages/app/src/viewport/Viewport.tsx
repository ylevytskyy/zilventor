import { useEffect, useRef, useImperativeHandle, useState, forwardRef } from 'react';
import * as THREE from 'three';
import { SceneManager } from './SceneManager';
import ViewCube from './ViewCube';

export type ViewportRef = {
  setMesh(positions: Float32Array, indices: Uint32Array): void;
  captureThumbnail(w: number, h: number): Promise<Uint8Array>;
  getSceneManager(): SceneManager | null;
  screenToWorld(clientX: number, clientY: number): { x: number; y: number };
  worldToScreen(worldX: number, worldY: number): { x: number; y: number };
};

type Props = {
  onPointer?: (event: { type: 'click' | 'move' | 'pointerdown' | 'pointerup'; clientX: number; clientY: number }) => void;
};

const Viewport = forwardRef<ViewportRef, Props>(function Viewport(props, ref) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<SceneManager | null>(null);
  const [triangles, setTriangles] = useState(0);

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
    worldToScreen: (worldX, worldY) => {
      if (!sceneRef.current || !canvasRef.current) return { x: 0, y: 0 };
      const canvas = canvasRef.current;
      const rect = canvas.getBoundingClientRect();
      const vec = new THREE.Vector3(worldX, worldY, 0);
      vec.project(sceneRef.current.getCamera());
      const x = ((vec.x + 1) / 2) * rect.width;
      const y = ((-vec.y + 1) / 2) * rect.height;
      return { x, y };
    }
  }), []);

  return (
    <div className="relative w-full h-full" data-testid="viewport" data-triangle-count={triangles}>
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

import { useEffect, useRef, useImperativeHandle, useState, forwardRef } from 'react';
import { SceneManager } from './SceneManager';
import ViewCube from './ViewCube';

export type ViewportRef = {
  setMesh(positions: Float32Array, indices: Uint32Array, normals?: Float32Array): void;
};

const Viewport = forwardRef<ViewportRef>(function Viewport(_, ref) {
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
    setMesh: (p, i, n) => {
      if (!sceneRef.current) return;
      sceneRef.current.setMesh(p, i, n);
      setTriangles(i.length / 3);
    }
  }), []);

  return (
    <div className="relative w-full h-full" data-testid="viewport" data-triangle-count={triangles}>
      <canvas ref={canvasRef} className="block w-full h-full" />
      <ViewCube />
    </div>
  );
});

export default Viewport;

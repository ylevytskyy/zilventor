import { useEffect, useRef, useState } from 'react';
import { SceneManager } from './SceneManager';
import ViewCube from './ViewCube';

export type ViewportRef = {
  setMesh(positions: Float32Array, indices: Uint32Array, normals?: Float32Array): void;
};

type Props = {
  onReady?: (api: ViewportRef) => void;
};

export default function Viewport({ onReady }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [triangles, setTriangles] = useState(0);

  useEffect(() => {
    if (!ref.current) return;
    const canvas = ref.current;
    const sm = new SceneManager(canvas);

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

    if (onReady) {
      onReady({
        setMesh: (p, i, n) => {
          sm.setMesh(p, i, n);
          setTriangles(i.length / 3);
        }
      });
    }

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      sm.dispose();
    };
  }, [onReady]);

  return (
    <div className="relative w-full h-full" data-testid="viewport" data-triangle-count={triangles}>
      <canvas ref={ref} className="block w-full h-full" />
      <ViewCube />
    </div>
  );
}

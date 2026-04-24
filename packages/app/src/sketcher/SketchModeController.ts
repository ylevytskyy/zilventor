import * as THREE from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { DofStatus } from '@zilventor/sketcher-worker';
import type { SketchPrimitive, SketchConstraint } from '@zilventor/shared';
import type { SketcherClient } from './SketcherClient';

/**
 * Handles the camera + grid + orbit-control changes when entering / exiting sketch mode.
 * The camera is pulled to a near-orthographic view down the +Z axis onto the XY plane,
 * a 2D grid becomes visible, and orbit rotation is disabled (pan + zoom still work).
 */
export type SketchModeHandle = {
  enter(): Promise<void>;
  exit(): Promise<void>;
  isActive(): boolean;
};

export type SketchModeControllerOpts = {
  camera: THREE.PerspectiveCamera;
  orbitControls: OrbitControls;
  scene: THREE.Scene;
  sketcherClient: SketcherClient;
  getActiveSketch: () => { primitives: SketchPrimitive[]; constraints: SketchConstraint[] } | null;
  resolveParamValue?: (name: string) => number | undefined;
  setSketchDof: (v: DofStatus | null) => void;
};

export function createSketchModeController(opts: SketchModeControllerOpts): SketchModeHandle {
  let active = false;
  let savedCamera: { position: THREE.Vector3; rotation: THREE.Euler; fov: number } | null = null;
  const grid = new THREE.GridHelper(500, 50, 0x555555, 0x333333);
  grid.rotateX(Math.PI / 2); // lay on XY
  grid.visible = false;
  opts.scene.add(grid);

  return {
    async enter(): Promise<void> {
      if (active) return;
      active = true;
      savedCamera = {
        position: opts.camera.position.clone(),
        rotation: opts.camera.rotation.clone(),
        fov: opts.camera.fov
      };
      opts.camera.position.set(0, 0, 500);
      opts.camera.lookAt(0, 0, 0);
      opts.camera.fov = 10;
      opts.camera.updateProjectionMatrix();
      // Disable OrbitControls entirely — it listens to pointerdown and would
      // swallow canvas events intended for the sketcher. Pan/zoom via keyboard
      // or disabled until exit.
      opts.orbitControls.enabled = false;
      grid.visible = true;
      const sketch = opts.getActiveSketch();
      if (sketch) {
        const dimensionResolvedValues: Record<string, number> = {};
        if (opts.resolveParamValue) {
          for (const c of sketch.constraints) {
            if (!c.kind.startsWith('dim-')) continue;
            const dim = c as { id: string; value: { kind: 'literal'; value: number } | { kind: 'param'; paramName: string } };
            if (dim.value.kind !== 'param') continue;
            const v = opts.resolveParamValue(dim.value.paramName);
            if (v !== undefined) dimensionResolvedValues[dim.id] = v;
          }
        }
        const { dof } = await opts.sketcherClient.loadSketch({
          primitives: sketch.primitives,
          constraints: sketch.constraints,
          dimensionResolvedValues
        });
        opts.setSketchDof(dof);
      }
    },
    async exit(): Promise<void> {
      if (!active) return;
      active = false;
      await opts.sketcherClient.unloadSketch();
      opts.setSketchDof(null);
      if (savedCamera) {
        opts.camera.position.copy(savedCamera.position);
        opts.camera.rotation.copy(savedCamera.rotation);
        opts.camera.fov = savedCamera.fov;
        opts.camera.updateProjectionMatrix();
      }
      opts.orbitControls.enabled = true;
      grid.visible = false;
    },
    isActive(): boolean {
      return active;
    }
  };
}

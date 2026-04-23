import * as THREE from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

/**
 * Handles the camera + grid + orbit-control changes when entering / exiting sketch mode.
 * The camera is pulled to a near-orthographic view down the +Z axis onto the XY plane,
 * a 2D grid becomes visible, and orbit rotation is disabled (pan + zoom still work).
 */
export type SketchModeHandle = {
  enter(): void;
  exit(): void;
  isActive(): boolean;
};

export function createSketchModeController(opts: {
  camera: THREE.PerspectiveCamera;
  orbitControls: OrbitControls;
  scene: THREE.Scene;
}): SketchModeHandle {
  let active = false;
  let savedCamera: { position: THREE.Vector3; rotation: THREE.Euler; fov: number } | null = null;
  const grid = new THREE.GridHelper(500, 50, 0x555555, 0x333333);
  grid.rotateX(Math.PI / 2); // lay on XY
  grid.visible = false;
  opts.scene.add(grid);

  return {
    enter(): void {
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
    },
    exit(): void {
      if (!active) return;
      active = false;
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

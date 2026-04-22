import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import Viewport from '../Viewport';

// Stub WebGL context — jsdom doesn't provide one.
beforeEach(() => {
  HTMLCanvasElement.prototype.getContext = function (type: string) {
    if (type === 'webgl2' || type === 'webgl') {
      // Return a minimal stub sufficient for three.js's renderer constructor
      // THREE.WebGLRenderer will still throw unless we hand back enough surface —
      // instead we mock the WebGLRenderer itself below.
      return null as unknown as RenderingContext;
    }
    return null;
  } as unknown as HTMLCanvasElement['getContext'];
});

vi.mock('three', async (orig) => {
  const actual = (await orig()) as typeof import('three');
  class FakeRenderer {
    domElement = document.createElement('canvas');
    setPixelRatio() {}
    setSize() {}
    render() {}
    dispose() {}
  }
  return { ...actual, WebGLRenderer: FakeRenderer };
});

vi.mock('three/examples/jsm/controls/OrbitControls.js', () => {
  class FakeOrbitControls {
    enableDamping = false;
    dampingFactor = 0;
    update() {}
    dispose() {}
  }
  return { OrbitControls: FakeOrbitControls };
});

class MockResizeObserver { observe() {} unobserve() {} disconnect() {} }
(global as unknown as { ResizeObserver: typeof MockResizeObserver }).ResizeObserver = MockResizeObserver;

describe('Viewport', () => {
  it('renders a canvas and the view cube', () => {
    render(<Viewport />);
    const vp = screen.getByTestId('viewport');
    expect(vp).toBeTruthy();
    expect(vp.querySelector('canvas')).toBeTruthy();
    expect(screen.getByText('VC')).toBeTruthy();
  });

  it('exposes a setMesh ref via onReady that updates the triangle count', async () => {
    let api: { setMesh: (p: Float32Array, i: Uint32Array, n?: Float32Array) => void } | null = null;
    render(<Viewport onReady={(a) => { api = a; }} />);
    expect(api).toBeTruthy();
    api!.setMesh(new Float32Array(9), new Uint32Array([0, 1, 2]));
    // Re-query after state update
    await new Promise((r) => setTimeout(r, 10));
    const vp = screen.getByTestId('viewport');
    expect(vp.getAttribute('data-triangle-count')).toBe('1');
  });
});

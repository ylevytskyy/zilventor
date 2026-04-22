import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import App from '../App';

// spawnKernel spins up a real Worker + OCCT WASM in production; that won't work
// under jsdom. Reject cleanly so App.tsx records a "Kernel failed" status and
// we can still assert the static layout renders.
vi.mock('../kernel-client/KernelClient', () => ({
  spawnKernel: vi.fn().mockRejectedValue(new Error('mocked, skipping'))
}));

// Viewport mounts three.js; jsdom has no WebGL. Mock the renderer + OrbitControls.
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

describe('App shell', () => {
  it('renders all six regions with stable IDs', () => {
    render(<App />);
    for (const id of ['region-appbar', 'region-ribbon', 'region-browser', 'region-viewport', 'region-properties', 'region-statusbar']) {
      expect(document.getElementById(id)).toBeTruthy();
    }
    expect(screen.getByText('ZilInventor')).toBeTruthy();
  });
});

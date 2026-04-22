import { describe, it, expect, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { createRef } from 'react';
import Viewport, { type ViewportRef } from '../Viewport';

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

  it('exposes a setMesh ref that updates the triangle count', () => {
    const ref = createRef<ViewportRef>();
    render(<Viewport ref={ref} />);
    expect(ref.current).toBeTruthy();
    act(() => {
      ref.current!.setMesh(new Float32Array(9), new Uint32Array([0, 1, 2]));
    });
    const vp = screen.getByTestId('viewport');
    expect(vp.getAttribute('data-triangle-count')).toBe('1');
  });
});

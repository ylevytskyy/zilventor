// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AssemblyTab } from '../AssemblyTab';
import { useAppStore } from '../../../store/useAppStore';
import type { AssemblyDocument } from '@zilventor/shared';

function makeAsm(): AssemblyDocument {
  return {
    id: 'a1', name: 'cabinet', units: 'mm', parameters: {}, properties: {},
    components: [{ id: 'c1', partPath: 'panel.zipt', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true }],
    constraints: [], groundedComponentPaths: [], colors: {}, bomItemNumbers: {},
    cutListItemNumbers: {}, colorOverrides: {}, materials: [], hardware: [],
  };
}

describe('AssemblyTab — Pattern panel', () => {
  it('renders "Rectangular Pattern" button disabled when no assembly', () => {
    render(<AssemblyTab />);
    const btn = screen.getByRole('button', { name: /rectangular pattern/i });
    expect(btn).toBeDisabled();
  });

  it('renders "Rectangular Pattern" button enabled when assembly is active', () => {
    useAppStore.getState().setActiveDocument({ kind: 'assembly', document: makeAsm() });
    render(<AssemblyTab />);
    const btn = screen.getByRole('button', { name: /rectangular pattern/i });
    expect(btn).toBeEnabled();
  });

  it('renders "Mirror" button in Pattern panel', () => {
    render(<AssemblyTab />);
    expect(screen.getByRole('button', { name: /^mirror$/i })).toBeInTheDocument();
  });

  it('Pattern panel section label is visible', () => {
    render(<AssemblyTab />);
    expect(screen.getByText('Pattern')).toBeInTheDocument();
  });
});

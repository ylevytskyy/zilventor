import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AddViewDialog } from '../AddViewDialog';
import { useAppStore } from '../../store/useAppStore';
import { useToolModeStore } from '../../drawing/toolMode';
import type { DrawingDocument } from '@zilventor/shared';

const seedDrawing = (): DrawingDocument => ({
  id: 'dw1', name: 'D', units: 'mm',
  source: { partPath: 'parts/p.zipt', sourceKind: 'part' },
  properties: {},
  sheets: [
    {
      id: 'sh1', name: 'Sheet 1',
      size: { kind: 'iso', size: 'A3' },
      orientation: 'landscape',
      views: [
        {
          id: 'bv1', kind: 'base', positionMm: { x: 50, y: 50 },
          scale: { numerator: 1, denominator: 1 },
          orientation: 'front', showHidden: true,
        },
      ],
      dimensions: [], annotations: [], titleBlock: {},
    },
  ],
  activeSheetId: 'sh1',
});

describe('AddViewDialog — kind=base', () => {
  beforeEach(() => {
    useToolModeStore.getState().reset();
    useAppStore.getState().setActiveDocument(null);
    useAppStore.setState({ addViewDialogState: null } as any);
  });

  it('renders nothing when addViewDialogState is null', () => {
    render(<AddViewDialog />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('renders Base View fields (orientation select + scale inputs) for kind=base', () => {
    useAppStore.setState({ addViewDialogState: { kind: 'base' } } as any);
    render(<AddViewDialog />);
    expect(screen.getByRole('dialog', { name: /add.*view/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/orientation/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/scale.*numerator/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/scale.*denominator/i)).toBeInTheDocument();
  });

  it('OK with orientation=top sets pendingViewParams correctly', () => {
    useAppStore.setState({ addViewDialogState: { kind: 'base' } } as any);
    render(<AddViewDialog />);
    fireEvent.change(screen.getByLabelText(/orientation/i), { target: { value: 'top' } });
    fireEvent.click(screen.getByRole('button', { name: /^ok$/i }));
    const params = useToolModeStore.getState().pendingViewParams;
    expect(params).toMatchObject({ kind: 'base', orientation: 'top', scale: { n: 1, d: 1 } });
  });

  it('OK closes the dialog', () => {
    useAppStore.setState({ addViewDialogState: { kind: 'base' } } as any);
    render(<AddViewDialog />);
    fireEvent.click(screen.getByRole('button', { name: /^ok$/i }));
    expect((useAppStore.getState() as any).addViewDialogState).toBeNull();
  });

  it('Cancel closes without setting pendingViewParams', () => {
    useAppStore.setState({ addViewDialogState: { kind: 'base' } } as any);
    render(<AddViewDialog />);
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(useToolModeStore.getState().pendingViewParams).toBeNull();
    expect((useAppStore.getState() as any).addViewDialogState).toBeNull();
  });
});

describe('AddViewDialog — kind=projected', () => {
  beforeEach(() => {
    useToolModeStore.getState().reset();
    useAppStore.getState().setActiveDocument({ kind: 'drawing', document: seedDrawing() });
    useAppStore.setState({ addViewDialogState: null } as any);
  });

  it('renders Projected View fields (parent base view select + direction radios)', () => {
    useAppStore.setState({ addViewDialogState: { kind: 'projected' } } as any);
    render(<AddViewDialog />);
    expect(screen.getByLabelText(/parent.*view/i)).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /^top$/i })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /^bottom$/i })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /^left$/i })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /^right$/i })).toBeInTheDocument();
  });

  it('OK sets pendingViewParams for projected view', () => {
    useAppStore.setState({ addViewDialogState: { kind: 'projected' } } as any);
    render(<AddViewDialog />);
    fireEvent.change(screen.getByLabelText(/parent.*view/i), { target: { value: 'bv1' } });
    fireEvent.click(screen.getByRole('radio', { name: /^right$/i }));
    fireEvent.click(screen.getByRole('button', { name: /^ok$/i }));
    const params = useToolModeStore.getState().pendingViewParams;
    expect(params).toMatchObject({ kind: 'projected', baseViewId: 'bv1', direction: 'right' });
  });
});

describe('AddViewDialog — kind=iso', () => {
  beforeEach(() => {
    useToolModeStore.getState().reset();
    useAppStore.setState({ addViewDialogState: null } as any);
  });

  it('renders Iso View fields (corner select + scale inputs)', () => {
    useAppStore.setState({ addViewDialogState: { kind: 'iso' } } as any);
    render(<AddViewDialog />);
    expect(screen.getByLabelText(/corner/i)).toBeInTheDocument();
    const cornerSelect = screen.getByLabelText(/corner/i) as HTMLSelectElement;
    const cornerValues = Array.from(cornerSelect.options).map((o) => o.value);
    expect(cornerValues).toContain('NE');
    expect(cornerValues).toContain('NW');
    expect(cornerValues).toContain('SE');
    expect(cornerValues).toContain('SW');
  });

  it('OK sets pendingViewParams for iso view', () => {
    useAppStore.setState({ addViewDialogState: { kind: 'iso' } } as any);
    render(<AddViewDialog />);
    fireEvent.change(screen.getByLabelText(/corner/i), { target: { value: 'SW' } });
    fireEvent.click(screen.getByRole('button', { name: /^ok$/i }));
    const params = useToolModeStore.getState().pendingViewParams;
    expect(params).toMatchObject({ kind: 'iso', corner: 'SW', scale: { n: 1, d: 1 } });
  });
});

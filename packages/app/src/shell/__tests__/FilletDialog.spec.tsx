import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FilletDialog } from '../FilletDialog';
import type { FilletEdgeSpec } from '@zilventor/shared';

describe('FilletDialog', () => {
  const noopHandlers = {
    onCommit: vi.fn(),
    onApply: vi.fn(),
    onCancel: vi.fn(),
    onAddEdges: vi.fn(),
    onRemoveEdge: vi.fn(),
    onClearEdges: vi.fn(),
    onSelectionModeChange: vi.fn(),
    onModeChange: vi.fn(),
    onRadiusChange: vi.fn(),
  };

  it('renders mode toggle + selection-mode toggle + 3 tabs', () => {
    render(
      <FilletDialog
        edges={[]}
        pickingMode="edge"
        previewError={null}
        {...noopHandlers}
      />,
    );
    expect(screen.getByRole('tab', { name: /Edges/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Variable/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Setbacks/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Constant/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: /Edge$/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Loop/ })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /All Fillets/ }),
    ).toBeInTheDocument();
  });

  it('OK disabled when edges list is empty', () => {
    render(
      <FilletDialog
        edges={[]}
        pickingMode="edge"
        previewError={null}
        {...noopHandlers}
      />,
    );
    expect(screen.getByRole('button', { name: /^OK$/ })).toBeDisabled();
  });

  it('Edges tab shows radius input + edge list with remove buttons', () => {
    const onRemoveEdge = vi.fn();
    const edges: FilletEdgeSpec[] = [
      {
        edgeId: {
          faceA: { featureId: 'E1', role: 'top' },
          faceB: { featureId: 'E1', role: 'side', instance: 0 },
        },
        selectionMode: 'edge',
        radius: { kind: 'literal', value: 2 },
      },
    ];
    render(
      <FilletDialog
        edges={edges}
        pickingMode="edge"
        previewError={null}
        {...noopHandlers}
        onRemoveEdge={onRemoveEdge}
      />,
    );
    expect(screen.getByLabelText(/Radius/)).toBeInTheDocument();
    expect(screen.getByText(/top.*side/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Remove/ }));
    expect(onRemoveEdge).toHaveBeenCalled();
  });

  it('renders inline parse error when validateExpression returns a string', () => {
    render(
      <FilletDialog
        edges={[]}
        pickingMode="edge"
        previewError={null}
        validateExpression={() => 'bad expression'}
        {...noopHandlers}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('bad expression');
  });

  it('Variable tab is disabled when mode = constant', () => {
    render(
      <FilletDialog
        edges={[]}
        pickingMode="edge"
        previewError={null}
        {...noopHandlers}
      />,
    );
    const varTab = screen.getByRole('tab', { name: /Variable/ });
    expect(varTab).toHaveAttribute('aria-disabled', 'true');
  });

  it('Variable tab shows per-edge startR/endR inputs when mode = variable', () => {
    const edges: FilletEdgeSpec[] = [
      {
        edgeId: {
          faceA: { featureId: 'E1', role: 'top' },
          faceB: { featureId: 'E1', role: 'side', instance: 0 },
        },
        selectionMode: 'edge',
        radius: { kind: 'literal', value: 2 },
        variableRadii: {
          startRadius: { kind: 'literal', value: 1 },
          endRadius: { kind: 'literal', value: 3 },
        },
      },
    ];
    render(
      <FilletDialog
        edges={edges}
        pickingMode="edge"
        previewError={null}
        initialMode="variable"
        {...noopHandlers}
        onVariableRadiiChange={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('tab', { name: /Variable/ }));
    expect(screen.getByLabelText(/Start radius/)).toBeInTheDocument();
    expect(screen.getByLabelText(/End radius/)).toBeInTheDocument();
  });

  it('Setbacks tab shows auto-detected vertices with setback inputs', () => {
    const edges: FilletEdgeSpec[] = [
      {
        edgeId: {
          faceA: { featureId: 'E1', role: 'top' },
          faceB: { featureId: 'E1', role: 'side', instance: 0 },
        },
        selectionMode: 'edge',
        radius: { kind: 'literal', value: 2 },
      },
    ];
    render(
      <FilletDialog
        edges={edges}
        pickingMode="edge"
        previewError={null}
        vertices={[
          {
            vertexKey: 'V1',
            perEdge: [
              { edgeKey: 'top-side0', defaultSetback: 1 },
              { edgeKey: 'top-side1', defaultSetback: 1 },
              { edgeKey: 'side0-side1', defaultSetback: 1 },
            ],
          },
        ]}
        {...noopHandlers}
        onSetbackChange={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('tab', { name: /Setbacks/ }));
    expect(screen.getAllByLabelText(/Setback/)).toHaveLength(3);
  });

  it('renders preview-error badge when previewError is set', () => {
    render(
      <FilletDialog
        edges={[]}
        pickingMode="edge"
        previewError="Fillet failed"
        {...noopHandlers}
      />,
    );
    expect(screen.getByText(/Preview:/)).toBeInTheDocument();
  });
});

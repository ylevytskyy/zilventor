import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ParametersPanel } from '../ParametersPanel';
import { ParameterRegistry } from '../../parameters/ParameterRegistry';

describe('ParametersPanel', () => {
  it('lists current parameters', () => {
    const registry = new ParameterRegistry();
    registry.setParameter({ name: 'd0', expression: '50', unit: 'mm' });
    registry.setParameter({ name: 'width', expression: 'd0 * 2', unit: 'mm' });
    render(<ParametersPanel registry={registry} onClose={() => {}} />);
    expect(screen.getByText('d0')).toBeInTheDocument();
    expect(screen.getByText('width')).toBeInTheDocument();
    expect(screen.getByText('100')).toBeInTheDocument();
  });

  it('updating an expression recomputes dependents', () => {
    const registry = new ParameterRegistry();
    registry.setParameter({ name: 'd0', expression: '50', unit: 'mm' });
    registry.setParameter({ name: 'width', expression: 'd0 * 2', unit: 'mm' });
    const { rerender } = render(<ParametersPanel registry={registry} onClose={() => {}} />);
    // double-click the expression span (first match — the <span> in Expression column)
    const expressionSpan = screen.getAllByText('50')[0]!;
    fireEvent.doubleClick(expressionSpan);
    const input = screen.getByDisplayValue('50');
    fireEvent.change(input, { target: { value: '100' } });
    fireEvent.blur(input);
    rerender(<ParametersPanel registry={registry} onClose={() => {}} />);
    expect(screen.getByText('200')).toBeInTheDocument();
  });
});

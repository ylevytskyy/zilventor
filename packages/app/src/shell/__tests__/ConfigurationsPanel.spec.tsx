import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ConfigurationsPanel } from '../ConfigurationsPanel';
import type { Configuration } from '@zilventor/shared';

const CONFIGS: Configuration[] = [
  { name: 'Large', values: { width: '900', height: '1200' } },
  { name: 'Small', values: { width: '300', height: '400' } },
];

function renderPanel(overrides: Partial<Parameters<typeof ConfigurationsPanel>[0]> = {}) {
  const props = {
    configurations: CONFIGS,
    activeName: null as string | null,
    onActivate: vi.fn(),
    onAddRow: vi.fn(),
    onImport: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
  render(<ConfigurationsPanel {...props} />);
  return props;
}

describe('ConfigurationsPanel', () => {
  it('renders one row per configuration', () => {
    renderPanel();
    expect(screen.getByText('Large')).toBeInTheDocument();
    expect(screen.getByText('Small')).toBeInTheDocument();
  });

  it('highlights the active configuration row', () => {
    renderPanel({ activeName: 'Small' });
    expect(screen.getByTestId('config-row-Small')).toHaveAttribute('aria-current', 'true');
    expect(screen.getByTestId('config-row-Large')).not.toHaveAttribute('aria-current', 'true');
  });

  it('clicking a row fires onActivate with the configuration name', () => {
    const props = renderPanel();
    fireEvent.click(screen.getByTestId('config-row-Large'));
    expect(props.onActivate).toHaveBeenCalledWith('Large');
  });

  it('clicking Add Row fires onAddRow', () => {
    const props = renderPanel();
    fireEvent.click(screen.getByTestId('config-add-row'));
    expect(props.onAddRow).toHaveBeenCalledTimes(1);
  });
});

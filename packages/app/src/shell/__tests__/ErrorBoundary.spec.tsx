import { render, screen } from '@testing-library/react';
import { ErrorBoundary } from '../ErrorBoundary';

function Boom(): never { throw new Error('kaboom'); }

it('renders a recovery fallback (not a blank screen) when a child throws', () => {
  // suppress the expected React error console noise
  const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
  render(<ErrorBoundary><Boom /></ErrorBoundary>);
  expect(screen.getByRole('button', { name: /reload/i })).toBeInTheDocument();
  expect(screen.getByText(/kaboom/i)).toBeInTheDocument();
  spy.mockRestore();
});

it('renders children normally when no error', () => {
  render(<ErrorBoundary><div>ok-content</div></ErrorBoundary>);
  expect(screen.getByText('ok-content')).toBeInTheDocument();
});

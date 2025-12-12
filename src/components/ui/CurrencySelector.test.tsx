import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CurrencySelector } from './CurrencySelector';

// Mock ResizeObserver locally to ensure it works
class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal('ResizeObserver', ResizeObserver);

describe('CurrencySelector', () => {
  it('renders with initial value', () => {
    const handleChange = vi.fn();
    render(
      <CurrencySelector
        value="USD"
        onChange={handleChange}
      />
    );

    expect(screen.getByRole('combobox')).toHaveTextContent('USD - United States Dollar');
  });

  it('renders placeholder when no value', () => {
    const handleChange = vi.fn();
    render(
      <CurrencySelector
        value=""
        onChange={handleChange}
      />
    );

    expect(screen.getByRole('combobox')).toHaveTextContent('Select currency...');
  });

  it('opens popover and shows options when clicked', async () => {
    const user = userEvent.setup();
    const handleChange = vi.fn();
    render(
      <CurrencySelector
        value=""
        onChange={handleChange}
      />
    );

    await user.click(screen.getByRole('combobox'));

    expect(screen.getByRole('listbox')).toBeInTheDocument(); // CommandList usually acts as listbox or contains items
    // Since Shadcn Command might not use listbox role directly on the list, check for items
    expect(screen.getByText('USD - United States Dollar')).toBeInTheDocument();
    expect(screen.getByText('EUR - Euro')).toBeInTheDocument();
  });

  it('filters currencies when typing', async () => {
    const user = userEvent.setup();
    const handleChange = vi.fn();
    render(
      <CurrencySelector
        value=""
        onChange={handleChange}
      />
    );

    await user.click(screen.getByRole('combobox'));
    
    // Type in the search input
    const input = screen.getByPlaceholderText('Search currency...');
    await user.type(input, 'Euro');

    // Should show Euro
    expect(screen.getByText('EUR - Euro')).toBeInTheDocument();
    
    // Should not show USD
    // Using queryByText here because it might be hidden or removed
    await waitFor(() => {
        expect(screen.queryByText('USD - United States Dollar')).not.toBeInTheDocument();
    });
  });

  it('calls onChange when selecting a currency', async () => {
    const user = userEvent.setup();
    const handleChange = vi.fn();
    render(
      <CurrencySelector
        value=""
        onChange={handleChange}
      />
    );

    await user.click(screen.getByRole('combobox'));
    await user.click(screen.getByText('EUR - Euro'));

    expect(handleChange).toHaveBeenCalledWith('EUR');
  });
});

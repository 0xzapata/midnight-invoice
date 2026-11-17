import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { HeaderNav } from './HeaderNav';

describe('HeaderNav', () => {
  it('shows separate links from sm and one pages menu on phones', async () => {
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <Routes>
          <Route path="/" element={<HeaderNav />} />
          <Route path="/templates" element={<p>Templates page</p>} />
        </Routes>
      </MemoryRouter>,
    );
    const inline = screen.getByRole('navigation', { name: 'Pages' });
    expect(inline).toHaveClass('hidden', 'sm:flex');
    expect(within(inline).getAllByRole('link').map((l) => l.textContent)).toEqual(['Clients', 'Templates', 'Recurring', 'Agents']);
    const menuButton = screen.getByRole('button', { name: 'Pages menu' });
    expect(menuButton).toHaveClass('sm:hidden');
    await user.click(menuButton);
    const menus = await screen.findAllByRole('navigation', { name: 'Pages' });
    const menu = menus.find((m) => m !== inline)!;
    await user.click(within(menu).getByRole('link', { name: 'Templates' }));
    expect(await screen.findByText('Templates page')).toBeInTheDocument();
    vi.unstubAllGlobals();
  });
});

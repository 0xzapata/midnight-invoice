import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import indexHtml from '../../index.html?raw';
import App from '@/App';
import { resolveDocumentInvoiceTheme } from '@/components/invoice/invoiceTheme';
import { useInvoiceStore } from '@/stores/useInvoiceStore';

vi.mock('@react-pdf/renderer', () => ({
  pdf: vi.fn(),
  Document: () => null,
  Page: () => null,
  Text: () => null,
  View: () => null,
  StyleSheet: { create: (s: unknown) => s },
  Font: { register: vi.fn(), registerHyphenationCallback: vi.fn() },
}));

/** The inline script index.html runs in <head>, before anything is painted. */
const bootstrap = indexHtml.match(/<script>([\s\S]*?)<\/script>/)![1];
const runBootstrap = () => new Function(bootstrap)();
const htmlIsDark = () => document.documentElement.classList.contains('dark');

/** Like a fresh page load of index.html: <html class="dark">, nothing on <body>. */
function freshDocument() {
  document.documentElement.className = 'dark';
  document.body.className = '';
}

describe('theme bootstrap (index.html)', () => {
  beforeEach(() => {
    localStorage.clear();
    freshDocument();
  });

  it('ships dark on <html> and nothing on <body>', () => {
    expect(indexHtml).toMatch(/<html lang="en" class="dark">/);
    expect(indexHtml).toMatch(/<body>/);
    // The script sits in <head>, so it runs before the body is parsed or painted.
    expect(indexHtml.indexOf(bootstrap)).toBeLessThan(indexHtml.indexOf('</head>'));
  });

  it('keeps dark for new visitors and for a stored "dark"', () => {
    runBootstrap();
    expect(htmlIsDark()).toBe(true);
    localStorage.setItem('theme', 'dark');
    runBootstrap();
    expect(htmlIsDark()).toBe(true);
  });

  it('applies a stored "light" before the app loads', () => {
    localStorage.setItem('theme', 'light');
    runBootstrap();
    expect(htmlIsDark()).toBe(false);
  });

  it('survives blocked storage', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(runBootstrap).not.toThrow();
    expect(htmlIsDark()).toBe(true);
    spy.mockRestore();
  });
});

describe('theme on every route', () => {
  beforeEach(() => {
    localStorage.clear();
    freshDocument();
    useInvoiceStore.setState({
      invoices: [{
        id: 'inv-1', invoiceNumber: 'INV-0001', issueDate: '2026-11-17', fromName: 'Me', fromAddress: '', fromEmail: '',
        toName: 'Client', toAddress: '', toEmail: '', lineItems: [{ id: '1', description: 'Work', quantity: 1, price: 1 }],
        taxRate: 0, notes: '', paymentDetails: '', currency: 'USD', createdAt: '2026-11-17T10:00:00.000Z',
      }],
    });
  });

  it.each(['/create/abc', '/invoice/inv-1', '/no-such-page'])('%s starts light when light was chosen, and offers the toggle', async (path) => {
    localStorage.setItem('theme', 'light');
    runBootstrap();
    window.history.pushState({}, '', path);
    render(<App />);
    // Still light after React mounted (the provider at the root applies the stored theme).
    await waitFor(() => expect(screen.getAllByRole('button', { name: /switch to dark mode/i }).length).toBeGreaterThan(0));
    expect(htmlIsDark()).toBe(false);
    // The PDF follows what the preview shows.
    expect(resolveDocumentInvoiceTheme()).toBe('light');
  });

  it('toggling stores the choice and updates <html>', async () => {
    const user = userEvent.setup();
    window.history.pushState({}, '', '/no-such-page');
    render(<App />);
    expect(htmlIsDark()).toBe(true);
    await user.click(await screen.findByRole('button', { name: /switch to light mode/i }));
    await act(async () => {});
    expect(htmlIsDark()).toBe(false);
    expect(localStorage.getItem('theme')).toBe('light');
    expect(resolveDocumentInvoiceTheme()).toBe('light');
  });
});

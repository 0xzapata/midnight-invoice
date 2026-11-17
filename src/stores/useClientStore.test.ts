import { beforeEach, describe, expect, it } from 'vitest';
import type { Invoice } from '@/types/invoice';
import { CURRENT_CLIENT_VERSION, migrateClientStore } from '@/lib/storageMigrations';
import { activeClientsSorted, invoicesForClient, useClientStore } from './useClientStore';

const invoice = (overrides: Partial<Invoice>): Invoice => ({
  id: crypto.randomUUID(),
  invoiceNumber: 'INV-0001',
  issueDate: '2026-11-01',
  fromName: 'Ada',
  fromAddress: '',
  fromEmail: '',
  toName: '',
  toAddress: '',
  toEmail: '',
  lineItems: [],
  taxRate: 0,
  notes: '',
  paymentDetails: '',
  currency: 'USD',
  createdAt: '2026-11-01T00:00:00.000Z',
  ...overrides,
});

beforeEach(() => {
  localStorage.clear();
  useClientStore.setState({ clients: [] });
});

describe('useClientStore', () => {
  it('saves, edits (keeping createdAt and sync metadata), archives and deletes clients, persisted', () => {
    const { saveClient } = useClientStore.getState();
    const created = saveClient({ name: '  Globex ', email: ' ap@globex.example ', address: '1 Way', defaultTaxRate: 7, paymentTermsDays: 30.4 });
    expect(created).toMatchObject({ name: 'Globex', email: 'ap@globex.example', defaultTaxRate: 7, paymentTermsDays: 30, defaultCurrency: null, archivedAt: null });
    useClientStore.setState({ clients: [{ ...created, revision: 3 }] });

    const edited = saveClient({ name: 'Globex Corp', email: '', address: '' }, created.id);
    expect(edited).toMatchObject({ id: created.id, createdAt: created.createdAt, revision: 3, name: 'Globex Corp', defaultTaxRate: null });

    useClientStore.getState().setArchived(created.id, true);
    expect(useClientStore.getState().getClient(created.id)?.archivedAt).toEqual(expect.any(String));
    expect(activeClientsSorted(useClientStore.getState().clients)).toEqual([]);
    useClientStore.getState().setArchived(created.id, false);
    expect(activeClientsSorted(useClientStore.getState().clients).map((c) => c.name)).toEqual(['Globex Corp']);

    const persisted = JSON.parse(localStorage.getItem('client-storage')!);
    expect(persisted.version).toBe(CURRENT_CLIENT_VERSION);
    expect(persisted.state.clients[0].name).toBe('Globex Corp');
    expect(Object.keys(persisted.state)).toEqual(['clients']);

    useClientStore.getState().deleteClient(created.id);
    expect(useClientStore.getState().clients).toEqual([]);
  });

  it('imports one client per normalised name + email, newest address first, skipping saved ones', () => {
    useClientStore.getState().saveClient({ name: 'Initech', email: 'ap@initech.example', address: '' });
    const created = useClientStore.getState().importFromInvoices([
      invoice({ toName: 'Globex', toEmail: 'AP@globex.example', toAddress: 'Old street', createdAt: '2026-01-01T00:00:00.000Z' }),
      invoice({ toName: '  globex ', toEmail: 'ap@globex.example ', toAddress: 'New street', createdAt: '2026-06-01T00:00:00.000Z' }),
      invoice({ toName: 'Globex', toEmail: '', toAddress: 'No email' }), // different email → different client
      invoice({ toName: 'INITECH', toEmail: 'ap@initech.example' }), // already saved
      invoice({ toName: '   ' }), // no name
    ]);
    // Newest invoices first (the "No email" one has the latest createdAt).
    expect(created.map((c) => [c.name, c.email, c.address])).toEqual([
      ['Globex', '', 'No email'],
      ['globex', 'ap@globex.example', 'New street'],
    ]);
    expect(useClientStore.getState().clients).toHaveLength(3);
    // Importing again adds nothing.
    expect(useClientStore.getState().importFromInvoices([invoice({ toName: 'GLOBEX', toEmail: 'ap@globex.example' })])).toEqual([]);
  });

  it('counts invoices by clientId, and older unlinked invoices by matching name + email', () => {
    const globex = useClientStore.getState().saveClient({ name: 'Globex', email: 'ap@globex.example', address: '' });
    const invoices = [
      invoice({ clientId: globex.id, toName: 'Globex renamed' }),
      invoice({ toName: 'globex', toEmail: 'AP@globex.example' }),
      invoice({ clientId: 'other', toName: 'Globex', toEmail: 'ap@globex.example' }),
      invoice({ toName: 'Initech' }),
    ];
    expect(invoicesForClient(globex, invoices)).toHaveLength(2);
  });
});

describe('migrateClientStore', () => {
  it('normalises entries and drops broken ones', () => {
    const result = migrateClientStore(
      {
        clients: [
          { id: 'a', name: 'Globex', defaultTaxRate: 'x', revision: 2, createdAt: '2026-01-01T00:00:00.000Z' },
          { id: 'a', name: 'Duplicate id' },
          { name: 'No id' },
          { id: 'b' },
          null,
        ],
      },
      0,
    );
    expect(result.clients).toEqual([
      {
        id: 'a',
        name: 'Globex',
        email: '',
        address: '',
        defaultCurrency: null,
        defaultTaxRate: null,
        paymentTermsDays: null,
        notes: '',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        archivedAt: null,
        revision: 2,
      },
    ]);
    expect(migrateClientStore(undefined, 0)).toEqual({ clients: [] });
    expect(migrateClientStore({ clients: 'nope' }, 1)).toEqual({ clients: [] });
  });
});

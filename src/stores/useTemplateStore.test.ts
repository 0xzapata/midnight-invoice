import { beforeEach, describe, expect, it, vi } from 'vitest';
import { activeTemplatesSorted, templateDataFromInvoice, useTemplateStore } from './useTemplateStore';
import { CURRENT_TEMPLATE_VERSION, migrateTemplateStore } from '@/lib/storageMigrations';
import { setLocalChangeListener, type LocalChange } from '@/lib/sync/localChanges';
import type { TemplateFormData } from '../../shared/types/template';

const BASE: TemplateFormData = {
  name: '  Monthly retainer ',
  description: ' For Globex ',
  clientId: '',
  lineItems: [
    { id: '', description: ' Retainer {{month_name}} ', quantity: 1, price: 2000 },
    { id: 'blank', description: '   ', quantity: 1, price: 0 },
  ],
  taxRate: Number.NaN,
  currency: '',
  notes: 'Thanks',
  paymentDetails: '',
  paymentTermsDays: 14.4,
  invoiceNamePattern: ' Retainer {{month_name}} {{year}} ',
} as unknown as TemplateFormData;

let changes: LocalChange[];
beforeEach(() => {
  localStorage.clear();
  useTemplateStore.setState({ templates: [] });
  changes = [];
  setLocalChangeListener((c) => changes.push(c));
  return () => setLocalChangeListener(null);
});

describe('useTemplateStore', () => {
  it('saves cleaned templates and reports every user change to the sync engine', () => {
    const t = useTemplateStore.getState().saveTemplate(BASE);
    expect(t).toMatchObject({
      name: 'Monthly retainer',
      description: 'For Globex',
      clientId: null,
      taxRate: null,
      currency: null,
      paymentTermsDays: 14,
      invoiceNamePattern: 'Retainer {{month_name}} {{year}}',
      archivedAt: null,
    });
    // Blank lines are dropped, missing line ids generated.
    expect(t.lineItems).toEqual([{ id: expect.any(String), description: 'Retainer {{month_name}}', quantity: 1, price: 2000 }]);
    expect(changes).toEqual([{ collection: 'templates', type: 'upsert', id: t.id }]);

    useTemplateStore.setState((s) => ({ templates: s.templates.map((x) => ({ ...x, revision: 3 })) }));
    const edited = useTemplateStore.getState().saveTemplate({ ...BASE, name: 'Renamed' }, t.id);
    expect(edited).toMatchObject({ name: 'Renamed', createdAt: t.createdAt, revision: 3 });
    expect(useTemplateStore.getState().templates).toHaveLength(1);

    useTemplateStore.getState().setArchived(t.id, true);
    useTemplateStore.getState().setArchived(t.id, true); // no-op
    expect(useTemplateStore.getState().getTemplate(t.id)?.archivedAt).toEqual(expect.any(String));
    useTemplateStore.getState().deleteTemplate(t.id);
    expect(useTemplateStore.getState().templates).toEqual([]);
    expect(changes.map((c) => c.type)).toEqual(['upsert', 'upsert', 'upsert', 'delete']);
    expect(changes[3]).toMatchObject({ collection: 'templates', id: t.id, entity: { id: t.id, revision: 3 } });
  });

  it('persists to localStorage under template-storage with a version', () => {
    useTemplateStore.getState().saveTemplate(BASE);
    const stored = JSON.parse(localStorage.getItem('template-storage')!);
    expect(stored.version).toBe(CURRENT_TEMPLATE_VERSION);
    expect(stored.state.templates[0].name).toBe('Monthly retainer');
    expect(stored.state).not.toHaveProperty('_hasHydrated');
  });

  it('activeTemplatesSorted hides archived ones and sorts by name', () => {
    const mk = (name: string, archivedAt: string | null = null) => ({ ...useTemplateStore.getState().saveTemplate({ ...BASE, name }), archivedAt });
    expect(activeTemplatesSorted([mk('b'), mk('A'), mk('c', '2026-01-01T00:00:00.000Z')]).map((t) => t.name)).toEqual(['A', 'b']);
  });

  it('templateDataFromInvoice keeps lines, terms and client but no dates or number', () => {
    vi.spyOn(crypto, 'randomUUID').mockReturnValueOnce('00000000-0000-4000-8000-000000000001');
    const data = templateDataFromInvoice(
      {
        invoiceNumber: 'INV-0009',
        issueDate: '2026-03-01',
        dueDate: '2026-03-31',
        clientId: 'c1',
        lineItems: [
          { id: 'x', description: 'Design', quantity: 2, price: 50 },
          { id: 'y', description: '  ', quantity: 1, price: 0 },
        ],
        taxRate: 7,
        currency: 'EUR',
        notes: 'Thanks',
        paymentDetails: 'IBAN',
      },
      'From INV-0009',
    );
    expect(data).toEqual({
      name: 'From INV-0009',
      description: '',
      clientId: 'c1',
      lineItems: [{ id: '00000000-0000-4000-8000-000000000001', description: 'Design', quantity: 2, price: 50 }],
      taxRate: 7,
      currency: 'EUR',
      notes: 'Thanks',
      paymentDetails: 'IBAN',
      paymentTermsDays: 30,
      invoiceNamePattern: '',
    });
    expect(templateDataFromInvoice({ issueDate: '2026-03-01', dueDate: '' }, 'x').paymentTermsDays).toBeNull();
    expect(templateDataFromInvoice({ issueDate: '2026-03-10', dueDate: '2026-03-01' }, 'x').paymentTermsDays).toBeNull();
  });
});

describe('migrateTemplateStore', () => {
  it('normalises entries and never throws on corrupt data', () => {
    expect(migrateTemplateStore(null, 0)).toEqual({ templates: [] });
    expect(migrateTemplateStore({ templates: 'nope' }, 0)).toEqual({ templates: [] });
    const { templates } = migrateTemplateStore(
      {
        templates: [
          { id: 't1', name: 'Kept', lineItems: [{ id: 'a', description: 'A', quantity: 'x', price: 5 }, { id: 'a', description: 'dup id' }, { quantity: 1 }, 'junk'], taxRate: 'high', currency: '', revision: 2, createdBy: { type: 'agent', agentName: 'Bot' }, createdAt: '2026-01-01T00:00:00.000Z' },
          { id: 't1', name: 'Duplicate id' },
          { name: 'No id' },
          { id: 't2' },
          42,
        ],
      },
      0,
    );
    expect(templates).toHaveLength(1);
    expect(templates[0]).toMatchObject({
      id: 't1',
      name: 'Kept',
      description: '',
      clientId: null,
      taxRate: null,
      currency: null,
      notes: '',
      paymentDetails: '',
      paymentTermsDays: null,
      invoiceNamePattern: '',
      archivedAt: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      revision: 2,
      createdBy: { type: 'agent', agentName: 'Bot' },
    });
    expect(templates[0].lineItems).toEqual([
      { id: 'a', description: 'A', quantity: 1, price: 5 },
      { id: expect.any(String), description: 'dup id', quantity: 1, price: 0 },
    ]);
    expect(templates[0].lineItems[1].id).not.toBe('a');
  });
});

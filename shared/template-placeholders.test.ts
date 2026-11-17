import { describe, expect, it } from 'vitest';
import { placeholdersIn, placeholderValues, resolvePlaceholders, TEMPLATE_PLACEHOLDERS } from './template-placeholders';
import { invoiceFieldsFromTemplate } from './types/template';

const ctx = { issueDate: '2026-03-05', clientName: 'Globex', invoiceNumber: 'INV-0042' };

describe('resolvePlaceholders', () => {
  it('resolves every whitelisted placeholder against the issue date', () => {
    const text = TEMPLATE_PLACEHOLDERS.map((p) => `{{${p.name}}}`).join('|');
    expect(resolvePlaceholders(text, ctx)).toEqual({
      text: '03|March|February|2026|2026|Q1|Globex|INV-0042',
      unknown: [],
      unresolved: [],
    });
    // Every documented example is what the example date produces (docs cannot drift).
    expect(TEMPLATE_PLACEHOLDERS.map((p) => p.example)).toEqual(['03', 'March', 'February', '2026', '2026', 'Q1', 'Globex Corporation', 'INV-0042']);
  });

  it('handles year boundaries and quarters', () => {
    const v = (issueDate: string) => placeholderValues({ issueDate });
    expect(v('2026-01-15')).toMatchObject({ month: '01', month_name: 'January', prev_month_name: 'December', prev_month_year: '2025', year: '2026', quarter: 'Q1' });
    expect(v('2026-12-31')).toMatchObject({ month: '12', prev_month_name: 'November', prev_month_year: '2026', quarter: 'Q4' });
    expect(v('2026-04-01').quarter).toBe('Q2');
    expect(v('2026-09-30').quarter).toBe('Q3');
    // Only the calendar date matters: no time zone can shift the month.
    expect(v('2026-03-31').month_name).toBe('March');
  });

  it('allows spaces inside the braces and repeats', () => {
    expect(resolvePlaceholders('{{ month_name }} / {{month_name}} {{  year}}', ctx).text).toBe('March / March 2026');
  });

  it('leaves unknown names visible and reports them once, in order (strict whitelist, case-sensitive)', () => {
    const r = resolvePlaceholders('{{Month}} {{constructor}} {{__proto__}} {{a.b}} {{Month}} {{month-name}}', ctx);
    expect(r.text).toBe('{{Month}} {{constructor}} {{__proto__}} {{a.b}} {{Month}} {{month-name}}');
    expect(r.unknown).toEqual(['Month', 'constructor', '__proto__', 'a.b', 'month-name']);
  });

  it('never evaluates anything: expressions, nested braces and odd syntax stay literal text', () => {
    for (const s of ['{{ year + 1 }}', '{{year()}}', '{{', '}}', '{year}', '{{ }}', '${year}', '{{year|upper}}', '{{ month_name ', 'year}}']) {
      expect(resolvePlaceholders(s, ctx)).toEqual({ text: s, unknown: [], unresolved: [] });
    }
    // Names of Object.prototype members are not placeholders either.
    expect(resolvePlaceholders('{{toString}}', ctx)).toEqual({ text: '{{toString}}', unknown: ['toString'], unresolved: [] });
    // Triple braces: the inner {{year}} is a placeholder, the extra braces are text.
    expect(resolvePlaceholders('{{{year}}}', ctx).text).toBe('{2026}');
  });

  it('reports known placeholders without a value as unresolved and leaves them visible', () => {
    const r = resolvePlaceholders('For {{client_name}} ({{invoice_number}}) in {{month_name}}', { issueDate: '2026-03-05', clientName: '  ', invoiceNumber: null });
    expect(r).toEqual({ text: 'For {{client_name}} ({{invoice_number}}) in March', unknown: [], unresolved: ['client_name', 'invoice_number'] });
    // An invalid date leaves the date placeholders unresolved rather than guessing.
    expect(resolvePlaceholders('{{year}}-{{month}}', { issueDate: 'soon' })).toEqual({ text: '{{year}}-{{month}}', unknown: [], unresolved: ['year', 'month'] });
    expect(resolvePlaceholders('{{month}}', { issueDate: '2026-13-01' }).unresolved).toEqual(['month']);
  });

  it('inserts values literally (a client name with braces or $ patterns is not re-expanded)', () => {
    expect(resolvePlaceholders('{{client_name}}', { ...ctx, clientName: '{{year}} $& $1' }).text).toBe('{{year}} $& $1');
  });

  it('placeholdersIn lists names used, known or not', () => {
    expect(placeholdersIn('a {{year}} b {{nope}} {{year}}')).toEqual(['year', 'nope']);
    expect(placeholdersIn('plain')).toEqual([]);
  });
});

describe('invoiceFieldsFromTemplate', () => {
  const template = {
    clientId: 'c1',
    lineItems: [{ id: 't1', description: 'Retainer {{prev_month_name}}', quantity: 1, price: 100 }],
    taxRate: null,
    currency: 'EUR',
    notes: 'Thanks {{client_name}} {{oops}}',
    paymentDetails: 'IBAN {{year}}',
    paymentTermsDays: 30,
    invoiceNamePattern: '  {{month_name}} {{year}}  ',
  };

  it('returns only the fields the template sets, with placeholders resolved and fresh line ids', () => {
    let n = 0;
    const r = invoiceFieldsFromTemplate(template, ctx, () => `new-${++n}`);
    expect(r.fields).toEqual({
      invoiceName: 'March 2026',
      lineItems: [{ id: 'new-1', description: 'Retainer February', quantity: 1, price: 100 }],
      notes: 'Thanks Globex {{oops}}',
      // Payment details are copied as typed (no placeholders there).
      paymentDetails: 'IBAN {{year}}',
      currency: 'EUR',
      dueDate: '2026-04-04',
      clientId: 'c1',
    });
    expect(r.unknown).toEqual(['oops']);
    expect(r.unresolved).toEqual([]);
  });

  it('leaves unset values out so client defaults and settings apply', () => {
    const r = invoiceFieldsFromTemplate(
      { ...template, clientId: null, currency: null, notes: '', paymentDetails: '', paymentTermsDays: null, invoiceNamePattern: ' ', lineItems: [] },
      ctx,
      () => 'x',
    );
    expect(r.fields).toEqual({ lineItems: [] });
  });
});

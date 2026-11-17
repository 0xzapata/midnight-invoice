import type { Scope } from '../../../shared/api';

/** Plain-language scope descriptions for consent and management screens. */
export const SCOPE_INFO: Record<Scope, { title: string; allows: string; sensitive?: boolean }> = {
  'invoices:read': {
    title: 'View invoices',
    allows: 'See every invoice in this workspace (clients, amounts, notes, payment details), the next invoice number, and download PDFs.',
  },
  'invoices:write': {
    title: 'Create and edit invoices',
    allows: 'Add new invoices and change existing ones. Changes show up in this app, marked with the agent’s name.',
  },
  'invoices:delete': {
    title: 'Delete invoices',
    allows: 'Delete invoices. Deleted invoices disappear from all your devices and cannot be restored.',
    sensitive: true,
  },
  'settings:read': {
    title: 'Read your default details',
    allows: 'See your default name, email, address, payment details, notes, tax rate and currency, used to prefill invoices.',
  },
};

export const SCOPE_SHORT: Record<Scope, string> = {
  'invoices:read': 'View',
  'invoices:write': 'Create & edit',
  'invoices:delete': 'Delete',
  'settings:read': 'Read defaults',
};

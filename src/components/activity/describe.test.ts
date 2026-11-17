import { describe, expect, it } from 'vitest';
import type { ActivityEntry } from '../../../shared/activity';
import { describeEntry, sentenceOf } from './describe';

const agent = { type: 'agent' as const, agentId: 'a1', agentName: 'Billing Assistant' };
const entry = (e: Partial<ActivityEntry> & Pick<ActivityEntry, 'action'>): ActivityEntry => ({
  id: 'act_1',
  time: '2026-11-17T12:00:00.000Z',
  actor: agent,
  entity: null,
  changes: null,
  source: 'rest',
  tool: null,
  requestId: null,
  ...e,
});
const inv = { type: 'invoice', id: 'i1', label: 'INV-0007' };

describe('activity sentences', () => {
  it.each<[Partial<ActivityEntry> & Pick<ActivityEntry, 'action'>, string, string[]]>([
    [{ action: 'invoice.created', entity: inv }, 'Billing Assistant created INV-0007', []],
    [{ action: 'invoice.created', entity: inv, changes: { status: { from: null, to: 'sent' } } }, 'Billing Assistant created INV-0007 as sent', []],
    [{ action: 'invoice.updated', entity: inv, changes: { fields: ['dueDate', 'lineItems', 'notes'] } }, 'Billing Assistant edited INV-0007', ['Changed due date, line items and notes']],
    [{ action: 'invoice.status_changed', entity: inv, changes: { status: { from: 'sent', to: 'paid' } } }, 'Billing Assistant marked INV-0007 as paid', ['Was sent']],
    [{ action: 'invoice.status_changed', entity: inv, changes: { status: { from: 'draft', to: 'void' }, fields: ['notes'] } }, 'Billing Assistant voided INV-0007', ['Was draft', 'Changed notes']],
    [{ action: 'invoice.status_changed', entity: inv, changes: { status: { from: 'sent', to: 'draft' } } }, 'Billing Assistant moved INV-0007 back to draft', ['Was sent']],
    [{ action: 'invoice.deleted', entity: inv }, 'Billing Assistant deleted INV-0007', []],
    [{ action: 'invoice.pdf_downloaded', entity: inv, changes: { theme: 'light' } }, 'Billing Assistant downloaded the PDF of INV-0007', ['Light theme']],
    [{ action: 'client.updated', actor: { type: 'user' }, entity: { type: 'client', id: 'c1', label: 'Globex' }, changes: { fields: ['paymentTermsDays', 'email'] } }, 'You edited the client Globex', ['Changed payment terms and email']],
    [{ action: 'client.archived', entity: { type: 'client', id: 'c1', label: 'Globex' } }, 'Billing Assistant archived the client Globex', []],
    [{ action: 'settings.updated', actor: { type: 'user' }, entity: { type: 'settings', id: 'default', label: null }, changes: { fields: ['fromName', 'taxRate'] } }, 'You changed the default settings', ['Changed your name and default tax rate']],
    [{ action: 'agent.approved', actor: { type: 'user' }, entity: { type: 'agent_registration', id: 'r1', label: 'Billing Assistant' }, changes: { scopes: ['invoices:read', 'invoices:write'] } }, 'You approved the agent Billing Assistant', ['Permissions: View, Create & edit']],
    [{ action: 'agent.denied', actor: { type: 'user' }, entity: { type: 'agent_registration', id: 'r2', label: 'Sketchy' } }, 'You denied the agent Sketchy', []],
    [{ action: 'agent.registered', entity: { type: 'agent', id: 'a1', label: 'Billing Assistant' }, changes: { scopes: ['invoices:read'] } }, 'Billing Assistant connected and received its API key', ['Permissions: View']],
    [{ action: 'agent.revoked', actor: { type: 'user' }, entity: { type: 'agent', id: 'a1', label: 'Billing Assistant' } }, 'You revoked access for Billing Assistant', []],
    [{ action: 'agent.revoked_key_used', entity: { type: 'agent', id: 'a1', label: 'Billing Assistant' } }, 'Billing Assistant tried to use its revoked key (refused)', []],
    [{ action: 'sync.bulk_upload', actor: { type: 'user' }, changes: { counts: { clients: 1, invoices: 12 } } }, 'You uploaded 1 client and 12 invoices to the cloud workspace', []],
    [{ action: 'account.workspace_claimed', actor: { type: 'user' } }, 'You added this workspace to your account', []],
    [{ action: 'account.workspace_created', actor: { type: 'user' } }, 'You created this cloud workspace with your account', []],
    [{ action: 'account.device_signed_in', actor: { type: 'user' }, entity: { type: 'device', id: 'd1', label: 'Firefox on macOS' } }, 'You signed in on Firefox on macOS', []],
    [{ action: 'account.device_revoked', actor: { type: 'user' }, entity: { type: 'device', id: 'd1', label: 'Safari on iOS' } }, 'You signed out Safari on iOS', []],
    [{ action: 'account.signed_out_everywhere', actor: { type: 'user' }, changes: { counts: { devices: 3 } } }, 'You signed out everywhere', ['3 devices signed out']],
    [{ action: 'account.signed_out_other_devices', actor: { type: 'user' }, changes: { counts: { devices: 1 } } }, 'You signed out all other devices', ['1 device signed out']],
    [{ action: 'account.recovery_key_created', actor: { type: 'user' } }, 'You created a recovery key', []],
    [{ action: 'account.recovery_key_rotated', actor: { type: 'user' } }, 'You replaced the recovery key (the old one no longer works)', []],
    [{ action: 'account.recovery_key_disabled', actor: { type: 'user' } }, 'You turned off the recovery key', []],
    [{ action: 'account.deleted', actor: { type: 'user' } }, 'You deleted your account; this workspace was kept with a new recovery key', []],
    [{ action: 'account.disabled', actor: { type: 'system' } }, 'System disabled your account on behalf of the site operator; its devices were signed out', []],
    [{ action: 'template.created', entity: { type: 'template', id: 't1', label: 'Monthly retainer' } }, 'Billing Assistant template.created on Monthly retainer', []],
    [{ action: 'invoice.deleted', entity: { type: 'invoice', id: 'i9', label: null } }, 'Billing Assistant deleted an invoice', []],
  ])('%o', (e, sentence, details) => {
    const full = entry(e);
    expect(sentenceOf(full)).toBe(sentence);
    expect(describeEntry(full).details).toEqual(details);
  });
});

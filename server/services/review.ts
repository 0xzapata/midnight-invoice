/**
 * "Needs your review": agent-written data the user has not confirmed, and the
 * explicit review actions (workspace / device token only).
 *
 * - An invoice needs review when one of its sender details (fromName,
 *   fromEmail, paymentDetails) is neither the workspace settings nor a value
 *   the user entered or approved, or when its toEmail is an address the user
 *   never entered (the same rules as `requireSenderReview` /
 *   `isUserEnteredAddress` in invoiceEmail.ts). Agents and unattended
 *   recurring sends cannot email such an invoice.
 * - A client needs review when its email is an address the user never entered.
 *
 * A user save that does not change those fields confirms nothing (migration
 * 0011): the browser's full-document sync PUT carries every field, so only
 * these actions (or typing a new value) confirm what an agent wrote. Each
 * action names the revision it approves (If-Match) and re-checks it inside
 * its batch, so a value an agent changes after the user looked at it is
 * never approved by accident.
 */
import type { ListReviewsResponse, ReviewClientResponse, ReviewField, ReviewInvoiceResponse } from '../../shared/api';
import { normalizeEmail } from '../../shared/email-template';
import { requireUser } from '../auth';
import { createEmailRepository, SENDER_FIELDS } from '../db/emailRepository';
import { errors } from '../errors';
import { activityWrite } from './activity';
import { clientRepo, parseClientId, toApiClient } from './clients';
import { unreviewedSenderFields } from './invoiceEmail';
import { parseInvoiceId, today, toApiInvoice, type RevisionPrecondition, type ServiceContext } from './invoices';

const LIST_LIMIT = 200;

function requireRevision(pre: RevisionPrecondition): number {
  if (typeof pre !== 'number') throw errors.badRequest('Send If-Match with the revision you reviewed (the ETag, e.g. "3")');
  return pre;
}

/** GET /reviews: candidates from SQL (bounded), then the exact rules the send guard uses. */
export async function listReviews(ctx: ServiceContext): Promise<ListReviewsResponse> {
  requireUser(ctx.principal);
  const ws = ctx.principal.workspaceId;
  const emails = createEmailRepository(ctx.deps.db);
  const settings = (await ctx.repo.getSettings(ws))?.settings ?? null;
  const invoices: ListReviewsResponse['invoices'] = [];
  for (const row of await emails.reviewCandidateInvoices(ws, LIST_LIMIT)) {
    const values = { fromName: row.from_name, fromEmail: row.from_email, paymentDetails: row.payment_details };
    const previous = row.previous ? (JSON.parse(row.previous) as Partial<Record<ReviewField, string>>) : null;
    const fields: ListReviewsResponse['invoices'][number]['fields'] = (await unreviewedSenderFields(emails, ws, values, settings)).map((field) => ({
      field,
      value: values[field],
      previous: previous?.[field] ?? null,
    }));
    if (row.to_email.trim() && !(await emails.isUserEnteredAddress(ws, normalizeEmail(row.to_email)))) {
      fields.push({ field: 'toEmail', value: row.to_email, previous: previous?.toEmail ?? null });
    }
    if (fields.length) invoices.push({ id: row.id, invoiceNumber: row.invoice_number, revision: row.revision, agentName: row.agent_name, fields });
  }
  const clients = await emails.unconfirmedClients(ws, LIST_LIMIT);
  return { invoices, clients: clients.map((c) => ({ id: c.id, name: c.name, email: c.email, revision: c.revision, agentName: c.agent_name })) };
}

/**
 * POST /invoices/:id/review: the user approves the invoice's current sender
 * details and confirms its toEmail ("Looks right — approve"). If-Match names
 * the revision the user looked at; a newer revision → 412, nothing approved.
 */
export async function reviewInvoice(
  ctx: ServiceContext,
  rawId: string,
  pre: { ifMatch?: RevisionPrecondition },
  opts: { recipient?: boolean } = {},
): Promise<ReviewInvoiceResponse> {
  requireUser(ctx.principal);
  const ws = ctx.principal.workspaceId;
  const id = parseInvoiceId(rawId);
  const revision = requireRevision(pre.ifMatch);
  const row = await ctx.repo.getInvoice(ws, id);
  if (!row) throw errors.notFound('Invoice not found');
  if (row.deleted_at) throw errors.gone('Invoice was deleted', { id, deletedAt: row.deleted_at });
  const stale = () => errors.preconditionFailed('The invoice changed since you looked at it; review it again', { id, currentRevision: row.revision });
  if (row.revision !== revision) throw stale();
  const invoice = toApiInvoice(row, today(ctx.deps));
  const emails = createEmailRepository(ctx.deps.db);
  const settings = (await ctx.repo.getSettings(ws))?.settings ?? null;
  const fields: ReviewField[] = await unreviewedSenderFields(emails, ws, invoice, settings);
  const to = invoice.toEmail.trim();
  const confirmTo = opts.recipient !== false && !!to && !(await emails.isUserEnteredAddress(ws, normalizeEmail(to)));
  if (confirmTo) fields.push('toEmail');
  const { statements, guard } = emails.reviewInvoiceStatements({
    workspaceId: ws,
    invoiceId: id,
    revision,
    values: Object.fromEntries(SENDER_FIELDS.map((f) => [f, invoice[f] ?? ''])) as Record<(typeof SENDER_FIELDS)[number], string>,
    address: confirmTo ? normalizeEmail(to) : null,
    now: ctx.deps.clock().toISOString(),
  });
  if (fields.length) {
    statements.push(...activityWrite(ctx, { action: 'invoice.reviewed', entity: { type: 'invoice', id, label: invoice.invoiceNumber }, changes: { fields } }, { when: guard }).statements);
  }
  const [ok] = await ctx.deps.db.batch<{ ok: number }>(statements);
  if (!ok.results?.[0]?.ok) throw stale();
  return { invoice, approved: fields };
}

/** POST /clients/:id/review: the user confirms the client's current email address. */
export async function reviewClient(ctx: ServiceContext, rawId: string, pre: { ifMatch?: RevisionPrecondition }): Promise<ReviewClientResponse> {
  requireUser(ctx.principal);
  const ws = ctx.principal.workspaceId;
  const id = parseClientId(rawId);
  const revision = requireRevision(pre.ifMatch);
  const row = await clientRepo(ctx).getClient(ws, id);
  if (!row) throw errors.notFound('Client not found');
  if (row.deleted_at) throw errors.gone('Client was deleted', { id, deletedAt: row.deleted_at });
  const stale = () => errors.preconditionFailed('The client changed since you looked at it; review it again', { id, currentRevision: row.revision });
  if (row.revision !== revision) throw stale();
  const email = row.email.trim();
  if (!email) throw errors.validation([{ path: 'email', message: 'The client has no email address' }]);
  const emails = createEmailRepository(ctx.deps.db);
  const confirmed = !(await emails.isUserEnteredAddress(ws, normalizeEmail(email)));
  if (confirmed) {
    const { statements, guard } = emails.reviewClientStatements({ workspaceId: ws, clientId: id, revision, address: normalizeEmail(email), now: ctx.deps.clock().toISOString() });
    statements.push(...activityWrite(ctx, { action: 'client.reviewed', entity: { type: 'client', id, label: row.name }, changes: { fields: ['email'] } }, { when: guard }).statements);
    const [ok] = await ctx.deps.db.batch<{ ok: number }>(statements);
    if (!ok.results?.[0]?.ok) throw stale();
  }
  return { client: toApiClient(row), confirmed };
}

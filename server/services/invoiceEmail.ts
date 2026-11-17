/**
 * Sending an invoice by email (REST `POST /invoices/:id/send`, MCP
 * `send_invoice_email`) and its history (`GET /invoices/:id/emails`).
 *
 * Rules (AGENT_API.md "Sending invoices by email"):
 * - From is always the operator-configured address; the invoice's fromName is
 *   the display name ("<fromName> via <service>") and its fromEmail the Reply-To.
 * - Recipient defaults to the invoice's toEmail. The workspace token may
 *   override `to` and add up to 3 cc. Agents may only send to the invoice's
 *   toEmail, only when the user entered that address themselves (a saved
 *   client or an invoice last written by the user), and may only cc the
 *   workspace's own fromEmail (settings, which agents cannot change).
 * - Subject/message are plain text (subject: one line), length-capped; the
 *   HTML part escapes them (shared/email-template.ts).
 * - Limits: per-invoice cooldown, per-workspace and per-agent hourly/daily
 *   windows and a site-wide daily cap (D1 counters, settings-driven).
 * - Idempotency-Key: a retry with the same key never sends twice (the key is
 *   also forwarded to the provider, derived from the message id).
 * - Void invoices cannot be sent. A draft becomes `sent` (existing status
 *   transition, sentAt = today UTC); sent/paid invoices are resent unchanged.
 */
import { z } from 'zod';
import type { ApiInvoice, InvoiceEmail, ListInvoiceEmailsResponse, SendInvoiceEmailResponse } from '../../shared/api';
import { statusOf } from '../../shared/invoice-status';
import {
  EMAIL_LIMITS,
  composeInvoiceEmail,
  formatMailbox,
  hasBodyUnsafeChars,
  hasHeaderUnsafeChars,
  isDeliverableEmail,
  maskEmail,
  normalizeEmail,
  senderDisplayName,
} from '../../shared/email-template';
import type { Actor } from '../../shared/types/invoice';
import { INVOICE_THEMES } from '@/components/invoice/invoiceTheme';
import { actorOf, requireScope, type Principal } from '../auth';
import { sha256Hex } from '../crypto';
import { createEmailRepository, type CounterReservation, type EmailMessageRow } from '../db/emailRepository';
import { emailPublicConfig, loadEmailConfig, type EmailLimits } from '../email/config';
import { EmailProviderError } from '../email/sender';
import { ApiError, errors } from '../errors';
import { pdfFilename, renderInvoicePdf } from '../pdf/render';
import { zodDetails } from '../schemas';
import { recordActivity, type ActivityInput } from './activity';
import { changeInvoiceStatus } from './invoiceStatus';
import { parseInvoiceId, today, toApiInvoice, type ServiceContext } from './invoices';

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
/** A queued attempt older than this is considered abandoned (Worker died mid-send) and may be retried with its key. */
const STALE_QUEUED_MS = 2 * 60_000;
const HISTORY_LIMIT = 50;

export const sendEmailRequestSchema = z
  .object({
    to: z.string().trim().max(EMAIL_LIMITS.address).optional(),
    cc: z.array(z.string().trim().max(EMAIL_LIMITS.address)).max(EMAIL_LIMITS.cc).optional(),
    ccMe: z.boolean().optional(),
    subject: z
      .string()
      .max(EMAIL_LIMITS.subject, `Must be at most ${EMAIL_LIMITS.subject} characters`)
      .refine((v) => !hasHeaderUnsafeChars(v), 'Must be a single line of text (no line breaks or control characters)')
      .optional(),
    message: z
      .string()
      .max(EMAIL_LIMITS.message, `Must be at most ${EMAIL_LIMITS.message} characters`)
      .refine((v) => !hasBodyUnsafeChars(v), 'Must be plain text (no control characters)')
      .optional(),
    theme: z.enum(INVOICE_THEMES).optional(),
  })
  .strict();

export type SendEmailRequest = z.infer<typeof sendEmailRequestSchema>;

export const IDEMPOTENCY_KEY_RE = /^[\x21-\x7e]{1,255}$/;

export function toApiEmail(row: EmailMessageRow): InvoiceEmail {
  return {
    id: row.id,
    invoiceId: row.invoice_id,
    to: row.to_address,
    cc: JSON.parse(row.cc) as string[],
    subject: row.subject,
    status: row.status,
    error: row.status === 'failed' && row.error_code ? { code: row.error_code, message: row.error_message ?? '' } : null,
    sentBy: JSON.parse(row.actor) as Actor,
    statusChanged: row.status_changed === 1,
    createdAt: row.created_at,
    sentAt: row.sent_at,
  };
}

const recipientNotAllowed = (message: string, details: Record<string, unknown>) => new ApiError(403, 'recipient_not_allowed', message, details);

/**
 * An agent's refused send is worth the user's attention: one
 * `invoice.email_blocked` entry per agent, invoice and reason per hour.
 */
function noteBlocked(ctx: ServiceContext, invoice: ApiInvoice, to: string, code: string): void {
  if (ctx.principal.type !== 'agent') return;
  const hour = Math.floor(ctx.deps.clock().getTime() / 3_600_000);
  void recordActivity(ctx, {
    action: 'invoice.email_blocked',
    entity: { type: 'invoice', id: invoice.id, label: invoice.invoiceNumber },
    changes: { email: { to: maskEmail(to), code } },
    dedupe: { key: `email-blocked:${ctx.principal.agentId}:${invoice.id}:${code}:${hour}`, mode: 'ignore' },
  });
}

/** Sender fields an agent could change to redirect a payment or replies; checked by `requireSenderReview`. */
const SENDER_FIELDS = ['fromName', 'fromEmail', 'paymentDetails'] as const;

/**
 * Fraud guard for agents: an invoice whose sender details (name, email,
 * payment details) an agent wrote, and that the user has not saved since, is
 * only sent if those details equal the workspace defaults (settings, which
 * agents cannot change) — or, for payment details, those of the template the
 * invoice was created from when the user saved that template last (an
 * agent-edited template does not count). Otherwise the user must review it in
 * the app first.
 */
async function requireSenderReview(
  ctx: ServiceContext,
  invoice: ApiInvoice,
  settings: { fromName: string; fromEmail: string; paymentDetails: string } | null,
  emails: ReturnType<typeof createEmailRepository>,
): Promise<void> {
  if (ctx.principal.type !== 'agent') return;
  const flag = await emails.senderReviewFlag(ctx.principal.workspaceId, invoice.id);
  if (!flag) return;
  // Payment details may also come from a template the user saved last (instantiated by the agent).
  const templatePd = invoice.templateId ? await emails.userTemplatePaymentDetails(ctx.principal.workspaceId, invoice.templateId) : null;
  const differing = SENDER_FIELDS.filter((f) => {
    const value = (invoice[f] ?? '').trim();
    if (value === (settings?.[f] ?? '').trim()) return false;
    return !(f === 'paymentDetails' && templatePd !== null && templatePd.trim() !== '' && value === templatePd.trim());
  });
  if (differing.length === 0) return;
  noteBlocked(ctx, invoice, invoice.toEmail, 'invoice_needs_review');
  throw new ApiError(
    403,
    'invoice_needs_review',
    `An agent${flag.agent_name ? ` (${flag.agent_name})` : ''} set this invoice’s sender details (${differing.join(', ')}) and the user has not reviewed them. Ask the user to open the invoice in the app and save it, or to send it themselves.`,
    { fields: differing },
  );
}
const invalidAddress = (path: string, value: string) =>
  errors.validation([{ path, message: `"${value.slice(0, 80)}" is not a deliverable email address` }], 'Invalid recipient');

function limitedFor(retryAfterSeconds: number, message: string, details: Record<string, unknown>) {
  const seconds = Math.max(1, Math.ceil(retryAfterSeconds));
  return new ApiError(429, 'rate_limited', message, { ...details, retryAfterSeconds: seconds }, { 'retry-after': String(seconds) });
}

const windowStart = (now: number, size: number) => new Date(Math.floor(now / size) * size).toISOString();

function reservationsFor(principal: Principal, limits: EmailLimits, now: number) {
  const hour = windowStart(now, HOUR_MS);
  const day = windowStart(now, DAY_MS);
  const list: (CounterReservation & { label: string; size: number })[] = [
    { scope: 'global:d', windowStart: day, limit: limits.globalDaily, label: 'site_daily_cap', size: DAY_MS },
    { scope: `ws:${principal.workspaceId}:h`, windowStart: hour, limit: limits.workspaceHourly, label: 'workspace_hourly_limit', size: HOUR_MS },
    { scope: `ws:${principal.workspaceId}:d`, windowStart: day, limit: limits.workspaceDaily, label: 'workspace_daily_cap', size: DAY_MS },
  ];
  if (principal.type === 'agent') {
    list.push(
      { scope: `agent:${principal.agentId}:h`, windowStart: hour, limit: limits.agentHourly, label: 'agent_hourly_limit', size: HOUR_MS },
      { scope: `agent:${principal.agentId}:d`, windowStart: day, limit: limits.agentDaily, label: 'agent_daily_cap', size: DAY_MS },
    );
  }
  return list;
}

const LIMIT_MESSAGES: Record<string, string> = {
  site_daily_cap: 'This server has reached its daily email limit. Try again tomorrow (UTC).',
  workspace_hourly_limit: 'Too many emails sent from this workspace in the last hour.',
  workspace_daily_cap: 'This workspace has reached its daily email limit. Try again tomorrow (UTC).',
  agent_hourly_limit: 'This agent has sent too many emails in the last hour.',
  agent_daily_cap: 'This agent has reached its daily email limit. Try again tomorrow (UTC).',
};

interface Recipients {
  to: string;
  cc: string[];
}

async function resolveRecipients(
  ctx: ServiceContext,
  invoice: ApiInvoice,
  req: SendEmailRequest,
  workspaceFromEmail: string,
  emails: ReturnType<typeof createEmailRepository>,
): Promise<Recipients> {
  const { principal } = ctx;
  const invoiceTo = invoice.toEmail.trim();
  const to = (req.to?.trim() || invoiceTo).trim();
  if (!to) {
    throw errors.validation([{ path: 'to', message: 'The invoice has no client email (toEmail). Add one to the invoice first.' }], 'No recipient');
  }
  if (!isDeliverableEmail(to)) throw invalidAddress(req.to ? 'to' : 'toEmail', to);

  const ownEmail = workspaceFromEmail.trim() || (principal.type === 'user' ? invoice.fromEmail.trim() : '');
  let cc = [...(req.cc ?? [])];
  if (req.ccMe) {
    if (!ownEmail) throw errors.validation([{ path: 'ccMe', message: 'Set your email in the default settings to receive a copy.' }], 'No address to copy');
    cc.push(ownEmail);
  }
  cc.forEach((address, i) => {
    if (!isDeliverableEmail(address)) throw invalidAddress(`cc.${i}`, address);
  });
  const seen = new Set([normalizeEmail(to)]);
  cc = cc.filter((address) => {
    const key = normalizeEmail(address);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (cc.length > EMAIL_LIMITS.cc) throw errors.validation([{ path: 'cc', message: `At most ${EMAIL_LIMITS.cc} cc recipients` }]);

  if (principal.type === 'agent') {
    if (normalizeEmail(to) !== normalizeEmail(invoiceTo)) {
      noteBlocked(ctx, invoice, to, 'agent_recipient_override');
      throw recipientNotAllowed('Agents can only email an invoice to the client email on the invoice (toEmail).', { reason: 'agent_recipient_override' });
    }
    const own = normalizeEmail(workspaceFromEmail);
    if (cc.some((address) => normalizeEmail(address) !== own)) {
      noteBlocked(ctx, invoice, cc.find((address) => normalizeEmail(address) !== own) ?? to, 'agent_cc_not_allowed');
      throw recipientNotAllowed('Agents can only copy (cc) the workspace’s own email from the default settings.', { reason: 'agent_cc_not_allowed' });
    }
    if (!(await emails.isUserEnteredAddress(principal.workspaceId, normalizeEmail(to)))) {
      noteBlocked(ctx, invoice, to, 'address_not_confirmed_by_user');
      throw recipientNotAllowed(
        'This client email was not entered by the user. Ask the user to confirm it in the app (save the client or edit the invoice), or to send this invoice themselves.',
        { reason: 'address_not_confirmed_by_user' },
      );
    }
  }
  return { to, cc };
}

async function loadSendableInvoice(ctx: ServiceContext, id: string): Promise<ApiInvoice> {
  const row = await ctx.repo.getInvoice(ctx.principal.workspaceId, id);
  if (!row) throw errors.notFound('Invoice not found. If it was just created in the app, wait until it has synced.');
  if (row.deleted_at) throw errors.gone('Invoice was deleted', { id, deletedAt: row.deleted_at });
  return toApiInvoice(row, today(ctx.deps));
}

/** Marks a draft as sent through the shared transition rules (invoices:send implies this one transition). */
async function markDraftSent(ctx: ServiceContext, invoice: ApiInvoice, activity: ActivityInput): Promise<{ invoice: ApiInvoice; changed: boolean }> {
  if (statusOf(invoice) !== 'draft') return { invoice, changed: false };
  const elevated: ServiceContext = { ...ctx, principal: { ...ctx.principal, scopes: [...ctx.principal.scopes, 'invoices:write'] } };
  try {
    // One activity entry for the send and the status change (recorded atomically with the status write).
    return await changeInvoiceStatus(elevated, invoice.id, { action: 'mark_sent' }, {
      activity: { ...activity, changes: { ...activity.changes, status: { from: 'draft', to: 'sent' } } },
    });
  } catch (error) {
    // The email went out; a concurrent status change must not turn that into an error.
    ctx.deps.logError?.('Could not mark the emailed invoice as sent', error);
    return { invoice: await loadSendableInvoice(ctx, invoice.id), changed: false };
  }
}

/** Error codes reported to telemetry as-is; anything else is `client_error` (fixed labels only). */
const TELEMETRY_CODES = new Set(['email_send_failed', 'email_not_configured', 'rate_limited', 'recipient_not_allowed', 'invoice_needs_review']);

export async function sendInvoiceEmail(
  ctx: ServiceContext,
  rawId: string,
  body: unknown,
  opts: { idempotencyKey?: string | null } = {},
): Promise<SendInvoiceEmailResponse> {
  try {
    return await send(ctx, rawId, body, opts);
  } catch (error) {
    // Over MCP a failure is a tool result with HTTP 200: report it so operator telemetry counts it like REST does.
    if (error instanceof ApiError && ctx.activity?.source === 'mcp') {
      ctx.activity.telemetry?.({ status: error.status, errorCode: TELEMETRY_CODES.has(error.code) ? error.code : 'client_error' });
    }
    throw error;
  }
}

async function send(
  ctx: ServiceContext,
  rawId: string,
  body: unknown,
  opts: { idempotencyKey?: string | null },
): Promise<SendInvoiceEmailResponse> {
  const { principal, deps } = ctx;
  requireScope(principal, 'invoices:send');
  const id = parseInvoiceId(rawId);
  const parsed = sendEmailRequestSchema.safeParse(body ?? {});
  if (!parsed.success) throw errors.validation(zodDetails(parsed.error));
  const req = parsed.data;
  const key = opts.idempotencyKey?.trim() || null;
  if (key !== null && !IDEMPOTENCY_KEY_RE.test(key)) {
    throw errors.badRequest('Idempotency-Key must be 1-255 printable ASCII characters');
  }

  const config = await loadEmailConfig(deps);
  if (!config.configured) {
    throw new ApiError(503, 'email_not_configured', `Email is not available: ${config.reason}`, { reason: config.reason });
  }

  const emails = createEmailRepository(deps.db);
  const invoice = await loadSendableInvoice(ctx, id);
  if (statusOf(invoice) === 'void') {
    throw new ApiError(409, 'invalid_status_transition', 'Void invoices cannot be sent', { from: 'void', action: 'send' });
  }
  if (hasHeaderUnsafeChars(invoice.fromName)) {
    throw errors.validation([{ path: 'fromName', message: 'The invoice’s sender name contains line breaks or control characters; edit the invoice first.' }]);
  }
  const workspaceSettings = (await ctx.repo.getSettings(principal.workspaceId))?.settings ?? null;
  const workspaceFromEmail = workspaceSettings?.fromEmail ?? '';
  const { to, cc } = await resolveRecipients(ctx, invoice, req, workspaceFromEmail, emails);
  await requireSenderReview(ctx, invoice, workspaceSettings, emails);
  const theme = req.theme ?? config.pdfTheme;
  const filename = pdfFilename(invoice.invoiceNumber);
  const composed = composeInvoiceEmail(invoice, { subject: req.subject, message: req.message, attachmentName: filename });
  if (hasHeaderUnsafeChars(composed.subject)) throw errors.validation([{ path: 'subject', message: 'Must be a single line of text' }]);

  const requestHash = key
    ? await sha256Hex(JSON.stringify({ id, to: normalizeEmail(to), cc: cc.map(normalizeEmail), subject: req.subject ?? null, message: req.message ?? null, theme }))
    : null;
  const nowMs = deps.clock().getTime();
  const now = new Date(nowMs).toISOString();

  // --- Idempotent replay / retry --------------------------------------------
  let retryOf: EmailMessageRow | null = null;
  if (key) {
    const existing = await emails.findByIdempotencyKey(principal.workspaceId, key);
    if (existing) {
      if (existing.request_hash !== requestHash || existing.invoice_id !== id) {
        throw new ApiError(409, 'idempotency_conflict', 'This Idempotency-Key was already used for a different request', { emailId: existing.id });
      }
      if (existing.status === 'sent') {
        const current = await loadSendableInvoice(ctx, id);
        return { email: toApiEmail(existing), invoice: current, statusChanged: existing.status_changed === 1, replayed: true };
      }
      if (existing.status === 'queued' && nowMs - Date.parse(existing.updated_at) < STALE_QUEUED_MS) {
        throw new ApiError(409, 'idempotency_conflict', 'This email is still being sent; retry in a moment', { emailId: existing.id }, { 'retry-after': '5' });
      }
      retryOf = existing; // failed (nothing was delivered) or abandoned: try again under the same provider key
    }
  }

  // --- Cooldown and limits ----------------------------------------------------
  const cooldownMs = config.limits.cooldownMinutes * 60_000;
  if (cooldownMs > 0) {
    const last = await emails.lastDeliveredAt(principal.workspaceId, id, retryOf?.id ?? null);
    if (last && nowMs - Date.parse(last) < cooldownMs) {
      throw limitedFor((Date.parse(last) + cooldownMs - nowMs) / 1000, `This invoice was emailed less than ${config.limits.cooldownMinutes} minutes ago.`, {
        reason: 'invoice_cooldown',
        lastSentAt: last,
      });
    }
  }
  const reservations = reservationsFor(principal, config.limits, nowMs);
  const reserved = await emails.reserve(reservations, windowStart(nowMs - 2 * DAY_MS, DAY_MS));
  if (!reserved.ok) {
    const hit = reservations.find((r) => r.scope === reserved.exceeded.scope)!;
    const resetsAt = Date.parse(hit.windowStart) + hit.size;
    throw limitedFor((resetsAt - nowMs) / 1000, LIMIT_MESSAGES[hit.label], { reason: hit.label, limit: hit.limit });
  }

  // --- Record the attempt -------------------------------------------------------
  const actor = actorOf(principal);
  let messageId: string;
  if (retryOf) {
    if (!(await emails.requeue(principal.workspaceId, retryOf.id, retryOf.updated_at, now))) {
      await emails.release(reservations);
      throw new ApiError(409, 'idempotency_conflict', 'This email is still being sent; retry in a moment', { emailId: retryOf.id }, { 'retry-after': '5' });
    }
    messageId = retryOf.id;
  } else {
    messageId = deps.ids.uuid();
    const inserted = await emails.insertQueued({
      workspaceId: principal.workspaceId,
      id: messageId,
      invoiceId: id,
      to,
      cc,
      subject: composed.subject,
      provider: config.sender.provider,
      actor,
      idempotencyKey: key,
      requestHash,
      now,
    });
    if (!inserted) {
      await emails.release(reservations);
      throw new ApiError(409, 'idempotency_conflict', 'A request with this Idempotency-Key is already in progress', undefined, { 'retry-after': '5' });
    }
  }

  const resend = statusOf(invoice) !== 'draft' || (await emails.lastDeliveredAt(principal.workspaceId, id, messageId)) !== null;
  const entity = { type: 'invoice', id, label: invoice.invoiceNumber };
  const fail = async (code: string, message: string, status: number, retryable: boolean): Promise<never> => {
    const at = deps.clock().toISOString();
    await emails.markFailed(principal.workspaceId, messageId, code, message, at);
    void recordActivity(ctx, { action: 'invoice.email_failed', entity, changes: { email: { to: maskEmail(to), cc: cc.length, resend, code } } });
    const row = await emails.get(principal.workspaceId, messageId);
    throw new ApiError(status, 'email_send_failed', message, { reason: code, retryable, email: row ? toApiEmail(row) : null });
  };

  // --- Render and send ------------------------------------------------------------
  let pdf: Uint8Array;
  try {
    pdf = await renderInvoicePdf(invoice, deps.readAsset, theme);
  } catch (error) {
    deps.logError?.('Invoice PDF for email failed to render', error);
    await emails.release(reservations);
    return fail('pdf_render_failed', 'The invoice PDF could not be generated, so nothing was sent.', 500, true);
  }

  const displayName = senderDisplayName(invoice.fromName, config.fromName);
  const replyTo = config.replyTo === 'sender' && isDeliverableEmail(invoice.fromEmail.trim()) ? invoice.fromEmail.trim() : undefined;
  try {
    const { providerMessageId } = await config.sender.send({
      from: formatMailbox(displayName, config.fromAddress),
      replyTo,
      to,
      cc,
      subject: composed.subject,
      text: composed.text,
      html: composed.html,
      attachments: [{ filename, contentType: 'application/pdf', content: pdf }],
      // Stable across retries of this attempt, so the provider never delivers it twice.
      idempotencyKey: `invoice-email/${messageId}`,
    });
    await emails.markSent(principal.workspaceId, messageId, providerMessageId, deps.clock().toISOString());
  } catch (error) {
    if (error instanceof EmailProviderError) {
      deps.logError?.(`Email provider error (${error.code}, HTTP ${error.providerStatus ?? '-'})`, error.message);
      return fail(error.code, error.message, 502, error.retryable);
    }
    deps.logError?.('Email send failed', error);
    return fail('provider_unavailable', 'Sending failed unexpectedly. Nothing is known to have been delivered.', 502, true);
  }

  const emailed: ActivityInput = { action: 'invoice.emailed', entity, changes: { email: { to: maskEmail(to), cc: cc.length, resend } } };
  const { invoice: finalInvoice, changed } = await markDraftSent(ctx, invoice, emailed);
  if (!changed) void recordActivity(ctx, emailed);
  if (changed) await emails.markStatusChanged(principal.workspaceId, messageId);
  const row = (await emails.get(principal.workspaceId, messageId))!;
  return { email: toApiEmail(row), invoice: finalInvoice, statusChanged: changed, replayed: false };
}

export async function listInvoiceEmails(ctx: ServiceContext, rawId: string): Promise<ListInvoiceEmailsResponse> {
  requireScope(ctx.principal, 'invoices:read');
  const id = parseInvoiceId(rawId);
  const row = await ctx.repo.getInvoice(ctx.principal.workspaceId, id);
  if (!row) throw errors.notFound('Invoice not found');
  if (row.deleted_at) throw errors.gone('Invoice was deleted', { id, deletedAt: row.deleted_at });
  const emails = createEmailRepository(ctx.deps.db);
  const rows = await emails.listForInvoice(ctx.principal.workspaceId, id, HISTORY_LIMIT);
  const config = await loadEmailConfig(ctx.deps);
  const pub = emailPublicConfig(ctx.deps);
  return {
    emails: rows.map(toApiEmail),
    delivery: {
      configured: config.configured,
      fromAddress: pub.fromAddress || null,
      fromName: pub.fromName,
      pdfTheme: pub.pdfTheme,
      cooldownMinutes: pub.limits.cooldownMinutes,
    },
  };
}

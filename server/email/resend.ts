/**
 * Resend adapter (REST, plain fetch — the `resend` SDK adds nothing a Worker
 * needs for one endpoint). Checked against resend@6.38.1 (Nov 2026):
 * - POST {base}/emails, `Authorization: Bearer <key>`, JSON body with
 *   `from`, `to` (string[]), `cc`, `reply_to`, `subject`, `text`, `html`,
 *   `attachments: [{ filename, content (base64), content_type }]`;
 *   max 40 MB per email including attachments.
 * - `Idempotency-Key` header: same key within 24 h = same email, never sent twice.
 * - 200 → `{ id }`; errors → `{ statusCode, name, message }` with names such as
 *   validation_error, missing_api_key, invalid_api_key, restricted_api_key,
 *   invalid_from_address, invalid_attachment, invalid_idempotency_key,
 *   invalid_idempotent_request, concurrent_idempotent_requests,
 *   rate_limit_exceeded, daily_quota_exceeded, monthly_quota_exceeded,
 *   application_error, internal_server_error.
 */
import { EmailProviderError, MAX_ATTACHMENT_BYTES, toBase64, type EmailSender, type OutgoingEmail } from './sender';

export const RESEND_API_BASE_URL = 'https://api.resend.com';
const TIMEOUT_MS = 20_000;

interface ResendOptions {
  apiKey: string;
  /** Dev/test only (fake Resend server); production always uses RESEND_API_BASE_URL. */
  baseUrl?: string;
  fetch?: typeof fetch;
}

const AUTH_ERRORS = new Set(['missing_api_key', 'invalid_api_key', 'restricted_api_key']);
const RATE_ERRORS = new Set(['rate_limit_exceeded', 'daily_quota_exceeded', 'monthly_quota_exceeded']);

/** Maps a Resend error response to our stable codes. Provider text is kept short and never echoes credentials. */
export function resendError(status: number, body: { name?: unknown; message?: unknown } | null): EmailProviderError {
  const name = typeof body?.name === 'string' ? body.name : '';
  const detail = typeof body?.message === 'string' ? body.message.replace(/re_[A-Za-z0-9_]+/g, 're_…').slice(0, 300) : '';
  const suffix = detail ? `: ${detail}` : '';
  if (status === 401 || AUTH_ERRORS.has(name)) {
    return new EmailProviderError('provider_auth_failed', `The email provider rejected the server's API key${suffix}`, status);
  }
  if (status === 429 || RATE_ERRORS.has(name)) {
    return new EmailProviderError('provider_rate_limited', `The email provider is rate limiting this server${suffix}`, status, name !== 'monthly_quota_exceeded');
  }
  if (status === 409 && name === 'concurrent_idempotent_requests') {
    return new EmailProviderError('provider_unavailable', 'The same email is already being sent; try again in a moment', status, true);
  }
  if (status >= 500) return new EmailProviderError('provider_unavailable', `The email provider had a problem${suffix}`, status, true);
  return new EmailProviderError('provider_rejected', `The email provider refused the message${suffix}`, status);
}

export function createResendSender(opts: ResendOptions): EmailSender {
  const base = (opts.baseUrl ?? RESEND_API_BASE_URL).replace(/\/+$/, '');
  return {
    provider: 'resend',
    async send(email: OutgoingEmail) {
      const size = email.attachments.reduce((n, a) => n + a.content.byteLength, 0);
      if (size > MAX_ATTACHMENT_BYTES) {
        throw new EmailProviderError('attachment_too_large', `The PDF is too large to email (${Math.ceil(size / 1024)} KB)`);
      }
      const headers: Record<string, string> = {
        authorization: `Bearer ${opts.apiKey}`,
        'content-type': 'application/json',
        'user-agent': 'midnight-invoice',
      };
      if (email.idempotencyKey) headers['idempotency-key'] = email.idempotencyKey;
      const body = {
        from: email.from,
        to: [email.to],
        ...(email.cc && email.cc.length > 0 ? { cc: email.cc } : {}),
        ...(email.replyTo ? { reply_to: email.replyTo } : {}),
        subject: email.subject,
        text: email.text,
        html: email.html,
        attachments: email.attachments.map((a) => ({ filename: a.filename, content: toBase64(a.content), content_type: a.contentType })),
      };
      let response: Response;
      try {
        response = await (opts.fetch ?? fetch)(`${base}/emails`, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch {
        // Unknown outcome: the idempotency key makes a retry safe.
        throw new EmailProviderError('provider_unreachable', 'Could not reach the email provider', null, true);
      }
      const text = await response.text().catch(() => '');
      type Body = { id?: unknown; name?: unknown; message?: unknown };
      let json: Body | null;
      try {
        json = text ? (JSON.parse(text) as Body) : null;
      } catch {
        json = null;
      }
      if (!response.ok) throw resendError(response.status, json);
      if (typeof json?.id !== 'string' || json.id === '') {
        throw new EmailProviderError('provider_unavailable', 'The email provider sent an unexpected response', response.status, true);
      }
      return { providerMessageId: json.id.slice(0, 200) };
    },
  };
}

/**
 * Email provider abstraction. The send service (server/services/invoiceEmail.ts)
 * only talks to `EmailSender`; adapters live next to this file (resend.ts).
 *
 * Adding a provider: implement `EmailSender`, add its name to EMAIL_PROVIDERS
 * (also the `email.provider` setting's options) and a case in `createEmailSender`
 * (server/email/config.ts). Adapters must:
 * - send exactly the given headers/addresses (no provider defaults that change From/Reply-To);
 * - forward `idempotencyKey` when the provider supports it, so retries cannot double-send;
 * - throw `EmailProviderError` with a stable `code` and a message that never
 *   contains credentials.
 */

export const EMAIL_PROVIDERS = ['resend'] as const;
export type EmailProvider = (typeof EMAIL_PROVIDERS)[number];

export interface EmailAttachment {
  filename: string;
  contentType: string;
  content: Uint8Array;
}

export interface OutgoingEmail {
  /** Full From mailbox, e.g. `"Acme via Midnight Invoice" <invoices@example.org>`. */
  from: string;
  replyTo?: string;
  to: string;
  cc?: string[];
  subject: string;
  text: string;
  html: string;
  attachments: EmailAttachment[];
  /** Provider-side de-duplication key (same key = same email, never sent twice). */
  idempotencyKey?: string;
}

export interface EmailSender {
  readonly provider: EmailProvider;
  send(email: OutgoingEmail): Promise<{ providerMessageId: string }>;
}

/** Stable error codes recorded in email_messages.error_code and shown to users. */
export type EmailErrorCode =
  | 'provider_auth_failed'
  | 'provider_rejected'
  | 'provider_rate_limited'
  | 'provider_unavailable'
  | 'provider_unreachable'
  | 'attachment_too_large'
  | 'pdf_render_failed';

export class EmailProviderError extends Error {
  constructor(
    readonly code: EmailErrorCode,
    message: string,
    /** HTTP status from the provider, if any. */
    readonly providerStatus: number | null = null,
    /** Worth retrying later with the same idempotency key. */
    readonly retryable = false,
  ) {
    super(message);
    this.name = 'EmailProviderError';
  }
}

/** Max total attachment size we hand to any provider (Resend allows 40 MB per email after base64). */
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

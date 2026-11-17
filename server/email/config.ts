/**
 * Email configuration, read at request time from the runtime settings
 * registry (`deps.settings`), so the operator can configure or turn off email
 * in /operator → Settings without a redeploy. The provider API key is a
 * secret setting (encrypted in D1, or the RESEND_API_KEY Worker secret) and
 * never leaves this module except inside the adapter's Authorization header.
 */
import { EMAIL_BRAND } from '../../shared/email-template';
import type { AppDeps } from '../deps';
import { createResendSender } from './resend';
import type { EmailProvider, EmailSender } from './sender';

export interface EmailLimits {
  cooldownMinutes: number;
  workspaceHourly: number;
  workspaceDaily: number;
  agentHourly: number;
  agentDaily: number;
  globalDaily: number;
}

export interface EmailPublicConfig {
  enabled: boolean;
  provider: EmailProvider;
  fromAddress: string;
  fromName: string;
  replyTo: 'sender' | 'none';
  pdfTheme: 'light' | 'dark';
  limits: EmailLimits;
}

export type EmailConfig =
  | ({ configured: true; sender: EmailSender } & EmailPublicConfig)
  | ({ configured: false; reason: string } & EmailPublicConfig);

/** Non-secret part of the configuration (sync; no secret is decrypted). */
export function emailPublicConfig(deps: AppDeps): EmailPublicConfig {
  const s = deps.settings;
  return {
    enabled: s.get('email.enabled'),
    provider: s.get('email.provider'),
    fromAddress: s.get('email.fromAddress'),
    fromName: s.get('email.fromName') || EMAIL_BRAND,
    replyTo: s.get('email.replyTo'),
    pdfTheme: s.get('email.pdfTheme'),
    limits: {
      cooldownMinutes: s.get('email.cooldownMinutes'),
      workspaceHourly: s.get('email.workspaceHourlyLimit'),
      workspaceDaily: s.get('email.workspaceDailyCap'),
      agentHourly: s.get('email.agentHourlyLimit'),
      agentDaily: s.get('email.agentDailyCap'),
      globalDaily: s.get('email.globalDailyCap'),
    },
  };
}

async function providerKey(deps: AppDeps, provider: EmailProvider): Promise<string | null> {
  try {
    switch (provider) {
      case 'resend':
        return await deps.settings.getSecret('resend.apiKey');
    }
  } catch (error) {
    // Encrypted store locked (e.g. INITIAL_PASSWORD changed): treat as not configured.
    deps.logError?.('Email provider key unavailable', error);
    return null;
  }
}

export function createEmailSender(deps: AppDeps, provider: EmailProvider, apiKey: string): EmailSender {
  switch (provider) {
    case 'resend':
      return createResendSender({ apiKey, baseUrl: deps.email?.resendBaseUrl, fetch: deps.email?.fetch });
  }
}

/** Full configuration including a ready sender, or why email cannot be sent. */
export async function loadEmailConfig(deps: AppDeps): Promise<EmailConfig> {
  const pub = emailPublicConfig(deps);
  if (!pub.enabled) return { ...pub, configured: false, reason: 'Sending email is turned off on this server.' };
  if (!pub.fromAddress) return { ...pub, configured: false, reason: 'This server has no From address for email yet.' };
  if (deps.email?.sender) return { ...pub, configured: true, sender: deps.email.sender };
  const key = await providerKey(deps, pub.provider);
  if (!key) return { ...pub, configured: false, reason: 'This server has no email provider API key yet.' };
  return { ...pub, configured: true, sender: createEmailSender(deps, pub.provider, key) };
}

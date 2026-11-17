import { useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Cloud, Mail, Paperclip, Pencil, RefreshCw, Send } from 'lucide-react';
import { toast } from 'sonner';
import type { Invoice } from '@/types/invoice';
import type { SendInvoiceEmailRequest } from '../../../../shared/api';
import { statusOf } from '../../../../shared/invoice-status';
import {
  EMAIL_LIMITS,
  composeInvoiceEmail,
  defaultEmailMessage,
  defaultEmailSubject,
  formatEmailDate,
  formatMailbox,
  isDeliverableEmail,
  senderDisplayName,
} from '../../../../shared/email-template';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Spinner } from '@/components/ui/spinner';
import { api, isNetworkError } from '@/lib/api';
import { applyServerInvoices, syncNow } from '@/lib/sync/engine';
import { useSettingsStore } from '@/stores/useSettingsStore';
import { cn } from '@/lib/utils';
import { describeEmailError, invoiceEmailsKey, useEmailReadiness, type EmailReadiness } from './emailState';

interface Props {
  invoice: Invoice;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * "Send by email": recipient (prefilled, editable), cc-me, subject and message
 * with the same defaults the server uses, and a preview of what the client
 * receives. Explains instead of failing when cloud sync is off or the invoice
 * is not on the server yet.
 */
export function SendInvoiceEmailDialog({ invoice, open, onOpenChange }: Props) {
  const readiness = useEmailReadiness(invoice);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] overflow-y-auto rounded-lg sm:w-full sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="h-4 w-4 text-primary" aria-hidden="true" />
            Send invoice by email
          </DialogTitle>
          <DialogDescription>
            Emails <span className="font-mono">{invoice.invoiceNumber}</span> to your client with the PDF attached.
          </DialogDescription>
        </DialogHeader>
        {readiness === 'ready' ? (
          <SendForm invoice={invoice} onDone={() => onOpenChange(false)} />
        ) : (
          <NotReady readiness={readiness} invoice={invoice} onClose={() => onOpenChange(false)} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function Notice({ children, tone = 'info' }: { children: React.ReactNode; tone?: 'info' | 'warn' }) {
  return (
    <div
      role="status"
      className={cn(
        'flex gap-3 border p-3 text-sm',
        tone === 'warn' ? 'border-amber-500/30 bg-amber-500/10' : 'border-border bg-secondary/50',
      )}
    >
      {tone === 'warn' ? (
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
      ) : (
        <Cloud className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
      )}
      <div className="min-w-0 space-y-1 text-muted-foreground">{children}</div>
    </div>
  );
}

function NotReady({ readiness, invoice, onClose }: { readiness: Exclude<EmailReadiness, 'ready'>; invoice: Invoice; onClose: () => void }) {
  const [syncing, setSyncing] = useState(false);
  const navigate = useNavigate();
  const go = (to: string) => {
    onClose();
    navigate(to, { viewTransition: true });
  };
  if (readiness === 'sync_off') {
    return (
      <>
        <Notice>
          <p className="font-medium text-foreground">Email sending needs cloud sync</p>
          <p>
            Emails are sent by the server, so the invoice has to be in your cloud workspace. Turn on cloud sync in Settings; your invoices stay in this
            browser too.
          </p>
        </Notice>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          <Button onClick={() => go('/?tab=settings')}>
            <Cloud className="mr-2 h-4 w-4" aria-hidden="true" />
            Turn on cloud sync
          </Button>
        </DialogFooter>
      </>
    );
  }
  if (readiness === 'void') {
    return (
      <>
        <Notice tone="warn">
          <p className="font-medium text-foreground">Void invoices can’t be sent</p>
          <p>Reopen the invoice first if you want to send it again.</p>
        </Notice>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </>
    );
  }
  if (readiness === 'not_synced') {
    return (
      <>
        <Notice tone="warn">
          <p className="font-medium text-foreground">This invoice isn’t synced</p>
          <p>Your workspace refused it, so the server can’t email it. Fix the invoice and save it again; it then syncs automatically.</p>
        </Notice>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          <Button onClick={() => go(`/create/${invoice.id}`)}>
            <Pencil className="mr-2 h-4 w-4" aria-hidden="true" />
            Edit to fix
          </Button>
        </DialogFooter>
      </>
    );
  }
  return (
    <>
      <Notice>
        <p className="font-medium text-foreground">Waiting for sync</p>
        <p>Your latest changes to this invoice haven’t reached the server yet. Sync now, then send — so your client gets the current version.</p>
      </Notice>
      <DialogFooter className="gap-2">
        <Button variant="outline" onClick={onClose}>
          Close
        </Button>
        <Button
          disabled={syncing}
          onClick={async () => {
            setSyncing(true);
            try {
              await syncNow({ force: true });
            } finally {
              setSyncing(false);
            }
          }}
        >
          {syncing ? <Spinner className="mr-2 h-4 w-4" /> : <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />}
          Sync now
        </Button>
      </DialogFooter>
    </>
  );
}

function newKey() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
}

function SendForm({ invoice, onDone }: { invoice: Invoice; onDone: () => void }) {
  const id = useId();
  const queryClient = useQueryClient();
  const ownEmail = useSettingsStore((s) => s.settings.fromEmail).trim() || invoice.fromEmail.trim();
  const defaults = useMemo(() => ({ subject: defaultEmailSubject(invoice), message: defaultEmailMessage(invoice) }), [invoice]);
  const [to, setTo] = useState(invoice.toEmail);
  const [ccMe, setCcMe] = useState(false);
  const [subject, setSubject] = useState(defaults.subject);
  const [message, setMessage] = useState(defaults.message);
  const [touched, setTouched] = useState(false);
  const history = useQuery({ queryKey: invoiceEmailsKey(invoice.id), queryFn: () => api.listInvoiceEmails(invoice.id) });
  // One idempotency key per distinct request: a retry of the same request (e.g. after a network error) can never send twice.
  const keyRef = useRef<{ body: string; key: string } | null>(null);

  const status = statusOf(invoice);
  const lastSent = history.data?.emails.find((e) => e.status === 'sent');
  const delivery = history.data?.delivery;
  const toValid = isDeliverableEmail(to.trim());
  const subjectError = /[\r\n]/.test(subject) ? 'One line only' : subject.length > EMAIL_LIMITS.subject ? `At most ${EMAIL_LIMITS.subject} characters` : null;

  const body = (): SendInvoiceEmailRequest => ({
    ...(to.trim() !== invoice.toEmail.trim() ? { to: to.trim() } : {}),
    ...(ccMe ? { ccMe: true } : {}),
    ...(subject.trim() && subject.trim() !== defaults.subject ? { subject: subject.trim() } : {}),
    ...(message.trim() && message.trim() !== defaults.message.trim() ? { message } : {}),
  });

  const send = useMutation({
    mutationFn: () => {
      const payload = body();
      const json = JSON.stringify(payload);
      if (keyRef.current?.body !== json) keyRef.current = { body: json, key: newKey() };
      return api.sendInvoiceEmail(invoice.id, payload, keyRef.current.key);
    },
    onSuccess: (result) => {
      keyRef.current = null;
      applyServerInvoices([result.invoice]);
      void syncNow();
      void queryClient.invalidateQueries({ queryKey: invoiceEmailsKey(invoice.id) });
      void queryClient.invalidateQueries({ queryKey: ['activity'] });
      toast.success(`${invoice.invoiceNumber} sent to ${result.email.to}`, {
        description: result.statusChanged ? 'The invoice is now marked as sent.' : undefined,
      });
      onDone();
    },
    onError: (error) => {
      // A network error leaves the outcome unknown: keep the key so "Send" again is a safe retry.
      if (!isNetworkError(error)) keyRef.current = null;
      void queryClient.invalidateQueries({ queryKey: invoiceEmailsKey(invoice.id) });
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!toValid || subjectError || send.isPending) return;
    send.mutate();
  };

  const preview = composeInvoiceEmail(invoice, {
    subject: subject.trim() || undefined,
    message: message.trim() ? message : undefined,
    attachmentName: `${invoice.invoiceNumber || 'invoice'}.pdf`,
  });
  const displayName = senderDisplayName(invoice.fromName, delivery?.fromName);
  const fromLine = delivery?.fromAddress ? formatMailbox(displayName, delivery.fromAddress) : displayName;

  if (history.isPending) {
    return (
      <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground" role="status">
        <Spinner className="h-4 w-4" /> Checking email settings…
      </div>
    );
  }
  if (delivery && !delivery.configured) {
    return (
      <>
        <Notice tone="warn">
          <p className="font-medium text-foreground">Email isn’t set up on this server</p>
          <p>The site owner hasn’t connected an email provider yet. Download the PDF and attach it to an email yourself in the meantime.</p>
        </Notice>
        <DialogFooter>
          <Button variant="outline" onClick={onDone}>
            Close
          </Button>
        </DialogFooter>
      </>
    );
  }

  return (
    <form onSubmit={submit} noValidate className="min-w-0 space-y-4">
      {status === 'draft' ? (
        <Notice>
          <p>
            <span className="font-medium text-foreground">This invoice is a draft.</span> Sending it marks it as <strong className="text-foreground">sent</strong>{' '}
            (dated today).
          </p>
        </Notice>
      ) : (
        lastSent && (
          <Notice>
            <p>
              Already emailed to {lastSent.to} on {formatEmailDate(lastSent.createdAt.slice(0, 10))}. This sends it again; the status stays{' '}
              <strong className="text-foreground">{status}</strong>.
            </p>
          </Notice>
        )
      )}

      <div className="space-y-2">
        <Label htmlFor={`${id}-to`} className="text-xs text-muted-foreground">
          To
        </Label>
        <Input
          id={`${id}-to`}
          type="email"
          inputMode="email"
          autoComplete="off"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          maxLength={EMAIL_LIMITS.address}
          placeholder="client@company.com"
          aria-invalid={touched && !toValid}
          aria-describedby={`${id}-to-hint`}
          className="bg-secondary border-border font-code"
        />
        <p id={`${id}-to-hint`} className={cn('text-xs', touched && !toValid ? 'text-destructive' : 'text-muted-foreground')}>
          {touched && !toValid
            ? to.trim()
              ? 'Enter a deliverable email address.'
              : 'This invoice has no client email. Enter one.'
            : to.trim() !== invoice.toEmail.trim() && invoice.toEmail
              ? `Different from the invoice’s client email (${invoice.toEmail}).`
              : 'The client email on the invoice.'}
        </p>
      </div>

      <div className="flex items-start gap-3">
        <input
          id={`${id}-ccme`}
          type="checkbox"
          checked={ccMe}
          disabled={!ownEmail}
          onChange={(e) => setCcMe(e.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-primary disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        />
        <Label htmlFor={`${id}-ccme`} className="min-w-0 text-sm font-normal leading-snug text-foreground">
          Send me a copy
          <span className="block break-all font-code text-xs text-muted-foreground">{ownEmail || 'Add your email in Settings to get a copy'}</span>
        </Label>
      </div>

      <div className="space-y-2">
        <Label htmlFor={`${id}-subject`} className="text-xs text-muted-foreground">
          Subject
        </Label>
        <Input
          id={`${id}-subject`}
          value={subject}
          onChange={(e) => setSubject(e.target.value.replace(/[\r\n]+/g, ' '))}
          maxLength={EMAIL_LIMITS.subject}
          aria-invalid={!!subjectError}
          className="bg-secondary border-border"
        />
        {subjectError && <p className="text-xs text-destructive">{subjectError}</p>}
      </div>

      <div className="space-y-2">
        <div className="flex items-baseline justify-between gap-2">
          <Label htmlFor={`${id}-message`} className="text-xs text-muted-foreground">
            Message
          </Label>
          <span className="text-[11px] tabular-nums text-muted-foreground" aria-live="polite">
            {message.length}/{EMAIL_LIMITS.message}
          </span>
        </div>
        <Textarea
          id={`${id}-message`}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          maxLength={EMAIL_LIMITS.message}
          rows={5}
          aria-describedby={`${id}-message-hint`}
          className="bg-secondary border-border resize-y"
        />
        <p id={`${id}-message-hint`} className="text-xs text-muted-foreground">
          Plain text. The invoice number, amount due and due date are always included below your message.
        </p>
      </div>

      <details className="group border border-border bg-card">
        <summary className="cursor-pointer select-none px-3 py-2 text-sm font-medium text-foreground hover:bg-accent/50">Preview what your client receives</summary>
        <div className="space-y-3 border-t border-border p-3 text-xs">
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
            <dt className="text-muted-foreground">From</dt>
            <dd className="break-words text-foreground">{fromLine}</dd>
            {invoice.fromEmail && (
              <>
                <dt className="text-muted-foreground">Reply-To</dt>
                <dd className="break-all font-code text-foreground">{invoice.fromEmail}</dd>
              </>
            )}
            <dt className="text-muted-foreground">To</dt>
            <dd className="break-all font-code text-foreground">{to.trim() || '—'}</dd>
            {ccMe && ownEmail && (
              <>
                <dt className="text-muted-foreground">Cc</dt>
                <dd className="break-all font-code text-foreground">{ownEmail}</dd>
              </>
            )}
            <dt className="text-muted-foreground">Subject</dt>
            <dd className="break-words font-medium text-foreground">{preview.subject}</dd>
          </dl>
          <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-words border border-border bg-secondary/50 p-3 font-sans text-xs leading-relaxed text-foreground">
            {preview.text}
          </pre>
          <p className="flex items-center gap-1.5 text-muted-foreground">
            <Paperclip className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="font-code">{invoice.invoiceNumber}.pdf</span> ({delivery?.pdfTheme ?? 'light'} theme)
          </p>
        </div>
      </details>

      {send.isError && (
        <p role="alert" className="border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {describeEmailError(send.error)}
        </p>
      )}

      <DialogFooter className="gap-2">
        <Button type="button" variant="outline" onClick={onDone} disabled={send.isPending}>
          Cancel
        </Button>
        <Button type="submit" disabled={send.isPending}>
          {send.isPending ? <Spinner className="mr-2 h-4 w-4" /> : <Send className="mr-2 h-4 w-4" aria-hidden="true" />}
          {send.isPending ? 'Sending…' : status === 'draft' ? 'Send and mark sent' : lastSent ? 'Send again' : 'Send'}
        </Button>
      </DialogFooter>
    </form>
  );
}

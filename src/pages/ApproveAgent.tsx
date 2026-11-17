import { useEffect, useId, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format, parseISO } from 'date-fns';
import { AlertTriangle, Bot, CheckCircle2, Clock, Hash, ShieldAlert, ShieldX, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { PageHeader } from '@/components/PageHeader';
import { EnableCloudSyncCard } from '@/components/sync/CloudSyncSettings';
import { SCOPE_INFO } from '@/components/agents/scopes';
import { api } from '@/lib/api';
import { ApiError, describeError, formatWait } from '@/lib/api/errors';
import { useCloudEnabled } from '@/stores/useCloudStore';
import { cn } from '@/lib/utils';
import { formatUserCode, normalizeUserCode } from '../../shared/user-code';
import type { AgentRegistrationPreview, Scope } from '../../shared/api';

type Registration = AgentRegistrationPreview['registration'];

const card = 'rounded-lg border border-border bg-card p-4 sm:p-6';

function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function StateCard({ icon, tone = 'neutral', title, children, actions }: {
  icon: ReactNode;
  tone?: 'neutral' | 'success' | 'danger';
  title: string;
  children?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className={cn(card, 'space-y-4')} role={tone === 'danger' ? 'alert' : 'status'}>
      <div className="flex items-start gap-3">
        <div
          className={cn(
            'flex h-10 w-10 shrink-0 items-center justify-center rounded-md',
            tone === 'success' ? 'bg-primary/10 text-primary' : tone === 'danger' ? 'bg-destructive/10 text-destructive' : 'bg-secondary text-muted-foreground',
          )}
          aria-hidden="true"
        >
          {icon}
        </div>
        <div className="min-w-0 space-y-2">
          <h2 className="text-base font-semibold text-foreground">{title}</h2>
          <div className="space-y-2 text-sm text-muted-foreground">{children}</div>
        </div>
      </div>
      {actions && <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">{actions}</div>}
    </div>
  );
}

/** Manual code entry; forgiving about case, spaces and dashes. */
function CodeEntry({ initialError }: { initialError?: string }) {
  const id = useId();
  const [, setParams] = useSearchParams();
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(initialError ?? null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const normalized = normalizeUserCode(value);
    if (!normalized) {
      setError('Codes have 8 letters, like WDJB-MJHT. Check the code your agent showed you.');
      return;
    }
    setParams({ code: formatUserCode(normalized) });
  };

  return (
    <form onSubmit={submit} className={cn(card, 'space-y-4')} noValidate>
      <div className="space-y-1">
        <h2 className="text-base font-semibold text-foreground">Enter the code from your agent</h2>
        <p className="text-sm text-muted-foreground">
          When an AI agent asks to connect, it shows you a short code. Type it here to review what it is asking for.
        </p>
      </div>
      <div className="space-y-2">
        <Label htmlFor={`${id}-code`} className="text-xs text-muted-foreground">
          Code
        </Label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            id={`${id}-code`}
            value={value}
            onChange={(e) => {
              setValue(e.target.value.toUpperCase());
              setError(null);
            }}
            placeholder="XXXX-XXXX"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            maxLength={20}
            aria-invalid={!!error}
            aria-describedby={error ? `${id}-error` : undefined}
            className="bg-secondary border-border font-mono uppercase tracking-widest sm:max-w-56"
          />
          <Button type="submit" variant="outline">
            Continue
          </Button>
        </div>
        {error && (
          <p id={`${id}-error`} role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}
      </div>
    </form>
  );
}

function ErrorState({ error, onReset }: { error: unknown; onReset: () => void }) {
  const reset = (
    <Button variant="outline" onClick={onReset}>
      Enter a different code
    </Button>
  );
  if (error instanceof ApiError) {
    if (error.status === 404) {
      return (
        <StateCard icon={<XCircle className="h-5 w-5" />} tone="danger" title="No request with this code" actions={reset}>
          <p>Check that you typed the code exactly as your agent shows it. Codes are not case-sensitive and the dash is optional.</p>
        </StateCard>
      );
    }
    if (error.status === 409) {
      const status = (error.details as { status?: string } | undefined)?.status;
      return (
        <StateCard icon={<CheckCircle2 className="h-5 w-5" />} title={`This request was already ${status === 'denied' ? 'denied' : 'approved'}`} actions={
          <>
            <Button variant="outline" asChild className="font-mono"><Link to="/agents">Manage agents</Link></Button>
            {reset}
          </>
        }>
          <p>Each code can be used once. If this was not you, revoke the agent on the Agents page.</p>
        </StateCard>
      );
    }
    if (error.status === 410) {
      return (
        <StateCard icon={<Clock className="h-5 w-5" />} tone="danger" title="This request expired" actions={reset}>
          <p>Codes are valid for 10 minutes. Ask your agent to start connecting again; it will show you a new code.</p>
        </StateCard>
      );
    }
    if (error.status === 429) {
      return (
        <StateCard icon={<AlertTriangle className="h-5 w-5" />} tone="danger" title="Too many attempts" actions={reset}>
          <p>
            Too many codes were tried. For your security, wait{' '}
            {error.retryAfterMs !== null ? formatWait(error.retryAfterMs) : 'a few minutes'} before trying again.
          </p>
        </StateCard>
      );
    }
  }
  return (
    <StateCard icon={<AlertTriangle className="h-5 w-5" />} tone="danger" title="Could not load the request" actions={reset}>
      <p>{describeError(error)}</p>
    </StateCard>
  );
}

export function ScopeChoice({ scope, checked, onChange }: { scope: Scope; checked: boolean; onChange: (checked: boolean) => void }) {
  const id = useId();
  const info = SCOPE_INFO[scope];
  return (
    <div className={cn('flex gap-3 border p-3 transition-colors', checked ? 'border-primary/40 bg-primary/5' : 'border-border')}>
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        aria-describedby={`${id}-desc`}
        className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      />
      <div className="min-w-0 space-y-1">
        <label htmlFor={id} className="flex cursor-pointer flex-wrap items-center gap-2 text-sm font-medium text-foreground">
          {info.title}
          <code className="font-code text-[11px] font-normal text-muted-foreground">{scope}</code>
          {info.sensitive && (
            <span className="border border-destructive/30 bg-destructive/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-destructive">
              Destructive
            </span>
          )}
        </label>
        <p id={`${id}-desc`} className="text-xs text-muted-foreground">
          {info.allows}
        </p>
      </div>
    </div>
  );
}

function Review({ registration, onReset }: { registration: Registration; onReset: () => void }) {
  const queryClient = useQueryClient();
  const now = useNow();
  const [selected, setSelected] = useState<Scope[]>(registration.requestedScopes);
  const [outcome, setOutcome] = useState<{ type: 'approved'; scopes: Scope[] } | { type: 'denied' } | null>(null);
  const remainingMs = Date.parse(registration.expiresAt) - now;
  const code = registration.userCode;

  const approve = useMutation({
    mutationFn: () => api.approveRegistration(code, selected),
    onSuccess: (res) => {
      setOutcome({ type: 'approved', scopes: res.registration.scopes });
      void queryClient.invalidateQueries({ queryKey: ['agents'] });
    },
  });
  const deny = useMutation({
    mutationFn: () => api.denyRegistration(code),
    onSuccess: () => setOutcome({ type: 'denied' }),
  });

  if (outcome?.type === 'approved') {
    return (
      <StateCard
        icon={<CheckCircle2 className="h-5 w-5" />}
        tone="success"
        title="Agent approved"
        actions={<Button variant="outline" asChild className="font-mono"><Link to="/agents">Manage agents</Link></Button>}
      >
        <p>
          <span className="font-medium text-foreground">“{registration.name}”</span> can now:{' '}
          {outcome.scopes.map((s) => SCOPE_INFO[s].title.toLowerCase()).join(', ')}.
        </p>
        <p className="text-foreground">Return to your agent. It finishes connecting on its own within a few seconds.</p>
        <p>You can revoke its access at any time on the Agents page.</p>
      </StateCard>
    );
  }
  if (outcome?.type === 'denied') {
    return (
      <StateCard icon={<ShieldX className="h-5 w-5" />} title="Request denied" actions={<Button variant="outline" asChild className="font-mono"><Link to="/">Back to invoices</Link></Button>}>
        <p>The agent did not get access to your invoices. You can close this page.</p>
      </StateCard>
    );
  }

  const decisionError = approve.error ?? deny.error;
  if (decisionError instanceof ApiError && [404, 409, 410, 429].includes(decisionError.status)) {
    return <ErrorState error={decisionError} onReset={onReset} />;
  }
  if (remainingMs <= 0) {
    return <ErrorState error={new ApiError(410, 'gone', 'expired')} onReset={onReset} />;
  }

  const busy = approve.isPending || deny.isPending;
  const toggle = (scope: Scope, on: boolean) =>
    setSelected((prev) => (on ? registration.requestedScopes.filter((s) => s === scope || prev.includes(s)) : prev.filter((s) => s !== scope)));
  const narrowed = selected.length < registration.requestedScopes.length;

  return (
    <div className={cn(card, 'space-y-6')}>
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary/10" aria-hidden="true">
          <Bot className="h-5 w-5 text-primary" />
        </div>
        <div className="min-w-0 space-y-1">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">Agent access request</p>
          <h2 className="break-words text-lg font-semibold text-foreground">
            An agent named “<span data-testid="agent-name">{registration.name}</span>” is asking for access to this
            workspace’s invoices
          </h2>
        </div>
      </div>

      {registration.description && (
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">Description provided by the agent (not verified):</p>
          <p className="whitespace-pre-wrap break-words border-l-2 border-border pl-3 text-sm text-foreground">{registration.description}</p>
        </div>
      )}

      <div className="flex gap-3 border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
        <div className="space-y-1 text-foreground">
          <p className="font-medium">Only approve if you started this yourself, just now.</p>
          <p className="text-muted-foreground">
            The name and description are chosen by the agent. If someone sent you this link or code, or you do not recognise
            it, deny it: approving gives that agent access to your invoices.
          </p>
        </div>
      </div>

      <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
        <div className="flex items-center gap-2">
          <Hash className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <dt className="text-muted-foreground">Code</dt>
          <dd className="font-mono tracking-widest text-foreground">{code}</dd>
        </div>
        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <dt className="text-muted-foreground">Expires in</dt>
          <dd className={cn('font-mono tabular-nums text-foreground', remainingMs < 60_000 && 'text-destructive')}>
            <span aria-hidden="true">{formatRemaining(remainingMs)}</span>
            <span className="sr-only">{`${formatRemaining(remainingMs)} (at ${format(parseISO(registration.expiresAt), 'HH:mm')})`}</span>
          </dd>
        </div>
      </dl>
      <p className="-mt-3 text-xs text-muted-foreground">Check that this code matches the one your agent shows.</p>

      <fieldset className="space-y-2">
        <legend className="mb-2 text-sm font-medium text-foreground">Permissions requested</legend>
        <p className="text-xs text-muted-foreground">Untick anything you do not want to allow. You can only reduce what the agent asked for.</p>
        {registration.requestedScopes.map((scope) => (
          <ScopeChoice key={scope} scope={scope} checked={selected.includes(scope)} onChange={(on) => toggle(scope, on)} />
        ))}
      </fieldset>

      {decisionError && (
        <p role="alert" className="text-sm text-destructive">
          {describeError(decisionError)}
        </p>
      )}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="outline" onClick={() => deny.mutate()} disabled={busy} className="text-destructive hover:text-destructive">
          {deny.isPending ? 'Denying…' : 'Deny'}
        </Button>
        <Button onClick={() => approve.mutate()} disabled={busy || selected.length === 0}>
          {approve.isPending ? 'Approving…' : narrowed ? `Approve ${selected.length} of ${registration.requestedScopes.length} permissions` : 'Approve'}
        </Button>
      </div>
      {selected.length === 0 && (
        <p className="-mt-4 text-right text-xs text-muted-foreground">Select at least one permission to approve, or deny the request.</p>
      )}
    </div>
  );
}

function RegistrationLoader({ code, onReset }: { code: string; onReset: () => void }) {
  const query = useQuery({
    queryKey: ['agent-registration', code],
    queryFn: async () => (await api.getRegistration(code)).registration,
    retry: false,
    refetchOnWindowFocus: false,
    staleTime: Infinity,
  });
  if (query.isPending) {
    return (
      <div className="flex justify-center py-16" role="status" aria-label="Loading request">
        <Spinner size="md" />
      </div>
    );
  }
  if (query.isError) return <ErrorState error={query.error} onReset={onReset} />;
  return <Review key={query.data.id} registration={query.data} onReset={onReset} />;
}

/**
 * `/agents/approve?code=XXXX-XXXX`: consent screen of the agent
 * device-authorisation flow. Never approves on its own: the user reviews the
 * agent, the permissions and the code, then clicks Approve or Deny.
 */
export default function ApproveAgent() {
  const [params, setParams] = useSearchParams();
  const enabled = useCloudEnabled();
  const raw = params.get('code') ?? '';
  const normalized = raw ? normalizeUserCode(raw) : null;
  const code = normalized ? formatUserCode(normalized) : null;
  const reset = () => setParams({});

  return (
    <div className="min-h-screen bg-background">
      <PageHeader title="Approve agent" />
      <main className="container py-8">
        <div className="mx-auto max-w-xl space-y-6">
          <div>
            <h2 className="mb-2 text-2xl font-semibold text-foreground">Connect an agent</h2>
            <p className="text-sm text-muted-foreground">
              Review an AI agent’s request to work with your invoices.
            </p>
          </div>

          {!code ? (
            <CodeEntry key={raw} initialError={raw ? 'That code does not look right. Codes have 8 letters, like WDJB-MJHT.' : undefined} />
          ) : !enabled ? (
            <div className="space-y-4">
              <StateCard icon={<Hash className="h-5 w-5" />} title={`Code ${code}`}>
                <p>
                  Agents work with invoices stored in the cloud, and cloud sync is not turned on in this browser yet. Turn it
                  on (or connect the workspace you already use on another device); you will then review this request here.
                </p>
              </StateCard>
              <EnableCloudSyncCard />
            </div>
          ) : (
            <RegistrationLoader key={code} code={code} onReset={reset} />
          )}
        </div>
      </main>
    </div>
  );
}

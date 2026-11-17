import { useEffect, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format, parseISO } from 'date-fns';
import { AlertTriangle, CheckCircle2, Clock, Globe, KeyRound, Laptop, Plug, ShieldAlert, ShieldX, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { PageHeader } from '@/components/PageHeader';
import { EnableCloudSyncCard } from '@/components/sync/CloudSyncSettings';
import { SCOPE_INFO } from '@/components/agents/scopes';
import { ApiError, describeError, formatWait } from '@/lib/api/errors';
import { cn } from '@/lib/utils';
import { ScopeChoice, StateCard } from '../ApproveAgent';
import { browser, checkRedirectTarget, consentApi, useConsentIdentity } from './consent';
import type { Scope } from '../../../shared/api';
import { OAUTH_REQUEST_ERRORS, type OAuthRequestError, type OAuthRequestPreview } from '../../../shared/oauth';

type Request = OAuthRequestPreview['request'];

const card = 'rounded-lg border border-border bg-card p-4 sm:p-6';
const REQUEST_ID = /^[A-Za-z0-9_-]{32,64}$/;

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
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

const manageAgents = (
  <Button variant="outline" asChild className="font-mono">
    <Link to="/agents">Manage agents</Link>
  </Button>
);

/** Errors found before the request could be shown: fixed text only, nothing from the request. */
const REQUEST_ERROR_TEXT: Record<OAuthRequestError, { title: string; body: string }> = {
  invalid_client: {
    title: 'Unknown app',
    body: 'The app that sent you here is not registered with Midnight Invoice, or its registration expired. Start connecting again from your MCP client.',
  },
  invalid_redirect_uri: {
    title: 'This link cannot be used',
    body: 'The address the app asked to be sent back to does not match the addresses it registered. For your safety you were not sent back to it. Start connecting again from your MCP client.',
  },
  invalid_client_metadata: {
    title: 'The app could not be verified',
    body: 'Its client information could not be downloaded or is not valid. Try again later, or ask the app’s developer.',
  },
  invalid_request: {
    title: 'This link is not valid',
    body: 'The connection request is malformed. Start connecting again from your MCP client.',
  },
  rate_limited: {
    title: 'Too many attempts',
    body: 'Too many connection requests came from your network. Wait a minute, then start connecting again from your MCP client.',
  },
};

function RequestErrorState({ code }: { code: string }) {
  const known = (OAUTH_REQUEST_ERRORS as readonly string[]).includes(code) ? REQUEST_ERROR_TEXT[code as OAuthRequestError] : REQUEST_ERROR_TEXT.invalid_request;
  return (
    <StateCard icon={<XCircle className="h-5 w-5" />} tone="danger" title={known.title} actions={manageAgents}>
      <p>{known.body}</p>
    </StateCard>
  );
}

function LoadErrorState({ error }: { error: unknown }) {
  if (error instanceof ApiError) {
    if (error.status === 404) {
      return (
        <StateCard icon={<XCircle className="h-5 w-5" />} tone="danger" title="No such request" actions={manageAgents}>
          <p>This link does not belong to a connection request. Start connecting again from your MCP client.</p>
        </StateCard>
      );
    }
    if (error.status === 409) {
      const status = (error.details as { status?: string } | undefined)?.status;
      return (
        <StateCard icon={<CheckCircle2 className="h-5 w-5" />} title={`This request was already ${status === 'denied' ? 'denied' : 'approved'}`} actions={manageAgents}>
          <p>Each request can be answered once. If this was not you, revoke the agent on the Agents page.</p>
        </StateCard>
      );
    }
    if (error.status === 410) {
      return (
        <StateCard icon={<Clock className="h-5 w-5" />} tone="danger" title="This request expired" actions={manageAgents}>
          <p>Requests are valid for 10 minutes. Start connecting again from your MCP client; it will send you back here.</p>
        </StateCard>
      );
    }
    if (error.status === 429) {
      return (
        <StateCard icon={<AlertTriangle className="h-5 w-5" />} tone="danger" title="Too many attempts">
          <p>Wait {error.retryAfterMs !== null ? formatWait(error.retryAfterMs) : 'a minute'} and reload this page.</p>
        </StateCard>
      );
    }
  }
  return (
    <StateCard icon={<AlertTriangle className="h-5 w-5" />} tone="danger" title="Could not load the request">
      <p>{describeError(error)}</p>
    </StateCard>
  );
}

const REDIRECT_KIND: Record<Request['redirect']['kind'], { icon: ReactNode; label: string }> = {
  https: { icon: <Globe className="h-4 w-4 text-muted-foreground" aria-hidden="true" />, label: 'a website' },
  loopback: { icon: <Laptop className="h-4 w-4 text-muted-foreground" aria-hidden="true" />, label: 'a program on this computer' },
  custom_scheme: { icon: <Laptop className="h-4 w-4 text-muted-foreground" aria-hidden="true" />, label: 'an app installed on this device' },
};

/** Redirect in progress after a decision (with a manual link in case the browser blocks it). */
function Leaving({ request, target, approved, scopes }: { request: Request; target: URL | null; approved: boolean; scopes: Scope[] }) {
  useEffect(() => {
    // The decision replaces a long form: show its result from the top (phones).
    window.scrollTo?.({ top: 0 });
    if (target) browser.leaveTo(target.href);
  }, [target]);
  if (!target) {
    return (
      <StateCard icon={<AlertTriangle className="h-5 w-5" />} tone="danger" title="Could not return to the app" actions={manageAgents}>
        <p>The server answered with an unexpected address, so this page did not follow it. Start connecting again from your MCP client.</p>
      </StateCard>
    );
  }
  const continueLink = (
    <Button variant="outline" asChild>
      <a href={target.href} rel="noreferrer">
        Continue to {request.redirect.display}
      </a>
    </Button>
  );
  return approved ? (
    <StateCard icon={<CheckCircle2 className="h-5 w-5" />} tone="success" title="Access approved" actions={<>{continueLink}{manageAgents}</>}>
      <p>
        <span className="font-medium text-foreground">“{request.client.name}”</span> can now:{' '}
        {scopes.map((s) => SCOPE_INFO[s].title.toLowerCase()).join(', ')}.
      </p>
      <p className="text-foreground">
        Returning you to <span className="font-code">{request.redirect.display}</span>… If nothing happens, use the button below.
      </p>
      <p>You can revoke its access at any time on the Agents page.</p>
    </StateCard>
  ) : (
    <StateCard icon={<ShieldX className="h-5 w-5" />} title="Request denied" actions={continueLink}>
      <p>
        The app did not get access to your invoices. Returning you to <span className="font-code">{request.redirect.display}</span>…
      </p>
    </StateCard>
  );
}

function Review({ request }: { request: Request }) {
  const queryClient = useQueryClient();
  const now = useNow();
  const [selected, setSelected] = useState<Scope[]>(request.requestedScopes);
  const [outcome, setOutcome] = useState<{ approved: boolean; target: URL | null; scopes: Scope[] } | null>(null);
  const remainingMs = Date.parse(request.expiresAt) - now;

  const approve = useMutation({
    mutationFn: () => consentApi.approve(request.id, selected),
    onSuccess: (res) => {
      setOutcome({ approved: true, target: checkRedirectTarget(res.redirectTo, request.redirect.uri), scopes: res.scopes ?? selected });
      void queryClient.invalidateQueries({ queryKey: ['agents'] });
    },
  });
  const deny = useMutation({
    mutationFn: () => consentApi.deny(request.id),
    onSuccess: (res) => setOutcome({ approved: false, target: checkRedirectTarget(res.redirectTo, request.redirect.uri), scopes: [] }),
  });

  if (outcome) return <Leaving request={request} target={outcome.target} approved={outcome.approved} scopes={outcome.scopes} />;
  const decisionError = approve.error ?? deny.error;
  if (decisionError instanceof ApiError && [404, 409, 410, 429].includes(decisionError.status)) return <LoadErrorState error={decisionError} />;
  if (remainingMs <= 0) return <LoadErrorState error={new ApiError(410, 'gone', 'expired')} />;

  const busy = approve.isPending || deny.isPending;
  const toggle = (scope: Scope, on: boolean) =>
    setSelected((prev) => (on ? request.requestedScopes.filter((s) => s === scope || prev.includes(s)) : prev.filter((s) => s !== scope)));
  const narrowed = selected.length < request.requestedScopes.length;
  const redirectKind = REDIRECT_KIND[request.redirect.kind];

  return (
    <div className={cn(card, 'space-y-6')}>
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary/10" aria-hidden="true">
          <Plug className="h-5 w-5 text-primary" />
        </div>
        <div className="min-w-0 space-y-1">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">MCP client access request</p>
          <h2 className="break-words text-lg font-semibold text-foreground">
            An app named “<span data-testid="client-name">{request.client.name}</span>” is asking for access to this
            workspace’s invoices
          </h2>
        </div>
      </div>

      <dl className="space-y-3 text-sm">
        <div className="flex flex-wrap items-start gap-x-2 gap-y-1">
          <span className="mt-0.5">{redirectKind.icon}</span>
          <dt className="text-muted-foreground">Sends you back to</dt>
          <dd className="min-w-0 text-foreground">
            <span className="inline-block max-w-full break-all font-code" data-testid="redirect-display">
              {request.redirect.display}
            </span>{' '}
            <span className="text-muted-foreground">({redirectKind.label})</span>
          </dd>
        </div>
        <div className="flex flex-wrap items-start gap-x-2 gap-y-1">
          <KeyRound className="mt-0.5 h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <dt className="text-muted-foreground">Identified by</dt>
          <dd className="min-w-0 text-foreground">
            {request.client.kind === 'cimd' && request.client.metadataHost ? (
              <>
                details published at <span className="inline-block max-w-full break-all font-code">{request.client.metadataHost}</span>
              </>
            ) : (
              'details the app registered itself (not verified)'
            )}
          </dd>
        </div>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Clock className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <dt className="text-muted-foreground">Expires in</dt>
          <dd className={cn('font-mono tabular-nums text-foreground', remainingMs < 60_000 && 'text-destructive')}>
            <span aria-hidden="true">{formatRemaining(remainingMs)}</span>
            <span className="sr-only">{`${formatRemaining(remainingMs)} (at ${format(parseISO(request.expiresAt), 'HH:mm')})`}</span>
          </dd>
        </div>
      </dl>

      {request.existingAgent && (
        <p className="border-l-2 border-border pl-3 text-sm text-muted-foreground" data-testid="existing-agent">
          This app is already connected as “<span className="text-foreground">{request.existingAgent.name}</span>”. Approving
          replaces its permissions with the ones you choose below.
        </p>
      )}

      <div className="flex gap-3 border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
        <div className="space-y-1 text-foreground">
          <p className="font-medium">Only approve if you started this yourself, just now.</p>
          <p className="text-muted-foreground">
            The name is chosen by the app and is not verified. If someone sent you this link, or you do not recognise{' '}
            <span className="inline-block max-w-full break-all font-code text-foreground">{request.redirect.display}</span>, deny it: approving gives
            that app access to your invoices.
          </p>
          {request.redirect.kind !== 'https' && (
            <p className="text-muted-foreground" data-testid="local-redirect-warning">
              Access is handed to {redirectKind.label}. Any program on this device could be listening there, so only continue
              if you just started connecting from an app on this device.
            </p>
          )}
        </div>
      </div>

      <fieldset className="space-y-2">
        <legend className="mb-2 text-sm font-medium text-foreground">Permissions requested</legend>
        <p className="text-xs text-muted-foreground">
          {request.scopesDefaulted
            ? 'The app did not ask for specific permissions, so these are the defaults. '
            : ''}
          Untick anything you do not want to allow. You can only reduce what the app asked for.
        </p>
        {request.requestedScopes.map((scope) => (
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
          {approve.isPending ? 'Approving…' : narrowed ? `Approve ${selected.length} of ${request.requestedScopes.length} permissions` : 'Approve'}
        </Button>
      </div>
      {selected.length === 0 && (
        <p className="-mt-4 text-right text-xs text-muted-foreground">Select at least one permission to approve, or deny the request.</p>
      )}
    </div>
  );
}

function RequestLoader({ requestId }: { requestId: string }) {
  const query = useQuery({
    queryKey: ['oauth-request', requestId],
    queryFn: async () => (await consentApi.get(requestId)).request,
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
  if (query.isError) return <LoadErrorState error={query.error} />;
  return <Review key={query.data.id} request={query.data} />;
}

/**
 * `/agents/authorize?request=…`: consent screen of the OAuth flow for MCP
 * clients (GET /api/oauth/authorize lands here). Never approves on its own;
 * everything the client chose (name, redirect target) is shown as plain,
 * untrusted text. The decision is a same-origin POST with the workspace
 * token, which returns where to send the browser.
 */
export default function AuthorizeAgent() {
  const [params] = useSearchParams();
  const identity = useConsentIdentity();
  const error = params.get('error');
  const requestId = params.get('request') ?? '';

  let content: ReactNode;
  if (error) content = <RequestErrorState code={error} />;
  else if (!REQUEST_ID.test(requestId)) {
    content = (
      <StateCard icon={<Plug className="h-5 w-5" />} title="Nothing to review" actions={manageAgents}>
        <p>This page opens when an MCP client asks to connect to Midnight Invoice. Start connecting from your MCP client.</p>
      </StateCard>
    );
  } else if (identity.status === 'needs_workspace') {
    content = (
      <div className="space-y-4">
        <StateCard icon={<Plug className="h-5 w-5" />} title="An app is asking to connect">
          <p>
            Agents work with invoices stored in the cloud, and cloud sync is not turned on in this browser yet. Turn it on (or
            connect the workspace you already use on another device); you will then review this request here.
          </p>
        </StateCard>
        <EnableCloudSyncCard />
      </div>
    );
  } else content = <RequestLoader key={requestId} requestId={requestId} />;

  return (
    <div className="min-h-screen bg-background">
      <PageHeader title="Authorize app" />
      <main className="container py-8">
        <div className="mx-auto max-w-xl space-y-6">
          <div>
            <h2 className="mb-2 text-2xl font-semibold text-foreground">Connect an MCP client</h2>
            <p className="text-sm text-muted-foreground">Review an app’s request to work with your invoices.</p>
          </div>
          {content}
        </div>
      </main>
    </div>
  );
}

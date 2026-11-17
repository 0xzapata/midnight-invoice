import { useId, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format, formatDistanceToNow, parseISO } from 'date-fns';
import { Bot, ChevronRight, History, Plug, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { PageHeader } from '@/components/PageHeader';
import { CopyButton } from '@/components/CopyButton';
import { EnableCloudSyncCard } from '@/components/sync/CloudSyncSettings';
import { AgentActivityPreview } from '@/components/activity/AgentActivityPreview';
import { SCOPE_INFO, SCOPE_SHORT } from '@/components/agents/scopes';
import { api } from '@/lib/api';
import { describeError } from '@/lib/api/errors';
import { useCloudEnabled } from '@/stores/useCloudStore';
import { cn } from '@/lib/utils';
import { formatUserCode, normalizeUserCode } from '../../shared/user-code';
import { API_BASE_PATH, MCP_PATH, SCOPES, type AgentSummary } from '../../shared/api';

const card = 'rounded-lg border border-border bg-card p-4 sm:p-5';

function ScopeChips({ agent }: { agent: AgentSummary }) {
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="Permissions">
      {agent.scopes.map((scope) => (
        <li
          key={scope}
          title={SCOPE_INFO[scope].allows}
          className={cn(
            'border px-1.5 py-0.5 text-[11px] font-medium',
            SCOPE_INFO[scope].sensitive ? 'border-destructive/30 text-destructive' : 'border-border text-muted-foreground',
          )}
        >
          {SCOPE_SHORT[scope]}
        </li>
      ))}
    </ul>
  );
}

function AgentRow({ agent }: { agent: AgentSummary }) {
  const queryClient = useQueryClient();
  const revoke = useMutation({
    mutationFn: () => api.revokeAgent(agent.id),
    onSuccess: () => {
      toast.success(`Access revoked for “${agent.name}”`);
      void queryClient.invalidateQueries({ queryKey: ['agents'] });
    },
    onError: (err) => toast.error('Could not revoke the agent', { description: describeError(err) }),
  });
  const revoked = agent.revokedAt !== null;

  return (
    <li className={cn(card, 'flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between', revoked && 'opacity-60')}>
      <div className="flex min-w-0 items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-secondary" aria-hidden="true">
          <Bot className="h-5 w-5 text-muted-foreground" />
        </div>
        <div className="min-w-0 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <p className="break-words font-medium text-foreground">{agent.name}</p>
            <span
              className={cn(
                'px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider',
                revoked ? 'bg-secondary text-muted-foreground' : 'bg-primary/10 text-primary',
              )}
            >
              {revoked ? 'Revoked' : 'Active'}
            </span>
            {agent.connection === 'oauth' && (
              <span
                title="Connected from an MCP client with OAuth"
                className="border border-border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground"
              >
                OAuth
              </span>
            )}
          </div>
          {agent.description && <p className="line-clamp-2 break-words text-sm text-muted-foreground">{agent.description}</p>}
          <ScopeChips agent={agent} />
          <p className="text-xs text-muted-foreground">
            Connected {format(parseISO(agent.createdAt), 'MMM d, yyyy')}
            {agent.connection === 'oauth' ? ' via OAuth' : ''} · Last used{' '}
            {agent.lastUsedAt ? formatDistanceToNow(parseISO(agent.lastUsedAt), { addSuffix: true }) : 'never'}
            {revoked && ` · Revoked ${format(parseISO(agent.revokedAt!), 'MMM d, yyyy')}`}
          </p>
          <AgentActivityPreview agentId={agent.id} agentName={agent.name} />
        </div>
      </div>
      {!revoked && (
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              disabled={revoke.isPending}
              aria-label={`Revoke access for ${agent.name}`}
              className="self-start text-destructive hover:text-destructive"
            >
              <Trash2 className="w-4 h-4" aria-hidden="true" />
              {revoke.isPending ? 'Revoking…' : 'Revoke'}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Revoke “{agent.name}”?</AlertDialogTitle>
              <AlertDialogDescription>
                It loses access to this workspace immediately and cannot reconnect without your approval. Invoices it created
                stay.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={() => revoke.mutate()} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                Revoke access
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </li>
  );
}

function AgentList() {
  const query = useQuery({ queryKey: ['agents'], queryFn: async () => (await api.listAgents()).agents });

  if (query.isPending) {
    return (
      <div className="flex justify-center py-10" role="status" aria-label="Loading agents">
        <Spinner size="sm" />
      </div>
    );
  }
  if (query.isError) {
    return (
      <div className={cn(card, 'flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between')} role="alert">
        <p className="text-sm text-destructive">{describeError(query.error)}</p>
        <Button variant="outline" size="sm" onClick={() => void query.refetch()}>
          Try again
        </Button>
      </div>
    );
  }
  const active = query.data.filter((a) => a.revokedAt === null);
  const revoked = query.data.filter((a) => a.revokedAt !== null);

  return (
    <div className="space-y-3">
      {active.length === 0 ? (
        <div className={cn(card, 'text-center')}>
          <p className="text-sm text-muted-foreground">No agents connected yet. Follow the steps below to connect one.</p>
        </div>
      ) : (
        <ul className="space-y-2" aria-label="Connected agents">
          {active.map((agent) => (
            <AgentRow key={agent.id} agent={agent} />
          ))}
        </ul>
      )}
      {revoked.length > 0 && (
        <details className="group">
          <summary className="flex cursor-pointer list-none items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            <ChevronRight className="h-4 w-4 transition-transform group-open:rotate-90" aria-hidden="true" />
            Revoked agents ({revoked.length})
          </summary>
          <ul className="mt-2 space-y-2" aria-label="Revoked agents">
            {revoked.map((agent) => (
              <AgentRow key={agent.id} agent={agent} />
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function CodeForm() {
  const id = useId();
  const navigate = useNavigate();
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const normalized = normalizeUserCode(value);
    if (!normalized) {
      setError('Codes have 8 letters, like WDJB-MJHT.');
      return;
    }
    navigate(`/agents/approve?code=${formatUserCode(normalized)}`);
  };
  return (
    <form onSubmit={submit} noValidate className="space-y-2">
      <Label htmlFor={`${id}-code`} className="text-xs text-muted-foreground">
        Got a code from an agent?
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
          Review request
        </Button>
      </div>
      {error && (
        <p id={`${id}-error`} role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </form>
  );
}

function Snippet({ label, value, wrap = false }: { label: string; value: string; wrap?: boolean }) {
  const id = useId();
  return (
    <div className="min-w-0 space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <p id={id} className="text-xs text-muted-foreground">
          {label}
        </p>
        <CopyButton value={value} label="Copy" variant="ghost" className="h-7 px-2 text-xs" />
      </div>
      <pre
        aria-labelledby={id}
        tabIndex={0}
        className={cn('overflow-x-auto border border-border bg-secondary p-3 font-code text-xs text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring', wrap ? 'whitespace-pre-wrap [overflow-wrap:anywhere]' : 'whitespace-pre')}
      >
        {value}
      </pre>
    </div>
  );
}

/** Every permission an agent can ask for, in plain language (the same text as the approval screen). */
function PermissionGlossary() {
  return (
    <details className="group text-sm">
      <summary className="cursor-pointer text-muted-foreground hover:text-foreground">Permissions an agent can ask for</summary>
      <dl className="mt-3 space-y-2">
        {SCOPES.map((scope) => (
          <div key={scope} className="grid gap-0.5 sm:grid-cols-[12rem_1fr] sm:gap-3">
            <dt className="font-medium text-foreground">
              {SCOPE_INFO[scope].title} <code className="font-code text-[11px] font-normal text-muted-foreground">{scope}</code>
              {SCOPE_INFO[scope].sensitive && (
                <span className="ml-1.5 border border-destructive/30 bg-destructive/10 px-1 py-px text-[10px] font-medium uppercase tracking-wider text-destructive">
                  {SCOPE_INFO[scope].sensitiveLabel ?? 'Destructive'}
                </span>
              )}
            </dt>
            <dd className="text-muted-foreground">{SCOPE_INFO[scope].allows}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

/** How to point an agent at this app. */
export function ConnectAgentHelp({ origin = window.location.origin }: { origin?: string }) {
  const baseUrl = `${origin}${API_BASE_PATH}`;
  const mcpUrl = `${origin}${MCP_PATH}`;
  const prompt = [
    `Connect to my Midnight Invoice workspace. Read ${origin}/llms.txt and follow it:`,
    `register at POST ${baseUrl}/agents/register with your name, a short description and only the scopes you need,`,
    `then show me the user code and the approval link, and poll for your API key while I approve.`,
    `Never ask me for my workspace recovery key.`,
  ].join(' ');
  const mcpConfig = JSON.stringify(
    {
      mcpServers: {
        'midnight-invoice': { type: 'http', url: mcpUrl, headers: { Authorization: 'Bearer <agent API key>' } },
      },
    },
    null,
    2,
  );

  return (
    <div className={cn(card, 'space-y-6')}>
      <div className="space-y-3">
        <h4 className="text-sm font-medium text-foreground">Simplest: paste this URL into your MCP client</h4>
        <Snippet label="MCP server URL (Streamable HTTP, sign-in with OAuth)" value={mcpUrl} />
        <p className="text-sm text-muted-foreground">
          MCP clients that support signing in (OAuth) open this app in your browser. Check the permissions, approve, and the
          client connects. There is no key to copy.
        </p>
      </div>
      <div className="space-y-3 border-t border-border pt-5">
        <h4 className="text-sm font-medium text-foreground">Or let an agent register itself</h4>
        <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
          <li>Paste the prompt below into your AI agent (Claude, ChatGPT, a script…).</li>
          <li>It registers and shows you a code and a link to this app.</li>
          <li>Open the link (or type the code above), check the permissions and approve.</li>
        </ol>
        <Snippet label="Prompt for your agent" value={prompt} wrap />
        <Snippet label="API base URL" value={baseUrl} />
        <Snippet label="MCP client configuration with the agent’s API key (for clients without OAuth)" value={mcpConfig} />
      </div>
      <PermissionGlossary />
      <p className="text-xs text-muted-foreground">
        Agents get their own credentials with only the permissions you approve. Never give an agent your recovery key.
      </p>
    </div>
  );
}

/** `/agents`: connected agents, revocation and how to connect a new one. */
export default function Agents() {
  const enabled = useCloudEnabled();
  return (
    <div className="min-h-screen bg-background">
      <PageHeader title="Agents" />
      <main className="container py-8">
        <div className="mx-auto max-w-3xl space-y-10">
          <div>
            <h2 className="mb-2 text-2xl font-semibold text-foreground">Agents</h2>
            <p className="text-sm text-muted-foreground">
              AI agents you approve can work with this workspace’s invoices and saved clients, with only the permissions you
              give them. Their changes are marked with their name.
            </p>
          </div>

          {!enabled ? (
            <EnableCloudSyncCard reason="Agents work with invoices stored in the cloud. Turn on cloud sync to connect one." />
          ) : (
            <section aria-labelledby="agents-connected" className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 id="agents-connected" className="text-lg font-semibold text-foreground">
                  Connected agents
                </h3>
                <Button variant="outline" size="sm" asChild>
                  <Link to="/activity">
                    <History className="h-4 w-4" aria-hidden="true" />
                    Activity log
                  </Link>
                </Button>
              </div>
              <AgentList />
              <CodeForm />
            </section>
          )}

          <section aria-labelledby="agents-connect" className="space-y-4">
            <div className="flex items-center gap-2">
              <Plug className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              <h3 id="agents-connect" className="text-lg font-semibold text-foreground">
                Connect an agent
              </h3>
            </div>
            <ConnectAgentHelp />
          </section>
        </div>
      </main>
    </div>
  );
}

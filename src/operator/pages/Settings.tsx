import { useId, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';
import type { SettingItem } from '../../../shared/operator';
import { errorMessage, operatorApi } from '../api';
import { Badge, Card, ErrorNote, PageTitle, Switch, fmtAgo } from '../ui';

const KEY = ['operator', 'settings'] as const;

function useSave() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ key, value }: { key: string; value: unknown }) => operatorApi.setSetting(key, value),
    onSuccess: (_d, v) => {
      toast.success(`Saved ${v.key}`);
      void queryClient.invalidateQueries({ queryKey: KEY });
    },
  });
}

function SourceBadge({ s }: { s: SettingItem }) {
  if (s.source === 'database') return <Badge tone="info">Set in console</Badge>;
  if (s.source === 'environment') return <Badge>From Worker env</Badge>;
  return <Badge>Default</Badge>;
}

function SettingRow({ s, locked }: { s: SettingItem; locked: boolean }) {
  const queryClient = useQueryClient();
  const save = useSave();
  const reset = useMutation({
    mutationFn: () => operatorApi.resetSetting(s.key),
    onSuccess: () => {
      toast.success(s.secret ? `Cleared ${s.key}` : `Reset ${s.key}`);
      void queryClient.invalidateQueries({ queryKey: KEY });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const [draft, setDraft] = useState<string>(s.secret ? '' : s.value === undefined || s.value === null ? '' : String(s.value));
  const id = useId();
  const dirty = s.secret ? draft !== '' : draft !== String(s.value ?? '');

  const submit = () => {
    const value = s.type === 'integer' ? Number(draft) : draft;
    save.mutate({ key: s.key, value }, { onSuccess: () => s.secret && setDraft('') });
  };

  return (
    <div className="grid gap-3 border-b border-border/60 py-4 last:border-0 md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor={id} className="text-sm font-medium text-foreground">
            {s.label}
          </label>
          <SourceBadge s={s} />
          {s.secret && <Badge tone="warn">Secret</Badge>}
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">{s.description}</p>
        <p className="font-code text-[11px] text-muted-foreground">
          {s.key}
          {s.updatedAt ? ` · changed ${fmtAgo(s.updatedAt)}${s.updatedBy ? ` by ${s.updatedBy}` : ''}` : ''}
        </p>
      </div>
      <div className="min-w-0 space-y-2">
        {s.type === 'boolean' ? (
          <div className="flex items-center gap-3">
            <Switch id={id} checked={s.value === true} label={s.label} onChange={(v) => save.mutate({ key: s.key, value: v })} disabled={save.isPending} />
            <span className="text-sm text-muted-foreground">{s.value ? 'On' : 'Off'}</span>
          </div>
        ) : (
          <form
            className="flex flex-col gap-2 sm:flex-row"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            {s.type === 'enum' ? (
              <select id={id} value={draft} onChange={(e) => setDraft(e.target.value)} className="h-10 flex-1 border border-input bg-background px-2 text-sm">
                {s.options?.map((o) => (
                  <option key={o}>{o}</option>
                ))}
              </select>
            ) : (
              <Input
                id={id}
                type={s.secret ? 'password' : s.type === 'integer' ? 'number' : s.type === 'url' ? 'url' : 'text'}
                min={s.min}
                max={s.max}
                autoComplete="off"
                spellCheck={false}
                placeholder={s.secret ? (s.isSet ? `Set · ends in ${s.last4 ?? '••••'} — enter a new value to replace` : 'Not set') : String(s.defaultValue ?? '')}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                className={cn('flex-1', (s.secret || s.type === 'url') && 'font-code text-xs')}
                disabled={s.secret && locked}
              />
            )}
            <Button type="submit" size="sm" className="h-10" disabled={!dirty || save.isPending}>
              Save
            </Button>
          </form>
        )}
        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          {s.secret ? <span>{s.isSet ? `Set${s.last4 ? ` · •••• ${s.last4}` : ''}` : 'Not set'} · write-only</span> : s.type === 'integer' && <span>Range {s.min}–{s.max}</span>}
          {s.source === 'database' && (
            <button type="button" className="underline-offset-4 hover:text-foreground hover:underline" onClick={() => reset.mutate()} disabled={reset.isPending}>
              {s.secret ? 'Clear' : 'Reset to default'}
            </button>
          )}
        </div>
        {save.isError && save.variables?.key === s.key && <ErrorNote error={save.error} />}
      </div>
    </div>
  );
}

/** "Email: not configured" hint above the Email settings, computed from the list (no extra request). */
function emailSetupStatus(byKey: Map<string, SettingItem>): { ready: boolean; text: string } {
  if (byKey.get('email.enabled')?.value === false) return { ready: false, text: 'Email: turned off' };
  const missing = [
    !byKey.get('resend.apiKey')?.isSet && 'Resend API key',
    !byKey.get('email.fromAddress')?.value && 'From address (on a domain verified with Resend)',
  ].filter(Boolean);
  if (missing.length) return { ready: false, text: `Email: not configured — set the ${missing.join(' and the ')}` };
  // Who can send (security fix M2): the account requirement only works with user accounts on.
  const requireAccount = byKey.get('email.requireAccount')?.value;
  if (requireAccount === true && byKey.get('accounts.enabled')?.value !== true) {
    return {
      ready: false,
      text: 'Email: configured, but nobody can send — “Only signed-in accounts may send” is on and User accounts are off. Turn on User accounts, or turn that setting off (then anyone who turns on cloud sync can send from your domain).',
    };
  }
  if (requireAccount === true) return { ready: true, text: 'Email: configured — only workspaces with a signed-in account can send' };
  if (requireAccount === false) return { ready: true, text: 'Email: configured — anyone who turns on cloud sync can send, anonymous workspaces included' };
  return { ready: true, text: 'Email: configured' };
}

/** How many workspaces at their daily cap use up the site cap before the warning shows. */
const CAP_SHARE_WARNING = 5;

/** Warns when a few workspaces could use up the whole site's daily cap (security fix M2). */
function emailCapWarning(byKey: Map<string, SettingItem>): string | null {
  const ws = byKey.get('email.workspaceDailyCap')?.value;
  const site = byKey.get('email.globalDailyCap')?.value;
  if (typeof ws !== 'number' || typeof site !== 'number' || ws * CAP_SHARE_WARNING < site) return null;
  const n = Math.max(1, Math.ceil(site / ws));
  return `Warning: ${n === 1 ? 'one workspace' : `${n} workspaces`} at the daily cap (${ws}) can use up the whole site cap (${site}). Keep the workspace cap below 1/${CAP_SHARE_WARNING} of the site cap.`;
}

export function SettingsPage() {
  const q = useQuery({ queryKey: KEY, queryFn: operatorApi.settings });
  const save = useSave();
  if (q.isPending) return <Spinner />;
  if (q.isError) return <ErrorNote error={q.error} />;
  const { settings, propagationSeconds, encryptionLocked } = q.data;
  const byKey = new Map(settings.map((s) => [s.key, s]));
  const groups = [...new Set(settings.map((s) => s.group))];
  const quick = ['maintenance.enabled', 'registration.workspacesOpen', 'registration.agentsOpen'].map((k) => byKey.get(k)).filter(Boolean) as SettingItem[];

  return (
    <>
      <PageTitle
        title="Settings"
        description={`Runtime settings stored in D1 (secrets encrypted with AES-256-GCM). They override wrangler vars and reach every Worker isolate within ${propagationSeconds} seconds. Every change is audited (secret values never are).`}
      />
      {encryptionLocked && <ErrorNote error="Encrypted settings are locked: secret values cannot be read or written until access is restored (Operators & security)." />}
      <Card title="Quick controls" className="mb-4">
        <div className="grid gap-4 sm:grid-cols-3">
          {quick.map((s) => (
            <div key={s.key} className="flex items-center justify-between gap-3 border border-border p-3">
              <div className="min-w-0">
                <p className="text-sm text-foreground">{s.label}</p>
                <p className="text-xs text-muted-foreground">
                  {s.key === 'maintenance.enabled' ? (s.value ? 'API answers 503' : 'Serving normally') : s.value ? 'Open' : 'Closed'}
                </p>
              </div>
              <Switch checked={s.value === true} label={s.label} onChange={(v) => save.mutate({ key: s.key, value: v })} disabled={save.isPending} />
            </div>
          ))}
        </div>
      </Card>
      <div className="space-y-4">
        {groups.map((g) => (
          <Card key={g} title={g}>
            {g === 'Email' && (
              <p
                role="status"
                className={`mb-3 border px-3 py-2 text-xs ${emailSetupStatus(byKey).ready ? 'border-border text-muted-foreground' : 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300'}`}
              >
                {emailSetupStatus(byKey).text}
              </p>
            )}
            {g === 'Email' && emailCapWarning(byKey) && (
              <p role="status" className="mb-3 border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
                {emailCapWarning(byKey)}
              </p>
            )}
            {settings
              .filter((s) => s.group === g)
              .map((s) => (
                <SettingRow key={`${s.key}:${s.updatedAt}`} s={s} locked={encryptionLocked} />
              ))}
          </Card>
        ))}
      </div>
    </>
  );
}

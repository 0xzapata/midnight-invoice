import { useId, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Settings2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { CopyButton } from '@/components/CopyButton';
import { cn } from '@/lib/utils';
import type { SetupStep } from '../../shared/operator';
import { browserNav, operatorApi } from './api';
import { AuthShell } from './Login';
import { ErrorNote, RecoveryKeyPanel, card } from './ui';

const STEPS: { id: SetupStep[]; label: string }[] = [
  { id: ['encryption', 'encryption_confirm'], label: 'Encryption key' },
  { id: ['workos'], label: 'WorkOS' },
  { id: ['identity'], label: 'Operator account' },
];

function Progress({ step }: { step: SetupStep }) {
  const current = STEPS.findIndex((s) => s.id.includes(step));
  return (
    <ol className="mb-6 grid grid-cols-3 gap-2" aria-label="Setup progress">
      {STEPS.map((s, i) => (
        <li key={s.label} aria-current={i === current ? 'step' : undefined} className="space-y-1.5">
          <span className={cn('block h-1', i < current ? 'bg-primary' : i === current ? 'bg-primary/60' : 'bg-secondary')} />
          <span className={cn('flex items-center gap-1 text-xs', i <= current ? 'text-foreground' : 'text-muted-foreground')}>
            {i < current && <Check className="h-3 w-3 text-primary" aria-hidden="true" />}
            {i + 1}. {s.label}
          </span>
        </li>
      ))}
    </ol>
  );
}

function EncryptionStep({ step }: { step: SetupStep }) {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<'generate' | 'passphrase'>('generate');
  const [passphrase, setPassphrase] = useState('');
  const [confirmPassphrase, setConfirmPassphrase] = useState('');
  const [recoveryKey, setRecoveryKey] = useState<string | null>(null);
  const ppId = useId();
  const pp2Id = useId();
  const create = useMutation({
    mutationFn: () => operatorApi.createMasterKey(mode === 'generate' ? { mode } : { mode, passphrase }),
    onSuccess: (r) => {
      setRecoveryKey(r.recoveryKey);
      setPassphrase('');
      setConfirmPassphrase('');
    },
  });
  const confirm = useMutation({
    mutationFn: operatorApi.confirmMasterKey,
    onSuccess: () => {
      setRecoveryKey(null);
      void queryClient.invalidateQueries({ queryKey: ['operator', 'setup'] });
    },
  });

  if (recoveryKey) {
    return (
      <div className={cn(card, 'p-4 sm:p-5')}>
        <h2 className="mb-3 text-sm font-medium">Your recovery key</h2>
        <RecoveryKeyPanel recoveryKey={recoveryKey} onConfirmed={() => confirm.mutate()} busy={confirm.isPending} confirmLabel="I saved it, continue" />
        <div className="mt-3">
          <ErrorNote error={confirm.error} />
        </div>
      </div>
    );
  }

  const mismatch = mode === 'passphrase' && confirmPassphrase !== '' && passphrase !== confirmPassphrase;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate();
  };
  return (
    <form onSubmit={submit} className={cn(card, 'space-y-5 p-4 sm:p-5')} aria-label="Encryption key">
      <div className="space-y-1">
        <h2 className="text-sm font-medium">Create the encryption master key</h2>
        <p className="text-xs leading-relaxed text-muted-foreground">
          Secret settings (WorkOS keys, tokens) are encrypted with AES-256-GCM under a data key that this master key protects. By default the master
          key is stored in D1 wrapped with a key derived from INITIAL_PASSWORD, so INITIAL_PASSWORD must stay set. Later you can switch to hardened
          mode (ENCRYPTION_KEY secret, no copy in the database) under Operators &amp; security.
        </p>
      </div>
      {step === 'encryption_confirm' && (
        <p className="border border-yellow-500/40 bg-yellow-500/5 px-3 py-2 text-xs text-foreground">
          A key was created but its recovery key was not confirmed as saved. It cannot be shown again; create a new one (nothing has been encrypted yet).
        </p>
      )}
      <fieldset className="space-y-2">
        <legend className="sr-only">Key source</legend>
        {(
          [
            ['generate', 'Generate a random 256-bit key', 'Recommended. You will get a recovery key to store offline.'],
            ['passphrase', 'Derive it from my passphrase', 'PBKDF2-SHA-256, 100,000 iterations. At least 20 characters, mixed classes, or 32+.'],
          ] as const
        ).map(([value, title, hint]) => (
          <label key={value} className={cn('flex cursor-pointer items-start gap-3 border p-3', mode === value ? 'border-primary bg-primary/5' : 'border-border')}>
            <input type="radio" name="mode" value={value} checked={mode === value} onChange={() => setMode(value)} className="mt-1 accent-primary" />
            <span>
              <span className="block text-sm text-foreground">{title}</span>
              <span className="block text-xs text-muted-foreground">{hint}</span>
            </span>
          </label>
        ))}
      </fieldset>
      {mode === 'passphrase' && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor={ppId}>Passphrase</Label>
            <Input id={ppId} type="password" autoComplete="new-password" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor={pp2Id}>Repeat passphrase</Label>
            <Input id={pp2Id} type="password" autoComplete="new-password" value={confirmPassphrase} onChange={(e) => setConfirmPassphrase(e.target.value)} aria-invalid={mismatch} />
          </div>
          {mismatch && <p className="text-xs text-destructive sm:col-span-2">The passphrases do not match.</p>}
        </div>
      )}
      <ErrorNote error={create.error} />
      <Button type="submit" disabled={create.isPending || (mode === 'passphrase' && (!passphrase || passphrase !== confirmPassphrase))}>
        {create.isPending ? 'Creating…' : 'Create master key'}
      </Button>
    </form>
  );
}

function WorkosStep({ redirectUri, emulator, clientId }: { redirectUri: string; emulator: string | null; clientId: string | null }) {
  const queryClient = useQueryClient();
  const [apiKey, setApiKey] = useState('');
  const [client, setClient] = useState(clientId ?? '');
  const keyId = useId();
  const clientInputId = useId();
  const save = useMutation({
    mutationFn: () => operatorApi.saveWorkos(apiKey.trim(), client.trim()),
    onSuccess: () => {
      setApiKey('');
      void queryClient.invalidateQueries({ queryKey: ['operator', 'setup'] });
    },
  });
  return (
    <form
      className={cn(card, 'space-y-5 p-4 sm:p-5')}
      aria-label="WorkOS credentials"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <div className="space-y-1">
        <h2 className="text-sm font-medium">Connect WorkOS AuthKit</h2>
        <p className="text-xs leading-relaxed text-muted-foreground">
          In the WorkOS dashboard: create (or pick) an environment, enable AuthKit with Email + Password and/or Passkeys, add the redirect URI below
          under Redirects, then copy the API key and client ID from API Keys. They are verified with WorkOS before they are stored (encrypted).
        </p>
      </div>
      {emulator && (
        <p className="border border-blue-500/30 bg-blue-500/5 px-3 py-2 text-xs text-foreground">
          Development: this server talks to the local WorkOS emulator at <code className="font-code">{emulator}</code> (started by{' '}
          <code className="font-code">workos dev</code>). Use API key <code className="font-code">sk_test_default</code> and client ID{' '}
          <code className="font-code">client_emulated</code>.
        </p>
      )}
      <div className="space-y-2">
        <Label>Redirect URI</Label>
        <div className="flex items-center gap-2">
          <code className="min-w-0 flex-1 break-all border border-border bg-secondary px-3 py-2 font-code text-xs text-foreground" data-testid="redirect-uri">
            {redirectUri}
          </code>
          <CopyButton value={redirectUri} label="Copy redirect URI" />
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor={keyId}>API key</Label>
          <Input id={keyId} type="password" className="font-code" autoComplete="off" placeholder="sk_…" value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor={clientInputId}>Client ID</Label>
          <Input id={clientInputId} className="font-code" autoComplete="off" placeholder="client_…" value={client} onChange={(e) => setClient(e.target.value)} />
        </div>
      </div>
      <ErrorNote error={save.error} />
      <Button type="submit" disabled={!apiKey || !client || save.isPending}>
        {save.isPending ? 'Verifying with WorkOS…' : 'Verify and save'}
      </Button>
    </form>
  );
}

function IdentityStep({ apiKeyLast4, clientId }: { apiKeyLast4: string | null; clientId: string | null }) {
  const [email, setEmail] = useState('');
  const emailId = useId();
  const start = useMutation({
    mutationFn: () => operatorApi.startIdentity(email.trim() || undefined),
    onSuccess: ({ authorizationUrl }) => browserNav.assign(authorizationUrl),
  });
  return (
    <form
      className={cn(card, 'space-y-5 p-4 sm:p-5')}
      aria-label="Operator account"
      onSubmit={(e) => {
        e.preventDefault();
        start.mutate();
      }}
    >
      <div className="space-y-1">
        <h2 className="text-sm font-medium">Create your operator account</h2>
        <p className="text-xs leading-relaxed text-muted-foreground">
          You will be sent to WorkOS AuthKit to sign up and set your final password and/or passkey. When you come back, that WorkOS user becomes the
          operator and the INITIAL_PASSWORD login is switched off permanently.
        </p>
      </div>
      <p className="text-xs text-muted-foreground">
        WorkOS: client <code className="font-code text-foreground">{clientId}</code>, API key ending <code className="font-code text-foreground">{apiKeyLast4 ?? '••••'}</code>{' '}
        (stored encrypted).
      </p>
      <div className="space-y-2">
        <Label htmlFor={emailId}>Email (optional, pre-fills AuthKit)</Label>
        <Input id={emailId} type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <ErrorNote error={start.error} />
      <Button type="submit" disabled={start.isPending}>
        {start.isPending ? 'Redirecting…' : 'Continue to WorkOS'}
      </Button>
    </form>
  );
}

export function SetupWizard() {
  const setup = useQuery({ queryKey: ['operator', 'setup'], queryFn: operatorApi.setup });
  const queryClient = useQueryClient();
  const logout = useMutation({ mutationFn: operatorApi.logout, onSettled: () => queryClient.invalidateQueries({ queryKey: ['operator'] }) });
  return (
    <AuthShell
      wide
      title="Set up the operator console"
      icon={<Settings2 className="h-5 w-5 text-muted-foreground" />}
      description="This setup-only session can do nothing but these steps and expires after 30 minutes."
    >
      {setup.isPending && <Spinner />}
      <ErrorNote error={setup.error} />
      {setup.data && (
        <>
          <Progress step={setup.data.step} />
          {(setup.data.step === 'encryption' || setup.data.step === 'encryption_confirm') && <EncryptionStep step={setup.data.step} />}
          {setup.data.step === 'workos' && <WorkosStep redirectUri={setup.data.workos.redirectUri} emulator={setup.data.workosEmulator} clientId={setup.data.workos.clientId} />}
          {setup.data.step === 'identity' && <IdentityStep apiKeyLast4={setup.data.workos.apiKeyLast4} clientId={setup.data.workos.clientId} />}
        </>
      )}
      <div className="mt-6">
        <Button variant="ghost" size="sm" onClick={() => logout.mutate()}>
          Sign out of setup
        </Button>
      </div>
    </AuthShell>
  );
}

import { useId, useState, type FormEvent, type ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { KeyRound, LockKeyhole, ShieldAlert, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ThemeToggle } from '@/components/ThemeToggle';
import { browserNav, operatorApi } from './api';
import { ErrorNote } from './ui';

const CALLBACK_ERRORS: Record<string, string> = {
  invalid_state: 'The sign-in link expired or was opened in another browser. Start again.',
  authorization_failed: 'WorkOS did not complete the sign-in. Start again.',
  not_an_operator: 'That account is not on the operator allowlist.',
  setup_expired: 'The setup session expired. Sign in with INITIAL_PASSWORD again.',
  setup_failed: 'Setup could not be completed. Try again.',
  encryption_locked: 'Encrypted settings are locked. Restore access with the recovery key first.',
};

export function AuthShell({ title, description, icon, children, wide }: { title: string; description?: ReactNode; icon?: ReactNode; children: ReactNode; wide?: boolean }) {
  return (
    <div className="min-h-screen bg-background">
      <header className="flex h-14 items-center justify-between border-b border-border px-4 sm:px-6">
        <p className="font-mono text-xs tracking-widest text-muted-foreground">MIDNIGHT INVOICE · OPERATOR</p>
        <ThemeToggle />
      </header>
      <main className={`mx-auto px-4 py-10 sm:py-16 ${wide ? 'max-w-2xl' : 'max-w-md'}`}>
        <div className="mb-6 flex items-start gap-3">
          {icon && (
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-secondary" aria-hidden="true">
              {icon}
            </div>
          )}
          <div className="space-y-1">
            <h1 className="text-xl font-semibold tracking-tight text-foreground">{title}</h1>
            {description && <div className="text-sm text-muted-foreground">{description}</div>}
          </div>
        </div>
        {children}
      </main>
    </div>
  );
}

export function NotConfigured({ error }: { error?: unknown }) {
  return (
    <AuthShell title="Operator console not configured" icon={<ShieldAlert className="h-5 w-5 text-muted-foreground" />}>
      {error ? (
        <ErrorNote error={error} />
      ) : (
        <div className="space-y-3 text-sm text-muted-foreground">
          <p>
            Set the <code className="font-code text-foreground">INITIAL_PASSWORD</code> secret on the Worker (at least 24 characters; a shorter value keeps the console off) to enable the console, then reload this page:
          </p>
          <pre className="overflow-x-auto border border-border bg-secondary p-3 font-code text-xs text-foreground">openssl rand -base64 32 | npx wrangler secret put INITIAL_PASSWORD</pre>
        </div>
      )}
    </AuthShell>
  );
}

export function BootstrapLogin({ callbackError }: { callbackError?: string | null }) {
  const queryClient = useQueryClient();
  const [password, setPassword] = useState('');
  const id = useId();
  const login = useMutation({
    mutationFn: () => operatorApi.bootstrapLogin(password),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['operator'] }),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    login.mutate();
  };
  return (
    <AuthShell
      title="First-run setup"
      icon={<KeyRound className="h-5 w-5 text-muted-foreground" />}
      description="Enter the INITIAL_PASSWORD set at deployment. It only unlocks the setup wizard, and stops working once setup is complete."
    >
      <form onSubmit={submit} className="space-y-4" aria-label="Bootstrap login">
        {callbackError && <ErrorNote error={CALLBACK_ERRORS[callbackError] ?? 'Sign-in failed.'} />}
        <div className="space-y-2">
          <Label htmlFor={id}>Initial password</Label>
          <Input id={id} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required autoFocus />
        </div>
        <ErrorNote error={login.error} />
        <Button type="submit" className="w-full" disabled={!password || login.isPending}>
          {login.isPending ? 'Checking…' : 'Start setup'}
        </Button>
      </form>
    </AuthShell>
  );
}

export function SignIn({ locked, callbackError }: { locked: boolean; callbackError?: string | null }) {
  const queryClient = useQueryClient();
  const start = useMutation({
    mutationFn: operatorApi.startLogin,
    onSuccess: ({ authorizationUrl }) => {
      browserNav.assign(authorizationUrl);
    },
  });
  const [key, setKey] = useState('');
  const keyId = useId();
  const recover = useMutation({
    mutationFn: () => operatorApi.recover(key.trim()),
    onSuccess: () => {
      setKey('');
      void queryClient.invalidateQueries({ queryKey: ['operator'] });
    },
  });

  if (locked) {
    return (
      <AuthShell
        title="Encrypted settings are locked"
        icon={<LockKeyhole className="h-5 w-5 text-destructive" />}
        description={
          <>
            The server cannot unwrap its master key, so secret settings (WorkOS keys, tokens) cannot be read and nobody can sign in. This happens when
            INITIAL_PASSWORD was changed without a re-wrap, or when hardened mode is on and ENCRYPTION_KEY is missing or wrong. Nothing has been
            modified.
          </>
        }
      >
        <form
          className="space-y-4"
          aria-label="Recover encryption"
          onSubmit={(e) => {
            e.preventDefault();
            recover.mutate();
          }}
        >
          <div className="space-y-2">
            <Label htmlFor={keyId}>Recovery key (or the passphrase you chose)</Label>
            <Input id={keyId} type="password" className="font-code" autoComplete="off" spellCheck={false} value={key} onChange={(e) => setKey(e.target.value)} placeholder="mi_mk_…" />
            <p className="text-xs text-muted-foreground">The key is re-wrapped under the current INITIAL_PASSWORD (default mode). Alternatively, restore the previous secret value and reload.</p>
          </div>
          <ErrorNote error={recover.error} />
          <Button type="submit" disabled={!key || recover.isPending}>
            {recover.isPending ? 'Verifying…' : 'Restore access'}
          </Button>
        </form>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Operator sign-in"
      icon={<ShieldCheck className="h-5 w-5 text-primary" />}
      description="Sign in with your operator account (password or passkey) through WorkOS AuthKit."
    >
      <div className="space-y-4">
        {callbackError && <ErrorNote error={CALLBACK_ERRORS[callbackError] ?? 'Sign-in failed.'} />}
        <ErrorNote error={start.error} />
        <Button className="w-full" onClick={() => start.mutate()} disabled={start.isPending}>
          {start.isPending ? 'Redirecting…' : 'Continue with WorkOS'}
        </Button>
      </div>
    </AuthShell>
  );
}

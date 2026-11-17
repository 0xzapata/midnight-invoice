import { useId, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LockKeyhole, ShieldCheck, ShieldHalf } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import type { EncryptionStatusResponse } from '../../../shared/operator';
import { errorMessage, operatorApi } from '../api';
import { Badge, Card, ErrorNote, PageTitle, RecoveryKeyPanel, Table, fmtAgo, fmtDateTime, fmtNumber, td, th } from '../ui';

const KEY = ['operator', 'security'] as const;

function useInvalidate() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: KEY });
}

function Operators({ operators }: { operators: { id: string; email: string; pending: boolean; lastSignInAt: number | null; addedBy: string | null; addedAt: number }[] }) {
  const invalidate = useInvalidate();
  const [email, setEmail] = useState('');
  const id = useId();
  const add = useMutation({
    mutationFn: () => operatorApi.addOperator(email.trim()),
    onSuccess: () => {
      toast.success(`${email.trim()} added to the allowlist`);
      setEmail('');
      void invalidate();
    },
  });
  const remove = useMutation({
    mutationFn: (opId: string) => operatorApi.removeOperator(opId),
    onSuccess: () => {
      toast.success('Operator removed');
      void invalidate();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Card
      title="Operators"
      description="WorkOS users allowed into this console. Add a teammate by email: they become an operator the first time they sign in with that (verified) email through AuthKit. The last operator cannot be removed."
    >
      <Table label="Operators">
        <thead>
          <tr>
            <th className={th}>Email</th>
            <th className={th}>Status</th>
            <th className={th}>Last sign-in</th>
            <th className={th}>Added</th>
            <th className={cn(th, 'text-right')}>
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {operators.map((o) => (
            <tr key={o.id}>
              <td className={cn(td, 'break-all')}>{o.email}</td>
              <td className={td}>{o.pending ? <Badge tone="warn">Invited</Badge> : <Badge tone="good">Active</Badge>}</td>
              <td className={cn(td, 'whitespace-nowrap text-muted-foreground')}>{fmtAgo(o.lastSignInAt)}</td>
              <td className={cn(td, 'whitespace-nowrap text-muted-foreground')}>
                {fmtAgo(o.addedAt)}
                {o.addedBy ? ` by ${o.addedBy}` : ''}
              </td>
              <td className={cn(td, 'text-right')}>
                <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" disabled={operators.length <= 1 || remove.isPending} onClick={() => remove.mutate(o.id)}>
                  Remove
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </Table>
      <form
        className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          add.mutate();
        }}
      >
        <div className="flex-1 space-y-2">
          <Label htmlFor={id}>Add operator by email</Label>
          <Input id={id} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="teammate@example.com" />
        </div>
        <Button type="submit" disabled={!email || add.isPending}>
          Add to allowlist
        </Button>
      </form>
      <div className="mt-2">
        <ErrorNote error={add.error} />
      </div>
    </Card>
  );
}

function Sessions({ sessions }: { sessions: { id: string; email: string | null; kind: string; createdAt: number; lastSeenAt: number; expiresAt: number; ip: string | null; userAgent: string | null; current: boolean }[] }) {
  const invalidate = useInvalidate();
  const queryClient = useQueryClient();
  const revoke = useMutation({
    mutationFn: (sid: string) => operatorApi.revokeSession(sid),
    onSuccess: (_d, sid) => {
      toast.success('Session revoked');
      if (sessions.find((s) => s.id === sid)?.current) void queryClient.invalidateQueries({ queryKey: ['operator'] });
      else void invalidate();
    },
  });
  return (
    <Card title="Active sessions" description="Operator sessions end after the idle or absolute timeout (Settings → Operator console), on sign-out, or when revoked here.">
      <Table label="Active sessions">
        <thead>
          <tr>
            <th className={th}>Operator</th>
            <th className={th}>Client</th>
            <th className={th}>Signed in</th>
            <th className={th}>Last seen</th>
            <th className={th}>Expires</th>
            <th className={cn(th, 'text-right')}>
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {sessions.map((s) => (
            <tr key={s.id}>
              <td className={td}>
                {s.email ?? (s.kind === 'setup' ? 'setup session' : '—')} {s.current && <Badge tone="good">This session</Badge>}
              </td>
              <td className={cn(td, 'max-w-[16rem] truncate text-xs text-muted-foreground')} title={s.userAgent ?? ''}>
                {s.ip ?? 'unknown IP'} · {s.userAgent ?? 'unknown client'}
              </td>
              <td className={cn(td, 'whitespace-nowrap text-muted-foreground')}>{fmtAgo(s.createdAt)}</td>
              <td className={cn(td, 'whitespace-nowrap text-muted-foreground')}>{fmtAgo(s.lastSeenAt)}</td>
              <td className={cn(td, 'whitespace-nowrap text-muted-foreground')}>{fmtDateTime(s.expiresAt)}</td>
              <td className={cn(td, 'text-right')}>
                <Button size="sm" variant="ghost" onClick={() => revoke.mutate(s.id)} disabled={revoke.isPending}>
                  {s.current ? 'Sign out' : 'Revoke'}
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </Table>
    </Card>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right">{children}</dd>
    </>
  );
}

function MasterKeyDialog({ open, onOpenChange, envMode }: { open: boolean; onOpenChange: (o: boolean) => void; envMode: boolean }) {
  const invalidate = useInvalidate();
  const [mode, setMode] = useState<'generate' | 'passphrase'>('generate');
  const [passphrase, setPassphrase] = useState('');
  const [result, setResult] = useState<{ recoveryKey: string; pending?: boolean } | null>(null);
  const id = useId();
  const rotate = useMutation({
    mutationFn: () => operatorApi.rotateMaster(mode === 'generate' ? { mode } : { mode, passphrase }),
    onSuccess: (r) => {
      setResult(r);
      setPassphrase('');
      void invalidate();
    },
  });
  const close = (o: boolean) => {
    if (!o) {
      setResult(null);
      rotate.reset();
    }
    onOpenChange(o);
  };
  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Rotate the master key</DialogTitle>
          <DialogDescription>
            {envMode
              ? 'Hardened mode: the new key is prepared now. Set it as ENCRYPTION_KEY (wrangler secret put ENCRYPTION_KEY); the server switches over on the first request that sees it.'
              : 'The data key is re-sealed under a new master key immediately; the old recovery key stops working.'}
          </DialogDescription>
        </DialogHeader>
        {result ? (
          <div className="space-y-3">
            {result.pending && (
              <pre className="overflow-x-auto border border-border bg-secondary p-2 font-code text-[11px] text-foreground">npx wrangler secret put ENCRYPTION_KEY</pre>
            )}
            <RecoveryKeyPanel recoveryKey={result.recoveryKey} onConfirmed={() => close(false)} confirmLabel="Done" />
          </div>
        ) : (
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              rotate.mutate();
            }}
          >
            <div className="flex gap-4 text-sm">
              <label className="flex items-center gap-2">
                <input type="radio" checked={mode === 'generate'} onChange={() => setMode('generate')} className="accent-primary" /> Generate (recommended)
              </label>
              <label className="flex items-center gap-2">
                <input type="radio" checked={mode === 'passphrase'} onChange={() => setMode('passphrase')} className="accent-primary" /> From passphrase
              </label>
            </div>
            {mode === 'passphrase' && (
              <div className="space-y-2">
                <Label htmlFor={id}>Passphrase</Label>
                <Input id={id} type="password" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} autoComplete="new-password" />
              </div>
            )}
            <ErrorNote error={rotate.error} />
            <Button type="submit" disabled={rotate.isPending || (mode === 'passphrase' && !passphrase)}>
              Rotate master key
            </Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function RewrapDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const invalidate = useInvalidate();
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const idA = useId();
  const idB = useId();
  const run = useMutation({
    mutationFn: () => operatorApi.prepareRewrap(a),
    onSuccess: () => {
      toast.success('Re-wrap prepared', { description: 'Now set the new INITIAL_PASSWORD with wrangler secret put.' });
      setA('');
      setB('');
      void invalidate();
      onOpenChange(false);
    },
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Change INITIAL_PASSWORD safely</DialogTitle>
          <DialogDescription>
            1. Enter the new value here: the master key is sealed under it as a pending copy. 2. Run <code className="font-code">wrangler secret put INITIAL_PASSWORD</code> with
            the same value. 3. The first request that sees the new secret promotes the pending copy. Until then the current secret keeps working.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            run.mutate();
          }}
        >
          <div className="space-y-2">
            <Label htmlFor={idA}>New INITIAL_PASSWORD (24+ characters)</Label>
            <Input id={idA} type="password" value={a} onChange={(e) => setA(e.target.value)} autoComplete="new-password" />
          </div>
          <div className="space-y-2">
            <Label htmlFor={idB}>Repeat</Label>
            <Input id={idB} type="password" value={b} onChange={(e) => setB(e.target.value)} autoComplete="new-password" />
          </div>
          <ErrorNote error={run.error} />
          <Button type="submit" disabled={!a || a !== b || run.isPending}>
            Prepare re-wrap
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Encryption({ enc }: { enc: EncryptionStatusResponse }) {
  const invalidate = useInvalidate();
  const [masterOpen, setMasterOpen] = useState(false);
  const [rewrapOpen, setRewrapOpen] = useState(false);
  const act = (fn: () => Promise<unknown>, ok: string) => ({
    mutationFn: fn,
    onSuccess: () => {
      toast.success(ok);
      void invalidate();
    },
    onError: (e: unknown) => toast.error(errorMessage(e)),
  });
  const rotateDek = useMutation(act(operatorApi.rotateDek, 'Data key rotated; all secrets re-encrypted'));
  const hardenOn = useMutation(act(() => operatorApi.setHardened(true), 'Hardened mode on: D1 no longer holds a wrapped copy of the master key'));
  const hardenOff = useMutation(act(() => operatorApi.setHardened(false), 'Back to default mode (wrapped under INITIAL_PASSWORD)'));
  const cancel = useMutation(act(operatorApi.cancelPending, 'Pending change cancelled'));
  const env = enc.mode === 'env';
  return (
    <Card
      title="Encryption at rest"
      description="Envelope encryption: master key → data key → AES-256-GCM per secret value (random IV, AAD = setting key + version). This protects database exports, backups and casual database access; it does not protect against someone who holds both the database and the Worker’s secrets."
    >
      <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
          <Row label="State">
            {enc.state === 'unlocked' ? <Badge tone="good">Unlocked</Badge> : enc.state === 'locked' ? <Badge tone="bad">Locked · {enc.problem}</Badge> : <Badge>Not set up</Badge>}
          </Row>
          <Row label="Mode">
            {env ? (
              <span className="inline-flex items-center gap-1">
                <ShieldCheck className="h-3.5 w-3.5 text-primary" aria-hidden="true" /> Hardened (ENCRYPTION_KEY)
              </span>
            ) : (
              <span className="inline-flex items-center gap-1">
                <ShieldHalf className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" /> Default (wrapped in D1)
              </span>
            )}
          </Row>
          <Row label="Master key">
            v{enc.masterKeyVersion} · {enc.masterKeySource} · {fmtAgo(enc.masterKeyCreatedAt)}
          </Row>
          <Row label="Data key">
            v{enc.dekVersion} · rotated {fmtAgo(enc.dekRotatedAt)}
          </Row>
          <Row label="Cipher">{enc.cipher}</Row>
          <Row label="KEK derivation">{enc.kdf ? `${enc.kdf.algorithm}, ${fmtNumber(enc.kdf.iterations)} it.` : '— (key from Worker secret)'}</Row>
          <Row label="ENCRYPTION_KEY">{enc.envKeyPresent ? (enc.envKeyMatches ? <Badge tone="good">Set · matches</Badge> : <Badge tone="bad">Set · does not match</Badge>) : <Badge>Not set</Badge>}</Row>
          <Row label="Pending">
            {enc.pendingRewrap ? 'INITIAL_PASSWORD re-wrap' : enc.pendingMasterRotation ? 'master key rotation' : 'nothing'}
          </Row>
        </dl>
        <div className="space-y-4 text-sm">
          {!env && (
            <p className="border border-yellow-500/30 bg-yellow-500/5 p-3 text-xs leading-relaxed text-foreground">
              <LockKeyhole className="mr-1 inline h-3.5 w-3.5" aria-hidden="true" />
              Default mode keeps the master key in D1, wrapped with a key derived from INITIAL_PASSWORD, so INITIAL_PASSWORD must stay set (it no longer
              logs anyone in). For hardened mode set your recovery key as a Worker secret — <code className="font-code">npx wrangler secret put ENCRYPTION_KEY</code> — redeploy, then enable it here.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => rotateDek.mutate()} disabled={enc.state !== 'unlocked' || rotateDek.isPending}>
              Rotate data key
            </Button>
            <Button variant="outline" size="sm" onClick={() => setMasterOpen(true)} disabled={enc.state !== 'unlocked'}>
              Rotate master key
            </Button>
            {!env && (
              <Button variant="outline" size="sm" onClick={() => setRewrapOpen(true)} disabled={enc.state !== 'unlocked'}>
                Change INITIAL_PASSWORD…
              </Button>
            )}
            {!env ? (
              <Button size="sm" onClick={() => hardenOn.mutate()} disabled={!enc.envKeyMatches || hardenOn.isPending} title={enc.envKeyMatches ? undefined : 'Set ENCRYPTION_KEY to your recovery key first'}>
                Enable hardened mode
              </Button>
            ) : (
              <Button variant="outline" size="sm" onClick={() => hardenOff.mutate()} disabled={hardenOff.isPending}>
                Return to default mode
              </Button>
            )}
            {(enc.pendingRewrap || enc.pendingMasterRotation) && (
              <Button variant="ghost" size="sm" onClick={() => cancel.mutate()}>
                Cancel pending change
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Rotating the data key re-encrypts every secret. Rotating the master key shows a new recovery key once. Lost access (changed root secret)? The
            sign-in page offers “restore with recovery key”.
          </p>
        </div>
      </div>
      <MasterKeyDialog open={masterOpen} onOpenChange={setMasterOpen} envMode={env} />
      <RewrapDialog open={rewrapOpen} onOpenChange={setRewrapOpen} />
    </Card>
  );
}

export function SecurityPage() {
  const q = useQuery({ queryKey: KEY, queryFn: operatorApi.security });
  if (q.isPending) return <Spinner />;
  if (q.isError) return <ErrorNote error={q.error} />;
  return (
    <>
      <PageTitle title="Operators & security" description="Who can enter the console, their sessions, and the keys protecting secret settings." />
      <div className="space-y-4">
        <Encryption enc={q.data.encryption} />
        <Operators operators={q.data.operators} />
        <Sessions sessions={q.data.sessions} />
      </div>
    </>
  );
}

import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CloudUpload, Layers, LogOut, UserRound } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { PageHeader } from '@/components/PageHeader';
import { describeError } from '@/lib/api/errors';
import { SIGN_IN_ERRORS, safeReturnTo, type AccountSessionResponse, type SignInError } from '../../../shared/accounts';
import { accountApi, accountErrorMessage, isAccountError } from '../api';
import { SignInButtons } from '../components/AccountSignIn';
import { executePlan, isOwnedElsewhere, localSituation, needsChoice, planConnection, type ConnectOutcome, type ConnectPlan, type LocalCounts } from '../connect';
import { ACCOUNT_SESSION_KEY } from '../hooks';

const card = 'rounded-lg border border-border bg-card p-4 sm:p-6';

const OUTCOME_TOAST: Record<ConnectOutcome, { title: string; description?: string }> = {
  created: { title: 'Signed in, cloud sync is on', description: 'Your invoices are being uploaded to your account.' },
  claimed: {
    title: 'Workspace added to your account',
    description: 'Sign in on other devices to open it. Your recovery key still works; manage it on the Account page.',
  },
  rebound: { title: 'Signed in', description: 'This browser now syncs with its own device key.' },
  joined: { title: 'Signed in', description: 'Your invoices are being downloaded.' },
  merged: { title: 'Signed in', description: 'This browser’s invoices are being added to your account.' },
  switched: { title: 'Switched to your account’s workspace', description: 'This browser’s invoices are being copied into it.' },
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const describeCounts = (c: LocalCounts) => {
  const items = [c.invoices > 0 && plural(c.invoices, 'invoice'), c.clients > 0 && plural(c.clients, 'saved client'), c.templates > 0 && plural(c.templates, 'template')].filter(
    Boolean,
  ) as string[];
  if (items.length === 0) return 'no invoices';
  return items.length === 1 ? items[0] : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
};

/** The question asked for plans that could otherwise lose or mix data (rules in ../connect.ts). */
export function ConnectChoice({
  plan,
  email,
  busy,
  onConfirm,
  onCancel,
}: {
  plan: Extract<ConnectPlan, { kind: 'merge-local' | 'switch-workspace' }>;
  email: string;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const switching = plan.kind === 'switch-workspace';
  return (
    <section className={`${card} space-y-4`} role="alertdialog" aria-labelledby="connect-choice-title" aria-describedby="connect-choice-desc">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary" aria-hidden="true">
          {switching ? <Layers className="h-5 w-5" /> : <CloudUpload className="h-5 w-5" />}
        </div>
        <div className="min-w-0 space-y-2">
          <h2 id="connect-choice-title" className="text-base font-semibold text-foreground">
            {switching ? 'This browser syncs with a different workspace' : 'Add this browser’s invoices to your account?'}
          </h2>
          <div id="connect-choice-desc" className="space-y-2 text-sm text-muted-foreground">
            <p>
              You signed in as <span className="font-medium text-foreground break-all">{email}</span>. This browser has {describeCounts(plan.counts)}{' '}
              {switching ? 'from another cloud workspace' : 'not yet in your account'}.
            </p>
            {switching ? (
              <p>
                {plan.target === 'existing'
                  ? 'Switch this browser to your account’s workspace and copy these invoices into it? '
                  : 'Create a workspace for your account and copy these invoices into it? '}
                The other workspace is not changed or merged on the server and stays reachable with its recovery key.
                Recurring invoices are not copied: schedules set up there stay in that workspace and keep creating invoices
                there until you pause them.
              </p>
            ) : (
              <p>Upload them into your account so they sync with your other devices. Invoices with the same id are merged, nothing is deleted.</p>
            )}
            <p>If you cancel, nothing changes in this browser and you are signed out here.</p>
          </div>
        </div>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <Button onClick={onConfirm} disabled={busy}>
          <CloudUpload className="w-4 h-4" aria-hidden="true" />
          {busy ? 'Working…' : switching ? (plan.target === 'existing' ? 'Switch and copy invoices' : 'Create workspace and copy invoices') : 'Upload and merge'}
        </Button>
        <Button variant="outline" onClick={onCancel} disabled={busy}>
          <LogOut className="w-4 h-4" aria-hidden="true" />
          Cancel and sign out
        </Button>
      </div>
    </section>
  );
}

type View =
  | { kind: 'working' }
  | { kind: 'choice'; plan: Extract<ConnectPlan, { kind: 'merge-local' | 'switch-workspace' }>; session: AccountSessionResponse }
  | { kind: 'error'; message: string; signIn: boolean };

/** `/account/connect`: where the AuthKit callback lands. Connects this browser to the account (rules in ../connect.ts). */
export default function AccountConnect() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const returnTo = safeReturnTo(params.get('return_to') ?? undefined);
  const errorCode = params.get('error');
  const [view, setView] = useState<View>(() =>
    errorCode
      ? { kind: 'error', message: SIGN_IN_ERRORS[errorCode as SignInError] ?? SIGN_IN_ERRORS.authorization_failed, signIn: errorCode !== 'account_disabled' && errorCode !== 'accounts_unavailable' }
      : { kind: 'working' },
  );
  const [busy, setBusy] = useState(false);
  const started = useRef(false);

  const finish = (outcome: ConnectOutcome) => {
    const t = OUTCOME_TOAST[outcome];
    toast.success(t.title, { description: t.description });
    void queryClient.invalidateQueries({ queryKey: ACCOUNT_SESSION_KEY });
    navigate(returnTo, { replace: true });
  };

  const fail = (e: unknown) => {
    const message = isAccountError(e) ? accountErrorMessage(e) : describeError(e);
    setView({ kind: 'error', message, signIn: isAccountError(e, 401) });
  };

  const run = async (session: AccountSessionResponse, plan: ConnectPlan) => {
    try {
      finish(await executePlan(session, plan));
    } catch (e) {
      if (plan.kind === 'claim' && isOwnedElsewhere(e)) {
        setView({ kind: 'choice', session, plan: { kind: 'switch-workspace', target: 'new', counts: localSituation().counts } });
        return;
      }
      fail(e);
    }
  };

  useEffect(() => {
    if (errorCode || started.current) return;
    started.current = true;
    void (async () => {
      let session: AccountSessionResponse;
      try {
        session = await accountApi.session();
      } catch (e) {
        fail(e);
        return;
      }
      queryClient.setQueryData(ACCOUNT_SESSION_KEY, session);
      const plan = planConnection(session, localSituation());
      if (needsChoice(plan)) setView({ kind: 'choice', session, plan: plan as Extract<ConnectPlan, { kind: 'merge-local' | 'switch-workspace' }> });
      else await run(session, plan);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once per landing
  }, []);

  const confirm = async () => {
    if (view.kind !== 'choice') return;
    setBusy(true);
    await run(view.session, view.plan);
    setBusy(false);
  };

  const cancel = async () => {
    setBusy(true);
    try {
      await accountApi.signOut();
    } catch {
      // Already signed out; nothing to undo.
    }
    queryClient.setQueryData(ACCOUNT_SESSION_KEY, null);
    toast('Signed out', { description: 'Nothing was changed in this browser.' });
    navigate(returnTo, { replace: true });
  };

  return (
    <div className="min-h-screen bg-background">
      <PageHeader title="Account" backTo={returnTo} />
      <main className="container py-8">
        <div className="mx-auto max-w-xl space-y-6">
          {view.kind === 'working' && (
            <div className={`${card} flex items-center gap-3`} role="status">
              <Spinner />
              <p className="text-sm text-muted-foreground">Connecting this browser to your account…</p>
            </div>
          )}
          {view.kind === 'choice' && (
            <ConnectChoice plan={view.plan} email={view.session.user.email} busy={busy} onConfirm={() => void confirm()} onCancel={() => void cancel()} />
          )}
          {view.kind === 'error' && (
            <section className={`${card} space-y-4`} role="alert">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-destructive/10 text-destructive" aria-hidden="true">
                  <AlertTriangle className="h-5 w-5" />
                </div>
                <div className="space-y-2">
                  <h2 className="text-base font-semibold text-foreground">Sign-in did not complete</h2>
                  <p className="text-sm text-muted-foreground">{view.message}</p>
                </div>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                {view.signIn && <SignInButtons returnTo={returnTo} />}
                <Button variant="ghost" asChild>
                  <Link to={returnTo}>
                    <UserRound className="w-4 h-4" aria-hidden="true" />
                    Back
                  </Link>
                </Button>
              </div>
            </section>
          )}
        </div>
      </main>
    </div>
  );
}

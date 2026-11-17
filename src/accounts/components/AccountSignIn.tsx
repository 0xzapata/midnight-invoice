import { useState } from 'react';
import { Link, useLocation } from 'react-router';
import { LogIn, LogOut, Unplug, UserPlus, UserRound, X } from 'lucide-react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
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
import { useCloudStore } from '@/stores/useCloudStore';
import { cn } from '@/lib/utils';
import { safeReturnTo } from '../../../shared/accounts';
import { accountErrorMessage, startAccountSignIn } from '../api';
import { signOutThisBrowser } from '../connect';
import { ACCOUNT_SESSION_KEY, useAccountConfig, useAccountSession } from '../hooks';
import { useAccountStore, useLinkedAccount } from '../useAccountStore';

export function SignInButtons({ returnTo, size = 'default' }: { returnTo?: string; size?: 'default' | 'sm' }) {
  const location = useLocation();
  const target = returnTo ?? `${location.pathname}${location.search}`;
  const [pending, setPending] = useState<'sign-in' | 'sign-up' | null>(null);
  const go = async (intent: 'sign-in' | 'sign-up') => {
    setPending(intent);
    try {
      await startAccountSignIn(intent, target);
    } catch (e) {
      toast.error('Could not start sign-in', { description: accountErrorMessage(e) });
      setPending(null);
    }
  };
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
      <Button size={size} onClick={() => void go('sign-in')} disabled={pending !== null}>
        <LogIn className="w-4 h-4" aria-hidden="true" />
        {pending === 'sign-in' ? 'Opening sign-in…' : 'Sign in'}
      </Button>
      <Button size={size} variant="outline" onClick={() => void go('sign-up')} disabled={pending !== null}>
        <UserPlus className="w-4 h-4" aria-hidden="true" />
        {pending === 'sign-up' ? 'Opening…' : 'Create account'}
      </Button>
    </div>
  );
}

/**
 * Sign-in option shown with "Turn on cloud sync" (settings, approve-agent and
 * agents screens) and, for an anonymous workspace, inside the connected panel.
 * Renders nothing when the site has no accounts.
 */
export function AccountSignInOption({ returnTo, className }: { returnTo?: string; className?: string }) {
  const config = useAccountConfig();
  const enabled = config.data?.enabled === true;
  const session = useAccountSession(enabled);
  const cloudOn = useCloudStore((s) => !!s.token);
  const location = useLocation();
  if (!enabled) return null;
  const target = returnTo ?? `${location.pathname}${location.search}`;

  if (session.data) {
    return (
      <div className={cn('space-y-2 border-t border-border pt-4 text-sm', className)}>
        <p className="text-muted-foreground">
          Signed in as <span className="font-medium text-foreground break-all">{session.data.user.email}</span>, but this browser is not connected to
          your account yet.
        </p>
        <Button variant="outline" size="sm" asChild>
          <Link to={`/account/connect?return_to=${encodeURIComponent(safeReturnTo(target))}`}>
            <UserRound className="w-4 h-4" aria-hidden="true" />
            Connect this browser
          </Link>
        </Button>
      </div>
    );
  }

  const required = !cloudOn && config.data?.requiredForNewWorkspaces === true;
  return (
    <div className={cn('space-y-3 border-t border-border pt-4 text-sm', className)}>
      <div className="space-y-1">
        <h4 className="text-sm font-medium text-foreground">
          {cloudOn ? 'Keep this workspace with an account' : required ? 'Sign in to turn on cloud sync' : 'Or use an account'}
        </h4>
        <p className="text-muted-foreground">
          {cloudOn
            ? 'Sign in to attach this workspace to your account, then open it from any browser without a recovery key.'
            : required
              ? 'This site keeps cloud workspaces with an account. Sign in or create one; the invoices in this browser are uploaded to your account.'
              : 'Sign in to turn on cloud sync with an account: open your invoices from any browser by signing in, no recovery key needed.'}
        </p>
      </div>
      <SignInButtons returnTo={target} size="sm" />
    </div>
  );
}

/**
 * Shown instead of the generic "disconnected" banner when a signed-in browser's
 * device key was rejected: signed out from another device or everywhere, or
 * the account was disabled by the site operator. Local data is always kept.
 */
export function AccountSignedOutNotice() {
  const notice = useAccountStore((s) => s.signedOut);
  const dismiss = useAccountStore((s) => s.dismissSignedOut);
  if (!notice) return null;
  const text =
    notice.reason === 'account_disabled'
      ? 'The site operator disabled this account, so this browser stopped syncing. Your invoices are still here.'
      : notice.reason === 'revoked'
        ? 'This browser was signed out from another device (or with “sign out everywhere”). Your invoices are still here; sign in again to keep syncing.'
        : 'This browser was signed out: the server no longer accepts its key. Your invoices are still here; sign in again to keep syncing.';
  return (
    <div role="alert" className="flex gap-3 border border-destructive/30 bg-destructive/10 p-3 text-sm text-foreground">
      <Unplug className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
      <div className="min-w-0 flex-1 space-y-1">
        <p className="font-medium">
          Signed out of <span className="break-all">{notice.email}</span>
        </p>
        <p>{notice.reason === 'checking' ? 'This browser stopped syncing. Your invoices are still here.' : text}</p>
      </div>
      <button type="button" onClick={dismiss} className="h-6 w-6 shrink-0 text-muted-foreground hover:text-foreground" aria-label="Dismiss">
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
}

/** Replaces the recovery-key panel when this browser syncs as a signed-in device. */
export function AccountLinkedPanel() {
  const linked = useLinkedAccount();
  const queryClient = useQueryClient();
  const config = useAccountConfig();
  const [busy, setBusy] = useState(false);
  if (!linked) return null;
  // Accounts turned off by the operator: the device key keeps syncing (nobody is locked out);
  // account management is hidden until accounts return. The browser can still detach itself.
  const accountsOff = config.data !== undefined && !config.data.enabled;
  const signOut = async () => {
    setBusy(true);
    try {
      await signOutThisBrowser();
      void queryClient.invalidateQueries({ queryKey: ACCOUNT_SESSION_KEY });
      toast.success('Signed out of this browser', { description: 'Your invoices are still here. Sign in again to keep syncing.' });
    } catch (e) {
      toast.error('Could not sign out', { description: accountErrorMessage(e) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="rounded-lg border border-border bg-card p-4 sm:p-5 space-y-3">
      <div className="flex items-start gap-3">
        <UserRound className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <div className="min-w-0 space-y-1">
          <h4 className="text-sm font-medium text-foreground">Your account</h4>
          {accountsOff ? (
            <p className="text-sm text-muted-foreground">
              Synced with the account <span className="font-medium text-foreground break-all">{linked.email}</span>. Accounts are turned off on
              this site right now: this browser keeps syncing with its own key, but signing in on other devices and account settings are
              unavailable. If you sign out here you may not be able to reconnect until accounts are back (or with a recovery key).
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              Signed in as <span className="font-medium text-foreground break-all">{linked.email}</span>. To use this workspace on another
              device, sign in there with the same account. This browser has its own key, which you can revoke from any signed-in device.
            </p>
          )}
        </div>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        {!accountsOff && (
          <Button variant="outline" size="sm" asChild>
            <Link to="/account">
              <UserRound className="w-4 h-4" aria-hidden="true" />
              Manage account
            </Link>
          </Button>
        )}
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="outline" size="sm" disabled={busy}>
              <LogOut className="w-4 h-4" aria-hidden="true" />
              {busy ? 'Signing out…' : 'Sign out of this browser'}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Sign out of this browser?</AlertDialogTitle>
              <AlertDialogDescription>
                This browser stops syncing and its key is revoked. Your invoices stay here and in your account; sign in again to continue.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={() => void signOut()}>Sign out</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}

/**
 * Entry of the operator console (lazy-loaded by src/main.tsx for /operator/*
 * only, so regular users never download it). Decides between: not configured,
 * bootstrap login, setup wizard, AuthKit sign-in (+ recovery), dashboard.
 */
import { useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { Toaster as Sonner } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Spinner } from '@/components/ui/spinner';
import { OperatorApiError, operatorApi } from './api';
import { BootstrapLogin, NotConfigured, SignIn } from './Login';
import { SetupWizard } from './SetupWizard';
import { OperatorLayout } from './Layout';
import { OverviewPage } from './pages/Overview';
import { TelemetryPage } from './pages/Telemetry';
import { UsersPage } from './pages/Users';
import { SettingsPage } from './pages/Settings';
import { DeploymentsPage } from './pages/Deployments';
import { AuditPage } from './pages/Audit';
import { SecurityPage } from './pages/Security';

const statusKey = ['operator', 'status'] as const;
const sessionKey = ['operator', 'session'] as const;

function useNoIndex() {
  useEffect(() => {
    const meta = document.createElement('meta');
    meta.name = 'robots';
    meta.content = 'noindex, nofollow';
    document.head.appendChild(meta);
    const prevTitle = document.title;
    document.title = 'Operator console · Midnight Invoice';
    return () => {
      meta.remove();
      document.title = prevTitle;
    };
  }, []);
}

function Gate() {
  const status = useQuery({ queryKey: statusKey, queryFn: operatorApi.status, retry: false });
  const session = useQuery({
    queryKey: sessionKey,
    queryFn: async () => {
      try {
        return await operatorApi.session();
      } catch (error) {
        if (error instanceof OperatorApiError && (error.status === 401 || error.status === 503)) return null;
        throw error;
      }
    },
    retry: false,
    enabled: status.isSuccess,
  });
  const [callbackError] = useState(() => new URLSearchParams(window.location.search).get('error'));
  useEffect(() => {
    if (callbackError) window.history.replaceState(null, '', window.location.pathname);
  }, [callbackError]);

  if (status.isError) {
    const err = status.error;
    if (err instanceof OperatorApiError && err.code === 'operator_not_configured') return <NotConfigured />;
    return <NotConfigured error={err} />;
  }
  if (status.isPending || session.isPending) {
    return (
      <div className="flex min-h-screen items-center justify-center" role="status" aria-label="Loading">
        <Spinner />
      </div>
    );
  }
  const s = session.data;
  if (s?.kind === 'setup') return <SetupWizard />;
  if (!s) {
    return status.data.phase === 'bootstrap' ? (
      <BootstrapLogin callbackError={callbackError} />
    ) : (
      <SignIn locked={status.data.encryptionLocked} callbackError={callbackError} />
    );
  }
  return (
    <Routes>
      <Route path="/operator" element={<OperatorLayout session={s} />}>
        <Route index element={<OverviewPage />} />
        <Route path="telemetry" element={<TelemetryPage />} />
        <Route path="users" element={<UsersPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="deployments" element={<DeploymentsPage />} />
        <Route path="audit" element={<AuditPage />} />
        <Route path="security" element={<SecurityPage />} />
        <Route path="*" element={<Navigate to="/operator" replace />} />
      </Route>
    </Routes>
  );
}

export default function OperatorRoot({ client }: { client?: QueryClient }) {
  useNoIndex();
  const [queryClient] = useState(
    () =>
      client ??
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: (count, error) => !(error instanceof OperatorApiError && error.status > 0 && error.status < 500) && count < 2,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Sonner />
        <BrowserRouter>
          <Gate />
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

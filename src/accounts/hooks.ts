import { useQuery } from '@tanstack/react-query';
import { accountApi, isAccountError } from './api';

export const ACCOUNT_CONFIG_KEY = ['account-config'] as const;
export const ACCOUNT_SESSION_KEY = ['account-session'] as const;

/**
 * Whether the site offers accounts. Only components on the cloud-sync,
 * approve-agent and account screens use it, so a purely local app still
 * makes no API calls. Any failure (old server, maintenance) means "no".
 */
export function useAccountConfig(enabled = true) {
  return useQuery({
    queryKey: ACCOUNT_CONFIG_KEY,
    enabled,
    queryFn: async () => {
      try {
        return await accountApi.config();
      } catch {
        return { enabled: false, requiredForNewWorkspaces: false };
      }
    },
    staleTime: 5 * 60_000,
    retry: false,
  });
}

/** The signed-in account (null = not signed in). */
export function useAccountSession(enabled: boolean) {
  return useQuery({
    queryKey: ACCOUNT_SESSION_KEY,
    enabled,
    queryFn: async () => {
      try {
        return await accountApi.session();
      } catch (e) {
        if (isAccountError(e, 401) || isAccountError(e, 404)) return null;
        throw e;
      }
    },
    retry: false,
  });
}

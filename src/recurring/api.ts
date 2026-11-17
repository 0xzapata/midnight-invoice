/**
 * Recurring schedules in the browser: server state (react-query), not a
 * synced collection. Schedules run on the server, so they need cloud sync;
 * while it is off nothing here makes a request (every query is disabled and
 * the page explains how to turn sync on). Invoices a schedule generates reach
 * this browser through the normal invoice sync.
 */
import { useEffect, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { syncNow, whenIdle } from '@/lib/sync/engine';
import { useCloudEnabled, useCloudStore } from '@/stores/useCloudStore';
import type {
  ListRecurringResponse,
  RecurringInput,
  RecurringPatch,
  RecurringPreviewResponse,
  RecurringResponse,
  RunRecurringNowResponse,
} from '../../shared/api';

const path = (id: string) => `/recurring/${encodeURIComponent(id)}`;

export const recurringApi = {
  list: () => api.request<ListRecurringResponse>('GET', '/recurring'),
  get: (id: string) => api.request<RecurringResponse>('GET', path(id)),
  create: (body: RecurringInput) => api.request<RecurringResponse>('POST', '/recurring', { body }),
  update: (id: string, body: RecurringPatch, revision?: number) =>
    api.request<RecurringResponse>('PATCH', path(id), { body, headers: revision !== undefined ? { 'if-match': `"${revision}"` } : undefined }),
  remove: (id: string) => api.request<void>('DELETE', path(id)),
  pause: (id: string) => api.request<RecurringResponse>('POST', `${path(id)}/pause`),
  resume: (id: string) => api.request<RecurringResponse>('POST', `${path(id)}/resume`),
  runNow: (id: string, period: string) => api.request<RunRecurringNowResponse>('POST', `${path(id)}/run-now`, { body: { period } }),
  preview: (id: string, count = 6) => api.request<RecurringPreviewResponse>('GET', `${path(id)}/preview`, { query: { count } }),
};

export const RECURRING_KEY = ['recurring'] as const;

/** All schedules of the workspace; refetched after each sync cycle (the job may have run meanwhile). */
export function useRecurringList() {
  const enabled = useCloudEnabled();
  const query = useQuery({ queryKey: RECURRING_KEY, queryFn: async () => (await recurringApi.list()).recurring, enabled });
  const queryClient = useQueryClient();
  const lastSyncedAt = useCloudStore((s) => s.lastSyncedAt);
  const seen = useRef(lastSyncedAt);
  useEffect(() => {
    if (seen.current === lastSyncedAt) return;
    seen.current = lastSyncedAt;
    void queryClient.invalidateQueries({ queryKey: RECURRING_KEY, exact: true });
  }, [lastSyncedAt, queryClient]);
  return query;
}

export function useRecurringPreview(id: string | null, count = 6) {
  const enabled = useCloudEnabled() && !!id;
  return useQuery({ queryKey: ['recurring', 'preview', id, count], queryFn: () => recurringApi.preview(id!, count), enabled });
}

/** Mutations refresh the list (and pull the generated invoice into this browser after run-now). */
export function useRecurringMutation<A, R>(fn: (args: A) => Promise<R>, opts: { pullInvoices?: boolean } = {}) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: RECURRING_KEY });
      if (opts.pullInvoices) void syncNow();
    },
  });
}

/**
 * Makes sure local templates/clients this schedule refers to have reached the
 * server (they are created locally first and uploaded by the sync queue).
 */
export async function flushLocalChanges(): Promise<void> {
  if (!useCloudStore.getState().token) return;
  await syncNow({ force: true });
  await whenIdle();
}

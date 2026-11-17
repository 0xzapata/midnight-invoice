import { useEffect, useRef } from 'react';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { ActivityParams } from '@/lib/api/client';
import { useCloudEnabled, useCloudStore } from '@/stores/useCloudStore';

/**
 * Paged activity feed (newest first) for the given filters; disabled while
 * cloud sync is off. Refreshed after each finished sync cycle, so this
 * browser's own uploaded edits show up without reloading.
 */
export function useActivityFeed(params: Omit<ActivityParams, 'before'>, opts: { pageSize?: number } = {}) {
  const enabled = useCloudEnabled();
  const limit = opts.pageSize ?? 50;
  const queryKey = ['activity', { ...params, limit }];
  const query = useInfiniteQuery({
    queryKey,
    queryFn: ({ pageParam }) => api.listActivity({ ...params, limit, before: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next?.before,
    enabled,
  });
  const queryClient = useQueryClient();
  const lastSyncedAt = useCloudStore((s) => s.lastSyncedAt);
  const keyJson = JSON.stringify(queryKey);
  const seenSync = useRef(lastSyncedAt);
  useEffect(() => {
    if (seenSync.current === lastSyncedAt) return;
    seenSync.current = lastSyncedAt;
    void queryClient.invalidateQueries({ queryKey: JSON.parse(keyJson) as unknown[], exact: true });
  }, [lastSyncedAt, keyJson, queryClient]);
  return query;
}

/** The few latest entries by or about one agent (Agents page preview). */
export function useAgentActivityPreview(agentId: string, limit = 3) {
  const enabled = useCloudEnabled();
  return useQuery({
    queryKey: ['activity', 'agent-preview', agentId, limit],
    queryFn: async () => (await api.listAgentActivity(agentId, { limit })).activity,
    enabled,
  });
}

import { useEffect } from 'react';
import { useCloudEnabled, useCloudStore } from '@/stores/useCloudStore';
import { POLL_INTERVAL_MS, startCloudSync, syncNow } from '@/lib/sync/engine';

/**
 * Drives cloud sync for the whole app (renders nothing). Inert until cloud
 * sync is enabled: then it pulls on start, on window focus, when coming back
 * online and every POLL_INTERVAL_MS while the page is visible.
 */
export function CloudSyncRuntime() {
  const enabled = useCloudEnabled();

  useEffect(() => startCloudSync(), []);

  useEffect(() => {
    if (!enabled) return;
    void syncNow({ pullSettings: true });

    const visible = () => document.visibilityState !== 'hidden';
    const onFocus = () => void syncNow({ pullSettings: true });
    const onOnline = () => void syncNow({ force: true });
    const onOffline = () => useCloudStore.getState().setRuntime({ status: 'offline' });
    const onVisibility = () => {
      if (visible()) void syncNow();
    };
    const interval = setInterval(() => {
      if (visible()) void syncNow();
    }, POLL_INTERVAL_MS);

    window.addEventListener('focus', onFocus);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [enabled]);

  return null;
}

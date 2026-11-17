import { toast } from 'sonner';
import { useCloudStore } from '@/stores/useCloudStore';
import { leaveWorkspace } from '@/lib/sync/session';
import { useAccountStore } from '@/accounts/useAccountStore';
import { createApiClient } from './client';

export { ApiError, NetworkError, describeError, formatWait, isApiError, isNetworkError } from './errors';
export { createApiClient, type ApiClient } from './client';

/**
 * The app's API client, authenticated with this browser's workspace token.
 * A 401 means the workspace was deleted (e.g. from another device) or the key
 * is no longer valid: the browser is marked disconnected and keeps its data.
 */
export const api = createApiClient({
  getToken: () => useCloudStore.getState().token,
  onUnauthorized: (rejectedToken) => {
    // Ignore late answers for a key this browser already replaced.
    if (useCloudStore.getState().token !== rejectedToken) return;
    leaveWorkspace('token_rejected');
    // A signed-in device (optional accounts) was signed out: its own notice explains why.
    if (useAccountStore.getState().signedOut) {
      toast.error('Signed out of your account', {
        description: 'This browser stopped syncing. Your invoices are still here; see Settings → Cloud sync & agents.',
      });
      return;
    }
    toast.error('Disconnected from the cloud workspace', {
      description:
        'The server no longer accepts this browser\'s key (the workspace may have been deleted on another device). Your invoices are still here.',
    });
  },
});

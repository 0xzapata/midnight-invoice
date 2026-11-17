import type { ApiErrorCode } from '../../../shared/api';

/**
 * An HTTP error from the API, parsed from `{ error: { code, message, details } }`.
 * Messages come from the server and never contain credentials.
 */
export class ApiError extends Error {
  readonly status: number;
  /** Server error code, or `unknown` when the body was not the API's error shape (e.g. a proxy's 502 page). */
  readonly code: ApiErrorCode | 'unknown';
  readonly details: unknown;
  /** From `Retry-After` (429/503), in milliseconds. */
  readonly retryAfterMs: number | null;

  constructor(status: number, code: ApiErrorCode | 'unknown', message: string, details?: unknown, retryAfterMs: number | null = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.retryAfterMs = retryAfterMs;
  }

  /**
   * The site operator paused this workspace's API access (suspension) or the
   * whole API (maintenance). Sync pauses and retries later; nothing is dropped.
   */
  get pause(): 'suspended' | 'maintenance' | null {
    if (this.status === 403 && this.code === 'workspace_suspended') return 'suspended';
    if (this.status === 503 && this.code === 'maintenance') return 'maintenance';
    return null;
  }

  /** Worth retrying later with the same request (server hiccup, rate limit, write race). */
  get isTransient(): boolean {
    return this.status >= 500 || this.status === 429 || this.status === 408 || (this.status === 409 && this.code === 'conflict');
  }
}

/** The request never got an HTTP response: offline, DNS, connection reset, CORS… */
export class NetworkError extends Error {
  readonly offline: boolean;

  constructor(offline: boolean) {
    super(offline ? 'You are offline' : 'Could not reach the server');
    this.name = 'NetworkError';
    this.offline = offline;
  }
}

export const isApiError = (e: unknown, status?: number): e is ApiError =>
  e instanceof ApiError && (status === undefined || e.status === status);

export const isNetworkError = (e: unknown): e is NetworkError => e instanceof NetworkError;

/** Parses a `Retry-After` header (delta-seconds or HTTP date) into milliseconds. */
export function parseRetryAfter(value: string | null, now = Date.now()): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000;
  const date = Date.parse(trimmed);
  if (Number.isNaN(date)) return null;
  return Math.max(0, date - now);
}

/** Short human-readable wait, e.g. "45 seconds", "3 minutes". */
export function formatWait(ms: number): string {
  const seconds = Math.max(1, Math.ceil(ms / 1000));
  if (seconds < 90) return `${seconds} second${seconds === 1 ? '' : 's'}`;
  const minutes = Math.ceil(seconds / 60);
  return `${minutes} minute${minutes === 1 ? '' : 's'}`;
}

/** A user-facing sentence for any error thrown by the API client. */
export function describeError(error: unknown): string {
  if (error instanceof NetworkError) {
    return error.offline ? 'You are offline. Changes are kept in this browser and sync when you are back online.' : 'Could not reach the server. Check your connection and try again.';
  }
  if (error instanceof ApiError) {
    if (error.status === 429) {
      return error.retryAfterMs !== null ? `Too many requests. Try again in ${formatWait(error.retryAfterMs)}.` : 'Too many requests. Try again in a minute.';
    }
    if (error.status === 401) return 'This browser is no longer connected to the cloud workspace.';
    if (error.pause === 'suspended') {
      return 'Cloud sync is paused: this workspace has been suspended by the site operator. Your invoices are safe in this browser and will sync if it is reinstated.';
    }
    if (error.pause === 'maintenance') {
      return `Cloud sync is paused for maintenance${error.message ? `: ${error.message.replace(/\.?$/, '.')}` : '.'} Changes are kept in this browser and sync automatically afterwards.`;
    }
    if (error.code === 'registration_closed') {
      return 'This site is not accepting new cloud-sync workspaces right now. Your invoices stay in this browser; try again later.';
    }
    if (error.status >= 500) return 'The server had a problem. Try again in a moment.';
    return error.message;
  }
  return 'Something went wrong.';
}

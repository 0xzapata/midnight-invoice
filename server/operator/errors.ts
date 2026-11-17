import type { ApiErrorCode } from '../../shared/api';
import { ApiError } from '../errors';

/**
 * Operator-console errors. They extend ApiError so the app's error handler
 * renders them with the same `{ error: { code, message, details? } }` body;
 * the codes are private to /api/operator and not part of the public contract.
 */
export class OperatorError extends ApiError {
  constructor(status: number, code: string, message: string, details?: unknown, headers?: Record<string, string>) {
    super(status, code as ApiErrorCode, message, details, headers);
    this.name = 'OperatorError';
  }

  static notConfigured() {
    return new OperatorError(503, 'operator_not_configured', 'Operator console not configured: set the INITIAL_PASSWORD secret to enable it.');
  }
  static unauthenticated(message = 'Sign in to the operator console') {
    return new OperatorError(401, 'operator_unauthenticated', message);
  }
  static forbidden(message: string) {
    return new OperatorError(403, 'operator_forbidden', message);
  }
  static csrf() {
    return new OperatorError(403, 'csrf_failed', 'Missing or invalid CSRF token / origin');
  }
  static validation(message: string, details?: unknown) {
    return new OperatorError(400, 'validation_failed', message, details);
  }
  static conflict(code: string, message: string) {
    return new OperatorError(409, code, message);
  }
  static notFound(message = 'Not found') {
    return new OperatorError(404, 'not_found', message);
  }
  static locked(retryAfterSeconds: number) {
    return new OperatorError(429, 'too_many_attempts', 'Too many attempts. Try again later.', { retryAfterSeconds }, {
      'retry-after': String(retryAfterSeconds),
    });
  }
  static upstream(message: string) {
    return new OperatorError(502, 'upstream_error', message);
  }
}

import type { ApiErrorBody, ApiErrorCode } from '../shared/api';

/** An error that maps 1:1 to an HTTP error response `{ error: { code, message, details? } }`. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiErrorCode,
    message: string,
    readonly details?: unknown,
    readonly headers?: Record<string, string>,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  toBody(): ApiErrorBody {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.details === undefined ? {} : { details: this.details }),
      },
    };
  }

  toResponse(): Response {
    return new Response(JSON.stringify(this.toBody()), {
      status: this.status,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...this.headers },
    });
  }
}

export const AUTH_REALM = 'midnight-invoice';

export const errors = {
  badRequest: (message: string, details?: unknown) => new ApiError(400, 'bad_request', message, details),
  invalidJson: () => new ApiError(400, 'invalid_json', 'Request body must be valid JSON'),
  validation: (details: unknown, message = 'Request validation failed') =>
    new ApiError(400, 'validation_failed', message, details),
  invalidScope: (message: string, details?: unknown) => new ApiError(400, 'invalid_scope', message, details),
  unauthorized: (message = 'Missing or invalid bearer token') =>
    new ApiError(401, 'unauthorized', message, undefined, {
      'www-authenticate': `Bearer realm="${AUTH_REALM}", error="invalid_token"`,
    }),
  forbidden: (message: string) => new ApiError(403, 'forbidden', message),
  insufficientScope: (scope: string) =>
    new ApiError(403, 'insufficient_scope', `This credential lacks the "${scope}" scope`, { requiredScope: scope }, {
      'www-authenticate': `Bearer realm="${AUTH_REALM}", error="insufficient_scope", scope="${scope}"`,
    }),
  notFound: (message = 'Not found') => new ApiError(404, 'not_found', message),
  conflict: (message: string, details?: unknown) => new ApiError(409, 'conflict', message, details),
  gone: (message: string, details?: unknown) => new ApiError(410, 'gone', message, details),
  preconditionFailed: (message: string, details?: unknown) => new ApiError(412, 'precondition_failed', message, details),
  payloadTooLarge: (limit: number) =>
    new ApiError(413, 'payload_too_large', `Request body exceeds ${limit} bytes`, { limitBytes: limit }),
  unsupportedMediaType: () => new ApiError(415, 'unsupported_media_type', 'Content-Type must be application/json'),
  methodNotAllowed: (allow: string) =>
    new ApiError(405, 'method_not_allowed', 'Method not allowed', undefined, { allow }),
  rateLimited: (retryAfterSeconds: number) =>
    new ApiError(429, 'rate_limited', 'Too many requests, slow down', { retryAfterSeconds }, {
      'retry-after': String(retryAfterSeconds),
    }),
  internal: () => new ApiError(500, 'internal_error', 'Internal server error'),
};

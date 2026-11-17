/** Injected by vite.config.ts `define` (absent when the Worker is run without Vite). */
declare const __MI_BUILD_INFO__: { sha: string; time: string } | undefined;
/** true only when the Worker runs under the Vite dev server. */
declare const __MI_DEV_SERVER__: boolean | undefined;

/**
 * Secrets and optional bindings that `wrangler types` cannot see in
 * wrangler.jsonc (set with `wrangler secret put`), plus the dev-only var.
 */
interface OperatorEnv {
  INITIAL_PASSWORD?: string;
  ENCRYPTION_KEY?: string;
  RESEND_API_KEY?: string;
  /** Optional fallback for the `email.fromAddress` setting. */
  EMAIL_FROM_ADDRESS?: string;
  /** Dev only (vite dev against a fake Resend server); ignored in production builds. */
  RESEND_API_BASE_URL?: string;
  /** Dev only (vite dev under `workos dev`); ignored in production builds. */
  WORKOS_API_BASE_URL?: string;
  CF_VERSION_METADATA?: { id?: string; tag?: string; timestamp?: string };
}

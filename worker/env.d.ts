/// <reference types="vite/client" />

/** Injected by vite.config.ts `define` (absent when the Worker is run without Vite). */
declare const __MI_BUILD_INFO__: { sha: string; time: string } | undefined;

/**
 * Secrets and optional bindings that `wrangler types` cannot see in
 * wrangler.jsonc (set with `wrangler secret put`), plus the dev-only var.
 */
interface OperatorEnv {
  INITIAL_PASSWORD?: string;
  ENCRYPTION_KEY?: string;
  RESEND_API_KEY?: string;
  /** Dev only (vite dev under `workos dev`); ignored in production builds. */
  WORKOS_API_BASE_URL?: string;
  CF_VERSION_METADATA?: { id?: string; tag?: string; timestamp?: string };
}

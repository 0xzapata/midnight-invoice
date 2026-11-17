/**
 * Cloudflare Worker entry. Static assets (the Vite SPA) are served by the
 * assets layer before this runs; `run_worker_first` in wrangler.jsonc sends
 * every API call and the OAuth discovery documents (/.well-known/oauth-*)
 * here. All logic lives in server/.
 */
import { createApp, type App } from '../server/app';
import { defaultDeps, type AppDeps } from '../server/deps';
import { runScheduledJobs } from '../server/scheduled';

let cached: { env: Env; app: App; deps: AppDeps } | null = null;

/** Operator console inputs from the Worker env (see server/operator, worker/env.d.ts). */
function operatorDeps(env: Env & OperatorEnv): AppDeps['operator'] {
  return {
    initialPassword: env.INITIAL_PASSWORD || undefined,
    encryptionKey: env.ENCRYPTION_KEY || undefined,
    // The WorkOS emulator URL is honoured only under the Vite dev server; every build compiles this to undefined.
    workosBaseUrl: typeof __MI_DEV_SERVER__ !== 'undefined' && __MI_DEV_SERVER__ ? env.WORKOS_API_BASE_URL || undefined : undefined,
    versionMetadata: env.CF_VERSION_METADATA,
    build: typeof __MI_BUILD_INFO__ === 'undefined' ? undefined : __MI_BUILD_INFO__,
    vars: { APP_URL: env.APP_URL, RESEND_API_KEY: env.RESEND_API_KEY, EMAIL_FROM_ADDRESS: env.EMAIL_FROM_ADDRESS },
  };
}

/** Email inputs from the Worker env (configuration itself is in the settings registry). */
function emailDeps(env: Env & OperatorEnv): AppDeps['email'] {
  return {
    // The fake Resend server URL is honoured only under the Vite dev server; every build compiles this to undefined.
    resendBaseUrl: typeof __MI_DEV_SERVER__ !== 'undefined' && __MI_DEV_SERVER__ ? env.RESEND_API_BASE_URL || undefined : undefined,
  };
}

function depsFor(env: Env): AppDeps {
  appFor(env);
  return cached!.deps;
}

function appFor(env: Env): App {
  if (cached?.env !== env) {
    const deps = defaultDeps({
      db: env.DB,
      readAsset: async (path) => {
        // Deployed, the assets binding ignores the host; under `vite dev` it is
        // proxied to the Vite server, which only accepts allowed hosts (localhost).
        const response = await env.ASSETS.fetch(new URL(path, 'http://localhost'));
        if (!response.ok) throw new Error(`Static asset ${path} not found (${response.status})`);
        return response.arrayBuffer();
      },
      rateLimiters: { create: env.RATE_LIMIT_CREATE, poll: env.RATE_LIMIT_POLL },
      config: { appUrl: env.APP_URL || undefined },
      operator: operatorDeps(env),
      email: emailDeps(env),
    });
    cached = { env, deps, app: createApp(deps) };
  }
  return cached.app;
}

export default {
  fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);
    if (pathname === '/api' || pathname.startsWith('/api/') || pathname.startsWith('/.well-known/')) {
      return appFor(env).fetch(request, env, ctx);
    }
    // Only reached if assets routing is misconfigured; defer to the SPA.
    return env.ASSETS.fetch(request);
  },
  // Cron triggers (wrangler.jsonc "triggers") dispatch to the job registry in server/scheduled.ts.
  scheduled(controller, env, ctx) {
    ctx.waitUntil(runScheduledJobs(depsFor(env), { cron: controller.cron, scheduledTime: controller.scheduledTime }));
  },
} satisfies ExportedHandler<Env>;

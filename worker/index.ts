/**
 * Cloudflare Worker entry. Static assets (the Vite SPA) are served by the
 * assets layer before this runs; `run_worker_first` in wrangler.jsonc sends
 * every API call and the OAuth discovery documents (/.well-known/oauth-*)
 * here. All logic lives in server/.
 */
import { createApp, type App } from '../server/app';
import { defaultDeps } from '../server/deps';

let cached: { env: Env; app: App } | null = null;

function appFor(env: Env): App {
  if (cached?.env !== env) {
    cached = {
      env,
      app: createApp(
        defaultDeps({
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
        }),
      ),
    };
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
} satisfies ExportedHandler<Env>;

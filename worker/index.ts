/**
 * Cloudflare Worker entry. Static assets (the Vite SPA) are served by the
 * assets layer before this runs; `run_worker_first: ["/api/*"]` in
 * wrangler.jsonc sends every API call here.
 */
export default {
  fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname === '/api' || pathname.startsWith('/api/')) {
      return Response.json({ error: { code: 'not_found', message: 'No API yet' } }, { status: 404 });
    }
    // Only reached if assets routing is misconfigured; defer to the SPA.
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;

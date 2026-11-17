/**
 * Content-Security-Policy for the static app (security fix L6).
 *
 * The policy lives in `public/_headers` (Cloudflare static-assets headers)
 * with the placeholder `'__INLINE_SCRIPT_HASHES__'` in `script-src`. After
 * the browser build, this plugin computes the SHA-256 of every inline
 * `<script>` in the built `index.html` (the theme bootstrap) and writes the
 * hashes into the emitted `_headers`, so the hash can never drift from the
 * script. `worker/worker.test.ts` checks the built output.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Plugin } from 'vite';

export const INLINE_HASHES_PLACEHOLDER = "'__INLINE_SCRIPT_HASHES__'";

/** CSP source expressions ('sha256-…') for the inline scripts of an HTML document (scripts with a src are skipped). */
export function inlineScriptHashes(html: string): string[] {
  const hashes: string[] = [];
  for (const m of html.matchAll(/<script(\s[^>]*)?>([\s\S]*?)<\/script>/gi)) {
    if (/\ssrc\s*=/i.test(m[1] ?? '')) continue;
    hashes.push(`'sha256-${createHash('sha256').update(m[2], 'utf8').digest('base64')}'`);
  }
  return hashes;
}

/** `_headers` with the placeholder replaced by the hashes of `html`'s inline scripts. */
export function fillCspHashes(headers: string, html: string): string {
  if (!headers.includes(INLINE_HASHES_PLACEHOLDER)) throw new Error(`public/_headers has no ${INLINE_HASHES_PLACEHOLDER} placeholder in script-src`);
  const hashes = inlineScriptHashes(html);
  return headers.split(INLINE_HASHES_PLACEHOLDER).join(hashes.join(' '));
}

export function cspHashes(): Plugin {
  let outDir = '';
  return {
    name: 'midnight-invoice:csp-hashes',
    apply: 'build',
    applyToEnvironment: (env) => env.name === 'client',
    configResolved(config) {
      outDir = path.resolve(config.root, config.environments?.client?.build?.outDir ?? config.build.outDir);
    },
    closeBundle: {
      order: 'post',
      sequential: true,
      handler() {
      const dir = outDir;
      const headersPath = path.join(dir, '_headers');
      const htmlPath = path.join(dir, 'index.html');
      if (!fs.existsSync(headersPath) || !fs.existsSync(htmlPath)) return;
      fs.writeFileSync(headersPath, fillCspHashes(fs.readFileSync(headersPath, 'utf8'), fs.readFileSync(htmlPath, 'utf8')));
      },
    },
  };
}

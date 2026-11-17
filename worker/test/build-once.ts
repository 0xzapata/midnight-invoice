/**
 * Vitest globalSetup for the `workerd` project: builds the production bundle
 * (SPA + Worker) exactly like `bun run build`, so the tests exercise the real
 * deployable output in workerd.
 *
 * Hermetic: the Cloudflare Vite plugin copies a developer's local `.dev.vars`
 * (and `.env*`) next to the built wrangler.json, where the test harness would
 * load them (e.g. APP_URL or INITIAL_PASSWORD). They are removed from the test
 * build so the tests always see the deployment's defaults.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createBuilder } from 'vite';

export const LOCAL_VAR_FILES = /^(\.dev\.vars|\.env)(\..*)?$/;

export default async function setup() {
  const root = path.resolve(import.meta.dirname, '../..');
  const builder = await createBuilder({ root, configFile: path.join(root, 'vite.config.ts'), logLevel: 'error' });
  await builder.buildApp();
  const workerDir = path.join(root, 'dist/midnight_invoice');
  for (const name of fs.readdirSync(workerDir)) {
    if (LOCAL_VAR_FILES.test(name)) fs.rmSync(path.join(workerDir, name), { force: true });
  }
}

/**
 * Vitest globalSetup for the `workerd` project: builds the production bundle
 * (SPA + Worker) exactly like `bun run build`, so the tests exercise the real
 * deployable output in workerd.
 */
import path from 'node:path';
import { createBuilder } from 'vite';

export default async function setup() {
  const root = path.resolve(import.meta.dirname, '../..');
  const builder = await createBuilder({ root, configFile: path.join(root, 'vite.config.ts'), logLevel: 'error' });
  await builder.buildApp();
}

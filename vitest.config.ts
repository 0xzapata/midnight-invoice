import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

const alias = { '@': path.resolve(import.meta.dirname, './src') };

/**
 * Three projects:
 * - web:     React components and stores (jsdom).
 * - server:  the Hono API via `app.request()` in Node, against a real local D1
 *            database run by workerd (wrangler's createTestHarness) with the
 *            migrations applied.
 * - workerd: the production build (`vite build` output) running in workerd,
 *            exercised over HTTP: SPA routing, API, MCP and PDF rendering.
 *
 * @cloudflare/vitest-pool-workers is not used: its latest release (0.23.0)
 * only supports Vitest 4 (peer vitest ^4.1.0) and this repo is on Vitest 5.
 */
export default defineConfig({
    plugins: [react()],
    resolve: { alias },
    test: {
        coverage: {
            reporter: ['text', 'json', 'html'],
            include: ['src/**/*.{ts,tsx}', 'server/**/*.{ts,tsx}', 'shared/**/*.ts'],
            exclude: ['src/test/**', '**/*.test.{ts,tsx}', 'src/vite-env.d.ts', 'server/test/**'],
        },
        projects: [
            {
                extends: true,
                test: {
                    name: 'web',
                    environment: 'jsdom',
                    globals: true,
                    setupFiles: ['./src/test/setup.ts'],
                    include: ['src/**/*.{test,spec}.{js,ts,jsx,tsx}', 'shared/**/*.test.ts'],
                },
            },
            {
                extends: true,
                test: {
                    name: 'server',
                    environment: 'node',
                    include: ['server/**/*.test.{ts,tsx}'],
                    testTimeout: 30_000,
                    hookTimeout: 60_000,
                },
            },
            {
                extends: true,
                test: {
                    name: 'workerd',
                    environment: 'node',
                    include: ['worker/**/*.test.ts'],
                    globalSetup: ['./worker/test/build-once.ts'],
                    testTimeout: 60_000,
                    hookTimeout: 120_000,
                },
            },
        ],
    },
});

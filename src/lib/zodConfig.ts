/**
 * Zod without its JIT (security fix L6): zod probes `new Function('')` to decide whether it may
 * compile parsers, which the Content-Security-Policy (no 'unsafe-eval', public/_headers) reports as a
 * violation on every page. Imported first by main.tsx, before any schema is used.
 */
import { z } from 'zod';

z.config({ jitless: true });

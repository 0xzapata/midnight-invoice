/**
 * Vite plugins that make @react-pdf/renderer run inside the Workers runtime.
 * They apply to the Worker (server-consumer) environment only; the browser
 * build is untouched.
 *
 * 1. Worker resolution: see workerEnvironment() below.
 *
 * 2. yoga-layout (layout engine):
 * yoga-layout ships its WebAssembly as an inlined base64 string and compiles it
 * at runtime with `WebAssembly.instantiate(bytes)`. workerd forbids runtime
 * code generation ("Wasm code generation disallowed by embedder"); Workers may
 * only instantiate modules that were uploaded with the script.
 *
 * For the Worker environment only, this plugin:
 *  1. extracts the exact wasm binary from the installed yoga-layout package
 *     into node_modules/.cache (so it always matches the installed version);
 *  2. replaces `yoga-layout/load` with a tiny module that imports that file
 *     as a precompiled `WebAssembly.Module` (the Cloudflare Vite plugin uploads
 *     `.wasm` imports as CompiledWasm modules) and hands it to Emscripten via
 *     its `instantiateWasm` hook.
 *
 * 3. pdfkit (PDF writer) computes `new URL('./data/…icc', import.meta.url)` at
 *    module load. In a bundled Worker `import.meta.url` is not a valid base
 *    URL, so module evaluation throws "Invalid URL string". The path is only
 *    used as a key into pdfkit's in-memory virtual file system, so we replace
 *    `import.meta.url` inside pdfkit with a constant file URL.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import type { Plugin } from 'vite';

const VIRTUAL_ID = '\0midnight:yoga-layout-workerd';

function locateYoga(root: string) {
  const require = createRequire(path.join(root, 'package.json'));
  // `yoga-layout/load` resolves to <pkg>/dist/src/load.js
  const loadPath = require.resolve('yoga-layout/load');
  const pkgDir = path.resolve(path.dirname(loadPath), '..', '..');
  const pkg = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8')) as { version: string };
  return { pkgDir, version: pkg.version };
}

export function extractYogaWasm(root: string): { wasmPath: string; pkgDir: string } {
  const { pkgDir, version } = locateYoga(root);
  const outDir = path.join(root, 'node_modules', '.cache', 'yoga-workerd');
  const wasmPath = path.join(outDir, `yoga-${version}.wasm`);
  if (!fs.existsSync(wasmPath)) {
    const source = fs.readFileSync(path.join(pkgDir, 'dist', 'binaries', 'yoga-wasm-base64-esm.js'), 'utf8');
    const matches = [...source.matchAll(/data:application\/octet-stream;base64,([A-Za-z0-9+/=]+)/g)];
    if (matches.length !== 1) {
      throw new Error(`yoga-workerd: expected exactly one inlined wasm binary in yoga-layout ${version}, found ${matches.length}`);
    }
    const bytes = Buffer.from(matches[0][1], 'base64');
    if (bytes.subarray(0, 4).toString('hex') !== '0061736d') {
      throw new Error('yoga-workerd: extracted payload is not a WebAssembly binary');
    }
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(wasmPath, bytes);
  }
  return { wasmPath, pkgDir };
}

const isServerEnv = (environment: { config: { consumer: string } }) => environment.config.consumer === 'server';

export function reactPdfWorkerd(): Plugin[] {
  return [workerEnvironment(), yogaWorkerd(), pdfkitImportMetaUrl()];
}

/**
 * Resolution settings for the Worker environment (every environment except
 * the browser `client`):
 * - `mainFields` starts with `browser`, like wrangler's own Worker bundling.
 *   react-pdf packages (@react-pdf/renderer, /font, /image) pick their
 *   browser build only via the legacy package.json `browser` field. Without
 *   it they load their Node builds, which mismatch the browser builds of
 *   pdfkit/fontkit selected through `exports` conditions (e.g. @react-pdf/font's
 *   Node build expects pdfkit to read standard fonts from `fs`).
 * - `yoga-layout` is excluded from dev pre-bundling so `bun run dev` also goes
 *   through the yoga shim below (pre-bundled deps bypass plugin resolveId).
 */
function workerEnvironment(): Plugin {
  return {
    name: 'midnight:react-pdf-worker-environment',
    configEnvironment(name) {
      if (name === 'client') return;
      return {
        resolve: { mainFields: ['browser', 'module', 'main'] },
        optimizeDeps: { exclude: ['yoga-layout'] },
      };
    },
  };
}

function pdfkitImportMetaUrl(): Plugin {
  return {
    name: 'midnight:pdfkit-import-meta-url',
    enforce: 'pre',
    applyToEnvironment: isServerEnv,
    transform(code, id) {
      if (!/[\\/]node_modules[\\/]pdfkit[\\/]/.test(id) || !code.includes('import.meta.url')) return null;
      return { code: code.replaceAll('import.meta.url', JSON.stringify('file:///node_modules/pdfkit/js/pdfkit.js')), map: null };
    },
  };
}

function yogaWorkerd(): Plugin {
  let code = '';
  return {
    name: 'midnight:yoga-workerd',
    enforce: 'pre',
    applyToEnvironment: isServerEnv,
    configResolved(config) {
      const { wasmPath, pkgDir } = extractYogaWasm(config.root);
      const file = (p: string) => JSON.stringify(path.join(pkgDir, 'dist', p).split(path.sep).join('/'));
      code = [
        `import loadYogaImpl from ${file('binaries/yoga-wasm-base64-esm.js')};`,
        `import wrapAssembly from ${file('src/wrapAssembly.js')};`,
        `import yogaModule from ${JSON.stringify(wasmPath.split(path.sep).join('/'))};`,
        `export * from ${file('src/generated/YGEnums.js')};`,
        `export async function loadYoga() {`,
        `  return wrapAssembly(await loadYogaImpl({`,
        `    instantiateWasm(imports, done) {`,
        `      const instance = new WebAssembly.Instance(yogaModule, imports);`,
        `      done(instance, yogaModule);`,
        `      return instance.exports;`,
        `    },`,
        `  }));`,
        `}`,
      ].join('\n');
    },
    resolveId(id) {
      if (id === 'yoga-layout/load') return VIRTUAL_ID;
      return null;
    },
    load(id) {
      if (id === VIRTUAL_ID) return code;
      return null;
    },
  };
}

/**
 * Hakobu ESM Loader Hooks — hook code generator
 *
 * Generates the self-contained JavaScript code that runs inside Node's
 * loader thread via module.register(). The code is passed as a data: URL
 * because the loader thread cannot import from the main thread's modules.
 *
 * The hook code receives snapshot data via initialize() and serves
 * resolve/load for snapshot-owned modules.
 */

/**
 * Returns the self-contained ESM hook source code as a string.
 * This code will be registered via module.register('data:text/javascript,...')
 */
export function getHookSource(): string {
  return HOOK_SOURCE;
}

/**
 * Prepare the transfer data for the loader hooks.
 * This is passed via module.register(url, { data: ... }).
 */
export interface HookTransferData {
  /** Snapshot entries: path → { offset, size, format } */
  entries: Record<string, { offset: number; size: number; format: string | null }>;
  /** Package boundaries: path → { type, exports, imports, main, directory } */
  packages: Record<string, { type: string | null; main: string | null; directory: string }>;
  /** The blob content as ArrayBuffer */
  blob: ArrayBuffer;
  /** Application ID */
  appId: string;
  /** All directory paths (for existence checks) */
  directories: string[];
}

// The actual hook source code. This is a self-contained ES module
// that runs in Node's loader worker thread.
const HOOK_SOURCE = `
// ── Snapshot data (populated by initialize) ──
let entries;     // Map<path, {offset, size, format}>
let packages;    // Map<path, {type, main, directory}>
let blob;        // Uint8Array
let appId;
let dirSet;      // Set<path> for directory existence

const BUILTINS = new Set([
  'assert','assert/strict','async_hooks','buffer','child_process',
  'cluster','console','constants','crypto','dgram',
  'diagnostics_channel','dns','dns/promises','domain','events',
  'fs','fs/promises','http','http2','https','inspector',
  'inspector/promises','module','net','os','path','path/posix',
  'path/win32','perf_hooks','process','punycode','querystring',
  'readline','readline/promises','repl','stream','stream/consumers',
  'stream/promises','stream/web','string_decoder','sys','test',
  'timers','timers/promises','tls','trace_events','tty','url',
  'util','util/types','v8','vm','wasi','worker_threads','zlib',
  'sqlite',
]);

function isBuiltin(s) {
  if (s.startsWith('node:')) return true;
  return BUILTINS.has(s);
}

function isSnapshotUrl(url) {
  return url.startsWith('file:///snapshot/');
}

function urlToPath(url) {
  if (!url.startsWith('file:///snapshot/')) return null;
  return '/snapshot/' + url.slice('file:///snapshot/'.length);
}

function pathToUrl(p) {
  return 'file://' + p;
}

function canonicalize(p) {
  const parts = p.split('/');
  const result = [];
  for (const part of parts) {
    if (part === '' || part === '.') continue;
    if (part === '..') { result.pop(); continue; }
    result.push(part);
  }
  return '/' + result.join('/');
}

function extname(p) {
  const dot = p.lastIndexOf('.');
  const slash = p.lastIndexOf('/');
  if (dot <= slash) return '';
  return p.slice(dot);
}

function dirname(p) {
  return p.substring(0, p.lastIndexOf('/')) || '/';
}

const RESOLVE_EXTS = ['.js','.mjs','.cjs','.json','.node'];

function exists(p) {
  return entries.has(p) || dirSet.has(p);
}

function isFile(p) {
  return entries.has(p);
}

function isDir(p) {
  return dirSet.has(p);
}

function tryFile(p) {
  if (isFile(p)) return p;
  for (const ext of RESOLVE_EXTS) {
    if (isFile(p + ext)) return p + ext;
  }
  if (isDir(p)) {
    const pjPath = p + '/package.json';
    if (isFile(pjPath) && packages.has(pjPath)) {
      const pkg = packages.get(pjPath);
      if (pkg.main) {
        const mainPath = canonicalize(p + '/' + pkg.main);
        const resolved = tryFile(mainPath);
        if (resolved) return resolved;
      }
    }
    for (const ext of RESOLVE_EXTS) {
      if (isFile(p + '/index' + ext)) return p + '/index' + ext;
    }
  }
  return null;
}

function getFormat(p) {
  const ext = extname(p);
  if (ext === '.mjs') return 'module';
  if (ext === '.cjs') return 'commonjs';
  if (ext === '.json') return 'json';
  if (ext === '.wasm') return 'wasm';
  const entry = entries.get(p);
  if (entry?.format === 'esm') return 'module';
  if (entry?.format === 'cjs') return 'commonjs';
  return 'commonjs';
}

function findPackageDir(filePath) {
  let dir = dirname(filePath);
  const root = '/snapshot/' + appId;
  while (dir.startsWith(root)) {
    const pj = dir + '/package.json';
    if (packages.has(pj)) return packages.get(pj);
    dir = dirname(dir);
  }
  return null;
}

export function initialize(data) {
  entries = new Map(Object.entries(data.entries));
  packages = new Map(Object.entries(data.packages));
  blob = new Uint8Array(data.blob);
  appId = data.appId;
  dirSet = new Set(data.directories);
}

export function resolve(specifier, context, nextResolve) {
  if (isBuiltin(specifier)) {
    return nextResolve(specifier, context);
  }

  const parentUrl = context.parentURL;

  // Only handle snapshot-parented resolution
  if (!parentUrl || !isSnapshotUrl(parentUrl)) {
    // Entry point or non-snapshot parent
    if (specifier.startsWith('file:///snapshot/')) {
      const snapPath = urlToPath(specifier);
      if (snapPath && isFile(snapPath)) {
        return { url: specifier, shortCircuit: true, format: getFormat(snapPath) };
      }
    }
    return nextResolve(specifier, context);
  }

  const parentPath = urlToPath(parentUrl);
  if (!parentPath) return nextResolve(specifier, context);

  // Relative specifier
  if (specifier.startsWith('.') || specifier.startsWith('/')) {
    const parentDir = dirname(parentPath);
    const target = canonicalize(parentDir + '/' + specifier);
    if (!target.startsWith('/snapshot/')) return nextResolve(specifier, context);
    const resolved = tryFile(target);
    if (resolved) {
      return { url: pathToUrl(resolved), shortCircuit: true, format: getFormat(resolved) };
    }
    throw new Error(
      'Cannot find module \\'' + specifier + '\\' imported from ' + parentUrl
    );
  }

  // Bare specifier — walk node_modules
  const pkgName = specifier.startsWith('@')
    ? specifier.split('/').slice(0, 2).join('/')
    : specifier.split('/')[0];
  const subpath = specifier.slice(pkgName.length) || '.';

  let searchDir = dirname(parentPath);
  const snapRoot = '/snapshot/' + appId;

  while (searchDir.startsWith(snapRoot)) {
    const nmDir = searchDir + '/node_modules/' + pkgName;
    if (isDir(nmDir)) {
      if (subpath === '.') {
        const pkgPj = packages.get(nmDir + '/package.json');
        if (pkgPj?.main) {
          const resolved = tryFile(canonicalize(nmDir + '/' + pkgPj.main));
          if (resolved) {
            return { url: pathToUrl(resolved), shortCircuit: true, format: getFormat(resolved) };
          }
        }
        const resolved = tryFile(nmDir + '/index');
        if (resolved) {
          return { url: pathToUrl(resolved), shortCircuit: true, format: getFormat(resolved) };
        }
      } else {
        const resolved = tryFile(canonicalize(nmDir + '/' + subpath));
        if (resolved) {
          return { url: pathToUrl(resolved), shortCircuit: true, format: getFormat(resolved) };
        }
      }
      // Package found but couldn't resolve entry
      return nextResolve(specifier, context);
    }
    searchDir = dirname(searchDir);
  }

  // Not in snapshot — let Node handle it
  return nextResolve(specifier, context);
}

export function load(url, context, nextLoad) {
  if (!isSnapshotUrl(url)) {
    return nextLoad(url, context);
  }

  const snapPath = urlToPath(url);
  if (!snapPath) return nextLoad(url, context);

  const entry = entries.get(snapPath);
  if (!entry) return nextLoad(url, context);

  const sourceBytes = blob.slice(entry.offset, entry.offset + entry.size);
  const source = new TextDecoder().decode(sourceBytes);
  const format = getFormat(snapPath);

  return { source, format, shortCircuit: true };
}
`;

/**
 * Hakobu Bundle Mode
 *
 * Optional pre-processing step that bundles a project before packaging.
 * This is useful for:
 *   - TypeScript projects (compiled to JS)
 *   - Workspace monorepos (resolved to a single bundle)
 *   - Projects with complex dependency graphs (tree-shaken)
 *
 * Bundle mode is NOT the default. Native mode (direct packaging of JS files)
 * remains the primary path. Bundle mode is an opt-in adapter that produces
 * a self-contained JS project that the existing packaging pipeline can consume.
 *
 * Architecture:
 *   1. BundleAdapter receives project root + entry + options
 *   2. Adapter produces a bundled project in a temp directory
 *   3. Packager runs on the temp directory as if it were a normal JS project
 *   4. Temp directory is cleaned up after packaging
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { parse } from '@babel/parser';
import traverse from '@babel/traverse';
import { log } from './log';

// ─────────────────────────────────────────────────────────────────────
// Bundle adapter interface
// ─────────────────────────────────────────────────────────────────────

export interface BundleInput {
  /** Absolute path to the project root. */
  projectRoot: string;

  /** Entry file (relative to project root or absolute). */
  entry: string;

  /** Module names or patterns to keep external (not bundled). */
  external?: string[];

  /** The app name (used for naming the bundle output). */
  appName: string;
}

export interface BundleOutput {
  /** Absolute path to the bundled project directory. */
  projectRoot: string;

  /** Entry file path relative to the bundled project root. */
  entry: string;

  /** Warnings generated during bundling. */
  warnings: BundleWarning[];

  /** How the final bundle was emitted. */
  strategy: 'single-chunk' | 'code-split';

  /** Number of emitted JavaScript chunks. */
  chunkCount: number;

  /** Why bundle mode fell back to single-chunk, if it did. */
  fallbackReason?: string;

  /** Source map files emitted alongside the bundle (relative to projectRoot). */
  mapFiles: string[];

  /** Cleanup function to remove temp directory. */
  cleanup: () => void;
}

export interface BundleWarning {
  message: string;
  file?: string;
}

export interface BundleAdapter {
  /** Human-readable name of the bundler. */
  readonly name: string;

  /** Bundle the project. */
  bundle(input: BundleInput): Promise<BundleOutput>;
}

// ─────────────────────────────────────────────────────────────────────
// Rolldown adapter
// ─────────────────────────────────────────────────────────────────────

export class RolldownAdapter implements BundleAdapter {
  readonly name = 'rolldown';

  async bundle(input: BundleInput): Promise<BundleOutput> {
    // Dynamic import — rolldown is ESM-only and optional
    let rolldown: any;
    try {
      rolldown = await loadRolldown();
    } catch {
      throw new Error(
        'Rolldown is required for bundle mode but could not be loaded.\n' +
        'Install it with: pnpm add rolldown'
      );
    }

    const { projectRoot, entry, external = [], appName } = input;
    const entryPath = path.isAbsolute(entry)
      ? entry
      : path.resolve(projectRoot, entry);

    if (!fs.existsSync(entryPath)) {
      throw new Error(`Bundle entry not found: ${entryPath}`);
    }

    // Create temp output directory
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hakobu-bundle-'));
    const outFile = 'index.js';
    const warnings: BundleWarning[] = [];

    try {
      log.info(`  bundler: rolldown`);
      log.info(`  entry: ${path.relative(projectRoot, entryPath)}`);

      // Default externals: node builtins + runtime-specific protocols + user-specified
      const allExternal = [
        /^node:/,
        /^bun:/,
        /^electron$/,
        /^chromium-bidi/,
        ...external.map(e => {
          if (e.includes('*')) {
            return new RegExp('^' + e.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\*/g, '.*') + '$');
          }
          return e;
        }),
      ];

      const build = await rolldown.rolldown({
        input: entryPath,
        platform: 'node',
        resolve: {
          conditionNames: ['node', 'import', 'require', 'default'],
          mainFields: ['module', 'main'],
        },
        external: allExternal,
        onwarn: (warning: any) => {
          warnings.push({
            message: warning.message || String(warning),
            file: warning.loc?.file,
          });
        },
      });

      const writeResult = await writeBundleOutput(build, tmpDir, outFile);

      // Post-bundle: apply compatibility patches for bundler-hostile packages
      for (const file of writeResult.jsFiles) {
        applyBundlePatches(file);
      }

      // Create a minimal package.json for the bundled output
      const bundledPkg = {
        name: appName,
        version: '0.0.0',
        type: 'module',
        main: outFile,
      };
      fs.writeFileSync(
        path.join(tmpDir, 'package.json'),
        JSON.stringify(bundledPkg, null, 2),
      );

      const outSize = writeResult.jsFiles.reduce(
        (sum, file) => sum + fs.statSync(file).size,
        0,
      );
      log.info(
        `  output: ${(outSize / 1024).toFixed(0)}KB bundled ` +
        `(${writeResult.strategy}, ${writeResult.chunkCount} chunk${writeResult.chunkCount === 1 ? '' : 's'})`,
      );
      if (writeResult.fallbackReason) {
        log.info(`  fallback: ${writeResult.fallbackReason}`);
      }

      if (warnings.length > 0) {
        log.warn(`  ${warnings.length} bundler warning(s)`);
      }

      // Collect map file paths relative to tmpDir for asset inclusion
      const relativeMapFiles = writeResult.mapFiles.map(f => path.relative(tmpDir, f));

      return {
        projectRoot: tmpDir,
        entry: outFile,
        warnings,
        strategy: writeResult.strategy,
        chunkCount: writeResult.chunkCount,
        fallbackReason: writeResult.fallbackReason,
        mapFiles: relativeMapFiles,
        cleanup: () => {
          try {
            fs.rmSync(tmpDir, { recursive: true, force: true });
          } catch { /* best effort */ }
        },
      };
    } catch (err: any) {
      // Clean up on failure
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
      throw new Error(`Rolldown bundle failed: ${err.message}`);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────
// Bundle writing + fallback detection
// ─────────────────────────────────────────────────────────────────────

interface WrittenBundle {
  strategy: 'single-chunk' | 'code-split';
  chunkCount: number;
  fallbackReason?: string;
  jsFiles: string[];
  mapFiles: string[];
}

const MULTI_CHUNK_BANNER = [
  `import{fileURLToPath as _hk_f}from'node:url';`,
  `import{dirname as _hk_d}from'node:path';`,
].join('');

const SINGLE_CHUNK_BANNER = [
  MULTI_CHUNK_BANNER,
  `var __filename=_hk_f(import.meta.url),__dirname=_hk_d(__filename);`,
].join('');

async function writeBundleOutput(
  build: any,
  tmpDir: string,
  outFile: string,
): Promise<WrittenBundle> {
  const splitResult = await writeBundle(build, tmpDir, outFile, true);
  const unsafeReason = detectSingleChunkFallback(splitResult.jsFiles);
  if (unsafeReason) {
    resetBundleDir(tmpDir);
    const singleResult = await writeBundle(build, tmpDir, outFile, false);
    return {
      strategy: 'single-chunk',
      chunkCount: singleResult.jsFiles.length,
      fallbackReason: unsafeReason,
      jsFiles: singleResult.jsFiles,
      mapFiles: singleResult.mapFiles,
    };
  }

  return {
    strategy: splitResult.jsFiles.length > 1 ? 'code-split' : 'single-chunk',
    chunkCount: splitResult.jsFiles.length,
    jsFiles: splitResult.jsFiles,
    mapFiles: splitResult.mapFiles,
  };
}

async function writeBundle(
  build: any,
  tmpDir: string,
  outFile: string,
  codeSplitting: boolean,
): Promise<{ jsFiles: string[]; mapFiles: string[] }> {
  await build.write({
    dir: tmpDir,
    format: 'esm',
    entryFileNames: outFile,
    chunkFileNames: 'chunks/[name]-[hash].js',
    sourcemap: true,
    codeSplitting,
    banner: codeSplitting ? MULTI_CHUNK_BANNER : SINGLE_CHUNK_BANNER,
  });

  return listBundleFiles(tmpDir);
}

function listBundleFiles(rootDir: string): { jsFiles: string[]; mapFiles: string[] } {
  const jsFiles: string[] = [];
  const mapFiles: string[] = [];

  function walk(dir: string): void {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile()) {
        if (/\.(?:m?js|cjs)$/.test(entry.name)) {
          jsFiles.push(fullPath);
        } else if (entry.name.endsWith('.map')) {
          mapFiles.push(fullPath);
        }
      }
    }
  }

  walk(rootDir);
  jsFiles.sort();
  mapFiles.sort();
  return { jsFiles, mapFiles };
}

function resetBundleDir(tmpDir: string): void {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.mkdirSync(tmpDir, { recursive: true });
}

function detectSingleChunkFallback(jsFiles: string[]): string | null {
  for (const file of jsFiles) {
    const globals = findUnsafeNodePathGlobals(file);
    if (globals.length > 0) {
      return `${path.relative(path.dirname(file), file)} requires ${globals.join('/')} globals`;
    }
  }
  return null;
}

function findUnsafeNodePathGlobals(filePath: string): string[] {
  const code = fs.readFileSync(filePath, 'utf8');
  const ast = parse(code, {
    sourceType: 'module',
    plugins: ['importMeta', 'topLevelAwait'],
  });
  const found = new Set<string>();

  traverse(ast as any, {
    Identifier(p: any) {
      const name = p.node.name;
      if (name !== '__dirname' && name !== '__filename') return;
      if (!p.isReferencedIdentifier()) return;
      if (p.scope.hasBinding(name)) return;
      found.add(name);
    },
  });

  return Array.from(found);
}

// ─────────────────────────────────────────────────────────────────────
// Bundle compatibility patches
// ─────────────────────────────────────────────────────────────────────

/**
 * A single post-bundle text replacement rule.
 *
 * Each rule has a name (for diagnostics), a regex pattern to match in the
 * bundled output, and a replacement string. Rules are applied in order —
 * more specific patterns should come before generic ones.
 */
interface BundlePatchRule {
  /** Human-readable name for log output. */
  name: string;
  /** Package or pattern class this rule addresses. */
  scope: string;
  /** Regex to match in the bundled JS output. */
  pattern: RegExp;
  /** Replacement string (supports $1, $2, etc.). */
  replacement: string;
}

/**
 * Registry of known bundler-hostile patterns and their fixes.
 *
 * These packages use runtime introspection patterns (require.resolve to
 * their own package.json, dirname-based path discovery, etc.) that produce
 * build-time absolute paths after bundling. The paths don't exist at runtime
 * in a packaged executable, so we replace them with safe stubs.
 *
 * Order matters: dirname(resolve(...)) rules must come before resolve(...)
 * rules, because the latter is a substring of the former.
 *
 * To add a new package: append rules to the array below. Each rule is
 * independent and self-documenting.
 */
const BUNDLE_PATCH_RULES: BundlePatchRule[] = [
  // ── playwright-core ──
  // Playwright resolves its own package.json at runtime to find its
  // installation directory. After bundling, these become absolute build-time
  // paths that don't exist in the packaged snapshot.
  {
    name: 'dirname(resolve(playwright/package.json))',
    scope: 'playwright-core',
    pattern: /(?:dirname|_hk_d)\(\s*(?:__require\.resolve|require\.resolve)\(\s*"[^"]*playwright[^"]*package\.json"\s*\)\s*\)/g,
    replacement: 'process.cwd()',
  },
  {
    name: 'resolve(playwright/package.json)',
    scope: 'playwright-core',
    pattern: /(?:__require\.resolve|require\.resolve)\(\s*"[^"]*playwright[^"]*package\.json"\s*\)/g,
    replacement: '"playwright-core-stub"',
  },
  {
    name: 'require(playwright/package.json)',
    scope: 'playwright-core',
    pattern: /(?:__require|require)\(\s*"[^"]*playwright[^"]*package\.json"\s*\)/g,
    replacement: '({name:"playwright-core",version:"0.0.0"})',
  },

  // ── Generic: relative package.json traversals ──
  // Many packages use dirname(require.resolve('../../package.json')) to find
  // their own root. After bundling, relative paths resolve to the bundler's
  // working directory at build time, not the runtime location.
  {
    name: 'dirname(resolve(../package.json))',
    scope: 'relative-package-json',
    pattern: /[\w$.]+\.dirname\(\s*(?:__require\.resolve|require\.resolve)\(\s*"(?:\.\.\/)+package\.json"\s*\)\s*\)/g,
    replacement: 'process.cwd()',
  },
  {
    name: 'resolve(../package.json)',
    scope: 'relative-package-json',
    pattern: /(?:__require\.resolve|require\.resolve)\(\s*"(?:\.\.\/)+package\.json"\s*\)/g,
    replacement: '"package-json-stub"',
  },
  {
    name: 'require(../package.json)',
    scope: 'relative-package-json',
    pattern: /(?:__require|require)\(\s*"(?:\.\.\/)+package\.json"\s*\)/g,
    replacement: '({name:"unknown",version:"0.0.0"})',
  },
];

/**
 * Apply all bundle compatibility patches to a file.
 * Returns the list of rules that matched (for diagnostics).
 */
function applyBundlePatches(filePath: string): string[] {
  const original = fs.readFileSync(filePath, 'utf8');
  let code = original;
  const applied: string[] = [];

  for (const rule of BUNDLE_PATCH_RULES) {
    const before = code;
    code = code.replace(rule.pattern, rule.replacement);
    if (code !== before) {
      applied.push(`${rule.scope}: ${rule.name}`);
    }
  }

  if (code !== original) {
    fs.writeFileSync(filePath, code);
    for (const desc of applied) {
      log.info(`  patched: ${desc}`);
    }
  }

  return applied;
}

// ─────────────────────────────────────────────────────────────────────
// Rolldown loader (handles ESM-only package from CJS context)
// ─────────────────────────────────────────────────────────────────────

let _rolldownCache: any = null;

async function loadRolldown(): Promise<any> {
  if (_rolldownCache) return _rolldownCache;

  // rolldown is ESM-only, so we need dynamic import
  const dynamicImport = new Function('specifier', 'return import(specifier)');

  // Try to find rolldown in the local node_modules first
  const localPath = path.join(__dirname, '../node_modules/rolldown/dist/index.mjs');
  if (fs.existsSync(localPath)) {
    _rolldownCache = await dynamicImport(localPath);
    return _rolldownCache;
  }

  // Fallback: try bare specifier (might work if hoisted)
  try {
    _rolldownCache = await dynamicImport('rolldown');
    return _rolldownCache;
  } catch {
    throw new Error('rolldown not found');
  }
}

// ─────────────────────────────────────────────────────────────────────
// Adapter registry
// ─────────────────────────────────────────────────────────────────────

const adapters: Record<string, () => BundleAdapter> = {
  rolldown: () => new RolldownAdapter(),
};

export function getAdapter(name: string): BundleAdapter {
  const factory = adapters[name];
  if (!factory) {
    throw new Error(
      `Unknown bundler: ${name}. Available: ${Object.keys(adapters).join(', ')}`
    );
  }
  return factory();
}

/**
 * Hakobu Configuration Normalization
 *
 * Reads packaging config from:
 *   1. CLI flags (highest priority)
 *   2. package.json "hakobu" field (modern)
 *   3. package.json "pkg" field (legacy — accepted with warnings)
 *
 * All inputs are normalized into PackageOptions for the packaging pipeline.
 * Legacy `pkg` options are mapped where safe, warned where changed, and
 * rejected where unsupported.
 */

import fs from 'fs';
import path from 'path';
import type { PackageOptions } from './packager';

// ─────────────────────────────────────────────────────────────────────
// Modern config shape (package.json "hakobu" field)
// ─────────────────────────────────────────────────────────────────────

export interface HakobuConfig {
  /** Entry file relative to project root. */
  entry?: string;

  /** Target specification string (e.g., 'node24-linux-x64'). */
  target?: string;

  /** Multiple targets (e.g., ['node24-linux-x64', 'node24-win-x64']). */
  targets?: string[];

  /** Output executable path (single target) or directory (multi-target). */
  output?: string;

  /** Asset glob patterns to include. */
  assets?: string[];

  /** External artifact names (kept outside the executable). */
  externals?: string[];

  /** Bundle mode: true, 'rolldown', or false/undefined. */
  bundle?: boolean | string;

  /** Modules to keep external when bundling. */
  bundleExternal?: string[];

  /**
   * Bytecode compilation: compile JS to V8 bytecode before packaging.
   * Opt-in. Default: false (source-only mode).
   * When true, scripts are compiled to bytecode for the target platform.
   * Source maps are not available in bytecode mode.
   */
  bytecode?: boolean;

  /**
   * Executable metadata for Windows PE resources.
   * Sets VERSIONINFO fields (product name, version, description, etc.)
   * and optionally an application icon.
   */
  metadata?: {
    productName?: string;
    fileDescription?: string;
    companyName?: string;
    legalCopyright?: string;
    fileVersion?: string;
    productVersion?: string;
    icon?: string;
  };

  /**
   * Produce a macOS .app bundle instead of a raw executable.
   * Only valid for macOS targets.
   */
  appBundle?: boolean;

  /**
   * macOS bundle metadata for Info.plist generation.
   * Only used when appBundle is true.
   */
  macos?: {
    bundleId?: string;
    displayName?: string;
    bundleVersion?: string;
    shortVersion?: string;
    copyright?: string;
    /** Path to a .icns file to embed as the application icon. */
    icon?: string;
  };

  /**
   * Produce a Linux AppDir instead of a raw executable.
   * Only valid for Linux targets.
   */
  appDir?: boolean;

  /**
   * Produce an AppImage from the AppDir output.
   * Implies appDir. Requires external appimagetool in PATH.
   */
  appImage?: boolean;

  /**
   * Snapshot compression algorithm: 'brotli' or 'gzip'.
   * Default: none (uncompressed).
   */
  compress?: 'brotli' | 'gzip';

  /**
   * V8 flags to bake into the executable.
   * Array of flag strings, each prefixed with '--'.
   * Example: ["--expose-gc", "--max-heap-size=34"]
   */
  options?: string[];

  /**
   * Linux desktop metadata for .desktop file generation.
   * Only used when appDir is true.
   */
  linux?: {
    name?: string;
    comment?: string;
    categories?: string;
    terminal?: boolean;
    icon?: string;
    /** Path to a .png file to place as the application icon. */
    iconPath?: string;
    /** One-line summary for AppStream metainfo. */
    summary?: string;
    /** Longer description for AppStream metainfo. */
    description?: string;
    /** Homepage URL for AppStream metainfo. */
    url?: string;
    /** SPDX license identifier (e.g., 'MIT', 'Apache-2.0'). */
    license?: string;
    /** Application version for AppStream metainfo. */
    version?: string;
  };
}

// ─────────────────────────────────────────────────────────────────────
// Legacy config shape (package.json "pkg" field)
// ─────────────────────────────────────────────────────────────────────

interface LegacyPkgConfig {
  scripts?: string[];
  assets?: string[];
  targets?: string[];
  outputPath?: string;
  // Unsupported legacy options — detected and rejected
  patches?: unknown;
  dictionary?: unknown;
  deployFiles?: unknown;
  ignore?: unknown;
  log?: unknown;
}

// ─────────────────────────────────────────────────────────────────────
// CLI args shape (from minimist)
// ─────────────────────────────────────────────────────────────────────

export interface CliArgs {
  projectRoot: string;
  entry?: string;
  target?: string;
  output?: string;
  bundle?: boolean | string;
  external?: string | string[];
  bytecode?: boolean;
  // Legacy CLI aliases
  targets?: string;
  config?: string;
  'out-path'?: string;
  outdir?: string;
  'out-dir'?: string;
  'no-bytecode'?: boolean;
  compress?: string;
  build?: boolean;
  public?: boolean;
  'public-packages'?: string;
  sea?: boolean;
  options?: string;
  'no-native-build'?: boolean;
  'no-dict'?: string;
}

// ─────────────────────────────────────────────────────────────────────
// Config warnings
// ─────────────────────────────────────────────────────────────────────

export interface ConfigWarning {
  type: 'migrated' | 'deprecated' | 'unsupported';
  option: string;
  message: string;
}

// ─────────────────────────────────────────────────────────────────────
// Normalization result
// ─────────────────────────────────────────────────────────────────────

export interface NormalizedConfig {
  options: PackageOptions;
  warnings: ConfigWarning[];
}

// ─────────────────────────────────────────────────────────────────────
// Main normalization function
// ─────────────────────────────────────────────────────────────────────

export function normalizeConfig(args: CliArgs): NormalizedConfig {
  const warnings: ConfigWarning[] = [];
  const projectRoot = path.resolve(args.projectRoot);

  // ── Read package.json ──
  const pkgJsonPath = path.join(projectRoot, 'package.json');
  let hakobuConfig: HakobuConfig | undefined;
  let legacyConfig: LegacyPkgConfig | undefined;

  if (fs.existsSync(pkgJsonPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));

      if (pkg.hakobu) {
        hakobuConfig = pkg.hakobu;
      }

      if (pkg.pkg) {
        if (hakobuConfig) {
          warnings.push({
            type: 'deprecated',
            option: 'pkg',
            message:
              'Both "hakobu" and "pkg" fields found in package.json. Using "hakobu"; ignoring "pkg".',
          });
        } else {
          legacyConfig = pkg.pkg;
          warnings.push({
            type: 'migrated',
            option: 'pkg',
            message:
              'Reading config from "pkg" field. Migrate to "hakobu" field for future compatibility.',
          });
        }
      }
    } catch {
      /* invalid package.json — analyzer will handle this */
    }
  }

  // ── Handle legacy --config / -c flag ──
  if (args.config) {
    warnings.push({
      type: 'deprecated',
      option: '--config',
      message:
        '--config is deprecated. Put config in the "hakobu" field of package.json instead.',
    });
  }

  // ── Reject unsupported legacy CLI flags ──
  checkUnsupportedCliFlag(args, 'no-bytecode', warnings);
  checkUnsupportedCliFlag(args, 'public', warnings);
  checkUnsupportedCliFlag(args, 'public-packages', warnings);
  checkUnsupportedCliFlag(args, 'sea', warnings);
  // options is now supported — V8 flags baking (handled in normalization below)
  checkUnsupportedCliFlag(args, 'no-native-build', warnings);
  checkUnsupportedCliFlag(args, 'no-dict', warnings);
  // build is now supported — force local base binary build

  // ── Handle legacy --out-path / --outdir ──
  let legacyOutputPath: string | undefined;
  const outPathValue = args['out-path'] || args.outdir || args['out-dir'];
  if (outPathValue) {
    warnings.push({
      type: 'migrated',
      option: '--out-path',
      message:
        '--out-path is accepted. Use --output with a full path in new projects.',
    });
    legacyOutputPath = String(outPathValue);
  }

  // ── Handle legacy --targets (comma-separated, plural) ──
  let legacyTarget: string | undefined;
  if (args.targets) {
    const targetList = String(args.targets).split(',').filter(Boolean);
    if (targetList.length > 1) {
      warnings.push({
        type: 'deprecated',
        option: '--targets',
        message:
          'Multi-target builds are not supported. Hakobu builds one target at a time. Using the first target.',
      });
    }
    if (targetList.length > 0) {
      legacyTarget = targetList[0];
      warnings.push({
        type: 'migrated',
        option: '--targets',
        message:
          '--targets is accepted. Use --target (singular) in new projects.',
      });
    }
  }

  // ── Normalize legacy pkg config ──
  const fromLegacy = legacyConfig
    ? normalizeLegacy(legacyConfig, warnings)
    : {};

  // ── Normalize modern hakobu config ──
  const fromModern = hakobuConfig || {};

  // ── Merge: CLI > modern config > legacy config ──
  // CLI flags take highest priority, then modern "hakobu" field, then legacy "pkg" field.
  const source = hakobuConfig ? fromModern : fromLegacy;

  const entry = args.entry || source.entry;
  const target = args.target || legacyTarget || source.target;
  const output = resolveOutput(args.output, legacyOutputPath, source.output);
  const assets = source.assets;
  const externals = source.externals;

  // Bundle mode
  let bundle: boolean | string | undefined;
  if (args.bundle === true || args.bundle === '') {
    bundle = true;
  } else if (typeof args.bundle === 'string') {
    bundle = args.bundle;
  } else {
    bundle = source.bundle;
  }

  let bundleExternal: string[] | undefined;
  if (args.external) {
    bundleExternal = Array.isArray(args.external)
      ? args.external
      : [String(args.external)];
  } else {
    bundleExternal = source.bundleExternal;
  }

  // Bytecode mode — CLI --bytecode overrides config only when explicitly true
  const bytecode = args.bytecode === true ? true : (source.bytecode ?? false);

  // Compression — CLI --compress overrides config
  let compress: 'brotli' | 'gzip' | undefined;
  if (args.compress) {
    const algo = String(args.compress).toLowerCase();
    if (algo === 'brotli' || algo === 'br') {
      compress = 'brotli';
    } else if (algo === 'gzip' || algo === 'gz') {
      compress = 'gzip';
    } else if (algo !== 'none') {
      warnings.push({
        type: 'unsupported',
        option: '--compress',
        message: `--compress "${args.compress}" is not supported. Use Brotli or GZip (or omit for no compression).`,
      });
    }
  } else {
    compress = hakobuConfig?.compress;
  }

  // V8 baked options — CLI --options overrides config
  let v8Options: string[] | undefined;
  if (args.options) {
    v8Options = String(args.options)
      .split(',')
      .filter(Boolean)
      .map((flag) => (flag.startsWith('--') ? flag : `--${flag}`));
  } else if (hakobuConfig?.options) {
    v8Options = hakobuConfig.options.map((flag: string) =>
      flag.startsWith('--') ? flag : `--${flag}`,
    );
  }

  // Metadata — from "hakobu.metadata" in package.json
  const metadata = hakobuConfig?.metadata;

  return {
    options: {
      projectRoot,
      entry,
      target,
      output,
      assets,
      externals,
      bundle,
      bundleExternal,
      bytecode: bytecode || undefined,
      metadata,
      appBundle: hakobuConfig?.appBundle,
      macos: hakobuConfig?.macos,
      appDir: hakobuConfig?.appDir,
      appImage: hakobuConfig?.appImage,
      linux: hakobuConfig?.linux,
      compress,
      options: v8Options,
      forceBuild: args.build === true ? true : undefined,
    },
    warnings,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Legacy normalization
// ─────────────────────────────────────────────────────────────────────

function normalizeLegacy(
  legacy: LegacyPkgConfig,
  warnings: ConfigWarning[],
): Partial<HakobuConfig> {
  const result: Partial<HakobuConfig> = {};

  // pkg.scripts → mapped to assets (they were extra files to include)
  if (legacy.scripts && legacy.scripts.length > 0) {
    warnings.push({
      type: 'migrated',
      option: 'pkg.scripts',
      message:
        '"pkg.scripts" mapped to "hakobu.assets". In Hakobu, use "assets" for extra files to include.',
    });
    result.assets = [...(legacy.assets || []), ...legacy.scripts];
  } else if (legacy.assets && legacy.assets.length > 0) {
    result.assets = legacy.assets;
  }

  // pkg.targets → take the first one
  if (legacy.targets && legacy.targets.length > 0) {
    if (legacy.targets.length > 1) {
      warnings.push({
        type: 'deprecated',
        option: 'pkg.targets',
        message:
          'Multi-target "pkg.targets" not supported. Hakobu builds one target at a time. Using the first.',
      });
    }
    result.target = legacy.targets[0];
  }

  // pkg.outputPath → output
  if (legacy.outputPath) {
    result.output = legacy.outputPath;
  }

  // Reject unsupported legacy config fields
  if (legacy.patches) {
    warnings.push({
      type: 'unsupported',
      option: 'pkg.patches',
      message:
        '"pkg.patches" is not supported. Hakobu does not support source patching during packaging.',
    });
  }

  if (legacy.dictionary) {
    warnings.push({
      type: 'unsupported',
      option: 'pkg.dictionary',
      message:
        '"pkg.dictionary" is not supported. Hakobu resolves dependencies from the project directly.',
    });
  }

  if (legacy.deployFiles) {
    warnings.push({
      type: 'unsupported',
      option: 'pkg.deployFiles',
      message:
        '"pkg.deployFiles" is not supported. Use "hakobu.assets" for extra files, or "hakobu.externals" for external binaries.',
    });
  }

  if (legacy.ignore) {
    warnings.push({
      type: 'unsupported',
      option: 'pkg.ignore',
      message:
        '"pkg.ignore" is not supported. Hakobu includes only files reachable from the entry point.',
    });
  }

  return result;
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

function resolveOutput(
  cliOutput?: string,
  legacyOutputPath?: string,
  configOutput?: string,
): string | undefined {
  if (cliOutput) return cliOutput;
  if (configOutput) return configOutput;
  if (legacyOutputPath) return legacyOutputPath;
  return undefined;
}

function checkUnsupportedCliFlag(
  args: Record<string, any>,
  flag: string,
  warnings: ConfigWarning[],
): void {
  if (args[flag] !== undefined && args[flag] !== false) {
    const messages: Record<string, string> = {
      'no-bytecode':
        '--no-bytecode is not needed. Hakobu defaults to source-only mode. Use --bytecode to opt in to bytecode compilation.',
      // compress is now supported — handled in normalization above
      public: '--public is not supported. Hakobu always includes source.',
      'public-packages':
        '--public-packages is not supported. Hakobu always includes source.',
      sea: '--sea is not supported. Hakobu uses its own snapshot format, not Node SEA.',
      // options is now supported — handled in normalization above
      'no-native-build':
        '--no-native-build is not needed. Hakobu does not prebuild native addons by default.',
      'no-dict':
        '--no-dict is not supported. Hakobu does not use dictionaries.',
      // build is now supported — handled in normalization
    };
    warnings.push({
      type: 'unsupported',
      option: `--${flag}`,
      message: messages[flag] || `--${flag} is not supported.`,
    });
  }
}

/**
 * Hakobu Normalized Packaging Manifest
 *
 * This is the canonical internal representation of "what goes into the
 * executable". It sits between analysis (Task 4.2) and snapshot assembly
 * (Task 5), and is the single source of truth for the packaging pipeline.
 *
 * Lifecycle:
 *   1. User config (CLI / package.json / config file)
 *   2. Analysis (walker + resolver scan the project)
 *   3. → NORMALIZED MANIFEST (this file's types) ←
 *   4. Bundle mode (optional — rewrites the script graph)
 *   5. Snapshot assembly (reads manifest → builds snapshot blob)
 *   6. Executable assembly (base binary + snapshot + bootstrap)
 *
 * The manifest is internal-first. It is NOT the user-facing config schema.
 * User config is parsed and normalized into this shape by the analyzer.
 */

// ─────────────────────────────────────────────────────────────────────
// Module format
// ─────────────────────────────────────────────────────────────────────

/**
 * How a module's format was determined.
 *
 * Node 24 uses these rules (in order):
 *   1. .mjs → always ESM
 *   2. .cjs → always CJS
 *   3. .js  → check nearest package.json "type" field
 *   4. no extension → CJS (require), ESM (import) depending on context
 */
export type ModuleFormat = 'esm' | 'cjs';

/**
 * How the entrypoint format was resolved.
 * - 'extension': determined by file extension (.mjs, .cjs)
 * - 'package-type': determined by nearest package.json "type" field
 * - 'explicit': set explicitly by user config
 */
export type FormatSource = 'extension' | 'package-type' | 'explicit';

// ─────────────────────────────────────────────────────────────────────
// Entrypoint
// ─────────────────────────────────────────────────────────────────────

export interface ManifestEntrypoint {
  /** Absolute path to the entrypoint file on disk during analysis. */
  absolutePath: string;

  /**
   * Snapshot-relative path (POSIX-normalized).
   * This becomes the canonical path inside the packaged executable.
   * e.g., "/snapshot/my-app/src/index.js"
   */
  snapshotPath: string;

  /** Module format of the entrypoint. */
  format: ModuleFormat;

  /** How the format was determined. */
  formatSource: FormatSource;
}

// ─────────────────────────────────────────────────────────────────────
// File classification
// ─────────────────────────────────────────────────────────────────────

/**
 * Every file in the manifest is classified into one of these kinds.
 *
 * - script:       JS/MJS/CJS executed by Node's module system
 * - json:         JSON files loaded by require() or import assertions
 * - wasm:         WebAssembly modules
 * - package-json: package.json files needed for module resolution
 * - asset:        non-executable files read at runtime (templates, etc.)
 * - native-addon: .node binary addons (extracted to disk at runtime)
 */
export type FileKind =
  | 'script'
  | 'json'
  | 'wasm'
  | 'package-json'
  | 'asset'
  | 'native-addon';

export interface ManifestFile {
  /** Absolute path on disk during analysis. */
  absolutePath: string;

  /** Snapshot-relative path (POSIX-normalized). */
  snapshotPath: string;

  /** Classification of this file. */
  kind: FileKind;

  /**
   * Module format for script files. Null for non-script files.
   * Determined by extension + nearest package.json "type" field.
   */
  format: ModuleFormat | null;

  /**
   * The package boundary this file belongs to, identified by the
   * snapshot path of its package.json. Null for files outside any
   * package (e.g., project root files without a package.json).
   */
  packageBoundary: string | null;
}

// ─────────────────────────────────────────────────────────────────────
// Package metadata (for module resolution)
// ─────────────────────────────────────────────────────────────────────

/**
 * Packaged representation of a package.json.
 *
 * The runtime needs this metadata to resolve imports correctly inside
 * the snapshot — especially for `exports`, `imports`, and `type` fields.
 * Only resolution-relevant fields are included.
 */
export interface PackageMetadata {
  /** Snapshot path to this package.json. */
  snapshotPath: string;

  /** Package name (e.g., "express"). */
  name: string | null;

  /** Package version. */
  version: string | null;

  /** "type" field — determines .js format for files in this package. */
  type: 'module' | 'commonjs' | null;

  /** "main" field — CJS main entry. */
  main: string | null;

  /** "exports" field — Node subpath exports map. Raw JSON value. */
  exports: unknown | null;

  /** "imports" field — Node subpath imports map. Raw JSON value. */
  imports: unknown | null;

  /**
   * "dependencies" — needed at analysis time for resolution.
   * Not stored in the snapshot; used only during manifest construction.
   */
  dependencies: Record<string, string> | null;
}

// ─────────────────────────────────────────────────────────────────────
// Native addons
// ─────────────────────────────────────────────────────────────────────

/**
 * A native .node addon that must be extracted to the real filesystem
 * at runtime because it cannot be loaded from an in-memory snapshot.
 */
export interface NativeAddon {
  /** Snapshot path where the addon placeholder lives. */
  snapshotPath: string;

  /** Absolute path on disk during analysis. */
  absolutePath: string;

  /**
   * Content hash of the addon binary. Used to build deterministic
   * extraction paths at runtime.
   */
  contentHash: string;

  /**
   * Target platform and arch this addon is built for.
   * Used to validate addon/target compatibility during packaging.
   */
  targetPlatform: string | null;
  targetArch: string | null;
}

// ─────────────────────────────────────────────────────────────────────
// External artifacts
// ─────────────────────────────────────────────────────────────────────

/**
 * A file or directory that is intentionally kept outside the executable.
 * The packaged app can reference it through runtime helpers.
 *
 * Examples: browser binaries, ffmpeg, large data files.
 */
export interface ExternalArtifact {
  /** Identifier used by the app to locate this artifact at runtime. */
  name: string;

  /** Path pattern (glob or directory) that matches external files. */
  pattern: string;

  /** Whether this external is required (error if missing) or optional. */
  required: boolean;
}

// ─────────────────────────────────────────────────────────────────────
// Runtime target
// ─────────────────────────────────────────────────────────────────────

export type Platform = 'linux' | 'win' | 'macos';
export type Arch = 'x64' | 'arm64';

export interface RuntimeTarget {
  platform: Platform;
  arch: Arch;
  nodeLine: '24';
  nodeVersion: string;
}

// ─────────────────────────────────────────────────────────────────────
// Bundle mode
// ─────────────────────────────────────────────────────────────────────

/**
 * Configuration for optional bundle-mode preprocessing.
 *
 * Bundle mode is an adapter in front of the normal pipeline. It rewrites
 * the script graph (e.g., via Rolldown) before snapshot assembly.
 * It is NOT the default and must remain optional.
 */
export interface BundleModeConfig {
  /** Whether bundle mode is enabled. */
  enabled: boolean;

  /**
   * Bundler to use. Rolldown is the preferred first integration.
   * This is a hook point — the bundler interface will be defined when
   * bundle mode is implemented (Task 11).
   */
  bundler: 'rolldown' | string;

  /**
   * Bundler-specific options. Passed through to the bundler adapter.
   * Shape depends on the bundler.
   */
  options: Record<string, unknown>;

  /**
   * Files/packages to exclude from bundling (kept as separate snapshot
   * entries). Useful for dynamic requires, native addons, etc.
   */
  externals: string[];
}

// ─────────────────────────────────────────────────────────────────────
// Compression
// ─────────────────────────────────────────────────────────────────────

export type CompressionType = 'none' | 'brotli' | 'gzip';

// ─────────────────────────────────────────────────────────────────────
// The normalized manifest
// ─────────────────────────────────────────────────────────────────────

/**
 * The Hakobu Normalized Packaging Manifest.
 *
 * This is the canonical internal representation produced by the analysis
 * phase. Every downstream step (bundle mode, snapshot assembly, executable
 * assembly) reads from this manifest.
 *
 * The manifest describes WHAT goes into the executable, not HOW to build
 * it. Build strategy (Docker, native, LTO) is handled by hakobu-fetch
 * and the CI pipeline.
 */
export interface PackagingManifest {
  // ── Project identity ──

  /** Absolute path to the project root on disk. */
  projectRoot: string;

  /**
   * Application identifier used in the snapshot filesystem root.
   * POSIX: /snapshot/{appId}/...
   * Windows: C:\snapshot\{appId}\...
   */
  appId: string;

  // ── Entrypoint ──

  /** The application entrypoint. */
  entry: ManifestEntrypoint;

  // ── File graph ──

  /**
   * All files to be packaged into the snapshot, including the entrypoint.
   * Keyed by snapshot path for O(1) lookup.
   */
  files: Record<string, ManifestFile>;

  // ── Package metadata ──

  /**
   * Package.json metadata for all packages in the dependency graph.
   * Keyed by snapshot path of the package.json.
   *
   * The runtime uses this for:
   * - Module format determination ("type" field)
   * - Subpath exports/imports resolution
   * - Package boundary enforcement
   */
  packages: Record<string, PackageMetadata>;

  // ── Native addons ──

  /** Native .node addons that need runtime extraction. */
  nativeAddons: NativeAddon[];

  // ── Externals ──

  /** Files/directories intentionally kept outside the executable. */
  externals: ExternalArtifact[];

  // ── Targets ──

  /** Runtime targets to build for. */
  targets: RuntimeTarget[];

  // ── Build options ──

  /**
   * Bundle mode config. Null when native mode (default) is used.
   * Bundle mode rewrites the script graph before snapshot assembly.
   */
  bundleMode: BundleModeConfig | null;

  /** Compression for snapshot content. */
  compression: CompressionType;

  /**
   * Additional Node.js flags to embed in the executable's bootstrap.
   * e.g., ["--max-old-space-size=4096"]
   */
  runtimeFlags: string[];

  // ── Diagnostics ──

  /**
   * Warnings generated during analysis. These are non-fatal issues
   * that the user should be aware of but that don't block packaging.
   */
  warnings: ManifestWarning[];
}

// ─────────────────────────────────────────────────────────────────────
// Diagnostics
// ─────────────────────────────────────────────────────────────────────

/**
 * Diagnostic severity:
 * - error:   blocks correct packaging. The packaged app will not work.
 * - warning: may cause incorrect behavior. Should be reviewed.
 * - info:    informational. No action required but useful for debugging.
 */
export type DiagnosticSeverity = 'error' | 'warning' | 'info';

export type WarningCategory =
  | 'exports-not-resolved'
  | 'imports-not-resolved'
  | 'unresolved-import'
  | 'dynamic-require'
  | 'dynamic-import'
  | 'missing-asset'
  | 'addon-platform-mismatch'
  | 'deprecated-config'
  | 'legacy-pkg-config'
  | 'unsupported-feature'
  | 'esm-resolution-fallback';

export interface ManifestWarning {
  severity: DiagnosticSeverity;
  category: WarningCategory;
  message: string;
  /** File that triggered the warning, if applicable. */
  file: string | null;
  /** Suggested remediation. */
  suggestion: string | null;
}

/**
 * Hakobu Runtime Diagnostics
 *
 * Structured error types for addon and external artifact failures.
 * These wrap low-level errors with actionable context so users know
 * what Hakobu was doing and how to fix the problem.
 *
 * Error types:
 *   HakobuAddonError     — native .node addon failures
 *   HakobuExternalError  — external artifact lookup failures
 *
 * All errors include:
 *   - what Hakobu was trying to do (operation)
 *   - the relevant path/name
 *   - the original cause (if wrapping a lower-level error)
 *   - remediation guidance
 */

// ─────────────────────────────────────────────────────────────────────
// Base error
// ─────────────────────────────────────────────────────────────────────

export class HakobuRuntimeError extends Error {
  /** Machine-readable error code. */
  readonly code: string;

  /** What Hakobu was trying to do. */
  readonly operation: string;

  /** The original error, if this wraps one. */
  readonly cause?: Error;

  /** Remediation guidance. */
  readonly remediation: string;

  constructor(opts: {
    code: string;
    operation: string;
    message: string;
    remediation: string;
    cause?: Error;
  }) {
    const fullMessage = [
      `[${opts.code}] ${opts.message}`,
      ``,
      `Operation: ${opts.operation}`,
      `Remediation: ${opts.remediation}`,
      opts.cause ? `Cause: ${opts.cause.message}` : null,
    ].filter(Boolean).join('\n');

    super(fullMessage);
    this.name = 'HakobuRuntimeError';
    this.code = opts.code;
    this.operation = opts.operation;
    this.cause = opts.cause;
    this.remediation = opts.remediation;
  }
}

// ─────────────────────────────────────────────────────────────────────
// Addon errors
// ─────────────────────────────────────────────────────────────────────

export class HakobuAddonError extends HakobuRuntimeError {
  /** The snapshot path of the addon. */
  readonly addonPath: string;

  /** The extraction target path, if applicable. */
  readonly extractionPath?: string;

  constructor(opts: {
    code: string;
    operation: string;
    message: string;
    remediation: string;
    addonPath: string;
    extractionPath?: string;
    cause?: Error;
  }) {
    super(opts);
    this.name = 'HakobuAddonError';
    this.addonPath = opts.addonPath;
    this.extractionPath = opts.extractionPath;
  }
}

/**
 * Create a diagnostic error for a missing addon in the snapshot.
 */
export function addonNotInSnapshot(snapshotPath: string): HakobuAddonError {
  return new HakobuAddonError({
    code: 'HAKOBU_ADDON_NOT_FOUND',
    operation: `Loading native addon from snapshot: ${snapshotPath}`,
    message: `Native addon '${snapshotPath}' is not in the packaged snapshot.`,
    addonPath: snapshotPath,
    remediation:
      `Ensure the .node addon is included in the packaging manifest.\n` +
      `If it's a build-time artifact, run 'npm rebuild' before packaging.\n` +
      `If it should be excluded, add it to the externals list.`,
  });
}

/**
 * Create a diagnostic error for extraction failure.
 */
export function addonExtractionFailed(
  snapshotPath: string,
  extractionPath: string,
  cause: Error,
): HakobuAddonError {
  return new HakobuAddonError({
    code: 'HAKOBU_ADDON_EXTRACT_FAILED',
    operation: `Extracting addon to: ${extractionPath}`,
    message: `Failed to extract native addon '${snapshotPath}' to disk.`,
    addonPath: snapshotPath,
    extractionPath,
    cause,
    remediation:
      `Check filesystem permissions for the extraction directory.\n` +
      `Override the cache location with HAKOBU_ADDON_CACHE=/path/to/cache.\n` +
      `Ensure there is enough disk space.`,
  });
}

/**
 * Create a diagnostic error for dlopen/load failure (likely platform mismatch).
 */
export function addonLoadFailed(
  snapshotPath: string,
  extractedPath: string,
  cause: Error,
): HakobuAddonError {
  const isPlatformMismatch =
    cause.message.includes('wrong ELF class') ||
    cause.message.includes('not a valid Win32') ||
    cause.message.includes('Mach-O') ||
    cause.message.includes('invalid ELF header') ||
    cause.message.includes('GLIBC');

  const code = isPlatformMismatch
    ? 'HAKOBU_ADDON_PLATFORM_MISMATCH'
    : 'HAKOBU_ADDON_LOAD_FAILED';

  const remediation = isPlatformMismatch
    ? `This addon was compiled for a different platform or architecture.\n` +
      `The packaged binary targets a specific platform — ensure the addon\n` +
      `was built for the same OS and architecture.\n` +
      `Run 'npm rebuild' on the target platform before packaging.`
    : `The addon was extracted successfully but failed to load.\n` +
      `Check that all shared library dependencies are available.\n` +
      `On Linux, use 'ldd ${extractedPath}' to check dependencies.`;

  return new HakobuAddonError({
    code,
    operation: `Loading extracted addon: ${extractedPath}`,
    message: `Failed to load native addon '${snapshotPath}'.`,
    addonPath: snapshotPath,
    extractionPath: extractedPath,
    cause,
    remediation,
  });
}

// ─────────────────────────────────────────────────────────────────────
// External artifact errors
// ─────────────────────────────────────────────────────────────────────

export class HakobuExternalError extends HakobuRuntimeError {
  /** The declared artifact name. */
  readonly artifactName: string;

  constructor(opts: {
    code: string;
    operation: string;
    message: string;
    remediation: string;
    artifactName: string;
    cause?: Error;
  }) {
    super(opts);
    this.name = 'HakobuExternalError';
    this.artifactName = opts.artifactName;
  }
}

/**
 * Create a diagnostic error for a missing required external artifact.
 */
export function externalNotFound(
  name: string,
  searchedPaths: string[],
): HakobuExternalError {
  return new HakobuExternalError({
    code: 'HAKOBU_EXTERNAL_NOT_FOUND',
    operation: `Locating required external artifact: ${name}`,
    message: `Required external artifact '${name}' was not found.`,
    artifactName: name,
    remediation:
      `Searched locations:\n` +
      searchedPaths.map(p => `  - ${p}`).join('\n') + '\n\n' +
      `Set HAKOBU_EXTERNAL_${name.toUpperCase().replace(/[^A-Z0-9]/g, '_')} ` +
      `to the artifact path, or place it at one of the search locations.`,
  });
}

/**
 * Create a diagnostic error for an undeclared external artifact.
 */
export function externalNotDeclared(
  name: string,
  declared: string[],
): HakobuExternalError {
  return new HakobuExternalError({
    code: 'HAKOBU_EXTERNAL_NOT_DECLARED',
    operation: `Looking up external artifact: ${name}`,
    message: `External artifact '${name}' is not declared in the packaging manifest.`,
    artifactName: name,
    remediation:
      `Declared externals: ${declared.length ? declared.join(', ') : '(none)'}\n` +
      `Add '${name}' to the externals list in your Hakobu config.`,
  });
}

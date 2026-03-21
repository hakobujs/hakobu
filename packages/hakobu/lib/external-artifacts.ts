/**
 * Hakobu External Artifact Runtime
 *
 * Manages declared external artifacts — files or directories that are
 * intentionally kept outside the packaged executable. Examples:
 *
 *   - Browser binaries (Playwright, Camoufox)
 *   - ffmpeg or other helper tools
 *   - Large data files
 *
 * External artifacts are:
 *   - Declared explicitly in the packaging manifest (not guessed)
 *   - Resolved at runtime to real filesystem paths
 *   - NOT embedded in the snapshot
 *   - Validated at startup (required artifacts must exist)
 *
 * Resolution strategy:
 *   1. Check HAKOBU_EXTERNAL_{NAME} env var (uppercase, dashes→underscores)
 *   2. Check {execDir}/externals/{name}/ (relative to the executable)
 *   3. Check the declared pattern path (absolute or relative to cwd)
 *   4. If required and not found → throw with clear guidance
 *
 * Usage from packaged code:
 *   const { getExternal } = require('@hakobu/runtime');
 *   const browserPath = getExternal('camoufox-browser');
 */

import fs from 'fs';
import path from 'path';
import type { ExternalArtifact } from './manifest';

// ─────────────────────────────────────────────────────────────────────
// Resolution result
// ─────────────────────────────────────────────────────────────────────

export interface ResolvedExternal {
  /** The declared artifact name. */
  name: string;

  /** The resolved real filesystem path (file or directory). */
  resolvedPath: string;

  /** How the path was resolved. */
  resolvedVia: 'env' | 'exec-relative' | 'pattern' | 'cwd-relative';

  /** Whether this is a file or directory. */
  isDirectory: boolean;
}

// ─────────────────────────────────────────────────────────────────────
// Registry
// ─────────────────────────────────────────────────────────────────────

/**
 * Runtime registry of declared external artifacts.
 * Created from the manifest's externals list during bootstrap.
 */
export class ExternalArtifactRegistry {
  private readonly declarations: Map<string, ExternalArtifact>;
  private readonly resolved: Map<string, ResolvedExternal>;
  private readonly execDir: string;

  constructor(artifacts: ExternalArtifact[], execDir?: string) {
    this.declarations = new Map();
    this.resolved = new Map();
    this.execDir = execDir || path.dirname(process.execPath);

    for (const artifact of artifacts) {
      this.declarations.set(artifact.name, artifact);
    }
  }

  /**
   * Get a declared external artifact by name.
   * Resolves the path on first access and caches the result.
   *
   * @param name - The declared artifact name
   * @returns ResolvedExternal with the real filesystem path
   * @throws Error if the artifact is required but not found
   */
  get(name: string): ResolvedExternal | null {
    // Check cache
    if (this.resolved.has(name)) {
      return this.resolved.get(name)!;
    }

    const decl = this.declarations.get(name);
    if (!decl) {
      throw new Error(
        `External artifact '${name}' is not declared in the packaging manifest.\n` +
        `Declared externals: ${[...this.declarations.keys()].join(', ') || '(none)'}\n` +
        `Add it to the externals list in your Hakobu config.`
      );
    }

    const resolved = this.resolve(decl);

    if (resolved) {
      this.resolved.set(name, resolved);
      return resolved;
    }

    if (decl.required) {
      throw new Error(
        `Required external artifact '${name}' not found.\n` +
        `Searched:\n` +
        `  1. env HAKOBU_EXTERNAL_${toEnvName(name)}\n` +
        `  2. ${path.join(this.execDir, 'externals', name)}\n` +
        `  3. pattern: ${decl.pattern}\n` +
        `Set the environment variable or place the artifact in one of these locations.`
      );
    }

    return null;
  }

  /**
   * Check if a declared external artifact exists without throwing.
   */
  has(name: string): boolean {
    try {
      return this.get(name) !== null;
    } catch {
      return false;
    }
  }

  /**
   * Validate all required externals exist. Throws on first missing.
   */
  validateRequired(): void {
    for (const [name, decl] of this.declarations) {
      if (decl.required) {
        this.get(name); // throws if missing
      }
    }
  }

  /**
   * List all declared external artifact names.
   */
  listDeclared(): string[] {
    return [...this.declarations.keys()];
  }

  // ── Resolution logic ──

  private resolve(decl: ExternalArtifact): ResolvedExternal | null {
    // 1. Environment variable override
    const envKey = `HAKOBU_EXTERNAL_${toEnvName(decl.name)}`;
    const envVal = process.env[envKey];
    if (envVal && fs.existsSync(envVal)) {
      return {
        name: decl.name,
        resolvedPath: path.resolve(envVal),
        resolvedVia: 'env',
        isDirectory: fs.statSync(envVal).isDirectory(),
      };
    }

    // 2. Executable-relative: {execDir}/externals/{name}
    const execRelative = path.join(this.execDir, 'externals', decl.name);
    if (fs.existsSync(execRelative)) {
      return {
        name: decl.name,
        resolvedPath: execRelative,
        resolvedVia: 'exec-relative',
        isDirectory: fs.statSync(execRelative).isDirectory(),
      };
    }

    // 3. Pattern path (absolute or relative to cwd)
    const patternPath = path.resolve(decl.pattern);
    if (fs.existsSync(patternPath)) {
      return {
        name: decl.name,
        resolvedPath: patternPath,
        resolvedVia: 'pattern',
        isDirectory: fs.statSync(patternPath).isDirectory(),
      };
    }

    // 4. CWD-relative by name
    const cwdRelative = path.resolve(decl.name);
    if (cwdRelative !== patternPath && fs.existsSync(cwdRelative)) {
      return {
        name: decl.name,
        resolvedPath: cwdRelative,
        resolvedVia: 'cwd-relative',
        isDirectory: fs.statSync(cwdRelative).isDirectory(),
      };
    }

    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

/**
 * Convert an artifact name to an environment variable suffix.
 * "camoufox-browser" → "CAMOUFOX_BROWSER"
 */
function toEnvName(name: string): string {
  return name.toUpperCase().replace(/[^A-Z0-9]/g, '_');
}

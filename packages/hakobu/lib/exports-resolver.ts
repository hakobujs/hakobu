/**
 * Node-compatible package.json exports/imports map resolution.
 *
 * Implements the PACKAGE_EXPORTS_RESOLVE and PACKAGE_IMPORTS_RESOLVE
 * algorithms from the Node.js ESM specification, adapted for snapshot
 * resolution.
 *
 * Reference: https://nodejs.org/api/esm.html#resolver-algorithm-specification
 *
 * Supported:
 *   - String exports: "exports": "./lib/index.js"
 *   - Object exports with "." key: "exports": { ".": "./lib/index.js" }
 *   - Subpath exports: "exports": { "./utils": "./lib/utils.js" }
 *   - Conditional exports: { "import": "...", "require": "...", "default": "..." }
 *   - Nested conditions: { ".": { "import": "...", "require": "..." } }
 *   - Pattern exports: "exports": { "./*": "./lib/*.js" }
 *   - Package imports (#-prefixed): "imports": { "#utils": "./src/utils.js" }
 *
 * Not yet supported:
 *   - Array fallback targets: ["./a.js", "./b.js"]
 */

// ─────────────────────────────────────────────────────────────────────
// Conditions
// ─────────────────────────────────────────────────────────────────────

/**
 * Default condition set for ESM resolution.
 * Order matters — first match wins.
 */
export const ESM_CONDITIONS = ['import', 'node', 'default'];

/**
 * Default condition set for CJS resolution.
 */
export const CJS_CONDITIONS = ['require', 'node', 'default'];

// ─────────────────────────────────────────────────────────────────────
// Exports resolution
// ─────────────────────────────────────────────────────────────────────

/**
 * Resolve a subpath against a package's exports map.
 *
 * @param exports - The raw "exports" value from package.json
 * @param subpath - The subpath to resolve (e.g., "." or "./utils")
 * @param conditions - Condition names to match (e.g., ["import", "node", "default"])
 * @returns Resolved relative path (e.g., "./lib/index.js") or null
 */
export function resolveExports(
  exports: unknown,
  subpath: string,
  conditions: string[],
): string | null {
  if (exports === null || exports === undefined) return null;

  // Simple string: "exports": "./lib/index.js"
  // Only matches subpath "."
  if (typeof exports === 'string') {
    return subpath === '.' ? exports : null;
  }

  // Array fallback — not yet supported
  if (Array.isArray(exports)) {
    // Try each in order, return first valid
    for (const target of exports) {
      if (typeof target === 'string') return subpath === '.' ? target : null;
    }
    return null;
  }

  if (typeof exports !== 'object') return null;

  const map = exports as Record<string, unknown>;
  const keys = Object.keys(map);

  // Check if this is a conditions object or a subpath map.
  // A conditions object has keys that don't start with "."
  // A subpath map has keys that start with "."
  const isConditionsObject = keys.length > 0 && !keys[0].startsWith('.');

  if (isConditionsObject) {
    // This is a conditions object at the top level.
    // Only valid for subpath "."
    if (subpath !== '.') return null;
    return resolveConditions(map, conditions);
  }

  // Subpath map: { ".": ..., "./utils": ..., "./*": ... }
  // Look for exact match first
  if (subpath in map) {
    return resolveTarget(map[subpath], conditions);
  }

  // Pattern matching: "./*" or "./lib/*"
  for (const key of keys) {
    if (!key.includes('*')) continue;

    const pattern = key;
    const starIndex = pattern.indexOf('*');
    const prefix = pattern.slice(0, starIndex);
    const suffix = pattern.slice(starIndex + 1);

    if (subpath.startsWith(prefix) && subpath.endsWith(suffix)) {
      const matched = subpath.slice(prefix.length, subpath.length - (suffix.length || Infinity));
      const target = resolveTarget(map[key], conditions);
      if (target && typeof target === 'string') {
        return target.replace('*', matched);
      }
    }
  }

  return null;
}

// ─────────────────────────────────────────────────────────────────────
// Imports resolution
// ─────────────────────────────────────────────────────────────────────

/**
 * Resolve a #-prefixed specifier against a package's imports map.
 *
 * @param imports - The raw "imports" value from package.json
 * @param specifier - The full #-prefixed specifier (e.g., "#utils")
 * @param conditions - Condition names to match
 * @returns Resolved relative path or null
 */
export function resolveImports(
  imports: unknown,
  specifier: string,
  conditions: string[],
): string | null {
  if (!imports || typeof imports !== 'object') return null;
  if (!specifier.startsWith('#')) return null;

  const map = imports as Record<string, unknown>;

  // Exact match
  if (specifier in map) {
    return resolveTarget(map[specifier], conditions);
  }

  // Pattern match: "#utils/*"
  for (const key of Object.keys(map)) {
    if (!key.includes('*')) continue;

    const starIndex = key.indexOf('*');
    const prefix = key.slice(0, starIndex);
    const suffix = key.slice(starIndex + 1);

    if (specifier.startsWith(prefix) && specifier.endsWith(suffix)) {
      const matched = specifier.slice(prefix.length, specifier.length - (suffix.length || Infinity));
      const target = resolveTarget(map[key], conditions);
      if (target && typeof target === 'string') {
        return target.replace('*', matched);
      }
    }
  }

  return null;
}

// ─────────────────────────────────────────────────────────────────────
// Internal: condition + target resolution
// ─────────────────────────────────────────────────────────────────────

/**
 * Resolve a target value which may be a string, conditions object, or null.
 */
function resolveTarget(target: unknown, conditions: string[]): string | null {
  if (typeof target === 'string') return target;
  if (target === null) return null;
  if (Array.isArray(target)) {
    for (const t of target) {
      const result = resolveTarget(t, conditions);
      if (result) return result;
    }
    return null;
  }
  if (typeof target === 'object') {
    return resolveConditions(target as Record<string, unknown>, conditions);
  }
  return null;
}

/**
 * Match a conditions object against the active condition set.
 * First matching condition wins (order of the conditions array matters).
 */
function resolveConditions(
  obj: Record<string, unknown>,
  conditions: string[],
): string | null {
  // Check each condition in priority order
  for (const cond of conditions) {
    if (cond in obj) {
      return resolveTarget(obj[cond], conditions);
    }
  }
  return null;
}
